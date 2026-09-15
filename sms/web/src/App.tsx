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
  getMe, logout as apiLogout, setUnauthorizedHandler, ROLE_RANK, type AuthUser,
} from './api';
import { LiveProvider, readAsOf, useLive, usePlantNow } from './lib/live';
import { assessHealth } from './lib/health';
import { parsePeriodParams, resolvePeriod, writePeriodParams, type PeriodParams } from './lib/period';
import { W } from './lib/words';
import { Bar, SCREENS, type Screen, type ReadingsFilter } from './ui/Bar';
import { Loading } from './ui/bits';
import { LineScreen } from './screens/Line';
import { ReadingsScreen } from './screens/Readings';
import { ReadingSheet } from './screens/ReadingSheet';
import { StationSheet } from './screens/StationSheet';
import { ProductSheet } from './screens/ProductSheet';
import { ReportScreen } from './screens/Report';
import { WeightScreen } from './screens/Weight';
import { RejectsScreen } from './screens/Rejects';
import { ReasonSheet, reasonIdOf } from './screens/ReasonSheet';
import { WallScreen } from './screens/Wall';
import { SetupScreen } from './screens/Setup';
import { HealthScreen } from './screens/Health';
import { SacksScreen } from './screens/Sacks';
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

interface Route {
  view: View;
  period: PeriodParams;
  sheet: Sheet | null;
  /** Replay instant for the live screens; only honoured when the API allows it. */
  at: string | null;
  readingsFilter: ReadingsFilter;
}

const VIEWS: readonly View[] = [...SCREENS, 'setup', 'wall', 'health'] as const;

/**
 * The register export is requireRole(3) on the server. Offering it at rank 2
 * put a button in front of a supervisor that could only ever answer 403 — and
 * a 403 is a bug, not a state. A control a role cannot use is absent.
 */
const EXPORT_RANK = 3;

function parseRoute(): Route {
  if (typeof window === 'undefined') {
    return { view: 'line', period: { key: 'shift' }, sheet: null, at: null, readingsFilter: null };
  }
  const p = new URLSearchParams(window.location.search);
  const raw = p.get('s');
  const view: View = (VIEWS as readonly string[]).includes(raw ?? '') ? (raw as View) : 'line';
  const sheetRaw = p.get('sheet');
  const m = sheetRaw?.match(/^(station|cone|sack|reject|product|reason|stock):(.+)$/);
  const rf = p.get('rf');
  return {
    view,
    period: parsePeriodParams(p),
    sheet: m ? { kind: m[1] as Sheet['kind'], id: m[2]! } : null,
    at: readAsOf(),
    readingsFilter: rf === 'outsideLimits' || rf === 'inspectionRejects' ? rf : null,
  };
}

function routeSearch(r: Route): string {
  const p = new URLSearchParams();
  p.set('s', r.view);
  writePeriodParams(p, r.period);
  if (r.sheet) p.set('sheet', `${r.sheet.kind}:${r.sheet.id}`);
  if (r.at) p.set('at', r.at);
  if (r.readingsFilter) p.set('rf', r.readingsFilter);
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

  const go = useCallback((next: Partial<Route>) => {
    setRoute((prev) => {
      const merged = { ...prev, ...next };
      window.history.pushState(null, '', routeSearch(merged));
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
  go: (next: Partial<Route>) => void;
  onSignOut: () => void;
}) {
  const { line, loading, error } = useLive();
  // Ticks every second off the instant /api/live reported, so the strip's
  // clock is the plant's and keeps time between polls.
  const plantNow = usePlantNow();
  const rank = ROLE_RANK[user.role] ?? 1;
  const health = assessHealth(line);

  // Wall is the Line screen without the chrome, so it returns before the bar.
  if (route.view === 'wall') {
    return <WallScreen onExit={() => go({ view: 'line' })} />;
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
            initialFilter={route.readingsFilter}
            onFilterChange={(f) => go({ readingsFilter: f })}
            onOpenReading={(kind, id) => go({ sheet: { kind, id: String(id) } })}
            canExport={rank >= EXPORT_RANK}
          />
        )}

        {route.view === 'report' && <ReportScreen period={period} user={user} />}

        {route.view === 'weight' && (
          <WeightScreen
            period={period}
            onOpenStation={(n) => go({ sheet: { kind: 'station', id: String(n) } })}
            onSeeOutside={() => go({ view: 'readings', readingsFilter: 'outsideLimits' })}
          />
        )}

        {route.view === 'rejects' && (
          <RejectsScreen
            period={period}
            onSeeCones={() => go({ view: 'readings', readingsFilter: 'inspectionRejects' })}
            onSeeStations={() => go({ view: 'weight' })}
            onOpenReason={(r) => go({ sheet: { kind: 'reason', id: reasonIdOf({ ...r, rejectType: r.rejectType as 'quality' | 'weight' }) } })}
            canName={rank >= 3}
          />
        )}

        {/* Roadmap Phase 7 (15 Sep 2026): open to every account; recording a
            movement is rank 3 server-side, so the form is offered at 3. */}
        {route.view === 'sacks' && (
          <SacksScreen
            period={period}
            canRecord={rank >= 3}
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
          onClose={() => go({ sheet: null })}
        />
      )}
      {route.sheet?.kind === 'product' && (
        <ProductSheet canWrite={rank >= 2} onClose={() => go({ sheet: null })} />
      )}
      {route.sheet?.kind === 'reason' && (
        <ReasonSheet
          id={route.sheet.id}
          canName={rank >= 3}
          onClose={() => go({ sheet: null })}
          // Readings has no reason filter (Phase 5): the link narrows to the
          // day and the inspection-reject listing, and says so on the sheet.
          onOpenRegister={(day) => go({ view: 'readings', readingsFilter: 'inspectionRejects', period: { key: 'pick', picked: { from: day, to: day } }, sheet: null })}
          onOpenReading={(kind, id) => go({ sheet: { kind, id: String(id) } })}
        />
      )}
      {route.sheet?.kind === 'stock' && <StockSheet day={route.sheet.id} onClose={() => go({ sheet: null })} />}
      {route.sheet && route.sheet.kind !== 'station' && route.sheet.kind !== 'product' && route.sheet.kind !== 'reason' && route.sheet.kind !== 'stock' && (
        <ReadingSheet
          type={route.sheet.kind}
          id={route.sheet.id}
          onClose={() => go({ sheet: null })}
        />
      )}
    </div>
  );
}

