/**
 * Sacks — "How many sacks were weighed, how heavy, how many the scale passed,
 * and what is in line stock." Roadmap Phase 7 (15 Sep 2026): the sack half
 * of requirement 6 and the LINE-level half of requirement 7.
 *
 * Four blocks, in the order a manager reads them: the period's figures (the
 * in-range share the CLI computed and no screen showed), the same by shift
 * and by product, the stock ledger with the form that adds a movement to it,
 * and the sack history — the register's own sack listing, reused, not
 * re-implemented (Readings keeps its Sacks toggle; this is the same rows in
 * a second place because the ledger is read beside them).
 *
 * THREE FACTS THE DATA FORCES, printed once, as the ledger's footnote:
 *  - a sack's time is when the plant wrote the reading (DQ-5), so the list
 *    says "Recorded" and the sheet explains;
 *  - no sack is attributed to a machine, because the source records none and
 *    this system does not infer one from the cones weighed around it
 *    (roadmap rule 6). The "Per machine" figure reads "not available" with
 *    the server's reason beside it, rather than being absent;
 *  - cones per sack is an approximation, labelled.
 * What a "receipt" is and which unit the ledger is kept in are the
 * developer's reading until IFL confirms; the footnote says so.
 *
 * Nothing about the balance is worked out here: every figure is the server's
 * (services/sackStock.ts), and the screen only chooses the unit to show.
 */
import { useState } from 'react';
import { useLive, usePolling, usePlantNow, LIST_POLL_MS } from '../lib/live';
import { W } from '../lib/words';
import { batchName } from '../lib/batchName';
import { periodQuery, dayToShiftRange, type Period, type PeriodParams, type ShiftRef } from '../lib/period';
import { Block, Details, Empty, Failed, Figures, SkelChart, SkelFigures, SkelLines, Toggle, Toolbar } from '../ui/bits';
import { fmtClock, fmtDayLong, fmtInt, fmtKg, fmtPct1, fmtSpan } from '../lib/fmt';
import { assessHealth } from '../lib/health';
import { CategoryBars, type BarDatum } from '../ui/chart';
import { distinctProductLabels } from '../lib/productLabel';
import { DeviationBars, RankBars, fmtDayShort, type DeviationRow, type RankRow } from './report/shared';
import { Pager, ReadingTable } from './Readings';
import {
  getEvents, getProducts, getReportOf, getSackStock, getSackSummary, recordSackMovement, MOVEMENT_TYPES,
  type LedgerDay, type LedgerFlow, type MovementType, type ProductOption, type RegisterType, type SackSummaryData,
  type SackReportData, type StockLedgerData,
} from '../api';

/**
 * This screen's own register page, deliberately NOT Readings' 100.
 *
 * At 100 rows the sack history was about 3,600px of a 7,900px page — the
 * single largest thing on the screen was a table of a hundred rows, on a
 * screen whose own question is answered by the blocks above it. Readings IS
 * the register and keeps its hundred; this is the same rows in a second
 * place (see the file header), and twenty-five of them with the pager intact
 * is a listing rather than a wall.
 */
const HISTORY_PAGE_SIZE = 25;

/** Roadmap Phase 2b (16 Sep 2026): the ledger's unit, in the URL as `su`. */
export type SackUnit = 'sacks' | 'kg';

const periodLabel = (p: Period): string =>
  p.from === p.to ? fmtDayLong(p.from) : `${fmtDayLong(p.from)} to ${fmtDayLong(p.to)}`;

/**
 * UX Phase WS-B2 (23 Sep 2026) — THE UNDIAGNOSED FAILURE MODE, established.
 *
 * `fmtInt`/`fmtKg` (`lib/fmt.ts`) guard `n == null`, which correctly catches
 * both `null` and a field simply absent from the wire (`undefined`) — a
 * bare stripped field already renders the honest "—" those helpers were
 * built for, with no fix needed here.
 *
 * The actual hole is ARITHMETIC done on a possibly-missing field BEFORE
 * formatting: `Math.round(t.kg)` and `t.sacks - t.noFlag` both produce
 * `NaN` when the operand is `undefined` (a field an RT-005-shaped response
 * — a present envelope with keys deleted, see `testkit/fixtures.ts`'s
 * `stripFields` — did not send), and `NaN == null` is `false`, so `fmtInt`
 * does NOT catch it. Reproduced live (`Sacks.summaryFigures.test.tsx`): the
 * headline printed "96 sacks weighed, NaN kg, 94.1% within the scale's
 * range." and the in-range note printed "90 of NaN the scale passed" — a
 * plausible-looking three-letter word standing in for a number, on a
 * report a manager may read or print, neither a throw nor a fabricated
 * zero. `finiteOrNull` is the one guard that treats "the arithmetic could
 * not be done" the same honest way `fmtInt`/`fmtKg` already treat "the
 * field itself was missing" — never inventing a 0.
 */
const finiteOrNull = (n: number): number | null => (Number.isFinite(n) ? n : null);

export function SacksScreen({
  period,
  unit,
  onUnitChange,
  page,
  onPageChange,
  canRecord,
  onOpenReading,
  onOpenDay,
  onSelectPeriod,
}: {
  period: Period;
  unit: SackUnit;
  onUnitChange: (u: SackUnit) => void;
  /** The history register's page — see `History` below. */
  page: number;
  onPageChange: (p: number) => void;
  /** Rank 3 — the developer's default until IFL sets the rank for a stock entry. */
  canRecord: boolean;
  onOpenReading: (type: RegisterType, id: string | number) => void;
  /** The stock sheet for one production day. */
  onOpenDay: (day: string) => void;
  /** Chart overhaul, Task T8b (29 Sep 2026): drag-select on the per-day
   *  weighed chart or the per-day avg-weight-vs-period chart snaps the WHOLE
   *  PAGE period to shift boundaries — the same `onSelectPeriod?` contract
   *  `StationSheet`/`Weight` already take. Optional so this compiles and
   *  renders unchanged until App.tsx wires it. */
  onSelectPeriod?: (p: PeriodParams) => void;
}) {
  const slow = period.live ? 60_000 : 10 * 60_000;
  const pq = periodQuery(period);
  const key = `${period.from}:${period.to}:${pq.fromShift ?? ''}:${pq.toShift ?? ''}:${period.shift ?? 'all'}:${period.tsTo}`;
  const summary = usePolling(
    () => getSackSummary(pq),
    slow,
    `sacks:summary:${key}`,
    { enabled: period.live },
  );
  const ledger = usePolling(() => getSackStock(pq), slow, `sacks:stock:${key}`, { enabled: period.live });
  // The per-day average sack weight, which no other endpoint on this screen
  // carries: /api/sacks/summary gives one average for the whole period and
  // the ledger gives none. The sack REPORT already computes it per day, at
  // rank 1 (REPORT_RANK.sack = 1, services/reports/common.ts), and is cached
  // server-side — this is an existing endpoint read from a second screen, not
  // a new payload.
  const report = usePolling(
    () => getReportOf('sack', pq),
    slow,
    `sacks:report:${key}`,
    { enabled: period.live },
  );
  // PDAS holds six materials all described "205-IL0-SD" on this line, so the
  // by-product table printed six identical row headings with figures ranging
  // 27.8% to 100% — indistinguishable to the reader, and a duplicate React
  // key on top of it. The parts that tell them apart (colour, blend, count,
  // tube) live in the product master, and the one disambiguator every other
  // screen already uses turns them into distinct names.
  const productMaster = usePolling(() => getProducts(), 10 * 60_000, 'products');

  const s = summary.data?.data ?? null;
  const labels = distinctProductLabels(productMaster.data?.products ?? []);
  const productName = (materialId: number | null, plain: string | null): string =>
    materialId == null ? W.sacks.noProduct : (labels.get(materialId) ?? plain ?? `Product ${materialId}`);
  const headline = !s
    ? null
    : s.totals.sacks === 0
      ? W.sacks.headlineNone(periodLabel(period))
      : W.sacks.headline(periodLabel(period), fmtInt(s.totals.sacks), fmtInt(finiteOrNull(Math.round(s.totals.kg))), s.totals.inRangePct == null ? null : fmtPct1(s.totals.inRangePct));

  return (
    <>
      <div className="page">
        <p className="q">{W.sacks.question}</p>
        {headline ? <h1 className="wide">{headline}</h1> : <div className="skel line" style={{ height: 'var(--fs-head)', maxWidth: '40ch' }} />}
      </div>

      <Block first>
        {summary.error && !s ? (
          <Failed error={summary.error} onRetry={summary.refresh} />
        ) : !s ? (
          <SkelFigures n={4} />
        ) : (
          <>
            <SummaryFigures s={s} />
            {/* One sentence for everything this fetch feeds — the figures
                here and the by-product and by-shift charts below (W.chartStale). */}
            {summary.error && <p className="mut sm" style={{ marginTop: 10 }}>{W.chartStale}</p>}
          </>
        )}
      </Block>

      {/* UX charts pass 2 (23 Sep 2026). The first pass put ONE 816x240px bar
          chart on an 8,890px page — 1.8% of it — and the owner's complaint
          ("majority of texts, no proper graphs") was not answered by that.
          Four marks now carry this screen's own question, in the order a
          packing question is actually asked: how many, how heavy, which
          product, which shift. Every one of them is drawn from a figure an
          endpoint already returns; none is a new statistic, and none is a
          line, because a period may span the 5 Aug source-generation
          boundary (see CategoryBars' own header). */}
      {s && s.totals.sacks > 0 && (
        <Block chartWide>
          <p className="h2"><span>{W.sacks.weighedPerDay}</span></p>
          {ledger.error && !ledger.data ? (
            <Failed error={ledger.error} onRetry={ledger.refresh} />
          ) : !ledger.data ? (
            <SkelChart />
          ) : (
            <>
              <SackWeighedChart days={ledger.data.data.days} onSelectPeriod={onSelectPeriod} />
              {/* See W.chartStale: a chart drawn from a fetch that has since
                  failed reads as current evidence unless it says otherwise. */}
              {ledger.error && <p className="mut sm" style={{ marginTop: 6 }}>{W.chartStale}</p>}
            </>
          )}
        </Block>
      )}

      {s && s.totals.sacks > 0 && (
        <Block chartWide>
          <p className="h2">
            <span>{W.sacks.avgPerDay}</span>
          </p>
          {report.error && !report.data ? (
            // Named, not blanket: everything else on this screen is still on
            // screen and still true; it is this one chart that has no data.
            <p className="state">{W.sacks.avgPerDayUnavailable}</p>
          ) : !report.data ? (
            <SkelChart />
          ) : (
            <>
              <AvgWeightPerDay report={report.data.data.report} onSelectPeriod={onSelectPeriod} />
              {report.error && <p className="mut sm" style={{ marginTop: 6 }}>{W.chartStale}</p>}
            </>
          )}
        </Block>
      )}

      {s && s.totals.sacks > 0 && (
        <Block chartWide>
          <p className="h2"><span>{W.sacks.byProduct}</span></p>
          {productMaster.error && !productMaster.data && (
            <p className="mut sm" style={{ marginBottom: 10 }}>{W.sacks.namesNotDistinct}</p>
          )}
          <ByProduct rows={s.byProduct} nameOf={productName} />
          {s.unattributed.rows > 0 && (
            <p className="mut sm" style={{ marginTop: 8 }}>{W.sacks.unattributed(fmtInt(s.unattributed.rows), fmtInt(s.unattributed.of))}</p>
          )}
          <div className="tw" style={{ marginTop: 18 }}>
            <GroupTable
              head={W.sacks.colProduct}
              rows={s.byProduct.map((r) => ({ ...r, key: String(r.materialId ?? 'none'), label: productName(r.materialId, r.productName) }))}
            />
          </div>
        </Block>
      )}

      {s && s.totals.sacks > 0 && s.byShift.length > 0 && (
        <Block chartWide>
          <p className="h2"><span>{W.sacks.byShift}</span></p>
          <RankBars
            rows={s.byShift.map((r) => ({
              key: r.shift,
              label: W.shiftName[r.shift as 'morning'] ?? r.shift,
              value: r.sacks,
            }))}
            ariaLabel={W.sacks.byShiftAria}
            labelWidth={140}
            rowHeight={36}
          />
          <div className="tw" style={{ marginTop: 14 }}>
            <GroupTable
              head={W.sacks.colShift}
              rows={s.byShift.map((r) => ({ ...r, key: r.shift, label: W.shiftName[r.shift as 'morning'] ?? r.shift }))}
            />
          </div>
        </Block>
      )}

      <Block label={W.sacks.ledger} note={W.sacks.ledgerNote}>
        {ledger.error && !ledger.data ? (
          <Failed error={ledger.error} onRetry={ledger.refresh} />
        ) : !ledger.data ? (
          <SkelLines n={6} />
        ) : (
          <Ledger
            d={ledger.data.data}
            unit={unit}
            onUnit={onUnitChange}
            canRecord={canRecord}
            onRecorded={() => { ledger.refresh(); summary.refresh(); }}
            onOpenDay={onOpenDay}
          />
        )}
      </Block>

      <History period={period} page={page} onPageChange={onPageChange} onOpenReading={onOpenReading} />
    </>
  );
}

/* ------------------------------------------------------------------ chart */

/**
 * One bar per production day in the ledger's own range: sacks weighed, the
 * ledger's own `weighed.sacks` figure. Bars, not a line — the ledger can
 * legitimately span the 5 Aug source-generation boundary (a picked range
 * crossing it), and a LINE drawn across that gap would assert a continuity
 * the data does not have (CLAUDE.md's "a line drawn across it is a lie
 * about continuity"); a bar makes no such claim about the day beside it.
 * Height and layout mirror `report/shared.tsx`'s `DayBars`, which this is
 * not a copy of: that component's readout and axis are cone-shaped
 * (`cones`/`sacks` together, always both), this screen's own question is
 * sacks and kg, and the report module is not this screen's to import
 * internals from for a shape that does not fit it.
 */
function SackWeighedChart({ days, onSelectPeriod }: { days: LedgerDay[]; onSelectPeriod?: (p: PeriodParams) => void }) {
  if (days.length === 0) return <Empty message={W.nothingHere} />;
  const data: BarDatum[] = days.map((d) => ({
    key: d.day,
    label: fmtDayShort(d.day),
    value: d.weighed.sacks,
    detail: `${fmtDayLong(d.day)} · ${fmtInt(d.weighed.sacks)} ${W.sacks.figSacks} · ${fmtInt(finiteOrNull(Math.round(d.weighed.kg)))} ${W.sacks.figKg}`,
  }));
  const total = days.reduce((sum, d) => sum + d.weighed.sacks, 0);
  const busiest = days.reduce((best, d) => (d.weighed.sacks > best.weighed.sacks ? d : best), days[0]!);
  // Chart overhaul T8b: one bar is one production day, so a drag snaps to
  // that day's whole D.morning..D.night span — the same idiom
  // `report/shared.tsx`'s `DayBars` already uses for the identical shape.
  const brush = onSelectPeriod
    ? {
        refs: days.map((d): [ShiftRef, ShiftRef] => {
          const r = dayToShiftRange(d.day, d.day);
          return [r.from, r.to];
        }),
        onSelect: onSelectPeriod,
      }
    : undefined;
  return (
    <CategoryBars
      data={data}
      height={300}
      ariaLabel={W.sacks.weighedPerDayAria}
      valueFmt={fmtInt}
      chartId="sacks-weighed-per-day"
      brush={brush}
      resting={W.sacks.weighedResting(
        days.length,
        fmtInt(total),
        fmtInt(busiest.weighed.sacks),
        fmtDayLong(busiest.day),
      )}
    />
  );
}

/**
 * Each production day's MEAN sack weight against the period's own mean.
 *
 * Deviation bars rather than absolute weights: every sack on this line is
 * packed to about 47 kg, so an absolute axis prints twenty-three bars of
 * identical height and answers nothing. What a packing question actually
 * asks is whether any day drifted, and by how much.
 *
 * TWO THINGS THIS CHART MUST NOT DO, both of which would be over-claiming:
 *  - it draws NO target or tolerance band. IFL's data carries no sack
 *    tolerance of any kind (CLAUDE.md), so there is nothing to draw and
 *    nothing to judge a day against beyond the period's own middle;
 *  - it does not let the axis magnify nothing into something. `minHalfSpan`
 *    fixes the axis at ±0.5 kg — about 1% of a sack — so a period whose days
 *    all sit within 0.1 kg of each other DRAWS flat, which is the true and
 *    useful answer. Without it niceDomain would scale ±0.07 kg to the full
 *    height of the block and invent a drift story.
 */
function AvgWeightPerDay({ report, onSelectPeriod }: { report: SackReportData; onSelectPeriod?: (p: PeriodParams) => void }) {
  const days = report.byDay.filter((r) => r.group !== 'total' && r.avgSackKg != null);
  if (days.length < 2 || report.totals.avgSackKg == null) return <Empty message={W.sacks.avgPerDayTooShort} />;
  const mean = report.totals.avgSackKg;
  const rows: DeviationRow[] = days.map((r) => ({
    key: r.group,
    label: fmtDayShort(r.group),
    value: Number(((r.avgSackKg as number) - mean).toFixed(3)),
  }));
  const worst = rows.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a), rows[0]!);
  const brush = onSelectPeriod
    ? {
        refs: days.map((r): [ShiftRef, ShiftRef] => {
          const rg = dayToShiftRange(r.group, r.group);
          return [rg.from, rg.to];
        }),
        onSelect: onSelectPeriod,
      }
    : undefined;
  return (
    <>
      <p className="readout"><span className="dim">{W.sacks.avgPerDayResting(fmtKg(mean), fmtKg(Math.abs(worst.value)))}</span></p>
      <DeviationBars
        rows={rows}
        ariaLabel={W.sacks.avgPerDayAria}
        zeroLabel={W.sacks.avgPerDayZero(fmtKg(mean))}
        valueFmt={(v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtKg(Math.abs(v))}`}
        height={260}
        chartId="sacks-avg-weight-per-day"
        brush={brush}
        /* 0.1 kg either side — about 0.2% of a 47 kg sack, and set by
           measurement rather than taste. At ±0.5 kg (the first value tried)
           the real day-to-day movement drew as an invisible hairline, which
           reads as a broken chart rather than as a steady one. It is not
           magnifying noise either: with roughly 300 sacks behind each day's
           mean and a 0.12 kg spread, the standard error of a day's mean is
           about 0.007 kg, so a 0.05 kg difference between days is a real
           difference. A genuine drift beyond 0.1 kg still scales the axis
           out, because this is a floor, not a fixed domain. */
        minHalfSpan={0.1}
      />
    </>
  );
}

/**
 * Two ranked comparisons of the products that actually carry a product id:
 * how many sacks each packed, and what share of them the scale passed.
 *
 * The unattributed rows are NOT in either chart — on the September
 * generation they are 88% of every sack, and one bar that long leaves the
 * real products as hairlines. Their count is printed in full beneath the
 * charts (the same sentence this block already carried), never dropped.
 *
 * Nothing here is flagged in the accent: IFL has confirmed no sack
 * tolerance and no in-range target, so this app has no standing to mark one
 * product's share as a fault. The bars state what was measured and stop.
 */
function ByProduct({
  rows,
  nameOf,
}: {
  rows: (SackSummaryData['byProduct'][number])[];
  nameOf: (materialId: number | null, plain: string | null) => string;
}) {
  const attributed = rows.filter((r) => r.materialId != null);
  if (attributed.length < 2) return null;
  const sacks: RankRow[] = [...attributed]
    .sort((a, b) => b.sacks - a.sacks)
    .map((r) => ({ key: String(r.materialId), label: nameOf(r.materialId, r.productName), value: r.sacks }));
  const inRange: RankRow[] = [...attributed]
    .filter((r) => r.inRangePct != null)
    .sort((a, b) => (a.inRangePct as number) - (b.inRangePct as number))
    .map((r) => ({
      key: String(r.materialId),
      label: `${nameOf(r.materialId, r.productName)} · ${fmtInt(r.sacks)} ${W.sacks.figSacks}`,
      value: r.inRangePct as number,
    }));
  return (
    <>
      <RankBars rows={sacks} ariaLabel={W.sacks.byProductAria} labelWidth={330} rowHeight={34} />
      {inRange.length >= 2 && (
        <>
          <p className="h2" style={{ marginTop: 22 }}><span>{W.sacks.inRangeByProduct}</span></p>
          <RankBars
            rows={inRange}
            ariaLabel={W.sacks.inRangeByProductAria}
            valueFmt={(v) => fmtPct1(v)}
            labelWidth={420}
            rowHeight={34}
          />
        </>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- figures */

function SummaryFigures({ s }: { s: SackSummaryData }) {
  const t = s.totals;
  if (t.sacks === 0) return <Empty message={W.readings.nothing} />;
  return (
    <Figures
      items={[
        { value: fmtInt(t.sacks), unit: W.sacks.figSacks },
        {
          value: fmtInt(finiteOrNull(Math.round(t.kg))),
          unit: W.sacks.figKg,
          note: t.avgKg == null ? null : (
            <>
              {W.sacks.avgNote(fmtKg(t.avgKg))}
              {t.implausible > 0 && <> · {W.sacks.avgExcluded(fmtInt(t.implausible))}</>}
            </>
          ),
        },
        {
          value: t.inRangePct == null ? '—' : fmtPct1(t.inRangePct),
          unit: W.sacks.figInRange,
          note: (
            <>
              {W.sacks.inRangeNote(fmtInt(t.inRange), fmtInt(finiteOrNull(t.sacks - t.noFlag)))}
              {t.noFlag > 0 && <> · {W.sacks.noFlagNote(fmtInt(t.noFlag))}</>}
            </>
          ),
        },
        { value: t.conesPerSack == null ? '—' : String(t.conesPerSack), unit: W.sacks.figConesPerSack, note: W.sacks.conesPerSackNote },
      ]}
    />
  );
}

function GroupTable({
  head,
  rows,
}: {
  head: string;
  /**
   * `key` is the row's own identity, not its label. Six PDAS materials share
   * the description "205-IL0-SD" on this line, so `key={r.label}` gave React
   * six duplicate keys (55 warnings in the console, counted 23 Sep 2026) —
   * and, more to the point, printed six identical headings against figures
   * running from 27.8% to 100%. The label is now disambiguated by the
   * caller; the key is the material id.
   */
  rows: { key: string; label: string; sacks: number; kg: number; avgKg: number | null; inRangePct: number | null }[];
}) {
  if (rows.length === 0) return <Empty message={W.nothingHere} />;
  return (
    <table>
      <thead>
        <tr>
          <th>{head}</th>
          <th className="n">{W.sacks.colSacks}</th>
          <th className="n">{W.sacks.colKg}</th>
          <th className="n">{W.sacks.colAvg}</th>
          <th className="n">{W.sacks.colInRange}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td>
            <td className="n">{fmtInt(r.sacks)}</td>
            <td className="n">{fmtInt(finiteOrNull(Math.round(r.kg)))}</td>
            <td className="n">{r.avgKg == null ? '—' : fmtKg(r.avgKg)}</td>
            <td className="n">{r.inRangePct == null ? '—' : fmtPct1(r.inRangePct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ----------------------------------------------------------------- ledger */

const flow = (f: LedgerFlow, unit: SackUnit): string =>
  unit === 'sacks' ? fmtInt(f.sacks) : f.kg === 0 ? '0' : f.kg.toLocaleString('en-US', { maximumFractionDigits: 1 });
const signed = (f: LedgerFlow, unit: SackUnit): string => {
  const v = unit === 'sacks' ? f.sacks : f.kg;
  if (v === 0) return '0';
  return `${v > 0 ? '+' : '−'}${flow({ sacks: Math.abs(f.sacks), kg: Math.abs(f.kg) }, unit)}`;
};
const unitWord = (n: number, unit: SackUnit): string => (unit === 'sacks' ? `${fmtInt(n)} ${W.sacks.figSacks}` : `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${W.sacks.figKg}`);

function Ledger({
  d,
  unit,
  onUnit,
  canRecord,
  onRecorded,
  onOpenDay,
}: {
  d: StockLedgerData;
  unit: SackUnit;
  onUnit: (u: SackUnit) => void;
  canRecord: boolean;
  onRecorded: () => void;
  onOpenDay: (day: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const hasCounts = d.days.some((x) => x.openingEntries.sacks !== 0 || x.openingEntries.kg !== 0);
  const nothing = d.opening.sacks === 0 && d.closing.sacks === 0 && d.days.every((x) => x.movements === 0 && x.weighed.sacks === 0);

  return (
    <>
      <Toolbar
        left={<Toggle label="Unit" value={unit} onChange={onUnit} options={[{ key: 'sacks', label: W.sacks.unit.sacks }, { key: 'kg', label: W.sacks.unit.kg }]} />}
        right={canRecord && !recording ? (
          <button type="button" className="btn" onClick={() => setRecording(true)}>{W.sacks.record}</button>
        ) : null}
      />

      {recording && (
        <MovementForm
          onDone={() => { setRecording(false); onRecorded(); }}
          onCancel={() => setRecording(false)}
        />
      )}

      {nothing ? (
        <p className="state">{W.sacks.ledgerEmpty}</p>
      ) : (
        <>
          <p style={{ marginTop: 14 }}>
            {W.sacks.openingBefore(unitWord(unit === 'sacks' ? d.opening.sacks : d.opening.kg, unit))}{' '}
            {W.sacks.closingNow(unitWord(unit === 'sacks' ? d.closing.sacks : d.closing.kg, unit))}
          </p>
          <div className="tw" style={{ marginTop: 14 }}>
            <table>
              <thead>
                <tr>
                  <th>{W.sacks.colDay}</th>
                  <th className="n">{W.sacks.colOpening}</th>
                  {hasCounts && <th className="n">{W.sacks.colCount}</th>}
                  <th className="n">{W.sacks.colReceipts}</th>
                  <th className="n">{W.sacks.colIssues}</th>
                  <th className="n">{W.sacks.colConsumption}</th>
                  <th className="n">{W.sacks.colAdjustments}</th>
                  <th className="n">{W.sacks.colClosing}</th>
                </tr>
              </thead>
              <tbody>
                {d.days.map((day) => (
                  <DayRow key={day.day} day={day} unit={unit} hasCounts={hasCounts} onOpen={() => onOpenDay(day.day)} />
                ))}
              </tbody>
            </table>
          </div>
          {unit === 'kg' && d.kgMissing > 0 && <p className="mut sm" style={{ marginTop: 8 }}>{W.sacks.kgIncomplete(d.kgMissing)}</p>}
          {d.byMaterial.length > 1 && (
            <Details summary={W.sacks.byProduct}>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>{W.sacks.colProduct}</th>
                      <th className="n">{W.sacks.colOpening}</th>
                      <th className="n">{W.sacks.colReceipts}</th>
                      <th className="n">{W.sacks.colIssues}</th>
                      <th className="n">{W.sacks.colConsumption}</th>
                      <th className="n">{W.sacks.colAdjustments}</th>
                      <th className="n">{W.sacks.colClosing}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byMaterial.map((m) => (
                      <tr key={m.materialId ?? 'none'}>
                        <td className={m.materialId == null ? 'mut' : ''}>{m.productName ?? (m.materialId == null ? W.sacks.noProduct : `Product ${m.materialId}`)}</td>
                        <td className="n">{flow(m.opening, unit)}</td>
                        <td className="n">{flow(m.receipts, unit)}</td>
                        <td className="n">{flow(m.issues, unit)}</td>
                        <td className="n">{flow(m.consumption, unit)}</td>
                        <td className="n">{signed(m.adjustments, unit)}</td>
                        <td className="n"><b>{flow(m.closing, unit)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Details>
          )}
        </>
      )}

      {/* The per-machine figure is present and says "not available", with
          the server's reason: a GM who looks for it must find why, never a
          blank. */}
      <p style={{ marginTop: 18 }}>
        <span className="mut">{W.sacks.perMachine}</span> <b>{W.sacks.perMachineNone}</b>
        <span className="mut sm"> — {d.machineLevel.reason}</span>
      </p>
      <p className="mut sm" style={{ marginTop: 10, maxWidth: '90ch' }}>{W.sacks.ledgerCaveat}</p>
    </>
  );
}

function DayRow({ day, unit, hasCounts, onOpen }: { day: LedgerDay; unit: SackUnit; hasCounts: boolean; onOpen: () => void }) {
  const quiet = day.movements === 0 && day.weighed.sacks === 0;
  return (
    <tr className={`click${quiet ? ' mut' : ''}`} tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      <td>{fmtDayLong(day.day)}</td>
      <td className="n">{flow(day.opening, unit)}</td>
      {hasCounts && <td className="n">{signed(day.openingEntries, unit)}</td>}
      <td className="n">{flow(day.receipts, unit)}</td>
      <td className="n">{flow(day.issues, unit)}</td>
      <td className="n">{flow(day.consumption, unit)}</td>
      <td className="n">{signed(day.adjustments, unit)}</td>
      <td className="n"><b>{flow(day.closing, unit)}</b></td>
    </tr>
  );
}

/* ------------------------------------------------------------ the form */

/** "YYYY-MM-DDTHH:MM" on the plant's clock, for a datetime-local input's default. */
const plantLocal = (iso: string | null): string => (iso ? iso.slice(0, 16) : '');

function MovementForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const plantNow = usePlantNow();
  const products = usePolling(() => getProducts(), 10 * 60_000, 'products');
  const [type, setType] = useState<MovementType>('issue');
  const [sacks, setSacks] = useState('');
  const [kg, setKg] = useState('');
  const [product, setProduct] = useState('');
  const [when, setWhen] = useState(() => plantLocal(plantNow));
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list: ProductOption[] = products.data?.products ?? [];

  return (
    <form
      style={{ marginTop: 14, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'end' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const n = Number(sacks);
          const k = kg.trim() === '' ? null : Number(kg);
          await recordSackMovement({
            movementType: type,
            quantitySacks: Number.isFinite(n) ? n : 0,
            quantityKg: k != null && Number.isFinite(k) ? k : null,
            materialId: product === '' ? null : Number(product),
            occurredAtPlant: when || plantLocal(plantNow),
            reason: why.trim() || null,
          });
          onDone();
        } catch (err) {
          const detail = (err as { detail?: string | null }).detail;
          setError(detail ?? String((err as Error).message ?? err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>{W.sacks.type}</span>
        <select value={type} onChange={(e) => setType(e.target.value as MovementType)}>
          {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{W.sacks.typeName[t]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{W.sacks.quantity}</span>
        <input type="number" step="1" required value={sacks} autoFocus onChange={(e) => setSacks(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.sacks.quantityKg}</span>
        <input type="number" step="0.001" value={kg} onChange={(e) => setKg(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.sacks.product}</span>
        <select value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="">{W.sacks.anyProduct}</option>
          {list.map((p) => (
            <option key={p.productId} value={p.productId}>{p.description ?? p.lotCode ?? `Product ${p.productId}`}</option>
          ))}
        </select>
        {/* UX Phase 7 Brief 1: `list` silently degrading to [] on a failed
            /api/products used to be indistinguishable from a genuinely empty
            product master — the dropdown just offered fewer options. */}
        {products.error && !products.data && (
          <span className="mut sm">{W.sacks.productListUnavailable}</span>
        )}
      </label>
      <label className="field">
        <span>{W.sacks.when}</span>
        <input type="datetime-local" required value={when} max={plantLocal(plantNow)} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <label className="field" style={{ gridColumn: '1 / -1' }}>
        <span>{W.sacks.why}</span>
        <input type="text" maxLength={255} required={type === 'adjustment'} value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <div className="row" style={{ gridColumn: '1 / -1' }}>
        <button type="submit" className="btn primary" disabled={busy}>{W.sacks.save}</button>
        <button type="button" className="btn" onClick={onCancel}>{W.sacks.cancel}</button>
        <span className="mut sm">{W.sacks.recordNote}</span>
      </div>
      {error && (
        <p className="acc sm" role="alert" style={{ gridColumn: '1 / -1' }}>{W.sacks.saveFailed} {error}</p>
      )}
    </form>
  );
}

/* ---------------------------------------------------------------- history */

/** Exported for testing only — mounted from SacksScreen below. */
export function History({
  period,
  page,
  onPageChange,
  onOpenReading,
}: {
  period: Period;
  /** Roadmap Phase 2b (16 Sep 2026): lifted to the URL (`sp`), so this
   *  register's page survives a refresh or a pasted link like the rest. */
  page: number;
  onPageChange: (p: number) => void;
  onOpenReading: (type: RegisterType, id: string | number) => void;
}) {
  const { line } = useLive();
  const health = assessHealth(line);
  const stale = health.kind !== 'ok';
  const rows = usePolling(
    () => getEvents({
      type: 'sack', ...periodQuery(period), tsFrom: period.tsFrom,
      page, pageSize: HISTORY_PAGE_SIZE, sort: 'time', dir: 'desc',
    }),
    period.live ? LIST_POLL_MS : 5 * 60_000,
    `sacks:history:${period.from}:${period.to}:${periodQuery(period).fromShift ?? ''}:${periodQuery(period).toShift ?? ''}:${period.shift ?? 'all'}:${page}`,
    { enabled: period.live },
  );
  const data = rows.data?.data;
  const total = data?.total ?? 0;
  /**
   * WS-CN (23 Sep 2026, RT-002/RT-029/WS-R follow-up). `register.ts`'s
   * `listEvents` now names, via `dataIssues[]`, when its own pooled tally
   * (`foldGenerationTally`) could not read a generation's count row — the
   * defect `ALLOW_LIST_ZERO` in reliability.guard.test.ts held open for
   * exactly this: `total === 0` used to be read as a genuine empty period
   * with no way to tell it apart from a hole in the tally while `rows` (a
   * SEPARATE query, unaffected by the tally's own malformation) still held
   * real data. A hole reads as "count unknown", never as `<Empty>` — the
   * two-sided contract `production.presence.test.ts` established for
   * Line.tsx, mirrored here for a LISTING rather than a single figure.
   */
  const countUnknown = !!data?.dataIssues?.some((i) => i.field === 'total');
  const lagText =
    health.kind === 'stale'
      ? W.lag.stale(health.readingUtc ? fmtClock(health.readingUtc) : '—')
      : health.kind === 'late'
        ? W.lag.late(fmtSpan(health.lagSeconds))
        : W.lag.noData;
  // Task B (28 Sep 2026, owner decision): the history register also lists
  // ONE data batch by default ('auto', the same one this screen's own
  // headline and ledger already read for the period) — one sentence, no
  // switch (Readings owns the switch; this is the same rows in a second
  // place, per the file header).
  const genName = data?.generation?.generation ? batchName(data.generation.generation) : null;
  const batchNote = genName ? W.readings.batch.current(genName) : null;
  const note = !data
    ? null
    : countUnknown
      ? W.sacks.historyCountUnknown
      : batchNote
        ? `${W.sacks.historyNote(fmtInt(total))} ${batchNote}`
        : W.sacks.historyNote(fmtInt(total));

  return (
    <Block label={W.sacks.history} note={note}>
      {rows.error && !rows.data ? (
        <Failed error={rows.error} onRetry={rows.refresh} />
      ) : rows.loading && !rows.data ? (
        <SkelLines n={8} />
      ) : !countUnknown && total === 0 ? (
        <Empty message={W.readings.nothing} />
      ) : (
        <>
          <div className="tw">
            <ReadingTable rows={data?.rows ?? []} listing="sacks" onOpen={onOpenReading} />
          </div>
          {/* The caveat already runs once, as the Block's own `note` above —
              a second copy here would duplicate the exact same sentence in
              the same block, which is noise, not emphasis. */}
          <p className="row between mut sm" style={{ marginTop: 14 }}>
            <span>
              {period.live && <span className={`dot live${stale ? ' bad' : ''}`} aria-hidden="true" />}
              {stale ? lagText : period.live ? W.readings.liveNote : null}
            </span>
            {!countUnknown && (
              <span>
                {W.readings.perPage(HISTORY_PAGE_SIZE, fmtInt(total))}
                <Pager page={page} total={total} onPage={onPageChange} size={HISTORY_PAGE_SIZE} />
              </span>
            )}
          </p>
        </>
      )}
    </Block>
  );
}
