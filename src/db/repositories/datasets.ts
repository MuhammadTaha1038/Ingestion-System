import { Pool } from "pg";
import { getDatabasePool } from "../pool.js";

export interface DatasetCounts {
  raw: number;
  valid: number;
  duplicate: number;
  error: number;
}

export class DatasetRepository {
  private readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? getDatabasePool();
  }

  async createDataset(params: {
    sourceType: string;
    sourcePath: string;
    status?: string;
  }): Promise<string> {
    const status = params.status ?? "pending";
    const result = await this.pool.query(
      "INSERT INTO datasets (source_type, source_path, status) VALUES ($1, $2, $3) RETURNING id",
      [params.sourceType, params.sourcePath, status]
    );

    return result.rows[0]?.id as string;
  }

  async markProcessing(id: string): Promise<void> {
    await this.pool.query("UPDATE datasets SET status = $1 WHERE id = $2", [
      "processing",
      id
    ]);
  }

  async markCompleted(
    id: string,
    counts: DatasetCounts,
    processedPath: string,
    reportPath: string
  ): Promise<void> {
    await this.pool.query(
      "UPDATE datasets SET status = $1, raw_count = $2, valid_count = $3, duplicate_count = $4, error_count = $5, processed_path = $6, report_path = $7 WHERE id = $8",
      [
        "completed",
        counts.raw,
        counts.valid,
        counts.duplicate,
        counts.error,
        processedPath,
        reportPath,
        id
      ]
    );
  }

  async markFailed(id: string, errorCount = 1): Promise<void> {
    await this.pool.query("UPDATE datasets SET status = $1, error_count = $2 WHERE id = $3", [
      "failed",
      errorCount,
      id
    ]);
  }
}
