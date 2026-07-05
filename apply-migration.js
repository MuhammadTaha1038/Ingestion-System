import { readFile } from "fs/promises";
import { getDatabasePool } from "./dist/db/pool.js";

async function run() {
  const sql = await readFile("./db/migrations/20260705_add_unsubscribes_table.sql", "utf-8");
  const pool = getDatabasePool();
  try {
    await pool.query(sql);
    console.log("Migration applied successfully!");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    pool.end();
  }
}

run();
