import { IngestionInput } from "../ingestion/types.js";

export const QUEUE_NAMES = {
  ingestion: "ingestion",
  sending: "sending"
} as const;

export interface IngestionJobPayload {
  jobId: string;
  datasetId?: string;
  input: IngestionInput;
  campaignId?: string;
}

export interface SendingJobPayload {
  campaignId: string;
  windowId: string;
  replyTo?: string;
  recipients?: Array<{ to: string; subject: string; html?: string; text?: string }>;
  smtpAccountId?: string;
}
