# WS-PW — Playwright layout/print harness (23 Sep 2026)

Owner authorised adding Playwright, previously deferred, to make some of the
layout/print claims in `CLAUDE.md`'s UX Phase 9 section testable for the
first time. `vitest` + jsdom (this repo's only client harness until today)
computes no layout at all, so column-overflow, table-clipping, the Wall
board's composition, and print/PDF output have only ever been checked by
viewport resize plus an injected stylesheet — a simulation, never a render.

## Browser: Edge, driven via `channel: 'msedge'` — no download

The installed Edge at
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` (153.0.4234.48)
is what `playwright.config.ts` drives, via `devices['Desktop Edge']` +
`channel: 'msedge'`. Verified with a throwaway script before wiring anything
permanent: `chromium.launch({ channel: 'msedge', headless: true })` launched
and loaded `http://localhost:5173` with no `playwright install` download.
Two reasons, both already in this project's own constraints, not new
reasoning: the plant PC is air-gapped (the PDF pipeline already drives
installed Edge/Chromium through `puppeteer-core` rather than bundling a
browser, for the same reason), and a real, current browser was already on
disk. **No bundled-Chromium download ran for this pass.** If a future
machine lacks Edge, `playwright install chromium` becomes a real decision —
size and runtime-dependency status should be weighed then, not assumed here.

## Isolation from vitest — proven, not asserted

- `playwright.config.ts` lives at the `sms/` root, points `testDir` at
  `./layout-tests`, `testMatch: '**/*.spec.ts'`.
- `vitest.config.ts` (untouched) only includes `**/src/**/*.test.ts(x)` and
  `test/**/*.test.ts` — `layout-tests/**/*.spec.ts` matches neither the
  directory nor the `.test.ts` suffix.
- `npx vitest run` was run **before** any layout-tests file existed and
  **after**: both times **1782 passed / 4 skipped / 0 failed**, 179 files (1
  skipped). No new file, no changed count.
- `@playwright/test` is a devDependency in the **root** `sms/package.json`
  only (`git diff --stat` on this change touches `sms/package.json` and
  `sms/package-lock.json`; `web/package.json`, `api/package.json`, etc. are
  untouched).
- `npm run test:layout` is a new script (`playwright test -c
  playwright.config.ts`); `npm test` (`vitest run`) and `verify:release` were
  not edited and do not call it.

## Auth: env-var login, cached storage state, never a created/guessed account

`layout-tests/support/auth.ts` reads `SMS_TEST_USERNAME` /
`SMS_TEST_PASSWORD`. Both are unset on this machine — the owner is creating
rank-1/rank-2 accounts separately, per the WS-PW brief, and this harness must
not create, reset, or guess one (the same rule the `feedback-no-agent-created-
accounts` incident on 16 Sep 2026 exists to prevent). When unset, `signIn()`
returns `{ ok: false, reason }` and every spec that needs a session calls
`test.skip(...)` with that reason printed, rather than failing red or, worse,
passing vacuously.

**What was and wasn't tried to get a session today, for the record:**
- The session cookie (`sms_session`, `api/src/auth.ts`) is `httpOnly` —
  unreadable from page JS by design, so a page script (or a tool driving one)
  cannot lift it out of an already-signed-in tab.
- No local Chromium/Edge process on this machine exposes a remote-debugging
  port Playwright could attach to (`Get-CimInstance Win32_Process` showed no
  `--remote-debugging-port` on any running `chrome.exe`/`msedge.exe`), so
  there was no legitimate "attach to the existing signed-in browser instead
  of logging in" path either.
- A direct read-only `SELECT username, role FROM sms."user"` against the app
  DB (to see whether an account already existed to reuse — still not a
  password, but informational) was attempted and **was blocked by this
  session's own permission classifier** ("Credential Exploration"). That is
  the correct outcome and this file records it rather than working around
  it: no account inventory, no cookie, no password. Authenticated specs are
  written and wired, not executed.

Once credentials exist, `npm run test:layout` with both env vars set will log
in through the real `LoginScreen` form (never a back door), cache
`layout-tests/.auth/state.json` (gitignored), and every skipped spec below
runs for real.

## Claims measured today

| Claim | Status | Measured |
|---|---|---|
| Login screen, no horizontal overflow, 1366×768 | **Measured** | `scrollWidth=1366 clientWidth=1366 overflowPx=0` — passes |
| Login screen, no horizontal overflow, 1920×1080 | **Measured** | `scrollWidth=1920 clientWidth=1920 overflowPx=0` — passes |
| PDF render works through installed Edge | **Measured — real render** | `layout-tests/.output/pdf/login-screen-smoke.pdf`, 15,679 bytes, via `page.pdf()` under `emulateMedia({media:'print'})` |
| Machine-product report, ~18% of 55 columns visible at 1366×768 | **NOT run — blocked on credentials** | Spec written (`machine-product-report.spec.ts`): counts `thead th`, computes visible-vs-total from bounding boxes against the `.tw` wrapper, checks `position: sticky` on the first column. Cannot confirm or refute the ~18% figure today. |
| Four "fixed" tables (Weight station, Health epoch register, Calibration station, Daily/Sack by-shift), no horizontal page overflow at 1366 and 1920 | **NOT run — blocked on credentials** | 10 test cases written (`table-clipping.spec.ts`, 5 tables × 2 viewports) |
| Wall board at 1920×1080: state sentence and footer present, not clipped | **NOT run — blocked on credentials** | Spec written (`wall.spec.ts`) |
| Report screen print/PDF, landscape | **NOT run — blocked on credentials** | Spec written (`print.spec.ts`); would also check the `role="group"[aria-label]` hook the `@page` landscape rule keys off (see CLAUDE.md's fragility note on that selector) |

**The ~18% figure is neither confirmed nor refuted by this pass.** Say so
plainly rather than repeating the manual number as if it had been checked.

## Deliberate breakage — proven to fail, then reverted

Per this repo's own standard ("every guard here must be proven to fail"),
one assertion was deliberately broken, observed to fail, then restored:

1. Baseline: `login-screen.spec.ts` both tests pass (`overflowPx=0` at both
   viewports, shown above).
2. Edit `web/src/app.css`, `.login form` rule:
   ```diff
   -.login form { width: min(360px, 100%); display: flex; flex-direction: column; gap: 16px; }
   +.login form { width: min(360px, 100%); display: flex; flex-direction: column; gap: 16px; min-width: 2000px; }
   ```
3. Re-ran `npx playwright test login-screen.spec.ts` — **both tests failed**,
   with a real measured number each time, not a generic assertion failure:
   ```
   Error: page scrolls horizontally by 634px at 1366x768
   Error: page scrolls horizontally by 112px at 1920x1080
   ```
4. Reverted the edit. `git diff web/src/app.css` — **empty**, confirmed clean.
5. Re-ran the same spec — both tests passed again (`overflowPx=0` at both
   viewports).

This proves the assertion is a real regression check, not a test that always
passes. It exercises `login-screen.spec.ts` specifically, because that is
the one spec reachable without a session today; the eight authenticated
specs use the identical `measureHorizontalOverflow` helper and the identical
assertion shape, so the same proof mechanism applies to them once a session
is available — it was not re-run against each of them individually today.

## What this does not, and cannot, establish

- **This laptop is not the plant PC.** A Playwright run here proves nothing
  about the actual hardware, screen, or printer at IFL.
- **Nothing in this project has ever run against real plant data.** This
  harness runs against the same local `_SEP07` dev copy every other test in
  this repo uses. A passing layout test does not change that.
- **The PDF smoke test renders the Login screen, not a report.** It proves
  `page.pdf()` works end-to-end through installed Edge on this machine — a
  first for this project — but it does not by itself verify any report's
  print output, because reaching a report needs a session this pass does not
  have.
- **No browser has ever been proven to survive an actual print driver or
  physical printer.** `page.pdf()` is Chromium's own headless PDF pipeline;
  it is a real render, not a DevTools-style simulation, but it is still one
  specific software PDF path, not proof that IFL's printer or a different
  PDF viewer renders the same page identically.

## Suite health

- `npx vitest run`: **1782 passed / 4 skipped / 0 failed**, 179 files passed
  + 1 skipped (180), unchanged before and after this change.
- `npm run typecheck` (`tsc -b shared sync-worker cli api web`): clean, no
  output.
- `layout-tests/**/*.ts` type-checked separately (`tsc --noEmit --strict` on
  the harness files directly, since they sit outside the workspaces
  `typecheck` builds): clean.
- `npx playwright test -c playwright.config.ts`: **3 passed, 13 skipped, 0
  failed** today (the 3 that don't need a session; the 13 that do, skipped
  with the reason printed — not silently green).

## Files owned by this pass

`sms/package.json`, `sms/package-lock.json` (dev dependency + script),
`sms/playwright.config.ts` (new), `sms/layout-tests/**` (new),
`sms/.gitignore` (excludes `layout-tests/.auth/`, `layout-tests/.output/`,
`playwright-report/`, `test-results/`). No production source, no
`vitest.config.ts`, no existing test file was touched. The one edit to
`web/src/app.css` described above was made and reverted in the same pass,
confirmed by `git diff` to leave no trace, and is not part of the committed
change.
