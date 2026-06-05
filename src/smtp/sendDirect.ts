import nodemailer from "nodemailer";

export interface DirectSmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  username?: string;
  password?: string;
  ignoreTLS?: boolean;
}

export const sendDirect = async (
  cfg: DirectSmtpConfig,
  to: string,
  subject: string,
  html: string,
  text?: string
) => {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? false,
    ignoreTLS: cfg.ignoreTLS ?? false,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
  });

  const info = await transporter.sendMail({
    from: cfg.username ?? "no-reply@example.com",
    to,
    subject,
    text: text ?? "",
    html,
  });

  return info;
};
