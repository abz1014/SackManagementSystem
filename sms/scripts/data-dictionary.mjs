// data-dictionary.mjs — generate DATA-DICTIONARY.md at the repository root from
// the APP database's own catalogue plus db/dictionary.json (roadmap Phase 3
// item 6, 14 Sep 2026).
//
// WHAT IS READ. INFORMATION_SCHEMA.COLUMNS (type, nullability, default, in
// ordinal order) and sys.extended_properties (MS_Description, none today) from
// the app database in .env — the same loader as migrate.mjs. Never IFL's
// databases: this documents what SMS owns.
//
// WHAT IS WRITTEN. One section per table in sms / sms_raw, a column table per
// section, and a "Provenance chain" section explaining raw → canonical →
// sync_run → source_epoch. Descriptions come from db/dictionary.json; a column
// the JSON does not name is marked UNDESCRIBED so the gap is visible in the
// document rather than silent, and the run exits 1 if any REQUIRED table (the
// canonical, raw and configuration tables the roadmap names) has one.
//
// Usage:  npm run dictionary        (from sms/)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sql from 'mssql';

const __dirname = dirname(fileURLToPath(import.meta.url));
const smsRoot = join(__dirname, '..');
const repoRoot = join(smsRoot, '..');
const OUT = join(repoRoot, 'DATA-DICTIONARY.md');

// minimal .env loader (no dependency) — identical to migrate.mjs ------------
function loadEnv() {
  try {
    const text = readFileSync(join(smsRoot, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    console.warn('No .env found — relying on process environment.');
  }
}

/** Tables the roadmap requires every column of to be described. */
const REQUIRED = new Set([
  'sms.cone_event', 'sms.sack_event', 'sms.reject_event',
  'sms_raw.cone_raw', 'sms_raw.sack_raw', 'sms_raw.reject_qcs_raw', 'sms_raw.reject_weight_raw',
  'sms.source_epoch', 'sms.sync_run', 'sms.dq_finding', 'sms.audit_log', 'sms.product_limit_version',
  'sms.product', 'sms.station', 'sms.machine', 'sms.line',
  'sms.shift_rule', 'sms.weight_rule', 'sms.plausibility_rule', 'sms.reject_code',
]);

/** Section order: the data model as a reader meets it, then everything else alphabetically. */
const ORDER = [
  'sms_raw.cone_raw', 'sms_raw.sack_raw', 'sms_raw.reject_qcs_raw', 'sms_raw.reject_weight_raw',
  'sms.cone_event', 'sms.sack_event', 'sms.reject_event',
  'sms.source_epoch', 'sms.sync_run', 'sms.dq_finding', 'sms.rebuild_audit', 'sms.app_config',
  'sms.plant', 'sms.plant_unit', 'sms.line', 'sms.machine', 'sms.station',
  'sms.data_source', 'sms.source_table',
  'sms.shift_rule', 'sms.weight_rule', 'sms.plausibility_rule', 'sms.reject_code',
  'sms.product', 'sms.product_limit_version', 'sms.product_timeline', 'sms.product_change',
  'sms.blend', 'sms.yarn_count', 'sms.tube_type', 'sms.unit',
  'sms.calibration_adjustment', 'sms.audit_log',
  'sms.role', 'sms.app_user', 'sms.session', 'sms.schema_migration',
];

function typeOf(c) {
  const t = c.DATA_TYPE;
  if (['varchar', 'nvarchar', 'char', 'nchar', 'varbinary', 'binary'].includes(t)) {
    const n = c.CHARACTER_MAXIMUM_LENGTH;
    return `${t}(${n === -1 ? 'max' : n})`;
  }
  if (['decimal', 'numeric'].includes(t)) return `${t}(${c.NUMERIC_PRECISION},${c.NUMERIC_SCALE})`;
  if (['datetime2', 'time', 'datetimeoffset'].includes(t)) return `${t}(${c.DATETIME_PRECISION})`;
  return t;
}

/** `((0))` → `0`, `(sysutcdatetime())` → `sysutcdatetime()`. */
function defaultOf(d) {
  if (d == null) return '';
  let s = String(d).trim();
  while (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1);
  return s;
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

async function main() {
  loadEnv();
  const config = {
    server: process.env.APP_DB_SERVER ?? '.\\SQLEXPRESS',
    port: process.env.APP_DB_PORT ? Number(process.env.APP_DB_PORT) : undefined,
    database: process.env.APP_DB_NAME ?? 'sms',
    user: process.env.APP_DB_USER,
    password: process.env.APP_DB_PASSWORD,
    options: {
      encrypt: (process.env.APP_DB_ENCRYPT ?? 'true') === 'true',
      trustServerCertificate: (process.env.APP_DB_TRUST_SERVER_CERTIFICATE ?? 'true') === 'true',
    },
  };
  const dictionary = JSON.parse(readFileSync(join(smsRoot, 'db', 'dictionary.json'), 'utf8'));

  const pool = await sql.connect(config);
  try {
    const cols = (
      await pool.request().query(`
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, IS_NULLABLE,
               COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION
          FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA IN ('sms', 'sms_raw')
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`)
    ).recordset;
    // MS_Description extended properties on tables (minor_id 0) and columns.
    // None exist today (migration 029 notes this); read anyway so a DBA who
    // adds one in SSMS sees it here without touching the JSON.
    const props = (
      await pool.request().query(`
        SELECT s.name AS sch, t.name AS tbl, c.name AS col, CAST(ep.value AS nvarchar(max)) AS descr
          FROM sys.extended_properties ep
          JOIN sys.tables t ON t.object_id = ep.major_id
          JOIN sys.schemas s ON s.schema_id = t.schema_id
          LEFT JOIN sys.columns c ON c.object_id = ep.major_id AND c.column_id = ep.minor_id
         WHERE ep.class = 1 AND ep.name = 'MS_Description' AND s.name IN ('sms', 'sms_raw')`)
    ).recordset;
    const applied = (
      await pool.request().query(`SELECT filename FROM sms.schema_migration ORDER BY filename`)
    ).recordset.map((r) => r.filename);

    const byTable = new Map();
    for (const c of cols) {
      const key = `${c.TABLE_SCHEMA}.${c.TABLE_NAME}`;
      if (!byTable.has(key)) byTable.set(key, []);
      byTable.get(key).push(c);
    }
    const propOf = (key, col) => props.find((p) => `${p.sch}.${p.tbl}` === key && (p.col ?? null) === col)?.descr ?? null;

    const tables = [...ORDER.filter((k) => byTable.has(k)), ...[...byTable.keys()].filter((k) => !ORDER.includes(k)).sort()];
    const undescribed = [];
    const out = [];

    out.push('# SMS data dictionary — the app-owned database');
    out.push('');
    out.push(`Generated ${new Date().toISOString()} by \`npm run dictionary\` (sms/scripts/data-dictionary.mjs) from ` +
      `\`${config.database}\` on \`${config.server}${config.port ? ',' + config.port : ''}\` — ${tables.length} tables, ` +
      `${cols.length} columns, ${applied.length} migrations applied (latest \`${applied[applied.length - 1] ?? 'none'}\`). ` +
      'Do not edit by hand: types, nullability and defaults are read from the catalogue; descriptions live in ' +
      '`sms/db/dictionary.json`. This documents the sidecar SMS owns; IFL\'s own tables are described in `SCHEMA.md`.');
    out.push('');
    out.push('**Two clocks.** Columns named `production_ts_utc` and `ingest_ts_utc` (and every raw `src_Date` / ' +
      '`src_ProductionDate`) hold the PLANT\'S wall clock labelled as UTC — IFL\'s own values, stored verbatim. ' +
      'Columns SMS writes itself (`ingested_at_utc`, `read_at_utc`, `started_at_utc`, `effective_from`, `changed_at`, `at_utc`, ...) ' +
      'are real UTC. On this plant the two are five hours apart; never compare them unconverted (CLAUDE.md, redesign rule 2).');
    out.push('');
    out.push('## Contents');
    out.push('');
    for (const key of tables) out.push(`- [${key}](#${key.replace(/[^a-z0-9_]/gi, '').toLowerCase()})`);
    out.push('- [Provenance chain](#provenance-chain)');
    out.push('');

    for (const key of tables) {
      const desc = dictionary[key] ?? {};
      const tableDescr = propOf(key, null) ?? desc._table ?? '_No description._';
      const anchor = key.replace(/[^a-z0-9_]/gi, '').toLowerCase();
      out.push(`<a id="${anchor}"></a>`);
      out.push(`## ${key}`);
      out.push('');
      out.push(tableDescr);
      out.push('');
      out.push('| Column | Type | Null | Default | Description |');
      out.push('|---|---|---|---|---|');
      for (const c of byTable.get(key)) {
        let d = propOf(key, c.COLUMN_NAME) ?? desc[c.COLUMN_NAME] ?? desc._default ?? null;
        if (d == null) {
          d = '**UNDESCRIBED** — add it to sms/db/dictionary.json';
          undescribed.push(`${key}.${c.COLUMN_NAME}`);
        }
        out.push(`| \`${c.COLUMN_NAME}\` | ${typeOf(c)} | ${c.IS_NULLABLE === 'YES' ? 'yes' : 'no'} | ${esc(defaultOf(c.COLUMN_DEFAULT))} | ${esc(d)} |`);
      }
      out.push('');
    }

    out.push('<a id="provenance-chain"></a>');
    out.push('## Provenance chain');
    out.push('');
    out.push([
      'Every reportable row can be walked back to the pass that read it and the physical generation of the IFL table it came from. Nothing in the chain is inferred; each link is a stored column.',
      '',
      '```',
      'IFL table (DATA_TP1U2.dbo.pack1_TP1U2, id = 5, ProductionDate, MachineNo, MaterialId, ...)',
      '   │  read by the sync-worker, one pass per minute, through the adapter sms.data_source.system_code names',
      '   ▼',
      'sms_raw.cone_raw          raw_id (SMS identity)  src_id = 5  source_epoch = 9  ingest_run_id = <pass>  read_at_utc = <real UTC>',
      '   │  transformed (pure function, transform_version 2), deduplicated on raw_id',
      '   ▼',
      'sms.cone_event            raw_id  source_row_id = 5  source_epoch = 9  ingest_run_id = <pass>  ingested_at_utc = read_at_utc',
      '   │                          │                        │',
      '   │                          │                        └──► sms.source_epoch (epoch_id = 9): WHICH pack1_TP1U2 — server, database,',
      '   │                          │                             create_date, fingerprint of the columns read, full column list, label',
      '   │                          └──► sms.sync_run (run_id = <pass>): when it was read, watermarks, rows read/written, outcome',
      '   └──► sms.dq_finding.subject_ref = raw_id: the first row a finding is about',
      '```',
      '',
      '1. **Source row → raw row.** `src_id` is IFL\'s `id`, unique only within a generation (IFL reset every identity to 1 on 2026-08-05). `source_epoch` says which generation; `(line_id, source_epoch, src_id)` is the raw dedupe key. `raw_id` is SMS\'s own identity and never repeats.',
      '2. **Raw row → canonical row.** `raw_id` is copied onto the canonical row and is unique there; the transform is deterministic, so `sms rebuild` reproduces the same rows. `source_row_id` and `source_epoch` are copied for the reader; `ingest_run_id` and `ingested_at_utc` are copied from the raw row — since transform version 2, never minted.',
      '3. **Canonical row → the pass.** `ingest_run_id = sms.sync_run.run_id`. The sync_run row says when the pass started and finished, what it read, and how it ended; the same id is the `correlationId` on the worker\'s log lines for that pass.',
      '4. **Canonical row → the generation.** `source_epoch = sms.source_epoch.epoch_id`. The epoch row is the identity of the physical table that was read: server, database, `create_date`, the fingerprint of the columns SMS depends on (a change halts the worker) and the full column list (a change raises the WARNING finding `source_columns_changed`).',
      '5. **Findings → rows.** `sms.dq_finding.subject_ref` is the `raw_id` of the first offending row for a finding about rows; `subject_table` says which raw or canonical table.',
      '',
      'The API exposes this chain on every register row and reading sheet as a `provenance` object (roadmap Phase 3 item 4); the TypeScript contracts are `ConeReading` / `SackReading` / `RejectEvent` / `Provenance` in `sms/shared/src/domain/canonical.ts`.',
    ].join('\n'));
    out.push('');

    writeFileSync(OUT, out.join('\n'), 'utf8');
    console.log(`wrote ${OUT}: ${tables.length} tables, ${cols.length} columns`);
    const missingRequired = undescribed.filter((k) => REQUIRED.has(k.slice(0, k.lastIndexOf('.'))));
    if (undescribed.length) console.warn(`${undescribed.length} column(s) undescribed: ${undescribed.join(', ')}`);
    if (missingRequired.length) {
      console.error(`FAIL: ${missingRequired.length} column(s) of required tables are undescribed`);
      process.exitCode = 1;
    }
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
