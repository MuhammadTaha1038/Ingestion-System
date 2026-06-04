import { getSendingWindowState } from "./windowScheduler.js";
import { SmtpRepository } from "../db/repositories/smtp.js";
import { createLogger } from "../logging/logger.js";
import { loadConfig } from "../config/config.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);

let lastWindowKey: string | null = null;

export const startWindowResetter = (intervalMs = 60_000): void => {
  const repo = new SmtpRepository();

  const tick = async () => {
    try {
      const state = getSendingWindowState(new Date());
      if (state.windowKey !== lastWindowKey) {
        logger.info("detected new sending window", { windowKey: state.windowKey });
        const windowId = await repo.getOrCreateWindow(state.windowStart, state.windowEnd, state.windowKey);
        // ensure usage for the new window is reset
        await repo.resetUsageForWindow(windowId);
        lastWindowKey = state.windowKey;
      }
    } catch (err) {
      logger.error("window resetter tick failed", { error: String(err) });
    }
  };

  // run immediately then on interval
  void tick();
  setInterval(tick, intervalMs);
};
