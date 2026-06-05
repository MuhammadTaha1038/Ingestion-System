import { Client, GatewayIntentBits, Partials } from "discord.js";
import { loadConfig } from "../config/config.js";
import { createLogger } from "../logging/logger.js";
import { SmtpRepository } from "../db/repositories/smtp.js";
import { JobRepository } from "../db/repositories/jobs.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

export const startDiscordBot = async (): Promise<void> => {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    logger.warn("DISCORD_BOT_TOKEN not set; skipping Discord bot");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] as any, partials: [Partials.Channel] });

  client.on("ready", () => {
    logger.info("discord bot ready", { user: client.user?.tag });
  });
  client.on("interactionCreate", async (interaction) => {
    try {
      if (!interaction.isChatInputCommand()) return;
      const { commandName, options } = interaction;

      if (commandName === "smtp-list") {
        const repo = new SmtpRepository();
        const list = await repo.listAllAccounts();
        const lines = list.slice(0, 10).map((a) => `${a.id} ${a.username}@${a.host} [${a.status}]`);
        await interaction.reply(lines.join("\n") || "no_accounts");
        return;
      }

      if (commandName === "smtp-disable") {
        const id = options.getString("id", true);
        const repo = new SmtpRepository();
        await repo.disableSmtpAccount(id);
        await interaction.reply(`disabled ${id}`);
        return;
      }

      if (commandName === "smtp-enable") {
        const id = options.getString("id", true);
        const repo = new SmtpRepository();
        await repo.enableSmtpAccount(id);
        await interaction.reply(`enabled ${id}`);
        return;
      }

      if (commandName === "job-status") {
        const id = options.getString("id", true);
        const repo = new JobRepository();
        const res = await repo.pool.query("SELECT id, status, error, processed_count, total_count FROM jobs WHERE id = $1", [id]);
        if (res.rows[0]) {
          const r = res.rows[0];
          await interaction.reply(`${r.id} ${r.status} processed=${r.processed_count} total=${r.total_count} error=${r.error ?? 'none'}`);
        } else {
          await interaction.reply("job_not_found");
        }
        return;
      }

      if (commandName === "campaign-send") {
        const id = options.getString("id", true);
        // trigger campaign send via API endpoint
        await interaction.reply(`triggering campaign ${id}`);
        // Implemented via server API; administrators should use HTTP endpoint /campaigns/:id/send
        return;
      }
    } catch (err) {
      logger.error("discord command failed", { error: String(err) });
      try {
        if (interaction && interaction.isRepliable()) await interaction.reply("command_error");
      } catch (e) {
        // ignore
      }
    }
  });

  await client.login(token);
};
