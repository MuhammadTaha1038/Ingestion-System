import { Pool } from "pg";
import { getDatabasePool } from "../pool.js";

export class TestRecipientRepository {
  public readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? getDatabasePool();
  }

  private async ensureTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS test_recipient (
        id smallint PRIMARY KEY DEFAULT 1,
        email text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async getLatest(): Promise<string | null> {
    await this.ensureTable();
    const res = await this.pool.query(`SELECT email FROM test_recipient WHERE id = 1`);
    if (!res.rows[0]) return null;
    return String(res.rows[0].email);
  }

  async setLatest(email: string): Promise<void> {
    await this.ensureTable();
    await this.pool.query(
      `INSERT INTO test_recipient (id, email, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, updated_at = now()`,
      [email]
    );
  }
}

export default TestRecipientRepository;
