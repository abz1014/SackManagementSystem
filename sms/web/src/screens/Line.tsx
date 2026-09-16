/**
 * Line — the home screen. "Is the line running, what has it made this period,
 * and does anything need attention?"
 *
 * Built to design/sms-redesign/Main.dc.html, the version signed off on
 * 3 Sep 2026. It replaces BOTH the old Now screen and the old Day dashboard,
 * which between them answered the current-state question twice, showed the
 * running product twice, and spent half the dashboard's height on availability,
 * mean-time-between-stops and mean-time-to-restart — reliability metrics no
 * requirement asked for.
 *
 * TWO RULES THIS SCREEN MUST NOT BREAK:
 *
 * 1. NOTHING HERE IS MEASURED AGAINST THE BROWSER'S CLOCK. IFL's acquisition
 *    layer writes a cone's row about a quarter of an hour after the cone is
 *    weighed, so "quiet for 20 minutes" measured from `Date.now()` is true of
 *    every station on a perfectly healthy line. Every relative time is
 *    anchored on `dataAsOfUtc`, the newest reading on record.
 *
 * 2. WHEN THE PIPELINE IS IN DOUBT, THE HEADLINE CHANGES. If the sync worker
 *    stops, the newest reading keeps ageing and the line-state arithmetic
 *    would report "Stopped 3 min" about a line running flat out. In that state
 *    the headline says it cannot tell, and the figures stay — they are still
 *    the last true counts.
 */
import { useMemo } from 'react';
import { useLive, usePolling } from '../lib/live';
import { assessHealth, stateIsKnowable } from '../lib/health';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import {
  Block, Chevron, Details, Empty, Failed, Figures, Loading, rowKeys,
  SkelFigures, SkelLines, SkelStations, type FigureProps,
} from '../ui/bits';
import { fmtClock, fmtG, fmtInt, fmtKg, fmtPct1, fmtSpan, secondsBetween } from '../lib/fmt';
import {
  getAttention, getProduction, getProductAt, getStations, stationLabel, getMachinesRunning,
  type AttentionFinding, type LiveLine, type ProductionRow, type StationRow, type MachinesRunningData,
  type StateCounts,
} from '../api';
import type { Screen, ReadingsFilter } from '../ui/Bar';
import { projectionSentence } from './StationSheet';

/**
 * How long a station must be silent before it is worth saying so — measured
 * back from the newest reading, never from the browser's clock.
 *
 * Twenty minutes, and the number is measured rather than chosen. At one
 * station the gap between consecutive cones runs to a median of 130 s and a
 * 95th percentile of 516 s, with 888 s seen inside a single four-hour window
 * (sampled from the live line, 3 Sep 2026). A five-minute rule — the first
 * value used here — therefore fired on four stations out of fourteen while the
 * line was running perfectly, which is precisely the kind of false alarm on the
 * home screen that costs more trust than the warning earns.
 */
const QUIET_AFTER_SECONDS = 20 * 60;

const REFRESH_MS = 30_000;

export function LineScreen({
  period,
  onNavigate,
  onOpenStation,
  onOpenReading,
  onOpenProduct,
  canWrite,
}: {
  period: Period;
  onNavigate: (s: Screen, filter?: ReadingsFilter) => void;
  onOpenStation: (station: number) => void;
  onOpenReading: (type: 'cone' | 'sack', id: string | number) => void;
  onOpenProduct: () => void;
  canWrite: boolean;
}) {
  const { line, loading } = useLive();
  const health = assessHealth(line);

  const stations = usePolling(() => getStations(), 10 * 60_000, 'stations');

  // THE FIGURES OBEY THE PERIOD. They used to read line.thisShift, so "This
  // month" and "This shift" printed the same three numbers on the one screen
  // whose question is "what has it made this period" — the period control was
  // global everywhere except the home screen.
  // tsTo is what makes a replay honest. /api/live caps its counts at the
  // replay instant; /api/production had no instant bound at all, so under
  // `?at=` this screen counted the WHOLE shift while the Wall display counted
  // up to the replayed moment — mid-shift, Line read roughly double Wall for
  // the same shift. period.ts documents tsTo as exactly this guard.
  const periodKey = `${period.from}:${period.to}:${period.shift ?? 'all'}:${period.tsTo}`;
  const totals = usePolling(
    () => getProduction({ from: period.from, to: period.to, shift: period.shift, tsTo: period.tsTo, groupBy: 'none' }),
    period.live ? REFRESH_MS : 5 * 60_000,
    `line-totals:${periodKey}`,
  );
  const perStation = usePolling(
    () => getProduction({ from: period.from, to: period.to, shift: period.shift, tsTo: period.tsTo, groupBy: 'station' }),
    period.live ? REFRESH_MS : 5 * 60_000,
    `line-stations:${periodKey}`,
  );
  // Same leak, same fix: with no argument this asked for the product running
  // NOW, so a July replay showed today's product beside July's readings.
  const product = usePolling(() => getProductAt(period.tsTo), REFRESH_MS, `product-at:${period.tsTo}`);
  const attention = usePolling(
    () => getAttention({ from: period.from, to: period.to, shift: period.shift }),
    REFRESH_MS,
    `attention:${period.from}:${period.to}:${period.shift ?? 'all'}`,
  );
  // What each machine is running (roadmap Phase 4, 14 Sep 2026): the product
  // on each station from its newest cones, in a two-hour window anchored on
  // the newest reading — never on the clock — and capped at the replay
  // instant, like everything else on this screen.
  const machines = usePolling(() => getMachinesRunning(period.tsTo), REFRESH_MS, `machines-running:${period.tsTo}`);

  if (loading && !line) return <Loading />;
  if (!line) return <Empty message={W.lag.noData} />;

  // Line's own empty-state note for the KPI row (OVERVIEW-SPEC.md §3.1 case
  // 6): absent when the figures are non-zero or health is not 'ok' — the
  // strip and headline already carry that doubt (rule 8), a second warning
  // here would be the density failure IFL named. Only computed once totals
  // has data; skeleton and Failed carry their own states.
  const kpiNote = totals.data ? kpiBlockNote(totals.data.data.rows[0] ?? null, line, period, health.kind === 'ok') : null;
  const implausible = totals.data?.data.implausible ?? null;

  return (
    <>
      <div className="page">
        <p className="q">{W.question.line}</p>
        <h1 className="wide">
          <Headline line={line} knowable={stateIsKnowable(health)} />
        </h1>
      </div>

      <Block first>
        {/* Finding H14 (Sep 2026 audit): a persistent fetch failure used to
            render this as an unending skeleton — indistinguishable from
            "still loading" no matter how long it had actually been failing. */}
        {totals.error && !totals.data ? (
          <Failed error={totals.error} onRetry={totals.refresh} />
        ) : totals.data ? (
          <>
            <Figures items={periodFigures(totals.data.data.rows[0] ?? null, totals.data.data.states, onNavigate)} />
            {kpiNote && <p className="mut sm" style={{ marginTop: 8 }}>{kpiNote}</p>}
          </>
        ) : (
          <SkelFigures n={4} />
        )}
      </Block>

      <Block
        label={W.attention}
        note={attention.data ? W.judgedOver(attention.data.data.window.days) : null}
      >
        {/* Finding H14: the worst instance found — a failed attention check
            used to render "Nothing needs attention", the calm state, because
            an empty findings array looks identical whether the check ran and
            found nothing or never ran at all. */}
        {attention.error && !attention.data ? (
          <Failed error={attention.error} onRetry={attention.refresh} />
        ) : (
          <AttentionList
            findings={attention.data?.data.findings ?? []}
            total={attention.data?.data.totalFindings ?? 0}
            stations={stations.data?.stations ?? []}
            loading={attention.loading && !attention.data}
            windowDays={attention.data?.data.window.days ?? null}
            minDaysHeld={attention.data?.data.thresholds.minDaysHeld ?? null}
            onNavigate={onNavigate}
            onOpenStation={onOpenStation}
          />
        )}
      </Block>

      {/* Stations moves above "What is being made" (OVERVIEW-SPEC.md §3):
          the attention list above names stations, and this grid is the
          surface a reader scans to find the one it named. */}
      <Block
        label={`${W.stations} — ${W.stationsNote}`}
        note={stationsNote(line, stations.data?.stations ?? [], perStation.data?.data.rows ?? null, health.kind === 'ok')}
      >
        {/* perStation counted too: without it a failed counts fetch left
            every station cell in its permanent loading state — the
            endless-skeleton half of H14, in the same block as the fixed half. */}
        {(stations.error && !stations.data) || (perStation.error && !perStation.data) ? (
          <Failed
            error={stations.error ?? perStation.error}
            onRetry={() => {
              stations.refresh();
              perStation.refresh();
            }}
          />
        ) : (
          <StationRowGrid
            line={line}
            stations={stations.data?.stations ?? []}
            counts={perStation.data?.data.rows ?? null}
            onOpen={onOpenStation}
          />
        )}
      </Block>

      {/* The merge of today's "Product recorded in this system" and "What
          each machine is running" (OVERVIEW-SPEC.md §3.4): one question,
          answered once. The machine rows are the block's primary content and
          must survive a product-lookup failure, so the two calls keep
          independent guards. */}
      <Block
        label={W.cone.machinesTitle}
        note={machines.data ? W.cone.machinesNote(machines.data.data.materialsRunning) : null}
      >
        {machines.error && !machines.data ? (
          <Failed error={machines.error} onRetry={machines.refresh} />
        ) : !machines.data ? (
          <SkelLines n={3} short />
        ) : (
          <MachinesBlock data={machines.data.data} stations={stations.data?.stations ?? []} onOpen={onOpenStation} />
        )}

        {product.error && !product.data ? (
          <Failed error={product.error} onRetry={product.refresh} />
        ) : (
          <ProductFooter data={product.data} canWrite={canWrite} onOpenProduct={onOpenProduct} />
        )}
      </Block>

      <Block label={W.lastReadings}>
        <LastReadings line={line} onOpen={onOpenReading} />
      </Block>

      <div className="page">
      <Details summary={W.details}>
        <p>
          The line is judged against the newest reading rather than the clock, because the plant writes a
          cone&apos;s row about {line.ingestLagSeconds != null ? fmtSpan(line.ingestLagSeconds) : 'a quarter of an hour'}{' '}
          after it is weighed. It reads as stopped once that gap exceeds {fmtSpan(line.state.stopThresholdSeconds)}.
        </p>
        <p>
          Attention is judged over the last {attention.data?.data.window.days ?? '—'} production days, not the
          selected period, because the station tests need consecutive days and one shift is a single point. A
          station is named when it has held one side of the line by at least{' '}
          {attention.data ? fmtG(attention.data.data.thresholds.driftG) : '—'} for{' '}
          {attention.data?.data.thresholds.minDaysHeld ?? '—'} days or more.
        </p>
        {/* OVERVIEW-SPEC.md §3.6: the honest home for the population rule —
            noise in a KPI note, a lie of omission if dropped entirely. */}
        {implausible != null && implausible > 0 && (
          <p>{W.detailsImplausible(fmtInt(implausible))}</p>
        )}
      </Details>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- headline */

function Headline({ line, knowable }: { line: LiveLine; knowable: boolean }) {
  const shiftName = W.shift[line.shift.code];
  const from = fmtClock(line.shift.startUtc);
  const to = fmtClock(line.shift.endUtc);

  // When the pipeline is in doubt the state is not asserted at all. The shift
  // is still true, so it is still said.
  if (!knowable) {
    return (
      <>
        <span className="acc">{W.state.unknown}</span>. {W.state.shiftOf(cap(shiftName), from, to)}.
      </>
    );
  }

  const elapsed = fmtSpan(line.shift.elapsedSeconds);
  switch (line.state.status) {
    case 'running':
      return (
        <>
          {lineTitle(line)} {W.state.running} —{' '}
          {W.state.intoShift(elapsed, shiftName, from, to)}.
        </>
      );
    case 'stopped':
      return (
        <>
          <span className="acc">
            {lineTitle(line)} {W.state.stopped(fmtSpan(line.state.behindSeconds ?? 0))}
          </span>
          . {W.state.shiftOf(cap(shiftName), from, to)}.
        </>
      );
    default:
      return (
        <>
          {W.state.idle(line.dataAsOfUtc ? fmtClock(line.dataAsOfUtc) : '—')}.{' '}
          {W.state.shiftOf(cap(shiftName), from, to)}.
        </>
      );
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * What to call the line in a sentence: its short name, verbatim.
 *
 * Until roadmap Phase 1 (14 Sep 2026) this split LINE_NAME on '·' and kept
 * the segment that said "Line" — the env string was a whole address, "TP1 ·
 * Line 3 · Unit 2", and "Unit 2 is running" names the building. The name is
 * a row now (sms.line.name, edited in Setup › Line), the full display name
 * stays on the bar and the report, and nothing is parsed.
 */
function lineTitle(line: LiveLine): string {
  return line.lineShortName || line.lineName;
}

/* ----------------------------------------------------------------- figures */

/**
 * The four figures for the SELECTED period. Zeros, not dashes: an empty
 * period is a normal fact on a plant that runs six days, and zero is a
 * measurement.
 *
 * Every figure is a link (OVERVIEW-SPEC.md §3.1): the KPI → exception →
 * drilldown pattern the owner asked for, closed for the price of four
 * onClick handlers — no new API, no new URL key, no new handler shape.
 * `onNav` is `onNavigate`, already wired at App.tsx to merge the period.
 */
function periodFigures(
  r: ProductionRow | null,
  states: StateCounts | null,
  onNav: (s: Screen, filter?: ReadingsFilter) => void,
): FigureProps[] {
  const cones = r?.cones ?? 0;
  const rejected = r?.rejectedCones ?? 0;
  const sacks = r?.sacks ?? 0;
  const kg = r?.sackWeightKg ?? 0;
  const rejectRate =
    cones + rejected > 0 ? `${Math.round((1000 * rejected) / (cones + rejected)) / 10}%` : '0%';
  // states is computed once for the whole range at rank 1 on every
  // /api/production call (app.ts withStates: true) — served today and
  // discarded by the client until now. low/high = passed the scale, outside
  // the product's limits in force at that reading's own time; unknown = no
  // weight, an implausible weight, or no limits in force (coneState.ts).
  const outsideLimits = states ? states.low + states.high : 0;
  const couldNotBeJudged = states ? states.unknown : 0;
  return [
    {
      value: fmtInt(cones),
      unit: W.fig.cones,
      note: r?.conesInRangePct != null ? W.withinLimits(fmtPct1(r.conesInRangePct)) : null,
      // Readings, unfiltered: the filter is explicitly cleared by go()'s
      // merge (App.tsx: filter ?? null), not left over from a previous hop.
      onClick: () => onNav('readings'),
    },
    // Rounded: a headline figure with two decimal places reads as precision
    // the reader is being asked to care about, and nobody weighs a shift's
    // output to the gram.
    {
      value: fmtInt(sacks),
      unit: W.fig.sacks,
      note: `${fmtInt(Math.round(kg))} ${W.fig.kg}`,
      onClick: () => onNav('sacks'),
    },
    {
      value: fmtInt(rejected),
      unit: W.fig.rejected,
      note: W.ofEverything(rejectRate),
      onClick: () => onNav('rejects'),
    },
    {
      value: fmtInt(outsideLimits),
      unit: W.outsideProduct,
      note: W.fig.couldNotBeJudged(fmtInt(couldNotBeJudged)),
      // The identical hop Weight and the attention list already open.
      onClick: () => onNav('readings', 'outsideLimits'),
    },
  ];
}

/**
 * The KPI block's own empty-state note (OVERVIEW-SPEC.md §3.1 case 6): three
 * distinct explanations for a figure that reads low or zero, tried in order
 * of how much they explain. Never shown when health is not 'ok' — rule 8,
 * the strip and headline already carry that doubt, and a second warning here
 * is the density failure IFL named.
 */
function kpiBlockNote(r: ProductionRow | null, line: LiveLine, period: Period, healthOk: boolean): string | null {
  if (!healthOk) return null;
  const cones = r?.cones ?? 0;
  const sacks = r?.sacks ?? 0;
  const rejected = r?.rejectedCones ?? 0;
  if (cones + sacks + rejected > 0) return null;
  // No readings at all: the headline already says so (W.lag.noData); a
  // second sentence here would repeat it for no reason.
  if (line.dataAsOfUtc == null) return null;
  // The source has not caught up: on a live period the query is always
  // capped at the plant's current instant (period.tsTo), so the newest
  // acquisition lag's worth of cones is structurally missing — the 2 Sep
  // 2026 live rehearsal's lesson. Never on a period that is already closed.
  if (period.live && line.ingestLagSeconds != null && line.ingestLagSeconds > 0) {
    return W.fig.notCaughtUp(fmtSpan(line.ingestLagSeconds));
  }
  return W.nothingHere;
}

/* --------------------------------------------------------------- attention */

function AttentionList({
  findings,
  total,
  stations,
  loading,
  windowDays,
  minDaysHeld,
  onNavigate,
  onOpenStation,
}: {
  findings: AttentionFinding[];
  total: number;
  stations: StationRow[];
  loading: boolean;
  /** The FIXED trailing window the drift and reject rules actually had. */
  windowDays: number | null;
  minDaysHeld: number | null;
  onNavigate: (s: Screen, filter?: ReadingsFilter) => void;
  onOpenStation: (station: number) => void;
}) {
  // Two lines: the attention list is at most three sentences, and reserving
  // two keeps the block from growing as it lands on a calm shift.
  if (loading) return <SkelLines n={2} short />;
  if (findings.length === 0) {
    // A second empty case (OVERVIEW-SPEC.md §3.2): when the record holds
    // fewer production days than the drift rule needs, "Nothing needs
    // attention" is a statement about the record, not the line.
    const tooFew = windowDays != null && minDaysHeld != null && windowDays < minDaysHeld;
    return (
      <ul className="attn calm">
        <li>
          {W.nothingNeedsAttention}
          {tooFew && ` ${W.tooFewProductionDays(windowDays!)}`}
        </li>
      </ul>
    );
  }
  const byId = new Map(stations.map((s) => [s.stationId, s]));
  return (
    <>
      <ul className="attn">
        {findings.map((f, i) => {
          // (a) A station-drift finding opens that station's sheet, not
          // Weight unsorted and unfiltered (IA-PROPOSAL.md §6.1's worst
          // context drop) — onOpenStation already exists, wired to
          // ?sheet=station:N, and the link word is the station's own label.
          const isStationDrift = f.kind === 'station_drift' && f.station != null;
          const isOutsideLimits = f.kind === 'outside_product_limits';
          const label = isStationDrift
            ? stationLabel(byId.get(f.station!), f.station!)
            : isOutsideLimits
              ? W.seeThem
              : W.nav[f.screen as keyof typeof W.nav];
          const onClick = isStationDrift
            ? () => onOpenStation(f.station!)
            // Finding H4 (Sep 2026 audit): this used to open Readings
            // unfiltered regardless of which finding was clicked — the same
            // dead end as Weight's disagreement banner.
            : () => onNavigate(f.screen as Screen, isOutsideLimits ? 'outsideLimits' : undefined);
          return (
            <li key={i}>
              <span className="say">{sentence(f, byId)}</span>{' '}
              <button type="button" className="linkish" onClick={onClick}>
                {label}
              </button>
            </li>
          );
        })}
      </ul>
      {/* Name the screen the FIRST HIDDEN finding actually lives on.
          attention.ts orders drift findings first and caps at three, so the
          overflow is precisely the reject-rise and outside-limits findings —
          never Weight, which is what this used to hardcode. */}
      {total > findings.length && (
        <p className="attn-more">
          {W.andMore(total - findings.length, W.nav[(findings[findings.length - 1]?.screen ?? 'weight') as keyof typeof W.nav])}
        </p>
      )}
    </>
  );
}

/**
 * The sentence for a finding, composed here from the numbers the API returns.
 *
 * Deliberately never "reduce station 7 by 9 g": weighing data cannot tell a
 * scale that reads heavy from cones that ARE heavy, and the two need opposite
 * actions. It states what was measured and stops.
 */
function sentence(f: AttentionFinding, stations: Map<number, StationRow>): string {
  switch (f.kind) {
    case 'station_drift': {
      const name = stationLabel(stations.get(f.station ?? 0), f.station ?? 0);
      const g = fmtG(Math.abs(f.deltaG ?? 0));
      const days = f.days ?? 0;
      const said = `${name} ${(f.deltaG ?? 0) > 0 ? W.weight.readsHeavier(g, days) : W.weight.readsLighter(g, days)}`;
      // The projection (roadmap Phase 9 item 6): the same line the station
      // sheet draws, in the same words. Only when the API computed one — it
      // needs product limits in force — and never without its assumption.
      if (!f.projection) return said;
      return `${said} ${projectionSentence(f.projection, { targetG: f.projection.targetG })}`;
    }
    case 'reject_rise': {
      const kind = f.rejectKind === 'weight' ? W.rejects.weightKind : W.rejects.quality;
      const since = f.sinceUtc ? fmtClock(f.sinceUtc) : '—';
      return `${cap(kind)} rejects have been rising since ${since} — ${fmtPct1(f.ratePct)} against a usual ${fmtPct1(f.usualPct)}.`;
    }
    case 'outside_product_limits':
      // (b) Countless, deliberately: with KPI figure 4 directly above this
      // block, a numeral here would be a second number for one fact, from a
      // DIFFERENT SQL population (productDisagreement — see D2 in the spec).
      // W.disagreement stays in words.ts for Weight's own banner.
      return W.outsideLimitsThisPeriod;
  }
}

/* ----------------------------------------------------------------- product */

/**
 * Footer line 2 of the merged "What is being made" block (OVERVIEW-SPEC.md
 * §3.4): the line-wide product record is now the FALLBACK for readings from
 * before the plant's own MaterialId column existed, not the primary answer —
 * the per-machine rows above (MachinesBlock) are. History and Change call the
 * same handler, `onOpenProduct` — both now open the dedicated Product screen
 * (UX Phase 6 Brief 1, 16 Sep 2026, IA-PROPOSAL.md §3.2), on its default
 * Running tab, which shows the SAME `/api/machines/running` payload
 * MachinesBlock draws above, pivoted by product rather than by station. That
 * is a different question (which products are in force vs. is the line
 * running), so the same numbers appearing on both screens is not the
 * duplication CLAUDE.md:305 forbids. The old product sheet component, which this used to
 * open, is deleted.
 */
function ProductFooter({
  data,
  canWrite,
  onOpenProduct,
}: {
  data: { product: { label: string } | null; limits: { targetG: number; label: string } | null; neverRecorded: boolean } | null;
  canWrite: boolean;
  onOpenProduct: () => void;
}) {
  if (!data) return <SkelLines n={2} short />;
  return (
    <div className="row between top" style={{ marginTop: 12 }}>
      <div>
        {!data.product ? (
          // D4: neverRecorded distinguishes "nothing was ever recorded for
          // this line" from "a product exists but none was in force at this
          // instant" — the normal case on a July-generation period or a
          // replay, which used to render the same sentence as the former.
          <p className="g">{data.neverRecorded ? W.product.none : W.product.noneAtThisTime}</p>
        ) : (
          <>
            <div className="product-name">{data.product.label}</div>
            {data.limits && (
              <div className="g">
                {W.product.target} {fmtG(data.limits.targetG)} · {W.product.limits} {data.limits.label}
              </div>
            )}
            {/* Requirement 3 says "update product details on machines". Nothing here
                reaches a machine, and the screen says so rather than implying it. */}
            <div className="mut sm">{W.product.notSentToMachine}</div>
          </>
        )}
      </div>
      <div className="row" style={{ gap: 16 }}>
        {/* Fixed alongside H3 (Sep 2026 audit): this used to link to a
            #history anchor that existed nowhere on the page. It opens the
            same product sheet Change does, available to every reader. */}
        <button type="button" className="linkish" onClick={onOpenProduct}>{W.product.history}</button>
        {canWrite && (
          <button type="button" className="btn" onClick={onOpenProduct}>
            {W.product.change}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- machines */

/**
 * One row per active station: the product it is running, since when, and how
 * many cones in the window. Quiet stations say so in the same row rather than
 * vanishing — a machine that stopped is information too. Compact on purpose:
 * this block sits between the product and the station grid and must not
 * push either off the first screen.
 */
function MachinesBlock({
  data,
  stations,
  onOpen,
}: {
  data: MachinesRunningData;
  stations: StationRow[];
  onOpen: (station: number) => void;
}) {
  if (data.asOfUtc == null || data.machines.length === 0) return <Empty message={W.nothingHere} />;
  const nameOf = new Map(stations.map((s) => [s.stationId, s]));
  return (
    <>
      <table>
        <tbody>
          {data.machines.map((m) => (
            <tr key={m.station} className="click" onClick={() => onOpen(m.station)} onKeyDown={rowKeys(() => onOpen(m.station))} tabIndex={0}>
              <td className="mut" style={{ width: '9em', whiteSpace: 'nowrap' }}>{stationLabel(nameOf.get(m.station), m.station)}</td>
              <td>
                {m.quiet ? (
                  <span className="mut">{W.cone.quiet2h}</span>
                ) : (
                  <>
                    <span style={{ fontWeight: 500 }}>{m.productName ?? (m.materialId != null ? W.cone.noProductName(m.materialId) : W.cone.noMaterial)}</span>
                    <span className="mut">
                      {' · '}
                      {m.sinceIsWindowStart || m.sinceUtc == null ? W.cone.sinceAtLeast : W.cone.since(fmtClock(m.sinceUtc))}
                      {' · '}
                      {W.cone.conesInWindow(fmtInt(m.conesOnMaterial))}
                    </span>
                  </>
                )}
                <Chevron />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mut sm" style={{ marginTop: 8 }}>{W.cone.machinesWindow}</p>
    </>
  );
}

/* ---------------------------------------------------------------- stations */

/** Seconds since a station last produced, measured from the newest reading. */
function quietSeconds(line: LiveLine, lastTs: string): number {
  const anchor = line.dataAsOfUtc ?? line.plantNowUtc;
  return Math.max(0, secondsBetween(lastTs, anchor));
}

function quietNote(line: LiveLine, stations: StationRow[]): string | null {
  const quiet = line.stations.filter((s) => quietSeconds(line, s.lastTs) > QUIET_AFTER_SECONDS);
  if (quiet.length === 0) return null;
  const worst = quiet.sort((a, b) => quietSeconds(line, b.lastTs) - quietSeconds(line, a.lastTs))[0]!;
  const name = stationLabel(stations.find((s) => s.stationId === worst.station), worst.station);
  if (quiet.length === 1) return `${name} has been quiet for ${fmtSpan(quietSeconds(line, worst.lastTs))}`;
  return `${quiet.length} stations quiet, longest ${name} for ${fmtSpan(quietSeconds(line, worst.lastTs))}`;
}

/** The station roster: never a hardcoded fourteen, requirement 10 is about
 *  accommodating more machines. Shared by the grid and the block note so the
 *  two agree on which group keys are real stations. */
function stationIds(line: LiveLine, stations: StationRow[]): number[] {
  const configured = stations.map((s) => s.stationId);
  const seen = line.stations.map((s) => s.station);
  return [...new Set([...configured, ...seen])].sort((a, b) => a - b);
}

/** groupBy=station groups sms.reject_event by source_station, which is NULL
 *  for rejects the QCS path never attached to a station (OVERVIEW-SPEC.md
 *  §3.3). Summed here rather than dropped, so the boxes' rejects never
 *  silently disagree with KPI figure 3. */
function unattributedRejectsCount(counts: ProductionRow[] | null, ids: number[]): number {
  if (!counts) return 0;
  const known = new Set(ids);
  let sum = 0;
  for (const r of counts) {
    if (!known.has(Number(r.group))) sum += r.rejectedCones;
  }
  return sum;
}

/** The Stations block's note: the quiet summary, plus the unattributed-
 *  rejects caveat when it is above zero, prefixed with the stale-anchor
 *  sentence when health is not 'ok'. Absent (null) in the normal case, so it
 *  costs no words in the steady state (OVERVIEW-SPEC.md §3.3 rules 3, 8). */
function stationsNote(
  line: LiveLine,
  stationsRoster: StationRow[],
  counts: ProductionRow[] | null,
  healthOk: boolean,
): string | null {
  const parts: string[] = [];
  const quiet = quietNote(line, stationsRoster);
  if (quiet) parts.push(quiet);
  const unattributed = unattributedRejectsCount(counts, stationIds(line, stationsRoster));
  if (unattributed > 0) parts.push(W.unattributedRejects(unattributed));
  const body = parts.length > 0 ? parts.join(' · ') : null;
  if (healthOk || line.dataAsOfUtc == null) return body;
  const prefix = W.measuredToNewest(fmtClock(line.dataAsOfUtc));
  return body ? `${prefix} · ${body}` : prefix;
}

function StationRowGrid({
  line,
  stations,
  counts,
  onOpen,
}: {
  line: LiveLine;
  stations: StationRow[];
  /** Cones and rejects per station for the SELECTED period. Null while it loads. */
  counts: ProductionRow[] | null;
  onOpen: (station: number) => void;
}) {
  const ids = useMemo(() => stationIds(line, stations), [stations, line.stations]);

  // The row keeps its full width and height while the names arrive, so the
  // block below it does not travel up the page.
  if (ids.length === 0) return <SkelStations n={14} />;

  // Two different questions, two different sources: how many cones the period
  // holds, and when the station last produced. The second is inherently live
  // and is what decides "quiet"; the first follows the period control.
  const liveById = new Map(line.stations.map((s) => [s.station, s]));
  const countById = new Map((counts ?? []).map((r) => [Number(r.group), r.cones]));
  const rejectById = new Map((counts ?? []).map((r) => [Number(r.group), r.rejectedCones]));
  const nameOf = new Map(stations.map((s) => [s.stationId, s]));

  return (
    <div className="stations" style={{ ['--st-count' as string]: String(ids.length) }}>
      {ids.map((id) => {
        const row = liveById.get(id);
        const cones = counts == null ? null : (countById.get(id) ?? 0);
        const rejected = counts == null ? 0 : (rejectById.get(id) ?? 0);
        const quiet = row ? quietSeconds(line, row.lastTs) > QUIET_AFTER_SECONDS : true;
        // Quiet always wins (OVERVIEW-SPEC.md §3.3): a machine that stopped
        // is the bigger fact than one that rejected a few cones.
        const tag = quiet ? W.quiet : rejected > 0 ? W.stationRejected(rejected) : ' ';
        return (
          <button
            key={id}
            type="button"
            className={`st${quiet ? ' quiet' : ''}`}
            onClick={() => onOpen(id)}
            title={stationLabel(nameOf.get(id), id)}
          >
            {/* The number alone unless the station has a plant name: the block
                is already headed "Stations", so repeating the word fourteen
                times is noise that also overflowed every box past nine. */}
            <span className="st-name">{nameOf.get(id)?.name?.trim() || id}</span>
            <span className="st-val">{cones == null ? '—' : fmtInt(cones)}</span>
            {/* The tag line is ALWAYS rendered, even when empty. .st-tag
                reserves 1.4em precisely so the row does not reflow — and every
                block below it does not travel up the page — the moment a
                station goes quiet. */}
            <span className="st-tag">{tag}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------- last readings */

function LastReadings({
  line,
  onOpen,
}: {
  line: LiveLine;
  onOpen: (type: 'cone' | 'sack', id: string | number) => void;
}) {
  const rows: { label: string; text: string; type: 'cone' | 'sack'; id: number }[] = [];
  if (line.lastSack) {
    rows.push({
      label: W.lastSack,
      type: 'sack',
      // The permalink takes the canonical PK. sourceRowId is IFL's own counter,
      // which they reset on 2026-08-05, so it now names two different sacks.
      id: line.lastSack.eventId,
      text: `${fmtKg(line.lastSack.weightKg)} · ${line.lastSack.inRange === false ? W.rejectedByScale : W.passed} · ${fmtClock(line.lastSack.ts)}`,
    });
  }
  if (line.lastCone) {
    rows.push({
      label: W.lastCone,
      type: 'cone',
      id: line.lastCone.eventId,
      text: `${fmtG(line.lastCone.weightG)} · ${line.lastCone.inRange === false ? W.rejectedByScale : W.passed} · Station ${line.lastCone.station ?? '—'} · ${fmtClock(line.lastCone.ts)}`,
    });
  }
  if (rows.length === 0) return <Empty message={W.nothingHere} />;
  return (
    <table>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="click" onClick={() => onOpen(r.type, r.id)}>
            <td className="mut" style={{ width: '9em' }}>{r.label}</td>
            <td>
              {r.text}
              <Chevron />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
