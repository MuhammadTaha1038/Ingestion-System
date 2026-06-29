import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const SRC = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
const DST = process.env.DEST_DATABASE_URL || process.env.VPS_DB_URL || `postgresql://ingestion_user:Ingestion2026!@localhost:5432/ingestion_db`;

if (!SRC || !DST) {
  console.error('Require SOURCE_DATABASE_URL and DEST_DATABASE_URL (or DATABASE_URL/VPS_DB_URL) in env');
  process.exit(2);
}

const srcPool = new pg.Pool({ connectionString: SRC, ssl: { rejectUnauthorized: false } });
const dstPool = new pg.Pool({ connectionString: DST, ssl: { rejectUnauthorized: false } });

async function listTables(client) {
  const res = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')
    ORDER BY table_schema, table_name
  `);
  return res.rows.map(r => `${r.table_schema}.${r.table_name}`);
}

async function getRowCount(client, schemaTable) {
  const [schema, table] = schemaTable.split('.');
  const res = await client.query(`SELECT count(*)::bigint as c FROM ${schema}.${table}`);
  return Number(res.rows[0].c);
}

async function getPrimaryKeyCols(client, schemaTable) {
  const [schema, table] = schemaTable.split('.');
  const res = await client.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.constraint_schema = kcu.constraint_schema
     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2
     ORDER BY kcu.ordinal_position`,
    [schema, table]
  );
  return res.rows.map(r => r.column_name);
}

function colList(cols) {
  return cols.map(c => `COALESCE(${c}::text,'')`).join("||'|'||");
}

async function tableChecksum(client, schemaTable) {
  const [schema, table] = schemaTable.split('.');
  const pk = await getPrimaryKeyCols(client, schemaTable);
  let orderBy = '';
  let expr = '';
  if (pk.length) {
    orderBy = `ORDER BY ${pk.map(c => c).join(',')}`;
    expr = colList(pk);
  } else {
    // fallback: use all columns (constructed dynamically)
    const colsRes = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`,
      [schema, table]
    );
    const cols = colsRes.rows.map(r => r.column_name);
    expr = colList(cols);
    orderBy = `ORDER BY ${cols.map(c => c).join(',')}`;
  }

  const sql = `SELECT md5(string_agg(md5((${expr})::text), '')) as checksum FROM (SELECT ${expr} as row_repr FROM ${schema}.${table} ${orderBy}) t`;
  try {
    const res = await client.query(sql);
    return res.rows[0].checksum || null;
  } catch (err) {
    return `ERROR: ${err.message}`;
  }
}

async function main() {
  const srcClient = await srcPool.connect();
  const dstClient = await dstPool.connect();
  try {
    console.log('Listing tables from source...');
    const srcTables = await listTables(srcClient);
    console.log('Listing tables from destination...');
    const dstTables = await listTables(dstClient);

    const all = Array.from(new Set([...srcTables, ...dstTables]));

    const report = [];
    for (const t of all) {
      const inSrc = srcTables.includes(t);
      const inDst = dstTables.includes(t);
      const rowSrc = inSrc ? await getRowCount(srcClient, t) : null;
      const rowDst = inDst ? await getRowCount(dstClient, t) : null;
      let checksumSrc = null;
      let checksumDst = null;
      if (inSrc) checksumSrc = await tableChecksum(srcClient, t);
      if (inDst) checksumDst = await tableChecksum(dstClient, t);

      report.push({ table: t, inSrc, inDst, rowSrc, rowDst, checksumSrc, checksumDst });
      console.log(`\nTable: ${t}\n  inSrc: ${inSrc}  inDst: ${inDst}\n  rows: src=${rowSrc}  dst=${rowDst}\n  checksum: src=${checksumSrc}  dst=${checksumDst}\n`);
    }

    const mismatches = report.filter(r => !r.inSrc || !r.inDst || r.rowSrc !== r.rowDst || String(r.checksumSrc) !== String(r.checksumDst));
    console.log('\nSummary:');
    console.log(`  tables scanned: ${all.length}`);
    console.log(`  mismatches: ${mismatches.length}`);
    if (mismatches.length) {
      console.log('MISMATCHES DETAIL:');
      for (const m of mismatches) {
        console.log(JSON.stringify(m, null, 2));
      }
      process.exitCode = 3;
    } else {
      console.log('All tables and checksums match. Migration appears consistent.');
    }
  } finally {
    srcClient.release();
    dstClient.release();
    await srcPool.end();
    await dstPool.end();
  }
}

main().catch(err => { console.error('Verification error:', err); process.exit(1); });
