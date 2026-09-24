/**
 * RT24-01 (CRITICAL): a malformed session cookie used to bind straight into
 * an `mssql.UniqueIdentifier` parameter (auth.ts's `userFromSession`),
 * throwing `EPARAM` inside `authMiddleware`'s async handler — a rejection
 * Express 4 does not forward, so it went unhandled and crashed the process.
 * `auth.ts` is now defensive on its own (GUID-shape check before any query,
 * try/catch around the lookup), but this module is the last line of
 * defence for that bug CLASS, not just this one instance of it: any future
 * unhandled rejection anywhere in the process must not take the service
 * down by itself.
 *
 * - `unhandledRejection` — logged with its stack, the service is marked
 *   degraded (`services/health.ts`'s `markDegraded`, read by `/api/health`)
 *   so the failure is visible on Health, and the process keeps running: a
 *   single bad request should cost one 401/500, not the whole API.
 * - `uncaughtException` — logged, then `exit(1)`. An uncaught exception (as
 *   opposed to a rejected promise) means a synchronous throw escaped every
 *   handler around it; process state may be inconsistent, so this
 *   deliberately does NOT try to keep running. NSSM restarts the service
 *   ~10 s later (DEPLOY.md).
 *
 * `proc` defaults to the real `process` but is injectable so
 * processGuards.test.ts can emit synthetic events on a fake EventEmitter
 * without touching the real process's listener list.
 */
export interface ProcessGuardLog {
  error(message: string, meta?: Record<string, unknown>): void;
}

export function installProcessGuards(
  log: ProcessGuardLog,
  markDegraded: (reason: string) => void,
  exit: (code: number) => void = process.exit.bind(process),
  proc: NodeJS.Process = process,
): void {
  proc.on('unhandledRejection', (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log.error('unhandled promise rejection', { err: { message: err.message, stack: err.stack } });
    markDegraded(`unhandled rejection: ${err.message}`);
  });

  proc.on('uncaughtException', (err: Error) => {
    log.error('uncaught exception', { err: { message: err.message, stack: err.stack } });
    exit(1);
  });
}
