import 'dotenv/config';
import { getDatabasePool } from './dist/db/pool.js';
const pool = getDatabasePool();
pool.query('SELECT dataset_id, total_count, processed_count FROM jobs WHERE type=''sending'' ORDER BY created_at DESC LIMIT 5').then(res => { console.log(res.rows); process.exit(0); });

