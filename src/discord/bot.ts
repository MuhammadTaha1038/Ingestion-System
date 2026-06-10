import { randomUUID } from "crypto";
import { ChatInputCommandInteraction, Client, GatewayIntentBits, Partials } from "discord.js";
import { loadConfig } from "../config/config.js";
import { createLogger } from "../logging/logger.js";
import { encrypt } from "../security/crypto.js";
import { SmtpRepository } from "../db/repositories/smtp.js";
import { JobRepository } from "../db/repositories/jobs.js";
import { DatasetRepository } from "../db/repositories/datasets.js";
import { HierarchyRepository } from "../db/repositories/hierarchy.js";
import { WindowSettingsRepository } from "../db/repositories/windowSettings.js";
import { jobStore } from "../jobs/store.js";
import { ingestionQueue, sendingQueue } from "../queue/queues.js";
import { getQueueStatus, pauseQueues, resumeQueues } from "../queue/status.js";
import { getRecentLogs } from "../logging/logger.js";
import { getDatabasePool } from "../db/pool.js";
import { InputFormat } from "../ingestion/types.js";
import { getSendingWindowState } from "../scheduler/windowScheduler.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

const allowedFormats = new Set(["csv", "json", "txt", "raw", "bulk"]);

const truncate = (value: string, max = 1800): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const formatCampaignRows = (rows: Array<{ id: string; name: string; subject: string; status: string }>): string => {
  if (rows.length === 0) return "no_campaigns";
  return rows.slice(0, 10).map((row) => `${row.id} ${row.name} [${row.status}] ${row.subject}`).join("\n");
};

const formatCpanelRows = (rows: Array<{ id: string; name: string }>): string => {
  if (rows.length === 0) return "no_cpanels";
  return rows.slice(0, 10).map((row) => `${row.id} ${row.name}`).join("\n");
};

const formatSubdomainRows = (rows: Array<{ id: string; cpanel_account_id: string; name: string }>): string => {
  if (rows.length === 0) return "no_subdomains";
  return rows.slice(0, 10).map((row) => `${row.id} ${row.cpanel_account_id} ${row.name}`).join("\n");
};

const formatEmailRows = (rows: Array<{ id: string; subdomain_id: string; address: string }>): string => {
  if (rows.length === 0) return "no_email_accounts";
  return rows.slice(0, 10).map((row) => `${row.id} ${row.subdomain_id} ${row.address}`).join("\n");
};

const formatSmtpRows = (rows: Array<{ id: string; email_account_id: string; host: string; port: number; username: string; status: string; use_tls: boolean; max_per_window: number; max_concurrent: number }>): string => {
  if (rows.length === 0) return "no_accounts";
  return rows.slice(0, 10).map((row) => `${row.id} ${row.username}@${row.host}:${row.port} [${row.status}] tls=${row.use_tls} window=${row.max_per_window} concurrent=${row.max_concurrent}`).join("\n");
};

const formatCountBlock = (title: string, counts: Record<string, number>): string => {
  const order = ["waiting", "active", "delayed", "completed", "failed", "paused"];
  const lines = order
    .filter((key) => typeof counts[key] === "number")
    .map((key) => `- ${key}: ${counts[key]}`);
  return [title, ...lines].join("\n");
};

const formatQueueSummary = (status: {
  ingestion: Record<string, number>;
  sending: Record<string, number>;
  paused: { ingestion: boolean; sending: boolean };
  latestFailedSendingJob?: { id: string; error: string | null; finishedAt: string | null } | null;
}): string => {
  return [
    "Queue summary",
    formatCountBlock("Ingestion", status.ingestion),
    formatCountBlock("Sending", status.sending),
    `Paused: ingestion=${status.paused.ingestion ? "yes" : "no"}, sending=${status.paused.sending ? "yes" : "no"}`,
    status.latestFailedSendingJob ? `Latest failed send: ${status.latestFailedSendingJob.id} error=${status.latestFailedSendingJob.error ?? "none"}` : null,
    "",
    "Note: `failed` is historical job failure count, not a live error.",
    "If sending is failing, check `/smtp-failures` and `/job-status id:<job_id>`."
  ].filter(Boolean).join("\n");
};

const formatLogs = (logs: Array<{ ts: string; level: string; message: string; meta?: Record<string, unknown> }>): string => {
  if (logs.length === 0) return "No recent logs.";

  const lines = logs.slice(-20).map((entry) => {
    const time = new Date(entry.ts).toLocaleString("en-PK", { timeZone: "Asia/Karachi" });
    const meta = entry.meta && Object.keys(entry.meta).length > 0 ? ` ${JSON.stringify(entry.meta)}` : "";
    return `- ${time} [${entry.level}] ${entry.message}${meta}`;
  });

  return ["Recent logs", ...lines].join("\n");
};

const formatWindows = (windows: Array<{ id: string; window_start: string; window_end: string; status: string }>): string => {
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

const formatSmtpFailures = (rows: Array<{ smtp_account_id: string; consecutive_failures: number; last_failure_at: string | null }>): string => {
  if (rows.length === 0) return "No SMTP failures recorded.";
  return [
    "SMTP failures",
    ...rows.slice(0, 10).map((row) => `- ${row.smtp_account_id}: failures=${row.consecutive_failures}, last_failure=${row.last_failure_at ?? "none"}`)
  ].join("\n");
};

const formatSmtpUsage = (rows: Array<{ smtp_account_id: string; used_count: number }>): string => {
  if (rows.length === 0) return "No SMTP usage for this window.";
  return [
    "SMTP usage for window",
    ...rows.slice(0, 10).map((row) => `- ${row.smtp_account_id}: used ${row.used_count}`)
  ].join("\n");
};

const formatWindowSettings = (settings: {
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

export const startDiscordBot = async (): Promise<void> => {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set; skipping Discord bot");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });

  client.on("ready", () => {
    logger.info("discord bot ready", { user: client.user?.tag });
  });
  client.on("interactionCreate", async (interaction) => {
    let commandInteraction: ChatInputCommandInteraction | null = null;
    try {
      if (!interaction.isChatInputCommand()) return;
      commandInteraction = interaction as ChatInputCommandInteraction;
      const { commandName, options } = commandInteraction;
      await commandInteraction.deferReply();

      if (commandName === "ingest") {
        const format = options.getString("format", true);
        const content = options.getString("content") ?? "";
        const sourcePathOption = options.getString("source_path") ?? undefined;
        const attachment = options.getAttachment("file");
        const sourcePath = sourcePathOption ?? attachment?.url;
        const campaignId = options.getString("campaign_id") ?? undefined;

        void (async () => {
          try {
            if (!allowedFormats.has(format)) {
              await commandInteraction.editReply("invalid_format");
              return;
            }

            if (!content.trim() && !sourcePath) {
              await commandInteraction.editReply("missing_content_or_source_path");
              return;
            }

            const inputFormat = format as InputFormat;

            let datasetId: string | null = null;
            if (config.databaseUrl) {
              const datasetRepo = new DatasetRepository();
              datasetId = await datasetRepo.createDataset({
                sourceType: inputFormat,
                sourcePath: sourcePath ?? "inline"
              });
            }

            const job = jobStore.createJob("ingestion", {
              format,
              sourcePath: sourcePath ?? null,
              campaignId: campaignId ?? null,
              datasetId
            });

            if (config.databaseUrl) {
              const jobRepo = new JobRepository();
              await jobRepo.createJob({
                id: job.id,
                type: "ingestion",
                status: "pending",
                datasetId,
                campaignId: campaignId ?? null
              });
            }

            await ingestionQueue.add(
              "ingest",
              {
                jobId: job.id,
                datasetId: datasetId ?? undefined,
                input: { format: inputFormat, content, sourcePath },
                campaignId: campaignId ?? undefined
              },
              { jobId: job.id }
            );

            await commandInteraction.editReply(truncate(`queued ingestion job ${job.id}${datasetId ? ` dataset=${datasetId}` : ""}`));
          } catch (err) {
            logger.error("discord ingest command failed", { error: String(err) });
            try {
              await commandInteraction.editReply("command_error");
            } catch {
              // ignore
            }
          }
        })();
        return;
      }

      if (commandName === "health") {
        await commandInteraction.editReply("ok");
        return;
      }

      if (commandName === "status") {
        const jobId = options.getString("job_id");
        if (jobId) {
          const job = jobStore.getJob(jobId);
          if (!job) {
            await commandInteraction.editReply("job_not_found");
            return;
          }

          const resultCounts = job.payload?.result && typeof job.payload.result === "object"
            ? (job.payload.result as { counts?: { raw?: number; valid?: number; duplicate?: number; error?: number } }).counts
            : null;

          await commandInteraction.editReply(truncate([
            `Job ${job.id}`,
            `Type: ${job.type}`,
            `Status: ${job.status}`,
            `Created: ${job.createdAt}`,
            `Updated: ${job.updatedAt}`,
            `Progress: ${job.progress.processed}/${job.progress.total} processed, ${job.progress.failed} failed`,
            resultCounts ? `Counts: raw=${resultCounts.raw ?? 0}, valid=${resultCounts.valid ?? 0}, duplicate=${resultCounts.duplicate ?? 0}, error=${resultCounts.error ?? 0}` : null,
            job.payload?.datasetId ? `Dataset: ${String(job.payload.datasetId)}` : null,
            job.payload?.campaignId ? `Campaign: ${String(job.payload.campaignId)}` : null,
            job.error ? `Error: ${job.error}` : null
          ].filter(Boolean).join("\n")));
          return;
        }

        const summary = jobStore.getSummary();
        await commandInteraction.editReply(truncate([
          formatCountBlock("Job summary", summary.counts),
          "",
          "Recent jobs:",
          ...summary.recent.slice(0, 10).map((job) => `- ${job.id} ${job.type} [${job.status}] processed=${job.progress.processed}/${job.progress.total} failed=${job.progress.failed}`)
        ].join("\n")));
        return;
      }

      if (commandName === "queue") {
        const status = await getQueueStatus();
        if (config.databaseUrl) {
          const pool = getDatabasePool();
          const failedRes = await pool.query(
            `SELECT id, error, finished_at FROM jobs WHERE type = 'sending' AND status = 'failed' ORDER BY finished_at DESC NULLS LAST LIMIT 1`
          );
          const latestFailedSendingJob = failedRes.rows[0]
            ? {
                id: String(failedRes.rows[0].id),
                error: failedRes.rows[0].error ? String(failedRes.rows[0].error) : null,
                finishedAt: failedRes.rows[0].finished_at ? String(failedRes.rows[0].finished_at) : null
              }
            : null;

          await commandInteraction.editReply(truncate(formatQueueSummary({ ...status, latestFailedSendingJob })));
          return;
        }

        await commandInteraction.editReply(truncate(formatQueueSummary(status)));
        return;
      }

      if (commandName === "metrics") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const pool = getDatabasePool();
        const jobsRes = await pool.query(`SELECT status, count(*)::int AS count FROM jobs GROUP BY status ORDER BY status`);
        const usageRes = await pool.query(`SELECT smtp_account_id, COALESCE(SUM(used_count), 0)::int as total_used FROM smtp_usage GROUP BY smtp_account_id ORDER BY total_used DESC LIMIT 20`);
        await commandInteraction.editReply(
          truncate(
            JSON.stringify(
              {
                jobs: jobsRes.rows,
                smtpUsage: usageRes.rows
              },
              null,
              2
            )
          )
        );
        return;
      }

      if (commandName === "logs") {
        const limit = options.getInteger("limit") ?? 100;
        await commandInteraction.editReply(truncate(formatLogs(getRecentLogs(limit))));
        return;
      }

      if (commandName === "pause") {
        await pauseQueues();
        await commandInteraction.editReply("queues_paused");
        return;
      }

      if (commandName === "resume") {
        await resumeQueues();
        await commandInteraction.editReply("queues_running");
        return;
      }

      if (commandName === "window-show") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const repo = new WindowSettingsRepository();
        const settings = await repo.getSettings();
        await commandInteraction.editReply(truncate(formatWindowSettings(settings)));
        return;
      }

      if (commandName === "window-update") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const hours = options.getInteger("hours");
        const intervalHours = options.getInteger("interval_hours");
        const startHour = options.getInteger("start_hour");
        const startMinute = options.getInteger("start_minute");
        const timezone = options.getString("timezone");

        if (hours === null && intervalHours === null && startHour === null && startMinute === null && timezone === null) {
          await commandInteraction.editReply("no_fields_to_update");
          return;
        }

        if (typeof startHour === "number" && (startHour < 0 || startHour > 23)) {
          await commandInteraction.editReply("start_hour_must_be_0_to_23");
          return;
        }

        if (typeof startMinute === "number" && (startMinute < 0 || startMinute > 59)) {
          await commandInteraction.editReply("start_minute_must_be_0_to_59");
          return;
        }

        if (typeof timezone === "string") {
          try {
            new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
          } catch {
            await commandInteraction.editReply("invalid_timezone");
            return;
          }
        }

        const repo = new WindowSettingsRepository();
        const settings = await repo.updateSettings({
          sendingWindowHours: hours ?? undefined,
          sendingWindowIntervalHours: intervalHours ?? undefined,
          sendingWindowStartHour: startHour ?? undefined,
          sendingWindowStartMinute: startMinute ?? undefined,
          sendingWindowTz: timezone ?? undefined
        });

        await commandInteraction.editReply(truncate(formatWindowSettings(settings)));
        return;
      }

      if (commandName === "cpanel-create") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const name = options.getString("name", true);
        const repo = new HierarchyRepository();
        const id = await repo.createCpanel(name);
        await commandInteraction.editReply(`created cpanel ${id}`);
        return;
      }

      if (commandName === "cpanel-list") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const repo = new HierarchyRepository();
        const list = await repo.listCpanels();
        await commandInteraction.editReply(truncate(formatCpanelRows(list)));
        return;
      }

      if (commandName === "subdomain-create") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const cpanelId = options.getString("cpanel_id", true);
        const name = options.getString("name", true);
        const repo = new HierarchyRepository();
        const id = await repo.createSubdomain(cpanelId, name);
        await commandInteraction.editReply(`created subdomain ${id}`);
        return;
      }

      if (commandName === "subdomain-list") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const cpanelId = options.getString("cpanel_id") ?? undefined;
        const repo = new HierarchyRepository();
        const list = await repo.listSubdomains(cpanelId);
        await commandInteraction.editReply(truncate(formatSubdomainRows(list)));
        return;
      }

      if (commandName === "email-create") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const subdomainId = options.getString("subdomain_id", true);
        const address = options.getString("address", true);
        const repo = new HierarchyRepository();
        const id = await repo.createEmailAccount(subdomainId, address);
        await commandInteraction.editReply(`created email account ${id}`);
        return;
      }

      if (commandName === "email-list") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const subdomainId = options.getString("subdomain_id") ?? undefined;
        const repo = new HierarchyRepository();
        const list = await repo.listEmailAccounts(subdomainId);
        await commandInteraction.editReply(truncate(formatEmailRows(list)));
        return;
      }

      if (commandName === "smtp-status" || commandName === "accounts-status") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const repo = new SmtpRepository();
        const accounts = await repo.listActiveAccounts();
        await commandInteraction.editReply(truncate(accounts.length === 0 ? "no_accounts" : accounts.slice(0, 10).map((a) => `${a.id} ${a.username}@${a.host} [${a.status}]`).join("\n")));
        return;
      }

      if (commandName === "smtp-create") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const emailAccountId = options.getString("email_account_id", true);
        const host = options.getString("host", true);
        const username = options.getString("username", true);
        const password = options.getString("password", true);
        const port = options.getInteger("port") ?? 587;
        const useTls = options.getBoolean("use_tls") ?? true;
        const maxPerWindow = options.getInteger("max_per_window") ?? 50;
        const maxConcurrent = options.getInteger("max_concurrent") ?? 1;

        const repo = new SmtpRepository();
        const id = await repo.createSmtpAccount({
          emailAccountId,
          host,
          port,
          username,
          passwordEncrypted: encrypt(password),
          useTls,
          maxPerWindow,
          maxConcurrent
        });

        await commandInteraction.editReply(`created smtp account ${id}`);
        return;
      }

      if (commandName === "smtp-update") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const id = options.getString("id", true);
        const patch: {
          host?: string;
          port?: number;
          username?: string;
          passwordEncrypted?: string;
          useTls?: boolean;
          maxPerWindow?: number;
          maxConcurrent?: number;
        } = {};

        const host = options.getString("host");
        const username = options.getString("username");
        const password = options.getString("password");
        const port = options.getInteger("port");
        const useTls = options.getBoolean("use_tls");
        const maxPerWindow = options.getInteger("max_per_window");
        const maxConcurrent = options.getInteger("max_concurrent");

        if (host) patch.host = host;
        if (typeof port === "number") patch.port = port;
        if (username) patch.username = username;
        if (password) patch.passwordEncrypted = encrypt(password);
        if (typeof useTls === "boolean") patch.useTls = useTls;
        if (typeof maxPerWindow === "number") patch.maxPerWindow = maxPerWindow;
        if (typeof maxConcurrent === "number") patch.maxConcurrent = maxConcurrent;

        if (Object.keys(patch).length === 0) {
          await commandInteraction.editReply("no_fields_to_update");
          return;
        }

        const repo = new SmtpRepository();
        await repo.updateSmtpAccount(id, patch);
        await commandInteraction.editReply(`updated smtp account ${id}`);
        return;
      }

      if (commandName === "smtp-list") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const repo = new SmtpRepository();
        const list = await repo.listAllAccounts();
        await commandInteraction.editReply(truncate(formatSmtpRows(list)));
        return;
      }

      if (commandName === "smtp-usage") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const windowId = options.getString("window_id");
        const pool = getDatabasePool();
        if (windowId) {
          const res = await pool.query(
            `SELECT smtp_account_id, used_count FROM smtp_usage WHERE window_id = $1 ORDER BY used_count DESC`,
            [windowId]
          );
          await commandInteraction.editReply(truncate(formatSmtpUsage(res.rows as Array<{ smtp_account_id: string; used_count: number }>)));
          return;
        }

        const res = await pool.query(
          `SELECT id, window_start, window_end, status FROM sending_windows ORDER BY window_start DESC LIMIT 10`
        );
        await commandInteraction.editReply(truncate(formatWindows(res.rows as Array<{ id: string; window_start: string; window_end: string; status: string }>)));
        return;
      }

      if (commandName === "smtp-failures") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const pool = getDatabasePool();
        const res = await pool.query(
          `SELECT smtp_account_id, consecutive_failures, last_failure_at FROM smtp_failures ORDER BY last_failure_at DESC LIMIT 20`
        );
        await commandInteraction.editReply(truncate(formatSmtpFailures(res.rows as Array<{ smtp_account_id: string; consecutive_failures: number; last_failure_at: string | null }>)));
        return;
      }

      if (commandName === "smtp-disable") {
        const id = options.getString("id", true);
        const repo = new SmtpRepository();
        await repo.disableSmtpAccount(id);
        await commandInteraction.editReply(`disabled ${id}`);
        return;
      }

      if (commandName === "smtp-enable") {
        const id = options.getString("id", true);
        const repo = new SmtpRepository();
        await repo.enableSmtpAccount(id);
        await commandInteraction.editReply(`enabled ${id}`);
        return;
      }

      if (commandName === "job-status") {
        const id = options.getString("id", true);
        const repo = new JobRepository();
        const res = await repo.pool.query("SELECT id, status, error, processed_count, total_count FROM jobs WHERE id = $1", [id]);
        if (res.rows[0]) {
          const r = res.rows[0];
          await commandInteraction.editReply(`${r.id} ${r.status} processed=${r.processed_count} total=${r.total_count} error=${r.error ?? 'none'}`);
        } else {
          await commandInteraction.editReply("job_not_found");
        }
        return;
      }

      if (commandName === "campaign-list") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const pool = getDatabasePool();
        const res = await pool.query("SELECT id, name, subject, status FROM campaigns ORDER BY created_at DESC LIMIT 10");
        await commandInteraction.editReply(truncate(formatCampaignRows(res.rows as Array<{ id: string; name: string; subject: string; status: string }>)));
        return;
      }

      if (commandName === "campaign-create") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const name = options.getString("name", true);
        const subject = options.getString("subject", true);
        const bodyHtml = options.getString("body_html", true);
        const fromAddress = options.getString("from_address", true);
        const replyTo = options.getString("reply_to") ?? null;

        const pool = getDatabasePool();
        const res = await pool.query(
          `INSERT INTO campaigns (name, subject, body_html, from_address, reply_to) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [name, subject, bodyHtml, fromAddress, replyTo]
        );

        await commandInteraction.editReply(`created campaign ${res.rows[0].id}`);
        return;
      }

      if (commandName === "campaign-update") {
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const id = options.getString("id", true);
        const body: Record<string, unknown> = {};
        const name = options.getString("name");
        const subject = options.getString("subject");
        const bodyHtml = options.getString("body_html");
        const bodyText = options.getString("body_text");
        const fromAddress = options.getString("from_address");
        const replyTo = options.getString("reply_to");
        const status = options.getString("status");

        if (name) body.name = name;
        if (subject) body.subject = subject;
        if (bodyHtml) body.body_html = bodyHtml;
        if (bodyText) body.body_text = bodyText;
        if (fromAddress) body.from_address = fromAddress;
        if (replyTo) body.reply_to = replyTo;
        if (status) body.status = status;

        if (Object.keys(body).length === 0) {
          await commandInteraction.editReply("no_fields_to_update");
          return;
        }

        const allowedStatuses = new Set(["draft", "active", "paused", "archived"]);
        if (typeof body.status === "string" && !allowedStatuses.has(body.status)) {
          await commandInteraction.editReply("invalid_status");
          return;
        }

        const pool = getDatabasePool();
        const fields: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(body)) {
          fields.push(`${key} = $${fields.length + 1}`);
          values.push(value);
        }

        values.push(id);
        const res = await pool.query(
          `UPDATE campaigns SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id, name, subject, status, updated_at`,
          values
        );

        if (!res.rows[0]) {
          await commandInteraction.editReply("not_found");
          return;
        }

        await commandInteraction.editReply(truncate(`updated campaign ${res.rows[0].id} ${res.rows[0].name} [${res.rows[0].status}]`));
        return;
      }

      if (commandName === "campaign-send") {
        const id = options.getString("id", true);
        const datasetId = options.getString("dataset_id") ?? undefined;
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        if (!datasetId) {
          await commandInteraction.editReply("dataset_id_required_for_send");
          return;
        }

        const pool = getDatabasePool();
        const campaignRes = await pool.query(
          `SELECT subject, body_html, body_text, from_address, reply_to FROM campaigns WHERE id = $1`,
          [id]
        );
        if (!campaignRes.rows[0]) {
          await commandInteraction.editReply("campaign_not_found");
          return;
        }

        const campaign = campaignRes.rows[0] as {
          subject: string;
          body_html: string;
          body_text: string | null;
          from_address: string;
          reply_to: string | null;
        };
        const res = await pool.query(`SELECT r.email_normalized FROM recipients r WHERE r.first_dataset_id = $1`, [datasetId]);
        const emails = res.rows.map((r: { email_normalized: string }) => r.email_normalized);
        const batchSize = 50;
        const jobRepo = new JobRepository();

        for (let i = 0; i < emails.length; i += batchSize) {
          const sendJobId = randomUUID();
          const batch = emails.slice(i, i + batchSize).map((email: string) => ({
            to: email,
            subject: campaign.subject,
            html: campaign.body_html,
            text: campaign.body_text ?? undefined
          }));
          await jobRepo.createJob({
            id: sendJobId,
            type: "sending",
            status: "pending",
            campaignId: id
          });
          await sendingQueue.add(
            "send",
            {
              campaignId: id,
              windowId: "",
              fromAddress: campaign.from_address,
              replyTo: campaign.reply_to ?? undefined,
              recipients: batch
            },
            { jobId: sendJobId, removeOnComplete: true }
          );
        }

        await commandInteraction.editReply(`triggered campaign ${id}, queued ${Math.ceil(emails.length / batchSize)} send jobs for dataset ${datasetId}`);
        return;
      }
    } catch (err) {
      logger.error("discord command failed", { error: String(err) });
      try {
        if (!commandInteraction) {
          return;
        }

        if (commandInteraction.deferred || commandInteraction.replied) {
          await commandInteraction.editReply("command_error");
        } else if (commandInteraction.isRepliable()) {
          await commandInteraction.reply("command_error");
        }
      } catch (e) {
        // ignore
      }
    }
  });

  await client.login(token);
};
