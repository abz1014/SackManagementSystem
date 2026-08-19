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
  getProductTimeline,
  setCurrentProduct,
  adminListUsers,
  adminCreateUser,
  adminUpdateUser,
  adminListStations,
  adminSetStation,
  adminGetRules,
  adminSetWeightRule,
  adminSetShiftRule,
  adminSetPlausibilityRule,
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
  type Basis,
  type Meta,
  type ExcludedDay,
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
import { AppShell, canOpen, VIEW_LABEL, type View, type SectionConfig } from './shell';
import { downloadCsv, csvName, type CsvRow } from './csv';
import { fmtInt, ageLabel, freshnessLevel, fmtDuration, fmtHourLabel, fmtDateTime, fmtTime } from './format';

type Shift = 'all' | 'morning' | 'evening' | 'night';
const SHIFTS: Shift[] = ['all', 'morning', 'evening', 'night'];


/** The register detail page is a real URL, not modal state — permalink-able,
 * survives refresh, and cooperates with browser back/forward. No router
 * dependency: the native History API is enough for one addressable sub-page. */
interface Route {
  view: View;
  /** Section-column sub-view, so a finding can deep-link to the exact tab. */
  sub?: string;
  detailType?: RegisterType;
  detailId?: string;
}

function parseRoute(): Route {
  if (typeof window === 'undefined') return { view: 'dashboard' };
  const p = new URLSearchParams(window.location.search);
  const v = p.get('v');
  const view: View = (['dashboard', 'register', 'performance', 'weight', 'shift', 'rejects', 'operations', 'exceptions', 'timeline', 'admin'] as const).includes(v as View)
    ? (v as View)
    : 'dashboard';
  const dtype = p.get('dtype');
  const did = p.get('did');
  const sub = p.get('sub');
  return {
    view,
    sub: sub ?? undefined,
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
  if (r.sub) p.set('sub', r.sub);
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


/**
 * Section-column contents per screen, from the handoff's table.
 *
 * Sub-tab keys are the values that appear in the URL as ?sub=, so they are part
 * of the permalink contract — rename one and you break a bookmark. Notes that
 * quote a figure take it from live data where we have it rather than the
 * design's sample numbers, which are illustrative and in several cases wrong
 * for this plant.
 */
function sectionFor(view: View, counts: { cones?: number; sacks?: number; rejects?: number; stations?: number }): SectionConfig {
  const n = (v?: number) => (v == null || v === 0 ? '—' : fmtInt(v));
  switch (view) {
    case 'dashboard':
      return {
        eyebrow: 'Live picture',
        title: 'The line',
        subTabs: [
          { key: 'today', label: 'Today', note: 'last complete day' },
          { key: 'yesterday', label: 'Yesterday' },
          { key: 'week', label: 'This week' },
        ],
      };
    case 'register':
      return {
        eyebrow: 'Every reading',
        title: 'Records',
        subTabs: [
          { key: 'cone', label: 'Cones', note: `${n(counts.cones)} rows` },
          { key: 'sack', label: 'Sacks', note: `${n(counts.sacks)} rows` },
          // Third tab: the design has only Cones and Sacks, but rejects are a
          // different table shape (no weight, no in-range, coded reasons) and
          // this is the only path from a named finding to the rows behind it.
          { key: 'reject', label: 'Rejects', note: `${n(counts.rejects)} rows` },
        ],
      };
    case 'performance':
      return {
        eyebrow: 'How the line ran',
        title: 'Output',
        subTabs: [
          { key: 'oee', label: 'Effectiveness', note: 'OEE and its three parts' },
          { key: 'stops', label: 'Stops', note: 'downtime and throughput' },
          { key: 'patterns', label: 'Patterns', note: 'when stops repeat' },
        ],
      };
    case 'weight':
      return {
        eyebrow: 'Grams per cone',
        title: 'Weight',
        subTabs: [
          { key: 'spread', label: 'Spread', note: 'distribution and stations' },
          { key: 'stability', label: 'Stability', note: 'control through the day' },
        ],
      };
    case 'rejects':
      return {
        eyebrow: `${n(counts.rejects)} on record`,
        title: 'Rejects',
        subTabs: [
          { key: 'reasons', label: 'Reasons', note: 'inspection codes' },
          { key: 'trend', label: 'Trend', note: 'bursts vs noise' },
          { key: 'station', label: 'By station', note: 'where they happen' },
        ],
      };
    case 'shift':
      return {
        eyebrow: 'Morning · evening · night',
        title: 'Shifts',
        subTabs: [
          { key: 'week', label: 'This week' },
          { key: 'all', label: 'Whole record' },
        ],
      };
    case 'operations':
      return { eyebrow: 'Plant connection', title: 'Sync', subTabs: [] };
    case 'exceptions':
      return { eyebrow: 'One day, filtered', title: 'Exceptions', subTabs: [] };
    case 'timeline':
      return { eyebrow: 'Every changeover', title: 'Product history', subTabs: [] };
    case 'admin':
      return {
        eyebrow: 'Configuration',
        title: 'Setup',
        subTabs: [
          { key: 'people', label: 'People' },
          { key: 'stations', label: 'Stations', note: `${n(counts.stations)} positions` },
          { key: 'rules', label: 'Rules', note: 'weight and shift' },
          { key: 'sync', label: 'Sync', note: 'plant connection' },
        ],
      };
  }
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
  // Row counts for the section column. Fetched once rather than typed in: the
  // literals here were correct for the supplied copy and would have quietly
  // gone stale the first time the sync worker advanced.
  const [counts, setCounts] = useState<{ cones: number; sacks: number; rejects: number; stations: number }>(
    { cones: 0, sacks: 0, rejects: 0, stations: 0 },
  );
  // The section column's "Running now" footer (shell.tsx) has rendered its
  // slot on every screen since the shell rework, but nothing ever populated
  // it — the call site below passed a literal `null`. Fetched once here,
  // independent of CurrentProductBar's own copy of the same read, and
  // refreshed by that component's onProductChanged callback rather than
  // polled, matching how every other mutation in this app triggers an
  // explicit reload instead of an interval.
  const [productLabel, setProductLabel] = useState<string | null>(null);
  const refreshProductLabel = () => {
    getCurrentProduct()
      .then((r) => setProductLabel(r.current?.productLabel ?? null))
      .catch(() => {});
  };
  useEffect(() => {
    refreshProductLabel();
  }, []);
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
    // `sub` must be cleared with the view. navigate() merges into the current
    // route, so without this a sub-tab key leaks across screens — going
    // Records -> Weight produced ?v=weight&sub=reject, naming a tab that does
    // not exist there. Clearing it lets the section column fall back to its
    // own first tab.
    navigate({ view: v, sub: undefined, detailType: undefined, detailId: undefined });
  };

  /** Follow a finding to the page that explains it, carrying the reason. */
  const followException = (e: Exception) => {
    setNavContext({
      fromView: view,
      fromLabel: VIEW_LABEL[view],
      title: e.title,
      detail: e.because,
    });
    navigate({ view: e.view, sub: e.sub, detailType: undefined, detailId: undefined });
  };

  const openRegisterDetail = (detailType: RegisterType, detailId: string | number) =>
    navigate({ view: 'register', detailType, detailId: String(detailId) });
  const closeRegisterDetail = () => navigate({ view: 'register', detailType: undefined, detailId: undefined });

  const navigateToRegister = (seed: RegisterSeed) => {
    setRegisterSeed(seed);
    setView('register');
  };

  useEffect(() => {
    if (!range.min || !range.max) return;
    let cancelled = false;
    Promise.all([
      getProduction({ from: range.min, to: range.max, groupBy: 'none' }),
      getRejects(range.min, range.max),
    ])
      .then(([p, rj]) => {
        if (cancelled) return;
        const row = p.data.rows[0];
        setCounts({
          cones: row?.cones ?? 0,
          sacks: row?.sacks ?? 0,
          rejects: rj.data.total,
          stations: 14,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [range.min, range.max]);

  useEffect(() => {
    getRange()
      .then((r) => setRange({ min: r.minDate, max: r.maxDate }))
      .catch((e) => setRangeErr(String(e.message ?? e)));
  }, []);

  const doLogout = async () => {
    await apiLogout().catch(() => {});
    onLogout();
  };

  // Route guard. Hiding a rail button is decluttering; this is what stops a
  // typed ?v=weight rendering for an operator. The API enforces the same ranks
  // server-side — this keeps a role out of a screen, it is not the data control.
  const allowed = canOpen(view, rank);
  const section = sectionFor(view, counts);
  // One value drives the column highlight, the hub content and the URL.
  const activeSub = route.sub ?? section.subTabs[0]?.key ?? '';
  const goSub = (k: string) => navigate({ sub: k });

  return (
    <AppShell
      view={view}
      rank={rank}
      user={user}
      freshness={freshness}
      productLabel={productLabel}
      section={section}
      sub={activeSub}
      onNavigate={(v) => setView(v)}
      onSub={goSub}
      onSignOut={doLogout}
      onOpenSync={() => setView('operations')}
    >
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
      {!allowed ? (
        <div className="error-card" role="alert">
          <b>You don't have access to this view.</b> Your role ({user.role}) can't open{' '}
          {VIEW_LABEL[view]}. Pick another section from the rail.
        </div>
      ) : rangeErr ? (
        <div className="error-card" role="alert"><b>Couldn't reach the API.</b> {rangeErr}</div>
      ) : view === 'dashboard' ? (
        <DashboardView
          range={range}
          onMeta={setFreshness}
          rank={rank}
          onNavigate={followException}
          onSeeAllExceptions={() => navigate({ view: 'exceptions', sub: undefined, detailType: undefined, detailId: undefined })}
          onOpenTimeline={() => navigate({ view: 'timeline', sub: undefined, detailType: undefined, detailId: undefined })}
          onProductChanged={refreshProductLabel}
        />
      ) : view === 'register' ? (
        <RegisterView
          range={range}
          seed={registerSeed}
          detail={route.detailType && route.detailId ? { type: route.detailType, id: route.detailId } : null}
          onOpenDetail={openRegisterDetail}
          onCloseDetail={closeRegisterDetail}
          onSeeStation={() => navigate({ view: 'weight', sub: 'spread', detailType: undefined, detailId: undefined })}
          sub={activeSub}
          rank={rank}
        />
      ) : view === 'performance' ? (
        <PerformanceHub range={range} onMeta={setFreshness} onInspect={navigateToRegister} sub={activeSub} />
      ) : view === 'weight' ? (
        <WeightHub range={range} onMeta={setFreshness} onInspect={navigateToRegister} sub={activeSub} />
      ) : view === 'shift' ? (
        <ShiftView range={range} onMeta={setFreshness} sub={activeSub} />
      ) : view === 'rejects' ? (
        <RejectsHub range={range} onMeta={setFreshness} rank={rank} sub={activeSub} />
      ) : view === 'operations' ? (
        <OperationsView onMeta={setFreshness} />
      ) : view === 'exceptions' ? (
        <ExceptionsView range={range} onMeta={setFreshness} onNavigate={followException} />
      ) : view === 'timeline' ? (
        <TimelineView />
      ) : (
        <AdminView sub={activeSub} onMeta={setFreshness} />
      )}
    </AppShell>
  );
}

/* ---------------- Consolidated nav hubs (Phase 2 — 10 nav items -> 7) ----------------
 * Each hub is a thin sub-tab wrapper around two previously-separate top-level
 * pages that answered the same underlying question. No page logic changed —
 * only where it lives in the nav. */

/**
 * Route key <-> hub key maps.
 *
 * The section column and these hubs were built at different times and named the
 * same tabs differently ('stops' vs 'downtime', 'spread' vs 'distribution',
 * 'reasons' vs 'pareto'). While each hub kept its own useState the mismatch was
 * invisible AND fatal: clicking a column tab changed the URL and the highlight
 * but never the content, because the hub seeded its state once and ignored the
 * route afterwards.
 *
 * The route key is the single source of truth — it is what a permalink carries,
 * so it uses the design's user-facing names. Each hub maps it onto its own
 * internal union rather than being renamed throughout. The hubs are read-only
 * consumers: the section column is the only control that writes `sub`.
 */
const PERF_SUB = { oee: 'oee', stops: 'downtime', patterns: 'patterns' } as const;
const WEIGHT_SUB = { spread: 'distribution', stability: 'spc' } as const;
const REJECT_SUB = { reasons: 'pareto', trend: 'trend', station: 'station' } as const;

function PerformanceHub({
  range,
  onMeta,
  onInspect,
  sub: routeSub,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  onInspect: (seed: RegisterSeed) => void;
  sub: string;
}) {
  const sub = PERF_SUB[routeSub as keyof typeof PERF_SUB] ?? 'oee';
  return (
    <>
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

/**
 * Weight screen. The hub owns the data layer because the design puts one
 * verdict banner above BOTH sub-tabs, and because the Spread tab needs the SPC
 * station data that only this fetch provides.
 *
 * The section column is the tab control now, so the hub renders no Segmented of
 * its own — the old one duplicated the column and used different keys.
 */
function WeightHub({
  range,
  onMeta,
  onInspect,
  sub: routeSub,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  onInspect: (seed: RegisterSeed) => void;
  sub: string;
}) {
  const sub = WEIGHT_SUB[routeSub as keyof typeof WEIGHT_SUB] ?? 'distribution';

  const [type, setType] = useState<SpcType>('cone');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [specMode, setSpecMode] = useState<SpcMode>('none');
  const [productId, setProductId] = useState('');
  const [manualUsl, setManualUsl] = useState('');
  const [manualLsl, setManualLsl] = useState('');
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [spc, setSpc] = useState<SpcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Lifted out of the Spread tab: the verdict needs the setpoint this call
  // carries. /api/spc's spec is null until the user picks a tolerance, but the
  // current product always has a setpoint, and a banner that says "no setpoint"
  // directly above a panel measuring against one is just wrong.
  const [basis, setBasis] = useState<Basis>('as_recorded');
  const [weights, setWeights] = useState<WeightsData | null>(null);
  const [dailyCones, setDailyCones] = useState<number[] | null>(null);
  const [wErr, setWErr] = useState<string | null>(null);

  useEffect(() => {
    getProducts().then((r) => setProducts(r.products)).catch(() => {});
  }, []);

  // Product setpoints are cone grams; they cannot describe a sack. The API
  // refuses them for sacks, so the picker must not keep claiming one is active.
  useEffect(() => {
    if (type === 'sack' && specMode === 'product') {
      setSpecMode('none');
      setProductId('');
    }
  }, [type, specMode]);

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
        setSpc(r.data);
        onMeta(r.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [type, from, to, specMode, productId, manualUsl, manualLsl, onMeta]);

  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    setWErr(null);
    Promise.all([getWeights(basis, from, to), getProduction({ from, to, groupBy: 'day' })])
      .then(([r, p]) => {
        if (cancelled) return;
        setWeights(r.data);
        setDailyCones(p.data.rows.filter((x) => x.group !== 'total').map((x) => x.cones));
      })
      .catch((e) => !cancelled && setWErr(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [basis, from, to]);

  const unit = type === 'cone' ? 'g' : 'kg';

  return (
    <>
      <div className="wt-controls">
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
          <label>Tolerance (for Cp/Cpk)</label>
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
              {type === 'cone' &&
                products.map((p) => (
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
        <div className="error-card" role="alert"><b>Couldn't load weight analysis.</b> {error}</div>
      ) : loading || !spc ? (
        <>
          <div className="sk sk-verdict" />
          <div className="sk sk-chart" style={{ marginTop: 14 }} />
        </>
      ) : (
        <>
          <WeightVerdict spc={spc} unit={unit} type={type} weights={weights} />
          {sub === 'spc' ? (
            <WeightStability spc={spc} unit={unit} type={type} from={from} to={to} onInspect={onInspect} />
          ) : (
            <WeightSpread
              spc={spc}
              unit={unit}
              type={type}
              from={from}
              to={to}
              onInspect={onInspect}
              basis={basis}
              onBasis={setBasis}
              weights={weights}
              dailyCones={dailyCones}
              wErr={wErr}
            />
          )}
        </>
      )}
    </>
  );
}

/**
 * The screen's verdict, above both tabs.
 *
 * Every figure is computed. The design's banner reads "Cones run 8.5 g light of
 * the 1 960 g setpoint" with a Cpk of 0.57 beside it, and neither can be printed
 * unconditionally here:
 *
 *  - Capability is null until someone picks a tolerance. The screen loads with
 *    specMode 'none', so Cp/Cpk/Pp/Ppk are all null on first paint. A banner
 *    that leads with Cpk would show a blank on the default view of the page.
 *  - Without a tolerance there is no setpoint to be "light of" either, so the
 *    sentence degrades to the mean alone rather than inventing a target.
 *
 * The mean and sigma come from /api/spc, which measures AS-RECORDED weights —
 * it has no gross/net basis. The basis toggle on the Spread tab moves the
 * histogram but not this banner, so the banner says which basis it is on.
 */
function WeightVerdict({
  spc,
  unit,
  type,
  weights,
}: {
  spc: SpcData;
  unit: string;
  type: SpcType;
  weights: WeightsData | null;
}) {
  const noun = type === 'cone' ? 'Cones' : 'Sacks';
  // Two setpoints exist and they are not the same mechanism. /api/spc's is the
  // tolerance the user picked in the control above (null until they pick one);
  // /api/weights' is the setpoint of the product the Process Engineer has
  // currently set, which is always present. Prefer the explicit choice, fall
  // back to the current product, and say which one is on screen — the screen
  // used to claim "no setpoint" while the panel beneath it measured against one.
  const productNominal = type === 'cone' ? weights?.cone.nominalSetpointG ?? null : null;
  const nominal = spc.spec.nominal ?? productNominal;
  const nominalIsChosen = spc.spec.nominal != null;
  const productLabel = weights?.cone.nominalLabel ?? null;
  const delta = nominal != null ? spc.mean - nominal : null;
  const off = delta != null ? Math.abs(round1(delta)) : null;

  // "light" vs "heavy" is the whole point of the sentence, so it is only ever
  // printed when there is a real tolerance to be light or heavy OF.
  const headline =
    nominal != null && off != null
      ? off < 0.05
        ? `${noun} sit on the ${nominal}${unit} setpoint`
        : `${noun} run ${off}${unit} ${delta! < 0 ? 'light' : 'heavy'} of the ${nominal}${unit} setpoint`
      : `${noun} average ${spc.mean}${unit} across ${fmtInt(spc.count)} readings`;

  const flagged = spc.flaggedStationCount;
  const oocPct = spc.subgroups.length > 0 ? Math.round((100 * spc.xbarOutOfControl) / spc.subgroups.length) : 0;
  const spread = `Spread is ${spc.stdevWithin}${unit} within subgroups.`;
  const stationBit =
    spc.stations.length === 0
      ? ''
      : flagged > 0
        ? ` ${flagged} of ${spc.stations.length} stations ${flagged === 1 ? 'sits' : 'sit'} past the action threshold.`
        : ' No station is past the action threshold.';
  // Where the setpoint came from is load-bearing: measured against the current
  // product, not a confirmed tolerance, means capability is still unavailable.
  const sourceBit =
    nominal == null
      ? ' No setpoint is available, so there is nothing to measure against.'
      : nominalIsChosen
        ? ''
        : ` Measured against the current product${productLabel ? ` (${productLabel})` : ''}; pick a tolerance above for capability.`;
  const support = `${spread}${stationBit}${sourceBit}`;

  return (
    <section className="verdict-card">
      <div className="vc-main">
        <div className="vc-eyebrow">Verdict</div>
        <h2 className="vc-headline">{headline}</h2>
        <p className="vc-support">{support}</p>
      </div>
      <div className="vc-stats">
        <div className="vc-stat">
          <div className="vcs-val">{spc.mean}<span className="vcs-u">{unit}</span></div>
          <div className="vcs-key">mean</div>
        </div>
        <div className="vc-stat">
          <div className="vcs-val">{spc.stdevWithin}<span className="vcs-u">{unit}</span></div>
          <div className="vcs-key">spread <span className="nocaps">σ</span></div>
        </div>
        {spc.capability.cpk != null ? (
          <div className="vc-stat">
            <div className={`vcs-val ${capClass(spc.capability.cpk)}`}>{spc.capability.cpk}</div>
            <div className="vcs-key">cpk</div>
          </div>
        ) : (
          <div className="vc-stat">
            <div className="vcs-val muted">—</div>
            <div className="vcs-key">cpk · no tolerance</div>
          </div>
        )}
        <div className="vc-stat">
          <div className={`vcs-val ${spc.xbarOutOfControl > 0 ? 'bad' : ''}`}>{oocPct}<span className="vcs-u">%</span></div>
          <div className="vcs-key">groups out</div>
        </div>
      </div>
    </section>
  );
}

function RejectsHub({
  range,
  onMeta,
  rank,
  sub: routeSub,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  rank: number;
  sub: string;
}) {
  const sub = REJECT_SUB[routeSub as keyof typeof REJECT_SUB] ?? 'pareto';
  return (
    <>
      {sub === 'pareto' ? (
        <RejectView onMeta={onMeta} rank={rank} range={range} />
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
    const weightById = new Map(weightStations.map((w) => [w.station, w]));
    const worst = flagged[0] ?? null;
    const ratio = worst && pooledRate > 0 ? worst.mean / (pooledRate * 100) : null;
    return {
      stations,
      pooledRatePct: round1(pooledRate * 100),
      practicalPct: round1(practicalPct),
      flagged,
      crossRef,
      worst,
      worstRatio: ratio != null ? Math.round(ratio * 10) / 10 : null,
      worstWeight: worst ? weightById.get(worst.station) ?? null : null,
      weightFlagged: weightStations.filter((s) => s.flagged).map((s) => s.station),
    };
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
        <div className="sk sk-chart" />
      ) : (
        <>
          {/* The design's signature card reads "Station 5 is both 24 g light and
              rejecting 1.9x the line" — a station that is flagged on weight AND
              on rejects. That cross-reference is empty on this data (rejects
              flag stations 4 and 5; weight flags 10 and 13), so the card states
              which of the three cases actually holds. The empty case is the
              useful one: knowing the worst rejecter's weight is NORMAL rules
              out a calibration cause and points at threading or tube handling. */}
          <section className="fixfirst">
            <div className="ff-eyebrow">The one to fix first</div>
            {analysis.crossRef.length > 0 ? (
              <>
                <h2 className="ff-headline">
                  Station {analysis.crossRef[0]!.station} is both off-target on weight and rejecting{' '}
                  {analysis.crossRef[0]!.mean}% against the line's {analysis.pooledRatePct}%
                </h2>
                <p className="ff-sub">
                  Weight bias and reject rate on the same station is a machine problem, not measurement noise.
                  {analysis.crossRef.length > 1 && ` ${analysis.crossRef.length - 1} other station also shows both.`}
                </p>
              </>
            ) : analysis.worst ? (
              <>
                <h2 className="ff-headline">
                  Station {analysis.worst.station} rejects {analysis.worstRatio}× the line —{' '}
                  {analysis.worst.mean}% against {analysis.pooledRatePct}%
                </h2>
                <p className="ff-sub">
                  Its weight is not off:{' '}
                  {analysis.worstWeight
                    ? `station ${analysis.worst.station} sits ${analysis.worstWeight.delta > 0 ? '+' : ''}${analysis.worstWeight.delta}g from the line average, inside the action band`
                    : 'no weight bias is flagged for it'}
                  . No station is flagged on both weight and rejects
                  {analysis.weightFlagged.length > 0 && `, and the weight-flagged ones are ${analysis.weightFlagged.join(' and ')}`}
                  {' '}— so this is not a scale or calibration fault, and the cause is somewhere in how that position
                  threads or handles tubes.
                </p>
              </>
            ) : (
              <>
                <h2 className="ff-headline">No station rejects meaningfully more than the line</h2>
                <p className="ff-sub">
                  All {analysis.stations.length} sit inside the ±{analysis.practicalPct}pt band around the{' '}
                  {analysis.pooledRatePct}% line baseline. Rejects on this line are not a station problem.
                </p>
              </>
            )}
          </section>

          <div className="panel">
            <div className="panel-head">
              <h3 className="panel-title">Reject rate by station</h3>
              <span>
                <span className="sub">{from === to ? from : `${from} to ${to}`}</span>
                <ExportCsv
                  name={csvName('reject-rate-by-station', from, to)}
                  headers={['station', 'n_total', 'reject_rate_pct', 'delta_vs_line_pt', 'statistically_distinguishable', 'flagged_actionable']}
                  rows={() => analysis.stations.map((st) => [st.station, st.n, st.mean, st.delta, st.distinguishable, st.flagged])}
                />
              </span>
            </div>
            <div className="panel-lede">
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

/**
 * Login. Two panes: the plant on --ink, the form on --paper.
 *
 * The design's left pane carries three live figures — "142,511 cones on record",
 * "5,462 sacks packed", "14 stations". The first two are NOT built here, and
 * deliberately: this page renders before authentication, /api is gated at
 * operator+, and the app is tunnelled publicly for demos. Wiring live production
 * volumes into an unauthenticated page would tell anyone who reaches the login
 * screen how much the line makes. Hardcoding them instead would break this
 * rework's one rule and go stale the moment the sync runs.
 *
 * What is shown instead is true without disclosing anything: fixed properties of
 * the line, and a live plant-link state from /api/health, which is public by
 * design and returns only {status, db}.
 */
function LoginScreen({ onLogin }: { onLogin: (u: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<'checking' | 'up' | 'down'>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => !cancelled && setLink(j?.db === 'up' ? 'up' : 'down'))
      .catch(() => !cancelled && setLink('down'));
    return () => {
      cancelled = true;
    };
  }, []);

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
    <div className="login">
      <div className="login-plant">
        <div className="lp-mark">
          <span className="lpm-name">SMS</span>
          <span className="lpm-line">TP1 · Line 3 · Unit 2</span>
        </div>

        <div>
          <h1 className="lp-headline">Sack Management System</h1>
          <p className="lp-lede">
            Every cone and every sack weighed on the line, read straight from the plant server.
          </p>
          <div className="lp-facts">
            <div className="lp-fact">
              <div className="lpf-v">14</div>
              <div className="lpf-k">winding stations</div>
            </div>
            <div className="lp-fact">
              <div className="lpf-v">3</div>
              <div className="lpf-k">shifts a day</div>
            </div>
            <div className="lp-fact">
              <div className="lpf-v">60s</div>
              <div className="lpf-k">sync interval</div>
            </div>
          </div>
        </div>

        <div className="lp-link">
          <span className={`dot ${link === 'up' ? 'ok' : link === 'down' ? 'crit' : 'warn'}`} />
          {link === 'up' ? 'plant link online' : link === 'down' ? 'plant link unreachable' : 'checking plant link…'}
        </div>
      </div>

      <div className="login-form">
        <form className="lf-card" onSubmit={submit}>
          <div className="lf-eyebrow">Sign in</div>
          <h2 className="lf-title">Plant account</h2>

          <label className="lf-label" htmlFor="login-user">Username</label>
          <input
            id="login-user"
            className="lf-input"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />

          <label className="lf-label" htmlFor="login-pass">Password</label>
          <input
            id="login-pass"
            className="lf-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className="lf-submit" type="submit" disabled={busy || !username || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          {err && <div className="lf-err" role="alert">{err}</div>}

          <p className="lf-note">
            Supervisors and above can set the running product. Operators get read-only screens.
          </p>
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

/**
 * Synthesises the day's findings from data every hub already fetches — no new
 * endpoint, just reading across SPC, downtime and reject-episode results that
 * were already loaded for that day's charts. Pulled out of DashboardView as a
 * pure function (was a useMemo body there) so the Overview's "Needs a look"
 * panel and the standalone Exceptions view compute identically off the same
 * inputs — one finding can never disagree with itself between the two places
 * it is shown, because there is only one implementation of "what counts".
 */
function computeExceptions(
  spc: SpcData | null,
  downtime: DowntimeData | null,
  baselineAvailability: number | null,
  rejectSpc: RejectSpcData | null,
  date: string,
): Exception[] {
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
        sub: 'spread', // the per-station chart lives on Spread
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
        sub: 'stability', // the control chart is on Stability
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
        sub: 'stops',
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
      const xs = root.getPropertyValue('--fs-caption').trim();
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


function DashboardView({
  range,
  onMeta,
  rank,
  onNavigate,
  onSeeAllExceptions,
  onOpenTimeline,
  onProductChanged,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  rank: number;
  onNavigate: (e: Exception) => void;
  onSeeAllExceptions: () => void;
  onOpenTimeline: () => void;
  onProductChanged: () => void;
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



  const exceptions = useMemo(
    () => computeExceptions(spc, downtime, baselineAvailability, rejectSpc, date),
    [spc, downtime, baselineAvailability, rejectSpc, date],
  );
  // ---- derived presentation values -------------------------------------
  // The design's copy quotes fixed numbers ("7 stops", "Night runs 15% behind").
  // Every one of them is computed here instead: several are simply false for
  // this plant, and the emphasis (alarm colour, which shift is called out)
  // follows the computed answer rather than the prototype's assumption.
  const dayLabel = date
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
        weekday: 'long', day: 'numeric', month: 'long',
      })
    : '';

  const ribbon = useMemo(() => {
    if (!downtime?.firstTs || !downtime.lastTs) return null;
    const t0 = new Date(downtime.firstTs).getTime();
    const span = Math.max(1, new Date(downtime.lastTs).getTime() - t0);
    const blocks = downtime.stoppages.map((s) => ({
      left: ((new Date(s.startTs).getTime() - t0) / span) * 100,
      // a 2-minute stop on a 24-hour axis is 0.14% wide and would vanish; the
      // design floors it so every stop stays visible and hoverable
      width: Math.max(0.45, ((s.durationSeconds * 1000) / span) * 100),
      seconds: s.durationSeconds,
      startTs: s.startTs,
    }));
    const longest = [...downtime.stoppages].sort((a, b) => b.durationSeconds - a.durationSeconds)[0] ?? null;

    // Shift bands are placed from the real 14:00 and 22:00 boundaries, not by
    // cutting the ribbon into thirds. They only coincide on a full 24h day that
    // starts at 06:00; on a short day (line down at start of shift, or today
    // still running) thirds would put the dividers — and the shift labels —
    // over the wrong stretch of the ribbon and quietly misattribute stoppages.
    const pctAt = (d: Date) => ((d.getTime() - t0) / span) * 100;
    // Built in UTC, like every other timestamp on this screen: the plant's wall
    // clock is stamped as UTC in the source data, which is why format.ts renders
    // with timeZone 'UTC'. Constructing these boundaries in the browser's local
    // zone instead put them five hours out on a UTC+5 machine.
    const bounds = [14, 22].map((h) => pctAt(new Date(`${date}T${String(h).padStart(2, '0')}:00:00Z`)));
    const edges = [0, ...bounds, 100];
    const bands = ['Morning', 'Evening', 'Night']
      .map((name, i) => ({
        name,
        // clamp so a band that is only partly on screen still labels its
        // visible portion rather than drifting off the end
        centre: (Math.max(0, edges[i]!) + Math.min(100, edges[i + 1]!)) / 2,
        visible: Math.min(100, edges[i + 1]!) - Math.max(0, edges[i]!) > 6,
      }))
      .filter((b) => b.visible);

    return {
      blocks,
      longest,
      dividers: bounds.filter((p) => p > 0 && p < 100),
      bands,
      runSeconds: downtime.totalRunSeconds,
      downSeconds: downtime.totalDownSeconds,
    };
  }, [downtime, date]);

  const kpiCards = useMemo(() => {
    const row = kpi?.data.rows[0];
    if (!row) return [];
    const cones = row.cones ?? 0;
    const rejected = row.rejectedCones ?? 0;
    const sacks = row.sacks ?? 0;
    const kg = row.sackWeightKg ?? 0;
    const weighed = cones + rejected;
    const series = (pick: (r: ProductionRow) => number) => trend.map(pick);
    return [
      {
        key: 'cones', label: 'Total cones', value: fmtInt(cones), unit: '', alarm: false,
        foot: row.conesInRangePct != null ? `${row.conesInRangePct}% in weight range` : '—',
        series: series((r) => r.cones ?? 0),
      },
      {
        key: 'rejected', label: 'Rejected cones', value: fmtInt(rejected), unit: '', alarm: true,
        foot: weighed > 0 ? `${((100 * rejected) / weighed).toFixed(2)}% of all weighed` : '—',
        series: series((r) => r.rejectedCones ?? 0),
      },
      {
        key: 'sacks', label: 'Total sacks', value: fmtInt(sacks), unit: '', alarm: false,
        foot: sacks > 0 ? `${(cones / sacks).toFixed(1)} cones per sack` : '—',
        series: series((r) => r.sacks ?? 0),
      },
      {
        key: 'kg', label: 'Sack weight', value: fmtInt(Math.round(kg)), unit: 'kg', alarm: false,
        foot: sacks > 0 ? `${(kg / sacks).toFixed(1)} kg average` : '—',
        series: series((r) => r.sackWeightKg ?? 0),
      },
    ];
  }, [kpi, trend]);

  // Which shift actually trails, and by how much. The design hardcodes night;
  // on this line night is the strongest and morning the weakest, so the callout
  // and the alarm bar are driven by the data.
  const shiftBars = useMemo(() => {
    const rows = (byShift?.rows ?? []).filter((r) => r.group !== 'total');
    if (rows.length === 0) return null;
    const order: readonly string[] = SHIFT_ORDER;
    const sorted = [...rows].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    const max = Math.max(1, ...sorted.map((r) => r.cones ?? 0));
    const worst = [...sorted].sort((a, b) => (a.cones ?? 0) - (b.cones ?? 0))[0]!;
    const others = sorted.filter((r) => r.group !== worst.group);
    const otherAvg = others.length ? others.reduce((s, r) => s + (r.cones ?? 0), 0) / others.length : 0;
    const behindPct = otherAvg > 0 ? Math.round((100 * (otherAvg - (worst.cones ?? 0))) / otherAvg) : 0;
    // Comparing shifts needs at least two of them. The last day in the data set
    // is a part-day with only a morning shift, and the three-shift sentence read
    // as a finding about shifts that never ran.
    return {
      rows: sorted,
      max,
      worst: worst.group,
      behindPct,
      comparable: sorted.length > 1,
      others: others.map((r) => r.group),
    };
  }, [byShift]);

  return (
    <>
      <header className="ov-head">
        <div>
          <div className="eyebrow">Production day · last complete</div>
          <h2 className="ov-day">{dayLabel || '—'}</h2>
        </div>
        <div className="ov-head-controls">
          <input
            type="date"
            className="ov-date"
            aria-label="Production date"
            value={date}
            min={range.min ?? undefined}
            max={range.max ?? undefined}
            onChange={(e) => setDate(e.target.value)}
          />
          <Segmented
            value={shift}
            onChange={setShift}
            options={SHIFTS.map((s) => ({
              key: s,
              label: s === 'all' ? 'All shifts' : s[0]!.toUpperCase() + s.slice(1),
            }))}
          />
        </div>
      </header>

      {error ? (
        <div className="error-card" role="alert"><b>Couldn't load production data.</b> {error}</div>
      ) : loading || !downtime ? (
        <div className="sk sk-ribbon" />
      ) : (
        <>
          <CurrentProductBar rank={rank} onOpenTimeline={onOpenTimeline} onProductChanged={onProductChanged} />

          {/* Signature: the day as one 24-hour band of running and stopped. */}
          <section className="panel ribbon-panel">
            <div className="ribbon-head">
              <div>
                <div className="verdict">
                  Line ran {fmtDuration(ribbon?.runSeconds ?? 0)} of {fmtDuration((ribbon?.runSeconds ?? 0) + (ribbon?.downSeconds ?? 0))}
                </div>
                <div className="verdict-sub">
                  {downtime.stoppageCount === 0 ? (
                    'No stops detected on this day.'
                  ) : (
                    <>
                      {fmtInt(downtime.stoppageCount)} stop{downtime.stoppageCount === 1 ? '' : 's'}
                      {ribbon?.longest && (
                        <> · longest {fmtDuration(ribbon.longest.durationSeconds)} at {fmtTime(ribbon.longest.startTs)}</>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="ribbon-stats">
                <div className="rs">
                  <span className="rs-label">Availability</span>
                  <span className={`rs-val${(downtime.availabilityPct ?? 100) < (baselineAvailability ?? 100) - 5 ? ' alarm' : ''}`}>
                    {downtime.availabilityPct ?? '—'}%
                  </span>
                </div>
                <div className="rs">
                  <span className="rs-label">Between stops</span>
                  <span className="rs-val">{fmtDuration(downtime.mtbfSeconds)}</span>
                </div>
                <div className="rs">
                  <span className="rs-label">To restart</span>
                  <span className="rs-val">{fmtDuration(downtime.mttrSeconds)}</span>
                </div>
              </div>
            </div>

            <div className="ribbon">
              {ribbon?.blocks.map((b, i) => (
                <span
                  key={i}
                  className="ribbon-stop"
                  style={{ left: `${b.left}%`, width: `${b.width}%` }}
                  title={`${fmtDuration(b.seconds)} from ${fmtTime(b.startTs)}`}
                />
              ))}
              {ribbon?.dividers.map((p, i) => (
                <span key={i} className="ribbon-div" style={{ left: `${p}%` }} />
              ))}
            </div>
            <div className="ribbon-axis">
              <span className="ra-end start">{downtime.firstTs ? fmtTime(downtime.firstTs) : '—'}</span>
              {ribbon?.bands.map((b) => (
                <span key={b.name} className="ra-band" style={{ left: `${b.centre}%` }}>{b.name}</span>
              ))}
              <span className="ra-end finish">{downtime.lastTs ? fmtTime(downtime.lastTs) : '—'}</span>
            </div>
          </section>

          <div className="kpis">
            {kpiCards.map((c) => (
              <section className="kpi" key={c.key}>
                <div className="kpi-label">{c.label}</div>
                <div className={`kpi-value${c.alarm ? ' alarm' : ''}`}>
                  {c.value}
                  {c.unit && <span className="kpi-unit">{c.unit}</span>}
                </div>
                <div className="kpi-foot">{c.foot}</div>
                <Spark points={c.series} alarm={c.alarm} />
              </section>
            ))}
          </div>

          <div className="ov-grid">
            <section className="panel">
              <div className="panel-head">
                <h3 className="panel-title">Needs a look</h3>
                <span className="ov-findings-actions">
                  <span className="mono-note">{exceptions.length} open</span>
                  <button type="button" className="rr-link" onClick={onSeeAllExceptions}>
                    See all · change date →
                  </button>
                </span>
              </div>
              {exceptions.length === 0 ? (
                <div className="empty-note">
                  Nothing flagged — weight, rejects and availability are all inside their normal range today.
                </div>
              ) : (
                <div className="findings">
                  {exceptions.map((e, i) => (
                    <button
                      key={i}
                      type="button"
                      className="finding"
                      onClick={() => onNavigate(e)}
                      aria-label={`${e.severity}: ${e.title}. Opens ${VIEW_LABEL[e.view]}.`}
                    >
                      <span className={`f-sev ${e.severity}`} aria-hidden="true" />
                      <span className="f-body">
                        <span className="f-title">{e.title}</span>
                        <span className="f-detail">{e.message}</span>
                      </span>
                      <span className="f-go" aria-hidden="true">›</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="panel-foot">Each one opens the page that explains it.</div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h3 className="panel-title">Cones by shift</h3>
              </div>
              {!shiftBars ? (
                <div className="empty-note">No shift data for this day.</div>
              ) : (
                <>
                  <div className="shiftbars">
                    {shiftBars.rows.map((r) => (
                      <div className="sb-row" key={r.group}>
                        <span className="sb-name">{r.group}</span>
                        <span className="sb-track">
                          <span
                            className={`sb-fill${r.group === shiftBars.worst ? ' alarm' : ''}`}
                            style={{ width: `${(100 * (r.cones ?? 0)) / shiftBars.max}%` }}
                          />
                        </span>
                        <span className="sb-val">{fmtInt(r.cones ?? 0)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="panel-foot">
                    {!shiftBars.comparable ? (
                      <>Only the <b className="cap">{shiftBars.worst}</b> shift ran on this day — nothing to compare it against.</>
                    ) : shiftBars.behindPct > 0 ? (
                      <>
                        <b className="cap">{shiftBars.worst}</b> runs {shiftBars.behindPct}% behind{' '}
                        {shiftBars.others.length > 1 ? 'the other two' : <span className="cap">{shiftBars.others[0]}</span>} on this day.
                      </>
                    ) : (
                      <>
                        All {shiftBars.rows.length === 2 ? 'both' : 'three'} shifts ran within a percent of each other on this day.
                      </>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Exceptions — the standalone version of Overview's "Needs a look" panel.
 *
 * Reachable via the "See all · change date" link on Overview, not a rail icon
 * (same precedent as Sync/`operations`, which also has no rail item). What it
 * adds over the embedded panel: any day, not just yesterday, and severity /
 * screen filters. What it does NOT add: persistence. Findings are recomputed
 * live from the same four already-existing endpoints computeExceptions always
 * read — there is nothing to persist, because the underlying event data
 * (cone_event, downtime, reject episodes) is itself permanent, so any past
 * day's exceptions can always be recomputed exactly, not just recalled.
 */
const EXCEPTION_SEVERITIES = ['fault', 'warn', 'info'] as const;
type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];

function ExceptionsView({
  range,
  onMeta,
  onNavigate,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  onNavigate: (e: Exception) => void;
}) {
  const [date, setDate] = useState('');
  const [spc, setSpc] = useState<SpcData | null>(null);
  const [downtime, setDowntime] = useState<DowntimeData | null>(null);
  const [baselineAvailability, setBaselineAvailability] = useState<number | null>(null);
  const [rejectSpc, setRejectSpc] = useState<RejectSpcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severities, setSeverities] = useState<Set<ExceptionSeverity>>(new Set(EXCEPTION_SEVERITIES));
  const [screens, setScreens] = useState<Set<View> | null>(null); // null = all

  // Same default as Overview: the most recent day guaranteed complete, not
  // "today" mid-accumulation.
  useEffect(() => {
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
    const from7 = new Date(date);
    from7.setDate(from7.getDate() - 6);
    const trendFrom = from7.toISOString().slice(0, 10);
    const dayBefore = new Date(date);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const baselineTo = dayBefore.toISOString().slice(0, 10);
    Promise.all([
      getSpc({ type: 'cone', from: date, to: date }),
      getDowntime(date, 120),
      baselineTo >= trendFrom ? getOee({ from: trendFrom, to: baselineTo }) : Promise.resolve(null),
      getRejectSpc(trendFrom, date, 'all', 'day'),
    ])
      .then(([sp, d, base, rj]) => {
        if (cancelled) return;
        setSpc(sp.data);
        setDowntime(d.data);
        setBaselineAvailability(base?.data.availabilityPct ?? null);
        setRejectSpc(rj.data);
        onMeta(sp.metadata);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [date, onMeta]);

  const all = useMemo(
    () => computeExceptions(spc, downtime, baselineAvailability, rejectSpc, date),
    [spc, downtime, baselineAvailability, rejectSpc, date],
  );

  // Which screens actually appear as a target today, in the order they're
  // first seen — the filter only ever offers choices that could do something.
  const availableScreens = useMemo(() => {
    const seen: View[] = [];
    for (const e of all) if (!seen.includes(e.view)) seen.push(e.view);
    return seen;
  }, [all]);

  const filtered = all.filter((e) => severities.has(e.severity) && (screens == null || screens.has(e.view)));

  const toggleSeverity = (s: ExceptionSeverity) =>
    setSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const toggleScreen = (v: View) =>
    setScreens((prev) => {
      const base = prev ?? new Set(availableScreens);
      const next = new Set(base);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      // If toggling landed back on "every screen available today", collapse to
      // null rather than keep an explicit set that happens to match today's
      // full list. Without this, off-then-on did not round-trip: it left an
      // explicit {'weight'} behind that then wrongly filtered tomorrow's
      // findings on a screen 'weight' never restricted, the moment a different
      // day surfaced a Rejects or Output finding this set didn't contain.
      if (availableScreens.length > 0 && availableScreens.every((s) => next.has(s))) return null;
      return next;
    });

  const bySeverity = useMemo(() => {
    const counts: Record<ExceptionSeverity, number> = { fault: 0, warn: 0, info: 0 };
    for (const e of all) counts[e.severity]++;
    return counts;
  }, [all]);

  return (
    <>
      <div className="ov-head">
        <div>
          <div className="eyebrow">Findings for</div>
          <h2 className="ov-day">
            {date
              ? new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
              : '—'}
          </h2>
        </div>
        <input
          type="date"
          className="ov-date"
          aria-label="Findings date"
          value={date}
          min={range.min ?? undefined}
          max={range.max ?? undefined}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {error ? (
        <div className="error-card" role="alert"><b>Couldn't load findings.</b> {error}</div>
      ) : loading ? (
        <div className="sk sk-chart" />
      ) : (
        <>
          <section className="panel">
            <div className="panel-head">
              <h3 className="panel-title">Filter</h3>
              <span className="mono-note">
                {filtered.length} of {all.length} shown
              </span>
            </div>
            <div className="exc-filter-row">
              <span className="exc-filter-label">Severity</span>
              {EXCEPTION_SEVERITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip exc-chip ${s}${severities.has(s) ? ' active' : ''}`}
                  aria-pressed={severities.has(s)}
                  onClick={() => toggleSeverity(s)}
                >
                  {s} <span className="mono-note">{bySeverity[s]}</span>
                </button>
              ))}
            </div>
            {availableScreens.length > 0 && (
              <div className="exc-filter-row">
                <span className="exc-filter-label">Screen</span>
                {availableScreens.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`chip exc-chip${(screens ?? new Set(availableScreens)).has(v) ? ' active' : ''}`}
                    aria-pressed={(screens ?? new Set(availableScreens)).has(v)}
                    onClick={() => toggleScreen(v)}
                  >
                    {VIEW_LABEL[v]}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="panel" style={{ marginTop: 14 }}>
            <div className="panel-head">
              <h3 className="panel-title">Findings</h3>
            </div>
            {all.length === 0 ? (
              <div className="empty-note">
                Nothing flagged — weight, rejects and availability were all inside their normal range this day.
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-note">{all.length} finding{all.length === 1 ? '' : 's'} this day, none matching the current filter.</div>
            ) : (
              <div className="findings">
                {filtered.map((e, i) => (
                  <button
                    key={i}
                    type="button"
                    className="finding"
                    onClick={() => onNavigate(e)}
                    aria-label={`${e.severity}: ${e.title}. Opens ${VIEW_LABEL[e.view]}.`}
                  >
                    <span className={`f-sev ${e.severity}`} aria-hidden="true" />
                    <span className="f-body">
                      <span className="f-title">{e.title}</span>
                      <span className="f-detail">{e.message}</span>
                    </span>
                    <span className="f-go" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            )}
            <div className="panel-foot">Each one opens the page that explains it.</div>
          </section>
        </>
      )}
    </>
  );
}

/**
 * Every changeover ever recorded, newest first — the history that the
 * current-product bar's "since …" line only ever hints was there. No date
 * filter: the table is a handful of rows a day, so "history" means the whole
 * thing, not a windowed report.
 */
function TimelineView() {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getProductTimeline(), getProducts()])
      .then(([t, p]) => {
        if (cancelled) return;
        setTimeline(t.timeline);
        setProducts(p.products);
      })
      .catch((e) => !cancelled && setError(String(e.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const detailFor = (productId: number) => products.find((p) => p.productId === productId) ?? null;

  return (
    <>
      <div className="ov-head">
        <div>
          <div className="eyebrow">Every recorded changeover</div>
          <h2 className="ov-day">Product history</h2>
        </div>
      </div>

      {error ? (
        <div className="error-card" role="alert"><b>Couldn't load product history.</b> {error}</div>
      ) : loading ? (
        <div className="sk sk-chart" />
      ) : (
        <section className="panel">
          <div className="panel-head">
            <h3 className="panel-title">Changeovers</h3>
            <span className="mono-note">{timeline.length} recorded</span>
          </div>
          {timeline.length === 0 ? (
            <div className="empty-note">No product has been set yet — production is unattributed (Q1).</div>
          ) : (
            <div className="tl-list">
              {timeline.map((t) => {
                const detail = detailFor(t.productId);
                return (
                  <div className="tl-row" key={t.timelineId}>
                    <span className="tl-when">
                      {new Date(t.effectiveFrom).toLocaleString()}
                    </span>
                    <span className="tl-body">
                      <span className="tl-product">
                        {t.productLabel} <span className="cp-id">#{t.productId}</span>
                      </span>
                      {detail && <ProductDetailLine p={detail} />}
                      <span className="tl-meta">
                        set by {t.changedBy ?? '—'}
                        {t.reason ? ` · ${t.reason}` : ''}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </>
  );
}




/**
 * KPI sparkline — 7 days of one measure, to the design's geometry
 * (viewBox 0 0 92 26, 1.5px stroke, baseline hairline at y=25).
 *
 * preserveAspectRatio="none" is correct HERE and nowhere else in the app: a
 * sparkline carries no <text>, so non-uniform scaling distorts nothing. Every
 * chart that does render text keeps its measured-width 1:1 viewBox, because
 * stretching those squashed the type — a bug this codebase has already had once.
 */
function Spark({ points, alarm }: { points: number[]; alarm?: boolean }) {
  const w = 92;
  const h = 26;
  const base = 25;
  if (points.length < 2) return <svg className="spark" viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden="true" />;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const d = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = base - ((v - min) / span) * (base - 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      className={`spark${alarm ? ' alarm' : ''}`}
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line className="spark-base" x1={0} y1={base} x2={w} y2={base} />
      <path className="spark-line" d={d} />
    </svg>
  );
}


const SHIFT_ORDER = ['morning', 'evening', 'night'] as const;

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


/* ---------------- Sack & Cone Register ---------------- */

const PAGE_SIZE = 25;

function RegisterView({
  range,
  seed,
  detail,
  onOpenDetail,
  onCloseDetail,
  onSeeStation,
  sub,
  rank,
}: {
  range: { min: string | null; max: string | null };
  seed: RegisterSeed | null;
  detail: { type: RegisterType; id: string } | null;
  onOpenDetail: (type: RegisterType, id: string | number) => void;
  onCloseDetail: () => void;
  onSeeStation: () => void;
  sub: string;
  rank: number;
}) {
  const [type, setType] = useState<RegisterType>(() => seed?.type ?? 'cone');
  // The section column declares Cones / Sacks / Rejects; without this they were
  // highlighted but inert, exactly as the hub tabs were before they were wired.
  useEffect(() => {
    if (sub === 'cone' || sub === 'sack' || sub === 'reject') setType(sub);
  }, [sub]);
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

  const toggleSort = (col: RegisterSort) => {
    if (sort === col) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSort(col);
      setDir('desc');
    }
  };

  // Selection drives the rail. It reads straight out of the page already in
  // memory — RegisterRow carries every field the rail shows — so picking a row
  // costs no request. The full detail page stays a real URL for permalinks.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [setpointG, setSetpointG] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCurrentProduct(), getProducts()])
      .then(([c, p]) => {
        if (cancelled || !c.current) return;
        const match = p.products.find((x) => x.productId === c.current!.productId);
        setSetpointG(match?.setpointG ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep a selection that exists: when the page changes under it, fall back to
  // the first row rather than leaving the rail showing a row that is no longer
  // in the table.
  const selected = rows.find((r) => String(r.source_row_id) === selectedId) ?? rows[0] ?? null;

  // Active filters, as the chips that replace the old nine-field grid. Each one
  // knows how to remove itself, so the chip row is the filter state rather than
  // a display of it.
  const chips = useMemo(() => {
    const out: { key: string; label: string; tone?: string; clear: () => void }[] = [];
    if (context) out.push({ key: 'ctx', label: context, clear: () => { setContext(null); setTsWindow(null); } });
    if (from || to) {
      out.push({
        key: 'date',
        label: from === to ? from : `${from || '…'} → ${to || '…'}`,
        clear: () => { setFrom(''); setTo(''); },
      });
    }
    if (shift !== 'all') out.push({ key: 'shift', label: `${shift} shift`, clear: () => setShift('all') });
    if (station) out.push({ key: 'station', label: `station ${station}`, clear: () => setStation('') });
    if (inRange !== 'all') {
      out.push({
        key: 'inRange',
        label: inRange === 'false' ? 'out of range only' : 'in range only',
        tone: inRange === 'false' ? 'alarm' : undefined,
        clear: () => setInRange('all'),
      });
    }
    if (type === 'reject' && rejectType !== 'all') {
      out.push({ key: 'rt', label: `${rejectType} rejects`, clear: () => setRejectType('all') });
    }
    if (wMin || wMax) {
      out.push({
        key: 'w',
        label: `${wMin || '…'}–${wMax || '…'} ${weightUnit}`,
        clear: () => { setWMin(''); setWMax(''); },
      });
    }
    // Only when nothing else already describes the window — otherwise this
    // repeated the context chip verbatim.
    if (tsWindow && !context) out.push({ key: 'ts', label: 'around one reading', clear: () => setTsWindow(null) });
    return out;
  }, [context, from, to, shift, station, inRange, rejectType, wMin, wMax, tsWindow, type, weightUnit]);

  // "Readings around it" — a +/-10 minute window on the selected row, which is
  // the same tsWindow the SPC and downtime drill-downs already use.
  const readingsAround = (r: RegisterRow) => {
    const t = new Date(r.production_ts_utc).getTime();
    setTsWindow({
      tsFrom: new Date(t - 10 * 60_000).toISOString(),
      tsTo: new Date(t + 10 * 60_000).toISOString(),
    });
    setContext(`readings within 10 minutes of ${fmtDateTime(r.production_ts_utc)}`);
  };

  if (detail) {
    return <RegisterDetailPage type={detail.type} id={detail.id} onBack={onCloseDetail} onOpenDetail={onOpenDetail} />;
  }

  return (
    <>
      <div className="rec-bar">
        <div className="rec-chips">
          {chips.map((c) => (
            <span className={`chip${c.tone ? ` ${c.tone}` : ''}`} key={c.key}>
              {c.label}
              <button type="button" className="chip-x" onClick={c.clear} aria-label={`Remove filter: ${c.label}`}>×</button>
            </span>
          ))}
          <button type="button" className="chip-add" onClick={() => setFiltersOpen((v) => !v)} aria-expanded={filtersOpen}>
            + filter
          </button>
          {chips.length > 0 && (
            <button type="button" className="chip-clear" onClick={clearFilters}>clear all</button>
          )}
        </div>
        <div className="rec-actions">
          <span className="mono-note">{fmtInt(total)} row{total === 1 ? '' : 's'}</span>
          {/* Manager+, matching the API guard. Hidden rather than disabled: a
              role that cannot export has no use for the control. */}
          {rank >= 3 && (
            <a className="cta" href={eventsExportUrl(query)}>Export CSV</a>
          )}
        </div>
      </div>

      {filtersOpen && (
        <div className="rec-filters">
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
              <option value="all">All shifts</option>
              <option value="morning">Morning</option>
              <option value="evening">Evening</option>
              <option value="night">Night</option>
            </select>
          </div>
          {type !== 'sack' && (
            <div className="field">
              <label>Station</label>
              <input type="number" min={1} max={14} placeholder="any" value={station} onChange={(e) => setStation(e.target.value)} />
            </div>
          )}
          {type !== 'reject' && (
            <div className="field">
              <label>Status</label>
              <select value={inRange} onChange={(e) => setInRange(e.target.value as typeof inRange)}>
                <option value="all">Any</option>
                <option value="true">In range</option>
                <option value="false">Out of range</option>
              </select>
            </div>
          )}
          {type === 'reject' && (
            <div className="field">
              <label>Reject type</label>
              <select value={rejectType} onChange={(e) => setRejectType(e.target.value as typeof rejectType)}>
                <option value="all">All</option>
                <option value="quality">Quality</option>
                <option value="weight">Weight</option>
              </select>
            </div>
          )}
          <div className="field">
            <label>Weight min ({weightUnit})</label>
            <input type="number" value={wMin} placeholder="any" onChange={(e) => setWMin(e.target.value)} />
          </div>
          <div className="field">
            <label>Weight max ({weightUnit})</label>
            <input type="number" value={wMax} placeholder="any" onChange={(e) => setWMax(e.target.value)} />
          </div>
        </div>
      )}

      {error ? (
        <div className="error-card" role="alert"><b>Couldn't load records.</b> {error}</div>
      ) : (
        <div className="rec-grid">
          <div className="rec-table">
            <div className="rt-head" role="row">
              <button type="button" className="rth sortable" onClick={() => toggleSort('time')}
                      aria-sort={sort === 'time' ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}>
                Production time <span aria-hidden="true">{sort === 'time' ? (dir === 'desc' ? '↓' : '↑') : ''}</span>
              </button>
              <span className="rth">Shift</span>
              <span className="rth">{type === 'sack' ? 'Sack' : 'Stn'}</span>
              <button type="button" className="rth sortable num" onClick={() => toggleSort('weight')}
                      aria-sort={sort === 'weight' ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}>
                Weight <span aria-hidden="true">{sort === 'weight' ? (dir === 'desc' ? '↓' : '↑') : ''}</span>
              </button>
              <span className="rth num">{type === 'reject' ? 'Reason' : 'Status'}</span>
            </div>

            {loading && rows.length === 0 ? (
              <div className="rt-empty">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="rt-empty">No records match these filters.</div>
            ) : (
              rows.map((r) => {
                const id = String(r.source_row_id);
                const isSel = selected != null && String(selected.source_row_id) === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`rt-row${isSel ? ' sel' : ''}`}
                    aria-current={isSel ? 'true' : undefined}
                    onClick={() => setSelectedId(id)}
                    onDoubleClick={() => onOpenDetail(type, r.source_row_id)}
                  >
                    <span>{fmtDateTime(r.production_ts_utc)}</span>
                    <span className="dim cap">{r.shift_code}</span>
                    <span className="dim">{type === 'sack' ? (r.sack_num ?? '—') : (r.source_station ?? '—')}</span>
                    <span className="num">
                      {/* Quality rejects carry no weight at source (rejectQCS1 has no
                          weight column), so an em dash is the honest answer rather
                          than a zero that would read as "weighed nothing". */}
                      {type === 'sack'
                        ? `${r.weight_kg} ${weightUnit}`
                        : r.weight_g == null
                          ? '—'
                          : `${r.weight_g} ${weightUnit}`}
                    </span>
                    <span className="num">
                      {type === 'reject' ? (
                        <RejectReasonCell row={r} />
                      ) : (
                        <span className={`pill ${r.in_range ? 'on' : 'off'}`}>{r.in_range ? 'in range' : 'out of range'}</span>
                      )}
                    </span>
                  </button>
                );
              })
            )}

            <div className="rt-pager">
              <span>
                {total === 0
                  ? 'no rows'
                  : `rows ${fmtInt((page - 1) * PAGE_SIZE + 1)}–${fmtInt(Math.min(page * PAGE_SIZE, total))} of ${fmtInt(total)}`}
              </span>
              <span className="rtp-btns">
                <button type="button" className="pgbtn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>prev</button>
                <button type="button" className="pgbtn next" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>next</button>
              </span>
            </div>
          </div>

          <RecordRail
            row={selected}
            type={type}
            weightUnit={weightUnit}
            setpointG={setpointG}
            onOpenDetail={onOpenDetail}
            onSeeStation={onSeeStation}
            onReadingsAround={readingsAround}
          />
        </div>
      )}
    </>
  );
}

/**
 * The sticky detail rail. Everything here comes from the row already loaded in
 * the table, so selection is instant and costs no request.
 *
 * Three fields are judgements rather than raw values, and each is marked when it
 * disagrees with the plant's own record: the stored shift (wrong on 4.45% of
 * rows because it is derived from insert time), the merge key (unique or
 * colliding — DQ-2), and the weight against the current product's setpoint,
 * which is an approximation because historical rows carry no product.
 */
function RecordRail({
  row,
  type,
  weightUnit,
  setpointG,
  onOpenDetail,
  onSeeStation,
  onReadingsAround,
}: {
  row: RegisterRow | null;
  type: RegisterType;
  weightUnit: string;
  setpointG: number | null;
  onOpenDetail: (type: RegisterType, id: string | number) => void;
  onSeeStation: () => void;
  onReadingsAround: (r: RegisterRow) => void;
}) {
  if (!row) {
    return (
      <aside className="rec-rail">
        <div className="rr-head">
          <div className="rr-eyebrow">Nothing selected</div>
          <div className="rr-id">—</div>
        </div>
        <div className="rr-body">
          <p className="empty-note">Pick a row to see everything recorded about it.</p>
        </div>
      </aside>
    );
  }

  const noun = type === 'cone' ? 'cone' : type === 'sack' ? 'sack' : 'reject';
  const weight = type === 'sack' ? row.weight_kg : row.weight_g;
  const shiftDisagrees = row.shift_code_legacy != null && row.shift_code_legacy !== row.shift_code;
  const vsSetpoint =
    type === 'cone' && setpointG != null && row.weight_g != null ? round1(row.weight_g - setpointG) : null;

  const fields: { k: string; v: ReactNode; tone?: string }[] = [
    { k: 'Production time', v: fmtDateTime(row.production_ts_utc) },
    { k: 'Shift (corrected)', v: <span className="cap">{row.shift_code}</span> },
    {
      k: 'Shift as stored',
      v: row.shift_code_legacy ? <span className="cap">{row.shift_code_legacy}</span> : '—',
      tone: shiftDisagrees ? 'warn' : undefined,
    },
  ];
  if (type === 'sack') {
    fields.push({ k: 'Sack number', v: row.sack_num ?? '—' });
  } else {
    fields.push({ k: 'Station', v: row.source_station ?? '—' });
  }
  if (type === 'reject') {
    fields.push({ k: 'Reject type', v: row.reject_type ?? '—' });
    fields.push({ k: 'Tube code', v: row.tube_inspect_code ?? '—' });
    fields.push({ k: 'Material code', v: row.material_inspect_code ?? '—' });
    fields.push({ k: 'Meaning', v: row.reject_label ?? 'not yet named (Q10)', tone: row.reject_label ? undefined : 'warn' });
  }
  if (weight != null) {
    fields.push({
      k: 'Weight',
      v: `${weight} ${weightUnit}`,
      tone: row.in_range === false ? 'alarm' : undefined,
    });
  }
  if (vsSetpoint != null) {
    fields.push({ k: 'Against setpoint', v: `${vsSetpoint > 0 ? '+' : ''}${vsSetpoint} g` });
  }
  if (type === 'cone') fields.push({ k: 'Hanger', v: row.hanger_num ?? '—' });
  fields.push({ k: 'Product', v: row.lot_code ?? 'not attributed', tone: row.lot_code ? undefined : 'muted' });
  fields.push({
    k: 'Merge key',
    v: row.merge_key_is_unique ? 'unique' : 'collides',
    tone: row.merge_key_is_unique ? 'ok' : 'warn',
  });
  fields.push({ k: 'Source row', v: String(row.source_id ?? row.source_row_id) });

  return (
    <aside className="rec-rail">
      <div className="rr-head">
        <div className="rr-eyebrow">Selected {noun}</div>
        <div className="rr-id">#{String(row.source_row_id)}</div>
      </div>
      <div className="rr-body">
        {fields.map((f, i) => (
          <div className="rr-row" key={i}>
            <span className="rrr-k">{f.k}</span>
            <span className={`rrr-v${f.tone ? ` ${f.tone}` : ''}`}>{f.v}</span>
          </div>
        ))}
        <div className="rr-actions">
          {type !== 'sack' && (
            <button type="button" className="cta" onClick={onSeeStation}>See its station</button>
          )}
          <button type="button" className="ghost-btn" onClick={() => onReadingsAround(row)}>Readings around it</button>
          <button type="button" className="rr-link" onClick={() => onOpenDetail(type, row.source_row_id)}>
            Open the full record →
          </button>
        </div>
      </div>
    </aside>
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
          <h3 className="panel-title">Not found</h3>
        </div>
        <div style={{ padding: '4px 0' }}>
          <p>{type === 'cone' ? 'Cone' : type === 'sack' ? 'Sack' : 'Reject'} #{id} doesn't exist, or doesn't match this line.</p>
          <button type="button" className="cta" onClick={onBack}>← Back to records</button>
        </div>
      </div>
    );
  }
  if (!row) {
    return <div className="sk sk-chart" />;
  }

  // rejects are rejected cones -> grams; only sacks are kg
  const weightUnit = type === 'sack' ? 'kg' : 'g';
  const weight = type === 'sack' ? row.weight_kg : row.weight_g;

  return (
    <>
      <button type="button" className="ghost-btn" style={{ marginBottom: 14 }} onClick={onBack}>← Back to records</button>

      <div className="panel">
        <div className="panel-head">
          <h3 className="panel-title">{type === 'cone' ? 'Cone' : type === 'sack' ? 'Sack' : 'Reject'} #{String(row.source_row_id)}</h3>
          <span className="mono-note">{fmtDateTime(String(row.production_ts_utc))}</span>
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
        <div className="rr-provenance">
        <DetailRow label="Source system" value={String(row.source_system ?? '—')} />
        <DetailRow label="Transform version" value={`v${row.transform_version ?? '—'}`} />
        {row.ingest_ts_utc != null && <DetailRow label="Synced at" value={fmtDateTime(String(row.ingest_ts_utc))} />}
        </div>
      </div>

      {subgroup && (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <h3 className="panel-title">Its subgroup</h3>
            <span className="mono-note">{spc!.bucketLabel}</span>
          </div>
          <div className="panel-lede">
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
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <h3 className="panel-title">Its station</h3>
            <span className="mono-note">station {stationStat.station}</span>
          </div>
          <div className="panel-lede">
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

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <h3 className="panel-title">Time-neighbours</h3>
          <span className="mono-note">{sourceStation != null ? `station ${sourceStation}` : 'same stream'}</span>
        </div>
        <div className="panel-lede">
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
          <div className="sk" style={{ height: 120 }} />
        ) : (
          <div className="table-scroll">
            <table className="reg-table light">
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
                      style={isCurrent ? { background: 'var(--ok-pale)', fontWeight: 650 } : undefined}
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
    <div className="rr-row">
      <span className="rrr-k">{label}</span>
      <span className={`rrr-v${mismatch ? ' warn' : ''}`}>{value}</span>
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
      // The design asserts "Stops cluster at 02:00 and 14:00". Whether stops
      // cluster at all is a property of the data, so it is tested: an hour only
      // counts as a cluster if it recurs on more days than the median hour.
      clusterHours: [...byHour]
        .filter((h) => h.days > medianDays && h.count > 0)
        .sort((a, b) => b.days - a.days || b.count - a.count)
        .slice(0, 2),
      medianDays,
      underTenPct:
        all.length > 0 ? (100 * all.filter((x) => x.durationSeconds < 600).length) / all.length : 0,
      overHourCount: all.filter((x) => x.durationSeconds >= 3600).length,
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
        <div className="sk sk-chart" />
      ) : analysis.all.length === 0 ? (
        <div className="panel-lede">No stoppages over {threshold}s in this range.</div>
      ) : (
        <>
          <section className="panel">
            <h2 className="sv-headline">
              {analysis.clusterHours.length >= 2
                ? `Stops cluster at ${hh(analysis.clusterHours[0]!.hour)} and ${hh(analysis.clusterHours[1]!.hour)}`
                : analysis.clusterHours.length === 1
                  ? `Stops cluster at ${hh(analysis.clusterHours[0]!.hour)}`
                  : 'Stops are spread evenly through the day'}
            </h2>
            <p className="sv-sub">
              {analysis.clusterHours.length > 0 ? (
                <>
                  {analysis.clusterHours.map((h) => `${hh(h.hour)} goes down on ${h.days} of ${analysis.dayCount} days`).join('; ')}.
                  The median hour goes down on {analysis.medianDays}.
                </>
              ) : (
                <>No hour of the clock recurs more than the median of {analysis.medianDays} days — there is no time-of-day pattern to chase.</>
              )}
            </p>
            <div className="loss-grid" style={{ marginTop: 20 }}>
              <div className="loss">
                <div className="loss-val">{fmtInt(analysis.all.length)}</div>
                <div className="loss-key">stops in {analysis.dayCount} days</div>
              </div>
              <div className="loss">
                <div className="loss-val">{Math.round(analysis.underTenPct)}%</div>
                <div className="loss-key">under ten minutes</div>
              </div>
              <div className="loss">
                <div className="loss-val">{fmtInt(analysis.overHourCount)}</div>
                <div className="loss-key">over an hour</div>
              </div>
            </div>
            <div className="panel-foot">
              {Math.round(analysis.microPct)}% of stops are under 5 minutes but only {Math.round(analysis.microDownPct)}% of
              the lost time; the {analysis.longCount} over 15 minutes account for {Math.round(analysis.longDownPct)}% of
              it. Chasing the count and chasing the lost hours are two different jobs.
            </div>
          </section>

          <div style={{ height: 14 }} />

          <div className="panel">
            <div className="panel-head">
              <h3 className="panel-title">How long do stoppages last?</h3>
              <span>
                <span className="mono-note">{from} to {to}</span>
                <ExportCsv
                  name={csvName('stoppage-durations', from, to)}
                  headers={['bucket', 'min_seconds', 'max_seconds', 'count', 'total_down_seconds']}
                  rows={() => analysis.buckets.map((b) => [b.label, b.min, b.max === Infinity ? '' : b.max, b.count, b.downSeconds])}
                />
              </span>
            </div>
            <div className="panel-lede">
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
              <h3 className="panel-title">When in the day do stoppages happen?</h3>
              <span>
                <span className="mono-note">
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
            <div className="panel-lede">
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
              <div className="panel-lede" style={{ color: 'var(--warn-ink)' }}>
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
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

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

  // The design's headline is "One stop cost more than the other six together".
  // That is a claim about this day's distribution, so it is tested rather than
  // printed: it only holds when the longest stop really does exceed the sum of
  // the rest, which is not true on every day in this data set.
  const stopVerdict = useMemo(() => {
    const stops = data?.stoppages ?? [];
    if (!data || stops.length === 0) {
      return { headline: 'No stops detected this day', sub: 'The line produced continuously above the detection threshold.' };
    }
    const sorted = [...stops].sort((a, b) => b.durationSeconds - a.durationSeconds);
    const longest = sorted[0]!;
    const rest = sorted.slice(1).reduce((t, x) => t + x.durationSeconds, 0);
    const shiftOf = (iso: string) => {
      const h = new Date(iso).getUTCHours();
      return h >= 6 && h < 14 ? 'morning' : h >= 14 && h < 22 ? 'evening' : 'night';
    };
    const sub = `${fmtTime(longest.startTs)} – ${fmtTime(longest.endTs)} · ${fmtDuration(longest.durationSeconds)} · ${shiftOf(longest.startTs)} shift`;
    if (stops.length === 1) {
      return { headline: `A single stop cost ${fmtDuration(longest.durationSeconds)}`, sub };
    }
    if (longest.durationSeconds > rest) {
      return {
        headline: `One stop cost more than the other ${stops.length - 1} together`,
        sub,
      };
    }
    const share = data.totalDownSeconds > 0 ? Math.round((100 * longest.durationSeconds) / data.totalDownSeconds) : 0;
    return {
      headline: `${fmtInt(stops.length)} stops cost ${fmtDuration(data.totalDownSeconds)} between them`,
      sub: `The longest was ${sub} — ${share}% of the day's downtime.`,
    };
  }, [data]);

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
        <div className="sk sk-chart" />
      ) : (
        <>
          <section className="stops-verdict">
            <div className="sv-main">
              <h2 className="sv-headline">{stopVerdict.headline}</h2>
              <p className="sv-sub">{stopVerdict.sub}</p>
            </div>
            <div className="vc-stats">
              <div className="vc-stat">
                <div className="vcs-val">{data.availabilityPct ?? '—'}<span className="vcs-u">%</span></div>
                <div className="vcs-key">availability</div>
              </div>
              <div className="vc-stat">
                <div className="vcs-val">{fmtDuration(data.mtbfSeconds)}</div>
                <div className="vcs-key">between stops</div>
              </div>
              <div className="vc-stat">
                <div className="vcs-val">{fmtDuration(data.mttrSeconds)}</div>
                <div className="vcs-key">to restart</div>
              </div>
            </div>
          </section>

          <div className="rule-note" style={{ marginBottom: 14 }}>
            A stoppage here means the line produced <b>zero cones for {threshold}+ seconds</b>, inferred from gaps
            between weighings. With no PLC status feed and no planned-downtime schedule, this cannot tell a scheduled
            break or changeover from a fault. Typical running gap this day was ~{data.typicalGapSeconds ?? '—'}s.
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3 className="panel-title">Stoppage timeline</h3>
              <span>
                <ExportCsv
                  name={csvName('stoppages', date, date)}
                  headers={['start', 'end', 'duration_seconds']}
                  rows={() => data.stoppages.map((st) => [st.startTs, st.endTs, st.durationSeconds])}
                />
                <PrintButton />
              </span>
            </div>
            <div className="panel-lede">
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
              <h3 className="panel-title">Throughput — cones per hour</h3>
              <ExportCsv
                name={csvName('throughput-hourly', date, date)}
                headers={['hour_start', 'cones']}
                rows={() => data.hourly.map((h) => [h.hourTs, h.count])}
              />
            </div>
            <div className="panel-lede">Detected stoppages line up with the low bars below.</div>
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
            <div className="panel" style={{ marginTop: 14 }}>
              <div className="panel-head">
                <h3 className="panel-title">Stoppages — longest first</h3>
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
                      <th className="num">Down</th>
                      <th className="num">Share of the day's downtime</th>
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
                        <td className="num">
                          <span className="share">
                            <span className="share-track">
                              <span
                                className="share-fill"
                                style={{ width: `${data.totalDownSeconds > 0 ? (100 * s.durationSeconds) / data.totalDownSeconds : 0}%` }}
                              />
                            </span>
                            <span className="share-pct">
                              {data.totalDownSeconds > 0 ? Math.round((100 * s.durationSeconds) / data.totalDownSeconds) : 0}%
                            </span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!stoppagesExpanded && data.stoppages.length > STOPPAGE_PREVIEW_COUNT && (
                <div className="panel-foot" style={{ marginTop: 10 }}>
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

/**
 * Weight → Stability. Control through the day.
 *
 * The design leads with a one-line verdict and hides the statistics behind a
 * "Show the maths" toggle. The verdict is computed, not transcribed: the
 * prototype's line is "The mean held steady all day", which is false here —
 * 12 of 48 subgroups breach the band on the default day.
 *
 * The toggle hides the capability tiles and the S chart. It does NOT hide the
 * PLC-vs-tolerance disagreement panel: that is a finding about the plant's own
 * configuration, not a statistic, and burying it behind a toggle would defeat
 * the point of surfacing it.
 */
function WeightStability({
  spc,
  unit,
  type,
  from,
  to,
  onInspect,
}: {
  spc: SpcData;
  unit: string;
  type: SpcType;
  from: string;
  to: string;
  onInspect: (seed: RegisterSeed) => void;
}) {
  const noun = type === 'cone' ? 'cones' : 'sacks';
  const [showMaths, setShowMaths] = useState<boolean>(() => {
    try {
      return localStorage.getItem('sms.showMaths') === '1';
    } catch {
      return false;
    }
  });
  const toggleMaths = () => {
    setShowMaths((v) => {
      try {
        localStorage.setItem('sms.showMaths', v ? '0' : '1');
      } catch {
        /* private mode — the choice just will not persist */
      }
      return !v;
    });
  };

  const inspectSubgroup = (g: Subgroup) => {
    const startMs = new Date(g.ts).getTime();
    const endMs = startMs + spc.bucketMinutes * 60_000;
    onInspect({
      type,
      from: g.ts.slice(0, 10),
      to: new Date(endMs).toISOString().slice(0, 10),
      tsFrom: g.ts,
      tsTo: new Date(endMs).toISOString(),
      label: `${spc.bucketLabel} subgroup at ${fmtDateTime(g.ts)} (n=${g.n}, mean ${g.mean}${unit})`,
    });
  };

  const ooc = spc.xbarOutOfControl;
  const total = spc.subgroups.length;
  const oocPct = total > 0 ? Math.round((100 * ooc) / total) : 0;

  // The control limits are ±3σ/√n, so they tighten as a subgroup gets bigger.
  // At ~170 cones a subgroup that band is under ±2 g, which a real line will
  // cross often without anything being wrong. Saying "out of control" without
  // that context reads as an alarm; the band width is stated so the reader can
  // judge it.
  const meanN = total > 0 ? Math.round(spc.subgroups.reduce((s, g) => s + g.n, 0) / total) : 0;
  const bandHalfWidth = meanN > 0 ? round1((3 * spc.stdevWithin) / Math.sqrt(meanN)) : null;

  const headline =
    ooc === 0
      ? 'The mean held steady all day'
      : oocPct >= 20
        ? `The line mean moved around all day — ${ooc} of ${total} subgroups outside the band`
        : `The mean mostly held — ${ooc} of ${total} subgroups stepped outside the band`;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-sub-verdict">{headline}</h3>
            <p className="panel-lede">
              Each point is one {spc.bucketLabel} subgroup of about {fmtInt(meanN)} {noun}.
              {bandHalfWidth != null && (
                <> At that size the ±3σ band is only ±{bandHalfWidth}{unit} wide, so it is a sensitive test, not a fault light.</>
              )}
              {' '}Click a point to see the {noun} behind it.
            </p>
          </div>
          <button type="button" className="ghost-btn" onClick={toggleMaths} aria-expanded={showMaths}>
            {showMaths ? 'Hide the maths' : 'Show the maths'}
          </button>
        </div>

        <ResizableChart initialHeight={320}>
          {(h) => (
            <SubgroupChart
              subgroups={spc.subgroups}
              valueOf={(g) => g.mean}
              uclOf={(g) => g.xUcl}
              lclOf={(g) => g.xLcl}
              violatesOf={(g) => g.xViolates}
              centerline={spc.grandMean}
              uslLine={spc.spec.usl}
              lslLine={spc.spec.lsl}
              unit={unit}
              noun={noun}
              height={h}
              onPointClick={inspectSubgroup}
            />
          )}
        </ResizableChart>
        <div className="spc-legend">
          <span><span className="dot limit" /> outside the band ({ooc})</span>
          <span><span className="dot ctr" /> centreline {spc.grandMean}{unit}</span>
          {spc.spec.usl != null && <span><span className="dot spec" /> tolerance {spc.spec.lsl}–{spc.spec.usl}{unit}</span>}
        </div>

        {showMaths && (
          <div className="maths">
            <div className="maths-eyebrow">
              Capability · {spc.bucketLabel} subgroups of ~{fmtInt(meanN)} {noun}
            </div>
            <div className="maths-grid">
              <div className="mstat">
                <div className={`ms-val ${capClass(spc.capability.cp)}`}>{spc.capability.cp ?? '—'}</div>
                <div className="ms-key">Cp</div>
                <div className="ms-note">
                  {spc.capability.cp == null ? 'Needs a tolerance — pick one above.' : 'What the spread could achieve if perfectly centred.'}
                </div>
              </div>
              <div className="mstat">
                <div className={`ms-val ${capClass(spc.capability.cpk)}`}>{spc.capability.cpk ?? '—'}</div>
                <div className="ms-key">Cpk</div>
                <div className="ms-note">
                  {spc.capability.cpk == null ? 'Needs a tolerance.' : '1.33 is capable, 1.00–1.33 marginal, below 1.00 not capable.'}
                </div>
              </div>
              <div className="mstat">
                <div className="ms-val">{spc.stdevWithin}<span className="ms-u">{unit}</span></div>
                <div className="ms-key">Sigma within</div>
                <div className="ms-note">Short-term spread, pooled inside subgroups.</div>
              </div>
              <div className="mstat">
                <div className="ms-val">{spc.stdevOverall}<span className="ms-u">{unit}</span></div>
                <div className="ms-key">Sigma overall</div>
                <div className="ms-note">Long-term spread, including drift between subgroups.</div>
              </div>
              <div className="mstat">
                <div className={`ms-val ${ooc > 0 ? 'bad' : ''}`}>{ooc}<span className="ms-u">of {total}</span></div>
                <div className="ms-key">Groups out</div>
                <div className="ms-note">Subgroup means outside their own ±3σ band.</div>
              </div>
            </div>

            <div className="maths-chart">
              <div className="panel-head">
                <h3 className="panel-title">S chart — spread within each subgroup</h3>
                <ExportCsv
                  name={csvName(`schart-${type}`, from, to)}
                  headers={['subgroup_start', 'n', `sigma_${unit}`, `ucl_${unit}`, `lcl_${unit}`, 'out_of_control']}
                  rows={() => spc.subgroups.map((g) => [g.ts, g.n, g.s, g.sUcl, g.sLcl, g.sViolates])}
                />
              </div>
              <p className="panel-lede">
                Centred on {spc.sChartCenter}{unit}. A point above its band means the process got erratic in that window —
                a different failure from the mean moving, which is what the chart above tracks.
              </p>
              <ResizableChart initialHeight={240}>
                {(h) => (
                  <SubgroupChart
                    subgroups={spc.subgroups.filter((g) => g.s != null)}
                    valueOf={(g) => g.s}
                    uclOf={(g) => g.sUcl}
                    lclOf={(g) => g.sLcl}
                    violatesOf={(g) => g.sViolates}
                    centerline={spc.sChartCenter}
                    unit={unit}
                    noun={noun}
                    height={h}
                    onPointClick={inspectSubgroup}
                  />
                )}
              </ResizableChart>
            </div>

            <div className="maths-foot">
              <ExportCsv
                name={csvName(`process-summary-${type}`, from, to)}
                headers={['metric', 'value', 'unit']}
                rows={() => [
                  ['count', spc.count, noun],
                  ['mean', spc.mean, unit],
                  ['sigma_within', spc.stdevWithin, unit],
                  ['sigma_overall', spc.stdevOverall, unit],
                  ['subgroup_size', spc.bucketLabel, ''],
                  ['subgroups', spc.subgroups.length, ''],
                  ['subgroups_out_of_control', spc.xbarOutOfControl, ''],
                  ['practical_threshold', spc.practicalThresholdG, unit],
                  ['stations_flagged', spc.flaggedStationCount, ''],
                  ['spec_source', spc.spec.source, ''],
                  ['spec_lsl', spc.spec.lsl, unit],
                  ['spec_usl', spc.spec.usl, unit],
                  ['cp', spc.capability.cp, ''],
                  ['cpk', spc.capability.cpk, ''],
                  ['pp', spc.capability.pp, ''],
                  ['ppk', spc.capability.ppk, ''],
                ]}
                label="Export summary"
              />
              <PrintButton />
              <span className="mono-note">
                {fmtInt(spc.count)} {noun}, {from === to ? from : `${from} to ${to}`}. In-spec and out-of-spec both count;
                implausible readings (scale faults) are excluded.
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Two independent verdicts exist on every cone — the PLC's in-range bit
          and the product tolerance in PDAS — and nobody had compared them.
          Where they disagree, only IFL can say which governs, so this states the
          finding and asks rather than silently picking a side. Deliberately not
          behind the maths toggle: it is a finding, not a statistic. */}
      {spc.specAgreement && spc.specAgreement.disagreementCount > 0 && (
        <section className="panel spec-disagree">
          <div className="panel-head">
            <h3 className="panel-title">The PLC and your product spec disagree</h3>
            <span className="mono-note">{spc.specAgreement.disagreementPct}% of {fmtInt(spc.specAgreement.evaluated)} cones</span>
          </div>
          <p className="panel-lede">
            Both judgements come from IFL systems. The line's <b>in-range</b> bit is set by the PLC against a band
            configured in the controller; the tolerance <b>{spc.specAgreement.toleranceLabel}</b> is what the product
            master in PDAS says. They do not agree on <b>{fmtInt(spc.specAgreement.disagreementCount)}</b> cones in this range.
          </p>
          <div className="sd-split">
            <div className="sd-half">
              <div className="sd-val">{fmtInt(spc.specAgreement.plcPassedButOutOfTolerance)}</div>
              <div className="sd-key">PLC passed, spec says out</div>
              <div className="sd-note">Passed the line as good while sitting outside the product tolerance.</div>
            </div>
            <div className="sd-half">
              <div className="sd-val">{fmtInt(spc.specAgreement.plcFailedButInTolerance)}</div>
              <div className="sd-key">PLC rejected, spec says in</div>
              <div className="sd-note">Failed while inside it.</div>
            </div>
          </div>
          <div className="panel-foot">
            Worth reconciling before it shows up in an audit: whichever limit governs, one of the two is currently
            mis-set. We are not guessing which — that is a decision for your process and quality engineers, and the
            app will follow whichever you confirm.
          </div>
        </section>
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
  // A bin counts as out of tolerance when it lies wholly beyond a limit. Bins
  // straddling a limit stay neutral rather than being coloured on a guess about
  // where inside the bin the readings actually sat.
  const outOfSpec = (b: HistBin) => (lsl != null && b.end <= lsl) || (usl != null && b.start >= usl);
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
            className={`hist-bar${hover === i ? ' hi' : ''}${outOfSpec(b) ? ' oos' : ''}`}
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

  // "A 3-day burst, not a bad day" in the design. Whether the rejects arrived as
  // a sustained run or as isolated spikes is exactly what the episode detector
  // answers, so the sentence is built from it: a multi-bucket episode is a
  // burst, a single bucket is a spike, and neither is asserted when the chart
  // is in control throughout.
  const trendVerdict = useMemo(() => {
    const unit = data?.bucketSize === 'hour' ? 'hour' : 'day';
    const basePct = data?.pBar != null ? (data.pBar * 100).toFixed(2) : '—';
    if (!data || data.episodes.length === 0) {
      return {
        headline: 'Reject rate stayed in control',
        sub: `No ${unit} in this window went beyond its own control limit. The baseline is ${basePct}%.`,
      };
    }
    const runs = data.episodes.filter((e) => e.bucketCount > 1);
    const spikes = data.episodes.length - runs.length;
    const worst = [...data.episodes].sort((a, b) => b.bucketCount - a.bucketCount || b.totalRejects - a.totalRejects)[0]!;
    const worstRate = worst.totalProduced > 0 ? (100 * worst.totalRejects) / worst.totalProduced : 0;
    const ratio = data.pBar && data.pBar > 0 ? Math.round((worstRate / (data.pBar * 100)) * 100) / 100 : null;
    const when = `${worst.startTs.slice(0, 10)}${worst.bucketCount > 1 ? ` to ${worst.endTs.slice(0, 10)}` : ''}`;
    if (runs.length > 0) {
      return {
        headline: `A ${worst.bucketCount}-${unit} burst, not a bad ${unit}`,
        sub: `${when} ran ${fmtInt(worst.totalRejects)} rejects of ${fmtInt(worst.totalProduced)} cones — ${worstRate.toFixed(2)}%${ratio ? `, ${ratio}× the ${basePct}% baseline` : ''}${spikes > 0 ? `. ${spikes} isolated spike${spikes === 1 ? '' : 's'} elsewhere` : ''}.`,
      };
    }
    return {
      headline: spikes === 1 ? `One ${unit} broke the pattern` : `${spikes} isolated spikes, no sustained run`,
      sub: `The worst was ${when} at ${worstRate.toFixed(2)}% against a ${basePct}% baseline. Nothing ran beyond its limit for two consecutive ${unit}s.`,
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
        <div className="sk sk-chart" />
      ) : (
        <>
          <section className="panel">
            <h2 className="sv-headline">{trendVerdict.headline}</h2>
            <p className="sv-sub">{trendVerdict.sub}</p>
            <div className="panel-foot" style={{ marginTop: 14 }}>
              Each {data.bucketSize} gets its own control limit, scaled to how many cones it actually produced, so a
              quiet {data.bucketSize} and a busy one are judged fairly rather than against one flat threshold. A run of
              two or more flagged buckets is an event; a single one is a spike.
            </div>
          </section>

          <div style={{ height: 14 }} />

          {data.episodes.length > 0 ? (
            <div className="panel">
              <div className="panel-head">
                <h3 className="panel-title">Detected episodes</h3>
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
              <div className="panel-lede">Sorted by severity — longest run first.</div>
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

          <div className="panel" style={{ marginTop: 14 }}>
            <div className="panel-head">
              <h3 className="panel-title">Reject rate control chart</h3>
              <ExportCsv
                name={csvName('reject-control-chart', from, to)}
                headers={['bucket_start', 'produced', 'rejects', 'rate', 'ucl', 'lcl', 'beyond_control_limit']}
                rows={() => data.buckets.map((b) => [b.bucketTs, b.produced, b.rejects, b.rate, b.ucl, b.lcl, b.outOfControl])}
              />
            </div>
            <div className="panel-lede">
              Dashed line is each bucket's own 3σ upper limit, scaled to its production volume; the flat line is the
              overall baseline rate.
            </div>
            <ResizableChart initialHeight={320}>
              {(h) => <PChart buckets={data.buckets} pBar={data.pBar} bucketSize={data.bucketSize} revealed={revealed} height={h} />}
            </ResizableChart>
            <div className="spc-legend">
              <span><span className="dot limit" /> beyond control limit ({data.outOfControlCount})</span>
              <span><span className="dot ctr" /> normal variation</span>
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


/**
 * Last-7-days OEE columns.
 *
 * Measured-width viewBox, like every other chart here that renders text — the
 * design specifies a fixed 620x190 box, but scaling that to the container
 * stretches the mono labels horizontally. The geometry below keeps the design's
 * proportions (54px bars, dashed target line) at 1:1.
 */
function OeeDaysChart({ days, target = 85 }: { days: { date: string; oeePct: number | null }[]; target?: number }) {
  const [wrapRef, measuredW] = useMeasuredWidth();
  const W = Math.max(420, measuredW - 64);
  const H = 190;
  const BASE = 150;
  const RM = 62; // room for the "85 target" label at the right edge
  const plotW = Math.max(120, W - RM);
  const axisFontPx = useTipFontPx();

  const max = Math.max(100, ...days.map((d) => d.oeePct ?? 0));
  const y = (pct: number) => BASE - (pct / max) * (BASE - 26);
  const slot = plotW / Math.max(1, days.length);
  const barW = Math.min(54, slot * 0.62);

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg className="oeedays" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
           aria-label={`OEE for the last ${days.length} days`}>
        <line className="ax" x1={0} y1={BASE} x2={plotW} y2={BASE} />
        <line className="target" x1={0} y1={y(target)} x2={plotW} y2={y(target)} />
        <text className="target-label" x={plotW + 6} y={y(target) + 4} fontSize={axisFontPx}>{target} target</text>
        {days.map((d, i) => {
          const cx = slot * i + slot / 2;
          const pct = d.oeePct;
          if (pct == null) {
            return (
              <text key={d.date} className="tick" x={cx} y={BASE - 8} textAnchor="middle" fontSize={axisFontPx}>—</text>
            );
          }
          const top = y(pct);
          return (
            <g key={d.date}>
              <rect className={`bar${i === days.length - 1 ? ' latest' : ''}`} x={cx - barW / 2} y={top} width={barW} height={Math.max(1, BASE - top)}>
                <title>{d.date}: {pct}% OEE</title>
              </rect>
              <text className="val" x={cx} y={top - 7} textAnchor="middle" fontSize={axisFontPx}>{pct}</text>
            </g>
          );
        })}
        {days.map((d, i) => (
          <text key={`t${d.date}`} className="tick" x={slot * i + slot / 2} y={BASE + axisFontPx + 6}
                textAnchor="middle" fontSize={axisFontPx}>
            {d.date.slice(8)}
          </text>
        ))}
      </svg>
    </div>
  );
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
  const [days, setDays] = useState<{ date: string; oeePct: number | null }[]>([]);
  const [showInputs, setShowInputs] = useState(false);
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

  // The 7-day strip. /api/oee has no day-grouped mode, so this is one call per
  // day — deliberately the same parameters as the headline figure, or the strip
  // would be measuring a different thing from the number above it.
  useEffect(() => {
    if (!to) return;
    let cancelled = false;
    const wanted: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${to}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      const s = d.toISOString().slice(0, 10);
      if (!range.min || s >= range.min) wanted.push(s);
    }
    Promise.all(
      wanted.map((d) =>
        getOee({
          from: d,
          to: d,
          thresholdSeconds,
          plannedHoursPerDay,
          idealCycleSeconds: idealOverride ? Number(idealOverride) : undefined,
        })
          .then((r) => ({ date: d, oeePct: r.data.oeePct as number | null }))
          .catch(() => ({ date: d, oeePct: null })),
      ),
    ).then((rows) => !cancelled && setDays(rows));
    return () => {
      cancelled = true;
    };
  }, [to, range.min, thresholdSeconds, plannedHoursPerDay, idealOverride]);

  // The three loss buckets, in their own units. Deliberately NOT presented as an
  // arithmetic split of the missing percentage: OEE multiplies its three factors,
  // so the losses do not sum to 100 - OEE and claiming they do would be wrong.
  const losses = useMemo(() => {
    if (!data) return null;
    const slowSeconds = Math.max(0, data.runSeconds - data.idealCycleSeconds * data.producedCount);
    return { stopped: data.downSeconds, slow: slowSeconds, rejected: data.rejectedCount };
  }, [data]);

  const verdict = (pct: number) =>
    pct >= 85
      ? 'At or above the 85% mark usually called world-class.'
      : pct >= 60
        ? 'A typical band for a line like this. 85% is world-class.'
        : 'Below the usual band for a line like this. 85% is world-class.';

  return (
    <>
      {error ? (
        <div className="error-card" role="alert"><b>Couldn't load OEE.</b> {error}</div>
      ) : loading || !data ? (
        <div className="sk sk-oee" />
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

          <div className="oee-grid">
            {/* Signature: the one dark surface in the app. */}
            <section className="oee-block">
              <div className="ob-eyebrow">Overall equipment effectiveness</div>
              <div className="ob-hero">
                {data.oeePct}<span className="ob-pct">%</span>
              </div>
              <p className="ob-lede">{verdict(data.oeePct)}</p>
              <p className="ob-estimated">
                Inferred from event timestamps — there is no PLC status feed and no planned-downtime schedule for this
                line. It is an estimate, not a certified figure.
              </p>

              {[
                { name: 'Availability', v: data.availabilityPct, cls: 'avail', note: `Run time ÷ planned time. ${fmtDuration(data.downSeconds)} stopped across ${fmtInt(data.stoppageCount)} events.` },
                { name: 'Performance', v: data.performancePct, cls: 'perf', note: data.idealCycleSource === 'inferred' ? `Ideal cycle ${data.idealCycleSeconds}s/cone, inferred from the best observed hour.` : `Ideal cycle ${data.idealCycleSeconds}s/cone, from your override.` },
                { name: 'Quality', v: data.qualityPct, cls: 'qual', note: `${fmtInt(data.producedCount)} good, ${fmtInt(data.rejectedCount)} rejected.` },
              ].map((f) => (
                <div className="ob-factor" key={f.name}>
                  <div className="obf-head">
                    <span className="obf-name">{f.name}</span>
                    <span className="obf-val">{f.v}%</span>
                  </div>
                  <span className="obf-track">
                    <span className={`obf-fill ${f.cls}`} style={{ width: `${Math.max(0, Math.min(100, f.v))}%` }} />
                  </span>
                  <div className="obf-note">{f.note}</div>
                </div>
              ))}
            </section>

            <div className="oee-right">
              <section className="panel">
                <div className="panel-head">
                  <h3 className="panel-title">Last 7 days</h3>
                  <span className="mono-note">OEE %</span>
                </div>
                {days.length > 0 ? (
                  <OeeDaysChart days={days} />
                ) : (
                  <div className="empty-note">No daily figures for this window.</div>
                )}
              </section>

              <section className="panel">
                <div className="panel-head">
                  <h3 className="panel-title">Where the missing {round1(100 - data.oeePct)}% went</h3>
                </div>
                {losses && (
                  <div className="loss-grid">
                    <div className="loss">
                      <div className="loss-val alarm">{fmtDuration(losses.stopped)}</div>
                      <div className="loss-key">stopped — {fmtInt(data.stoppageCount)} event{data.stoppageCount === 1 ? '' : 's'}</div>
                    </div>
                    <div className="loss">
                      <div className="loss-val warn">{fmtDuration(losses.slow)}</div>
                      <div className="loss-key">slow vs the best hour observed</div>
                    </div>
                    <div className="loss">
                      <div className="loss-val">{fmtInt(losses.rejected)}</div>
                      <div className="loss-key">cones rejected</div>
                    </div>
                  </div>
                )}
                <div className="panel-foot">
                  Three separate losses in their own units. OEE multiplies its factors rather than adding them, so
                  these do not sum to {round1(100 - data.oeePct)}% — they are where the loss came from, not a split of it.
                </div>
              </section>
            </div>
          </div>

          {/* The estimate is only defensible if the assumptions behind it are
              reachable. The design drops these controls; they stay, folded away,
              because an inferred number whose inputs cannot be inspected is
              exactly the kind of figure a plant engineer is right to distrust. */}
          <section className="panel" style={{ marginTop: 14 }}>
            <div className="panel-head">
              <h3 className="panel-title">Assumptions behind this estimate</h3>
              <button type="button" className="ghost-btn" onClick={() => setShowInputs((v) => !v)} aria-expanded={showInputs}>
                {showInputs ? 'Hide inputs' : 'Show inputs'}
              </button>
            </div>
            <p className="panel-lede">
              Availability = run ÷ planned. Performance = (ideal cycle × produced) ÷ run, ideal cycle{' '}
              {data.idealCycleSource === 'inferred'
                ? 'inferred from the 95th-percentile hourly throughput, since no cycle-time spec exists yet'
                : 'taken from your override'}
              . Quality = produced ÷ (produced + rejected).
            </p>
            {showInputs && (
              <>
                <div className="wt-controls" style={{ marginTop: 16, borderBottom: 0, paddingBottom: 0 }}>
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
                <div className="maths-foot">
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
                    label="Export inputs"
                  />
                  <PrintButton />
                  <span className="mono-note">
                    planned {fmtDuration(data.plannedSeconds)} · run {fmtDuration(data.runSeconds)} · down {fmtDuration(data.downSeconds)}
                  </span>
                </div>
              </>
            )}
          </section>
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

function ShiftView({
  range,
  onMeta,
  sub,
}: {
  range: { min: string | null; max: string | null };
  onMeta: (m: Meta) => void;
  sub: string;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scores, setScores] = useState<ShiftScore[] | null>(null);
  const [trend, setTrend] = useState<Record<ShiftKey, ProductionRow[]> | null>(null);
  const [legacy, setLegacy] = useState<ShiftAnalysisData | null>(null);
  const [trendMetric, setTrendMetric] = useState<'cones' | 'reject'>('cones');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The section column's two tabs choose the window. They were declared but
  // never wired, so both rendered the whole record.
  useEffect(() => {
    if (!range.min || !range.max) return;
    if (sub === 'week') {
      const start = new Date(`${range.max}T12:00:00Z`);
      start.setUTCDate(start.getUTCDate() - 6);
      const s = start.toISOString().slice(0, 10);
      setFrom(s >= range.min ? s : range.min);
      setTo(range.max);
    } else {
      setFrom(range.min);
      setTo(range.max);
    }
  }, [range.min, range.max, sub]);

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

  // Which shift trails, on how many days, and in the longest unbroken run.
  // The design states "Night has trailed for 18 days straight" and colours night
  // as the alarm. On this line night is the STRONGEST shift on cones,
  // availability, stops and OEE, and morning is the weakest on all four — so
  // both the sentence and the colour follow the computed answer.
  const trailing = useMemo(() => {
    if (!trendSeries || !verdict) return null;
    const byShift = new Map(trendSeries.series.map((s) => [s.name as ShiftKey, s.points]));
    let days = 0;
    let run = 0;
    let bestRun = 0;
    trendSeries.days.forEach((_, i) => {
      const vals = WORK_SHIFTS.map((s) => ({ s, v: byShift.get(s)?.[i] ?? null })).filter((x) => x.v != null);
      if (vals.length < WORK_SHIFTS.length) {
        run = 0;
        return;
      }
      const low = vals.reduce((a, b) => (b.v! < a.v! ? b : a));
      if (low.s === verdict.shift) {
        days += 1;
        run += 1;
        bestRun = Math.max(bestRun, run);
      } else {
        run = 0;
      }
    });
    return { days, longestRun: bestRun, total: trendSeries.days.length };
  }, [trendSeries, verdict]);

  // Cards carry the same colour as their line on the chart below, so the two
  // read as one statement. The alarm attaches to the computed worst shift
  // rather than to a fixed shift name, and the remaining two always take the
  // other two tones — keying off the shift NAME instead collapsed both of them
  // onto one colour whenever morning was the weak shift.
  const tones = useMemo(() => {
    const m = new Map<ShiftKey, string>();
    if (!scores || !verdict) return m;
    m.set(verdict.shift, 'alarm');
    const rest = [...scores].filter((x) => x.shift !== verdict.shift).sort((a, b) => b.cones - a.cones);
    rest.forEach((x, i) => m.set(x.shift, i === 0 ? 'ink' : 'steel'));
    return m;
  }, [scores, verdict]);
  const toneOf = (s: ShiftKey) => tones.get(s) ?? 'steel';

  if (error) return <div className="error-card" role="alert"><b>Couldn't load shift performance.</b> {error}</div>;

  return (
    <>
      {loading || !scores || !verdict ? (
        <div className="sk sk-chart" />
      ) : (
        <>
          <div className="shift-cards">
            {scores.map((sc) => {
              const isWorst = sc.shift === verdict.shift;
              const mostCones = Math.max(...scores.map((x) => x.cones));
              const behind = mostCones > 0 ? Math.round((100 * (mostCones - sc.cones)) / mostCones) : 0;
              // Rank on cones explicitly. Inferring it from "is it the max?"
              // called the lowest-output shift "between the other two", and the
              // worst-overall shift "0% behind" on a week where it happened to
              // wind the most cones while trailing on everything else.
              const coneRank = [...scores].sort((a, b) => b.cones - a.cones).findIndex((x) => x.shift === sc.shift);
              const lastOn = `last on ${verdict.metrics.length} of ${SHIFT_METRICS.length} measures`;
              const line = isWorst
                ? behind >= 1
                  ? `${behind}% behind on cones, and ${lastOn}`
                  : `Highest output, but ${lastOn}`
                : coneRank === 0
                  ? 'Best output of the three'
                  : coneRank === 1
                    ? 'Steady, between the other two'
                    : 'Lowest output of the three';
              // A value is marked only when being worst on that measure is
              // actually a problem — a shift with the fewest stoppages is not a
              // finding, it is the good outcome.
              const mark = (m: ShiftMetric) => {
                const vals = scores.map(m.value);
                const worst = m.higherIsBetter ? Math.min(...vals) : Math.max(...vals);
                return m.value(sc) === worst && scores.length > 1 ? 'bad' : '';
              };
              return (
                <section className={`shift-card ${toneOf(sc.shift)}`} key={sc.shift}>
                  <div className="sc-head">
                    <div className="sc-title">
                      <span className="sc-name">{sc.shift}</span>
                      <span className="sc-hours">{SHIFT_HOURS[sc.shift]}</span>
                    </div>
                    <div className={`sc-verdict${isWorst ? ' bad' : ''}`}>{line}</div>
                  </div>
                  <div className="sc-body">
                    {SHIFT_METRICS.filter((m) => m.key !== 'oee').map((m) => (
                      <div className="sc-row" key={m.key}>
                        <span className="scr-k" title={m.note}>{m.label}</span>
                        <span className={`scr-v ${mark(m)}`}>{m.format(m.value(sc))}</span>
                      </div>
                    ))}
                    <div className="sc-row oee">
                      <span className="scr-k">OEE (estimated)</span>
                      <span className={`scr-v ${mark(SHIFT_METRICS.find((m) => m.key === 'oee')!)}`}>
                        {sc.oeePct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2 className="panel-sub-verdict">
                  {trailing && trailing.days > 0 ? (
                    <>
                      <span className="cap">{verdict.shift}</span> has trailed on {trailing.days} of {trailing.total} days
                      {trailing.longestRun > 1 && `, ${trailing.longestRun} of them in a row`}
                    </>
                  ) : (
                    <>No shift trails consistently</>
                  )}
                </h2>
                <p className="panel-lede">
                  {trailing && trailing.days > trailing.total / 2
                    ? 'Not a one-off: the gap holds across the record. Same line, same machines — a gap this size is a crewing, handover or maintenance-timing question, not an equipment one.'
                    : `OEE spans ${verdict.spreadPp.toFixed(1)} points between the best and worst shift. No shift is consistently behind, so the differences look like day-to-day variation rather than a crew pattern.`}
                </p>
              </div>
              <span className="mono-note">
                {trendMetric === 'cones' ? 'cones per shift' : 'reject rate %'}
              </span>
            </div>

            <div style={{ marginBottom: 4 }}>
              <Segmented
                value={trendMetric}
                onChange={setTrendMetric}
                options={[
                  { key: 'cones' as const, label: 'Cones' },
                  { key: 'reject' as const, label: 'Reject rate' },
                ]}
              />
            </div>

            {trendSeries && (
              <ResizableChart initialHeight={260}>
                {(h) => (
                  <ShiftTrendChart
                    days={trendSeries.days}
                    series={trendSeries.series.map((s) => ({ ...s, tone: toneOf(s.name as ShiftKey) }))}
                    metric={trendMetric}
                    height={h}
                  />
                )}
              </ResizableChart>
            )}

            <div className="shift-legend">
              {WORK_SHIFTS.map((s) => (
                <span className="sl-item" key={s}>
                  <span className={`sl-rule ${s} ${toneOf(s)}`} />
                  <span className="cap">{s}</span>
                </span>
              ))}
            </div>

            <div className="panel-foot">
              <span className="w-tag">Data note</span>{' '}
              Shift is recomputed from production time.{' '}
              {legacy && (
                <>
                  The plant's stored value disagrees on <b>{legacy.mismatch.pct}%</b> of rows
                  ({fmtInt(legacy.mismatch.differing)} of {fmtInt(legacy.mismatch.total)}), because it is derived from
                  insert time rather than production time.
                </>
              )}
              {scores && (
                <ExportCsv
                  name={csvName('shift-scorecard', from, to)}
                  headers={['metric', 'unit', ...scores.map((sc) => sc.shift)]}
                  rows={() => SHIFT_METRICS.map((m) => [m.label, m.unit, ...scores.map((sc) => m.value(sc))])}
                />
              )}
              <PrintButton />
            </div>
          </section>
        </>
      )}
    </>
  );
}

/**
 * Three shifts on one day axis. Each shift keeps a fixed dash pattern — solid,
 * dashed, dotted — so the chart still reads in greyscale and with any colour
 * vision; colour only carries which shift is the weak one.
 */
function ShiftTrendChart({
  days,
  series,
  metric,
  height = 260,
}: {
  days: string[];
  series: { name: string; points: (number | null)[]; tone: string }[];
  metric: 'cones' | 'reject';
  height?: number;
}) {
  const [wrapRef, measuredW] = useMeasuredWidth();
  const axisFontPx = useTipFontPx();
  const RM = 54;
  const W = Math.max(420, measuredW - 40);
  const plotW = Math.max(120, W - RM);
  const H = height;
  const BASE = H - Math.ceil(axisFontPx * 2.4);

  const all = series.flatMap((s) => s.points).filter((v): v is number => v != null);
  const max = all.length ? Math.max(...all) : 1;
  const min = metric === 'cones' ? 0 : Math.min(0, ...all);
  const span = max - min || 1;
  const y = (v: number) => BASE - ((v - min) / span) * (BASE - 14);
  const x = (i: number) => (days.length <= 1 ? plotW / 2 : (i / (days.length - 1)) * plotW);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * span);
  const fmtV = (v: number) => (metric === 'cones' ? fmtInt(Math.round(v)) : `${v.toFixed(1)}%`);

  return (
    <div ref={wrapRef} className="chart-wrap">
      <svg className="shifttrend" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
           aria-label={`${metric === 'cones' ? 'Cones' : 'Reject rate'} per shift across ${days.length} days`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line className="grid" x1={0} y1={y(t)} x2={plotW} y2={y(t)} />
            <text className="tick" x={plotW + 6} y={y(t) + 4} fontSize={axisFontPx}>{fmtV(t)}</text>
          </g>
        ))}
        <line className="ax" x1={0} y1={BASE} x2={plotW} y2={BASE} />
        {series.map((s) => {
          const d = s.points
            .map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
            .filter(Boolean)
            .join(' ');
          return <polyline key={s.name} className={`sline ${s.name} ${s.tone}`} points={d} />;
        })}
        {days.length > 0 && (
          <>
            <text className="tick" x={0} y={BASE + axisFontPx + 6} fontSize={axisFontPx}>{days[0]!.slice(5)}</text>
            <text className="tick" x={plotW} y={BASE + axisFontPx + 6} textAnchor="end" fontSize={axisFontPx}>
              {days[days.length - 1]!.slice(5)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}


/* ---------------- Reject Analysis (Q10) ---------------- */

function RejectView({
  onMeta,
  rank,
  range,
}: {
  onMeta: (m: Meta) => void;
  rank: number;
  range: { min: string | null; max: string | null };
}) {
  const canEdit = rank >= 3; // manager+
  const [data, setData] = useState<RejectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Bounded to the production window like every other view. Unbounded, this
    // counted the three epoch-clock-fault rows and the panel reported 3,146
    // against the 3,144 in its own section-column tab — the same screen
    // disagreeing with its own navigation.
    getRejects(range.min ?? undefined, range.max ?? undefined)
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
  }, [onMeta, reloadKey, range.min, range.max]);

  const revealed = useRevealOnData(data ? data.reasons.map((r) => `${r.tubeCode}:${r.materialCode}:${r.count}`).join('|') : null);

  // How concentrated the Pareto actually is. The design states "Two inspection
  // codes cause 3 in 4 rejects" as a fixed headline; how many codes it takes to
  // reach three quarters is a property of the data, so it is derived — and on
  // this line two codes reach 79%, not 75%.
  const shape = useMemo(() => {
    if (!data || data.reasons.length === 0) return null;
    const quality = data.reasons.filter((r) => r.rejectType === 'quality');
    const weight = data.reasons.filter((r) => r.rejectType !== 'quality');
    const sum = (rs: RejectReason[]) => rs.reduce((t, r) => t + r.count, 0);
    const qCount = sum(quality);
    const wCount = sum(weight);
    let k = 0;
    for (const r of data.reasons) {
      k += 1;
      if (r.cumulativePct >= 75) break;
    }
    const topPct = data.reasons[k - 1]?.cumulativePct ?? 0;
    const word = ['', 'One', 'Two', 'Three', 'Four', 'Five'][k] ?? String(k);
    return {
      quality: { count: qCount, pct: data.total > 0 ? Math.round((100 * qCount) / data.total) : 0, codes: quality.length },
      weight: { count: wCount, pct: data.total > 0 ? Math.round((100 * wCount) / data.total) : 0, codes: weight.length },
      k,
      topPct: Math.round(topPct),
      headline:
        k === 1
          ? `One inspection code causes ${Math.round(topPct)}% of all rejects`
          : `${word} inspection code${k === 1 ? '' : 's'} cause ${Math.round(topPct)}% of all rejects`,
      unlabelled: data.reasons.filter((r) => !r.label && r.rejectType === 'quality').length,
    };
  }, [data]);

  if (error) return <div className="error-card" role="alert"><b>Couldn't load reject analysis.</b> {error}</div>;
  if (loading || !data || !shape) return <div className="sk sk-chart" />;

  const max = Math.max(1, ...data.reasons.map((r) => r.count));

  return (
    <div className="rej-grid">
      <div className="rej-cards">
        <section className="rej-card">
          <div className="rc-eyebrow">quality rejects</div>
          <div className="rc-figure">{fmtInt(shape.quality.count)}</div>
          <div className="rc-sub">
            {shape.quality.pct}% of all rejects · {shape.quality.codes} code{shape.quality.codes === 1 ? '' : 's'}
          </div>
          <span className="rc-track">
            <span className="rc-fill alarm" style={{ width: `${shape.quality.pct}%` }} />
          </span>
        </section>
        <section className="rej-card">
          <div className="rc-eyebrow">weight rejects</div>
          <div className="rc-figure">{fmtInt(shape.weight.count)}</div>
          <div className="rc-sub">{shape.weight.pct}% · the PLC's own in-range bit</div>
          <span className="rc-track">
            <span className="rc-fill warn" style={{ width: `${shape.weight.pct}%` }} />
          </span>
        </section>
      </div>

      <section className="panel">
        <h2 className="sv-headline">{shape.headline}</h2>
        <p className="sv-sub">
          {shape.unlabelled > 0
            ? 'Codes stay unlabelled until IFL confirms what they mean.'
            : 'Every code on this line has been named.'}
        </p>

        <div className="pareto" style={{ marginTop: 22 }}>
          {data.reasons.map((r, i) => (
            <ParetoRow
              key={`${r.rejectType}-${r.tubeCode}-${r.materialCode}`}
              r={r}
              max={max}
              rank={i}
              revealed={revealed}
              canEdit={canEdit}
              onSaved={() => setReloadKey((k) => k + 1)}
            />
          ))}
        </div>

        {shape.unlabelled > 0 && (
          <div className="waiting" role="note">
            <span className="w-tag">Waiting on IFL</span>
            <span className="w-text">
              Name {shape.unlabelled === 1 ? 'this code' : `these ${shape.unlabelled} codes`} and this page becomes an
              action list. {canEdit ? 'Type a name into any row above to record it.' : 'A manager or admin can record the names.'}
            </span>
          </div>
        )}

        <div className="panel-foot">
          {fmtInt(data.total)} rejected cones across {data.reasons.length} codes. A label applies to every matching
          reject, past and future — the raw codes are always kept underneath.
          <ExportCsv
            name={csvName('reject-pareto')}
            headers={['reject_type', 'tube_code', 'material_code', 'label', 'count', 'pct_of_total', 'cumulative_pct']}
            rows={() => data.reasons.map((r) => [r.rejectType, r.tubeCode, r.materialCode, r.label ?? '', r.count, r.pct, r.cumulativePct])}
          />
        </div>
      </section>
    </div>
  );
}

function ParetoRow({
  r,
  max,
  rank,
  revealed,
  canEdit,
  onSaved,
}: {
  r: RejectReason;
  max: number;
  rank: number;
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

  // Emphasis follows position in the Pareto: the two that matter, then the
  // tail. Rank is a second channel alongside colour — the rows are already
  // ordered, and the count and percentage are printed on every row.
  const tone = rank < 2 ? 'top' : rank < 4 ? 'mid' : 'tail';

  return (
    <div className="pareto-row">
      <div className="reason">
        {canEdit ? (
          <input
            value={label}
            placeholder={r.displayLabel}
            aria-label={`Name for code ${r.displayLabel}`}
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
        <div className={`pareto-fill ${tone}`} style={{ width: revealed ? `${(100 * r.count) / max}%` : 0 }} />
      </div>
      <div className="nums">
        <span className="cnt">{fmtInt(r.count)}</span>
        <span className="pct">{r.pct}%</span>
      </div>
    </div>
  );
}

/* ---------------- Weight consistency (Q4/Q5) ---------------- */

/**
 * Weight → Spread. Distribution and stations.
 *
 * Two populations meet on this tab and the design does not distinguish them, so
 * the code has to:
 *
 *  - The histogram and the station chart come from /api/spc, which keeps every
 *    plausible reading (1500–2100 g) whether in spec or not, because filtering
 *    to in-range would delete a drifting station's worst output from the
 *    evidence used to judge that station.
 *  - The giveaway figure comes from /api/weights, which applies the gross/net
 *    basis. That basis is the unanswered Q4/Q5 and it flips the SIGN of the
 *    number, so the toggle lives inside that panel rather than in the page
 *    controls — it governs that block and nothing else on the screen.
 */
function WeightSpread({
  spc,
  unit,
  type,
  from,
  to,
  onInspect,
  basis,
  onBasis,
  weights,
  dailyCones,
  wErr,
}: {
  spc: SpcData;
  unit: string;
  type: SpcType;
  from: string;
  to: string;
  onInspect: (seed: RegisterSeed) => void;
  basis: Basis;
  onBasis: (b: Basis) => void;
  weights: WeightsData | null;
  dailyCones: number[] | null;
  wErr: string | null;
}) {
  const noun = type === 'cone' ? 'cones' : 'sacks';

  const days = from && to ? Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1 : null;

  // Annualise from a RATE (g/cone × a typical day's cones), never from
  // total ÷ calendar days. A range almost always includes a partial day —
  // always, once live, because today is still running — and dividing by whole
  // days understates the figure (measured: 3.9 t/yr vs 4.3 t/yr on an 18-day
  // window with two partial edges). The median daily count is used as the
  // "typical day" precisely so those partial days can't drag it.
  const giveaway = useMemo(() => {
    const perCone = weights?.cone.giveawayPerConeG;
    if (perCone == null || !dailyCones || dailyCones.length === 0) return null;
    const sorted = [...dailyCones].sort((a, b) => a - b);
    const medianConesPerDay = sorted[Math.floor(sorted.length / 2)]!;
    const kgPerDay = (perCone * medianConesPerDay) / 1000;
    return {
      kgPerDay: round1(kgPerDay),
      annualizedTonnes: round1((kgPerDay * 365) / 1000),
      medianConesPerDay,
      partialDays: dailyCones.filter((c) => c < medianConesPerDay * 0.5).length,
    };
  }, [weights, dailyCones]);

  // Sub-floor readings the SPC population never sees. weights.ts collects them
  // per record type; both are shown because a sack-scale fault matters as much
  // as a cone one and nothing else on this screen would reveal it.
  const excluded = useMemo(() => {
    if (!weights) return [] as { weight: number; unit: string; shiftDate: string | null }[];
    return [
      ...weights.cone.outliers.map((o) => ({ weight: o.weight, unit: 'g', shiftDate: o.shiftDate ?? null })),
      ...weights.sack.outliers.map((o) => ({ weight: o.weight, unit: 'kg', shiftDate: o.shiftDate ?? null })),
    ];
  }, [weights]);

  // The API bins over mean±4sigma, so a tolerance wider than that window falls
  // entirely outside the chart and Histogram silently drops the line. Saying so
  // is better than drawing a chart that looks like it has no limits.
  const outOfSpecNote = useMemo(() => {
    const { lsl, usl } = spc.spec;
    if (usl == null || lsl == null || spc.histogram.length === 0) return null;
    const lo = spc.histogram[0]!.start;
    const hi = spc.histogram[spc.histogram.length - 1]!.end;
    const n = spc.histogram.filter((b) => b.end <= lsl || b.start >= usl).reduce((t, b) => t + b.count, 0);
    const clipped = lsl < lo || usl > hi;
    if (clipped) {
      return ` The ${lsl}–${usl}${unit} tolerance is wider than the spread shown, so its limits sit off this chart — every reading here is inside it.`;
    }
    return n > 0 ? ` ${fmtInt(n)} readings fall outside ${lsl}–${usl}${unit}.` : ' No reading falls outside the tolerance.';
  }, [spc, unit]);

  const inspectStation = (s: StationStat) =>
    onInspect({
      type: 'cone',
      from,
      to,
      station: s.station,
      label: `station ${s.station} over ${from === to ? from : `${from}–${to}`} (mean ${s.mean}${unit}, ${s.delta > 0 ? '+' : ''}${s.delta}${unit} vs line)`,
    });

  // The panel title IS the finding, per the design. It names the extremes only
  // when they are past the action threshold — the prototype's "Station 5 is 24 g
  // light. Station 10 is 19 g heavy." is a standing claim, and on this line the
  // flagged station changes with the date range, so it has to be derived.
  const stationVerdict = useMemo(() => {
    const flagged = spc.stations.filter((s) => s.flagged).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    if (flagged.length === 0) {
      return {
        title: `No station is far enough off to act on`,
        lede: `All ${spc.stations.length} sit inside the ±${spc.practicalThresholdG}${unit} action band. ${spc.distinguishableStationCount} of them differ from the line average by more than measurement noise, but not by enough to matter.`,
      };
    }
    const phrase = (s: StationStat) => `Station ${s.station} is ${Math.abs(s.delta)}${unit} ${s.delta < 0 ? 'light' : 'heavy'}`;
    const named = flagged.slice(0, 2).map(phrase).join('. ');
    const rest = spc.stations.length - Math.min(2, flagged.length);
    return {
      title: `${named}.`,
      lede:
        flagged.length > 2
          ? `${flagged.length - 2} more are also past the ±${spc.practicalThresholdG}${unit} action band; the rest sit inside it.`
          : `The other ${rest} sit inside the ±${spc.practicalThresholdG}${unit} action band — leave them alone.`,
    };
  }, [spc, unit]);

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Every {type} weighed{from === to ? `, ${from}` : ''}</h3>
          <span className="mono-note">{fmtInt(spc.count)} readings · {spc.histogram.length} bins</span>
        </div>
        <p className="panel-lede">
          {spc.spec.usl != null
            ? 'Bars outside the tolerance are marked. Lines are the tolerance limits and the measured mean.'
            : 'The line is the measured mean. Pick a tolerance above to mark the bars outside it.'}
          {outOfSpecNote}
        </p>
        <ResizableChart initialHeight={300}>
          {(h) => <Histogram bins={spc.histogram} mean={spc.mean} usl={spc.spec.usl} lsl={spc.spec.lsl} unit={unit} height={h} />}
        </ResizableChart>
        <div className="panel-foot">
          {/* The histogram's population stops at the plausibility window, so the
              readings it drops have to be named somewhere or a scale fault just
              disappears from the screen. This is the only place they surface. */}
          Physically implausible readings are excluded as scale faults, in spec or not.
          {excluded.length > 0 && (
            <>
              {' '}
              <b>{excluded.length} sub-floor reading{excluded.length === 1 ? '' : 's'}</b> in this range:{' '}
              {excluded.slice(0, 4).map((o, i) => (
                <span key={i} className="mono-note">
                  {o.weight}{o.unit}{o.shiftDate ? ` on ${o.shiftDate}` : ''}{i < Math.min(4, excluded.length) - 1 ? ' · ' : ''}
                </span>
              ))}
              {excluded.length > 4 && <span className="mono-note"> · +{excluded.length - 4} more</span>}.
            </>
          )}
          <ExportCsv
            name={csvName(`distribution-${type}`, from, to)}
            headers={[`bin_start_${unit}`, `bin_end_${unit}`, 'count']}
            rows={() => spc.histogram.map((b) => [b.start, b.end, b.count])}
          />
        </div>
      </section>

      {type === 'cone' && spc.stations.length > 0 && (
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <div>
              <h3 className="panel-sub-verdict">{stationVerdict.title}</h3>
              <p className="panel-lede">{stationVerdict.lede}</p>
            </div>
            <span className="mono-note">±{spc.practicalThresholdG}{unit} action threshold</span>
          </div>
          <ResizableChart initialHeight={300}>
            {(h) => (
              <StationChart
                stations={spc.stations}
                grandMean={spc.grandMean}
                threshold={spc.practicalThresholdG}
                unit={unit}
                height={h}
                onStationClick={inspectStation}
              />
            )}
          </ResizableChart>
          <div className="panel-foot">
            Each bar is a station's mean against the line average of {spc.grandMean}{unit}; click one to see its {noun}.
            The threshold is {spc.spec.source !== 'none' ? '10% of the selected tolerance' : '0.3σ of the measured spread'},
            so it moves when you change the tolerance above.
            <ExportCsv
              name={csvName(`per-station-${type}`, from, to)}
              headers={['station', 'n', `mean_${unit}`, `stdev_${unit}`, `delta_vs_line_${unit}`, 'statistically_distinguishable', 'flagged_actionable']}
              rows={() => spc.stations.map((st) => [st.station, st.n, st.mean, st.stdev, st.delta, st.distinguishable, st.flagged])}
            />
          </div>
        </section>
      )}

      {wErr ? (
        <div className="error-card" role="alert" style={{ marginTop: 14 }}>
          <b>Couldn't load the giveaway figure.</b> {wErr}
        </div>
      ) : weights && weights.cone.giveawayPerConeG != null ? (
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <h3 className="panel-title">Material given away</h3>
            <div className="field inline">
              <label>Weight basis (Q4 / Q5)</label>
              <Segmented
                value={basis}
                onChange={onBasis}
                options={(['as_recorded', 'gross', 'net'] as Basis[]).map((b) => ({
                  key: b,
                  label: b === 'as_recorded' ? 'As recorded' : b[0]!.toUpperCase() + b.slice(1),
                }))}
              />
            </div>
          </div>

          <div className="giveaway">
            {giveaway ? (
              <div className="gv-big">
                <span className={weights.cone.giveawayPerConeG >= 0 ? 'accent' : ''}>
                  {Math.abs(giveaway.kgPerDay)} kg/day
                </span>{' '}
                {weights.cone.giveawayPerConeG >= 0 ? 'overfill' : 'underfill'} · ≈{Math.abs(giveaway.annualizedTonnes)} t/year
              </div>
            ) : (
              <div className="gv-big">
                {weights.cone.giveawayPerConeG >= 0 ? 'Overfill' : 'Underfill'} vs {weights.cone.nominalSetpointG}{unit} nominal
              </div>
            )}

            {/* The most quotable number in the app. The basis toggle no longer
                moves it (weights.ts adjusts the nominal by the same tube
                weight), but it is still unquotable: the setpoint's own basis is
                unconfirmed, and if it is stated opposite to the recorded weight
                this figure is out by the full tube weight. The caveat travels
                with the number so it cannot be screenshotted without it. */}
            {weights.cone.provisionalReasons.length > 0 && (
              <div className="provisional" role="note">
                <b>Provisional — not for quoting yet.</b>
                <ul>
                  {weights.cone.provisionalReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="panel-lede">
              {weights.note} Average cone <b>{weights.cone.avg}g</b> against {weights.cone.nominalSetpointG}g nominal
              {weights.cone.nominalSource === 'current_product'
                ? ` (${weights.cone.nominalLabel}'s own setpoint)`
                : ' (fallback — no product selected)'}
              {' — '}{weights.cone.giveawayPerConeG > 0 ? '+' : ''}
              {weights.cone.giveawayPerConeG} g/cone across {fmtInt(weights.cone.count)} cones over {days} day{days === 1 ? '' : 's'}
              {weights.cone.giveawayTotalKg != null && <> ≈ <b>{weights.cone.giveawayTotalKg} kg</b> against nominal</>}.
              {giveaway && (
                <>
                  {' '}The daily and yearly figures apply that per-cone rate to a typical day of{' '}
                  <b>{fmtInt(giveaway.medianConesPerDay)} cones</b> (the median), so a partly-finished day can't drag
                  them{giveaway.partialDays > 0 ? ` — ${giveaway.partialDays} in this range` : ''}. Straight-line
                  extrapolation, not a forecast.
                </>
              )}
            </p>
            <p className="panel-lede">
              This block is the only thing on the screen that moves with the basis toggle. The verdict, the
              histogram and the stations above are all measured on weights exactly as the PLC recorded them.
            </p>
          </div>
        </section>
      ) : null}
    </>
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

function ProductDetailLine({ p }: { p: ProductOption }) {
  const parts: string[] = [];
  if (p.blend) parts.push(`Blend ${p.blend}`);
  if (p.countText) parts.push(`Count ${p.countText}`);
  if (p.tubeType) parts.push(`Tube ${p.tubeType}${p.tubeWeightG != null ? ` (${p.tubeWeightG}g)` : ''}`);
  if (p.setpointG != null && (p.weightOffsetMinusG != null || p.weightOffsetPlusG != null)) {
    parts.push(`Tolerance ${p.setpointG}g −${p.weightOffsetMinusG ?? 0}/+${p.weightOffsetPlusG ?? 0}g`);
  }
  if (!parts.length && p.activeFlag !== false) return null;
  return (
    <span className="cp-detail">
      {parts.join(' · ')}
      {p.activeFlag === false && (
        <span className="cp-inactive-warn"> ⚠ marked inactive in PDAS</span>
      )}
    </span>
  );
}

function CurrentProductBar({
  rank,
  onOpenTimeline,
  onProductChanged,
}: {
  rank: number;
  onOpenTimeline: () => void;
  onProductChanged: () => void;
}) {
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

  const currentDetail = current ? products.find((p) => p.productId === current.productId) ?? null : null;
  const selectedProduct = sel === '' ? null : products.find((p) => p.productId === Number(sel)) ?? null;

  const apply = async () => {
    if (sel === '') return;
    setSaving(true);
    try {
      const chosen = products.find((p) => p.productId === Number(sel)) ?? null;
      const r = await setCurrentProduct(Number(sel));
      setCurrent(r.current);
      setSel('');
      setJustChanged(chosen);
      onProductChanged();
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
            {currentDetail && <ProductDetailLine p={currentDetail} />}
          </>
        ) : (
          <span className="val none">Not set — production is unattributed (Q1)</span>
        )}
        {justChanged && (
          <span className="cp-confirm">✓ Changed to {productLabel(justChanged)}</span>
        )}
        <button type="button" className="rr-link cp-history-link" onClick={onOpenTimeline}>
          View history →
        </button>
      </div>
      {canSet && (
        <div className="cp-set">
          <div className="cp-set-row">
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
          {selectedProduct && <ProductDetailLine p={selectedProduct} />}
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
  const [excluded, setExcluded] = useState<ExcludedDay[]>([]);

  // What the date pickers are NOT offering, and why. Stated here rather than
  // left implicit: narrowing the window silently is the kind of thing that
  // makes a user distrust every other figure on the screen.
  useEffect(() => {
    let cancelled = false;
    getRange()
      .then((r) => !cancelled && setExcluded(r.excludedDays ?? []))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [reloadKey]);

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
  if (loading || !data) return <div className="sk sk-chart" />;

  // Freshness is judged on the OLDEST table, not an average: one stalled table
  // is a stalled pipeline, and averaging would hide it.
  const ages = data.sync.map((s) => s.ageSeconds).filter((a): a is number => a != null);
  const worstAge = ages.length ? Math.max(...ages) : null;
  const level = freshnessLevel(worstAge);
  const anyFailed = data.sync.some((s) => s.outcome !== 'success');
  const sev = data.dq.bySeverity;
  const blocking = (sev.CRITICAL ?? 0) + (sev.ERROR ?? 0);
  const life = data.lifetime;

  return (
    <>
      <section className="sync-verdict">
        <div className="sv-main">
          <div className="sync-live">
            <span className={`dot ${anyFailed || level === 'crit' ? 'crit' : level === 'warn' ? 'warn' : 'ok'}`} />
            <span className="mono-note">
              {data.sync.length} table{data.sync.length === 1 ? '' : 's'} · read-only, never written to
            </span>
          </div>
          <h2 className="sv-headline">
            {anyFailed
              ? 'Ingestion reported a failure on its last pass'
              : level === 'ok'
                ? `Sync is healthy — all ${data.sync.length} tables current`
                : `Sync last completed ${ageLabel(worstAge)}`}
          </h2>
          <p className="sv-sub">
            Everything the other pages show is derived from this pipeline, so this is the page to check first
            if a figure looks wrong.
            {level !== 'ok' && !anyFailed && (
              <> A large age here does not mean data was lost — the raw layer is append-only and the sync resumes
              from its stored watermark, so restarting the worker picks up exactly where it stopped. It means the
              newest events on the line may not be in the app yet.</>
            )}
          </p>
        </div>
        <button type="button" className="ghost-btn" onClick={() => setReloadKey((k) => k + 1)}>Re-check now</button>
      </section>

      {excluded.length > 0 && (
        <div className="rule-note" style={{ marginBottom: 14 }}>
          <b>{excluded.length} day{excluded.length === 1 ? '' : 's'} held out of the date range.</b>{' '}
          {excluded.map((d) => `${d.date} (${d.rows} reading${d.rows === 1 ? '' : 's'})`).join(', ')} —
          too few readings to be a production day. The readings themselves are kept and still count in
          totals; only the day is not offered as a date. See the <b>stale_timestamp</b> finding below for
          the station clock behind it.
        </div>
      )}

      {/* Lifetime figures, not just the last pass. sync_run holds one row per
          table per pass, so passes and table-runs are shown as the different
          things they are — calling 65 rows "65 runs" would overstate the work
          by the number of source tables. */}
      <div className="loss-grid sync-tiles">
        <div className="loss">
          <div className="loss-val">{fmtInt(life.passes)}</div>
          <div className="loss-key">
            passes since install
            {life.firstRunUtc && <> · first {fmtDateTime(life.firstRunUtc)}</>}
          </div>
        </div>
        <div className="loss">
          <div className={`loss-val ${level === 'crit' ? 'alarm' : level === 'warn' ? 'warn' : ''}`}>{ageLabel(worstAge)}</div>
          <div className="loss-key">since the oldest table last ran</div>
        </div>
        <div className="loss">
          <div className={`loss-val ${life.failures > 0 ? 'alarm' : ''}`}>{fmtInt(life.failures)}</div>
          <div className="loss-key">failed of {fmtInt(life.tableRuns)} table-runs</div>
        </div>
        <div className="loss">
          <div className="loss-val">{life.medianMs == null ? '—' : `${fmtInt(life.medianMs)}ms`}</div>
          <div className="loss-key">
            median table sync
            {life.p95Ms != null && <> · p95 {fmtInt(life.p95Ms)}ms</>}
          </div>
        </div>
      </div>

      {/* A bare failure count is not actionable: it does not say what broke,
          when, or whether it is still broken. */}
      {life.lastFailure && (
        <div className="rule-note" style={{ marginBottom: 14 }}>
          <b>Last failure:</b> <span className="mono">{life.lastFailure.targetTable}</span>{' '}
          at {fmtDateTime(life.lastFailure.startedAtUtc)}
          {life.lastFailure.error && <> — <span className="mono">{life.lastFailure.error}</span></>}.{' '}
          {data.sync.find((x) => x.targetTable === life.lastFailure!.targetTable)?.outcome === 'success'
            ? 'That table has completed successfully since, so this is history rather than an open fault.'
            : 'That table has not completed successfully since — this one is still open.'}
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Ingestion by table</h3>
          <span>
            <span className="mono-note">{data.sync.length} source tables</span>
            <ExportCsv
              name={csvName('operations-ingestion')}
              headers={['target_table', 'outcome', 'watermark', 'rows_read', 'rows_written', 'finished_at_utc', 'age_seconds']}
              rows={() => data.sync.map((x) => [x.targetTable, x.outcome, x.watermark, x.rowsRead, x.rowsWritten, x.finishedAtUtc, x.ageSeconds])}
            />
            <PrintButton />
          </span>
        </div>
        <div className="panel-lede">
          Each table advances its own <b>watermark</b> — the highest source row id already ingested — so a
          pass reads only what is new and a restart never re-reads from the beginning. Rows read exceeds
          rows written because a deliberate overlap window re-reads recent rows to catch late-arriving
          edits; re-ingesting an unchanged row writes nothing.
        </div>
        <div className="table-scroll">
          <table className="reg-table light">
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
          <h3 className="panel-title">Schema-drift guard</h3>
          <span className="mono-note">{data.schema.length} source tables fingerprinted</span>
        </div>
        <div className="panel-lede">
          Each source table's column names and types are hashed. If IFL changes a table we depend on,
          the fingerprint stops matching and <b>the sync halts with an explicit error instead of writing
          wrong data</b>. A silent corruption is far more expensive than a loud stop, so this is
          deliberately fail-closed.
        </div>
        <div className="table-scroll">
          <table className="reg-table light">
            <thead>
              <tr><th>Source table</th><th>Status</th><th>Fingerprint</th></tr>
            </thead>
            <tbody>
              {data.schema.map((f) => (
                <tr key={f.table}>
                  <td className="mono">{f.table}</td>
                  <td><span className="pill on">{f.status === 'ok' ? 'matching' : f.status}</span></td>
                  <td className="mono dim">{f.fingerprint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ height: 16 }} />

      <div className="panel">
        <div className="panel-head">
          <h3 className="panel-title">Data-quality findings</h3>
          <span>
            <span className="mono-note">
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
        <div className="panel-lede">
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
            <table className="reg-table light">
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
        <div className="panel-foot" style={{ marginTop: 12 }}>
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

/**
 * Setup. The section column declares four tabs — People, Stations, Rules, Sync —
 * and this switches on them. It previously rendered all three panels stacked in
 * one grid and ignored `sub`, so the tabs highlighted but did nothing: the fifth
 * place in this app where the column was controlling nothing.
 *
 * Sync is the same OperationsView reachable at ?v=operations. One component, two
 * routes, rather than a second copy that can drift.
 */
function AdminView({ sub, onMeta }: { sub: string; onMeta: (m: Meta) => void }) {
  if (sub === 'stations') return <StationsPanel />;
  if (sub === 'rules') return <RulesPanel />;
  if (sub === 'sync') return <OperationsView onMeta={onMeta} />;
  return <UsersPanel />;
}

function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [nu, setNu] = useState({ username: '', password: '', role: 'operator', displayName: '' });
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => adminListUsers().then((r) => setUsers(r.users)).catch((e) => setErr(String(e.message)));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setErr(null);
    try {
      await adminCreateUser(nu);
      setNu({ username: '', password: '', role: 'operator', displayName: '' });
      setAdding(false);
      load();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">People</h3>
          <p className="panel-lede">
            {users.length} account{users.length === 1 ? '' : 's'}. Passwords are argon2-hashed — IFL's own
            Users table, which stores them in plain text, is never read.
          </p>
        </div>
        <button type="button" className="cta" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          {adding ? 'Cancel' : 'Add person'}
        </button>
      </div>

      {adding && (
        <div className="rec-filters" style={{ marginBottom: 14 }}>
          <div className="field">
            <label>Username</label>
            <input value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} />
          </div>
          <div className="field">
            <label>Display name</label>
            <input value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} />
          </div>
          <div className="field">
            <label>Password (min 6)</label>
            <input type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
          </div>
          <div className="field">
            <label>Role</label>
            <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>
              {['operator', 'supervisor', 'manager', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button type="button" className="cta" disabled={!nu.username || nu.password.length < 6} onClick={create}>
            Create account
          </button>
        </div>
      )}

      <div className="setup-table">
        <div className="st-head">
          <span>Name</span><span>Username</span><span>Role</span><span>Status</span><span />
        </div>
        {users.map((u) => (
          <div className="st-row" key={u.userId}>
            <span>{u.displayName ?? u.username}</span>
            <span className="mono">@{u.username}</span>
            <span>
              <select
                aria-label={`Role for ${u.username}`}
                value={u.role}
                onChange={(e) => adminUpdateUser(u.userId, { role: e.target.value }).then(load)}
              >
                {['operator', 'supervisor', 'manager', 'admin'].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </span>
            <span><span className={`pill ${u.active ? 'on' : 'off'}`}>{u.active ? 'active' : 'disabled'}</span></span>
            <span className="num">
              <button type="button" className="ghost-btn sm" onClick={() => adminUpdateUser(u.userId, { active: !u.active }).then(load)}>
                {u.active ? 'Disable' : 'Enable'}
              </button>
            </span>
          </div>
        ))}
      </div>

      {err && <div className="error-card" role="alert" style={{ marginTop: 14 }}>{err}</div>}

      <div className="panel-foot">
        Operators read Line, Records and Shifts. Supervisors add Output, Weight, Rejects and can set the
        running product. Managers can export and name reject codes. Admins can open Setup.
      </div>
    </section>
  );
}

function StationsPanel() {
  const [rows, setRows] = useState<StationRow[]>([]);
  const [edited, setEdited] = useState<Record<number, StationRow>>({});
  const [flagged, setFlagged] = useState<number[]>([]);
  const load = () => adminListStations().then((r) => setRows(r.stations));
  useEffect(() => { load(); }, []);

  // Which stations the weight SPC currently flags, so the ones worth naming
  // first are obvious. Marked, never reordered — the list is a fixed physical
  // layout and shuffling it would make positions hard to find.
  useEffect(() => {
    let cancelled = false;
    getRange()
      .then((r) => (r.minDate && r.maxDate ? getSpc({ type: 'cone', from: r.minDate, to: r.maxDate }) : null))
      .then((sp) => {
        if (cancelled || !sp) return;
        setFlagged(sp.data.stations.filter((s) => s.flagged).map((s) => s.station));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const val = (s: StationRow) => edited[s.stationId] ?? s;
  const change = (id: number, patch: Partial<StationRow>) =>
    setEdited((e) => ({ ...e, [id]: { ...(e[id] ?? rows.find((r) => r.stationId === id)!), ...patch } }));
  const save = async (s: StationRow) => {
    const v = val(s);
    await adminSetStation(s.stationId, { name: v.name, machine: v.machine, description: v.description });
    setEdited((e) => { const n = { ...e }; delete n[s.stationId]; return n; });
    load();
  };

  const named = rows.filter((s) => (s.name ?? '').trim().length > 0).length;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">Stations</h3>
          <p className="panel-lede">
            {named} of {rows.length} named. Naming a position makes every station-wise chart and drill-down
            read in plant language instead of a bare number (Q11).
            {flagged.length > 0 && (
              <> Station{flagged.length > 1 ? 's' : ''} <b>{flagged.join(' and ')}</b> {flagged.length > 1 ? 'are' : 'is'} currently
              flagged on weight — worth naming first.</>
            )}
          </p>
        </div>
      </div>

      <div className="station-grid">
        {rows.map((s) => {
          const isFlagged = flagged.includes(s.stationId);
          const dirty = !!edited[s.stationId];
          return (
            <div className={`station-row${isFlagged ? ' flagged' : ''}`} key={s.stationId}>
              <span className="sr-idx">{s.stationId}</span>
              <input
                className="sr-name"
                aria-label={`Name for station ${s.stationId}`}
                value={val(s).name ?? ''}
                placeholder="unnamed"
                onChange={(e) => change(s.stationId, { name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && dirty && save(s)}
              />
              {dirty && (
                <button type="button" className="cta sm" onClick={() => save(s)}>Save</button>
              )}
            </div>
          );
        })}
      </div>

      <div className="panel-foot">
        Machine and description are also stored per station; they appear in the CSV exports.
      </div>
    </section>
  );
}

function RulesPanel() {
  const [rules, setRules] = useState<Rules | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [plausErr, setPlausErr] = useState<string | null>(null);
  const [plausSaving, setPlausSaving] = useState(false);
  // Draft fields for the plausibility form, seeded from the loaded rule and
  // re-seeded whenever it reloads — same "edit a copy, Save when dirty"
  // shape as the Stations panel's per-row inputs.
  const [plausDraft, setPlausDraft] = useState<{ coneLoG: string; coneHiG: string; sackLoKg: string; sackHiKg: string } | null>(null);
  const load = () => adminGetRules().then((r) => {
    setRules(r);
    setPlausDraft({
      coneLoG: String(r.plausibility?.coneLoG ?? 1500),
      coneHiG: String(r.plausibility?.coneHiG ?? 2100),
      sackLoKg: String(r.plausibility?.sackLoKg ?? 40),
      sackHiKg: String(r.plausibility?.sackHiKg ?? 60),
    });
  });
  useEffect(() => { load(); }, []);

  if (!rules || !plausDraft) return <div className="sk sk-chart" />;

  const setWeight = async (basis: string) => {
    await adminSetWeightRule({ basis, coneTubeWeightG: rules.weight?.coneTubeWeightG ?? 70, sackTareKg: rules.weight?.sackTareKg ?? 0.5, reason: 'admin UI' });
    load();
  };
  const setShift = async (mode: string) => {
    const r = await adminSetShiftRule({ mode, nightBelongsTo: rules.shift?.nightBelongsTo ?? 'start_day', reason: 'admin UI' });
    setNote(r.note ?? null);
    load();
  };

  const basis = (rules.weight?.basis ?? 'as_recorded') as 'as_recorded' | 'gross' | 'net';
  const mode = (rules.shift?.mode ?? 'corrected') as 'corrected' | 'legacy';

  const plausDirty =
    !!rules.plausibility &&
    (plausDraft.coneLoG !== String(rules.plausibility.coneLoG) ||
      plausDraft.coneHiG !== String(rules.plausibility.coneHiG) ||
      plausDraft.sackLoKg !== String(rules.plausibility.sackLoKg) ||
      plausDraft.sackHiKg !== String(rules.plausibility.sackHiKg));
  const plausParsed = {
    coneLoG: Number(plausDraft.coneLoG), coneHiG: Number(plausDraft.coneHiG),
    sackLoKg: Number(plausDraft.sackLoKg), sackHiKg: Number(plausDraft.sackHiKg),
  };
  const plausValid =
    Object.values(plausParsed).every((n) => Number.isFinite(n) && n > 0) &&
    plausParsed.coneLoG < plausParsed.coneHiG &&
    plausParsed.sackLoKg < plausParsed.sackHiKg;
  const savePlausibility = async () => {
    if (!plausValid) return;
    setPlausSaving(true);
    setPlausErr(null);
    try {
      await adminSetPlausibilityRule({ ...plausParsed, reason: 'admin UI' });
      await load();
    } catch (e) {
      setPlausErr((e as Error).message ?? 'save failed');
    } finally {
      setPlausSaving(false);
    }
  };

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Weight basis</h3>
            <p className="panel-lede">
              Whether a recorded weight is the cone plus its tube, or the yarn alone. This is IFL's open
              question Q4/Q5, and it is set here once they answer — no redeploy.
            </p>
          </div>
          <span className="mono-note">applies immediately · read-time</span>
        </div>
        <Segmented
          value={basis}
          onChange={setWeight}
          options={(['as_recorded', 'gross', 'net'] as const).map((b) => ({
            key: b,
            label: b === 'as_recorded' ? 'As recorded' : b[0]!.toUpperCase() + b.slice(1),
          }))}
        />
        <div className="panel-foot">
          <b>Gross and As-recorded are the same number</b> — the tube is only subtracted on Net, so choosing
          Gross moves nothing until IFL confirms which the PLC records. Net subtracts the{' '}
          {rules.weight?.coneTubeWeightG ?? 70} g tube and {rules.weight?.sackTareKg ?? 0.5} kg sack tare from
          readings <b>and</b> from the setpoint, so cone giveaway is unchanged by design; what moves is the
          absolute weights, and the Overview's total sack kilograms. That tare is a seeded default, not a
          measured value. Every giveaway figure carries a "provisional" caveat until Q4/Q5 is answered.
          This applies at read time, immediately, for every user — unlike the shift rule below.
        </div>
      </section>

      <section className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Shift basis</h3>
            <p className="panel-lede">
              Whether a reading's shift is recomputed from its production time, or taken from the value the
              plant stored. The stored value is derived from insert time and disagrees on a measurable share
              of rows (Q7).
            </p>
          </div>
          <span className="mono-note">needs a rebuild to apply</span>
        </div>
        <Segmented
          value={mode}
          onChange={setShift}
          options={(['corrected', 'legacy'] as const).map((m) => ({ key: m, label: m[0]!.toUpperCase() + m.slice(1) }))}
        />
        {note && <div className="rule-note" style={{ marginTop: 12 }}>⚠ {note}</div>}
        <div className="panel-foot">
          Changing this appends a new versioned rule; it does not rewrite stored rows. Run the canonical
          rebuild to apply it to history.
        </div>
      </section>

      <section className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <div>
            <h3 className="panel-title">Plausibility window</h3>
            <p className="panel-lede">
              Below (or, for cones, above) these bounds a reading is a scale fault, not a light or heavy cone
              — excluded from SPC and from the giveaway stats rather than skewing them. Was fixed in code;
              now a versioned rule like the two above it.
            </p>
          </div>
          <span className="mono-note">applies immediately · read-time</span>
        </div>
        <div className="rec-filters" style={{ marginBottom: 0 }}>
          <div className="field">
            <label>Cone min (g)</label>
            <input
              type="number" min={0} step={1} value={plausDraft.coneLoG}
              onChange={(e) => setPlausDraft({ ...plausDraft, coneLoG: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Cone max (g)</label>
            <input
              type="number" min={0} step={1} value={plausDraft.coneHiG}
              onChange={(e) => setPlausDraft({ ...plausDraft, coneHiG: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Sack min (kg)</label>
            <input
              type="number" min={0} step={0.1} value={plausDraft.sackLoKg}
              onChange={(e) => setPlausDraft({ ...plausDraft, sackLoKg: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Sack max (kg)</label>
            <input
              type="number" min={0} step={0.1} value={plausDraft.sackHiKg}
              onChange={(e) => setPlausDraft({ ...plausDraft, sackHiKg: e.target.value })}
            />
          </div>
          {plausDirty && (
            <button type="button" className="cta" disabled={!plausValid || plausSaving} onClick={savePlausibility}>
              {plausSaving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
        {plausDirty && !plausValid && (
          <div className="rule-note" style={{ marginTop: 12 }}>⚠ Each min must be less than its max, and every value positive.</div>
        )}
        {plausErr && <div className="error-card" role="alert" style={{ marginTop: 12 }}>{plausErr}</div>}
        <div className="panel-foot">
          Bounds are deliberately generous — wide enough that no genuinely out-of-tolerance cone is ever
          discarded, tight enough to drop non-readings. Real sacks run ~47 kg; the widest real product
          tolerance sits inside 1910–2010 g. Widening these does not relax any product tolerance — it only
          changes which readings count as measurements at all.
        </div>
      </section>

      {/* The design's Rules panel shows four toggles. Three are now real; the
          stoppage threshold is genuinely per-view rather than a standing rule
          (it already varies by what a user is looking at on Output), so it
          stays a stated fact rather than a fourth control here. */}
      <section className="panel" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <h3 className="panel-title">Fixed in code</h3>
          <span className="mono-note">not settable here</span>
        </div>
        <div className="setup-table fixed">
          <div className="st-row">
            <span>Stoppage threshold</span>
            <span className="mono">120 s default</span>
            <span className="dim">adjustable per-view on Output</span>
          </div>
        </div>
        <div className="panel-foot">
          Per-view rather than a standing rule — each Output chart already lets you change it there.
        </div>
      </section>
    </>
  );
}

