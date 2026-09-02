/**
 * Live data plumbing for the floor and wall screens.
 *
 * Before this file nothing in the web app ever re-fetched: every screen loaded
 * once on open, which is why IFL's first comment was "doesn't show live data".
 * The approach here is deliberately the simplest one that works on a plant
 * intranet — a timer and a fetch — because the sync worker already refreshes
 * the app database every sixty seconds and the API caches for five, so
 * anything more elaborate than polling buys nothing.
 *
 * A hidden tab keeps polling (browsers already throttle its timers, and the
 * API caches for five seconds, so the cost is nil) and re-fetches the moment
 * it is shown again, so the first thing a returning viewer sees is current.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getLive, type LiveLine, type Meta } from '../api';

export const LIVE_POLL_MS = 10_000;
export const LIST_POLL_MS = 15_000;

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Browser clock at the last successful fetch. */
  updatedAt: number | null;
  refresh: () => void;
}

/**
 * Poll `fn` every `intervalMs`, keyed so a change of `key` starts a fresh
 * cycle. On error the last good data is kept and `error` is set: a stale
 * number with a warning beats a blank screen in front of a running line.
 */
export function usePolling<T>(fn: () => Promise<T>, intervalMs: number, key: string): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const schedule = () => {
      timer = window.setTimeout(run, intervalMs);
    };
    const run = async () => {
      try {
        const d = await fnRef.current();
        if (cancelled) return;
        setData(d);
        setError(null);
        setUpdatedAt(Date.now());
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message ?? e));
      } finally {
        if (!cancelled) {
          setLoading(false);
          schedule();
        }
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer);
        void run();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    setLoading(true);
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, key, tick]);

  return { data, error, loading, updatedAt, refresh };
}

/** A once-a-second re-render, for "updated 4 s ago" and the wall clock. */
export function useTicker(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/* ------------------------------------------------------------ live context */

export interface LiveCtx {
  /** The first (today, only) line — what the floor screens show. */
  line: LiveLine | null;
  /** Every line the API reports; the wall renders one card per line. */
  lines: LiveLine[];
  meta: Meta | null;
  error: string | null;
  loading: boolean;
  updatedAt: number | null;
  /** The ?at= replay instant, or null when live. */
  asOf: string | null;
  refresh: () => void;
}

const Ctx = createContext<LiveCtx | null>(null);

/** Read the replay instant from the URL. Only honoured when the API allows it. */
export function readAsOf(): string | null {
  if (typeof window === 'undefined') return null;
  const at = new URLSearchParams(window.location.search).get('at');
  return at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(at) ? at : null;
}

export function LiveProvider({
  asOf,
  onMeta,
  children,
}: {
  asOf: string | null;
  onMeta?: (m: Meta) => void;
  children: ReactNode;
}) {
  const poll = usePolling(() => getLive(asOf), LIVE_POLL_MS, `live:${asOf ?? 'now'}`);
  const meta = poll.data?.metadata ?? null;
  useEffect(() => {
    if (meta && onMeta) onMeta(meta);
  }, [meta, onMeta]);
  const lines = poll.data?.data.lines ?? [];
  const value: LiveCtx = {
    line: lines[0] ?? null,
    lines,
    meta,
    error: poll.error,
    loading: poll.loading,
    updatedAt: poll.updatedAt,
    asOf,
    refresh: poll.refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLive(): LiveCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLive() outside <LiveProvider>');
  return v;
}

/**
 * The plant clock as it is NOW, not as it was at the last poll: the reported
 * instant plus however long ago we received it. A wall display's clock must
 * tick every second, not jump every ten.
 */
export function usePlantNow(): string | null {
  const { line, updatedAt } = useLive();
  const now = useTicker(1000);
  if (!line || updatedAt == null) return null;
  // In a replay the clock is frozen at the requested instant.
  if (line.replay) return line.plantNowUtc;
  return new Date(new Date(line.plantNowUtc).getTime() + (now - updatedAt)).toISOString();
}
