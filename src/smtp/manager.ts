import { SmtpRepository, SmtpAccountRecord } from "../db/repositories/smtp.js";
import { WindowSettingsRepository } from "../db/repositories/windowSettings.js";
import { getSendingWindowState } from "../scheduler/windowScheduler.js";

const repo = new SmtpRepository();
const settingsRepo = new WindowSettingsRepository();

export interface SelectedAccount {
  account: SmtpAccountRecord;
  windowId: string;
}

// Select an available SMTP account for the current sending window.
const getCurrentSendingWindow = async () => {
  const settings = await settingsRepo.getSettings();
  const window = getSendingWindowState(new Date(), {
    sendingWindowHours: settings.sending_window_hours,
    sendingWindowIntervalHours: settings.sending_window_interval_hours,
    sendingWindowStartHour: settings.sending_window_start_hour,
    sendingWindowStartMinute: settings.sending_window_start_minute,
    sendingWindowTz: settings.sending_window_tz
  });
  return {
    windowKey: window.windowKey,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    intervalHours: settings.sending_window_interval_hours
  };
};

const getWarmupDailyLimit = (daysActive: number): number => {
  if (daysActive <= 3) return 50;
  if (daysActive <= 7) return 200;
  if (daysActive <= 10) return 500;
  if (daysActive <= 14) return 1000;
  if (daysActive <= 18) return 2000;
  if (daysActive <= 21) return 4000;
  return 9000;
};

export const selectAvailableAccount = async (): Promise<SelectedAccount | null> => {
  const windowState = await getCurrentSendingWindow();
  const windowId = await repo.getOrCreateWindow(windowState.windowStart, windowState.windowEnd, windowState.windowKey);

  const accounts = await repo.listActiveAccounts();
  if (accounts.length === 0) return null;

  const candidates = [] as Array<{ account: SmtpAccountRecord; used: number }>;

  const windowsPerDay = 24 / windowState.intervalHours;

  for (const acc of accounts) {
    const daysActive = Math.floor((Date.now() - new Date(acc.created_at).getTime()) / 86400000) + 1;
    const maxDaily = getWarmupDailyLimit(daysActive);
    const effectiveMaxPerWindow = Math.ceil(maxDaily / windowsPerDay);

    const usage = await repo.getUsageForWindow(acc.id, windowId);
    const used = usage ? usage.used_count : 0;
    if (used < effectiveMaxPerWindow) {
      candidates.push({ account: acc, used });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.used - b.used);
  const selected = candidates[0].account;

  return { account: selected, windowId };
};

export const selectAccountById = async (smtpAccountId: string): Promise<SelectedAccount | null> => {
  const windowState = await getCurrentSendingWindow();
  const windowId = await repo.getOrCreateWindow(windowState.windowStart, windowState.windowEnd, windowState.windowKey);

  const res = await repo.pool.query(
    `SELECT id, email_account_id, host, port, username, use_tls, status, max_per_window, max_concurrent
     FROM smtp_accounts
     WHERE id = $1 AND status = 'active' LIMIT 1`,
    [smtpAccountId]
  );

  const account = res.rows[0] as SmtpAccountRecord | undefined;
  if (!account) return null;
  return { account, windowId };
};

export const recordSend = async (accountId: string, windowId: string, count = 1): Promise<void> => {
  await repo.incrementUsage(accountId, windowId, count);
};

export const listActiveAccounts = async (): Promise<SmtpAccountRecord[]> => {
  return repo.listActiveAccounts();
};
