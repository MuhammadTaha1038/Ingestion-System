import { Job } from "bullmq";
import { createSendingWorker } from "./workers.js";
import { SendingJobPayload } from "./types.js";
import { createLogger } from "../logging/logger.js";
import { loadConfig } from "../config/config.js";
import { selectAvailableAccount, recordSend } from "../smtp/manager.js";
import { sendMail } from "../smtp/sender.js";
import { jobStore } from "../jobs/store.js";
import { JobRepository } from "../db/repositories/jobs.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

export const startSendingWorker = (): void => {
  createSendingWorker(async (job: Job<SendingJobPayload>) => {
    logger.info("sending job started", { jobId: job.id, data: job.data });
    const jobRepo = config.databaseUrl ? new JobRepository() : null;

    if (jobRepo) await jobRepo.markProcessing(String(job.id));

    // Process recipients provided by the job. If none provided, use batchSize as a placeholder.
    const recipients = job.data.recipients ?? [];
    const batchSize = job.data.batchSize ?? (recipients.length || 1);

    if (recipients.length === 0) {
      logger.warn("no recipients provided in job; nothing to send");
    }

    const smtpRepo = config.databaseUrl ? new (await import("../db/repositories/smtp.js")).SmtpRepository() : null;

    for (let i = 0; i < batchSize; i += 1) {
      const recipient = recipients[i];
      let attempt = 0;
      const maxAttempts = 4; // 1 initial + 3 retries
      const baseDelay = 1000; // 1s
      const selected = await selectAvailableAccount();
      if (!selected) {
        logger.warn("no available smtp account, requeueing work");
        throw new Error("no_smtp_available");
      }
      // retry loop per recipient
      let sent = false;
      let lastErr: unknown = null;
      while (attempt < maxAttempts && !sent) {
        try {
          attempt += 1;
          if (recipient) {
            await sendMail(selected.account.id, recipient.to, recipient.subject, recipient.html ?? "", recipient.text);
          } else {
            await sendMail(selected.account.id, "recipient@example.com", "[Test]", "<p>Test</p>");
          }

          await recordSend(selected.account.id, selected.windowId, 1);
          logger.info("send succeeded", { smtpAccount: selected.account.id, to: recipient?.to, attempt });
          sent = true;
        } catch (err) {
          lastErr = err;
          logger.warn("send attempt failed, will retry", { smtpAccount: selected.account.id, attempt, error: String(err) });
          if (attempt < maxAttempts) {
            const delay = baseDelay * Math.pow(2, attempt - 1);
            await new Promise((res) => setTimeout(res, delay));
          }
        }
      }

      if (!sent) {
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        logger.error("recipient send permanently failed", { smtpAccount: selected.account.id, to: recipient?.to, error: msg });
        if (smtpRepo) {
          const res = await smtpRepo.recordFailureAndMaybeDisable(selected.account.id, 4);
          if (res.disabled) {
            logger.warn("smtp account auto-disabled due to repeated failures", { smtpAccount: selected.account.id, failures: res.failures });
          }
        }
        if (jobRepo) await jobRepo.markFailed(String(job.id), msg);
        throw lastErr;
      } else {
        // on success, reset failure counter for account
        if (smtpRepo) await smtpRepo.resetFailureCount(selected.account.id);
      }
    }

    // Mark the job as completed in the in-memory job store if present
    try {
      const jobRecord = jobStore.getJob(job.data.campaignId ?? job.id);
      if (jobRecord) {
        jobStore.updateJob(jobRecord.id, { status: "completed" });
      }
    } catch (err) {
      // ignore
    }

    logger.info("sending job finished", { jobId: job.id });
  });
};
