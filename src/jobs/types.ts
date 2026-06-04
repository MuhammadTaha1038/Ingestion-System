import { JobStatus } from "../types/index.js";

export type JobType = "ingestion" | "processing" | "sending";

export interface JobProgress {
  total: number;
  processed: number;
  failed: number;
}

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  payload?: Record<string, unknown>;
  progress: JobProgress;
  error?: string;
}

export interface JobSummary {
  counts: Record<JobStatus, number>;
  recent: JobRecord[];
}
