import { getSendingWindowState } from "../scheduler/windowScheduler.js";
import { getDatabasePool } from "../db/pool.js";
import { loadConfig } from "../config/config.js";

const getJobSourceLabel = (job: { payload?: Record<string, unknown> }): string | null => {
  const payload = job.payload ?? {};
  const input = payload.input && typeof payload.input === "object" ? (payload.input as { sourcePath?: unknown }) : null;
  const sourcePath = typeof payload.sourcePath === "string" ? payload.sourcePath : typeof input?.sourcePath === "string" ? input.sourcePath : null;
  if (!sourcePath || !sourcePath.trim()) {
    return null;
  }

  return sourcePath;
};

const getJobResultCounts = (job: { payload?: Record<string, unknown> }): { raw: number; valid: number; duplicate: number; error: number } | null => {
  const payload = job.payload ?? {};
  const result = payload.result && typeof payload.result === "object" ? (payload.result as { counts?: { raw?: number; valid?: number; duplicate?: number; error?: number } }) : null;
  if (!result?.counts) {
    return null;
  }

  return {
    raw: result.counts.raw ?? 0,
    valid: result.counts.valid ?? 0,
    duplicate: result.counts.duplicate ?? 0,
    error: result.counts.error ?? 0
  };
};

export const truncate = (value: string, max = 1800): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

export const formatIngestionJobSummary = (job: { id: string; status: string; payload?: Record<string, unknown>; error?: string | null }): string => {
  const source = getJobSourceLabel(job) ?? "unknown file";
  const counts = getJobResultCounts(job);
  const autoSend = job.payload?.autoSend && typeof job.payload.autoSend === "object"
    ? (job.payload.autoSend as { queued?: boolean; campaignId?: string; recipients?: number; reason?: string })
    : null;

  return [
    `File: ${source}`,
    `Status: ${job.status}`,
    counts ? `Fetched: ${counts.raw}` : null,
    counts ? `Added to recipients: ${counts.valid}` : null,
    counts ? `Duplicates: ${counts.duplicate}` : null,
    counts ? `Errors: ${counts.error}` : null,
    autoSend?.queued ? `Auto-send: queued for campaign ${autoSend.campaignId ?? "unknown"}` : autoSend?.reason ? `Auto-send: not queued (${autoSend.reason})` : null,
    job.error ? `Issue: ${job.error}` : null
  ].filter(Boolean).join("\n");
};

export const formatJobLine = (job: { id: string; type: string; status: string; progress: { processed: number; total: number }; payload?: Record<string, unknown>; error?: string }): string => {
  if (job.type === "ingestion") {
    const counts = getJobResultCounts(job);
    return [
      `${job.status}: ${getJobSourceLabel(job) ?? job.id}`,
      counts ? `fetched ${counts.raw}, added ${counts.valid}, duplicates ${counts.duplicate}, errors ${counts.error}` : null
    ].filter(Boolean).join(" | ");
  }

  if (job.type === "sending") {
    const payload = job.payload ?? {};
    const campaignId = typeof payload.campaignId === "string" ? payload.campaignId : null;
    const recipientCount = Array.isArray(payload.recipients)
      ? payload.recipients.length
      : typeof payload.recipients === "number"
        ? payload.recipients
        : null;
    return `${job.status}: send ${campaignId ? `campaign ${campaignId}` : job.id}${recipientCount !== null ? ` (${recipientCount} recipients)` : ""}`;
  }

  return `${job.type} ${job.status}`;
};

export const formatCampaignRows = (rows: Array<{ id: string; name: string; subject: string; status: string; smtp_account_address?: string | null }>): string => {
  if (rows.length === 0) return "no_campaigns";
  return rows.slice(0, 10).map((row) => `${row.id} ${row.name} [${row.status}] ${row.subject}${row.smtp_account_address ? ` smtp=${row.smtp_account_address}` : ""}`).join("\n");
};

export const formatCpanelRows = (rows: Array<{ id: string; name: string }>): string => {
  if (rows.length === 0) return "no_cpanels";
  return rows.slice(0, 10).map((row) => `${row.id} ${row.name}`).join("\n");
};

export const formatSubdomainRows = (rows: Array<{ id: string; cpanel_account_id: string; name: string }>): string => {
  if (rows.length === 0) return "no_subdomains";
  return rows.slice(0, 10).map((row) => `${row.id} ${row.cpanel_account_id} ${row.name}`).join("\n");
};

export const formatEmailRows = (rows: Array<{ id: string; subdomain_id: string; address: string }>): string => {
  if (rows.length === 0) return "no_email_accounts";
  return rows.slice(0, 10).map((row) => `${row.id} ${row.subdomain_id} ${row.address}`).join("\n");
};

export const formatStorageOverview = (): string => {
  const config = loadConfig();
  const s3Enabled = Boolean(config.s3.endpoint && config.s3.region && config.s3.bucket && config.s3.accessKeyId && config.s3.secretAccessKey);
  return [
    "Storage overview",
    `Local storage root: ${process.cwd()}\\storage`,
    `S3 configured: ${s3Enabled ? "yes" : "no"}`,
    config.s3.bucket ? `Bucket: ${config.s3.bucket}` : null,
    config.s3.region ? `Region: ${config.s3.region}` : null,
    config.s3.endpoint ? `Endpoint: ${config.s3.endpoint}` : null
  ].filter(Boolean).join("\n");
};

export type PersistentJobSummary = {
  statusCounts: Record<string, number>;
  recentJobs: Array<{
    id: string;
    type: string;
    status: string;
    dataset_id: string | null;
    campaign_id: string | null;
    total_count: number;
    processed_count: number;
    error: string | null;
    created_at: string;
  }>;
  latestDataset: {
    id: string;
    source_path: string;
    source_name: string | null;
    status: string;
    raw_count: number;
    valid_count: number;
    duplicate_count: number;
    error_count: number;
    created_at: string;
  } | null;
};

export const getPersistentJobSummary = async (): Promise<PersistentJobSummary> => {
  const pool = getDatabasePool();
  const countsRes = await pool.query(`SELECT status, count(*)::int AS count FROM jobs GROUP BY status`);
  const counts: Record<string, number> = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0
  };
  for (const row of countsRes.rows as Array<{ status: string; count: number }>) {
    if (typeof counts[row.status] === "number") {
      counts[row.status] = row.count;
    }
  }

  const recentRes = await pool.query(
    `SELECT id, type, status, dataset_id, campaign_id, total_count, processed_count, error, created_at
     FROM jobs ORDER BY created_at DESC LIMIT 5`
  );

  const latestDatasetRes = await pool.query(
    `SELECT id, source_path, source_name, status, raw_count, valid_count, duplicate_count, error_count, created_at
     FROM datasets ORDER BY created_at DESC LIMIT 1`
  );

  return {
    statusCounts: counts,
    recentJobs: recentRes.rows as PersistentJobSummary["recentJobs"],
    latestDataset: latestDatasetRes.rows[0] ?? null
  };
};

export const formatPersistentJobSummary = (summary: PersistentJobSummary): string => {
  const lines: string[] = [
    "Persistent job history",
    `DB jobs: pending=${summary.statusCounts.pending} processing=${summary.statusCounts.processing} completed=${summary.statusCounts.completed} failed=${summary.statusCounts.failed}`
  ];

  if (summary.latestDataset) {
    lines.push(
      `Latest ingested file: ${summary.latestDataset.source_name ?? summary.latestDataset.source_path}`,
      `Dataset status: ${summary.latestDataset.status}`,
      `Counts: fetched=${summary.latestDataset.raw_count} valid=${summary.latestDataset.valid_count} duplicates=${summary.latestDataset.duplicate_count} errors=${summary.latestDataset.error_count}`
    );
  }

  lines.push("Recent persisted jobs:");
  if (summary.recentJobs.length === 0) {
    lines.push("- No persisted jobs recorded yet.");
  } else {
    lines.push(
      ...summary.recentJobs.map((job) => {
        const refs = [job.dataset_id ? `dataset ${job.dataset_id}` : null, job.campaign_id ? `campaign ${job.campaign_id}` : null].filter(Boolean);
        const counts = [job.total_count !== 0 ? `total=${job.total_count}` : null, job.processed_count !== 0 ? `processed=${job.processed_count}` : null].filter(Boolean);
        return `- ${job.type} ${job.status}: ${job.id}${refs.length ? ` (${refs.join(" | ")})` : ""}${counts.length ? ` ${counts.join(" ")}` : ""}${job.error ? ` error=${job.error}` : ""}`;
      })
    );
  }

  return lines.join("\n");
};

export const formatSmtpRows = (rows: Array<{ id: string; email_account_id: string; host: string; port: number; username: string; status: string; use_tls: boolean; max_per_window: number; max_concurrent: number }>): string => {
  if (rows.length === 0) return "no_accounts";
  return rows.slice(0, 10).map((row) => `${row.id} ${row.username}@${row.host}:${row.port} [${row.status}] tls=${row.use_tls} window=${row.max_per_window} concurrent=${row.max_concurrent}`).join("\n");
};

export const formatQueueSummary = (status: {
  ingestion: Record<string, number>;
  sending: Record<string, number>;
  paused: { ingestion: boolean; sending: boolean };
  latestFailedSendingJob?: { id: string; error: string | null; finishedAt: string | null } | null;
  liveJobs?: Array<{ id: string; type: string; status: string; progress: { processed: number; total: number }; payload?: Record<string, unknown>; error?: string }>;
  latestIngestionJob?: { id: string; status: string; payload?: Record<string, unknown>; error?: string | null } | null;
  latestSendingJob?: { id: string; status: string; payload?: Record<string, unknown>; error?: string | null } | null;
}, persistentSummary?: string): string => {
  return [
    "Pipeline",
    `Ingestion: ${status.paused.ingestion ? "paused" : status.ingestion.waiting + status.ingestion.active > 0 ? "working" : "ready"}`,
    `Sending: ${status.paused.sending ? "paused" : status.sending.waiting + status.sending.active > 0 ? "working" : "ready"}`,
    `Automatic handoff: ${status.paused.sending ? "held until sending resumes" : "enabled"}`,
    "",
    "Live jobs:",
    ...(status.liveJobs && status.liveJobs.length > 0
      ? status.liveJobs.slice(0, 5).map((job) => `- ${formatJobLine(job)}`)
      : ["- No jobs are currently waiting or running."]
    ),
    "",
    "Latest ingest",
    status.latestIngestionJob ? formatIngestionJobSummary(status.latestIngestionJob) : "No ingest jobs yet.",
    "",
    "Latest send",
    status.latestSendingJob
      ? [
          `Job: ${status.latestSendingJob.id}`,
          `Status: ${status.latestSendingJob.status}`,
          typeof status.latestSendingJob.payload?.campaignId === "string" ? `Campaign: ${status.latestSendingJob.payload.campaignId}` : null,
          Array.isArray(status.latestSendingJob.payload?.recipients) ? `Recipients: ${(status.latestSendingJob.payload?.recipients as Array<unknown>).length}` : null,
          status.latestSendingJob.error ? `Issue: ${status.latestSendingJob.error}` : null
        ].filter(Boolean).join("\n")
      : "No send jobs yet.",
    "",
    status.latestFailedSendingJob ? `Latest failed send: ${status.latestFailedSendingJob.error ?? status.latestFailedSendingJob.id}` : "No failed sends.",
    "",
    "This view shows the latest file and send activity, not the full historical queue.",
    persistentSummary ? "" : null,
    persistentSummary ?? null
  ].filter(Boolean).join("\n");
};

export const formatLogs = (logs: Array<{ ts: string; level: string; message: string; meta?: Record<string, unknown> }>): string => {
  if (logs.length === 0) return "No recent logs.";

  const lines = logs.slice(-20).map((entry) => {
    const time = new Date(entry.ts).toLocaleString("en-PK", { timeZone: "Asia/Karachi" });
    const meta = entry.meta && Object.keys(entry.meta).length > 0 ? ` ${JSON.stringify(entry.meta)}` : "";
    return `- ${time} [${entry.level}] ${entry.message}${meta}`;
  });

  return ["Recent logs", ...lines].join("\n");
};

export const formatWindows = (windows: Array<{ id: string; window_start: string; window_end: string; status: string }>): string => {
  if (windows.length === 0) return "No sending windows found.";

  const lines = windows.slice(0, 10).map((window) => {
    const start = new Date(window.window_start).toLocaleString("en-PK", { timeZone: "Asia/Karachi" });
    const end = new Date(window.window_end).toLocaleString("en-PK", { timeZone: "Asia/Karachi" });
    return `- ${start} -> ${end} [${window.status}]`;
  });

  return [
    "Sending windows (Pakistan time)",
    ...lines,
    "",
    "If the current time is outside the active window, sends are queued until the next window."
  ].join("\n");
};

export const formatSmtpFailures = (rows: Array<{ smtp_account_id: string; consecutive_failures: number; last_failure_at: string | null }>): string => {
  if (rows.length === 0) return "No SMTP failures recorded.";
  return [
    "SMTP failures",
    ...rows.slice(0, 10).map((row) => `- ${row.smtp_account_id}: failures=${row.consecutive_failures}, last_failure=${row.last_failure_at ?? "none"}`)
  ].join("\n");
};

export const formatSmtpUsage = (rows: Array<{ smtp_account_id: string; used_count: number; username?: string; host?: string }>): string => {
  if (rows.length === 0) return "No SMTP usage for this window.";
  return [
    "SMTP usage for window",
    ...rows.slice(0, 10).map((row) => {
      const label = row.username && row.host ? `${row.username}@${row.host}` : row.smtp_account_id;
      return `- ${label}: used ${row.used_count}`;
    })
  ].join("\n");
};

export const formatWindowSettings = (settings: {
  sending_window_hours: number;
  sending_window_interval_hours: number;
  sending_window_start_hour: number;
  sending_window_start_minute: number;
  sending_window_tz: string;
}): string => {
  const state = getSendingWindowState(new Date(), {
    sendingWindowHours: settings.sending_window_hours,
    sendingWindowIntervalHours: settings.sending_window_interval_hours,
    sendingWindowStartHour: settings.sending_window_start_hour,
    sendingWindowStartMinute: settings.sending_window_start_minute,
    sendingWindowTz: settings.sending_window_tz
  });

  return [
    "Sending window settings",
    `Hours: ${settings.sending_window_hours}`,
    `Interval hours: ${settings.sending_window_interval_hours}`,
    `Start time: ${String(settings.sending_window_start_hour).padStart(2, "0")}:${String(settings.sending_window_start_minute).padStart(2, "0")}`,
    `Timezone: ${settings.sending_window_tz}`,
    `Current window: ${new Date(state.windowStart).toLocaleString("en-PK", { timeZone: settings.sending_window_tz })} -> ${new Date(state.windowEnd).toLocaleString("en-PK", { timeZone: settings.sending_window_tz })}`,
    `Active now: ${state.isActive ? "yes" : "no"}`
  ].join("\n");
};

export const formatJobStatusSummary = (job: {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  progress: { processed: number; total: number; failed: number };
  payload?: Record<string, unknown>;
  error?: string | null;
}): string => {
  if (job.type === "ingestion") {
    return [
      "Ingestion job",
      `File: ${getJobSourceLabel(job) ?? job.id}`,
      `Status: ${job.status}`,
      `Fetched: ${getJobResultCounts(job)?.raw ?? job.progress.total ?? 0}`,
      `Added to recipients: ${getJobResultCounts(job)?.valid ?? job.progress.processed ?? 0}`,
      `Duplicates: ${getJobResultCounts(job)?.duplicate ?? 0}`,
      `Errors: ${getJobResultCounts(job)?.error ?? job.progress.failed ?? 0}`,
      job.payload?.datasetId ? `Dataset: ${String(job.payload.datasetId)}` : null,
      job.payload?.autoSend && typeof job.payload.autoSend === "object"
        ? (job.payload.autoSend as { queued?: boolean; campaignId?: string; reason?: string }).queued
          ? `Auto-send: queued for campaign ${(job.payload.autoSend as { campaignId?: string }).campaignId ?? "unknown"}`
          : `Auto-send: not queued${(job.payload.autoSend as { reason?: string }).reason ? ` (${(job.payload.autoSend as { reason?: string }).reason})` : ""}`
        : null,
      job.error ? `Issue: ${job.error}` : null
    ].filter(Boolean).join("\n");
  }

  if (job.type === "sending") {
    const campaignId = typeof job.payload?.campaignId === "string" ? job.payload.campaignId : null;
    const recipients = Array.isArray(job.payload?.recipients) ? (job.payload?.recipients as Array<unknown>).length : null;
    return [
      "Sending job",
      `Status: ${job.status}`,
      campaignId ? `Campaign: ${campaignId}` : null,
      recipients !== null ? `Recipients in this batch: ${recipients}` : null,
      `Progress: ${job.progress.processed}/${job.progress.total}`,
      job.error ? `Issue: ${job.error}` : null
    ].filter(Boolean).join("\n");
  }

  return [
    `${job.type} job`,
    `Status: ${job.status}`,
    `Progress: ${job.progress.processed}/${job.progress.total}`,
    job.error ? `Issue: ${job.error}` : null
  ].filter(Boolean).join("\n");
};
