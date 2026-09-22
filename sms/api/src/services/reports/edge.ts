/**
 * Locate Microsoft Edge on the host — the PDF renderer's one hard dependency
 * (services/reports/pdf.ts). `puppeteer-core` ships no bundled Chromium on
 * purpose (see pdf.ts's header): the plant PC is air-gapped, so an
 * install-time browser download would simply fail there. Edge is instead
 * preinstalled on every Windows machine this app targets, so the renderer
 * drives it directly.
 *
 * WHY THIS IS ITS OWN MODULE, PROBED AT STARTUP, NOT AT EXPORT TIME. A
 * missing browser is a fact about the HOST, not about any one request — the
 * brief's own instruction is that it "must be a health/startup concern, not
 * a 500 on a button". `index.ts` calls `locateEdge()` once at boot and logs
 * loudly (the same idiom as `checkPlantOffsetOnStartup`) if nothing is
 * found; `getHealth()` (services/health.ts) carries the same result so an
 * operator watching Setup/Health sees it without pressing Export first. The
 * export route (routes/reports.ts) still re-checks before every render —
 * Edge could be uninstalled by IT after the process started — but by then
 * the operator has already had a chance to see the warning.
 *
 * PROBE ORDER, from a named env override down to the three install
 * locations Windows actually uses:
 *   1. PDF_EDGE_PATH        explicit override (same style as the rest of
 *                           appConfig — CLAUDE.md's "never hardcode paths")
 *   2. %ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe   (the
 *      normal per-machine install location on 64-bit Windows — Edge is a
 *      32-bit-on-x64 install by default)
 *   3. %ProgramFiles%\Microsoft\Edge\Application\msedge.exe        (a
 *      64-bit Edge build, or a non-default install)
 *   4. %LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe        (a
 *      per-user install, e.g. on a locked-down machine with no admin rights)
 * The first that exists wins. No PATH search, no registry read: both need
 * extra privileges or extra dependencies this module has no reason to ask
 * for when a plain file-existence check on three well-documented paths
 * answers the same question.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface EdgeProbeResult {
  ok: boolean;
  /** Full path to msedge.exe, or null when not found. */
  path: string | null;
  /** Set only when `ok` is false — human-readable, actionable, safe to log or show on Setup/Health. */
  reason: string | null;
}

interface Candidate {
  dir: string | undefined;
  source: string;
}

function candidateDirs(env: NodeJS.ProcessEnv): Candidate[] {
  return [
    { dir: env['ProgramFiles(x86)'], source: 'Program Files (x86)' },
    { dir: env.ProgramFiles, source: 'Program Files' },
    { dir: env.LOCALAPPDATA, source: "the current user's AppData\\Local" },
  ];
}

/**
 * `env` and `exists` are injectable so `edge.test.ts` can prove both the
 * present and the absent path without touching the real filesystem or the
 * real environment — the same shape as `health.ts`'s `BackupFs`.
 */
export function locateEdge(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): EdgeProbeResult {
  const override = env.PDF_EDGE_PATH;
  if (override) {
    if (exists(override)) return { ok: true, path: override, reason: null };
    return {
      ok: false,
      path: null,
      reason:
        `PDF_EDGE_PATH is set to "${override}" but no file exists there. PDF export is disabled until this is fixed: ` +
        `either correct the path or unset PDF_EDGE_PATH to fall back to the automatic Windows-install probe.`,
    };
  }
  for (const { dir, source } of candidateDirs(env)) {
    if (!dir) continue;
    const exe = join(dir, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (exists(exe)) return { ok: true, path: exe, reason: null };
  }
  return {
    ok: false,
    path: null,
    reason:
      'Microsoft Edge was not found in any known Windows install location (Program Files, Program Files (x86), or ' +
      "the current user's AppData\\Local). PDF export needs msedge.exe — Edge ships preinstalled on Windows, so a " +
      'missing copy usually means a stripped-down server image. Install Edge, or set PDF_EDGE_PATH to its full path ' +
      'if it is installed somewhere non-standard. PDF export is disabled until this is resolved; CSV and XLSX export ' +
      'are unaffected.',
  };
}
