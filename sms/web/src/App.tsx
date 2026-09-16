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
import { useCallback, useEffect, useState } from 'react';
import {
  getMe, logout as apiLogout, setUnauthorizedHandler, ROLE_RANK, REPORT_TYPES, CONE_STATES,
  type AuthUser, type ReportType, type ConeState,
} from './api';
import { LiveProvider, readAsOf, useLive, usePlantNow } from './lib/live';
import { assessHealth } from './lib/health';
import { parsePeriodParams, resolvePeriod, writePeriodParams, type PeriodParams, type ShiftCode } from './lib/period';
import { W } from './lib/words';
import { Bar, SCREENS, type Screen, type ReadingsFilter } from './ui/Bar';
import { Loading } from './ui/bits';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { LineScreen } from './screens/Line';
import { ReadingsScreen, LISTINGS, type Listing } from './screens/Readings';
import { ReadingSheet } from './screens/ReadingSheet';
import { StationSheet } from './screens/StationSheet';
import { ProductSheet } from './screens/ProductSheet';
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

/* ------------------------------------------------------------------ route */

type View = Screen | 'setup' | 'wall' | 'health';

export interface Sheet {
  /** 'reason' (roadmap Phase 5): one day's rejects of one code, id `<day>|<type>|<tube>|<material>`.
   *  'stock' (roadmap Phase 7): one production day's stock movements, id `<day>`. */
  kind: 'station' | 'cone' | 'sack' | 'reject' | 'product' | 'reason' | 'stock';
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

  /** Weight: which chart. Chart station is the shared field above. */
  weightMode: WeightMode;

  /** Sacks: the ledger's unit, and the history register's page. */
  sacksUnit: SackUnit;
  sacksPage: number;

  /** Rejects: the chosen Pareto reason. Station/product are the shared
   *  fields above — see RejectsScreen's file header for why they moved. */
  rejectsCode: string | null;
}

const VIEWS: readonly View[] = [...SCREENS, 'setup', 'wall', 'health'] as const;

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
  weightMode: 'time',
  sacksUnit: 'sacks',
  sacksPage: 1,
  rejectsCode: null,
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

export function parseRoute(): Route {
  if (typeof window === 'undefined') {
    return { view: 'line', period: { key: 'shift' }, sheet: null, at: null, readingsFilter: null, ...DEFAULT_ROUTE };
  }
  const p = new URLSearchParams(window.location.search);
  const raw = p.get('s');
  const view: View = (VIEWS as readonly string[]).includes(raw ?? '') ? (raw as View) : 'line';
  const sheetRaw = p.get('sheet');
  const m = sheetRaw?.match(/^(station|cone|sack|reject|product|reason|stock):(.+)$/);
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

  const weightMode: WeightMode = p.get('wm') === 'dist' ? 'dist' : 'time';

  const sacksUnit: SackUnit = p.get('su') === 'kg' ? 'kg' : 'sacks';
  const sacksPage = Math.max(1, parseId(p.get('sp')) ?? 1);

  const rejectsCode = p.get('jc');

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
    sacksUnit,
    sacksPage,
    rejectsCode,
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

  if (r.weightMode !== DEFAULT_ROUTE.weightMode) p.set('wm', r.weightMode);

  if (r.sacksUnit !== DEFAULT_ROUTE.sacksUnit) p.set('su', r.sacksUnit);
  if (r.sacksPage > 1) p.set('sp', String(r.sacksPage));

  if (r.rejectsCode) p.set('jc', r.rejectsCode);

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

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
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
  const go = useCallback((next: Partial<Route>, opts?: { replace?: boolean }) => {
    setRoute((prev) => {
      const merged = { ...prev, ...next };
      const url = routeSearch(merged);
      if (opts?.replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
      return merged;
    });
  }, []);

  const signOut = useCallback(() => {
    void apiLogout().finally(onSignOut);
  }, [onSignOut]);

  return (
    <LiveProvider asOf={route.at}>
      <Chrome user={user} route={route} go={go} onSignOut={signOut} />
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
  go: (next: Partial<Route>, opts?: { replace?: boolean }) => void;
  onSignOut: () => void;
}) {
  const { line, loading, error } = useLive();
  // Ticks every second off the instant /api/live reported, so the strip's
  // clock is the plant's and keeps time between polls.
  const plantNow = usePlantNow();
  const rank = ROLE_RANK[user.role] ?? 1;
  const health = assessHealth(line);

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
  }, route.period.picked);

  // Remounts the screen-area boundary whenever the screen or the open sheet
  // changes, so navigating away from a crash (via the Bar, still rendered
  // OUTSIDE this boundary below) clears the failure rather than leaving the
  // fallback stuck on screen until a hard reload.
  const screenKey = `${route.view}:${route.sheet ? `${route.sheet.kind}:${route.sheet.id}` : 'none'}`;

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
              onChangeProduct={() => go({ sheet: { kind: 'product', id: 'current' } })}
              canWrite={rank >= 2}
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
            />
          )}

          {route.view === 'weight' && (
            <WeightScreen
              period={period}
              mode={route.weightMode}
              onModeChange={(m) => go({ weightMode: m })}
              chartStation={route.station}
              onChartStationChange={(v) => go({ station: v })}
              onOpenStation={(n) => go({ sheet: { kind: 'station', id: String(n) } })}
              onSeeOutside={() => go({
                view: 'readings', readingsFilter: 'outsideLimits',
                readingsListing: 'cones', readingsStates: [], readingsPage: 1,
              })}
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
          {route.view === 'health' && <HealthScreen isAdmin={rank >= 4} />}
        </main>

        {/* Drill-downs open over the screen and close with Escape, so the reader
            never loses their filters, their page or their place in the list. */}
        {route.sheet?.kind === 'station' && (
          <StationSheet
            station={Number(route.sheet.id)}
            canAdjust={rank >= 2}
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
          />
        )}
        {route.sheet?.kind === 'product' && (
          <ProductSheet
            canWrite={rank >= 2}
            onClose={() => go({ sheet: null })}
            onSeeReport={(productId) => go({ view: 'report', reportType: 'product', product: productId, sheet: null })}
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
        {route.sheet && route.sheet.kind !== 'station' && route.sheet.kind !== 'product' && route.sheet.kind !== 'reason' && route.sheet.kind !== 'stock' && (
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
          />
        )}
      </ErrorBoundary>
    </div>
  );
}

