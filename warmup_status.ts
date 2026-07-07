import "dotenv/config";
import { getDatabasePool } from "./src/db/pool.js";
import { WindowSettingsRepository } from "./src/db/repositories/windowSettings.js";

const getWarmupDailyLimit = (daysActive: number): number => {
  if (daysActive <= 3) return 50;
  if (daysActive <= 7) return 200;
  if (daysActive <= 10) return 500;
  if (daysActive <= 14) return 1000;
  if (daysActive <= 18) return 2000;
  if (daysActive <= 21) return 4000;
  return 9000;
};

async function run() {
  const pool = getDatabasePool();
  const settingsRepo = new WindowSettingsRepository(pool);
  
  try {
    const settings = await settingsRepo.getSettings();
    const windowsPerDay = 24 / settings.sending_window_interval_hours;

    const res = await pool.query(`
      SELECT sa.username, sa.status, sa.created_at, ea.address 
      FROM smtp_accounts sa
      LEFT JOIN email_accounts ea ON sa.email_account_id = ea.id
      WHERE sa.status = 'active'
    `);

    console.log("| SMTP Account | Age (Days) | Daily Limit | Per-Window Limit |");
    console.log("|---|---|---|---|");

    for (const acc of res.rows) {
      const daysActive = Math.floor((Date.now() - new Date(acc.created_at).getTime()) / 86400000) + 1;
      const maxDaily = getWarmupDailyLimit(daysActive);
      const effectiveMaxPerWindow = Math.ceil(maxDaily / windowsPerDay);

      console.log(`| ${acc.username} | ${daysActive} | ${maxDaily} | ${effectiveMaxPerWindow} |`);
    }

  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

run();
