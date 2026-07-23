import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  getRange,
  getProduction,
  getShiftAnalysis,
  getRejects,
  setRejectLabel,
  getWeights,
  getMe,
  setUnauthorizedHandler,
  login as apiLogin,
  logout as apiLogout,
  getProducts,
  getCurrentProduct,
  setCurrentProduct,
  adminListUsers,
  adminCreateUser,
  adminUpdateUser,
  adminListStations,
  adminSetStation,
  adminGetRules,
  adminSetWeightRule,
  adminSetShiftRule,
  getEvents,
  getEventDetail,
  eventsExportUrl,
  getDowntime,
  getSpc,
  getRejectSpc,
  getOee,
  ROLE_RANK,
  type AuthUser,
  type AdminUser,
  type StationRow,
  type Rules,
  type ProductOption,
  type TimelineEntry,
  type Envelope,
  type ProductionData,
  type ProductionRow,
  type ShiftAnalysisData,
  type RejectData,
  type RejectReason,
  type WeightsData,
  type WeightStats,
  type Basis,
  type Meta,
  type RegisterType,
  type RegisterSort,
  type RegisterRow,
  type DowntimeData,
  type Stoppage,
  type SpcType,
  type SpcData,
  type Subgroup,
  type StationStat,
  type HistBin,
  type RejectSpcData,
  type RejectBucket,
  type RejectTypeFilter,
  type OeeData,
} from './api';
import { fmtInt, fmtKg, ageLabel, freshnessLevel, fmtDuration, fmtHourLabel, fmtDateTime, fmtTime } from './format';

type Shift = 'all' | 'morning' | 'evening' | 'night';
const SHIFTS: Shift[] = ['all', 'morning', 'evening', 'night'];
type View = 'dashboard' | 'register' | 'downtime' | 'spc' | 'rejectspc' | 'oee' | 'shift' | 'rejects' | 'weights' | 'admin';

/** A pre-filtered entry point into the Register, handed off from an
 * anomaly-surfacing view (SPC point, downtime stoppage) so a user never has
 * to hand-reconstruct filters to find the exact row that caused a flag. */
interface RegisterSeed {
  type: RegisterType;
  from?: string;
  to?: string;
  tsFrom?: string;
  tsTo?: string;
  wMin?: number;
  wMax?: number;
  station?: number;
  label: string;
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Tween a displayed number toward `target` — the KPI "settling on a reading"
 *  motion. No dependency: requestAnimationFrame + easeOutCubic. Skips the
 *  animation entirely under prefers-reduced-motion. */
function useTweenedNumber(target: number, durationMs = 550): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number>();
  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(target);
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (target - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);
  return display;
}

/** Flips true one animation frame after `depKey` changes — used to trigger a
 *  0-to-target CSS width/height transition ("a reading being taken") each
 *  time a data set loads, without a real animation library. */
function useRevealOnData(depKey: unknown): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (prefersReducedMotion()) {
      setOn(true);
      return;
    }
    setOn(false);
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, [depKey]);
  return on;
}

/** Segmented control with a sliding highlight — measures the active button's
 *  position and animates a shared indicator to it, instead of the highlight
 *  jumping between separate elements. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-key="${value}"]`);
    if (el && containerRef.current) {
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, [value, options.length]);

  return (
    <div className="segmented" ref={containerRef}>
      {indicator && (
        <span className="seg-indicator" style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }} />
      )}
      {options.map((o) => (
        <button key={o.key} data-key={o.key} className={o.key === value ? 'active' : ''} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    // an expired/invalid session on any call bounces back to the login screen
    setUnauthorizedHandler(() => setUser(null));
    getMe()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="app" />;
  if (user === null) return <LoginScreen onLogin={setUser} />;
  return <Shell user={user} onLogout={() => setUser(null)} />;
}

function Shell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [view, setView] = useState<View>('dashboard');
  const [range, setRange] = useState<{ min: string | null; max: string | null }>({ min: null, max: null });
  const [rangeErr, setRangeErr] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<Meta | null>(null);
  const [registerSeed, setRegisterSeed] = useState<RegisterSeed | null>(null);
  const rank = ROLE_RANK[user.role] ?? 1;

  const navigateToRegister = (seed: RegisterSeed) => {
    setRegisterSeed(seed);
    setView('register');
  };

  useEffect(() => {
    getRange()
      .then((r) => setRange({ min: r.minDate, max: r.maxDate }))
      .catch((e) => setRangeErr(String(e.message ?? e)));
  }, []);

  const doLogout = async () => {
    await apiLogout().catch(() => {});
    onLogout();
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark">
            SMS<span className="dot">.</span>
          </span>
          <span className="sub">TP1 Line 3 · Unit 2</span>
          <span className="segmented nav">
            <button className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>Dashboard</button>
            <button className={view === 'oee' ? 'active' : ''} onClick={() => setView('oee')}>OEE</button>
            <button className={view === 'register' ? 'active' : ''} onClick={() => { setRegisterSeed(null); setView('register'); }}>Register</button>
            <button className={view === 'downtime' ? 'active' : ''} onClick={() => setView('downtime')}>Downtime</button>
            <button className={view === 'spc' ? 'active' : ''} onClick={() => setView('spc')}>Weight SPC</button>
            <button className={view === 'shift' ? 'active' : ''} onClick={() => setView('shift')}>Shift Analysis</button>
            <button className={view === 'rejects' ? 'active' : ''} onClick={() => setView('rejects')}>Rejects</button>
            <button className={view === 'rejectspc' ? 'active' : ''} onClick={() => setView('rejectspc')}>Reject Trend</button>
            <button className={view === 'weights' ? 'active' : ''} onClick={() => setView('weights')}>Weights</button>
            {rank >= 4 && (
              <button className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>Admin</button>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {freshness && (
            <span className="freshness" title={`last sync ${freshness.lastSyncUtc ?? 'never'}`}>
              <span className={`led ${freshnessLevel(freshness.sourceAgeSeconds)}`} />
              synced {ageLabel(freshness.sourceAgeSeconds)}
            </span>
          )}
          <span className="userchip">
            <span className="who">
              <div className="u">{user.displayName ?? user.username}</div>
              <div className="r">{user.role}</div>
            </span>
            <button className="logout" onClick={doLogout}>Sign out</button>
          </span>
        </div>
      </header>

      {rangeErr ? (
        <div className="error-card"><b>Couldn't reach the API.</b> {rangeErr}</div>
      ) : view === 'dashboard' ? (
        <DashboardView range={range} onMeta={setFreshness} rank={rank} />
      ) : view === 'oee' ? (
        <OeeView range={range} onMeta={setFreshness} />
      ) : view === 'register' ? (
        <RegisterView range={range} seed={registerSeed} />
      ) : view === 'downtime' ? (
        <DowntimeView range={range} onMeta={setFreshness} onInspect={navigateToRegister} />
      ) : view === 'spc' ? (
        <SpcView range={range} onMeta={setFreshness} onInspect={navigateToRegister} />
      ) : view === 'shift' ? (
        <ShiftView range={range} onMeta={setFreshness} />
      ) : view === 'rejects' ? (
        <RejectView onMeta={setFreshness} rank={rank} />
      ) : view === 'rejectspc' ? (
        <RejectSpcView range={range} onMeta={setFreshness} />
      ) : view === 'weights' ? (
        <WeightView onMeta={setFreshness} />
      ) : (
        <AdminView />
      )}
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (u: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await apiLogin(username, password);
      onLogin(r.user);
    } catch (ex) {
      setErr((ex as Error).message ?? 'login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <div className="login-wrap">
        <form className="login-card" onSubmit={submit}>
          <h1>SMS<span className="dot">.</span></h1>
          <div className="tag">Sack Management System · TP1 Line 3 · Unit 2</div>
          <div className="field">
            <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="primary" type="submit" disabled={busy || !username || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {err && <div className="err">{err}</div>}
        </form>
      </div>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */

function DashboardView({
  range,
  onMeta,
  rank,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  rank: number;
}) {
  const [date, setDate] = useState<string>('');
  const [shift, setShift] = useState<Shift>('all');
  const [kpi, setKpi] = useState<Envelope<ProductionData> | null>(null);
  const [byShift, setByShift] = useState<ProductionData | null>(null);
  const [trend, setTrend] = useState<ProductionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Default to the day BEFORE the most recent one, not the most recent day
    // itself: "today" is always still accumulating until the day rolls over,
    // so defaulting to it shows a partial, misleadingly-sparse picture. The
    // day before is the most recent one guaranteed complete.
    if (range.max && !date) {
      const prior = new Date(`${range.max}T12:00:00Z`);
      prior.setUTCDate(prior.getUTCDate() - 1);
      const priorStr = prior.toISOString().slice(0, 10);
      setDate(range.min && priorStr >= range.min ? priorStr : range.max);
    }
  }, [range.max, range.min, date]);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const shiftParam = shift === 'all' ? undefined : shift;
    const from7 = new Date(date);
    from7.setDate(from7.getDate() - 6);
    const trendFrom = from7.toISOString().slice(0, 10);
    Promise.all([
      getProduction({ from: date, to: date, shift: shiftParam, groupBy: 'none' }),
      getProduction({ from: date, to: date, groupBy: 'shift' }),
      getProduction({ from: trendFrom, to: date, groupBy: 'day' }),
    ])
      .then(([k, s, t]) => {
        if (cancelled) return;
        setKpi(k);
        setByShift(s.data);
        setTrend(t.data.rows);
        onMeta(k.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date, shift, onMeta]);

  const total: ProductionRow | null = kpi?.data.rows[0] ?? null;
  const meta = kpi?.metadata;
  const rejectRate = useMemo(() => {
    if (!total) return null;
    const denom = total.cones + total.rejectedCones;
    return denom > 0 ? (100 * total.rejectedCones) / denom : 0;
  }, [total]);

  return (
    <>
      <CurrentProductBar rank={rank} />
      <div className="filters">
        <div className="field">
          <label htmlFor="d">Production date</label>
          <input
            id="d"
            type="date"
            value={date}
            min={range.min ?? undefined}
            max={range.max ?? undefined}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label>Shift</label>
          <Segmented
            value={shift}
            onChange={setShift}
            options={SHIFTS.map((s) => ({ key: s, label: s === 'all' ? 'All' : s[0]!.toUpperCase() + s.slice(1) }))}
          />
        </div>
      </div>

      {error ? (
        <div className="error-card">
          <b>Couldn't load production data.</b> {error}
        </div>
      ) : loading || !total ? (
        <div className="kpis">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="tile skeleton" />
          ))}
        </div>
      ) : (
        <>
          <div className="kpis">
            <Tile label="Total Cones" value={total.cones} format={fmtInt}
              trend={trend.map((r) => r.cones)}
              foot={<><span className="em">{total.conesInRangePct ?? '—'}%</span> in weight range</>} />
            <Tile label="Rejected Cones" value={total.rejectedCones} format={fmtInt}
              trend={trend.map((r) => r.rejectedCones)}
              foot={<>reject rate <span className="em">{rejectRate?.toFixed(2)}%</span></>} />
            <Tile label="Total Sacks" value={total.sacks} format={fmtInt}
              trend={trend.map((r) => r.sacks ?? 0)}
              foot={total.sacks && total.cones ? <>~<span className="em">{(total.cones / total.sacks).toFixed(1)}</span> cones/sack</> : <>&nbsp;</>} />
            <Tile label="Sack Weight" value={total.sackWeightKg} format={fmtKg} unit="kg"
              trend={trend.map((r) => r.sackWeightKg ?? 0)}
              foot={<>basis <span className="em">{meta?.weightBasis}</span></>} />
          </div>
          <ShiftBreakdown data={byShift} />
          {meta && <MetaStrip meta={meta} />}
        </>
      )}
    </>
  );
}

function Tile({
  label,
  value,
  format,
  unit,
  foot,
  trend,
}: {
  label: string;
  value: number | null;
  format: (n: number) => string;
  unit?: string;
  foot: ReactNode;
  trend?: number[];
}) {
  // the KPI "settling on a reading" motion — tweens toward the new value
  // whenever the filtered date/shift changes.
  const shown = useTweenedNumber(value ?? 0);
  return (
    <div className="tile">
      <div className="k-label">
        {label}
        <span className="k-tick" title="7-day trend below" />
      </div>
      <div className="k-value">
        {value == null ? '—' : format(shown)}
        {unit && value != null && <span className="unit">{unit}</span>}
      </div>
      {trend && trend.length > 1 && <Sparkline values={trend} />}
      <div className="k-foot">{foot}</div>
    </div>
  );
}

/** 7-day instrument trace — the signature readout element. Pure data, no chart
 *  library: a thin green polyline over the tile's own history. Draws itself in
 *  once per data set via the stroke-dasharray/dashoffset technique, like an
 *  oscilloscope trace sweeping across, then fades the reading dot in. */
function Sparkline({ values }: { values: number[] }) {
  const w = 100;
  const h = 26;
  const lineRef = useRef<SVGPolylineElement>(null);
  const revealed = useRevealOnData(values.join(','));

  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1, max - min);
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`)
    .join(' ');
  const lastX = (values.length - 1) * step;
  const lastY = h - ((values[values.length - 1]! - min) / span) * (h - 4) - 2;

  useLayoutEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.style.strokeDasharray = 'none';
      el.style.strokeDashoffset = '0';
      return;
    }
    const len = el.getTotalLength();
    el.style.transition = 'none';
    el.style.strokeDasharray = `${len}`;
    el.style.strokeDashoffset = `${len}`;
    // force layout, then release the transition so it animates to 0
    void el.getBoundingClientRect();
    requestAnimationFrame(() => {
      el.style.transition = '';
      el.style.strokeDashoffset = '0';
    });
  }, [points]);

  return (
    <svg className="k-spark" viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <line className="baseline" x1="0" y1={h - 1} x2={w} y2={h - 1} />
      <polyline ref={lineRef} points={points} />
      <circle cx={lastX} cy={lastY} r="1.8" style={{ opacity: revealed ? 1 : 0 }} />
    </svg>
  );
}

const SHIFT_ORDER = ['morning', 'evening', 'night'] as const;

function ShiftBreakdown({ data }: { data: ProductionData | null }) {
  // grow-in ("a reading being taken") retriggers whenever this day's data changes
  const revealed = useRevealOnData(data ? data.rows.map((r) => `${r.group}:${r.cones}`).join('|') : null);
  if (!data) return null;
  // Always show all three shifts in their real running order, zero-filled —
  // a day with only one shift recorded should never look like a broken
  // panel with two rows missing.
  const byName = new Map(data.rows.map((r) => [r.group, r.cones]));
  const total = data.rows.reduce((s, r) => s + r.cones, 0);
  const max = Math.max(1, ...SHIFT_ORDER.map((s) => byName.get(s) ?? 0));

  return (
    <div className="panel">
      <h2>Cones by shift</h2>
      <div className="hint">Corrected shift, derived from production time — this day.</div>
      {total === 0 ? (
        <div className="empty-note">No production recorded this day.</div>
      ) : (
        <div className="bars">
          {SHIFT_ORDER.map((s) => {
            const v = byName.get(s) ?? 0;
            const pct = total > 0 ? Math.round((100 * v) / total) : 0;
            const w = revealed ? (100 * v) / max : 0;
            return (
              <div className="bar-row" key={s}>
                <span className="name">{s}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${w}%` }} />
                </span>
                <span className="val">
                  {fmtInt(v)}
                  <span className="val-pct">{v > 0 ? `${pct}%` : '—'}</span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- Sack & Cone Register ---------------- */

const STATIONS = Array.from({ length: 14 }, (_, i) => i + 1);
const PAGE_SIZE = 25;

function RegisterView({ range, seed }: { range: { min: string | null; max: string | null }; seed: RegisterSeed | null }) {
  const [type, setType] = useState<RegisterType>(() => seed?.type ?? 'cone');
  const [from, setFrom] = useState(() => seed?.from ?? '');
  const [to, setTo] = useState(() => seed?.to ?? '');
  const [shift, setShift] = useState<'all' | 'morning' | 'evening' | 'night'>('all');
  const [station, setStation] = useState<string>(() => (seed?.station != null ? String(seed.station) : ''));
  const [inRange, setInRange] = useState<'all' | 'true' | 'false'>('all');
  const [wMin, setWMin] = useState(() => (seed?.wMin != null ? String(seed.wMin) : ''));
  const [wMax, setWMax] = useState(() => (seed?.wMax != null ? String(seed.wMax) : ''));
  const [tsWindow, setTsWindow] = useState(() => (seed ? { tsFrom: seed.tsFrom, tsTo: seed.tsTo } : null));
  const [sort, setSort] = useState<RegisterSort>('time');
  const [dir, setDir] = useState<'asc' | 'desc'>(() => (seed ? 'asc' : 'desc'));
  const [page, setPage] = useState(1);
  const [context, setContext] = useState<string | null>(() => seed?.label ?? null);

  const [rows, setRows] = useState<RegisterRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RegisterRow | null>(null);

  const clearFilters = () => {
    setType('cone');
    setFrom('');
    setTo('');
    setShift('all');
    setStation('');
    setInRange('all');
    setWMin('');
    setWMax('');
    setTsWindow(null);
    setSort('time');
    setDir('desc');
    setContext(null);
  };

  // reset to page 1 whenever a filter (not page itself) changes
  useEffect(() => {
    setPage(1);
  }, [type, from, to, shift, station, inRange, wMin, wMax, sort, dir]);

  const query = useMemo(
    () => ({
      type,
      from: from || undefined,
      to: to || undefined,
      shift: shift === 'all' ? undefined : shift,
      station: type === 'cone' && station ? Number(station) : undefined,
      inRange: inRange === 'all' ? undefined : inRange === 'true',
      wMin: wMin ? Number(wMin) : undefined,
      wMax: wMax ? Number(wMax) : undefined,
      tsFrom: tsWindow?.tsFrom,
      tsTo: tsWindow?.tsTo,
      sort,
      dir,
      page,
      pageSize: PAGE_SIZE,
    }),
    [type, from, to, shift, station, inRange, wMin, wMax, sort, dir, page],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEvents(query)
      .then((r) => {
        if (cancelled) return;
        setRows(r.data.rows);
        setTotal(r.data.total);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const weightUnit = type === 'cone' ? 'g' : 'kg';
  const revealed = useRevealOnData(rows.map((r) => r.source_row_id).join(','));

  const toggleSort = (col: RegisterSort) => {
    if (sort === col) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSort(col);
      setDir('desc');
    }
  };

  return (
    <>
      {context && (
        <div className="callout register-context">
          <div className="big">Filtered: {context}</div>
          <button className="abtn" onClick={clearFilters}>Clear filter</button>
        </div>
      )}

      <div className="quick-filters">
        <span className="qf-label">Quick filters:</span>
        <button className="abtn" onClick={() => { setInRange('false'); setContext(null); setTsWindow(null); }}>Out of range only</button>
        <button
          className="abtn"
          disabled={!range.max}
          onClick={() => { if (range.max) { setFrom(range.max); setTo(range.max); } setContext(null); setTsWindow(null); }}
        >
          Latest day
        </button>
        <button className="abtn" onClick={clearFilters}>Clear all</button>
      </div>

      <div className="filters register-filters">
        <div className="field">
          <label>Record type</label>
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { key: 'cone', label: 'Cones' },
              { key: 'sack', label: 'Sacks' },
            ]}
          />
        </div>
        <div className="field">
          <label>From</label>
          <input type="date" value={from} min={range.min ?? undefined} max={range.max ?? undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={to} min={range.min ?? undefined} max={range.max ?? undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field">
          <label>Shift</label>
          <select value={shift} onChange={(e) => setShift(e.target.value as typeof shift)}>
            <option value="all">All</option>
            <option value="morning">Morning</option>
            <option value="evening">Evening</option>
            <option value="night">Night</option>
          </select>
        </div>
        {type === 'cone' && (
          <div className="field">
            <label>Station</label>
            <select value={station} onChange={(e) => setStation(e.target.value)}>
              <option value="">All</option>
              {STATIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>In range</label>
          <select value={inRange} onChange={(e) => setInRange(e.target.value as typeof inRange)}>
            <option value="all">All</option>
            <option value="true">In range</option>
            <option value="false">Out of range</option>
          </select>
        </div>
        <div className="field">
          <label>Weight min ({weightUnit})</label>
          <input type="number" inputMode="decimal" value={wMin} placeholder="—" onChange={(e) => setWMin(e.target.value)} />
        </div>
        <div className="field">
          <label>Weight max ({weightUnit})</label>
          <input type="number" inputMode="decimal" value={wMax} placeholder="—" onChange={(e) => setWMax(e.target.value)} />
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <a className="abtn primary" href={eventsExportUrl(query)} download>
            Export CSV
          </a>
        </div>
      </div>

      {error ? (
        <div className="error-card"><b>Couldn't load the register.</b> {error}</div>
      ) : (
        <div className="panel">
          <h2>{type === 'cone' ? 'Cone' : 'Sack'} register</h2>
          <div className="hint">
            {fmtInt(total)} matching record{total === 1 ? '' : 's'}. Click a row for full detail.
          </div>
          <div className="table-scroll">
            <table className="reg-table">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => toggleSort('time')}>
                    Production time {sort === 'time' && (dir === 'desc' ? '▾' : '▴')}
                  </th>
                  <th>Shift</th>
                  {type === 'cone' ? <th>Station</th> : <th>Sack #</th>}
                  <th className="sortable num" onClick={() => toggleSort('weight')}>
                    Weight {sort === 'weight' && (dir === 'desc' ? '▾' : '▴')}
                  </th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody style={{ opacity: revealed ? 1 : 0.4, transition: 'opacity 200ms' }}>
                {loading && rows.length === 0 ? (
                  <tr><td colSpan={5} className="reg-empty">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="reg-empty">No records match these filters.</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr key={String(r.source_row_id)} className="reg-row" onClick={() => setSelected(r)}>
                      <td className="mono">{fmtDateTime(r.production_ts_utc)}</td>
                      <td className="cap">{r.shift_code}</td>
                      <td className="mono">{type === 'cone' ? (r.source_station ?? '—') : (r.sack_num ?? '—')}</td>
                      <td className="mono num">
                        {type === 'cone' ? r.weight_g : r.weight_kg} {weightUnit}
                      </td>
                      <td>
                        <span className={`pill ${r.in_range ? 'on' : 'off'}`}>{r.in_range ? 'in range' : 'out of range'}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="reg-pager">
            <button className="abtn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
            <span className="reg-pageinfo">Page {page} of {totalPages}</span>
            <button className="abtn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        </div>
      )}

      {selected && (
        <DetailDrawer type={type} row={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

function DetailDrawer({ type, row, onClose }: { type: RegisterType; row: RegisterRow; onClose: () => void }) {
  const [full, setFull] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let cancelled = false;
    getEventDetail(type, row.source_row_id)
      .then((r) => !cancelled && setFull(r.row))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [type, row.source_row_id]);

  const weightUnit = type === 'cone' ? 'g' : 'kg';
  const weight = type === 'cone' ? row.weight_g : row.weight_kg;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2>{type === 'cone' ? 'Cone' : 'Sack'} #{row.source_row_id}</h2>
          <button className="abtn" onClick={onClose}>Close ✕</button>
        </div>
        <div className="drawer-body">
          <DetailRow label="Production time" value={fmtDateTime(row.production_ts_utc)} />
          <DetailRow label="Shift (corrected)" value={row.shift_code} />
          <DetailRow label="Shift (legacy)" value={row.shift_code_legacy ?? '—'} mismatch={row.shift_code_legacy != null && row.shift_code_legacy !== row.shift_code} />
          <DetailRow label="Weight" value={`${weight ?? '—'} ${weightUnit}`} />
          <DetailRow label="In range" value={row.in_range ? 'Yes' : 'No'} />
          {type === 'cone' ? (
            <>
              <DetailRow label="Source station" value={row.source_station ?? '—'} />
              <DetailRow label="Lifter station" value={row.lifter_station ?? '—'} />
              <DetailRow label="Hanger" value={row.hanger_num ?? '—'} />
            </>
          ) : (
            <DetailRow label="Sack number" value={row.sack_num ?? '—'} />
          )}
          <DetailRow label="Product" value={row.lot_code ?? 'Not attributed (Q1)'} />
          <DetailRow
            label="Merge key"
            value={row.merge_key_is_unique ? 'Unique' : 'Collision (DQ-2)'}
            mismatch={!row.merge_key_is_unique}
          />
          {full && (
            <>
              <DetailRow label="Source system" value={String(full.source_system ?? '—')} />
              <DetailRow label="Transform version" value={`v${full.transform_version ?? '—'}`} />
              {full.ingest_ts_utc != null && (
                <DetailRow label="Synced at" value={fmtDateTime(String(full.ingest_ts_utc))} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, mismatch }: { label: string; value: ReactNode; mismatch?: boolean }) {
  return (
    <div className={`drow${mismatch ? ' mismatch' : ''}`}>
      <span className="drow-label">{label}</span>
      <span className="drow-val">{value}</span>
    </div>
  );
}

/* ---------------- Downtime & Throughput ---------------- */

const STOPPAGE_PREVIEW_COUNT = 5;

function DowntimeView({
  range,
  onMeta,
  onInspect,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  onInspect: (seed: RegisterSeed) => void;
}) {
  const [date, setDate] = useState('');
  const [threshold, setThreshold] = useState(120);
  const [data, setData] = useState<DowntimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stoppagesExpanded, setStoppagesExpanded] = useState(false);

  useEffect(() => {
    setStoppagesExpanded(false);
  }, [date, threshold]);

  useEffect(() => {
    // default to the day before the most recent — the same "don't default to
    // a still-accumulating day" rule as the Dashboard.
    if (range.max && !date) {
      const prior = new Date(`${range.max}T12:00:00Z`);
      prior.setUTCDate(prior.getUTCDate() - 1);
      const priorStr = prior.toISOString().slice(0, 10);
      setDate(range.min && priorStr >= range.min ? priorStr : range.max);
    }
  }, [range.max, range.min, date]);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDowntime(date, threshold)
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        onMeta(r.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date, threshold, onMeta]);

  const revealed = useRevealOnData(data ? `${data.date}:${data.thresholdSeconds}:${data.stoppageCount}` : null);
  const rateMax = Math.max(1, ...(data?.hourly.map((h) => h.count) ?? [1]));

  const inspectStoppage = (s: Stoppage) =>
    onInspect({
      type: 'cone',
      from: date,
      to: date,
      tsFrom: new Date(new Date(s.startTs).getTime() - 60_000).toISOString(),
      tsTo: new Date(new Date(s.endTs).getTime() + 60_000).toISOString(),
      label: `stoppage ${fmtTime(s.startTs)}–${fmtTime(s.endTs)} (${fmtDuration(s.durationSeconds)} down) — showing cones just before and after`,
    });

  return (
    <>
      <div className="filters">
        <div className="field">
          <label>Date</label>
          <input type="date" value={date} min={range.min ?? undefined} max={range.max ?? undefined} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>Stoppage threshold</label>
          <div className="dt-threshold">
            <input
              type="number"
              min={30}
              max={3600}
              step={30}
              value={threshold}
              onChange={(e) => setThreshold(Math.max(30, Math.min(3600, Number(e.target.value) || 120)))}
            />
            <span className="dt-unit">seconds</span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="error-card"><b>Couldn't load downtime analysis.</b> {error}</div>
      ) : loading || !data ? (
        <div className="tile skeleton" style={{ height: 280 }} />
      ) : (
        <>
          <div className="callout">
            <div className="big">
              <span className="accent">{data.stoppageCount}</span> stoppage{data.stoppageCount === 1 ? '' : 's'} detected
              {' · '}
              <span className="accent">{fmtDuration(data.totalDownSeconds)}</span> total downtime
              {' · '}
              <span className="accent">{data.availabilityPct ?? '—'}%</span> availability
            </div>
            <p>
              A stoppage here means the whole line produced <b>zero cones for {threshold}+ seconds</b> — inferred purely
              from gaps between cone weighings. There is no PLC status feed and no planned-downtime schedule, so this
              cannot distinguish a scheduled break or changeover from an unplanned fault. Typical running gap this day
              was ~{data.typicalGapSeconds ?? '—'}s between cones, for reference.
            </p>
          </div>

          <div className="kpis">
            <Tile label="Availability" value={data.availabilityPct} format={(n) => n.toFixed(1)} unit="%"
              foot={<>{fmtInt(data.coneCount)} cones this day</>} />
            <Tile label="Total Downtime" value={data.totalDownSeconds} format={(n) => fmtDuration(n)}
              foot={<>across {data.stoppageCount} stoppage{data.stoppageCount === 1 ? '' : 's'}</>} />
            <Tile label="MTBF" value={data.mtbfSeconds} format={(n) => fmtDuration(n)}
              foot={<>mean time between failures</>} />
            <Tile label="MTTR" value={data.mttrSeconds} format={(n) => fmtDuration(n)}
              foot={<>mean time to recover</>} />
          </div>

          <div className="panel">
            <h2>Stoppage timeline</h2>
            <div className="hint">
              {data.firstTs && data.lastTs
                ? `${fmtDateTime(data.firstTs)} — ${fmtDateTime(data.lastTs)}`
                : 'No data this day.'}
            </div>
            <div className="dt-timeline-track">
              {data.firstTs &&
                data.lastTs &&
                data.stoppages.map((s, i) => {
                  const spanMs = new Date(data.lastTs!).getTime() - new Date(data.firstTs!).getTime();
                  const leftPct = ((new Date(s.startTs).getTime() - new Date(data.firstTs!).getTime()) / spanMs) * 100;
                  const widthPct = Math.max(0.3, (s.durationSeconds * 1000 / spanMs) * 100);
                  return (
                    <div
                      key={i}
                      className="dt-timeline-seg"
                      style={{ left: `${revealed ? leftPct : 0}%`, width: `${revealed ? widthPct : 0}%`, cursor: 'pointer' }}
                      onClick={() => inspectStoppage(s)}
                    >
                      <span className="tip">
                        {fmtTime(s.startTs)} – {fmtTime(s.endTs)}
                        <br />
                        {fmtDuration(s.durationSeconds)} down
                      </span>
                    </div>
                  );
                })}
            </div>
            <div className="dt-timeline-axis">
              <span>{data.firstTs ? fmtTime(data.firstTs) : ''}</span>
              <span>{data.lastTs ? fmtTime(data.lastTs) : ''}</span>
            </div>

            <h2>Throughput — cones per hour</h2>
            <div className="hint">Detected stoppages line up with the low bars below.</div>
            <div className="ratebars">
              {data.hourly.map((h) => (
                <div key={h.hourTs} className="rbar" style={{ height: `${revealed ? (100 * h.count) / rateMax : 0}%` }}>
                  <span className="tip">{fmtHourLabel(h.hourTs)}: {h.count} cones</span>
                </div>
              ))}
            </div>
            <div className="rate-axis">
              <span>{data.hourly[0] ? fmtHourLabel(data.hourly[0].hourTs) : ''}</span>
              <span>{data.hourly.length > 1 ? fmtHourLabel(data.hourly[data.hourly.length - 1]!.hourTs) : ''}</span>
            </div>
          </div>

          {data.stoppages.length > 0 && (
            <div className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <h2>Stoppages — longest first</h2>
                {data.stoppages.length > STOPPAGE_PREVIEW_COUNT && (
                  <button className="abtn" onClick={() => setStoppagesExpanded((v) => !v)}>
                    {stoppagesExpanded ? 'Show less' : `Show all ${data.stoppages.length}`}
                  </button>
                )}
              </div>
              <div className="table-scroll">
                <table className="dt-table">
                  <thead>
                    <tr>
                      <th>Start</th>
                      <th>End</th>
                      <th className="num">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(stoppagesExpanded ? data.stoppages : data.stoppages.slice(0, STOPPAGE_PREVIEW_COUNT)).map((s, i) => (
                      <tr key={i} className="reg-row" onClick={() => inspectStoppage(s)}>
                        <td>{fmtDateTime(s.startTs)}</td>
                        <td>{fmtDateTime(s.endTs)}</td>
                        <td className="num">{fmtDuration(s.durationSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!stoppagesExpanded && data.stoppages.length > STOPPAGE_PREVIEW_COUNT && (
                <div className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                  {data.stoppages.length - STOPPAGE_PREVIEW_COUNT} more not shown.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ---------------- Weight SPC ---------------- */

function capClass(v: number | null): string {
  if (v == null) return '';
  if (v >= 1.33) return 'good';
  if (v >= 1.0) return 'warn';
  return 'bad';
}

type SpcMode = 'none' | 'product' | 'manual';

function SpcView({
  range,
  onMeta,
  onInspect,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  onInspect: (seed: RegisterSeed) => void;
}) {
  const [type, setType] = useState<SpcType>('cone');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [specMode, setSpecMode] = useState<SpcMode>('none');
  const [productId, setProductId] = useState('');
  const [manualUsl, setManualUsl] = useState('');
  const [manualLsl, setManualLsl] = useState('');
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [data, setData] = useState<SpcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProducts().then((r) => setProducts(r.products)).catch(() => {});
  }, []);

  useEffect(() => {
    if (range.max && !to) {
      const prior = new Date(`${range.max}T12:00:00Z`);
      prior.setUTCDate(prior.getUTCDate() - 1);
      const priorStr = prior.toISOString().slice(0, 10);
      const d = range.min && priorStr >= range.min ? priorStr : range.max;
      setTo(d);
      setFrom(d);
    }
  }, [range.max, range.min, to]);

  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const q: { type: SpcType; from: string; to: string; productId?: number; usl?: number; lsl?: number } = { type, from, to };
    if (specMode === 'product' && productId) q.productId = Number(productId);
    if (specMode === 'manual' && manualUsl && manualLsl) {
      q.usl = Number(manualUsl);
      q.lsl = Number(manualLsl);
    }
    getSpc(q)
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        onMeta(r.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [type, from, to, specMode, productId, manualUsl, manualLsl, onMeta]);

  const unit = type === 'cone' ? 'g' : 'kg';
  const noun = type === 'cone' ? 'cones' : 'sacks';

  // click a subgroup → the register, filtered to that exact time bucket.
  const inspectSubgroup = (g: Subgroup) => {
    if (!data) return;
    const startMs = new Date(g.ts).getTime();
    const endMs = startMs + data.bucketMinutes * 60_000;
    onInspect({
      type,
      from: g.ts.slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
      tsFrom: g.ts,
      tsTo: new Date(endMs).toISOString(),
      label: `${data.bucketLabel} subgroup at ${fmtDateTime(g.ts)} (n=${g.n}, mean ${g.mean}${unit})`,
    });
  };

  // click a station → the register, filtered to that station over the range.
  const inspectStation = (s: StationStat) =>
    onInspect({
      type: 'cone',
      from,
      to,
      station: s.station,
      label: `station ${s.station} over ${from === to ? from : `${from}–${to}`} (mean ${s.mean}${unit}, ${s.delta > 0 ? '+' : ''}${s.delta}${unit} vs line)`,
    });

  return (
    <>
      <div className="filters">
        <div className="field">
          <label>Record type</label>
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { key: 'cone', label: 'Cones' },
              { key: 'sack', label: 'Sacks' },
            ]}
          />
        </div>
        <div className="field">
          <label>From</label>
          <input type="date" value={from} min={range.min ?? undefined} max={range.max ?? undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={to} min={range.min ?? undefined} max={range.max ?? undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field">
          <label>Spec limits (for Cp/Cpk)</label>
          <div className="spc-spec-picker">
            <select
              value={specMode === 'product' ? `p:${productId}` : specMode}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'none' || v === 'manual') {
                  setSpecMode(v);
                } else {
                  setSpecMode('product');
                  setProductId(v.replace('p:', ''));
                }
              }}
            >
              <option value="none">None — statistical control only</option>
              <option value="manual">Manual entry</option>
              {products.map((p) => (
                <option key={p.productId} value={`p:${p.productId}`}>
                  {p.description || p.lotCode || `Product ${p.productId}`} ({p.setpointG}g)
                </option>
              ))}
            </select>
            {specMode === 'manual' && (
              <>
                <input type="number" placeholder={`LSL (${unit})`} value={manualLsl} onChange={(e) => setManualLsl(e.target.value)} />
                <input type="number" placeholder={`USL (${unit})`} value={manualUsl} onChange={(e) => setManualUsl(e.target.value)} />
              </>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <div className="error-card"><b>Couldn't load SPC data.</b> {error}</div>
      ) : loading || !data ? (
        <div className="tile skeleton" style={{ height: 320 }} />
      ) : (
        <>
          {data.spec.source !== 'none' ? (
            <div className={`spc-spec-note ${data.spec.source === 'product' ? 'confirmed' : 'unconfirmed'}`}>
              {data.spec.source === 'product' ? (
                <>Spec limits from IFL's confirmed material tolerance — <b>{data.spec.productLabel}</b>: {data.spec.lsl}–{data.spec.usl} {unit} (nominal {data.spec.nominal}{unit}).</>
              ) : (
                <>Spec limits entered manually ({data.spec.lsl}–{data.spec.usl} {unit}) — <b>unconfirmed with IFL</b>, treat capability below as provisional.</>
              )}
            </div>
          ) : (
            <div className="spc-spec-note none">
              No spec limits selected — the control chart below needs none (it's purely statistical), but Cp/Cpk require a real tolerance. Pick a product or enter limits manually above.
            </div>
          )}

          <div className="panel" style={{ marginTop: 16 }}>
            <h2>Process summary</h2>
            <div className="hint">
              {fmtInt(data.count)} in-range {type === 'cone' ? 'cones' : 'sacks'}, {from === to ? from : `${from} to ${to}`} ·
              {' '}grouped into {data.subgroups.length} {data.bucketLabel} subgroups.
            </div>
            <div className="stat-row">
              <Stat label="Mean" val={`${data.mean}`} u={unit} accent />
              <Stat label="σ (within)" val={`${data.stdevWithin}`} u={unit} />
              <Stat label="σ (overall)" val={`${data.stdevOverall}`} u={unit} />
              <Stat label="Subgroups out of control" val={`${data.xbarOutOfControl}`} u={`of ${data.subgroups.length}`} accent={data.xbarOutOfControl > 0} />
            </div>

            <div className="cap-row">
              <div className="cap-tile">
                <span className="cap-label">Cp</span>
                <span className={`cap-val ${capClass(data.capability.cp)}`}>{data.capability.cp ?? '—'}</span>
                <span className="cap-hint">potential capability</span>
              </div>
              <div className="cap-tile">
                <span className="cap-label">Cpk</span>
                <span className={`cap-val ${capClass(data.capability.cpk)}`}>{data.capability.cpk ?? '—'}</span>
                <span className="cap-hint">actual capability</span>
              </div>
              <div className="cap-tile">
                <span className="cap-label">Pp</span>
                <span className={`cap-val ${capClass(data.capability.pp)}`}>{data.capability.pp ?? '—'}</span>
                <span className="cap-hint">overall performance</span>
              </div>
              <div className="cap-tile">
                <span className="cap-label">Ppk</span>
                <span className={`cap-val ${capClass(data.capability.ppk)}`}>{data.capability.ppk ?? '—'}</span>
                <span className="cap-hint">overall performance</span>
              </div>
            </div>
            {data.capability.cpk != null && (
              <div className="hint" style={{ marginTop: 4 }}>
                Cpk ≥ 1.33 is conventionally "capable", 1.00–1.33 "marginal", below 1.00 "not capable" for this tolerance.
              </div>
            )}
          </div>

          {type === 'cone' && data.stations.length > 0 && (
            <div className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <h2>Per-station weight — where the real variation is</h2>
              </div>
              <div className="hint">
                Each winding station's mean weight vs the line average ({data.grandMean}{unit}). Bars run light (below) to heavy (above);
                click any station to see its cones. Dashed lines are the <b>±{data.practicalThresholdG}{unit} practical threshold</b>
                {' '}({data.spec.source !== 'none' ? '10% of the spec tolerance' : '0.3σ of the spread'}) — only bars past it are flagged as worth acting on.{' '}
                {data.flaggedStationCount > 0 ? (
                  <>
                    <b>{data.flaggedStationCount} of {data.stations.length}</b> cross it. ({data.distinguishableStationCount} are
                    <i> statistically</i> distinguishable at ~{fmtInt(Math.round(data.count / data.stations.length))} cones each, but most of those offsets are too small to matter.)
                  </>
                ) : (
                  <>No station crosses it — the {data.distinguishableStationCount} statistically-distinguishable stations are all within the practical band.</>
                )}
              </div>
              <ResizableChart initialHeight={240}>
                {(h) => (
                  <StationChart stations={data.stations} grandMean={data.grandMean} threshold={data.practicalThresholdG} unit={unit} height={h} onStationClick={inspectStation} />
                )}
              </ResizableChart>
            </div>
          )}

          <div className="panel" style={{ marginTop: 16 }}>
            <h2>X̄ chart — line mean over time</h2>
            <div className="hint">
              Each point is the mean of one {data.bucketLabel} subgroup; the band is that subgroup's ±3σ control limit (narrower where more {noun} landed).
              A point outside the band means the line mean genuinely shifted. Click a point to inspect those {noun}.
              {data.spec.usl != null && ' Amber lines are the spec tolerance.'}
            </div>
            <ResizableChart initialHeight={220}>
              {(h) => (
                <SubgroupChart
                  subgroups={data.subgroups}
                  valueOf={(g) => g.mean}
                  uclOf={(g) => g.xUcl}
                  lclOf={(g) => g.xLcl}
                  violatesOf={(g) => g.xViolates}
                  centerline={data.grandMean}
                  uslLine={data.spec.usl}
                  lslLine={data.spec.lsl}
                  unit={unit}
                  noun={noun}
                  height={h}
                  onPointClick={inspectSubgroup}
                />
              )}
            </ResizableChart>
            <div className="spc-legend">
              <span><span className="dot limit" /> out of control ({data.xbarOutOfControl})</span>
              <span><span className="dot ctr" /> centerline {data.grandMean}{unit}</span>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h2>S chart — within-subgroup spread over time</h2>
            <div className="hint">
              Each point is the spread (σ) inside one {data.bucketLabel} subgroup, centered on {data.sChartCenter}{unit}. A point above its band means the
              process got erratic in that window.
              {type === 'cone'
                ? ' This is a valid consistency signal, unlike a raw cone-to-cone moving range across interleaved stations.'
                : ''}
            </div>
            <ResizableChart initialHeight={150}>
              {(h) => (
                <SubgroupChart
                  subgroups={data.subgroups.filter((g) => g.s != null)}
                  valueOf={(g) => g.s}
                  uclOf={(g) => g.sUcl}
                  lclOf={(g) => g.sLcl}
                  violatesOf={(g) => g.sViolates}
                  centerline={data.sChartCenter}
                  unit={unit}
                  noun={noun}
                  height={h}
                  onPointClick={inspectSubgroup}
                />
              )}
            </ResizableChart>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <h2>Weight distribution</h2>
            <div className="hint">
              Every in-range {type === 'cone' ? 'cone' : 'sack'}, binned. The green line is the mean;
              {data.spec.usl != null ? ' amber lines are the spec tolerance — bars near or past them are the capability risk.' : ' add a spec above to overlay the tolerance.'}
            </div>
            <ResizableChart initialHeight={200}>
              {(h) => <Histogram bins={data.histogram} mean={data.mean} usl={data.spec.usl} lsl={data.spec.lsl} unit={unit} height={h} />}
            </ResizableChart>
          </div>
        </>
      )}
    </>
  );
}

/** Wraps a chart in a vertically drag-resizable frame so the user can enlarge
 * it for closer visual inspection. Passes the live height to the child so the
 * chart re-lays-out crisply (no SVG stretching / distorted text). */
function ResizableChart({
  initialHeight = 220,
  minHeight = 140,
  maxHeight = 700,
  children,
}: {
  initialHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  children: (height: number) => ReactNode;
}) {
  const [height, setHeight] = useState(initialHeight);
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const onMove = (ev: MouseEvent) => {
      setHeight(Math.max(minHeight, Math.min(maxHeight, startH + (ev.clientY - startY))));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  return (
    <div className="resizable-chart">
      {children(height)}
      <div className="resize-handle" onMouseDown={startDrag} title="Drag to resize" role="separator" aria-orientation="horizontal">
        <span className="grip" />
      </div>
    </div>
  );
}

/** X̄ or S chart over time-based subgroups, with a variable-width control
 * band (per-subgroup limits, narrower where more cones landed). */
function SubgroupChart({
  subgroups,
  valueOf,
  uclOf,
  lclOf,
  violatesOf,
  centerline,
  uslLine,
  lslLine,
  unit,
  noun,
  height = 220,
  onPointClick,
}: {
  subgroups: Subgroup[];
  valueOf: (g: Subgroup) => number | null;
  uclOf: (g: Subgroup) => number | null;
  lclOf: (g: Subgroup) => number | null;
  violatesOf: (g: Subgroup) => boolean;
  centerline: number;
  uslLine?: number | null;
  lslLine?: number | null;
  unit: string;
  noun: string;
  height?: number;
  onPointClick?: (g: Subgroup) => void;
}) {
  const W = 1000;
  const RM = 56;
  const [hover, setHover] = useState<number | null>(null);
  const valid = subgroups.filter((g) => valueOf(g) != null);
  if (valid.length === 0) return <div className="empty-note">Not enough data to chart.</div>;

  const vals = valid.map((g) => valueOf(g)!);
  const ucls = valid.map(uclOf).filter((v): v is number => v != null);
  const lcls = valid.map(lclOf).filter((v): v is number => v != null);
  const cand = [...vals, ...ucls, ...lcls, centerline, uslLine ?? centerline, lslLine ?? centerline];
  const dMin = Math.min(...cand);
  const dMax = Math.max(...cand);
  const pad = (dMax - dMin) * 0.12 || 1;
  const yMin = dMin - pad;
  const yMax = dMax + pad;
  const x = (i: number) => (i / Math.max(1, valid.length - 1)) * W;
  const y = (v: number) => height - ((v - yMin) / (yMax - yMin)) * height;

  const bandTop = valid.map((g, i) => `${x(i).toFixed(1)},${y(uclOf(g) ?? centerline).toFixed(1)}`);
  const bandBot = valid.map((g, i) => `${x(i).toFixed(1)},${y(lclOf(g) ?? centerline).toFixed(1)}`).reverse();
  const bandPath = `M${bandTop.join('L')}L${bandBot.join('L')}Z`;
  const linePts = valid.map((g, i) => `${x(i).toFixed(1)},${y(valueOf(g)!).toFixed(1)}`).join(' ');

  const gridN = 4;
  const gridVals = Array.from({ length: gridN + 1 }, (_, i) => yMin + (i / gridN) * (yMax - yMin));
  const tickCount = Math.min(7, valid.length);
  const tickIdxs =
    valid.length <= 1 ? [0] : Array.from({ length: tickCount }, (_, i) => Math.round((i * (valid.length - 1)) / (tickCount - 1)));

  const indexAt = (e: React.MouseEvent<SVGRectElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(valid.length - 1, Math.round(frac * (valid.length - 1))));
  };
  const hg = hover != null ? valid[hover] : null;
  const hVal = hg ? valueOf(hg) : null;
  const tipW = 172;
  const tipX = hover != null ? Math.min(Math.max(x(hover) + 10, 0), W - tipW) : 0;

  return (
    <div className="spc-chart-wrap">
      <svg className="spc-chart" viewBox={`0 0 ${W + RM} ${height + 24}`} width="100%" height={height + 24} preserveAspectRatio="none">
        {gridVals.map((gv, i) => (
          <line key={i} className="grid-line" x1={0} y1={y(gv)} x2={W} y2={y(gv)} />
        ))}
        <path className="ctl-band" d={bandPath} />
        <line className="center-line" x1={0} y1={y(centerline)} x2={W} y2={y(centerline)} />
        {uslLine != null && uslLine <= yMax && <line className="spec-line" x1={0} y1={y(uslLine)} x2={W} y2={y(uslLine)} />}
        {lslLine != null && lslLine >= yMin && <line className="spec-line" x1={0} y1={y(lslLine)} x2={W} y2={y(lslLine)} />}
        <polyline className="series-line" points={linePts} />
        {valid.map((g, i) => (
          <circle key={i} className={violatesOf(g) ? 'pt-limit' : 'pt-ok'} cx={x(i)} cy={y(valueOf(g)!)} r={violatesOf(g) ? 3.6 : 2.4} />
        ))}
        <text className="axis-label" x={W + 4} y={y(centerline) + 3}>{centerline.toFixed(1)}</text>
        {tickIdxs.map((i) => (
          <text key={i} className="x-tick" x={x(i)} y={height + 16} textAnchor="middle">{fmtTime(valid[i]!.ts)}</text>
        ))}
        {hover != null && hg && hVal != null && (
          <>
            <line className="crosshair" x1={x(hover)} y1={0} x2={x(hover)} y2={height} />
            <circle className={violatesOf(hg) ? 'hover-dot burst' : 'hover-dot'} cx={x(hover)} cy={y(hVal)} r={4} />
            <g transform={`translate(${tipX}, 4)`}>
              <rect className="tooltip-bg" width={tipW} height={16 + (violatesOf(hg) ? 4 : 3) * 15} rx={5} />
              <text className="tooltip-text" x={9} y={17}>{fmtDateTime(hg.ts)}</text>
              <text className="tooltip-text strong" x={9} y={32}>{hVal.toFixed(2)} {unit}</text>
              <text className="tooltip-text" x={9} y={47}>n = {hg.n} {noun}</text>
              {violatesOf(hg) && <text className="tooltip-text warn" x={9} y={62}>out of control</text>}
            </g>
          </>
        )}
        <rect
          x={0}
          y={0}
          width={W}
          height={height}
          fill="transparent"
          style={{ pointerEvents: 'all', cursor: onPointClick ? 'pointer' : 'crosshair' }}
          onMouseMove={(e) => setHover(indexAt(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            if (!onPointClick) return;
            const g = valid[indexAt(e)];
            if (g) onPointClick(g);
          }}
        />
      </svg>
    </div>
  );
}

/** Per-station deviation from the line mean — diverging columns (light↓/heavy↑),
 * with the ±practical-threshold band. Flagged stations (past the band) are
 * emphasized; this is where the dominant, actionable weight variation lives. */
function StationChart({
  stations,
  grandMean,
  threshold,
  unit,
  height = 240,
  onStationClick,
}: {
  stations: StationStat[];
  grandMean: number;
  threshold: number;
  unit: string;
  height?: number;
  onStationClick?: (s: StationStat) => void;
}) {
  const W = 1000;
  const H = height;
  const [hover, setHover] = useState<number | null>(null);
  const n = stations.length;
  const maxAbs = Math.max(0.5, threshold * 1.15, ...stations.map((s) => Math.abs(s.delta))) * 1.3;
  const bandW = W / n;
  const barW = bandW * 0.5;
  const yMid = H / 2;
  const y = (d: number) => yMid - (d / maxAbs) * (H / 2);

  const hs = hover != null ? stations[hover] : null;
  const tipW = 184;
  const tipX = hover != null ? Math.min(Math.max(hover * bandW + bandW / 2 + 8, 0), W - tipW) : 0;

  return (
    <div className="spc-chart-wrap">
      <svg className="spc-chart st-chart" viewBox={`0 0 ${W} ${H + 26}`} width="100%" height={H + 26} preserveAspectRatio="none">
        {threshold > 0 && (
          <>
            <line className="st-dl" x1={0} y1={y(threshold)} x2={W} y2={y(threshold)} />
            <line className="st-dl" x1={0} y1={y(-threshold)} x2={W} y2={y(-threshold)} />
          </>
        )}
        <line className="st-zero" x1={0} y1={yMid} x2={W} y2={yMid} />
        {stations.map((s, i) => {
          const cx = i * bandW + bandW / 2;
          const top = Math.min(y(0), y(s.delta));
          const h = Math.abs(y(s.delta) - y(0)) || 1;
          const cls = `st-bar${s.flagged ? ' flagged' : ''}`;
          return <rect key={s.station} className={cls} x={cx - barW / 2} y={top} width={barW} height={h} rx={1.5} />;
        })}
        {stations.map((s, i) => (
          <text key={s.station} className={`x-tick${s.flagged ? ' flagged' : ''}`} x={i * bandW + bandW / 2} y={H + 16} textAnchor="middle">{s.station}</text>
        ))}
        {hover != null && hs && (
          <g transform={`translate(${tipX}, 4)`}>
            <rect className="tooltip-bg" width={tipW} height={16 + 4 * 15} rx={5} />
            <text className="tooltip-text strong" x={9} y={17}>Station {hs.station}</text>
            <text className="tooltip-text" x={9} y={32}>mean {hs.mean} {unit}</text>
            <text className="tooltip-text" x={9} y={47}>{hs.delta > 0 ? '+' : ''}{hs.delta} {unit} vs line · n={fmtInt(hs.n)}</text>
            <text className={`tooltip-text ${hs.flagged ? 'warn' : ''}`} x={9} y={62}>
              {hs.flagged ? `off-target (past ±${threshold}${unit})` : 'within practical band'}
            </text>
          </g>
        )}
        {stations.map((s, i) => (
          <rect
            key={s.station}
            x={i * bandW}
            y={0}
            width={bandW}
            height={H}
            fill="transparent"
            style={{ pointerEvents: 'all', cursor: onStationClick ? 'pointer' : 'default' }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onStationClick?.(s)}
          />
        ))}
      </svg>
    </div>
  );
}

/** Weight distribution histogram with mean + spec-limit overlays. */
function Histogram({
  bins,
  mean,
  usl,
  lsl,
  unit,
  height = 200,
}: {
  bins: HistBin[];
  mean: number;
  usl: number | null;
  lsl: number | null;
  unit: string;
  height?: number;
}) {
  const W = 1000;
  const H = height;
  const [hover, setHover] = useState<number | null>(null);
  if (bins.length === 0) return <div className="empty-note">Not enough data to chart.</div>;
  const maxC = Math.max(1, ...bins.map((b) => b.count));
  const lo = bins[0]!.start;
  const hi = bins[bins.length - 1]!.end;
  const xv = (v: number) => ((v - lo) / (hi - lo)) * W;
  const bw = W / bins.length;
  const y = (c: number) => H - (c / maxC) * H;

  const tickVals = [lo, lo + (hi - lo) * 0.25, (lo + hi) / 2, lo + (hi - lo) * 0.75, hi];
  const hb = hover != null ? bins[hover] : null;
  const tipW = 150;
  const tipX = hover != null ? Math.min(Math.max(hover * bw + bw / 2 + 8, 0), W - tipW) : 0;

  return (
    <div className="spc-chart-wrap">
      <svg className="spc-chart histchart" viewBox={`0 0 ${W} ${H + 24}`} width="100%" height={H + 24} preserveAspectRatio="none">
        {bins.map((b, i) => (
          <rect
            key={i}
            className={`hist-bar${hover === i ? ' hi' : ''}`}
            x={i * bw + 0.5}
            y={y(b.count)}
            width={bw - 1}
            height={H - y(b.count)}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {lsl != null && lsl >= lo && lsl <= hi && <line className="spec-line" x1={xv(lsl)} y1={0} x2={xv(lsl)} y2={H} />}
        {usl != null && usl >= lo && usl <= hi && <line className="spec-line" x1={xv(usl)} y1={0} x2={xv(usl)} y2={H} />}
        <line className="mean-line" x1={xv(mean)} y1={0} x2={xv(mean)} y2={H} />
        {tickVals.map((v, i) => (
          <text key={i} className="x-tick" x={Math.max(14, Math.min(W - 14, xv(v)))} y={H + 16} textAnchor="middle">{Math.round(v)}</text>
        ))}
        {hover != null && hb && (
          <g transform={`translate(${tipX}, 4)`}>
            <rect className="tooltip-bg" width={tipW} height={16 + 2 * 15} rx={5} />
            <text className="tooltip-text" x={9} y={17}>{hb.start}–{hb.end} {unit}</text>
            <text className="tooltip-text strong" x={9} y={32}>{fmtInt(hb.count)} {hb.count === 1 ? 'unit' : 'units'}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

/* ---------------- Reject control chart (p-chart) ---------------- */

function RejectSpcView({
  range,
  onMeta,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rejectType, setRejectType] = useState<RejectTypeFilter>('all');
  const [data, setData] = useState<RejectSpcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // default to the full available window — bursts are a multi-day pattern
    if (range.max && !to) {
      setTo(range.max);
      setFrom(range.min ?? range.max);
    }
  }, [range.max, range.min, to]);

  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRejectSpc(from, to, rejectType)
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        onMeta(r.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to, rejectType, onMeta]);

  const revealed = useRevealOnData(data ? `${data.bucketSize}:${data.buckets.length}:${data.outOfControlCount}` : null);

  return (
    <>
      <div className="filters">
        <div className="field">
          <label>From</label>
          <input type="date" value={from} min={range.min ?? undefined} max={range.max ?? undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={to} min={range.min ?? undefined} max={range.max ?? undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field">
          <label>Reject type</label>
          <Segmented
            value={rejectType}
            onChange={setRejectType}
            options={[
              { key: 'all', label: 'All' },
              { key: 'quality', label: 'Quality' },
              { key: 'weight', label: 'Weight' },
            ]}
          />
        </div>
      </div>

      {error ? (
        <div className="error-card"><b>Couldn't load the reject control chart.</b> {error}</div>
      ) : loading || !data ? (
        <div className="tile skeleton" style={{ height: 320 }} />
      ) : (
        <>
          <div className="callout">
            <div className="big">
              <span className="accent">{data.outOfControlCount}</span> of {fmtInt(data.buckets.length)} {data.bucketSize === 'hour' ? 'hours' : 'days'}{' '}
              show a reject rate beyond normal variation
              {' · '}
              baseline <span className="accent">{data.pBar != null ? (data.pBar * 100).toFixed(2) : '—'}%</span>
            </div>
            <p>
              Each {data.bucketSize} gets its own control limit, scaled to how many cones it actually produced — a quiet
              hour and a busy hour are judged fairly, not against one flat threshold. A run of 2+ flagged buckets in a
              row is a genuine event (bad batch, mis-calibration); a single flagged bucket is an isolated spike.
            </p>
          </div>

          {data.episodes.length > 0 ? (
            <div className="panel">
              <h2>Detected episodes</h2>
              <div className="hint">Sorted by severity — longest run first.</div>
              {data.episodes.map((ep, i) => (
                <div key={i} className={`episode-card${ep.bucketCount === 1 ? ' single' : ''}`}>
                  <div className="ep-title">
                    {ep.bucketCount === 1 ? 'Isolated spike' : `Burst — ${ep.bucketCount} consecutive ${data.bucketSize}s`}
                  </div>
                  <div className="ep-detail">
                    {fmtDateTime(ep.startTs)} — {fmtDateTime(ep.endTs)} · {fmtInt(ep.totalRejects)} rejects of {fmtInt(ep.totalProduced)} produced
                    {' '}({((ep.totalRejects / ep.totalProduced) * 100).toFixed(2)}%)
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="panel">
              <div className="empty-note">No anomalous {data.bucketSize}s in this window — reject rate stayed within normal variation throughout.</div>
            </div>
          )}

          <div className="panel" style={{ marginTop: 16 }}>
            <h2>Reject rate control chart</h2>
            <div className="hint">
              Dashed line is each bucket's own 3σ upper limit (based on its production volume); flat line is the overall baseline rate.
            </div>
            <ResizableChart initialHeight={220}>
              {(h) => <PChart buckets={data.buckets} pBar={data.pBar} bucketSize={data.bucketSize} revealed={revealed} height={h} />}
            </ResizableChart>
            <div className="spc-legend">
              <span><span className="dot" style={{ background: 'var(--alert)' }} /> beyond control limit ({data.outOfControlCount})</span>
              <span><span className="dot" style={{ background: 'var(--green)' }} /> normal variation</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function PChart({
  buckets,
  pBar,
  bucketSize,
  revealed,
  height = 220,
}: {
  buckets: RejectBucket[];
  pBar: number | null;
  bucketSize: 'hour' | 'day';
  revealed: boolean;
  height?: number;
}) {
  const W = 1000;
  const H = height;
  const RM = 56;
  const [hover, setHover] = useState<number | null>(null);
  const withRate = buckets.filter((b) => b.rate != null);
  if (withRate.length === 0 || pBar == null) {
    return <div className="empty-note">Not enough data to chart.</div>;
  }
  const rates = withRate.map((b) => b.rate!);
  const ucls = withRate.map((b) => b.ucl ?? 0);
  const yMax = Math.max(...rates, ...ucls, pBar) * 1.15 || 0.01;
  const x = (i: number) => (i / Math.max(1, withRate.length - 1)) * W;
  const y = (v: number) => (revealed ? H - (v / yMax) * H : H);

  const ratePts = withRate.map((b, i) => `${x(i).toFixed(1)},${y(b.rate!).toFixed(1)}`).join(' ');
  const uclPts = withRate.map((b, i) => `${x(i).toFixed(1)},${y(b.ucl ?? 0).toFixed(1)}`).join(' ');

  const gridN = 4;
  const gridVals = Array.from({ length: gridN + 1 }, (_, i) => (i / gridN) * yMax);
  const tickCount = Math.min(bucketSize === 'hour' ? 8 : 6, withRate.length);
  const tickIdxs =
    withRate.length <= 1
      ? [0]
      : Array.from({ length: tickCount }, (_, i) => Math.round((i * (withRate.length - 1)) / (tickCount - 1)));
  const tickLabel = (ts: string) => (bucketSize === 'hour' ? fmtTime(ts) : ts.slice(0, 10));

  const handleMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(frac * (withRate.length - 1));
    setHover(Math.max(0, Math.min(withRate.length - 1, idx)));
  };

  const hb = hover != null ? withRate[hover] : null;
  const tipW = 168;
  const tipX = hover != null ? Math.min(Math.max(x(hover) + 10, 0), W - tipW) : 0;

  return (
    <div className="spc-chart-wrap">
      <svg
        className="spc-chart pchart"
        viewBox={`0 0 ${W + RM} ${H + 24}`}
        width="100%"
        height={H + 24}
        preserveAspectRatio="none"
      >
        {gridVals.map((gv, i) => (
          <line key={i} className="grid-line" x1={0} y1={y(gv)} x2={W} y2={y(gv)} />
        ))}
        <polyline className="ucl-band" points={uclPts} />
        <line className="center-line" x1={0} y1={y(pBar)} x2={W} y2={y(pBar)} />
        <polyline className="rate-line" points={ratePts} style={{ transition: 'opacity 300ms' }} />
        {withRate.map((b, i) => (
          <circle key={i} className={b.outOfControl ? 'pt-burst' : 'pt-ok'} cx={x(i)} cy={y(b.rate!)} r={b.outOfControl ? 3.2 : 1.6} />
        ))}
        <text className="axis-label" x={W + 4} y={y(pBar) + 3}>{(pBar * 100).toFixed(2)}%</text>

        {tickIdxs.map((i) => (
          <text key={i} className="x-tick" x={x(i)} y={H + 16} textAnchor="middle">
            {tickLabel(withRate[i]!.bucketTs)}
          </text>
        ))}

        {hover != null && hb && (
          <>
            <line className="crosshair" x1={x(hover)} y1={0} x2={x(hover)} y2={H} />
            <circle className={hb.outOfControl ? 'hover-dot burst' : 'hover-dot'} cx={x(hover)} cy={y(hb.rate!)} r={4} />
            <g transform={`translate(${tipX}, 4)`}>
              <rect className="tooltip-bg" width={tipW} height={16 + 4 * 15} rx={5} />
              <text className="tooltip-text" x={9} y={17}>
                {bucketSize === 'hour' ? fmtDateTime(hb.bucketTs) : hb.bucketTs.slice(0, 10)}
              </text>
              <text className="tooltip-text strong" x={9} y={17 + 16}>{((hb.rate ?? 0) * 100).toFixed(2)}% rate</text>
              <text className="tooltip-text" x={9} y={17 + 31}>{fmtInt(hb.rejects)} of {fmtInt(hb.produced)} produced</text>
              {hb.outOfControl && <text className="tooltip-text warn" x={9} y={17 + 46}>beyond control limit</text>}
            </g>
          </>
        )}
        <rect
          x={0}
          y={0}
          width={W}
          height={H}
          fill="transparent"
          style={{ pointerEvents: 'all', cursor: 'crosshair' }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
    </div>
  );
}

/* ---------------- Inferred OEE ---------------- */

function oeeClass(pct: number): string {
  if (pct >= 85) return 'good'; // world-class benchmark
  if (pct >= 60) return 'warn'; // typical/acceptable
  return 'bad';
}

function OeeView({
  range,
  onMeta,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [thresholdSeconds, setThresholdSeconds] = useState(120);
  const [plannedHoursPerDay, setPlannedHoursPerDay] = useState(24);
  const [idealOverride, setIdealOverride] = useState('');
  const [data, setData] = useState<OeeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (range.max && !to) {
      const prior = new Date(`${range.max}T12:00:00Z`);
      prior.setUTCDate(prior.getUTCDate() - 1);
      const priorStr = prior.toISOString().slice(0, 10);
      const d = range.min && priorStr >= range.min ? priorStr : range.max;
      setTo(d);
      setFrom(d);
    }
  }, [range.max, range.min, to]);

  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getOee({
      from,
      to,
      thresholdSeconds,
      plannedHoursPerDay,
      idealCycleSeconds: idealOverride ? Number(idealOverride) : undefined,
    })
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        onMeta(r.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to, thresholdSeconds, plannedHoursPerDay, idealOverride, onMeta]);

  return (
    <>
      <div className="callout">
        <div className="big">Estimated OEE — not a certified figure</div>
        <p>
          There is no PLC status feed and no planned-downtime schedule for this line, so Availability, Performance and
          Quality below are all <b>inferred from event timestamps</b>. Every input that shapes the estimate — the
          stoppage threshold, planned hours/day, and the ideal cycle time — is shown and editable below, so you can see
          exactly what produced this number and correct it if it doesn't match how the plant actually runs.
        </p>
      </div>

      <div className="oee-inputs filters">
        <div className="field">
          <label>From</label>
          <input type="date" value={from} min={range.min ?? undefined} max={range.max ?? undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={to} min={range.min ?? undefined} max={range.max ?? undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field">
          <label>Stoppage threshold (s)</label>
          <input type="number" min={30} max={3600} step={30} value={thresholdSeconds} onChange={(e) => setThresholdSeconds(Math.max(30, Math.min(3600, Number(e.target.value) || 120)))} />
        </div>
        <div className="field">
          <label>Planned hours/day</label>
          <input type="number" min={1} max={24} step={0.5} value={plannedHoursPerDay} onChange={(e) => setPlannedHoursPerDay(Math.max(1, Math.min(24, Number(e.target.value) || 24)))} />
        </div>
        <div className="field">
          <label>Ideal cycle (s) — override</label>
          <input type="number" min={0.1} step={0.1} placeholder="auto" value={idealOverride} onChange={(e) => setIdealOverride(e.target.value)} />
        </div>
      </div>

      {error ? (
        <div className="error-card"><b>Couldn't load OEE.</b> {error}</div>
      ) : loading || !data ? (
        <div className="tile skeleton" style={{ height: 260 }} />
      ) : (
        <>
          {data.possiblyPartial && (
            <div className="rule-note" style={{ marginBottom: 14 }}>
              <b>Partial data window — numbers below are incomplete, not final.</b>{' '}
              {data.lastTs && data.tailGapSeconds > data.thresholdSeconds && (
                <>Last recorded event in this range was {fmtDateTime(data.lastTs)}, {fmtDuration(data.tailGapSeconds)} before the window closes. </>
              )}
              {data.firstTs && data.headGapSeconds > data.thresholdSeconds && (
                <>First recorded event was {fmtDateTime(data.firstTs)}, {fmtDuration(data.headGapSeconds)} after the window opens. </>
              )}
              Planned time has been capped to the actual observed data span, so this gap isn't counted as downtime — but it means the shift or day
              likely isn't over yet, or data hasn't synced past this point.
            </div>
          )}
          <div className="oee-headline">
            <div>
              <div className="oee-label">Estimated OEE</div>
              <div className={`oee-big ${oeeClass(data.oeePct)}`}>{data.oeePct}%</div>
              <div className="oee-badge">estimated, not certified</div>
            </div>
            <div className="oee-formula">
              <div className="oee-term">
                <span className="t-val">{data.availabilityPct}%</span>
                <span className="t-label">Availability</span>
              </div>
              <span className="op">×</span>
              <div className="oee-term">
                <span className="t-val">{data.performancePct}%</span>
                <span className="t-label">Performance</span>
              </div>
              <span className="op">×</span>
              <div className="oee-term">
                <span className="t-val">{data.qualityPct}%</span>
                <span className="t-label">Quality</span>
              </div>
              <span className="op">=</span>
              <div className="oee-term">
                <span className="t-val">{data.oeePct}%</span>
                <span className="t-label">OEE</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2>What went into this number</h2>
            <div className="stat-row">
              <Stat label="Planned time" val={fmtDuration(data.plannedSeconds)} />
              <Stat label="Downtime" val={fmtDuration(data.downSeconds)} />
              <Stat label="Run time" val={fmtDuration(data.runSeconds)} />
              <Stat label="Stoppages" val={fmtInt(data.stoppageCount)} />
            </div>
            <div className="stat-row">
              <Stat label="Produced" val={fmtInt(data.producedCount)} />
              <Stat label="Rejected" val={fmtInt(data.rejectedCount)} />
              <Stat
                label="Ideal cycle time"
                val={`${data.idealCycleSeconds}`}
                u={`s/cone (${data.idealCycleSource})`}
                accent={data.idealCycleSource === 'inferred'}
              />
            </div>
            <div className="oee-note">
              Availability = Run time ÷ Planned time. Performance = (Ideal cycle × Produced) ÷ Run time — ideal cycle is{' '}
              {data.idealCycleSource === 'inferred'
                ? 'inferred from the best-observed hourly throughput rate (95th percentile), since no cycle-time spec exists yet.'
                : 'the manual override you entered above.'}{' '}
              Quality = Produced ÷ (Produced + Rejected), matching the reject-rate convention used on the Dashboard.
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------- Shift Analysis (Q7) ---------------- */

function ShiftView({ range, onMeta }: { range: { min: string | null; max: string | null }; onMeta: (m: Meta) => void }) {
  const [data, setData] = useState<ShiftAnalysisData | null>(null);
  const [basis, setBasis] = useState<'corrected' | 'legacy'>('corrected');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // default to the full data window — the shift-mismatch story is systemic,
  // so the whole range is the useful default; narrow it to inspect a period.
  useEffect(() => {
    if (range.min && range.max && !from && !to) {
      setFrom(range.min);
      setTo(range.max);
    }
  }, [range.min, range.max, from, to]);

  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    setLoading(true);
    getShiftAnalysis(from, to)
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        onMeta(r.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to, onMeta]);

  // grow-in retriggers on data load AND whenever the basis toggle switches
  const revealed = useRevealOnData(data ? `${basis}:${JSON.stringify(data.corrected)}` : null);

  if (error) return <div className="error-card"><b>Couldn't load shift analysis.</b> {error}</div>;
  if (loading || !data) return <div className="tile skeleton" style={{ height: 220 }} />;

  const byShift = (arr: { shift: string; cones: number }[]) =>
    new Map(arr.map((r) => [r.shift, r.cones]));
  const corr = byShift(data.corrected);
  const leg = byShift(data.legacy);
  const shifts = ['morning', 'evening', 'night'];
  const active = basis === 'corrected' ? corr : leg;
  const max = Math.max(1, ...shifts.map((s) => active.get(s) ?? 0));

  return (
    <>
      <div className="callout">
        <div className="big">
          <span className="accent">{fmtInt(data.mismatch.differing)}</span> of {fmtInt(data.mismatch.total)} cones
          {' '}(<span className="accent">{data.mismatch.pct}%</span>) fall in a different shift once corrected.
        </div>
        <p>
          IFL's existing system stamps each cone's shift from the time the record was <em>saved</em> to the database,
          not when it was produced (a ~3.8h lag). SMS recomputes the shift from the real production time. Below,
          the same cones are counted both ways — toggle to compare.
        </p>
      </div>

      <div className="filters">
        <div className="field">
          <label>From</label>
          <input type="date" value={from} min={range.min ?? undefined} max={range.max ?? undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input type="date" value={to} min={range.min ?? undefined} max={range.max ?? undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field">
          <label>Shift basis</label>
          <Segmented
            value={basis}
            onChange={setBasis}
            options={[
              { key: 'corrected', label: 'Corrected (SMS)' },
              { key: 'legacy', label: 'Legacy (existing)' },
            ]}
          />
        </div>
      </div>

      <div className="panel">
        <h2>Cones per shift — corrected vs legacy</h2>
        <div className="hint">{from === to ? from : `${from} to ${to}`} ({fmtInt(data.mismatch.total)} cones). Bars show the selected basis.</div>
        <div className="bars" style={{ marginBottom: 22 }}>
          {shifts.map((s) => {
            const v = active.get(s) ?? 0;
            const w = revealed ? (100 * v) / max : 0;
            return (
              <div className="bar-row" key={s}>
                <span className="name">{s}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${w}%` }} />
                </span>
                <span className="val">{fmtInt(v)}</span>
              </div>
            );
          })}
        </div>

        <div className="table-scroll">
        <table className="compare">
          <thead>
            <tr>
              <th className="name">Shift</th>
              <th className={basis === 'corrected' ? 'col-active' : 'col-idle'}>Corrected</th>
              <th className={basis === 'legacy' ? 'col-active' : 'col-idle'}>Legacy</th>
              <th>Δ</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => {
              const c = corr.get(s) ?? 0;
              const l = leg.get(s) ?? 0;
              const d = c - l;
              return (
                <tr key={s}>
                  <td className="name">{s}</td>
                  <td className={basis === 'corrected' ? 'col-active' : 'col-idle'}>{fmtInt(c)}</td>
                  <td className={basis === 'legacy' ? 'col-active' : 'col-idle'}>{fmtInt(l)}</td>
                  <td className={`delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>
                    {d > 0 ? '+' : ''}{fmtInt(d)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}

/* ---------------- Reject Analysis (Q10) ---------------- */

function RejectView({ onMeta, rank }: { onMeta: (m: Meta) => void; rank: number }) {
  const canEdit = rank >= 3; // manager+
  const [data, setData] = useState<RejectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRejects()
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        onMeta(r.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [onMeta, reloadKey]);

  const revealed = useRevealOnData(data ? data.reasons.map((r) => `${r.tubeCode}:${r.materialCode}:${r.count}`).join('|') : null);

  if (error) return <div className="error-card"><b>Couldn't load reject analysis.</b> {error}</div>;
  if (loading || !data) return <div className="tile skeleton" style={{ height: 260 }} />;

  const labelled = data.reasons.filter((r) => r.label).length;
  const max = Math.max(1, ...data.reasons.map((r) => r.count));

  return (
    <>
      <div className="callout">
        <div className="big">
          <span className="accent">{fmtInt(data.total)}</span> rejected cones across{' '}
          <span className="accent">{data.reasons.length}</span> reason codes.
        </div>
        <p>
          The line records two numeric inspection codes per reject, but their meaning isn't in the database (Q10).
          Counts and the Pareto below are correct now — <b>enter a label against any code and it applies to every
          matching reject, past and future.</b> {labelled} of {data.reasons.length} labelled so far.
        </p>
      </div>

      <div className="panel">
        <h2>Reject reasons — Pareto</h2>
        <div className="hint">Ordered by frequency. Edit a label to record what a code means.</div>
        <div className="pareto">
          {data.reasons.map((r) => (
            <ParetoRow key={`${r.rejectType}-${r.tubeCode}-${r.materialCode}`} r={r} max={max} revealed={revealed} canEdit={canEdit} onSaved={() => setReloadKey((k) => k + 1)} />
          ))}
        </div>
      </div>
    </>
  );
}

function ParetoRow({
  r,
  max,
  revealed,
  canEdit,
  onSaved,
}: {
  r: RejectReason;
  max: number;
  revealed: boolean;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState(r.label ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = (r.label ?? '') !== label;

  const save = async () => {
    if (r.rejectCodeId == null) return;
    setSaving(true);
    try {
      await setRejectLabel(r.rejectCodeId, label.trim() || null);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pareto-row">
      <div className="reason">
        {canEdit ? (
          <input
            value={label}
            placeholder={r.displayLabel}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && dirty && save()}
          />
        ) : (
          <span className="lbl">{r.displayLabel}</span>
        )}
        <span className="code">
          {r.rejectType} · tube {r.tubeCode ?? '—'} / mat {r.materialCode ?? '—'}
        </span>
        {canEdit && dirty && (
          <button className="savebtn" onClick={save} disabled={saving}>
            {saving ? 'saving…' : 'save label'}
          </button>
        )}
      </div>
      <div className="pareto-track">
        <div className="pareto-fill" style={{ width: `${(100 * r.count) / max}%` }} />
      </div>
      <div className="nums">
        <div>
          <span className="cnt">{fmtInt(r.count)}</span>
          <span className="pc">{r.pct}%</span>
        </div>
        <div className="cum">cum {r.cumulativePct}%</div>
      </div>
    </div>
  );
}

/* ---------------- Weight consistency (Q4/Q5) ---------------- */

function WeightView({ onMeta }: { onMeta: (m: Meta) => void }) {
  const [basis, setBasis] = useState<Basis>('as_recorded');
  const [data, setData] = useState<WeightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getWeights(basis)
      .then((r) => {
        if (cancelled) return;
        setData(r.data);
        onMeta(r.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [basis, onMeta]);

  if (error) return <div className="error-card"><b>Couldn't load weight analysis.</b> {error}</div>;

  return (
    <>
      <div className="filters">
        <div className="field">
          <label>Weight basis (Q4 / Q5)</label>
          <Segmented
            value={basis}
            onChange={setBasis}
            options={(['as_recorded', 'gross', 'net'] as Basis[]).map((b) => ({
              key: b,
              label: b === 'as_recorded' ? 'As recorded' : b[0]!.toUpperCase() + b.slice(1),
            }))}
          />
        </div>
      </div>

      {loading || !data ? (
        <div className="tile skeleton" style={{ height: 280 }} />
      ) : (
        <>
          {data.cone.giveawayPerConeG != null && (
            <div className="callout">
              <div className="big">
                Avg cone <span className="accent">{data.cone.avg} g</span>
                {' · '}
                {data.cone.giveawayPerConeG >= 0 ? 'overfill' : 'underfill'} vs {data.cone.nominalSetpointG} g nominal:{' '}
                <span className="accent">
                  {data.cone.giveawayPerConeG > 0 ? '+' : ''}
                  {data.cone.giveawayPerConeG} g/cone
                </span>
              </div>
              <p>{data.note} {data.cone.giveawayTotalKg != null && <>Across {fmtInt(data.cone.count)} cones ≈ <b>{data.cone.giveawayTotalKg} kg</b> vs nominal.</>}</p>
            </div>
          )}

          <WeightPanel title="Cone weight distribution" stats={data.cone} suffix="g" />
          <div style={{ height: 16 }} />
          <WeightPanel title="Sack weight distribution" stats={data.sack} suffix="kg" />
        </>
      )}
    </>
  );
}

function WeightPanel({ title, stats, suffix }: { title: string; stats: WeightStats; suffix: string }) {
  const revealed = useRevealOnData(stats.histogram.map((b) => `${b.bucket}:${b.count}`).join('|'));
  const max = Math.max(1, ...stats.histogram.map((b) => b.count));
  const first = stats.histogram[0]?.bucket;
  const last = stats.histogram[stats.histogram.length - 1];
  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="hint">In-range values only; outliers listed separately.</div>
      <div className="stat-row">
        <Stat label="Count" val={fmtInt(stats.count)} />
        <Stat label="Average" val={`${stats.avg}`} u={suffix} accent />
        <Stat label="Min" val={`${stats.min}`} u={suffix} />
        <Stat label="Max" val={`${stats.max}`} u={suffix} />
        <Stat label="Std dev" val={`${stats.stdev}`} u={suffix} />
      </div>
      <div className="histo">
        {stats.histogram.map((b) => (
          <div key={b.bucket} className="hbar" style={{ height: `${revealed ? (100 * b.count) / max : 0}%` }}>
            <span className="tip">
              {b.bucket}–{b.bucket + stats.bucketSize} {suffix}: {fmtInt(b.count)}
            </span>
          </div>
        ))}
      </div>
      <div className="histo-axis">
        <span>{first} {suffix}</span>
        <span>{last ? last.bucket + stats.bucketSize : ''} {suffix}</span>
      </div>
      {stats.outliers.length > 0 && (
        <div className="outliers">
          <div className="hint" style={{ marginTop: 16 }}>
            {stats.outliers.length} anomalous reading{stats.outliers.length > 1 ? 's' : ''} (excluded from stats)
          </div>
          {stats.outliers.map((o, i) => (
            <div className="o-item" key={i}>
              <span className="w">{o.weight} {suffix}</span>
              <span className="meta">
                {o.shiftDate ?? '—'} · row #{o.sourceRowId ?? '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, val, u, accent }: { label: string; val: string; u?: string; accent?: boolean }) {
  return (
    <div className={`stat${accent ? ' accent' : ''}`}>
      <span className="s-label">{label}</span>
      <span className="s-val">
        {val}
        {u && <span className="u">{u}</span>}
      </span>
    </div>
  );
}

/* ---------------- Current Product (Q1) ---------------- */

function CurrentProductBar({ rank }: { rank: number }) {
  const [current, setCurrent] = useState<TimelineEntry | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [sel, setSel] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const canSet = rank >= 2; // supervisor+

  const load = () => {
    getCurrentProduct().then((r) => setCurrent(r.current)).catch(() => {});
  };
  useEffect(() => {
    load();
    getProducts().then((r) => setProducts(r.products)).catch(() => {});
  }, []);

  const apply = async () => {
    if (sel === '') return;
    setSaving(true);
    try {
      const r = await setCurrentProduct(Number(sel));
      setCurrent(r.current);
      setSel('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cpbar">
      <div className="cp-info">
        <span className="lab">Current product</span>
        {current ? (
          <>
            <span className="val">{current.productLabel}</span>
            <span className="meta">
              since {new Date(current.effectiveFrom).toLocaleString()} · set by {current.changedBy ?? '—'}
            </span>
          </>
        ) : (
          <span className="val none">Not set — production is unattributed (Q1)</span>
        )}
      </div>
      {canSet && (
        <div className="cp-set">
          <select value={sel} onChange={(e) => setSel(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Change product…</option>
            {products.map((p) => (
              <option key={p.productId} value={p.productId}>
                {p.description || p.lotCode || `Product ${p.productId}`}
                {p.setpointG ? ` (${p.setpointG}g)` : ''}
              </option>
            ))}
          </select>
          <button disabled={sel === '' || saving} onClick={apply}>
            {saving ? 'setting…' : 'Set'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Admin (admin only) ---------------- */

function AdminView() {
  return (
    <div className="admin-grid">
      <UsersPanel />
      <StationsPanel />
      <RulesPanel />
    </div>
  );
}

function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [nu, setNu] = useState({ username: '', password: '', role: 'operator', displayName: '' });
  const [err, setErr] = useState<string | null>(null);
  const load = () => adminListUsers().then((r) => setUsers(r.users)).catch((e) => setErr(String(e.message)));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setErr(null);
    try {
      await adminCreateUser(nu);
      setNu({ username: '', password: '', role: 'operator', displayName: '' });
      load();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="panel">
      <h2>Users</h2>
      <div className="hint">Create accounts and manage roles. Passwords are argon2-hashed — IFL's plaintext Users table is never used.</div>
      <div className="table-scroll">
      <table className="atable">
        <thead><tr><th>User</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.userId}>
              <td>{u.displayName ?? u.username} <span style={{ color: 'var(--graphite-dim)' }}>@{u.username}</span></td>
              <td>
                <select value={u.role} onChange={(e) => adminUpdateUser(u.userId, { role: e.target.value }).then(load)}>
                  {['operator', 'supervisor', 'manager', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td><span className={`pill ${u.active ? 'on' : 'off'}`}>{u.active ? 'active' : 'disabled'}</span></td>
              <td>
                <button className="abtn" onClick={() => adminUpdateUser(u.userId, { active: !u.active }).then(load)}>
                  {u.active ? 'Disable' : 'Enable'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div className="inline-form">
        <input placeholder="username" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
        <input placeholder="display name" value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} />
        <input placeholder="password (min 6)" type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
        <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
          {['operator', 'supervisor', 'manager', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className="abtn primary" disabled={!nu.username || nu.password.length < 6} onClick={create}>Create user</button>
      </div>
      {err && <div className="err" style={{ color: 'var(--alert)', marginTop: 8 }}>{err}</div>}
    </div>
  );
}

function StationsPanel() {
  const [rows, setRows] = useState<StationRow[]>([]);
  const [edited, setEdited] = useState<Record<number, StationRow>>({});
  const load = () => adminListStations().then((r) => setRows(r.stations));
  useEffect(() => { load(); }, []);
  const val = (s: StationRow) => edited[s.stationId] ?? s;
  const change = (id: number, patch: Partial<StationRow>) =>
    setEdited((e) => ({ ...e, [id]: { ...(e[id] ?? rows.find((r) => r.stationId === id)!), ...patch } }));
  const save = async (s: StationRow) => {
    const v = val(s);
    await adminSetStation(s.stationId, { name: v.name, machine: v.machine, description: v.description });
    setEdited((e) => { const n = { ...e }; delete n[s.stationId]; return n; });
    load();
  };

  return (
    <div className="panel">
      <h2>Station labels <span style={{ color: 'var(--graphite-dim)', fontWeight: 400, fontSize: 12 }}>(Q11)</span></h2>
      <div className="hint">Name the 14 source/lifter stations so station-wise reports read meaningfully.</div>
      <div className="table-scroll">
      <table className="atable">
        <thead><tr><th>#</th><th>Name</th><th>Machine</th><th>Description</th><th></th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.stationId}>
              <td>{s.stationId}</td>
              <td><input value={val(s).name ?? ''} placeholder="—" onChange={(e) => change(s.stationId, { name: e.target.value })} /></td>
              <td><input value={val(s).machine ?? ''} placeholder="—" onChange={(e) => change(s.stationId, { machine: e.target.value })} /></td>
              <td><input value={val(s).description ?? ''} placeholder="—" onChange={(e) => change(s.stationId, { description: e.target.value })} /></td>
              <td>{edited[s.stationId] && <button className="abtn primary" onClick={() => save(s)}>Save</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function RulesPanel() {
  const [rules, setRules] = useState<Rules | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = () => adminGetRules().then(setRules);
  useEffect(() => { load(); }, []);
  if (!rules) return <div className="panel"><h2>Interpretation rules</h2><div className="hint">Loading…</div></div>;

  const setWeight = async (basis: string) => {
    await adminSetWeightRule({ basis, coneTubeWeightG: rules.weight?.coneTubeWeightG ?? 70, sackTareKg: rules.weight?.sackTareKg ?? 0.5, reason: 'admin UI' });
    load();
  };
  const setShift = async (mode: string) => {
    const r = await adminSetShiftRule({ mode, nightBelongsTo: rules.shift?.nightBelongsTo ?? 'start_day', reason: 'admin UI' });
    setNote(r.note ?? null);
    load();
  };

  return (
    <div className="panel">
      <h2>Interpretation rules <span style={{ color: 'var(--graphite-dim)', fontWeight: 400, fontSize: 12 }}>(Q4/Q5 · Q7)</span></h2>
      <div className="hint">Versioned — each change appends a new effective rule. When IFL answers, set it here once.</div>

      <div style={{ marginTop: 14 }}>
        <div className="s-label" style={{ marginBottom: 6 }}>Weight basis (applies immediately — read-time)</div>
        <div className="segmented">
          {['as_recorded', 'gross', 'net'].map((b) => (
            <button key={b} className={rules.weight?.basis === b ? 'active' : ''} onClick={() => setWeight(b)}>
              {b === 'as_recorded' ? 'As recorded' : b[0]!.toUpperCase() + b.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="s-label" style={{ marginBottom: 6 }}>Shift basis (needs a canonical rebuild to apply to stored data)</div>
        <div className="segmented">
          {['corrected', 'legacy'].map((m) => (
            <button key={m} className={rules.shift?.mode === m ? 'active' : ''} onClick={() => setShift(m)}>
              {m[0]!.toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        {note && <div className="rule-note">⚠ {note}</div>}
      </div>
    </div>
  );
}

function MetaStrip({ meta }: { meta: Meta }) {
  return (
    <div className="meta-strip">
      <span className="chip"><b>shift basis</b> {meta.shiftMode}</span>
      <span className="chip"><b>weight basis</b> {meta.weightBasis}</span>
      <span className="chip"><b>transform</b> v{meta.transformVersion}</span>
      <span className="chip"><b>generated</b> {new Date(meta.generatedAtUtc).toLocaleTimeString()}</span>
    </div>
  );
}
