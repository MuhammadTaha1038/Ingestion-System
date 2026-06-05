import { SmtpRepository, SmtpAccountRecord } from "../db/repositories/smtp.js";
import { getSendingWindowState } from "../scheduler/windowScheduler.js";

const repo = new SmtpRepository();

export interface SelectedAccount {
  account: SmtpAccountRecord;
  windowId: string;
}

// Select an available SMTP account for the current sending window.
export const selectAvailableAccount = async (): Promise<SelectedAccount | null> => {
  const window = getSendingWindowState(new Date());
  const windowKey = window.windowKey;
  const windowStart = window.windowStart;
  const windowEnd = window.windowEnd;
  const windowId = await repo.getOrCreateWindow(windowStart, windowEnd, windowKey);

  const accounts = await repo.listActiveAccounts();
  if (accounts.length === 0) return null;

  // Find account with remaining quota (used < max_per_window).
  const candidates = [] as Array<{ account: SmtpAccountRecord; used: number }>;

  for (const acc of accounts) {
    const usage = await repo.getUsageForWindow(acc.id, windowId);
    const used = usage ? usage.used_count : 0;
    if (used < acc.max_per_window) {
      candidates.push({ account: acc, used });
    }
  }

  if (candidates.length === 0) return null;

  // Prefer the account with the least used_count (simple rotation/load balancing)
  candidates.sort((a, b) => a.used - b.used);
  const selected = candidates[0].account;

  return { account: selected, windowId };
};

export const recordSend = async (accountId: string, windowId: string, count = 1): Promise<void> => {
  await repo.incrementUsage(accountId, windowId, count);
};

export const listActiveAccounts = async (): Promise<SmtpAccountRecord[]> => {
  return repo.listActiveAccounts();
};
