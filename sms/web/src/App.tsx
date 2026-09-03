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
import { Bar, SCREENS, type Screen } from './ui/Bar';
import { Loading } from './ui/bits';
import { LineScreen } from './screens/Line';
import { ReadingsScreen } from './screens/Readings';
import { ReadingSheet } from './screens/ReadingSheet';
import { StationSheet } from './screens/StationSheet';
import { ReportScreen } from './screens/Report';
import { WeightScreen } from './screens/Weight';
import { RejectsScreen } from './screens/Rejects';
import { WallScreen } from './screens/Wall';
import { SetupScreen } from './screens/Setup';
import { LoginScreen } from './screens/Login';
import './app.css';

/* ------------------------------------------------------------------ route */

type View = Screen | 'setup' | 'wall';

export interface Sheet {
  kind: 'station' | 'cone' | 'sack' | 'reject';
  id: string;
}

interface Route {
  view: View;
  period: PeriodParams;
  sheet: Sheet | null;
  /** Replay instant for the live screens; only honoured when the API allows it. */
  at: string | null;
}

const VIEWS: readonly View[] = [...SCREENS, 'setup', 'wall'] as const;

/**
 * The register export is requireRole(3) on the server. Offering it at rank 2
 * put a button in front of a supervisor that could only ever answer 403 — and
 * a 403 is a bug, not a state. A control a role cannot use is absent.
 */
const EXPORT_RANK = 3;

function parseRoute(): Route {
  if (typeof window === 'undefined') return { view: 'line', period: { key: 'shift' }, sheet: null, at: null };
  const p = new URLSearchParams(window.location.search);
  const raw = p.get('s');
  const view: View = (VIEWS as readonly string[]).includes(raw ?? '') ? (raw as View) : 'line';
  const sheetRaw = p.get('sheet');
  const m = sheetRaw?.match(/^(station|cone|sack|reject):(.+)$/);
  return {
    view,
    period: parsePeriodParams(p),
    sheet: m ? { kind: m[1] as Sheet['kind'], id: m[2]! } : null,
    at: readAsOf(),
  };
}

function routeSearch(r: Route): string {
  const p = new URLSearchParams();
  p.set('s', r.view);
  writePeriodParams(p, r.period);
  if (r.sheet) p.set('sheet', `${r.sheet.kind}:${r.sheet.id}`);
  if (r.at) p.set('at', r.at);
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
        onNavigate={(s) => go({ view: s, sheet: null })}
        onPeriod={(p) => go({ period: p })}
        onWall={() => go({ view: 'wall' })}
        onSetup={() => go({ view: 'setup', sheet: null })}
        onOpenSync={() => go({ view: 'setup', sheet: null })}
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
            onNavigate={(s) => go({ view: s })}
            onOpenStation={(n) => go({ sheet: { kind: 'station', id: String(n) } })}
            onOpenReading={(kind, id) => go({ sheet: { kind, id: String(id) } })}
            onChangeProduct={() => go({ view: 'setup' })}
            canWrite={rank >= 2}
          />
        )}

        {route.view === 'readings' && (
          <ReadingsScreen
            period={period}
            onOpenReading={(kind, id) => go({ sheet: { kind, id: String(id) } })}
            canExport={rank >= EXPORT_RANK}
          />
        )}

        {route.view === 'report' && <ReportScreen period={period} user={user} />}

        {route.view === 'weight' && (
          <WeightScreen
            period={period}
            onOpenStation={(n) => go({ sheet: { kind: 'station', id: String(n) } })}
            onSeeOutside={() => go({ view: 'readings' })}
          />
        )}

        {route.view === 'rejects' && (
          <RejectsScreen
            period={period}
            onSeeCones={() => go({ view: 'readings' })}
            onSeeStations={() => go({ view: 'weight' })}
            canName={rank >= 3}
          />
        )}

        {/* Hiding the gear is decluttering, not access control: a typed URL
            would otherwise render a page of panels that each fail with 403.
            The API enforces the same rank server-side. */}
        {route.view === 'setup' &&
          (rank >= 4 ? (
            <SetupScreen />
          ) : (
            <div className="page">
              <p className="q">{W.question.setup}</p>
              <h1 className="wide">{W.notAllowed}</h1>
            </div>
          ))}
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
      {route.sheet && route.sheet.kind !== 'station' && (
        <ReadingSheet
          type={route.sheet.kind}
          id={route.sheet.id}
          onClose={() => go({ sheet: null })}
        />
      )}
    </div>
  );
}

