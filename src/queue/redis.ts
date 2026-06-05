import IORedis from "ioredis";
import { loadConfig } from "../config/config.js";

let sharedConnection: any = null;

export const getRedisConnection = (): any => {
  if (!sharedConnection) {
    const config = loadConfig();
    if (!config.redisUrl) {
      throw new Error("REDIS_URL is required for queue connections");
    }

    sharedConnection = new (IORedis as any)(config.redisUrl);
  }

  return sharedConnection;
};
