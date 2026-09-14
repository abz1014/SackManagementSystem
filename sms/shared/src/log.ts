/**
 * Structured logging without a dependency (roadmap Phase 2 item 6, 14 Sep 2026).
 *
 * One JSON object per line on stdout: `ts, level, svc, msg` and whatever the
 * caller adds. Until now the worker had an inline `log()` and the API wrote
 * template strings to stderr, so the same event — a halted table, a refused
 * request, a 500 — had a different shape in every process and could not be
 * grepped for, let alone correlated: the halt rows in `sms.sync_run` carry a
 * `run_id`, the log line that explained them did not.
 *
 * `child(extra)` binds fields onto every line the child writes. The worker's
 * pass `runId` and the API's per-request id travel that way under the one
 * name `correlationId`, so `grep <id> api.log sync.log` finds every line about
 * one pass or one request across both services.
 *
 * Not pino, deliberately: the plant PC has no internet and the project rule
 * is to ask before adding a dependency (CLAUDE.md working rule 4). This is
 * forty lines and covers the whole requirement — one line per event, machine-
 * parseable, level-tagged — and NSSM already rotates the files it lands in
 * (DEPLOY.md).
 *
 * Every level writes to STDOUT, by contract with the other services: the
 * `level` field is the filter, not the stream. A logger must never throw —
 * an Error in `extra` is flattened to `{ name, message, stack }` (JSON.stringify
 * of an Error is `{}`), and a value that cannot be serialised at all is
 * replaced with a note saying so rather than losing the line.
 */

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(msg: string, extra?: LogFields): void;
  warn(msg: string, extra?: LogFields): void;
  error(msg: string, extra?: LogFields): void;
  /** A logger that adds `extra` to every line it writes (e.g. `{ correlationId }`). */
  child(extra: LogFields): Logger;
}

/** JSON.stringify(err) is `{}`; the stack is the one thing a 2am reader needs. */
function flatten(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack ?? null };
  }
  return value;
}

function emit(svc: string, bound: LogFields, level: LogLevel, msg: string, extra: LogFields | undefined): void {
  const fields: LogFields = {};
  for (const [k, v] of Object.entries({ ...bound, ...(extra ?? {}) })) fields[k] = flatten(v);
  // The four fixed keys come first and cannot be overridden by a caller's
  // `extra` — a line whose `level` said "info" because a field was named
  // `level` would defeat the filter this format exists for. Re-assigning an
  // existing key keeps its position, so the order stays ts, level, svc, msg.
  const ts = new Date().toISOString();
  const line: LogFields = { ts, level, svc, msg, ...fields };
  line.ts = ts;
  line.level = level;
  line.svc = svc;
  line.msg = msg;
  let text: string;
  try {
    text = JSON.stringify(line);
  } catch (e) {
    text = JSON.stringify({ ts, level, svc, msg, serializationError: e instanceof Error ? e.message : String(e) });
  }
  process.stdout.write(`${text}\n`);
}

function make(svc: string, bound: LogFields): Logger {
  return {
    info: (msg, extra) => emit(svc, bound, 'info', msg, extra),
    warn: (msg, extra) => emit(svc, bound, 'warn', msg, extra),
    error: (msg, extra) => emit(svc, bound, 'error', msg, extra),
    child: (extra) => make(svc, { ...bound, ...extra }),
  };
}

/** `svc` names the process — 'api', 'sync-worker', 'cli' — on every line. */
export function createLogger(svc: string): Logger {
  return make(svc, {});
}
