import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { logout, type AuthUser } from '../bridge/api';
import { C } from '../copy';
import type { Route } from '../route';
import { routeFor } from './nav';
import { Sidebar, useSidebarCollapsed } from './Sidebar';
import { TabBar } from './TabBar';
import { TopBar } from './TopBar';
import './components/shell.css';

export interface AppShellProps {
  route: Route;
  /** 1 viewer .. 4 admin (ROLE_RANK of the signed-in user). */
  rank: number;
  user: AuthUser | null;
  onNavigate: (r: Route) => void;
  /** Page title shown in the top bar; defaults to the screen's navigation word. */
  title?: string;
  periodChip?: ReactNode;
  healthDot?: ReactNode;
  /** Block at the foot of the sidebar card (for example a health summary). */
  sidebarFooter?: ReactNode;
  /** Called after the server accepted the sign-out. Default: reload the page. */
  onSignedOut?: () => void;
  children: ReactNode;
}

/** A page that throws must not take the shell with it. Reset by key (route) or by the Try again button. */
class PageBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_e: Error, _i: ErrorInfo) {
    /* the message is deliberately not shown: it is not a sentence for a reader */
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card sh-page-error" role="alert">
        <h2>{C.couldntLoad(C.shell.pageFailed.toLowerCase())}</h2>
        <button type="button" className="btn quiet" onClick={() => this.setState({ failed: false })}>
          {C.tryAgain}
        </button>
      </div>
    );
  }
}

export function AppShell({
  route, rank, user, onNavigate, title, periodChip, healthDot, sidebarFooter, onSignedOut, children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useSidebarCollapsed(user?.username ?? null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const resetKey = `${route.s}/${route.t ?? ''}`;

  const signOut = () => {
    setSignOutError(null);
    logout().then(
      () => (onSignedOut ? onSignedOut() : window.location.reload()),
      () => setSignOutError(C.shell.signOutFailed),
    );
  };

  // Wall mode: no chrome at all, only the page on the wall scale.
  if (route.wall) {
    return (
      <div className="wall sh-wall">
        <PageBoundary resetKey={resetKey}>{children}</PageBoundary>
      </div>
    );
  }

  return (
    <div className="sh-app" data-collapsed={collapsed ? '' : undefined}>
      <a className="sh-skip" href="#sh-main">
        {C.shell.skip}
      </a>
      <Sidebar
        route={route}
        rank={rank}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        onNavigate={onNavigate}
        footer={sidebarFooter}
      />
      <div className="sh-col">
        <TopBar
          title={title ?? C.nav[route.s]}
          periodChip={periodChip}
          healthDot={healthDot}
          user={user}
          onOpenAccount={() => onNavigate(routeFor(route, { s: 'system', t: 'account' }))}
          onSignOut={signOut}
          onOpenWall={() => onNavigate({ s: 'today', t: null, sheet: null, wall: true, keys: route.keys })}
          signOutError={signOutError}
        />
        <main id="sh-main" className="sh-main" tabIndex={-1}>
          <PageBoundary resetKey={resetKey}>{children}</PageBoundary>
        </main>
      </div>
      <TabBar route={route} rank={rank} onNavigate={onNavigate} onSignOut={signOut} signOutError={signOutError} />
    </div>
  );
}
