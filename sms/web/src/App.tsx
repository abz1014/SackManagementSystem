/**
 * The application shell: authentication, one route, one period, one sheet.
 *
 * This file replaced a 7,400-line App.tsx that held every screen, every chart
 * and every helper in one module. The screens now live under `screens/`, the
 * shared pieces under `ui/`, and the rules that must not differ between
 * screens — what a period means, whether the data can be trusted — under
 * `lib/`. What is left here is routing and nothing else.
 *
 * THE PERIOD AND THE ROUTE BOTH LIVE IN THE URL. That is what makes one global
 * period control possible: every screen reads the same value, a refresh keeps
 * it, and a link pasted to a colleague opens on the same period in their
 * browser. The old app had seven date controls that disagreed with each other,
 * which is why nobody could say what period a number described.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  getMe, logout as apiLogout, setUnauthorizedHandler, ROLE_RANK, REPORT_TYPES, CONE_STATES,
  type AuthUser, type ReportType, type ConeState, type SpcType,
} from './api';
import { LiveProvider, readAsOf, useLive, usePlantNow } from './lib/live';
import { assessHealth } from './lib/health';
import { parsePeriodParams, resolvePeriod, samePeriodParams, writePeriodParams, type PeriodParams, type ShiftCode } from './lib/period';
import { W } from './lib/words';
import { Bar, SCREENS, PRODUCT_TABS, type Screen, type ReadingsFilter, type ProductTab } from './ui/Bar';
import { Loading } from './ui/bits';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { SimulatorBanner } from './ui/SimulatorBanner';
import { LineScreen } from './screens/Line';
import { ReadingsScreen, LISTINGS, type Listing } from './screens/Readings';
import { ReadingSheet } from './screens/ReadingSheet';
import { StationSheet } from './screens/StationSheet';
import { ProductScreen } from './screens/Product';
import { ReportScreen } from './screens/Report';
import { WeightScreen, type WeightMode } from './screens/Weight';
import { RejectsScreen } from './screens/Rejects';
import { ReasonSheet, reasonIdOf } from './screens/ReasonSheet';
import { WallScreen } from './screens/Wall';
import { SetupScreen } from './screens/Setup';
import { HealthScreen } from './screens/Health';
import { SacksScreen, type SackUnit } from './screens/Sacks';
import { StockSheet } from './screens/StockSheet';
import { LoginScreen } from './screens/Login';
import './app.css';

/* ------------------------------------------------------------------- zoom */

/**
 * Chart overhaul, Task T8a (29 Sep 2026): a chart's drag-select sets the
 * WHOLE PAGE period (owner decision), snapped to shifts by the caller before
 * it ever reaches here (see lib/period.ts's `snapToShifts`/`dayToShiftRange`,
 * already wired into StationSheet's own daily-means chart by Task T7). This
 * is the other half — the undo, and a way for a screen to trigger it without
 * a prop drilled all the way through `Chrome`'s already-large render.
 *
 * Screens receive individual callbacks today (onNavigate, onOpenStation, the
 * `onSelectPeriod` StationSheet already takes) rather than the raw `go()` —
 * so `zoomTo`/`back` join that vocabulary as a small context instead of
 * widening every screen's prop list for one capability several unrelated
 * charts (Weight, Report, Line, Rejects — each owned by a different task)
 * will want the same way. `useZoom()` follows `useLive()`'s own contract
 * (lib/live.tsx): it throws outside the provider, so a screen that forgets to
 * render inside `<App/>` fails loudly in development instead of quietly
 * no-opping.
 */
export interface ZoomApi {
  /** Push a new whole-page period, remembering the one being left in
   *  `history.state.zoomFrom` so `back` (or the bar's own "Back to previous
   *  range" control) can restore it. A zoom is always a PUSH — it is exactly
   *  the kind of navigation a reader may want to undo with Back (see `go`'s
   *  own push-vs-replace rule below), never a replace. */
  zoomTo: (p: PeriodParams) => void;
  /** Undo the most recent zoom: `history.back()`. Safe to call with nowhere
   *  to go back to (it simply does nothing observable); callers should still
   *  prefer `canGoBack` to decide whether to show a control at all — the same
   *  check StationSheet's own per-chart back button already makes. */
  back: () => void;
  /** True only when the CURRENT history entry was reached by a zoom (its
   *  `state.zoomFrom` is set) — panning (`{ replace: true }`) preserves
   *  whatever this was before the pan, so it stays true while panning around
   *  inside a zoomed-in range. */
  canGoBack: boolean;
}

const ZoomContext = createContext<ZoomApi | null>(null);

/** True when zoomTo(p) targeting the period already on screen should do
 *  nothing — no history push, no re-render of the zoomFrom trail. */
export function zoomIsNoop(next: PeriodParams, current: PeriodParams): boolean {
  return samePeriodParams(next, current);
}

export function useZoom(): ZoomApi {
  const ctx = useContext(ZoomContext);
  if (!ctx) throw new Error('useZoom() must be called inside <App/>');
  return ctx;
}

/** The one custom field this app ever pushes onto `history.state`. Read back
 *  on mount and on every `popstate` so the bar's "Back to previous range"
 *  control tracks Back/Forward navigation, not just the zoom that pushed it. */
interface NavState {
  zoomFrom?: PeriodParams;
}

function readZoomFrom(): PeriodParams | null {
  if (typeof window === 'undefined') return null;
  return (window.history.state as NavState | null)?.zoomFrom ?? null;
}

/* ------------------------------------------------------------------ route */

// 'health' is now one of Bar's own SCREENS (28 Sep 2026 — see ui/Bar.tsx),
// so it comes in through `Screen` already; no longer spelled out separately.
type View = Screen | 'setup' | 'wall';

export interface Sheet {
  /** 'reason' (roadmap Phase 5): one day's rejects of one code, id `<day>|<type>|<tube>|<material>`.
   *  'stock' (roadmap Phase 7): one production day's stock movements, id `<day>`.
   *  'product' is GONE as a sheet kind (UX Phase 6 Brief 1, 16 Sep 2026):
   *  the old product sheet component is deleted, absorbed into the Product nav screen. An
   *  incoming `?sheet=product:*` is a legacy bookmark and is redirected to
   *  `?s=product` in `parseRoute` below, never parsed into a live sheet. */
  kind: 'station' | 'cone' | 'sack' | 'reject' | 'reason' | 'stock';
  id: string;
}

/**
 * Roadmap Phase 2b (16 Sep 2026) — screen state joins the route.
 *
 * Ten pieces of user-chosen state used to live in component memory and never
 * reach the URL: a user could not send a colleague what they were looking at,
 * bookmark it, or keep it across a reload. Each new field below is one of
 * them, keyed tersely (these links get pasted into chat) and following `rf`'s
 * precedent — an enum or number, validated on the way in, omitted from the
 * URL whenever it equals the screen's default.
 *
 * STATION AND PRODUCT ARE SHARED, DELIBERATELY, NOT PER-SCREEN. The Phase 2a
 * IA review (`audit/IA-PROPOSAL.md` §7) flagged that Readings, Weight and
 * Report each picked "which station" under their own local name; giving each
 * its own URL key would have meant three parameters for one real-world
 * selection, and a second migration the day a link had to carry a station
 * choice from one screen to another (Weight's station table already means to
 * open that station's readings — see roadmap Phase 2a). One key, `st` (and
 * `pr` for product, shared the same way between Report and Rejects), means a
 * link that sets it filters every screen that understands it consistently,
 * and switching screens without touching it keeps the same station in view.
 * Nothing else here is shared: `listing`, `mode`, `unit` and a page number
 * mean nothing outside the one screen that owns them.
 */
export interface Route {
  view: View;
  period: PeriodParams;
  sheet: Sheet | null;
  at: string | null;
  readingsFilter: ReadingsFilter;

  /** Report: which of the ten types, and its own shift-filter override. */
  reportType: ReportType;
  reportShift: ShiftCode | null;
  /** SHARED — see the file-level note above. Read by Report's filters,
   *  Weight's chart-station selector, Readings' station chip and Rejects'
   *  station chip alike. */
  station: number | null;
  /** SHARED — Report's product filter and Rejects' product chip. */
  product: number | null;

  /** Readings: what to list, the cone-state chips, and the page. Station is
   *  the shared field above. */
  readingsListing: Listing;
  readingsStates: ConeState[];
  readingsPage: number;

  /** Weight: which chart. Chart station is the shared field above. `null`
   *  means no explicit tab was ever chosen — see the file-header note in
   *  parseRoute for why this can't just default to a fixed value here. */
  weightMode: WeightMode | null;
  /** Weight: the chart's own population, cone or sack (UX Phase 5 Brief 3
   *  unit U6, 16 Sep 2026, URL key `wt`) — follows the exact `wm` pattern. */
  weightChartType: SpcType;

  /** Sacks: the ledger's unit, and the history register's page. */
  sacksUnit: SackUnit;
  sacksPage: number;

  /** Rejects: the chosen Pareto reason. Station/product are the shared
   *  fields above — see RejectsScreen's file header for why they moved. */
  rejectsCode: string | null;

  /** Product (UX Phase 6 Brief 1, 16 Sep 2026): which of the four tabs.
   *  Product id, when one is deep-linked into Catalogue, is the SHARED
   *  `product` field above — the same key Report and Rejects use. */
  productTab: ProductTab;
}

// 'health' no longer listed separately — SCREENS carries it (see the View
// type note above).
const VIEWS: readonly View[] = [...SCREENS, 'setup', 'wall'] as const;

/**
 * The register export is requireRole(3) on the server. Offering it at rank 2
 * put a button in front of an engineer that could only ever answer 403 — and
 * a 403 is a bug, not a state. A control a role cannot use is absent.
 */
const EXPORT_RANK = 3;
/**
 * The engineer's writes (rank 2) since IFL's answers of 15 Sep 2026: naming a
 * reject code (Q12) and recording a sack movement (Q43) moved down from
 * manager, matching the server's requireRole(2) on both routes. The names
 * are viewer / engineer / manager / admin (migration 035).
 */
const ENGINEER_RANK = 2;

/** Defaults for every field this module owns — the no-window (SSR/test)
 *  fallback and the yardstick `routeSearch` omits a value against. */
const DEFAULT_ROUTE: Omit<Route, 'view' | 'period' | 'sheet' | 'at' | 'readingsFilter'> = {
  reportType: 'daily',
  reportShift: null,
  station: null,
  product: null,
  readingsListing: 'cones',
  readingsStates: [],
  readingsPage: 1,
  weightMode: null,
  weightChartType: 'cone',
  sacksUnit: 'sacks',
  sacksPage: 1,
  rejectsCode: null,
  productTab: 'running',
};

/** A positive integer, or null for anything else — missing, zero, negative,
 *  fractional or not a number at all. Never throws on a hand-edited URL. */
function parseId(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Readings' listing defaults to plain 'cones' EXCEPT when a deep-linked
 *  `rf=inspectionRejects` arrived with no explicit `rl` of its own — the one
 *  existing behaviour (`initialFilter === 'inspectionRejects'` used to seed
 *  this screen's local `useState`) an old link must keep getting for free. */
function defaultListing(rf: ReadingsFilter): Listing {
  return rf === 'inspectionRejects' ? 'inspectionRejects' : 'cones';
}

/**
 * UX Phase 10 (22 Sep 2026): Weight's chart-mode default, period-conditional.
 *
 * Distribution — a clean bell with a dashed limit and a target rule — was
 * measured by a design review as the best graphic in the application, and
 * Over time (an X̄ line) was the hardcoded default regardless of period, so
 * on the common single-shift view it rendered as a flat, near-useless line
 * one click away from the chart that actually says something. A trend line
 * needs more than one point to be a trend; a shift or a single day is one
 * point, so Distribution is the more honest default there. A period spanning
 * more than a day is exactly the case Over time exists for.
 *
 * `explicit` is `null` only when the URL carried no `wm` (or an unrecognised
 * one) — see parseRoute below. Once a user has picked a tab, this function is
 * never consulted again for that link: the explicit choice always wins, even
 * across a period change or a reload.
 */
export function resolveWeightMode(explicit: WeightMode | null, period: { days: number }): WeightMode {
  if (explicit) return explicit;
  return period.days <= 1 ? 'dist' : 'time';
}

export function parseRoute(): Route {
  if (typeof window === 'undefined') {
    return { view: 'line', period: { key: 'shift' }, sheet: null, at: null, readingsFilter: null, ...DEFAULT_ROUTE };
  }
  const p = new URLSearchParams(window.location.search);
  const raw = p.get('s');
  const sheetRaw = p.get('sheet');
  // Legacy bookmark: the old product sheet component is deleted (UX Phase 6 Brief 1) and
  // `sheet=product:*` was its only id shape (always 'current'). Redirect to
  // the Product screen itself rather than parsing a sheet kind that no
  // longer exists, so an old link still lands somewhere useful instead of a
  // sheet the app can no longer open.
  const isLegacyProductBookmark = sheetRaw?.startsWith('product:') ?? false;
  const view: View = isLegacyProductBookmark
    ? 'product'
    : (VIEWS as readonly string[]).includes(raw ?? '') ? (raw as View) : 'line';
  const m = isLegacyProductBookmark ? null : sheetRaw?.match(/^(station|cone|sack|reject|reason|stock):(.+)$/);
  const rf = p.get('rf');
  const readingsFilter: ReadingsFilter = rf === 'outsideLimits' || rf === 'inspectionRejects' ? rf : null;

  const rtRaw = p.get('rt');
  const reportType: ReportType = (REPORT_TYPES as readonly string[]).includes(rtRaw ?? '') ? (rtRaw as ReportType) : DEFAULT_ROUTE.reportType;
  const rshRaw = p.get('rsh');
  const reportShift: ShiftCode | null = rshRaw === 'morning' || rshRaw === 'evening' || rshRaw === 'night' ? rshRaw : null;

  // SHARED across Report, Weight, Readings and Rejects — see the Route note.
  const station = parseId(p.get('st'));
  const product = parseId(p.get('pr'));

  const rlRaw = p.get('rl');
  const readingsListing: Listing = (LISTINGS as readonly string[]).includes(rlRaw ?? '') ? (rlRaw as Listing) : defaultListing(readingsFilter);
  const rcsRaw = p.get('rcs');
  const readingsStates: ConeState[] = rcsRaw
    ? rcsRaw.split(',').filter((x): x is ConeState => (CONE_STATES as readonly string[]).includes(x))
    : [];
  const readingsPage = Math.max(1, parseId(p.get('rp')) ?? 1);

  // UX Phase 10 (22 Sep 2026): `null` means no explicit choice was ever made
  // — the URL carries no `wm` at all (or an unrecognised value, treated the
  // same way). The absence resolves to a PERIOD-CONDITIONAL default in
  // App.tsx's render (Distribution for a single shift/day, Over time for a
  // longer span), which needs the plant-clock-resolved Period this parser
  // does not have. Once a user picks a tab, `wm` is written explicitly
  // (routeSearch below) and from then on this line reads it back verbatim —
  // the URL always wins over the conditional default.
  const weightModeRaw = p.get('wm');
  const weightMode: WeightMode | null =
    weightModeRaw === 'dist' ? 'dist' : weightModeRaw === 'time' ? 'time' : null;
  const weightChartType: SpcType = p.get('wt') === 'sack' ? 'sack' : 'cone';

  const sacksUnit: SackUnit = p.get('su') === 'kg' ? 'kg' : 'sacks';
  const sacksPage = Math.max(1, parseId(p.get('sp')) ?? 1);

  const rejectsCode = p.get('jc');

  const ptRaw = p.get('pt');
  const productTab: ProductTab = (PRODUCT_TABS as readonly string[]).includes(ptRaw ?? '') ? (ptRaw as ProductTab) : 'running';

  return {
    view,
    period: parsePeriodParams(p),
    sheet: m ? { kind: m[1] as Sheet['kind'], id: m[2]! } : null,
    at: readAsOf(),
    readingsFilter,
    reportType,
    reportShift,
    station,
    product,
    readingsListing,
    readingsStates,
    readingsPage,
    weightMode,
    weightChartType,
    sacksUnit,
    sacksPage,
    rejectsCode,
    productTab,
  };
}

export function routeSearch(r: Route): string {
  const p = new URLSearchParams();
  p.set('s', r.view);
  writePeriodParams(p, r.period);
  if (r.sheet) p.set('sheet', `${r.sheet.kind}:${r.sheet.id}`);
  if (r.at) p.set('at', r.at);
  if (r.readingsFilter) p.set('rf', r.readingsFilter);

  if (r.reportType !== DEFAULT_ROUTE.reportType) p.set('rt', r.reportType);
  if (r.reportShift) p.set('rsh', r.reportShift);
  if (r.station != null) p.set('st', String(r.station));
  if (r.product != null) p.set('pr', String(r.product));

  if (r.readingsListing !== defaultListing(r.readingsFilter)) p.set('rl', r.readingsListing);
  if (r.readingsStates.length > 0) p.set('rcs', r.readingsStates.join(','));
  if (r.readingsPage > 1) p.set('rp', String(r.readingsPage));

  if (r.weightMode) p.set('wm', r.weightMode);
  if (r.weightChartType !== DEFAULT_ROUTE.weightChartType) p.set('wt', r.weightChartType);

  if (r.sacksUnit !== DEFAULT_ROUTE.sacksUnit) p.set('su', r.sacksUnit);
  if (r.sacksPage > 1) p.set('sp', String(r.sacksPage));

  if (r.rejectsCode) p.set('jc', r.rejectsCode);

  if (r.productTab !== DEFAULT_ROUTE.productTab) p.set('pt', r.productTab);

  return `?${p.toString()}`;
}

/* -------------------------------------------------------------------- app */

export function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    // An expired session on any call bounces back to sign-in rather than
    // surfacing as a data error on whatever screen happened to be open.
    setUnauthorizedHandler(() => setUser(null));
    getMe()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  if (user === undefined) return <div className="app" />;
  if (user === null) return <LoginScreen onLogin={setUser} />;
  return <Session user={user} onSignOut={() => setUser(null)} />;
}

function Session({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  // Tracks history.state.zoomFrom — see readZoomFrom's own header. Kept as
  // its own bit of state (not re-derived inside `go`'s body) so a plain
  // Back/Forward through browser chrome, which never calls `go` at all,
  // still updates the bar's control via the popstate listener below.
  const [zoomFrom, setZoomFrom] = useState<PeriodParams | null>(() => readZoomFrom());

  useEffect(() => {
    const onPop = () => {
      setRoute(parseRoute());
      setZoomFrom(readZoomFrom());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // PUSH vs REPLACE: a change from a fixed set of choices — a screen, a
  // report type, a toggle, a chip — is a navigation a reader may want to
  // undo with Back, so it pushes. A value advanced by STEPPING — a page
  // number, here — is not: paging through the register ten times must not
  // fill the back button with nine stops nobody wants to revisit, so it
  // replaces. Everything below defaults to push; only the two pagers pass
  // `{ replace: true }`.
  //
  // Chart overhaul, Task T8a (29 Sep 2026): `opts.state` carries
  // `history.state` for the entry `go` writes. A PUSH with no explicit
  // `state` gets `null` (a plain navigation, e.g. switching screens, starts
  // clean — it must not inherit a zoom it has nothing to do with). A REPLACE
  // with no explicit `state` keeps whatever `history.state` already held —
  // panning inside a zoomed-in range must not silently drop the `zoomFrom`
  // that got it there. `zoomTo` below is the one caller that ever passes
  // `state` explicitly.
  const go = useCallback((next: Partial<Route>, opts?: { replace?: boolean; state?: NavState | null }) => {
    setRoute((prev) => {
      const merged = { ...prev, ...next };
      const url = routeSearch(merged);
      if (opts?.replace) {
        const state = opts.state !== undefined ? opts.state : (window.history.state as NavState | null);
        window.history.replaceState(state, '', url);
        setZoomFrom(state?.zoomFrom ?? null);
      } else {
        const state = opts?.state ?? null;
        window.history.pushState(state, '', url);
        setZoomFrom(state?.zoomFrom ?? null);
      }
      return merged;
    });
  }, []);

  // owner 29 Sep 2026: clicking the period already shown (e.g. re-clicking
  // the same chart bar) must not push a fresh history entry — samePeriodParams
  // makes that a no-op instead of a dead Back stop. zoomIsNoop is the pure
  // decision, pulled out and exported so it can be tested without rendering
  // <App/>, the same way parseRoute/routeSearch are tested above.
  const zoomTo = useCallback((p: PeriodParams) => {
    if (zoomIsNoop(p, route.period)) return;
    go({ period: p }, { state: { zoomFrom: route.period } });
  }, [go, route.period]);

  const back = useCallback(() => {
    window.history.back();
  }, []);

  const signOut = useCallback(() => {
    void apiLogout().finally(onSignOut);
  }, [onSignOut]);

  const zoomApi: ZoomApi = { zoomTo, back, canGoBack: zoomFrom != null };

  return (
    <LiveProvider asOf={route.at}>
      <ZoomContext.Provider value={zoomApi}>
        <Chrome user={user} route={route} go={go} onSignOut={signOut} />
      </ZoomContext.Provider>
    </LiveProvider>
  );
}

/* ----------------------------------------------------------------- chrome */

function Chrome({
  user,
  route,
  go,
  onSignOut,
}: {
  user: AuthUser;
  route: Route;
  go: (next: Partial<Route>, opts?: { replace?: boolean; state?: NavState | null }) => void;
  onSignOut: () => void;
}) {
  const { line, loading, error } = useLive();
  // Ticks every second off the instant /api/live reported, so the strip's
  // clock is the plant's and keeps time between polls.
  const plantNow = usePlantNow();
  const rank = ROLE_RANK[user.role] ?? 1;
  const health = assessHealth(line);
  // Chart overhaul, Task T8a (29 Sep 2026): read from context rather than a
  // prop — see the ZoomApi note above.
  const { zoomTo, back: zoomBack, canGoBack } = useZoom();

  // Wall is the Line screen without the chrome, so it returns before the bar.
  // It gets its own boundary, with the 'wall' variant, rather than relying on
  // the screen-area one below: Wall runs unattended with no navigation of its
  // own, which is exactly why a render throw there needs the one automatic
  // remount the 'wall' variant attempts before it settles on the fallback —
  // see ui/ErrorBoundary.tsx.
  if (route.view === 'wall') {
    return (
      <ErrorBoundary variant="wall" label={W.wall}>
        <WallScreen onExit={() => go({ view: 'line' })} />
      </ErrorBoundary>
    );
  }

  if (!line) {
    return (
      <div className="app">
        <main className="page">
          {loading ? <Loading /> : <p className="state err">{error ?? W.lag.noData}</p>}
        </main>
      </div>
    );
  }

  // Every period is resolved against the PLANT's clock, reported by the API —
  // never the browser's, which on a laptop in another timezone would land on
  // the wrong production day.
  const period = resolvePeriod(route.period.key, {
    shiftDate: line.shift.shiftDate,
    shiftCode: line.shift.code,
    shiftStartUtc: line.shift.startUtc,
    plantNowUtc: line.plantNowUtc,
    dataAsOfUtc: line.dataAsOfUtc,
  }, route.period.picked, route.period.range);

  // Remounts the screen-area boundary whenever the SCREEN changes, so
  // navigating away from a crash (via the Bar, still rendered OUTSIDE this
  // boundary below) clears the failure rather than leaving the fallback stuck
  // on screen until a hard reload.
  //
  // The open sheet used to be part of this key as well (23 Sep 2026: it is
  // not any more). It was there for a real reason — a sheet renders inside
  // this same boundary, so a throw while drawing ONE caught here, and closing
  // that sheet had to clear the fallback or the reader was stranded in it.
  // But React remounts everything under a changed key, so every drilldown
  // click also tore down and rebuilt the screen BEHIND the overlay: every
  // `usePolling` on it lost its data and refetched from null, and for one to
  // two seconds the screen asserted numbers it did not have. On Readings ›
  // This month that printed `0 weighed, 0 rejected by the scale (0%)`, and —
  // when the lighter of the two counts landed first — `0 weighed, 402
  // rejected by the scale (0%)`, which is not a state that can exist.
  //
  // A sheet is an overlay. The screen underneath it did not change, so it is
  // not rebuilt. What the sheet half of the key was protecting is preserved,
  // and improved on, by `sheetKey` below: the sheets now sit in their OWN
  // boundary, keyed on the open sheet. A sheet that throws is caught there
  // first, so it no longer takes the screen down with it, and closing or
  // changing the sheet still clears that fallback by unmounting it. If a
  // sheet throws before it can draw its own close control, the Bar — outside
  // both boundaries — clears it, because every `onNavigate` sets `sheet: null`.
  const screenKey = route.view;
  const sheetKey = route.sheet ? `${route.sheet.kind}:${route.sheet.id}` : 'none';

  return (
    <div className="app">
      <a className="skip-link" href="#main">{W.skipToContent}</a>

      <Bar
        screen={route.view === 'setup' ? 'setup' : (route.view as Screen)}
        lineName={line.lineName}
        plantNowUtc={plantNow}
        health={health}
        period={route.period}
        user={user}
        isAdmin={rank >= 4}
        onNavigate={(s) => go({ view: s, sheet: null, readingsFilter: null })}
        onPeriod={(p) => go({ period: p })}
        onWall={() => go({ view: 'wall' })}
        onSetup={() => go({ view: 'setup', sheet: null })}
        onOpenSync={() => go({ view: 'health', sheet: null })}
        onSignOut={onSignOut}
        canGoBack={canGoBack}
        onBack={zoomBack}
      />

      {/* The screen area, boundaried on its own (keyed so a navigation away
          from a crash — via the Bar above, which stays outside this box —
          remounts it clean): a render throw while drawing one screen must
          not blank the top bar and navigation along with it. Plain 'default'
          variant here, not 'wall' — Wall never reaches this region, since it
          returns before the Bar further up this function, and every screen
          here already sits one click away from Line via the Bar that stays
          standing beside it. */}
      <ErrorBoundary key={screenKey} variant="default" label={route.view}>
        {/* Task D (28 Sep 2026): the global "simulated data" notice. One
            instance, beside the replay banner below, so every screen's
            simulator/real disclosure is decided in one place. Renders
            nothing on Setup, Wall (its own short form lives in Wall.tsx's
            footer) or Product's non-Running tabs, and nothing at all at
            IFL — see SimulatorBanner.tsx's own file header. */}
        <SimulatorBanner view={route.view} productTab={route.productTab} from={period.from} to={period.to} />
        {line.replay && (
          <div className="replay no-print">
            <span>
              {W.replay} {new Date(line.plantNowUtc).toISOString().replace('T', ' ').slice(0, 19)}. {W.replayNote}
            </span>
            <a href={routeSearch({ ...route, at: null })}>Leave replay</a>
          </div>
        )}

        {/* Not .page any more: every band carries its own 1100px page inside a
            full-bleed rule, and each screen wraps its head area in one. */}
        <main id="main" tabIndex={-1}>
          {route.view === 'line' && (
            <LineScreen
              period={period}
              onNavigate={(s, filter) => go({ view: s, readingsFilter: filter ?? null })}
              onOpenStation={(n) => go({ sheet: { kind: 'station', id: String(n) } })}
              onOpenReading={(kind, id) => go({ sheet: { kind, id: String(id) } })}
              // UX Phase 6 Brief 1 (16 Sep 2026): the old product sheet component is gone —
              // both "History" and "Change" on the product block now open
              // the Product nav screen (Running tab, its default) rather
              // than a sheet.
              onOpenProduct={() => go({ view: 'product', sheet: null })}
              canWrite={rank >= ENGINEER_RANK}
              onSelectPeriod={zoomTo}
            />
          )}

          {route.view === 'readings' && (
            <ReadingsScreen
              period={period}
              listing={route.readingsListing}
              onListingChange={(l) => go({
                readingsListing: l,
                readingsPage: 1,
                // Manually switching what to list is a distinct choice from
                // clearing the deep-linked outside-limits filter via its own
                // chip below — see ReadingsScreen's note on `outsideOnly`.
                // inspectionRejects carries no such clash: it only ever
                // seeded this screen's default listing.
                readingsFilter: route.readingsFilter === 'outsideLimits' ? null : route.readingsFilter,
              })}
              station={route.station}
              onStationChange={(v) => go({ station: v, readingsPage: 1 })}
              states={route.readingsStates}
              onStatesChange={(v) => go({ readingsStates: v, readingsPage: 1 })}
              page={route.readingsPage}
              onPageChange={(pg) => go({ readingsPage: pg }, { replace: true })}
              initialFilter={route.readingsFilter}
              onFilterChange={(f) => go({ readingsFilter: f, readingsPage: 1 })}
              onOpenReading={(kind, id) => go({ sheet: { kind, id: String(id) } })}
              canExport={rank >= EXPORT_RANK}
            />
          )}

          {route.view === 'report' && (
            <ReportScreen
              period={period}
              user={user}
              type={route.reportType}
              onTypeChange={(t) => go({ reportType: t })}
              filters={{ shift: route.reportShift ?? undefined, station: route.station ?? undefined, product: route.product ?? undefined }}
              onShiftChange={(sh) => go({ reportShift: sh })}
              onStationChange={(v) => go({ station: v })}
              onProductChange={(v) => go({ product: v })}
              onOpenStation={(n) => go({ sheet: { kind: 'station', id: String(n) } })}
              onOpenCode={(c) => go({ view: 'rejects', rejectsCode: c })}
              onSelectPeriod={zoomTo}
            />
          )}

          {route.view === 'weight' && (
            <WeightScreen
              period={period}
              // UX Phase 10 (22 Sep 2026): see resolveWeightMode above — the
              // default is period-conditional, resolved here (not in
              // parseRoute) because it needs the plant-clock-resolved
              // `period.days`, not just the raw URL. An explicit `wm` in the
              // URL always wins.
              mode={resolveWeightMode(route.weightMode, period)}
              onModeChange={(m) => go({ weightMode: m })}
              chartType={route.weightChartType}
              onChartTypeChange={(t) => go({ weightChartType: t })}
              chartStation={route.station}
              onChartStationChange={(v) => go({ station: v })}
              onOpenStation={(n) => go({ sheet: { kind: 'station', id: String(n) } })}
              onSeeOutside={() => go({
                view: 'readings', readingsFilter: 'outsideLimits',
                readingsListing: 'cones', readingsStates: [], readingsPage: 1,
              })}
              onSelectPeriod={zoomTo}
            />
          )}

          {route.view === 'rejects' && (
            <RejectsScreen
              period={period}
              station={route.station}
              onStationChange={(v) => go({ station: v })}
              product={route.product}
              onProductChange={(v) => go({ product: v })}
              code={route.rejectsCode}
              onCodeChange={(c, opts) => go({ rejectsCode: c }, opts)}
              onSeeCones={() => go({
                view: 'readings', readingsFilter: 'inspectionRejects',
                readingsListing: 'inspectionRejects', readingsStates: [], readingsPage: 1,
              })}
              onSeeStations={() => go({ view: 'weight' })}
              onOpenReason={(r) => go({ sheet: { kind: 'reason', id: reasonIdOf({ ...r, rejectType: r.rejectType as 'quality' | 'weight' }) } })}
              canName={rank >= ENGINEER_RANK}
              onSelectPeriod={zoomTo}
            />
          )}

          {/* Roadmap Phase 7 (15 Sep 2026): open to every account; recording a
              movement is rank 2 server-side (IFL's Q43 answer, 15 Sep 2026),
              so the form is offered at ENGINEER_RANK. */}
          {route.view === 'sacks' && (
            <SacksScreen
              period={period}
              unit={route.sacksUnit}
              onUnitChange={(u) => go({ sacksUnit: u })}
              page={route.sacksPage}
              onPageChange={(pg) => go({ sacksPage: pg }, { replace: true })}
              canRecord={rank >= ENGINEER_RANK}
              onOpenReading={(kind, id) => go({ sheet: { kind, id: String(id) } })}
              onOpenDay={(day) => go({ sheet: { kind: 'stock', id: day } })}
              onSelectPeriod={zoomTo}
            />
          )}

          {/* UX Phase 6 Brief 1 (16 Sep 2026): open to every signed-in
              account (ONE AUDIENCE, CLAUDE.md) — only the write actions
              inside it (setting the running product, PDAS writes) are
              rank-gated, server-side. `pr` is the SHARED product id, same
              key Report and Rejects use, here deep-linking Catalogue. */}
          {route.view === 'product' && (
            <ProductScreen
              period={period}
              tab={route.productTab}
              onTabChange={(t) => go({ productTab: t })}
              productId={route.product}
              onProductIdChange={(v) => go({ product: v })}
              canWrite={rank >= ENGINEER_RANK}
              onOpenStation={(n) => go({ sheet: { kind: 'station', id: String(n) } })}
              onSeeStationReadings={(n) => go({ view: 'readings', station: n, readingsPage: 1 })}
            />
          )}

          {/* Hiding the gear is decluttering, not access control: a typed URL
              would otherwise render a page of panels that each fail with 403.
              The API enforces the same rank server-side. */}
          {route.view === 'setup' &&
            (rank >= 4 ? (
              <SetupScreen currentUsername={user.username} />
            ) : (
              <div className="page">
                <p className="q">{W.question.setup}</p>
                <h1 className="wide">{W.notAllowed}</h1>
              </div>
            ))}

          {/* Open to every signed-in account (roadmap Phase 11): the sync's
              state was admin-only while IFL's accounts are created at manager. */}
          {route.view === 'health' && (
            <HealthScreen isAdmin={rank >= 4} onOpenReading={(kind, id) => go({ sheet: { kind, id: String(id) } })} />
          )}
        </main>

        {/* Drill-downs open over the screen and close with Escape, so the reader
            never loses their filters, their page or their place in the list.

            Their own boundary, keyed on the open sheet (see the screenKey note
            above): a throw while drawing a sheet is caught HERE rather than by
            the screen boundary, so the screen behind the overlay stays
            standing, and closing or changing the sheet clears the fallback by
            unmounting it. Nothing inside `<main>` above is remounted when a
            sheet opens. */}
        <ErrorBoundary key={sheetKey} variant="default" label={route.sheet ? route.sheet.kind : undefined}>
        {route.sheet?.kind === 'station' && (
          <StationSheet
            station={Number(route.sheet.id)}
            canAdjust={rank >= ENGINEER_RANK}
            periodTo={period.to}
            onClose={() => go({ sheet: null })}
            // Roadmap Phase 2b guided-navigation pass (16 Sep 2026,
            // IA-PROPOSAL.md §6.6): each carries THIS station — the sheet's
            // own, not whatever `route.station` happened to hold — via the
            // shared `st` key, and closes the sheet. Readings' page resets
            // (a fresh filter, not a stale page number); the reject report
            // and calibration report both accept a station filter
            // (report/model.ts FILTERS_BY_TYPE).
            onSeeReadings={() => go({ view: 'readings', station: Number(route.sheet!.id), sheet: null, readingsPage: 1 })}
            onSeeRejects={() => go({ view: 'rejects', station: Number(route.sheet!.id), sheet: null })}
            onSeeCalibrationReport={() => go({ view: 'report', reportType: 'calibration', station: Number(route.sheet!.id), sheet: null })}
            onSeeShiftReport={() => go({ view: 'report', reportType: 'machine-product', station: Number(route.sheet!.id), sheet: null })}
            // Task T8a (29 Sep 2026): the daily-means chart's drag-select
            // hands its shift-snapped whole-page period straight to the
            // global zoom — see the ZoomApi note above. This is the
            // "Task T8's, not this one's" wiring StationSheet's own header
            // comment (screens/StationSheet.tsx) already anticipated.
            onSelectPeriod={zoomTo}
          />
        )}
        {route.sheet?.kind === 'reason' && (
          <ReasonSheet
            id={route.sheet.id}
            canName={rank >= ENGINEER_RANK}
            onClose={() => go({ sheet: null })}
            // Readings has no reason filter (Phase 5): the link narrows to the
            // day and the inspection-reject listing, and says so on the sheet.
            onOpenRegister={(day) => go({
              view: 'readings', readingsFilter: 'inspectionRejects',
              readingsListing: 'inspectionRejects', readingsStates: [], readingsPage: 1,
              period: { key: 'pick', picked: { from: day, to: day } }, sheet: null,
            })}
            onOpenReading={(kind, id) => go({ sheet: { kind, id: String(id) } })}
            // Same day-narrowing as onOpenRegister above: the reject report
            // has no per-code filter, so the day is what carries.
            onOpenReport={(day) => go({
              view: 'report', reportType: 'reject',
              period: { key: 'pick', picked: { from: day, to: day } }, sheet: null,
            })}
          />
        )}
        {route.sheet?.kind === 'stock' && <StockSheet day={route.sheet.id} onClose={() => go({ sheet: null })} />}
        {route.sheet && route.sheet.kind !== 'station' && route.sheet.kind !== 'reason' && route.sheet.kind !== 'stock' && (
          <ReadingSheet
            type={route.sheet.kind}
            id={route.sheet.id}
            onClose={() => go({ sheet: null })}
            // The product in force at THIS reading, narrowed to its own
            // production day — mirrors ReasonSheet's day-narrowing above.
            onOpenProductReport={(productId, day) => go({
              view: 'report', reportType: 'product', product: productId,
              period: { key: 'pick', picked: { from: day, to: day } }, sheet: null,
            })}
            // UX Phase 6 Brief 1 (16 Sep 2026): the second of the two
            // Phase-4 drilldown hops that had no real destination until the
            // Product screen's Catalogue tab existed (IA-PROPOSAL.md §6.4).
            onOpenProductCatalogue={(productId) => go({
              view: 'product', productTab: 'catalogue', product: productId, sheet: null,
            })}
          />
        )}
        </ErrorBoundary>
      </ErrorBoundary>
    </div>
  );
}

