import nodemailer from "nodemailer";

export interface DirectSmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  username?: string;
  password?: string;
  ignoreTLS?: boolean;
  replyTo?: string;
}

text ?: string
) => {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
  });

  const pino = (await import("../logging/logger.js")).createLogger("info");
  pino.info("DEBUG SMTP DIRECT AUTH", { user: cfg.username, passLength: cfg.password?.length, passFalsy: !cfg.password });

  const info = await transporter.sendMail({
    from: cfg.username ?? "no-reply@example.com",
    replyTo: cfg.replyTo ?? undefined,
    to,
    subject,
    text: text ?? "",
    html,
  });

  return info;
};
