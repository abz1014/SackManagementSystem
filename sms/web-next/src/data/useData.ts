import { live } from '../bridge/lib';
import { assertShape, type Shape } from './shape';

export type DataStatus = 'loading' | 'error' | 'ok' | 'empty';

export interface DataState<T> {
  status: DataStatus;
  data: T | null;
  /** Message of the failed fetch. Set with status 'error', or as staleError beside kept data. */
  error: string | null;
  /** Set when a refetch failed but the last good data of the SAME key is still shown. */
  staleError?: string;
  /** Which part of the screen this is, so a failure can be named. */
  part: string;
  updatedAt: number | null;
  refresh: () => void;
}

export interface UseDataOptions<T> {
  /** false: fetch once per key/refresh, never repeat. Default true. */
  live?: boolean;
  /** Decides "empty" for successfully fetched data only. */
  isEmpty?: (data: T) => boolean;
  intervalMs?: number;
  /** Required body paths (see shape.ts). A body without one is a failed fetch that names the part, never a crash or a zero. */
  shape?: Shape;
}

/**
 * usePolling with an explicit status. A failed fetch with nothing to show is
 * 'error' and never 'empty'; 'empty' needs a successful answer that isEmpty().
 */
export function useData<T>(
  part: string,
  fn: () => Promise<T>,
  key: string,
  opts: UseDataOptions<T> = {},
): DataState<T> {
  const shape = opts.shape;
  const checked = shape ? async () => { const body = await fn(); return body === null ? body : assertShape(body, shape, part); } : fn;
  const poll = live.usePolling(checked, opts.intervalMs ?? live.LIST_POLL_MS, key, { enabled: opts.live !== false });
  let status: DataStatus;
  if (poll.data !== null) status = opts.isEmpty && opts.isEmpty(poll.data) ? 'empty' : 'ok';
  else if (poll.error !== null) status = 'error';
  else status = 'loading';
  const out: DataState<T> = {
    status,
    data: poll.data,
    error: poll.error,
    part,
    updatedAt: poll.updatedAt,
    refresh: poll.refresh,
  };
  if (poll.data !== null && poll.error !== null) out.staleError = poll.error;
  return out;
}
