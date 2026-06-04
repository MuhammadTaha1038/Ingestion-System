import IORedis from "ioredis";
import { loadConfig } from "../config/config.js";

let sharedConnection: IORedis | null = null;

export const getRedisConnection = (): IORedis => {
  if (!sharedConnection) {
    const config = loadConfig();
    if (!config.redisUrl) {
      throw new Error("REDIS_URL is required for queue connections");
    }

    sharedConnection = new IORedis(config.redisUrl);
  }

  return sharedConnection;
};
