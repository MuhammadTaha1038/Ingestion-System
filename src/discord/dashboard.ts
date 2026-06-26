import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, ModalBuilder, TextChannel, TextInputBuilder, TextInputStyle } from "discord.js";
import { createLogger } from "../logging/logger.js";
import { loadConfig } from "../config/config.js";
import { HierarchyRepository } from "../db/repositories/hierarchy.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

export const ingestModalId = "dashboard:ingest-modal";
export const campaignCreateModalId = "dashboard:campaign-create-modal";
export const campaignUpdateModalId = "dashboard:campaign-update-modal";
export const campaignDeleteModalId = "dashboard:campaign-delete-modal";
export const smtpCreateModalId = "dashboard:smtp-create-modal";
export const smtpUpdateModalId = "dashboard:smtp-update-modal";
export const smtpDeleteModalId = "dashboard:smtp-delete-modal";
export const smtpImportModalId = "dashboard:smtp-import-modal";
export const cpanelCreateModalId = "dashboard:cpanel-create-modal";
export const subdomainCreateModalId = "dashboard:subdomain-create-modal";
export const emailCreateModalId = "dashboard:email-create-modal";

export const dashboardButtonIds = {
  ingest: "dashboard:ingest",
  queue: "dashboard:queue",
  send: "dashboard:send",
  logs: "dashboard:logs",
  smtpList: "dashboard:smtp-list",
  smtpCreate: "dashboard:smtp-create",
  smtpUpdate: "dashboard:smtp-update",
  smtpDelete: "dashboard:smtp-delete",
  smtpImport: "dashboard:smtp-import",
  smtpFailures: "dashboard:smtp-failures",
  smtpUsage: "dashboard:smtp-usage",
  accounts: "dashboard:accounts",
  health: "dashboard:health",
  status: "dashboard:status",
  window: "dashboard:window",
  campaigns: "dashboard:campaigns",
  campaignCreate: "dashboard:campaign-create",
  campaignUpdate: "dashboard:campaign-update",
  campaignDelete: "dashboard:campaign-delete",
  campaignUsage: "dashboard:campaign-usage",
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

export const createDashboardComponents = () => [
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
    new ButtonBuilder().setCustomId(dashboardButtonIds.smtpDelete).setLabel("SMTP Delete").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(dashboardButtonIds.smtpImport).setLabel("SMTP Import").setStyle(ButtonStyle.Success)
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.cpanelList).setLabel("cPanel List").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.cpanelCreate).setLabel("cPanel Create").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.subdomainList).setLabel("Subdomain List").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.subdomainCreate).setLabel("Subdomain Create").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignUpdate).setLabel("Campaign Update").setStyle(ButtonStyle.Secondary)
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.emailCreate).setLabel("Email Create").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.health).setLabel("Health").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.window).setLabel("Window").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.logs).setLabel("Logs").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignUsage).setLabel("Campaign Usage").setStyle(ButtonStyle.Secondary)
  ),
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(dashboardButtonIds.pause).setLabel("Pause").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(dashboardButtonIds.resume).setLabel("Resume").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(dashboardButtonIds.accounts).setLabel("Accounts").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignCreate).setLabel("Campaign Create").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(dashboardButtonIds.campaignDelete).setLabel("Campaign Delete").setStyle(ButtonStyle.Danger)
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

export const createCampaignUpdateModal = () => {
  const campaignId = new TextInputBuilder()
    .setCustomId("campaign_id")
    .setLabel("Campaign ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("Enter campaign ID");

  const updates = new TextInputBuilder()
    .setCustomId("updates")
    .setLabel("Fields to update")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder("name=New Campaign subject=New Subject status=active");

  const bodyHtml = new TextInputBuilder()
    .setCustomId("body_html")
    .setLabel("HTML body update (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder("Optional HTML body update");

  return new ModalBuilder()
    .setCustomId("dashboard:campaign-update-modal")
    .setTitle("Update Campaign")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(campaignId),
      new ActionRowBuilder<TextInputBuilder>().addComponents(updates),
      new ActionRowBuilder<TextInputBuilder>().addComponents(bodyHtml)
    );
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
