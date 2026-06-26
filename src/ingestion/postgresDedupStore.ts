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

  async checkAndInsert(emailNormalized: string, datasetId?: string | null): Promise<boolean> {
    const domain = getEmailDomain(emailNormalized);
    if (!datasetId) {
      const result = await this.pool.query(
        "INSERT INTO recipients (email_normalized, email_domain, first_dataset_id) VALUES ($1, $2, NULL) ON CONFLICT (email_normalized) DO NOTHING",
        [emailNormalized, domain]
      );
      return result.rowCount === 1;
    }

    const result = await this.pool.query(
      `INSERT INTO dataset_recipients (dataset_id, email_normalized, email_domain, metadata)
       VALUES ($1, $2, $3, '{}'::jsonb)
       ON CONFLICT (dataset_id, email_normalized) DO NOTHING`,
      [datasetId, emailNormalized, domain]
    );

    return result.rowCount === 1;
  }
}
