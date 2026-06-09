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
    const result = await this.pool.query(
      "INSERT INTO recipients (email_normalized, email_domain, first_dataset_id) VALUES ($1, $2, $3) ON CONFLICT (email_normalized) DO NOTHING",
      [emailNormalized, domain, datasetId ?? null]
    );

    if (result.rowCount === 1) {
      return true;
    }

    if (datasetId) {
      await this.pool.query(
        "UPDATE recipients SET first_dataset_id = COALESCE(first_dataset_id, $2) WHERE email_normalized = $1",
        [emailNormalized, datasetId]
      );
    }

    return false;
  }
}
