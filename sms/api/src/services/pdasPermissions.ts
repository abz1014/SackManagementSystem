/**
 * RT24-05. Whether the PDAS write login can read back what it writes.
 *
 * `pdasWrite.ts`'s echo-back check (the CRITICAL 'pdas_write_echo_mismatch'
 * finding) can only ever fire if the writer login holds SELECT on the table
 * it just wrote — under an EXECUTE-only role (the shape IFL's own SOP uses:
 * their engineers run the vendor's procs by hand, with no ad-hoc SELECT
 * grant implied) the check read throws every time and the mismatch check
 * can never fire, silently. This module answers, directly and by asking SQL
 * Server rather than by inferring it from a failed write, whether that gap
 * exists — so Health can say so in plain words before an operator ever
 * needs the echo-back to catch something.
 *
 * `HAS_PERMS_BY_NAME` is read-only and needs no elevated grant of its own —
 * it answers "does the CURRENT login have permission X on object Y", exactly
 * the question here, without requiring VIEW DEFINITION or any catalog access
 * the plant's EXECUTE-only role might also lack (the same gap that blocked
 * the 16 Sep 2026 sys.parameters introspection — see pdasWrite.ts's file
 * header). The five tables and seven procedures below are exactly the ones
 * pdasWrite.ts ever touches (PROC_PARAMS' own VendorProc list plus the
 * Materials UPDATE path) — never built from any external input.
 */
import type { ConnectionPool } from 'mssql';

/** The only five PDAS tables any write path in this app ever reads back or mirrors. */
export const PDAS_SELECT_TABLES = ['Materials', 'Blends', 'Counts', 'TubeTypes', 'Pallets'] as const;

/** The only seven vendor procs pdasWrite.ts ever executes — see pdasWrite.ts's VendorProc. */
export const PDAS_EXEC_PROCS = [
  'CreateMaterial',
  'SetMaterialStatusActive',
  'AddBlend',
  'AddCount',
  'AddTubeType',
  'CreatePallet',
  'SetPalletStatusActive',
] as const;

export interface PdasPermissionStatus {
  /** True only when the writer login holds SELECT on every one of PDAS_SELECT_TABLES. */
  canReadBack: boolean;
  missingSelect: string[];
  missingExecute: string[];
  checkedAtUtc: string;
}

export interface PdasPermissionDeps {
  /** The same lazily-opened writer pool pdasWrite.ts's own writes go through. */
  writerPool: () => Promise<ConnectionPool>;
}

const CACHE_MS = 10 * 60 * 1000;
let cached: { status: PdasPermissionStatus; at: number } | null = null;

/** Tests only: the cache would otherwise leak a stale status across cases. */
export function resetPdasPermissionsCache(): void {
  cached = null;
}

/**
 * Queries `HAS_PERMS_BY_NAME` for each table/proc pdasWrite.ts touches, on
 * the writer's own connection, so the answer reflects the exact login that
 * will actually attempt the writes. Cached 10 minutes: this is a startup /
 * Health-poll fact, not something worth a round trip per page view.
 */
export async function probePdasPermissions(deps: PdasPermissionDeps, now = Date.now()): Promise<PdasPermissionStatus> {
  if (cached && now - cached.at < CACHE_MS) return cached.status;

  const pool = await deps.writerPool();
  const missingSelect: string[] = [];
  const missingExecute: string[] = [];

  for (const table of PDAS_SELECT_TABLES) {
    const r = await pool.request().query<{ ok: number | null }>(`SELECT HAS_PERMS_BY_NAME('dbo.${table}', 'OBJECT', 'SELECT') AS ok`);
    if (r.recordset[0]?.ok !== 1) missingSelect.push(table);
  }
  for (const proc of PDAS_EXEC_PROCS) {
    const r = await pool.request().query<{ ok: number | null }>(`SELECT HAS_PERMS_BY_NAME('dbo.${proc}', 'OBJECT', 'EXECUTE') AS ok`);
    if (r.recordset[0]?.ok !== 1) missingExecute.push(proc);
  }

  const status: PdasPermissionStatus = {
    canReadBack: missingSelect.length === 0,
    missingSelect,
    missingExecute,
    checkedAtUtc: new Date(now).toISOString(),
  };
  cached = { status, at: now };
  return status;
}
