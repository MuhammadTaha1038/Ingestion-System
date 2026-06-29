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
  getObjectBytes,
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
import { resolveIngestionChunks } from "./autoDetect.js";
import { autoSendDatasetIfPossible } from "../campaigns/sendService.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const dedupStore = config.databaseUrl
  ? new PostgresDedupStore()
  : new InMemoryDedupStore();
const datasetRepo = config.databaseUrl ? new DatasetRepository() : null;
const jobRepo = config.databaseUrl ? new JobRepository() : null;
// s3 client is resolved dynamically at job time so updated env is respected

if (!config.databaseUrl) {
  logger.warn("DATABASE_URL not set; using in-memory dedup store");
}

if (!hasS3Config(config.s3)) {
  logger.warn("S3 config incomplete; using local storage");
}

const STORAGE_ROOT = join(process.cwd(), "storage");
const PROCESSED_DIR = join(STORAGE_ROOT, "processed");
const REPORTS_DIR = join(STORAGE_ROOT, "reports");

const ensureStorageDirs = async (): Promise<void> => {
  await mkdir(PROCESSED_DIR, { recursive: true });
  await mkdir(REPORTS_DIR, { recursive: true });
};

const fetchSourceBytes = async (sourcePath: string): Promise<{ buffer: Buffer; sourceName: string }> => {
  if (sourcePath.startsWith("http://") || sourcePath.startsWith("https://")) {
    const response = await fetch(sourcePath);
    if (!response.ok) {
      throw new Error(`fetch_failed:${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const url = new URL(sourcePath);
    const contentDisposition = response.headers.get("content-disposition") ?? "";
    const filenameMatch = /filename\*?=(?:UTF-8''|\")?([^\";]+)/i.exec(contentDisposition);
    const sourceName = filenameMatch?.[1]?.trim().replace(/^\"|\"$/g, "") || decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "downloaded-file");

    return { buffer: Buffer.from(arrayBuffer), sourceName };
  }

  if (sourcePath.startsWith("file://")) {
    const filePath = fileURLToPath(sourcePath);
    return { buffer: await readFile(filePath), sourceName: filePath.split(/[\\/]/).pop() ?? "file" };
  }

  const looksLikeWindowsPath = /^[a-zA-Z]:[\\/]/.test(sourcePath);
  if (sourcePath.startsWith("s3://") || (!looksLikeWindowsPath && !sourcePath.includes("://"))) {
    const cfg = loadConfig();
    const dynamicS3Enabled = hasS3Config(cfg.s3);
    const client = dynamicS3Enabled ? createS3Client(cfg.s3) : null;

    if (!client) {
      throw new Error("s3_not_configured");
    }

    const location = resolveS3Location(sourcePath, cfg.s3.bucket);
    return { buffer: await getObjectBytes(client, location.bucket, location.key), sourceName: location.key.split("/").pop() ?? location.key };
  }

  throw new Error("unsupported_source_path");
};

const resolveInputSource = async (input: IngestionInput): Promise<{ buffer: Buffer; sourceName: string }> => {
  if (input.content && input.content.trim().length > 0) {
    return { buffer: Buffer.from(input.content, "utf-8"), sourceName: input.sourcePath ?? "inline" };
  }

  if (!input.sourcePath) {
    throw new Error("missing_content");
  }

  return await fetchSourceBytes(input.sourcePath);
};

const writeProcessedDataset = async (
  jobId: string,
  result: IngestionResult
): Promise<string> => {
  const key = `processed/${jobId}.jsonl`;
  const lines = result.records.map((record) => JSON.stringify(record)).join("\n");
  const payload = lines.length > 0 ? `${lines}\n` : "";

  const cfg = loadConfig();
  if (hasS3Config(cfg.s3)) {
    const client = createS3Client(cfg.s3);
    const location = resolveS3Location(key, cfg.s3.bucket);
    await putObjectText(client, location.bucket, location.key, payload, "application/x-ndjson");
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

  const cfg2 = loadConfig();
  if (hasS3Config(cfg2.s3)) {
    const client = createS3Client(cfg2.s3);
    const location = resolveS3Location(key, cfg2.s3.bucket);
    await putObjectText(client, location.bucket, location.key, payload, "application/json");
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

      const source = await resolveInputSource(job.data.input);
      const sourceName = source.sourceName;

      // Persist the original file name back to the dataset record
      if (datasetRepo && datasetId && sourceName && sourceName !== "inline") {
        await datasetRepo.updateSourceName(datasetId, sourceName);
      }

      const chunks = resolveIngestionChunks(source.buffer, sourceName);
      if (chunks.length === 0) {
        throw new Error("no_supported_files_found");
      }

      const aggregateResult: IngestionResult = {
        records: [],
        counts: { raw: 0, valid: 0, duplicate: 0, error: 0 },
        invalidSamples: []
      };

      for (const chunk of chunks) {
        const result = await runIngestion(
          {
            format: chunk.format,
            content: chunk.content,
            sourcePath: job.data.input.sourcePath ?? chunk.sourceName
          },
          dedupStore,
          { datasetId }
        );

        aggregateResult.records.push(...result.records);
        aggregateResult.counts.raw += result.counts.raw;
        aggregateResult.counts.valid += result.counts.valid;
        aggregateResult.counts.duplicate += result.counts.duplicate;
        aggregateResult.counts.error += result.counts.error;
        aggregateResult.invalidSamples.push(...result.invalidSamples);
      }

      aggregateResult.records.sort((left, right) => left.email.localeCompare(right.email));
      aggregateResult.invalidSamples = aggregateResult.invalidSamples.slice(0, 25);

      const processedPath = await writeProcessedDataset(jobId, aggregateResult);
      const reportPath = await writeReport(jobId, job.data.input, aggregateResult, processedPath);
      updateJobCompletion(jobId, aggregateResult, processedPath, reportPath);

      if (datasetRepo && datasetId) {
        await datasetRepo.markCompleted(datasetId, aggregateResult.counts, processedPath, reportPath);
      }

      if (jobRepo) {
        await jobRepo.markCompleted(jobId, {
          total: aggregateResult.counts.raw,
          processed: aggregateResult.counts.valid,
          failed: aggregateResult.counts.error
        });
      }

      // Per client requirement: do not auto-send after ingest. Persist dataset only.
      const existingJob = jobStore.getJob(jobId);
      jobStore.updateJob(jobId, {
        payload: {
          ...existingJob?.payload,
          autoSend: {
            queued: false,
            reason: "auto_send_disabled"
          }
        }
      });
      logger.info("ingestion completed (auto send disabled)", {
        jobId,
        datasetId,
        requestedCampaignId: job.data.campaignId ?? null
      });

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
