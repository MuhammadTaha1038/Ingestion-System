import { Worker, Job } from "bullmq";
import { getRedisConnection } from "./redis.js";
import { QUEUE_NAMES, SmtpScanJobPayload } from "./types.js";
import { createLogger } from "../logging/logger.js";
import { loadConfig } from "../config/config.js";
import { SmtpRepository } from "../db/repositories/smtp.js";
import { validateAndUpdateAccountStatus } from "../smtp/validator.js";
import { getDiscordClient } from "../discord/bot.js";
import { TextChannel } from "discord.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

export const createSmtpScanWorker = () => {
  return new Worker<SmtpScanJobPayload>(
    QUEUE_NAMES.smtp_scan,
    async (job: Job<SmtpScanJobPayload>) => {
      logger.info("smtpScanWorker: started scan job", { jobId: job.id });
      const repo = new SmtpRepository();

      try {
        const res = await repo.pool.query(
          `SELECT id, username, host FROM smtp_accounts WHERE status IN ('disabled', 'pending')`
        );
        const accountsToScan = res.rows;

        if (accountsToScan.length === 0) {
          await sendDiscordReport(job.data.channelId, "✅ **SMTP Scan Complete!**\nNo disabled or pending accounts found to scan.");
          return;
        }

        let activated = 0;
        let failed = 0;
        const failedDetails: string[] = [];

        // Concurrency of 10
        const concurrency = 10;
        for (let i = 0; i < accountsToScan.length; i += concurrency) {
          const chunk = accountsToScan.slice(i, i + concurrency);
          
          await Promise.all(
            chunk.map(async (acc) => {
              try {
                const result = await validateAndUpdateAccountStatus(repo, acc.id);
                if (result.ok) {
                  activated++;
                } else {
                  failed++;
                  failedDetails.push(`${acc.username}@${acc.host}: ${result.error}`);
                }
              } catch (err: any) {
                failed++;
                failedDetails.push(`${acc.username}@${acc.host}: ${err.message}`);
              }
            })
          );
        }

        let report = `✅ **SMTP Scan Complete!**\n`;
        report += `- **${activated}** accounts successfully connected and were automatically **Activated**.\n`;
        report += `- **${failed}** accounts failed and remain **Disabled**.\n`;

        if (failedDetails.length > 0) {
          report += `\n**Sample Failures:**\n`;
          const samples = failedDetails.slice(0, 10);
          samples.forEach((f) => {
            report += `- \`${f}\`\n`;
          });
          if (failedDetails.length > 10) {
            report += `- *...and ${failedDetails.length - 10} more errors.*`;
          }
        }

        await sendDiscordReport(job.data.channelId, report);
      } catch (err) {
        logger.error("smtpScanWorker: failed to scan", { error: String(err) });
        await sendDiscordReport(job.data.channelId, `❌ **SMTP Scan Failed:** ${String(err)}`);
        throw err;
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: 1
    }
  );
};

async function sendDiscordReport(channelId: string, content: string) {
  try {
    const client = getDiscordClient();
    if (!client) return;

    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      await (channel as TextChannel).send({ content });
    }
  } catch (err) {
    logger.error("smtpScanWorker: failed to send discord report", { error: String(err) });
  }
}
