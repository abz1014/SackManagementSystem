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
import { LiveProvider, readAsOf, useLive } from './floor/live';
import { assessHealth } from './lib/health';
import { parsePeriodParams, resolvePeriod, writePeriodParams, type PeriodParams } from './lib/period';
import { W } from './lib/words';
import { Bar, SCREENS, type Screen } from './ui/Bar';
import { Loading } from './ui/bits';
import { LineScreen } from './screens/Line';
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
  const rank = ROLE_RANK[user.role] ?? 1;
  const health = assessHealth(line);

  // Wall is the Line screen without the chrome, so it returns before the bar.
  if (route.view === 'wall') {
    return <WallHost onExit={() => go({ view: 'line' })} />;
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

      <main id="main" className="page" tabIndex={-1}>
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

        {route.view !== 'line' && <NotYetBuilt view={route.view} />}
      </main>
    </div>
  );
}

/**
 * The honest placeholder for a screen whose redesign has not landed yet.
 *
 * It says which screen and what it will answer, in the new design's own voice,
 * rather than leaving a blank region or silently routing to the old layout —
 * mixing two visual languages in one app is exactly the incoherence this
 * redesign exists to remove.
 */
function NotYetBuilt({ view }: { view: View }) {
  const q = (W.question as Record<string, string>)[view];
  return (
    <>
      <p className="q">{q ?? ''}</p>
      <h1 className="wide">This screen is being rebuilt.</h1>
      <p className="fig-note" style={{ marginTop: 16 }}>
        The Line screen is finished and live. This one follows in the same design.
      </p>
    </>
  );
}

/** Placeholder host until the redesigned wall screen lands. */
function WallHost({ onExit }: { onExit: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onExit();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onExit]);
  return (
    <div className="app">
      <main className="page">
        <h1>Wall display is being rebuilt.</h1>
        <p className="fig-note" style={{ marginTop: 16 }}>
          Press Escape to go back.
        </p>
      </main>
    </div>
  );
}
