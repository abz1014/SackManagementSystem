/**
 * Guard against the 3 Sep 2026 incident: `getOee`, `getShiftAnalysis` and
 * `getStoppagePatterns` survived that day's redesign pointing at endpoints
 * that had just been deleted, and 404'd silently for days because nothing
 * in the app ever called them.
 *
 * This test is deliberately dumb: it reads api.ts and every other source
 * file under web/src straight off disk (node:fs, no imports of the real
 * modules, no DOM — see vitest.config.ts's `environment: 'node'`) and fails
 * when an exported wrapper has no caller anywhere outside api.ts and
 * outside `*.test.ts` files. A wrapper reached only from its own unit test
 * is exactly as invisible to a user as one that 404s quietly — the check
 * needs a SCREEN, or a shared lib/ui module a screen goes through.
 *
 * A wrapper without a caller today is not automatically a bug: it may be a
 * feature nobody has wired to a screen yet, or one superseded by a richer
 * wrapper hitting the same endpoint. Either way it must be a WRITTEN
 * decision, never a silent gap — add it to ALLOW_LIST with a one-line
 * reason naming the evidence. Do not add an entry just to make this pass.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));
const API_FILE = 'api.ts';

/**
 * Wrappers with zero UI callers as of the 16 Sep 2026 API-wrapper audit,
 * each a written decision rather than a gap. Keep this in sync: routing one
 * of these to a screen should remove its entry (the test then proves it via
 * the "ALLOW_LIST is not stale" check below); an endpoint that goes away
 * should delete the wrapper instead of growing this list.
 */
const ALLOW_LIST: Record<string, string> = {
  // ---- (b) unreachable feature — the endpoint is real and works, no screen calls it yet ----
  getDowntime:
    '/api/downtime computes the full stoppage list, hourly buckets, MTBF/MTTR and availabilityPct; only its stoppageCount/stoppedSeconds subset reaches Report via getReportOf("daily") today (screens/report/Daily.tsx).',
  getCalibrationRules:
    "api/src/routes/calibration.ts's own doc comment: the Nelson rule labels were built for the Weight/StationSheet Details block (\"rules 4 and 7 cannot fire on this series\") and have never been wired to a screen.",

  // ---- (c) superseded — the endpoint still works, but a richer wrapper on the SAME endpoint is what screens call ----
  adminGetAudit:
    'superseded by adminGetAuditPage — same GET /api/admin/audit, keyset-paginated — used by screens/Setup.tsx.',
  getRejects:
    'superseded by getRejectsFiltered — same GET /api/rejects plus station/product/code filters — used by screens/Rejects.tsx.',
  getWeights:
    "superseded by getSpc + getWeightStations, the Weight screen's replacement for the old Spread screen; getWeights's giveawayTotalKg was the disclaimer-boxed figure the 3 Sep 2026 redesign deliberately dropped.",
  getCalibration:
    'superseded by getWeightStations — both call the same server-side getStationDrift — which is the ONE station table CLAUDE.md rule 6 mandates on Weight; a second wrapper on this data must not be reintroduced.',
  getCalibrationAdjustments:
    'superseded by listAdjustments — same GET /api/calibration/adjustments plus from/to/station — used by screens/StationSheet.tsx and screens/report/Calibration.tsx.',
  recordCalibrationAdjustment:
    'superseded by recordAdjustment — same POST /api/calibration/adjustments plus before/after/reference/product — used by screens/StationSheet.tsx.',
  getRejectSpc:
    'superseded by getRejectSpcFiltered — same GET /api/reject-spc plus station/product/code filters — used by screens/Rejects.tsx.',
  getReport:
    'superseded by getReportOf("daily", …) via /api/reports/daily, the roadmap Phase 8 rebuild of Report.tsx (its own header comment calls /api/report "the old one").',

  // ---- (b) unreachable feature — UX Phase 7 Brief 2 (21 Sep 2026) built the backend only, no UI ----
  getSystemHistory:
    'GET /api/system-history (source generations, rebuild audit, sms verify runs) is built, routed and tested; Brief 2 was scoped to backend only — no screen reads it yet.',
  getDqDestination:
    'GET /api/dq-destination resolves a DQ finding subjectRef to its canonical row; built, routed and tested — Brief 2 was scoped to backend only, no screen calls it yet.',
};

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every `export function` / `export const foo = (` in api.ts, by name. */
function exportedWrapperNames(apiSource: string): string[] {
  const names = new Set<string>();
  for (const m of apiSource.matchAll(/^export (?:async )?function ([A-Za-z_$][\w$]*)/gm)) names.add(m[1]!);
  for (const m of apiSource.matchAll(/^export const ([A-Za-z_$][\w$]*)(?:\s*:[^=\n]+)?=\s*(?:async\s*)?\(/gm)) {
    names.add(m[1]!);
  }
  return [...names];
}

const apiPath = `${SRC_DIR}${API_FILE}`;
const apiSource = readFileSync(apiPath, 'utf8');
const wrapperNames = exportedWrapperNames(apiSource);

// Every other .ts/.tsx file under web/src — screens, ui, lib — excluding
// api.ts itself and any *.test.ts(x), so a wrapper exercised only by its own
// unit test still counts as unreachable from the app.
const callerFiles = listSourceFiles(SRC_DIR).filter(
  (f) => !f.endsWith(`/${API_FILE}`) && !/\.test\.tsx?$/.test(f),
);
const callerSource = callerFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

describe('api.ts wrappers are reachable from the app', () => {
  it('scanned a realistic number of exported wrappers (sanity check on the scan itself)', () => {
    // A canary for the regex above breaking silently, not a real business
    // rule — bump the floor if wrappers are removed and it starts failing.
    expect(wrapperNames.length).toBeGreaterThan(50);
  });

  it('every exported wrapper has a caller outside api.ts/*.test.ts, or a written ALLOW_LIST reason', () => {
    const violations = wrapperNames.filter((name) => {
      const hasCaller = new RegExp(`\\b${name}\\b`).test(callerSource);
      return !hasCaller && !ALLOW_LIST[name];
    });
    expect(
      violations,
      violations.length === 0
        ? ''
        : `these api.ts exports have no caller anywhere in web/src outside api.ts/*.test.ts, and no ALLOW_LIST entry: ${violations.join(', ')}. ` +
            `Either wire one up to a screen, delete it if its endpoint is gone (check api/src/app.ts and api/src/routes/*), ` +
            `or add ALLOW_LIST['<name>'] here with a one-line reason.`,
    ).toEqual([]);
  });

  it('ALLOW_LIST names only wrappers that still exist in api.ts', () => {
    const stale = Object.keys(ALLOW_LIST).filter((name) => !wrapperNames.includes(name));
    expect(stale, `ALLOW_LIST entries for names no longer exported from api.ts (remove them): ${stale.join(', ')}`).toEqual([]);
  });

  it('ALLOW_LIST names only wrappers that genuinely have no caller (remove the entry once one exists)', () => {
    const obsolete = Object.keys(ALLOW_LIST).filter((name) => new RegExp(`\\b${name}\\b`).test(callerSource));
    expect(
      obsolete,
      `ALLOW_LIST entries for wrappers that now DO have a caller — remove the entry, the gap is closed: ${obsolete.join(', ')}`,
    ).toEqual([]);
  });
});
