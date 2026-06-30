import { Job } from "bullmq";
import { createSendingWorker } from "./workers.js";
import { SendingJobPayload } from "./types.js";
import { createLogger } from "../logging/logger.js";
import { loadConfig } from "../config/config.js";
import { selectAvailableAccount, selectAccountById, recordSend } from "../smtp/manager.js";
import { sendMail } from "../smtp/sender.js";
import { jobStore } from "../jobs/store.js";
import { JobRepository } from "../db/repositories/jobs.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

export const startSendingWorker = (): void => {
  createSendingWorker(async (job: Job<SendingJobPayload>) => {
    const jobRepo = config.databaseUrl ? new JobRepository() : null;
    const smtpRepo = config.databaseUrl ? new (await import("../db/repositories/smtp.js")).SmtpRepository() : null;

    try {
      logger.info("sending job started", { jobId: job.id, data: job.data });

      if (jobRepo) await jobRepo.markProcessing(String(job.id));

      const recipients = job.data.recipients ?? [];
      const replyTo = job.data.replyTo;

      if (recipients.length === 0) {
        logger.warn("no recipients provided in job; completing without SMTP send", { jobId: job.id });
        if (jobRepo) {
          await jobRepo.markCompleted(String(job.id), { total: 0, processed: 0, failed: 0 });
        }

        try {
          const jobRecord = jobStore.getJob(String(job.id));
          if (jobRecord) {
            jobStore.updateJob(jobRecord.id, { status: "completed" });
          }
        } catch (err) {
          // ignore
        }

        logger.info("sending job finished", { jobId: job.id, sent: 0, failed: 0 });
        return;
      }

      for (const recipient of recipients) {
        let attempt = 0;
        const maxAttempts = 4; // 1 initial + 3 retries
        const baseDelay = 1000; // 1s
        // If the job specifies a particular smtpAccountId, use it directly
        let selected = null as any;
        const jobLevelSmtp = (job.data as any).smtpAccountId as string | undefined;
        if (jobLevelSmtp) {
          selected = await selectAccountById(jobLevelSmtp);
          if (!selected) {
            logger.error("requested smtp account unavailable or inactive", { smtpAccountId: jobLevelSmtp });
            throw new Error("requested_smtp_account_unavailable");
          }
        } else {
          selected = await selectAvailableAccount();
        }

        if (!selected) {
          logger.warn("no available smtp account, requeueing work");
          throw new Error("no_smtp_available");
        }
        logger.info("sending recipient", { jobId: job.id, to: recipient?.to, smtpAccount: selected.account.id, attemptLimit: maxAttempts });
        // retry loop per recipient
        let sent = false;
        let lastErr: unknown = null;
        while (attempt < maxAttempts && !sent) {
          try {
            attempt += 1;
            if (recipient) {
              await sendMail(
                selected.account.id,
                recipient.to,
                recipient.subject,
                recipient.html ?? "",
                recipient.text,
                replyTo
              );
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

      if (jobRepo) {
        await jobRepo.markCompleted(String(job.id), { total: recipients.length, processed: recipients.length, failed: 0 });
      }

      // Mark the job as completed in the in-memory job store if present
      try {
        const jobRecord = jobStore.getJob(String(job.id));
        if (jobRecord) {
          jobStore.updateJob(jobRecord.id, { status: "completed" });
        }
      } catch (err) {
        // ignore
      }

      logger.info("sending job finished", { jobId: job.id, sent: recipients.length, failed: 0 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("sending job failed", { jobId: job.id, error: message });

      if (jobRepo) {
        await jobRepo.markFailed(String(job.id), message);
      }

      try {
        const jobRecord = jobStore.getJob(String(job.id));
        if (jobRecord) {
          jobStore.updateJob(jobRecord.id, { status: "failed", error: message });
        }
      } catch (updateErr) {
        // ignore
      }

      throw err;
    }
  });
};
