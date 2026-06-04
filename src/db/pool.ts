import { Pool } from "pg";
import { loadConfig } from "../config/config.js";

let sharedPool: Pool | null = null;

export const getDatabasePool = (): Pool => {
  if (!sharedPool) {
    const config = loadConfig();
    if (!config.databaseUrl) {
      throw new Error("DATABASE_URL is required for database connections");
    }

    sharedPool = new Pool({ connectionString: config.databaseUrl });
  }

  return sharedPool;
};
