# Independent verification — 23 September 2026

Verifier pass over the ~20 commits that landed today from eight parallel workers on
`floor-first-rework`. Nothing in this file was taken from a worker's own report; every
number below was re-measured in this pass. **Not committed, by instruction.**

Scope rules honoured: read-only against every database (`q.mjs`, which refuses any
non-SELECT); no `rebuild`, `cutover` or `epoch:*`; no login created, reset or guessed; no
file edited except this one; no `git stash`/`reset`/`checkout`/`commit`.

Validation windows: **epoch 1 / gen 1** (`DATA_TP1U2`, 22 Jun – 10 Jul) and **epoch 9 /
gen 3** (`DATA_TP1U2_SEP07`, 5 Aug – 20 Aug, and 5 Aug – 7 Sep where a claim names the full
generation). **Epoch 13 (gen 4, `DATA_TP1U2_SIM`) was never used as evidence.**

---

## 1. The three gates

| Gate | Result |
|---|---|
| `npm run typecheck` (5 workspaces) | **CLEAN**, no output |
| `npx vitest run` from `sms/` — **run A, 12:55** | **1597 passed / 4 skipped**, 155 files passed / 1 skipped, 18.2 s |
| `npm run build --workspace @sms/web` | **CLEAN** — 92 modules, `index-C7F6JDMj.js` 475.82 kB (134.04 kB gzip), 915 ms |
| `npx vitest run` — **run B, 13:10** | **1599 passed / 7 failed / 4 skipped**, 157 files |

**Run A is the real baseline.** It was taken while `git status` showed only the
pre-existing untracked `FRICTION-AUDIT.md` — i.e. against the committed tree at `fc27b60`.

**Run B's 7 failures are not regressions.** Between the two runs a still-active worker
wrote to the tree. `git status` at 13:10:

```
 M sms/api/src/services/coneState.ts        M sms/api/src/services/productAt.ts
 M sms/api/src/services/health.ts           M sms/api/src/services/productLimits.ts
 M sms/api/src/services/live.ts             M sms/sync-worker/src/seed/seedProducts.ts
 M sms/api/src/services/machinesRunning.ts
?? sms/db/migrations/040_product_limit_true_start.sql
?? FRICTION-AUDIT.md
```

Every failure attributes to one of those files, by file, not by guess:

| Failing file | Tests | Attributed to |
|---|---|---|
| `sync-worker/src/seed/seed.test.ts` | 4 | ` M seedProducts.ts` — new "PDAS record…" version note text |
| `api/src/services/health.test.ts` | 1 | ` M health.ts` — `acquisition` gained a third field |
| `api/src/routes/ops.test.ts` | 2 | ` M health.ts`, same third field |

No failure touches any file committed today. **The committed tree is green.**

**The known flake was NOT captured.** Three full runs in this pass; the only failures seen
are the seven above, all explained by the dirty tree. Nothing unexplained, so no test name
to record. The ~1-in-74 flake remains open and uncaptured.

### The API process

The running API (pid 22040, started **11:25:59**) predated eleven of today's commits and
was serving stale code. **I rebuilt and restarted it** — `npm run build` for `@sms/shared`
then `@sms/api`, then `node api/dist/index.js`. New pid **47036**, up 07:57:17 UTC,
`/api/health` → 200.

`api/dist` was already current with `api/src` before the rebuild (dist 12:50:32, newest
`api/src` file 12:49:50; the 12:53/12:54 commits only committed files written at ~12:45–12:49).
So the staleness was entirely in the *process*, not the build. **Every API number in this
report comes from the restarted process.** No browser number here was read from the stale one.

---

## 2. The ten headline claims

Measured through the rebuilt API via the signed-in browser session at
`http://localhost:5173`, and independently against SQL where the claim permits it.

| # | Claim | Verdict | What I measured |
|---|---|---|---|
| 1 | three reject rates agree: 3.40 % gen 3, 2.21 % gen 1 | **CONFIRMED at the service layer / REFUTED at the screen layer** | See below — the three services agree exactly; **two of the seven screens print 3.3 %** |
| 2 | X̄ violations 27.8 → 5.6 % (gen 3 full), 38.5 → 13.1 % (gen 1) | **CONFIRMED** (post-fix halves) | gen 3 full: 159/2837 = **5.6 %**. gen 1: 218/1660 = **13.1 %**. Both exact. Pre-fix halves not re-measurable without reverting `spc.ts` — not attempted |
| 3 | availability 96.2 % pooled → 44.1 % real, 53 stoppages restored, 1 Sep | **CONFIRMED, exactly, on all three figures** | See below |
| 4 | chart area Sacks 1.83 → 17.79 %, Line 5.61 → 18.63 % at 1366 | **CONFIRMED** (post-fix halves) | Sacks **18.14 %** (5 charts), Line **18.72 %** (2 charts), `svg` area ÷ `main` area at 1366×768, period 5–20 Aug |
| 5 | drilldown 13 → 5 requests; impossible headline gone | **CONFIRMED** | Exactly **5** fetches; screen underneath did not refetch; headline reads a sane "77,492 weighed, 39 rejected by the scale (0.1 %)" |
| 6 | `/api/spc` warm 4–8 ms; Weight time-to-usable 3,455 → 1,013 ms | **CONFIRMED** | `/api/spc` warm **8 ms, 8 ms** (`X-Cache: HIT`), cold 1,769 ms. Weight cold-cache time-to-usable **710 / 1598 / 702 ms**, mean **1,003 ms** |
| 7 | station `vs line` sign contradictions 7/14 → 0 (epoch 1) | **CONFIRMED, exactly** | Shipped `vsLineG`: **0/14**. Old `runVsLineG` basis, still in the payload: **7/14** — the claimed baseline reproduces |
| 8 | Weight page states one thing about the period's target | **CONFIRMED** | Every statement agrees; no contradiction. One presentational nit below |
| 9 | histograms: sacks 99.6 % in one bar → 47 bars; cones 75.8 % in three → 75 bars | **CONFIRMED, exactly, on epoch 1** | epoch 1: sacks **47 bars** (top bar 9.1 %), cones **75 bars** (top 3 = 28.1 %) |
| 10 | Wall says "Cannot tell whether the line is running" under a dead fetch | **CONFIRMED, on both failure paths** | See below |

### Claim 1, in full — this is the one that does not survive

The **services** agree, and they are arithmetically right. Independent SQL ground truth,
using the documented formula (rejects ÷ (cones + rejects with no matching `cone_event` on
`production_ts_utc_ms`, `hanger_num`)):

| Window | cones | rejects | unmatched | rate |
|---|---|---|---|---|
| epoch 1, full | 142,511 | 3,146 | 16 | 3146/142,527 = **2.2073 %** |
| epoch 9, `shift_date` 5–20 Aug | 77,492 | 2,633 | 27 | 2633/77,519 = **3.3966 %** |
| epoch 9, full generation | 132,552 | 6,090 | 116 | 6090/132,668 = **4.5904 %** |

Through the restarted API, all three services land on the same number:

| Window | `reject-spc` p̄ | `weight-stations` | `report` totals |
|---|---|---|---|
| gen 3, 5–20 Aug | 3.397 % | 3.4 % | 3.4 % |
| gen 1 | 2.206 % | 2.21 % | 2.21 % |

**That part is solid.** The claim as written is true of the three services.

**But the application still prints the old wrong number.** Same period, three screens:

- Line — `3.3% of everything weighed`
- Rejects — `3.3% of everything weighed`
- Report (Daily) — `3.4% of cones plus rejects`

Cause, found and reproduced — see interaction finding **I-1**. This is a **fourth**
re-derivation of the rule, on the client, carrying the exact pre-fix denominator. The
three-way guard cannot see it because it compares service outputs, not rendered strings.

### Claim 3, in full

`GET /api/downtime?date=2026-09-01`, restarted API: **availability 44.14 %**,
**stoppageCount 65**, `otherGenerationExcluded: 7470`.

The exclusion is real and I confirmed its size in SQL — 1 Sep holds **3,089** real cones
(epoch 9) and **7,470** simulator cones (epoch 13) interleaved across the same 24 hours.

The pooled counterfactual, computed directly in SQL over all 10,559 rows with the same
120 s threshold:

```
n = 10,559   span = 86,282.09 s   stoppages(>120s) = 12   down = 3,302.35 s
availability = (86,282.09 - 3,302.35) / 86,282.09 = 96.17 %
```

**96.2 % → 44.1 %. 65 − 12 = 53 stoppages restored.** All three figures land exactly.
(`DEFECTS.md` D-11's own table at line 315 records `pooled | 12 | 3,301 s | 96.2 %` —
independently reproduced here.)

### Claim 10, in full

Tested two distinct failure paths at `?s=wall`, `/api/live` rejected at the `window.fetch`
boundary:

1. **Degrade from healthy** — headline held at *"Cannot tell whether the line is running"*,
   and the footer gained *"Could not reach the server — showing the last numbers received."*
2. **Fail from first render** (SPA remount with the block already in place) — same headline,
   same footer sentence. It does not fall back to an all-clear.

Both reproduced. Note the on-screen clock keeps ticking locally while the server is
unreachable; it is labelled as unreachable, so this is an observation, not a defect.

---

## 3. Interaction findings — worst first

### I-1 — **HIGH. The reject-rate fix was made three times server-side and the client still prints the pre-fix number.**

Three services were made to agree today (`4f68945`, `ede05e9`, and this pass's
`weightStations.ts`), and `rejectRateThreeWayAgreement.test.ts` was written to stop a
fourth re-derivation. **The fourth re-derivation already exists, in the client, and the
guard cannot reach it.**

- `web/src/screens/Line.tsx:438-439`
  `cones + rejected > 0 ? Math.round((1000 * rejected) / (cones + rejected)) / 10 : 0`
- `web/src/screens/Rejects.tsx:271-273`
  `(100 * rejectCount.n) / (produced + rejectCount.n)`

Both divide by **produced + every reject** — the exact double-count the server-side fixes
removed. Measured, 5–20 Aug, viewport 1366×768:

| | denominator | value | rendered |
|---|---|---|---|
| client formula | 77,492 + 2,633 = **80,125** | 3.2861 % | **3.3 %** |
| server (`pBar`, already on the wire) | **77,519** | 3.3966 % | **3.4 %** |

Reproduced twice, on Line and on Rejects, against the restarted API. The correct value is
already in the payload each screen holds (`/api/reject-spc` returns `pBar = 0.03397` at the
top level and `totalInspected = 77519` per generation), so neither screen needs a new
request — both ignore it and recompute.

Two further consequences of the same root cause:

- **The denominator label disagrees too.** `words.ts:147` `ofEverything` → *"of everything
  weighed"*; `words.ts:1861` `ofInspected` → *"of cones plus rejects"*. The second is
  correct. The first is wrong twice over — the denominator is neither "everything weighed"
  (77,492) nor produced-plus-all-rejects (80,125), but inspected (77,519).
- `web/src/screens/Rejects.tsx:526` states in prose: *"Reject rate is rejected cones over
  everything weighed, rejected cones included."* That sentence **describes the pre-fix
  formula** and is now wrong relative to the three services.

Not in `DEFECTS.md` (D-1…D-14 checked; the register's newest entry is D-14). This is a new
defect, and it is the single most consequential thing found in this pass: today's
headline fix is not what a user sees.

### I-2 — **MEDIUM. "Record" names two different identifiers, one click apart.**

The Readings table and the sheet it opens both label a field **"Record"**
(`W.readings.record`, `words.ts:504`) and show **different numbers for the same reading**.

- `web/src/screens/Readings.tsx:507` — column header "Record"; the cell at `:533` renders
  `String(id)` where `id = r.event_id` (`:519`)
- `web/src/screens/ReadingSheet.tsx:242-243` — `<dt>Record</dt>` over `row.source_row_id`

Reproduced on 4 of 4 rows tried (table → sheet): 915454→77494, 915453→77493, 915452→77492,
915448→77488. Confirmed in the database — `cone_event_id` vs `source_row_id` on the same rows.

What makes this more than cosmetic is that `Readings.tsx:516-519` carries an explicit
comment choosing `event_id` *and rejecting* `source_row_id`, for a stated reason:

> "Not source_row_id: IFL reset their counter on 2026-08-05, so that number now names two
> different readings nine weeks apart."

The sheet then displays precisely that number, under precisely the label the table used for
the other one. A user who clicks row "915454" is shown "Record 77494" and cannot match it
back. The fix is a label, not a value — both identifiers are legitimate and worth showing.

### I-3 — **LOW. Weight prints the same 60-word target explanation twice.**

On `?s=weight` for 5–20 Aug, the full `targetOmittedReason` sentence ("No target is stated:
the earliest limits this system holds for that product were first recorded on 2026-09-11,
after this period ended on 2026-08-20…") appears **verbatim in the figure-tile subtitle**,
beside `median 1,951 g · No product target`, and again as the chart-block caption. The
substance is right and claim 8 stands; a ~60-word sentence inside a stat tile's subtitle is
a layout problem, not a correctness one.

### I-4 — **Guard audit: all ten guards are real; two have a named weakness.**

A dedicated audit re-read all ten and **empirically proved two** by reintroducing the exact
defect each exists to catch (`reliability.guard` GUARD 1C, and `targets.guard` check 3).
Both failed loudly with the right diagnosis; both files were restored byte-for-byte and the
tree confirmed clean afterwards.

**None is vacuous.** Nine of the ten carry a canary on their own scan, and every allow-list
is paired with a staleness test — so a stale entry turns the suite *red* rather than
quietly widening. `KNOWN_DEFECTS` in `reliability.guard.test.ts:137` is verified **empty**.
`ALLOW_LIST_ZERO` (GUARD 1C, `:456-469`) holds 2 entries; `ALLOW_LIST` (`:99-120`) holds 4,
and **has grown by one** on 22 Sep.

Two weaknesses, both of the hardcoded-enumeration kind:

- `web/src/rank.crosscheck.test.ts` — `PAIRINGS` is a 6-row table with **no completeness
  check**. It covers all 7 gated controls in `App.tsx` today, but by review, not by
  construction: an 8th gated control would not turn anything red.
- `web/src/targets.guard.test.ts:294-302` — the allow-list entry for
  `api/src/services/productAt.ts` **states a real open defect inside its own reason text**
  (`versionAt` falls back to the oldest version, so a June cone can be judged against a
  version stamped 2026-09-11). Honestly recorded, but it lives in a green test, so no run
  surfaces it.

Worth noting given I-1: these guards are strong *at the service layer*. Not one of them
looks at a rendered string, which is exactly the gap I-1 fell through.

### I-5 — `8673ffd`: message is wrong, **nothing was lost.** Confirmed, no action.

`0c07499` (12:16) carries the real "six identical write buttons / a report that dropped its
only row" work — `Catalogue.tsx`, `ProductLimitsBlock.tsx`, `Calibration.tsx`.
`8673ffd` (12:26) repeats that message but contains a different worker's staged files: the
new `api/src/services/generation.ts` (345 lines) plus generation-scoping in
`downtime/production/rejects/sacks/weights` and four test files.

Verified intact at HEAD, not inferred:

- `git cat-file -e HEAD:sms/api/src/services/generation.ts` → present, 345 lines
- `git diff 0c07499 HEAD` for all three of `0c07499`'s files → **0 lines each**

Both commits' content survives. History not rewritten, as instructed.

---

## 4. What I could not check, and why

- **No print-pipeline verification.** No real print dialog or PDF driver in this
  environment. I did not attempt to confirm the landscape `@page` rule, column clipping, or
  the `MachineProduct` print suppression. Every print claim in `CLAUDE.md` remains
  simulation-derived. The `machine-product` report does render **49 columns across 7 tables**
  on screen at 1366, consistent with the documented structural limit — but that is a
  screen measurement, not a print one.
- **The "before" half of claims 2, 4, 6 and 9 is not re-measurable** without reverting the
  fixes. I verified the post-fix values and, where the old basis was still present in the
  payload (claim 7's `runVsLineG`, claim 3's pooled query), reproduced the baseline too.
  For claims 2, 4, 6 and 9 I did not revert anything, so the improvement *ratios* are taken
  on trust; the current values are not.
- **Gate run B was taken against a dirty tree.** I could not get a second clean full-suite
  run because a worker was writing throughout. Run A is clean and is the number to quote.
- **Timings are dev-server numbers.** Claim 6's Weight figures were measured through Vite
  dev with React StrictMode double-invocation, via SPA route change. A production build will
  differ. The `/api/spc` warm figure is a server measurement and is not affected.
- **Nothing was verified against real plant data.** Every measurement is against the local
  `_SEP07` / `DATA_TP1U2` dev copies, as every prior pass has been.
- **The rank-1 viewer path has still never been exercised live.** `rank.matrix.test.tsx`
  proves rendering; no one has signed in as a viewer. I did not create an account, by rule.
- **The ~1-in-74 flake was not captured.** Three runs, no unexplained failure.
- **I did not audit the two live workers' in-flight files** (`shared.tsx`/`chart.tsx`, and
  `verify.ts`/`register.ts`/`sackStock.ts`/`productAt.ts`/`machineProducts.ts`) beyond
  attributing test failures to them. They were mid-edit; anything I found would have been
  stale before it was written down.
- **Browser evidence came from the Browser pane, not the user's Chrome** — the
  claude-in-chrome extension was unreachable. The pane carried the same signed-in session
  ("PA", rank 4), so the measurements stand, but I never exercised a second browser.

---

## 5. What a reader should and should not believe about this codebase today

**Believe:**

- The three gates. Typecheck clean, web build clean, **1597 passed / 4 skipped** on the
  committed tree.
- The arithmetic behind today's data fixes. Claims 3, 7 and 9 reproduced to the digit
  against independent SQL, and claim 1's *service* figures reproduced against raw
  `cone_event`/`reject_event` counts. The source-generation work is real and load-bearing —
  1 Sep genuinely holds 3,089 real cones under 7,470 simulator ones, and the pooled answer
  genuinely was 96.2 %.
- The guards. Ten of ten are real, two proven by defect reintroduction. The suite is not
  passing vacuously.
- Every screen and all ten report types render, at 1366×768, with real rows and no crash,
  no `NaN`, no `undefined`, nothing empty-without-explanation.
- `8673ffd` lost nothing.

**Do not believe:**

- **That the application shows the corrected reject rate.** It does not. Line and Rejects
  print **3.3 %** where the truth is **3.4 %**, because both recompute the rate on the
  client with the denominator the server spent three commits removing (I-1). Today's
  headline "three services agree" is true and is *not* the same statement as "the app is
  right".
- **That a guard passing means a user-visible fact is correct.** Every guard in this repo
  inspects services, source text or component trees. None reads a rendered number against
  its own API response. I-1 is exactly the shape that gap admits, and it shipped today
  under a green suite.
- **That anything here has been printed, seen by a real user, or run against plant data.**
  None of those has happened, in this pass or any before it.
- **That the run-B failures mean something broke.** They are one worker's uncommitted
  edits, attributed file-by-file above.

The honest summary: **nine of the ten claims survive re-measurement, several to the exact
digit, and the tenth survives only as far as the API boundary.** The work that landed today
is real and well-evidenced at the service layer. The defect it left behind is that the
screens were never re-checked against it.

---

## Addendum — the tree moved under this pass

Everything above was measured against **`fc27b60`**. Before this file was finished, a worker
committed **`c17c0cd`** ("A histogram x axis that measures something…"), and the working
tree had grown to 16 modified files plus three untracked ones
(`sms/db/migrations/040_product_limit_true_start.sql`, `sms/_tmp_runseed.mjs`, and this report).

`c17c0cd` touches `web/src/lib/words.ts`, `report/shared.tsx`, `report/ConeWeight.tsx`,
`report/Sack.tsx` and adds `histogram.axis.test.tsx` — **client-side histogram rendering
only**. Claim 9's bar counts are produced by `/api/weights` and are unaffected, so that
verdict stands. My walk of the `cone-weight` and `sack` report types predates this commit
and should be repeated by whoever next looks at them.

Nothing else in this report is affected: `Line.tsx` and `Rejects.tsx` (I-1),
`Readings.tsx`/`ReadingSheet.tsx` (I-2) and every service behind claims 1–3 and 5–8 are
untouched by `c17c0cd`. **I-1 in particular is still live at `c17c0cd`.**
