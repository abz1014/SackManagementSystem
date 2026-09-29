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
import { ApiError, getLive, type LiveLine, type Meta } from '../api';

export const LIVE_POLL_MS = 10_000;
export const LIST_POLL_MS = 15_000;

/**
 * Failure backoff cap for `usePolling` (Task, 29 Sep 2026). While the API is
 * unreachable — e.g. mid-restart, when Vite's dev proxy answers every
 * request with a 500 — a fixed `intervalMs` retry means every open tab
 * hammers the (still-down) server every `intervalMs`, forever, with no
 * relief until it comes back. The delay now doubles per consecutive
 * failure, capped here, and resets to `intervalMs` on the next success (or
 * immediately on a manual `refresh()`). The cap is the larger of a flat 60 s
 * and 6× the poll's own interval, so a slow list poll (`LIST_POLL_MS`)
 * still backs off meaningfully relative to its own cadence.
 */
export const BACKOFF_CAP_MS = 60_000;

export interface PollState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Browser clock at the last successful fetch. */
  updatedAt: number | null;
  refresh: () => void;
}

/**
 * The one decision this file makes about stale data, pulled out so it can be
 * unit-tested without rendering the hook: given the key the last data was
 * fetched under and the key now in effect, may that old data still be shown?
 *
 * Same key (a routine poll tick, a manual refresh, a tab regaining focus) —
 * yes: it is the last good reading of the thing still on screen, and a
 * transient failure shouldn't blank a live display over it.
 *
 * Different key — no, regardless of why the key changed (new period, new
 * station, new report). The old value describes a different question than
 * the one now on screen; keeping it around lets a failed fetch present it as
 * the answer to the new question, which is worse than an error state.
 */
export function keepDataAcrossKeyChange(prevKey: string | null, nextKey: string): boolean {
  return prevKey === nextKey;
}

export interface UsePollingOptions {
  /**
   * When `false`, `fn` is still called once (on mount and on every `key`/
   * `refresh()` change) but the result is never used to schedule a repeat —
   * no `setTimeout`, no `visibilitychange` re-fetch. Defaults to `true`, so
   * every existing 3-argument call site is unaffected.
   *
   * Built for periods that are not live (`period.live === false`, a past
   * range or a past day): re-running the identical historic query every
   * `intervalMs` wastes server load for an answer that cannot change. Screens
   * opt in with `usePolling(fn, intervalMs, key, { enabled: period.live })` —
   * when `period.live` later flips back to `true` (the viewer returns to a
   * live period), polling resumes on the same cycle, from the same `key`.
   */
  enabled?: boolean;
}

/**
 * Poll `fn` every `intervalMs`, keyed so a change of `key` starts a fresh
 * cycle. On error the last good data is kept and `error` is set: a stale
 * number with a warning beats a blank screen in front of a running line.
 *
 * That "keep the last good data" rule applies to a refetch of the SAME
 * query only. When `key` itself changes, any data already held describes
 * the previous key (the previous period/station/report), not the one now
 * on screen — so it is cleared before the new key's first fetch runs. If
 * that fetch fails, the screen sees `data: null, error: <message>` and
 * renders its failure state instead of the old key's numbers under the new
 * heading.
 *
 * `opts.enabled` (default `true`) gates the REPEAT only, never the initial
 * fetch — see `UsePollingOptions` above.
 */
export function usePolling<T>(
  fn: () => Promise<T>,
  intervalMs: number,
  key: string,
  opts?: UsePollingOptions,
): PollState<T> {
  const enabled = opts?.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const prevKeyRef = useRef<string | null>(null);
  // Consecutive-failure streak, used only to compute the next delay
  // (`schedule` below). Lives outside the effect (a plain useRef, not
  // effect-local state) so it survives the effect re-running on a manual
  // `refresh()` tick — a refresh must still fire its OWN fetch immediately,
  // but the streak it inherits still governs the delay after that fetch.
  const failStreakRef = useRef(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    if (!keepDataAcrossKeyChange(prevKeyRef.current, key)) {
      setData(null);
      setError(null);
      setUpdatedAt(null);
    }
    prevKeyRef.current = key;

    const schedule = () => {
      if (!enabled) return; // not live: one fetch per key/refresh, no repeat
      const cap = Math.max(BACKOFF_CAP_MS, intervalMs * 6);
      const delay =
        failStreakRef.current > 0
          ? Math.min(intervalMs * 2 ** failStreakRef.current, cap)
          : intervalMs;
      timer = window.setTimeout(run, delay);
    };
    const run = async () => {
      try {
        const d = await fnRef.current();
        if (cancelled) return;
        setData(d);
        setError(null);
        setUpdatedAt(Date.now());
        failStreakRef.current = 0; // back to normal cadence on the next success
      } catch (e) {
        if (!cancelled) {
          // RT-014 (ENGINEERING-RED-TEAM-AUDIT-2026-09-24.md): `Failed`
          // (ui/bits.tsx) needs to tell a 413 "your own query was too big"
          // apart from a genuine outage, and the only place that status
          // survives is here, on the thrown ApiError — by the time this
          // reaches a screen it is already just `error: string | null`. A
          // `[<status>] ` prefix carries it through without widening
          // PollState's own shape, the same "encode it in the string" idiom
          // the pre-existing `refused` check in `Failed` already relied on.
          const status = e instanceof ApiError ? e.status : null;
          const message = String((e as Error).message ?? e);
          setError(status != null ? `[${status}] ${message}` : message);
          failStreakRef.current += 1; // next schedule() backs off further
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          schedule();
        }
      }
    };
    const onVisible = () => {
      if (!enabled) return; // not live: a tab regaining focus is not a reason to re-poll a fixed period
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
  }, [intervalMs, key, tick, enabled]);

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
