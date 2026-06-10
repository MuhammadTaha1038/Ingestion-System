import { Pool } from "pg";
import { loadConfig } from "../../config/config.js";
import { getDatabasePool } from "../pool.js";

export interface WindowSettingsRecord {
  sending_window_hours: number;
  sending_window_interval_hours: number;
  sending_window_start_hour: number;
  sending_window_start_minute: number;
  sending_window_tz: string;
}

export interface WindowSettingsPatch {
  sendingWindowHours?: number;
  sendingWindowIntervalHours?: number;
  sendingWindowStartHour?: number;
  sendingWindowStartMinute?: number;
  sendingWindowTz?: string;
}

export class WindowSettingsRepository {
  public readonly pool: Pool;

  constructor(pool?: Pool) {
    this.pool = pool ?? getDatabasePool();
  }

  private async ensureTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS window_settings (
        id smallint PRIMARY KEY DEFAULT 1,
        sending_window_hours integer NOT NULL,
        sending_window_interval_hours integer NOT NULL,
        sending_window_start_hour integer NOT NULL,
        sending_window_start_minute integer NOT NULL,
        sending_window_tz text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async getSettings(): Promise<WindowSettingsRecord> {
    await this.ensureTable();

    const defaults = loadConfig();
    const defaultRow: WindowSettingsRecord = {
      sending_window_hours: defaults.sendingWindowHours,
      sending_window_interval_hours: defaults.sendingWindowIntervalHours,
      sending_window_start_hour: defaults.sendingWindowStartHour,
      sending_window_start_minute: defaults.sendingWindowStartMinute,
      sending_window_tz: defaults.sendingWindowTz
    };

    const existing = await this.pool.query(
      `SELECT sending_window_hours, sending_window_interval_hours, sending_window_start_hour, sending_window_start_minute, sending_window_tz FROM window_settings WHERE id = 1`
    );

    if (existing.rows[0]) {
      return existing.rows[0] as WindowSettingsRecord;
    }

    await this.pool.query(
      `INSERT INTO window_settings (id, sending_window_hours, sending_window_interval_hours, sending_window_start_hour, sending_window_start_minute, sending_window_tz)
       VALUES (1, $1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [
        defaultRow.sending_window_hours,
        defaultRow.sending_window_interval_hours,
        defaultRow.sending_window_start_hour,
        defaultRow.sending_window_start_minute,
        defaultRow.sending_window_tz
      ]
    );

    return defaultRow;
  }

  async updateSettings(patch: WindowSettingsPatch): Promise<WindowSettingsRecord> {
    await this.ensureTable();
    const current = await this.getSettings();
    const next: WindowSettingsRecord = {
      sending_window_hours: patch.sendingWindowHours ?? current.sending_window_hours,
      sending_window_interval_hours: patch.sendingWindowIntervalHours ?? current.sending_window_interval_hours,
      sending_window_start_hour: patch.sendingWindowStartHour ?? current.sending_window_start_hour,
      sending_window_start_minute: patch.sendingWindowStartMinute ?? current.sending_window_start_minute,
      sending_window_tz: patch.sendingWindowTz ?? current.sending_window_tz
    };

    await this.pool.query(
      `INSERT INTO window_settings (
         id, sending_window_hours, sending_window_interval_hours, sending_window_start_hour, sending_window_start_minute, sending_window_tz, updated_at
       ) VALUES (1, $1, $2, $3, $4, $5, now())
       ON CONFLICT (id) DO UPDATE SET
         sending_window_hours = EXCLUDED.sending_window_hours,
         sending_window_interval_hours = EXCLUDED.sending_window_interval_hours,
         sending_window_start_hour = EXCLUDED.sending_window_start_hour,
         sending_window_start_minute = EXCLUDED.sending_window_start_minute,
         sending_window_tz = EXCLUDED.sending_window_tz,
         updated_at = now()`,
      [
        next.sending_window_hours,
        next.sending_window_interval_hours,
        next.sending_window_start_hour,
        next.sending_window_start_minute,
        next.sending_window_tz
      ]
    );

    return next;
  }
}