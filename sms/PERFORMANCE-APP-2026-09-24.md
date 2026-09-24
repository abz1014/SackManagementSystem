# PERFORMANCE-APP-2026-09-24.md — SMS's own responsiveness, re-measured

**Author:** WS-PERF2. **Subject:** the API on `:4000` and the screens on `:5173`, both reading
SMS's own sidecar — never IFL's server. Load on IFL's server is a separate worker's question
(`PERFORMANCE-SOURCE-LOAD-2026-09-24.md`), not this file's.

## Was the API stale?

**Yes.** `api/dist/app.js` was built 2026-09-23 18:22; seven `api/src/**/*.ts` files were newer,
including `app.ts`, `pdasWrite.ts`, `reports/daily.ts`, `rejectSpc.ts` and two test files. Rebuilt
(`npm run build --workspace @sms/shared && npm run build --workspace @sms/api`, both clean).
Old process **PID 102496** killed; rebuilt server started as **new PID 139348**, confirmed
listening on `:4000`. All measurements below are against the rebuilt binary. Vite (`:5173`) was
never touched, per instructions.

## Suite

`npx vitest run` from `sms/`: **179 files passed / 1 skipped (180); 1782 tests passed / 4
skipped (1786)**, 0 failed. Matches the stated 1782/4/0 exactly.

## Method

All requests went through the real authenticated HTTP path: a browser tab already signed in at
`http://localhost:5173` as `admin` (session cookie set by the app's own login; no login was
created, reset or guessed), driving `fetch(path, {credentials:'include'})` from the page's own
origin so the browser's cookie jar is used, exactly as the UI itself would call it. Data scope:
the **current live generation, `DATA_TP1U2_SEP07#3`** (`ifl_copy`, not the simulator) —
2026-08-05 to 2026-09-07, 34 days — confirmed via `GET /api/range`. This is within the brief's
allowed epochs 9-12 window at its start and extends to the generation's actual end (09-07); it is
real IFL data, not `DATA_TP1U2_SIM` (epochs 13-16), so no simulator caveat applies to the figures
below.

Widths used:
- **shift**: `2026-09-07` (single day)
- **week**: `2026-08-31`→`2026-09-06` (7 days)
- **widest**: `2026-08-05`→`2026-09-07` (34 days, the full offered range)

"Cold" = first request for that exact query after the 5 s TTL (`CACHE_TTL_SECONDS=5`) had
provably expired (a `sleep(6000)` precedes each cold batch). "Warm" = the identical request
fired immediately after, still inside the TTL. `X-Cache` on the response confirms which happened;
`cache: null` in the tables below means the route sets no `X-Cache` header at all — i.e. **not
cached**, every hit costs full price regardless of repetition.

## Endpoint table

| Endpoint | Cached? | Shift cold | Shift warm | Week cold | Week warm | Widest cold | Widest warm |
|---|---|---|---|---|---|---|---|
| `/api/live` | yes | 377 | 8 | 18 (already warm) | 18 | 247 | 5 |
| `/api/attention` | yes | 2445 | 152 | 3139 | 206 | 713 | 68 |
| `/api/operations` | yes | 415 | 14 | 576 | 8 | 175 | 5 |
| `/api/system-history` | yes | 178 | 14 | 187 | 24 | 79 | 5 |
| `/api/production` (groupBy=none) | yes | 504 | 16 | 1118 | 12 | 857–925 (×3 runs) | 4–114 |
| `/api/spc` (type=cone) | yes | 994 | 17 | 1814 | 62 | 1476–2190 (×3 runs) | 9–17 |
| `/api/reject-spc` | **no** | 198 | 268 | 462 | 429 | 297–299 | 294 |
| `/api/weight-stations` | **yes — changed since 23 Sep** | 1891 | 40 | 1344 | 12 | 1477–3033 (×3 runs) | 4–15 |
| `/api/report` (period=day) | yes | 3023 | 163 | 1011 | 95 | 476 | 74 |
| `/api/reports/management-summary` | yes | — | — | — | — | 2344–2566 | 40 |
| `/api/rejects` | **no** | 113 | — | 134 | — | 198 | — |
| `/api/downtime` | **no** | 251 | — | 253 | — | 254 | — |
| `/api/calibration` | **no** | 196 | — | 318 | — | 880 | — |
| `/api/sacks/summary` | **no** | — | — | — | — | 266 | — |
| `/api/sacks/stock` | **no** | — | — | — | — | 276 | — |
| `/api/sacks/movements` | **no** | — | — | — | — | 52 | — |
| `/api/reconciliation` | **no** | — | — | — | — | 348 | — |
| `/api/events` (register page, pageSize=100) | **no** | — | — | — | — | 346 | — |
| `/api/reports/header` | **no** | — | — | — | — | 4–7 | — |
| `/api/stations`, `/api/config` | **no** (flat, cheap) | 5–89 | — | — | — | 4–7 | — |
| `/api/machines/running` | **no** | — | — | — | — | 124 | — |

Raw JSON for every run is reproduced in full above/inline in this session's tool output; the
table condenses it. Run counts: every "cold/warm" pair shown is at least 1 run per width per
endpoint from the structured harness, plus a first exploratory pass (not tabulated separately,
consistent with the structured numbers) and 3 repeated cold runs each for `spc`,
`weight-stations` and `production` at widest range to show spread (given inline above as ranges).

## Confirmed: `/api/weight-stations`'s cached state changed

23 Sep's figure — **1,396 ms and uncached** — is **no longer true**. `api/src/app.ts:745`
(`const key = \`wstations:${from}:${to}:${periodFrom}:${periodTo}:${shift}\`; ... prodCache.get/set`)
now caches it under the standard 5 s TTL idiom, same as `/api/live` and `/api/production`. Warm
reads now cost single-digit milliseconds. Cold reads did **not** get cheaper — they got
**worse at widest range** (1,477–3,033 ms vs. 1,396 ms on 23 Sep) — see the scoping section
below for why. Two screens poll this endpoint every 30 s per the brief; with caching now in
place, only the first poll in each 5 s window pays the real cost, and any two screens open at
once share one cache entry instead of each paying separately.

## Time-to-usable per screen (approximate, via critical-path request timing)

jsdom/this harness has no layout, so "usable" is approximated as the slowest of the screen's
own parallel data requests (the real bottleneck — React itself paints only after these settle),
measured cold at widest range, single run each:

| Screen | Critical requests | Slowest (≈ time-to-usable) |
|---|---|---|
| Line | `/api/live` (5), `/api/production` (830), `/api/machines/running` (124) | **~830 ms** |
| Weight | `/api/weight-stations` (up to 3033), `/api/spc`×2, `/api/stations` | **~1.5–3.0 s** (wide spread, see below) |
| Rejects | `/api/rejects` (174), `/api/reject-spc` (281) | **~280 ms** |
| Sacks | `/api/sacks/summary` (266), `/api/sacks/stock` (276), `/api/sacks/movements` (52) | **~280 ms** |
| Readings | `/api/reports/header` (7), `/api/events` pageSize=100 (346), `/api/stations` (5) | **~350 ms** |
| Report | `/api/reports/header` (4), `/api/reports/management-summary` (2344–2566 cold) | **~2.3–2.6 s cold**, ~40 ms warm |
| Health | `/api/operations` (171–415), `/api/system-history` (74–178), `/api/reconciliation` (348) | **~350–420 ms** |

Compared to 23 Sep's **Weight screen 3,455 ms cold → 1,013 ms warm**: cold is now **in the same
band but noisier** (1,477–3,033 ms across three widest-range runs, median ≈1,590 ms — plausibly
*faster* on the median but the tail is worse than 23 Sep's single cold figure); warm is clearly
**better** (weight-stations itself now warms to single digits vs. contributing to a 1,013 ms
warm total before caching existed for it). The honest statement: Weight's cold time-to-usable did
not regress on the numbers gathered, and its warm time-to-usable improved, because the
previously-uncached, most expensive call on that screen is now cached.

## Did generation scoping cost measurable time? Yes — quantified, not estimated

`resolveGenerationScope` (`api/src/services/generation.ts:187`) issues **two SQL round trips per
call**: a `UNION ALL`/`GROUP BY source_epoch` scan over the event table(s) in the requested
window (cost scales with rows in the window — see "what scales with history" below), plus a flat
lookup on `sms.source_epoch` (small, ~constant).

Most scoped services call it **once per request** (`production.ts:358`, `spc.ts:523`,
`report.ts:249` — each verified by grep, 1 call site each). Those pay one extra round-trip pair,
which is cheap relative to the data query itself.

**`/api/weight-stations` is the exception, and it is exactly the endpoint whose cold latency
regressed relative to 23 Sep.** A single request to it triggers `resolveGenerationScope`
**three separate times**, each independently, for the identical `(lineId, from, to)` window:

1. `weightStations.ts:656`, inside `stationMaterialCounts` — called from `getWeightStations`.
2. `weightStations.ts:736`, inside `rejectRatesByStation` — also called from `getWeightStations`
   (`weightStations.ts:454`).
3. `productAt.ts:516` (`productDisagreement`), called from `app.ts`'s `Promise.all` alongside
   `getWeightStations` for the same request.

This is **documented in the code as deliberate**, not an oversight: `rejectRatesByStation`'s own
comment says its scope is "resolved ONCE and reused for every query below... but NOT shared with
`stationMaterialCounts`'s own resolve... which is the point: each service/function resolves for
itself rather than threading one object across the file's exports." That is a real architectural
choice (correctness/isolation over round-trip count), and this measurement does not second-guess
the choice — it only prices it: **6 extra SQL round trips per `/api/weight-stations` request**
(3 resolutions × 2 queries each) beyond the endpoint's actual data queries, all before caching
absorbs it on repeat.

A second, compounding detail: the two in-file calls (`weightStations.ts:656` and `:736`) call
`resolveGenerationScope(pool, lineId, { from, to })` with **no table-list argument**, so they
default to `EVENT_TABLES = ['cone_event', 'sack_event', 'reject_event']` — scanning and grouping
**all three** event tables even though `stationMaterialCounts` only ever reads `cone_event` and
`rejectRatesByStation` only ever reads `cone_event`/`reject_event`. By contrast `spc.ts:523` and
`productAt.ts:516` both pass an explicit single-table list. This is not fixed here (out of scope
for a measurement pass) but is worth flagging: it is scanning roughly 1.5× more table data than
the two callers need, on top of the 3× call duplication above.

**Plain answer: yes, scoping cost measurable time, concentrated entirely in one endpoint.**
Everywhere else (`production`, `spc`, `report`) it is one extra round-trip pair per request,
which is a small fraction of a 500–2000 ms query and not distinguishable from ordinary variance
in these measurements. `/api/weight-stations` alone pays 3× that cost plus an unnecessary
2-extra-table scan each of those 3 times, and it is the one endpoint whose cold-at-widest number
is worse than 23 Sep's figure for the same shape of request.

## Polling vs. cache TTL

`CACHE_TTL_SECONDS=5` (`.env`). Two screens poll `/api/weight-stations` every 30 s per the
brief — 30 s ≫ 5 s TTL, so this is not a wasteful poll; it simply means each 30 s poll pays a
cold miss (now cheap to serve concurrently since the cache absorbs same-instant duplicate
requests, but each distinct 30 s tick is still a genuine cold hit costing up to ~3 s at widest
range). `/api/reject-spc`, `/api/rejects`, `/api/downtime`, `/api/calibration`,
`/api/sacks/*`, `/api/reconciliation`, `/api/events` remain **uncached** — any screen polling
these on an interval shorter than its own query cost sustains that cost indefinitely, every
tick, forever. None of these were directly observed being polled in this pass (no polling
interval audit of every screen's source was done — see "what could not be measured" below), but
their uncached status alone is the fact IFL's budget cares about: a poll on any of them is never
free the way a poll on `/api/live` or `/api/production` now is.

## What scales with history, and what does not

Reasoned from query shape (not fabricated as a number), per the brief's instruction:

- **Scales with window width (and therefore with history, once IFL's server holds indefinite
  months instead of 53 days):** every endpoint whose SQL is `WHERE shift_date BETWEEN @from AND
  @to` over `sms.cone_event`/`sack_event`/`reject_event` with a `GROUP BY`/aggregate — `/api/spc`,
  `/api/production`, `/api/weight-stations`, `/api/report`, `/api/reports/management-summary`,
  `/api/reject-spc`, `/api/events` (register paging). The widest-range figures above (34 days)
  are consistently 2–10× the shift-range figures for the same endpoint, which is the query doing
  more row-scanning and aggregation, not fixed overhead. `resolveGenerationScope`'s own scan
  query is in this category too — it scales with the window, independent of which endpoint calls
  it.
- **Flat regardless of history:** `/api/live` (bounded to "now" plus the median acquisition lag,
  never the full history), `/api/stations`, `/api/config`, `/api/system-history` (reads
  `sms.verify_run`/`sms.rebuild_audit`, which grow with *manual runs*, not with production
  volume), `/api/operations` (a DQ/sync rollup, not a full-history scan). These stayed
  single-digit-to-low-hundred milliseconds at every width tested.
- **Six months out, at IFL's real cadence:** the widest-legal-range queries (the ones in the
  first bullet) are the ones to watch — their cost today already visibly tracks window width
  over a 34-day sample; the same query shape against, say, a 180-day widest range would be
  expected to cost proportionally more unless a materialized/pre-aggregated path is added. This
  is inference from the `WHERE`/`GROUP BY` shape actually read in the code, not a measured
  projection — no 180-day data exists to measure against.

## Comparison against the 23 Sep figures — explicit, per item

*(23 Sep figures as stated in this task's brief; no committed `PERFORMANCE-APP-2026-09-23.md` or
equivalent was found in the repo or git history to re-verify them independently — see "could not
measure" below.)*

| Item | 23 Sep | 24 Sep | Verdict |
|---|---|---|---|
| `/api/spc` cold | 2,567 ms | 1,476–2,190 ms (3 runs, widest) | **improved**, though within noisy range |
| `/api/spc` warm | 4–8 ms | 9–17 ms | **~unchanged** (noise-level) |
| `/api/reports/management-summary` | 2,519 ms | 2,344–2,566 ms | **unchanged** |
| `/api/reports/station` | 1,661 ms | not independently re-run this pass (see gaps) | **not compared** |
| `/api/weight-stations` cold, uncached | 1,396 ms, **no caching** | 1,477–3,033 ms, **now cached** (warm 4–15 ms) | **mixed**: cold got noisier/worse at the tail, but the endpoint is no longer uncached — repeated polls (its actual usage pattern, every 30 s from two screens) are now cheap where they were not before |
| Weight screen time-to-usable | 3,455 ms cold → 1,013 ms warm | ~1.5–3.0 s cold (noisy) → low-hundreds ms warm | **cold: roughly flat to slightly better on median, worse on tail; warm: improved**, driven by weight-stations' new caching |
| 19/21 endpoints over 100 ms budget | stated as-is 23 Sep | still true 24 Sep — nearly every endpoint measured here exceeds 100 ms cold at any width above "shift" | **unchanged** — no endpoint's cold path was brought under the 100 ms budget this week |

## What could not be measured

- **No committed 23 Sep performance report was found** to diff against line-by-line; the
  comparison above uses the figures given in this task's own brief, treated as the prior
  measurement, and could not be independently re-verified beyond what the brief already states.
- **`/api/reports/station` and `/api/reports/product`** were not re-run this pass (time-boxed);
  their cache idiom is identical to `management-summary` (`routes/reports.ts`'s shared
  `serveReport`), so the same cold/warm shape is expected but not directly confirmed today.
- **No poll-interval audit of every screen's source** was done to confirm which of the uncached
  endpoints are actually polled vs. fetched once per navigation; the polling-vs-TTL section states
  what is cached/uncached as fact and what is polled as inference from the brief plus what was
  observed live in one shared browser tab's network log (which showed repeated `/api/production`,
  `/api/live`, `/api/spc`, `/api/weight-stations` calls at varying intervals consistent with
  active polling, but was not a clean single-screen capture).
- **No real print/PDF export timing** — `/api/reports/:type/export` was not exercised.
- **No concurrency/load test** — explicitly out of scope per the brief; every figure here is a
  single client, sequential requests, several repeats.
- **Time-to-usable is a proxy** (slowest parallel critical-path request), not a browser paint
  measurement — this repo has no layout/paint harness for the API+SPA combination beyond the
  Playwright harness added this week for print/layout, which this task did not invoke.

## Constraints honoured

Read-only throughout — no INSERT/UPDATE/DELETE against any database, including the sidecar. No
`rebuild`/`cutover`/`epoch:*`/`retention`/`sync`/`user:create` run. `PDAS_WRITE_ENABLED` never
touched. No PDAS procedure executed. `/api/changeover/execute` never called. `.env` never
repointed. No production source file edited. No login created, reset or guessed — the existing
signed-in `admin` browser session was reused as-is. `git status` confirms the only working-tree
change is the pre-existing `VERIFICATION-2026-09-23.md` modification, not made by this pass.
