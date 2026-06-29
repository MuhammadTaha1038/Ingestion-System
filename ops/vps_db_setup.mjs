/**
 * vps_db_setup.mjs
 * 
 * Connects to VPS via SSH, installs PostgreSQL, creates the database,
 * applies the full schema, then dumps Neon data and restores it into VPS.
 * 
 * All operations run ON THE VPS — nothing is downloaded locally.
 */

import { Client } from "ssh2";
import dotenv from "dotenv";

dotenv.config();

const VPS_HOST = process.env.VPS_HOST;
const VPS_USER = process.env.VPS_USER;
const VPS_PASSWORDS = [
  process.env.new_password,      // try new password first
  process.env.VPS_PASSWORD,      // fallback to original
].filter(Boolean);
const NEON_URL = process.env.DATABASE_URL;

const VPS_DB_NAME = "ingestion_db";
const VPS_DB_USER = "ingestion_user";
const VPS_DB_PASS = "Ingestion2026!";
const VPS_DB_URL = `postgresql://${VPS_DB_USER}:${VPS_DB_PASS}@localhost:5432/${VPS_DB_NAME}`;

if (!VPS_HOST || !VPS_USER || !VPS_PASSWORDS.length || !NEON_URL) {
  console.error("Missing required env vars: VPS_HOST, VPS_USER, VPS_PASSWORD, DATABASE_URL");
  process.exit(1);
}

function runCommand(conn, cmd, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n[${label}] Running...`);
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      stream.on("data", (d) => { stdout += d; process.stdout.write(d.toString()); });
      stream.stderr.on("data", (d) => { stderr += d; process.stderr.write(d.toString()); });
      stream.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`[${label}] exited with code ${code}\nstderr: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });
    });
  });
}

async function connectSSH() {
  for (const password of VPS_PASSWORDS) {
    try {
      const conn = new Client();
      await new Promise((resolve, reject) => {
        conn.on("ready", resolve);
        conn.on("error", reject);
        conn.connect({
          host: VPS_HOST,
          port: 22,
          username: VPS_USER,
          password,
          readyTimeout: 20000,
          authHandler: ["password"],
        });
      });
      console.log(`\n✅ Connected to VPS ${VPS_HOST} using password: ${password.slice(0,4)}****`);
      return conn;
    } catch (err) {
      console.warn(`   ⚠ Password ${password.slice(0,4)}**** failed: ${err.message}`);
    }
  }
  throw new Error("All passwords failed — check VPS_PASSWORD and new_password in .env");
}

async function main() {
  const conn = await connectSSH();

  try {
    // ─── Step 1: Install PostgreSQL ───────────────────────────────────────────
    await runCommand(conn,
      `DEBIAN_FRONTEND=noninteractive apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib`,
      "Install PostgreSQL"
    );

    // ─── Step 2: Start PostgreSQL ─────────────────────────────────────────────
    await runCommand(conn,
      `systemctl start postgresql && systemctl enable postgresql && systemctl is-active postgresql`,
      "Start PostgreSQL"
    );

    // ─── Step 3: Create DB user + database ───────────────────────────────────
    await runCommand(conn,
      `sudo -u postgres psql -c "DO \\$\\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${VPS_DB_USER}') THEN CREATE USER ${VPS_DB_USER} WITH PASSWORD '${VPS_DB_PASS}'; END IF; END \\$\\$;"`,
      "Create DB user"
    );
    await runCommand(conn,
      `sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${VPS_DB_NAME}'" | grep -q 1 || sudo -u postgres createdb -O ${VPS_DB_USER} ${VPS_DB_NAME}`,
      "Create database"
    );
    await runCommand(conn,
      `sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${VPS_DB_NAME} TO ${VPS_DB_USER};"`,
      "Grant privileges"
    );

    // ─── Step 4: Install pg_dump client tools for Neon dump ──────────────────
    // Ensure we have a pg_dump compatible with the Neon server (Postgres 18).
    // Add the PostgreSQL APT repo and install postgresql-client-18 if needed.
    // Try to install postgresql-client-18 (pg_dump v18) from the PGDG repo so it's compatible with Neon 18.
    await runCommand(conn,
      `(apt-get update -y && apt-get install -y wget ca-certificates gnupg) || true && \
      curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg || true && \
      echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt/ noble-pgdg main" > /etc/apt/sources.list.d/pgdg.list || true && \
      apt-get update -y || true && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-client-18 postgresql-client || true`,
      "Ensure postgresql-client-18 is installed (best-effort)"
    );

    // ─── Step 5: Dump Neon → restore into VPS (all on the server) ────────────
    console.log("\n[Dump & Restore] Dumping from Neon and restoring to VPS PostgreSQL...");
    const dumpAndRestore = `
if [ -x /usr/lib/postgresql/18/bin/pg_dump ]; then DUMP=/usr/lib/postgresql/18/bin/pg_dump; else DUMP=$(which pg_dump || echo pg_dump); fi; \
PGPASSWORD="" $DUMP "${NEON_URL}" --no-owner --no-acl --format=plain 2>/tmp/dump_err.log | \
PGPASSWORD="${VPS_DB_PASS}" psql -U ${VPS_DB_USER} -h localhost -d ${VPS_DB_NAME} 2>/tmp/restore_err.log; \
echo "Exit: $?"; \
cat /tmp/dump_err.log 2>/dev/null | head -40 || true; \
cat /tmp/restore_err.log 2>/dev/null | head -40 || true;
`;
    await runCommand(conn, dumpAndRestore, "Dump Neon → Restore VPS");

    // ─── Step 6: Verify tables on VPS ────────────────────────────────────────
    const tableList = await runCommand(conn,
      `PGPASSWORD="${VPS_DB_PASS}" psql -U ${VPS_DB_USER} -h localhost -d ${VPS_DB_NAME} -c "\\dt" 2>&1`,
      "Verify VPS tables"
    );
    console.log("\n📋 Tables on VPS:\n" + tableList);

    // ─── Step 7: Count key rows for sanity check ──────────────────────────────
    const counts = await runCommand(conn,
      `PGPASSWORD="${VPS_DB_PASS}" psql -U ${VPS_DB_USER} -h localhost -d ${VPS_DB_NAME} -c "SELECT 'datasets' as tbl, count(*) FROM datasets UNION ALL SELECT 'campaigns', count(*) FROM campaigns UNION ALL SELECT 'smtp_accounts', count(*) FROM smtp_accounts UNION ALL SELECT 'recipients', count(*) FROM recipients;" 2>&1`,
      "Row count verification"
    );
    console.log("\n📊 Row counts:\n" + counts);

    console.log("\n\n✅ ════════════════════════════════════════════════════════");
    console.log("   VPS DATABASE IS READY");
    console.log("   Connection string for .env:");
    console.log(`   DATABASE_URL=${VPS_DB_URL}`);
    console.log("════════════════════════════════════════════════════════\n");

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    process.exit(1);
  } finally {
    conn.end();
  }
}

main();
