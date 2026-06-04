import { Job, Worker } from "bullmq";
import { loadConfig } from "../config/config.js";
import { createLogger } from "../logging/logger.js";
import { getRedisConnection } from "./redis.js";
import { IngestionJobPayload, QUEUE_NAMES, SendingJobPayload } from "./types.js";

const logger = createLogger(loadConfig().logLevel);

export const createIngestionWorker = (
  handler: (job: Job<IngestionJobPayload>) => Promise<void>
): Worker<IngestionJobPayload> =>
  new Worker(QUEUE_NAMES.ingestion, async (job) => {
    logger.info("ingestion job received", { jobId: job.id });
    await handler(job);
  }, {
    connection: getRedisConnection()
  });

export const createSendingWorker = (
  handler: (job: Job<SendingJobPayload>) => Promise<void>
): Worker<SendingJobPayload> =>
  new Worker(QUEUE_NAMES.sending, async (job) => {
    logger.info("sending job received", { jobId: job.id });
    await handler(job);
  }, {
    connection: getRedisConnection()
  });
