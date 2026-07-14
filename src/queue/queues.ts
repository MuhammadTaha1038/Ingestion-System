import { Queue } from "bullmq";
import { getRedisConnection } from "./redis.js";
import { IngestionJobPayload, SendingJobPayload, SmtpScanJobPayload, QUEUE_NAMES } from "./types.js";

export const ingestionQueue = new Queue<IngestionJobPayload>(
  QUEUE_NAMES.ingestion,
  { connection: getRedisConnection() }
);

export const sendingQueue = new Queue<SendingJobPayload>(QUEUE_NAMES.sending, {
  connection: getRedisConnection()
});

export const smtpScanQueue = new Queue<SmtpScanJobPayload>(QUEUE_NAMES.smtp_scan, {
  connection: getRedisConnection()
});
