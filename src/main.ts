import "dotenv/config";
import { loadConfig } from "./config/config.js";
import { createLogger } from "./logging/logger.js";
import { createServer } from "./api/server.js";
import { startIngestionWorker } from "./ingestion/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info("bootstrap started", { env: config.env });

  const server = createServer(logger);
  await server.listen({ port: config.port, host: "0.0.0.0" });
  logger.info("api listening", { port: config.port });

  if (process.env.RUN_INGESTION_WORKER !== "false") {
    startIngestionWorker();
    logger.info("ingestion worker started");
  }
  if (process.env.RUN_SENDING_WORKER !== "false") {
    const { startSendingWorker } = await import("./queue/sendingWorker.js");
    startSendingWorker();
    logger.info("sending worker started");
  }
  if (process.env.RUN_WINDOW_RESETTER !== "false") {
    const { startWindowResetter } = await import("./scheduler/windowResetter.js");
    startWindowResetter();
    logger.info("window resetter started");
  }
  if (process.env.RUN_SMTP_VALIDATOR !== "false") {
    const { startSmtpValidator } = await import("./smtp/validator.js");
    startSmtpValidator();
    logger.info("smtp validator started");
  }
  if (process.env.RUN_DISCORD_BOT !== "false") {
    const { startDiscordBot } = await import("./discord/bot.js");
    startDiscordBot();
    logger.info("discord bot started (if token provided)");
  }
  if (process.env.RUN_DISCORD_COMMAND_REG !== "false") {
    const { registerCommands } = await import("./discord/registerCommands.js");
    await registerCommands();
    logger.info("discord commands registration attempted");
  }
}

main().catch((error) => {
  console.error("fatal error", error);
  process.exit(1);
});
