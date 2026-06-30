export interface SmtpConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
}

export interface SmtpValidationAttempt {
  config: SmtpConnectionConfig;
  error?: string;
}

export interface SmtpValidationResult {
  ok: boolean;
  error?: string;
  config?: SmtpConnectionConfig;
  attempts: SmtpValidationAttempt[];
}

import nodemailer from "nodemailer";

const formatConfig = (config: SmtpConnectionConfig): string => {
  return `host=${config.host} port=${config.port} secure=${config.secure} requireTLS=${config.requireTLS}`;
};

const buildCandidateConfigs = (host: string, port: number, useTls: boolean): SmtpConnectionConfig[] => {
  const configs: SmtpConnectionConfig[] = [];
  const normalize = (cfg: SmtpConnectionConfig) => `${cfg.port}:${cfg.secure}:${cfg.requireTLS}`;
  const seen = new Set<string>();

  const add = (cfg: SmtpConnectionConfig) => {
    const key = normalize(cfg);
    if (!seen.has(key)) {
      seen.add(key);
      configs.push(cfg);
    }
  };

  const current = {
    host,
    port,
    secure: port === 465,
    requireTLS: port !== 465 && Boolean(useTls)
  };

  add(current);

  if (port !== 587) {
    add({ host, port: 587, secure: false, requireTLS: true });
  }

  if (port !== 465) {
    add({ host, port: 465, secure: true, requireTLS: false });
  }

  if (port !== 25) {
    add({ host, port: 25, secure: false, requireTLS: true });
  }

  if (port === 587 && !useTls) {
    add({ host, port: 587, secure: false, requireTLS: true });
  }

  return configs;
};

export const buildTransportOptions = (config: SmtpConnectionConfig, username: string, password: string) => ({
  host: config.host,
  port: config.port,
  secure: config.secure,
  requireTLS: config.requireTLS,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 30000,
  disableFileAccess: true,
  disableUrlAccess: true,
  auth: {
    user: username,
    pass: password
  },
  logger: true,
  debug: true,
  tls: {
    rejectUnauthorized: false
  }
});

const connectAndLogin = async (config: SmtpConnectionConfig, username: string, password: string): Promise<void> => {
  const transporter = nodemailer.createTransport(buildTransportOptions(config, username, password));
  await transporter.verify();
};

export const findWorkingSmtpConfig = async (
  host: string,
  port: number,
  useTls: boolean,
  username: string,
  password: string
): Promise<SmtpValidationResult> => {
  const attempts: SmtpValidationAttempt[] = [];
  const candidates = buildCandidateConfigs(host, port, useTls);

  for (const config of candidates) {
    try {
      await connectAndLogin(config, username, password);
      return { ok: true, config, attempts };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      attempts.push({ config, error });
    }
  }

  const message = attempts.map((attempt) => `${formatConfig(attempt.config)} => ${attempt.error}`).join(" | ");
  return { ok: false, error: `smtp_validation_failed: ${message}`, attempts };
};
