import "dotenv/config";
import { SmtpRepository } from "./src/db/repositories/smtp.js";
import { decrypt } from "./src/security/crypto.js";

async function run() {
  const repo = new SmtpRepository();
  const res = await repo.pool.query("SELECT id, host, port, username, password_encrypted FROM smtp_accounts WHERE id = $1", ["2d24c683-ca77-48c7-8908-efa5507d86fe"]);
  const row = res.rows[0];
  if (!row) {
    console.log("Account not found");
    process.exit(1);
  }
  const password = decrypt(row.password_encrypted);
  console.log(`Account: ${row.username}`);
  console.log(`Host: ${row.host}:${row.port}`);
  console.log(`Password length: ${password?.length}`);
  console.log(`Password is empty string? ${password === ""}`);
  process.exit(0);
}

run().catch(console.error);
