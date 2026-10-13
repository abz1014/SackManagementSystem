/**
 * The app frame: sign-in, one route, one period, one sheet, one shell.
 *
 * The URL is the state (route.ts). Legacy links are rewritten on load, a tab the
 * viewer's rank does not allow falls back to Today, and every screen is drawn by
 * the registry (screens/registry.ts) inside a page boundary, so a screen that
 * throws never takes the shell with it.
 */
import { lazy, Suspense, useCallback, useEffect, useState, type ComponentProps } from 'react';
import { getMe, setUnauthorizedHandler, ROLE_RANK, type AuthUser } from './bridge/api';
import { ErrorBoundary, SimulatorBanner } from './bridge/components';
import { health as healthLib, live } from './bridge/lib';
import { W } from './bridge/words';
import { C } from './copy';
import { usePeriod } from './data/usePeriod';
import { navigate, replaceQuery, resolveLocation, todayRoute, useLocationSearch } from './appRoute';
import type { Route } from './route';
import { defaultTab } from './route';
import { LoginScreen } from './screens/Login';
import { resolveScreen, resolveSheet } from './screens/registry';
import { AppShell } from './ui/AppShell';
import { HealthDot } from './ui/HealthDot';
import { hrefFor, plainClick, routeFor } from './ui/nav';
import { PeriodChip } from './ui/PeriodChip';
import './app.css';
import { useLive, usePlantNow } from './data';

/* The component gallery exists only in the dev server: the whole branch (and its chunk) is removed from a production build. */
const Gallery = import.meta.env.DEV ? lazy(() => import('./Gallery').then((m) => ({ default: m.Gallery }))) : null;

export function App() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  useEffect(() => {
    // An expired session on any call returns to sign-in instead of surfacing as a data error on a screen.
    setUnauthorizedHandler(() => setUser(null));
    getMe()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, [setUser]);

  useEffect(() => {
    if (user === null) document.title = `${C.login.title} - ${C.shell.appName}`;
  }, [user]);

  if (user === undefined) {
    return (
      <div className="lg-checking" role="status">
        {C.app.checking}
      </div>
    );
  }
  if (user === null) return <LoginScreen onLogin={setUser} />;
  return <Session user={user} onSignedOut={() => setUser(null)} />;
}

function Session({ user, onSignedOut }: { user: AuthUser; onSignedOut: () => void }) {
  const rank = ROLE_RANK[user.role] ?? 1;
  const search = useLocationSearch();
  const { route, gallery, canonical } = resolveLocation(search, rank);

  useEffect(() => {
    if (canonical !== null) replaceQuery(canonical);
  }, [canonical]);

  const at = route.keys.at ?? null;

  if (gallery && Gallery) {
    return (
      <live.LiveProvider asOf={null}>
        <Suspense fallback={<p className="app-loading">{C.chart.loading}</p>}>
          <Gallery />
        </Suspense>
      </live.LiveProvider>
    );
  }
  return (
    <live.LiveProvider asOf={at}>
      <Frame user={user} rank={rank} route={route} onSignedOut={onSignedOut} />
    </live.LiveProvider>
  );
}

/** Words for the browser tab: the tab label where the screen has tabs, else the screen. */
export function pageTitle(route: Route): string {
  if (route.wall) return C.app.wallTitle;
  const tabs = (C.tabs as Record<string, Record<string, string>>)[route.s];
  const name = route.t && tabs ? tabs[route.t] : undefined;
  return name ?? C.nav[route.s];
}

type BannerView = ComponentProps<typeof SimulatorBanner>['view'];
type BannerTab = ComponentProps<typeof SimulatorBanner>['productTab'];

/** The old banner reasons in the old screen names; this maps the new route onto them. */
export function bannerView(route: Route): { view: BannerView; productTab: BannerTab } {
  if (route.wall) return { view: 'wall', productTab: 'running' };
  switch (route.s) {
    case 'today':
      return { view: 'line', productTab: 'running' };
    case 'quality':
      return {
        view: route.t === 'rejects' ? 'rejects' : route.t === 'register' ? 'readings' : 'weight',
        productTab: 'running',
      };
    case 'products':
      return { view: 'product', productTab: route.t === 'board' ? 'running' : 'catalogue' };
    case 'reports':
      return { view: 'report', productTab: 'running' };
    default:
      return { view: route.t === 'diagnostics' ? 'health' : 'setup', productTab: 'running' };
  }
}

function Frame({ user, rank, route, onSignedOut }: { user: AuthUser; rank: number; route: Route; onSignedOut: () => void }) {
  const { line } = useLive();
  const plantNow = usePlantNow();
  const { period } = usePeriod();
  const go = useCallback((next: Route, opts?: { replace?: boolean }) => navigate(next, opts), []);

  const title = pageTitle(route);
  useEffect(() => {
    document.title = `${title} - ${C.shell.appName}`;
  }, [title]);

  // Esc leaves the wall display, which has no navigation of its own.
  useEffect(() => {
    if (!route.wall) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') go(todayRoute(route));
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [route, go]);

  const Screen = resolveScreen(route);
  const Sheet = route.sheet ? resolveSheet(route.sheet.kind) : null;
  const screenProps = { route, rank, user, go };

  // A missing verdict (loading, or the fetch failed) is "status unknown", never OK.
  const health = line ? healthLib.assessHealth(line) : null;
  const sim = bannerView(route);
  const leaveReplay: Route = {
    ...route,
    keys: Object.fromEntries(Object.entries(route.keys).filter(([k]) => k !== 'at')),
  };

  const page = (
    <Suspense fallback={<p className="app-loading" role="status">{C.chart.loading}</p>}>
      <Screen {...screenProps} />
    </Suspense>
  );

  if (route.wall) {
    return (
      <AppShell route={route} rank={rank} user={user} onNavigate={go} onSignedOut={onSignedOut}>
        <ErrorBoundary variant="wall" label={C.app.wallTitle}>
          {page}
        </ErrorBoundary>
      </AppShell>
    );
  }

  return (
    <AppShell
      route={route}
      rank={rank}
      user={user}
      onNavigate={go}
      onSignedOut={onSignedOut}
      periodChip={route.s === 'system' ? undefined : <PeriodChip />}
      healthDot={
        <HealthDot
          health={health}
          plantNowUtc={plantNow}
          onOpen={() => go(routeFor(route, { s: 'system', t: defaultTab('system') }))}
        />
      }
    >
      {line?.replay && (
        <div className="app-banner" role="status">
          <span>
            {W.replay} {new Date(line.plantNowUtc).toISOString().replace('T', ' ').slice(0, 19)}. {W.replayNote}
          </span>
          <a className="ui-link" href={hrefFor(leaveReplay)} onClick={(e) => plainClick(e, () => go(leaveReplay))}>
            {C.app.leaveReplay}
          </a>
        </div>
      )}
      {period && <SimulatorBanner view={sim.view} productTab={sim.productTab} from={period.from} to={period.to} />}
      {page}
      {Sheet && route.sheet && (
        <ErrorBoundary key={`${route.sheet.kind}:${route.sheet.id}`} variant="default" label={route.sheet.kind}>
          <Suspense fallback={null}>
            <Sheet {...screenProps} onClose={() => go({ ...route, sheet: null })} />
          </Suspense>
        </ErrorBoundary>
      )}
    </AppShell>
  );
}
