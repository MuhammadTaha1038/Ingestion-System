import nodemailer from "nodemailer";
import { SmtpRepository } from "../db/repositories/smtp.js";
import { decrypt } from "../security/crypto.js";
import { loadConfig } from "../config/config.js";
import { createLogger } from "../logging/logger.js";

const cfg = loadConfig();
const logger = createLogger(cfg.logLevel);

const DEFAULT_INTERVAL_MINUTES = 5;

export const validateAccount = async (repo: SmtpRepository, accountId: string): Promise<{ id: string; ok: boolean; error?: string }> => {
  try {
    const res = await repo.pool.query(
      `SELECT id, host, port, username, password_encrypted, use_tls FROM smtp_accounts WHERE id = $1`,
      [accountId]
    );
    const row = res.rows[0];
    if (!row) return { id: accountId, ok: false, error: "not_found" };

    const password = decrypt(row.password_encrypted);

    const transporter = nodemailer.createTransport({
      host: row.host,
      port: row.port,
      secure: row.use_tls,
      auth: {
        user: row.username,
        pass: password
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 20000
    });

    await transporter.verify();
    return { id: accountId, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id: accountId, ok: false, error: message };
  }
};

export const validateAndUpdateAccountStatus = async (repo: SmtpRepository, accountId: string): Promise<{ id: string; ok: boolean; error?: string }> => {
  const result = await validateAccount(repo, accountId);
  if (result.ok) {
    await repo.enableSmtpAccount(accountId);
  } else {
    await repo.disableSmtpAccount(accountId);
  }
  return result;
};

export const startSmtpValidator = (): void => {
  const intervalMinutes = Number(process.env.SMTP_VALIDATOR_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES);
  const repo = new SmtpRepository();

  const run = async () => {
    try {
      const accounts = await repo.listActiveAccounts();
      logger.info("smtp-validator: checking active accounts", { count: accounts.length });

      for (const acc of accounts) {
        try {
          const res = await validateAndUpdateAccountStatus(repo, acc.id);
          if (!res.ok) {
            logger.warn("smtp-validator: account validation failed, disabling", { id: acc.id, error: res.error });
          } else {
            logger.info("smtp-validator: account valid", { id: acc.id });
          }
        } catch (e) {
          logger.warn("smtp-validator: unexpected error validating account", { id: acc.id, error: String(e) });
        }
      }
    } catch (err) {
      logger.error("smtp-validator: failed to run validation", { error: String(err) });
    }
  };

  // initial run
  void run();

  // schedule
  setInterval(run, Math.max(1, intervalMinutes) * 60 * 1000);
  logger.info("smtp-validator started", { intervalMinutes });
};
