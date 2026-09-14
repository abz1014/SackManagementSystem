/**
 * Backfill sms_raw.* and sms.* `source_epoch` for rows ingested before epochs
 * existed. Run once, after migration 025 and before migration 026.
 *
 * NOT A MIGRATION, deliberately. scripts/migrate.mjs wraps each file in ONE
 * explicit transaction: a 204,076-row UPDATE inside it holds the transaction for
 * the whole run and grows the log by the size of the table, on a plant PC with a
 * modest disk. Here each chunk auto-commits, so the log truncates between chunks
 * and peak usage is one chunk.
 *
 * Resumable: the predicate is `source_epoch IS NULL`, so an interrupted run is
 * continued simply by running it again. Idempotent for the same reason.
 *
 * WHICH EPOCH EACH ROW BELONGS TO. Measured on this database, the boundaries are
 * exact and have no gap or overlap:
 *
 *   cone_raw          July 1..142,511  | simulator 142,512..204,076
 *   sack_raw          July 1..5,462    | simulator 5,463..8,201
 *   reject_qcs_raw    July 1..2,900    | simulator 2,901..4,203
 *   reject_weight_raw July 0..245      | simulator 246..366
 *
 * The simulator continued IFL's own identity counter rather than restarting it
 * (142,512 follows 142,511), which is why one unbroken id space holds two
 * genuinely different provenances — and why labelling it all one epoch would
 * have recorded a true fact while erasing the one that matters: half of it never
 * happened on a plant.
 *
 * Canonical rows are assigned by JOINing raw_id back to the raw row, never by
 * re-deriving the boundary — raw_id is our own identity and is the authority.
 *
 *   node scripts/backfill-source-epoch.mjs [--chunk=20000] [--dry]
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mssql from 'mssql';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(join(repo, '.env'), 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {
    /* rely on process.env */
  }
  return { ...out, ...process.env };
}

const env = loadEnv();
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const CHUNK = Number(args.chunk ?? 20000);
const DRY = args.dry === true;

/** Raw tables: the id boundary between the July generation and the simulator. */
const RAW = [
  { table: 'sms_raw.cone_raw', boundary: 142511, julyEpoch: 1, simEpoch: 5 },
  { table: 'sms_raw.sack_raw', boundary: 5462, julyEpoch: 2, simEpoch: 6 },
  { table: 'sms_raw.reject_qcs_raw', boundary: 2900, julyEpoch: 3, simEpoch: 7 },
  { table: 'sms_raw.reject_weight_raw', boundary: 245, julyEpoch: 4, simEpoch: 8 },
];

/** Canonical tables: assigned by raw_id, optionally split by reject_type. */
const CANON = [
  { table: 'sms.cone_event', alias: 'ce', raw: 'sms_raw.cone_raw', where: '' },
  { table: 'sms.sack_event', alias: 'se', raw: 'sms_raw.sack_raw', where: '' },
  {
    table: 'sms.reject_event',
    alias: 're',
    raw: 'sms_raw.reject_qcs_raw',
    where: " AND re.reject_type = 'quality'",
  },
  {
    table: 'sms.reject_event',
    alias: 're',
    raw: 'sms_raw.reject_weight_raw',
    where: " AND re.reject_type = 'weight'",
  },
];

async function chunked(pool, label, sql) {
  let total = 0;
  for (;;) {
    const r = await pool.request().query(sql);
    const n = r.rowsAffected[0] ?? 0;
    total += n;
    if (n > 0) process.stdout.write(`  ${label}: ${total}\r`);
    if (n === 0) break;
  }
  console.log(`  ${label}: ${total} rows`.padEnd(60));
  return total;
}

async function main() {
  const pool = await new mssql.ConnectionPool({
    server: env.APP_DB_SERVER ?? 'localhost',
    port: Number(env.APP_DB_PORT ?? 1433),
    database: env.APP_DB_NAME ?? 'sms',
    user: env.APP_DB_USER,
    password: env.APP_DB_PASSWORD,
    options: {
      encrypt: (env.APP_DB_ENCRYPT ?? 'true') === 'true',
      trustServerCertificate: (env.APP_DB_TRUST_SERVER_CERTIFICATE ?? 'true') === 'true',
      useUTC: true,
    },
    // Chunks are small, but a scan over 204k rows to FIND the next chunk is not
    // instant on a cold cache. The 15s default is the wrong ceiling here.
    requestTimeout: 600_000,
  }).connect();

  try {
    if (DRY) {
      console.log('dry run — what would be assigned:\n');
      for (const r of RAW) {
        const q = await pool.request().query(`
          SELECT SUM(CASE WHEN src_id <= ${r.boundary} THEN 1 ELSE 0 END) AS july_,
                 SUM(CASE WHEN src_id >  ${r.boundary} THEN 1 ELSE 0 END) AS sim_,
                 SUM(CASE WHEN source_epoch IS NULL THEN 1 ELSE 0 END)    AS todo_
          FROM ${r.table}`);
        const x = q.recordset[0];
        console.log(
          `  ${r.table.padEnd(26)} epoch ${r.julyEpoch} <- ${x.july_}   epoch ${r.simEpoch} <- ${x.sim_}   (unassigned ${x.todo_})`,
        );
      }
      return 0;
    }

    console.log('backfilling source_epoch\n\nraw:');
    for (const r of RAW) {
      await chunked(
        pool,
        r.table,
        `UPDATE TOP (${CHUNK}) ${r.table}
            SET source_epoch = CASE WHEN src_id <= ${r.boundary} THEN ${r.julyEpoch} ELSE ${r.simEpoch} END
          WHERE source_epoch IS NULL`,
      );
    }

    console.log('\ncanonical (assigned by raw_id, not by re-deriving the boundary):');
    for (const c of CANON) {
      await chunked(
        pool,
        `${c.table}${c.where ? c.where.replace(' AND re.reject_type =', ' ') : ''}`,
        `UPDATE TOP (${CHUNK}) ${c.alias}
            SET ${c.alias}.source_epoch = r.source_epoch
           FROM ${c.table} ${c.alias}
           JOIN ${c.raw} r ON r.raw_id = ${c.alias}.raw_id
          WHERE ${c.alias}.source_epoch IS NULL${c.where}`,
      );
    }

    // Verification is the point of the exercise, not a formality: a NULL left
    // anywhere means migration 026's NOT NULL will fail, and worse, it means a
    // row whose generation we cannot name.
    console.log('\nverifying — every row must now name its generation:');
    let bad = 0;
    for (const t of [...RAW.map((r) => r.table), 'sms.cone_event', 'sms.sack_event', 'sms.reject_event']) {
      const q = await pool.request().query(
        `SELECT COUNT(*) n FROM ${t} WHERE source_epoch IS NULL`,
      );
      const n = Number(q.recordset[0].n);
      if (n > 0) bad += n;
      console.log(`  ${t.padEnd(26)} ${n === 0 ? 'ok' : `${n} STILL NULL`}`);
    }

    const dist = await pool.request().query(`
      SELECT e.epoch_id, e.source_table, e.provenance, COUNT(x.src_id) AS raw_rows
        FROM sms.source_epoch e
        LEFT JOIN (
          SELECT source_epoch, src_id FROM sms_raw.cone_raw
          UNION ALL SELECT source_epoch, src_id FROM sms_raw.sack_raw
          UNION ALL SELECT source_epoch, src_id FROM sms_raw.reject_qcs_raw
          UNION ALL SELECT source_epoch, src_id FROM sms_raw.reject_weight_raw
        ) x ON x.source_epoch = e.epoch_id
       GROUP BY e.epoch_id, e.source_table, e.provenance
       ORDER BY e.epoch_id`);
    console.log('\nrows per epoch:');
    for (const r of dist.recordset) {
      console.log(
        `  ${String(r.epoch_id).padStart(2)}  ${r.source_table.padEnd(22)} ${r.provenance.padEnd(10)} ${String(r.raw_rows).padStart(8)}`,
      );
    }

    if (bad > 0) {
      console.error(`\nFAILED: ${bad} rows still have no epoch. Re-run to continue.`);
      return 1;
    }
    console.log('\ndone. Next: purge the simulator epoch, then apply migration 026.');
    return 0;
  } finally {
    await pool.close();
  }
}

main()
  .then((c) => process.exit(c))
  .catch((err) => {
    console.error(`backfill failed: ${err?.message ?? err}`);
    process.exit(1);
  });
