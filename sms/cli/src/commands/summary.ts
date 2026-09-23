/**
 * `sms summary [--date=YYYY-MM-DD] [--shift=morning|evening|night] [--epoch=N[,M]]`
 *
 * Prints IFL's four priority metrics from canonical, honouring the weight basis
 * (Q4/Q5) read from the current weight_rule. Defaults to the latest shift_date
 * IN SCOPE.
 *
 * WHY THIS COMMAND KNOWS ABOUT GENERATIONS (23 Sep 2026)
 * ------------------------------------------------------
 * Until today every query here read `WHERE line_id = … AND shift_date = @d` and
 * nothing else. `sms.cone_event` / `sack_event` / `reject_event` hold EVERY
 * source generation at once — that is the whole point of `sms.source_epoch` —
 * so where two generations cover the same production day, this command added
 * them together and printed one number with nothing on screen to say so.
 *
 * That is not a development-copy curiosity. IFL dropped and recreated their
 * four weighing tables on 2026-08-05, restarting every identity at 1 (see
 * CLAUDE.md, "September 2026 — IFL's rebuilt source"). Any window that spans
 * that rebuild — or any window after IFL sends the missing 10 Jul – 5 Aug data,
 * or any re-ingest of a sample already loaded — has two generations over the
 * same days with entirely real plant data and no simulator anywhere near it.
 *
 * WHY IT REPORTS RATHER THAN REFUSES. `sms rebuild` (fb44b11) refuses a
 * scope-less run and exits 2, because it DELETES: there, doing nothing is the
 * recoverable outcome. This command is read-only, and it is the fastest way to
 * sanity-check a figure before it is quoted to IFL. A command that refuses is a
 * command an operator routes around — with ad-hoc SSMS SQL that has no epoch
 * predicate either, and no banner. So: never refuse, never pool. One generation
 * on the date prints exactly as it always did, plus a line naming which
 * generation it is; more than one prints a block PER GENERATION, with no total
 * across them and a sentence saying why there isn't one.
 */
import mssql from 'mssql';
import { openContext, parseArgs } from '../context.js';
import { idInClause } from './epoch.js';
import { parseEpochList } from './rebuild.js';

/** One source generation's totals for the date/shift asked for. */
export interface GenerationTotals {
  /** Stable identity: server + database + generation ordinal. */
  key: string;
  ordinal: number;
  sourceDb: string;
  provenance: string;
  /** Every epoch id of this generation that carries rows on this date. */
  epochIds: number[];
  cones: number;
  rejects: number;
  sacks: number;
  /** Already adjusted for the weight basis. */
  sackKg: number;
  sacksInRange: number;
}

const pad = (v: string | number): string => String(v).padStart(10);

/** `gen 3 · DATA_TP1U2_SEP07 (ifl_copy) · epochs 9, 10, 11` */
export function generationLabel(g: GenerationTotals): string {
  const many = g.epochIds.length === 1 ? 'epoch' : 'epochs';
  return `gen ${g.ordinal} · ${g.sourceDb} (${g.provenance}) · ${many} ${g.epochIds.join(', ')}`;
}

/**
 * The output, as lines. Returned rather than printed so a test can assert the
 * sentences an operator reads — following `rebuild.planLines` (fb44b11): what a
 * command says about the scope of its numbers IS part of its contract.
 */
export function summaryLines(
  lineId: number,
  date: string,
  shift: string | null,
  basis: string,
  inScope: GenerationTotals[],
  excluded: GenerationTotals[],
  scoped: boolean,
): string[] {
  const when = `${date}${shift ? ', ' + shift : ' (all shifts)'}`;
  const out: string[] = [`Production summary — line ${lineId}, ${when}`];

  if (inScope.length === 0) {
    out.push(
      '  ------------------------------------------',
      scoped
        ? '  No rows on this date for the generation(s) named by --epoch.'
        : '  No rows on this date.',
    );
  } else if (inScope.length === 1) {
    // The unchanged, single-generation shape — plus the one line that says
    // which generation these numbers are, which was never stated before.
    out.push(`  source generation      ${generationLabel(inScope[0]!)}`);
    out.push(...block(inScope[0]!, basis));
  } else {
    out.push(
      '',
      `  ${inScope.length} SOURCE GENERATIONS COVER THIS DATE — there is no single total below.`,
      '  These are separate physical generations of IFL\'s tables, whose row ids each restart',
      '  at 1 (IFL dropped and recreated theirs on 2026-08-05). Adding them together would',
      '  report the same production day more than once. Quote ONE block, or name the',
      `  generation you mean: sms summary --date=${date} --epoch=${inScope[0]!.epochIds.join(',')}`,
    );
    for (const g of inScope) {
      out.push('', `  generation             ${generationLabel(g)}`);
      out.push(...block(g, basis));
    }
  }

  if (excluded.length > 0) {
    out.push('', '  EXCLUDED by --epoch (present on this date, not counted above):');
    for (const g of excluded) {
      out.push(
        `    ${generationLabel(g)} — ${g.cones} cone(s), ${g.rejects} reject(s), ${g.sacks} sack(s)`,
      );
    }
  }
  return out;
}

function block(g: GenerationTotals, basis: string): string[] {
  const out = [
    '  ------------------------------------------',
    `  Total cones produced   ${pad(g.cones)}`,
    `  Total rejected cones   ${pad(g.rejects)}`,
    `  Total sacks produced   ${pad(g.sacks)}`,
    `  Total sack weight (kg) ${pad(g.sackKg.toFixed(1))}   [basis: ${basis}]`,
  ];
  if (g.sacks > 0) {
    out.push(`  Sacks in-range         ${pad(((100 * g.sacksInRange) / g.sacks).toFixed(1) + '%')}`);
  }
  return out;
}

interface EpochMeta {
  ordinal: number;
  sourceDb: string;
  sourceServer: string;
  provenance: string;
}

/**
 * Fold per-epoch counts into per-generation totals. A generation is one
 * (server, database, generation_ordinal): the four source tables of one
 * physical generation carry four different epoch ids (cones 9, sacks 10,
 * rejects 11 and 12 on this sidecar), and a summary reads all of them, so the
 * epoch id alone is not the unit an operator means by "generation".
 *
 * An epoch id with no row in `sms.source_epoch` is not silently merged into a
 * neighbour: it gets its own block, named as unregistered, because that is a
 * fault to look at rather than a rounding detail.
 */
export function foldGenerations(
  meta: Map<number, EpochMeta>,
  cones: Map<number, number>,
  rejects: Map<number, number>,
  sacks: Map<number, { n: number; kg: number; inRange: number }>,
  basis: string,
  tareKg: number,
): GenerationTotals[] {
  const byKey = new Map<string, GenerationTotals>();
  const epochIds = [
    ...new Set([...cones.keys(), ...rejects.keys(), ...sacks.keys()]),
  ].sort((a, b) => a - b);

  for (const id of epochIds) {
    const m = meta.get(id);
    const key = m ? `${m.sourceServer}/${m.sourceDb}#${m.ordinal}` : `unregistered#${id}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        ordinal: m?.ordinal ?? 0,
        sourceDb: m?.sourceDb ?? '(unregistered epoch)',
        provenance: m?.provenance ?? 'unknown',
        epochIds: [],
        cones: 0,
        rejects: 0,
        sacks: 0,
        sackKg: 0,
        sacksInRange: 0,
      };
      byKey.set(key, g);
    }
    g.epochIds.push(id);
    g.cones += cones.get(id) ?? 0;
    g.rejects += rejects.get(id) ?? 0;
    const s = sacks.get(id);
    if (s) {
      g.sacks += s.n;
      g.sackKg += s.kg;
      g.sacksInRange += s.inRange;
    }
  }
  for (const g of byKey.values()) {
    // Tare is per sack, so it is applied per generation, after folding.
    if (basis === 'net') g.sackKg -= tareKg * g.sacks;
  }
  return [...byKey.values()].sort((a, b) => (a.epochIds[0] ?? 0) - (b.epochIds[0] ?? 0));
}

export async function summary(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  // Same flag, same parser and same filter as `sms rebuild` and `sms
  // epoch:purge`: three commands that name generations must name them the
  // same way. Unlike rebuild's, this scope is OPTIONAL — see the file header.
  const wantedEpochs = parseEpochList(args.epoch);
  if (typeof args.epoch === 'string' && wantedEpochs.length === 0) {
    console.error(`--epoch=${args.epoch} names no valid epoch id. Use --epoch=N or --epoch=N,M (see 'sms epoch:list').`);
    return 2;
  }
  const scopeQ = wantedEpochs.length > 0 ? idInClause(wantedEpochs) : null;
  const scopeClause = scopeQ ? ` AND source_epoch IN ${scopeQ.sql}` : '';

  const ctx = await openContext();
  try {
    const line = ctx.cfg.lineId;
    // Bound, not interpolated (working rule 3). `line` is a config number and
    // the old `line_id=${line}` was not exploitable — but the rule has no
    // "unless it happens to be a number" clause, and a bound parameter also
    // lets SQL Server reuse the plan.
    const lineReq = (): mssql.Request => ctx.app.request().input('line', mssql.Int, line);

    const date =
      typeof args.date === 'string'
        ? args.date
        : (
            await (scopeQ ? scopeQ.bind(lineReq()) : lineReq()).query<{ d: string }>(
              `SELECT CONVERT(varchar(10), MAX(shift_date), 120) d FROM sms.cone_event
                WHERE line_id = @line${scopeClause}`,
            )
          ).recordset[0]?.d;
    if (!date) {
      console.log(scopeQ ? 'No data for the generation(s) named by --epoch.' : 'No data.');
      return 0;
    }
    const shift = typeof args.shift === 'string' ? args.shift : null;
    const shiftClause = shift ? 'AND shift_code = @shift' : '';

    const req = (): mssql.Request => {
      const r = lineReq().input('d', mssql.Date, date);
      if (shift) r.input('shift', mssql.VarChar(10), shift);
      return scopeQ ? scopeQ.bind(r) : r;
    };

    // weight basis (Q4/Q5)
    const wr = await lineReq().query<{ basis: string; sack_tare_kg: number }>(
      `SELECT TOP 1 basis, sack_tare_kg FROM sms.weight_rule WHERE line_id = @line ORDER BY effective_from DESC`,
    );
    const basis = wr.recordset[0]?.basis ?? 'as_recorded';
    const tare = Number(wr.recordset[0]?.sack_tare_kg ?? 0);

    // Counted PER GENERATION, never pooled. The GROUP BY is the whole fix.
    const countBy = async (table: string): Promise<Map<number, number>> => {
      const r = await req().query<{ e: number; n: number }>(
        `SELECT source_epoch e, COUNT(*) n FROM sms.${table}
          WHERE line_id = @line AND shift_date = @d ${shiftClause}${scopeClause}
          GROUP BY source_epoch`,
      );
      return new Map(r.recordset.map((x) => [Number(x.e), Number(x.n)]));
    };
    const cones = await countBy('cone_event');
    const rejects = await countBy('reject_event');

    const sackRows = await req().query<{ e: number; n: number; kg: number; inr: number }>(
      `SELECT source_epoch e, COUNT(*) n, ISNULL(SUM(weight_kg),0) kg,
              ISNULL(SUM(CASE WHEN in_range=1 THEN 1 ELSE 0 END),0) inr
         FROM sms.sack_event
        WHERE line_id = @line AND shift_date = @d ${shiftClause}${scopeClause}
        GROUP BY source_epoch`,
    );
    const sacks = new Map(
      sackRows.recordset.map((x) => [
        Number(x.e),
        { n: Number(x.n), kg: Number(x.kg), inRange: Number(x.inr) },
      ]),
    );

    // Every generation on this date, in scope or not, so what --epoch left out
    // can be named rather than silently dropped.
    const allReq = lineReq().input('d', mssql.Date, date);
    if (shift) allReq.input('shift', mssql.VarChar(10), shift);
    const metaRows = await allReq.query<{
      epoch_id: number;
      source_db: string;
      source_server: string;
      provenance: string;
      generation_ordinal: number;
    }>(
      `SELECT epoch_id, source_db, source_server, provenance, generation_ordinal
         FROM sms.source_epoch WHERE line_id = @line`,
    );
    const meta = new Map<number, EpochMeta>(
      metaRows.recordset.map((m) => [
        Number(m.epoch_id),
        {
          ordinal: Number(m.generation_ordinal),
          sourceDb: m.source_db,
          sourceServer: m.source_server,
          provenance: m.provenance,
        },
      ]),
    );

    const inScope = foldGenerations(meta, cones, rejects, sacks, basis, tare);

    let excluded: GenerationTotals[] = [];
    if (scopeQ) {
      const outReq = (): mssql.Request => {
        const r = lineReq().input('d', mssql.Date, date);
        if (shift) r.input('shift', mssql.VarChar(10), shift);
        return scopeQ.bind(r);
      };
      const outBy = async (table: string): Promise<Map<number, number>> => {
        const r = await outReq().query<{ e: number; n: number }>(
          `SELECT source_epoch e, COUNT(*) n FROM sms.${table}
            WHERE line_id = @line AND shift_date = @d ${shiftClause}
              AND source_epoch NOT IN ${scopeQ.sql}
            GROUP BY source_epoch`,
        );
        return new Map(r.recordset.map((x) => [Number(x.e), Number(x.n)]));
      };
      const outSack = await outReq().query<{ e: number; n: number; kg: number; inr: number }>(
        `SELECT source_epoch e, COUNT(*) n, ISNULL(SUM(weight_kg),0) kg,
                ISNULL(SUM(CASE WHEN in_range=1 THEN 1 ELSE 0 END),0) inr
           FROM sms.sack_event
          WHERE line_id = @line AND shift_date = @d ${shiftClause}
            AND source_epoch NOT IN ${scopeQ.sql}
          GROUP BY source_epoch`,
      );
      excluded = foldGenerations(
        meta,
        await outBy('cone_event'),
        await outBy('reject_event'),
        new Map(
          outSack.recordset.map((x) => [
            Number(x.e),
            { n: Number(x.n), kg: Number(x.kg), inRange: Number(x.inr) },
          ]),
        ),
        basis,
        tare,
      );
    }

    for (const l of summaryLines(line, date, shift, basis, inScope, excluded, scopeQ !== null)) {
      console.log(l);
    }
    return 0;
  } finally {
    await ctx.close();
  }
}
