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
  getStoppagePatterns,
  getSpc,
  getRejectSpc,
  getOee,
  getOperations,
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
  type StoppagePatternData,
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
  type OperationsData,
} from './api';
import { downloadCsv, csvName, type CsvRow } from './csv';
import { fmtInt, fmtKg, ageLabel, freshnessLevel, fmtDuration, fmtHourLabel, fmtDateTime, fmtTime } from './format';

type Shift = 'all' | 'morning' | 'evening' | 'night';
const SHIFTS: Shift[] = ['all', 'morning', 'evening', 'night'];
type View = 'dashboard' | 'register' | 'performance' | 'weight' | 'shift' | 'rejects' | 'operations' | 'admin';
/**
 * Text size is an environment decision, not a design one. An operator reading a
 * wall-mounted screen across the shop floor and a supervisor at a desk need
 * genuinely different sizes, and plant staff skew older — so rather than us
 * guessing a single value and fielding "make it bigger" every review, the user
 * sets it. It scales the ENTIRE interface (one CSS variable feeding a rem
 * scale), so layout proportions hold instead of text outgrowing its boxes.
 *
 * Stored per browser, not per account: the right size follows the screen you
 * are sitting at, and the same operator at a different station wants different
 * settings.
 */
const UI_SCALES = [
  { key: '1', label: 'Normal', px: 18 },
  { key: '1.125', label: 'Large', px: 20 },
  { key: '1.25', label: 'Extra large', px: 22 },
] as const;

function DisplayScale() {
  const [scale, setScale] = useState<string>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('sms.uiScale') : null;
    return UI_SCALES.some((s) => s.key === saved) ? saved! : '1';
  });

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', scale);
    try {
      localStorage.setItem('sms.uiScale', scale);
    } catch {
      /* private mode — the setting just won't persist */
    }
  }, [scale]);

  return (
    <div className="uiscale" role="group" aria-label="Text size">
      {UI_SCALES.map((s) => (
        <button
          key={s.key}
          type="button"
          className={scale === s.key ? 'active' : ''}
          style={{ fontSize: `${11 + Number(s.key) * 3}px` }}
          onClick={() => setScale(s.key)}
          aria-pressed={scale === s.key}
          title={`Text size: ${s.label}`}
        >
          A<span className="sr-only"> — {s.label}</span>
        </button>
      ))}
    </div>
  );
}

const VIEW_LABEL: Record<View, string> = {
  dashboard: 'Overview',
  register: 'Register',
  performance: 'Performance',
  weight: 'Weight',
  shift: 'Shifts',
  rejects: 'Rejects',
  operations: 'Operations',
  admin: 'Admin',
};

/** The register detail page is a real URL, not modal state — permalink-able,
 * survives refresh, and cooperates with browser back/forward. No router
 * dependency: the native History API is enough for one addressable sub-page. */
interface Route {
  view: View;
  detailType?: RegisterType;
  detailId?: string;
}

function parseRoute(): Route {
  if (typeof window === 'undefined') return { view: 'dashboard' };
  const p = new URLSearchParams(window.location.search);
  const v = p.get('v');
  const view: View = (['dashboard', 'register', 'performance', 'weight', 'shift', 'rejects', 'operations', 'admin'] as const).includes(v as View)
    ? (v as View)
    : 'dashboard';
  const dtype = p.get('dtype');
  const did = p.get('did');
  return {
    view,
    // 'reject' was missing here, so a reject detail URL only worked when reached
    // by CLICK (which sets route state directly) and silently fell back to the
    // cone list on a cold load — i.e. it was not actually a permalink, which is
    // the one thing a permalink has to be. Keep this list in step with
    // RegisterType in api.ts.
    detailType: dtype === 'cone' || dtype === 'sack' || dtype === 'reject' ? dtype : undefined,
    detailId: did ?? undefined,
  };
}

function routeSearch(r: Route): string {
  const p = new URLSearchParams();
  p.set('v', r.view);
  if (r.detailType && r.detailId) {
    p.set('dtype', r.detailType);
    p.set('did', r.detailId);
  }
  return `?${p.toString()}`;
}

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
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [range, setRange] = useState<{ min: string | null; max: string | null }>({ min: null, max: null });
  const [rangeErr, setRangeErr] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<Meta | null>(null);
  const [registerSeed, setRegisterSeed] = useState<RegisterSeed | null>(null);
  const [navContext, setNavContext] = useState<NavContext | null>(null);
  const rank = ROLE_RANK[user.role] ?? 1;
  const view = route.view;

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (patch: Partial<Route>) => {
    const next: Route = { ...route, ...patch };
    window.history.pushState(null, '', routeSearch(next));
    setRoute(next);
  };

  // kept as `setView` — every existing call site (nav buttons, deep-link
  // callbacks) already calls it by that name; only its implementation
  // changed, from a raw dispatch to a real URL navigation.
  // Picking a view from the nav is a deliberate move — clear any "you came
  // here from a finding" context so it can't go stale on an unrelated page.
  const setView = (v: View) => {
    setNavContext(null);
    navigate({ view: v, detailType: undefined, detailId: undefined });
  };

  /** Follow a finding to the page that explains it, carrying the reason. */
  const followException = (e: Exception) => {
    setNavContext({
      fromView: view,
      fromLabel: VIEW_LABEL[view],
      title: e.title,
      detail: e.because,
      sub: e.sub,
    });
    navigate({ view: e.view, detailType: undefined, detailId: undefined });
  };

  const openRegisterDetail = (detailType: RegisterType, detailId: string | number) =>
    navigate({ view: 'register', detailType, detailId: String(detailId) });
  const closeRegisterDetail = () => navigate({ view: 'register', detailType: undefined, detailId: undefined });

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
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="brand">
          <span className="mark">
            SMS<span className="dot">.</span>
          </span>
          <span className="sub">TP1 Line 3 · Unit 2</span>
          <nav className="segmented nav" aria-label="Views">
            <button aria-current={view === 'dashboard' ? 'page' : undefined} className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}>Overview</button>
            <button aria-current={view === 'register' ? 'page' : undefined} className={view === 'register' ? 'active' : ''} onClick={() => { setRegisterSeed(null); setView('register'); }}>Register</button>
            <button aria-current={view === 'performance' ? 'page' : undefined} className={view === 'performance' ? 'active' : ''} onClick={() => setView('performance')}>Performance</button>
            <button aria-current={view === 'weight' ? 'page' : undefined} className={view === 'weight' ? 'active' : ''} onClick={() => setView('weight')}>Weight</button>
            <button aria-current={view === 'rejects' ? 'page' : undefined} className={view === 'rejects' ? 'active' : ''} onClick={() => setView('rejects')}>Rejects</button>
            <button aria-current={view === 'shift' ? 'page' : undefined} className={view === 'shift' ? 'active' : ''} onClick={() => setView('shift')}>Shifts</button>
            <button aria-current={view === 'operations' ? 'page' : undefined} className={view === 'operations' ? 'active' : ''} onClick={() => setView('operations')}>Operations</button>
            {rank >= 4 && (
              <button aria-current={view === 'admin' ? 'page' : undefined} className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>Admin</button>
            )}
          </nav>
        </div>
        <div className="topbar-tools">
          <DisplayScale />
          {freshness && (
            <button
              type="button"
              className="freshness as-link"
              title={`last sync ${freshness.lastSyncUtc ?? 'never'} — open Operations`}
              onClick={() => setView('operations')}
            >
              <span className={`led ${freshnessLevel(freshness.sourceAgeSeconds)}`} />
              synced {ageLabel(freshness.sourceAgeSeconds)}
            </button>
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

      <main id="main" tabIndex={-1}>
      {/* Announces the view change to a screen reader — without it, switching
          tabs updates the page silently. */}
      <p className="sr-only" aria-live="polite">{VIEW_LABEL[view]} view</p>
      {navContext && (
        <div className="nav-context">
          <button
            type="button"
            className="nc-back"
            onClick={() => {
              const back = navContext.fromView;
              setNavContext(null);
              navigate({ view: back, detailType: undefined, detailId: undefined });
            }}
          >
            ← {navContext.fromLabel}
          </button>
          <div className="nc-body">
            <span className="nc-trail">
              {navContext.fromLabel} <span aria-hidden="true">›</span> {VIEW_LABEL[view]}
            </span>
            <span className="nc-title">Following up: {navContext.title}</span>
            {navContext.detail && <span className="nc-detail">{navContext.detail}</span>}
          </div>
          <button type="button" className="nc-dismiss" onClick={() => setNavContext(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {rangeErr ? (
        <div className="error-card" role="alert"><b>Couldn't reach the API.</b> {rangeErr}</div>
      ) : view === 'dashboard' ? (
        <DashboardView range={range} onMeta={setFreshness} rank={rank} onNavigate={followException} />
      ) : view === 'register' ? (
        <RegisterView
          range={range}
          seed={registerSeed}
          detail={route.detailType && route.detailId ? { type: route.detailType, id: route.detailId } : null}
          onOpenDetail={openRegisterDetail}
          onCloseDetail={closeRegisterDetail}
        />
      ) : view === 'performance' ? (
        <PerformanceHub range={range} onMeta={setFreshness} onInspect={navigateToRegister} initialSub={navContext?.sub} />
      ) : view === 'weight' ? (
        <WeightHub range={range} onMeta={setFreshness} onInspect={navigateToRegister} initialSub={navContext?.sub} />
      ) : view === 'shift' ? (
        <ShiftView range={range} onMeta={setFreshness} />
      ) : view === 'rejects' ? (
        <RejectsHub range={range} onMeta={setFreshness} rank={rank} initialSub={navContext?.sub} />
      ) : view === 'operations' ? (
        <OperationsView onMeta={setFreshness} />
      ) : (
        <AdminView />
      )}
      </main>
    </div>
  );
}

/* ---------------- Consolidated nav hubs (Phase 2 — 10 nav items -> 7) ----------------
 * Each hub is a thin sub-tab wrapper around two previously-separate top-level
 * pages that answered the same underlying question. No page logic changed —
 * only where it lives in the nav. */

function PerformanceHub({
  range,
  onMeta,
  onInspect,
  initialSub,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  onInspect: (seed: RegisterSeed) => void;
  initialSub?: string;
}) {
  const [sub, setSub] = useState<'oee' | 'downtime' | 'patterns'>(
    (initialSub as 'oee' | 'downtime' | 'patterns') ?? 'oee',
  );
  return (
    <>
      <div className="filters" style={{ marginBottom: 6 }}>
        <Segmented
          value={sub}
          onChange={setSub}
          options={[
            { key: 'oee', label: 'OEE' },
            { key: 'downtime', label: 'Downtime & Throughput' },
            { key: 'patterns', label: 'Stoppage patterns' },
          ]}
        />
      </div>
      {sub === 'oee' ? (
        <OeeView range={range} onMeta={onMeta} />
      ) : sub === 'downtime' ? (
        <DowntimeView range={range} onMeta={onMeta} onInspect={onInspect} />
      ) : (
        <StoppagePatternView range={range} onMeta={onMeta} />
      )}
    </>
  );
}

function WeightHub({
  range,
  onMeta,
  onInspect,
  initialSub,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  onInspect: (seed: RegisterSeed) => void;
  initialSub?: string;
}) {
  const [sub, setSub] = useState<'spc' | 'distribution'>((initialSub as 'spc' | 'distribution') ?? 'spc');
  return (
    <>
      <div className="filters" style={{ marginBottom: 6 }}>
        <Segmented
          value={sub}
          onChange={setSub}
          options={[
            { key: 'spc', label: 'Process control' },
            { key: 'distribution', label: 'Distribution' },
          ]}
        />
      </div>
      {sub === 'spc' ? (
        <SpcView range={range} onMeta={onMeta} onInspect={onInspect} />
      ) : (
        <WeightView range={range} onMeta={onMeta} />
      )}
    </>
  );
}

function RejectsHub({
  range,
  onMeta,
  rank,
  initialSub,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  rank: number;
  initialSub?: string;
}) {
  const [sub, setSub] = useState<'pareto' | 'trend' | 'station'>(
    (initialSub as 'pareto' | 'trend' | 'station') ?? 'pareto',
  );
  return (
    <>
      <div className="filters" style={{ marginBottom: 6 }}>
        <Segmented
          value={sub}
          onChange={setSub}
          options={[
            { key: 'pareto', label: 'Reasons' },
            { key: 'trend', label: 'Trend' },
            { key: 'station', label: 'By station' },
          ]}
        />
      </div>
      {sub === 'pareto' ? (
        <RejectView onMeta={onMeta} rank={rank} />
      ) : sub === 'trend' ? (
        <RejectSpcView range={range} onMeta={onMeta} />
      ) : (
        <RejectStationView range={range} onMeta={onMeta} />
      )}
    </>
  );
}

/** Where rejects happen, not just what or when. Reuses the same per-station
 * ANOM methodology already built for weight bias (pooled rate ± 3σ/√n for
 * statistical significance, plus a practical-magnitude threshold so the
 * flagged set is the few worth a maintenance look, not everything that's
 * merely measurable) — computed entirely from /api/production's existing
 * groupBy=station rows, no new backend endpoint. Cross-references the
 * weight-bias stations already surfaced in Weight SPC: a station that is
 * BOTH light/heavy AND rejecting more is the genuinely actionable finding. */
function RejectStationView({
  range,
  onMeta,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<ProductionRow[]>([]);
  const [weightStations, setWeightStations] = useState<StationStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // default to the full available window — same rationale as Trend: a
    // station's true bias only separates from noise with enough volume.
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
    Promise.all([
      getProduction({ from, to, groupBy: 'station' }),
      getSpc({ type: 'cone', from, to }),
    ])
      .then(([p, sp]) => {
        if (cancelled) return;
        setRows(p.data.rows);
        setWeightStations(sp.data.stations);
        onMeta(p.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to, onMeta]);

  const analysis = useMemo(() => {
    const stationRows = rows.filter((r) => r.group !== 'total' && Number(r.group) >= 1);
    const totalCones = stationRows.reduce((s, r) => s + r.cones, 0);
    const totalRejects = stationRows.reduce((s, r) => s + r.rejectedCones, 0);
    const pooledRate = totalCones + totalRejects > 0 ? totalRejects / (totalCones + totalRejects) : 0;
    // practical threshold: at least 0.5 pt, or 25% relative to baseline —
    // mirrors the weight-bias "statistically real but too small to matter"
    // distinction so a handful of stations get flagged, not all fourteen.
    const practicalPct = Math.max(0.5, pooledRate * 100 * 0.25);
    const stations: StationStat[] = stationRows.map((r) => {
      const n = r.cones + r.rejectedCones;
      const rate = n > 0 ? r.rejectedCones / n : 0;
      const se = n > 0 ? Math.sqrt((pooledRate * (1 - pooledRate)) / n) : 0;
      const deltaPct = (rate - pooledRate) * 100;
      const distinguishable = se > 0 && Math.abs(rate - pooledRate) > 3 * se;
      return {
        station: Number(r.group),
        n,
        mean: round1(rate * 100),
        stdev: null,
        delta: round1(deltaPct),
        distinguishable,
        // unlike weight (off-target in EITHER direction is a problem), reject
        // rate has a direction: only "rejects meaningfully MORE than the
        // line" is a concern worth flagging red — a station rejecting less
        // is a good outcome, not an exception.
        flagged: distinguishable && deltaPct > 0 && deltaPct >= practicalPct,
      };
    });
    const flagged = stations.filter((s) => s.flagged).sort((a, b) => b.delta - a.delta);
    const weightFlaggedNums = new Set(weightStations.filter((s) => s.flagged).map((s) => s.station));
    const crossRef = flagged.filter((s) => weightFlaggedNums.has(s.station));
    return { stations, pooledRatePct: round1(pooledRate * 100), practicalPct: round1(practicalPct), flagged, crossRef };
  }, [rows, weightStations]);

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
      </div>

      {error ? (
        <div className="error-card"><b>Couldn't load per-station rejects.</b> {error}</div>
      ) : loading ? (
        <div className="tile skeleton" style={{ height: 320 }} />
      ) : (
        <>
          {analysis.crossRef.length > 0 && (
            <div className="callout" style={{ borderLeftColor: 'var(--alert)' }}>
              <div className="big">
                <span className="accent" style={{ color: 'var(--alert)' }}>{analysis.crossRef.length}</span> station
                {analysis.crossRef.length === 1 ? '' : 's'} both off-target on weight <b>and</b> rejecting more
              </div>
              <p>
                {analysis.crossRef.map((s) => `Station ${s.station}`).join(', ')} — the same station showing up in both
                the weight-bias chart and the reject-rate chart is the actionable pattern: it's not measurement noise, it's
                that station's process.
              </p>
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <h2>Reject rate by station</h2>
              <span>
                <span className="sub">{from === to ? from : `${from} to ${to}`}</span>
                <ExportCsv
                  name={csvName('reject-rate-by-station', from, to)}
                  headers={['station', 'n_total', 'reject_rate_pct', 'delta_vs_line_pt', 'statistically_distinguishable', 'flagged_actionable']}
                  rows={() => analysis.stations.map((st) => [st.station, st.n, st.mean, st.delta, st.distinguishable, st.flagged])}
                />
              </span>
            </div>
            <div className="hint">
              Line baseline <b>{analysis.pooledRatePct}%</b>. Dashed lines are the ±{analysis.practicalPct}pt practical
              threshold — {analysis.flagged.length > 0 ? (
                <>only <b>{analysis.flagged.length}</b> station{analysis.flagged.length === 1 ? '' : 's'} cross it and reject meaningfully more than the line.</>
              ) : (
                <>no station rejects meaningfully more than the line.</>
              )}
            </div>
            <ResizableChart initialHeight={300}>
              {(h) => <StationChart stations={analysis.stations} grandMean={analysis.pooledRatePct} threshold={analysis.practicalPct} unit="%" height={h} />}
            </ResizableChart>
          </div>
        </>
      )}
    </>
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
            <input
              id="login-user"
              aria-label="Username"
              autoComplete="username"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <input
              id="login-pass"
              type="password"
              aria-label="Password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={busy || !username || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {err && <div className="err" role="alert">{err}</div>}
        </form>
      </div>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */

/** A single derived finding surfaced on Overview — the "what's wrong right
 * now" feed. Built entirely client-side from data every hub page already
 * exposes (SPC stations/subgroups, downtime, reject episodes) — no new
 * backend endpoint, just synthesis across existing, already-verified ones. */
interface Exception {
  severity: 'fault' | 'warn' | 'info';
  title: string;
  message: ReactNode;
  view: View;
  /** Which sub-tab of the destination hub actually shows this finding. Without
   * it a link lands on the hub's default tab, which is right only by luck. */
  sub?: string;
  /** Plain-language restatement of what the user clicked, shown on arrival. */
  because?: string;
}

/** Why the user is on this page, when they didn't pick it from the nav.
 * Jumping between views used to carry nothing: you clicked "2 stations
 * off-target" and landed on a generic Weight page with no statement of what
 * you were meant to be looking at, or any way back. */
interface NavContext {
  fromView: View;
  fromLabel: string;
  title: string;
  detail?: string;
  sub?: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Measure a container's inner width so a chart can set its viewBox to the real
 * pixel width and scale 1:1.
 *
 * Every chart drew into a fixed 1000-unit viewBox and then stretched it with
 *. That scales x and y by different factors —
 * measured at 0.82 vs 1.0 on a 1280px layout — so all axis text, tick labels
 * and data dots were squashed horizontally by ~18%, on every chart in the app.
 * Matching the viewBox to the measured width keeps both axes at scale 1.
 */
function useMeasuredWidth(fallback = 1000): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      if (next > 0) setW(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * Chart tooltip geometry, derived from the text instead of hardcoded.
 *
 * Every tooltip used to carry a fixed pixel width (190, 200, 172 ...) and 15px
 * line spacing, both hand-tuned for ~11px text. Raising the type scale to 16px
 * made the content wider and taller than its box, so labels spilled outside the
 * dark panel and got clipped at the chart edge. Sizing from the content means
 * that can't recur the next time the scale moves — including when a user picks
 * Large or Extra large, which multiplies the font at runtime.
 *
 * Tooltip text is monospace, so width is predictable: Cascadia Mono advances
 * ~0.6em per character. We over-estimate slightly rather than risk clipping.
 */
const TIP_PAD = 11;
const TIP_CHAR_W = 0.62; // em, monospace advance (rounded up for safety)
const TIP_LINE = 1.42; // line height in em

function tipMetrics(lines: string[], fontPx: number) {
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const lineH = Math.ceil(fontPx * TIP_LINE);
  return {
    w: Math.ceil(longest * fontPx * TIP_CHAR_W) + TIP_PAD * 2,
    h: TIP_PAD * 2 + lines.length * lineH - Math.round(lineH - fontPx),
    lineH,
    baseline: (i: number) => TIP_PAD + fontPx + i * lineH,
  };
}

/** Resolved --fs-xs in px, so tooltips track the user's Display size setting. */
function useTipFontPx(): number {
  const [px, setPx] = useState(16);
  useEffect(() => {
    const read = () => {
      const root = getComputedStyle(document.documentElement);
      const rem = parseFloat(root.fontSize) || 16;
      const xs = root.getPropertyValue('--fs-xs').trim();
      setPx(xs.endsWith('rem') ? parseFloat(xs) * rem : parseFloat(xs) || rem);
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => mo.disconnect();
  }, []);
  return px;
}

interface TipLine {
  t: string;
  cls?: string;
}

/** A chart tooltip that fits its own content. */
function ChartTip({ x, y = 4, lines, fontPx }: { x: number; y?: number; lines: TipLine[]; fontPx: number }) {
  const m = tipMetrics(lines.map((l) => l.t), fontPx);
  return (
    <g transform={`translate(${x}, ${y})`} pointerEvents="none">
      <rect className="tooltip-bg" width={m.w} height={m.h} rx={5} />
      {lines.map((l, i) => (
        <text key={i} className={`tooltip-text ${l.cls ?? ''}`} x={TIP_PAD} y={m.baseline(i)}>
          {l.t}
        </text>
      ))}
    </g>
  );
}

/** Props that make a non-button element (a table row, mostly) behave like one
 * for keyboard users: focusable, and activated by Enter or Space. Rows are the
 * primary drill-down in this app, so leaving them mouse-only put the main
 * navigation out of reach on a plant terminal without a working mouse. */
function activatable(onActivate: () => void, label?: string) {
  return {
    tabIndex: 0,
    role: 'button' as const,
    'aria-label': label,
    onClick: onActivate,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

function computeDelta(current: number, priorValues: number[]): { pct: number; dir: 'up' | 'down' | 'flat'; text: string } | null {
  const valid = priorValues.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  const avg = valid.reduce((s, v) => s + v, 0) / valid.length;
  if (avg === 0) return null;
  const pct = ((current - avg) / avg) * 100;
  const dir: 'up' | 'down' | 'flat' = Math.abs(pct) < 2 ? 'flat' : pct > 0 ? 'up' : 'down';
  return { pct, dir, text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}% vs ${valid.length}-day avg` };
}

function DashboardView({
  range,
  onMeta,
  rank,
  onNavigate,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  rank: number;
  onNavigate: (e: Exception) => void;
}) {
  const [date, setDate] = useState<string>('');
  const [shift, setShift] = useState<Shift>('all');
  const [kpi, setKpi] = useState<Envelope<ProductionData> | null>(null);
  const [byShift, setByShift] = useState<ProductionData | null>(null);
  const [trend, setTrend] = useState<ProductionRow[]>([]);
  const [downtime, setDowntime] = useState<DowntimeData | null>(null);
  const [baselineAvailability, setBaselineAvailability] = useState<number | null>(null);
  const [spc, setSpc] = useState<SpcData | null>(null);
  const [rejectSpc, setRejectSpc] = useState<RejectSpcData | null>(null);
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
    const dayBefore = new Date(date);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const baselineTo = dayBefore.toISOString().slice(0, 10);
    Promise.all([
      getProduction({ from: date, to: date, shift: shiftParam, groupBy: 'none' }),
      getProduction({ from: date, to: date, groupBy: 'shift' }),
      getProduction({ from: trendFrom, to: date, groupBy: 'day' }),
      getDowntime(date, 120),
      baselineTo >= trendFrom ? getOee({ from: trendFrom, to: baselineTo }) : Promise.resolve(null),
      getSpc({ type: 'cone', from: date, to: date }),
      getRejectSpc(trendFrom, date, 'all', 'day'),
    ])
      .then(([k, s, t, d, base, sp, rj]) => {
        if (cancelled) return;
        setKpi(k);
        setByShift(s.data);
        setTrend(t.data.rows);
        setDowntime(d.data);
        setBaselineAvailability(base?.data.availabilityPct ?? null);
        setSpc(sp.data);
        setRejectSpc(rj.data);
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

  const priorTrend = trend.length > 1 ? trend.slice(0, -1) : [];
  const conesDelta = total ? computeDelta(total.cones, priorTrend.map((r) => r.cones)) : null;
  const sacksDelta = total?.sacks != null ? computeDelta(total.sacks, priorTrend.map((r) => r.sacks ?? 0)) : null;
  const weightDelta = total?.sackWeightKg != null ? computeDelta(total.sackWeightKg, priorTrend.map((r) => r.sackWeightKg ?? 0)) : null;
  const rejectRateDelta = useMemo(() => {
    if (!total) return null;
    const priorRates = priorTrend
      .map((r) => {
        const denom = r.cones + r.rejectedCones;
        return denom > 0 ? (100 * r.rejectedCones) / denom : NaN;
      })
      .filter((v) => Number.isFinite(v));
    return rejectRate != null ? computeDelta(rejectRate, priorRates) : null;
  }, [total, priorTrend, rejectRate]);

  const exceptions = useMemo<Exception[]>(() => {
    const out: Exception[] = [];
    if (spc && spc.stations.length > 0) {
      const flagged = spc.stations.filter((s) => s.flagged).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      if (flagged.length > 0) {
        const top = flagged[0]!;
        out.push({
          severity: 'fault',
          title: flagged.length === 1 ? `Station ${top.station} off-target` : `${flagged.length} stations off-target`,
          message: (
            <>
              Station <b>{top.station}</b> is <b>{top.delta > 0 ? '+' : ''}{top.delta}{spc.unit}</b> vs the line average — past the{' '}
              <b>±{spc.practicalThresholdG}{spc.unit}</b> action threshold.
              {flagged.length > 1 && <> {flagged.length - 1} other station{flagged.length > 2 ? 's' : ''} also flagged.</>}
            </>
          ),
          view: 'weight',
          sub: 'spc',
          because: `Station ${top.station} sits ${top.delta > 0 ? '+' : ''}${top.delta}${spc.unit} off the line average. The per-station chart below is where that shows up.`,
        });
      }
    }
    if (spc && spc.subgroups.length > 0) {
      const oocFrac = spc.xbarOutOfControl / spc.subgroups.length;
      if (spc.xbarOutOfControl >= 3 && oocFrac >= 0.15) {
        out.push({
          severity: 'warn',
          title: 'Weight mean drifted out of control',
          message: (
            <>
              <b>{spc.xbarOutOfControl} of {spc.subgroups.length}</b> {spc.bucketLabel} subgroups breached the ±3σ control band today.
            </>
          ),
          view: 'weight',
          sub: 'spc',
          because: `${spc.xbarOutOfControl} subgroups breached the control band. Look at the X-bar chart for when the mean moved.`,
        });
      }
    }
    if (downtime && baselineAvailability != null && downtime.availabilityPct != null) {
      const gap = baselineAvailability - downtime.availabilityPct;
      if (gap >= 5) {
        out.push({
          severity: gap >= 15 ? 'fault' : 'warn',
          title: 'Availability below normal',
          message: (
            <>
              <b>{downtime.availabilityPct.toFixed(1)}%</b> today vs a <b>{baselineAvailability.toFixed(1)}%</b> 6-day baseline —{' '}
              <b>{downtime.stoppageCount}</b> stoppages cost <b>{fmtDuration(downtime.totalDownSeconds)}</b>.
            </>
          ),
          view: 'performance',
          sub: 'downtime',
          because: `${downtime.stoppageCount} stoppages cost ${fmtDuration(downtime.totalDownSeconds)} today. The timeline shows when the line was down.`,
        });
      }
    }
    if (rejectSpc) {
      const activeEpisode = rejectSpc.episodes.find((e) => e.startTs.slice(0, 10) <= date && date <= e.endTs.slice(0, 10));
      if (activeEpisode) {
        const pct = activeEpisode.totalProduced > 0 ? (100 * activeEpisode.totalRejects) / activeEpisode.totalProduced : 0;
        out.push({
          severity: 'fault',
          title: `Reject burst — ${activeEpisode.bucketCount}-day run`,
          message: (
            <>
              <b>{fmtInt(activeEpisode.totalRejects)}</b> rejects of <b>{fmtInt(activeEpisode.totalProduced)}</b> produced
              (<b>{pct.toFixed(2)}%</b>) across this burst — a genuine event, not an isolated spike.
            </>
          ),
          view: 'rejects',
          sub: 'trend',
          because: `A ${activeEpisode.bucketCount}-day burst, not an isolated spike. The control chart shows the run.`,
        });
      }
    }
    const order = { fault: 0, warn: 1, info: 2 };
    return out.sort((a, b) => order[a.severity] - order[b.severity]);
  }, [spc, downtime, baselineAvailability, rejectSpc, date]);

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
        <>
          <div className="tile skeleton" style={{ height: 100, marginBottom: 22 }} />
          <div className="kpis">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="tile skeleton" />
            ))}
          </div>
        </>
      ) : (
        <>
          {downtime && <LineStatusPanel downtime={downtime} />}

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head">
              <h2>Needs attention</h2>
              <span className="sub">{exceptions.length} open</span>
            </div>
            {exceptions.length === 0 ? (
              <div className="exc-empty">✓ Nothing flagged — weight, rejects, and availability are all within normal range today.</div>
            ) : (
              <div className="exc-list">
                {exceptions.map((e, i) => (
                  <button
                    key={i}
                    type="button"
                    className="exc-item"
                    onClick={() => onNavigate(e)}
                    aria-label={`${e.severity}: ${e.title}. ${e.message}. Open ${e.view}.`}
                  >
                    <div className={`exc-sev ${e.severity}`}>{e.severity}</div>
                    <div className="exc-body">
                      <div className="exc-title">{e.title}</div>
                      <div className="exc-msg">{e.message}</div>
                    </div>
                    <div className="exc-go" aria-hidden="true">›</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="kpis" style={{ marginTop: 16 }}>
            <Tile label="Total Cones" value={total.cones} format={fmtInt}
              trend={trend.map((r) => r.cones)}
              delta={conesDelta ? { text: conesDelta.text, tone: 'neutral' } : null}
              foot={<><span className="em">{total.conesInRangePct ?? '—'}%</span> in weight range</>} />
            <Tile label="Rejected Cones" value={total.rejectedCones} format={fmtInt}
              trend={trend.map((r) => r.rejectedCones)}
              delta={rejectRateDelta ? { text: rejectRateDelta.text, tone: rejectRateDelta.dir === 'flat' ? 'neutral' : rejectRateDelta.dir === 'up' ? 'bad' : 'good' } : null}
              foot={<>reject rate <span className="em">{rejectRate?.toFixed(2)}%</span></>} />
            <Tile label="Total Sacks" value={total.sacks} format={fmtInt}
              trend={trend.map((r) => r.sacks ?? 0)}
              delta={sacksDelta ? { text: sacksDelta.text, tone: 'neutral' } : null}
              foot={total.sacks && total.cones ? <>~<span className="em">{(total.cones / total.sacks).toFixed(1)}</span> cones/sack</> : <>&nbsp;</>} />
            <Tile label="Sack Weight" value={total.sackWeightKg} format={fmtKg} unit="kg"
              trend={trend.map((r) => r.sackWeightKg ?? 0)}
              delta={weightDelta ? { text: weightDelta.text, tone: 'neutral' } : null}
              foot={<>basis <span className="em">{meta?.weightBasis}</span></>} />
          </div>
          <ShiftBreakdown data={byShift} />
          {meta && <MetaStrip meta={meta} />}
        </>
      )}
    </>
  );
}

/** The line status strip — the Overview signature element. A real 24h
 * run/stop timeline (from the same gap-detection data Downtime uses) with
 * shift boundaries marked, so "how did the line do" is a glance, not a
 * multi-page investigation. */
function LineStatusPanel({ downtime }: { downtime: DowntimeData }) {
  const [hover, setHover] = useState<number | null>(null);
  const hasData = !!(downtime.firstTs && downtime.lastTs);
  const t0 = hasData ? new Date(downtime.firstTs!).getTime() : 0;
  const t1 = hasData ? new Date(downtime.lastTs!).getTime() : 0;
  const span = Math.max(1, t1 - t0);

  // shift boundaries at 14:00 and 22:00 local-labelled wall clock, expressed
  // as a fraction of the observed [firstTs,lastTs] window for this date.
  const dayStart = hasData ? new Date(downtime.firstTs!) : null;
  const shiftFracs =
    dayStart != null
      ? [14, 22].map((h) => {
          const t = Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), dayStart.getUTCDate(), h, 0, 0);
          const tAdj = t < t0 ? t + 86_400_000 : t;
          return (tAdj - t0) / span;
        })
      : [];

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Line status — {downtime.date}</h2>
        <span className="sub">{downtime.stoppageCount} stoppages · {fmtDuration(downtime.totalDownSeconds)} down</span>
      </div>
      <div className="status-strip-wrap">
        <div className="status-strip">
          {hasData &&
            downtime.stoppages.map((s, i) => {
              const l = ((new Date(s.startTs).getTime() - t0) / span) * 100;
              const w = Math.max(0.25, (s.durationSeconds * 1000 / span) * 100);
              return (
                <div
                  key={i}
                  className={`status-seg${hover === i ? ' hot' : ''}`}
                  style={{ left: `${l}%`, width: `${w}%` }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  {/* segments can be 2px wide, so widen the hover target
                      beyond the visible bar or thin stops are unhittable */}
                  <span className="status-seg-hit" />
                </div>
              );
            })}
          {hover != null && downtime.stoppages[hover] && (() => {
            const s = downtime.stoppages[hover]!;
            const pct = ((new Date(s.startTs).getTime() - t0) / span) * 100;
            // The panel clips overflow, so a centred tooltip on a stoppage near
            // either edge gets its outer half cut off. Anchor by which third of
            // the strip the stoppage sits in instead of always centring.
            const edge = pct < 18 ? 'left' : pct > 82 ? 'right' : 'mid';
            return (
              <div
                className={`status-tip ${edge}`}
                style={edge === 'right' ? { right: `${100 - pct}%` } : { left: `${pct}%` }}
              >
                <b>{fmtDuration(s.durationSeconds)} down</b>
                <span>{fmtTime(s.startTs)} – {fmtTime(s.endTs)}</span>
                <span className="tip-rank">
                  stoppage {hover + 1} of {downtime.stoppages.length} · longest first
                </span>
              </div>
            );
          })()}
          {shiftFracs.map((f, i) => (
            <div key={i} className="status-shiftline" style={{ left: `${f * 100}%` }} />
          ))}
        </div>
        <div className="status-labels">
          <span style={{ left: '0%' }}>{hasData ? fmtTime(downtime.firstTs!) : '—'}</span>
          <span style={{ left: '100%' }}>{hasData ? fmtTime(downtime.lastTs!) : '—'}</span>
        </div>
        <div className="status-shiftband">
          <div>Morning</div>
          <div>Evening</div>
          <div>Night</div>
        </div>
        <div className="status-legend">
          <span><span className="dot ok" /> running — {downtime.availabilityPct ?? '—'}%</span>
          <span><span className="dot stop" /> stopped ≥120s</span>
          <span style={{ color: 'var(--graphite-dim)' }}>
            MTBF <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{fmtDuration(downtime.mtbfSeconds)}</b>
            {' · '}MTTR <b style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{fmtDuration(downtime.mttrSeconds)}</b>
          </span>
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  format,
  unit,
  foot,
  trend,
  delta,
}: {
  label: string;
  value: number | null;
  format: (n: number) => string;
  unit?: string;
  foot: ReactNode;
  trend?: number[];
  delta?: { text: string; tone: 'good' | 'bad' | 'neutral' } | null;
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
      {delta && <div className={`k-delta ${delta.tone === 'good' ? 'up' : delta.tone === 'bad' ? 'down' : 'flat'}`}>{delta.text}</div>}
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

function RegisterView({
  range,
  seed,
  detail,
  onOpenDetail,
  onCloseDetail,
}: {
  range: { min: string | null; max: string | null };
  seed: RegisterSeed | null;
  detail: { type: RegisterType; id: string } | null;
  onOpenDetail: (type: RegisterType, id: string | number) => void;
  onCloseDetail: () => void;
}) {
  const [type, setType] = useState<RegisterType>(() => seed?.type ?? 'cone');
  const [from, setFrom] = useState(() => seed?.from ?? '');
  const [to, setTo] = useState(() => seed?.to ?? '');
  // default scope: latest FULL day + its last (most recently completed)
  // shift — landing here should never show all 142k+ rows unfiltered.
  const [shift, setShift] = useState<'all' | 'morning' | 'evening' | 'night'>(() => (seed ? 'all' : 'night'));
  const [station, setStation] = useState<string>(() => (seed?.station != null ? String(seed.station) : ''));
  const [inRange, setInRange] = useState<'all' | 'true' | 'false'>('all');
  const [rejectType, setRejectType] = useState<'all' | 'quality' | 'weight'>('all');
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

  useEffect(() => {
    if (seed || from || !range.max) return;
    const prior = new Date(`${range.max}T12:00:00Z`);
    prior.setUTCDate(prior.getUTCDate() - 1);
    const priorStr = prior.toISOString().slice(0, 10);
    const d = range.min && priorStr >= range.min ? priorStr : range.max;
    setFrom(d);
    setTo(d);
  }, [range.max, range.min, seed, from]);

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
  }, [type, from, to, shift, station, inRange, rejectType, wMin, wMax, sort, dir]);

  const query = useMemo(
    () => ({
      type,
      from: from || undefined,
      to: to || undefined,
      shift: shift === 'all' ? undefined : shift,
      station: type !== 'sack' && station ? Number(station) : undefined,
      // reject_event has no in_range column; sending it would be meaningless
      inRange: type === 'reject' || inRange === 'all' ? undefined : inRange === 'true',
      rejectType: type === 'reject' && rejectType !== 'all' ? rejectType : undefined,
      wMin: wMin ? Number(wMin) : undefined,
      wMax: wMax ? Number(wMax) : undefined,
      tsFrom: tsWindow?.tsFrom,
      tsTo: tsWindow?.tsTo,
      sort,
      dir,
      page,
      pageSize: PAGE_SIZE,
    }),
    [type, from, to, shift, station, inRange, rejectType, wMin, wMax, sort, dir, page],
  );

  useEffect(() => {
    if (detail) return; // detail page open — list isn't visible, skip the fetch
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
  }, [query, detail]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const weightUnit = type === 'sack' ? 'kg' : 'g';
  const revealed = useRevealOnData(rows.map((r) => r.source_row_id).join(','));

  const toggleSort = (col: RegisterSort) => {
    if (sort === col) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSort(col);
      setDir('desc');
    }
  };

  if (detail) {
    return <RegisterDetailPage type={detail.type} id={detail.id} onBack={onCloseDetail} onOpenDetail={onOpenDetail} />;
  }

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
              { key: 'reject', label: 'Rejects' },
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
        {type !== 'sack' && (
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
        {type === 'reject' && (
          <div className="field">
            <label>Reject type</label>
            <select value={rejectType} onChange={(e) => setRejectType(e.target.value as typeof rejectType)}>
              <option value="all">All</option>
              <option value="quality">Quality (coded)</option>
              <option value="weight">Weight</option>
            </select>
          </div>
        )}
        {/* reject_event has no in_range column, so the control would be a lie */}
        {type !== 'reject' && (
          <div className="field">
            <label>In range</label>
            <select value={inRange} onChange={(e) => setInRange(e.target.value as typeof inRange)}>
              <option value="all">All</option>
              <option value="true">In range</option>
              <option value="false">Out of range</option>
            </select>
          </div>
        )}
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
          <h2>{type === 'cone' ? 'Cone' : type === 'sack' ? 'Sack' : 'Reject'} register</h2>
          <div className="hint">
            {fmtInt(total)} matching record{total === 1 ? '' : 's'}. Click a row for full detail.
            {type === 'reject' && (
              <>
                {' '}Quality rejects carry two raw inspection codes and <b>no weight</b> — the source
                table has no weight column — so the weight column is blank for them and sorting by
                weight groups them together. Codes show their meaning once labelled on the Rejects page.
              </>
            )}
          </div>
          <div className="table-scroll">
            <table className="reg-table">
              <thead>
                <tr>
                  <th className="sortable" aria-sort={sort === 'time' ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}>
                    <button type="button" className="th-sort" onClick={() => toggleSort('time')}>
                      Production time <span aria-hidden="true">{sort === 'time' ? (dir === 'desc' ? '▾' : '▴') : ''}</span>
                    </button>
                  </th>
                  <th>Shift</th>
                  {type === 'sack' ? <th>Sack #</th> : <th>Station</th>}
                  <th className="sortable num" aria-sort={sort === 'weight' ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}>
                    <button type="button" className="th-sort" onClick={() => toggleSort('weight')}>
                      Weight <span aria-hidden="true">{sort === 'weight' ? (dir === 'desc' ? '▾' : '▴') : ''}</span>
                    </button>
                  </th>
                  {type === 'reject' ? <th>Reason</th> : <th>Status</th>}
                </tr>
              </thead>
              <tbody style={{ opacity: revealed ? 1 : 0.4, transition: 'opacity 200ms' }}>
                {loading && rows.length === 0 ? (
                  <tr><td colSpan={5} className="reg-empty">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="reg-empty">No records match these filters.</td></tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={String(r.source_row_id)}
                      className="reg-row"
                      {...activatable(
                        () => onOpenDetail(type, r.source_row_id),
                        `Open ${type} ${r.source_row_id}, ${fmtDateTime(r.production_ts_utc)}`,
                      )}
                    >
                      <td className="mono">{fmtDateTime(r.production_ts_utc)}</td>
                      <td className="cap">{r.shift_code}</td>
                      <td className="mono">{type === 'sack' ? (r.sack_num ?? '—') : (r.source_station ?? '—')}</td>
                      <td className="mono num">
                        {/* Quality rejects carry no weight at source (rejectQCS1 has no
                            weight column), so an em dash here is the honest answer
                            rather than a zero that would read as "weighed nothing". */}
                        {type === 'sack'
                          ? `${r.weight_kg} ${weightUnit}`
                          : r.weight_g == null
                            ? '—'
                            : `${r.weight_g} ${weightUnit}`}
                      </td>
                      <td>
                        {type === 'reject' ? (
                          <RejectReasonCell row={r} />
                        ) : (
                          <span className={`pill ${r.in_range ? 'on' : 'off'}`}>{r.in_range ? 'in range' : 'out of range'}</span>
                        )}
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
    </>
  );
}

/** The register detail page — a real URL (?v=register&dtype=...&did=...),
 * not modal state: permalink-able, survives refresh, works with browser
 * back/forward. Fetches everything itself from just {type, id} so it never
 * depends on the list having already loaded that row. Adds the context the
 * old drawer didn't have: which SPC subgroup this reading falls in, how its
 * station is trending, and the readings immediately around it in time. */
function RegisterDetailPage({
  type,
  id,
  onBack,
  onOpenDetail,
}: {
  type: RegisterType;
  id: string;
  onBack: () => void;
  onOpenDetail: (type: RegisterType, id: string | number) => void;
}) {
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [spc, setSpc] = useState<SpcData | null>(null);
  const [neighbors, setNeighbors] = useState<RegisterRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRow(null);
    setNotFound(false);
    setSpc(null);
    setNeighbors(null);
    getEventDetail(type, id)
      .then((r) => {
        if (cancelled) return;
        if (!r.row) {
          setNotFound(true);
          return;
        }
        setRow(r.row);
      })
      .catch(() => !cancelled && setNotFound(true));
    return () => {
      cancelled = true;
    };
  }, [type, id]);

  const shiftDate = row ? String(row.shift_date).slice(0, 10) : null;
  const productionTs = row ? String(row.production_ts_utc) : null;
  // sack_event has no station; cone and reject both do.
  const sourceStation = row && type !== 'sack' ? (row.source_station as number | null) : null;

  // A reject IS a rejected cone, so its weight-statistics context lives in the
  // cone stream — reject_event carries no subgroup or sigma of its own (and for
  // quality rejects, no weight at all). The station context is the genuinely
  // useful part: how the station this reject came from was running that day.
  const spcType: SpcType = type === 'reject' ? 'cone' : type;

  useEffect(() => {
    if (!shiftDate) return;
    let cancelled = false;
    getSpc({ type: spcType, from: shiftDate, to: shiftDate })
      .then((r) => !cancelled && setSpc(r.data))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [spcType, shiftDate]);

  useEffect(() => {
    if (!productionTs) return;
    let cancelled = false;
    const stationFilter = sourceStation ?? undefined;
    Promise.all([
      getEvents({ type, station: stationFilter, tsTo: productionTs, sort: 'time', dir: 'desc', page: 1, pageSize: 6 }),
      getEvents({ type, station: stationFilter, tsFrom: productionTs, sort: 'time', dir: 'asc', page: 1, pageSize: 6 }),
    ])
      .then(([before, after]) => {
        if (cancelled) return;
        const beforeAsc = [...before.data.rows].reverse(); // desc → asc, ends with this row
        const afterRows = after.data.rows.slice(1); // drop the duplicate leading row
        setNeighbors([...beforeAsc, ...afterRows]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [type, productionTs, sourceStation]);

  const subgroup = useMemo(() => {
    if (!spc || !productionTs) return null;
    const t = new Date(productionTs).getTime();
    return spc.subgroups.find((g) => {
      const gStart = new Date(g.ts).getTime();
      return t >= gStart && t < gStart + spc.bucketMinutes * 60_000;
    }) ?? null;
  }, [spc, productionTs]);

  const stationStat = useMemo(() => {
    if (!spc || sourceStation == null) return null;
    return spc.stations.find((s) => s.station === sourceStation) ?? null;
  }, [spc, sourceStation]);

  if (notFound) {
    return (
      <div className="panel">
        <div className="panel-head">
          <h2>Not found</h2>
        </div>
        <div style={{ padding: '4px 0' }}>
          <p>{type === 'cone' ? 'Cone' : type === 'sack' ? 'Sack' : 'Reject'} #{id} doesn't exist, or doesn't match this line.</p>
          <button className="abtn primary" onClick={onBack}>← Back to register</button>
        </div>
      </div>
    );
  }
  if (!row) {
    return <div className="tile skeleton" style={{ height: 260 }} />;
  }

  // rejects are rejected cones -> grams; only sacks are kg
  const weightUnit = type === 'sack' ? 'kg' : 'g';
  const weight = type === 'sack' ? row.weight_kg : row.weight_g;

  return (
    <>
      <button className="abtn" style={{ marginBottom: 14 }} onClick={onBack}>← Back to register</button>

      <div className="panel">
        <div className="panel-head">
          <h2>{type === 'cone' ? 'Cone' : type === 'sack' ? 'Sack' : 'Reject'} #{String(row.source_row_id)}</h2>
          <span className="sub">{fmtDateTime(String(row.production_ts_utc))}</span>
        </div>
        <DetailRow label="Production time" value={fmtDateTime(String(row.production_ts_utc))} />
        <DetailRow label="Shift (corrected)" value={String(row.shift_code)} />
        <DetailRow
          label="Shift (legacy)"
          value={row.shift_code_legacy != null ? String(row.shift_code_legacy) : '—'}
          mismatch={row.shift_code_legacy != null && row.shift_code_legacy !== row.shift_code}
        />
        {type === 'reject' && (
          <>
            <DetailRow label="Reject type" value={String(row.reject_type ?? '—')} />
            {row.reject_type === 'quality' ? (
              <>
                <DetailRow
                  label="Tube inspect code"
                  value={row.tube_inspect_code == null ? '—' : String(row.tube_inspect_code)}
                />
                <DetailRow
                  label="Material inspect code"
                  value={row.material_inspect_code == null ? '—' : String(row.material_inspect_code)}
                />
                <DetailRow
                  label="Reason"
                  value={row.reject_label != null ? String(row.reject_label) : 'Code meaning not yet supplied by IFL (Q10)'}
                />
              </>
            ) : null}
          </>
        )}
        {/* Quality rejects have no weight at source, so this reads "—" rather
            than a fabricated 0. Sacks and cones always carry one. */}
        <DetailRow label="Weight" value={weight == null ? '—' : `${weight} ${weightUnit}`} />
        {type !== 'reject' && <DetailRow label="In range" value={row.in_range ? 'Yes' : 'No'} />}
        {type !== 'sack' ? (
          <>
            <DetailRow label="Source station" value={String(row.source_station ?? '—')} />
            <DetailRow label="Lifter station" value={String(row.lifter_station ?? '—')} />
            <DetailRow label="Hanger" value={String(row.hanger_num ?? '—')} />
          </>
        ) : (
          <DetailRow label="Sack number" value={String(row.sack_num ?? '—')} />
        )}
        {type !== 'reject' && (
          <DetailRow label="Product" value={row.lot_code != null ? String(row.lot_code) : 'Not attributed (Q1)'} />
        )}
        {type !== 'reject' && (
          <DetailRow
            label="Merge key"
            value={row.merge_key_is_unique ? 'Unique' : 'Collision (DQ-2)'}
            mismatch={!row.merge_key_is_unique}
          />
        )}
        <DetailRow label="Source system" value={String(row.source_system ?? '—')} />
        <DetailRow label="Transform version" value={`v${row.transform_version ?? '—'}`} />
        {row.ingest_ts_utc != null && <DetailRow label="Synced at" value={fmtDateTime(String(row.ingest_ts_utc))} />}
      </div>

      {subgroup && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head">
            <h2>Its subgroup</h2>
            <span className="sub">{spc!.bucketLabel}</span>
          </div>
          <div className="hint">
            The {spc!.bucketLabel} window this reading falls in — n = {subgroup.n}, mean {subgroup.mean}{spc!.unit}.
          </div>
          <div className="stat-row">
            <Stat label="Subgroup mean" val={`${subgroup.mean}`} u={spc!.unit} accent />
            <Stat label="Control limits" val={`${subgroup.xLcl}–${subgroup.xUcl}`} u={spc!.unit} />
            <Stat label="n" val={`${subgroup.n}`} />
          </div>
          {subgroup.xViolates && (
            <div className="rule-note">This subgroup's mean was outside its ±3σ control limit — the line genuinely shifted in this window.</div>
          )}
        </div>
      )}

      {stationStat && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head">
            <h2>Its station</h2>
            <span className="sub">station {stationStat.station}</span>
          </div>
          <div className="hint">
            How station {stationStat.station} ran on {shiftDate}, across all {fmtInt(stationStat.n)} of its cones that day.
          </div>
          <div className="stat-row">
            <Stat label="Station mean" val={`${stationStat.mean}`} u={spc!.unit} accent={stationStat.flagged} />
            <Stat label="vs line" val={`${stationStat.delta > 0 ? '+' : ''}${stationStat.delta}`} u={spc!.unit} />
            <Stat label="n" val={`${fmtInt(stationStat.n)}`} />
          </div>
          {stationStat.flagged && (
            <div className="rule-note">
              Past the ±{spc!.practicalThresholdG}{spc!.unit} practical threshold — this station is worth a maintenance look.
            </div>
          )}
        </div>
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>Time-neighbours</h2>
          <span className="sub">{sourceStation != null ? `station ${sourceStation}` : 'same stream'}</span>
        </div>
        <div className="hint">
          {type === 'reject' ? (
            <>
              The rejects immediately before and after this one{sourceStation != null ? ' from the same station' : ''}.
              Tightly-spaced neighbours mean a burst worth investigating as one event; widely-spaced ones
              mean this was isolated. Click one to jump to it.
            </>
          ) : (
            <>
              The readings immediately before and after this one{sourceStation != null ? ' from the same station' : ''}.
              Click one to jump to it.
            </>
          )}
        </div>
        {!neighbors ? (
          <div className="tile skeleton" style={{ height: 120 }} />
        ) : (
          <div className="table-scroll">
            <table className="reg-table">
              <thead>
                <tr>
                  <th>Production time</th>
                  <th>Shift</th>
                  <th className="num">Weight</th>
                  {type === 'reject' ? <th>Reason</th> : <th>Status</th>}
                </tr>
              </thead>
              <tbody>
                {neighbors.map((n) => {
                  const isCurrent = String(n.source_row_id) === String(row.source_row_id);
                  return (
                    <tr
                      key={String(n.source_row_id)}
                      className="reg-row"
                      style={isCurrent ? { background: 'var(--green-pale)', fontWeight: 650 } : undefined}
                      aria-current={isCurrent ? 'true' : undefined}
                      {...(isCurrent
                        ? {}
                        : activatable(
                            () => onOpenDetail(type, n.source_row_id),
                            `Jump to ${type} at ${fmtDateTime(n.production_ts_utc)}`,
                          ))}
                    >
                      <td className="mono">{fmtDateTime(n.production_ts_utc)}{isCurrent ? ' (this one)' : ''}</td>
                      <td className="cap">{n.shift_code}</td>
                      <td className="mono num">
                        {type === 'sack'
                          ? `${n.weight_kg} ${weightUnit}`
                          : n.weight_g == null
                            ? '—'
                            : `${n.weight_g} ${weightUnit}`}
                      </td>
                      <td>
                        {type === 'reject' ? (
                          <RejectReasonCell row={n} />
                        ) : (
                          <span className={`pill ${n.in_range ? 'on' : 'off'}`}>{n.in_range ? 'in range' : 'out of range'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
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

/** Stoppage patterns across many days. Hour-of-day clustering only means
 * anything with repeats — one day gives one sample per hour — so this view is
 * range-based, unlike the single-day Downtime view it sits beside. */
function StoppagePatternView({
  range,
  onMeta,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [threshold, setThreshold] = useState(120);
  const [data, setData] = useState<StoppagePatternData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    getStoppagePatterns(from, to, threshold)
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
  }, [from, to, threshold, onMeta]);

  const analysis = useMemo(() => {
    if (!data) return null;
    const all = data.stoppages;
    const buckets = DURATION_BUCKETS.map((b) => {
      const inB = all.filter((s) => s.durationSeconds >= b.min && s.durationSeconds < b.max);
      return { ...b, count: inB.length, downSeconds: inB.reduce((a, s) => a + s.durationSeconds, 0) };
    });
    const hourDays = Array.from({ length: 24 }, () => new Set<string>());
    const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, downSeconds: 0, days: 0, maxSingle: 0 }));
    for (const s of all) {
      const h = new Date(s.startTs).getUTCHours();
      byHour[h]!.count += 1;
      byHour[h]!.downSeconds += s.durationSeconds;
      byHour[h]!.maxSingle = Math.max(byHour[h]!.maxSingle, s.durationSeconds);
      hourDays[h]!.add(s.startTs.slice(0, 10));
    }
    byHour.forEach((h, i) => (h.days = hourDays[i]!.size));

    const totalDown = all.reduce((a, s) => a + s.durationSeconds, 0);
    const micro = buckets[0]!;
    const long = buckets.slice(2).reduce((a, b) => a + b.count, 0);
    const longDown = buckets.slice(2).reduce((a, b) => a + b.downSeconds, 0);

    // Rank the "worst hour" by RECURRENCE, not total seconds. A single long
    // outage can put 30% of all downtime into one hour of the clock and read
    // as a daily pattern when it happened exactly once — verified in the data,
    // where hour 08 was dominated by one 19.7h stop.
    const worstHour = [...byHour].sort((a, b) => b.days - a.days || b.count - a.count)[0]!;
    const biggestByTime = [...byHour].sort((a, b) => b.downSeconds - a.downSeconds)[0]!;
    const skewed = biggestByTime.downSeconds > 0 && biggestByTime.maxSingle / biggestByTime.downSeconds > 0.5;
    // 06/14/22 are the shift changes — recurrence there is a handover signal.
    const handover = [6, 14, 22].map((h) => byHour[h]!);
    const medianDays = [...byHour].map((h) => h.days).sort((a, b) => a - b)[12]!;

    return {
      all,
      buckets,
      byHour,
      totalDown,
      microPct: all.length > 0 ? (100 * micro.count) / all.length : 0,
      microDownPct: totalDown > 0 ? (100 * micro.downSeconds) / totalDown : 0,
      longCount: long,
      longDownPct: totalDown > 0 ? (100 * longDown) / totalDown : 0,
      worstHour,
      biggestByTime,
      skewed,
      handoverElevated: handover.filter((h) => h.days > medianDays),
      dayCount: data.dayCount,
    };
  }, [data]);

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
        <div className="error-card"><b>Couldn't load stoppage patterns.</b> {error}</div>
      ) : loading || !analysis ? (
        <div className="tile skeleton" style={{ height: 340 }} />
      ) : analysis.all.length === 0 ? (
        <div className="hint">No stoppages over {threshold}s in this range.</div>
      ) : (
        <>
          <div className="callout">
            <div className="big">
              <span className="accent">{Math.round(analysis.microPct)}%</span> of stoppages are under 5 minutes —
              but they are only <span className="accent">{Math.round(analysis.microDownPct)}%</span> of lost time
            </div>
            <p>
              {fmtInt(analysis.all.length)} stoppages across {analysis.dayCount} days, {fmtDuration(analysis.totalDown)} down
              in total. The <b>{analysis.longCount}</b> stoppages over 15 minutes account for{' '}
              <b>{Math.round(analysis.longDownPct)}%</b> of it. Chasing the count and chasing the lost hours are two
              different jobs — this is which one you're looking at.
            </p>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>How long do stoppages last?</h2>
              <span>
                <span className="sub">{from} to {to}</span>
                <ExportCsv
                  name={csvName('stoppage-durations', from, to)}
                  headers={['bucket', 'min_seconds', 'max_seconds', 'count', 'total_down_seconds']}
                  rows={() => analysis.buckets.map((b) => [b.label, b.min, b.max === Infinity ? '' : b.max, b.count, b.downSeconds])}
                />
              </span>
            </div>
            <div className="hint">
              Micro-stops an operator clears, versus breakdowns someone gets called out for. Bars are counts; the figure
              on the right is the downtime that bucket actually cost.
            </div>
            <div className="bars">
              {analysis.buckets.map((b) => {
                const max = Math.max(1, ...analysis.buckets.map((x) => x.count));
                return (
                  <div className="bar-row wide" key={b.label}>
                    <span className="name">{b.label}</span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ width: `${(100 * b.count) / max}%` }} />
                    </span>
                    <span className="val">
                      {fmtInt(b.count)}
                      <span className="val-pct">{fmtDuration(b.downSeconds)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ height: 16 }} />

          <div className="panel">
            <div className="panel-head">
              <h2>When in the day do stoppages happen?</h2>
              <span>
                <span className="sub">
                  most days affected: {String(analysis.worstHour.hour).padStart(2, '0')}:00 · {analysis.worstHour.days} of{' '}
                  {analysis.dayCount}
                </span>
                <ExportCsv
                  name={csvName('stoppages-by-hour', from, to)}
                  headers={['hour', 'stoppages', 'total_down_seconds', 'days_affected', 'days_in_range']}
                  rows={() => analysis.byHour.map((h) => [h.hour, h.count, h.downSeconds, h.days, analysis.dayCount])}
                />
              </span>
            </div>
            <div className="hint">
              Downtime by hour of day, pooled over {analysis.dayCount} days and banded by shift. What makes an hour worth
              acting on is <b>recurrence</b> — how many separate days it goes down — not the total, which one long
              outage can dominate on its own.
              {analysis.handoverElevated.length > 0 && (
                <>
                  {' '}The shift-change hours{' '}
                  <b>
                    {analysis.handoverElevated.map((h) => `${String(h.hour).padStart(2, '0')}:00`).join(', ')}
                  </b>{' '}
                  go down on more days than a typical hour — the handover itself is worth a look.
                </>
              )}
            </div>
            {analysis.skewed && (
              <div className="hint" style={{ color: 'var(--amber)' }}>
                Note: {String(analysis.biggestByTime.hour).padStart(2, '0')}:00 has the tallest bar
                ({fmtDuration(analysis.biggestByTime.downSeconds)}), but a single{' '}
                {fmtDuration(analysis.biggestByTime.maxSingle)} stoppage is most of it — one incident, not a daily habit.
              </div>
            )}
            <ResizableChart initialHeight={280}>
              {(h) => <HourClusterChart byHour={analysis.byHour} height={h} />}
            </ResizableChart>
          </div>
        </>
      )}
    </>
  );
}

/** Downtime by hour of day (0–23), with the three shifts banded behind. */
function HourClusterChart({
  byHour,
  height = 280,
}: {
  byHour: { hour: number; count: number; downSeconds: number; days: number }[];
  height?: number;
}) {
  const [wrapRef, measuredW] = useMeasuredWidth();
  const W = Math.max(560, measuredW - 92);
  const LM = 58;
  const H = height;
  const [hover, setHover] = useState<number | null>(null);
  const maxDown = Math.max(1, ...byHour.map((h) => h.downSeconds));
  const bandW = W / 24;
  const barW = bandW * 0.62;
  const y = (v: number) => H - (v / maxDown) * H;
  const bx = (i: number) => LM + i * bandW;
  // The top-left duration label ("21h 37m") right-anchors at LM-6 and needs
  // room to its LEFT to the viewBox edge. The fixed 76px margin was sized for
  // the old font; measured on real data at Extra Large (20px) the label needs
  // ~82px and only had ~70, clipping "21h 37m" against the chart's own edge.
  const axisFontPx = useTipFontPx();
  const maxDownLabel = fmtDuration(maxDown);
  const leftPad = Math.max(76, Math.ceil(maxDownLabel.length * axisFontPx * TIP_CHAR_W) + 16);

  const shiftBands = [
    { from: 6, to: 14, label: 'Morning' },
    { from: 14, to: 22, label: 'Evening' },
    { from: 22, to: 24, label: 'Night' },
    { from: 0, to: 6, label: 'Night' },
  ];
  const hs = hover != null ? byHour[hover] : null;
  const tipFont = useTipFontPx();
  const tipLines: TipLine[] = hs
    ? [
        { t: `${String(hs.hour).padStart(2, '0')}:00–${String((hs.hour + 1) % 24).padStart(2, '0')}:00`, cls: 'strong' },
        { t: `${fmtDuration(hs.downSeconds)} over ${hs.count} stoppage${hs.count === 1 ? '' : 's'}` },
        { t: `on ${hs.days} separate day${hs.days === 1 ? '' : 's'}` },
      ]
    : [];
  const tipW = tipLines.length ? tipMetrics(tipLines.map((l) => l.t), tipFont).w : 0;
  const tipX = hover != null ? Math.min(Math.max(bx(hover) + bandW / 2 + 8, LM), LM + W - tipW) : 0;

  return (
    <div className="spc-chart-wrap" ref={wrapRef}>
      <svg className="spc-chart dt-timeline" viewBox={`${LM - leftPad} -28 ${W + leftPad + 16} ${H + 66}`} width="100%" height={H + 66}>
        <text className="axis-title" x={LM - 6} y={-15} textAnchor="end">down</text>
        {shiftBands.map((b, i) => (
          <g key={i}>
            <rect className={`dt-band ${b.label.toLowerCase()}`} x={bx(b.from)} y={0} width={(b.to - b.from) * bandW} height={H} />
            {b.to - b.from >= 6 && (
              <text className="dt-band-label" x={bx((b.from + b.to) / 2)} y={15} textAnchor="middle">{b.label}</text>
            )}
          </g>
        ))}
        <line className="grid-line" x1={LM} y1={H} x2={LM + W} y2={H} />
        <text className="axis-label" x={LM - 6} y={H + 4} textAnchor="end">0</text>
        <text className="axis-label" x={LM - 6} y={12} textAnchor="end">{fmtDuration(maxDown)}</text>
        {byHour.map((h, i) => (
          <rect
            key={h.hour}
            className={`dt-stop${hover === i ? ' hot' : ''}`}
            x={bx(i) + (bandW - barW) / 2}
            y={y(h.downSeconds)}
            width={barW}
            height={Math.max(0, H - y(h.downSeconds))}
            rx={1.5}
          />
        ))}
        {byHour.map((h, i) =>
          h.hour % 2 === 0 ? (
            <text key={h.hour} className="x-tick" x={bx(i) + bandW / 2} y={H + 20} textAnchor="middle">
              {String(h.hour).padStart(2, '0')}
            </text>
          ) : null,
        )}
        {hs && (
          <ChartTip x={tipX} lines={tipLines} fontPx={tipFont} />
        )}
        {byHour.map((h, i) => (
          <rect
            key={h.hour}
            x={bx(i)}
            y={0}
            width={bandW}
            height={H}
            fill="transparent"
            style={{ pointerEvents: 'all' }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
    </div>
  );
}

/** Stoppage duration buckets. The split that matters operationally is
 * micro-stop (an operator clears it) vs breakdown (someone is called out) —
 * so the buckets are chosen around that, not on an even numeric scale. */
const DURATION_BUCKETS: { label: string; short: string; min: number; max: number }[] = [
  { label: 'under 5 min', short: '<5m', min: 0, max: 300 },
  { label: '5–15 min', short: '5–15m', min: 300, max: 900 },
  { label: '15–30 min', short: '15–30m', min: 900, max: 1800 },
  { label: '30–60 min', short: '30–60m', min: 1800, max: 3600 },
  { label: 'over 1 hour', short: '>1h', min: 3600, max: Infinity },
];

/** A day's stoppages on a real time axis, banded by shift. Height encodes
 * duration so one long breakdown doesn't read the same as a run of micro-stops. */
function StoppageTimeline({
  firstTs,
  lastTs,
  stoppages,
  height = 280,
  onPick,
}: {
  firstTs: string;
  lastTs: string;
  stoppages: Stoppage[];
  height?: number;
  onPick?: (s: Stoppage) => void;
}) {
  const [wrapRef, measuredW] = useMeasuredWidth();
  const W = Math.max(560, measuredW - 92);
  const LM = 58;
  const H = height;
  const [hover, setHover] = useState<number | null>(null);

  const t0 = new Date(firstTs).getTime();
  const t1 = new Date(lastTs).getTime();
  const span = Math.max(1, t1 - t0);
  const x = (t: number) => LM + ((t - t0) / span) * W;
  const maxDur = Math.max(60, ...stoppages.map((s) => s.durationSeconds));
  const y = (d: number) => H - (d / maxDur) * H;
  // Same fix as HourClusterChart's identical top-left duration label/viewBox.
  const axisFontPx = useTipFontPx();
  const maxDurLabel = fmtDuration(maxDur);
  const leftPad = Math.max(76, Math.ceil(maxDurLabel.length * axisFontPx * TIP_CHAR_W) + 16);

  // Shift boundaries (06/14/22) that actually fall inside the observed window.
  const start = new Date(firstTs);
  const marks: { t: number; label: string }[] = [];
  for (let dayOff = 0; dayOff <= 1; dayOff++) {
    for (const [h, label] of [[6, 'Morning'], [14, 'Evening'], [22, 'Night']] as [number, string][]) {
      const t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + dayOff, h, 0, 0);
      if (t > t0 && t < t1) marks.push({ t, label });
    }
  }
  marks.sort((a, b) => a.t - b.t);

  // Band = the stretch between two boundaries; its shift is whichever one owns
  // the band's midpoint, so no running cursor to keep in sync.
  const labelFor = (h: number) => (h >= 6 && h < 14 ? 'Morning' : h >= 14 && h < 22 ? 'Evening' : 'Night');
  const edges = [t0, ...marks.map((m) => m.t), t1];
  const bands = edges.slice(0, -1).map((e, i) => {
    const next = edges[i + 1]!;
    return { x0: x(e), x1: x(next), label: labelFor(new Date((e + next) / 2).getUTCHours()) };
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * span);
  const hs = hover != null ? stoppages[hover] : null;
  const tipFont = useTipFontPx();
  const tipLines: TipLine[] = hs
    ? [
        { t: `${fmtDuration(hs.durationSeconds)} down`, cls: 'strong' },
        { t: `${fmtTime(hs.startTs)} – ${fmtTime(hs.endTs)}` },
        { t: 'click to see cones either side' },
      ]
    : [];
  const tipW = tipLines.length ? tipMetrics(tipLines.map((l) => l.t), tipFont).w : 0;
  const tipX = hs ? Math.min(Math.max(x(new Date(hs.startTs).getTime()) + 10, LM), LM + W - tipW) : 0;

  return (
    <div className="spc-chart-wrap" ref={wrapRef}>
      <svg className="spc-chart dt-timeline" viewBox={`${LM - leftPad} -28 ${W + leftPad + 16} ${H + 66}`} width="100%" height={H + 66}>
        <text className="axis-title" x={LM - 6} y={-15} textAnchor="end">down</text>
        {bands.map((b, i) => (
          <g key={i}>
            <rect className={`dt-band ${b.label.toLowerCase()}`} x={b.x0} y={0} width={Math.max(0, b.x1 - b.x0)} height={H} />
            {b.x1 - b.x0 > 70 && (
              <text className="dt-band-label" x={(b.x0 + b.x1) / 2} y={15} textAnchor="middle">{b.label}</text>
            )}
          </g>
        ))}
        {marks.map((m, i) => (
          <line key={i} className="dt-shiftline" x1={x(m.t)} y1={0} x2={x(m.t)} y2={H} />
        ))}
        <line className="grid-line" x1={LM} y1={H} x2={LM + W} y2={H} />
        <text className="axis-label" x={LM - 6} y={H + 4} textAnchor="end">0</text>
        <text className="axis-label" x={LM - 6} y={12} textAnchor="end">{fmtDuration(maxDur)}</text>
        {stoppages.map((s, i) => {
          const sx = x(new Date(s.startTs).getTime());
          const w = Math.max(2, (s.durationSeconds * 1000 / span) * W);
          return (
            <rect
              key={i}
              className={`dt-stop${hover === i ? ' hot' : ''}`}
              x={sx}
              y={y(s.durationSeconds)}
              width={w}
              height={H - y(s.durationSeconds)}
              rx={1}
              style={{ pointerEvents: 'all', cursor: onPick ? 'pointer' : 'default' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick?.(s)}
            />
          );
        })}
        {ticks.map((t, i) => (
          <text key={i} className="x-tick" x={x(t)} y={H + 20} textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>
            {fmtTime(new Date(t).toISOString())}
          </text>
        ))}
        {hs && (
          <ChartTip x={tipX} lines={tipLines} fontPx={tipFont} />
        )}
      </svg>
    </div>
  );
}

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
            <div className="panel-head">
              <h2>Stoppage timeline</h2>
              <span>
                <ExportCsv
                  name={csvName('stoppages', date, date)}
                  headers={['start', 'end', 'duration_seconds']}
                  rows={() => data.stoppages.map((st) => [st.startTs, st.endTs, st.durationSeconds])}
                />
                <PrintButton />
              </span>
            </div>
            <div className="hint">
              {data.firstTs && data.lastTs
                ? `${fmtDateTime(data.firstTs)} — ${fmtDateTime(data.lastTs)}. Bar height is the stoppage's duration, so a long breakdown reads differently from a cluster of micro-stops. Click one to open the cones either side of it.`
                : 'No data this day.'}
            </div>
            {data.firstTs && data.lastTs ? (
              <ResizableChart initialHeight={280}>
                {(h) => (
                  <StoppageTimeline
                    firstTs={data.firstTs!}
                    lastTs={data.lastTs!}
                    stoppages={data.stoppages}
                    height={h}
                    onPick={inspectStoppage}
                  />
                )}
              </ResizableChart>
            ) : null}

            <div className="panel-head" style={{ marginTop: 6 }}>
              <h2>Throughput — cones per hour</h2>
              <ExportCsv
                name={csvName('throughput-hourly', date, date)}
                headers={['hour_start', 'cones']}
                rows={() => data.hourly.map((h) => [h.hourTs, h.count])}
              />
            </div>
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
                <span>
                  {data.stoppages.length > STOPPAGE_PREVIEW_COUNT && (
                    <button className="abtn" onClick={() => setStoppagesExpanded((v) => !v)}>
                      {stoppagesExpanded ? 'Show less' : `Show all ${data.stoppages.length}`}
                    </button>
                  )}
                  <ExportCsv
                    name={csvName('stoppages-ranked', date, date)}
                    headers={['rank', 'start', 'end', 'duration_seconds']}
                    rows={() =>
                      [...data.stoppages]
                        .sort((a, b) => b.durationSeconds - a.durationSeconds)
                        .map((st, i) => [i + 1, st.startTs, st.endTs, st.durationSeconds])
                    }
                  />
                </span>
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
                      <tr
                        key={i}
                        className="reg-row"
                        {...activatable(
                          () => inspectStoppage(s),
                          `Inspect stoppage at ${fmtDateTime(s.startTs)}, ${fmtDuration(s.durationSeconds)} down`,
                        )}
                      >
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

          {/* Two independent verdicts exist on every cone — the PLC's in-range bit
              and the product tolerance in PDAS — and nobody had compared them.
              Where they disagree, only IFL can say which governs, so this states
              the finding and asks rather than silently picking a side. */}
          {data.specAgreement && data.specAgreement.disagreementCount > 0 && (
            <div className="panel spec-disagree" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <h2>The PLC and your product spec disagree</h2>
                <span className="sub">{data.specAgreement.disagreementPct}% of {fmtInt(data.specAgreement.evaluated)} cones</span>
              </div>
              <div className="hint">
                Both judgements come from IFL systems. The line's <b>in-range</b> bit is set by the PLC
                against a band configured in the controller; the tolerance <b>{data.specAgreement.toleranceLabel}</b> is
                what the product master in PDAS says. They do not agree on{' '}
                <b>{fmtInt(data.specAgreement.disagreementCount)}</b> cones in this range.
              </div>
              <div className="stat-row">
                <Stat label="PLC passed, spec says out" val={fmtInt(data.specAgreement.plcPassedButOutOfTolerance)} accent />
                <Stat label="PLC rejected, spec says in" val={fmtInt(data.specAgreement.plcFailedButInTolerance)} />
              </div>
              <div className="hint">
                The first group passed the line as good while sitting outside the product tolerance;
                the second was failed while inside it.
              </div>
              <div className="hint" style={{ marginTop: 10 }}>
                Worth reconciling before it shows up in an audit: whichever limit governs, one of the two
                is currently mis-set. We are not guessing which — that is a decision for your process
                and quality engineers, and the app will follow whichever you confirm.
              </div>
            </div>
          )}

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head">
              <h2>Process summary</h2>
              <span>
                <ExportCsv
                  name={csvName(`process-summary-${type}`, from, to)}
                  headers={['metric', 'value', 'unit']}
                  rows={() => [
                    ['count', data.count, noun],
                    ['mean', data.mean, unit],
                    ['sigma_within', data.stdevWithin, unit],
                    ['sigma_overall', data.stdevOverall, unit],
                    ['subgroup_size', data.bucketLabel, ''],
                    ['subgroups', data.subgroups.length, ''],
                    ['subgroups_out_of_control', data.xbarOutOfControl, ''],
                    ['practical_threshold', data.practicalThresholdG, unit],
                    ['stations_flagged', data.flaggedStationCount, ''],
                    ['spec_source', data.spec.source, ''],
                    ['spec_lsl', data.spec.lsl, unit],
                    ['spec_usl', data.spec.usl, unit],
                    ['cp', data.capability.cp, ''],
                    ['cpk', data.capability.cpk, ''],
                    ['pp', data.capability.pp, ''],
                    ['ppk', data.capability.ppk, ''],
                  ]}
                />
                <PrintButton />
              </span>
            </div>
            <div className="hint">
              {/* Population is now every plausible reading, in-spec or not — SPC has to
                  include a station's out-of-spec output or it cannot detect that station
                  drifting. Only physically impossible readings (scale faults) are excluded. */}
              {fmtInt(data.count)} {type === 'cone' ? 'cones' : 'sacks'}, {from === to ? from : `${from} to ${to}`} ·
              {' '}grouped into {data.subgroups.length} {data.bucketLabel} subgroups. In-spec and
              out-of-spec both count; implausible readings (scale faults) are excluded.
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
                <ExportCsv
                  name={csvName(`per-station-${type}`, from, to)}
                  headers={['station', 'n', `mean_${unit}`, `stdev_${unit}`, `delta_vs_line_${unit}`, 'statistically_distinguishable', 'flagged_actionable']}
                  rows={() => data.stations.map((st) => [st.station, st.n, st.mean, st.stdev, st.delta, st.distinguishable, st.flagged])}
                />
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
              <ResizableChart initialHeight={300}>
                {(h) => (
                  <StationChart stations={data.stations} grandMean={data.grandMean} threshold={data.practicalThresholdG} unit={unit} height={h} onStationClick={inspectStation} />
                )}
              </ResizableChart>
            </div>
          )}

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="panel-head">
              <h2>X̄ chart — line mean over time</h2>
              <ExportCsv
                name={csvName(`xbar-${type}`, from, to)}
                headers={['subgroup_start', 'n', `mean_${unit}`, `ucl_${unit}`, `lcl_${unit}`, 'out_of_control']}
                rows={() => data.subgroups.map((g) => [g.ts, g.n, g.mean, g.xUcl, g.xLcl, g.xViolates])}
              />
            </div>
            <div className="hint">
              Each point is the mean of one {data.bucketLabel} subgroup; the band is that subgroup's ±3σ control limit (narrower where more {noun} landed).
              A point outside the band means the line mean genuinely shifted. Click a point to inspect those {noun}.
              {data.spec.usl != null && ' Amber lines are the spec tolerance.'}
            </div>
            <ResizableChart initialHeight={320}>
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
            <div className="panel-head">
              <h2>S chart — within-subgroup spread over time</h2>
              <ExportCsv
                name={csvName(`schart-${type}`, from, to)}
                headers={['subgroup_start', 'n', `sigma_${unit}`, `ucl_${unit}`, `lcl_${unit}`, 'out_of_control']}
                rows={() => data.subgroups.map((g) => [g.ts, g.n, g.s, g.sUcl, g.sLcl, g.sViolates])}
              />
            </div>
            <div className="hint">
              Each point is the spread (σ) inside one {data.bucketLabel} subgroup, centered on {data.sChartCenter}{unit}. A point above its band means the
              process got erratic in that window.
              {type === 'cone'
                ? ' This is a valid consistency signal, unlike a raw cone-to-cone moving range across interleaved stations.'
                : ''}
            </div>
            <ResizableChart initialHeight={260}>
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
            <div className="panel-head">
              <h2>Weight distribution</h2>
              <ExportCsv
                name={csvName(`distribution-${type}`, from, to)}
                headers={[`bin_start_${unit}`, `bin_end_${unit}`, 'count']}
                rows={() => data.histogram.map((b) => [b.start, b.end, b.count])}
              />
            </div>
            <div className="hint">
              Every {type === 'cone' ? 'cone' : 'sack'}, in-spec or not, binned. The green line is the mean;
              {data.spec.usl != null ? ' amber lines are the spec tolerance — bars near or past them are the capability risk.' : ' add a spec above to overlay the tolerance.'}
            </div>
            <ResizableChart initialHeight={300}>
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
      <div
        className="resize-handle"
        onMouseDown={startDrag}
        title="Drag to resize (or focus and use arrow keys)"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize chart"
        aria-valuenow={height}
        aria-valuemin={minHeight}
        aria-valuemax={maxHeight}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 60 : 20;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHeight((h) => Math.min(maxHeight, h + step));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHeight((h) => Math.max(minHeight, h - step));
          } else if (e.key === 'Home') {
            e.preventDefault();
            setHeight(initialHeight);
          }
        }}
      >
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
  height = 320,
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
  const [wrapRef, measuredW] = useMeasuredWidth();
  const W = Math.max(560, measuredW - 136);
  const LM = 46;
  const rmFontPx = useTipFontPx();
  // RM was a fixed 56px, sized for the ~12px axis-label font this chart used
  // before the type-scale change — "1952.3" at the new 16px (or 20px at Extra
  // large) no longer fit and spilled past the chart's own right edge.
  // RM must clear TWO different right-edge labels, not just one: the
  // right-anchored centre-line value, AND the last x-tick timestamp, which is
  // CENTRE-anchored exactly at the plot's right edge — so only its right HALF
  // needs to fit in this margin, but that half was sized only for the
  // centre-line text and clipped "5:30:00 AM" by a few px on real data.
  const halfTimeTick = ("12:00:01 PM".length * rmFontPx * TIP_CHAR_W) / 2;
  const RM = Math.max(56, Math.ceil(centerline.toFixed(1).length * rmFontPx * TIP_CHAR_W) + 14, Math.ceil(halfTimeTick) + 10);
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
  const x = (i: number) => LM + (i / Math.max(1, valid.length - 1)) * W;
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
  const tipFont = useTipFontPx();
  const tipLines: TipLine[] =
    hg && hVal != null
      ? [
          { t: fmtDateTime(hg.ts) },
          { t: `${hVal.toFixed(2)} ${unit}`, cls: 'strong' },
          { t: `n = ${hg.n} ${noun}` },
          ...(violatesOf(hg) ? [{ t: 'out of control', cls: 'warn' }] : []),
        ]
      : [];
  const tipW = tipLines.length ? tipMetrics(tipLines.map((l) => l.t), tipFont).w : 0;
  const tipX = hover != null ? Math.min(Math.max(x(hover) + 10, LM), LM + W - tipW) : 0;

  return (
    <div className="spc-chart-wrap" ref={wrapRef}>
      <svg className="spc-chart" viewBox={`${LM - 80} -28 ${W + 80 + RM} ${height + 52}`} width="100%" height={height + 52}>
        {gridVals.map((gv, i) => (
          <line key={i} className="grid-line" x1={LM} y1={y(gv)} x2={LM + W} y2={y(gv)} />
        ))}
        <path className="ctl-band" d={bandPath} />
        <line className="center-line" x1={LM} y1={y(centerline)} x2={LM + W} y2={y(centerline)} />
        {uslLine != null && uslLine <= yMax && <line className="spec-line" x1={LM} y1={y(uslLine)} x2={LM + W} y2={y(uslLine)} />}
        {lslLine != null && lslLine >= yMin && <line className="spec-line" x1={LM} y1={y(lslLine)} x2={LM + W} y2={y(lslLine)} />}
        <polyline className="series-line" points={linePts} />
        {valid.map((g, i) => (
          <circle key={i} className={violatesOf(g) ? 'pt-limit' : 'pt-ok'} cx={x(i)} cy={y(valueOf(g)!)} r={violatesOf(g) ? 3.6 : 2.4} />
        ))}
        <text className="axis-label" x={LM + W + 4} y={y(centerline) + 3}>{centerline.toFixed(1)}</text>
        {gridVals.map((gv, i) => (
          <text key={`gl${i}`} className="axis-label" x={LM - 6} y={y(gv) + 3} textAnchor="end">{gv.toFixed(0)}</text>
        ))}
        <text className="axis-title" x={LM - 6} y={-15} textAnchor="end">{unit}</text>
        {tickIdxs.map((i) => (
          <text key={i} className="x-tick" x={x(i)} y={height + 16} textAnchor="middle">{fmtTime(valid[i]!.ts)}</text>
        ))}
        {hover != null && hg && hVal != null && (
          <>
            <line className="crosshair" x1={x(hover)} y1={0} x2={x(hover)} y2={height} />
            <circle className={violatesOf(hg) ? 'hover-dot burst' : 'hover-dot'} cx={x(hover)} cy={y(hVal)} r={4} />
            <ChartTip x={tipX} lines={tipLines} fontPx={tipFont} />
          </>
        )}
        <rect
          x={LM}
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
  height = 300,
  onStationClick,
}: {
  stations: StationStat[];
  grandMean: number;
  threshold: number;
  unit: string;
  height?: number;
  onStationClick?: (s: StationStat) => void;
}) {
  const [wrapRef, measuredW] = useMeasuredWidth();
  const W = Math.max(560, measuredW - 80);
  const LM = 46;
  const H = height;
  const [hover, setHover] = useState<number | null>(null);
  const n = stations.length;
  const maxAbs = Math.max(0.5, threshold * 1.15, ...stations.map((s) => Math.abs(s.delta))) * 1.3;
  const bandW = W / n;
  const barW = bandW * 0.5;
  const yMid = H / 2;
  const y = (d: number) => yMid - (d / maxAbs) * (H / 2);
  const bx = (i: number) => LM + i * bandW;

  const hs = hover != null ? stations[hover] : null;
  const tipFont = useTipFontPx();
  const tipLines: TipLine[] = hs
    ? [
        { t: `Station ${hs.station}`, cls: 'strong' },
        { t: `mean ${hs.mean} ${unit}` },
        { t: `${hs.delta > 0 ? '+' : ''}${hs.delta} ${unit} vs line · n=${fmtInt(hs.n)}` },
        {
          t: hs.flagged ? `off-target (past ±${threshold}${unit})` : 'within practical band',
          cls: hs.flagged ? 'warn' : '',
        },
      ]
    : [];
  const tipW = tipLines.length ? tipMetrics(tipLines.map((l) => l.t), tipFont).w : 0;
  const tipX = hover != null ? Math.min(Math.max(bx(hover) + bandW / 2 + 8, LM), LM + W - tipW) : 0;

  return (
    <div className="spc-chart-wrap" ref={wrapRef}>
      <svg className="spc-chart st-chart" viewBox={`${LM - 80} -28 ${W + 80} ${H + 54}`} width="100%" height={H + 54}>
        {threshold > 0 && (
          <>
            <line className="st-dl" x1={LM} y1={y(threshold)} x2={LM + W} y2={y(threshold)} />
            <line className="st-dl" x1={LM} y1={y(-threshold)} x2={LM + W} y2={y(-threshold)} />
            <text className="axis-label" x={LM - 6} y={y(threshold) + 3} textAnchor="end">+{threshold}</text>
            <text className="axis-label" x={LM - 6} y={y(-threshold) + 3} textAnchor="end">−{threshold}</text>
          </>
        )}
        <line className="st-zero" x1={LM} y1={yMid} x2={LM + W} y2={yMid} />
        <text className="axis-label" x={LM - 6} y={yMid + 3} textAnchor="end">0</text>
        <text className="axis-title" x={LM - 6} y={-15} textAnchor="end">Δ {unit}</text>
        {stations.map((s, i) => {
          const cx = bx(i) + bandW / 2;
          const top = Math.min(y(0), y(s.delta));
          const h = Math.abs(y(s.delta) - y(0)) || 1;
          const cls = `st-bar${s.flagged ? ' flagged' : ''}`;
          return <rect key={s.station} className={cls} x={cx - barW / 2} y={top} width={barW} height={h} rx={1.5} />;
        })}
        {stations.map((s, i) => (
          <text key={s.station} className={`x-tick${s.flagged ? ' flagged' : ''}`} x={bx(i) + bandW / 2} y={H + 16} textAnchor="middle">{s.station}</text>
        ))}
        {hover != null && hs && (
          <ChartTip x={tipX} lines={tipLines} fontPx={tipFont} />
        )}
        {stations.map((s, i) => (
          <rect
            key={s.station}
            x={bx(i)}
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
  height = 300,
}: {
  bins: HistBin[];
  mean: number;
  usl: number | null;
  lsl: number | null;
  unit: string;
  height?: number;
}) {
  const [wrapRef, measuredW] = useMeasuredWidth();
  const W = Math.max(560, measuredW - 80);
  const LM = 46;
  const H = height;
  const [hover, setHover] = useState<number | null>(null);
  // This is the one chart that stacks two text lines below the plot (the
  // x-tick values, then the unit title). Both baselines and the viewBox's
  // bottom padding were fixed px (16/34/68) sized for the old ~12px axis
  // font — at 16px+ the two lines collided, and the unit label got squeezed
  // against the resize handle below the chart (reported: "G" overlapping it).
  const axisFontPx = useTipFontPx();
  // viewBox starts at y=-28 (room for the top axis-title) — the total SVG
  // height has to cover that same 28 units again on top of whatever sits
  // below H, or the last line renders past the element's own box and
  // spills into whatever sits after it in the DOM. Missed on the first pass
  // of this fix: it under-allocated by almost exactly 28px, which is why the
  // unit label still touched the resize handle after the first attempt.
  const TOP_OFFSET = 28;
  const tickY = H + Math.ceil(axisFontPx * 1.1);
  const unitY = tickY + Math.ceil(axisFontPx * 1.5);
  const bottomPad = unitY - H + Math.ceil(axisFontPx * 0.4) + TOP_OFFSET;
  if (bins.length === 0) return <div className="empty-note">Not enough data to chart.</div>;
  const maxC = Math.max(1, ...bins.map((b) => b.count));
  const lo = bins[0]!.start;
  const hi = bins[bins.length - 1]!.end;
  const xv = (v: number) => LM + ((v - lo) / (hi - lo)) * W;
  const bw = W / bins.length;
  const y = (c: number) => H - (c / maxC) * H;

  const gridN = 4;
  const gridVals = Array.from({ length: gridN + 1 }, (_, i) => (i / gridN) * maxC);
  const tickVals = [lo, lo + (hi - lo) * 0.25, (lo + hi) / 2, lo + (hi - lo) * 0.75, hi];
  // The last tick is centred (textAnchor="middle") right at the plot's own
  // right edge, so at a wider font half its text extends past the viewBox
  // with nothing to clip against but the edge — "1983" reported clipped to
  // "198". Reserve room for half that label's width instead of a fixed 14px.
  const halfLastLabel = Math.ceil((String(Math.round(hi)).length * axisFontPx * TIP_CHAR_W) / 2) + 3;
  const hb = hover != null ? bins[hover] : null;
  const tipFont = useTipFontPx();
  const tipLines: TipLine[] = hb
    ? [
        { t: `${hb.start}–${hb.end} ${unit}` },
        { t: `${fmtInt(hb.count)} ${hb.count === 1 ? 'unit' : 'units'}`, cls: 'strong' },
      ]
    : [];
  const tipW = tipLines.length ? tipMetrics(tipLines.map((l) => l.t), tipFont).w : 0;
  const tipX = hover != null ? Math.min(Math.max(LM + hover * bw + bw / 2 + 8, LM), LM + W - tipW) : 0;

  return (
    <div className="spc-chart-wrap" ref={wrapRef}>
      <svg
        className="spc-chart histchart"
        viewBox={`${LM - 80} -28 ${W + 80 + halfLastLabel} ${H + bottomPad}`}
        width="100%"
        height={H + bottomPad}
      >
        {gridVals.map((gv, i) => (
          <line key={i} className="grid-line" x1={LM} y1={y(gv)} x2={LM + W} y2={y(gv)} />
        ))}
        {bins.map((b, i) => (
          <rect
            key={i}
            className={`hist-bar${hover === i ? ' hi' : ''}`}
            x={LM + i * bw + 0.5}
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
        {gridVals.map((gv, i) => (
          <text key={`gl${i}`} className="axis-label" x={LM - 6} y={y(gv) + 3} textAnchor="end">{fmtInt(Math.round(gv))}</text>
        ))}
        <text className="axis-title" x={LM - 6} y={-15} textAnchor="end">count</text>
        {tickVals.map((v, i) => (
          <text
            key={i}
            className="x-tick"
            x={Math.max(LM + halfLastLabel, Math.min(LM + W - halfLastLabel, xv(v)))}
            y={tickY}
            textAnchor="middle"
          >
            {Math.round(v)}
          </text>
        ))}
        <text className="axis-title" x={LM + W / 2} y={unitY} textAnchor="middle">{unit}</text>
        {hover != null && hb && (
          <ChartTip x={tipX} lines={tipLines} fontPx={tipFont} />
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
              <div className="panel-head">
                <h2>Detected episodes</h2>
                <ExportCsv
                  name={csvName('reject-episodes', from, to)}
                  headers={['start', 'end', 'buckets', 'total_rejects', 'total_produced', 'rate']}
                  rows={() =>
                    data.episodes.map((ep) => [
                      ep.startTs,
                      ep.endTs,
                      ep.bucketCount,
                      ep.totalRejects,
                      ep.totalProduced,
                      ep.totalProduced > 0 ? Math.round((10000 * ep.totalRejects) / ep.totalProduced) / 100 : null,
                    ])
                  }
                />
              </div>
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
            <div className="panel-head">
              <h2>Reject rate control chart</h2>
              <ExportCsv
                name={csvName('reject-control-chart', from, to)}
                headers={['bucket_start', 'produced', 'rejects', 'rate', 'ucl', 'lcl', 'beyond_control_limit']}
                rows={() => data.buckets.map((b) => [b.bucketTs, b.produced, b.rejects, b.rate, b.ucl, b.lcl, b.outOfControl])}
              />
            </div>
            <div className="hint">
              Dashed line is each bucket's own 3σ upper limit (based on its production volume); flat line is the overall baseline rate.
            </div>
            <ResizableChart initialHeight={320}>
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
  height = 320,
}: {
  buckets: RejectBucket[];
  pBar: number | null;
  bucketSize: 'hour' | 'day';
  revealed: boolean;
  height?: number;
}) {
  const [wrapRef, measuredW] = useMeasuredWidth();
  const W = Math.max(560, measuredW - 136);
  const LM = 46;
  const H = height;
  const rmFontPx = useTipFontPx();
  const [hover, setHover] = useState<number | null>(null);
  const withRate = buckets.filter((b) => b.rate != null);
  if (withRate.length === 0 || pBar == null) {
    return <div className="empty-note">Not enough data to chart.</div>;
  }
  // Same fix as SubgroupChart's RM — was a fixed 56px sized for the old
  // ~12px axis font; "2.03%" at 16px+ was clipping against the right edge.
  const RM = Math.max(56, Math.ceil(`${(pBar * 100).toFixed(2)}%`.length * rmFontPx * TIP_CHAR_W) + 14);
  const rates = withRate.map((b) => b.rate!);
  const ucls = withRate.map((b) => b.ucl ?? 0);
  const yMax = Math.max(...rates, ...ucls, pBar) * 1.15 || 0.01;
  const x = (i: number) => LM + (i / Math.max(1, withRate.length - 1)) * W;
  const y = (v: number) => (revealed ? H - (v / yMax) * H : H);

  const ratePts = withRate.map((b, i) => `${x(i).toFixed(1)},${y(b.rate!).toFixed(1)}`).join(' ');
  // Buckets below the p-chart validity threshold (n·p̄ < 5) carry ucl: null —
  // skip them rather than plot at 0, which used to draw a sharp false notch
  // down to the axis right where the real control limit simply isn't defined.
  const uclPts = withRate
    .map((b, i) => (b.ucl == null ? null : `${x(i).toFixed(1)},${y(b.ucl).toFixed(1)}`))
    .filter((p): p is string => p != null)
    .join(' ');

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
  const tipFont = useTipFontPx();
  const tipLines: TipLine[] = hb
    ? [
        { t: bucketSize === 'hour' ? fmtDateTime(hb.bucketTs) : hb.bucketTs.slice(0, 10) },
        { t: `${((hb.rate ?? 0) * 100).toFixed(2)}% rate`, cls: 'strong' },
        { t: `${fmtInt(hb.rejects)} of ${fmtInt(hb.produced)} produced` },
        ...(hb.outOfControl ? [{ t: 'beyond control limit', cls: 'warn' }] : []),
      ]
    : [];
  const tipW = tipLines.length ? tipMetrics(tipLines.map((l) => l.t), tipFont).w : 0;
  const tipX = hover != null ? Math.min(Math.max(x(hover) + 10, LM), LM + W - tipW) : 0;

  return (
    <div className="spc-chart-wrap" ref={wrapRef}>
      <svg
        className="spc-chart pchart"
        viewBox={`${LM - 80} -28 ${W + 80 + RM} ${H + 52}`}
        width="100%"
        height={H + 52}
       
      >
        {gridVals.map((gv, i) => (
          <line key={i} className="grid-line" x1={LM} y1={y(gv)} x2={LM + W} y2={y(gv)} />
        ))}
        <polyline className="ucl-band" points={uclPts} />
        <line className="center-line" x1={LM} y1={y(pBar)} x2={LM + W} y2={y(pBar)} />
        <polyline className="rate-line" points={ratePts} style={{ transition: 'opacity 300ms' }} />
        {withRate.map((b, i) => (
          <circle key={i} className={b.outOfControl ? 'pt-burst' : 'pt-ok'} cx={x(i)} cy={y(b.rate!)} r={b.outOfControl ? 3.2 : 1.6} />
        ))}
        <text className="axis-label" x={LM + W + 4} y={y(pBar) + 3}>{(pBar * 100).toFixed(2)}%</text>
        {gridVals.map((gv, i) => (
          <text key={`gl${i}`} className="axis-label" x={LM - 6} y={y(gv) + 3} textAnchor="end">{(gv * 100).toFixed(1)}</text>
        ))}
        <text className="axis-title" x={LM - 6} y={-15} textAnchor="end">rate %</text>

        {tickIdxs.map((i) => (
          <text key={i} className="x-tick" x={x(i)} y={H + 16} textAnchor="middle">
            {tickLabel(withRate[i]!.bucketTs)}
          </text>
        ))}

        {hover != null && hb && (
          <>
            <line className="crosshair" x1={x(hover)} y1={0} x2={x(hover)} y2={H} />
            <circle className={hb.outOfControl ? 'hover-dot burst' : 'hover-dot'} cx={x(hover)} cy={y(hb.rate!)} r={4} />
            <ChartTip x={tipX} lines={tipLines} fontPx={tipFont} />
          </>
        )}
        <rect
          x={LM}
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
            <div className="panel-head">
              <h2>What went into this number</h2>
              <span>
                <ExportCsv
                  name={csvName('oee-inputs', data.from, data.to)}
                  headers={['input', 'value', 'unit']}
                  rows={() => [
                    ['oee_pct', data.oeePct, '%'],
                    ['availability_pct', data.availabilityPct, '%'],
                    ['performance_pct', data.performancePct, '%'],
                    ['quality_pct', data.qualityPct, '%'],
                    ['planned_seconds', data.plannedSeconds, 's'],
                    ['run_seconds', data.runSeconds, 's'],
                    ['down_seconds', data.downSeconds, 's'],
                    ['stoppage_count', data.stoppageCount, ''],
                    ['ideal_cycle_seconds', data.idealCycleSeconds, 's'],
                    ['ideal_cycle_source', data.idealCycleSource, ''],
                    ['produced_count', data.producedCount, 'cones'],
                    ['rejected_count', data.rejectedCount, 'cones'],
                    ['threshold_seconds', data.thresholdSeconds, 's'],
                    ['planned_hours_per_day', data.plannedHoursPerDay, 'h'],
                    ['first_event', data.firstTs, ''],
                    ['last_event', data.lastTs, ''],
                    ['possibly_partial', data.possiblyPartial, ''],
                  ]}
                />
                <PrintButton />
              </span>
            </div>
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

const WORK_SHIFTS = ['morning', 'evening', 'night'] as const;
type ShiftKey = (typeof WORK_SHIFTS)[number];
const SHIFT_HOURS: Record<ShiftKey, string> = { morning: '06–14', evening: '14–22', night: '22–06' };

interface ShiftScore {
  shift: ShiftKey;
  cones: number;
  rejects: number;
  rejectRatePct: number;
  availabilityPct: number;
  stoppages: number;
  oeePct: number;
  weightSd: number;
  weightMean: number;
}

/** One row of the scorecard: a metric measured across all three shifts. */
interface ShiftMetric {
  key: string;
  label: string;
  unit: string;
  /** true when a HIGHER number is the better outcome */
  higherIsBetter: boolean;
  value: (s: ShiftScore) => number;
  format: (n: number) => string;
  note: string;
}

const SHIFT_METRICS: ShiftMetric[] = [
  { key: 'cones', label: 'Cones produced', unit: '', higherIsBetter: true, value: (s) => s.cones, format: fmtInt, note: 'Total good cones wound during the shift.' },
  { key: 'reject', label: 'Reject rate', unit: '%', higherIsBetter: false, value: (s) => s.rejectRatePct, format: (n) => `${n.toFixed(2)}%`, note: 'Rejects ÷ (good + rejected).' },
  { key: 'avail', label: 'Availability', unit: '%', higherIsBetter: true, value: (s) => s.availabilityPct, format: (n) => `${n.toFixed(1)}%`, note: 'Run time ÷ shift time, from detected stoppages.' },
  { key: 'stops', label: 'Stoppages', unit: '', higherIsBetter: false, value: (s) => s.stoppages, format: fmtInt, note: 'Gaps over the detection threshold.' },
  { key: 'oee', label: 'OEE (estimated)', unit: '%', higherIsBetter: true, value: (s) => s.oeePct, format: (n) => `${n.toFixed(1)}%`, note: 'Availability × Performance × Quality. Inferred, not certified.' },
  { key: 'sd', label: 'Weight consistency (σ)', unit: 'g', higherIsBetter: false, value: (s) => s.weightSd, format: (n) => `${n.toFixed(2)} g`, note: 'Spread of cone weight. Lower = tighter control.' },
];

function ShiftView({ range, onMeta }: { range: { min: string | null; max: string | null }; onMeta: (m: Meta) => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scores, setScores] = useState<ShiftScore[] | null>(null);
  const [trend, setTrend] = useState<Record<ShiftKey, ProductionRow[]> | null>(null);
  const [legacy, setLegacy] = useState<ShiftAnalysisData | null>(null);
  const [trendMetric, setTrendMetric] = useState<'cones' | 'reject'>('cones');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    Promise.all([
      // plannedHoursPerDay=8 because each shift only owns a third of the day —
      // the default 24 would understate availability by 3×.
      Promise.all(WORK_SHIFTS.map((s) => getOee({ from, to, shift: s, plannedHoursPerDay: 8 }))),
      Promise.all(WORK_SHIFTS.map((s) => getSpc({ type: 'cone', from, to, shift: s }))),
      Promise.all(WORK_SHIFTS.map((s) => getProduction({ from, to, shift: s, groupBy: 'day' }))),
      getShiftAnalysis(from, to),
    ])
      .then(([oees, spcs, prods, leg]) => {
        if (cancelled) return;
        setScores(
          WORK_SHIFTS.map((s, i) => {
            const o = oees[i]!.data;
            const sp = spcs[i]!.data;
            const denom = o.producedCount + o.rejectedCount;
            return {
              shift: s,
              cones: o.producedCount,
              rejects: o.rejectedCount,
              rejectRatePct: denom > 0 ? (100 * o.rejectedCount) / denom : 0,
              availabilityPct: o.availabilityPct,
              stoppages: o.stoppageCount,
              oeePct: o.oeePct,
              weightSd: sp.stdevOverall,
              weightMean: sp.mean,
            };
          }),
        );
        setTrend({ morning: prods[0]!.data.rows, evening: prods[1]!.data.rows, night: prods[2]!.data.rows });
        setLegacy(leg.data);
        onMeta(oees[0]!.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to, onMeta]);

  // The headline: which shift is weakest, and on how many of the six metrics.
  const verdict = useMemo(() => {
    if (!scores || scores.length < 3) return null;
    const worstCount = new Map<ShiftKey, string[]>(WORK_SHIFTS.map((s) => [s, []]));
    for (const m of SHIFT_METRICS) {
      const sorted = [...scores].sort((a, b) => (m.higherIsBetter ? m.value(a) - m.value(b) : m.value(b) - m.value(a)));
      worstCount.get(sorted[0]!.shift)!.push(m.label.toLowerCase());
    }
    const ranked = [...worstCount.entries()].sort((a, b) => b[1].length - a[1].length);
    const [shift, metrics] = ranked[0]!;
    const oee = scores.map((s) => s.oeePct);
    return { shift, metrics, spreadPp: Math.max(...oee) - Math.min(...oee) };
  }, [scores]);

  const trendSeries = useMemo(() => {
    if (!trend) return null;
    const days = [...new Set(WORK_SHIFTS.flatMap((s) => trend[s].map((r) => r.group)))].sort();
    return {
      days,
      series: WORK_SHIFTS.map((s) => {
        const byDay = new Map(trend[s].map((r) => [r.group, r]));
        return {
          name: s,
          points: days.map((d) => {
            const r = byDay.get(d);
            if (!r) return null;
            if (trendMetric === 'cones') return r.cones;
            const n = r.cones + r.rejectedCones;
            return n > 0 ? (100 * r.rejectedCones) / n : null;
          }),
        };
      }),
    };
  }, [trend, trendMetric]);

  if (error) return <div className="error-card"><b>Couldn't load shift performance.</b> {error}</div>;

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
      </div>

      {loading || !scores || !verdict ? (
        <div className="tile skeleton" style={{ height: 360 }} />
      ) : (
        <>
          <div className="callout" style={verdict.metrics.length >= 3 ? { borderLeftColor: 'var(--alert)' } : undefined}>
            <div className="big">
              <span className="accent" style={{ textTransform: 'capitalize' }}>{verdict.shift}</span> is the weakest shift —
              worst on <span className="accent">{verdict.metrics.length}</span> of {SHIFT_METRICS.length} measures
            </div>
            <p>
              {verdict.metrics.length > 0 ? <>It ranks last on {verdict.metrics.join(', ')}. </> : null}
              OEE spans <b>{verdict.spreadPp.toFixed(1)} points</b> between the best and worst shift over{' '}
              {from === to ? from : `${from} to ${to}`}. Same line, same machines — a gap this size is a crewing,
              handover, or maintenance-timing question, not an equipment one.
            </p>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Shift scorecard</h2>
              <span>
                <span className="sub">{from === to ? from : `${from} to ${to}`}</span>
                <ExportCsv
                  name={csvName('shift-scorecard', from, to)}
                  headers={['metric', 'unit', ...scores.map((sc) => sc.shift)]}
                  rows={() => SHIFT_METRICS.map((m) => [m.label, m.unit, ...scores.map((sc) => m.value(sc))])}
                />
                <PrintButton />
              </span>
            </div>
            <div className="hint">
              Best value in each row is emphasised; the worst is marked when being worst actually signals a problem.
            </div>
            <div className="table-scroll">
              <table className="compare shift-scorecard">
                <thead>
                  <tr>
                    <th className="name">Measure</th>
                    {scores.map((s) => (
                      <th key={s.shift}>
                        <span className="sh-name">{s.shift}</span>
                        <span className="sh-hours">{SHIFT_HOURS[s.shift]}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SHIFT_METRICS.map((m) => {
                    const vals = scores.map(m.value);
                    const best = m.higherIsBetter ? Math.max(...vals) : Math.min(...vals);
                    const worst = m.higherIsBetter ? Math.min(...vals) : Math.max(...vals);
                    return (
                      <tr key={m.key}>
                        <td className="name" title={m.note}>{m.label}</td>
                        {scores.map((s) => {
                          const v = m.value(s);
                          const cls = v === best ? 'col-active' : v === worst ? 'is-worst' : '';
                          return <td key={s.shift} className={cls}>{m.format(v)}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ height: 16 }} />

          <div className="panel">
            <div className="panel-head">
              <h2>Day over day, by shift</h2>
              <span>
                {trendSeries && (
                  <ExportCsv
                    name={csvName(`shift-trend-${trendMetric}`, from, to)}
                    headers={['date', ...trendSeries.series.map((sr) => sr.name)]}
                    rows={() =>
                      trendSeries.days.map((d, i) => [d, ...trendSeries.series.map((sr) => sr.points[i] ?? null)])
                    }
                  />
                )}
              </span>
              <Segmented
                value={trendMetric}
                onChange={setTrendMetric}
                options={[
                  { key: 'cones', label: 'Cones' },
                  { key: 'reject', label: 'Reject rate' },
                ]}
              />
            </div>
            <div className="hint">
              Whether a shift's gap is a persistent pattern or a bad day. Three lines that stay separated day after day
              point at the crew or the schedule; lines that cross around point at the process.
            </div>
            {trendSeries && trendSeries.days.length > 0 ? (
              <ResizableChart initialHeight={300}>
                {(h) => (
                  <ShiftTrendChart
                    days={trendSeries.days}
                    series={trendSeries.series}
                    unit={trendMetric === 'cones' ? 'cones' : '%'}
                    height={h}
                  />
                )}
              </ResizableChart>
            ) : (
              <div className="hint">No daily data in this range.</div>
            )}
          </div>

          {legacy && (
            <>
              <div style={{ height: 16 }} />
              <details className="data-note">
                <summary>
                  Data integrity: {legacy.mismatch.pct}% of cones sat in the wrong shift before SMS
                </summary>
                <p>
                  IFL's existing system stamps each cone's shift from the time the record was <em>saved</em> to the
                  database, not when it was produced — a ~3.8h lag. SMS recomputes the shift from the real production
                  time, which moves <b>{fmtInt(legacy.mismatch.differing)}</b> of {fmtInt(legacy.mismatch.total)} cones.
                  Every figure on this page uses the corrected assignment.
                </p>
                <div className="table-scroll">
                  <table className="compare">
                    <thead>
                      <tr>
                        <th className="name">Shift</th>
                        <th>Corrected</th>
                        <th>Legacy</th>
                        <th>Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {WORK_SHIFTS.map((s) => {
                        const c = legacy.corrected.find((r) => r.shift === s)?.cones ?? 0;
                        const l = legacy.legacy.find((r) => r.shift === s)?.cones ?? 0;
                        const d = c - l;
                        return (
                          <tr key={s}>
                            <td className="name">{s}</td>
                            <td className="col-active">{fmtInt(c)}</td>
                            <td className="col-idle">{fmtInt(l)}</td>
                            <td className={`delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}`}>
                              {d > 0 ? '+' : ''}{fmtInt(d)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </>
  );
}

/** Three shift series over the same day axis. Distinguished by dash pattern as
 * well as tone, so the lines stay separable without spending status colours. */
function ShiftTrendChart({
  days,
  series,
  unit,
  height = 300,
}: {
  days: string[];
  series: { name: string; points: (number | null)[] }[];
  unit: string;
  height?: number;
}) {
  const [wrapRef, measuredW] = useMeasuredWidth();
  const W = Math.max(560, measuredW - 96);
  const LM = 62;
  const H = height;
  const [hover, setHover] = useState<number | null>(null);
  // Top-left y-axis unit label ("cones" or "reject %") right-anchors at
  // LM-6 — the fixed 80px left viewBox margin fit "cones" (5 chars) but not
  // the wider "reject %" (8 chars) once toggled, clipping it against the
  // chart's own edge at larger font sizes.
  const axisFontPx = useTipFontPx();
  const unitLabel = unit === '%' ? 'reject %' : 'cones';
  const leftPad = Math.max(80, Math.ceil(unitLabel.length * axisFontPx * TIP_CHAR_W) + 16);

  const all = series.flatMap((s) => s.points).filter((v): v is number => v != null);
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const pad = (hi - lo) * 0.15 || Math.max(1, hi * 0.1);
  const yMin = Math.max(0, lo - pad);
  const yMax = hi + pad;
  const y = (v: number) => H - ((v - yMin) / (yMax - yMin || 1)) * H;
  const x = (i: number) => (days.length === 1 ? LM + W / 2 : LM + (i / (days.length - 1)) * W);

  const fmtV = (v: number) => (unit === '%' ? `${v.toFixed(2)}%` : fmtInt(Math.round(v)));
  const ticks = [yMin, yMin + (yMax - yMin) / 2, yMax];
  const xStep = Math.max(1, Math.ceil(days.length / 9));
  const tipFont = useTipFontPx();
  const tipLines: TipLine[] =
    hover != null
      ? [
          { t: days[hover] ?? '', cls: 'strong' },
          ...series.map((sr) => ({
            t: `${sr.name}: ${sr.points[hover] != null ? fmtV(sr.points[hover]!) : '—'}`,
          })),
        ]
      : [];
  const tipW = tipLines.length ? tipMetrics(tipLines.map((l) => l.t), tipFont).w : 0;
  const tipX = hover != null ? Math.min(Math.max(x(hover) + 10, LM), LM + W - tipW) : 0;

  return (
    <div className="spc-chart-wrap" ref={wrapRef}>
      <svg className="spc-chart trend-chart" viewBox={`${LM - leftPad} -28 ${W + leftPad + 16} ${H + 60}`} width="100%" height={H + 60}>
        <text className="axis-title" x={LM - 6} y={-15} textAnchor="end">{unit === '%' ? 'reject %' : 'cones'}</text>
        {ticks.map((t, i) => (
          <g key={i}>
            <line className="grid-line" x1={LM} y1={y(t)} x2={LM + W} y2={y(t)} />
            <text className="axis-label" x={LM - 6} y={y(t) + 4} textAnchor="end">{fmtV(t)}</text>
          </g>
        ))}
        {series.map((s, si) => {
          const d = s.points
            .map((v, i) => (v == null ? null : `${x(i)},${y(v)}`))
            .filter(Boolean)
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`)
            .join(' ');
          return <path key={s.name} className={`trend-line s${si}`} d={d} />;
        })}
        {series.map((s, si) =>
          s.points.map((v, i) =>
            v == null ? null : <circle key={`${s.name}-${i}`} className={`trend-dot s${si}`} cx={x(i)} cy={y(v)} r={2.6} />,
          ),
        )}
        {days.map((d, i) =>
          i % xStep === 0 ? (
            <text key={d} className="x-tick" x={x(i)} y={H + 18} textAnchor="middle">{d.slice(5)}</text>
          ) : null,
        )}
        {hover != null && (
          <>
            <line className="crosshair" x1={x(hover)} y1={0} x2={x(hover)} y2={H} />
            <ChartTip x={tipX} lines={tipLines} fontPx={tipFont} />
          </>
        )}
        {days.map((d, i) => (
          <rect
            key={d}
            x={x(i) - W / (2 * Math.max(1, days.length - 1))}
            y={0}
            width={W / Math.max(1, days.length - 1)}
            height={H}
            fill="transparent"
            style={{ pointerEvents: 'all' }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      <div className="trend-legend">
        {series.map((s, si) => (
          <span key={s.name} className="tl-item">
            <span className={`tl-swatch s${si}`} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
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
        <div className="panel-head">
          <h2>Reject reasons — Pareto</h2>
          <ExportCsv
            name={csvName('reject-pareto')}
            headers={['reject_type', 'tube_code', 'material_code', 'label', 'count', 'pct_of_total', 'cumulative_pct']}
            rows={() => data.reasons.map((r) => [r.rejectType, r.tubeCode, r.materialCode, r.label ?? '', r.count, r.pct, r.cumulativePct])}
          />
        </div>
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

function WeightView({
  range,
  onMeta,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
}) {
  const [basis, setBasis] = useState<Basis>('as_recorded');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<WeightsData | null>(null);
  const [dailyCones, setDailyCones] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // default to the full available window — matches this page's original
    // behaviour (no date filter at all) while now making the range visible
    // and adjustable, since annualising needs a real, known day-count.
    if (range.max && !to) {
      setTo(range.max);
      setFrom(range.min ?? range.max);
    }
  }, [range.max, range.min, to]);

  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([getWeights(basis, from, to), getProduction({ from, to, groupBy: 'day' })])
      .then(([r, p]) => {
        if (cancelled) return;
        setData(r.data);
        setDailyCones(p.data.rows.filter((x) => x.group !== 'total').map((x) => x.cones));
        onMeta(r.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [basis, from, to, onMeta]);

  const days = from && to ? Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1 : null;

  // Annualise from a RATE (g/cone × a typical day's cones), never from
  // total ÷ calendar days. A range almost always includes a partial day —
  // always, once live, because today is still running — and dividing by whole
  // days understates the figure (measured: 3.9 t/yr vs 4.3 t/yr on an 18-day
  // window with two partial edges). The median daily count is used as the
  // "typical day" precisely so those partial days can't drag it.
  const giveaway = useMemo(() => {
    const perCone = data?.cone.giveawayPerConeG;
    if (perCone == null || !dailyCones || dailyCones.length === 0) return null;
    const sorted = [...dailyCones].sort((a, b) => a - b);
    const medianConesPerDay = sorted[Math.floor(sorted.length / 2)]!;
    const kgPerDay = (perCone * medianConesPerDay) / 1000;
    return {
      kgPerDay: round1(kgPerDay),
      annualizedKg: Math.round(kgPerDay * 365),
      annualizedTonnes: round1((kgPerDay * 365) / 1000),
      medianConesPerDay,
      partialDays: dailyCones.filter((c) => c < medianConesPerDay * 0.5).length,
    };
  }, [data, dailyCones]);

  if (error) return <div className="error-card"><b>Couldn't load weight analysis.</b> {error}</div>;

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
                {giveaway ? (
                  <>
                    <span className="accent">{Math.abs(giveaway.kgPerDay)} kg/day</span> {data.cone.giveawayPerConeG >= 0 ? 'overfill' : 'underfill'}
                    {' — '}<span className="accent">≈{Math.abs(giveaway.annualizedTonnes)} t/year</span> projected
                  </>
                ) : (
                  <>
                    {data.cone.giveawayPerConeG >= 0 ? 'Overfill' : 'Underfill'} vs {data.cone.nominalSetpointG}g nominal
                  </>
                )}
              </div>

              {/* This is the most quotable number in the app and its SIGN is not
                  yet settled — on this range, net basis turns +1.5 g/cone into
                  −68.5 g/cone. The caveat travels with the number so it cannot be
                  screenshotted or quoted without it. */}
              {data.cone.provisionalReasons.length > 0 && (
                <div className="provisional" role="note">
                  <b>Provisional — not for quoting yet.</b>
                  <ul>
                    {data.cone.provisionalReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p>
                {data.note} Avg cone <b>{data.cone.avg}g</b> vs {data.cone.nominalSetpointG}g nominal
                {data.cone.nominalSource === 'current_product'
                  ? ` (${data.cone.nominalLabel}'s own setpoint)`
                  : ' (fallback — no product selected)'}
                {' — '}{data.cone.giveawayPerConeG > 0 ? '+' : ''}
                {data.cone.giveawayPerConeG} g/cone. Across {fmtInt(data.cone.count)} cones over {days} day{days === 1 ? '' : 's'}
                {data.cone.giveawayTotalKg != null && <> ≈ <b>{data.cone.giveawayTotalKg} kg</b> vs nominal</>}.
                {giveaway && (
                  <>
                    {' '}The daily and yearly figures apply that per-cone rate to a typical day of{' '}
                    <b>{fmtInt(giveaway.medianConesPerDay)} cones</b> (the median), so a partly-finished day can't drag
                    them{giveaway.partialDays > 0 ? ` — ${giveaway.partialDays} in this range` : ''}. Straight-line
                    extrapolation, not a forecast.
                  </>
                )}
              </p>
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

/**
 * A reject's reason. Weight rejects are self-describing; quality rejects carry
 * two raw inspection codes whose meaning is still unanswered (Q10), so the codes
 * themselves are shown rather than invented wording. The moment a code is
 * labelled on the Rejects page, that label appears here retroactively for every
 * matching reject, past and future — which is why the raw codes are always kept.
 */
function RejectReasonCell({ row }: { row: RegisterRow }) {
  if (row.reject_type === 'weight') {
    return <span className="pill off">weight</span>;
  }
  const t = row.tube_inspect_code;
  const m = row.material_inspect_code;
  return (
    <span className="reject-reason">
      <span className="pill off">quality</span>
      {row.reject_label ? (
        <span className="rr-label">{row.reject_label}</span>
      ) : (
        <span className="rr-codes mono" title="tube / material inspection codes — meaning pending IFL (Q10)">
          {t ?? '—'}/{m ?? '—'}
        </span>
      )}
    </span>
  );
}

/**
 * Export affordance for an analytics panel. Sits in the panel head, where the
 * existing .abtn override already renders it correctly against the dark bezel.
 *
 * `rows` is a thunk so the (sometimes large) row array is only built when the
 * user actually clicks, rather than on every render of every panel.
 */
function ExportCsv({
  name,
  headers,
  rows,
  label = 'CSV',
}: {
  name: string;
  headers: string[];
  rows: () => CsvRow[];
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="abtn"
      disabled={busy}
      title={`Download this panel's data as CSV (${name}.csv)`}
      onClick={() => {
        setBusy(true);
        try {
          const r = rows();
          if (r.length === 0) return;
          downloadCsv(name, headers, r);
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </button>
  );
}

/** Print affordance. The @media print rules already drop interactive chrome and
 *  force collapsed notes open, so this is just the trigger. */
function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <button type="button" className="abtn" onClick={() => window.print()} title="Print or save as PDF">
      {label}
    </button>
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

/** Some products in sms.product share an identical description + setpoint —
 * verified live (ids 12/13 are both "201-IH0-SD" @ 1960g with no other
 * distinguishing field) — so the id is the only real disambiguator and must
 * always be shown, in both the picker and the current-product readout,
 * or switching between two such products looks like nothing happened. */
function productLabel(p: ProductOption): string {
  const base = p.description || p.lotCode || `Product ${p.productId}`;
  const wt = p.setpointG ? ` · ${p.setpointG}g` : '';
  return `${base}${wt} · #${p.productId}`;
}

function CurrentProductBar({ rank }: { rank: number }) {
  const [current, setCurrent] = useState<TimelineEntry | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [sel, setSel] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [justChanged, setJustChanged] = useState<ProductOption | null>(null);
  const canSet = rank >= 2; // supervisor+

  const load = () => {
    getCurrentProduct().then((r) => setCurrent(r.current)).catch(() => {});
  };
  useEffect(() => {
    load();
    getProducts().then((r) => setProducts(r.products)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!justChanged) return;
    const t = setTimeout(() => setJustChanged(null), 5000);
    return () => clearTimeout(t);
  }, [justChanged]);

  const sortedProducts = useMemo(
    () =>
      [...products].sort(
        (a, b) =>
          (a.description ?? '').localeCompare(b.description ?? '') ||
          (a.setpointG ?? 0) - (b.setpointG ?? 0) ||
          a.productId - b.productId,
      ),
    [products],
  );

  const apply = async () => {
    if (sel === '') return;
    setSaving(true);
    try {
      const chosen = products.find((p) => p.productId === Number(sel)) ?? null;
      const r = await setCurrentProduct(Number(sel));
      setCurrent(r.current);
      setSel('');
      setJustChanged(chosen);
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
            <span className="val">
              {current.productLabel} <span className="cp-id">#{current.productId}</span>
            </span>
            <span className="meta">
              since {new Date(current.effectiveFrom).toLocaleString()} · set by {current.changedBy ?? '—'}
            </span>
          </>
        ) : (
          <span className="val none">Not set — production is unattributed (Q1)</span>
        )}
        {justChanged && (
          <span className="cp-confirm">✓ Changed to {productLabel(justChanged)}</span>
        )}
      </div>
      {canSet && (
        <div className="cp-set">
          <select value={sel} onChange={(e) => setSel(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Change product…</option>
            {sortedProducts.map((p) => (
              <option key={p.productId} value={p.productId}>
                {productLabel(p)}
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

/* ---------------- Operations: can you trust what the other pages say? ----------------
 *
 * Every other view answers a question about the LINE. This one answers a question
 * about the DATA, and it is the first place to look when a dashboard reads low or
 * zero: is the number small because the plant was slow, or because ingestion
 * stopped four hours ago?
 *
 * The endpoint already existed and returned all of this; there was simply no
 * screen, so the provenance work was invisible. Three things are worth a
 * customer's attention here, and none of them are visible anywhere else:
 *   - a per-table watermark, which is what makes the sync incremental and
 *     resumable rather than a nightly re-import;
 *   - a schema fingerprint per source table, which HALTS the sync when IFL's
 *     schema changes underneath us instead of silently writing wrong data;
 *   - data-quality findings by severity, published rather than suppressed.
 */
function OperationsView({ onMeta }: { onMeta: (m: Meta) => void }) {
  const [data, setData] = useState<OperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getOperations()
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

  if (error) return <div className="error-card" role="alert"><b>Couldn't load operations status.</b> {error}</div>;
  if (loading || !data) return <div className="tile skeleton" style={{ height: 260 }} />;

  // Freshness is judged on the OLDEST table, not an average: one stalled table
  // is a stalled pipeline, and averaging would hide it.
  const ages = data.sync.map((s) => s.ageSeconds).filter((a): a is number => a != null);
  const worstAge = ages.length ? Math.max(...ages) : null;
  const level = freshnessLevel(worstAge);
  const anyFailed = data.sync.some((s) => s.outcome !== 'success');
  const sev = data.dq.bySeverity;
  const blocking = (sev.CRITICAL ?? 0) + (sev.ERROR ?? 0);

  return (
    <>
      <div className="callout" style={{ borderLeftColor: level === 'ok' ? 'var(--green)' : level === 'warn' ? 'var(--amber)' : 'var(--alert)' }}>
        <div className="big">
          {anyFailed ? (
            <>Ingestion <span className="accent" style={{ color: 'var(--alert)' }}>reported a failure</span> on its last pass</>
          ) : level === 'ok' ? (
            <>Ingestion healthy — all {data.sync.length} tables current</>
          ) : (
            <>
              Ingestion last completed <span className="accent" style={{ color: level === 'crit' ? 'var(--alert)' : 'var(--amber)' }}>{ageLabel(worstAge)}</span>
            </>
          )}
        </div>
        <p>
          Everything the other pages show is derived from this pipeline, so this is the page to check
          first if a figure looks wrong. {level !== 'ok' && !anyFailed && (
            <>
              A large age here does not mean data was lost — the raw layer is append-only and the sync
              resumes from its stored watermark, so restarting the worker picks up exactly where it
              stopped. It means the newest events on the line may not be in the app yet.
            </>
          )}
        </p>
        <button className="abtn" onClick={() => setReloadKey((k) => k + 1)}>Re-check now</button>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Ingestion by table</h2>
          <span>
            <span className="sub">{data.sync.length} source tables</span>
            <ExportCsv
              name={csvName('operations-ingestion')}
              headers={['target_table', 'outcome', 'watermark', 'rows_read', 'rows_written', 'finished_at_utc', 'age_seconds']}
              rows={() => data.sync.map((x) => [x.targetTable, x.outcome, x.watermark, x.rowsRead, x.rowsWritten, x.finishedAtUtc, x.ageSeconds])}
            />
            <PrintButton />
          </span>
        </div>
        <div className="hint">
          Each table advances its own <b>watermark</b> — the highest source row id already ingested — so a
          pass reads only what is new and a restart never re-reads from the beginning. Rows read exceeds
          rows written because a deliberate overlap window re-reads recent rows to catch late-arriving
          edits; re-ingesting an unchanged row writes nothing.
        </div>
        <div className="table-scroll">
          <table className="atable">
            <thead>
              <tr>
                <th>Target table</th>
                <th>Outcome</th>
                <th className="num">Watermark</th>
                <th className="num">Read</th>
                <th className="num">Written</th>
                <th>Last completed</th>
              </tr>
            </thead>
            <tbody>
              {data.sync.map((s) => (
                <tr key={s.targetTable}>
                  <td className="mono">{s.targetTable}</td>
                  <td>
                    <span className={`pill ${s.outcome === 'success' ? 'on' : 'off'}`}>{s.outcome}</span>
                  </td>
                  <td className="mono num">{s.watermark == null ? '—' : fmtInt(s.watermark)}</td>
                  <td className="mono num">{fmtInt(s.rowsRead)}</td>
                  <td className="mono num">{fmtInt(s.rowsWritten)}</td>
                  <td className="mono">
                    {s.finishedAtUtc ? fmtDateTime(s.finishedAtUtc) : '—'}
                    <span className="sub" style={{ marginLeft: 8 }}>{ageLabel(s.ageSeconds)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ height: 16 }} />

      <div className="panel">
        <div className="panel-head">
          <h2>Schema-drift guard</h2>
          <span className="sub">{data.schema.length} source tables fingerprinted</span>
        </div>
        <div className="hint">
          Each source table's column names and types are hashed. If IFL changes a table we depend on,
          the fingerprint stops matching and <b>the sync halts with an explicit error instead of writing
          wrong data</b>. A silent corruption is far more expensive than a loud stop, so this is
          deliberately fail-closed.
        </div>
        <div className="table-scroll">
          <table className="atable">
            <thead>
              <tr><th>Source table</th><th>Status</th><th>Fingerprint</th></tr>
            </thead>
            <tbody>
              {data.schema.map((f) => (
                <tr key={f.table}>
                  <td className="mono">{f.table}</td>
                  <td><span className="pill on">{f.status === 'ok' ? 'matching' : f.status}</span></td>
                  <td className="mono" style={{ color: 'var(--graphite-dim)' }}>{f.fingerprint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ height: 16 }} />

      <div className="panel">
        <div className="panel-head">
          <h2>Data-quality findings</h2>
          <span>
            <span className="sub">
              {data.dq.findings.length === 0 ? 'none open' : `${data.dq.findings.length} open`}
            </span>
            {data.dq.findings.length > 0 && (
              <ExportCsv
                name={csvName('operations-dq')}
                headers={['severity', 'check_name', 'subject_table', 'detail', 'run_id']}
                rows={() => data.dq.findings.map((f) => [f.severity, f.checkName, f.subjectTable, f.detail, data.dq.latestRunId])}
              />
            )}
          </span>
        </div>
        <div className="hint">
          Published, not suppressed. These are checks the pipeline runs on every pass against IFL's own
          data; a finding describes something about the source, not a defect in this app. Severity
          decides whether it merely annotates a figure or blocks a rebuild.
        </div>
        <div className="stat-row">
          <Stat label="Critical" val={String(sev.CRITICAL ?? 0)} accent={(sev.CRITICAL ?? 0) > 0} />
          <Stat label="Error" val={String(sev.ERROR ?? 0)} accent={(sev.ERROR ?? 0) > 0} />
          <Stat label="Warning" val={String(sev.WARNING ?? 0)} />
          <Stat label="Info" val={String(sev.INFO ?? 0)} />
        </div>
        {data.dq.findings.length > 0 && (
          <div className="table-scroll" style={{ marginTop: 14 }}>
            <table className="atable">
              <thead>
                <tr><th>Severity</th><th>Check</th><th>Subject</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {data.dq.findings.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <span className={`pill ${f.severity === 'CRITICAL' || f.severity === 'ERROR' ? 'off' : 'on'}`}>
                        {f.severity.toLowerCase()}
                      </span>
                    </td>
                    <td className="mono">{f.checkName}</td>
                    <td className="mono">{f.subjectTable ?? '—'}</td>
                    <td>{f.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="hint" style={{ marginTop: 12 }}>
          {blocking > 0 ? (
            <>
              <b>{blocking}</b> finding{blocking === 1 ? '' : 's'} at error or above. These are real
              readings in IFL's data — a non-positive weight is a scale fault, not a light sack — and they
              are excluded from statistics while remaining visible here and in the register.
            </>
          ) : (
            <>No findings at error or above on the most recent pass.</>
          )}
          {data.dq.latestRunId && (
            <span className="sub" style={{ marginLeft: 8 }}>run {data.dq.latestRunId.slice(0, 8)}</span>
          )}
        </div>
      </div>
    </>
  );
}

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
      <h2>Station labels <span style={{ color: 'var(--bezel-dim)', fontWeight: 400, fontSize: 12 }}>(Q11)</span></h2>
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
      <h2>Interpretation rules <span style={{ color: 'var(--bezel-dim)', fontWeight: 400, fontSize: 12 }}>(Q4/Q5 · Q7)</span></h2>
      <div className="hint">Versioned — each change appends a new effective rule. When IFL answers, set it here once.</div>

      <div style={{ marginTop: 14 }}>
        <div className="s-label" style={{ marginBottom: 6 }}>Weight basis (applies immediately — read-time)</div>
        {/* Was hand-rolled markup missing the sliding <span class="seg-indicator">
            pill the real Segmented component renders. .segmented button.active
            sets color:#fff with no background of its own — white text on
            nothing behind it, i.e. invisible. Reported as an empty button. */}
        <Segmented
          value={(rules.weight?.basis ?? 'as_recorded') as 'as_recorded' | 'gross' | 'net'}
          onChange={setWeight}
          options={(['as_recorded', 'gross', 'net'] as const).map((b) => ({
            key: b,
            label: b === 'as_recorded' ? 'As recorded' : b[0]!.toUpperCase() + b.slice(1),
          }))}
        />
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="s-label" style={{ marginBottom: 6 }}>Shift basis (needs a canonical rebuild to apply to stored data)</div>
        <Segmented
          value={(rules.shift?.mode ?? 'corrected') as 'corrected' | 'legacy'}
          onChange={setShift}
          options={(['corrected', 'legacy'] as const).map((m) => ({ key: m, label: m[0]!.toUpperCase() + m.slice(1) }))}
        />
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
