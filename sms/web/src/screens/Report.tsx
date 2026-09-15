/**
 * Report — "What did the line make over this period, on paper."
 *
 * The reporting half of requirement 8 and the sack log of requirement 6. It is
 * the screen the audit called the best-behaved in the old app, so the redesign
 * mostly generalises it rather than replacing it: coverage stated FIRST, one
 * chart, plain tables that print as they stand.
 *
 * Two things it must say that the old one did not:
 *  - a print header, because a printed page without the line, the period, the
 *    coverage and who printed it is an undated, unattributed sheet of numbers;
 *  - one sentence under the sack totals explaining why sack stock per machine
 *    is missing. Requirement 7 is the largest thing IFL asked for, and a GM who
 *    looks for it must find the reason rather than a blank space.
 */
import { useState } from 'react';
import { usePolling, usePlantNow, useLive } from '../lib/live';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import { Block, Empty, Failed, SkelChart, SkelFigures, SkelLines } from '../ui/bits';
import { Readout, useChartWidth, edgeAnchor } from '../ui/chart';
import { fmtDayLong, fmtInt, fmtKg, fmtPct1, fmtSpan } from '../lib/fmt';
import { downloadCsv, csvName, type CsvRow } from '../csv';
import { getReport, type ReportData, type ReportLine, type AuthUser } from '../api';

export function ReportScreen({ period, user }: { period: Period; user: AuthUser }) {
  // The plant's clock, not the browser's: a printed plant record is stamped
  // with the time the plant was keeping.
  const plantNow = usePlantNow();
  const { line } = useLive();
  const lineName = line?.lineName ?? '';
  // The global period always resolves to explicit dates, so the report is
  // always asked for a custom range — one period control, not two.
  const r = usePolling(
    () => getReport({ period: 'custom', from: period.from, to: period.to }),
    period.live ? 60_000 : 10 * 60_000,
    `report:${period.from}:${period.to}`,
  );

  if (r.error && !r.data) return <Failed error={r.error} onRetry={r.refresh} />;
  if (!r.data) return <ReportSkeleton />;
  const d = r.data.data;

  return (
    <>
      <div className="page">
      <div className="print-head">
        <b>Report · {period.from} to {period.to}</b>
        <div>{printedLine(plantNow, user)}</div>
      </div>

      <div className="head-row">
        <div>
          <p className="q no-print">{W.question.report}</p>
          <h1 className="wide">{coverage(d)}</h1>
        </div>
        <div className="head-actions">
          {/* Print and Export sit at the TOP of the screen. A control the
              reader has to scroll past the content to find is a control they
              do not know exists. Both are disabled while the report is still
              arriving: a half-loaded report must not be printable. */}
          <div className="row no-print">
            <button type="button" className="btn" disabled={r.loading} onClick={() => window.print()}>
              {W.report.print}
            </button>
            <button type="button" className="btn" disabled={r.loading} onClick={() => exportCsv(d, plantNow, user, lineName)}>
              {W.report.exportCsv}
            </button>
          </div>
          {/* THE VERDICT MARK — the one ink fill in the application, and the
              reason this is the only screen carrying it: Report is the only
              one whose output leaves the building. It states the figure that
              was signed for, its period and its line, and who printed it.
              Absent when the period holds no production days: there is
              nothing to sign for. */}
          {d.coverage.daysWithData > 0 && (
            <div className="verdict">
              <span className="lbl">{W.report.verdict}</span>
              <span className="val">
                {fmtInt(d.totals.cones)} {W.fig.cones}, {fmtInt(d.totals.sacks)} {W.fig.sacks},{' '}
                {fmtInt(Math.round(d.totals.sackWeightKg))} {W.fig.kg}
                <br />
                {fmtDayShort(d.period.from)} – {fmtDayShort(d.period.to)} · {lineName}
              </span>
              <span className="who">{printedLine(plantNow, user)}</span>
            </div>
          )}
        </div>
      </div>
      </div>

      {d.totals.cones === 0 ? (
        <Block first>
          <Empty message={W.nothingHere} />
        </Block>
      ) : (
        <>
          <Block first>
            <Totals t={d.totals} />
          </Block>

          <Block label={W.report.conesPerDay}>
            <DayBars rows={d.byDay} />
            <p className="g" style={{ marginTop: 18 }}>
              {W.report.timeLost(fmtSpan(d.downtime.stoppedSeconds), d.downtime.stoppageCount)}{' '}
              <span className="mut sm">({W.report.timeLostCaveat})</span>.
            </p>
            <p className="mut sm" style={{ marginTop: 10 }}>{W.report.noSackStock}</p>
            {/* Roadmap Phase 4 (14 Sep 2026): the population every weight
                figure was computed over, and the shift-attribution check —
                the same two facts Weight and Setup › Rules state, in the
                same words, so the printed page agrees with the screens. */}
            {d.readings && (
              <p className="mut sm" style={{ marginTop: 6 }}>
                {W.cone.readingsSentence(fmtInt(d.totals.cones), fmtInt(d.readings.implausible))}
              </p>
            )}
            {d.shiftCheck && (
              <p className="mut sm" style={{ marginTop: 6 }}>
                {W.cone.shiftSentence(
                  fmtInt(d.shiftCheck.mismatched),
                  fmtInt(d.shiftCheck.compared),
                  d.shiftCheck.topHour == null ? null : `${String(d.shiftCheck.topHour).padStart(2, '0')}:00`,
                )}
              </p>
            )}
          </Block>

          <Block>
            <div className="two-col">
              <div>
                <p className="h2"><span>{W.report.byShift}</span></p>
                <div className="tw"><LineTable rows={d.byShift} head={W.report.colShift} /></div>
              </div>
              <div>
                <p className="h2"><span>{W.report.byDay}</span></p>
                <div className="tw"><LineTable rows={d.byDay} head={W.report.colDay} /></div>
              </div>
            </div>
          </Block>
        </>
      )}
    </>
  );
}

/* --------------------------------------------------------------- coverage */

/** Coverage first, always: a period with holes must say so before its totals. */
function coverage(d: ReportData): string {
  const c = d.coverage;
  const label = `${fmtDayLong(d.period.from)} to ${fmtDayLong(d.period.to)}`;
  const short = d.period.from === d.period.to ? fmtDayLong(d.period.from) : label;
  if (c.daysWithData === 0) return W.report.coverageNone(short);
  if (c.complete) return W.report.coverageAll(short, c.daysInPeriod);
  return W.report.coveragePartial(
    short,
    c.daysWithData,
    c.daysInPeriod,
    c.firstDayWithData ? fmtDayLong(c.firstDayWithData) : '—',
    c.lastDayWithData ? fmtDayLong(c.lastDayWithData) : '—',
  );
}

function Totals({ t }: { t: ReportLine }) {
  return (
    <div className="figs four">
      <Fig v={fmtInt(t.cones)} u={W.fig.cones} n={t.conesInRangePct != null ? W.withinLimits(fmtPct1(t.conesInRangePct)) : null} />
      <Fig v={fmtInt(t.sacks)} u={W.fig.sacks} n={t.conesPerSack != null ? `${t.conesPerSack} ${W.report.perSack}` : null} />
      <Fig v={fmtInt(Math.round(t.sackWeightKg))} u={W.fig.kg} n={t.avgSackKg != null ? `${fmtKg(t.avgSackKg)} ${W.report.averageSack}` : null} />
      <Fig v={fmtInt(t.rejectedCones)} u={W.fig.rejected} n={t.rejectRatePct != null ? W.ofEverything(fmtPct1(t.rejectRatePct)) : null} />
    </div>
  );
}

function Fig({ v, u, n }: { v: string; u: string; n: string | null }) {
  return (
    <div>
      <b className="fig-val">{v}<span className="fig-unit">{u}</span></b>
      {n && <span className="fig-note">{n}</span>}
    </div>
  );
}

/* ------------------------------------------------------------- the chart */

function DayBars({ rows }: { rows: ReportLine[] }) {
  const [box, width] = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 240;
  const L = 56;
  const R = 8;
  const T = 24;
  const B = 30;

  const days = rows.filter((r) => r.group !== 'total');
  if (days.length === 0) return <Empty message={W.report.coverageNone('This period')} />;

  const max = Math.max(...days.map((d) => d.cones), 1);
  const slot = (width - L - R) / days.length;
  const bw = Math.max(4, slot * 0.62);
  const y = (v: number) => T + ((max - v) / max) * (H - T - B);
  const cx = (i: number) => L + slot * i + slot / 2;

  // A label under every bar only when they fit; otherwise the ends and the
  // middles, anchored inward so no tick hangs off the plot.
  const step = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor((width - L - R) / 90))));
  const grid = [0.25, 0.5, 0.75].map((f) => Math.round((max * f) / 500) * 500).filter((v) => v > 0);

  const h = hover != null ? days[hover] : null;

  return (
    <div ref={box}>
      <Readout
        hovered={h ? `${fmtDayLong(h.group)} · ${fmtInt(h.cones)} cones · ${fmtInt(h.sacks)} sacks` : null}
        resting={`${days.length} ${days.length === 1 ? 'day' : 'days'} · ${fmtInt(Math.min(...days.map((d) => d.cones)))} to ${fmtInt(max)} cones`}
      />
      <svg className="chart" viewBox={`0 0 ${width} ${H}`} height={H} role="img" aria-label={W.report.conesPerDay}>
        {[...new Set(grid)].map((v) => (
          <g key={v}>
            <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} stroke="var(--rule)" />
            <text x={L - 8} y={y(v) + 4} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor="end">{fmtInt(v)}</text>
          </g>
        ))}
        {days.map((d, i) => (
          <rect
            key={d.group}
            x={cx(i) - bw / 2}
            y={y(d.cones)}
            width={bw}
            height={Math.max(0, H - B - y(d.cones))}
            fill={hover === i ? 'var(--ink)' : 'var(--graphite)'}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {days.map((d, i) =>
          i % step === 0 || i === days.length - 1 ? (
            <text
              key={`t${d.group}`}
              x={cx(i)}
              y={H - 8}
              fontSize="var(--fs-tick)"
              fill="var(--muted)"
              textAnchor={edgeAnchor(i, days.length)}
            >
              {fmtDayShort(d.group)}
            </text>
          ) : null,
        )}
        <line x1={L} x2={width - R} y1={H - B} y2={H - B} stroke="var(--rule-2)" />
      </svg>
    </div>
  );
}

/** Who printed this, and when, on the plant's own clock. */
function printedLine(plantNowUtc: string | null, user: AuthUser): string {
  const when = plantNowUtc
    ? new Date(plantNowUtc).toLocaleString('en-GB', {
        timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—';
  return `${W.report.printedAt} ${when} ${W.report.printedBy} ${user.displayName ?? user.username}`;
}

/** "31 Aug" — a bar label a person reads without decoding. */
function fmtDayShort(day: string): string {
  return new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC', day: 'numeric', month: 'short',
  });
}

/* ------------------------------------------------------------- the tables */

function LineTable({ rows, head }: { rows: ReportLine[]; head: string }) {
  const body = rows.filter((r) => r.group !== 'total');
  if (body.length === 0) return <Empty message={W.nothingHere} />;
  return (
    <table>
      <thead>
        <tr>
          <th>{head}</th>
          <th className="n">{W.report.colCones}</th>
          <th className="n">{W.report.colSacks}</th>
          <th className="n">{W.report.colSackWeight}</th>
          <th className="n">{W.report.colRejected}</th>
        </tr>
      </thead>
      <tbody>
        {body.map((r) => (
          <tr key={r.group}>
            <td>{head === W.report.colShift ? (W.shiftName[r.group as 'morning'] ?? r.group) : fmtDayShort(r.group)}</td>
            <td className="n">{fmtInt(r.cones)}</td>
            <td className="n">{fmtInt(r.sacks)}</td>
            <td className="n">{fmtInt(Math.round(r.sackWeightKg))} {W.fig.kg}</td>
            <td className="n">{fmtInt(r.rejectedCones)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ export */

function exportCsv(d: ReportData, plantNowUtc: string | null, user: AuthUser, lineName: string): void {
  const headers = [
    "scope", "group", "cones", "cones_in_range_pct", "sacks", "sack_weight_kg",
    "avg_sack_kg", "cones_per_sack", "rejected_cones", "reject_rate_pct",
  ];
  const line = (scope: string, r: ReportLine): CsvRow => [
    scope, r.group, r.cones, r.conesInRangePct, r.sacks, r.sackWeightKg,
    r.avgSackKg, r.conesPerSack, r.rejectedCones, r.rejectRatePct,
  ];
  const rows: CsvRow[] = [
    line("total", d.totals),
    ...d.byShift.map((r) => line("shift", r)),
    ...d.byDay.map((r) => line("day", r)),
  ];
  // (d) the filename plus (c) trailing rows after a blank line: the filename
  // does the everyday work, the rows survive for anyone who opens the file
  // properly, and neither mangles Excel the way a comment header would.
  const who = user.displayName ?? user.username;
  downloadCsv(csvName("report", d.period.from, d.period.to, who), headers, rows, [
    ["line", lineName],
    ["period", `${d.period.from} to ${d.period.to}`],
    ["days_with_data", String(d.coverage.daysWithData)],
    ["exported", printedLine(plantNowUtc, user)],
  ]);
}

/** Report's shape while it loads: coverage sentence, four totals, chart, tables. */
function ReportSkeleton() {
  return (
    <>
      <div className="page">
        <p className="q">{W.question.report}</p>
        <div className="skel line" style={{ height: 'var(--fs-head)', maxWidth: '34ch' }} />
      </div>
      <Block first>
        <SkelFigures n={4} />
      </Block>
      <Block label={W.report.conesPerDay}>
        <SkelChart />
      </Block>
      <Block label={W.report.byDay}>
        <SkelLines n={7} />
      </Block>
    </>
  );
}