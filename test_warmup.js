import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const getWarmupDailyLimit = (daysActive) => {
  if (daysActive <= 3) return 50;
  if (daysActive <= 7) return 200;
  if (daysActive <= 10) return 500;
  if (daysActive <= 14) return 1000;
  if (daysActive <= 18) return 2000;
  if (daysActive <= 21) return 4000;
  return 9000;
};
async function run() {
  const res = await pool.query("SELECT sa.username, sa.status, sa.created_at, ea.address FROM smtp_accounts sa LEFT JOIN email_accounts ea ON sa.email_account_id = ea.id ORDER BY sa.created_at DESC");
  console.log("| SMTP Account | Status | Age (Days) | Daily Limit |");
  console.log("|---|---|---|---|");
  for (const acc of res.rows) {
    const daysActive = Math.floor((Date.now() - new Date(acc.created_at).getTime()) / 86400000) + 1;
    console.log(`| ${acc.username} | ${acc.status} | ${daysActive} | ${getWarmupDailyLimit(daysActive)} |`);
  }
  process.exit(0);
}
run();
