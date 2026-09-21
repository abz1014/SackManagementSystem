/**
 * UX Phase 8 Brief B, File 2 — client write-gate vs server write-gate
 * crosscheck.
 *
 * `api/src/app.rbac.test.ts:376-478` enumerates GET routes against the
 * server's own rank table, but its own header says it covers reads only —
 * the WRITE routes behind `requireRole`/`canWrite`/`canName`/`canRecord`/
 * `canAdjust` are never checked against the CLIENT's own rank constants
 * (`App.tsx`'s `ENGINEER_RANK`, `EXPORT_RANK`). The precedent defect is
 * real and shipped: the register's Export button was offered at rank 2
 * while the server gated it at 3 (fixed 3 Sep 2026, `EXPORT_RANK` in
 * `App.tsx`) — a control that could only ever answer 403. That defect
 * shape is a CLIENT gate looser than the SERVER's; this test would have
 * caught it, and would catch its opposite (a client gate TIGHTER than the
 * server's, which hides a capability nobody meant to hide).
 *
 * Deliberately dumb, in `targets.guard.test.ts` / `api.callers.test.ts`'s
 * own idiom: reads source files off disk with `node:fs` and greps them —
 * no imports of the real modules, no DOM (`vitest.config.ts`'s
 * `environment: 'node'`), so this file is `.ts`, not `.tsx`.
 *
 * PAIRINGS is the explicit table the brief asks for: for every write
 * control gated by a client rank constant, the constant it is gated by,
 * the exact route it POSTs/PUTs to, and where that route's own
 * `requireRole(N)` is declared. An entry here whose route text no longer
 * appears in its file fails the "PAIRINGS is not stale" test below, so an
 * unmapped or renamed control is visible rather than silently skipped.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const toPosix = (p: string) => p.replace(/\\/g, '/');
const WEB_SRC = toPosix(fileURLToPath(new URL('.', import.meta.url)));
const API_SRC = toPosix(fileURLToPath(new URL('../../api/src', import.meta.url)));

const APP_TSX = readFileSync(`${WEB_SRC}/App.tsx`, 'utf8');

/** Read a `const NAME = <int>;` declaration out of a source file's text. */
function readIntConst(src: string, name: string, file: string): number {
  const m = new RegExp(`const ${name}\\s*=\\s*(\\d+)`).exec(src);
  if (!m) throw new Error(`${name} definition not found in ${file} — update this guard`);
  return Number(m[1]);
}

/** Read a route's own `requireRole(<int>)` — either a literal integer, or a
 *  named local constant declared in the SAME file (e.g. changeover.ts's own
 *  `const PDAS_WRITE_RANK = 2;`, deliberately kept separate from app.ts's). */
function readRouteRank(routeFile: string, routeNeedle: string): number {
  const src = readFileSync(routeFile, 'utf8');
  const idx = src.indexOf(routeNeedle);
  if (idx === -1) {
    throw new Error(`route text "${routeNeedle}" not found in ${routeFile} — update PAIRINGS`);
  }
  // requireRole( ... ) appears right after the route path on the same
  // app.METHOD(...) call in every route file this test reads — search the
  // 200 chars following the route text, which comfortably spans the method
  // call and its requireRole argument without reaching the next route.
  const window = src.slice(idx, idx + 200);
  const literal = /requireRole\((\d+)\)/.exec(window);
  if (literal) return Number(literal[1]);
  const named = /requireRole\((\w+)\)/.exec(window);
  if (!named) throw new Error(`no requireRole(...) found near "${routeNeedle}" in ${routeFile}`);
  return readIntConst(src, named[1]!, routeFile);
}

/**
 * The explicit control -> route table. `clientConst` is read from App.tsx
 * (or, for the one server-derived control, N/A — see the note on
 * PRODUCT_WRITE_STATUS below). `routeFile`/`routeNeedle` locate the
 * server's own gate; `routeNeedle` must be unique enough in the file to
 * find the right app.METHOD(...) call (checked by the "not stale" test).
 */
interface Pairing {
  control: string;
  clientConstName: 'EXPORT_RANK' | 'ENGINEER_RANK';
  routeFile: string;
  routeNeedle: string;
  evidence: string;
}

const PAIRINGS: Pairing[] = [
  {
    control: "Readings' Export control (Readings.tsx:248, W.report.exportCsv)",
    clientConstName: 'EXPORT_RANK',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.get('/api/events/export'",
    evidence: 'the register CSV/XLSX download the 3 Sep 2026 defect was about; App.tsx passes canExport={rank >= EXPORT_RANK} to ReadingsScreen.',
  },
  {
    control: "Line's Change control / Product › Running's write control (product/Running.tsx ChangeForm, setCurrentProduct)",
    clientConstName: 'ENGINEER_RANK',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/current-product'",
    evidence: 'App.tsx passes canWrite={rank >= ENGINEER_RANK} to both LineScreen and ProductScreen; both forms POST to /api/current-product (api.ts setCurrentProduct).',
  },
  {
    control: "Sacks' record-movement control (Sacks.tsx canRecord, MovementForm)",
    clientConstName: 'ENGINEER_RANK',
    routeFile: `${API_SRC}/routes/sacks.ts`,
    routeNeedle: "app.post('/api/sacks/movements'",
    evidence: 'App.tsx passes canRecord={rank >= ENGINEER_RANK} to SacksScreen (roadmap Phase 7, IFL Q43 answer).',
  },
  {
    control: "Rejects' name-a-code control (Rejects.tsx canName) and ReasonSheet's inline rename",
    clientConstName: 'ENGINEER_RANK',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.put('/api/reject-codes/:id'",
    evidence: 'App.tsx passes canName={rank >= ENGINEER_RANK} to both RejectsScreen and ReasonSheet; both call setRejectLabel/api.ts:316, PUT /api/reject-codes/:id.',
  },
  {
    control: 'StationSheet’s calibration-adjustment form (canAdjust, recordAdjustment)',
    clientConstName: 'ENGINEER_RANK',
    routeFile: `${API_SRC}/app.ts`,
    routeNeedle: "app.post('/api/calibration/adjustments'",
    evidence: 'App.tsx passes canAdjust={rank >= ENGINEER_RANK} to StationSheet; the form POSTs via recordAdjustment (api.ts:1794).',
  },
  {
    control: "Product › Changeover's Execute control (Changeover.tsx canExecute, changeoverExecute)",
    clientConstName: 'ENGINEER_RANK',
    routeFile: `${API_SRC}/routes/changeover.ts`,
    routeNeedle: "app.post('/api/changeover/execute'",
    evidence:
      'App.tsx passes the SAME canWrite={rank >= ENGINEER_RANK} into ProductScreen -> ChangeoverTab (Product.tsx:97); the route is ' +
      'gated by its OWN local PDAS_WRITE_RANK constant (changeover.ts:61), deliberately not app.ts’s, per that file’s own comment ' +
      'at changeover.ts:58-59 ("Matches app.ts’s own PDAS_WRITE_RANK"). This pairing checks that the two constants, declared in ' +
      'two different files on purpose, have not drifted apart.',
  },
];

describe('client write-gate vs server write-gate crosscheck (the GET-only gap app.rbac.test.ts leaves)', () => {
  it('sanity: EXPORT_RANK and ENGINEER_RANK are still defined in App.tsx (canary on the scan itself)', () => {
    expect(readIntConst(APP_TSX, 'EXPORT_RANK', 'App.tsx')).toBeGreaterThan(0);
    expect(readIntConst(APP_TSX, 'ENGINEER_RANK', 'App.tsx')).toBeGreaterThan(0);
  });

  it('PAIRINGS route text is not stale — every routeNeedle still appears in its routeFile', () => {
    const stale: string[] = [];
    for (const p of PAIRINGS) {
      const src = readFileSync(p.routeFile, 'utf8');
      if (!src.includes(p.routeNeedle)) stale.push(`${p.control}: "${p.routeNeedle}" not found in ${p.routeFile}`);
    }
    expect(stale, `PAIRINGS entries whose route text no longer matches (fix or remove them): ${stale.join('; ')}`).toEqual([]);
  });

  for (const p of PAIRINGS) {
    it(`${p.control}: client ${p.clientConstName} equals the server's requireRole on its route`, () => {
      const clientRank = readIntConst(APP_TSX, p.clientConstName, 'App.tsx');
      const serverRank = readRouteRank(p.routeFile, p.routeNeedle);
      expect(
        serverRank,
        `${p.control} — client gates at ${p.clientConstName}=${clientRank}, but the server's requireRole on ` +
          `${p.routeNeedle} (${p.routeFile}) is ${serverRank}. ${p.evidence} A disagreement here means the control ` +
          `either offers an action the server will 403 (client too loose — the exact shape of the 3 Sep 2026 Export ` +
          `defect) or hides one the server would actually allow (client too tight).`,
      ).toBe(clientRank);
    });
  }
});
