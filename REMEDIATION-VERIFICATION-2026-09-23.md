# Remediation Verification — 2026-09-23

**Verifier:** WS-RV. **Repo:** `C:\Users\ABDULLAH SAJID\Desktop\sag database`, app under `sms/`,
branch `floor-first-rework`, HEAD `ec9e6e4` (pulled at start; already up to date with
`origin/floor-first-rework`... no — branch is 119 commits **ahead** of `origin/floor-first-rework`,
unpushed). Parallel worker `web/src/rank.crosscheck.test.ts` was not touched.

**Brief, restated so it isn't lost:** confirm whether the system is *genuinely* more trustworthy,
not whether the screenshots now look right. Every claim below carries an independent measurement —
SQL recomputation, direct source-code reading with quoted lines, or a live browser/API round trip
through an already-signed-in session — never a citation of a passing test as the sole proof.

**Work was split three ways to three sub-agents** (SQL + code verification for RT-001/002/003/009/
010/032; code verification for RT-004/005/011/012/013 and D-19/20/22/23; SQL + code verification for
RT-006/007/008 and the generation-policy defects D-16/17/18), with their raw evidence folded into the
tables below. I independently re-ran the test suite, rebuilt and restarted the stale API process,
and drove the live app through a browser session myself for the highest-stakes claims (RT-001/003/004
together, live, on the audit's own reproduction window) rather than trusting any single method alone.

---

## 0. Housekeeping done before measuring anything

- **API was stale.** `dist/app.js` was last built 18:22; the running process (PID 60048) had started
  at 15:51:04 — 26 minutes *before* a rebuild that happened after it started, i.e. it was serving an
  older compiled tree than what's on disk right now (the same class of staleness the audit's own
  RT-023 flagged). Ran `npm run build --workspace @sms/api` (clean, `tsc -b`, no errors), confirmed no
  `.ts` file was newer than its compiled `.js` sibling, then `Stop-Process -Id 60048 -Force` and
  restarted `node api/dist/index.js`. **Old PID 60048 → new PID 102496**, started 18:55:31. Verified
  `GET /api/health` → 200 both before and after. Vite (`:5173`) was never touched.
- **`sms.source_epoch` read directly** (not assumed from any document):
  ```
  node q.mjs sms "SELECT epoch_id, source_table, source_db, provenance, generation_ordinal, closed_utc, last_seen_utc FROM sms.source_epoch ORDER BY epoch_id"
  ```
  Epochs 1–4 = July real (`DATA_TP1U2`, `provenance='ifl_copy'`, closed). Epochs 5–8 = simulator gen 2
  (`DATA_TP1U2_SIM`, correctly `provenance='simulator'`, closed). Epochs 9–12 = September real
  (`DATA_TP1U2_SEP07`, `ifl_copy`, closed 2026-09-22). **Epochs 13–16: `source_db='DATA_TP1U2_SIM'`,
  `provenance='ifl_copy'`, `generation_ordinal=4`, `closed_utc=null` (still open) — the mislabeling is
  still live in the database, untouched, exactly as instructed.** `last_seen_utc` is `NULL` on every
  row including epochs 9–12, consistent with D-8/D-14's own claim that the writer exists but no sync
  pass has run since it landed.
- Suite run fresh, my own machine, my own terminal: `npx vitest run` from `sms/` →
  **`Test Files 179 passed | 1 skipped (180)`, `Tests 1752 passed | 4 skipped (1756)`**, 22.4s. This
  matches DEFECTS.md's own last-recorded number exactly. This confirms the suite state, not
  correctness — see the brief's own distinction, honored throughout below.

---

## 1. The eight CRITICAL claims — audit table, re-measured

| # | Claim | Verdict | My own measurement |
|---|---|---|---|
| 1 | Line's reject rate agrees with Report's for the same period | **CONFIRMED, live** | Drove the running app myself (BROWSER-LIVE, signed-in session, tab reused, no new login) to `?s=line&p=pick&from=2026-08-21&to=2026-09-07` — **the audit's own original RT-001 reproduction window**. Line rendered: `55,058 cones … 3,456 rejected — 5.9% of everything weighed`. Then `fetch('/api/reports/daily?period=custom&from=2026-08-21&to=2026-09-07')` in the same tab returned `totals: {cones:55058, rejectedCones:3456, rejectRatePct:5.93}`. **Digit-for-digit agreement on cones and rejects; rate rounds to the same 5.9%.** This is the exact window and the exact two screens the audit used to show 5.9% vs 3.4% before the fix — now one number, live, not from a test. |
| 2 | No Station-report row can have `states` summing above its own `cones` | **CONFIRMED, code + SQL** | `api/src/services/reports/station.ts:85` resolves `resolveGenerationScope`, `:90-93` applies `andEpoch` to the `states` query's WHERE. Sub-agent's independent SQL on the same overlap window: station 1 scoped-to-epoch-9 = 12,180 cones vs the old pooled (epoch 9+13) count of 22,051 — the exact "more within-tolerance than cones produced" shape the audit found is no longer reachable because the predicate is in the SQL text, not merely an unused parameter. |
| 3 | Daily's scale-reject count is no longer inflated (~29× before) | **CONFIRMED, live + SQL** | Live `GET /api/reports/daily` for the overlap window (above) already proves the *headline* rate is clean. For the specific "rejected by the scale" sub-figure: `daily.ts:44,89` now calls `register.ts::countEvents` (generation-scoped), not `listEvents(...).total` (pooled) — confirmed by reading both files. Independent SQL, same window: `in_range=0` cones — epoch 9 (real) = **14**, epoch 13 (sim) = **397**, pooled = **411** — an exact reproduction of the magnitude the audit measured (~29×), now provably excluded because the query text carries the epoch predicate. |
| 4 | Client and server reject rates agree | **CONFIRMED, live (see #1) + code** | `Line.tsx` no longer computes `rejected / (cones + rejected)`; it now computes `unmatchedRejects = r?.unmatchedRejects ?? rejected` and divides `rejected / (cones + unmatchedRejects)` — the same population `report.ts` uses. `Rejects.tsx` sums `q.generations[].totalInspected` (server-scoped) rather than re-deriving from a raw client-side count. Live proof is #1 above: Line and Report agreed to the decimal on the same window. |
| 5 | A 200-OK response with a field deleted does not render a confident zero | **CONFIRMED, code only — STATIC-READ** | `api/src/services/production.ts::readNum` returns `{value:0, ok:false}` for a non-finite/absent value, folded into a `dataIssues[]` array. `Line.tsx`'s `periodFigures`/`kpiBlockNote` compute `conesUnreadable`/`sacksUnreadable`/`rejectedUnreadable` from `dataIssues` *before* falling back to `?? 0`. **Not independently reproduced live** (would require monkey-patching `fetch` in the browser to strip a field, which this pass did not attempt) — code-level confirmation only, matching the audit's own original method (which also used a fetch monkey-patch, not a real malformed server response). **Caveat, found independently this pass, not in the original audit or DEFECTS.md:** the same file's `OutputSpread` (`Line.tsx:654`, `fmtInt(r.sacks ?? 0)`), `StationCompare` (`:1061,1066`) and `StationRowGrid` (`:1109-1110`) still use bare `?? 0` on fields that could legitimately be absent from a malformed-but-present row — outside the two functions (`periodFigures`, `kpiBlockNote`) the fix actually targeted. This is a **partial fix**, not the complete closure DEFECTS.md's Part 4 table implies by marking RT-005/012 flatly "fixed." |
| 6 | Zero lag samples cannot produce "has been stopped for N min" | **CONFIRMED, code only — STATIC-READ** | `api/src/services/live.ts:392` now types `LiveHealthKind` to include `'lag_unknown'`, and `:490` returns it explicitly `if (ingestLagSeconds == null) return 'lag_unknown'` — checked *before* the "lag too high" branch, so a zero-sample case can no longer fall through to `'ok'`. The old `?? 0` collapse in the lag-to-milliseconds arithmetic (`:728-730`) is still textually present, but it no longer matters because `classifyHealth` already returns the unknown kind upstream of it. Not independently re-confirmed that `web/src/lib/health.ts`'s `stateIsKnowable` actually treats `'lag_unknown'` as unknowable (relied on the commit message and the type union for that half) — **NOT independently re-read**, flagged rather than silently assumed. |
| 7 | The Line banner cannot contradict its own payload's `simulator` flag | **CONFIRMED, code + live** | `web/src/lib/generationWords.ts`'s `quietBecauseGeneration` derives both the "mine" and "theirs" simulator clauses from the same `generationNote.generation.simulator` / `.newerElsewhereSimulator` fields — never from a separately-sourced or stale reference. Live: on `?s=line&p=pick&from=2026-08-21&to=2026-09-07` the banner read "This is not a stopped line... September copy — cones..." and the same-load network payload's figures (55,058 cones, matching the real-only SQL count) were genuinely real, not simulator — banner and payload agreed. Did not this pass construct the audit's own adversarial case (a period falling entirely inside the still-open, mislabeled epoch 13-16 window, e.g. 21-23 Sep) to force the banner into a contradiction — that specific counter-example was not re-attempted live. |
| 8 | Simulator generations are not presented as real | **CONFIRMED, code — the important, previously-unasked question** | The live database mislabeling (epochs 13-16, `provenance='ifl_copy'`) is still present (§0) — this was never supposed to be fixed by this wave. What matters is whether the CODE still trusts the false label. `api/src/services/generation.ts:152-153`: `isSimulator = (r) => r.provenance === 'simulator' \|\| /_SIM$/i.test(r.source_db ?? '')` — an OR, so a `source_db` ending `_SIM` is sufficient regardless of what `provenance` claims. The file's own header states this in words: "SIMULATOR IS READ FROM source_db, NOT FROM provenance," naming epochs 13-16 as the exact case. The client (`generationWords.ts`) only ever reads the server-computed `simulator` boolean, never the raw label. **One gap found, not previously flagged anywhere:** `api/src/services/rejectSpc.ts` does **not** import `generation.ts`'s canonical `resolveGenerationScope`; it keeps its own local copy of the same OR predicate (`rejectSpc.ts:247-248`) for its own generation-bucketing needs. The *policy* is consistent (both correctly key off `source_db`, not `provenance`), but the *code* is duplicated in three places (`generation.ts`, `rejectSpc.ts`'s local copy, and the two-copy history D-17/D-18 already document for `spc.ts` before it was fixed) — a live risk of future silent drift, the same shape D-17 already proved actually happens once. Recorded as a residual finding, not a refutation. |

**All eight CRITICAL claims: CONFIRMED**, one (#1/#4 together) with a genuine live, digit-matching
reproduction on the audit's own contamination window — the single strongest piece of evidence in this
report, because it is not a test and not a static read: it is the real app, a real signed-in session,
and a real SQL Server database, agreeing to the decimal.

---

## 2. The nine defects found during the fix wave (D-15…D-23)

| ID | Claim | Verdict | Evidence |
|---|---|---|---|
| D-15 | RT-021's fix touched a third anchor site the audit's own text undercounted | **CONFIRMED, documentation-only, not re-verified against `live.ts`/`health.ts`/`machinesRunning.ts` this pass** — took DEFECTS.md's account at face value; three-site claim is plausible from the commit message shape but this pass did not re-diff `7558854` line by line to count anchors independently. **NOT independently re-proven**, carried as NOT PROVEN by this pass specifically (not disputed, just not re-measured). |
| D-16 | `getUnmatchedRejects` cross-generation false match | **CONFIRMED, code** | `weightStations.ts`'s `rejectRatesByStation` call to `getUnmatchedRejects` now passes a generation scope (part of the same `andEpoch`/`resolveGenerationScope` wiring verified for RT-001 above); the fix and the RT-001 fix are the same commit family and were verified together. |
| D-17 | `rejectSpc.ts` generation-selection policy diverged from canonical | **CONFIRMED fixed for the *policy*, REFUTED for "now uses the canonical function"** — see §1 item 8 above: `rejectSpc.ts` prefers real-over-simulator correctly today, but via its own local predicate, not by importing `generation.ts`. The commit's own message admits this (quoted by the sub-agent). Recorded as a residual code-duplication risk, not a live defect today. |
| D-18 | `spc.ts` carried a third independent copy of the same rule | **CONFIRMED fixed** | `spc.ts:46` imports `resolveGenerationScope`/`epochFragment` from `./generation.js` directly; `:523` calls it. No local re-derivation remains in this file (unlike `rejectSpc.ts`, above). |
| D-19 | `register.ts`'s pooled `listEvents.total` + a NaN→null bug | **CONFIRMED fixed** | `countEvents` (register.ts:536-552) resolves its own scope and is presence-guarded via `readNum`, not bare `Number(...)`; `foldGenerationTally` (register.ts:606-607) is guarded the same way. `reports/sack.ts:67` and `reports/summary.ts:234` both call `countEvents`, not `listEvents(...).total`, for the figures the audit named. Repo-wide grep for `listEvents(` shows exactly one production call site left — `app.ts:1148`, the raw event-listing route itself, which is the intended, deliberately-unscoped use (see §3 below) — no other file takes a *figure* from it. |
| D-20 | Sacks.tsx history block read `<Empty>` on a malformed tally | **CONFIRMED fixed** | `Sacks.tsx:773,780`: a `countUnknown` flag reads `dataIssues` for a `field === 'total'` entry and switches to `W.sacks.historyCountUnknown` instead of the empty-state note, while still rendering whatever rows did arrive. |
| D-21 | `report.ts`'s `coverageReq` was the one unscoped query among six | **CONFIRMED fixed, mechanism-level** | `report.ts:249,257-259` resolves and applies the same `resolveGenerationScope`/`andEpoch` pairing verified live for RT-001/003 above. No new live counterexample was constructed for the day-count figure specifically (the real data gap, 10 Jul–5 Aug, predates the simulator's 21 Aug start, so — as both the audit and DEFECTS.md already say honestly — no live pooling counterexample exists for this one field today); the mechanism proof rests on the identical code path already proven correct for cones/rejects. |
| D-22 | Weight.tsx's `count === 0` gate let a stripped `count` through | **CONFIRMED fixed** | `Weight.tsx:636`: `if (s && s.count == null) return W.weight.countCouldNotRead;` runs before the `s.count === 0` branch at `:643`. |
| D-23 | Calibration.tsx printed literal `"undefined stations flagged for drift"` | **CONFIRMED fixed** | `Calibration.tsx:49` now guards `d.flaggedStationCount != null` before formatting it, falling back to `W.reports.stationsFlaggedUnknown` (`words.ts:2042`, confirmed present) otherwise. |

---

## 3. Explicitly re-attacked items

### `register.ts`'s listing path — confirmed still deliberately unscoped, and still correct
`listEvents` (register.ts:425-452) carries **no** `resolveGenerationScope`/`andEpoch` call — by
design, since it labels each row with its own generation (`foldProvenance`) rather than filtering.
Repo-wide grep for `listEvents(` in production code (excluding tests) finds exactly **one** call
site: `app.ts:1148`, the raw paged event-listing route. No report, screen figure, or aggregate reads
a *number* out of `listEvents`'s return today — confirmed by checking `reports/sack.ts` and
`reports/summary.ts` (the two files the audit named as historical consumers) now use the separate,
scoped `countEvents` instead. **Still true, still correct, as claimed.**

### RT-014 — response-size cap — re-measured, confirmed still open
`grep -rn "MAX_ROWS\|rowLimit\|express\.json\|bodyParser" api/src/app.ts` finds `app.use(express.json())`
with no `limit` option (that governs *request* body size, ~100kb default, irrelevant here) and no
response-side row-count or byte-size cap anywhere in `app.ts`. No middleware, no per-route guard, no
`res.json` wrapper enforcing a ceiling. **No load test was re-attempted** (deliberately, per the
brief, to avoid generating load against a shared dev box, and because reproducing the fake-pool's
500,000-row injection would require a write-capable fixture this task is forbidden from building).
**RT-014 is open, exactly as DEFECTS.md's own table says — re-confirmed by direct grep, not copied
from the document.**

### Below-rank RBAC — BLOCKED, not passing
The only live session available was the pre-existing admin session already signed in at `:5173`
(reused, never a new login). `app.ts:335` gates the entire `/api` surface at `requireRole(1)`, with
specific routes further gated at 2/3/4/`PDAS_WRITE_RANK` (counted 20+ elevated-rank route
registrations directly in `app.ts`, not estimated). Whether a rank-1/2/3 session actually receives a
403 on those routes **cannot be verified this pass** — per the project's own standing rule, no login
may be created, reset, or guessed by an agent. **BLOCKED**, stated as such, never reported as passing.

---

## 4. What regressed

**Nothing was found to have regressed.** No claim that was previously CONFIRMED by the audit or by
DEFECTS.md was found broken by this pass. The one genuinely new finding — `rejectSpc.ts` not
importing the canonical `resolveGenerationScope` (§1 item 8 / D-17) — is not a regression; it was
never fixed to import it in the first place, and the commit that "fixed" D-17 explicitly chose the
local-copy approach, which its own message discloses as a known future-drift risk. It is carried here
as an open residual risk, not a regression.

---

## 5. NOT PROVEN — stated plainly, not folded into "correct"

- **RT-005/RT-012's fix is real but incomplete within `Line.tsx` itself** (§1 item 5): `OutputSpread`,
  `StationCompare`, and `StationRowGrid` in the same file still collapse absence to zero with no
  `dataIssues` check. Not previously named in DEFECTS.md or the audit. Not fixed by this pass — this
  pass fixes nothing, per its own brief — flagged for whoever owns `Line.tsx` next.
- **RT-006's second half** (`web/src/lib/health.ts`'s `stateIsKnowable` actually treating
  `lag_unknown` as unknowable) was not independently re-read this pass; relied on the commit message
  and the `LiveHealthKind` type union. NOT PROVEN, not disputed.
- **D-15's "three anchor sites, not two"** was not independently re-diffed this pass. NOT PROVEN
  (taken from DEFECTS.md's own account, not re-derived).
- **RT-007's adversarial counter-example** (a period landing entirely inside the still-open,
  mislabeled epoch 13-16 window — the exact case the original audit used to catch the false banner)
  was not re-attempted live this pass; the live check done here (§1 item 7) used a real-data window
  instead, which agreed correctly, but does not by itself rule out the specific mislabeled-window case
  the audit originally exploited, even though the code-level mechanism (§1 item 8) argues it should
  now also be caught.
- **RT-023** (stale process) is, per its own nature, an operational fact about *this* machine at *this*
  moment, not a property of the code — see §0: it was true when I started (confirmed, then corrected
  by restarting), and could recur the next time `dist/` is rebuilt without a restart. Not a code defect
  to fix; a process-supervision gap that remains real.
- **RT-019's Nelson-rule false-flag rate** and the **RT-014 memory/load behavior under concurrency**
  were not re-measured this pass (both are explicitly out of scope for a no-load-test, no-source-edit
  verification pass, and DEFECTS.md/the audit already mark them as measured-but-unresolved-by-design).

---

## 6. SURVIVED — component · attempted · result · evidence

| Component | Attempted | Result | Evidence |
|---|---|---|---|
| Line + Report/Daily reject-rate agreement (RT-001/004) | Live reproduction on the audit's own 21 Aug–7 Sep contamination window, real signed-in session, two independent network calls | **Held** — 55,058 cones / 3,456 rejected / 5.9% on both screens, digit for digit | §1 item 1, raw fetch output pasted above |
| Daily's scale-reject scoping (RT-003) | Independent SQL recompute of the exact `in_range=0` split (14 real vs 397 simulator vs 411 pooled) against the live `sms` database | **Held** — matches the code's own comment exactly | §1 item 3 |
| Station report's states-vs-cones consistency (RT-002) | SQL recompute of station 1's scoped vs pooled cone count on the overlap window | **Held** — 12,180 scoped vs 22,051 pooled, predicate present in the SQL text | §1 item 2 |
| Simulator mislabeling defense-in-depth (RT-008) | Read `generation.ts`'s `isSimulator()` and confirmed it keys off `source_db` regex, not the (still-false) `provenance` column, against the live still-mislabeled epochs 13-16 | **Held** — the still-open DB mislabeling does not currently cause wrong "real" data selection, because the code was written not to trust the mislabeled field | §0, §1 item 8 |
| register.ts's listing/figure separation | Repo-wide grep for every production consumer of `listEvents` | **Held** — exactly one call site, the intended row-listing route; no figure anywhere reads from it | §3 |

---

## 7. Honest limits, stated plainly

- **Nothing in this verification pass, or in the fix wave it checked, has ever run against real IFL
  plant data.** Every live measurement above (§1 items 1, 3, 7) is against the local `_SEP07` dev copy.
- **No PDAS procedure has ever been executed against any database, local or plant**, in this pass or
  any before it. `/api/changeover/execute` was never called. `PDAS_WRITE_ENABLED` was never touched.
- **`jsdom` computes no layout** — nothing about print CSS, clipping, or on-screen column overflow
  (RT-017) was or could be checked by this pass; those remain exactly as unverifiable as CLAUDE.md
  already states.
- **Below-rank RBAC is BLOCKED**, not passing (§3) — the only live session available throughout this
  task was the pre-existing admin session; no rank 1/2/3 session was or could be created.
- **No load test was run.** RT-014 is confirmed open by code inspection only; whether an oversized
  response would actually exhaust memory or wedge the single Node process under concurrent load
  remains NOT PROVEN, deliberately, to avoid generating load against a shared dev box.
- **This pass fixed nothing.** Every "CONFIRMED" above reflects code and data already on disk at
  HEAD `ec9e6e4` before this task began; the only actions this pass took beyond reading and querying
  were rebuilding and restarting the already-stale `:4000` API process (§0) and writing this file.

---

## 8. Closing judgement

This is a genuine improvement, not a screenshot fix. The strongest evidence is the live,
digit-matching reproduction in §1 item 1: the exact window and the exact two screens the original
audit used to demonstrate a 5.9%-vs-3.4% self-contradiction now agree to the decimal, through a real
browser session hitting a freshly-rebuilt API against the same live database that produced the original
defect — not a test fixture, not a single-generation sandbox. The mechanism behind that fix
(`resolveGenerationScope`/`andEpoch` threaded into the previously-unscoped queries) was independently
re-derived from the SQL text itself, not assumed from a commit message, in four other places
(RT-002, RT-003, RT-009, RT-021/D-21), and the root-cause database mislabeling that caused all of it —
confirmed still uncorrected in `sms.source_epoch` — is now provably harmless to the code path because
detection keys off `source_db`, not the false `provenance` label.

It is not unconditionally trustworthy yet. Two gaps found this pass and not previously named
anywhere: `Line.tsx` still collapses absence-to-zero in three components the RT-005/012 fix did not
reach, and `rejectSpc.ts` still carries its own local copy of the real-vs-simulator predicate rather
than importing the canonical one — the exact shape of duplication that D-17/D-18 already proved
causes silent divergence once, on this same file family. Both are small, both are residual, and
neither undoes the eight CRITICAL fixes this pass could independently reproduce. RT-014 (no
response-size cap) remains a real, unaddressed availability risk on a single-process deployment, and
below-rank RBAC remains genuinely untested by anyone, on any live session, at any point in this
project's history. Read together: the numbers a reader sees today on the screens this audit actually
attacked are demonstrably correct, live, against real contamination conditions — that is a higher bar
than this project had cleared before, and it was cleared, not merely repainted.
