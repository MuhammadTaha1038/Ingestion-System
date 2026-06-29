import pkg from 'pg';
import { loadConfig } from '../src/config/config.js';

const { Pool } = pkg;

const days = process.env.DAYS ? Number(process.env.DAYS) : 90;
const confirm = process.env.CONFIRM === '1';

const cfg = loadConfig();
const databaseUrl = process.env.DATABASE_URL || cfg.databaseUrl;
if (!databaseUrl) {
  console.error('DATABASE_URL not provided. Aborting.');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

const threshold = days > 0 ? `now() - interval '${days} days'` : null;

console.log(`cleanup_old_datasets: days=${days} confirm=${confirm}`);
if (!confirm) {
  console.log('To actually run deletion set CONFIRM=1. Exiting.');
  process.exit(0);
}

try {
  if (threshold) {
    console.log(`Deleting datasets older than ${days} days...`);
    await pool.query(`DELETE FROM dataset_recipients WHERE dataset_id IN (SELECT id FROM datasets WHERE created_at < ${threshold})`);
    const res = await pool.query(`DELETE FROM datasets WHERE created_at < ${threshold} RETURNING id`);
    console.log(`Deleted ${res.rowCount} datasets`);
  } else {
    console.log('Deleting ALL datasets and recipients...');
    await pool.query(`TRUNCATE TABLE dataset_recipients CASCADE`);
    const res = await pool.query(`DELETE FROM datasets RETURNING id`);
    console.log(`Deleted ${res.rowCount} datasets`);
  }
} catch (e) {
  console.error('Error during cleanup', e);
  process.exit(2);
} finally {
  await pool.end();
}

console.log('Cleanup completed.');
