/**
 * One station, in a sheet — the evidence behind a recommendation.
 *
 * It opens from the station row on Line and from the station table on Weight,
 * both of which were clickable and opened nothing until this existed.
 *
 * WHY IT MATTERS THAT THE EVIDENCE IS ONE TAP AWAY. The station table says
 * "has read about 9 g heavier than the line for 4 days — check its scale
 * first". That is a claim an engineer is being asked to act on by walking to a
 * machine, and a claim with no visible working is one they will not trust and
 * should not act on. This is the working: which days, how far, what was
 * already done about it.
 *
 * WHAT IT DOES NOT SAY. No grams to adjust by, and no date the limit will be
 * crossed. Weighing data cannot tell a scale that reads nine grams heavy from
 * cones that genuinely are nine grams heavy, and those two need opposite
 * actions. It states what was measured and stops.
 *
 * A logged adjustment RESTARTS the station: the days before it are drawn grey,
 * because they say nothing about the scale as it now stands.
 */
import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Details, Empty, SkelLines } from '../ui/bits';
import { linePath } from '../ui/chart';
import { W } from '../lib/words';
import { TRAILING_DAYS } from '../lib/period';
import { fmtG, fmtInt } from '../lib/fmt';
import {
  getCalibrationAdjustments, getStations, getWeightStations, recordCalibrationAdjustment, stationLabel,
  type CalibrationAdjustment, type StationRow, type WeightStationRow, type WeightStationsData,
} from '../api';

export function StationSheet({
  station,
  canAdjust,
  onClose,
}: {
  station: number;
  canAdjust: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<WeightStationsData | null>(null);
  const [names, setNames] = useState<StationRow[]>([]);
  const [log, setLog] = useState<CalibrationAdjustment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let dead = false;
    // Cleared on every re-run: without this one failed load pinned the error
    // branch permanently, so a later successful retry (or opening a different
    // station) still rendered "could not load".
    setError(null);
    (async () => {
      try {
        const [w, s, a] = await Promise.all([
          getWeightStations({ trailingDays: TRAILING_DAYS }),
          getStations(),
          getCalibrationAdjustments(),
        ]);
        if (dead) return;
        setData(w.data);
        setNames(s.stations);
        setLog(a.adjustments);
      } catch (e) {
        if (!dead) setError(String((e as Error).message ?? e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [station, nonce]);

  const row = data?.stations.find((s) => s.station === station) ?? null;
  const name = stationLabel(names.find((n) => n.stationId === station), station);
  const mine = useMemo(() => (log ?? []).filter((a) => a.stationId === station), [log, station]);

  // The window is only named once it is known: `?? 0` printed "judged over
  // the last 0 production days" for the whole load.
  return (
    <Sheet
      title={name}
      eyebrow={data ? `${W.weight.stationsTable} · ${W.judgedOver(data.days)}` : W.weight.stationsTable}
      onClose={onClose}
    >
      {error ? (
        <p className="state err">{W.couldNotLoad}</p>
      ) : !data ? (
        <SkelLines n={5} short />
      ) : !row ? (
        // Finding H13: loaded successfully, but no station with this id
        // holds any readings in the window — distinct from still loading,
        // which the branch above already covers.
        <Empty message={W.stationNotFound} />
      ) : (
        <Body row={row} data={data} name={name} log={mine} canAdjust={canAdjust} onLogged={() => setNonce((n) => n + 1)} />
      )}
    </Sheet>
  );
}

function Body({
  row,
  data,
  name,
  log,
  canAdjust,
  onLogged,
}: {
  row: WeightStationRow;
  data: WeightStationsData;
  name: string;
  log: CalibrationAdjustment[];
  canAdjust: boolean;
  onLogged: () => void;
}) {
  const signed = (v: number | null) => {
    if (v == null) return '—';
    const g = fmtG(Math.abs(v));
    return Math.round(v) === 0 ? g : `${v > 0 ? '+' : '−'}${g}`;
  };

  return (
    <>
      <div className="big">{fmtG(row.meanG)}</div>
      <div className={row.flagged ? 'said acc' : 'said'}>{verdict(row)}</div>

      <dl className="kv" style={{ marginTop: 22 }}>
        <dt>{W.weight.colVsLine}</dt>
        <dd>{signed(row.vsLineG)}</dd>
        <dt>{W.weight.colVsTarget}</dt>
        <dd>{row.vsTargetG == null ? W.weight.noTarget : signed(row.vsTargetG)}</dd>
        <dt>{W.weight.colRejects}</dt>
        <dd>
          {row.rejectRatePct == null ? '—' : `${row.rejectRatePct.toFixed(1)}%`}
          {data.lineRejectRatePct != null && (
            <span className="mut"> · line {data.lineRejectRatePct.toFixed(1)}%</span>
          )}
        </dd>
        <dt>{W.fig.cones}</dt>
        <dd>{fmtInt(row.n)}</dd>
      </dl>

      <p className="h2" style={{ marginTop: 26, marginBottom: 10 }}>
        {W.judgedOver(data.days)}
      </p>
      <DailyMeans row={row} data={data} log={log} />

      <p className="h2" style={{ marginTop: 26, marginBottom: 10 }}>
        {W.weight.adjustmentLog}
      </p>
      {log.length === 0 ? (
        <p className="mut sm">{W.weight.adjustmentsIn(0, data.days)}</p>
      ) : (
        <table>
          <tbody>
            {log.slice(0, 6).map((a) => (
              <tr key={a.adjustmentId}>
                <td style={{ width: '10em' }}>{new Date(a.adjustedAtUtc).toLocaleDateString('en-GB')}</td>
                <td className="n" style={{ width: '6em' }}>
                  {signed(a.amountG)}
                </td>
                <td>
                  {a.reason ?? '—'}
                  {a.recordedBy && <span className="mut"> · {a.recordedBy}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mut sm" style={{ marginTop: 8 }}>{W.weight.adjustmentResets}</p>

      {canAdjust && <LogForm station={row.station} name={name} onLogged={onLogged} />}

      <Details>
        <p>
          Flagged when the station has held one side of the line by at least {fmtG(data.thresholdG)} for{' '}
          {data.minDaysHeld} production days or more, and the pattern test has fired inside that run. The figures
          above are measured over that run, not over the whole window, so they describe the change being reported.
        </p>
      </Details>
    </>
  );
}

/** What the data shows, and nothing beyond it. */
function verdict(row: WeightStationRow): string {
  if (!row.flagged) return W.weight.steady;
  const g = fmtG(Math.abs(row.vsLineG));
  return row.vsLineG > 0 ? W.weight.readsHeavier(g, row.daysHeld) : W.weight.readsLighter(g, row.daysHeld);
}

/* ------------------------------------------------------- the daily means */

/**
 * The station's daily mean against the line and the target, with the days that
 * fired a pattern marked and any adjustment drawn as a tick. Days before the
 * most recent adjustment are grey: they describe a scale that no longer
 * exists.
 */
function DailyMeans({
  row,
  data,
  log,
}: {
  row: WeightStationRow;
  data: WeightStationsData;
  log: CalibrationAdjustment[];
}) {
  const days = row.days;
  if (days.length < 2) return <Empty message={W.nothingHere} />;

  const W_ = 396;
  const H = 150;
  const L = 4;
  const R = 92;
  const T = 14;
  const B = 26;

  const marks = [data.lineMeanG, data.targetG].filter((v): v is number => v != null);
  const vals = days.map((d) => d.mean);
  const lo = Math.min(...vals, ...marks);
  const hi = Math.max(...vals, ...marks);
  const pad = (hi - lo || 1) * 0.25;
  const y = (v: number) => T + ((hi + pad - v) / (hi - lo + 2 * pad)) * (H - T - B);
  const x = (i: number) => L + (i / (days.length - 1)) * (W_ - L - R);

  const lastAdj = log.length ? log.map((a) => a.adjustedAtUtc).sort().slice(-1)[0]! : null;
  const adjIndex = lastAdj ? days.findIndex((d) => `${d.date}T23:59:59Z` >= lastAdj) : -1;

  const before = adjIndex > 0 ? days.slice(0, adjIndex + 1) : [];
  const after = adjIndex > 0 ? days.slice(adjIndex) : days;
  const pts = (arr: typeof days, off: number) => arr.map((d, i) => ({ x: x(off + i), y: y(d.mean) }));

  return (
    <svg className="chart" viewBox={`0 0 ${W_} ${H}`} height={H} role="img" aria-label={`Daily average for station ${row.station}`}>
      {data.targetG != null && (
        <>
          <line x1={L} x2={W_ - R} y1={y(data.targetG)} y2={y(data.targetG)} stroke="var(--graphite)" />
          <text x={W_ - R + 8} y={y(data.targetG) + 4} fontSize="var(--fs-tick)" fill="var(--graphite)">
            target {fmtInt(Math.round(data.targetG))}
          </text>
        </>
      )}
      {data.lineMeanG != null && (
        <>
          <line x1={L} x2={W_ - R} y1={y(data.lineMeanG)} y2={y(data.lineMeanG)} stroke="var(--grid)" strokeDasharray="3 3" />
          <text x={W_ - R + 8} y={y(data.lineMeanG) + 4} fontSize="var(--fs-tick)" fill="var(--muted)">
            line {fmtInt(Math.round(data.lineMeanG))}
          </text>
        </>
      )}

      {/* Before the adjustment, greyed: a different scale. */}
      {before.length > 1 && <path d={linePath(pts(before, 0))} fill="none" stroke="var(--grid)" strokeWidth={2} />}
      <path d={linePath(pts(after, adjIndex > 0 ? adjIndex : 0))} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" />

      {days.map((d, i) => (d.nelson.length > 0 ? <circle key={i} cx={x(i)} cy={y(d.mean)} r={3.5} fill="var(--acc-fill)" /> : null))}

      {adjIndex > 0 && (
        <>
          <line x1={x(adjIndex)} x2={x(adjIndex)} y1={H - B - 12} y2={H - B} stroke="var(--acc)" strokeWidth={2} />
          <text x={x(adjIndex)} y={H - B - 16} fontSize="var(--fs-tick)" fill="var(--acc)" textAnchor="middle">
            adjusted
          </text>
        </>
      )}

      <text x={L} y={H - 6} fontSize="var(--fs-tick)" fill="var(--muted)">{short(days[0]!.date)}</text>
      <text x={W_ - R} y={H - 6} fontSize="var(--fs-tick)" fill="var(--muted)" textAnchor="end">
        {short(days[days.length - 1]!.date)}
      </text>
    </svg>
  );
}

const short = (d: string) =>
  new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });

/* --------------------------------------------------------- log an adjustment */

function LogForm({ station, name, onLogged }: { station: number; name: string; onLogged: () => void }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn" style={{ marginTop: 18 }} onClick={() => setOpen(true)}>
        {W.weight.logAdjustment}
      </button>
    );
  }

  return (
    <form
      style={{ marginTop: 18, display: 'grid', gap: 10 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFailed(false);
        try {
          const amountG = amount.trim() === '' ? undefined : Number(amount);
          await recordCalibrationAdjustment({
            stationId: station,
            reason: why.trim() || undefined,
            amountG: amountG != null && Number.isFinite(amountG) ? amountG : undefined,
          });
          setOpen(false);
          setWhy('');
          setAmount('');
          onLogged();
        } catch {
          setFailed(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>{W.weight.adjustAmount}</span>
        <input type="number" step="0.1" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.weight.adjustWhy} — {name}</span>
        <input type="text" value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      {failed && <p className="acc sm">{W.couldNotLoad}</p>}
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy}>{W.weight.save}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>{W.product.cancel}</button>
      </div>
    </form>
  );
}
