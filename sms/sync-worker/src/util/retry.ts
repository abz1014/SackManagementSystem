/**
 * Exponential backoff (ARCHITECTURE §14). Retries transient DB failures.
 *
 * `retryOn` (roadmap Phase 2, 14 Sep 2026): which failures a retry can cure.
 * Without it every failure was retried four times with backoff — a login
 * refused by the server, a table that no longer exists — before the halt row
 * finally said why, and the log held four identical warnings for one fact.
 * The runner passes `isTransient` (reader/errorClass.ts); an auth or schema
 * failure now throws on the first attempt, with its classification in the
 * halt row. The default stays "retry everything" so existing callers and
 * tests keep their behaviour until they opt in.
 */
export interface RetryOptions {
  retries?: number;
  baseMs?: number;
  onRetry?: (attempt: number, err: unknown) => void;
  /** Return false to give up immediately on this error. Default: retry every error. */
  retryOn?: (err: unknown) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 500;
  const retryOn = opts.retryOn ?? (() => true);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !retryOn(err)) break;
      opts.onRetry?.(attempt + 1, err);
      const delay = baseMs * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
