import { randomUUID } from "crypto";
import { JobRecord, JobSummary, JobType } from "./types.js";
import { JobStatus } from "../types/index.js";

export interface JobStore {
  createJob: (type: JobType, payload?: Record<string, unknown>, id?: string) => JobRecord;
  updateJob: (id: string, patch: Partial<Omit<JobRecord, "id" | "createdAt">>) => JobRecord | null;
  getJob: (id: string) => JobRecord | null;
  getSummary: (limit?: number) => JobSummary;
}

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, JobRecord>();

  createJob(type: JobType, payload?: Record<string, unknown>, id?: string): JobRecord {
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: id ?? randomUUID(),
      type,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      payload,
      progress: {
        total: 0,
        processed: 0,
        failed: 0
      }
    };

    this.jobs.set(job.id, job);
    return job;
  }

  updateJob(id: string, patch: Partial<Omit<JobRecord, "id" | "createdAt">>): JobRecord | null {
    const existing = this.jobs.get(id);
    if (!existing) {
      return null;
    }

    const updated: JobRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    this.jobs.set(id, updated);
    return updated;
  }

  getJob(id: string): JobRecord | null {
    return this.jobs.get(id) ?? null;
  }

  getSummary(limit = 25): JobSummary {
    const counts: Record<JobStatus, number> = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };

    const all = Array.from(this.jobs.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );

    for (const job of all) {
      counts[job.status] += 1;
    }

    return {
      counts,
      recent: all.slice(0, limit)
    };
  }
}

export const jobStore = new InMemoryJobStore();
