/**
 * Plant simulator — synthetic source data for rehearsing go-live.
 *
 * WHY THIS EXISTS. The supplied copy of IFL's database ends on 10 Jul 2026, so
 * every screen in this app has only ever been seen against data that stopped
 * weeks ago. Behaviour that only appears when readings are arriving now — the
 * live screens, the wall display, the sync cadence, the data-quality checks —
 * has never actually been exercised. This writes plausible readings so it can
 * be.
 *
 * WHERE IT WRITES, AND WHY NOT WHERE YOU MIGHT EXPECT. It writes to a SEPARATE
 * database, `DATA_TP1U2_SIM`, never to `DATA_TP1U2`. Two reasons, and both are
 * load-bearing:
 *
 *   1. IFL's databases are read-only to this project. That rule does not get a
 *      local-copy exemption, because a script that can write to a database
 *      called DATA_TP1U2 is one wrong connection string away from writing to
 *      the plant's. The guards below refuse any target whose name does not end
 *      in _SIM, and any server that is not local.
 *   2. The 19 real days are reference data. Every measured figure in
 *      CAPABILITIES.md was checked against them, and mixing invented rows into
 *      that set would quietly make all of it unverifiable.
 *
 * Because the sidecar's dev-to-live switch is just a connection string, feeding
 * the app from the simulator is the same one-line change as the real cutover:
 * point IFL_DB_NAME_DATA at DATA_TP1U2_SIM. Everything downstream — reader,
 * schema-fingerprint gate, raw layer, transform, data-quality checks, API,
 * screens — runs exactly as it will in the plant. Nothing is injected past it.
 *
 * IDs CONTINUE FROM THE REAL DATA. The sync watermark is the highest source id
 * already ingested, so rows numbered from 1 would be silently skipped as
 * already-seen. Each stream therefore starts above the real maximum
 * (cones 142511, sacks 5462, quality rejects 2900, weight rejects 245).
 *
 * THE ACQUISITION LAG IS REPRODUCED, and it matters more than it looks. In the
 * real data a cone's row is inserted about 18 minutes after the cone was
 * actually weighed (measured: 909 s minimum, 1090 s mean, over 142,509 rows).
 * So the newest production timestamp available to this software is always a
 * quarter of an hour old, even while the line runs flat out. Any simulator that
 * ignored that would produce data this app handles better than it will handle
 * the plant's.
 *
 * Usage, from the `sms` directory:
 *   node scripts/simulate-plant.mjs --check           verify schema + counts
 *   node scripts/simulate-plant.mjs --days=7          backfill 7 days to now
 *   node scripts/simulate-plant.mjs --live            keep appending, real time
 *   node scripts/simulate-plant.mjs --reset           empty the sim tables
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import mssql from 'mssql';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

/* ----------------------------------------------------------------- config */

function loadEnv() {
  const out = {};
  try {
    for (const line of readFileSync(join(repo, '.env'), 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {
    /* no .env — rely on process.env */
  }
  return { ...out, ...process.env };
}

const env = loadEnv();
const SIM_DB = env.SIM_DB_NAME ?? 'DATA_TP1U2_SIM';
const SERVER = (env.IFL_DB_SERVER ?? 'localhost').replace(/\\.*$/, '') || 'localhost';
const PORT = Number(env.IFL_DB_PORT ?? 1433);

/**
 * Two refusals, not one. The name check stops this pointing at DATA_TP1U2 even
 * by typo; the host check stops it reaching a plant server even if someone
 * creates a database called something_SIM there.
 */
function requireEnv(name) {
  const v = env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. Put it in sms/.env beside SIM_DB_NAME and SIM_DB_USER. ` +
        `This script never carries a default password.`,
    );
  }
  return v;
}

function assertSafeTarget() {
  if (!/_SIM$/i.test(SIM_DB)) {
    throw new Error(
      `refusing to write to "${SIM_DB}": the simulator only ever writes to a database whose name ends in _SIM. ` +
        `IFL's own databases are read-only to this project.`,
    );
  }
  const local = ['localhost', '127.0.0.1', '.', '(local)', '::1'];
  if (!local.includes(SERVER.toLowerCase())) {
    throw new Error(
      `refusing to write to server "${SERVER}": the simulator only runs against a local instance. ` +
        `Never point it at a plant server.`,
    );
  }
}

const connect = () =>
  mssql.connect({
    server: SERVER,
    port: PORT,
    database: SIM_DB,
    user: env.SIM_DB_USER ?? 'sms_sim',
    // No default. Working rule 1: credentials come from the environment only.
    password: requireEnv('SIM_DB_PASSWORD'),
    options: { encrypt: env.IFL_DB_ENCRYPT === 'true', trustServerCertificate: true, useUTC: true },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
  });

/* ------------------------------------------------------------------ clock */

/**
 * The plant's wall clock, expressed as milliseconds in "UTC space".
 *
 * Production timestamps in IFL's data are the plant's local wall clock stored
 * in a naive datetime column, which this codebase reads back as UTC-labelled
 * (see sync-worker/transform/wallClock.ts and web/src/format.ts). Every
 * timestamp generated here is built the same way, so a row written at 14:05
 * plant time stores 14:05 and reads back as 14:05 everywhere.
 */
const plantNowMs = () => Date.now() - new Date().getTimezoneOffset() * 60_000;
const asDate = (ms) => new Date(ms);

const SHIFT_OF_HOUR = (h) => (h >= 6 && h < 14 ? 'Morning' : h >= 14 && h < 22 ? 'Evening' : 'Night');

/**
 * The plant's own Shift column, derived from INSERT time rather than
 * production time. That is how IFL's acquisition layer fills it, and it is why
 * the stored value disagrees with the truth on about 4.45% of real rows
 * (SCHEMA.md DQ-4). Reproduced deliberately: the app corrects this, and the
 * correction needs something to correct.
 */
const shiftFromInsert = (insertMs) => SHIFT_OF_HOUR(new Date(insertMs).getUTCHours());

/* ------------------------------------------------------------------- rand */

/** Seeded so a rerun with the same window produces the same plant. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = rng(20260902);

const gauss = (mean, sd) => {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pick = (buckets) => {
  let r = rand();
  for (const b of buckets) {
    r -= b.p;
    if (r <= 0) return b;
  }
  return buckets[buckets.length - 1];
};
const uniform = (lo, hi) => lo + rand() * (hi - lo);
const logUniform = (lo, hi) => Math.exp(uniform(Math.log(lo), Math.log(hi)));

/* -------------------------------------------------- measured plant shape */
/* Every constant below was measured against the 19 real days, not invented.  */

/** Inter-cone gaps, in seconds, as observed (142,507 gaps). The long tails
 *  ARE the stoppages — no separate stoppage mechanism is needed or wanted. */
const CONE_GAP_BUCKETS = [
  { p: 0.3160, lo: 0.6, hi: 5 },
  { p: 0.4555, lo: 5, hi: 15 },
  { p: 0.2208, lo: 15, hi: 60 },
  { p: 0.0069, lo: 60, hi: 300 },
  { p: 0.00068, lo: 300, hi: 1800 },
  { p: 0.00012, lo: 1800, hi: 5400 },
];
/** Tuned so the day lands near the observed 8,100 cones; the SHAPE above is
 *  empirical, this only sets the rate. */
const GAP_SCALE = 0.80;

/** Sack intervals, in seconds, as observed (5,376 gaps). */
const SACK_GAP_BUCKETS = [
  { p: 0.8288, lo: 120, hi: 240 },
  { p: 0.1406, lo: 240, hi: 600 },
  { p: 0.0445, lo: 600, hi: 3600 },
  { p: 0.0017, lo: 3600, hi: 9000 },
];

const CONE_WEIGHT_MEAN = 1951.5;
const CONE_WEIGHT_SD = 8.5;
const CONE_IN_RANGE_P = 0.997;
const SACK_WEIGHT_MEAN = 47.25;
const SACK_WEIGHT_SD = 0.08;
const STATIONS = 14;
const HANGERS = 299;

/** Station 4 runs light in the real data (-2.92 g against the line average).
 *  Kept, so the per-station and calibration screens have a real signal. */
const STATION_BIAS = { 4: -2.9, 10: 1.4, 13: -1.1 };

/** Rejects as a share of everything weighed, and the split between the two
 *  streams (2,899 quality against 246 weight). */
const REJECT_RATE = 0.022;
const QUALITY_SHARE = 0.922;

/** Quality inspection codes, in the observed Pareto order. */
const QCS_CODES = [
  { p: 0.597, tube: 10, mat: 1 },
  { p: 0.264, tube: 2, mat: 1 },
  { p: 0.070, tube: 1, mat: 2 },
  { p: 0.029, tube: 1, mat: 1 },
  { p: 0.013, tube: 9, mat: 1 },
  { p: 0.011, tube: 2, mat: 2 },
  { p: 0.008, tube: 3, mat: 1 },
  { p: 0.008, tube: 10, mat: 2 },
];

/** Acquisition lag, seconds: how long after weighing a row appears. */
const LAG_MIN = 909;
const LAG_MAX = 1245;
const sampleLagMs = () => Math.round(gauss(1090, 70)) * 1000;
const clampLag = (ms) => Math.min(LAG_MAX * 1000, Math.max(LAG_MIN * 1000, ms));

/* --------------------------------------------------------------- generate */

/**
 * Produce every row whose PRODUCTION time falls in [fromMs, toMs).
 *
 * `insertAt` decides each row's Date column. In backfill it is the production
 * time plus the acquisition lag; in live mode it is the moment the tick runs,
 * because that is what the plant's acquisition layer does.
 */
function generate(fromMs, toMs, ids, state, insertAt) {
  const cones = [];
  const sacks = [];
  const qcs = [];
  const wrej = [];

  let t = state.coneCursor > fromMs ? state.coneCursor : fromMs;
  let nextSack = state.sackCursor > fromMs ? state.sackCursor : fromMs + pickGap(SACK_GAP_BUCKETS) * 1000;

  while (t < toMs) {
    t += pickGap(CONE_GAP_BUCKETS) * GAP_SCALE * 1000;
    if (t >= toMs) break;

    const station = 1 + Math.floor(rand() * STATIONS);
    const hanger = 1 + Math.floor(rand() * HANGERS);
    const insertMs = insertAt(t);
    const shift = shiftFromInsert(insertMs);

    // Is this weighing a reject rather than an accepted cone?
    if (rand() < REJECT_RATE) {
      if (rand() < QUALITY_SHARE) {
        const c = pick(QCS_CODES);
        qcs.push({
          id: ids.qcs++, Date: asDate(insertMs), Shift: shift, Area: 'Package-1',
          ProductionDate: asDate(t), HangerNum: hanger, Source: station, Lifter: station,
          TubeInspectResult: c.tube, MaterialInspectResult: c.mat,
        });
      } else {
        // Over- and underweight, matching the observed 2010 g average.
        const w = rand() < 0.7 ? gauss(2055, 55) : gauss(1890, 45);
        wrej.push({
          id: ids.wrej++, Date: asDate(insertMs), Shift: shift, Area: 'Package-1',
          ProductionDate: asDate(t), HangerNum: hanger, Source: station, Lifter: station,
          Weight: round2(Math.max(0, w)),
        });
      }
    } else {
      let w = gauss(CONE_WEIGHT_MEAN + (STATION_BIAS[station] ?? 0), CONE_WEIGHT_SD);
      const inRange = rand() < CONE_IN_RANGE_P;
      if (!inRange) w += rand() < 0.5 ? -uniform(25, 45) : uniform(25, 45);
      // One implausible reading roughly every other day, as the real data has:
      // a scale fault, not a light cone. Exercises the DQ outlier check.
      if (rand() < 0.00012) w = uniform(200, 900);
      cones.push({
        id: ids.cone++, Date: asDate(insertMs), Shift: shift, Area: 'Package-1',
        ProductionDate: asDate(t), HangerNum: hanger, Source: station, Lifter: station,
        Weight: round2(w), inRange: inRange ? 1 : 0,
      });
    }

    while (nextSack <= t) {
      const insertSack = insertAt(nextSack);
      let kg = gauss(SACK_WEIGHT_MEAN, SACK_WEIGHT_SD);
      const sackInRange = rand() < 0.985;
      if (!sackInRange) kg += rand() < 0.5 ? -uniform(0.3, 1.2) : uniform(0.3, 1.2);
      // The SackNum counter resets to zero occasionally in the real data
      // (DQ-3). Reproduced so nothing downstream starts trusting it as a key.
      if (rand() < 0.0004) state.sackNum = 0;
      sacks.push({
        id: ids.sack++, Date: asDate(insertSack), Shift: shiftFromInsert(insertSack), Area: 'Sack-1',
        SackNum: state.sackNum++, Weight: round3(kg), inRange: sackInRange ? 1 : 0,
      });
      nextSack += pickGap(SACK_GAP_BUCKETS) * 1000;
    }
  }

  state.coneCursor = t;
  state.sackCursor = nextSack;
  return { cones, sacks, qcs, wrej };
}

const pickGap = (buckets) => {
  const b = pick(buckets);
  return logUniform(b.lo, b.hi);
};
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

/* ------------------------------------------------------------------ write */

async function insertRows(pool, table, rows, shape) {
  if (rows.length === 0) return 0;
  const t = new mssql.Table(table);
  t.create = false;
  // Nullability must match the table exactly or bcp refuses the batch with
  // "Invalid column type from bcp client". `id` is the NOT NULL primary key.
  for (const [name, type] of shape) {
    t.columns.add(name, type, { nullable: name !== 'id', primary: name === 'id' });
  }
  for (const r of rows) t.rows.add(...shape.map(([name]) => r[name]));
  const res = await pool.request().bulk(t);
  return res.rowsAffected ?? rows.length;
}

const CONE_SHAPE = [
  ['id', mssql.Int], ['Date', mssql.DateTime], ['Shift', mssql.VarChar(8)], ['Area', mssql.VarChar(10)],
  ['ProductionDate', mssql.DateTime], ['HangerNum', mssql.Int], ['Source', mssql.Int], ['Lifter', mssql.Int],
  ['Weight', mssql.Decimal(6, 2)], ['inRange', mssql.Bit],
];
const SACK_SHAPE = [
  ['id', mssql.Int], ['Date', mssql.DateTime], ['Shift', mssql.VarChar(8)], ['Area', mssql.VarChar(10)],
  ['SackNum', mssql.Int], ['Weight', mssql.Decimal(6, 3)], ['inRange', mssql.Bit],
];
const QCS_SHAPE = [
  ['id', mssql.Int], ['Date', mssql.DateTime], ['Shift', mssql.VarChar(8)], ['Area', mssql.VarChar(10)],
  ['ProductionDate', mssql.DateTime], ['HangerNum', mssql.Int], ['Source', mssql.Int], ['Lifter', mssql.Int],
  ['TubeInspectResult', mssql.Int], ['MaterialInspectResult', mssql.Int],
];
const WREJ_SHAPE = [
  ['id', mssql.Int], ['Date', mssql.DateTime], ['Shift', mssql.VarChar(8)], ['Area', mssql.VarChar(10)],
  ['ProductionDate', mssql.DateTime], ['HangerNum', mssql.Int], ['Source', mssql.Int], ['Lifter', mssql.Int],
  ['Weight', mssql.Decimal(6, 2)],
];

async function writeAll(pool, batch) {
  const n = { cones: 0, sacks: 0, qcs: 0, wrej: 0 };
  n.cones = await insertRows(pool, 'pack1_TP1U2', batch.cones, CONE_SHAPE);
  n.sacks = await insertRows(pool, 'sack1_TP1U2', batch.sacks, SACK_SHAPE);
  n.qcs = await insertRows(pool, 'rejectQCS1_TP1U2', batch.qcs, QCS_SHAPE);
  n.wrej = await insertRows(pool, 'rejectWeight1_TP1U2', batch.wrej, WREJ_SHAPE);
  return n;
}

/* ------------------------------------------------------------------ state */

/** Real-data maxima. New ids must exceed these or the sync treats them as
 *  already seen and reads nothing. */
const REAL_MAX = { cone: 142511, sack: 5462, qcs: 2900, wrej: 245 };
const REAL_MAX_SACKNUM = 9652;

async function loadState(pool) {
  const r = await pool.request().query(`
    SELECT
      (SELECT ISNULL(MAX(id), 0) FROM pack1_TP1U2) AS cone,
      (SELECT ISNULL(MAX(id), 0) FROM sack1_TP1U2) AS sack,
      (SELECT ISNULL(MAX(id), 0) FROM rejectQCS1_TP1U2) AS qcs,
      (SELECT ISNULL(MAX(id), 0) FROM rejectWeight1_TP1U2) AS wrej,
      (SELECT ISNULL(MAX(SackNum), 0) FROM sack1_TP1U2) AS sackNum,
      (SELECT MAX(ProductionDate) FROM pack1_TP1U2) AS lastProd`);
  const row = r.recordset[0];
  return {
    ids: {
      cone: Math.max(row.cone, REAL_MAX.cone) + 1,
      sack: Math.max(row.sack, REAL_MAX.sack) + 1,
      qcs: Math.max(row.qcs, REAL_MAX.qcs) + 1,
      wrej: Math.max(row.wrej, REAL_MAX.wrej) + 1,
    },
    sackNum: Math.max(row.sackNum, REAL_MAX_SACKNUM) + 1,
    lastProdMs: row.lastProd ? new Date(row.lastProd).getTime() : null,
  };
}

/* ------------------------------------------------------------- fingerprint */

const DEPENDED = {
  pack1_TP1U2: ['id', 'Date', 'Shift', 'Area', 'ProductionDate', 'HangerNum', 'Source', 'Lifter', 'Weight', 'inRange'],
  sack1_TP1U2: ['id', 'Date', 'Shift', 'Area', 'SackNum', 'Weight', 'inRange'],
  rejectQCS1_TP1U2: ['id', 'Date', 'Shift', 'Area', 'ProductionDate', 'HangerNum', 'Source', 'Lifter', 'TubeInspectResult', 'MaterialInspectResult'],
  rejectWeight1_TP1U2: ['id', 'Date', 'Shift', 'Area', 'ProductionDate', 'HangerNum', 'Source', 'Lifter', 'Weight'],
};

/** Mirrors sync-worker/src/reader/fingerprint.ts exactly. If these disagree,
 *  the sync halts on a schema-drift alarm — which is the guard working. */
async function fingerprints(pool) {
  const out = {};
  for (const [table, cols] of Object.entries(DEPENDED)) {
    const r = await pool.request().input('t', mssql.NVarChar, table).query(
      `SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE, CHARACTER_MAXIMUM_LENGTH
         FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @t`,
    );
    const want = new Set(cols.map((c) => c.toLowerCase()));
    const sig = r.recordset
      .filter((c) => want.has(c.COLUMN_NAME.toLowerCase()))
      .map((c) =>
        `${c.COLUMN_NAME.toLowerCase()}:${c.DATA_TYPE.toLowerCase()}:` +
        `${c.NUMERIC_PRECISION ?? ''}:${c.NUMERIC_SCALE ?? ''}:${c.CHARACTER_MAXIMUM_LENGTH ?? ''}`)
      .sort()
      .join('|');
    out[table] = createHash('sha256').update(sig).digest('hex').slice(0, 32);
  }
  return out;
}

/* ------------------------------------------------------------------- main */

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};

async function main() {
  assertSafeTarget();
  const pool = await connect();
  console.log(`simulator -> ${SERVER}:${PORT}/${SIM_DB}`);

  if (flag('reset')) {
    await pool.request().query(
      `TRUNCATE TABLE pack1_TP1U2; TRUNCATE TABLE sack1_TP1U2;
       TRUNCATE TABLE rejectQCS1_TP1U2; TRUNCATE TABLE rejectWeight1_TP1U2;`,
    );
    console.log('sim tables emptied');
  }

  if (flag('check')) {
    const fp = await fingerprints(pool);
    console.log('schema fingerprints (must equal the values in sms.app_config):');
    for (const [t, f] of Object.entries(fp)) console.log(`  ${t.padEnd(22)} ${f}`);
    const s = await loadState(pool);
    const c = await pool.request().query(
      `SELECT (SELECT COUNT(*) FROM pack1_TP1U2) cones, (SELECT COUNT(*) FROM sack1_TP1U2) sacks,
              (SELECT COUNT(*) FROM rejectQCS1_TP1U2) qcs, (SELECT COUNT(*) FROM rejectWeight1_TP1U2) wrej,
              (SELECT MIN(ProductionDate) FROM pack1_TP1U2) firstProd,
              (SELECT MAX(ProductionDate) FROM pack1_TP1U2) lastProd`,
    );
    console.log('rows:', c.recordset[0]);
    console.log('next ids:', s.ids);
    await pool.close();
    return;
  }

  const days = Number(value('days', '0'));
  const state = await loadState(pool);
  const sim = { coneCursor: 0, sackCursor: 0, sackNum: state.sackNum };

  if (days > 0) {
    // Production runs up to (now - lag): a reading weighed more recently than
    // that has not reached the database yet, which is exactly the plant's
    // behaviour and the thing this rehearsal exists to expose.
    const now = plantNowMs();
    const lag = clampLag(sampleLagMs());
    const to = now - lag;
    const from = to - days * 86_400_000;
    console.log(
      `backfilling ${days} day(s): production ${new Date(from).toISOString()} -> ${new Date(to).toISOString()}` +
        ` (acquisition lag ${Math.round(lag / 1000)} s)`,
    );
    sim.coneCursor = from;
    sim.sackCursor = from;

    let total = { cones: 0, sacks: 0, qcs: 0, wrej: 0 };
    // A day at a time: keeps each bulk insert modest and shows progress.
    for (let d = 0; d < days; d++) {
      const a = from + d * 86_400_000;
      const b = Math.min(to, a + 86_400_000);
      const batch = generate(a, b, state.ids, sim, (prodMs) => prodMs + clampLag(sampleLagMs()));
      await writeAll(pool, batch);
      total = {
        cones: total.cones + batch.cones.length, sacks: total.sacks + batch.sacks.length,
        qcs: total.qcs + batch.qcs.length, wrej: total.wrej + batch.wrej.length,
      };
      console.log(
        `  ${new Date(a).toISOString().slice(0, 10)}  cones ${batch.cones.length}  sacks ${batch.sacks.length}` +
          `  quality rejects ${batch.qcs.length}  weight rejects ${batch.wrej.length}`,
      );
    }
    console.log('backfill total:', total);
  }

  if (flag('live')) {
    const tickMs = Number(value('tick', '15')) * 1000;
    console.log(`live mode: appending every ${tickMs / 1000} s. Ctrl+C to stop.`);
    if (sim.coneCursor === 0) {
      sim.coneCursor = state.lastProdMs ?? plantNowMs() - clampLag(sampleLagMs());
      sim.sackCursor = sim.coneCursor;
    }
    for (;;) {
      const now = plantNowMs();
      const target = now - clampLag(sampleLagMs());
      if (target > sim.coneCursor) {
        // Rows inserted NOW carry a production time ~18 minutes old.
        const batch = generate(sim.coneCursor, target, state.ids, sim, () => now);
        const n = await writeAll(pool, batch);
        if (n.cones || n.sacks || n.qcs || n.wrej) {
          console.log(
            `${new Date(now).toISOString().slice(11, 19)}  +${n.cones} cones  +${n.sacks} sacks` +
              `  +${n.qcs} quality  +${n.wrej} weight  (production up to ${new Date(target).toISOString().slice(11, 19)})`,
          );
        }
      }
      await new Promise((r) => setTimeout(r, tickMs));
    }
  }

  await pool.close();
}

main().catch((e) => {
  console.error('simulator failed:', e.message);
  process.exit(1);
});
