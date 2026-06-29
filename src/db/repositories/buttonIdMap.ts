import { Pool } from "pg";
import { getDatabasePool } from "../pool.js";

export class ButtonIdMapRepository {
  public readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? getDatabasePool();
  }

  private async ensureTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS button_id_map (
        token text PRIMARY KEY,
        raw_value text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NULL
      )
    `);
  }

  async upsert(token: string, rawValue: string, expiresAt?: string | null): Promise<void> {
    await this.ensureTable();
    await this.pool.query(
      `INSERT INTO button_id_map (token, raw_value, created_at, expires_at)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (token) DO UPDATE SET raw_value = EXCLUDED.raw_value, expires_at = EXCLUDED.expires_at`,
      [token, rawValue, expiresAt ?? null]
    );
  }

  async get(token: string): Promise<string | null> {
    await this.ensureTable();
    const res = await this.pool.query(`SELECT raw_value FROM button_id_map WHERE token = $1`, [token]);
    if (!res.rows[0]) return null;
    return String(res.rows[0].raw_value);
  }
}

export default ButtonIdMapRepository;
