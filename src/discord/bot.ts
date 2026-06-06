import { ChatInputCommandInteraction, Client, GatewayIntentBits, Partials } from "discord.js";
import { loadConfig } from "../config/config.js";
import { createLogger } from "../logging/logger.js";
import { SmtpRepository } from "../db/repositories/smtp.js";
import { JobRepository } from "../db/repositories/jobs.js";
import { DatasetRepository } from "../db/repositories/datasets.js";
import { jobStore } from "../jobs/store.js";
import { ingestionQueue, sendingQueue } from "../queue/queues.js";
import { getQueueStatus, pauseQueues, resumeQueues } from "../queue/status.js";
import { getRecentLogs } from "../logging/logger.js";
import { getDatabasePool } from "../db/pool.js";
import { InputFormat } from "../ingestion/types.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

const allowedFormats = new Set(["csv", "json", "txt", "raw", "bulk"]);

const truncate = (value: string, max = 1800): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const formatCampaignRows = (rows: Array<{ id: string; name: string; subject: string; status: string }>): string => {
  if (rows.length === 0) return "no_campaigns";
  return rows.slice(0, 10).map((row) => `${row.id} ${row.name} [${row.status}] ${row.subject}`).join("\n");
};

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
    let commandInteraction: ChatInputCommandInteraction | null = null;
    try {
      if (!interaction.isChatInputCommand()) return;
      commandInteraction = interaction as ChatInputCommandInteraction;
      const { commandName, options } = commandInteraction;
      await commandInteraction.deferReply();

      if (commandName === "ingest") {
        const format = options.getString("format", true);
        const content = options.getString("content", true);
        const sourcePath = options.getString("source_path") ?? undefined;
        const campaignId = options.getString("campaign_id") ?? undefined;

        if (!allowedFormats.has(format)) {
          await commandInteraction.editReply("invalid_format");
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

          await commandInteraction.editReply(truncate(JSON.stringify(job, null, 2)));
          return;
        }

        await commandInteraction.editReply(truncate(JSON.stringify(jobStore.getSummary(), null, 2)));
        return;
      }

      if (commandName === "queue") {
        const status = await getQueueStatus();
        await commandInteraction.editReply(truncate(JSON.stringify(status, null, 2)));
        return;
      }

      if (commandName === "logs") {
        const limit = options.getInteger("limit") ?? 100;
        await commandInteraction.editReply(truncate(JSON.stringify({ logs: getRecentLogs(limit) }, null, 2)));
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

      if (commandName === "smtp-list") {
        const repo = new SmtpRepository();
        const list = await repo.listAllAccounts();
        const lines = list.slice(0, 10).map((a) => `${a.id} ${a.username}@${a.host} [${a.status}]`);
        await commandInteraction.editReply(lines.join("\n") || "no_accounts");
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

        const pool = getDatabasePool();
        const res = await pool.query(
          `INSERT INTO campaigns (name, subject, body_html, from_address) VALUES ($1,$2,$3,$4) RETURNING id`,
          [name, subject, bodyHtml, fromAddress]
        );

        await commandInteraction.editReply(`created campaign ${res.rows[0].id}`);
        return;
      }

      if (commandName === "campaign-send") {
        const id = options.getString("id", true);
        if (!config.databaseUrl) {
          await commandInteraction.editReply("db_required");
          return;
        }

        const pool = getDatabasePool();
        const res = await pool.query(`SELECT r.email_normalized FROM recipients r`);
        const emails = res.rows.map((r: { email_normalized: string }) => r.email_normalized);
        const batchSize = 50;

        for (let i = 0; i < emails.length; i += batchSize) {
          const batch = emails.slice(i, i + batchSize).map((email: string) => ({ to: email, subject: "Campaign", html: "<p>Campaign body</p>" }));
          await sendingQueue.add("send", { campaignId: id, windowId: "", recipients: batch }, { removeOnComplete: true });
        }

        await commandInteraction.editReply(`triggered campaign ${id}, queued ${Math.ceil(emails.length / batchSize)} send jobs`);
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
