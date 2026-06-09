import { readFile, mkdir, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { join } from "path";
import { Job } from "bullmq";
import { createLogger } from "../logging/logger.js";
import { loadConfig } from "../config/config.js";
import { DatasetRepository } from "../db/repositories/datasets.js";
import { JobRepository } from "../db/repositories/jobs.js";
import { createIngestionWorker } from "../queue/workers.js";
import { IngestionJobPayload } from "../queue/types.js";
import {
  createS3Client,
  getObjectText,
  hasS3Config,
  putObjectText,
  resolveS3Location
} from "../storage/s3.js";
import { InMemoryDedupStore } from "./dedupStore.js";
import { PostgresDedupStore } from "./postgresDedupStore.js";
import { runIngestion } from "./pipeline.js";
import { IngestionInput, IngestionResult } from "./types.js";
import { jobStore } from "../jobs/store.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const dedupStore = config.databaseUrl
  ? new PostgresDedupStore()
  : new InMemoryDedupStore();
const datasetRepo = config.databaseUrl ? new DatasetRepository() : null;
const jobRepo = config.databaseUrl ? new JobRepository() : null;
const s3Enabled = hasS3Config(config.s3);
const s3Client = s3Enabled ? createS3Client(config.s3) : null;

if (!config.databaseUrl) {
  logger.warn("DATABASE_URL not set; using in-memory dedup store");
}

if (!s3Enabled) {
  logger.warn("S3 config incomplete; using local storage");
}

const STORAGE_ROOT = join(process.cwd(), "storage");
const PROCESSED_DIR = join(STORAGE_ROOT, "processed");
const REPORTS_DIR = join(STORAGE_ROOT, "reports");

const ensureStorageDirs = async (): Promise<void> => {
  await mkdir(PROCESSED_DIR, { recursive: true });
  await mkdir(REPORTS_DIR, { recursive: true });
};

const fetchContent = async (sourcePath: string): Promise<string> => {
  if (sourcePath.startsWith("http://") || sourcePath.startsWith("https://")) {
    const response = await fetch(sourcePath);
    if (!response.ok) {
      throw new Error(`fetch_failed:${response.status}`);
    }
    return await response.text();
  }

  if (sourcePath.startsWith("file://")) {
    const filePath = fileURLToPath(sourcePath);
    return await readFile(filePath, "utf-8");
  }

  const looksLikeWindowsPath = /^[a-zA-Z]:[\\/]/.test(sourcePath);
  if (sourcePath.startsWith("s3://") || (s3Client && !looksLikeWindowsPath && !sourcePath.includes("://"))) {
    if (!s3Client) {
      throw new Error("s3_not_configured");
    }

    const location = resolveS3Location(sourcePath, config.s3.bucket);
    return await getObjectText(s3Client, location.bucket, location.key);
  }

  throw new Error("unsupported_source_path");
};

const resolveInputContent = async (input: IngestionInput): Promise<string> => {
  if (input.content && input.content.trim().length > 0) {
    return input.content;
  }

  if (!input.sourcePath) {
    throw new Error("missing_content");
  }

  return await fetchContent(input.sourcePath);
};

const writeProcessedDataset = async (
  jobId: string,
  result: IngestionResult
): Promise<string> => {
  const key = `processed/${jobId}.jsonl`;
  const lines = result.records.map((record) => JSON.stringify(record)).join("\n");
  const payload = lines.length > 0 ? `${lines}\n` : "";

  if (s3Client) {
    const location = resolveS3Location(key, config.s3.bucket);
    await putObjectText(s3Client, location.bucket, location.key, payload, "application/x-ndjson");
    return `s3://${location.bucket}/${location.key}`;
  }

  await ensureStorageDirs();
  const filePath = join(STORAGE_ROOT, key);
  await writeFile(filePath, payload, "utf-8");
  return key;
};

const writeReport = async (
  jobId: string,
  input: IngestionInput,
  result: IngestionResult,
  processedKey: string
): Promise<string> => {
  const key = `reports/${jobId}.json`;
  const report = {
    jobId,
    format: input.format,
    sourcePath: input.sourcePath ?? null,
    processedPath: processedKey,
    counts: result.counts,
    invalidSamples: result.invalidSamples,
    createdAt: new Date().toISOString()
  };

  const payload = JSON.stringify(report, null, 2);

  if (s3Client) {
    const location = resolveS3Location(key, config.s3.bucket);
    await putObjectText(s3Client, location.bucket, location.key, payload, "application/json");
    return `s3://${location.bucket}/${location.key}`;
  }

  await ensureStorageDirs();
  const filePath = join(STORAGE_ROOT, key);
  await writeFile(filePath, payload, "utf-8");
  return key;
};

const updateJobFailure = (jobId: string, message: string): void => {
  jobStore.updateJob(jobId, {
    status: "failed",
    error: message
  });
};

const updateJobCompletion = (
  jobId: string,
  result: IngestionResult,
  processedPath: string,
  reportPath: string
): void => {
  const existing = jobStore.getJob(jobId);
  const payload = {
    ...existing?.payload,
    result: {
      counts: result.counts,
      invalidSamples: result.invalidSamples,
      processedPath,
      reportPath
    }
  };

  jobStore.updateJob(jobId, {
    status: "completed",
    progress: {
      total: result.counts.raw,
      processed: result.counts.valid,
      failed: result.counts.error
    },
    payload
  });
};

export const startIngestionWorker = (): void => {
  createIngestionWorker(async (job: Job<IngestionJobPayload>) => {
    const jobId = job.data.jobId;
    const datasetId = job.data.datasetId;
    jobStore.updateJob(jobId, { status: "processing" });

    try {
      if (jobRepo) {
        await jobRepo.markProcessing(jobId);
      }

      if (datasetRepo && datasetId) {
        await datasetRepo.markProcessing(datasetId);
      }

      const content = await resolveInputContent(job.data.input);
      const result = await runIngestion(
        {
          format: job.data.input.format,
          content,
          sourcePath: job.data.input.sourcePath
        },
        dedupStore,
        { datasetId }
      );

      const processedPath = await writeProcessedDataset(jobId, result);
      const reportPath = await writeReport(jobId, job.data.input, result, processedPath);
      updateJobCompletion(jobId, result, processedPath, reportPath);

      if (datasetRepo && datasetId) {
        await datasetRepo.markCompleted(datasetId, result.counts, processedPath, reportPath);
      }

      if (jobRepo) {
        await jobRepo.markCompleted(jobId, {
          total: result.counts.raw,
          processed: result.counts.valid,
          failed: result.counts.error
        });
      }

      logger.info("ingestion job completed", { jobId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown_error";
      updateJobFailure(jobId, message);

      if (datasetRepo && datasetId) {
        await datasetRepo.markFailed(datasetId);
      }

      if (jobRepo) {
        await jobRepo.markFailed(jobId, message);
      }

      logger.error("ingestion job failed", { jobId, message });
      throw error;
    }
  });
};
