import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, ModalBuilder, TextChannel, TextInputBuilder, TextInputStyle } from "discord.js";
import { createLogger } from "../logging/logger.js";
import { loadConfig } from "../config/config.js";
import { HierarchyRepository } from "../db/repositories/hierarchy.js";
import { getQueueStatus } from "../queue/status.js";
import { getDatabasePool } from "../db/pool.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

export const ingestModalId = "dashboard:ingest-modal";
export const campaignCreateModalId = "dashboard:campaign-create-modal";
export const campaignUpdateModalId = "dashboard:campaign-update-modal";
export const campaignDeleteModalId = "dashboard:campaign-delete-modal";
export const campaignSelectModalId = "dashboard:campaign-select-modal";
export const campaignViewModalId = "dashboard:campaign-view-modal";
export const datasetSelectModalId = "dashboard:dataset-select-modal";
export const addTestRecipientModalId = "dashboard:add-test-recipient-modal";
export const useTestRecipientModalId = "dashboard:use-test-recipient-modal";
export const runCampaignModalId = "dashboard:run-campaign-modal";
export const smtpCreateModalId = "dashboard:smtp-create-modal";
export const smtpUpdateModalId = "dashboard:smtp-update-modal";
export const smtpDeleteModalId = "dashboard:smtp-delete-modal";
export const smtpImportModalId = "dashboard:smtp-import-modal";
export const cpanelCreateModalId = "dashboard:cpanel-create-modal";
export const subdomainCreateModalId = "dashboard:subdomain-create-modal";
export const emailCreateModalId = "dashboard:email-create-modal";

export const dashboardButtonIds = {
  ingest: "dashboard:ingest",
  ingestAttachment: "dashboard:ingest-attachment",
  ingestNewList: "dashboard:ingest-new-list",
  queue: "dashboard:queue",
  logs: "dashboard:logs",
  logsStatus: "dashboard:logs-status",
  status: "dashboard:status",
  campaigns: "dashboard:campaigns",
  campaignList: "dashboard:campaign-list",
  campaignSelect: "dashboard:campaign-select",
  campaignView: "dashboard:campaign-view",
  campaignUpdate: "dashboard:campaign-update",
  campaignUpdateSelect: "dashboard:campaign-update-select",
  campaignCreate: "dashboard:campaign-create",
  campaignDelete: "dashboard:campaign-delete",
  datasetList: "dashboard:dataset-list",
  datasetSelect: "dashboard:dataset-select",
  addTestRecipient: "dashboard:add-test-recipient",
  useTestRecipient: "dashboard:use-test-recipient",
  sendTest: "dashboard:send-test",
  runCampaign: "dashboard:run-campaign",
  send: "dashboard:send",
  smtpList: "dashboard:smtp-list",
  smtpFailures: "dashboard:smtp-failures",
  smtpUsage: "dashboard:smtp-usage",
  smtpCreate: "dashboard:smtp-create",
  smtpUpdate: "dashboard:smtp-update",
  smtpDelete: "dashboard:smtp-delete",
  smtpDeletePick: "dashboard:smtp-delete-pick",
  smtpImport: "dashboard:smtp-import",
  smtpImportAttachment: "dashboard:smtp-import-attachment",
  smtpAccountsStatus: "dashboard:smtp-accounts-status",
  storage: "dashboard:storage",
  pause: "dashboard:pause",
  resume: "dashboard:resume",
  accounts: "dashboard:accounts",
  health: "dashboard:health",
  window: "dashboard:window",
  cpanelList: "dashboard:cpanel-list",
  cpanelCreate: "dashboard:cpanel-create",
  subdomainList: "dashboard:subdomain-list",
  subdomainCreate: "dashboard:subdomain-create",
  emailList: "dashboard:email-list",
  emailCreate: "dashboard:email-create",
  campaignUsage: "dashboard:campaign-usage",
  campaignDeletePick: "dashboard:campaign-delete-pick",
  runCampaignPick: "dashboard:run-campaign-pick"
} as const;

export const getDashboardChannelId = (): string | undefined => {
  return process.env.DISCORD_DASHBOARD_CHANNEL_ID ?? process.env.DISCORD_STATUS_CHANNEL_ID;
};

export const postDashboardPanel = async (client: Client): Promise<void> => {
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

    const queue = await getQueueStatus();
    let emailsSent = queue.sending.completed;
    let emailsRemaining = queue.sending.waiting + queue.sending.active + queue.sending.delayed;
    
    let datasetName = "None";
    let campaignName = "None";

    try {
      const pool = getDatabasePool();
      const latestJobRes = await pool.query(
        `SELECT j.campaign_id, c.name as campaign_name, d.source_name as dataset_name
         FROM jobs j
         LEFT JOIN campaigns c ON j.campaign_id = c.id
         LEFT JOIN datasets d ON j.dataset_id = d.id
         WHERE j.type = 'sending' AND j.campaign_id IS NOT NULL 
         ORDER BY j.created_at DESC LIMIT 1`
      );
      
      if (latestJobRes.rows.length > 0) {
        const latestRow = latestJobRes.rows[0];
        campaignName = latestRow.campaign_name || latestRow.campaign_id || "Unknown";
        datasetName = latestRow.dataset_name || "Manual test / Multi-dataset";

        if (emailsSent === 0 && emailsRemaining === 0) {
          const statsRes = await pool.query(
            `SELECT COALESCE(SUM(total_count), 0)::int AS total, COALESCE(SUM(processed_count), 0)::int AS processed 
             FROM jobs WHERE type = 'sending' AND campaign_id = $1`,
            [latestRow.campaign_id]
          );
          if (statsRes.rows.length > 0) {
            const row = statsRes.rows[0];
            emailsSent = row.processed;
            emailsRemaining = Math.max(0, row.total - row.processed);
          }
        }
      }
    } catch (err) {
      logger.error("Failed to fetch persistent campaign stats", { error: String(err) });
    }

    const content = [
      "**Discord operations dashboard**",
      "Use these buttons for the primary operational interface.",
      "Ingestion, queue, status, logs, accounts, campaigns, cPanel, subdomains, emails, storage, pause, and resume are exposed here.",
      "",
      "📊 **Live Campaign Progress**",
      `* **Campaign:** ${campaignName}`,
      `* **Dataset:** ${datasetName}`,
      `* **Emails sent:** ${emailsSent}`,
      `* **Emails remaining:** ${emailsRemaining}`
    ].join("\n");

    const components = createDashboardComponents();

    try {
      // Try to find an existing dashboard message posted by this bot so we can update it
      const fetched = await channel.messages.fetch({ limit: 100 });
      const existing = fetched.find((m) => m.author?.id === client.user?.id && (
        (typeof m.content === "string" && m.content.includes("Discord operations dashboard")) ||
        (Array.isArray(m.components) && m.components.length > 0)
      ));

      if (existing) {
        await existing.edit({ content, components });
        logger.info("discord dashboard panel updated", { channelId: channel.id, messageId: existing.id });
      } else {
        const sent = await channel.send({ content, components });
        logger.info("discord dashboard panel posted", { channelId: channel.id, messageId: sent.id });
      }
    } catch (err: any) {
      // Fallback to sending a new message if fetch/edit fails for permissions or other reasons
      try {
        const sent = await channel.send({ content, components });
        logger.info("discord dashboard panel posted (fallback)", { channelId: channel.id, messageId: sent.id, error: String(err) });
      } catch (err2: any) {
        logger.warn("failed to post or update discord dashboard panel", { error: String(err2) });
      }
    }
  } catch (error) {
    logger.warn("failed to post discord dashboard panel", { error: String(error) });
  }
};

export const createDashboardComponents = () => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.ingest).setLabel("Ingest Data").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.ingestAttachment).setLabel("Upload Dataset File").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(dashboardButtonIds.datasetSelect).setLabel("Select Dataset").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.status).setLabel("Status").setStyle(ButtonStyle.Secondary)
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignList).setLabel("View Campaigns").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignSelect).setLabel("Select Campaign").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignView).setLabel("View Campaign").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignCreate).setLabel("Create Campaign").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignDelete).setLabel("Delete Campaign").setStyle(ButtonStyle.Danger)
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignUpdate).setLabel("Edit Campaign").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.runCampaign).setLabel("Run Campaign").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(dashboardButtonIds.send).setLabel("Start Sending").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(dashboardButtonIds.sendTest).setLabel("Send Test Email").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.addTestRecipient).setLabel("Add Test Recipient").setStyle(ButtonStyle.Secondary)
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.useTestRecipient).setLabel("Use Test Recipient").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.smtpList).setLabel("SMTP List").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.smtpCreate).setLabel("SMTP Create").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.smtpDelete).setLabel("SMTP Delete").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(dashboardButtonIds.smtpImportAttachment).setLabel("Upload SMTP File").setStyle(ButtonStyle.Success)
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.queue).setLabel("Queue").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.window).setLabel("Window").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.logs).setLabel("Logs").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.health).setLabel("Health").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignUsage).setLabel("Campaign Usage").setStyle(ButtonStyle.Secondary)
  )
];

export const createIngestModal = () => {
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
    .setCustomId("dashboard:ingest-modal")
    .setTitle("Ingest Data")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(sourcePath),
      new ActionRowBuilder<TextInputBuilder>().addComponents(format),
      new ActionRowBuilder<TextInputBuilder>().addComponents(campaignId)
    );
};

export const createDatasetSelectModal = () => {
  const datasetId = new TextInputBuilder()
    .setCustomId("dataset_id")
    .setLabel("Dataset ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Enter dataset id to view details");

  return new ModalBuilder()
    .setCustomId("dashboard:dataset-select-modal")
    .setTitle("Select Dataset")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(datasetId)
    );
};

export const createCampaignDetailsModal = () => {
  const campaignId = new TextInputBuilder()
    .setCustomId("campaign_id")
    .setLabel("Campaign ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Enter campaign id to view details");

  return new ModalBuilder()
    .setCustomId("dashboard:campaign-view-modal")
    .setTitle("View Campaign")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(campaignId)
    );
};

export const createRunCampaignModal = () => {
  const campaignId = new TextInputBuilder()
    .setCustomId("campaign_id")
    .setLabel("Campaign ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Campaign id to run");

  const datasetId = new TextInputBuilder()
    .setCustomId("dataset_id")
    .setLabel("Dataset ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Dataset id to use");

  return new ModalBuilder()
    .setCustomId("dashboard:run-campaign-modal")
    .setTitle("Run Campaign")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(campaignId),
      new ActionRowBuilder<TextInputBuilder>().addComponents(datasetId)
    );
};

export const createAddTestRecipientModal = () => {
  const email = new TextInputBuilder()
    .setCustomId("email_address")
    .setLabel("Test recipient email")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("user@example.com");

  return new ModalBuilder()
    .setCustomId("dashboard:add-test-recipient-modal")
    .setTitle("Add Test Recipient")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(email)
    );
};

export const createSendTestModal = () => {
  const email = new TextInputBuilder()
    .setCustomId("email_address")
    .setLabel("Test email recipient")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Leave empty to use latest test recipient");

  return new ModalBuilder()
    .setCustomId("dashboard:send-test-modal")
    .setTitle("Send Test Email")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(email)
    );
};

export const createSmtpImportModal = () => {
  const sourcePath = new TextInputBuilder()
    .setCustomId("source_path")
    .setLabel("Source URL / S3 path / file:// path")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const emailAccountAddress = new TextInputBuilder()
    .setCustomId("email_account_address")
    .setLabel("Email account address (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("user@example.com");

  return new ModalBuilder()
    .setCustomId("dashboard:smtp-import-modal")
    .setTitle("SMTP Import")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(sourcePath),
      new ActionRowBuilder<TextInputBuilder>().addComponents(emailAccountAddress)
    );
};

export const createCampaignModal = () => {
  const name = new TextInputBuilder()
    .setCustomId("name")
    .setLabel("Campaign name")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Descriptive campaign name");

  const subject = new TextInputBuilder()
    .setCustomId("subject")
    .setLabel("Subject")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Email subject line");

  const bodyHtml = new TextInputBuilder()
    .setCustomId("body_html")
    .setLabel("HTML body")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder("Email body HTML");

  const smtpAccountEmail = new TextInputBuilder()
    .setCustomId("smtp_account_email")
    .setLabel("SMTP account email (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("user@example.com");

  return new ModalBuilder()
    .setCustomId("dashboard:campaign-create-modal")
    .setTitle("Create Campaign")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(name),
      new ActionRowBuilder<TextInputBuilder>().addComponents(subject),
      new ActionRowBuilder<TextInputBuilder>().addComponents(bodyHtml),
      new ActionRowBuilder<TextInputBuilder>().addComponents(smtpAccountEmail)
    );
};

export const createCampaignUpdateModal = (campaignId?: string) => {
  const updates = new TextInputBuilder()
    .setCustomId("updates")
    .setLabel("Fields to update (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder("name=New Campaign subject=New Subject status=active");

  const bodyHtml = new TextInputBuilder()
    .setCustomId("body_html")
    .setLabel("HTML body update (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder("Optional HTML body update");

  const modal = new ModalBuilder()
    .setCustomId(campaignId ? `${campaignUpdateModalId}:${campaignId}` : campaignUpdateModalId)
    .setTitle("Update Campaign")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(updates),
      new ActionRowBuilder<TextInputBuilder>().addComponents(bodyHtml)
    );

  return modal;
};

export const createCampaignDeleteModal = () => {
  const campaignId = new TextInputBuilder()
    .setCustomId("campaign_id")
    .setLabel("Campaign ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Campaign id to delete");

  const confirm = new TextInputBuilder()
    .setCustomId("confirm")
    .setLabel("Type DELETE to confirm")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId("dashboard:campaign-delete-modal")
    .setTitle("Delete Campaign")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(campaignId),
      new ActionRowBuilder<TextInputBuilder>().addComponents(confirm)
    );
};

export const createCampaignDeleteConfirmModal = (campaignId: string) => {
  const confirm = new TextInputBuilder()
    .setCustomId("confirm")
    .setLabel("Type DELETE to confirm deletion")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`dashboard:campaign-delete-confirm-modal:${campaignId}`)
    .setTitle("Confirm Campaign Delete")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(confirm)
    );
};

export const createRunCampaignDatasetModal = (campaignId: string) => {
  const datasetId = new TextInputBuilder()
    .setCustomId("dataset_id")
    .setLabel("Dataset ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Dataset id to use for this campaign");

  return new ModalBuilder()
    .setCustomId(`dashboard:run-campaign-dataset-modal:${campaignId}`)
    .setTitle("Select Dataset")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(datasetId)
    );
};

export const createSmtpModal = (mode: "create" | "update") => {
  if (mode === "create") {
    const emailAccountId = new TextInputBuilder()
      .setCustomId("email_account_id")
      .setLabel("Email account id")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const host = new TextInputBuilder()
      .setCustomId("host")
      .setLabel("SMTP host")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const username = new TextInputBuilder()
      .setCustomId("username")
      .setLabel("SMTP username")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const password = new TextInputBuilder()
      .setCustomId("password")
      .setLabel("SMTP password or app password")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const useTls = new TextInputBuilder()
      .setCustomId("use_tls")
      .setLabel("Use TLS (optional)")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setPlaceholder("true or false")
      .setValue("true");

    const port = new TextInputBuilder()
      .setCustomId("port")
      .setLabel("Port")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setPlaceholder("587 or 465");

    return new ModalBuilder()
      .setCustomId("dashboard:smtp-create-modal")
      .setTitle("Create SMTP Account")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(emailAccountId),
        new ActionRowBuilder<TextInputBuilder>().addComponents(host),
        new ActionRowBuilder<TextInputBuilder>().addComponents(username),
        new ActionRowBuilder<TextInputBuilder>().addComponents(password),
        new ActionRowBuilder<TextInputBuilder>().addComponents(useTls),
        new ActionRowBuilder<TextInputBuilder>().addComponents(port)
      );
  }

  const id = new TextInputBuilder()
    .setCustomId("id")
    .setLabel("SMTP account id")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const updates = new TextInputBuilder()
    .setCustomId("updates")
    .setLabel("Fields to update")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder("host=smtp.example.com port=587 use_tls=true status=active max_per_window=50");

  return new ModalBuilder()
    .setCustomId("dashboard:smtp-update-modal")
    .setTitle("Update SMTP Account")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(id),
      new ActionRowBuilder<TextInputBuilder>().addComponents(updates)
    );
};

export const createSmtpDeleteModal = () => {
  const smtpId = new TextInputBuilder()
    .setCustomId("id")
    .setLabel("SMTP account id")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const confirm = new TextInputBuilder()
    .setCustomId("confirm")
    .setLabel("Type DELETE to confirm")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId("dashboard:smtp-delete-modal")
    .setTitle("Delete SMTP Account")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(smtpId),
      new ActionRowBuilder<TextInputBuilder>().addComponents(confirm)
    );
};

export const createSmtpDeleteConfirmModal = (smtpAccountId: string) => {
  const confirm = new TextInputBuilder()
    .setCustomId("confirm")
    .setLabel("Type DELETE to confirm deletion")
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`dashboard:smtp-delete-confirm-modal:${smtpAccountId}`)
    .setTitle("Confirm SMTP Delete")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(confirm));
};

export const parseSmtpUpdateText = (text: string) => {
  const patch: Record<string, unknown> = {};
  const pairs = text.split(/\s+/).filter(Boolean);
  for (const pair of pairs) {
    const [key, rawValue] = pair.split("=");
    if (!key || rawValue === undefined) continue;

    const value = rawValue.trim();
    switch (key.trim().toLowerCase()) {
      case "host":
        patch.host = value;
        break;
      case "username":
        patch.username = value;
        break;
      case "password":
        patch.password = value;
        break;
      case "port": {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) patch.port = parsed;
        break;
      }
      case "use_tls":
      case "usetls":
      case "tls":
        patch.useTls = ["true", "1", "yes", "y"].includes(value.toLowerCase());
        break;
      case "status":
        patch.status = value.toLowerCase();
        break;
      case "max_per_window":
      case "maxperwindow":
      case "max_perwindow": {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) patch.maxPerWindow = parsed;
        break;
      }
      case "max_concurrent":
      case "maxconcurrent": {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) patch.maxConcurrent = parsed;
        break;
      }
    }
  }

  return patch;
};

export const createHierarchyRecord = async (mode: "cpanel" | "subdomain" | "email", values: Record<string, string>): Promise<string> => {
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

export const createHierarchyModal = (mode: "cpanel" | "subdomain" | "email") => {
  if (mode === "cpanel") {
    return new ModalBuilder()
      .setCustomId("dashboard:cpanel-create-modal")
      .setTitle("Create cPanel Account")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId("name").setLabel("cPanel account name").setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
  }

  if (mode === "subdomain") {
    return new ModalBuilder()
      .setCustomId("dashboard:subdomain-create-modal")
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
    .setCustomId("dashboard:email-create-modal")
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
