import { loadConfig } from "../config/config.js";
import { createLogger } from "../logging/logger.js";
import { DatasetRepository } from "../db/repositories/datasets.js";
import { JobRepository } from "../db/repositories/jobs.js";
import { jobStore } from "../jobs/store.js";
import { ingestionQueue } from "../queue/queues.js";
import { getQueueStatus } from "../queue/status.js";
import { InputFormat } from "../ingestion/types.js";
import { selectCampaignById } from "../campaigns/sendService.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const emailAddressRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const allowedFormats = new Set(["csv", "json", "txt", "raw", "bulk"]);

export const queueDashboardIngestion = async (args: {
  format?: string;
  content?: string;
  sourcePath?: string;
  campaignId?: string;
}): Promise<string> => {
  const format = (args.format ?? "").trim().toLowerCase() || "auto";
  if (format !== "auto" && !allowedFormats.has(format)) {
    return "invalid_format";
  }

  let directEmailIngest = false;
  if (!(args.content ?? "").trim() && args.sourcePath) {
    const trimmedSource = args.sourcePath.trim();
    if (emailAddressRegex.test(trimmedSource)) {
      args.content = trimmedSource;
      args.sourcePath = undefined;
      directEmailIngest = true;
    }
  }

  if (!(args.content ?? "").trim() && !args.sourcePath) {
    return "missing_content_or_source_path";
  }

  const queueStatus = await getQueueStatus();
  const queuePaused = queueStatus.paused.ingestion;

  if (args.campaignId) {
    if (!config.databaseUrl) {
      return "db_required";
    }

    const campaign = await selectCampaignById(args.campaignId);
    if (!campaign) {
      return "campaign_not_found";
    }
  }

  const inputFormat = format as InputFormat;

  let datasetId: string | null = null;
  if (config.databaseUrl) {
    const datasetRepo = new DatasetRepository();
    datasetId = await datasetRepo.createDataset({
      sourceType: inputFormat,
      sourcePath: args.sourcePath ?? "inline"
    });
  }

  const job = jobStore.createJob("ingestion", {
    format: inputFormat,
    sourcePath: args.sourcePath ?? null,
    campaignId: args.campaignId ?? null,
    datasetId
  });

  if (config.databaseUrl) {
    const jobRepo = new JobRepository();
    await jobRepo.createJob({
      id: job.id,
      type: "ingestion",
      status: "pending",
      datasetId,
      campaignId: args.campaignId ?? null
    });
  }

  await ingestionQueue.add(
    "ingest",
    {
      jobId: job.id,
      datasetId: datasetId ?? undefined,
      input: { format: inputFormat, content: args.content ?? "", sourcePath: args.sourcePath },
      campaignId: args.campaignId ?? undefined
    },
    { jobId: job.id }
  );

  return [
    directEmailIngest ? `Email ${args.content?.trim()} accepted for ingest.` : "File accepted.",
    queuePaused
      ? "Ingestion queue is currently paused. This job is queued and will start when ingestion resumes."
      : "Processing has started.",
    directEmailIngest
      ? "This input is being treated as a single email address and will be ingested directly."
      : "When ingestion completes, Status will show fetched, added, duplicate, and error counts for this file.",
    args.campaignId
      ? `This ingest will use campaign ${args.campaignId} if the campaign exists.`
      : "If an active campaign exists, auto-send will be queued automatically.",
    datasetId ? `Tracking dataset: ${datasetId}` : null
  ].filter(Boolean).join(" ");
};

export const queueDashboardSmtpImport = async (args: {
  sourcePath: string;
  defaultEmailAccountReference?: string;
}): Promise<string> => {
  if (!config.databaseUrl) {
    return "db_required";
  }

  if (!args.sourcePath || !args.sourcePath.trim()) {
    return "missing_content_or_source_path";
  }

  try {
    const { ingestParsedAccounts } = await import("../smtp/bulkIngest.js");
    const results = await ingestParsedAccounts({
      sourcePath: args.sourcePath.trim(),
      defaultEmailAccountReference: args.defaultEmailAccountReference?.trim() || undefined
    });
    const successCount = results.filter((r) => r.id).length;
    const failCount = results.filter((r) => r.error).length;

    return [
      `Imported ${successCount} SMTP account(s).`,
      failCount > 0 ? `Failed ${failCount} account(s).` : null,
      args.defaultEmailAccountReference ? `Attached to email: ${args.defaultEmailAccountReference}` : null
    ]
      .filter(Boolean)
      .join(" ");
  } catch (error) {
    return error instanceof Error ? error.message : "smtp_import_failed";
  }
};
