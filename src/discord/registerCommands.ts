import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { loadConfig } from "../config/config.js";
import { createLogger } from "../logging/logger.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

export const registerCommands = async (): Promise<void> => {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_APP_ID;
  const guildId = process.env.DISCORD_SERVER_ID;
  if (!token || !clientId || !guildId) {
    logger.warn("discord register: missing env vars, skipping registration");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(token);

  const commands = [
    { name: "ingest", description: "Trigger ingestion", options: [
      { name: "format", type: 3, description: "csv, json, txt, raw, bulk", required: true },
      { name: "content", type: 3, description: "dataset content", required: false },
      { name: "source_path", type: 3, description: "optional source path", required: false },
      { name: "file", type: 11, description: "optional attachment URL source", required: false },
      { name: "campaign_id", type: 3, description: "optional campaign id", required: false }
    ] },
    { name: "health", description: "Show service health" },
    { name: "status", description: "Get job summary or job status", options: [
      { name: "job_id", type: 3, description: "optional job id", required: false }
    ] },
    { name: "queue", description: "Show queue status" },
    { name: "metrics", description: "Show aggregated job and SMTP usage metrics" },
    { name: "logs", description: "Show recent logs", options: [
      { name: "limit", type: 4, description: "number of log lines", required: false }
    ] },
    { name: "pause", description: "Pause ingestion and sending queues" },
    { name: "resume", description: "Resume ingestion and sending queues" },
    { name: "smtp-status", description: "Show active SMTP accounts" },
    { name: "accounts-status", description: "Show account status" },
    { name: "smtp-list", description: "List SMTP accounts" },
    { name: "smtp-usage", description: "Show SMTP usage windows or usage by window", options: [
      { name: "window_id", type: 3, description: "optional sending window id", required: false }
    ] },
    { name: "smtp-failures", description: "Show recent SMTP failures (alerts)" },
    { name: "smtp-disable", description: "Disable SMTP account", options: [{ name: "id", type: 3, description: "account id", required: true }] },
    { name: "smtp-enable", description: "Enable SMTP account", options: [{ name: "id", type: 3, description: "account id", required: true }] },
    { name: "job-status", description: "Get job status", options: [{ name: "id", type: 3, description: "job id", required: true }] },
    { name: "campaign-list", description: "List campaigns" },
    { name: "campaign-create", description: "Create campaign", options: [
      { name: "name", type: 3, description: "campaign name", required: true },
      { name: "subject", type: 3, description: "email subject", required: true },
      { name: "body_html", type: 3, description: "HTML body", required: true },
      { name: "from_address", type: 3, description: "from address", required: true }
    ] },
    { name: "campaign-update", description: "Update campaign", options: [
      { name: "id", type: 3, description: "campaign id", required: true },
      { name: "name", type: 3, description: "campaign name", required: false },
      { name: "subject", type: 3, description: "email subject", required: false },
      { name: "body_html", type: 3, description: "HTML body", required: false },
      { name: "body_text", type: 3, description: "plain text body", required: false },
      { name: "from_address", type: 3, description: "from address", required: false },
      { name: "reply_to", type: 3, description: "reply-to address", required: false },
      { name: "status", type: 3, description: "draft, active, paused, archived", required: false }
    ] },
    { name: "campaign-send", description: "Trigger campaign sending", options: [{ name: "id", type: 3, description: "campaign id", required: true }] }
  ];

  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    logger.info("registered discord guild commands", { guildId });
  } catch (err) {
    logger.error("failed to register discord commands", { error: String(err) });
  }
};
