# ENGINEERING RED-TEAM AUDIT — SMS — 24 September 2026

**Scope:** destructive, read-only QA of the SMS application (`sms/`), branch
`floor-first-rework`, HEAD `a9b85b5`. Goal: try to prove the software does *not*
work. No defects were fixed; no code, data, `.env`, credentials, PDAS write, or
schema was changed. Verified against the **local dev copies only**
(`DATA_TP1U2`, `DATA_TP1U2_SEP07`, `DATA_TP1U2_SIM`, `PDAS_TP1U2_SEP07`, `sms`)
on `.\SQLEXPRESS` — never IFL's live server.

**Method:** four parallel read-only workers (data/generations/KPIs; API/security/
recovery/perf; screens/filters/UX/reachability; reports/exports/logic/source-load),
each doing two passes, then the orchestrator independently re-verified every
CRITICAL/HIGH claim against the code and the databases before recording it here.
Baseline before testing: `npx vitest run` → **181 files, 1815 passed, 4 skipped**;
`npm run typecheck` clean.

**Data reality (so nothing below is misjudged):** `.env` points the source at
`DATA_TP1U2_SIM`, where a plant simulator (epochs 13–16, deliberately labelled
`provenance='ifl_copy'`) overlaps the real September data. Only epoch 1 (July real,
2026-06-22→07-10) and epochs 9–12 (September real, 2026-08-05→09-07) are trusted as
correctness evidence. The 10 Jul→5 Aug gap is real; clock-fault rows exist; a healthy
line runs ~18 min behind on acquisition lag; plant timestamps and app-written
instants are 5 h apart. The SIM overlap does not occur at IFL (real generations are
sequential there) — where a finding depends on it, that is stated.

---

## Executive summary

- **Tests performed:** ~110 across the five layers (28 data/KPI, 39 API + ~238
  individual attack calls, 29 screen/filter/reachability, 16+ report/logic/source-load),
  plus independent orchestrator re-verification of every top finding.
- **Findings:** **13** (excluding items that only re-confirm the known-open RT-/D-
  register). By severity as this report grades them:
  - **CRITICAL: 1** — unauthenticated single-request denial of service (RT24-01).
  - **HIGH: 4** — cross-generation reject-rate pooling (RT24-02); generation caveat
    dropped from exports (RT24-03); time-versioned rules read as "newest" incl. at
    transform time (RT24-04); PDAS write-verification permanently self-disabling under
    the real go-live role (RT24-05, CRITICAL the moment PDAS writes are enabled).
  - **MEDIUM: 4** — calendar-invalid dates return 200-empty (RT24-06); Line headline
    reject rate reverts to the double-count formula if one field is absent (RT24-07);
    no stale/dead distinction per machine (RT24-08); a phantom production row inside
    the "no data" gap (RT24-09).
  - **LOW: 4** — dead `/api/report` ignores dates (RT24-10); `X-Powered-By`
    (RT24-11); `health.degradedReason` null while degraded (RT24-12); missing-field
    fuzz coverage absent on ~13 screens (RT24-13). Plus two backend-unreachable notes.
- **Areas that survived hard testing** (verified, not assumed): server-side RBAC
  (all 27 rank gates hold), SQL-injection/XSS resistance, the honesty of `/api/live`
  (idle/stale, simulator never shown as real), the core KPI arithmetic (reject rate,
  station means, calibration slope, SPC limits, downtime, shift-across-midnight — all
  reproduced exactly from source), and the sync-worker's source-DB load (every read is
  an `id`-keyed clustered-index seek; no date-range scan exists in the reader).

**One-line verdict:** the *numbers the app computes* are trustworthy where we could
recompute them; the *ways the app can be knocked over or quietly misled* are where the
real defects sit — one of which (RT24-01) will take the whole application down from any
machine on the plant LAN with a single unauthenticated request, and should be fixed
before anything else.

---

## System health matrix

| Area | Status | Evidence |
|---|---|---|
| Data integrity | **Mostly sound; 1 anomaly** | Epoch-1 count+SUM(id) exact (142,511); zero merge-key duplicates; outliers kept+flagged. One phantom row in the gap (RT24-09). |
| Generation selection | **Sound at read; 1 pooling bug** | `resolveGenerationScope` pins the right generation; `/api/live` excludes SIM correctly. But `production.ts` calls `getUnmatchedRejects` unscoped (RT24-02). |
| KPI calculations | **PASS (recomputed)** | Reject % 3.396% vs 3.40%; 14/14 station means exact; calibration + SPC + downtime + shift-midnight all exact vs source SQL. |
| API | **Mostly robust; date-input gaps** | Zod validation strict; injection rejected; but calendar-invalid dates → 200-empty (RT24-06) and a dead route ignores dates (RT24-10). |
| Frontend | **Well-defended; 1 real gap** | 47/48 `?? 0` guarded; global 401→login sound; one unguarded field on Line (RT24-07). |
| Reports | **Correct totals; caveat lost on export** | 50 report×period builds ran; exports drop the generation-scope disclosure (RT24-03). |
| Exports (CSV/XLSX) | **Cell typing correct; disclosure missing** | XLSX numbers/percent/date/bool typed correctly; no generation note (RT24-03). |
| Performance | **Adequate on dev; unbounded** | spc 33d = 1.26 s / 469 KB. No server-side row cap (known RT-014). |
| Security | **1 CRITICAL** | Malformed cookie kills the process, unauthenticated (RT24-01). Headers, CSRF posture, no leaks otherwise. |
| RBAC | **PASS** | All 27 write/export/admin gates 403 one rank below; no fallthrough. Below-rank *live* sessions still untested (no non-admin account). |
| Recovery | **Partly tested** | `/api/live` honest when stale. DB-down/partial paths reasoned + spot-tested; the cookie crash (RT24-01) is the sharpest recovery failure. |
| UX | **Good, with gaps** | State words (nothing here / not caught up / stopped) correctly decoupled. Machine-level stale/dead not distinguished (RT24-08). |
| Error handling | **Mostly honest; one silent-empty class** | Failures named on most screens; calendar-invalid dates render as a real zero (RT24-06). |
| Backend/frontend integration | **1 unreachable param, 1 dead endpoint** | `/api/production` station/product never sent; `getCalibrationRules` no caller (both LOW, latter already tracked). |
| PDAS write path (dormant) | **Design defect before go-live** | Echo-mismatch CRITICAL detector self-disables under the real EXECUTE-only role (RT24-05). |

---

## CRITICAL findings

### RT24-01 — Unauthenticated denial of service: a malformed session cookie crashes the whole API process

- **Severity:** CRITICAL. **Verified by the orchestrator, reproduced twice** (it is
  also what killed the running `:4000` instance mid-audit at 11:35:40Z).
- **Component:** `api/src/auth.ts::authMiddleware` → `userFromSession` (binds the
  cookie as `mssql.UniqueIdentifier`). No `unhandledRejection` handler in
  `api/src/index.ts`.
- **Repro:** send one request to any route with a non-GUID session cookie:
  `curl -H "Cookie: sms_session=not-a-guid" http://<host>:4000/api/range`. No login
  needed. The process logs a `RequestError: Validation failed for parameter 'id'.
  Invalid GUID` (`EPARAM`) and exits with code 1; the port stops listening.
- **Reproduction here:** on a scratch instance (`:4300`): health `200`, then one
  malformed-cookie request → connection refused on every subsequent call; three
  `Invalid GUID` stacks in the log; `netstat` shows the port gone. The live `:4000`
  preview log shows the identical stack at 11:35:40Z.
- **Data/generation:** independent of data — it fails before any query runs.
- **Expected:** a bad cookie is treated as "not authenticated" → 401, process stays up.
- **Actual:** tedious rejects the non-GUID parameter during validation; the rejection
  is unhandled inside the async middleware (Express 4 does not catch async-middleware
  rejections), so Node terminates the process.
- **Why it matters:** anyone on the plant intranet — no account, no session — can take
  SMS down repeatedly and trivially with a single request, including from a browser.
  For a floor/wall monitoring app this is an availability CRITICAL.
- **Evidence:** preview log stack at 11:35:40Z; scratch `:4300` reproduction; the bind
  at `auth.ts:258` (`.input('id', mssql.UniqueIdentifier, id)`); no `process.on
  ('unhandledRejection')` anywhere in `api/src` (grep).
- **Existing test coverage:** none — `auth.test.ts` exercises `requireRole` against
  synthetic req/res, never drives a malformed cookie through the real middleware+pool.
- **Why tests missed it:** the crash needs the real `mssql` parameter validator in the
  loop; unit tests stub the pool, so the throw never happens.
- **Recommended fix (not implemented):** validate the cookie against a GUID shape
  before the query and treat a non-match as anonymous; wrap the `userFromSession` call
  in `authMiddleware` in try/catch → anonymous on error; and add a process-level
  `unhandledRejection`/`uncaughtException` guard so no single request can exit the
  process. All three, not one.

---

## HIGH findings

### RT24-02 — Reject rate is pooled across source generations in the busiest query path

- **Severity:** HIGH. **Verified** at `api/src/services/production.ts:442-446`.
- **Component:** `production.ts::getProduction` builds `unmatchedFilters` without a
  `scope` field, so `getUnmatchedRejects` (`rejects.ts:202`) runs UNSCOPED across every
  generation in the date range. Consumed by `report.ts::toReportLine` and thus the
  daily/product/sack reports, the management summary, and `/api/report`.
- **Contrast:** `weightStations.ts:853` and `rejects.ts:434` both attach
  `scope: resolvedScope` before the same call (the "WS-A1, 23 Sep 2026" fix). This one
  call site was missed.
- **Repro / evidence:**
  - Boundary window 2026-07-05→08-10 (spans the July/September real boundary): the
    daily report's `byDay` shows phantom rows 2026-07-06, 07-07, 07-09 with 0 cones and
    0% — days from the *excluded* July generation, their unmatched rejects folded into
    the September total's denominator. Pooled unmatched = 19 vs correctly-scoped 11.
  - Overlap window 2026-08-21→09-07: `report.ts` = **5.93%**, `weightStations.ts` =
    **6.27%** for the identical line and period (SIM-amplified, but the boundary case
    above shows the bug fires between two *real* generations too).
- **Why it matters:** the reject rate is the headline KPI on the reports and the
  management summary — the exact "three screens agree" claim of the 23 Sep remediation.
  Any report crossing a generation boundary (the 5 Aug rebuild, and every future PDAS
  rebuild) silently distorts it and prints orphaned zero-days as if the coverage were
  complete. At IFL this bites at every cutover/rebuild, not only on the SIM copy.
- **Existing test coverage:** `rejectRateThreeWayAgreement.test.ts` /
  `reportRejectRateAgreement.test.ts` assert agreement on engineered fixtures; none
  drives `getReport`/`getProduction` across two live generations with a real
  `resolveGenerationScope` in the loop.
- **Why tests missed it:** they check agreement between service outputs, not each
  service's own generation scoping; `report.ts` stays self-consistent (always uses
  `production.ts`'s consistently-wrong count) and only diverges from the others when the
  pooled counts move the rounded percentage.
- **Recommended fix:** add `scope` to `unmatchedFilters` (one line, mirroring WS-A1);
  add a test that drives `getProduction` across a two-generation fixture with unmatched
  rejects in both.

### RT24-03 — The generation-scope disclosure is in the report JSON but dropped from CSV and XLSX exports

- **Severity:** HIGH.
- **Component:** `reports/{daily,coneWeight,product,sack,station,summary}.ts` `*Csv()`
  functions and the XLSX built from them (`xlsx.ts`/`reportSheets`). None reference
  `generationNote`/`spansGenerations`/`otherGenerationExcluded`.
- **Repro:** boundary window daily report — JSON carries `generationNote:
  { spansGenerations:true, otherGenerationExcluded:43057 }` (57% of the true combined
  total excluded); the CSV/XLSX for the same report state none of it.
- **Why it matters:** the exported workbook is the artefact that reaches IFL management,
  gets printed and archived, and outlives the session. A manager exporting a report
  across a rebuild boundary gets a file that looks complete and silently omits over half
  the period's real data — the same silent-zero class the codebase fixed on-screen but
  not on export.
- **Existing test coverage:** none asserts the disclosure survives to CSV/XLSX.
- **Recommended fix:** emit a generation/scope row into each report's CSV table and the
  XLSX header sheet from the `generationNote` already on the payload (plumbing only).

### RT24-04 — Time-versioned rule tables are read as "whatever is newest," including when baking canonical rows

- **Severity:** HIGH (worker rated CRITICAL; moderated because it needs a config edit,
  and — for the stored-corruption half — a rebuild; IFL's shift boundaries are fixed at
  06/14/22 per Q8 and the weight basis is set once, so everyday exposure is low. It
  remains a real, latent violation of the app's own stated §8 rule.)
- **Component:** `plausibility_rule`, `weight_rule`, `shift_rule` are all read
  `SELECT TOP 1 … ORDER BY effective_from DESC` with **no time parameter**, at 9+ read
  sites (`admin.ts:259/263/287`, `live.ts:351`, `production.ts:469`, `sacks.ts:146`,
  `sackStock.ts:501`, `weights.ts:210`, `envelope.ts:52/53`) **and at transform time**
  (`sync-worker/src/transform/runTransform.ts:236` for `shift_rule`, `dq.ts:256` for
  `plausibility_rule`). All confirmed by grep.
- **Repro:** `sms.plausibility_rule` holds 3 real versions (edited to 1900–2100 g then
  reverted to 1500–2100 g on 2026-08-19), proving the edit path is live. Every reader
  takes the newest regardless of the period being judged.
- **Why it matters:** editing a rule today retroactively changes months-old reports'
  mean/SD, outlier exclusion and weight basis; and a rebuild/backfill after a
  `shift_rule` edit bakes today's rule into the **stored** `shift_code`/`shift_date` of
  historical rows (write-time corruption, not just a read-time skew). The architecture
  claims to have eliminated exactly this — it is done correctly for
  `product_limit_version` (guarded by `targets.guard.test.ts`) but never extended to
  these three siblings.
- **Existing test coverage:** the 5 tests stubbing `plausibility_rule` each return a
  single static row, so none can tell "time-versioned" from "always current."
- **Recommended fix:** thread the reading's own timestamp through these reads the way
  `productLimits.ts` resolves "as of"; resolve the rule per row (or refuse/flag a
  rebuild spanning a rule change) in the sync worker; add a two-version test per table.

### RT24-05 — The PDAS write-verification (echo-mismatch) CRITICAL detector permanently self-disables under the real go-live role

- **Severity:** HIGH now (feature is OFF: `PDAS_WRITE_ENABLED=false`, never run end to
  end). **Becomes CRITICAL the instant PDAS writes are enabled against the real
  EXECUTE-only role** — it defeats the exact go-live gate CLAUDE.md names.
- **Component:** `api/src/services/pdasWrite.ts` — `addBlend`, `addCount`,
  `addTubeType`, `createPallet`, `setPalletActive`, `updateProductLimits`. Commit
  `bdbb0eb` (24 Sep 2026). **Verified** by reading the diff and the code.
- **Mechanism:** each write does a post-commit echo-back read. On read failure the code
  now sets `observed = p.after` (assume PDAS stored what was requested), records
  `outcome: 'ok'`, and raises `pdas_write_readback_failed` at **WARNING** — not the
  pre-existing `pdas_write_echo_mismatch` at **CRITICAL**. The commit message itself
  states the plant's EXECUTE-only role *has no SELECT on the PDAS tables*, so the
  echo-back read fails on **every** write, forever, under that role — the CRITICAL
  mismatch comparison can then never run.
- **Why it matters:** from go-live, every PDAS write's sidecar mirror — including
  `updateProductLimits`, which sets the setpoint tolerance that gates every subsequent
  cone's pass/fail — is populated by assumption, never verification, with the detector
  for a genuine PDAS-side divergence permanently unreachable and replaced by a per-write
  WARNING that (firing every time) reads as noise. Nothing ever says "we have never
  actually verified a single PDAS write." B1/B2 correctly stopped mislabelling a
  committed write as failed, but replaced it with "never signal that we stopped
  checking."
- **Existing test coverage:** the commit's 6 tests prove the narrow per-call behaviour;
  none asserts the aggregate/lifetime consequence under the EXECUTE-only role.
- **Recommended fix:** escalate a *structural* readback failure (N consecutive for a
  role/table) to a single standing CRITICAL "verification disabled for this role"
  finding; or grant the writer role a narrow SELECT so the echo-back can run; and surface
  it on Health/Operations before `PDAS_WRITE_ENABLED` is ever flipped true.

---

## MEDIUM findings

### RT24-06 — Calendar-invalid dates return `200` with empty/zero data instead of `400`
`api/src/app.ts` date validation is regex-shape only (`YYYY-MM-DD`), so `2026-02-30`
passes the regex, `new Date()` rolls it over, and `/api/production`, `/api/rejects`,
`/api/weights`, `/api/spc`, `/api/reject-spc`, `/api/weight-stations` all return a
valid-looking empty payload — indistinguishable from a genuinely empty period.
(`/api/events`, `/api/downtime` correctly 400.) Distinct from known RT-016, which is the
month>12 *crash* case; this is the non-crashing, silent-empty sibling and touches more
routes. **Fix:** round-trip the parsed date back to `YYYY-MM-DD` and reject on mismatch,
in the shared helper.

### RT24-07 — Line's headline reject rate silently reverts to the double-count formula if one field is absent
`web/src/screens/Line.tsx::periodFigures` (~line 534): `unmatchedRejects =
r?.unmatchedRejects ?? rejected`, with no unreadable flag. If `/api/production` ever
returns a well-formed row missing just that key (stale cache pre-WS-B1, a proxy dropping
an unknown field, a future refactor), the tile reverts to `rejected/(cones+rejected)` —
the pre-fix double-count — with no caveat (reproduced in jsdom: 5.0%→4.8%). `missingField.
fuzz.test.tsx` fuzzes only `cones` on Line. **Fix:** add `fieldMissing(r,'unmatchedRejects')`
to `rateUnreadable` + a regression test.

### RT24-08 — No stale-vs-dead distinction at the machine level
`api/src/services/machinesRunning.ts::getMachinesRunning`: a station has only
`quiet:true|false` on a hard 2-hour cliff and retains no last-seen time. A machine quiet
for 3 minutes renders identically to one dead for weeks — on a screen meant to say which
machines need attention. (The line-level `live.ts` has a full state enum; the
machine-level view does not.) **Fix:** retain each station's all-time last reading so a
quiet row can say "last seen N ago," or document `quiet` as "not running now" only.

### RT24-09 — A phantom production row sits inside the documented "no data" gap
`generation.ts::resolveGenerationScope` keys on `shift_date` with no check that a row is
temporally plausible for its generation. `DATA_TP1U2_SEP07.pack1_TP1U2` id=4130
(MaterialId 17, retired) has `ProductionDate` 2026-07-12 but `source_epoch` 9, so a
window over 2026-07-12 — inside the 10 Jul→5 Aug gap — returns 1 in-range cone with
`spansGenerations=false`, nothing flagged. **Verified by the orchestrator.** The
clock-fault filter is a Y2K floor only and cannot catch a well-formed 2026 date in the
wrong week. **Fix:** per-generation temporal-plausibility check routing outliers to DQ.

---

## LOW findings

- **RT24-10** — Legacy `/api/report` silently ignores `from`/`to` unless `period=custom`
  is passed; it has **no UI caller** (`getReport` is unreferenced). Dead route, but a
  script hitting it is silently misled. Fix: delete it, or align its `period` default
  with `routes/reports.ts`.
- **RT24-11** — `X-Powered-By: Express` present (framework fingerprinting); every other
  security header is set deliberately. Fix: `app.disable('x-powered-by')`.
- **RT24-12** — `/api/health` returns `status:"degraded"` with `degradedReason:null`
  though `acquisition.kind:"stale"` and `backup.warning` are in the same payload. Fix:
  populate the field from the signals that already set the status.
- **RT24-13** — Missing-field fuzz coverage exists for Line/Weight/Rejects/Sacks and two
  report sections, but not for 6 of 8 report types, all 4 Product tabs, Health's two
  blocks, or the 4 sheets. RT24-07 was found in a *better*-covered screen; a sibling
  could hide in an un-fuzzed one. Fix: extend the existing `stripFields` harness.
- **Backend-unreachable notes (LOW):** `/api/production` accepts `station`/`product` but
  no UI call site sends them; `getCalibrationRules` has no screen caller (already tracked
  in `api.callers.test.ts`'s allow-list).

---

## Survived tests (verified, not assumed)

These were attacked and held up — reported because "what works" is part of the brief:

- **Server-side RBAC.** All 27 write/export/admin routes return `403` exactly one rank
  below their requirement, gate before handler, no fallthrough — including
  `/api/changeover/execute` and the products/PDAS routes.
- **Injection.** SQLi/XSS strings in date and id params are rejected by zod (`400`) or
  the tedious GUID validator (`400`); parameterised queries throughout; no query
  anomaly, no reflected value, no stack/SQL in any error body across ~250 responses.
- **`/api/live` honesty.** With no sync running (data ~17 days stale), it reports
  `health:stale`, `state:idle` — never "running" — and pins the generation to September
  real with the simulator explicitly excluded (`otherGenerationExcluded`,
  `newerElsewhereSimulator:true`). **The simulator is never presented as real plant
  data**, the single most important thing this test environment exists to check.
- **KPI arithmetic (recomputed from source SQL, matched exactly):** reject rate 3.396%
  vs 3.40% claimed; 14/14 per-station cone-weight means; calibration grand+daily means;
  SPC p̄ 0.03397 and the UCL formula (hand-checked 0.04402); downtime for 2026-08-08
  (59 stoppages, 15,980 s, 81.5% availability) under the 120 s rule; shift assignment
  across midnight at all three boundaries (22:00 / midnight / 06:00) with no leakage.
- **Sync-worker source-DB load.** Every query the reader can issue is a catalogue lookup
  or an `id`-keyed clustered-index seek (the only index on any wide table). **No
  ProductionDate/date-range scan exists in the reader** — the specific risk hunted for
  is absent. Incremental cycle (500-row overlap): 8 logical reads. Full backfill of the
  132K-row table: 1,211 logical reads, <300 ms on this laptop (shape, not timing, is the
  evidence — this is not IFL's hardware).
- **Changeover duplicate-triple blocker** correctly refuses retire-then-recreate of the
  same blend/count/tube regardless of active flag (matches the vendor's own check).
- **XLSX cell typing** — numbers, percentages (as fractions), dates (serials), booleans
  all correctly typed; text never coerced into numeric cells.
- **Frontend failure handling** — global 401→login; 47/48 `?? 0` guarded by an explicit
  unreadable check; no `|| 0` anywhere; `.length===0`→"none" gated behind loading/error;
  Report filters allow-listed per type on both client and server.

---

## Untested areas (explicit)

- **Live browser walk-through** — the Browser pane was never signed in (no credentials,
  and agents may not create accounts). All screen testing was jsdom component mounts and
  code reads. Desktop/mobile layout, live `fetch`-failure injection, and print/PDF render
  were not observed.
- **Below-rank RBAC live** — only an admin account exists; rank 1/2/3 gating rests on
  the 403 matrix and code inspection, never a real non-admin session.
- **PDAS writes end to end** — never run (correctly): `/api/changeover/execute` and all
  products/PDAS write routes tested only to the 403 gate; RT24-05 is a code-path finding.
- **Rebuild-triggered corruption for RT24-04** — `rebuild` is on the forbidden list;
  the transform-time claim is established from the call path, not observed in data.
- **PDF export pipeline** — needs a headless browser + render token; not executed.
- **Memory under sustained/concurrent load; sync-worker idempotency in practice** —
  reasoned from code, not soak-tested; no sync was run.
- **6 of 8 report types, all Product tabs, Health blocks, and the 4 sheets** — no
  missing-field fuzz coverage (RT24-13).
- **IFL production hardware/network/concurrency** — everything is `.\SQLEXPRESS` on one
  laptop; only query *shape* transfers, not milliseconds.

---

## Root causes (grouped)

1. **"Whatever is true now" instead of "true at the reading's time / for this row's
   generation."** RT24-04 (rules read as newest) and RT24-09 (row placed by identity,
   not temporal plausibility) are the same class — one the codebase fixed for product
   limits and never extended. RT24-02 is the sibling at the generation layer (a query
   left unscoped). Fixing the general pattern (thread time/scope through every
   period-sensitive read; make the unscoped path unreachable) closes three findings.
2. **A caveat computed but not carried to every consumer.** RT24-03 (generation note in
   JSON, absent from exports) and RT24-07 (unmatchedRejects computed, unguarded on one
   render path) are both "fixed the computation, didn't guard/propagate to every
   consumer." RT24-13 is the testing-side of the same shape.
3. **Robustness of the request lifecycle.** RT24-01 (async middleware rejection exits the
   process) and RT24-06 (regex-only date validation) are both "an unexpected input isn't
   contained at the boundary." One is catastrophic, one is silent.
4. **Verification that quietly stops verifying.** RT24-05 stands alone but is the most
   dangerous shape for a write path: a safety check that becomes structurally unreachable
   under the exact condition it exists for, with no signal that it did.

---

## Recommended fix order (do not fix yet — this is priority only)

1. **RT24-01** (CRITICAL DoS) — smallest fix, largest exposure; blocks any deployment.
2. **RT24-05** — must be resolved *before* `PDAS_WRITE_ENABLED` is ever flipped true;
   until then it is latent, but it is the go-live gate.
3. **RT24-02** — wrong headline KPI across any generation boundary; one-line fix + test.
4. **RT24-04** — retroactive/at-rebuild rule application; correctness of historical
   reports and stored shift attribution.
5. **RT24-03** — exported reports omit the scope caveat (the artefact IFL keeps).
6. **RT24-06 / RT24-07 / RT24-08 / RT24-09** — silent-wrong-answer MEDIUMs.
7. **RT24-10 … RT24-13** and the reachability notes — LOW cleanup.

---

## Production readiness (statement, not a score)

- **What prevents production use now:** RT24-01 — the app can be taken down by any
  unauthenticated request on the LAN. This alone blocks go-live.
- **What can safely proceed:** the read-only analytics core — the KPI math, generation
  pinning for live state, RBAC, injection resistance and the sync-worker's source-DB
  load are all sound as verified. The read path is close.
- **What requires IFL validation:** the reject-code semantics, weight basis (Q4/Q5), KPI
  approval (Q33-37), the 10 Jul–5 Aug data, and a live read-only login/host (Q65-70) —
  unchanged from the standing list; nothing here resolves them.
- **What requires engineering work before go-live:** RT24-01 (must), then RT24-02 /
  RT24-04 / RT24-03, then the MEDIUMs. RT24-05 must be closed before PDAS writes are
  enabled, independently of the read app.
- **What requires live-site testing:** below-rank RBAC with real accounts; the print/PDF
  pipeline; source-DB load on IFL's actual server under concurrent load; and the
  behaviour of `/api/live` and the reject-rate scoping across a *real* sequential
  generation cutover (the SIM overlap approximates but does not equal it).

---

*Read-only audit. No production data modified, no defects fixed, no writes issued. Every
CRITICAL and HIGH finding was independently re-verified by the orchestrator against the
code and the local databases before being recorded here. Findings that only re-confirm
the existing RT-/D- register (RT-014/016/017/018/019/020, D-10) are not re-listed.*

---

## Addendum — live verification + fix-wave re-check (24 Sep 2026, later same day)

After the report above was written (audit baseline `a9b85b5`), the owner signed in for a
live browser pass and a fix wave landed (commits `8e8a188`…`b1f355b`, HEAD `b1f355b`,
"Record RT24 fix-wave dispositions"). The orchestrator re-verified every finding against
current code — some at runtime, some in source. **Suite on `b1f355b`: 198 files, 2035
passed, 4 skipped; typecheck clean** (was 1815 at baseline; the wave added ~220 tests,
including `auth.malformedCookie.test.ts` for RT24-01).

| ID | Report severity | Status on HEAD `b1f355b` | How verified |
|---|---|---|---|
| RT24-01 | CRITICAL | **FIXED** | Runtime: scratch API from current dist — malformed cookie → `401`, process stays up, 0 crashes. `GUID_RE` shape-check + try/catch in `authMiddleware` (cites RT24-01). *(No `unhandledRejection` handler added — the specific vector is closed; a broader guard is still absent.)* |
| RT24-02 | HIGH | **FIXED** | Source: `scope` now in `unmatchedFilters` (`production.ts:462`). Commit `8e8a188`. |
| RT24-03 | HIGH | **FIXED** (per disposition; not independently re-run) | `buildHeader` now takes `reportData`; commits `f60e04a`/`b077815`. |
| RT24-04 | HIGH | **FIXED** | Source: rule reads guarded `effective_from <= SYSUTCDATETIME()` and resolved per-reading (`1315d23`/`8f5c80c`). |
| RT24-05 | HIGH (CRITICAL-on-enable) | **FIXED** | Per disposition (`25b02bc`): `observed` goes NULL on a failed read-back (no false `p.after` claim), standing CRITICAL `pdas_write_unverified` via new `pdasPermissions.ts` probe, Health "Checked after writing" line. New CRITICAL path unobserved locally (probe reports `canReadBack:true`). |
| RT24-06 | MEDIUM | **FIXED** | Runtime: `2026-02-30` → `400 "not a real calendar date"` (`11ce30b`). |
| RT24-07 | MEDIUM | **FIXED** | Source: `unmatchedRejectsMissing` now feeds `rateUnreadable` (`Line.tsx:540/548`, "WS-B7"); `4e8513c`. |
| RT24-08 | ~~MEDIUM~~ | **WITHDRAWN — not a real defect** | Live: `/api/machines/running` and `machinesRunning.ts` already carry `lastSeenUtc` + a `running/quiet/stale/silent` `MachineState` (2 h / 24 h / 7-day). The live Line screen shows "for at least 2 h" vs "Not seen for over a week" per machine. The worker read only lines 139-239 and asserted structural absence of the exact machinery at lines 96-97/167/192; its "recommended fix" is what line 167 already does. Query cost under load not yet measured. |
| RT24-09 | MEDIUM | **FIXED by flagging** | Runtime: `/api/production` for `2026-07-12` still returns `cones:1` (the row is not dropped — consistent with "flag, never delete"), but a new `isolated_production_day` DQ check now flags source row 4130 (`edae627`). The period *total* still includes the phantom cone. |
| RT24-10..13 | LOW | **Open** (per disposition, by design/priority) | Not addressed this wave. |

**Net current state:** RT24-08 was never a defect (correction). Of the remaining 12, the
fix wave closes RT24-01 through RT24-07 and RT24-09 (RT24-09 by surfacing rather than
hiding the anomaly); RT24-10..13 (all LOW) remain open. The CRITICAL DoS is closed and
runtime-verified. RT24-05 must still be seen firing against a real EXECUTE-only role
before PDAS writes are trusted in production — the local probe can read back, so its new
CRITICAL path has not yet been observed to fire.

**Still genuinely unproven (unchanged):** below-rank RBAC with real non-admin accounts;
the PDF export pipeline end to end; source-DB load on IFL's real server under concurrent
load; and behaviour across a real *sequential* generation cutover (the SIM overlap
approximates but is not the same). The live browser walk-through of every screen at
desktop/mobile width was only partially done — the pane dropped its session after the API
restart and was not re-driven across all screens.

---

## Addendum 2 — follow-through, 25 Sep 2026

Every item this report and its addendum left open is now dispositioned, in `DEFECTS.md`
Part 8 (commits `b182297`…`39c2c37`).
- **RT24-10/11/12/13, RT-014:** closed by the 24 Sep evening pass (`DEFECTS.md` Part 7). The
  last RT24-13 gaps (Product tabs, SyncHealthBlock) are closed here, and closing them found a
  live false-"OK" health verdict (D-30, HIGH), now fixed.
- **RT-017, RT-018, RT-020:** fixed. **RT-019:** decided by evidence. Rules 2–8 stay withheld,
  because EWMA failed on real data at both granularities.
- **PDF pipeline:** proven end to end.
- **RT24-05 live firing and below-rank RBAC:** ready-to-run owner kits exist, but they have
  not been run. They need logins an agent may not create.
- **IFL-server load and a real sequential cutover:** still unprovable on the dev copy.
