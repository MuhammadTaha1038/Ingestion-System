import { Pool } from "pg";
import { getDatabasePool } from "../pool.js";

export interface SmtpAccountRecord {
  id: string;
  email_account_id: string;
  host: string;
  port: number;
  username: string;
  use_tls: boolean;
  status: string;
  max_per_window: number;
  max_concurrent: number;
}

export interface SmtpUsageRecord {
  id: string;
  smtp_account_id: string;
  window_id: string;
  used_count: number;
}

export class SmtpRepository {
  public readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? getDatabasePool();
  }

  async listActiveAccounts(): Promise<SmtpAccountRecord[]> {
    const res = await this.pool.query(
      `SELECT id, email_account_id, host, port, username, use_tls, status, max_per_window, max_concurrent FROM smtp_accounts WHERE status = 'active'`
    );

    return res.rows as SmtpAccountRecord[];
  }

  async getUsageForWindow(smtpAccountId: string, windowId: string): Promise<SmtpUsageRecord | null> {
    const res = await this.pool.query(
      `SELECT id, smtp_account_id, window_id, used_count FROM smtp_usage WHERE smtp_account_id = $1 AND window_id = $2`,
      [smtpAccountId, windowId]
    );

    return res.rows[0] ?? null;
  }

  async incrementUsage(smtpAccountId: string, windowId: string, delta = 1): Promise<void> {
    await this.pool.query(
      `INSERT INTO smtp_usage (smtp_account_id, window_id, used_count)
       VALUES ($1, $2, $3)
       ON CONFLICT (smtp_account_id, window_id)
       DO UPDATE SET used_count = smtp_usage.used_count + $3, last_used_at = now()`,
      [smtpAccountId, windowId, delta]
    );
  }

  async resetUsageForWindow(windowId: string): Promise<void> {
    await this.pool.query(`DELETE FROM smtp_usage WHERE window_id = $1`, [windowId]);
  }

  // Create or update a sending window record and return its id
  async getOrCreateWindow(windowStart: string, windowEnd: string, windowKey: string): Promise<string> {
    const find = await this.pool.query(`SELECT id FROM sending_windows WHERE window_start = $1`, [windowStart]);
    if (find.rows[0]) return find.rows[0].id as string;

    const res = await this.pool.query(
      `INSERT INTO sending_windows (window_start, window_end, status) VALUES ($1, $2, $3) RETURNING id`,
      [windowStart, windowEnd, "scheduled"]
    );

    return res.rows[0].id as string;
  }

  async createSmtpAccount(params: {
    emailAccountId: string;
    host: string;
    port: number;
    username: string;
    passwordEncrypted: string;
    useTls?: boolean;
    maxPerWindow?: number;
    maxConcurrent?: number;
  }): Promise<string> {
    const res = await this.pool.query(
      `INSERT INTO smtp_accounts (email_account_id, host, port, username, password_encrypted, use_tls, max_per_window, max_concurrent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        params.emailAccountId,
        params.host,
        params.port,
        params.username,
        params.passwordEncrypted,
        typeof params.useTls === "boolean" ? params.useTls : params.port === 465 || params.port === 587,
        params.maxPerWindow ?? 50,
        params.maxConcurrent ?? 1
      ]
    );

    return res.rows[0].id as string;
  }

  async updateSmtpAccount(id: string, patch: {
    host?: string;
    port?: number;
    username?: string;
    passwordEncrypted?: string;
    useTls?: boolean;
    maxPerWindow?: number;
    maxConcurrent?: number;
    status?: string;
  }): Promise<void> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (typeof patch.host === "string") {
      fields.push(`host = $${fields.length + 1}`);
      values.push(patch.host);
    }

    if (typeof patch.port === "number") {
      fields.push(`port = $${fields.length + 1}`);
      values.push(patch.port);
    }

    if (typeof patch.username === "string") {
      fields.push(`username = $${fields.length + 1}`);
      values.push(patch.username);
    }

    if (typeof patch.passwordEncrypted === "string") {
      fields.push(`password_encrypted = $${fields.length + 1}`);
      values.push(patch.passwordEncrypted);
    }

    if (typeof patch.useTls === "boolean") {
      fields.push(`use_tls = $${fields.length + 1}`);
      values.push(patch.useTls);
    }

    if (typeof patch.maxPerWindow === "number") {
      fields.push(`max_per_window = $${fields.length + 1}`);
      values.push(patch.maxPerWindow);
    }

    if (typeof patch.maxConcurrent === "number") {
      fields.push(`max_concurrent = $${fields.length + 1}`);
      values.push(patch.maxConcurrent);
    }

    if (typeof patch.status === "string") {
      fields.push(`status = $${fields.length + 1}`);
      values.push(patch.status);
    }

    if (fields.length === 0) {
      return;
    }

    values.push(id);
    await this.pool.query(`UPDATE smtp_accounts SET ${fields.join(", ")} WHERE id = $${fields.length + 1}`, values);
  }

  async deleteSmtpAccount(id: string): Promise<void> {
    await this.pool.query("DELETE FROM smtp_accounts WHERE id = $1", [id]);
  }

  async disableSmtpAccount(id: string): Promise<void> {
    await this.pool.query("UPDATE smtp_accounts SET status = 'disabled' WHERE id = $1", [id]);
  }

  async listAllAccounts(): Promise<SmtpAccountRecord[]> {
    const res = await this.pool.query(
      `SELECT id, email_account_id, host, port, username, use_tls, status, max_per_window, max_concurrent FROM smtp_accounts ORDER BY created_at DESC`
    );

    return res.rows as SmtpAccountRecord[];
  }

  async enableSmtpAccount(id: string): Promise<void> {
    await this.pool.query("UPDATE smtp_accounts SET status = 'active' WHERE id = $1", [id]);
    await this.pool.query("DELETE FROM smtp_failures WHERE smtp_account_id = $1", [id]);
  }

  async recordFailureAndMaybeDisable(smtpAccountId: string, threshold = 5): Promise<{ disabled: boolean; failures: number }> {
    const upsert = await this.pool.query(
      `INSERT INTO smtp_failures (smtp_account_id, consecutive_failures, last_failure_at)
       VALUES ($1, 1, now())
       ON CONFLICT (smtp_account_id)
       DO UPDATE SET consecutive_failures = smtp_failures.consecutive_failures + 1, last_failure_at = now()
       RETURNING consecutive_failures`,
      [smtpAccountId]
    );

    const failures = upsert.rows[0].consecutive_failures as number;
    if (failures >= threshold) {
      await this.disableSmtpAccount(smtpAccountId);
      return { disabled: true, failures };
    }

    return { disabled: false, failures };
  }

  async resetFailureCount(smtpAccountId: string): Promise<void> {
    await this.pool.query(`DELETE FROM smtp_failures WHERE smtp_account_id = $1`, [smtpAccountId]);
  }

  async findByUsernameAndHost(username: string, host: string): Promise<SmtpAccountRecord | null> {
    const res = await this.pool.query(
      `SELECT id, email_account_id, host, port, username, use_tls, status, max_per_window, max_concurrent FROM smtp_accounts WHERE username = $1 AND host = $2 LIMIT 1`,
      [username, host]
    );
    return res.rows[0] ?? null;
  }

  async findByUsername(username: string): Promise<SmtpAccountRecord | null> {
    const res = await this.pool.query(
      `SELECT id, email_account_id, host, port, username, use_tls, status, max_per_window, max_concurrent FROM smtp_accounts WHERE username = $1 ORDER BY created_at DESC LIMIT 1`,
      [username]
    );
    return res.rows[0] ?? null;
  }
}
