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

const loadSmtpConnection = async (): Promise<any> => {
  const connectionImport = await import("nodemailer/lib/smtp-connection/index.js");
  return connectionImport.default ?? connectionImport;
};

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

const connectAndLogin = async (config: SmtpConnectionConfig, username: string, password: string): Promise<void> => {
  const SMTPConnection = await loadSmtpConnection();
  const connection = new SMTPConnection({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 20000
  } as any);

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      connection.removeListener("error", onError);
      connection.removeListener("close", onClose);
    };

    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      connection.close();
      cleanup();
      reject(err);
    };

    const onClose = () => {
      cleanup();
      if (settled) return;
      settled = true;
      resolve();
    };

    connection.once("error", onError);
    connection.once("close", onClose);

    connection.connect((connectErr: Error | null) => {
      if (connectErr) {
        return onError(connectErr);
      }

      connection.login({ user: username, pass: password }, (loginErr: Error | null) => {
        if (loginErr) {
          return onError(loginErr);
        }

        connection.quit((quitErr: Error | null) => {
          if (quitErr) {
            return onError(quitErr);
          }

          // wait for close event to resolve successfully
        });
      });
    });
  });
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
  }
});
