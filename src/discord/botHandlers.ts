import { ButtonInteraction, ChatInputCommandInteraction, ModalSubmitInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuInteraction } from "discord.js";
import { loadConfig } from "../config/config.js";
import { createLogger, getRecentLogs } from "../logging/logger.js";
import { DatasetRepository } from "../db/repositories/datasets.js";
import { SmtpRepository } from "../db/repositories/smtp.js";
import { JobRepository } from "../db/repositories/jobs.js";
import { HierarchyRepository } from "../db/repositories/hierarchy.js";
import { WindowSettingsRepository } from "../db/repositories/windowSettings.js";
import { getDatabasePool } from "../db/pool.js";
import { jobStore } from "../jobs/store.js";
import { getQueueStatus, pauseQueues, resumeQueues } from "../queue/status.js";
import { autoSendLatestCompletedDataset, selectCampaignById } from "../campaigns/sendService.js";
import { encrypt } from "../security/crypto.js";
import {
  dashboardButtonIds,
  createDashboardComponents,
  createIngestModal,
  createDatasetSelectModal,
  createCampaignDetailsModal,
  createRunCampaignModal,
  createRunCampaignDatasetModal,
  createAddTestRecipientModal,
  createSendTestModal,
  createSmtpImportModal,
  createCampaignModal,
  createCampaignUpdateModal,
  createCampaignDeleteModal,
  createCampaignDeleteConfirmModal,
  createSmtpModal,
  createSmtpDeleteModal,
  createHierarchyModal,
  createHierarchyRecord,
  ingestModalId,
  smtpImportModalId,
  campaignCreateModalId,
  campaignUpdateModalId,
  campaignDeleteModalId,
  smtpCreateModalId,
  smtpUpdateModalId,
  smtpDeleteModalId,
  cpanelCreateModalId,
  subdomainCreateModalId,
  emailCreateModalId,
  parseSmtpUpdateText
} from "./dashboard.js";
import { allowedFormats, queueDashboardIngestion, queueDashboardSmtpImport } from "./ingestion.js";
import {
  parseCampaignUpdateText,
  saveCampaignFromModal,
  updateCampaignFromPatch,
  deleteCampaignById,
  queueCampaignSend
} from "./campaigns.js";
import {
  truncate,
  formatQueueSummary,
  formatLogs,
  formatWindows,
  formatWindowSettings,
  formatCampaignRows,
  formatCpanelRows,
  formatSubdomainRows,
  formatEmailRows,
  formatSmtpRows,
  formatSmtpFailures,
  formatSmtpUsage,
  formatJobStatusSummary,
  formatIngestionJobSummary,
  formatJobLine,
  formatStorageOverview,
  getPersistentJobSummary,
  formatPersistentJobSummary
} from "./formatters.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
let latestTestRecipientEmail: string | null = null;

const getLatestFailedSendingJob = async (): Promise<{ id: string; error: string | null; finishedAt: string | null } | null> => {
  const pool = getDatabasePool();
  const failedRes = await pool.query(
    `SELECT id, error, finished_at FROM jobs WHERE type = 'sending' AND status = 'failed' ORDER BY finished_at DESC NULLS LAST LIMIT 1`
  );
  if (!failedRes.rows[0]) {
    return null;
  }

  return {
    id: String(failedRes.rows[0].id),
    error: failedRes.rows[0].error ? String(failedRes.rows[0].error) : null,
    finishedAt: failedRes.rows[0].finished_at ? String(failedRes.rows[0].finished_at) : null
  };
};

const getLatestPipelineSummary = () => {
  const summary = jobStore.getSummary();
  return {
    latestIngestionJob: summary.recent.find((job) => job.type === "ingestion") ?? null,
    latestSendingJob: summary.recent.find((job) => job.type === "sending") ?? null,
    liveJobs: summary.recent.filter((job) => job.status === "pending" || job.status === "processing")
  };
};

const getInteractionReplyMethod = async (interaction: ButtonInteraction | ModalSubmitInteraction, message: string): Promise<void> => {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(message);
  } else {
    await interaction.reply({ content: message, ephemeral: true });
  }
};

export const handleButtonInteraction = async (interaction: ButtonInteraction): Promise<void> => {
  logger.info("button interaction received", { customId: interaction.customId, user: interaction.user?.id });
  if (interaction.customId === dashboardButtonIds.ingest) {
    await interaction.showModal(createIngestModal());
    return;
  }

  if (interaction.customId === dashboardButtonIds.ingestNewList) {
    // Ingest new recipient list uses the same ingest modal but is labeled differently in the dashboard
    await interaction.showModal(createIngestModal());
    return;
  }

  if (interaction.customId === dashboardButtonIds.queue) {
    await interaction.deferReply({ ephemeral: true });
    const queueStatus = await getQueueStatus();
    const pipeline = getLatestPipelineSummary();
    let latestFailedSendingJob = null;
    let persistentSummary: string | undefined;

    if (config.databaseUrl) {
      latestFailedSendingJob = await getLatestFailedSendingJob();
      const dbSummary = await getPersistentJobSummary();
      persistentSummary = formatPersistentJobSummary(dbSummary);
    }

    await interaction.editReply(truncate(formatQueueSummary({
      ...queueStatus,
      latestFailedSendingJob,
      latestIngestionJob: pipeline.latestIngestionJob,
      latestSendingJob: pipeline.latestSendingJob,
      liveJobs: pipeline.liveJobs
    }, persistentSummary)));
    return;
  }

  if (interaction.customId === dashboardButtonIds.accounts) {
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }

    const pool = getDatabasePool();
    const rows = await pool.query(
      `SELECT sa.id, sa.username, sa.host, sa.port, sa.status, ea.address AS email_account_address
       FROM smtp_accounts sa
       LEFT JOIN email_accounts ea ON sa.email_account_id = ea.id
       ORDER BY sa.created_at DESC LIMIT 10`
    );

    await interaction.editReply(truncate(
      rows.rows.length === 0
        ? "no_accounts"
        : rows.rows.map((row: { id: string; username: string; host: string; port: number; status: string; email_account_address: string | null }) =>
            `${row.id} ${row.username}@${row.host}:${row.port} [${row.status}] email=${row.email_account_address ?? "unknown"}`
          ).join("\n")
    ));
    return;
  }

  if (interaction.customId === dashboardButtonIds.health) {
    await interaction.reply({ content: "ok", ephemeral: true });
    return;
  }

  if (interaction.customId === dashboardButtonIds.status) {
    await interaction.deferReply({ ephemeral: true });
    const pipeline = getLatestPipelineSummary();
    let persistentSummary: string | null = null;

    if (config.databaseUrl) {
      const dbSummary = await getPersistentJobSummary();
      persistentSummary = formatPersistentJobSummary(dbSummary);
    }

    const message = [
      "Current pipeline",
      pipeline.latestIngestionJob ? formatIngestionJobSummary(pipeline.latestIngestionJob) : "No ingestion jobs yet.",
      "",
      pipeline.latestSendingJob
        ? [
            "Latest send",
            `Status: ${pipeline.latestSendingJob.status}`,
            typeof pipeline.latestSendingJob.payload?.campaignId === "string" ? `Campaign: ${pipeline.latestSendingJob.payload.campaignId}` : null,
            Array.isArray(pipeline.latestSendingJob.payload?.recipients) ? `Recipients: ${(pipeline.latestSendingJob.payload?.recipients as Array<unknown>).length}` : null,
            pipeline.latestSendingJob.error ? `Issue: ${pipeline.latestSendingJob.error}` : null
          ].filter(Boolean).join("\n")
        : "No send jobs yet.",
      "",
      "Live work",
      ...(pipeline.liveJobs.length > 0 ? pipeline.liveJobs.slice(0, 5).map((job) => `- ${formatJobLine(job)}`) : ["- No jobs are currently waiting or running."])
    ];

    if (persistentSummary) {
      message.push("", persistentSummary);
    }

    await interaction.editReply(truncate(message.join("\n")));
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

  if (interaction.customId === dashboardButtonIds.campaigns || interaction.customId === dashboardButtonIds.campaignList) {
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }

    const pool = getDatabasePool();
    const res = await pool.query(
      `SELECT c.id, c.name, c.subject, c.status, ea.address AS smtp_account_address
       FROM campaigns c
       LEFT JOIN smtp_accounts sa ON c.smtp_account_id = sa.id
       LEFT JOIN email_accounts ea ON sa.email_account_id = ea.id
       ORDER BY c.created_at DESC LIMIT 10`
    );
    await interaction.editReply(truncate(formatCampaignRows(res.rows as Array<{ id: string; name: string; subject: string; status: string; smtp_account_address?: string | null }>)));
    return;
  }

  if (interaction.customId === dashboardButtonIds.datasetList) {
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }

    const pool = getDatabasePool();
    const res = await pool.query(
      `SELECT id, source_type, source_path, source_name, status, raw_count, valid_count, duplicate_count, error_count, created_at
       FROM datasets
       ORDER BY created_at DESC
       LIMIT 25`
    );
    const list = res.rows as Array<{ id: string; source_type: string; source_path: string; source_name: string | null; status: string; raw_count: number; valid_count: number; duplicate_count: number; error_count: number; created_at: string }>;
    if (list.length === 0) {
      await interaction.editReply("No datasets found.");
      return;
    }

    await interaction.editReply(truncate(list.slice(0, 10).map((row) =>
      `${row.source_name ?? row.id} [${row.status}] ${row.source_type} raw=${row.raw_count} valid=${row.valid_count} dup=${row.duplicate_count} err=${row.error_count}`
    ).join("\n")));
    return;
  }

  if (interaction.customId === dashboardButtonIds.datasetSelect) {
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }

    const repo = new DatasetRepository();
    const list = await repo.listAllDatasets();
    if (list.length === 0) {
      await interaction.editReply("No datasets found.");
      return;
    }

    const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];
    const buttons = list.slice(0, 25).map((row) =>
      new ButtonBuilder().setCustomId(`dashboard:dataset-pick:${row.id}`).setLabel((row.source_name ?? String(row.id)).slice(0, 80)).setStyle(ButtonStyle.Secondary)
    );
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(i, i + 5)));
    }

    await interaction.editReply({ content: "Select a dataset:", components: rows });
    return;
  }

  if (interaction.customId === dashboardButtonIds.campaignSelect || interaction.customId === dashboardButtonIds.campaignView) {
    // Both campaignSelect and campaignView now use the same button-picker flow — no manual ID entry needed.
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }

    const pool = getDatabasePool();
    const res = await pool.query(`SELECT id, name FROM campaigns ORDER BY created_at DESC LIMIT 25`);
    if (!res.rows || res.rows.length === 0) {
      await interaction.editReply("No campaigns found.");
      return;
    }

    const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];
    const buttons = res.rows.map((r: any) => new ButtonBuilder().setCustomId(`dashboard:campaign-pick:${r.id}`).setLabel(String(r.name || r.id).slice(0, 80)).setStyle(ButtonStyle.Secondary));
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(i, i + 5)));
    }
    await interaction.editReply({ content: "Select a campaign:", components: rows });
    return;
  }

  // Handle dynamic pick buttons: dataset pick and campaign pick
  if (interaction.customId.startsWith("dashboard:campaign-pick:")) {
    await interaction.deferReply({ ephemeral: true });
    const parts = interaction.customId.split(":");
    const campaignId = parts.slice(2).join(":");
    if (!campaignId) {
      await interaction.editReply("campaign_id_required");
      return;
    }
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }
    const campaign = await selectCampaignById(campaignId);
    if (!campaign) {
      await interaction.editReply("campaign_not_found");
      return;
    }

    await interaction.editReply(truncate([
      `Campaign: ${campaign.id}`,
      `Name: ${campaign.name}`,
      `Status: ${campaign.status}`,
      `Subject: ${campaign.subject}`,
      `SMTP: ${campaign.smtp_account_email ?? "none"}`,
      `Reply-to: ${campaign.reply_to ?? "none"}`,
      "Body HTML:",
      campaign.body_html
    ].join("\n")));
    return;
  }

  if (interaction.customId.startsWith("dashboard:dataset-pick:")) {
    await interaction.deferReply({ ephemeral: true });
    const parts = interaction.customId.split(":");
    const datasetId = parts.slice(2).join(":");
    if (!datasetId) {
      await interaction.editReply("dataset_id_required");
      return;
    }
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }
    const repo = new DatasetRepository();
    const dataset = await repo.getDatasetById(datasetId);
    if (!dataset) {
      await interaction.editReply("dataset_not_found");
      return;
    }

    await interaction.editReply(truncate([
      `Dataset: ${dataset.source_name ?? dataset.id}`,
      `ID: ${dataset.id}`,
      `Status: ${dataset.status}`,
      `Source: ${dataset.source_type} ${dataset.source_path}`,
      `Counts: raw=${dataset.raw_count ?? 0} valid=${dataset.valid_count ?? 0} duplicate=${dataset.duplicate_count ?? 0} error=${dataset.error_count ?? 0}`,
      dataset.processed_path ? `Processed path: ${dataset.processed_path}` : null,
      dataset.report_path ? `Report: ${dataset.report_path}` : null,
      `Created: ${dataset.created_at}`
    ].filter(Boolean).join("\n")));
    return;
  }

  if (interaction.customId === dashboardButtonIds.runCampaign) {
    // Step 1: Show campaign picker — user picks campaign, then dataset picker appears
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }
    const pool = getDatabasePool();
    const res = await pool.query(`SELECT id, name FROM campaigns ORDER BY created_at DESC LIMIT 25`);
    if (!res.rows || res.rows.length === 0) {
      await interaction.editReply("No campaigns found. Create a campaign first.");
      return;
    }
    const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];
    const buttons = res.rows.map((r: any) => new ButtonBuilder().setCustomId(`dashboard:run-campaign-pick:${r.id}`).setLabel(String(r.name || r.id).slice(0, 80)).setStyle(ButtonStyle.Danger));
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(i, i + 5)));
    }
    await interaction.editReply({ content: "Select a campaign to run:", components: rows });
    return;
  }

  // Step 2 of Run Campaign: campaign selected → show dataset picker
  if (interaction.customId.startsWith("dashboard:run-campaign-pick:")) {
    await interaction.deferReply({ ephemeral: true });
    const campaignId = interaction.customId.slice("dashboard:run-campaign-pick:".length);
    if (!campaignId) {
      await interaction.editReply("campaign_id_required");
      return;
    }
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }
    const repo = new DatasetRepository();
    const datasets = await repo.listAllDatasets();
    if (datasets.length === 0) {
      await interaction.editReply("No datasets found. Ingest a file first.");
      return;
    }
    const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];
    const buttons = datasets.slice(0, 25).map((d) =>
      new ButtonBuilder()
        .setCustomId(`dashboard:run-campaign-dataset-pick:${campaignId}:${d.id}`)
        .setLabel((d.source_name ?? String(d.id)).slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    );
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(i, i + 5)));
    }
    await interaction.editReply({ content: "Select a dataset to send:", components: rows });
    return;
  }

  // Step 3 of Run Campaign: dataset selected → trigger send directly
  if (interaction.customId.startsWith("dashboard:run-campaign-dataset-pick:")) {
    await interaction.deferReply({ ephemeral: true });
    const remainder = interaction.customId.slice("dashboard:run-campaign-dataset-pick:".length);
    // remainder is campaignId:datasetId — datasetId is a UUID so split at first colon after the campaign UUID
    const uuidLen = 36;
    const campaignId = remainder.slice(0, uuidLen);
    const datasetId = remainder.slice(uuidLen + 1); // skip the separating ":" 
    if (!campaignId || !datasetId) {
      await interaction.editReply("campaign_id_and_dataset_id_required");
      return;
    }
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }
    const message = await queueCampaignSend(campaignId, datasetId);
    await interaction.editReply(message);
    return;
  }

  if (interaction.customId === dashboardButtonIds.addTestRecipient) {
    await interaction.showModal(createAddTestRecipientModal());
    return;
  }

  if (interaction.customId === dashboardButtonIds.sendTest) {
    await interaction.showModal(createSendTestModal());
    return;
  }

  if (interaction.customId === dashboardButtonIds.useTestRecipient) {
    if (!latestTestRecipientEmail) {
      await interaction.reply({ content: "No recent test recipient available. Add a test recipient first.", ephemeral: true });
      return;
    }
    await interaction.reply({ content: `Latest test recipient: ${latestTestRecipientEmail}` +
      "\nUse Add Test Recipient to queue another address, or Send Test Email to trigger a direct test ingest.",
      ephemeral: true
    });
    return;
  }

  if (interaction.customId === dashboardButtonIds.campaignUsage) {
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }

    const pool = getDatabasePool();
    const res = await pool.query(
      `SELECT c.id, c.name, c.status, COALESCE(SUM(j.total_count), 0) AS sent_count
       FROM campaigns c
       LEFT JOIN jobs j ON j.campaign_id = c.id AND j.type = 'sending' AND j.status = 'completed'
       GROUP BY c.id, c.name, c.status
       ORDER BY sent_count DESC NULLS LAST, c.created_at DESC LIMIT 20`
    );

    const rows = res.rows as Array<{ id: string; name: string; status: string; sent_count: number }>;
    if (rows.length === 0) {
      await interaction.editReply("No campaign usage records available yet.");
      return;
    }

    await interaction.editReply(truncate([
      "Campaign usage",
      ...rows.map((row) => `- ${row.id} ${row.name} [${row.status}] sent=${row.sent_count}`)
    ].join("\n")));
    return;
  }

  if (interaction.customId === dashboardButtonIds.smtpList || interaction.customId === dashboardButtonIds.smtpFailures || interaction.customId === dashboardButtonIds.smtpUsage) {
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }

    if (interaction.customId === dashboardButtonIds.smtpList) {
      const repo = new SmtpRepository();
      const list = await repo.listAllAccounts();
      await interaction.editReply(truncate(formatSmtpRows(list)));
      return;
    }

    if (interaction.customId === dashboardButtonIds.smtpFailures) {
      const pool = getDatabasePool();
      const res = await pool.query(
        `SELECT smtp_account_id, consecutive_failures, last_failure_at FROM smtp_failures ORDER BY last_failure_at DESC LIMIT 20`
      );
      await interaction.editReply(truncate(formatSmtpFailures(res.rows as Array<{ smtp_account_id: string; consecutive_failures: number; last_failure_at: string | null }>)));
      return;
    }

    const pool = getDatabasePool();
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

  if (interaction.customId === dashboardButtonIds.smtpDelete) {
    await interaction.showModal(createSmtpDeleteModal());
    return;
  }

  if (interaction.customId === dashboardButtonIds.smtpImport) {
    await interaction.showModal(createSmtpImportModal());
    return;
  }

  if (interaction.customId === dashboardButtonIds.campaignCreate) {
    await interaction.showModal(createCampaignModal());
    return;
  }

  if (interaction.customId === dashboardButtonIds.campaignUpdate) {
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }

    const pool = getDatabasePool();
    const res = await pool.query(`SELECT id, name FROM campaigns ORDER BY created_at DESC LIMIT 25`);
    if (!res.rows || res.rows.length === 0) {
      await interaction.editReply("No campaigns found.");
      return;
    }

    const options = res.rows.map((r: any) => ({
      label: String(r.name || r.id).slice(0, 100),
      value: r.id,
      description: String(r.name ? `ID: ${r.id}` : `Campaign ${r.id}`).slice(0, 100)
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(dashboardButtonIds.campaignUpdateSelect)
      .setPlaceholder("Choose a campaign to edit")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(...options);

    const rows = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)];
    await interaction.editReply({ content: "Select a campaign to update:", components: rows });
    return;
  }

  if (interaction.customId === dashboardButtonIds.campaignDelete) {
    // Step 1: show campaign picker — no manual ID input needed
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }
    const pool = getDatabasePool();
    const res = await pool.query(`SELECT id, name FROM campaigns ORDER BY created_at DESC LIMIT 25`);
    if (!res.rows || res.rows.length === 0) {
      await interaction.editReply("No campaigns found.");
      return;
    }
    const rows: Array<ActionRowBuilder<ButtonBuilder>> = [];
    const buttons = res.rows.map((r: any) =>
      new ButtonBuilder().setCustomId(`dashboard:campaign-delete-pick:${r.id}`).setLabel(String(r.name || r.id).slice(0, 80)).setStyle(ButtonStyle.Danger)
    );
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(i, i + 5)));
    }
    await interaction.editReply({ content: "Select a campaign to delete:", components: rows });
    return;
  }

  // Step 2 of Delete Campaign: campaign picked → show confirm modal with ID embedded in customId
  if (interaction.customId.startsWith("dashboard:campaign-delete-pick:")) {
    const campaignId = interaction.customId.slice("dashboard:campaign-delete-pick:".length);
    if (!campaignId) {
      await interaction.reply({ content: "campaign_id_required", ephemeral: true });
      return;
    }
    await interaction.showModal(createCampaignDeleteConfirmModal(campaignId));
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
    const pipeline = getLatestPipelineSummary();
    const latestFailedSendingJob = await getLatestFailedSendingJob();

    await interaction.editReply(truncate([
      `Automatic sending started for campaign ${result.campaignId}.`,
      `Dataset: ${result.datasetId}`,
      `Queued send jobs: ${result.queued}`,
      "",
      formatQueueSummary({
        ...queueStatus,
        latestFailedSendingJob,
        latestIngestionJob: pipeline.latestIngestionJob,
        latestSendingJob: pipeline.latestSendingJob,
        liveJobs: pipeline.liveJobs
      })
    ].join("\n")));
    return;
  }

  await interaction.reply({ content: "unhandled_button", ephemeral: true });
};

// Ensure unhandled interactions are logged for easier debugging
process.on("unhandledRejection", (reason) => {
  logger.warn("unhandled rejection in discord handlers", { reason: String(reason) });
});

const formatCommandJobStatus = (job: { id: string; type: string; status: string; payload?: Record<string, unknown>; createdAt: string; updatedAt: string; progress: { processed: number; total: number; failed: number } }): string => {
  return [
    formatJobStatusSummary(job),
    job.payload?.result && typeof job.payload.result === "object"
      ? (() => {
          const resultCounts = (job.payload.result as { counts?: { raw?: number; valid?: number; duplicate?: number; error?: number } }).counts;
          return resultCounts ? `Records: raw=${resultCounts.raw ?? 0}, valid=${resultCounts.valid ?? 0}, duplicate=${resultCounts.duplicate ?? 0}, error=${resultCounts.error ?? 0}` : null;
        })()
      : null,
    `Created: ${job.createdAt}`,
    `Updated: ${job.updatedAt}`
  ].filter(Boolean).join("\n");
};

export const handleModalSubmit = async (interaction: ModalSubmitInteraction): Promise<void> => {
  if (interaction.customId === ingestModalId) {
    await interaction.deferReply({ ephemeral: true });
    const sourcePath = interaction.fields.getTextInputValue("source_path").trim();
    const format = interaction.fields.getTextInputValue("format").trim().toLowerCase();
    const campaignId = interaction.fields.getTextInputValue("campaign_id").trim() || undefined;
    const message = await queueDashboardIngestion({ format, sourcePath, campaignId });
    await interaction.editReply(message);
    return;
  }

  if (interaction.customId === smtpImportModalId) {
    await interaction.deferReply({ ephemeral: true });
    const sourcePath = interaction.fields.getTextInputValue("source_path").trim();
    const emailAccountAddress = interaction.fields.getTextInputValue("email_account_address").trim() || undefined;
    const message = await queueDashboardSmtpImport({ sourcePath, defaultEmailAccountReference: emailAccountAddress });
    await interaction.editReply(message);
    return;
  }

  if (interaction.customId === campaignCreateModalId) {
    await interaction.deferReply({ ephemeral: true });
    const name = interaction.fields.getTextInputValue("name").trim();
    const subject = interaction.fields.getTextInputValue("subject").trim();
    const smtpAccountEmail = interaction.fields.getTextInputValue("smtp_account_email").trim() || null;
    const bodyHtml = interaction.fields.getTextInputValue("body_html").trim();

    if (!name || !subject || !bodyHtml) {
      await interaction.editReply("missing_required_campaign_fields");
      return;
    }

    const message = await saveCampaignFromModal({
      name,
      subject,
      bodyHtml,
      replyTo: null,
      status: null,
      smtpAccountEmail
    });
    await interaction.editReply(message);
    return;
  }

  if (interaction.customId.startsWith(campaignUpdateModalId)) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const campaignId = interaction.customId === campaignUpdateModalId
        ? interaction.fields.getTextInputValue("campaign_id").trim()
        : interaction.customId.slice(campaignUpdateModalId.length + 1);
      const updatesText = interaction.fields.getTextInputValue("updates").trim();
      const bodyHtmlUpdate = interaction.fields.getTextInputValue("body_html").trim();

      if (!campaignId) {
        await interaction.editReply("campaign_id_required");
        return;
      }
      if (!updatesText && !bodyHtmlUpdate) {
        await interaction.editReply("no_update_fields_provided");
        return;
      }

      const patch = parseCampaignUpdateText(updatesText);
      if (bodyHtmlUpdate) {
        patch.body_html = bodyHtmlUpdate;
      }

      const message = await updateCampaignFromPatch(campaignId, patch);
      await interaction.editReply(message);
      return;
    } catch (err: any) {
      logger.error("campaign update failed", { error: err?.message || String(err) });
      await interaction.editReply("update_failed_see_logs");
      return;
    }
  }

  if (interaction.customId === campaignDeleteModalId) {
    await interaction.deferReply({ ephemeral: true });
    const campaignId = interaction.fields.getTextInputValue("campaign_id").trim();
    const confirm = interaction.fields.getTextInputValue("confirm").trim();

    if (!campaignId) {
      await interaction.editReply("campaign_id_required");
      return;
    }
    if (confirm !== "DELETE") {
      await interaction.editReply("delete_confirmation_required");
      return;
    }
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }

    const result = await deleteCampaignById(campaignId);
    await interaction.editReply(result);
    return;
  }

  // New picker-flow delete confirm: campaign ID is embedded in the customId
  if (interaction.customId.startsWith("dashboard:campaign-delete-confirm-modal:")) {
    await interaction.deferReply({ ephemeral: true });
    const campaignId = interaction.customId.slice("dashboard:campaign-delete-confirm-modal:".length);
    const confirm = interaction.fields.getTextInputValue("confirm").trim();

    if (!campaignId) {
      await interaction.editReply("campaign_id_required");
      return;
    }
    if (confirm !== "DELETE") {
      await interaction.editReply("delete_confirmation_required");
      return;
    }
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }
    const result = await deleteCampaignById(campaignId);
    await interaction.editReply(result);
    return;
  }

  // New picker-flow run campaign: campaign ID embedded in customId, only dataset ID typed
  if (interaction.customId.startsWith("dashboard:run-campaign-dataset-modal:")) {
    await interaction.deferReply({ ephemeral: true });
    const campaignId = interaction.customId.slice("dashboard:run-campaign-dataset-modal:".length);
    const datasetId = interaction.fields.getTextInputValue("dataset_id").trim();

    if (!campaignId || !datasetId) {
      await interaction.editReply("campaign_id_and_dataset_id_required");
      return;
    }
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }
    const message = await queueCampaignSend(campaignId, datasetId);
    await interaction.editReply(message);
    return;
  }

  if (interaction.customId === "dashboard:dataset-select-modal") {
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }
    const datasetId = interaction.fields.getTextInputValue("dataset_id").trim();
    if (!datasetId) {
      await interaction.editReply("dataset_id_required");
      return;
    }

    const repo = new DatasetRepository();
    const dataset = await repo.getDatasetById(datasetId);
    if (!dataset) {
      await interaction.editReply("dataset_not_found");
      return;
    }

    await interaction.editReply(truncate([
      `Dataset: ${dataset.source_name ?? dataset.id}`,
      `ID: ${dataset.id}`,
      `Status: ${dataset.status}`,
      `Source: ${dataset.source_type} ${dataset.source_path}`,
      `Counts: raw=${dataset.raw_count ?? 0} valid=${dataset.valid_count ?? 0} duplicate=${dataset.duplicate_count ?? 0} error=${dataset.error_count ?? 0}`,
      dataset.processed_path ? `Processed path: ${dataset.processed_path}` : null,
      dataset.report_path ? `Report: ${dataset.report_path}` : null,
      `Created: ${dataset.created_at}`
    ].filter(Boolean).join("\n")));
    return;
  }

  if (interaction.customId === "dashboard:campaign-view-modal") {
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }
    const campaignId = interaction.fields.getTextInputValue("campaign_id").trim();
    if (!campaignId) {
      await interaction.editReply("campaign_id_required");
      return;
    }

    const campaign = await selectCampaignById(campaignId);
    if (!campaign) {
      await interaction.editReply("campaign_not_found");
      return;
    }

    await interaction.editReply(truncate([
      `Campaign: ${campaign.id}`,
      `Name: ${campaign.name}`,
      `Status: ${campaign.status}`,
      `Subject: ${campaign.subject}`,
      `SMTP: ${campaign.smtp_account_email ?? "none"}`,
      `Reply-to: ${campaign.reply_to ?? "none"}`,
      `Body html length: ${campaign.body_html.length}`
    ].join("\n")));
    return;
  }

  if (interaction.customId === "dashboard:run-campaign-modal") {
    await interaction.deferReply({ ephemeral: true });
    if (!config.databaseUrl) {
      await interaction.editReply("db_required");
      return;
    }

    const campaignId = interaction.fields.getTextInputValue("campaign_id").trim();
    const datasetId = interaction.fields.getTextInputValue("dataset_id").trim();
    if (!campaignId || !datasetId) {
      await interaction.editReply("campaign_id_and_dataset_id_required");
      return;
    }
    const message = await queueCampaignSend(campaignId, datasetId);
    await interaction.editReply(message);
    return;
  }

  if (interaction.customId === "dashboard:add-test-recipient-modal") {
    await interaction.deferReply({ ephemeral: true });
    const email = interaction.fields.getTextInputValue("email_address").trim();
    if (!email) {
      await interaction.editReply("email_address_required");
      return;
    }
    latestTestRecipientEmail = email;
    await interaction.editReply(`latest_test_recipient_set_to ${email}`);
    return;
  }

  if (interaction.customId === "dashboard:send-test-modal") {
    await interaction.deferReply({ ephemeral: true });
    const email = interaction.fields.getTextInputValue("email_address").trim() || latestTestRecipientEmail || "";
    const campaignId = interaction.fields.getTextInputValue("campaign_id").trim() || undefined;
    if (!email) {
      await interaction.editReply("test_recipient_email_required");
      return;
    }
    latestTestRecipientEmail = email;
    const message = await queueDashboardIngestion({ format: "auto", content: email, campaignId });
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

  if (
    interaction.customId === smtpCreateModalId ||
    interaction.customId === smtpUpdateModalId ||
    interaction.customId === smtpDeleteModalId
  ) {
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
      const portText = interaction.fields.getTextInputValue("port").trim();

      if (!emailAccountId || !host || !username || !password || !portText) {
        await interaction.editReply("missing_required_smtp_fields");
        return;
      }

      const port = Number.isFinite(Number(portText)) ? Number(portText) : null;
      if (port === null) {
        await interaction.editReply("invalid_port");
        return;
      }

      const useTls = port === 465 || port === 587;
      const createdId = await repo.createSmtpAccount({
        emailAccountId,
        host,
        port,
        username,
        passwordEncrypted: encrypt(password),
        useTls,
        maxPerWindow: 50,
        maxConcurrent: 1
      });
      await interaction.editReply(`created smtp account ${createdId}. Use SMTP List to verify it.`);
      return;
    }

    if (interaction.customId === smtpUpdateModalId) {
      const id = interaction.fields.getTextInputValue("id").trim();
      const updatesText = interaction.fields.getTextInputValue("updates").trim();

      if (!id) {
        await interaction.editReply("smtp_account_id_required_for_update");
        return;
      }

      const patch = parseSmtpUpdateText(updatesText);
      if (Object.keys(patch).length === 0) {
        await interaction.editReply("no_fields_to_update");
        return;
      }

      if (typeof patch.password === "string") {
        patch.passwordEncrypted = encrypt(patch.password);
        delete patch.password;
      }

      await repo.updateSmtpAccount(id, patch as any);

      const shouldValidate = ["host", "port", "username", "passwordEncrypted", "useTls", "status"].some((key) => key in patch);
      if (shouldValidate && patch.status !== "disabled") {
        const { validateAndUpdateAccountStatus } = await import("../smtp/validator.js");
        const validation = await validateAndUpdateAccountStatus(repo, id);
        await interaction.editReply(`updated smtp account ${id}. status=${validation.ok ? "active" : "failed"}${validation.error ? ` error=${validation.error}` : ""}`);
        return;
      }

      await interaction.editReply(`updated smtp account ${id}`);
      return;
    }

    if (interaction.customId === smtpDeleteModalId) {
      const id = interaction.fields.getTextInputValue("id").trim();
      const confirm = interaction.fields.getTextInputValue("confirm").trim();

      if (!id) {
        await interaction.editReply("smtp_account_id_required_for_delete");
        return;
      }

      if (confirm !== "DELETE") {
        await interaction.editReply("delete_confirmation_required");
        return;
      }

      await repo.deleteSmtpAccount(id);
      await interaction.editReply(`deleted smtp account ${id}`);
      return;
    }
  }

  await interaction.editReply("unhandled_modal");
};

export const handleChatInputCommand = async (commandInteraction: ChatInputCommandInteraction): Promise<void> => {
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
      await commandInteraction.editReply(truncate(formatCommandJobStatus(job)));
      return;
    }

    const pipeline = getLatestPipelineSummary();
    await commandInteraction.editReply(truncate([
      "Current pipeline",
      pipeline.latestIngestionJob ? formatIngestionJobSummary(pipeline.latestIngestionJob) : "No ingestion jobs yet.",
      "",
      pipeline.latestSendingJob
        ? [
            "Latest send",
            `Status: ${pipeline.latestSendingJob.status}`,
            typeof pipeline.latestSendingJob.payload?.campaignId === "string" ? `Campaign: ${pipeline.latestSendingJob.payload.campaignId}` : null,
            Array.isArray(pipeline.latestSendingJob.payload?.recipients) ? `Recipients: ${(pipeline.latestSendingJob.payload?.recipients as Array<unknown>).length}` : null,
            pipeline.latestSendingJob.error ? `Issue: ${pipeline.latestSendingJob.error}` : null
          ].filter(Boolean).join("\n")
        : "No send jobs yet.",
      "",
      "Recent activity:",
      ...(pipeline.liveJobs.length > 0 ? pipeline.liveJobs.slice(0, 5).map((job) => `- ${formatJobLine(job)}`) : ["- No jobs are currently waiting or running."])
    ].join("\n")));
    return;
  }

  if (commandName === "queue") {
    const status = await getQueueStatus();
    let latestFailedSendingJob = null;
    if (config.databaseUrl) {
      latestFailedSendingJob = await getLatestFailedSendingJob();
    }
    await commandInteraction.editReply(truncate(formatQueueSummary({ ...status, latestFailedSendingJob })));
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
    await commandInteraction.editReply(truncate(JSON.stringify({ jobs: jobsRes.rows, smtpUsage: usageRes.rows }, null, 2)));
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
    const useTls = options.getBoolean("use_tls") ?? port === 465;
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

  if (commandName === "smtp-import") {
    if (!config.databaseUrl) {
      await commandInteraction.editReply("db_required");
      return;
    }

    const content = options.getString("content") ?? "";
    const sourcePath = options.getString("source_path") ?? undefined;
    const attachment = options.getAttachment("file");
    const defaultEmailAccountId = options.getString("email_account_id");

    let fileContent = "";
    if (attachment?.url) {
      const response = await fetch(attachment.url);
      if (!response.ok) {
        await commandInteraction.editReply("failed_to_fetch_attachment");
        return;
      }
      fileContent = await response.text();
    }

    const importText = content.trim() || fileContent.trim();
    if (!importText && !sourcePath) {
      await commandInteraction.editReply("missing_content_or_source_path");
      return;
    }

    try {
      const { ingestParsedAccounts } = await import("../smtp/bulkIngest.js");
      const results = await ingestParsedAccounts({
        content: importText || undefined,
        sourcePath,
        defaultEmailAccountReference: defaultEmailAccountId ?? undefined
      });
      const success = results.filter((r: any) => r.id).length;
      const failed = results.filter((r: any) => r.error).length;
      await commandInteraction.editReply(`imported: ${success}, failed: ${failed}`);
    } catch (err) {
      await commandInteraction.editReply("import_failed");
    }
    return;
  }

  if (commandName === "smtp-update") {
    if (!config.databaseUrl) {
      await commandInteraction.editReply("db_required");
      return;
    }

    const id = options.getString("id", true);
    const patch: Record<string, unknown> = {};
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
    await repo.updateSmtpAccount(id, patch as any);
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
        `SELECT su.smtp_account_id, su.used_count, sa.username, sa.host FROM smtp_usage su JOIN smtp_accounts sa ON sa.id = su.smtp_account_id WHERE su.window_id = $1 ORDER BY su.used_count DESC`,
        [windowId]
      );
      await commandInteraction.editReply(truncate(formatSmtpUsage(res.rows as Array<{ smtp_account_id: string; used_count: number; username: string; host: string }>)));
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
    const replyTo = options.getString("reply_to") ?? null;
    const smtpAccountEmail = options.getString("smtp_account_email") ?? undefined;

    const message = await saveCampaignFromModal({
      name,
      subject,
      bodyHtml,
      replyTo,
      status: null,
      smtpAccountEmail
    });
    await commandInteraction.editReply(message);
    return;
  }

  if (commandName === "campaign-update") {
    if (!config.databaseUrl) {
      await commandInteraction.editReply("db_required");
      return;
    }

    const id = options.getString("id", true);
    const patch: Record<string, unknown> = {};
    const name = options.getString("name");
    const subject = options.getString("subject");
    const bodyHtml = options.getString("body_html");
    const bodyText = options.getString("body_text");
    const replyTo = options.getString("reply_to");
    const status = options.getString("status");
    const smtpAccountEmail = options.getString("smtp_account_email");

    if (name) patch.name = name;
    if (subject) patch.subject = subject;
    if (bodyHtml) patch.body_html = bodyHtml;
    if (bodyText) patch.body_text = bodyText;
    if (replyTo) patch.reply_to = replyTo;
    if (status) patch.status = status;
    if (smtpAccountEmail) patch.smtp_account_email = smtpAccountEmail;

    if (Object.keys(patch).length === 0) {
      await commandInteraction.editReply("no_fields_to_update");
      return;
    }

    const message = await updateCampaignFromPatch(id, patch);
    await commandInteraction.editReply(message);
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

  await commandInteraction.editReply("unhandled_command");
};

export const handleSelectMenu = async (interaction: StringSelectMenuInteraction): Promise<void> => {
  try {
    if (interaction.customId === dashboardButtonIds.campaignUpdateSelect) {
      const campaignId = interaction.values?.[0];
      if (!campaignId) {
        await interaction.reply({ content: "campaign_id_required", ephemeral: true });
        return;
      }

      const modal = createCampaignUpdateModal(campaignId);
      await interaction.showModal(modal);
      return;
    }

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("select_menu_not_implemented");
    } else {
      await interaction.reply({ content: "select_menu_not_implemented", ephemeral: true });
    }
  } catch (err: any) {
    logger.warn("handleSelectMenu failed", { error: String(err) });
  }
};
