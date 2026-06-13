import { randomUUID } from "crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  TextChannel,
  ModalBuilder,
  Partials,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
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
import { autoSendLatestCompletedDataset, selectCampaignById, sendDatasetWithCampaign } from "../campaigns/sendService.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

const allowedFormats = new Set(["csv", "json", "txt", "raw", "bulk"]);
const dashboardButtonIds = {
  ingest: "dashboard:ingest",
  queue: "dashboard:queue",
  send: "dashboard:send",
  logs: "dashboard:logs",
  smtpList: "dashboard:smtp-list",
  smtpCreate: "dashboard:smtp-create",
  smtpUpdate: "dashboard:smtp-update",
  smtpFailures: "dashboard:smtp-failures",
  smtpUsage: "dashboard:smtp-usage",
  accounts: "dashboard:accounts",
  health: "dashboard:health",
  status: "dashboard:status",
  window: "dashboard:window",
  campaigns: "dashboard:campaigns",
  campaignCreate: "dashboard:campaign-create",
  campaignUpdate: "dashboard:campaign-update",
  cpanelCreate: "dashboard:cpanel-create",
  subdomainCreate: "dashboard:subdomain-create",
  emailCreate: "dashboard:email-create",
  cpanelList: "dashboard:cpanel-list",
  subdomainList: "dashboard:subdomain-list",
  emailList: "dashboard:email-list",
  storage: "dashboard:storage",
  pause: "dashboard:pause",
  resume: "dashboard:resume"
} as const;

const ingestModalId = "dashboard:ingest-modal";
const campaignCreateModalId = "dashboard:campaign-create-modal";
const campaignUpdateModalId = "dashboard:campaign-update-modal";
const smtpCreateModalId = "dashboard:smtp-create-modal";
const smtpUpdateModalId = "dashboard:smtp-update-modal";
const cpanelCreateModalId = "dashboard:cpanel-create-modal";
const subdomainCreateModalId = "dashboard:subdomain-create-modal";
const emailCreateModalId = "dashboard:email-create-modal";

const getDashboardChannelId = (): string | undefined => {
  return process.env.DISCORD_DASHBOARD_CHANNEL_ID ?? process.env.DISCORD_STATUS_CHANNEL_ID;
};

const postDashboardPanel = async (client: Client): Promise<void> => {
  const dashboardChannelId = getDashboardChannelId();
  const guildId = process.env.DISCORD_SERVER_ID;
  if (!guildId) {
    return;
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    let channel: TextChannel | null = null;

    if (dashboardChannelId) {
      const fetched = await client.channels.fetch(dashboardChannelId);
      if (fetched && fetched.isTextBased() && "send" in fetched) {
        channel = fetched as TextChannel;
      }
    }

    if (!channel) {
      const channels = await guild.channels.fetch();
      const named = channels.find((candidate) => candidate?.isTextBased() && candidate.name === "system-status");
      const fallback = channels.find((candidate) => candidate?.isTextBased() && candidate.name === "general");
      const target = named ?? fallback;
      if (target && target.isTextBased() && "send" in target) {
        channel = target as TextChannel;
      }
    }

    if (!channel) {
      logger.warn("discord dashboard channel not found");
      return;
    }

    await channel.send({
      content: [
        "Discord operations dashboard",
        "Use these buttons for the primary operational interface.",
        "Ingestion, queue, status, logs, accounts, campaigns, cPanel, subdomains, emails, storage, pause, and resume are exposed here."
      ].join("\n"),
      components: createDashboardComponents()
    });
    logger.info("discord dashboard panel posted", { channelId: channel.id });
  } catch (error) {
    logger.warn("failed to post discord dashboard panel", { error: String(error) });
  }
};

const createDashboardComponents = () => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.ingest).setLabel("Ingest Data").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaigns).setLabel("Campaigns").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.send).setLabel("Start Sending").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(dashboardButtonIds.queue).setLabel("Queue").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.status).setLabel("Status").setStyle(ButtonStyle.Secondary)
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.smtpList).setLabel("SMTP List").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.smtpCreate).setLabel("SMTP Create").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.smtpUpdate).setLabel("SMTP Update").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.smtpFailures).setLabel("SMTP Failures").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.smtpUsage).setLabel("SMTP Usage").setStyle(ButtonStyle.Secondary)
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.cpanelList).setLabel("cPanel List").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.cpanelCreate).setLabel("cPanel Create").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.subdomainList).setLabel("Subdomain List").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.subdomainCreate).setLabel("Subdomain Create").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.emailList).setLabel("Email List").setStyle(ButtonStyle.Secondary)
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.emailCreate).setLabel("Email Create").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.health).setLabel("Health").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.window).setLabel("Window").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.logs).setLabel("Logs").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.storage).setLabel("Storage").setStyle(ButtonStyle.Secondary)
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.pause).setLabel("Pause").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(dashboardButtonIds.resume).setLabel("Resume").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(dashboardButtonIds.accounts).setLabel("Accounts").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignCreate).setLabel("Campaign Create").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignUpdate).setLabel("Campaign Update").setStyle(ButtonStyle.Secondary)
  )
];

const createIngestModal = () => {
  const sourcePath = new TextInputBuilder()
    .setCustomId("source_path")
    .setLabel("Download link / source path")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const format = new TextInputBuilder()
    .setCustomId("format")
    .setLabel("Format (optional)")
    .setPlaceholder("Leave blank to auto-detect")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const campaignId = new TextInputBuilder()
    .setCustomId("campaign_id")
    .setLabel("Campaign ID (optional)")
    .setPlaceholder("Use a specific campaign for this ingest")
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(ingestModalId)
    .setTitle("Ingest Data")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(sourcePath),
      new ActionRowBuilder<TextInputBuilder>().addComponents(format),
      new ActionRowBuilder<TextInputBuilder>().addComponents(campaignId)
    );
};

const createCampaignModal = (mode: "create" | "update") => {
  const campaignId = new TextInputBuilder()
    .setCustomId("campaign_id")
    .setLabel("Campaign ID (required for update)")
    .setStyle(TextInputStyle.Short)
    .setRequired(mode === "update");

  const name = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("Campaign name")
    .setStyle(TextInputStyle.Short)
    .setRequired(mode === "create");

  const subject = new TextInputBuilder()
    .setCustomId("subject")
    .setLabel("Email subject")
    .setStyle(TextInputStyle.Short)
    .setRequired(mode === "create");

  const bodyHtml = new TextInputBuilder()
    .setCustomId("body_html")
    .setLabel("HTML body")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(mode === "create");

  const fromAddress = new TextInputBuilder()
    .setCustomId("from_address")
    .setLabel("From address")
    .setStyle(TextInputStyle.Short)
    .setRequired(mode === "create");

  return new ModalBuilder()
    .setCustomId(mode === "create" ? campaignCreateModalId : campaignUpdateModalId)
    .setTitle(mode === "create" ? "Create Campaign" : "Update Campaign")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(campaignId),
      new ActionRowBuilder<TextInputBuilder>().addComponents(name),
      new ActionRowBuilder<TextInputBuilder>().addComponents(subject),
      new ActionRowBuilder<TextInputBuilder>().addComponents(bodyHtml),
      new ActionRowBuilder<TextInputBuilder>().addComponents(fromAddress)
    );
};

  const createSmtpModal = (mode: "create" | "update") => {
    if (mode === "create") {
      return new ModalBuilder()
        .setCustomId(smtpCreateModalId)
        .setTitle("Create SMTP Account")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId("email_account_id").setLabel("Email account id").setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId("host").setLabel("SMTP host").setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId("username").setLabel("SMTP username").setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder().setCustomId("password").setLabel("SMTP password or app password").setStyle(TextInputStyle.Short).setRequired(true)
          )
        );
    }

    return new ModalBuilder()
      .setCustomId(smtpUpdateModalId)
      .setTitle("Update SMTP Account")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("id").setLabel("SMTP account id").setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("host").setLabel("SMTP host").setStyle(TextInputStyle.Short).setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("username").setLabel("SMTP username").setStyle(TextInputStyle.Short).setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("password").setLabel("SMTP password or app password").setStyle(TextInputStyle.Short).setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("port").setLabel("Port").setStyle(TextInputStyle.Short).setRequired(false)
        )
      );
  };

const createHierarchyModal = (mode: "cpanel" | "subdomain" | "email") => {
  if (mode === "cpanel") {
    return new ModalBuilder()
      .setCustomId(cpanelCreateModalId)
      .setTitle("Create cPanel Account")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("name").setLabel("cPanel account name").setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
  }

  if (mode === "subdomain") {
    return new ModalBuilder()
      .setCustomId(subdomainCreateModalId)
      .setTitle("Create Subdomain")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("cpanel_id").setLabel("cPanel account id").setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("name").setLabel("Subdomain name").setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
  }

  return new ModalBuilder()
    .setCustomId(emailCreateModalId)
    .setTitle("Create Email Account")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("subdomain_id").setLabel("Subdomain id").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("address").setLabel("Email address").setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
};

const queueDashboardIngestion = async (args: {
  format?: string;
  content?: string;
  sourcePath?: string;
  campaignId?: string;
}): Promise<string> => {
  const format = (args.format ?? "").trim().toLowerCase() || "auto";

  if (format !== "auto" && !allowedFormats.has(format)) {
    return "invalid_format";
  }

  if (!(args.content ?? "").trim() && !args.sourcePath) {
    return "missing_content_or_source_path";
  }

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
    "File accepted.",
    "Processing has started.",
    "When ingestion completes, Status will show fetched, added, duplicate, and error counts for this file.",
    args.campaignId
      ? `This ingest will use campaign ${args.campaignId} if the campaign exists.`
      : "If an active campaign exists, auto-send will be queued automatically.",
    datasetId ? `Tracking dataset: ${datasetId}` : null
  ].filter(Boolean).join(" ");
};

const queueCampaignSend = async (campaignId: string, datasetId: string): Promise<string> => {
  if (!config.databaseUrl) {
    return "db_required";
  }

  const result = await sendDatasetWithCampaign({ campaignId, datasetId });
  if (!result) {
    return "campaign_not_found";
  }

  return `triggered campaign ${result.campaignId}, queued ${result.queued} send jobs for dataset ${datasetId}`;
};

const formatSimpleRows = (title: string, rows: string[]): string => {
  if (rows.length === 0) return `No ${title.toLowerCase()} found.`;
  return [title, ...rows.slice(0, 10).map((row) => `- ${row}`)].join("\n");
};

const formatStorageOverview = (): string => {
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

const saveCampaignFromModal = async (args: {
  campaignId?: string;
  name: string;
  subject: string;
  bodyHtml: string;
  fromAddress: string;
  replyTo?: string | null;
  status?: string | null;
}): Promise<string> => {
  if (!config.databaseUrl) {
    return "db_required";
  }

  const allowedStatuses = new Set(["draft", "active", "paused", "archived"]);
  const status = args.status ? args.status.toLowerCase() : null;
  if (status && !allowedStatuses.has(status)) {
    return "invalid_status";
  }

  const pool = getDatabasePool();
  if (args.campaignId) {
    const fields = ["name = $1", "subject = $2", "body_html = $3", "from_address = $4", "reply_to = $5"];
    const values: unknown[] = [args.name, args.subject, args.bodyHtml, args.fromAddress, args.replyTo ?? null];
    if (status) {
      fields.push(`status = $${fields.length + 1}`);
      values.push(status);
    }
    values.push(args.campaignId);
    const res = await pool.query(
      `UPDATE campaigns SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id`,
      values
    );
    return res.rows[0] ? `updated campaign ${res.rows[0].id}` : "campaign_not_found";
  }

  const createFields = ["name", "subject", "body_html", "from_address", "reply_to"];
  const createValues: unknown[] = [args.name, args.subject, args.bodyHtml, args.fromAddress, args.replyTo ?? null];
  if (status) {
    createFields.push("status");
    createValues.push(status);
  }

  const placeholders = createValues.map((_, index) => `$${index + 1}`).join(",");
  const res = await pool.query(
    `INSERT INTO campaigns (${createFields.join(",")}) VALUES (${placeholders}) RETURNING id`,
    createValues
  );
  return `created campaign ${res.rows[0].id}`;
};

const createHierarchyRecord = async (mode: "cpanel" | "subdomain" | "email", values: Record<string, string>): Promise<string> => {
  if (!config.databaseUrl) {
    return "db_required";
  }

  const repo = new HierarchyRepository();
  if (mode === "cpanel") {
    return await repo.createCpanel(values.name);
  }
  if (mode === "subdomain") {
    return await repo.createSubdomain(values.cpanel_id, values.name);
  }
  return await repo.createEmailAccount(values.subdomain_id, values.address);
};

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

const formatIngestionJobSummary = (job: { id: string; status: string; payload?: Record<string, unknown>; error?: string | null }): string => {
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

const formatJobLine = (job: { id: string; type: string; status: string; progress: { processed: number; total: number }; payload?: Record<string, unknown>; error?: string }): string => {
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

const formatPipelineSummary = (status: {
  ingestion: Record<string, number>;
  sending: Record<string, number>;
  paused: { ingestion: boolean; sending: boolean };
  latestFailedSendingJob?: { id: string; error: string | null; finishedAt: string | null } | null;
}): string => {
  const ingestionBusy = (status.ingestion.waiting ?? 0) > 0 || (status.ingestion.active ?? 0) > 0;
  const sendingBusy = (status.sending.waiting ?? 0) > 0 || (status.sending.active ?? 0) > 0;
  const ingestionState = status.paused.ingestion ? "paused" : ingestionBusy ? "working" : "ready";
  const sendingState = status.paused.sending ? "paused" : sendingBusy ? "working" : "ready";
  const sendIssue = status.latestFailedSendingJob?.error
    ? `A previous send failed because of SMTP/server settings. The file pipeline still stays automatic.`
    : null;

  return [
    "Pipeline status",
    `Ingestion: ${ingestionState}`,
    `Sending: ${sendingState}`,
    `Automatic handoff: ${status.paused.sending ? "held until sending resumes" : "enabled"}`,
    sendIssue,
    "Use the dashboard buttons for upload, campaign setup, and live status.",
    "Queue details are available for troubleshooting, but the normal flow is upload -> process -> send."
  ].filter(Boolean).join("\n");
};

const formatQueueSummary = (status: {
  ingestion: Record<string, number>;
  sending: Record<string, number>;
  paused: { ingestion: boolean; sending: boolean };
  latestFailedSendingJob?: { id: string; error: string | null; finishedAt: string | null } | null;
  liveJobs?: Array<{ id: string; type: string; status: string; progress: { processed: number; total: number }; payload?: Record<string, unknown>; error?: string }>;
  latestIngestionJob?: { id: string; status: string; payload?: Record<string, unknown>; error?: string | null } | null;
  latestSendingJob?: { id: string; status: string; payload?: Record<string, unknown>; error?: string | null } | null;
}): string => {
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
    "This view shows the latest file and send activity, not the full historical queue."
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

const formatJobStatusSummary = (job: {
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

export const startDiscordBot = async (): Promise<void> => {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set; skipping Discord bot");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });

  client.on("ready", () => {
    logger.info("discord bot ready", { user: client.user?.tag });
    void postDashboardPanel(client);
  });
  client.on("interactionCreate", async (interaction) => {
    let commandInteraction: ChatInputCommandInteraction | null = null;
    try {
      if (interaction.isButton()) {
        if (interaction.customId === dashboardButtonIds.ingest) {
          await interaction.showModal(createIngestModal());
          return;
        }

        if (interaction.customId === dashboardButtonIds.queue) {
          await interaction.deferReply({ ephemeral: true });
          const queueStatus = await getQueueStatus();
          const summary = jobStore.getSummary();
          const latestIngestionJob = summary.recent.find((job) => job.type === "ingestion") ?? null;
          const latestSendingJob = summary.recent.find((job) => job.type === "sending") ?? null;
          const liveJobs = summary.recent.filter((job) => job.status === "pending" || job.status === "processing");

          let latestFailedSendingJob: { id: string; error: string | null; finishedAt: string | null } | null = null;
          if (config.databaseUrl) {
            const pool = getDatabasePool();
            const failedRes = await pool.query(
              `SELECT id, error, finished_at FROM jobs WHERE type = 'sending' AND status = 'failed' ORDER BY finished_at DESC NULLS LAST LIMIT 1`
            );
            latestFailedSendingJob = failedRes.rows[0]
              ? {
                  id: String(failedRes.rows[0].id),
                  error: failedRes.rows[0].error ? String(failedRes.rows[0].error) : null,
                  finishedAt: failedRes.rows[0].finished_at ? String(failedRes.rows[0].finished_at) : null
                }
              : null;
          }

          await interaction.editReply(truncate(formatQueueSummary({ ...queueStatus, latestFailedSendingJob, latestIngestionJob, latestSendingJob, liveJobs })));
          return;
        }

        if (interaction.customId === dashboardButtonIds.accounts) {
          await interaction.deferReply({ ephemeral: true });
          if (!config.databaseUrl) {
            await interaction.editReply("db_required");
            return;
          }

          const repo = new SmtpRepository();
          const accounts = await repo.listActiveAccounts();
          await interaction.editReply(truncate(accounts.length === 0 ? "no_accounts" : accounts.slice(0, 10).map((a) => `${a.id} ${a.username}@${a.host} [${a.status}]`).join("\n")));
          return;
        }

        if (interaction.customId === dashboardButtonIds.health) {
          await interaction.reply({ content: "ok", ephemeral: true });
          return;
        }

        if (interaction.customId === dashboardButtonIds.status) {
          await interaction.deferReply({ ephemeral: true });
          const summary = jobStore.getSummary();
          const latestIngestionJob = summary.recent.find((job) => job.type === "ingestion") ?? null;
          const latestSendingJob = summary.recent.find((job) => job.type === "sending") ?? null;
          const liveJobs = summary.recent.filter((job) => job.status === "pending" || job.status === "processing");
          const message = [
            "Current pipeline",
            latestIngestionJob ? formatIngestionJobSummary(latestIngestionJob) : "No ingestion jobs yet.",
            "",
            latestSendingJob
              ? [
                  "Latest send",
                  `Status: ${latestSendingJob.status}`,
                  typeof latestSendingJob.payload?.campaignId === "string" ? `Campaign: ${latestSendingJob.payload.campaignId}` : null,
                  Array.isArray(latestSendingJob.payload?.recipients) ? `Recipients: ${(latestSendingJob.payload?.recipients as Array<unknown>).length}` : null,
                  latestSendingJob.error ? `Issue: ${latestSendingJob.error}` : null
                ].filter(Boolean).join("\n")
              : "No send jobs yet.",
            "",
            "Live work",
            ...(liveJobs.length > 0 ? liveJobs.slice(0, 5).map((job) => `- ${formatJobLine(job)}`) : ["- No jobs are currently waiting or running."])
          ].join("\n");

          await interaction.editReply(truncate(message));
          return;
        }

        if (interaction.customId === dashboardButtonIds.window) {
          await interaction.deferReply({ ephemeral: true });
          if (!config.databaseUrl) {
            await interaction.editReply("db_required");
            return;
          }

          const repo = new WindowSettingsRepository();
          const settings = await repo.getSettings();
          await interaction.editReply(truncate(formatWindowSettings(settings)));
          return;
        }

        if (interaction.customId === dashboardButtonIds.campaigns) {
          await interaction.deferReply({ ephemeral: true });
          if (!config.databaseUrl) {
            await interaction.editReply("db_required");
            return;
          }

          const pool = getDatabasePool();
          const res = await pool.query("SELECT id, name, subject, status FROM campaigns ORDER BY created_at DESC LIMIT 10");
          await interaction.editReply(truncate(formatCampaignRows(res.rows as Array<{ id: string; name: string; subject: string; status: string }>)));
          return;
        }

        if (interaction.customId === dashboardButtonIds.smtpList || interaction.customId === dashboardButtonIds.smtpFailures || interaction.customId === dashboardButtonIds.smtpUsage) {
          await interaction.deferReply({ ephemeral: true });
          if (!config.databaseUrl) {
            await interaction.editReply("db_required");
            return;
          }

          const pool = getDatabasePool();
          if (interaction.customId === dashboardButtonIds.smtpList) {
            const repo = new SmtpRepository();
            const list = await repo.listAllAccounts();
            await interaction.editReply(truncate(formatSmtpRows(list)));
            return;
          }

          if (interaction.customId === dashboardButtonIds.smtpFailures) {
            const res = await pool.query(
              `SELECT smtp_account_id, consecutive_failures, last_failure_at FROM smtp_failures ORDER BY last_failure_at DESC LIMIT 20`
            );
            await interaction.editReply(truncate(formatSmtpFailures(res.rows as Array<{ smtp_account_id: string; consecutive_failures: number; last_failure_at: string | null }>)));
            return;
          }

          const res = await pool.query(
            `SELECT id, window_start, window_end, status FROM sending_windows ORDER BY window_start DESC LIMIT 10`
          );
          await interaction.editReply(truncate(formatWindows(res.rows as Array<{ id: string; window_start: string; window_end: string; status: string }>)));
          return;
        }

        if (interaction.customId === dashboardButtonIds.smtpCreate) {
          await interaction.showModal(createSmtpModal("create"));
          return;
        }

        if (interaction.customId === dashboardButtonIds.smtpUpdate) {
          await interaction.showModal(createSmtpModal("update"));
          return;
        }

        if (interaction.customId === dashboardButtonIds.campaignCreate) {
          await interaction.showModal(createCampaignModal("create"));
          return;
        }

        if (interaction.customId === dashboardButtonIds.campaignUpdate) {
          await interaction.showModal(createCampaignModal("update"));
          return;
        }

        if (interaction.customId === dashboardButtonIds.cpanelList) {
          if (!config.databaseUrl) {
            await interaction.reply({ content: "db_required", ephemeral: true });
            return;
          }

          const repo = new HierarchyRepository();
          const list = await repo.listCpanels();
          await interaction.reply({ content: truncate(formatCpanelRows(list)), ephemeral: true });
          return;
        }

        if (interaction.customId === dashboardButtonIds.subdomainList) {
          if (!config.databaseUrl) {
            await interaction.reply({ content: "db_required", ephemeral: true });
            return;
          }

          const repo = new HierarchyRepository();
          const list = await repo.listSubdomains();
          await interaction.reply({ content: truncate(formatSubdomainRows(list)), ephemeral: true });
          return;
        }

        if (interaction.customId === dashboardButtonIds.emailList) {
          if (!config.databaseUrl) {
            await interaction.reply({ content: "db_required", ephemeral: true });
            return;
          }

          const repo = new HierarchyRepository();
          const list = await repo.listEmailAccounts();
          await interaction.reply({ content: truncate(formatEmailRows(list)), ephemeral: true });
          return;
        }

        if (interaction.customId === dashboardButtonIds.storage) {
          await interaction.reply({ content: truncate(formatStorageOverview()), ephemeral: true });
          return;
        }

        if (interaction.customId === dashboardButtonIds.cpanelCreate) {
          await interaction.showModal(createHierarchyModal("cpanel"));
          return;
        }

        if (interaction.customId === dashboardButtonIds.subdomainCreate) {
          await interaction.showModal(createHierarchyModal("subdomain"));
          return;
        }

        if (interaction.customId === dashboardButtonIds.emailCreate) {
          await interaction.showModal(createHierarchyModal("email"));
          return;
        }

        if (interaction.customId === dashboardButtonIds.pause) {
          await pauseQueues();
          await interaction.reply({ content: "queues_paused", ephemeral: true });
          return;
        }

        if (interaction.customId === dashboardButtonIds.resume) {
          await resumeQueues();
          await interaction.reply({ content: "queues_running", ephemeral: true });
          return;
        }

        if (interaction.customId === dashboardButtonIds.logs) {
          await interaction.reply({ content: truncate(formatLogs(getRecentLogs(10))), ephemeral: true });
          return;
        }

        if (interaction.customId === dashboardButtonIds.send) {
          await interaction.deferReply({ ephemeral: true });
          if (!config.databaseUrl) {
            await interaction.editReply("db_required");
            return;
          }

          const result = await autoSendLatestCompletedDataset();
          if (!result) {
            await interaction.editReply("No completed dataset and active campaign were found yet. Upload a file first, then make sure a campaign is active.");
            return;
          }

          const queueStatus = await getQueueStatus();
          const summary = jobStore.getSummary();
          const latestIngestionJob = summary.recent.find((job) => job.type === "ingestion") ?? null;
          const latestSendingJob = summary.recent.find((job) => job.type === "sending") ?? null;
          const liveJobs = summary.recent.filter((job) => job.status === "pending" || job.status === "processing");

          let latestFailedSendingJob: { id: string; error: string | null; finishedAt: string | null } | null = null;
          if (config.databaseUrl) {
            const pool = getDatabasePool();
            const failedRes = await pool.query(
              `SELECT id, error, finished_at FROM jobs WHERE type = 'sending' AND status = 'failed' ORDER BY finished_at DESC NULLS LAST LIMIT 1`
            );
            latestFailedSendingJob = failedRes.rows[0]
              ? {
                  id: String(failedRes.rows[0].id),
                  error: failedRes.rows[0].error ? String(failedRes.rows[0].error) : null,
                  finishedAt: failedRes.rows[0].finished_at ? String(failedRes.rows[0].finished_at) : null
                }
              : null;
          }

          await interaction.editReply(truncate([
            `Automatic sending started for campaign ${result.campaignId}.`,
            `Dataset: ${result.datasetId}`,
            `Queued send jobs: ${result.queued}`,
            "",
            formatQueueSummary({ ...queueStatus, latestFailedSendingJob, latestIngestionJob, latestSendingJob, liveJobs })
          ].join("\n")));
          return;
        }
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId === ingestModalId) {
          await interaction.deferReply({ ephemeral: true });
          const sourcePath = interaction.fields.getTextInputValue("source_path").trim();
          const format = interaction.fields.getTextInputValue("format").trim().toLowerCase();
          const campaignId = interaction.fields.getTextInputValue("campaign_id").trim() || undefined;
          const message = await queueDashboardIngestion({ format, sourcePath, campaignId });
          await interaction.editReply(message);
          return;
        }

        if (interaction.customId === campaignCreateModalId || interaction.customId === campaignUpdateModalId) {
          await interaction.deferReply({ ephemeral: true });
          const campaignId = interaction.fields.getTextInputValue("campaign_id").trim();
          const name = interaction.fields.getTextInputValue("name").trim();
          const subject = interaction.fields.getTextInputValue("subject").trim();
          const bodyHtml = interaction.fields.getTextInputValue("body_html").trim();
          const fromAddress = interaction.fields.getTextInputValue("from_address").trim();

          if (interaction.customId === campaignUpdateModalId && !campaignId) {
            await interaction.editReply("campaign_id_required_for_update");
            return;
          }

          const message = await saveCampaignFromModal({
            campaignId: campaignId || undefined,
            name,
            subject,
            bodyHtml,
            fromAddress
          });
          await interaction.editReply(message);
          return;
        }

        if (interaction.customId === cpanelCreateModalId) {
          await interaction.deferReply({ ephemeral: true });
          const name = interaction.fields.getTextInputValue("name").trim();
          const id = await createHierarchyRecord("cpanel", { name });
          await interaction.editReply(id === "db_required" ? id : `created cpanel ${id}`);
          return;
        }

        if (interaction.customId === subdomainCreateModalId) {
          await interaction.deferReply({ ephemeral: true });
          const cpanelId = interaction.fields.getTextInputValue("cpanel_id").trim();
          const name = interaction.fields.getTextInputValue("name").trim();
          const id = await createHierarchyRecord("subdomain", { cpanel_id: cpanelId, name });
          await interaction.editReply(id === "db_required" ? id : `created subdomain ${id}`);
          return;
        }

        if (interaction.customId === emailCreateModalId) {
          await interaction.deferReply({ ephemeral: true });
          const subdomainId = interaction.fields.getTextInputValue("subdomain_id").trim();
          const address = interaction.fields.getTextInputValue("address").trim();
          const id = await createHierarchyRecord("email", { subdomain_id: subdomainId, address });
          await interaction.editReply(id === "db_required" ? id : `created email account ${id}`);
          return;
        }

        if (interaction.customId === smtpCreateModalId || interaction.customId === smtpUpdateModalId) {
          await interaction.deferReply({ ephemeral: true });
          if (!config.databaseUrl) {
            await interaction.editReply("db_required");
            return;
          }

          const repo = new SmtpRepository();
          if (interaction.customId === smtpCreateModalId) {
            const emailAccountId = interaction.fields.getTextInputValue("email_account_id").trim();
            const host = interaction.fields.getTextInputValue("host").trim();
            const username = interaction.fields.getTextInputValue("username").trim();
            const password = interaction.fields.getTextInputValue("password").trim();

            if (!emailAccountId || !host || !username || !password) {
              await interaction.editReply("missing_required_smtp_fields");
              return;
            }

            const createdId = await repo.createSmtpAccount({
              emailAccountId,
              host,
              port: 587,
              username,
              passwordEncrypted: encrypt(password),
              useTls: true,
              maxPerWindow: 50,
              maxConcurrent: 1
            });

            await interaction.editReply(`created smtp account ${createdId}. Use SMTP List to verify it.`);
            return;
          }

          const id = interaction.fields.getTextInputValue("id").trim();
          const host = interaction.fields.getTextInputValue("host").trim();
          const username = interaction.fields.getTextInputValue("username").trim();
          const password = interaction.fields.getTextInputValue("password").trim();
          const portText = interaction.fields.getTextInputValue("port").trim();

          const parseNumber = (value: string): number | undefined => {
            if (!value) return undefined;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
          };

          const port = parseNumber(portText);

          if (!id) {
            await interaction.editReply("smtp_account_id_required_for_update");
            return;
          }

          const patch: {
            host?: string;
            port?: number;
            username?: string;
            passwordEncrypted?: string;
          } = {};

          if (host) patch.host = host;
          if (typeof port === "number") patch.port = port;
          if (username) patch.username = username;
          if (password) patch.passwordEncrypted = encrypt(password);

          if (Object.keys(patch).length === 0) {
            await interaction.editReply("no_fields_to_update");
            return;
          }

          await repo.updateSmtpAccount(id, patch);
          await interaction.editReply(`updated smtp account ${id}`);
          return;
        }

      }

      if (!interaction.isChatInputCommand()) return;
      commandInteraction = interaction as ChatInputCommandInteraction;
      const { commandName, options } = commandInteraction;
      await commandInteraction.deferReply();

      if (commandName === "dashboard") {
        await commandInteraction.editReply({
          content: [
            "Client dashboard",
            "Primary flow: create or activate a campaign, upload a file, then let the system process and send automatically.",
            "The queue and status buttons are for checking progress; they are not required for normal use.",
            "If you only want the simple flow, use Campaign Create, Ingest Data, and Queue/Status."
          ].join("\n"),
          components: createDashboardComponents()
        });
        return;
      }

      if (commandName === "ingest") {
        const format = options.getString("format") ?? "auto";
        const content = options.getString("content") ?? "";
        const sourcePathOption = options.getString("source_path") ?? undefined;
        const attachment = options.getAttachment("file");
        const sourcePath = sourcePathOption ?? attachment?.url;
        const campaignId = options.getString("campaign_id") ?? undefined;

        void (async () => {
          try {
            if (format !== "auto" && !allowedFormats.has(format)) {
              await commandInteraction.editReply("invalid_format");
              return;
            }

            if (!content.trim() && !sourcePath) {
              await commandInteraction.editReply("missing_content_or_source_path");
              return;
            }

            const message = await queueDashboardIngestion({ format, content, sourcePath, campaignId });
            await commandInteraction.editReply(truncate(message));
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
            formatJobStatusSummary(job),
            resultCounts ? `Records: raw=${resultCounts.raw ?? 0}, valid=${resultCounts.valid ?? 0}, duplicate=${resultCounts.duplicate ?? 0}, error=${resultCounts.error ?? 0}` : null,
            `Created: ${job.createdAt}`,
            `Updated: ${job.updatedAt}`
          ].filter(Boolean).join("\n")));
          return;
        }

        const summary = jobStore.getSummary();
          const latestIngestionJob = summary.recent.find((job) => job.type === "ingestion") ?? null;
          const latestSendingJob = summary.recent.find((job) => job.type === "sending") ?? null;
          const liveJobs = summary.recent.filter((job) => job.status === "pending" || job.status === "processing");
        await commandInteraction.editReply(truncate([
            "Current pipeline",
            latestIngestionJob ? formatIngestionJobSummary(latestIngestionJob) : "No ingestion jobs yet.",
            "",
            latestSendingJob
              ? [
                  "Latest send",
                  `Status: ${latestSendingJob.status}`,
                  typeof latestSendingJob.payload?.campaignId === "string" ? `Campaign: ${latestSendingJob.payload.campaignId}` : null,
                  Array.isArray(latestSendingJob.payload?.recipients) ? `Recipients: ${(latestSendingJob.payload?.recipients as Array<unknown>).length}` : null,
                  latestSendingJob.error ? `Issue: ${latestSendingJob.error}` : null
                ].filter(Boolean).join("\n")
              : "No send jobs yet.",
          "",
          "Recent activity:",
            ...(liveJobs.length > 0
              ? liveJobs.slice(0, 5).map((job) => `- ${formatJobLine(job)}`)
              : ["- No jobs are currently waiting or running."])
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
        await commandInteraction.editReply(truncate([
          accounts.length === 0 ? "no_accounts" : accounts.slice(0, 10).map((a) => `${a.id} ${a.username}@${a.host} [${a.status}]`).join("\n"),
          "",
          "For the button-based interface, run /dashboard."
        ].join("\n")));
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

        const message = await queueCampaignSend(id, datasetId);
        await commandInteraction.editReply(message);
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
