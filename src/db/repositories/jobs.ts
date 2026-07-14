import { Pool } from "pg";
import { getDatabasePool } from "../pool.js";

export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type JobType = "ingestion" | "processing" | "sending";

export interface JobCounts {
  total: number;
  processed: number;
  failed: number;
}

export class JobRepository {
  public readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? getDatabasePool();
  }

  async createJob(params: {
    id: string;
    type: JobType;
    status?: JobStatus;
    datasetId?: string | null;
    campaignId?: string | null;
    totalCount?: number;
  }): Promise<void> {
    const status = params.status ?? "pending";
    await this.pool.query(
      "INSERT INTO jobs (id, type, status, dataset_id, campaign_id, total_count) VALUES ($1, $2, $3, $4, $5, $6)",
      [params.id, params.type, status, params.datasetId ?? null, params.campaignId ?? null, params.totalCount ?? null]
    );
  }

  async markProcessing(id: string): Promise<void> {
    await this.pool.query(
      "UPDATE jobs SET status = $1, started_at = now() WHERE id = $2",
      ["processing", id]
    );
  }

  async markCompleted(id: string, counts: JobCounts): Promise<void> {
    await this.pool.query(
      "UPDATE jobs SET status = $1, total_count = $2, processed_count = $3, finished_at = now(), error = NULL WHERE id = $4",
      ["completed", counts.total, counts.processed, id]
    );
  }

  async markFailed(id: string, message: string): Promise<void> {
    await this.pool.query(
      "UPDATE jobs SET status = $1, error = $2, finished_at = now() WHERE id = $3",
      ["failed", message, id]
    );
  }
}
