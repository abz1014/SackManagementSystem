/**
 * Production report — pick a period, read what the line made.
 *
 * IFL's requirement list asks for "comprehensive reporting, analytics and
 * graphical dashboards". Analytics and dashboards existed; reporting did not,
 * and there was nowhere in the app that answered "how much did we make this
 * month". This is that screen.
 *
 * It carries ONE chart, on purpose. The complaint about the analysis screens
 * was that the charts could not be read, so this one is built against that:
 * a labelled vertical axis, x labels thinned so they can never collide, and a
 * readout that names the day and its figures when you point at a bar. It is
 * plain HTML rather than SVG so it survives printing, which is the other thing
 * a report has to do.
 *
 * Coverage is stated before any figure. On the supplied copy "this quarter" is
 * 19 days of 92, and a total printed without saying so reads as a quarter's
 * output.
 */
import { useEffect, useMemo, useState } from 'react';
import { getReport, type ReportData, type ReportLine, type ReportPeriod, type Meta } from '../api';
import { downloadCsv, csvName } from '../csv';
import { usePolling, useLive, LIST_POLL_MS } from './live';
import { S } from './strings';
import { fmtDayLong, fmtDay, fmtInt, fmtSpan } from './fmt';
import { Measure, ReplayBanner, LiveFooter } from './bits';

const PERIODS: readonly ReportPeriod[] = ['day', 'week', 'month', 'quarter', 'custom'] as const;

export function parsePeriod(sub: string | undefined): ReportPeriod {
  return (PERIODS as readonly string[]).includes(sub ?? '') ? (sub as ReportPeriod) : 'day';
}

const kg = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} kg`);
const kg2 = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`);
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`);

/**
 * Cones per day.
 *
 * Bars are plain divs in a flex row. The vertical axis is labelled at zero,
 * midpoint and maximum; x labels appear at a computed step so a 92-day quarter
 * shows about ten of them instead of ninety overlapping ones. Hovering or
 * focusing a bar fills the readout above the chart rather than floating a
 * tooltip, which cannot be clipped by the panel edge and prints as static text.
 */
function DayBars({ rows }: { rows: ReportLine[] }) {
  const [hover, setHover] = useState<ReportLine | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.cones));
  const shown = hover;

  return (
    <div className="rchart">
      <div className="rchart-readout" aria-live="polite">
        {shown ? (
          <>
            <b>{fmtDayLong(shown.group)}</b>
            <span>
              {fmtInt(shown.cones)} {S.cones.toLowerCase()} · {fmtInt(shown.sacks)} {S.sacks.toLowerCase()} ·{' '}
              {kg(shown.sackWeightKg)} · {fmtInt(shown.rejectedCones)} {S.rejected.toLowerCase()} ({pct(shown.rejectRatePct)})
            </span>
          </>
        ) : (
          <span className="rchart-hint">{S.hoverADay}</span>
        )}
      </div>

      <div className="rchart-body">
        <div className="rchart-axis" aria-hidden="true">
          <span>{fmtInt(max)}</span>
          <span>{fmtInt(Math.round(max / 2))}</span>
          <span>0</span>
        </div>
        <div className="rchart-plot" onMouseLeave={() => setHover(null)}>
          <div className="rchart-grid" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="rchart-bars">
            {rows.map((r) => (
              <button
                key={r.group}
                type="button"
                className={`rbar${hover?.group === r.group ? ' on' : ''}`}
                style={{ height: `${(100 * r.cones) / max}%` }}
                title={`${r.group}: ${fmtInt(r.cones)} ${S.cones.toLowerCase()}`}
                onMouseEnter={() => setHover(r)}
                onFocus={() => setHover(r)}
                onBlur={() => setHover(null)}
                aria-label={`${r.group}: ${fmtInt(r.cones)} cones`}
              />
            ))}
          </div>
        </div>
        {/* Two labels, the ends of the range, and nothing between them.
            A label per bar is what makes the analysis charts unreadable: ten
            dates in a 370px plot need 60px each and have 37px, so they sit on
            top of one another. The exact day of any bar comes from the readout
            above, which is what pointing at it is for. */}
        <div className="rchart-xaxis" aria-hidden="true">
          <span>{fmtDay(`${rows[0]!.group}T12:00:00Z`)}</span>
          <span>{fmtDay(`${rows[rows.length - 1]!.group}T12:00:00Z`)}</span>
        </div>
      </div>
    </div>
  );
}

function LineTable({ title, header, rows, labelOf }: {
  title: string;
  header: string;
  rows: ReportLine[];
  labelOf: (r: ReportLine) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="panel rtable-panel">
      <div className="panel-head">
        <h3 className="panel-title">{title}</h3>
      </div>
      <div className="rtable-scroll">
        <table className="rtable">
          <thead>
            <tr>
              <th>{header}</th>
              <th className="num">{S.totalCones}</th>
              <th className="num">{S.rejected}</th>
              <th className="num">{S.rejectRate}</th>
              <th className="num">{S.totalSacks}</th>
              <th className="num">{S.totalWeight}</th>
              <th className="num">{S.avgSack}</th>
              <th className="num">{S.perSack}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.group}>
                <td className="cap">{labelOf(r)}</td>
                <td className="num">{fmtInt(r.cones)}</td>
                <td className="num">{fmtInt(r.rejectedCones)}</td>
                <td className="num">{pct(r.rejectRatePct)}</td>
                <td className="num">{fmtInt(r.sacks)}</td>
                <td className="num">{kg(r.sackWeightKg)}</td>
                <td className="num">{kg2(r.avgSackKg)}</td>
                <td className="num">{r.conesPerSack ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ReportScreen({
  sub,
  onMeta,
  range,
}: {
  sub: string;
  onMeta: (m: Meta) => void;
  /** The window that holds production, for the picker bounds and the
   *  empty-period hint. */
  range: { min: string | null; max: string | null };
}) {
  const live = useLive();
  const period = parsePeriod(sub);
  const plantDay = live.line?.shift.shiftDate ?? '';
  // One date drives Day, Week, Month and Quarter: the period is whichever one
  // contains it. Seeded with the plant's current production day, which is what
  // "this month" means to someone standing at the line, and changeable so a
  // past month can be pulled up without switching to a custom range.
  const [anchor, setAnchor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    if (!anchor && plantDay) setAnchor(plantDay);
  }, [anchor, plantDay]);

  // A custom range with only one end filled is not a query yet; hold the last
  // good one rather than asking the server for a half-specified period.
  const ready = period !== 'custom' ? Boolean(anchor) : Boolean(from && to && from <= to);
  const key = `report:${period}:${anchor}:${from}:${to}`;

  const poll = usePolling<{ data: ReportData; metadata: Meta } | null>(
    async () => {
      if (!ready) return null;
      const env = await getReport(
        period === 'custom' ? { period, from, to } : { period, anchor },
      );
      onMeta(env.metadata);
      return env;
    },
    LIST_POLL_MS,
    key,
  );

  const data = poll.data?.data ?? null;

  const exportCsv = () => {
    if (!data) return;
    const head = ['Group', 'Cones', 'Rejected cones', 'Reject rate %', 'In range %', 'Sacks', 'Sack weight kg', 'Average sack kg', 'Cones per sack'];
    const line = (r: ReportLine, label: string) => [
      label, r.cones, r.rejectedCones, r.rejectRatePct, r.conesInRangePct, r.sacks, r.sackWeightKg, r.avgSackKg, r.conesPerSack,
    ];
    downloadCsv(
      csvName('report', data.period.from, data.period.to),
      head,
      [
        line(data.totals, S.total),
        ...data.byShift.map((r) => line(r, r.group)),
        ...data.byDay.map((r) => line(r, r.group)),
      ],
    );
  };

  const coverage = useMemo(() => {
    if (!data) return null;
    const c = data.coverage;
    if (c.daysWithData === 0) return { level: 'none' as const, text: S.noProduction };
    if (c.complete) {
      return {
        level: 'ok' as const,
        text:
          c.daysInPeriod === 1
            ? 'This day has production data.'
            : `All ${c.daysInPeriod} days in this period have production data.`,
      };
    }
    return {
      level: 'part' as const,
      text: `${c.daysWithData} of ${c.daysInPeriod} days in this period have production data, from ${fmtDayLong(c.firstDayWithData!)} to ${fmtDayLong(c.lastDayWithData!)}. The totals below cover those ${c.daysWithData} days only.`,
    };
  }, [data]);

  const rangeLabel = data
    ? data.period.from === data.period.to
      ? fmtDayLong(data.period.from)
      : `${fmtDayLong(data.period.from)} to ${fmtDayLong(data.period.to)}`
    : '';

  return (
    <div className="report">
      <ReplayBanner />

      <header className="list-head">
        <div>
          <div className="eyebrow">
            {S.period[period]} · {S.periodNote[period]}
          </div>
          <h2 className="list-title">{rangeLabel || S.loading}</h2>
        </div>
        <div className="list-controls no-print">
          {period === 'custom' ? (
            <>
              <input type="date" className="ov-date" aria-label="From" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              <input type="date" className="ov-date" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </>
          ) : (
            <input
              type="date"
              className="ov-date"
              aria-label="Date in period"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
            />
          )}
          <button type="button" className="btn-more" onClick={() => window.print()} disabled={!data}>
            {S.print}
          </button>
          <button type="button" className="btn-more" onClick={exportCsv} disabled={!data}>
            {S.exportCsv}
          </button>
        </div>
      </header>

      {!ready ? (
        <div className="empty-note">{period === 'custom' ? S.periodNote.custom : S.loading}</div>
      ) : poll.error ? (
        <div className="error-card" role="alert">
          <b>{S.offline}</b> {poll.error}
        </div>
      ) : !data ? (
        <div className="sk sk-ribbon" aria-busy="true" />
      ) : (
        <>
          {coverage && (
            <div className={`coverage ${coverage.level}`}>
              {coverage.text}
              {/* A period with nothing in it is not necessarily a mistake — a
                  quiet Sunday looks the same. Naming the newest day that DOES
                  hold readings turns a blank screen into either "nothing ran"
                  or "the sync stopped weeks ago", which are different problems. */}
              {coverage.level === 'none' && range.max && (
                <>
                  {' '}The most recent production day on record is {fmtDayLong(range.max)}.{' '}
                  {period !== 'custom' && (
                    <button type="button" className="rr-link no-print" onClick={() => setAnchor(range.max!)}>
                      Show that period →
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          <div className="tiles">
            <section className="tile">
              <div className="tile-label">{S.totalCones}</div>
              <div className="tile-value"><Measure parts={{ value: fmtInt(data.totals.cones), unit: '' }} /></div>
              <div className="tile-foot">{pct(data.totals.conesInRangePct)} {S.inWeightRange}</div>
            </section>
            <section className="tile">
              <div className="tile-label">{S.totalSacks}</div>
              <div className="tile-value"><Measure parts={{ value: fmtInt(data.totals.sacks), unit: '' }} /></div>
              <div className="tile-foot">{data.totals.conesPerSack ?? '—'} {S.perSack.toLowerCase()}</div>
            </section>
            <section className="tile">
              <div className="tile-label">{S.totalWeight}</div>
              {/* Whole kilograms. The underlying total carries one decimal, so
                  printing two would invent a digit — it showed "140,853.90"
                  for a measured 140,853.88 — and a period total does not need
                  grams anyway. The average sack below keeps its decimals,
                  where they are real and useful. */}
              <div className="tile-value">
                <Measure parts={{ value: Math.round(data.totals.sackWeightKg).toLocaleString('en-US'), unit: 'kg' }} />
              </div>
              <div className="tile-foot">{kg2(data.totals.avgSackKg)} {S.avgSack.toLowerCase()}</div>
            </section>
            <section className="tile">
              <div className="tile-label">{S.rejected}</div>
              <div className="tile-value"><Measure parts={{ value: fmtInt(data.totals.rejectedCones), unit: '' }} /></div>
              <div className="tile-foot">{pct(data.totals.rejectRatePct)} {S.rejectRate.toLowerCase()}</div>
            </section>
          </div>

          <section className="panel downtime-line">
            <div className="dl-figures">
              <div>
                <span className="tile-label">{S.timeLost}</span>
                <span className="dl-val">{fmtSpan(data.downtime.stoppedSeconds)}</span>
              </div>
              <div>
                <span className="tile-label">{S.stops}</span>
                <span className="dl-val">{fmtInt(data.downtime.stoppageCount)}</span>
              </div>
            </div>
            <div className="panel-foot">{S.timeLostNote}</div>
          </section>

          {data.byDay.length > 1 && (
            <section className="panel">
              <div className="panel-head">
                <h3 className="panel-title">{S.dayChartTitle}</h3>
              </div>
              <DayBars rows={data.byDay} />
            </section>
          )}

          <LineTable title={S.byShiftTitle} header={S.shiftHeader} rows={data.byShift} labelOf={(r) => r.group} />
          <LineTable title={S.byDayTitle} header={S.dayHeader} rows={data.byDay} labelOf={(r) => fmtDayLong(r.group)} />
        </>
      )}

      <LiveFooter />
    </div>
  );
}
