# Engineering Red-Team Audit — 2026-09-23

Repo: `C:\Users\ABDULLAH SAJID\Desktop\sag database`, app under `sms/`, branch
`floor-first-rework` @ `3370886`. Assembled by W4 from twelve finished
workers' evidence files (`00`–`12` in the shared scratchpad). **W4 fixed
nothing, discovered nothing new, and wrote only this document.** Every
statement below traces to an evidence file; where two workers disagreed, both
are printed, and the disagreement is marked UNRESOLVED rather than resolved
by assembly-time judgment.

Findings are renumbered into one ID space, `RT-001…`. Each entry keeps its
originating worker's own ID (e.g. "01.F1", "05.F1", "08.item2") so evidence
stays traceable to the file that proved it.

---

## 1. Executive summary

SMS's statistics engines, RBAC boundary, DB-failure handling, and export
pipeline are genuinely strong where they were tested — 77/77 unauthenticated
probes correct, SQL injection inert everywhere tried, five DB-startup failure
modes all fail clean, a real historical ingestion interruption recovered with
zero duplicate rows, and both XLSX and PDF export were run against the live
server for the first time in this project's history and both produced
structurally valid files. None of that is in question.

What is in question is whether the numbers the app currently shows a reader
can be trusted, and the answer today is **no, not on the screens that matter
most**. The root cause is a single environment fact this audit found on its
first pass and never stopped finding downstream consequences of: **`.env`'s
`IFL_DB_NAME_DATA` currently points the sync worker at `DATA_TP1U2_SIM` (the
plant simulator), and the resulting sidecar rows were registered under
`provenance='ifl_copy'`** — the label a genuine IFL data copy gets — instead
of `'simulator'`. That mislabeled, currently-open generation (epochs 13–16)
sits inside the live `sms` sidecar today, and at least six report/analytics
services query the canonical event tables with no generation predicate at
all, silently blending real plant readings with synthetic simulator readings.
The consequences were proven live, on screen, not just in the API: the same
line, same period, shows a 5.9% reject rate on one report and 3.4% on
another; a Station-report row claims 22,023 cones were "within tolerance" on
a station that produced 12,180 cones total; a scale-reject figure is
inflated roughly 29× over its true value; and — the single worst finding of
this audit — the Line screen's own provenance disclosure banner tells the
reader "these figures are real September-copy data, simulator readings
excluded" on a page whose own API response states, in a field the banner
never reads, that the figures shown are 100% simulator output.

A second, independent defect class was proven live: a 200-OK response with a
field silently missing from an otherwise-present row renders as a confident
"0 cones / 0 sacks / 0 kg / 0 rejected" directly above a chart, on the same
screen, at the same moment, reading 77,492 cones — and separately, the
same shape exists **server-side**, where a malformed production row is
silently coerced to zero with no `degradedReason` anywhere in the response, a
code path Phase 7's reliability programme (client-side only) never reached.

A third: the statistical calibration advisory — the feature CLAUDE.md
repeatedly states replaces "AI" in this product — was measured, not
inferred, to flag 78.6% of stations and 12.7% of station-days on a real
19-day window, using the identical Nelson rule set the Weight screen already
suppresses for being too noisy on a comparable series; and its "days to
limit" projection can print "18 days" from a 5-point fit or "136 days" from a
slope smaller than another station's own day-to-day noise, with no
confidence interval anywhere.

Three of the four contradictions named in this audit's brief were resolved
by direct evidence; one — the exact route count — remains genuinely
UNRESOLVED, with three different numbers (58/67/78) each traceable to a
different counting method, none of which reproduces either of the others.

This audit itself caused exactly one database write (a self-identifying
audit-artefact row, `sms.product_change.change_id=3`), is missing all
below-rank (viewer/engineer/manager) live authenticated testing (structurally
blocked, not merely undone), and rests entirely on the local `_SEP07` dev
copy plus a mislabeled simulator generation — never on real plant hardware or
a real IFL production database. Nothing here should be read as "the system
is broken" or "the system is correct" in a blanket sense: specific components
survived specific, named attacks, and specific components failed specific,
named attacks, and both kinds of claim are listed below with their evidence.

---

## 2. Environment tested — and this audit's own limitations

- **Repo/branch/HEAD:** `C:\Users\ABDULLAH SAJID\Desktop\sag database`,
  `sms/`, branch `floor-first-rework`, commit `3370886` ("Add
  COMMISSIONING-GAPS.md"). 161 commits ahead of `origin/main`; 96 commits
  ahead of the last-pushed `origin/floor-first-rework` (a week stale). The
  branch is unpushed; CI has never run against it (per `00-environment.md`).
- **Data generations live in the sidecar during this audit:** epochs 1–4
  (July `DATA_TP1U2` real copy, closed), 5–8 (simulator gen 2, tombstoned/
  purged), 9–12 (September `DATA_TP1U2_SEP07` real copy, closed), **13–16
  (currently OPEN, `source_db=DATA_TP1U2_SIM`, `provenance='ifl_copy'` —
  mislabeled simulator data, the root cause behind most CRITICAL findings
  below)**.
- **One database write occurred, caused by this audit, fully accounted:**
  `sms.product_change`, `change_id = 3`, `outcome: 'disabled'`,
  `reason: "security audit dry test - expect 503 DISABLED, no PDAS call"`,
  written by `changeover.ts :: executeChangeover`'s `recordDisabledAttempt`
  **after** the `PDAS_WRITE_ENABLED` flag check had already refused the
  write, as that refusal's own audit trail — not before the check, and not
  a bypass of it. No PDAS procedure was executed; that record is intact and
  correctly labelled (proc_name `CreateMaterial`, every PDAS-effect column
  `null`, `outcome: disabled`). **Reachable by a screen** — `GET
  /api/product-changes` / Product › History would render it, with the
  self-identifying `reason` text making it unlikely to be mistaken for a
  real changeover, but it should be flagged or filtered as a known audit
  artefact, dated 23 Sep 2026, before Product › History is next reviewed.
- **The `:4000` API was restarted once**, with the owner's authorisation,
  because the running process (PID 47036, started 12:57:17) predated its
  own already-rebuilt `dist/` (newest file 13:23:45) by 26 minutes — the
  process was serving stale-relative-to-disk code with no self-detection
  and no process supervisor watching it (see RT-023). Old PID 47036 → new
  PID 60048; the Vite dev server (`:5173`) and all sessions were left
  untouched.
- **Live confirmation of several findings was degraded by concurrent
  activity on a shared dev box.** Vite HMR full-reloads wiped an installed
  `window.fetch` monkey-patch mid-attack (05-over-claiming.md's F2 patch,
  twice); a URL's own routing/param scheme (`?s=line&p=...` → `?s=weight&
  period=...`) changed under an open session mid-task, meaning the app's
  own source was being edited and reloaded by something other than this
  audit while it ran. Findings degraded this way are explicitly labelled
  **STATIC-READ** in their originating file rather than presented as
  live-proven, and that labelling is preserved below. Separately, browser
  tab contention (three workers sharing a capped tab pool) meant the
  Product screen (all four tabs: Running/Changeover/Catalogue/History) was
  **never reached at all** by the over-claiming worker, and was only opened
  (never its execute path) by the frontend-consistency worker for one
  finding.
- **Below-rank RBAC could not be tested at all — this is BLOCKED, not
  passing.** The only live session available throughout this audit was
  `admin` (rank 4, the ceiling). Per the project's own standing
  no-agent-created-accounts rule, no rank 1 (viewer), rank 2 (engineer), or
  rank 3 session could be created or used. Every unauthenticated (rank 0)
  probe is real and complete (see Section 8); every below-rank-but-
  authenticated boundary (rank 1 hitting a rank 2+ route, rank 2 hitting a
  rank 4 route, etc.) rests entirely on the `app.rbac.test.ts`/
  `rank.matrix.test.tsx` harnesses against a faked pool, never on a live
  session. This gap is not new to this audit — CLAUDE.md's own Phase 8
  section already states the rank-1 UI path has never been exercised
  live — but this audit extends the same statement to ranks 2 and 3 as
  well, for the first time on record.
- **Recovery testing was structurally limited by the no-writes rule.**
  Several category-10 (failure/recovery) questions end as explicit "NOT
  PROVEN — requires a write this audit forbids" (e.g. `06-failure-
  recovery.md`'s N1: a login with insufficient grants but valid
  authentication cannot be constructed without provisioning a new scoped
  login, which is forbidden; N2: a genuine mid-flight kill of an
  authenticated slow request needs a real login).
- **No load test was run.** DBFAIL-001 (205 MB unbounded response) was
  proven at one request at a time; whether it would exhaust memory or wedge
  the single Node process under concurrent load is explicitly NOT PROVEN
  (`06-failure-recovery.md` N6), deliberately not attempted to avoid
  generating load against a shared dev box.
- **Every finding in this audit is against the local `_SEP07` dev copy and
  the currently-open (mislabeled) simulator generation.** Nothing here was
  measured against a real IFL production database, real plant hardware, or
  a real network path to the plant. `LIVE_ALLOW_AS_OF=true` (dev-only
  replay) is ON in this environment.

---

## 3. Test methodology

Work was distributed across twelve workers (W0 environment baseline; W1
group — data integrity, calculations, data quality, security; W2 group —
over-claiming, failure/recovery, API contracts, frontend consistency; W3
group — test coverage, analytics, operational edges, RFQ coverage) plus this
assembler (W4). Four environments were used throughout, and every finding
below is labelled with which one produced it:

- **SQL-READ-ONLY** — `node q.mjs <db> "SELECT ..."`, a tool that refuses
  (exit 3, no query sent) any statement matching
  `/\b(insert|update|delete|drop|truncate|alter|create|merge|exec|execute|grant|revoke|backup|restore)\b/i`.
  Every SQL statement across all twelve workers went through this gate or an
  equivalent read-only service-function call; the gate was never triggered
  because no write was ever attempted through it.
- **STATIC-READ** — source code inspection only, no process run.
- **BROWSER-LIVE** — real, already-signed-in browser tabs (`credentials:
  'include'` fetches, or on-screen navigation), never a new login, never a
  sign-out.
- **Fake-pool probe** — a real `createApp()` (the actual compiled Express
  app) driven by a hand-rolled in-memory `mssql`-shaped pool, used
  specifically to inject failure conditions (timeouts, malformed rows, huge
  recordsets) that cannot be produced against a real, healthy database
  without a write.

No production code, test, or documentation file was edited by any worker.
`git status --porcelain` was clean at the start of the audit round except for
one pre-existing, not-audit-caused modification (`VERIFICATION-2026-09-23.md`,
appended to by an earlier, unrelated session) which no worker staged,
committed, or reverted.

---

## 4. CRITICAL

### RT-001 — Line reject-rate figure disagrees with itself by ~43–75% relative, contaminated by a mislabeled simulator generation
*(originating: 01.F1, corroborated live 08.item1)*

- **Severity:** CRITICAL.
- **Component:** `api/src/services/weightStations.ts :: rejectRatesByStation` /
  `getWeightStations`'s `lineRejectRatePct` — three internal queries (the `c`,
  `r`, and `totals` CTEs, lines ~684–772) carry **no epoch/generation
  predicate at all**, unlike the file's own other, correctly-scoped fields.
- **Exact reproduction:** compare `GET /api/weight-stations` (Weight screen /
  Report › Station) against `GET /api/report` (Report › Daily) for the
  identical line and period.
- **Test data/generation:** 21 Aug – 7 Sep 2026 window (SQL-READ-ONLY):
  `cone_event` real epoch 9 = 55,058 rows, simulator epoch 13 = 135,248 rows;
  `reject_event` real epochs 11+12 = 3,456, simulator epochs 15+16 = 3,091.
  Independently re-derived live (08.item1) on a *different*, self-chosen
  trailing-14-day window with an even larger gap (6.38% real vs 3.51% shown).
- **Expected:** one number, since both screens describe "the line's reject
  rate for this period."
- **Actual:** Report › Daily = **5.9%** (real-only, correctly scoped).
  Weight / Report › Station = **3.4%** (pooled real+simulator, ~43% lower
  than true). Second window: 6.38% real vs 3.51% shown, an even larger gap.
- **Why this matters operationally:** this is the number a station gets
  flagged/recalibrated off of. Understating the true reject rate by ~43%
  both hides a real quality problem and can silently change which stations
  cross a flagging threshold.
- **Evidence:** `01-data-integrity.md` F1 (SQL + arithmetic), `08-frontend-
  consistency.md` item 1 (on-screen text + network capture + independent SQL
  recompute on a second window).
- **Existing test coverage:** `weightStations.test.ts` and three siblings pin
  query *order* with single-generation fixtures; none constructs two
  coexisting `source_epoch` values.
- **Why existing tests did not catch it:** every fixture is single-generation
  by construction, so a query with no epoch predicate and one with an epoch
  predicate return identical results under test. The defect is invisible
  until two real generations coexist in one query window — exactly what is
  live in the sidecar today.
- **Recommended fix (NOT applied):** thread the same `GenerationScope`/
  `epochWhere` used everywhere else in this file into `rejectRatesByStation`'s
  three queries and `stationMaterialCounts`.

### RT-002 — Station-report row is arithmetically impossible: 22,023 "within-tolerance" cones on a station that produced 12,180 cones
*(originating: 01.F2, corroborated live 08.item2)*

- **Severity:** CRITICAL — worse than merely wrong; the row contradicts
  itself to a reader who does no tracing at all.
- **Component:** `api/src/services/reports/station.ts :: getStationReport`,
  the `states` query (lines ~68–75, `FROM sms.cone_event ... GROUP BY
  source_station, ${stateCase}`, no epoch predicate) merged into the same row
  as `getWeightStations`'s SCOPED `cones` field.
- **Exact reproduction:** open Report › Machine/station for 21 Aug – 7 Sep
  2026; read Station 1's row left to right.
- **Test data/generation:** station 1, same window: real epoch 9 = 12,180
  cones, simulator epoch 13 = 9,871 cones.
- **Expected:** `states.within + low + high + rejected + unknown` for a
  station equals (or is a documented subset of) that row's own `cones`.
- **Actual, rendered on screen (08.item2):** `Station 1 › cones 12,180 …
  Within 22,023 · Low 0 · High 0 · Rejected 28 · Not judged 0` — sum
  22,051, nearly double the row's own cone count, exactly the pooled
  real+simulator total for the window. **Every station row on the same
  screen shows the identical pattern.** A third, narrower defect in the same
  row: the displayed `Reject rate` (1.6%) is computed from the pooled
  population, while the adjacent `Rejected at inspection` count (156) is the
  real-only count — the count and the percentage next to it in the same
  cell cannot be cross-checked against each other even approximately.
- **Why this matters operationally:** this is precisely "flag weights
  outside limits" (an explicit IFL requirement) failing to reconcile with
  the module's own reported cone count, on the live rendered table.
- **Evidence:** `01-data-integrity.md` F2, `08-frontend-consistency.md`
  item 2 (rendered HTML table text, network JSON, independent SQL).
- **Existing test coverage:** none found for cross-field consistency within
  `StationReportRow`.
- **Why existing tests did not catch it:** same single-generation-fixture
  blindness as RT-001.
- **Recommended fix (NOT applied):** scope the `states` query with the same
  `GenerationScope` already resolved for `cones` in the same call.

### RT-003 — Daily report's "rejected by the scale" figure is inflated ~29× by simulator rows, divided against a real-only denominator
*(originating: 01.F4, corroborated live 08.item3)*

- **Severity:** CRITICAL.
- **Component:** `api/src/services/reports/daily.ts :: getDailyReport` —
  calls `listEvents(...)` for scale-rejected cones and uses only `.total`
  (POOLED, no epoch restriction), discarding the `generations[]` breakdown
  the same call computed specifically so callers would not do this; divides
  by `report.totals.cones` (SCOPED).
- **Exact reproduction:** Report › Daily, 21 Aug – 7 Sep 2026.
- **Test data/generation:** `in_range=0` cone rows: real epoch 9 = 14,
  simulator epoch 13 = 397 (411 total = 14+397 exactly).
- **Expected:** `byScale` = 14 (real), `byScalePct` ≈ 0.025%.
- **Actual, rendered on screen (08.item3):** **"Rejected by the scale: 411
  (0.7% of cones weighed)"** — ~28–29× the true real-only value, sitting one
  line below the (correctly scoped) "5.9% of cones plus rejects" figure, two
  named populations one computed correctly and one contaminated, with
  nothing visually distinguishing them.
- **Why this matters operationally:** the Daily report exists specifically
  to separate two reject populations "each named as what it is"; one of the
  two is silently contaminated while sitting beside the clean one.
- **Evidence:** `01-data-integrity.md` F4, `08-frontend-consistency.md`
  item 3.
- **Existing test coverage:** none for `daily.ts`'s use of `listEvents`.
- **Why existing tests did not catch it:** this is a *caller* bug (discarding
  `generations[]`), not a query-construction bug — even a test asserting
  `listEvents` itself returns the right tally would not catch `daily.ts`
  discarding it.
- **Recommended fix (NOT applied):** scope the `listEvents` call to the same
  generation `getReport` resolved, or use `.generations` to pick the
  matching generation's count.

### RT-004 — Client-side reject-rate re-derivation on Line/Rejects disagrees with the server's corrected figure — see also Contradiction #2 (Section "Adjudications")
*(originating: 02.F1; partially checked/NOT reproduced by 08.item4 — see adjudication below)*

- **Severity:** CRITICAL as proven on the window the calculations worker
  chose; **UNRESOLVED whether it is visible on every window** — see the
  adjudication in the dedicated section below. Printed here as CRITICAL
  because the mechanism (client re-derives a raw ratio instead of reading
  the server's already-corrected field) is confirmed live in source on both
  files, independent of which window makes the gap visible.
- **Component:** `web/src/screens/Line.tsx` (`periodFigures`) and
  `web/src/screens/Rejects.tsx` (`ratePct`) — both independently recompute
  `rejected / (cones + rejected)` from raw counts, instead of reading the
  server's already-correct `rejectRatePct` (which divides by
  `cones + unmatchedRejects`, excluding rejects that are the same physical
  cone as an already-counted `cone_event` row).
- **Exact reproduction:** open Line or Rejects for a period spanning real
  September data; compare against Report's reject-rate figure for the
  identical period.
- **Test data/generation:** `DATA_TP1U2_SEP07`, epoch 9 (cone) / 11+12
  (reject) — real IFL data, SQL-READ-ONLY.
- **Expected:** one number.
- **Actual (02.F1's window):** Line/Rejects = **4.4%**; Report/exports =
  **4.59%**, on the identical filters, for the identical period.
- **Why this matters operationally:** exactly the failure mode CLAUDE.md's
  "ONE STATUS VOCABULARY" rule exists to prevent, recurring a third time in
  this specific denominator, after three server-side fixes that were never
  propagated to the two client files that also compute it.
- **Evidence:** `02-calculations.md` F1 (SQL + arithmetic on a fresh,
  single-generation window); `08-frontend-consistency.md` item 4 (a second,
  independently-chosen window where client and server formulas coincided to
  one decimal, with the divergent input fields — `rejectedCones` vs
  `unmatchedRejects` — confirmed to genuinely differ in that same window,
  but the exact field `Line.tsx`'s rendered string binds to was not traced).
- **Existing test coverage:** `api/src/services/rejectRateThreeWayAgreement.test.ts`
  exists but is server-only — asserts on `rejectSpc.ts`/`report.ts`/
  `weightStations.ts` return values directly, never renders or reads a
  client `.tsx` file's own re-derivation.
- **Why existing tests did not catch it:** structural — no test in the
  162-file suite renders `Line.tsx` or `Rejects.tsx` and reads the rendered
  reject-rate string against a known fixture; Phase 8's component-harness
  work covered only 2 of 16 top-level screens, neither of them these two.
- **Recommended fix (NOT applied):** have `Line.tsx`/`Rejects.tsx` consume
  the server's already-correct `rejectRatePct`/`pBar` fields instead of
  recomputing; add a render-level guard test analogous to the existing
  three-way service-level agreement test.

### RT-005 — Line screen renders a confident "0 cones / 0 sacks / 0 kg / 0 rejected" from a 200-OK response with fields silently missing from an otherwise-present row
*(originating: 03.DQ-001)*

- **Severity:** CRITICAL — a system-generated zero, indistinguishable from a
  genuine stopped-line fact, on the app's default landing screen, in 56px
  display type.
- **Component:** `web/src/screens/Line.tsx :: periodFigures`, `kpiBlockNote`,
  reading `r?.cones ?? 0` / `r?.rejectedCones ?? 0` / `r?.sacks ?? 0` /
  `r?.sackWeightKg ?? 0` from a row that exists but whose fields were
  deleted.
- **Exact reproduction (BROWSER-LIVE):** monkey-patch `window.fetch` to
  intercept only the totals call to `/api/production`, and on a 200 OK
  response whose `data.rows[0]` exists, delete `cones`/`rejectedCones`/
  `sacks`/`sackWeightKg` from that row before returning the still-200,
  still-well-formed JSON to the app. Click "Line".
- **Test data/generation:** live dev copy, period 5 Aug–20 Aug 2026; the
  manipulation happened entirely in the browser, never reaching the API or a
  database.
- **Expected:** a row with undefined core fields should be treated as
  untrustworthy, not printed as a confident zero beside a real percentage
  computed from a field that happened to survive.
- **Actual, verbatim rendered text:** `0 / cones / 99.9% within the scale's
  limits / 0 / sacks / 0 kg / 0 / rejected / 0% of everything weighed / 0 /
  outside the product's limits / 4 could not be judged` — directly above the
  **untouched** per-day chart on the same screen, same load, reading:
  "16 production days · 77,492 cones · busiest 6,204 on Thursday, 13 August
  2026." `99.9% within the scale's limits` is a genuine percentage computed
  from a field the patch happened to leave in the row — a mathematically
  nonsensical but fully rendered sentence about zero cones.
- **Why this matters operationally:** the landing screen (`?s=line`, the
  default view) a supervisor opens first prints "the line made nothing" — a
  serious, actionable claim — when the true condition is a partial API
  response. Nothing on screen hints at this: no `Failed`, no dash, no
  asterisk. The one sentence built to reassure the reader that zero is a
  real measurement (`kpiBlockNote`) fires exactly backwards here.
- **Evidence:** page text + screenshots, `03-data-quality.md` DQ-001, full
  reproduction script and browser session captured.
- **Existing test coverage:** GUARD 1 and GUARD 1C in
  `reliability.guard.test.ts` both scan `Line.tsx` and both pass on it
  today (they correctly guard the fetch-failed case); no test anywhere in
  the 162-file suite constructs a 200-OK response with a field deleted from
  an otherwise-present row.
- **Why existing tests did not catch it:** every guard and route test in
  this repo assumes the API either returns a complete row or fails outright;
  none model the space in between — a syntactically valid, HTTP-200 payload
  whose individual fields are missing.
- **Recommended fix (NOT applied):** check for the *presence* of the fields
  read, not just the presence of the row (`r && r.cones != null` rather than
  `r?.cones ?? 0`); render a distinct "figures incomplete" state; extend
  GUARD 1C (or add GUARD 1D) to fuzz-test missing-key degradation.

### RT-006 — A zero-lag-sample edge case reprints the exact "stopped" defect a 2 Sep 2026 fix was built to kill
*(originating: 05.F1, STATIC-READ)*

- **Severity:** CRITICAL — reintroduces a previously-fixed, previously-
  documented defect class, and lands at the worst possible moment: go-live
  cutover.
- **Component:** `api/src/services/live.ts :: classifyHealth`,
  `classifyLineState`, and the `ingestLagSeconds` computation feeding both.
- **Exact reproduction (STATIC-READ, deterministic):** when the lag-sample
  query (`TOP (@take)` over recent raw rows) returns **zero rows**,
  `ingestLagSeconds` is `null`. `classifyHealth`'s only gate on lag is
  `if (ingestLagSeconds != null && ingestLagSeconds > MAX_CREDIBLE_LAG_SECONDS)
  return 'late'` — `null` short-circuits this to false, so health falls
  through to `'ok'`. The caller then computes
  `lagMs = Math.min(ingestLagSeconds ?? 0, ...) * 1000` — collapsing `null`
  to **zero lag** — and passes that into `classifyLineState`, which judges
  the line against raw `now` instead of `now - 18min` (IFL's own measured
  acquisition lag). `web/src/lib/health.ts :: stateIsKnowable` returns
  `true` (health kind is still `'ok'`), so `Line.tsx`'s "cannot tell whether
  the line is running" fallback is never reached, and execution falls into
  the `'stopped'` branch: **`"<line name> has been stopped for N min"`**,
  styled with the alarm/accent class.
- **Test data/generation:** any moment the lag-sample query has zero
  eligible rows — most plausibly the first seconds/minutes after
  `sms epoch:accept` opens a brand-new generation, exactly IFL's own go-live
  cutover moment per CLAUDE.md's own cutover description.
- **Expected:** the same "cannot tell whether the line is running" sentence
  the file already correctly prints for its *other* uncertain cases.
- **Actual:** a confident, wrong, operationally alarming "stopped for N min"
  message.
- **Why this matters operationally:** this is exactly the moment a new
  install would look broken on day one, right after the exact command
  CLAUDE.md's own cutover section says must run at go-live.
- **Evidence:** `05-over-claiming.md` F1, function/line citations for
  `live.ts`, `health.ts`, `Line.tsx`, `words.ts`.
- **Existing test coverage:** `live.health.test.ts`/`live.test.ts` cover
  `classifyHealth`/`classifyLineState` as pure functions with a *measured*
  bad lag; NOT PROVEN whether any existing test calls either with
  `ingestLagSeconds: null` specifically while `lastReadingMs` crosses the
  stop threshold under a zero-lag assumption — not exhaustively confirmed
  absent.
- **Why existing tests likely missed it:** the file's own comments describe
  two now-fixed defects, both about a *measured* lag being wrong, not the
  *unmeasured* (`null`) case, which degrades silently rather than throwing.
- **Recommended fix (NOT applied):** when `ingestLagSeconds === null` and an
  open generation has rows, `classifyHealth` should return a kind that keeps
  `stateIsKnowable` false, rather than falling through to `'ok'`.

### RT-007 — The Line screen's own provenance banner is false for the exact data it sits above
*(originating: 08.F-NEW-1, BROWSER-LIVE)*

- **Severity:** CRITICAL — the single most user-facing instance of the
  epoch-mislabeling root cause; worse than RT-001–003's silent pooling
  because this banner **actively asserts a specific, false provenance
  claim** directly above the numbers a GM or process engineer would read.
- **Component:** `web/src/screens/line/Running.tsx` — the fixed disclosure
  paragraph beginning "This is not a stopped line. Every figure here is read
  from one source generation — September copy — cones..."
- **Exact reproduction:** open Line, set the period to 21–23 Sept 2026 (a
  period inside the currently-open, mislabeled `DATA_TP1U2_SIM` generation
  4 — the only generation covering this date range).
- **Test data/generation:** live sidecar's currently-open epochs 13–16.
- **Expected:** if the banner states the figures are real "September copy"
  data with simulator readings "left out," the KPI figures below it should
  be real-plant data, or the banner should say the only available data is
  the simulator's.
- **Actual, verbatim:** banner reads *"...whose newest reading is 12:00 PM.
  There are newer readings, to 12:29 PM, but they belong to pack1_TP1U2 gen
  4... Those readings are the plant simulator's, not the plant's. They are
  left out rather than added to these totals..."* immediately followed by
  **"9,325 cones / 413 sacks / 19,515 kg / 224 rejected — 2.3% of everything
  weighed."** The network response for the exact same window states
  `"generationNote":{"generation":{"key":"DATA_TP1U2_SIM#4",...,
  "simulator":true},"spansGenerations":false,"otherGenerationExcluded":0}`
  — **the entire 9,325-cone figure is 100% simulator output**; there is no
  real-plant data in this window at all (independently confirmed by SQL: a
  single row, `source_epoch=13`, no epoch 9/10/11/12 rows exist for this
  range).
- **Why this matters operationally:** this is worse than a silent pooling
  bug — it tells a GM or engineer in plain language that synthetic data has
  been excluded, while showing a page built entirely from synthetic data.
- **Evidence:** `08-frontend-consistency.md` F-NEW-1 (on-screen text +
  network capture + independent SQL).
- **Existing test coverage:** not established this pass — a
  `rank.matrix.test.tsx`-style test asserting the banner's generation label
  matches the fetched `generationNote.generation.label`/`.simulator` for a
  mocked simulator-only response would have caught this; no such assertion
  was found.
- **Why existing tests did not catch it:** a genuinely new failure shape —
  not "fetch failed, read as empty" (Phase 7's whole focus) but "fetch
  succeeded, and the STATIC banner copy contradicts the DYNAMIC payload it
  sits above." No guard in the described test suite targets banner-vs-
  payload consistency.
- **Recommended fix (NOT applied):** derive the banner's provenance clause
  from the same response's `generationNote` field the KPI tiles are built
  from, per period, rather than from whatever reference the "newest
  reading" stations panel uses.

### RT-008 — Root cause: the currently-open live generation is the plant simulator, mislabeled as a genuine IFL copy
*(originating: 00-environment.md §5 / 00-env-facts.json, SQL-READ-ONLY)*

- **Severity:** CRITICAL — this is the mechanism behind RT-001, RT-002,
  RT-003, RT-007, and (per Section "Adjudications" contradiction #1's
  reject-rate range) plausibly RT-004.
- **Component:** `.env`'s `IFL_DB_NAME_DATA=DATA_TP1U2_SIM` (the sync
  worker's configured source currently points at the simulator database)
  and `sms.source_epoch` (the sidecar's own generation registry).
- **Exact reproduction:** `SELECT epoch_id, source_table, source_db,
  provenance, generation_ordinal, closed_utc FROM sms.source_epoch ORDER BY
  epoch_id` (SQL-READ-ONLY).
- **Test data/generation:** the live `sms` sidecar itself.
- **Expected:** a generation whose `source_db` matches `/_SIM$/i` should be
  registered `provenance='simulator'` (as epochs 5–8, a prior simulator
  generation, correctly were).
- **Actual:** epochs 13, 14, 15, 16 — all four source tables' currently
  **open** (unclosed) generation — have `source_db='DATA_TP1U2_SIM'` but
  `provenance='ifl_copy'`, the label a genuine IFL data copy gets. The
  sidecar's epoch 13/14/15/16 row counts (212,873/9,715/4,457/411)
  exactly match `DATA_TP1U2_SIM`'s live counts, confirming full absorption,
  with ingestion reaching as recently as 2026-09-22T12:42:36 despite no
  sync-worker process currently running.
- **Why this matters operationally:** every downstream consumer that trusts
  `provenance` (rather than the second, independent `source_db`-pattern
  signal some services correctly also check — see Section 9, SURVIVED) would
  treat this generation as real plant data. This is not a hypothetical
  future risk; it is the live state of the sidecar during this entire audit.
- **Evidence:** `00-environment.md` §5, `00-env-facts.json`
  `source_epoch_table.mislabel_finding`; corroborated independently by
  `06-failure-recovery.md` §3b (the sync worker's own historical halt log
  names the exact source swap: "Source generation changed for
  pack1_TP1U2... source now: localhost/DATA_TP1U2_SIM... Sync halted BEFORE
  reading" — the halt mechanism itself fired correctly; the *operator* who
  ran `epoch:accept` against it afterward is where the mislabeling entered).
- **Existing test coverage:** none — this is a live data-registry state, not
  a code path a unit test exercises.
- **Why existing tests did not catch it:** structurally out of reach — this
  is an operational/data-hygiene fact about what is currently registered in
  a live database, not a code defect a test suite can assert against.
- **Recommended fix (NOT applied):** re-run `sms epoch:accept` correctly
  against a genuine IFL copy once `.env`'s `IFL_DB_NAME_DATA` is repointed
  away from the simulator, and close/relabel epochs 13–16 with the correct
  `provenance='simulator'`; separately, investigate (not attempted this
  audit — would require reading `sync-worker/src`/`cli/src`) whether
  `epoch:accept`'s own CLI should validate `source_db` against the
  `provenance` argument it's given, to prevent recurrence.

---

## 5. HIGH

### RT-009 — Per-product weight statistics pool simulator with real data
*(originating: 01.F3, SQL-READ-ONLY)*

`api/src/services/reports/product.ts :: getProductReport`'s `wReq`/`sReq`
queries carry no epoch predicate. Same window: material 20's `cones=24,364`
(scoped, real) but `weight.n=62,833` (2.6× larger, pooled) — the per-product
mean/SD report can be pulled toward the simulator's synthetic distribution.
Evidence: `01-data-integrity.md` F3. Existing coverage: not fully audited
(`reports/product.test.ts` not opened). Fix: thread `GenerationScope` into
`wReq`/`sReq`, same pattern as RT-001.

### RT-010 — `getReport`'s "coverage" block ignores generation scoping (mechanism proven, live counterexample not found)
*(originating: 01.F5, SQL-READ-ONLY)*

`report.ts :: getReport`'s `coverageReq` query is unconditionally wrong-by-
construction (no epoch predicate, same class as RT-001–003) but the current
sidecar's one real data gap (10 Jul–5 Aug) predates the simulator's coverage
start (21 Aug), so the two generations' date ranges never diverge inside a
testable window today — recorded HIGH (not CRITICAL) precisely because no
live counterexample could be produced, honestly. Evidence: `01-data-
integrity.md` F5. Fix: scope `coverageReq` to the same `GenerationScope`
`getProduction` already resolves in the same function.

### RT-011 — Reject-rate and SPC trend charts plot a missing data bucket as a literal, indistinguishable zero
*(originating: 03.DQ-002 and 05.F4 — same file, same mechanism, merged)*

- **Severity:** HIGH.
- **Component:** `web/src/screens/report/shared.tsx` — the quality/weight
  series-merge for both the reject-rate trend chart and the combined SPC
  control chart: `w: pct(wb?.rate ?? null) ?? 0`, `wOut: wb?.outOfControl ??
  false`, `wn: wb?.rejects ?? 0`, where `wb = wByTs.get(b.bucketTs) ?? null`.
- **Exact reproduction (STATIC-READ; not independently re-rendered live —
  see NOT PROVEN below):** when a day has a quality bucket but no matching
  weight-reject bucket at all (a real, plausible condition — the weight
  scale's data can be sparser than QCS quality-reject data, or the gap can
  fall on a source-generation boundary), `wb` is `null` and the plotted
  weight-reject rate/out-of-control flag for that day becomes `0`/`false` —
  identical to a day genuinely measured at 0% and in-control.
- **Expected:** a day with no weight-series entry should render as a gap in
  the line (the same discipline the file already applies to its UCL/LCL
  band a few lines above, per its own comment), not a plotted zero/clean
  point.
- **Actual:** `w` and `wOut` are unconditionally `0`/`false` whenever `wb` is
  `null`, with nothing distinguishing "no data" from "measured clean."
- **Why this matters operationally:** this is precisely "analytics with no
  evidence draws a conclusion anyway," on the one chart type CLAUDE.md calls
  out as the machinery under the calibration requirement.
- **Evidence:** `03-data-quality.md` DQ-002, `05-over-claiming.md` F4 —
  independently found by two workers reading the same function.
- **Existing test coverage:** GUARD 1C cannot see this — it is a prop-fed
  `screens/report/*` component, never its own `usePolling()` consumer, which
  is structurally outside GUARD 1C's scan directory logic. Not confirmed
  whether a dedicated chart-series test exists (not exhaustively searched by
  either worker).
- **Why existing tests did not catch it:** same structural reason GUARD 1C
  misses it everywhere — every guard in this repo scans for `.error`/`?? 0`
  reachable from a `usePolling()` variable; this component receives data as
  a plain prop, several layers removed from any poll.
- **Recommended fix (NOT applied):** track presence separately from value
  (`w: wb ? pct(wb.rate) : null`) and skip/gap the line's path segment for
  buckets where the value is `null`, the same way the UCL/LCL band already
  breaks around missing data.
- **NOT PROVEN:** neither worker forced this live in the browser; both are
  STATIC-READ only, on grounds the reasoning is unconditional from the code.

### RT-012 — Line/Wall's KPI layer collapses "missing field" into "true zero" structurally, not as a one-off (companion to RT-005)
*(originating: 05.F2, STATIC-READ, corroborated by the same live mechanism as RT-005)*

`Line.tsx`'s `periodFigures`/`kpiBlockNote` use the identical `?? 0` collapse
on the *summary* query (`groupBy=none`), a second, independent code path
from the one RT-005 proved live on the grouped query — same file, same
screen, reachable through a different request. When all four figures
collapse to zero and `line.dataAsOfUtc` is non-null, `kpiBlockNote` falls
through to **`'Nothing recorded in this period.'`** — an explicit, false
claim that data does not exist, printed under a headline of four zeroed
figures, while the per-day chart (a separate query the same attack does not
touch) can still show the real per-day counts beside it. Evidence:
`05-over-claiming.md` F2, `web/src/lib/words.ts:1177`. Existing coverage:
GUARD 1C structurally cannot catch a 200-OK response with a missing field —
there is no `.error` to fail to read. Fix: make "no data" and "field
omitted" impossible to conflate at the row-shape level (never omit a numeric
field; add an explicit per-field presence marker).

### RT-013 — Wall's per-station bars silently render a stripped field as "quiet," on the one screen with no drilldown
*(originating: 05.F3, STATIC-READ, not live-confirmed)*

`web/src/screens/Wall.tsx` uses the identical `?? 0` pattern for its
per-station bar heights (`byId.get(id)?.cones ?? 0`, three sites). A station
whose row is present but missing `cones` renders identically to a station
that genuinely produced nothing this shift — on a fullscreen TV display with
no navigation and no way for a floor viewer to drill in and notice the
discrepancy. Evidence: `05-over-claiming.md` F3. Existing coverage: none
specific to a partial per-station payload. Why missed: same structural gap
as RT-012, applied to Wall's own data shape. Fix: same as RT-012, applied to
Wall's per-station map. **NOT PROVEN live** — STATIC-READ only, not attacked
in the browser this pass.

### RT-014 — No server-side response-size or row-count cap independent of SQL (DoS-adjacent)
*(originating: 06.DBFAIL-001, fake-pool probe)*

- **Severity:** HIGH (availability/DoS risk on a single-process, no-reverse-
  proxy, no-process-supervisor deployment — one oversized response can
  degrade or freeze the one API instance every signed-in user depends on).
- **Component:** `api/src/app.ts` — `GET /api/rejects` (no row cap of any
  kind) and, more generally, every analytics/report route that trusts its
  own SQL's `TOP`/date-range filtering to bound row count.
- **Exact reproduction:** fake-pool probe returns a synthetic 500,000-row
  recordset for any query; `GET /api/rejects?from=2026-09-01&to=2026-09-07`
  (a 7-day range, well inside `MAX_RANGE_DAYS=366`) serialized and returned
  the entire thing as one 200 response.
- **Actual:** `/api/rejects` returned a **46.5 MB** body; `/api/events`
  (nominally page-capped at 500 by zod, but the fake pool deliberately
  ignored that to test the JSON-serialization layer, exactly as a broken
  `OFFSET`/`FETCH` clause would in production) returned a **205 MB** body —
  both 200, both built synchronously with no cap.
- **Why this matters operationally:** `api/src/config.ts`'s own comment on
  `MAX_RANGE_DAYS` already documents that no query has ever been exercised
  above 53 production days of real data — this is the concrete consequence
  the day that assumption stops holding.
- **Evidence:** `06-failure-recovery.md` DBFAIL-001, raw response-size
  captures.
- **Existing test coverage:** none — all fake-pool fixtures in the existing
  suite are small, realistic recordsets.
- **Why existing tests did not catch it:** nothing in the suite is designed
  to simulate "the query returned far more than expected."
- **Recommended fix (NOT applied):** a hard row-count ceiling independent of
  the date-range cap, or a post-fetch guard before `res.json(...)`.
- **NOT PROVEN:** whether this would actually exhaust memory or wedge the
  process under real concurrent load (06.N6) — not load-tested, deliberately.

### RT-015 — Malformed/missing/null production rows are silently coerced to zero, server-side
*(originating: 06.DBFAIL-002, fake-pool probe)*

- **Severity:** Medium-High (recorded here under HIGH for prioritization
  purposes, per the source file's own "Medium-High" label) — the exact
  "asserting a fact it does not have" pattern CLAUDE.md's Phase 7 programme
  targeted, found here on the **server** side, which Phase 7 never touched.
- **Component:** `api/src/services/production.ts :: getProduction`'s
  row-mapping helpers — `?? 0` coercions at multiple lines
  (`Number(u0?.no_attr ?? 0)` and siblings).
- **Exact reproduction:** fake-pool probe injects a malformed/missing-
  column/null-valued row into the target query for `getProduction`'s main
  aggregate; `GET /api/production` as an authenticated viewer.
- **Actual:** `200` with `cones: 0, rejectedCones: 0, sacks: 0,
  sackWeightKg: 0` — indistinguishable from a genuinely idle line, no
  `degradedReason`, no error field anywhere.
- **Why this matters operationally:** Line/Production is the floor-facing
  screen the entire redesign programme exists to make trustworthy at a
  glance. A future data-quality incident upstream (a transform-version
  mismatch, a partial restore, a schema drift) that produces malformed rows
  would render as "line stopped" with no error anywhere in the response for
  a client to surface.
- **Evidence:** `06-failure-recovery.md` DBFAIL-002.
- **Existing test coverage:** none — all fixtures return well-formed rows.
- **Why existing tests did not catch it:** the Phase 7 client-side guard has
  no server-side equivalent for a row arriving with the wrong shape.
- **Recommended fix (NOT applied):** validate row shape before mapping
  (zod-parse the recordset) and surface a mapping failure distinctly from a
  true zero; or have `getHealth`'s DQ-finding fold catch this class.

### RT-016 — A calendar-invalid date (`2026-13-45`) crashes the DB driver instead of app validation, on 9 of 9 endpoints tried
*(originating: 07.API-001, BROWSER-LIVE against the running API)*

- **Severity:** HIGH — a trivially reachable, unauthenticated-format input
  turns into an unhandled internal exception on the majority of the app's
  read surface.
- **Component:** `api/src/app.ts :: dateStr` — a shared zod schema, regex-
  only (`/^\d{4}-\d{2}-\d{2}$/`, format not calendar validity) — together
  with every route binding `from`/`to` straight into a parameterized SQL
  query without constructing/validating a real `Date`.
- **Exact reproduction:** `GET /api/production?from=2026-13-45&to=2026-13-45`
  (also reproduced on `/api/weights`, `/api/weight-stations`,
  `/api/attention`, `/api/calibration`, `/api/calibration/adjustments`,
  `/api/rejects`, `/api/sacks/summary`, `/api/reports/daily` — 9 total).
- **Actual:** **500** on all 9, generic `{"error":"internal error",
  "requestId":...}`, with the server log showing a raw Tedious stack trace
  naming an internal SQL parameter (`genFrom`) the client should never see.
  Two siblings (`/api/spc`, `/api/reject-spc`) happened to return 400
  instead — not because they validate the calendar, but because
  `'2026-13-45' > '2026-09-07'` is true under plain string comparison and
  the reversed-range check runs first and catches it by accident.
- **Why this matters operationally:** every one of these 9 routes backs a
  screen opened directly by a manager or engineer; a manually-typed or
  bookmarked date range that happens to be calendar-invalid breaks the
  screen with no actionable message.
- **Evidence:** `07-api-contracts.md` API-001, raw request/response pairs
  and server log excerpt.
- **Existing test coverage:** `app.rangeCap.test.ts`/`app.attention.test.ts`
  pin reversed-range/oversized-range behaviour, neither constructs a
  calendar-invalid-but-regex-valid date.
- **Why existing tests did not catch it:** the regex looks complete at a
  glance (format is checked); nobody wrote the "right shape, wrong calendar"
  case.
- **Recommended fix (NOT applied):** validate with `Date.parse` (or a
  calendar-aware library) after the regex passes, in the shared schema.

### RT-017 — MachineProduct report table clips ~82% of its columns on screen, with no in-app fallback
*(originating: 08.item5, BROWSER-LIVE at 1366×768)*

`Report › Product by machine` renders one column per production-day×shift
(55 columns for an 18-day period); measured `scrollWidth: 4616px,
clientWidth: 816px` → only 17.7% of the table is visible without scrolling,
no sticky first column (`position: static` confirmed via `getComputedStyle`)
— scrolling right loses the machine-name label entirely. CLAUDE.md's own
Phase 9 section already flagged this exact structural problem for **print**
(suppressed via `.no-print` with a CSV-export pointer); the identical
problem is unaddressed **on screen**, where no equivalent fallback message
exists. Evidence: `08-frontend-consistency.md` item 5. Existing coverage:
none — jsdom computes no layout, so this class of defect is structurally
invisible to the test suite. Fix: sticky first column and/or an on-screen
CSV-fallback notice matching the print one.

### RT-018 — A definitively retired product is shown as the live weight target with no marker
*(originating: 08.item6, BROWSER-LIVE)*

Line and Weight both render **"201-IH0-SD · Target 1,960 g · limits
1,960 ± 40 g"** as the plain, unflagged Current Product/target. `GET
/api/products` (same authenticated session) shows all three plausible
candidate rows for "201-IH0-SD" (`productId` 11/12/13) with
`activeFlag: false` — `productId 12`'s `setpointG` (1960) matches the
displayed target exactly. Contrast: Product › Running's per-machine pivot
correctly shows currently-running materials with `activeFlag: true` — the
app clearly has the data needed to flag a retired product, it simply never
consults it for the line-wide Current Product block. Evidence:
`08-frontend-consistency.md` item 6, three product rows pasted with
`activeFlag: false`. Fix: check `activeFlag` before rendering the line-wide
target and mark it visibly if retired.

### RT-019 — The calibration advisory's Nelson rules, applied unsuppressed, flag 78.6% of stations and 12.7% of station-days on a real 19-day window
*(originating: 10.W3I-1, SQL-READ-ONLY + independent offline replica of the production code)*

- **Severity:** HIGH.
- **Component:** `api/src/services/calibration.ts :: getStationDrift`
  (Nelson rules 2–8 applied unsuppressed) feeding `attention.ts ::
  stationDriftFindings` and `weightStations.ts` (station `flagged`/
  projection), rendered by `StationSheet.tsx`.
- **Exact reproduction:** the worker built and ran an offline replica
  (`w3i-calib-nelson.mjs`) re-implementing `nelson.ts`'s
  `nelsonViolations` and `calibration.ts`'s `individualsSigma`/
  `slopePerDay` **line for line**, against 267 real station-days pulled
  live (14 stations, generation 1/July, plausibility-filtered).
- **Expected:** if Nelson rules 2–8 behave as the app's own Weight.tsx
  already measured (37.6–54.8% of subgroups on a materially similar series)
  and suppressed for that reason, the calibration advisory should apply the
  same suppression or state a comparable false-flag caveat.
- **Actual, measured:** **11 of 14 stations (78.6%) flag at least one day;
  34 of 267 station-days (12.7%) flag.** Rule 5 (2-of-3 beyond 2σ) fired 18
  times, rule 6 (4-of-5 beyond 1σ) fired 12 times — these two short-window
  rules alone account for 30 of the 34 flagged days. None of this is
  suppressed or captioned with a false-positive-rate caveat anywhere in
  `calibration.ts`, `weightStations.ts`, `attention.ts`, or
  `StationSheet.tsx` (confirmed by grep — Weight.tsx's own
  `patternsWithheld` treatment has no equivalent string for this screen).
- **Why this matters operationally:** this is the mechanism behind "days to
  action limit" — the feature standing in for the AI capability IFL was
  told they'd get. An engineer who acts on every flag sees the majority of
  the line "flagged" in any given period; an engineer who learns to ignore
  it has had the feature silently disabled by experience.
- **Evidence:** `10-analytics.md` W3I-1, offline replica output cross-
  checked by hand against `nelson.ts`/`calibration.ts`.
- **Existing test coverage:** `nelson.test.ts` (25 cases),
  `calibration.phase9.test.ts` (27 cases), `attention.test.ts` (19 cases) —
  all synthetic, hand-constructed 3–20-point fixtures verifying the
  arithmetic of one rule in isolation; none constructs a real
  per-station-per-day series and asserts anything about aggregate flag
  rate.
- **Why existing tests did not catch it:** unit tests for `nelsonViolations`
  are correctness tests for the arithmetic, not validity tests for the
  statistic against this plant's actual variance structure — the same gap
  D-10 (the project's own defect register) closed for `spc.ts` but which
  `DEFECTS.md`'s own text explicitly says was "not proven affected... and
  was not touched" for `calibration.ts`'s parallel use of the same engine.
  That sentence is correct as written (never measured, either direction)
  but has been read as closer to "probably fine" than this measurement
  supports.
- **Recommended fix (NOT applied):** either suppress the pattern-driven
  flag/projection gate the way Weight.tsx suppresses its dots, replacing it
  with a plain "N g off target for D days" statement, or state the measured
  rate on `StationSheet.tsx` the way `patternsWithheld` states it on
  Weight.
- **NOT PROVEN:** whether this rate generalizes beyond the one 19-day July
  window measured (not repeated on the September generation or a shorter
  window).

### RT-020 — Days-to-limit projections print precise numbers from as few as 3–5 noisy points, with no confidence interval
*(originating: 10.W3I-2, companion to RT-019, same offline replica)*

`calibration.ts :: projectDaysToLimit`, called from `attention.ts` with a
run as short as `MIN_DAYS_HELD = 3` days: Station 6 (5-day run, driven by 3
Nelson-rule-5 hits alone) prints **"18 days to the lower limit"** from a
5-point OLS fit with no standard error, no R², no confidence interval.
Station 12 (12-day run, slope −0.19 g/day — visually almost flat, smaller
than another station's own measured day-to-day sigma of 4.79 g) prints
**"136 days to the lower limit,"** three significant figures of apparent
precision from a fit whose own slope is smaller than the noise. Station 11's
3-day run (the legal minimum) shows a 1-day change in which day is "last"
would flip whether a number appears at all. Evidence: `10-analytics.md`
W3I-2, exact per-station output pasted. Why it matters: these numbers read
as forecasts to a floor engineer with no statistics background — the exact
audience CLAUDE.md's own audit history says this product is for. Existing
coverage: `calibration.phase9.test.ts`'s 11 `projectDaysToLimit` cases use
clean synthetic 2–5-point fixtures (e.g. a straight 1950→1970-by-5s run) —
prove the arithmetic is right, never that a real, noisy 3-point fit produces
a defensible number. Fix: raise the minimum run length for the projection
specifically (independent of the finding's own `MIN_DAYS_HELD`), and/or
compute and print a residual-based interval.

### RT-021 — A 1970 clock-fault sentinel row hijacks the live "anchor" under replay, at two independent call sites
*(originating: 11.OPS-1, BROWSER-LIVE + SQL-READ-ONLY)*

- **Severity:** HIGH — not reachable in normal real-time operation, but
  reachable through the project's own documented replay mechanism, which
  CLAUDE.md names as the tool for demos and verification.
- **Component:** `api/src/services/live.ts :: getLive` (the `tipReq`
  anchor query) and `api/src/services/machinesRunning.ts ::
  getMachinesRunning` (the `anchorReq` query) — both
  `SELECT MAX(production_ts_utc_ms) ... WHERE ... <= @asOf AND
  <single-generation-scope>`, both vulnerable to a sentinel row winning the
  comparison when no real data exists yet for the requested instant.
- **Exact reproduction:** `?s=line&at=2026-07-05T10:00:00Z` (any replay
  instant before 2026-08-05, the earliest real row in the currently-live
  generation).
- **Test data/generation:** `cone_event_id 843007` (source_epoch 9, the
  live generation) carries `production_ts_utc = 1970-01-01T00:00:00` — the
  vendor's own clock-fault sentinel, physically present *inside* the
  currently-live generation, not excluded by any code path.
- **Actual:** `GET /api/live?asOf=2026-07-05T10:00:00Z` returns
  `dataAsOfUtc: "1970-01-01T00:00:00.000Z"`, `behindSeconds:
  1,783,244,983` (~56.5 years), and the Line screen renders *"Cannot tell
  whether the line is running,"* every one of 14 stations "quiet," and
  *"Last cone 1,947 g · Passed · Station — · 12:00 AM"* — truncated to a
  bare time with no date, indistinguishable on screen from a genuinely
  recent reading. The API's own `generation.newerElsewhereUtc` field proves
  it already knows the real answer exists (378,575 real rows for that exact
  instant) and deliberately generation-scopes it away — the sentinel row
  fills the resulting gap instead of a "no data" state.
- **Why this matters operationally:** replay is the documented mechanism
  for demos; anyone replaying a date before the live generation's own start
  (which for the entire superseded July generation is every date on
  record) gets a screen that flatly denies the line was running, when
  hundreds of thousands of real readings exist for that instant.
- **Evidence:** `11-operational-edges.md` OPS-1, raw network capture, SQL
  confirmation of the sentinel row and its sibling in epoch 1.
- **Existing test coverage:** `live.health.test.ts`/`app.generations.test.ts`
  exercise generation-scoping and replay separately; neither seeds a row at
  `production_ts_utc_ms = 0` alongside real rows in the same generation.
- **Why existing tests did not catch it:** the defect needs three things at
  once (a replay instant before the live generation's real data starts, a
  clock-fault sentinel physically present in that generation, and a
  generation-scoped anchor query) and no test fixture combines them.
- **Recommended fix (NOT applied):** exclude `production_ts_utc_ms <= 0`
  from the anchor `MAX()` queries in both files, or require the anchor
  result to fall within the generation's own documented date range before
  trusting it.

### RT-022 — Weight basis, tare, and shift-boundary rules are read as "whatever is current," never "whatever was in force during the reported period" — confirmed real by actual rule-change history (merged finding)
*(originating: 02.F2 and 11.OPS-3 — same defect, independently found by two workers)*

- **Severity:** HIGH (02.F2 called this HIGH; 11.OPS-3 called it
  MEDIUM-HIGH-as-latent/LOW-as-currently-observed — printed here as HIGH on
  the strength of the confirmed, real rule-change history and the confirmed
  code pattern at 7+ call sites, while preserving OPS-3's honest caveat that
  it is not yet visibly wrong in the current dataset — see item 7 below).
- **Component:** `api/src/services/admin.ts :: getPlausibilityRule`,
  `getRules` and at least seven further call sites doing the identical
  `SELECT TOP 1 ... FROM sms.<rule table> WHERE line_id=@line ORDER BY
  effective_from DESC` with **no period bound**: `weights.ts ::
  loadWeightRule`, `sacks.ts`, `sackStock.ts`, `production.ts`,
  `envelope.ts` (both `weightBasis` and `shiftMode`), `live.ts` — contrasted
  with `productLimits.ts`/`productAt.ts`, which are correctly time-versioned
  and which CLAUDE.md repeatedly cites as the flagship "a reading is judged
  by the limits in force at its own time" rule.
- **Exact reproduction:** `SELECT * FROM sms.weight_rule ORDER BY
  effective_from` (and the same for `shift_rule`/`plausibility_rule`).
- **Test data/generation:** real edit history in the app-owned sidecar (not
  synthetic): `weight_rule` basis went `as_recorded` (seed) → `net` (23 Jul,
  reverted same day) → admin-UI toggling on 3 Aug (all reverted within ~1s
  each) → `as_recorded` (19 Aug) → **`gross` (15 Sep 2026, "IFL answer Q24,
  15 Sep 2026")**, the current, real, confirmed-with-IFL basis change.
  `shift_rule` changed twice in 83 seconds on 14 Sep 2026 ("Phase 1
  acceptance test", then reverted).
- **Expected:** a report for a period entirely before 15 Sep 2026 should be
  computed under `as_recorded` (the rule genuinely in force then), not
  today's `gross`.
- **Actual:** every report for any historical period is computed under
  today's current rule, unconditionally, confirmed in the SQL text itself.
- **Why this matters operationally:** IFL's weight basis has already
  changed once for real, and will again; the moment a report is regenerated
  for a period before such a change, printed sack kilograms and
  shift-grouped counts will silently use today's rule against yesterday's
  readings and call it historical fact — a manager comparing this month's
  export to last month's for the same period would see numbers move with no
  data having changed.
- **Item 7 (from 11.OPS-3), preserved honestly:** this dataset happens NOT
  to expose the bug numerically today, for a specific, narrow, fragile
  reason: `sacks.ts`'s basis switch only subtracts tare when `basis ===
  'net'`; both `gross` and `as_recorded` leave the raw value untouched, and
  every genuine `net` window in the whole rule history lasted under two
  seconds. Cross-checked directly: applying today's `gross` rule to June
  2026 sack data (`as_recorded` at the time) produces the same average
  (47.23 kg) as the raw recorded value, because the two bases happen to
  coincide arithmetically for this metric. **The bug is real and will fire
  the next time IFL asks for a genuine basis or boundary change spanning
  hours or days** — it is not currently visible only by coincidence.
  Separately: the word "basis" never appears anywhere in the Report
  screen's visible text, so even when the numbers are right, nothing on
  screen states which rule produced them.
- **Evidence:** `02-calculations.md` F2 (full rule-history dump, mechanism);
  `11-operational-edges.md` OPS-3 (independent confirmation, live Report
  screenshot + SQL cross-check proving today's coincidental non-divergence).
- **Existing test coverage:** `weights.basis.test.ts`'s test, titled *"reads
  `basis` off the newest weight_rule row,"* actively **encodes "always
  current" as the correct, expected behavior** — a future fix that made
  this time-versioned would fail this test as currently written, so the
  regression-proofing points the wrong way. No test constructs two rule
  versions and asserts a reading from before the second version's
  `effective_from` is judged by the first.
- **Why existing tests did not catch it:** the product-limits versioning
  pattern was built and tested carefully as the app's flagship rule; the
  identical need for `weight_rule`/`shift_rule` was apparently never
  generalised from that one case.
- **Recommended fix (NOT applied):** give `weight_rule`/`shift_rule` the
  same period-aware resolution `productLimits.ts` already implements
  (`effective_from <= <period end>`), reserving the unconditional `TOP 1`
  for genuinely "right now" call sites (Setup's own editor, `/api/live`).
  State the basis word on the Report screen regardless.

---

## 6. MEDIUM

### RT-023 — The running API process was serving code 26 minutes older than its own already-rebuilt `dist/`, with no self-detection
*(originating: 00.ENV-001)*

No process supervisor exists (confirmed absent by direct process/service/
scheduled-task inspection). `GET /api/health` reports its own uptime/PID but
not a build/start timestamp next to `dist/`'s mtime, so a stale-relative-to-
disk process is silently indistinguishable from a current one without manual
inspection. Evidence: `00-environment.md` §2–3. Fix: a lightweight process
supervisor, a build-and-restart wrapper, or at minimum `/api/health`
reporting its own build timestamp.

### RT-024 — `.env`'s `PDAS_WRITE_ENABLED` comment claims IFL authority was granted; the value says the gate is closed; the two disagree
*(originating: 00-environment.md §4 + 04.§6, corroborated by two independent workers)*

The comment block preceding `PDAS_WRITE_ENABLED=false` reads *"PDAS writes:
ENABLED 22 Sep 2026 on the owner's instruction (IFL granted permission)"* —
the value on the next line is `false`. Both the comment's narrative and the
code's actual behaviour (`/api/product-write/status` reports `enabled:
false`, `execute` returns 503 DISABLED) confirm no PDAS write is currently
reachable, so there is **no live security consequence** — the code is not
fooled by a `#` comment. This is a **documentation/provenance risk**: a
future reader or editor skimming only the comment, or toggling the literal
value to match it, could believe written IFL authority already exists, which
directly contradicts CLAUDE.md's own 21 Sep 2026 section ("all nine write
rights... still await IFL's written authority... no PDAS procedure of any
kind has ever been executed"). Evidence: `00-environment.md` §4,
`04-security.md` §6 (independently re-confirmed by reading `.env` directly a
second time). Fix: correct or remove the misleading comment; this is a
documentation edit, not a code change, and was correctly left unedited by
this audit per its own no-fix rule.

### RT-025 — `shift_code` is baked in at ingest time and never recomputed; a real, if brief, mixed shift-rule regime is independently confirmed
*(originating: 02.F3, SQL-READ-ONLY)*

`sync-worker/src/transform/transform.ts :: shiftCodeOf` computes and writes
`shift_code` once at transform time from whichever `shift_rule` was current
then; a brief Setup misconfiguration (the confirmed 14 Sep 2026, 80-second
shift-rule flip) permanently mis-assigns whatever rows the sync worker
happened to ingest in that window to the wrong shift, with no repair path
short of a full-table rebuild — and `sync-worker/src/config.ts`'s own
documented finding states `cone_event`'s rebuild has **never succeeded**
(times out at 204,076 rows). This is a named, already-known finding (H5)
per the config.ts comment, independently re-confirmed here by reading the
actual `shift_rule` row history rather than trusting the comment. Evidence:
`02-calculations.md` F3. Fix: already named by the codebase itself — fix the
`cone_event` rebuild timeout, then run a successful rebuild; longer-term,
compute `shift_code` at query time.

### RT-026 — The client/server rank crosscheck covers only ~6 of ~25–32 elevated-rank routes; the gap itself is untested
*(originating: 04.SEC-2, STATIC-READ)*

`web/src/rank.crosscheck.test.ts`'s `PAIRINGS` array has exactly 6
hand-maintained entries, with a staleness check only on those 6's own text,
never a completeness check against the server's actual `requireRole(N>1)`
call sites. Uncovered: all 15+ `/api/admin/*` routes (though these ARE
separately covered by `app.rbac.test.ts`'s own 19-entry table with a canary
— see Section 7, "Adjudication #3"), the admin password-reset route, the
three PDAS product-write routes, the second export route
(`/api/reports/:type/export`, distinct from the covered
`/api/events/export`), and `/api/products/limits/local`. This is exactly
the defect shape (Export offered at rank 2, gated at rank 3) this file
exists to catch, on one route it already covers; ~19 further routes have no
client/server crosscheck at all. Evidence: `04-security.md` SEC-2, direct
enumeration of `PAIRINGS` vs. every `requireRole` call site. Fix: a
companion test that grep-enumerates every `requireRole(N>1)` site and
asserts the resulting tuple set's size equals `PAIRINGS.length`, or a
documented allow-list for deliberately-unpaired routes.

### RT-027 — Misleading "Login failed" message masks three distinct DB-connection causes
*(originating: 06.DBFAIL-003, real doctored-env second API instance, port :4100)*

A nonexistent database name, a wrong password, and a real-but-unmapped login
against the app database all produce the byte-identical `ConnectionError:
Login failed for user '<x>'` with no further distinguishing detail — SQL
Server's own driver-level message, passed straight through unmodified.
`api/src/index.ts`'s `main().catch` logs only `err`, not the
`server`/`database`/`user` it attempted (available via `c.database`/
`c.server` in `db.ts`'s own pool-level `onError` handler for post-startup
failures, just not wired into the startup path). Why it matters: at go-live
cutover, a misconfigured connection string would produce this exact
ambiguous message and the debugging person may not be who set the
credentials. Evidence: `06-failure-recovery.md` DBFAIL-003, three raw log
lines with different root causes proven by construction. Fix: log the
attempted server/database/user (never the password) alongside the driver's
message in the startup-failure path, matching the post-startup handler.

### RT-028 — `/api/production` and `/api/weights` are missing the shared 366-day range cap every sibling date-range route enforces
*(originating: 07.API-002, BROWSER-LIVE against the running API)*

`validateRange()` (`MAX_RANGE_DAYS=366`) is called from 8 sibling
call sites and confirmed, by reading both handlers directly, **not called**
from `/api/production` or `/api/weights`. Reproduced:
`GET /api/production?from=1980-01-01&to=2030-01-01` (50-year span) → 200,
679 ms; `GET /api/weights` with the same span → 200, **1691 ms**, the
single slowest response measured in this audit's contracts pass — versus
2–7 ms for the same span on any capped sibling. Evidence:
`07-api-contracts.md` API-002. Fix: add the two missing `validateRange()`
calls, or move the cap into shared middleware keyed on the presence of
`from`/`to`.

### RT-029 — Two reject-headline fields on `Rejects.tsx` are generation-mixed while the field they should use (`pBar`) is correctly scoped
*(originating: 10.W3I-3, STATIC-READ code trace)*

`rejectSpc.ts :: getRejectSpc`'s `totalProduced`/`totalRejects` fields sum
over every generation in the queried window (unlike `pBar`, which is
explicitly scoped to the newest generation only). `Rejects.tsx` builds its
headline rate directly from these two raw, generation-mixed,
double-counting-unaware totals, never from `pBar` or the correctly-scoped
per-bucket fields the same service computes. This adds a second, independent
reason (generation-mixing) for the same headline to disagree with the chart
drawn below it, distinct from the already-known double-count bug
(00-env-facts.json's `reject_rate_discrepancy_anchor`) — and worse, if the
period spans a generation boundary, the trend chart's own `spansGenerations`
banner fires on the same payload whose headline number has already silently
pooled the two generations the banner is warning about. Evidence:
`10-analytics.md` W3I-3, code trace with line citations. Existing coverage:
`rejectSpc.test.ts`/`rejectSpc.generations.test.ts` test `pBar`'s scoping
directly; none asserts anything about `totalProduced`/`totalRejects`'s
scope, because the two fields are named identically to a per-generation
sibling type, inviting the same wrong assumption a human reader made.
**NOT PROVEN live** — established by STATIC-READ code trace only, not
independently reproduced in the browser this pass. Fix: scope the top-level
totals to the same newest-generation rule `pBar` uses, or have
`Rejects.tsx` compute from `pBar`/`inspected` instead.

### RT-030 — CLAUDE.md's clock-fault-row count is stale and none of the four rows are excluded by any code path (merged finding, three independent confirmations) — see also Contradiction #4
*(originating: 02.F4, 10.W3I-4, 11.OPS-2)*

- **Severity:** MEDIUM.
- **Component:** CLAUDE.md's "Known constraints" section; no exclusion
  predicate exists anywhere under `api/src/services` for
  `production_ts_utc_ms <= 0`-shaped rows.
- **Exact reproduction:** `SELECT shift_date, source_epoch, COUNT(*) FROM
  sms.cone_event WHERE shift_date IN ('1969-12-31','2026-06-21') GROUP BY
  shift_date, source_epoch`.
- **Expected (per CLAUDE.md):** 1 row on 1969-12-31, 2 rows on 2026-06-21 —
  written when only the July sample existed.
- **Actual:** **four** rows across two generations: epoch 1 (July) matches
  CLAUDE.md exactly (1+2), but epoch 9 (September) adds a fourth,
  undocumented row at 1969-12-31 — the fault recurs across the rebuild,
  consistent with an acquisition-layer default-clock artefact rather than a
  one-off. None of the four is excluded by the plausibility filter (all four
  weights, 1924–1959 g, sit inside the default 1500–2100 g band), and none
  is excluded by any coded predicate anywhere in the analytics layer —
  "excluded" in CLAUDE.md describes a documented analyst-time count
  exclusion, not a coded filter.
- **Reachable on screen:** confirmed directly — `?s=readings&p=pick&
  from=1969-12-31&to=1969-12-31` renders a normal-looking register entry
  ("Wednesday, 31 December 1969: 2 weighed, 0 rejected... 12:00 AM ·
  843007 · 1,947 g · Not judged"), reachable by a pasted link or a
  hand-edited URL with no widget interaction needed.
- **Why this matters operationally:** the 1969-12-31 rows are harmless in
  practice (no UI control would reach 1969 by accident). The 2026-06-21
  pair is not — it sits one calendar day before the July sample's
  documented start, exactly the kind of boundary a "last 20 days" default
  window could reach, with extreme leverage on a volume-weighted mean if it
  does.
- **Evidence:** `02-calculations.md` F4 (initial discrepancy), `10-
  analytics.md` W3I-4 (full four-row confirmation with weights and
  timestamps), `11-operational-edges.md` OPS-2 (on-screen Readings
  rendering, print-header text, URL-reachability proof) — three
  independent confirmations of the same underlying gap.
- **Existing test coverage:** none — no fixture in any test file uses real
  dates.
- **Why existing tests did not catch it:** no test re-checks the documented
  exclusion list against new generations as they land.
- **Recommended fix (NOT applied):** strip these rows at transform/ingest
  time with a shared predicate (`production_ts_utc_ms > 0`), or correct
  CLAUDE.md to state plainly that they remain in the canonical table and
  are excluded only from a specific analyst report, not from the live
  analytics or UI layer.

### RT-031 — `sms.plausibility_rule`/`weight_rule`/`shift_rule` time-versioning gap
*(subsumed into RT-022 above — see that entry; listed here only to record it is not a separate MEDIUM item, it was folded up to HIGH per RT-022's combined evidence.)*

### RT-032 — `medianConeWeight`'s report-query fallback is unscoped (mostly dormant)
*(originating: 01.F6, SQL-READ-ONLY)*

`api/src/services/reports/coneWeight.ts :: medianConeWeight` carries no
epoch predicate, but is only reached when `weights.ts`'s own SCOPED median
is `null` — in the probed window it was not (though this was not directly
confirmed by printing `medianSource`; see NOT PROVEN in the source file).
Severity kept LOW/mostly-dormant by the originating worker; listed here
under MEDIUM section boundary for grouping convenience with its siblings.
Fix: thread the same scope through, or drop the fallback in favour of
surfacing `null` with a stated reason.

---

## 7. LOW

### RT-033 — Sacks summary headline has no presence guard on `t.sacks`; failure mode on a stripped field is unknown
*(originating: 05.F5, STATIC-READ)*

`web/src/screens/Sacks.tsx :: SummaryFigures` checks `if (t.sacks === 0)`
for its empty state — if `t.sacks` is `undefined` (a stripped field) rather
than `0`, this comparison is `false`, so the empty-state path is not taken
and execution falls through to `fmtInt(undefined)` on an unverified value.
Neither the `?? 0` collapse (RT-012/013's failure mode) nor an explicit
ok/error tag (Rejects' own pattern) is used here — its behaviour under this
attack is simply unknown. Evidence: `05-over-claiming.md` F5. NOT PROVEN:
whether `fmtInt(undefined)` produces `NaN`, `0`, or throws. Fix: resolve
which failure mode occurs, then apply the same explicit-presence check used
elsewhere.

### RT-034 — An unknown filter id and a valid-but-zero-data filter id are indistinguishable
*(originating: 07.API-003, BROWSER-LIVE)*

`GET /api/production?...&product=999999` (a materialId that does not exist)
and the same URL with `product=12` (a real productId, but not a materialId
matching any row in the period) both return 200 with byte-identical shape —
`cones:0, rejectedCones:0` — no distinction between "this id does not
exist" and "this id exists but nothing matched." Neither differs from what
a genuinely-existing-but-idle material would return. Evidence:
`07-api-contracts.md` API-003, three-way comparison (no filter: 19,792
cones; `product=999999`: 0; `product=12`: 0). Why it matters: a manager
filtering by product with a mistyped id sees "0 cones" and could reasonably
conclude a machine is down. NOT PROVEN: whether any real materialId
currently returns non-zero for this period+filter at all — both ids tried
happened to return zero. Fix: validate `product` against the reference
table before querying, returning 400 or an explicit "unknown product" flag
for a genuinely absent id.

### RT-035 — Plain-HTTP intranet deployment means the session cookie travels in cleartext by design (informational, not a code defect)
*(originating: 04.SEC-3, STATIC-READ + live config confirmation)*

`.env`'s `COOKIE_SECURE=false` in this dev environment matches
`DEPLOY.md`'s documented plain-HTTP-intranet trade-off exactly (shipped
default is `true`; the dev override is intentional and documented). This is
**not a coding defect** — but the documented production posture (plain HTTP
on the plant LAN) still means the session cookie and every request/response
body travel in cleartext on that LAN, readable by anyone with a tap on the
network segment or a compromised device on the same VLAN (`httpOnly`/
`sameSite=strict` stop XSS/CSRF theft, not passive sniffing). Worth raising
with the owner as a residual risk depending on how isolated the plant
network actually is — a fact this audit cannot observe from this machine.
Evidence: `04-security.md` SEC-3. No code fix recommended; a deployment
decision (TLS, even self-signed internal CA, if the network is not fully
isolated).

### RT-036 — A live ngrok tunnel exists on the machine but exposes a different application, not SMS (informational)
*(originating: 04.SEC-4, process inspection)*

`ngrok.exe` (PID 62104) tunnels `localhost:5045` → a public `.ngrok-free.dev`
URL. Traced the tunnel target to `EMS.Web.exe` (the *other* application on
this machine, Energy Management System) — confirmed neither SMS's API
(`:4000`) nor its Vite dev server (`:5173`) has any tunnel pointed at them.
Not an SMS finding; recorded because a tunnel is live on the same physical
machine that hosts SMS's dev instance, which is a fact about the box's
overall exposure. Not killed, not touched — inspected read-only only.
Evidence: `04-security.md` SEC-4.

---

## 8. Components that survived — what was attacked, and what held

Per the owner's own instruction: *"we want 'this component survived these
attacks,' not simply 'no defect found.'"*

| Component | Failure conditions attempted | Result | Evidence | Relevant test count |
|---|---|---|---|---|
| **RBAC blanket + per-route gates** (`api/src/app.ts` + 6 route files) | 77 unauthenticated requests across every GET/POST/PUT/PATCH route this audit could enumerate (67 unique routes by the security worker's own count; login/logout excluded from execution on purpose) | **401 on every gated route; 200 with no secret on the 2 public routes — 77/77 correct** | `04-security.md` §1, full JSON captured | `api/src/app.rbac.test.ts`, `rank.matrix.test.tsx` |
| **SQL injection / XSS-style payloads** across every parameterized query surface tried (`from='OR'1'='1`, `<script>` in multiple params, `table=cone_event'--`, a SQL-comment-style report type) | Every parameterized *value* site tried | **Inert everywhere — every payload either fails a format regex (400, field-level message) or fails an allowlist check before reaching SQL** — no counter-example found in either audit pass | `04-security.md` §5, `07-api-contracts.md` "SURVIVED" | none of this audit's own; `app.routes.test.ts`'s fake pool records bound params |
| **SQL injection via identifiers** — the one admin-editable identifier, `sms.source_table` | Traced write-time, read-time, and point-of-use validation for the one place a client-supplied string reaches raw SQL identifier interpolation | **Triple-validated**: write-time (`lineConfig.updateSourceTable`), read-time (`defsFromRows`), point-of-use (`assertSourceTableName`, regex `^[A-Za-z_][A-Za-z0-9_]{0,127}$` — no brackets/quotes/semicolons possible) | `04-security.md` §5 | `verify.test.ts` |
| **Session cookie handling** (`api/src/auth.ts`) | Reviewed httpOnly/sameSite/secure/expiry/renewal/fixation | `httpOnly:true`, `sameSite:'strict'` hardcoded (cannot be widened by the `COOKIE_SECURE` escape hatch); session id = `randomUUID()` minted fresh on every login, no fixation; server-side invalidation on logout before cookie clear | `04-security.md` §5 | `auth.cookie.test.ts` (4 cases) |
| **Login rate limiting** | Reviewed dual-key (IP+username) lockout and its own documented prior IP-rotation-bypass fix | 8 fails/15 min/15 min lockout, keyed both axes; the fix for a previously-found IP-rotation bypass (dropping `trust proxy` by default) is in place | `04-security.md` §5 | not independently re-run live (would burn the shared account's rate-limit budget) |
| **PDF render token** (`auth.ts :: RENDER_TOKEN_COOKIE`) | Reviewed for external reachability | 244-bit random, 60s TTL, in-process Map only, never set via any HTTP response header to an external client | `04-security.md` §5 | none needed — not externally reachable by construction |
| **CSP / security headers** | Reviewed for wildcard/unsafe directives | Strict CSP (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, restrictive `Permissions-Policy`, HSTS correctly gated to `req.secure` | `04-security.md` §5 | none found; hand-rolled with in-file rationale |
| **CORS** | Grepped entire `api/src` for any CORS middleware | **None exists** — same-origin only, no wildcard `Access-Control-Allow-Origin` anywhere | `04-security.md` §5 | n/a |
| **Log/secret leakage** | Grepped logs and restart output for password/connection-string patterns | Zero hits; startup log logs only the DB *name*, never user/password | `04-security.md` §5 | n/a |
| **5 database-startup failure modes** (`api/src/index.ts`, second API instance on `:4100`) — nonexistent DB name, wrong password, connection refused, unroutable-host timeout, low-rights login (real `sms_readonly` misused against the wrong database) | Fresh process start under each doctored-env condition | Every case: a single structured JSON error log line, then a clean `process.exit(1)` — no crash loop, no hang past the driver's own bound (immediate for refused, 15s for timeout), no partial startup | `06-failure-recovery.md` §1 | none — structurally out of reach for the existing harnesses, which never construct a real connection pool |
| **Generic error handler, all routes** (fake-pool probe) | Injected query timeout, malformed row, missing column, unexpected NULL into every "target" query tried | **Every case: `500 {"error":"internal error","requestId":"<uuid>"}` — no raw SQL error text, no stack trace, no internal file path ever reaches the client**, full detail lands only in the structured server log | `06-failure-recovery.md` §4a–d | `app.routes.test.ts`/`app.rbac.test.ts` cover the shape indirectly |
| **Fire-and-forget audit logging** (login route) | Injected a timeout on the audit-log INSERT during login | **Login still succeeded (200)** — the audit write is genuinely best-effort, not a hard dependency of the auth path | `06-failure-recovery.md` §4a | none dedicated — first exercise of this specific behaviour |
| **A real historical interrupted ingestion** (sync_run 6889→6890, 15 Sep 2026, "orphaned: the worker was restarted mid-pass") | Read-only inspection of the worker's own past-run record and a sidecar-wide duplicate-id check | **Zero duplicate ids across the entire `cone_event`/`sack_event` tables today** (`n == distinct(id)` exactly, both tables, not just the affected window) — the watermark/overlap design survived a real interruption without double-counting | `06-failure-recovery.md` §3a | none — this is a historical record, not a test |
| **Generation-change halt mechanism** (a real source-DB swap, sync_run 6951–6954, 22 Sep 2026) | Read-only inspection of the worker's own halt log | **Halted BEFORE reading any row in all four target tables**, with a clear operator-facing message naming the mismatch and the remediation command, exactly as `CLAUDE.md`'s architecture section describes — the halt mechanism itself is sound (the operator's subsequent mislabeling, RT-008, is a separate, human-layer failure) | `06-failure-recovery.md` §3b | none — historical record |
| **`spc.ts`'s X̄-band validity gate** | Attempted n<3 contiguous subgroup pairs | **Refuses to draw a band rather than drawing a narrow or wrong one** — every rule sits inertly on the centreline when the band is unmeasurable | `10-analytics.md` SURVIVED | `spc.xbarBand.test.ts` (4 cases), `spc.subgroupSizing.test.ts` (14 cases) |
| **`rejectSpc.ts`'s n·p̄≥5 control-limit gate** | Conceptual attack with n=1/n=2 buckets | `rate` still reported (real) but `ucl`/`lcl`/`outOfControl` stay null/false — never a falsely-tight or falsely-wide band; the fix's own documented before/after numbers (a real n=2 bucket showing 33% UCL before the fix, vs ~2.7% for full days) were verified present in code | `10-analytics.md` SURVIVED | file's own header-documented measurement |
| **Reject episode contiguity across a generation or real time gap** | Conceptual attack at the Jul–Aug boundary | The `contiguous()` helper requires both same-generation AND a time-gap check — either condition alone ends a run; verified in code, not merely claimed | `10-analytics.md` SURVIVED | `rejectSpc.generations.test.ts` (3) |
| **`downtime.ts`'s generation predicate placement** | Verified the predicate sits **inside** the LAG-computing CTE, not applied after the window function runs | The one placement that actually prevents two interleaved generations from filling each other's gaps — verified structurally, not just claimed by comment; this is the mechanism behind the project's own documented 96.2%→44.1% correction | `10-analytics.md` SURVIVED | `downtime.generations.test.ts` (6) |
| **Night-shift midnight crossing, cone-to-day attribution** | 15 consecutive cone rows checked across the 22/23 June boundary | Zero disagreements — Readings and Report independently agree exactly (6,292 cones both ways) | `11-operational-edges.md` SURVIVED item 1 | `shared/src/domain/shift.test.ts` |
| **Replay banner visibility** | Navigated to `?s=line&at=2026-07-05T10:00:00Z` | A distinct, clearly worded banner renders (*"REPLAY — showing the plant as it was at..."*), conditioned on the server's own `replay: true` flag, not a client-side guess | `11-operational-edges.md` SURVIVED item 3 | not independently verified by a component test |
| **XLSX export, end-to-end** | Invoked live against the real `:4000` API for the first time in this project's history | **200 OK, 684 ms, 12,581 bytes, valid OOXML zip — 8 worksheet parts plus a real chart part** (not just styled cells) | `08-frontend-consistency.md` item 7 | `xlsx.test.ts` exists but had never been exercised against a live server before this pass |
| **PDF export, end-to-end** | Invoked live for the first time | **200 OK, 2,265 ms, 202,642 bytes, valid `%PDF-1.4`, 4 pages** — a genuine headless-Edge/Puppeteer-core render | `08-frontend-consistency.md` item 7 | `pdf.test.ts` deliberately excludes the real render per its own header comment; this is the first real exercise anywhere |
| **A 500,000-row hostile recordset** | Injected as the answer to `/api/rejects`/`/api/events` | The process itself did not crash and closed cleanly afterward — the finding (RT-014) is the *response size* (46.5 MB / 205 MB), not process stability, which held | `06-failure-recovery.md` §4e | none |
| **`api/src/app.rbac.test.ts`'s RBAC boundary matrix** | Structural review: 44 explicit route/rank pairs, each checked three ways per role against a REAL `createApp()` and real HTTP via `node:fetch` | All 19 `/api/admin/*` routes covered individually, **plus a canary that independently enumerates GET routes and would catch an admin route silently downgraded below rank 4 even if missing from the table entirely** | `09-test-coverage.md` §"SURVIVED" | 44 route/rank pairs, 3 checks each |
| **Zero test flakes** | `npx vitest run` 6 times in immediate succession today (5 by the coverage worker, 1 by W0) | **1660 passed / 4 skipped / 0 failed, every single run, 6/6** | `09-test-coverage.md` §6 | full suite |

---

## 9. Components that failed

Grouped by mechanism, cross-referencing the RT numbers above rather than
repeating them:

- **Generation-pooling in six report/analytics services** (RT-001, RT-002,
  RT-003, RT-009, RT-010, RT-029) — no epoch/generation predicate on a
  direct query against `sms.cone_event`/`sack_event`/`reject_event`,
  producing wrong headline numbers, arithmetically self-contradictory
  report rows, and a false provenance banner (RT-007) once the live
  generation happened to be the mislabeled simulator (RT-008).
- **"Missing field" collapsed into "true zero"** at three independent
  layers: client-side on Line's summary and grouped queries (RT-005,
  RT-012), client-side on Wall's per-station map (RT-013), and
  server-side on `production.ts`'s own row mapping (RT-015) — the same
  defect shape recurring at every layer Phase 7's client-only reliability
  programme did not reach.
- **A previously-fixed defect class reintroduced at an edge case**
  (RT-006) — the zero-lag-sample branch of `live.ts` falls through to the
  exact "confidently wrong stopped state" the 2 Sep 2026 fix targeted.
- **Statistical over-reach on the calibration advisory** (RT-019, RT-020)
  — the identical engine Weight.tsx suppresses for excessive false-positive
  rate runs unsuppressed on Calibration/StationSheet, measured (not
  inferred) at 78.6% station flag rate, with numeric day-projections from
  as few as 3–5 points.
- **Time-unaware configuration rules** (RT-022) — weight basis, tare, and
  shift boundaries are always read as "whatever is current," contradicting
  the app's own flagship time-versioning invariant, confirmed by real
  rule-change history including one real IFL-driven basis change.
- **Undocumented rows reachable through undefended paths** (RT-021,
  RT-030) — a 1970 clock-fault sentinel row can hijack the live "anchor"
  under replay; four (not the documented three) clock-fault rows remain in
  the canonical tables, unexcluded by any code path, and render as normal
  register entries reachable by URL.
- **Input-validation gaps at the HTTP boundary** (RT-016, RT-028, RT-034)
  — a calendar-invalid-but-regex-valid date 500s on 9 endpoints; two
  endpoints skip the shared range cap entirely; an unknown filter id is
  indistinguishable from a valid-but-empty one.
- **No defensive response-size ceiling** (RT-014) — a query returning far
  more rows than expected serializes and sends the whole thing, no cap, no
  streaming.
- **Test-coverage gaps that are structural, not incidental** (Section 10
  below) — every CRITICAL/HIGH finding in this audit was, by the coverage
  worker's own cross-check, invisible to the existing suite by
  construction, because every fixture in the suite is single-generation,
  single-path.

---

## 10. Test coverage gaps

*(drawn from `09-test-coverage.md`, the dedicated worker for this category)*

- **Structural screen coverage: 2 of 16 top-level screens (12.5%) have a
  real component/render test** (`Readings.test.tsx`, `Weight.test.tsx` +
  `Weight.sparkline.test.tsx`); a third (`Line.test.ts`) exists but tests
  only a pure helper function, never renders `<Line/>` or asserts on
  rendered text.
- **Route coverage: roughly 44 of ~79 endpoints have a central or
  route-local RBAC assertion**; RBAC-tested and data-correctness-tested are
  explicitly orthogonal axes in this suite — `app.rbac.test.ts` asserts
  precisely status codes, by its own stated design, never response bodies,
  which is exactly where every CRITICAL/HIGH finding in this audit lives.
- **Every "textual scan" guard in the repo** (`reliability.guard.test.ts`'s
  three guards, `targets.guard.test.ts`, `rank.crosscheck.test.ts`,
  `print.landscape.guard.test.ts`, `api.callers.test.ts`) is, by its own
  file-header admission, a deliberately-dumb regex/text scan over source
  files — proves the known-bad shape is *absent*, never that the code is
  *correct*. Each one's own documented blind spots were independently
  confirmed against the actual findings above: GUARD 1C cannot see
  `screens/report/*` (where RT-011 lives), `rank.crosscheck.test.ts` covers
  6 of ~25–32 routes (RT-026), and `weights.basis.test.ts`'s own test name
  actively encodes "always current" as correct — the wrong invariant,
  precisely (RT-022).
- **The throughline across findings RT-001/002/003/004/019/020/022:** every
  one is a cross-cutting or integration defect (two generations, two
  screens agreeing, a rule read at the wrong time, a real per-station noise
  series), and every test file found this pass that is genuinely strong is
  strong at a single-generation, single-path level. A suite built entirely
  from single-generation, single-path fixtures cannot, by construction,
  catch a defect whose entire nature is "two of these existing at once
  disagree." Independently confirmed: `rejectRateThreeWayAgreement.test.ts`'s
  own fixture uses 20 synthetic cones, all one `source_epoch`, one station,
  one day.
- **Flake rate:** 6 consecutive full runs today, 1660/1660 passing every
  time — the previously-reported ~1-in-74 flake was not observed in this
  small sample, neither confirming nor refuting its existence (expected
  ~0.08 failures across 6 runs at that rate).

---

## 11. IFL RFQ coverage

*(drawn from `12-rfq-coverage.md`, the dedicated worker for this category —
classifications reproduced verbatim per its own evidence, not re-derived)*

| # | RFQ requirement | Classification |
|---|---|---|
| 1 | Cone data acquisition and monitoring | **PARTIAL** — pipeline self-heals correctly (Section 8), but the *currently running configuration* is pointed at the simulator (RT-008) and the sync worker is not currently running under any process or service |
| 2 | Cone weight limit checking | **PARTIAL** — core classification mechanism is real (SURVIVED), but the plausibility/weight-basis rules gating it are not time-versioned (RT-022) |
| 3 | Reject monitoring/history/trends | **PARTIAL, disqualified from VERIFIED by CRITICAL defects** (RT-001, RT-003, RT-004) — headline reject-rate figures wrong by 43–75% relative depending on window |
| 4 | Product management and attribution | **PARTIAL** — attribution itself is real; the read-side UI shows a retired product as live with no marker (RT-018); PDAS write-back BLOCKED BY IFL |
| 5 | Sack data acquisition/history | **VERIFIED for acquisition mechanics** — zero duplicate ids sidecar-wide, no interruption double-counting |
| 6 | Sack stock management (subject to machine-ID availability) | **PARTIAL + BLOCKED BY IFL** — exactly as the roadmap's own conditional clause anticipates; no sack table in any generation carries a machine/station column — a data-availability fact, not a code defect |
| 7 | Dashboards and reports | **PARTIAL, VERIFIED for export mechanics only** — XLSX/PDF genuinely work end-to-end (Section 8); the *numbers* those same reports print are the ones proven wrong (RT-001–003); MachineProduct clips ~82% of its columns on screen with no fallback (RT-017) |
| 8 | Statistical calibration advisory | **PARTIAL, disqualified from VERIFIED by an evidenced HIGH-severity statistical-validity defect** (RT-019, RT-020) |
| 9 | Optional AI/ML calibration module | **NOT IMPLEMENTED, correctly deferred** — the roadmap's own data-volume gate (6–12 months) is nowhere near met (max real-data span is 53 days across two disjoint samples) |
| 10 | User/RBAC/security/audit | **PARTIAL** — security posture genuinely strong where tested (Section 8); below-rank live testing never exercised (BLOCKED, Section 2); client/server rank crosscheck covers ~6 of ~25–32 routes (RT-026) |

**Roadmap phases directly contradicted by `PROJECT_STATUS.md`'s own
COMPLETE markings**, per the RFQ-coverage worker's cross-check against this
audit's own evidence (not this audit re-litigating `PROJECT_STATUS.md`
directly — it was not independently re-read in full by this assembler):

- **Phase 5 (Reject management), marked COMPLETE** — contradicted by RT-001/
  RT-003/RT-004: three screens disagree on the same period's reject rate.
- **Phase 4 (Cone weight module), marked COMPLETE** — contradicted by
  RT-002: a live, on-screen arithmetic impossibility in the module's own
  output.
- **Phase 11 (Security & operations), marked COMPLETE except for items
  awaiting IFL** — contradicted by RT-014/RT-015 (no response-size cap;
  malformed rows silently read as zero server-side), both new findings this
  pass, in code this phase's own "without silent data loss" acceptance
  criterion should have caught.

**Blocked on IFL, confirmed genuine by this audit (not merely repeated
from CLAUDE.md):** PDAS write authorization (RT-024's `.env` comment
notwithstanding — the gate is genuinely closed); sack stock per machine
(structurally impossible from supplied data, independently confirmed);
weight basis/KPI approval; the 10 Jul–5 Aug data gap; the live read-only
login/host; below-rank live RBAC (this last one is blocked by the project's
own standing rule, not by IFL).

---

## 12. Production-readiness blockers

In no particular order (Section 13 orders them); each is a hard blocker to
telling IFL the system's numbers can be trusted or to installing against a
real plant database:

1. **The live sidecar's currently-open generation is mislabeled simulator
   data** (RT-008) — the root cause behind the majority of CRITICAL
   findings. Must be corrected (repoint `.env`, correctly `epoch:accept` a
   genuine IFL copy, relabel/close 13–16) before any further live
   verification is meaningful.
2. **Six services pool generations with no predicate** (RT-001, 002, 003,
   009, 010, 029) — must be fixed before Reject management (RFQ item 3) or
   Cone weight module (RFQ item 2) reporting can be shown to IFL as
   trustworthy.
3. **A false provenance banner** (RT-007) actively asserts the opposite of
   what the API response it sits above says — this is not merely wrong,
   it is actively misleading, and should block any demo using the current
   build against the current sidecar state.
4. **No below-rank live RBAC exercise has ever happened** (Section 2) —
   this blocks any claim that the RBAC design is production-ready, not just
   unit-tested.
5. **The calibration advisory's statistical validity is unestablished on
   the screen where it is unsuppressed** (RT-019, RT-020) — blocks calling
   this feature ready to replace the promised "AI" capability.
6. **No process supervisor exists anywhere in this deployment** (RT-023,
   and the general absence noted across `06-failure-recovery.md`) — a
   single Node process with nobody watching it, on a plant-floor
   installation, is an operational blocker independent of any code defect.
7. **Time-unaware configuration rules** (RT-022) will silently corrupt
   historical reports the moment IFL next changes a weight-basis or
   shift-boundary rule for real — this is not hypothetical; it already
   happened once (the 15 Sep 2026 gross-basis change) and the report layer
   does not yet know how to handle it correctly.

---

## 13. Recommended fix order

Ordered by what stops IFL being told something untrue first, then by what
stops an installation from proceeding — not by severity label alone.
Containment estimates are based only on what the evidence files state about
each mechanism's blast radius; none of these fixes were attempted by this
audit.

1. **RT-008 (root-cause mislabeling) — fix first, narrowly contained.**
   Repointing `.env`'s `IFL_DB_NAME_DATA` and correctly re-running
   `epoch:accept` is an operational/configuration action, not a code
   change; it does not by itself fix RT-001–003/007, but every other fix
   below is untestable against real conditions until this is corrected,
   because right now "real" and "simulator" data are commingled in the
   only live generation available.
2. **RT-007 (false banner) — narrowly contained, single component.**
   One component (`Running.tsx`'s disclosure text) reading the wrong
   source for its provenance claim. Highest priority among the code fixes
   because it is the one actively-false statement on the default screen,
   not merely a silently-wrong number.
3. **RT-001/002/003/009/010/029 (six unscoped services) — same fix
   pattern repeated six times, moderately contained.** Each fix is
   "thread the existing `GenerationScope`/`epochWhere` helper into one
   more query," a pattern already proven correct in 12 other consumers per
   `01-data-integrity.md`'s own inventory — mechanical, low-risk, but must
   be applied and verified per-file since each query's exact shape differs.
4. **RT-004 (client reject-rate re-derivation) — narrowly contained, two
   files.** `Line.tsx`/`Rejects.tsx` should read the server's already-
   correct field instead of recomputing; small diff, but needs the render-
   level guard test this class has never had, per RT-004's own "why tests
   missed it."
5. **RT-005/012/013/015 (missing-field-as-zero, four sites) — moderately
   contained, same fix shape at each site.** Presence-checking instead of
   `?? 0` defaulting, at Line's two query paths, Wall's per-station map,
   and `production.ts`'s server-side row mapping. RT-015 (server-side) is
   the most urgent of the four since it has no client-side equivalent
   defence at all today.
6. **RT-022 (time-unaware rules) — moderately contained but higher risk,
   touches 7+ call sites.** The fix pattern (`effective_from <= @asOf`)
   already exists and works for product limits; generalizing it to
   weight/shift rules is the same shape but touches more call sites and
   changes a test (`weights.basis.test.ts`) that currently encodes the
   wrong invariant and would need to be rewritten, not just extended.
7. **RT-019/020 (calibration advisory over-reach) — requires a product/
   statistics decision, not just a code change.** Either suppress the
   pattern-driven flag the way Weight.tsx already does, or state the
   measured false-flag rate on screen — this is a judgment call for the
   product owner informed by the measured 78.6%/12.7% figures, not a
   mechanical fix.
8. **RT-006 (zero-lag-sample edge case) — narrowly contained, one
   function's fallthrough branch**, but should be fixed before any go-live
   cutover rehearsal, since the failure condition is most likely to occur
   at exactly that moment.
9. **RT-014/016/028 (no response cap, invalid-date 500s, missing range
   cap) — narrowly contained per-item, moderate total effort across many
   call sites.** Each is a well-understood, mechanical input-validation or
   defensive-limit fix; the invalid-date fix (RT-016) is the highest-value
   single change since it touches a shared schema used by ~15 call sites
   at once.
10. **RT-021/030 (clock-fault sentinel/rows) — narrowly contained, one
    shared predicate.** Lower urgency than the items above because both
    are only reachable through a documented dev-only replay flag or a
    hand-edited URL, not normal operation — but trivial to fix once
    prioritized (a single `production_ts_utc_ms > 0`-shaped predicate
    applied at the read layer, or at ingest).
11. **RT-017/018 (MachineProduct overflow, retired-product-as-live) —
    narrowly contained, cosmetic/UI fixes**, but both are real, user-facing
    trust issues worth fixing before the next IFL-facing demo.
12. **RT-023/026/027 (process staleness, RBAC crosscheck gap, misleading
    login message) — operational hygiene, narrowly contained each,
    lower urgency.** None of the three currently produces a wrong number
    or a security hole; all three are exactly the kind of gap that turns
    into a production incident only when combined with bad luck at the
    wrong moment (e.g. RT-023 at a demo, RT-027 at cutover).
13. **RT-024 (`.env` comment mismatch) — trivial, single comment edit.**
    No live consequence today, but should be corrected before this file is
    read by anyone who has not also read the surrounding code, given how
    directly it contradicts CLAUDE.md's own record.
14. **RT-029/031–036 (remaining MEDIUM/LOW items) — lowest urgency,
    narrowly contained each.** Fix as capacity allows; none currently
    produces a proven wrong number on a live screen.

---

## Adjudication of the four named contradictions

### Contradiction #1 — Route count: three different answers

**UNRESOLVED. Print all three, as instructed.**

- **58** — the audit brief's own figure, which the security worker
  correctly could not source anywhere in the repo (`04-security.md` §1: "I
  cannot find a source in this repo that states 58 as a route count").
- **67** — the security worker's own count, by grepping every
  `app.get/post/put/patch/delete(` across `api/src/app.ts` and the seven
  files it mounts (`04-security.md` §1).
- **78 (or 79)** — the contracts worker's count: `grep -oE
  "app\.(get|post|put|patch|delete)\('[^']+'" api/src/app.ts
  api/src/routes/*.ts | grep -v test | grep -v "'\*'"` (excludes the SPA
  catch-all and every `.test.ts` file), returning 78 distinct
  method+path registrations: 58 in `app.ts` (minus the catch-all) + 21
  across `api/src/routes/*.ts` (`07-api-contracts.md` "Route count — 78,
  not 67"). The coverage worker independently arrived at "≈79 endpoints,"
  close to but not identical to this 78 (`09-test-coverage.md` §3),
  counting `app.ts`'s 58 (including the catch-all this time, so 57 API
  endpoints) plus 22 across `routes/*.ts` (a one-route discrepancy from the
  contracts worker's 21, unexplained by either file).

**How each counted, as the files themselves state it:** the security
worker's 67 came from a grep across `app.ts` **and** the seven route files
without excluding `.test.ts` files or the SPA catch-all (not explicitly
stated either way in `04-security.md`, but its table lists 78 numbered rows
minus the catch-all, and its own text says "67 distinct... pairs" derived
from that grep — the security worker's methodology description is less
precise than the contracts worker's exact grep command). The contracts
worker explicitly excludes `.test.ts` files and the `'*'` catch-all and
gets 78. The coverage worker's ≈79 used a very similar method but landed
one route higher.

**Not reconciled by any worker, including this assembler.** The contracts
worker explicitly logged this as unresolved (`07-api-contracts.md` §NOT
PROVEN item 5: "I did not find a plausible subset rule... that reproduces
67 from the current `app.ts`+`routes/*.ts` state. Not resolved."). Two
independent workers (contracts, coverage) converge on 78–79 using a
similar direct-grep method; the security worker's 67 does not reproduce
under either the contracts or coverage worker's counting rule, and the
brief's original 58 reproduces under none. **Best available reading:** 78
(or 79, one route apart between two workers using near-identical methods)
is the more reliable figure, since it is the one two independent,
precise, reproducible grep commands converge closest to — but this is an
assembly-time observation, not a resolution, and 67/58 are not
demonstrated wrong, only unreconciled. **Marked UNRESOLVED**, per
instruction.

### Contradiction #2 — Client-vs-server reject rate

**Both findings are printed as given (RT-004 above); neither is upgraded
or downgraded relative to the other. What would settle it, stated
explicitly.**

The calculations worker (`02-calculations.md` F1) **proved divergence** on
real September data by independently matching rejects to cones via SQL:
Line/Rejects screens compute **4.4%**, Report computes **4.59%**, on the
identical window (21 Aug–7 Sep... actually the full-September window used
in that file), traced to source: `Line.tsx`'s
`Math.round((1000*rejected)/(cones+rejected))/10` and `Rejects.tsx`'s
`(100*rejectCount.n)/(produced+rejectCount.n)` both use the raw `rejected`/
`rejectCount.n` count, while the server's `report.ts::toReportLine` divides
by `cones + unmatchedRejects` (excluding rejects that are the same physical
cone as an already-counted `cone_event` row — 98.1% of rejects match).

The frontend-consistency worker (`08-frontend-consistency.md` item 4)
**could not reproduce it** in an independently-chosen window (21 Aug–7 Sep
2026): both Line and the server read **5.9%** in that specific window.
This worker explicitly recorded **NOT PROVEN rather than refuted** — and
went further than a bare non-reproduction: it confirmed via `/api/production`
that in that same window, `rejectedCones` (3,456) and `unmatchedRejects`
(3,179) genuinely **do** differ (3,179 ≠ 3,456), meaning the mechanism that
would produce a visible gap is present in that window's data too — but did
not trace `Line.tsx`'s source to confirm which of the two fields the
rendered "3,456"/"5.9%" string is actually bound to. Its own conclusion:
"my spot check landed on a window where the two formulas happen to
coincide... **not as refuted**."

**Both are honest, and both stand as printed.** The calculations worker's
finding is a proven, reproduced, source-traced defect on the window it
chose; the frontend-consistency worker's finding is an honest non-
reproduction on a different window, with a specific, named, unresolved
question about which field is actually bound. **What would settle it**,
per both files' own account: trace `Line.tsx`'s exact rendered-string
source (not yet done by any worker) to confirm definitively whether it
reads `rejectedCones` or `unmatchedRejects` (or something else), and then
choose a window where those two fields are known to diverge by an amount
large enough to move the rounded percentage — the frontend-consistency
worker already found such a window exists (its own 21 Aug–7 Sep window has
`rejectedCones=3,456` vs `unmatchedRejects=3,179`, a 277-cone gap) but did
not push the field-trace the last step to confirm which one actually
renders.

### Contradiction #3 — Admin-route RBAC coverage

**Resolved. The corrected version is the one published (as instructed).**

The audit brief's own starting figure (15 admin routes, zero crosscheck
coverage) is superseded by two independent workers' direct counts:

- **19, not 15, `/api/admin/*` routes** — confirmed by both the security
  worker (`04-security.md` §2: "at least 19 additional `requireRole(N>1)`
  call sites") and the coverage worker (`09-test-coverage.md` finding 9:
  "counted 19 `/api/admin/*` routes in `app.ts` (not 15)").
- **`app.rbac.test.ts` DOES cover all 19 individually**, plus a canary
  that independently enumerates GET routes and fails if any `/api/admin/*`
  route is found at a rank other than 4 — confirmed by the coverage worker
  reading the file directly (`09-test-coverage.md` finding 9, citing
  `app.rbac.test.ts:219-280` for the 19-entry `ROUTES` table and `:468` for
  the canary).
- **The real, confirmed gap is `rank.crosscheck.test.ts`'s 6-entry
  client↔server pairing table having no completeness check** — this part
  of the brief's original framing is correct and is preserved as RT-026
  above. What is *not* correct in the brief's original framing is that the
  admin routes themselves lack server-side RBAC coverage; they do not —
  server-side RBAC for admin routes is real and thorough (both workers'
  independent conclusion).

**Published finding (RT-026):** the client/server crosscheck gap is real
and covers roughly 6 of ~25–32 elevated-rank routes total (a broader
category than just `/api/admin/*` — it also includes the PDAS product-write
routes, the second export route, and `/api/products/limits/local`), but
`/api/admin/*` server-side RBAC specifically is NOT part of that gap — it
is independently, thoroughly covered by `app.rbac.test.ts`'s own 19-route
table and canary.

### Contradiction #4 — Clock-fault rows

**Resolved. The documentation is wrong; three independent workers confirm
it identically.**

`CLAUDE.md`'s "Known constraints" section states: *"Two further dates
appear in the raw data and are excluded as clock faults: 1969-12-31 and
2026-06-21, holding 1 and 2 readings."*

Confirmed independently by the calculations worker (`02-calculations.md`
F4), the analytics worker (`10-analytics.md` W3I-4), and the operational-
edges worker (`11-operational-edges.md` OPS-1/OPS-2) — three separate
workers, three separate SQL queries, one shared conclusion:

1. **Four rows exist, not three**, in the **canonical** `sms.cone_event`
   table — epoch 1 (July) matches CLAUDE.md's documented count exactly
   (1969-12-31: 1 row; 2026-06-21: 2 rows), but **epoch 9 (September) adds
   a fourth, undocumented row** at 1969-12-31, confirming the fault recurs
   across the source rebuild rather than being a one-off from the original
   July sample.
2. **None of the four is excluded by any code path.** All four weights
   (1924–1959 g) pass the default 1500–2100 g plausibility band used
   throughout the analytics layer; no exclusion predicate for
   `production_ts_utc_ms <= 0` (or equivalent) exists anywhere under
   `api/src/services`, confirmed by grep by all three workers
   independently.
3. **The rows are live and reachable on screen** — the operational-edges
   worker confirmed the Readings screen renders the 1969-12-31 row as a
   normal register entry ("Wednesday, 31 December 1969: 2 weighed, 0
   rejected... 12:00 AM · 843007 · 1,947 g · Not judged"), reachable by a
   hand-typed or pasted URL with no widget interaction, and that the same
   row hijacks the live "anchor" query under the app's own documented
   replay mechanism (RT-021, HIGH severity in its own right).

**CLAUDE.md's "excluded" language describes an analyst-time manual count
exclusion (dropped from a document's own row-count narrative), not a coded
filter that was ever implemented** — this is the precise, corrected
characterization all three workers converge on independently, and it is
published as such (RT-030 above).

---

## 14. Evidence appendix

All findings above trace to the following scratchpad evidence files
(`C:\Users\ABDULL~1\AppData\Local\Temp\claude\C--Users-ABDULLAH-SAJID-Desktop-sag-database\e260368f-f6d2-4052-8f6e-96b97249f309\scratchpad\`),
each closing with its own affirmative no-write/no-mutation statement,
independently verified by this assembler to be consistent with `git status
--porcelain` showing only the one pre-existing, non-audit modification
(`VERIFICATION-2026-09-23.md`) throughout the audit round:

| File | Worker | Category | Key findings cited above |
|---|---|---|---|
| `00-environment.md` / `00-env-facts.json` | W0 | Environment baseline | RT-008, RT-023, RT-024 |
| `01-data-integrity.md` | W1-A | Data integrity | RT-001, RT-002, RT-009, RT-010, RT-032 |
| `02-calculations.md` | W1-B | Calculations | RT-004, RT-022, RT-025, RT-030 |
| `03-data-quality.md` | W1-C | Data quality | RT-005, RT-011 |
| `04-security.md` | W1-D | Security/AuthZ | RT-026, RT-035, RT-036, Section 8 (RBAC/CSP/CORS/etc.), Section 2 (the one write) |
| `05-over-claiming.md` | W2-E | No over-claiming | RT-006, RT-011, RT-012, RT-013, RT-033 |
| `06-failure-recovery.md` | W2-F | DB failure & recovery | RT-014, RT-015, RT-027, Section 8 (startup failures, ingestion recovery) |
| `07-api-contracts.md` | W2-G | API contracts + perf | RT-016, RT-028, RT-034, Contradiction #1 |
| `08-frontend-consistency.md` | W2-H | Frontend/backend consistency | RT-001–003 confirmations, RT-004 partial-check, RT-007, RT-017, RT-018, Section 8 (exports) |
| `09-test-coverage.md` | W2-J | Test coverage gaps | Section 10 in full, Contradiction #3 |
| `10-analytics.md` | W3-I | Analytics | RT-019, RT-020, RT-029, RT-030 confirmation, Section 8 (SPC/reject-SPC/downtime survivors) |
| `11-operational-edges.md` | W3-J | Operational edge cases | RT-021, RT-022 confirmation, RT-030 confirmation, Section 8 (midnight/replay survivors) |
| `12-rfq-coverage.md` | W3-K | RFQ coverage classification | Section 11 in full |

Cross-referenced, per the assembler's brief, but not edited: `DEFECTS.md`
(the project's own living defect register, cited by originating workers as
D-10/D-11/H5/H6 in several findings above — e.g. RT-019's discussion of
D-10's `spc.ts` measurement and its explicit non-extension to
`calibration.ts`) and `FRICTION-AUDIT.md`. Neither was independently
re-read in full by this assembler; both were left untouched, as instructed.

---

## Git

```
$ git status --porcelain   (before this file was written)
 M VERIFICATION-2026-09-23.md

$ git add -- ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md
$ git commit -m "..."
$ git status --porcelain   (after)
```

Commit performed by explicit pathspec only, per instruction — see the
commit hash returned to the caller.
