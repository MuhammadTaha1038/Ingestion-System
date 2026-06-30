import nodemailer from "nodemailer";
import { SmtpRepository } from "../db/repositories/smtp.js";
import { decrypt } from "../security/crypto.js";
import { findWorkingSmtpConfig, buildTransportOptions } from "./connection.js";

const repo = new SmtpRepository();

export const sendMail = async (
  smtpAccountId: string,
  to: string,
  subject: string,
  html: string,
  text?: string,
  replyTo?: string
) => {
  const res = await repo.pool.query("SELECT host, port, username, password_encrypted, use_tls FROM smtp_accounts WHERE id = $1", [smtpAccountId]);
  const row = res.rows[0];
  if (!row) throw new Error("smtp_account_not_found");

  const password = decrypt(row.password_encrypted);
  const validation = await findWorkingSmtpConfig(row.host, row.port, row.use_tls, row.username, password);
  if (!validation.ok || !validation.config) {
    throw new Error(validation.error ?? "smtp_connection_failed");
  }

  const { port, requireTLS } = validation.config;
  const normalizedUseTls = port === 465 ? false : requireTLS;
  if (port !== row.port || normalizedUseTls !== row.use_tls) {
    await repo.updateSmtpAccount(smtpAccountId, { port, useTls: normalizedUseTls });
  }

  const transporter = nodemailer.createTransport(buildTransportOptions(validation.config, row.username, password));

  const info = await transporter.sendMail({
    from: row.username,
    replyTo: replyTo ?? undefined,
    to,
    subject,
    text: text ?? "",
    html
  });

  return info;
};
