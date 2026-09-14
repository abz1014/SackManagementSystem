# SMS Strict Engineering Audit — 10 Sep 2026

> ## Fix status — 10 Sep 2026
>
> All 32 findings below (the CRITICAL, all 14 HIGH, all 11 MEDIUM, all 6 LOW)
> have been addressed in `floor-first-rework`, not yet committed. Full
> workspace typecheck, the full `vitest` suite (214 tests, including 6 new
> regression tests added for this pass), and a full production build
> (`shared`/`sync-worker`/`cli`/`api`/`web`) all pass clean.
>
> ### Validation round — same day, after the fixes
>
> The fixes were then reviewed by three independent passes and exercised
> against the live dev database and a running build. That found **13 further
> defects, 9 of them introduced or left incomplete by the fixes themselves** —
> all now fixed. The most consequential:
>
> - The C1 lock released itself mid-rebuild: its connection inherited
>   `min: 0, idleTimeoutMillis: 30000`, so the pool reaped it after 30 s and
>   SQL Server ended the session while the rebuild believed it still held the
>   lock. Its 60 s wait was also unreachable behind node-mssql's 15 s default
>   request timeout.
> - H1 fixed `pBar` but not the Home screen's own episode rate, which still
>   divided by cones — so the Attention sentence stated a rise and its
>   baseline on two different denominators. The quality and weight chart
>   series also no longer summed to the headline above them. Both corrected by
>   making `inspected` (cones + rejects of every type) the single denominator.
> - Readings' new filter made the header print an impossible percentage
>   ("40 weighed, 160 rejected by the scale (400.0%)") because the filtered
>   and unfiltered counts were mixed, and clearing the filter left `?rf=` in
>   the URL so a refresh silently reapplied it.
> - The new People controls could demote or deactivate the signed-in admin —
>   irrecoverable from the UI — and wrote one audit row per arrow-key press.
> - The H2 regression test was a tautology that passed against the bug it was
>   meant to pin. Rewritten, then verified by reverting the fix and confirming
>   it fails.
> - Two genuinely pre-existing bugs found by running the built stack: the SPA
>   fallback answered 500 for every non-API path under the relative `WEB_DIST`
>   value DEPLOY.md itself prescribes, and the Weight screen claimed
>   "Average cone weight is 0 g. Every station is steady." for a period in
>   which nothing was weighed.
>
> ### Second round — the seven that were left open
>
> All seven have since been closed:
>
> - **Two line reject rates over different populations.** The Weight/station
>   line total now counts the whole line, station or not, matching what the
>   Rejects headline counts. Its regression test pins the difference.
> - **M4's downstream asymmetry.** `dataAsOfUtc` and the current-run start now
>   span cones AND rejects, as "the newest production time on record" always
>   claimed to; `sinceLastConeSeconds` is renamed `sinceLastReadingSeconds`,
>   since it can hold a reject's age.
> - **H5's two-regime hazard.** Migration 023 stamps every canonical row with
>   the night rule that produced it, `/api/operations` reports any table
>   holding two, and Setup's Sync health says so in words. Previously nothing
>   could even detect it.
> - **Rejects' wasted fetch** before `/api/range` resolves — gated so nothing
>   is requested and no error state is set until the window is known.
> - **Access log** now covers every non-2xx except 304 (excluded because a
>   polled conditional GET answers 304 almost every time).
> - **The five remaining hands-on defects.** The stale copy was seven separate
>   inaccuracies — worst, the printed Report told IFL it "has been asked" a
>   question that `IFL_SACK_STOCK_QUESTION.md` still records as *drafted, not
>   yet sent*. The Line/Wall replay disagreement was real and severe: mid-shift
>   replay showed Line 78 sacks against Wall's 25, because `/api/production`
>   had no instant bound at all; both now read 25. Eleven formatting
>   inconsistencies traced to `fmt.ts` having no percentage helper. The
>   Pick-dates break was the whole page gaining a horizontal scrollbar below
>   ~885px, now wrapped.
> - **The `@types/node` mismatch** — fixed by matching express's own module
>   specifier, with no dependency change. Typecheck is now clean from cold.
>
> Verified live in a browser against the real dev data: the Current Product
> overlay (H3), both filtered "see these cones" links (H4 — 6 cones and 503
> cones, each matching the screen that promised them), the page reset (H12),
> the station not-found state (H13), error surfacing (H14), both corrected
> copy strings (M8), and the empty-period Weight headline. The migration
> chain was applied for real: 22 files applied, then all 22 skipped on a
> second run via the new history table.
>
> **Three items resolved as documentation/judgment calls rather than code
> changes**, because a code fix would have meant guessing at something nobody
> has decided:
> - **M3** (canonical `line_id` stamping): confirmed this can't be verified
>   against anything in IFL's row data with today's schema — documented
>   prominently at the exact code site instead of inventing a check with no
>   ground truth to check against.
> - **M10**'s `lot_code` half (PDAS's `MaterialDesc2` half **is** fixed and
>   wired end to end): left unpopulated on purpose, since PDAS's `Pallets.Lot`
>   has no confirmed material-level relationship to seed it from.
> - The **Wall screen**'s secondary pollers (part of H14) were deliberately
>   left as designed: that screen's own header comment specifies it must never
>   blank or show retry UI, which is incompatible with the `Failed`-component
>   pattern used everywhere else.
>
> **One pre-existing, unrelated issue found and left alone**: `tsc -b` reports
> a `keepAliveTimeoutBuffer` type mismatch in `app.rbac.test.ts` on a from-
> scratch build (no incremental cache) that predates this session — confirmed
> by checking out the original `HEAD` and reproducing it there unchanged. It
> is a `@types/node`/`@types/express` version-skew artifact, not a runtime
> bug (that file's 36 tests pass under `vitest`), and not one of the audited
> findings; fixing it would mean a dependency version decision, which is
> outside this task.
>
> See each finding below for what changed and why.

**Requested by:** project owner — *"open the software and softly check all the
components... I want a strict evaluation from your side as a senior software
engineer."*

**Scope:** the entire product as it stands on `floor-first-rework` — the
running app (hands-on, in-browser) plus the full codebase (sync-worker, CLI,
API, web) — verified wherever possible against the **real 19-day IFL data
copy** (`sms_real`, backfilled from `DATA_TP1U2`/`PDAS_TP1U2`, 2026-06-22 to
2026-07-10, 142,511 cones / 5,462 sacks / 2,900 quality rejects / 246 weight
rejects), not the synthetic simulator.

**Method.** Two passes:

1. **Hands-on**, in the running app in-browser, screen by screen, against
   live/replayed data.
2. **A 6-dimension code audit** — calculations, time/clock handling, the sync
   pipeline, frontend correctness, ops/test-coverage/production-readiness, and
   product fit against IFL's actual requirement list — run as review agents
   instructed to prove every claim with an actual SQL query against
   `sms_real`/`DATA_TP1U2`/`PDAS_TP1U2` (via the read-only `node q.mjs <db>
   "<SELECT ...>"` runner) rather than reasoning abstractly, followed by an
   adversarial verification pass.

Per explicit instruction this session, **no more than 3 subagents ran at any
one time**, in either phase.

I then **personally re-verified by hand** — direct `Read`/`Grep`/`Bash`, zero
additional agents — the highest-impact claims before writing this document.
Each finding below is marked:

- **[VERIFIED BY ME]** — I read the exact file/lines or ran the exact query
  myself, this session, and confirmed the claim.
- **[AGENT-VERIFIED]** — not independently re-checked by me, but the finding
  already carries a specific file/line citation and, in most cases, an actual
  query result against real data, produced by the review/verification agent
  pipeline (which itself included an adversarial refutation pass).

Nothing in this document is a guess or an extrapolation from "this looks like
it could be a bug" — every item names the file, the line, and (where
applicable) the real-data numbers that prove it.

---

## Verdict

The engineering fundamentals — auth, SQL safety, clock handling, the SPC
statistics — are stronger than most solo-built internal tools. But the audit
found **numbers that are wrong on screen**, **a headline feature that doesn't
exist where the docs say it does**, and **a genuine data-integrity race
condition**. This is not ready to demo to IFL again without the HIGH items
fixed, and not ready to run unattended on the plant for a year without the
CRITICAL item fixed.

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 14 |
| MEDIUM | 11 |
| LOW | 6 |
| Hands-on UI defects (separate pass, already reported) | 6 |

---

## CRITICAL

### C1. No lock between `sms rebuild` and the always-on sync-worker service

**Files:** `sms/cli/src/commands/rebuild.ts`; `sms/sync-worker/` (continuous
60s loop service).

Nothing — no `sp_getapplock`, no mutex, no lockfile — coordinates the CLI's
`sms rebuild` command against the sync-worker service, which runs continuously
and shares the exact same watermark keys (`sms.app_config`
`transform_wm_*`) and canonical tables (`sms.cone_event`, `sms.reject_event`,
etc.) that rebuild deletes and repopulates.

**[VERIFIED BY ME]** — confirmed via `grep -n "applock\|mutex\|lockfile\|LOCK"`
across `sms/cli/src/` and `sms/sync-worker/src/`: zero hits. No locking
primitive of any kind exists in either service.

Concrete interleavings this allows:

- Sync-worker's 60s tick runs its own transform in the middle of rebuild's
  canonical `DELETE` → sync-worker's transform reads a partially-emptied
  canonical table, or writes new canonical rows that rebuild's subsequent
  re-insert then collides with on the unique merge-key index.
- Sync-worker advances a watermark key while rebuild is mid-run → rebuild's
  own watermark write afterward silently **rewinds** it, defeating the
  incremental-scan optimization (the next sync re-scans from further back
  than necessary — a performance regression, not just a correctness one).
- Either process's insert collides with the other's on `UX_cone_merge` (the
  unique index on `(line_id, production_ts_utc_ms, hanger_num, ingest_seq)`)
  → an uncaught SQL exception.

**Compounding defect — no `catch` block in `rebuild.ts`.**
**[VERIFIED BY ME]** — read the file directly:

```
try     → line 31
finally → line 71
catch   → absent entirely
```

Any exception thrown after the canonical `DELETE` and before the re-insert
completes — whether from the race above or from an ordinary transient SQL
error — leaves the canonical table **empty** and `rebuild_audit.outcome`
permanently stuck at its default value of `'running'`. There is no
`outcome='failed'` state; a stuck `'running'` row and an empty production
table look, from the outside, exactly like a rebuild that is still in
progress.

**Why this matters:** `DEPLOY.md`'s own documented rebuild workflow (the Q7
shift-rule-change fix path) never instructs the operator to stop the
sync-worker service first. As written, following the documented procedure on
a live plant is unsafe.

**Fix:** take an application lock (`sp_getapplock`) at the start of rebuild,
held for its duration, and have the sync-worker's tick loop check/skip if it
can't acquire the same lock; add a `catch` that sets `outcome='failed'` and
records the error before rethrowing/exiting.

---

## HIGH — wrong numbers on screen, or a feature that isn't where it's claimed to be

### H1. `rejectSpc.ts` — the reject rate excludes the rejects it's measuring

**File:** `sms/api/src/services/rejectSpc.ts`, lines ~75-115.

**[VERIFIED BY ME]** — read the full block directly (`sed -n '75,115p'`):

```ts
const producedRes = await pool.request()...query<{ bucket_ts: Date; n: number }>(
  `SELECT ${bucketExprCone} AS bucket_ts, COUNT(*) AS n
   FROM sms.cone_event WHERE line_id=@line AND shift_date BETWEEN @from AND @to
   GROUP BY ${bucketExprCone}`,
);
// rejectsRes queries FROM sms.reject_event, same shape, into rejectsMap
const producedMap = new Map(producedRes.recordset.map((r) => [r.bucket_ts.getTime(), r.n]));
const rejectsMap = new Map(rejectsRes.recordset.map((r) => [r.bucket_ts.getTime(), r.n]));
const totalProduced = [...producedMap.values()].reduce((s, v) => s + v, 0);
const totalRejects = [...rejectsMap.values()].reduce((s, v) => s + v, 0);
const pBar = totalProduced > 0 ? totalRejects / totalProduced : null;
```

`totalProduced` is summed **only** from `cone_event` — it never adds
`reject_event`'s own count to its own denominator. So `pBar`, `rate`, and
every per-bucket rate the p-chart plots is `rejects / cones_only`, not
`rejects / (cones + rejects)`.

This directly **contradicts the Rejects screen's own correct formula**,
printed right above the chart this feeds (`Rejects.tsx` lines 88-89):
`ratePct = totalRejects / (produced + totalRejects)`. It also contradicts the
convention used correctly elsewhere in `report.ts` and `weightStations.ts`.

**Real-data magnitude (from the review agent's query against `sms_real`,
cited with the finding):**

| Period | Shown (wrong formula) | Correct | 
|---|---|---|
| 2026-07-07 | 5.42% | 5.14% |
| Full 19-day range | 2.208% | 2.160% |

This feeds: the Rejects trend chart, its hover tooltips, the p-chart control
limits, episode/"rising" detection, and the Home screen's Attention "reject
rise" finding — every one of them is silently off by this amount.

**Fix:** `totalProduced` (and every per-bucket denominator) must be
`cones + rejects`, matching `Rejects.tsx`'s own formula.

### H2. `weightStations.ts` — the line-level reject rate averages percentages instead of volume-weighting them

**File:** `sms/api/src/services/weightStations.ts`, ~line 160 area.
**[AGENT-VERIFIED]**, cited with a real-data comparison: the line rate is
computed as an unweighted average of the 14 stations' own reject
percentages — the classic average-of-ratios error, which is only correct if
every station handles the same volume (they don't). Real-data comparison:
**2.03% shown vs 2.16% correct** (volume-weighted). Shown on the Station Sheet
directly beside each station's own rate, inviting a direct — and wrong —
comparison.

**Fix:** `sum(rejects across stations) / sum(cones across stations)`, not
`mean(station rates)`.

### H3. "Current Product" — the headline changeover feature is unreachable through the UI

**Files:** `sms/web/src/App.tsx` line 219; `sms/web/src/screens/Setup.tsx`.

**[VERIFIED BY ME]**:

- `App.tsx:219` — `onChangeProduct={() => go({ view: 'setup' })}`: clicking
  "Change" on the Line screen navigates to Setup with **no product-picker
  mechanism** — it's a dead end.
- `Setup.tsx` — grepped for every top-level section function. Exactly five
  exist: `SyncHealth()` (line 44), `Stations()` (line 121), `RulesBlock()`
  (line 192), `People()` (line 225), `AuditLog()` (line 262). **No
  product-related section exists anywhere in the file.**

The backend is fully built — service, migration, API routes all exist — and
the dialog copy is already drafted and sitting unused in `words.ts`
(`product.pdasActive` etc.). None of it is wired to a UI entry point.

**Why this is HIGH, not MEDIUM:** this is the feature that resolves IFL's
blocking question Q1 and answers requirement 3 ("screens to view and update
product details"). **`CLAUDE.md` currently states this as complete** — the
"Still to do" list in the redesign sign-off doesn't flag it as missing. It
will be discovered for the first time live, in front of IFL.

**Fix:** either add the missing product-picker entry point to Setup (the
backend is ready — this is a UI-only gap), or correct `CLAUDE.md` to state the
gap explicitly so it isn't demoed as working.

### H4. Three "see these specific cones" links all open the same unfiltered register

**File:** `sms/web/src/App.tsx`, lines 216, 238, 245 (`view: 'readings'` /
`onNavigate` calls); the `Route` interface itself.

**[VERIFIED BY ME]** — grepped all three call sites. None pass any filter
parameter, and the `Route` type has no field to carry one.

Three separate screens each promise a specific, identifiable subset of cones:

- Weight's disagreement banner ("37 cones passed by the scale but outside
  limits — see them")
- Rejects' "see the rejected cones"
- Line's attention list entry

All three navigate to the same unfiltered cone register. A manager reading
"37 cones outside limits" clicks through and gets the full, unfiltered
register with no way to locate the 37. The inspection-reject population these
links reference has **zero** UI entry point anywhere, despite full backend
query support for it.

**Fix:** extend `Route`/`go()` to carry a filter (e.g. a reject/flag
predicate or an id list) and have Readings honor it on load.

### H5. The shift night-rule admin endpoint lies about what it does

**File:** `sms/api/src/app.ts`, line 973 (`/api/admin/rules/shift`).

**[AGENT-VERIFIED]**, cited with the exact contradiction: the endpoint writes
to `sms.shift_rule` and replies with a success message telling the operator to
"rebuild canonical to apply." But the transform (`runTransform.ts`) **never
reads `sms.shift_rule`** — it reads a static environment variable fixed at
process start. A rebuild after using this endpoint silently re-derives the
**old** rule; the write is inert.

This is directly relevant to the still-open Q7 decision (shift
fix-vs-reproduce), which this endpoint exists to resolve.

**Fix:** either make the transform read `sms.shift_rule`, or remove the
endpoint (and its misleading response) until it does.

### H6. `trailingWindow()`'s "last 14 production days" claim will overclaim from day 1 of go-live

**File:** `sms/web/src/lib/period.ts`, `trailingWindow()` at line 169.

**[AGENT-VERIFIED]**: the function's own comment states it should never claim
a window reaching back past the first day actually on record, and it has a
`firstDay` clip parameter built for exactly that purpose — but **no
production call site ever populates it** (`App.tsx:173-179`, `Rejects.tsx:
45-53` both call it without the clip). The fix already exists server-side
(`/api/range`'s `minDate`) — it is simply never wired to this call.

**Consequence:** on days 1-13 after the live cutover (repointing
`IFL_DB_SERVER`), every screen using this window will say "last 14 production
days" while only 1-13 actually exist, silently including empty/future
buckets in whatever it's driving (station drift, attention list, reject
episode detection all use exactly this window per the redesign's own rule #3).

**Fix:** thread `/api/range`'s `minDate` through to every `trailingWindow()`
call site.

### H7. Data-quality checks silently skip quality-type rejects entirely — only weight-type rejects are checked

**File:** `sms/sync-worker/src/transform/runTransform.ts` — `computeFindings`
(the DQ-check function).

**[AGENT-VERIFIED]**: `computeFindings` is invoked only on the weight-type
reject batch (`w`) — never on the quality-type batches (`q`/`qFresh`). On the
real data, quality rejects outnumber weight rejects roughly **12:1** (2,900
vs 246). This means clock-fault detection, missing-station detection, and
merge-collision detection are effectively disabled for ~92% of all reject
rows.

**Why this is HIGH:** this is the exact same bug *class* — a phantom or
mis-attributed production day slipping through undetected — that was already
found and fixed once on the cone stream (the `Math.min(...spread)` stack
overflow fix, commit `e86357f`, was discovered via this same kind of check).
It has silently regressed for the much larger quality-reject population.

**Fix:** call `computeFindings` on the quality batches too (or a merged batch
covering all reject types).

### H8. `.env.example` is missing two required, no-default environment variables

**File:** `sms/.env.example`.

**[VERIFIED BY ME]** — grepped for `PORT`: only `API_PORT=4000` is present.
`APP_DB_PORT` and `IFL_DB_PORT` are **entirely absent**, while
`api/src/config.ts:61` and `sync-worker/src/config.ts:35` both declare these
as required (`z.coerce.number().int().positive()`, with **no** `.default()`).

**Consequence:** a fresh deployment following `DEPLOY.md`'s own documented
first-time-setup steps (copy `.env.example` → `.env`, fill in placeholders)
will crash **both** the API and the sync-worker at startup with a config
validation error, because two required variables are never in the template
to begin with.

**Fix:** add `APP_DB_PORT=1433` and `IFL_DB_PORT=1433` (or whatever the
correct defaults are) to `.env.example`.

### H9. `GET /api/operations` runs two full-table-scan window functions on an unindexed column, polled every 60 seconds

**File:** `sms/api/src/services/operations.ts`, lines 71-98.

**[AGENT-VERIFIED]**: two separate `PERCENTILE_CONT(...) OVER (...)` queries
against `sms.sync_run`, with no supporting index on the column they filter/
order by (confirmed absent in the migration files — see O1 below). This
endpoint backs `Setup.tsx`'s `SyncHealth` panel, which polls it every 60
seconds for as long as anyone has Setup open. `sms.sync_run` has no retention
policy (see O2), so this cost grows unboundedly over the life of the
deployment.

**Fix:** add an index supporting the ordering/filter these queries use, and/
or cap the window they scan (e.g. only the last N days of `sync_run`).

### H10. The API's global error handler discards the stack trace and all request context; no request/access log exists

**File:** `sms/api/src/app.ts`, line 1022.

**[AGENT-VERIFIED]**: the Express error handler's first parameter is named
`_req` (unused) and only `err.message` is logged — never `err.stack`. No
HTTP request/access-log middleware exists anywhere in the API.

**Consequence:** when the plant calls about a 500 at 2am, on-call's entire
diagnostic artifact is a bare `api error: <message>` string, with no request
path, no user, no stack trace, and no record of what requests preceded it.
This is a strictly worse position than the sync-worker's already-known
message-only logging gap.

**Fix:** log `err.stack`; add a minimal request logger (method, path, status,
duration) at minimum for non-2xx responses.

### H11. Zero test coverage on the exact layer that already shipped a production-breaking bug

**Files:** `sms/sync-worker/src/transform/`, `sms/cli/`.

**[AGENT-VERIFIED]**: the entire sync/transform/CLI layer — the code that
shipped the 142,511-row `Math.min(...spread)` stack overflow (fixed in
`e86357f`) — has **zero** test files. No test was added alongside that fix
either. The SPC computation layer (`spc.ts`, `rejectSpc.ts`) and both
reject-rate bugs above (H1, H2) are in the same position: nothing will catch
a regression, and nothing currently fails even though the formulas are
already wrong today. Total test count in the repo: 17-20, none touching these
paths.

**Fix:** at minimum, a regression test locking `rejectSpc.ts`'s `pBar`
formula and `weightStations.ts`'s line-rate formula to the correct
(volume-weighted, rejects-in-denominator) values, plus one test exercising
`runTransform.ts` against a large batch to guard the stack-overflow class of
bug.

### H12. Readings page number is never reset when the global period changes

**File:** `sms/web/src/screens/Readings.tsx`, `page` state ~line 69; `sms/
api/src/services/register.ts` lines 162-177.

**[AGENT-VERIFIED]**: `register.ts` runs the total count (`COUNT(*)`) and the
current page's rows (`OFFSET`/`FETCH NEXT`) as two independent queries.
`Readings.tsx` never resets `page` to 1 when the period control changes.
Narrowing the period while parked on, say, page 4 produces a truthful-looking
non-zero header count ("80 cones weighed") over a **visibly empty table**,
with the pager hidden because the page-count check (`pages <= 1`) is now
satisfied by the smaller total.

**Fix:** reset `page` to 1 in the effect that reacts to period changes.

### H13. StationSheet has no "not found" state — an invalid station id spins forever

**File:** `sms/web/src/screens/StationSheet.tsx`, line 71.

**[AGENT-VERIFIED]**: `const row = data?.stations.find(...) ?? null` has no
branch for "row is null and the fetch succeeded" — only loading and
loaded-with-data are handled. An invalid or stale `?sheet=station:<id>` (e.g.
a bookmarked link to a station that was renamed or removed) renders
`<SkelLines n={5} short />` forever, indistinguishable from a slow network.

**Fix:** add an explicit not-found branch when `data` has loaded but no
matching station exists.

### H14. Secondary pollers across Line, Weight, Wall, and 3 of Setup's 5 sections never check `.error`

**Files:** `sms/web/src/screens/Line.tsx`, `Weight.tsx`, wall screens;
`sms/web/src/screens/Setup.tsx` (`RulesBlock`, `People`, `AuditLog`).

**[VERIFIED BY ME]** for the `Setup.tsx` half of this finding — grepped the
file directly and confirmed:

- `Stations()` (line 121) is the **one** section in the file that correctly
  implements `setError` + `<Failed error={error} onRetry={load}/>`.
- `People()`'s fetch ends in `.catch(() => setUsers([]))` (~line 228) —
  a failure renders as "no users," not an error.
- `AuditLog()`'s fetch ends in `.catch(() => setRows([]))` (~line 265) —
  a failure renders the **false positive** sentence "Nothing has been changed
  through this application yet." to an admin who is specifically there to
  audit access control.

**[AGENT-VERIFIED]** for the Line/Weight/Wall half: their secondary (non-
primary) pollers have the same pattern — a persistent API failure is
swallowed into an empty/default state rather than surfaced. Worst instance
cited: Line's attention list renders "Nothing needs attention" when the
underlying check itself failed to run, which is the opposite of what an
attention list is for.

Because `Stations()` in the very same file does this correctly, this is
demonstrably an inconsistency in the codebase, not a considered design
choice.

**Fix:** apply the `Stations()` pattern (`setError` + `<Failed>`) uniformly
to every fetch that currently swallows into an empty array/false state.

---

## MEDIUM

**M1.** Station-level drift/live/SPC queries group by `source_station` on
`cone_event`/`reject_event`, and neither table indexes that column
(`003_cone_event.sql`'s indexes — `IX_cone_prod_ts`, `IX_cone_shift_date`,
`IX_cone_source`, `UX_cone_merge` — none actually cover `source_station` as
the review agent traced the query plans). Invisible at 200k rows; a real cost
at year-2 volumes (~1GB/year projected growth, see O-below).

**M2.** Migrations share one un-transacted batch between table creation and
its indexes, with no schema-migration history table. A mid-batch failure can
permanently strand a table with missing indexes and leave no record that this
happened.

**M3.** `canonical` rows are stamped with the **process's own configured**
`line_id`, never the raw row's actual line. Dormant and harmless with one
line; becomes a silent cross-contamination hazard the moment a second line is
added — which `CLAUDE.md`'s own scalability note explicitly anticipates.

**M4.** Stoppage/idle detection watches only `cone_event` gaps. A span of
time producing rejects but zero good cones reads as full downtime. One real
instance of this was found in the 19-day data.

**M5.** `/api/product-at`'s empty-database edge case falls back to raw
`Date.now()`, off by the plant's UTC offset — a narrow instance of the
project's own "never compare production time to now unconverted" rule
(`app.ts` line 381).

**M6.** No runtime assertion that the deployment host's OS timezone actually
matches the plant's. The entire two-clocks design (`plantClock.ts`) silently
breaks by exactly 5 hours if it doesn't — with no error, just wrong numbers.

**M7.** A sack's timestamp is documented as insert-time rather than
weighing-time, and that distinction is captured end-to-end in the data model
— but the flag is never surfaced anywhere in the UI.

**M8.** `words.ts` line 283, `byStationNote: 'opens the Weight station table
sorted by reject rate'` — **[VERIFIED BY ME]**: describes behavior that does
not exist. The table's actual sort, per `weightStations.ts:160`, is
flagged-then-distance-from-target; there is no reject-rate sort code path
anywhere in the file.

**M9.** `015_calibration_adjustment.sql` has no grams/amount column, though
`REDESIGN.md` §5.3 specifies the calibration log must capture "station,
signed grams, time, why." The log currently cannot record the one number a
calibration adjustment is actually about.

**M10.** `sms/sync-worker/src/seed/seedProducts.ts`, line 38 —
**[cited with a direct query against `PDAS_TP1U2`]**: the Materials query
selects `MaterialDesc1` but never `MaterialDesc2`. Confirmed via direct query:
`MaterialId 11` has `MaterialDesc2='PARROT'`, `MaterialId 18` has
`'Khaki-2'` — real, meaningful color data is silently dropped before it ever
reaches the app. `Pallets.Lot` is similarly dropped; `lot_code` exists as a
column but is dead, unpopulated plumbing.

**M11.** `sms/web/src/ui/Bar.tsx`, line 87 — **[VERIFIED cited]**:
`todayRange()`, the default "Pick dates" range, uses `new Date()` (the
browser's clock) instead of the `plantNowUtc` prop already passed into the
component. This reintroduces, in one specific spot, the exact browser-vs-
plant-clock bug class the project's own `CLAUDE.md` says was "learned the
hard way" and fixed everywhere else.

---

## LOW

**L1.** Dead local-timezone shift-computation helpers still sit in the
codebase next to the correct UTC-based ones used in production paths —
confusing to a future reader, not currently wrong.

**L2.** "Plant now" is computed independently in three separate places, with
only partial cross-checking between them.

**L3.** `DEPLOY.md` instructs operators to set `SESSION_SECRET`, but nothing
in the codebase reads that variable — dead documentation.

**L4.** The backup script's own header comment states its default SQL login
must never be used for backups, yet that is the default the script ships
with. It fails loudly rather than silently (caught in a prior backup
rehearsal), so the risk is operator confusion, not silent data loss.

**L5.** No documented plan for SQL Server Express's 10GB database ceiling.
Projected growth is ~1GB/year, so there are years of runway — but it is
unplanned and unmentioned anywhere.

**L6.** Setup's People section is read-only — there is no way to create or
edit a user account from the UI; it must be done via the CLI's
`user:create`.

---

## Hands-on UI defects (separate, earlier pass against the running app)

These were found and reported in an earlier pass of this same audit by
directly operating the running app in-browser (not via code review), and are
restated here for completeness so this document is the single record of the
full audit:

1. A stale sentence referencing behavior/data no longer applicable to the
   current screen state.
2. A layout break in the "Pick dates" control under certain window widths.
3. A sentence-fusion bug on the Weight screen when the selected period
   contains zero readings (two clauses concatenate without the separator
   they need).
4. The Rejects screen's headline word ("steady") can contradict its own
   episode list — the headline describes only the newest day while episodes
   describes the whole window.
5. Line and Wall can disagree on the current sack count when viewed under
   `?at=` replay, due to differing refresh/anchor timing between the two
   screens.
6. Minor formatting inconsistencies (spacing/rounding) in a small number of
   figure displays.

*(Fix status: not yet re-verified in this pass; flagged in the prior hands-on
session and not addressed as part of this audit, which was evaluation-only
per the owner's request.)*

---

## What's genuinely strong (reconfirmed under this harder pass)

- **SPC methodology is textbook-correct**: pooled within-subgroup sigma,
  X-bar/S control charts, all 8 Nelson rules, Cp/Cpk/Pp/Ppk implemented
  properly.
- **Shift-date attribution** was checked at every boundary; two independently
  written implementations (sync-worker's transform and the API's own
  recomputation) agree exactly on the real data.
- **The 18-minute acquisition-lag correction** (`live.ts`) is subtle and done
  right: a measured median over real rows, with separate "shown to a person"
  and "used to judge whether the line is running" values.
- **RBAC has real anti-drift test coverage** that walks the actual router
  rather than asserting against a hand-maintained list.
- **Login uses timing-safe comparison and rate limiting** — beyond what most
  internal tools bother with.
- **Dynamic SQL is consistently parameterized** despite heavy fragment
  construction (`tableFor`/`sortCol` pattern over closed TypeScript unions,
  never raw input) — no injection surface found across either audit pass.
- **The backup script was actually rehearsed** and caught three real
  SQL-Server-Express-specific bugs before they could hit production.
- A claim that looked like over-reach on inspection — "95 of every 100 cones
  fall in this range" — checked out almost exactly against the real
  142,511-cone distribution.

---

## Recommended fix order

1. **H1 + H2** — the two reject-rate formulas. Five-minute fixes, highest
   visibility (wrong numbers on the two screens most likely to be scrutinized
   live).
2. **H3** — wire up Current Product, or correct `CLAUDE.md`'s claim that it's
   done, so it isn't discovered live in front of IFL.
3. **C1** — the rebuild/sync-worker lock, or at minimum a documented "stop
   the service first" step in `DEPLOY.md`, before `sms rebuild` is ever run
   again against real data.
4. **H8** — add the two missing `.env.example` ports before the next fresh
   deploy.
5. **H4, H5, H6, H7** — the dead links, the lying admin endpoint, the
   overclaiming 14-day window, and the DQ-skips-quality-rejects gap — all
   real but lower-traffic-path than 1-4.
6. Everything else (H9-H14, all MEDIUM, all LOW), roughly in the order
   listed above.

No code changes have been made as part of this audit — it was evaluation
only, per the original request. Say the word on any item and I'll fix it.
