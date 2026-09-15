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
 * should not act on. This is the working: which days, how far, which rule
 * fired on which day, what was already done about it.
 *
 * WHAT IT DOES NOT SAY. No grams to adjust by. Weighing data cannot tell a
 * scale that reads nine grams heavy from cones that genuinely are nine grams
 * heavy, and those two need opposite actions. What it DOES add (roadmap Phase
 * 9, 15 Sep 2026) is a PROJECTION: the straight line through the flagged
 * run's daily averages, extended to the product's limit — "at 0.8 g/day over
 * 5 days, reaches the action limit in about 12 days". The assumption (linear,
 * over those days) is printed with it, every time. It is a projection from
 * recent readings, not a prediction.
 *
 * A logged adjustment RESTARTS the station: the days before it are drawn grey,
 * because they say nothing about the scale as it now stands — and since
 * Phase 9 the pattern test's centreline and sigma restart there too.
 *
 * THE TWO CLOCKS. The ledger's `adjustedAtUtc` is genuine UTC; the daily
 * means are production days on the plant's wall clock. This sheet used to
 * compare the two as strings and placed a night-time adjustment on the wrong
 * day. Every comparison and every plant-time shown here now goes through
 * lib/plantClock.ts with the offset the API reports.
 */
import { useEffect, useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Details, Empty, SkelLines } from '../ui/bits';
import { linePath } from '../ui/chart';
import { W } from '../lib/words';
import { TRAILING_DAYS } from '../lib/period';
import { fmtClock, fmtG, fmtInt } from '../lib/fmt';
import { usePlantNow } from '../lib/live';
import { dayEndsAtOrAfter, fromPlantLocal, plantLocalValue } from '../lib/plantClock';
import {
  getMachinesRunning, getStations, getWeightStations, listAdjustments, recordAdjustment, stationLabel,
  NELSON_RULE_LABEL,
  type AdjustmentList, type CalibrationAdjustment, type DriftProjection, type NelsonRuleId, type NelsonRuleInfo,
  type StationRow, type WeightStationRow, type WeightStationsData,
} from '../api';

export function StationSheet({
  station,
  canAdjust,
  periodTo,
  onClose,
}: {
  station: number;
  canAdjust: boolean;
  /** Finding H4, 15 Sep 2026: the selected period's end, so a sheet opened
   *  from a past period is judged against that period's own product limits —
   *  not today's, which is what the trailing window anchored on by default
   *  before this was threaded through. See Weight.tsx and api.ts. */
  periodTo: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<WeightStationsData | null>(null);
  const [names, setNames] = useState<StationRow[]>([]);
  const [log, setLog] = useState<AdjustmentList | null>(null);
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
          getWeightStations({ trailingDays: TRAILING_DAYS, to: periodTo }),
          getStations(),
          // This station's rows plus the line-wide ones — all of them, not six.
          listAdjustments({ station }),
        ]);
        if (dead) return;
        setData(w.data);
        setNames(s.stations);
        setLog(a);
      } catch (e) {
        if (!dead) setError(String((e as Error).message ?? e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [station, periodTo, nonce]);

  const row = data?.stations.find((s) => s.station === station) ?? null;
  const name = stationLabel(names.find((n) => n.stationId === station), station);

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
      ) : !data || !log ? (
        <SkelLines n={5} short />
      ) : !row ? (
        // Finding H13: loaded successfully, but no station with this id
        // holds any readings in the window — distinct from still loading,
        // which the branch above already covers.
        <Empty message={W.stationNotFound} />
      ) : (
        <Body row={row} data={data} name={name} log={log} canAdjust={canAdjust} onLogged={() => setNonce((n) => n + 1)} />
      )}
    </Sheet>
  );
}

/** The served label when the API has one, the bundled copy otherwise. The
 *  station rows type the ids as plain numbers; an unknown id prints as itself. */
function ruleLabel(id: number, rules: NelsonRuleInfo[]): string {
  return rules.find((r) => r.id === id)?.label ?? NELSON_RULE_LABEL[id as NelsonRuleId] ?? `rule ${id}`;
}

/** "rules 4 and 7" — the ids as a phrase. */
function ruleList(ids: number[]): string {
  if (ids.length === 0) return '';
  if (ids.length === 1) return `rule ${ids[0]}`;
  return `rules ${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
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
  log: AdjustmentList;
  canAdjust: boolean;
  onLogged: () => void;
}) {
  const signed = (v: number | null) => {
    if (v == null) return '—';
    const g = fmtG(Math.abs(v));
    return Math.round(v) === 0 ? g : `${v > 0 ? '+' : '−'}${g}`;
  };
  const offset = log.plantOffsetMinutes;
  const flaggedDays = row.days.filter((d) => d.nelson.length > 0);
  const cannot = (data.rules ?? []).filter((r) => r.minPoints > row.longestRun).map((r) => r.id);

  return (
    <>
      <div className="big">{fmtG(row.meanG)}</div>
      <div className={row.flagged ? 'said acc' : 'said'}>{verdict(row)}</div>
      {/* The projection, only for a flagged station, with its assumption. */}
      {row.flagged && (
        <p className="sm" style={{ marginTop: 8 }}>
          {projectionSentence(row.projection, data)}{' '}
          <span className="mut">{row.projection ? W.calibration.projectionAssumption : ''}</span>
        </p>
      )}

      <dl className="kv" style={{ marginTop: 22 }}>
        <dt>{W.calibration.colMedian}</dt>
        <dd>{row.medianG == null ? '—' : fmtG(row.medianG)}</dd>
        <dt>{W.calibration.colSd}</dt>
        <dd>
          {row.sdG.toFixed(1)} g<span className="mut"> · {W.calibration.sdNote}</span>
        </dd>
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
      <DailyMeans row={row} data={data} log={log.adjustments} offsetMinutes={offset} />

      {/* Which day, which rule — the pattern named rather than "non-random". */}
      <p className="h2" style={{ marginTop: 22, marginBottom: 8 }}>{W.calibration.flaggedDays}</p>
      {flaggedDays.length === 0 ? (
        <p className="mut sm">{W.calibration.noFlaggedDays}</p>
      ) : (
        <table>
          <tbody>
            {flaggedDays.map((d) => (
              <tr key={d.date}>
                <td style={{ width: '7em' }}>{short(d.date)}</td>
                <td className="n" style={{ width: '6em' }}>{fmtG(d.mean)}</td>
                <td>{d.nelson.map((id) => ruleLabel(id, data.rules ?? [])).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="h2" style={{ marginTop: 26, marginBottom: 10 }}>
        {W.weight.adjustmentLog}
      </p>
      {log.adjustments.length === 0 ? (
        <p className="mut sm">{W.weight.adjustmentsIn(0, data.days)}</p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>{W.calibration.colWhen}</th>
                <th className="n">{W.calibration.colAmount}</th>
                <th className="n">{W.calibration.colBeforeAfter}</th>
                <th>{W.calibration.colProduct}</th>
                <th>{W.calibration.colWhy}</th>
              </tr>
            </thead>
            <tbody>
              {log.adjustments.map((a) => (
                <tr key={a.adjustmentId}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {short(a.adjustedAtPlant)} {fmtClock(a.adjustedAtPlant)}
                    {a.stationId == null && <span className="mut"> · {W.calibration.lineWide}</span>}
                  </td>
                  <td className="n">{signed(a.amountG)}</td>
                  <td className="n" style={{ whiteSpace: 'nowrap' }}>{beforeAfter(a)}</td>
                  <td>{a.productLabel ?? '—'}</td>
                  <td>
                    {a.reason ?? '—'}
                    {a.note && <span className="mut"> · {a.note}</span>}
                    {a.recordedBy && <span className="mut"> · {a.recordedBy}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mut sm" style={{ marginTop: 6 }}>{W.calibration.allAdjustments(log.adjustments.length)}</p>
        </>
      )}
      <p className="mut sm" style={{ marginTop: 8 }}>{W.weight.adjustmentResets}</p>

      {canAdjust && <LogForm station={row.station} name={name} offsetMinutes={offset} onLogged={onLogged} />}

      <Details>
        <p>
          Flagged when the station has held one side of the line by at least {fmtG(data.thresholdG)} for{' '}
          {data.minDaysHeld} production days or more, and the pattern test has fired inside that run. The figures
          above are measured over that run, not over the whole window, so they describe the change being reported.
        </p>
        <p>
          {W.calibration.rulesRun} {W.calibration.centreline(fmtG(row.centrelineG), `${row.sigmaDayToDay.toFixed(2)} g`)}
          {row.restartedOn ? `, ${W.calibration.restartedOn(short(row.restartedOn))}` : ''}.{' '}
          {cannot.length > 0
            ? W.calibration.cannotFire(ruleList(cannot), row.longestRun)
            : W.calibration.allCanFire(row.longestRun)}{' '}
          {W.calibration.notApproved}
        </p>
        {(data.rules ?? []).length > 0 && (
          <p className="mut">
            {(data.rules ?? []).map((r) => `${r.id}: ${r.label} (${r.minPoints})`).join(' · ')}
          </p>
        )}
        {row.flagged && !row.projection && <p>{W.calibration.projectionNoLimits}</p>}
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

/** The projection, in words, with the limit stated relative to the target. */
export function projectionSentence(p: DriftProjection | null, data: { targetG: number | null }): string {
  if (!p) return W.calibration.projectionNoLimits;
  const rate = W.calibration.gPerDay(`${p.slopeGPerDay > 0 ? '+' : '−'}${Math.abs(p.slopeGPerDay).toFixed(1)} g`);
  const rel = data.targetG == null ? p.limitG : p.limitG - data.targetG;
  const limit = data.targetG == null ? fmtG(p.limitG) : `${rel >= 0 ? '+' : '−'}${fmtG(Math.abs(rel))}`;
  if (p.daysToLimit == null) return W.calibration.projectionAway(rate, p.overDays);
  if (p.daysToLimit === 0) return W.calibration.projectionNow(rate, p.overDays, limit);
  if (p.daysToLimit > 90) return W.calibration.projectionFar(rate, p.overDays, limit);
  return W.calibration.projection(rate, p.overDays, limit, p.daysToLimit);
}

function beforeAfter(a: CalibrationAdjustment): string {
  if (a.beforeG == null && a.afterG == null) return '—';
  const ref = a.referenceG != null ? ` (ref ${fmtG(a.referenceG)})` : '';
  return `${a.beforeG == null ? '—' : fmtG(a.beforeG)} → ${a.afterG == null ? '—' : fmtG(a.afterG)}${ref}`;
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
  offsetMinutes,
}: {
  row: WeightStationRow;
  data: WeightStationsData;
  log: CalibrationAdjustment[];
  offsetMinutes: number;
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

  // The newest adjustment (this station's or line-wide), placed on the
  // production day whose END is at or after it — the server's own rule, on
  // the server's own offset. The old string comparison against `adjustedAtUtc`
  // put a 02:00 plant-time adjustment on the previous day.
  const lastAdj = log.length ? log.map((a) => a.adjustedAtUtc).sort().slice(-1)[0]! : null;
  const adjIndex = lastAdj ? days.findIndex((d) => dayEndsAtOrAfter(d.date, lastAdj, offsetMinutes)) : -1;

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

      {days.map((d, i) =>
        d.nelson.length > 0 ? (
          <circle key={i} cx={x(i)} cy={y(d.mean)} r={3.5} fill="var(--acc-fill)">
            <title>{`${short(d.date)} · ${fmtG(d.mean)} · ${d.nelson.map((id) => ruleLabel(id, data.rules ?? [])).join(' · ')}`}</title>
          </circle>
        ) : null,
      )}

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

/**
 * The ledger form (Phase 9 item 5): when (plant time, defaulting to the plant
 * clock now), the signed amount, why, a note, the reference readings before
 * and after, and the product in force — auto-filled from what the machine's
 * newest cones say it is running, and left blank when the machine is quiet.
 */
function LogForm({
  station,
  name,
  offsetMinutes,
  onLogged,
}: {
  station: number;
  name: string;
  offsetMinutes: number;
  onLogged: () => void;
}) {
  const plantNow = usePlantNow();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const [why, setWhy] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [reference, setReference] = useState('');
  const [product, setProduct] = useState<{ id: number; label: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Opening the form: default "when" to the plant clock now, and ask what
  // the machine is running. Both are suggestions the person can change.
  useEffect(() => {
    if (!open) return;
    if (plantNow && when === '') setWhen(plantLocalValue(plantNow));
    let dead = false;
    (async () => {
      try {
        const r = await getMachinesRunning();
        if (dead) return;
        const m = r.data.machines.find((x) => x.station === station);
        setProduct(m && !m.quiet && m.materialId != null ? { id: m.materialId, label: m.productName ?? W.cone.noProductName(m.materialId) } : null);
      } catch {
        if (!dead) setProduct(null);
      }
    })();
    return () => {
      dead = true;
    };
    // `when` is deliberately not a dependency: the default is taken once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, station]);

  const num = (s: string) => {
    const v = Number(s.trim());
    return s.trim() === '' || !Number.isFinite(v) ? undefined : v;
  };

  if (!open) {
    return (
      <button type="button" className="btn" style={{ marginTop: 18 }} onClick={() => setOpen(true)}>
        {W.weight.logAdjustment}
      </button>
    );
  }

  const field = (label: string, value: string, set: (v: string) => void, step = '0.1') => (
    <label className="field">
      <span>{label}</span>
      <input type="number" step={step} value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );

  return (
    <form
      style={{ marginTop: 18, display: 'grid', gap: 10 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFailed(false);
        try {
          await recordAdjustment({
            stationId: station,
            // A typed plant time becomes the genuine-UTC instant the ledger
            // stores, through the offset the API reported — never the
            // browser's own zone.
            adjustedAt: when ? fromPlantLocal(when, offsetMinutes) : undefined,
            reason: why.trim() || undefined,
            note: note.trim() || undefined,
            amountG: num(amount),
            beforeG: num(before),
            afterG: num(after),
            referenceG: num(reference),
            productId: product?.id,
          });
          setOpen(false);
          setWhy('');
          setNote('');
          setAmount('');
          setBefore('');
          setAfter('');
          setReference('');
          setWhen('');
          onLogged();
        } catch {
          setFailed(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>{W.calibration.adjustedAt}</span>
        <input type="datetime-local" value={when} autoFocus onChange={(e) => setWhen(e.target.value)} />
        <span className="mut sm">{W.calibration.adjustedAtNote}</span>
      </label>
      {field(W.weight.adjustAmount, amount, setAmount)}
      <label className="field">
        <span>{W.weight.adjustWhy} — {name}</span>
        <input type="text" value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <label className="field">
        <span>{W.calibration.note}</span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {field(W.calibration.referenceG, reference, setReference)}
      {field(W.calibration.beforeG, before, setBefore)}
      {field(W.calibration.afterG, after, setAfter)}
      <div className="field">
        <span>{W.calibration.productInForce}</span>
        <span>
          {product === undefined
            ? '…'
            : product == null
              ? <span className="mut">{W.calibration.productQuiet}</span>
              : W.calibration.productFromMachine(product.label)}
          {product != null && (
            <>
              {' '}
              <button type="button" className="linkish" onClick={() => setProduct(null)}>{W.calibration.productClear}</button>
            </>
          )}
        </span>
      </div>
      {failed && <p className="acc sm">{W.couldNotLoad}</p>}
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy}>{W.weight.save}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>{W.product.cancel}</button>
      </div>
    </form>
  );
}
