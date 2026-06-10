import nodemailer from "nodemailer";
import { SmtpRepository } from "../db/repositories/smtp.js";
import { decrypt } from "../security/crypto.js";

const repo = new SmtpRepository();

export const sendMail = async (
  smtpAccountId: string,
  to: string,
  subject: string,
  html: string,
  text?: string,
  fromAddress?: string,
  replyTo?: string
) => {
  const res = await repo.pool.query("SELECT host, port, username, password_encrypted, use_tls FROM smtp_accounts WHERE id = $1", [smtpAccountId]);
  const row = res.rows[0];
  if (!row) throw new Error("smtp_account_not_found");

  const password = decrypt(row.password_encrypted);

  const transporter = nodemailer.createTransport({
    host: row.host,
    port: row.port,
    secure: row.use_tls,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true,
    auth: {
      user: row.username,
      pass: password
    }
  });

  const info = await transporter.sendMail({
    from: fromAddress ?? row.username,
    replyTo: replyTo ?? undefined,
    to,
    subject,
    text: text ?? "",
    html
  });

  return info;
};
