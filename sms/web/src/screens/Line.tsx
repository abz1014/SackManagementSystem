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
  Block, Chevron, Details, Empty, Figures, Loading,
  SkelFigures, SkelLines, SkelStations,
} from '../ui/bits';
import { fmtClock, fmtG, fmtInt, fmtKg, fmtSpan, secondsBetween } from '../lib/fmt';
import {
  getAttention, getProduction, getProductAt, getStations, stationLabel,
  type AttentionFinding, type LiveLine, type ProductionRow, type StationRow,
} from '../api';
import type { Screen } from '../ui/Bar';

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
  onChangeProduct,
  canWrite,
}: {
  period: Period;
  onNavigate: (s: Screen) => void;
  onOpenStation: (station: number) => void;
  onOpenReading: (type: 'cone' | 'sack', id: string | number) => void;
  onChangeProduct: () => void;
  canWrite: boolean;
}) {
  const { line, loading } = useLive();
  const health = assessHealth(line);

  const stations = usePolling(() => getStations(), 10 * 60_000, 'stations');

  // THE FIGURES OBEY THE PERIOD. They used to read line.thisShift, so "This
  // month" and "This shift" printed the same three numbers on the one screen
  // whose question is "what has it made this period" — the period control was
  // global everywhere except the home screen.
  const periodKey = `${period.from}:${period.to}:${period.shift ?? 'all'}`;
  const totals = usePolling(
    () => getProduction({ from: period.from, to: period.to, shift: period.shift, groupBy: 'none' }),
    period.live ? REFRESH_MS : 5 * 60_000,
    `line-totals:${periodKey}`,
  );
  const perStation = usePolling(
    () => getProduction({ from: period.from, to: period.to, shift: period.shift, groupBy: 'station' }),
    period.live ? REFRESH_MS : 5 * 60_000,
    `line-stations:${periodKey}`,
  );
  const product = usePolling(() => getProductAt(), REFRESH_MS, 'product-at');
  const attention = usePolling(
    () => getAttention({ from: period.from, to: period.to, shift: period.shift }),
    REFRESH_MS,
    `attention:${period.from}:${period.to}:${period.shift ?? 'all'}`,
  );

  if (loading && !line) return <Loading />;
  if (!line) return <Empty message={W.lag.noData} />;

  return (
    <>
      <div className="page">
        <p className="q">{W.question.line}</p>
        <h1 className="wide">
          <Headline line={line} knowable={stateIsKnowable(health)} />
        </h1>
      </div>

      <Block first>
        {totals.data ? (
          <Figures items={periodFigures(totals.data.data.rows[0] ?? null)} />
        ) : (
          <SkelFigures n={3} />
        )}
      </Block>

      <Block
        label={W.attention}
        note={attention.data ? W.judgedOver(attention.data.data.window.days) : null}
      >
        <AttentionList
          findings={attention.data?.data.findings ?? []}
          total={attention.data?.data.totalFindings ?? 0}
          stations={stations.data?.stations ?? []}
          loading={attention.loading && !attention.data}
          onNavigate={onNavigate}
        />
      </Block>

      <Block label={W.product.title} note={<a href="#history">{W.product.history}</a>}>
        <ProductBlock data={product.data} canWrite={canWrite} onChange={onChangeProduct} />
      </Block>

      <Block
        label={`${W.stations} — ${W.stationsNote}`}
        note={quietNote(line, stations.data?.stations ?? [])}
      >
        <StationRowGrid
          line={line}
          stations={stations.data?.stations ?? []}
          counts={perStation.data?.data.rows ?? null}
          onOpen={onOpenStation}
        />
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
 * What to call the line in a sentence.
 *
 * LINE_NAME is configured as "TP1 · Line 3 · Unit 2" — a full address, too long
 * for a headline. Taking the last segment gave "Unit 2 is running", which names
 * the building rather than the line, so the segment that actually says "Line"
 * is preferred and the whole name is the fallback.
 */
function lineTitle(line: LiveLine): string {
  const parts = line.lineName.split('·').map((p) => p.trim()).filter(Boolean);
  return parts.find((p) => /line/i.test(p)) ?? parts[parts.length - 1] ?? line.lineName;
}

/* ----------------------------------------------------------------- figures */

/** The three figures for the SELECTED period. Zeros, not dashes: an empty
 *  period is a normal fact on a plant that runs six days, and zero is a
 *  measurement. */
function periodFigures(r: ProductionRow | null) {
  const cones = r?.cones ?? 0;
  const rejected = r?.rejectedCones ?? 0;
  const sacks = r?.sacks ?? 0;
  const kg = r?.sackWeightKg ?? 0;
  const rejectRate =
    cones + rejected > 0 ? `${Math.round((1000 * rejected) / (cones + rejected)) / 10}%` : '0%';
  return [
    {
      value: fmtInt(cones),
      unit: W.fig.cones,
      note: r?.conesInRangePct != null ? W.withinLimits(`${r.conesInRangePct}%`) : null,
    },
    // Rounded: a headline figure with two decimal places reads as precision
    // the reader is being asked to care about, and nobody weighs a shift's
    // output to the gram.
    { value: fmtInt(sacks), unit: W.fig.sacks, note: `${fmtInt(Math.round(kg))} ${W.fig.kg}` },
    { value: fmtInt(rejected), unit: W.fig.rejected, note: W.ofEverything(rejectRate) },
  ];
}

/* --------------------------------------------------------------- attention */

function AttentionList({
  findings,
  total,
  stations,
  loading,
  onNavigate,
}: {
  findings: AttentionFinding[];
  total: number;
  stations: StationRow[];
  loading: boolean;
  onNavigate: (s: Screen) => void;
}) {
  // Two lines: the attention list is at most three sentences, and reserving
  // two keeps the block from growing as it lands on a calm shift.
  if (loading) return <SkelLines n={2} short />;
  if (findings.length === 0) {
    return (
      <ul className="attn calm">
        <li>{W.nothingNeedsAttention}</li>
      </ul>
    );
  }
  const byId = new Map(stations.map((s) => [s.stationId, s]));
  return (
    <>
      <ul className="attn">
        {findings.map((f, i) => (
          <li key={i}>
            <span className="say">{sentence(f, byId)}</span>{' '}
            <button type="button" className="linkish" onClick={() => onNavigate(f.screen as Screen)}>
              {W.nav[f.screen as keyof typeof W.nav]}
            </button>
          </li>
        ))}
      </ul>
      {total > findings.length && (
        <p className="attn-more">{W.andMore(total - findings.length, W.nav.weight)}</p>
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
      return `${name} ${(f.deltaG ?? 0) > 0 ? W.weight.readsHeavier(g, days) : W.weight.readsLighter(g, days)}`;
    }
    case 'reject_rise': {
      const kind = f.rejectKind === 'weight' ? W.rejects.weightKind : W.rejects.quality;
      const since = f.sinceUtc ? fmtClock(f.sinceUtc) : '—';
      return `${cap(kind)} rejects have been rising since ${since} — ${f.ratePct}% against a usual ${f.usualPct}%.`;
    }
    case 'outside_product_limits':
      return W.disagreement(f.count ?? 0);
  }
}

/* ----------------------------------------------------------------- product */

function ProductBlock({
  data,
  canWrite,
  onChange,
}: {
  data: { product: { label: string } | null; limits: { targetG: number; label: string } | null; neverRecorded: boolean } | null;
  canWrite: boolean;
  onChange: () => void;
}) {
  if (!data) return <SkelLines n={3} short />;
  if (!data.product) return <p className="g">{W.product.none}</p>;
  return (
    <div className="row between top">
      <div>
        <div className="product-name">{data.product.label}</div>
        {data.limits && (
          <div className="g">
            {W.product.target} {fmtG(data.limits.targetG)} · {W.product.limits} {data.limits.label}
          </div>
        )}
        {/* Requirement 3 says "update product details on machines". Nothing here
            reaches a machine, and the screen says so rather than implying it. */}
        <div className="mut sm">{W.product.notSentToMachine}</div>
      </div>
      {canWrite && (
        <button type="button" className="btn" onClick={onChange}>
          {W.product.change}
        </button>
      )}
    </div>
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

function StationRowGrid({
  line,
  stations,
  counts,
  onOpen,
}: {
  line: LiveLine;
  stations: StationRow[];
  /** Cones per station for the SELECTED period. Null while it loads. */
  counts: ProductionRow[] | null;
  onOpen: (station: number) => void;
}) {
  // The count comes from Setup, not a hardcoded fourteen: requirement 10 is
  // about accommodating more machines, and a constant in the bundle is the
  // first thing that stops that being true.
  const ids = useMemo(() => {
    const configured = stations.map((s) => s.stationId);
    const seen = line.stations.map((s) => s.station);
    return [...new Set([...configured, ...seen])].sort((a, b) => a - b);
  }, [stations, line.stations]);

  // The row keeps its full width and height while the names arrive, so the
  // block below it does not travel up the page.
  if (ids.length === 0) return <SkelStations n={14} />;

  // Two different questions, two different sources: how many cones the period
  // holds, and when the station last produced. The second is inherently live
  // and is what decides "quiet"; the first follows the period control.
  const liveById = new Map(line.stations.map((s) => [s.station, s]));
  const countById = new Map((counts ?? []).map((r) => [Number(r.group), r.cones]));
  const nameOf = new Map(stations.map((s) => [s.stationId, s]));

  return (
    <div className="stations" style={{ ['--st-count' as string]: String(ids.length) }}>
      {ids.map((id) => {
        const row = liveById.get(id);
        const cones = counts == null ? null : (countById.get(id) ?? 0);
        const quiet = row ? quietSeconds(line, row.lastTs) > QUIET_AFTER_SECONDS : true;
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
            <span className="st-tag">{quiet ? W.quiet : ' '}</span>
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
      id: line.lastSack.sourceRowId,
      text: `${fmtKg(line.lastSack.weightKg)} · ${line.lastSack.inRange === false ? W.rejectedByScale : W.passed} · ${fmtClock(line.lastSack.ts)}`,
    });
  }
  if (line.lastCone) {
    rows.push({
      label: W.lastCone,
      type: 'cone',
      id: line.lastCone.sourceRowId,
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
