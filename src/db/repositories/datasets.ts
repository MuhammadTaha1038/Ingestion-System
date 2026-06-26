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

  async listAllDatasets(): Promise<Array<{ id: string; source_type: string; source_path: string; status: string; raw_count: number; valid_count: number; duplicate_count: number; error_count: number; created_at: string }>> {
    const result = await this.pool.query(
      `SELECT id, source_type, source_path, status, raw_count, valid_count, duplicate_count, error_count, created_at
       FROM datasets
       ORDER BY created_at DESC
       LIMIT 20`
    );

    return result.rows as Array<{ id: string; source_type: string; source_path: string; status: string; raw_count: number; valid_count: number; duplicate_count: number; error_count: number; created_at: string }>;
  }

  async getDatasetById(id: string): Promise<{ id: string; source_type: string; source_path: string; status: string; raw_count: number | null; valid_count: number | null; duplicate_count: number | null; error_count: number | null; processed_path: string | null; report_path: string | null; created_at: string } | null> {
    const result = await this.pool.query(
      `SELECT id, source_type, source_path, status, raw_count, valid_count, duplicate_count, error_count, processed_path, report_path, created_at
       FROM datasets
       WHERE id = $1 LIMIT 1`,
      [id]
    );

    return result.rows[0] ?? null;
  }
}
