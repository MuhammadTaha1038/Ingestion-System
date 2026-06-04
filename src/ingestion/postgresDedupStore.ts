import { Pool } from "pg";
import { getDatabasePool } from "../db/pool.js";
import { DedupStore } from "./dedupStore.js";

const getEmailDomain = (emailNormalized: string): string => {
  const atIndex = emailNormalized.lastIndexOf("@");
  return atIndex >= 0 ? emailNormalized.slice(atIndex + 1) : "";
};

export class PostgresDedupStore implements DedupStore {
  private readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? getDatabasePool();
  }

  async checkAndInsert(emailNormalized: string): Promise<boolean> {
    const domain = getEmailDomain(emailNormalized);
    const result = await this.pool.query(
      "INSERT INTO recipients (email_normalized, email_domain) VALUES ($1, $2) ON CONFLICT (email_normalized) DO NOTHING",
      [emailNormalized, domain]
    );

    return result.rowCount === 1;
  }
}
