/**
 * Error classification for source failures (roadmap Phase 2, 14 Sep 2026).
 * Lives apart from SourceAdapter.ts only so that the adapter class can import
 * it without a value-level cycle through the registry; the public home of
 * `classifyError` is SourceAdapter.ts, which re-exports it.
 */
export type ErrorClass = 'transient' | 'auth' | 'schema' | 'unknown';

const TRANSIENT_CODES = new Set(['ESOCKET', 'ETIMEOUT', 'ECONNRESET', 'ECONNCLOSED']);
const AUTH_NUMBERS = new Set([18456, 229, 230, 297]);
const SCHEMA_NUMBERS = new Set([207, 208, 4060]);
/** Server-side numbers that mean "try again", when wrapped in the driver's EREQUEST. */
const TRANSIENT_NUMBERS = new Set([1205, 1222, -2, 596, 1204, 8645, 8651, 40197, 40501, 40613, 49918, 49919, 49920]);

/** node-mssql errors carry `code` (driver) and `number` (server), sometimes on `originalError`. */
function codeAndNumber(err: unknown): { code: string | undefined; number: number | undefined } {
  if (typeof err !== 'object' || err === null) return { code: undefined, number: undefined };
  const e = err as { code?: unknown; number?: unknown; originalError?: unknown };
  let code = typeof e.code === 'string' ? e.code : undefined;
  let number = typeof e.number === 'number' ? e.number : undefined;
  // tedious wraps the server error: `RequestError.originalError.info.number`
  // is where the SQL Server number actually lives on a driver error.
  const inner = e.originalError as { code?: unknown; number?: unknown; info?: { number?: unknown } } | undefined;
  if (inner && typeof inner === 'object') {
    if (code === undefined && typeof inner.code === 'string') code = inner.code;
    if (number === undefined && typeof inner.number === 'number') number = inner.number;
    if (number === undefined && inner.info && typeof inner.info.number === 'number') number = inner.info.number;
  }
  return { code, number };
}

export function classifyError(err: unknown): ErrorClass {
  const { code, number } = codeAndNumber(err);
  if (code !== undefined && TRANSIENT_CODES.has(code)) return 'transient';
  if (code === 'ELOGIN') return 'auth';
  if (number !== undefined) {
    if (AUTH_NUMBERS.has(number)) return 'auth';
    if (SCHEMA_NUMBERS.has(number)) return 'schema';
    if (code === 'EREQUEST' && TRANSIENT_NUMBERS.has(number)) return 'transient';
  }
  return 'unknown';
}

/** `classifyError` as a `retryOn` predicate: only what a retry can cure. */
export const isTransient = (err: unknown): boolean => classifyError(err) === 'transient';

