import { Pool } from 'pg';
import fs from 'fs';

const envPath = '/opt/ingestion-system/.env';
if (fs.existsSync(envPath)) {
  // load env
  const env = fs.readFileSync(envPath, 'utf8');
  env.split(/\r?\n/).forEach((line) => {
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx === -1) return;
    const k = line.slice(0, idx);
    const v = line.slice(idx + 1);
    process.env[k] = v;
  });
}

const cs = process.env.DATABASE_URL;
console.log('Using DATABASE_URL=', cs ? cs.split('@')[0] + '@' + (cs.split('@')[1] ? cs.split('@')[1].split('/')[0] : '') : '<none>');

if (!cs) {
  console.error('No DATABASE_URL');
  process.exit(2);
}

const pool = new Pool({ connectionString: cs });

(async () => {
  try {
    const res = await pool.query("SELECT current_user, inet_server_addr() as addr, inet_server_port() as port");
    console.log('connected rows=', res.rows);
  } catch (e) {
    console.error('connect error', e.message);
    process.exitCode = 3;
  } finally {
    await pool.end();
  }
})();
