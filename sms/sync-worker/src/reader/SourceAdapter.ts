/**
 * The source adapter contract (roadmap Phase 2, 14 Sep 2026).
 *
 * WHAT WAS FALSE BEFORE. SPEC.md §3 and ARCHITECTURE.md §10 described an
 * "adapter-based" ingestion layer; the Aug 2026 audit grepped for an
 * `IngestionAdapter` interface and found nothing — the runner `new`ed a
 * concrete `IflSqlAdapter`, and CLAUDE.md was corrected to say "designed
 * only". This file is the interface the design promised, and `createAdapter`
 * is the one place a source system's code turns into a reader. `runner.ts`,
 * `epoch.ts` and the CLI go through it; nothing outside tests constructs an
 * adapter class directly.
 *
 * WHAT IS DELIBERATELY NOT HERE. The registry knows ONE system, 'ifl_sql'.
 * The PLC/OPC adapter (roadmap Phase 2B, Component B) is not built: IFL's Q22
 * answer put PLC integration out of scope, and CLAUDE.md's Phase 1 hard
 * constraints forbid a PLC dependency in any manifest. A configuration row
 * naming any other system code halts the pass with a message that says so,
 * rather than being silently read through the SQL adapter.
 *
 * ERROR CLASSES. The runner used to retry EVERY failure four times with
 * backoff — a revoked login, a dropped table, a typo in the table name — and
 * only then halt, with the pass's log holding four identical warnings and the
 * halt row holding the driver's raw message. `classifyError` sorts a failure
 * into what the operator should do about it:
 *
 *   transient  the network or the server blinked — retry, it will likely pass
 *   auth       the login was refused or lacks permission — retrying cannot
 *              help; someone must grant it (the `db_datareader` request that
 *              is still open with IFL)
 *   schema     the object is not there — a renamed table, a dropped column, or
 *              a wrong database; retrying cannot help, and reading on would be
 *              reading the wrong thing
 *   unknown    everything else; treated as not retryable, so a new failure
 *              mode surfaces once, in full, rather than four times
 *
 * The codes and numbers are node-mssql's (tedious) and SQL Server's own:
 * ESOCKET/ETIMEOUT/ECONNRESET/ECONNCLOSED are the driver's connection-level
 * codes; 18456 is "Login failed", 229/230 are "permission denied on object /
 * column", 297 is "the user does not have permission to perform this action";
 * 207/208 are "invalid column name / invalid object name"; 4060 is "cannot
 * open database". An EREQUEST wrapping a transient server number (1205
 * deadlock victim, 1222 lock timeout, -2 request timeout, 596/1204/8645
 * resource shortages) is transient too — the request failed, not the query.
 */
import type { ConnectionPool } from 'mssql';
import type { IflTableDef } from './iflTables.js';
import { IflSqlAdapter } from './IflSqlAdapter.js';

import { classifyError, isTransient, type ErrorClass } from './errorClass.js';

export { classifyError, isTransient, type ErrorClass };

export type ProbeResult =
  | { ok: true; roundTripMs: number }
  | { ok: false; error: string; classification: ErrorClass };

export interface SourceAdapter {
  /** The sms.data_source.system_code this adapter serves — 'ifl_sql'. */
  readonly systemCode: string;
  readonly def: IflTableDef;
  /** Is the source reachable and answering? Never throws: a failure is a classified result. */
  probe(): Promise<ProbeResult>;
  /** The source table's create_date as an ISO string — the generation key — or null if unreadable. */
  sourceEpoch(): Promise<string | null>;
  /** Hash of the columns this adapter DEPENDS ON (fingerprint.ts). */
  fingerprint(): Promise<string>;
  /** The FULL column list of the source table, `"name type"` in ordinal order. */
  columnList(): Promise<string[]>;
  /** Highest source id, or null when the table is empty. */
  maxSourceId(): Promise<number | null>;
  /** Rows with id > afterId, mapped to raw column names, in id order. */
  readSince(afterId: number): Promise<Record<string, unknown>[]>;
}

/**
 * The registry. One entry today; a second source system is a second entry
 * here and a row in sms.data_source — never a change to the runner.
 */
type AdapterFactory = (pool: ConnectionPool, def: IflTableDef) => SourceAdapter;

const REGISTRY: Record<string, AdapterFactory> = {
  ifl_sql: (pool, def) => new IflSqlAdapter(pool, def),
};

export function createAdapter(systemCode: string, pool: ConnectionPool, def: IflTableDef): SourceAdapter {
  const make = Object.prototype.hasOwnProperty.call(REGISTRY, systemCode) ? REGISTRY[systemCode] : undefined;
  if (!make) {
    throw new Error(
      `No adapter is registered for source system "${systemCode}" (known: ${Object.keys(REGISTRY).join(', ')}). ` +
        `The PLC/OPC adapter is deliberately not built (roadmap Phase 2B; IFL Q22). Check sms.data_source.system_code.`,
    );
  }
  return make(pool, def);
}

/** The system codes an installation may configure — for Setup and for tests. */
export const REGISTERED_SYSTEM_CODES: readonly string[] = Object.keys(REGISTRY);
