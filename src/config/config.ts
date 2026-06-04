export interface AppConfig {
  env: string;
  logLevel: string;
  port: number;
  sendingWindowHours: number;
  sendingWindowTz: string;
  sendingWindowIntervalHours: number;
  sendingWindowStartHour: number;
  sendingWindowStartMinute: number;
  databaseUrl: string;
  redisUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  discord: {
    botToken: string;
    appId: string;
    serverId: string;
  };
}

const parsePositiveInt = (
  name: string,
  value: string | undefined,
  fallback: number
): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

const parseIntInRange = (
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }

  return parsed;
};

const readString = (name: string, fallback = ""): string =>
  process.env[name] ?? fallback;

export const loadConfig = (): AppConfig => {
  const env = process.env.NODE_ENV ?? "development";
  const logLevel = process.env.LOG_LEVEL ?? "info";
  const port = parsePositiveInt("PORT", process.env.PORT, 3000);
  const sendingWindowHours = parsePositiveInt(
    "SENDING_WINDOW_HOURS",
    process.env.SENDING_WINDOW_HOURS,
    6
  );
  const sendingWindowTz = process.env.SENDING_WINDOW_TZ ?? "UTC";
  const sendingWindowIntervalHours = parsePositiveInt(
    "SENDING_WINDOW_INTERVAL_HOURS",
    process.env.SENDING_WINDOW_INTERVAL_HOURS,
    sendingWindowHours
  );
  const sendingWindowStartHour = parseIntInRange(
    "SENDING_WINDOW_START_HOUR",
    process.env.SENDING_WINDOW_START_HOUR,
    0,
    0,
    23
  );
  const sendingWindowStartMinute = parseIntInRange(
    "SENDING_WINDOW_START_MINUTE",
    process.env.SENDING_WINDOW_START_MINUTE,
    0,
    0,
    59
  );

  const databaseUrl = readString("DATABASE_URL");
  const redisUrl = readString("REDIS_URL");

  const s3 = {
    endpoint: readString("S3_ENDPOINT"),
    region: readString("S3_REGION"),
    bucket: readString("S3_BUCKET"),
    accessKeyId: readString("S3_ACCESS_KEY_ID"),
    secretAccessKey: readString("S3_SECRET_ACCESS_KEY")
  };

  const discord = {
    botToken: readString("DISCORD_BOT_TOKEN"),
    appId: readString("DISCORD_APP_ID"),
    serverId: readString("DISCORD_SERVER_ID")
  };

  return {
    env,
    logLevel,
    port,
    sendingWindowHours,
    sendingWindowTz,
    sendingWindowIntervalHours,
    sendingWindowStartHour,
    sendingWindowStartMinute,
    databaseUrl,
    redisUrl,
    s3,
    discord
  };
};
