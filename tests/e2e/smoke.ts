import "dotenv/config";
import assert from "node:assert/strict";
import { createServer } from "../../src/api/server.js";
import { createLogger } from "../../src/logging/logger.js";
import { loadConfig } from "../../src/config/config.js";
import { getDatabasePool } from "../../src/db/pool.js";
import Redis from "ioredis";

const config = loadConfig();
const logger = createLogger(config.logLevel);

const run = async (): Promise<void> => {
  assert.ok(config.databaseUrl, "DATABASE_URL is required for e2e smoke testing");
  assert.ok(config.redisUrl, "REDIS_URL is required for e2e smoke testing");

  const pool = getDatabasePool();
  const dbPing = await pool.query("SELECT 1 AS ok");
  assert.equal(dbPing.rows[0].ok, 1);

  const redis = new Redis(config.redisUrl);
  const redisPing = await redis.ping();
  assert.equal(redisPing, "PONG");
  await redis.quit();

  const server = createServer(logger);
  await server.listen({ port: 0, host: "127.0.0.1" });
  const address = server.server.address();
  assert.ok(address && typeof address !== "string");

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  const healthJson = await health.json();
  assert.equal(healthJson.status, "ok");

  const metrics = await fetch(`${baseUrl}/metrics`);
  assert.equal(metrics.status, 200);

  await server.close();
  await pool.end();
  console.log("e2e smoke test passed");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
