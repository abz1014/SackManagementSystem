/**
 * Pure guard logic for the PDAS e2e harness's live pre-flight check
 * (`scripts/pdas-e2e-local.mjs`, GUARD LAYER 2). Extracted into its own
 * side-effect-free module so it can be unit tested without connecting to
 * any database (Task, 28 Sep 2026 — the harness previously compared .env's
 * `PDAS_WRITE_SERVER` ("localhost") literally against the live
 * `@@SERVERNAME` host ("DESKTOP-G1MSH4I"), which always disagree for a
 * valid local-alias setup, so the guard refused every legitimate run before
 * any case executed).
 *
 * This module has NO imports, NO top-level side effects, and NEVER touches
 * a database or the filesystem — importing it does nothing but define these
 * two functions.
 */

/** Server strings that mean "this machine" without naming it, case-insensitive. */
const LOCAL_ALIASES = new Set(['localhost', '127.0.0.1', '.', '(local)', '::1']);

/**
 * True if `hostOnly` (already stripped of any `\instance` / `,port` suffix)
 * refers to this machine — either a well-known local alias, or the
 * machine's own hostname spelled out directly.
 */
export function isLocalAliasHost(hostOnly, hostname) {
  const h = String(hostOnly ?? '').trim().toLowerCase();
  if (h === '') return false;
  return LOCAL_ALIASES.has(h) || h === String(hostname ?? '').trim().toLowerCase();
}

function hostAndInstance(server) {
  const parts = String(server ?? '').split('\\');
  const host = (parts[0] ?? '').split(',')[0].trim().toLowerCase();
  const instance = (parts[1] ?? '').trim().toLowerCase();
  return { host, instance };
}

/**
 * Decide whether the PDAS e2e harness may proceed, given what it is LIVE
 * connected to (`liveSrv` = `@@SERVERNAME`, `liveDb` = `DB_NAME()`) and what
 * `.env` claims (`envServer` = PDAS_WRITE_SERVER, `envDatabase` =
 * PDAS_WRITE_DATABASE, both optional/blank-if-unset).
 *
 * Requires ALL of:
 *   - the live server's host part equals this machine's hostname
 *     (case-insensitive) — never merely "looks local";
 *   - the live server's instance is exactly SQLEXPRESS;
 *   - DB_NAME() is exactly PDAS_TP1U2_SEP07;
 *   - if `.env` states a server, it must be a recognised local alias
 *     (localhost / 127.0.0.1 / . / (local) / ::1) OR this machine's own
 *     hostname spelled out — never a literal match against the live
 *     server string, which would refuse "localhost" pointed at itself;
 *   - if `.env` states a database, it must equal the live database exactly.
 *
 * Returns `{ ok: true }` or `{ ok: false, reason: string }`. Never throws,
 * never touches a database, never reads a file.
 */
export function checkPdasE2ePreflight({ liveSrv, liveDb, envServer, envDatabase, hostname }) {
  const { host: liveHost, instance: liveInstance } = hostAndInstance(liveSrv);
  const expectedHost = String(hostname ?? '').trim().toLowerCase();

  if (liveHost !== expectedHost) {
    return {
      ok: false,
      reason: `@@SERVERNAME host is "${liveHost}", expected this machine's hostname "${expectedHost}".`,
    };
  }
  if (liveInstance !== 'sqlexpress') {
    return {
      ok: false,
      reason: `@@SERVERNAME instance is "${liveInstance || '(none)'}", expected "SQLEXPRESS".`,
    };
  }
  if (String(liveDb ?? '') !== 'PDAS_TP1U2_SEP07') {
    return {
      ok: false,
      reason: `DB_NAME() is "${liveDb}", expected EXACTLY "PDAS_TP1U2_SEP07".`,
    };
  }
  if (envServer && String(envServer).trim() !== '') {
    const { host: envHost } = hostAndInstance(envServer);
    if (!isLocalAliasHost(envHost, hostname)) {
      return {
        ok: false,
        reason: `.env's PDAS_WRITE_SERVER ("${envServer}") is neither a local alias (localhost/127.0.0.1/./((local))/::1) nor this machine's own hostname ("${expectedHost}").`,
      };
    }
  }
  if (envDatabase && String(envDatabase).trim() !== '' && String(envDatabase).trim() !== String(liveDb ?? '')) {
    return {
      ok: false,
      reason: `.env's PDAS_WRITE_DATABASE ("${envDatabase}") does not match the live database ("${liveDb}").`,
    };
  }
  return { ok: true };
}
