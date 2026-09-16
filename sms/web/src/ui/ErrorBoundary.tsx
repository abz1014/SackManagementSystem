/**
 * ErrorBoundary — the app's last line of defence against a render throw.
 *
 * Two are mounted: `main.tsx` wraps the whole application, and `App.tsx`
 * separately wraps the screen area (and, on its own, the Wall board). That
 * split matters for one reason — a boundary that only wraps the root turns a
 * broken SCREEN into a broken APP. Wrapping the screen area too means a
 * throw while drawing Weight or Rejects leaves the top bar and navigation
 * standing, so the reader can just click somewhere else instead of staring
 * at a blank page.
 *
 * Wall is the case that motivated this file. It runs fullscreen and
 * unattended on a TV beside the line, with no navigation chrome at all — see
 * `screens/Wall.tsx`. "Reload the page yourself" is not a real recovery path
 * for a display nobody is standing in front of, which is why it is the one
 * variant that gets an automatic remount (`shouldAutoRecover` below) before
 * settling on the fallback.
 *
 * The fallback matches `Failed` in `ui/bits.tsx` — the app's existing "this
 * did not load" language and accent colour — rather than inventing a second
 * failure idiom, and states the error's own message: this is an internal
 * plant tool read by process engineers, not a public site, and "Cannot read
 * properties of undefined" tells one of them more than "Something went
 * wrong" can.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

export type BoundaryVariant = 'default' | 'wall';

/**
 * How long the Wall waits before its one silent remount attempt. Long enough
 * that a transient throw (a bad poll response landing mid-render, say) has
 * settled; short enough that a doorway glance a few seconds later still
 * finds a working board rather than a frozen one.
 */
export const WALL_RETRY_DELAY_MS = 4000;

/**
 * Whether this catch should trigger an automatic remount, kept as a pure
 * function so it can be unit-tested without mounting React — this project's
 * `vitest.config.ts` runs in a Node environment and only collects
 * `*.test.ts`, so nothing that needs a DOM can be exercised here (see
 * `ErrorBoundary.test.ts`).
 *
 * Only Wall gets it, and only once:
 *
 *  - Everywhere else, a silent auto-retry is the wrong call. A manager
 *    watching Weight or Rejects when it throws should see the failure and
 *    decide what to do, not have the screen quietly vanish and reappear
 *    under them mid-read. Those screens sit behind the top bar anyway, so
 *    "click Line" is already one click away.
 *  - Capped at one attempt so a throw that fires on every render (a real
 *    bug, not a transient one) gets exactly one extra chance before the
 *    fallback settles for good — never an infinite remount loop, which on
 *    an unattended display would be worse than the blank screen it is
 *    trying to avoid.
 */
export function shouldAutoRecover(variant: BoundaryVariant | undefined, alreadyRetried: boolean): boolean {
  return variant === 'wall' && !alreadyRetried;
}

interface Props {
  children: ReactNode;
  /** 'wall' unlocks the one automatic remount described above. Everything
   *  else gets the plain fallback only. */
  variant?: BoundaryVariant;
  /** Printed as the fallback's second line and tagged onto the console log,
   *  so "the screen was blank" can be traced to which boundary caught it. */
  label?: string;
}

interface State {
  error: Error | null;
  /** The one auto-remount has already been used — never schedule a second. */
  retried: boolean;
  /** True while the auto-remount timer is pending, so the fallback can say
   *  it is about to try again on its own rather than sitting mute. */
  retrying: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retried: false, retrying: false };

  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Never swallowed, per the task this file was built for: this plant is
    // air-gapped, so the console is the whole record — there is nowhere to
    // send a report to and no reporting call is added here.
    console.error(
      `[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ''}]`,
      error,
      error.stack,
      'React component stack:',
      info.componentStack,
    );

    if (shouldAutoRecover(this.props.variant, this.state.retried)) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.setState({ error: null, retried: true, retrying: false });
      }, WALL_RETRY_DELAY_MS);
      this.setState({ retrying: true });
    }
  }

  componentWillUnmount(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  render(): ReactNode {
    if (this.state.error) {
      return <Fallback error={this.state.error} label={this.props.label} retrying={this.state.retrying} />;
    }
    return this.props.children;
  }
}

/*
 * The four fixed lines of copy, kept here rather than in `lib/words.ts` —
 * where every other string in the redesigned app lives — because this task
 * is scoped to `main.tsx`, `App.tsx` and this one new file. Written in the
 * same plain, blunt register as `words.ts` all the same: short sentences,
 * no jargon, the error's own message printed rather than paraphrased.
 */
const COPY = {
  headline: 'This screen failed.',
  body: 'Something in the app broke while drawing it. Reloading usually clears it.',
  noMessage: 'No error message was given.',
  reload: 'Reload this screen',
  backToLine: 'Back to Line',
  /** Wall only: shown while the boundary's one silent remount is pending. */
  recovering: 'This board will try to recover on its own in a few seconds.',
} as const;

function Fallback({ error, label, retrying }: { error: Error; label?: string; retrying: boolean }) {
  // A real navigation (not client-side routing, which is exactly the code
  // that just failed) back to the bare path — dropping `?s=…&sheet=…` drops
  // whatever route triggered the throw and lands on Line, the app's default
  // screen. This is the Wall's only way back to a working screen: it has no
  // navigation chrome of its own.
  const home = typeof window !== 'undefined' ? window.location.pathname : '/';
  return (
    <div className="page">
      {label && <p className="q">{label}</p>}
      <h1 className="wide acc">{COPY.headline}</h1>
      <p>{COPY.body}</p>
      <p className="sm mut">{error.message || COPY.noMessage}</p>
      {retrying && <p className="sm mut">{COPY.recovering}</p>}
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          {COPY.reload}
        </button>
        <a className="btn" href={home}>
          {COPY.backToLine}
        </a>
      </div>
    </div>
  );
}
