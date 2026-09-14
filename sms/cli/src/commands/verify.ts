/**
 * `sms verify` — reconcile source ⇄ raw ⇄ canonical PER SOURCE GENERATION, then
 * summarise merge-key collisions and DQ findings. Read-only on both databases.
 *
 * WHY PER GENERATION. IFL restarts its `id` counter whenever it recreates a
 * table (2026-08-05: all four wide tables, identities back to 1), so the app
 * database holds generations of the same source table side by side
 * (`sms.source_epoch`) while the source itself holds only the newest. The
 * previous verify compared whole tables — COUNT(source) = COUNT(raw) =
 * COUNT(canonical) — which is permanently MISMATCH the moment raw carries two
 * generations. An alarm that is always on is no alarm: a genuine loss of
 * 130,000 rows would have looked identical to the expected noise.
 *
 * WHAT IT ASSERTS, per source table:
 *
 *   1. The OPEN epoch against the live source — the only place the source is
 *      the authority. The source's create_date and column fingerprint must be
 *      the ones the epoch row records (otherwise the epoch describes a
 *      different physical table and every number below it is meaningless), and
 *      COUNT, MIN(id), MAX(id) AND SUM(id) must agree between the source table
 *      and `sms_raw.<t> WHERE source_epoch = <open>`. The sum catches the
 *      equal-missing/equal-extra case that COUNT alone passes. Any difference
 *      is a STOP. No open epoch at all is a STOP too: the worker halts on the
 *      same fact, so nothing is being synced.
 *
 *   2. CLOSED epochs — the source cannot corroborate them. They are reported as
 *      archived and only raw ⇄ canonical is checked.
 *
 *   3. raw ⇄ canonical BY KEY (`raw_id`), both directions, for every epoch. A
 *      count match can hide one row missing and one row duplicated.
 *
 * Exit 0 only when every table has an open epoch that reconciles and every
 * raw ⇄ canonical check is clean. Against a running worker the source can be a
 * few rows ahead of raw at any instant (the acquisition lag is ~18 min, the
 * pass is every 60 s); that is reported as a STOP with the reason, and the cure
 * is to re-run once the pass has settled — never to widen the tolerance.
 */
import mssql from 'mssql';
import type { ConnectionPool } from 'mssql';
import { IFL_TABLES, readSourceIdentity, type SourceIdentity } from '@sms/sync-worker';
import { openContext } from '../context.js';

type TableDef = (typeof IFL_TABLES)[number];

/** Where each raw table lands in canonical. reject_event is fed by TWO raw tables. */
const CANONICAL: Record<TableDef['key'], { table: string; typeFilter: string }> = {
  cone: { table: 'sms.cone_event', typeFilter: '' },
  sack: { table: 'sms.sack_event', typeFilter: '' },
  reject_qcs: { table: 'sms.reject_event', typeFilter: "AND c.reject_type = 'quality'" },
  reject_weight: { table: 'sms.reject_event', typeFilter: "AND c.reject_type = 'weight'" },
};

interface EpochRow {
  epoch_id: number;
  source_table: string;
  source_server: string;
  source_db: string;
  source_created_key: string;
  schema_fingerprint: string;
  provenance: string;
  label: string;
  closed_utc: Date | null;
}

/** The four numbers two sides must agree on. BIGINT arrives from the driver as a string. */
interface IdStats {
  n: number;
  lo: number | null;
  hi: number | null;
  sum: number | null;
}
const EMPTY: IdStats = { n: 0, lo: null, hi: null, sum: null };
const num = (v: unknown): number | null => (v == null ? null : Number(v));

const IND = '           '; // continuation indent under "  epoch NN  "
const fmtN = (v: number | null): string => (v === null ? '–' : String(v)).padStart(12);

async function sourceStats(ifl: ConnectionPool, def: TableDef): Promise<IdStats> {
  const r = await ifl
    .request()
    .query<{ n: number; lo: unknown; hi: unknown; s: unknown }>(
      `SELECT COUNT(*) n, MIN([id]) lo, MAX([id]) hi, SUM(CAST([id] AS BIGINT)) s
         FROM [${def.sourceTable}]`,
    );
  const x = r.recordset[0];
  return x ? { n: Number(x.n), lo: num(x.lo), hi: num(x.hi), sum: num(x.s) } : EMPTY;
}

/** One scan of the raw table gives every epoch's stats at once. */
async function rawStatsByEpoch(
  app: ConnectionPool,
  def: TableDef,
  line: number,
): Promise<Map<number, IdStats>> {
  const r = await app
    .request()
    .input('line', mssql.Int, line)
    .query<{ e: number; n: number; lo: unknown; hi: unknown; s: unknown }>(
      `SELECT source_epoch e, COUNT(*) n, MIN(src_id) lo, MAX(src_id) hi,
              SUM(CAST(src_id AS BIGINT)) s
         FROM ${def.rawTable}
        WHERE line_id = @line
        GROUP BY source_epoch`,
    );
  return new Map(
    r.recordset.map((x) => [
      Number(x.e),
      { n: Number(x.n), lo: num(x.lo), hi: num(x.hi), sum: num(x.s) },
    ]),
  );
}

/** raw → canonical and canonical → raw, by raw_id, within one epoch. */
async function keyGaps(
  app: ConnectionPool,
  def: TableDef,
  line: number,
  epoch: number,
): Promise<{ rawOnly: number; canonOnly: number }> {
  const canon = CANONICAL[def.key];
  const req = () => app.request().input('line', mssql.Int, line).input('e', mssql.Int, epoch);
  const a = await req().query<{ n: number }>(
    `SELECT COUNT(*) n FROM ${def.rawTable} r
      WHERE r.line_id = @line AND r.source_epoch = @e
        AND NOT EXISTS (SELECT 1 FROM ${canon.table} c
                         WHERE c.raw_id = r.raw_id ${canon.typeFilter})`,
  );
  const b = await req().query<{ n: number }>(
    `SELECT COUNT(*) n FROM ${canon.table} c
      WHERE c.line_id = @line AND c.source_epoch = @e ${canon.typeFilter}
        AND NOT EXISTS (SELECT 1 FROM ${def.rawTable} r WHERE r.raw_id = c.raw_id)`,
  );
  return { rawOnly: Number(a.recordset[0]?.n ?? 0), canonOnly: Number(b.recordset[0]?.n ?? 0) };
}

/**
 * Say WHICH way the open epoch disagrees with its source. The two directions
 * mean different things operationally, so they are named, not just counted.
 */
function diagnose(src: IdStats, raw: IdStats): string[] {
  const out: string[] = [];
  const lt = (a: number | null, b: number | null) => a !== null && b !== null && a < b;
  const sourceAhead = raw.n < src.n || lt(raw.hi, src.hi) || lt(src.lo, raw.lo) || (raw.n === 0 && src.n > 0);
  const weAhead = raw.n > src.n || lt(src.hi, raw.hi) || lt(raw.lo, src.lo);
  if (sourceAhead) {
    out.push(
      `→ the source has rows we do not (count ${raw.n - src.n >= 0 ? '+' : ''}${raw.n - src.n} on our side).`,
      `  If the worker is running they may not have arrived yet — re-run after its next pass.`,
      `  If it persists, the sync is incomplete or halted: check 'sms epoch:list' and sync_run.`,
    );
  }
  if (weAhead) {
    out.push(
      `→ we hold rows the source no longer does, inside an OPEN generation. That means rows`,
      `  were deleted at the source, or it was restored below our watermark; the worker's`,
      `  backwards gate halts on this. Read-only from here: an operator decides.`,
    );
  }
  if (!sourceAhead && !weAhead) {
    const d = (raw.sum ?? 0) - (src.sum ?? 0);
    out.push(
      `→ same count and id range, different ids (sum differs by ${d >= 0 ? '+' : ''}${d}): rows are`,
      `  missing on one side and extra on the other. COUNT alone would have passed this.`,
    );
  }
  return out;
}

export async function verify(): Promise<number> {
  const ctx = await openContext({ needIfl: true });
  const line = ctx.cfg.lineId;
  let stops = 0;
  let gapsChecked = 0;
  const stop = (msg: string): void => {
    stops++;
    console.log(msg);
  };

  try {
    // (a) Which source, which app DB. An OK from a verify pointed at the wrong
    //     copy must not read like an OK against the live server.
    console.log('verify — source ⇄ raw ⇄ canonical, per source generation\n');
    console.log(`  source   ${ctx.cfg.iflData.server}/${ctx.cfg.iflData.database}`);
    console.log(`  app      ${ctx.cfg.app.server}/${ctx.cfg.app.database}   (line ${line})`);

    // (b) The generations this line knows about.
    const epochs = (
      await ctx.app.request().input('line', mssql.Int, line).query<EpochRow>(
        `SELECT epoch_id, source_table, source_server, source_db, source_created_key,
                schema_fingerprint, provenance, label, closed_utc
           FROM sms.source_epoch
          WHERE line_id = @line
          ORDER BY epoch_id`,
      )
    ).recordset;

    console.log('\nSource generations');
    console.log(
      `   ${'id'.padStart(3)}  ${'table'.padEnd(20)} ${'provenance'.padEnd(10)} ${'state'.padEnd(6)} ${'raw rows'.padStart(9)}  label`,
    );
    const rawStats = new Map<TableDef['key'], Map<number, IdStats>>();
    for (const def of IFL_TABLES) rawStats.set(def.key, await rawStatsByEpoch(ctx.app, def, line));
    for (const e of epochs) {
      const def = IFL_TABLES.find((d) => d.sourceTable === e.source_table);
      const rows = def ? (rawStats.get(def.key)?.get(e.epoch_id)?.n ?? 0) : 0;
      console.log(
        `   ${String(e.epoch_id).padStart(3)}  ${e.source_table.padEnd(20)} ${e.provenance.padEnd(10)} ` +
          `${(e.closed_utc === null ? 'OPEN' : 'closed').padEnd(6)} ${String(rows).padStart(9)}  ${e.label}`,
      );
    }
    if (epochs.length === 0) console.log('   (none registered for this line)');

    console.log('\nReconciliation');
    for (const def of IFL_TABLES) {
      const canon = CANONICAL[def.key];
      const mine = epochs.filter((e) => e.source_table === def.sourceTable);
      const stats = rawStats.get(def.key) ?? new Map<number, IdStats>();
      console.log(
        `\n${def.sourceTable} → ${def.rawTable} → ${canon.table}` +
          (canon.typeFilter ? ` (${def.key === 'reject_qcs' ? 'quality' : 'weight'})` : ''),
      );

      // Every raw row must sit under one of THIS table's generations. The FK only
      // proves the epoch exists, not that it belongs to this table.
      for (const [e, s] of stats) {
        if (!mine.some((x) => x.epoch_id === e)) {
          stop(`  ${s.n} raw rows carry source_epoch ${e}, which is not a generation of ${def.sourceTable}   STOP`);
        }
      }

      // What the source says it is right now — needed for the open epoch, and
      // for the message when there is none.
      let now: SourceIdentity | null = null;
      let identityError: string | null = null;
      try {
        now = await readSourceIdentity(ctx.ifl, def, ctx.cfg.iflData);
      } catch (err) {
        identityError = err instanceof Error ? err.message : String(err);
      }

      for (const e of mine) {
        const raw = stats.get(e.epoch_id) ?? EMPTY;

        if (e.closed_utc !== null) {
          // (d) The source cannot corroborate a closed generation.
          console.log(
            `  epoch ${String(e.epoch_id).padEnd(3)} closed  — archived — ${raw.n} rows, source generation no longer present`,
          );
        } else {
          // (c) The open generation against the live source.
          console.log(
            `  epoch ${String(e.epoch_id).padEnd(3)} OPEN    registered as ${e.source_server}/${e.source_db} created ${e.source_created_key}`,
          );
          if (now === null) {
            stop(`${IND}identity   cannot read the source: ${identityError}   STOP`);
          } else {
            const sameSource =
              now.server === e.source_server &&
              now.database === e.source_db &&
              now.createdKey === e.source_created_key;
            const sameSchema = now.fingerprint === e.schema_fingerprint;
            if (!sameSource) {
              stop(
                `${IND}identity   source reports ${now.server}/${now.database} created ${now.createdKey}   STOP\n` +
                  `${IND}→ not the generation this epoch describes; its counts cannot be compared. Check\n` +
                  `${IND}  IFL_DB_SERVER / IFL_DB_NAME_DATA first — a wrong database looks exactly like this.\n` +
                  `${IND}  If the source really was rebuilt or repointed:\n` +
                  `${IND}    sms epoch:accept --table=${def.sourceTable} --confirm --label "<what this is>"`,
              );
            } else if (!sameSchema) {
              stop(
                `${IND}identity   create_date matches · fingerprint ${now.fingerprint} ≠ ${e.schema_fingerprint}   STOP\n` +
                  `${IND}→ the columns this app depends on changed under a live generation (schema drift).\n` +
                  `${IND}  Review the source schema; if intended: sms epoch:accept --table=${def.sourceTable} --confirm`,
              );
            } else {
              console.log(`${IND}identity   create_date matches · fingerprint matches   OK`);
            }

            if (sameSource) {
              const src = await sourceStats(ctx.ifl, def);
              const same =
                src.n === raw.n && src.lo === raw.lo && src.hi === raw.hi && src.sum === raw.sum;
              console.log(`${IND}${''.padEnd(9)}${'count'.padStart(12)}${'min'.padStart(12)}${'max'.padStart(12)}${'sum'.padStart(12)}`);
              console.log(`${IND}source   ${fmtN(src.n)}${fmtN(src.lo)}${fmtN(src.hi)}${fmtN(src.sum)}`);
              if (same) {
                console.log(`${IND}raw      ${fmtN(raw.n)}${fmtN(raw.lo)}${fmtN(raw.hi)}${fmtN(raw.sum)}   OK`);
              } else {
                stop(
                  `${IND}raw      ${fmtN(raw.n)}${fmtN(raw.lo)}${fmtN(raw.hi)}${fmtN(raw.sum)}   STOP\n` +
                    diagnose(src, raw).map((l) => `${IND}${l}`).join('\n'),
                );
              }
            }
          }
        }

        // (e) raw ⇄ canonical by key, every epoch, both directions.
        const gap = await keyGaps(ctx.app, def, line, e.epoch_id);
        gapsChecked++;
        const text = `${IND}raw ⇄ canonical   ${gap.rawOnly} raw without canonical · ${gap.canonOnly} canonical without raw`;
        if (gap.rawOnly === 0 && gap.canonOnly === 0) console.log(`${text}   OK`);
        else stop(`${text}   STOP`);
      }

      if (!mine.some((e) => e.closed_utc === null)) {
        const reports = now
          ? `the source reports ${now.server}/${now.database} created ${now.createdKey} fp ${now.fingerprint}`
          : `and the source's identity could not be read: ${identityError}`;
        stop(
          `  OPEN      none — no open generation for ${def.sourceTable}; ${reports}   STOP\n` +
            `${IND}→ nothing is being reconciled against the source, and the worker halts on the same fact.\n` +
            `${IND}  Register it deliberately:  sms epoch:accept --table=${def.sourceTable} --confirm --label "<what this is>"`,
        );
      }
    }

    // (g) Unchanged checks that still make sense across generations: the DQ-2
    //     collision flag is per canonical row, and findings are what they are.
    const collisions = await ctx.app
      .request()
      .query<{ n: number }>('SELECT COUNT(*) n FROM sms.cone_event WHERE merge_key_is_unique = 0');
    console.log(`\nMerge-key collisions (cone, DQ-2): ${collisions.recordset[0]?.n ?? 0}`);

    const dq = await ctx.app
      .request()
      .query<{ severity: string; n: number }>(`SELECT severity, COUNT(*) n FROM sms.dq_finding GROUP BY severity`);
    const order = ['CRITICAL', 'ERROR', 'WARNING', 'INFO'];
    const bySev = new Map(dq.recordset.map((r) => [r.severity, Number(r.n)]));
    console.log('DQ findings: ' + order.map((s) => `${s}=${bySev.get(s) ?? 0}`).join('  '));

    // (h)
    if (stops === 0) {
      console.log(
        `\n✓ every open generation reconciles with its source; raw ⇄ canonical clean on ${gapsChecked} epoch(s)`,
      );
      return 0;
    }
    console.log(`\n✗ ${stops} STOP condition(s) — see above`);
    return 1;
  } finally {
    await ctx.close();
  }
}
