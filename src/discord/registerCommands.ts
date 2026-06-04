import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { loadConfig } from "../config/config.js";
import { createLogger } from "../logging/logger.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

export const registerCommands = async (): Promise<void> => {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!token || !clientId || !guildId) {
    logger.warn("discord register: missing env vars, skipping registration");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(token);

  const commands = [
    { name: "smtp-list", description: "List SMTP accounts" },
    { name: "smtp-disable", description: "Disable SMTP account", options: [{ name: "id", type: 3, description: "account id", required: true }] },
    { name: "smtp-enable", description: "Enable SMTP account", options: [{ name: "id", type: 3, description: "account id", required: true }] },
    { name: "job-status", description: "Get job status", options: [{ name: "id", type: 3, description: "job id", required: true }] },
    { name: "campaign-send", description: "Trigger campaign sending", options: [{ name: "id", type: 3, description: "campaign id", required: true }] }
  ];

  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    logger.info("registered discord guild commands", { guildId });
  } catch (err) {
    logger.error("failed to register discord commands", { error: String(err) });
  }
};
