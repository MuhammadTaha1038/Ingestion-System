import nodemailer from "nodemailer";
import { SmtpRepository } from "../db/repositories/smtp.js";
import { decrypt } from "../security/crypto.js";
import { findWorkingSmtpConfig, buildTransportOptions } from "./connection.js";

const repo = new SmtpRepository();

export const sendMail = async (
  smtpAccountId: string, _account_not_found");

  const password = decrypt(row.password_encrypted);
const validation = await findWorkingSmtpConfig(row.host, row.port, row.use_tls, row.username, password);
if (!validation.ok || !validation.config) {
  throw new Error(validation.error ?? "smtp_connection_failed");
}

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
