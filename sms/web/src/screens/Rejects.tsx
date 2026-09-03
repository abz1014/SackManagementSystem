/**
 * Rejects — "How many cones are being rejected, why, is it getting worse, and
 * where?" Requirement 4, on one screen instead of three.
 *
 * TWO CORRECTIONS FROM THE ENGINEER'S REVIEW, both load-bearing:
 *
 *  1. WEIGHT AND QUALITY ARE DRAWN SEPARATELY. They have different causes and
 *     different owners: a rise in weight rejects sends you to the scales and
 *     the winders, a rise in quality codes sends you to tubes and material.
 *     The old single line merged them, so the one fact that tells you where to
 *     walk was averaged away.
 *  2. THE TREND IS DRAWN OVER THE TRAILING WINDOW WITH THE PERIOD SHADED, not
 *     over the period alone. A sustained rise cannot be seen inside an
 *     eight-hour window, so on "This shift" the old chart could only ever show
 *     noise. The rise stays visible from any period.
 *
 * There is no "by station" section here. That was the third screen ranking the
 * same fourteen stations, and it is now a link into the one station table on
 * Weight, which already carries a reject-rate column.
 */
import { useState } from 'react';
import { useLive, usePolling } from '../lib/live';
import { W } from '../lib/words';
import { trailingWindow, type Period } from '../lib/period';
import { Block, Details, Empty, Failed, Loading } from '../ui/bits';
import { Readout, useChartWidth, edgeAnchor, linePath } from '../ui/chart';
import { fmtInt } from '../lib/fmt';
import {
  getRejects, getRejectSpc, setRejectLabel,
  type RejectReason, type RejectSpcData,
} from '../api';

export function RejectsScreen({
  period,
  onSeeCones,
  onSeeStations,
  canName,
}: {
  period: Period;
  onSeeCones: () => void;
  onSeeStations: () => void;
  canName: boolean;
}) {
  const { line } = useLive();
  const win = line
    ? trailingWindow({
        shiftDate: line.shift.shiftDate,
        shiftCode: line.shift.code,
        shiftStartUtc: line.shift.startUtc,
        plantNowUtc: line.plantNowUtc,
        dataAsOfUtc: line.dataAsOfUtc,
      })
    : null;

  const quality = usePolling(
    () => getRejectSpc(win!.from, win!.to, 'quality', 'day'),
    5 * 60_000,
    `rspc:q:${win?.from}:${win?.to}`,
  );
  const weight = usePolling(
    () => getRejectSpc(win!.from, win!.to, 'weight', 'day'),
    5 * 60_000,
    `rspc:w:${win?.from}:${win?.to}`,
  );
  const reasons = usePolling(
    () => getRejects(win!.from, win!.to),
    5 * 60_000,
    `reasons:${win?.from}:${win?.to}`,
  );
  // The period figures, which are what the headline counts.
  const periodQ = usePolling(
    () => getRejectSpc(period.from, period.to, 'quality', 'day'),
    period.live ? 60_000 : 5 * 60_000,
    `pq:${period.from}:${period.to}`,
  );
  const periodW = usePolling(
    () => getRejectSpc(period.from, period.to, 'weight', 'day'),
    period.live ? 60_000 : 5 * 60_000,
    `pw:${period.from}:${period.to}`,
  );

  if (!win) return <Loading />;
  if (quality.error && !quality.data) return <Failed error={quality.error} onRetry={quality.refresh} />;

  const q = periodQ.data?.data ?? null;
  const w = periodW.data?.data ?? null;
  const totalRejects = (q?.totalRejects ?? 0) + (w?.totalRejects ?? 0);
  const produced = q?.totalProduced ?? 0;
  const ratePct = produced + totalRejects > 0 ? (100 * totalRejects) / (produced + totalRejects) : null;

  const rising = ongoing(quality.data?.data) ?? ongoing(weight.data?.data);
  const risingKind = ongoing(quality.data?.data) ? W.rejects.quality : W.rejects.weightKind;

  const top = reasons.data?.data.reasons?.[0] ?? null;

  return (
    <>
      <div className="page">
      <p className="q">{W.question.rejects}</p>
      <h1 className="wide">
        {q == null || w == null
          ? '…'
          : `${W.rejects.headline(fmtInt(totalRejects), ratePct == null ? '—' : `${Math.round(ratePct * 10) / 10}%`, q.totalRejects, w.totalRejects)} — ${
              rising ? W.rejects.risingSince(dayLabel(rising.startTs), risingKind) : W.rejects.steady
            }.`}
      </h1>
      </div>

      <Block first>
        <div className="figs two">
          <div>
            <b className="fig-val">{fmtInt(totalRejects)}<span className="fig-unit">{W.fig.rejected}</span></b>
            <span className="fig-note">{ratePct == null ? '—' : W.ofEverything(`${Math.round(ratePct * 10) / 10}%`)}</span>
          </div>
          <div>
            <b className="fig-val">{top ? `${Math.round(top.pct)}%` : '—'}</b>
            <span className="fig-note">
              {top ? `${reasonName(top)} · ${W.rejects.topReason} over the last ${win.requestedDays} days` : W.rejects.none}
            </span>
          </div>
        </div>
      </Block>

      <Block label={W.rejects.trendTitle(win.requestedDays)}>
        {quality.loading && !quality.data ? (
          <Loading />
        ) : (
          <TrendChart
            quality={quality.data?.data ?? null}
            weight={weight.data?.data ?? null}
            periodFrom={period.from}
            periodTo={period.to}
          />
        )}
      </Block>

      <Block label={W.rejects.reasonsTitle(win.requestedDays)} note={W.rejects.namesAwaited}>
        <Reasons
          rows={reasons.data?.data.reasons ?? []}
          loading={reasons.loading && !reasons.data}
          canName={canName}
          onNamed={reasons.refresh}
        />
      </Block>

      <Block tight>
        <p>
          <button type="button" className="linkish" onClick={onSeeCones}>{W.rejects.seeTheCones}</button>{' '}
          <span className="mut">· {W.rejects.seeTheConesNote}</span>
        </p>
        <p style={{ marginTop: 8 }}>
          <button type="button" className="linkish" onClick={onSeeStations}>{W.rejects.byStation}</button>{' '}
          <span className="mut">· {W.rejects.byStationNote}</span>
        </p>
      </Block>

      <div className="page">
      <Details>
        <p>
          The trend is drawn over the last {win.requestedDays} production days with the selected period shaded, because
          a sustained rise cannot be seen inside a single shift. A day is marked as a rise when its rate sits above the
          usual range for that many cones, and consecutive marked days are joined into one episode.
        </p>
        <p>
          Weight and quality rejects are counted separately throughout: a rise in one says nothing about the other.
          Reject rate is rejected cones over everything weighed, rejected cones included.
        </p>
      </Details>
      </div>
    </>
  );
}

/** An episode that reaches the most recent day is still going. */
function ongoing(d: RejectSpcData | null | undefined) {
  if (!d || d.buckets.length === 0) return null;
  const last = d.buckets[d.buckets.length - 1]!.bucketTs;
  return d.episodes.find((e) => e.endTs === last) ?? null;
}

const dayLabel = (ts: string) =>
  new Date(ts).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

function reasonName(r: RejectReason): string {
  if (r.label) return r.label;
  if (r.tubeCode == null && r.materialCode == null) return W.rejects.noCode;
  return W.rejects.codeUnnamed(`${r.tubeCode ?? '—'}/${r.materialCode ?? '—'}`);
}

/* ------------------------------------------------------------ trend chart */

function TrendChart({
  quality,
  weight,
  periodFrom,
  periodTo,
}: {
  quality: RejectSpcData | null;
  weight: RejectSpcData | null;
  periodFrom: string;
  periodTo: string;
}) {
  const [box, width] = useChartWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 250;
  const L = 44;
  const R = 130;
  const T = 18;
  const B = 30;

  const days = quality?.buckets ?? [];
  if (days.length === 0) return <Empty message={W.rejects.none} />;

  const wByTs = new Map((weight?.buckets ?? []).map((b) => [b.bucketTs, b]));
  const rateOf = (r: number | null) => (r == null ? 0 : r * 100);
  const series = days.map((b) => ({
    ts: b.bucketTs,
    q: rateOf(b.rate),
    w: rateOf(wByTs.get(b.bucketTs)?.rate ?? null),
    produced: b.produced,
    qn: b.rejects,
    wn: wByTs.get(b.bucketTs)?.rejects ?? 0,
  }));
  const max = Math.max(...series.map((s) => Math.max(s.q, s.w)), 1);
  const x = (i: number) => L + (i / Math.max(1, series.length - 1)) * (width - L - R);
  const y = (v: number) => T + ((max - v) / max) * (H - T - B);

  const inPeriod = (ts: string) => ts.slice(0, 10) >= periodFrom && ts.slice(0, 10) <= periodTo;
  const firstIn = series.findIndex((s) => inPeriod(s.ts));
  const lastIn = series.map((s) => inPeriod(s.ts)).lastIndexOf(true);

  const grid = [1, 2, 3, 4].filter((v) => v < max);
  const h = hover != null ? series[hover] : null;
  const ticks = [0, Math.floor(series.length / 3), Math.floor((2 * series.length) / 3), series.length - 1].filter(
    (v, i, a) => a.indexOf(v) === i && v >= 0 && v < series.length,
  );

  return (
    <div ref={box}>
      <Readout
        hovered={
          h
            ? `${dayLabel(h.ts)} · ${W.rejects.quality} ${h.q.toFixed(1)}% · ${W.rejects.weightKind} ${h.w.toFixed(1)}% · ${fmtInt(h.produced)} cones weighed`
            : null
        }
        resting={`${series.length} days · the shaded band is the selected period`}
      />
      <svg className="chart" viewBox={`0 0 ${width} ${H}`} height={H} role="img" aria-label="Reject rate over time"
           onMouseLeave={() => setHover(null)}>
        {firstIn >= 0 && (
          <rect x={x(firstIn) - 4} y={T} width={Math.max(8, x(lastIn) - x(firstIn) + 8)} height={H - T - B} fill="var(--paper-2)" />
        )}
        {grid.map((v) => (
          <g key={v}>
            <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} stroke="var(--rule)" />
            <text x={L - 8} y={y(v) + 4} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor="end">{v}%</text>
          </g>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--rule-2)" />}
        <path d={linePath(series.map((s, i) => ({ x: x(i), y: y(s.q) })))} fill="none" stroke="var(--ink)" strokeWidth={1.75} strokeLinejoin="round" />
        <path d={linePath(series.map((s, i) => ({ x: x(i), y: y(s.w) })))} fill="none" stroke="var(--graphite)" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />
        {/* Labelled on the mark, so the chart needs no legend. */}
        <text x={width - R + 10} y={y(series[series.length - 1]!.q) + 4} fontSize="var(--fs-small)" fill="var(--ink)">
          {W.rejects.quality} {series[series.length - 1]!.q.toFixed(1)}%
        </text>
        <text x={width - R + 10} y={y(series[series.length - 1]!.w) + 4} fontSize="var(--fs-small)" fill="var(--graphite)">
          {W.rejects.weightKind} {series[series.length - 1]!.w.toFixed(1)}%
        </text>
        {series.map((_, i) => (
          <rect key={i} className="hit" x={x(i) - (width - L - R) / Math.max(1, series.length) / 2} y={T}
                width={(width - L - R) / Math.max(1, series.length)} height={H - T - B}
                onMouseEnter={() => setHover(i)} />
        ))}
        {ticks.map((i) => (
          <text key={`t${i}`} x={x(i)} y={H - 8} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor={edgeAnchor(i, series.length)}>
            {dayLabel(series[i]!.ts)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ---------------------------------------------------------------- reasons */

function Reasons({
  rows,
  loading,
  canName,
  onNamed,
}: {
  rows: RejectReason[];
  loading: boolean;
  canName: boolean;
  onNamed: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  if (loading) return <Loading />;
  if (rows.length === 0) return <Empty message={W.rejects.none} />;
  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div className="bars">
      {rows.map((r) => (
        <div key={`${r.rejectType}:${r.tubeCode}:${r.materialCode}`}>
          <span className={r.label ? '' : 'g'}>{reasonName(r)}</span>
          <i style={{ width: `${Math.round((100 * r.count) / max)}%`, background: r.label ? 'var(--graphite)' : 'var(--grid)' }} />
          <em>{fmtInt(r.count)} · {Math.round(r.pct)}%</em>
          {canName && r.rejectCodeId != null ? (
            editing === r.rejectCodeId ? (
              <span className="row" style={{ gap: 6 }}>
                <input
                  type="text"
                  value={draft}
                  autoFocus
                  aria-label="Name for this code"
                  style={{ width: 120, fontSize: 'var(--fs-small)', padding: '2px 6px' }}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Escape') setEditing(null);
                    if (e.key === 'Enter') {
                      await setRejectLabel(r.rejectCodeId!, draft.trim() || null);
                      setEditing(null);
                      onNamed();
                    }
                  }}
                />
              </span>
            ) : (
              <button type="button" className="linkish sm" onClick={() => { setEditing(r.rejectCodeId!); setDraft(r.label ?? ''); }}>
                {W.rejects.nameIt}
              </button>
            )
          ) : (
            <span />
          )}
        </div>
      ))}
    </div>
  );
}
