export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const normalizeLevel = (value: string | undefined): LogLevel => {
  const normalized = (value ?? "info").toLowerCase();
  if (normalized in LEVELS) {
    return normalized as LogLevel;
  }

  return "info";
};

export const createLogger = (minLevel?: string): Logger => {
  const threshold = LEVELS[normalizeLevel(minLevel)];

  const log = (
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>
  ): void => {
    if (LEVELS[level] < threshold) {
      return;
    }

    const payload = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    const line = `[${level.toUpperCase()}] ${message}${payload}`;

    if (level === "error") {
      console.error(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  };

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta)
  };
};
