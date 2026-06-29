import pg from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";
import dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(join(__dirname, "../db/migrations/add_datasets_source_name.sql"), "utf-8");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const client = await pool.connect();
  try {
    console.log("Running migration on Neon database...");
    await client.query(migrationSql);
    console.log("Migration complete: source_name column added to datasets.");

    // Verify
    const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'datasets' AND column_name = 'source_name'
    `);
    if (res.rows.length > 0) {
      console.log("Verified: column exists ->", res.rows[0]);
    } else {
      console.log("WARNING: column not found after migration.");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
