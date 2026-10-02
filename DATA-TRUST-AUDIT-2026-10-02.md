# IFL Sack Management System: data-trust audit, final report (2 Oct 2026)

**Status: final, 2 Oct 2026, after the fix stage.** Plain-English report for the owner. This is the audit's verdict draft (`scratchpad/A90/trust-verdict-draft.md`) finalised: the fix commit SHAs are filled in from the commit ledger, the "Blocking" entry of every fixed item in the evidence matrix now reads "fixed (sha)", and section 8 records what the fix stage did. Machine-readable verdicts: `scratchpad/verification2/verdicts.json` (175 verdicts); eligible-fix detail: `scratchpad/A90/eligible.json`; the register is `DEFECTS.md` Part 15; the owner's decisions are `DECISIONS-PENDING.md` §14; the questions for IFL are `IFL-OPEN-QUESTIONS.md` items 30-41 (drafted, **not sent**). How to re-run every measurement: `handover/DATA-TRUST-RECOMPUTE-2026-10-02.md`.

## 0. What happened during the audit (disclosed plainly)

- A verification agent ran real CLI commands and **emptied the dev app database** (`sms`). It was restored from a verified backup and reconciled exactly. Only simulator rows and audit-log rows written after the 29 Sep backup were lost; nothing real.
- Another agent's whole-repo search **locked a database file**, and the local September copy was briefly unreadable (RECOVERY_PENDING). It was brought back online; counts and CHECKDB were verified.
- Refutation was therefore **re-run afterwards against a read-only copy, `sms_audit`** (the 29 Sep 16:22 UTC backup; real epochs identical to live, simulator epochs 13-16 slightly smaller). Incident record with exact times: `handover/INCIDENT-2026-10-02.md`.
- Everything below was measured on this dev PC only: frozen dev copies, real data to 7 Sep 2026, harness identity is an in-process rank-3 render token. Nothing ran against the plant or IFL's server. The 10 Jul - 5 Aug month was never sent by IFL.

## 1. Result in one paragraph

The stored history and the plain counts, sums and means are right on both real generations (July = `DATA_TP1U2`, September = `DATA_TP1U2_SEP07`): an independent oracle that never read the app code, itself re-derived with different SQL (58 checked, 0 mismatches), agrees with the app on 1,535 figure comparisons across 17 periods. What cannot yet be trusted is narrower: shift-range views of rejects (one HIGH wiring defect, C-003), the statistical bands and flags (reject p-chart, capability, drift flags, reject-rise sentence), the live running/stopped verdict, several labels and exports, and the operator tools for backfill, rebuild and cutover. Nothing found loses or alters real source rows.

Tally after independent refutation: 115 confirmed, 35 confirmed-latent, 21 decisions, 2 duplicates, 1 plausible, 1 refuted (175), plus 16 observations. Only one final HIGH (C-003). 58 items were fix-eligible; about 55 need an owner or IFL decision.

**After the fix stage (2 Oct 2026):** the HIGH (C-003) is fixed and independently verified, and so are 49 of the other 57 eligible items (50 in all, in 47 git commits, `08cfe07` to `becc956`; the last six, C-133, C-015, C-138, C-174, C-134 and C-117, were committed at the close-out) and eight were dropped from fixing with a reason. **The statistical-method decisions, the IFL definitions and the live-state design are untouched and still open.** Nothing was verified on the plant, on paper or in Excel.

## 2. The four answers (as at the audit; what moved is in section 8)

1. **Is the history stored correctly? Yes for the stored rows, with caveats on the tools around them.** Raw equals source cell-for-cell, both directions, all 8 table-generations (A10-P1), no duplicates or orphans (A10-P7), shift codes recompute with 0 mismatches over 275,061 real cones (A12-P7). Not proven: rule time-versioning on real edits (only unit tests; no real edit exists), incremental-sync fidelity (every real epoch was one backfill batch), the missing month. Defects in the operator tools (not triggered on real data): C-010 (backfill refuses an identical archive when collations differ), C-011/C-021/C-022 (acknowledged finding breaks rebuild, cutover, retention), C-024 (false stale/blackout findings after a backfill), C-030. **All of these are now fixed (section 8), by unit tests and read-only SQL demos only.**
2. **Is the analytics maths correct? Arithmetic yes; several statistical outputs mislead.** Rates, means, SD, stoppage seconds, sack averages match SQL. Misleading in normal use: reject p-chart band (22 of 34 Sept days, 16 of 19 July days outside; over-dispersed ~100x, C-012), Home "reject rise" on 23 of 53 days (C-013), per-station pattern flags (RT-019 duplicate, C-014), capability on the wrong population (C-006, C-044), I-MR dots (C-045), live state false "stopped" about 10 percent of running time (C-008, an emulation, not observed). C-003 is a plain wiring error (fixed).
3. **Can the numbers shown be verified against the data? Yes for whole periods; not yet for shift-range views.** Whole-period figures reconcile to independent SQL. Shift-range or single-shift views were wrong or mislabelled on several surfaces (C-003, C-007, C-127, C-174, C-138, C-170, C-130, C-129). Excel rendering and printed pages were never looked at by a person. **After the fix stage:** C-003, C-007, C-127, C-130 and C-170 are fixed and verified; C-138 and C-174 are fixed and verified but not yet committed as their own items; C-129 and C-004 (reports that ignore the selection) are owner decisions.
4. **Can the plant trust the data? Conditionally.** Trust whole-period counts, sacks, weights, stoppage seconds and stored history. Do not rely on shift-range reject figures, control-chart marks, capability indices, drift flags or the live stopped/running sentence until the items in section 7 are fixed or decided. Biggest data-validity question for IFL: no quality rejects were recorded 14-18 Aug 2026 while 2,500-5,700 cones a day were weighed, so September reject rate is understated (4.59 vs 5.01 percent excluding the window), and nothing on any screen says so (C-001; IFL question 30, not sent).

## 3. Verdict per figure family and evidence matrix

Verdict legend: trusted / trusted-with-caveats / not-trusted / unverifiable. Data scope in every "proven" cell: dev copy (`sms_audit`), July gen epochs 1-4, Sept gen epochs 9-12, real to 7 Sep 2026, simulator excluded. Passes are used only where the task's sample held (A12 needed a full re-run because A12-P1 failed; A12-P1 is not used). **The "Blocking" column shows each item's status after the fix stage** (the original draft listed them as blocking).

| Family | Verdict | Proven | Assumed | Not verifiable here | Blocking |
|---|---|---|---|---|---|
| Cone counts and totals | trusted-with-caveats | oracle cones_all match on 17 periods; raw=source (A10-P1,P7; A40, oracle-integrity) | one wide row = one cone; ~0.2-0.3 pct of cone records absent from wide table (C-084) | live plant; 10 Jul-5 Aug | C-015 [fix written, RV NOT-VERIFIED, not committed], C-016 [fixed (d067a92)], C-138 [fix written, RV VERIFIED, not committed as its own item] (labels/headlines), not counts |
| Rejects, whole periods | trusted-with-caveats | quality, weight, unmatched counts match SQL (A20-P1,P6; A31-P6) | weight reject definition (IFL items 22-29); "rejected" = two populations (C-131) | why QCS silent 14-18 Aug | C-001 [awaiting IFL] (IFL), C-005 [awaiting owner] N/A |
| Rejects, shift-range views and control chart | not-trusted | single-shift filter correct on /api/rejects | none | rendered screens | C-003 [fixed (08cfe07)] HIGH, C-007 [fixed (526df47)], C-012 [awaiting owner], C-013 [awaiting owner] |
| Weight statistics (mean, SD, histogram) | trusted-with-caveats | n, mean, median, SD identical to SQL (A21-P1) | 1500-2100 g and 40-60 kg windows unconfirmed (C-076, C-082); basis gross/net (C-019) | physical scale correctness | C-049 [fixed (146e74c)] (empty period prints 0) |
| Capability Cp/Cpk, control charts | not-trusted | formulas reproduce | limits "not validated" (D-10) | validation vs known-good reference | C-006 [awaiting owner], C-044 [awaiting owner], C-045 [awaiting owner], C-012 [awaiting owner] |
| Calibration and drift flags | not-trusted | station n, mean, bias match (A22-P1) | pattern rules on autocorrelated means | any true drift event (no ground truth) | C-014 [awaiting owner] (RT-019), C-054 [awaiting owner], C-057 [awaiting owner], C-059 [awaiting owner], C-062 [awaiting owner], C-053 [awaiting owner] |
| Downtime and stoppages | trusted-with-caveats | stoppage seconds match oracle, 55 of 55 days (A23-P1) | 120 s threshold (C-067), edge rules (C-064, C-065, C-166) | live behaviour | C-020 [awaiting IFL] definition wording |
| Live running/stopped state | not-trusted | lag mechanism measured | sync tick 61 s | live plant (emulation only) | C-008 [awaiting owner] |
| Sacks | trusted-with-caveats | count, kg, in-range, stock ledger match (A24-P1,P7) | sack time = insert time (C-075); gross basis | sack production time | C-017 [awaiting IFL], C-005 [awaiting owner], C-171 [awaiting owner], C-170 [fixed (95ca985)] |
| Shift attribution | trusted-with-caveats | 0 mismatches over 275,061 cones (A12-P7); vendor Shift wrong for 4.45 pct (July), 2.00 pct (Sept) | 06/14/22 per IFL Q8 | real rule edit | C-140 (client hard-codes hours, latent), C-130 [fixed (bb8f814)] |
| Generation history, rebuilds, backfills | trusted-with-caveats | stored rows exact (A10); canonical derivations consistent | source never restored/pruned (C-025) | R-17 on the real archive | C-010 [fixed (53b695c)], C-011 [fixed (d61eb37)], C-021 [fixed (0c83636)], C-022 [fixed (e1c5bdc)], C-024 [fixed (3eabdcf)] |
| Time-versioned limits and rules | trusted-with-caveats | limit versions applied per cone material; as-of rules by unit tests | no real edit has happened | real edits at IFL | C-018 [fixed (f4d6c75)], C-036 [fixed (baa247d)], C-037 [recorded, latent; decision first], C-019 [awaiting IFL] |
| DQ and Health | trusted-with-caveats | DQ numbers recompute (A12 full rerun) | checks forward-only | 27 Jun sack gap and 220 over-weight cones never evaluated (C-002) | C-001 [awaiting IFL], C-024 [fixed (3eabdcf)], C-030 [fixed (ff2eb9f)] |
| Exports (CSV, XLSX, PDF) | trusted-with-caveats | figure parity with JSON (A30-P11); 54 XLSX parsed | Excel opens them as expected | Excel, paper | C-112 [fixed (b31c3f1)], C-113 [fixed (03b527a)], C-114 [fixed (5b30711)], C-127 [fixed (7dbd053)], C-174 [fix written, RV VERIFIED, not committed as its own item] |
| Client display | trusted-with-caveats | built SPA driven in headless Edge, A50 sample held | none | signed-in viewer/engineer sessions | C-016 [fixed (d067a92)], C-015 [fixed (f64bf85)], C-138 [fixed (dfabc1e), tests only; code earlier], C-137 [fixed (91b1303)] |

## 4. Confirmed findings that were fix-eligible, with their fix commits

58 items; full file lists in `scratchpad/A90/eligible.json`. Order is the plan's wave order; the register number is the `DEFECTS.md` Part 15 row.

| Audit id | Sev | Defect | Group | Status | Register |
|---|---|---|---|---|---|
| C-003 | HIGH | Reject report under a shift range: trend/p-bar/limits are whole production days | F-RPT | fixed (08cfe07) | D-57 |
| C-130 | LOW | Shift-check sentence ignores shift filter/range | MULTI | fixed (bb8f814) | D-58 |
| C-158 | LOW | False 'missing scale-verdict counts' data issue on zero sacks | F-CORE | fixed (524c4e9) | D-59 |
| C-007 | MEDIUM | Weight-stations reject rates drop the shift filter | MULTI | fixed (526df47) | D-60 |
| C-009 | LOW | rejectSpc picks the 1-cone stray September generation (no stray filter) | MULTI | fixed (589a3ee) | D-61 |
| C-010 | MEDIUM | Backfill overlap proof is collation-dependent and refuses a byte-identical archive | F-PIPE | fixed (53b695c) | D-62 |
| C-023 | LOW | Backfill overlap checksum uses CHECKSUM_AGG (XOR), blind to even-count differences | F-PIPE | fixed (53b695c) | D-62 |
| C-024 | LOW | stale_timestamp and sack_blackout seeded across generations, false clock-fault and blackout findings | F-PIPE | fixed (3eabdcf) | D-63 |
| C-030 | LOW | persistFindings dedupe on detail swallows later same-count findings | F-PIPE | fixed (ff2eb9f) | D-64 |
| C-011 | MEDIUM | rebuild --all-generations empties canonical when an acknowledged finding blocks the dq_finding delete | F-PIPE | fixed (d61eb37) | D-65 |
| C-029 | LOW | Stale rebuild/verify text: rebuild applies today's rules; verify called read-only | F-PIPE | fixed (68f8b46) | D-66 |
| C-021 | LOW | sms cutover fails on acknowledgement FK after destructive deletes, no audit row | F-PIPE | fixed (0c83636) | D-67 |
| C-022 | LOW | Daily retention job stops pruning once an acknowledged finding is 365 days old | F-PIPE | fixed (e1c5bdc) | D-68 |
| C-026 | LOW | sms verify --weights ignores archived floor, permanent MISMATCH after IFL prune | F-PIPE | fixed (d20b108) | D-69 |
| C-027 | LOW | Scoped sms verify says every open generation reconciles and records a clean run | F-PIPE | fixed (d20b108) | D-70 |
| C-028 | LOW | sms verify --from/--to uses calendar days, not 06:00 production days | F-PIPE | fixed (d20b108) | D-71 |
| C-112 | MEDIUM | CSV formula guard turns negative numbers into text | F-EXP | fixed (b31c3f1) | D-72 |
| C-120 | LOW | Register export CSV has no BOM | F-EXP | fixed (5aea0da) | D-73 |
| C-113 | MEDIUM | XLSX labels genuine-UTC instants as plant time | F-EXP | fixed (03b527a) | D-74 |
| C-121 | LOW | XLSX banner 'All shifts' on shift-range exports | F-EXP | fixed (ec03678) | D-75 |
| C-127 | MEDIUM | Management summary CSV period columns state calendar days for shift range | F-RPT | fixed (7dbd053) | D-76 |
| C-128 | MEDIUM | stations_flagged printed as 0 for periods shorter than 3 days | MULTI | fixed (ef9e5f9) | D-77 |
| C-016 | MEDIUM | Cleared Pick-dates field sends an open-ended query and shows the whole generation | F-WEB | fixed (d067a92) | D-78 |
| C-114 | MEDIUM | Older ten reports' caveats missing from CSV/XLSX | F-EXP | fixed (5b30711) | D-82 |
| C-018 | LOW | Plausibility rule read as 'now' by five services but as-of by others | MULTI | fixed (f4d6c75) | D-84 |
| C-043 | LOW | Setup note and KPI row 18 misstate when a plausibility edit applies | MULTI | fixed (4b8dae3) | D-85 |
| C-039 | LOW | limitsChangedInPeriod counts creation version as a change | MULTI | fixed (e78eb52) | D-86 |
| C-157 | LOW | Undefined spreads stored/printed as 0 | MULTI | fixed (199fd09) | D-87 |
| C-049 | LOW | Empty or single-reading population printed as mean 0, SD 0 | MULTI | fixed (146e74c) | D-88 |
| C-110 | LOW | Small reject rates print 0.04 % as 0.0 % | MULTI | fixed (bb8be28) | D-89 |
| C-056 | LOW | Calibration report for an empty period states no action indicated | MULTI | fixed (dfcbc88) | D-90 |
| C-136 | LOW | Default report anchor UTC fallback; calibration ignores line-wide adjustments | MULTI | fixed (227d858) | D-91 |
| C-132 | LOW | Printed wording 'cones plus rejects' wrong denominator | MULTI | fixed (98a1789) | D-92 |
| C-139 | LOW | Register page number not reset on shift-range or Sacks history | F-WEB | fixed (7239ba2) | D-94 |
| C-175 | LOW | Health Reconciliation ignores shift-range period | F-WEB | fixed (3e6c0f8) | D-95 |
| C-155 | LOW | Line prints '0%' when nothing weighed | F-WEB | fixed (da33550) | D-96 |
| C-156 | LOW | Readings headline prints (0%) for 0 weighed | F-WEB | fixed (ba88ed9) | D-97 |
| C-143 | LOW | Simulator-banner polls every 10 s on closed periods | F-WEB | fixed (02c35af) | D-99 |
| C-036 | LOW | Mid-period rule changes disclosed only by sack and shift-production reports | MULTI | fixed (baa247d) | D-100 |
| C-119 | LOW | *_utc columns carry plant-clock instants; viewer-zone display shifts them | MULTI | fixed (fc8114c) | D-101 |
| C-167 | LOW | Summary prior period labelled by calendar days only | MULTI | fixed (7a40156) | D-102 |
| C-170 | LOW | Sacks screen chart and ledger are whole days under shift headline | F-WEB | fixed (95ca985) | D-103 |
| C-137 | LOW | Polling keys with tsTo change every 10 s, refetch and blank figures | F-WEB | fixed (91b1303) | D-104 |
| C-141 | LOW | api.ts fetch has no timeout | F-WEB | fixed (c345e47) | D-105 |
| C-015 | MEDIUM | Cross-generation period: Line, Weight, Rejects headlines hide the excluded generation | F-WEB | fixed (f64bf85); Rejects fixed at close-out, unit-proven | D-79 |
| C-138 | MEDIUM | Line/Readings/Sacks headlines name whole day for a shift period | F-WEB | fixed (dfabc1e) | D-80 |
| C-174 | MEDIUM | Readings print masthead states whole days for shift-bounded register | MULTI | fixed (f4f00f0) | D-81 |
| C-133 | LOW | excludedClockFault structurally 0 on three reports | MULTI | fixed (99caf8c); July hangers 2 confirmed by SQL | D-83 |
| C-134 | LOW | Hangers 'Line reject rate' prints filtered population rate | F-WEB | fixed (a929512) | D-93 |
| C-117 | LOW | Management summary cones per sack printed at 0 dp | F-WEB | fixed (becc956) | D-98 |
| C-074 | LOW | Derived figures computed from rounded operands end 0.01 off | F-CORE | recorded, not fixed (immaterial; payload change) | D-109 |
| C-099 | LOW | shift_rule_drift samples newest 20,000 rows of any generation | F-PIPE | recorded, dev-only | D-110 |
| C-109 | LOW | Pareto tie order unspecified | F-CORE | recorded, cosmetic | D-111 |
| C-115 | LOW | No export states data age | MULTI | moved to a decision (missing feature) | D-112 |
| C-123 | LOW | XLSX number style two decimals for three-decimal values | F-EXP | recorded, cosmetic | D-113 |
| C-148 | LOW | No write route clears response caches; 'applies immediately' overstated | MULTI | recorded (wording fixed under C-043) | D-114 |
| C-072 | LOW | live.ts ignores weight basis for sack kg | F-TIME | recorded, latent | D-115 |
| C-037 | LOW | Period-end instants / calendar-day edges instead of 06:00 production-day edges for rules and limits | MULTI | recorded, latent; decision first | D-116 |

Note: C-146 is covered by C-016; C-107 (dev-only simulator leak) is closed on the dev copy by C-009 but is not itself reachable at IFL. C-039's definition interacts with decision C-040. C-010 and C-023 are one change (`53b695c`); C-026, C-027 and C-028 are one commit (`d20b108`, the three `verify.ts` snapshots being byte-identical); the code of C-043 is inside C-018's commit (`f4d6c75`).

Recorded, not fixed (latent or not reachable in normal IFL operation, or cosmetic): C-025, C-051, C-060, C-066, C-088, C-089, C-093, C-094, C-098, C-107, C-118, C-140, C-142, C-144, C-149, C-159-C-162, and INFO items (C-038, C-047, C-061, C-063, C-073, C-077, C-090, C-092, C-097, C-100, C-108, C-111, C-122, C-124, C-163, C-164, C-168, C-173, C-176). C-069, C-055 (July stray 21 Jun days) need owner choice or are July-only. Register rows: `DEFECTS.md` Part 15.

## 5. Decisions (owner or IFL); recorded, not changed

Statistical method (owner): C-012 reject p-chart over-dispersion; C-013 reject-rise sentence; C-014 (duplicate of RT-019, wording of closure; RT-019's "closed" status is wrong for the per-station surface); C-045; C-053; C-054; C-057; C-059; C-062; C-044; C-006 which product Weight uses; C-004 whole-day weight figures under a shift range (disclose, narrow or refuse); C-005 Product report station filter vs sacks; C-129 four report types ignore "This shift"; C-171 opening stock across generations; C-172 stray 12 Jul cone; C-165 within-limits 0.0 pct for July; C-064/C-065/C-166 stoppage edge rules; C-008 per-winder lag design; C-002 retro DQ scan; C-031 NULL-date quarantine; C-096, C-101, C-104, C-105, C-145, C-041, C-040, C-067, C-068, C-071, C-083, C-178.

IFL: C-001 QCS gap; C-017 average sack definition; C-019 weight basis; C-020 stop-time rule row 17; C-032 and C-131 weight-reject definition and wording; C-034 sack window; C-035 implausible scale rejects; C-076 sack SD window; C-084 trigger dropped records; C-095 stale_timestamp cause; C-102 outlier on rejects; C-075 sack time. Owner-only: C-182 (.env comment), C-079 (SCHEMA/QUESTIONS wording).

Added by the fix stage: C-115 (data-age line on exports), C-148 (response caches, at most 5 s), C-037 (calendar versus production-day edge for rule lookups), C-072 (live sack kilograms and a net basis), C-123, C-109, C-074, C-099, and the follow-ups of the narrowed fixes (how a rebuild should carry acknowledged findings, whether acknowledgements expire, whether `verify` should use production days, the hangers flag basis under a filter, a shift-bounded sack ledger). **Plain-words entries with options, evidence and a recommendation: `DECISIONS-PENDING.md` §14.** Drafted IFL questions (never sent): `IFL-OPEN-QUESTIONS.md` items 30-41.

## 6. Unresolved and not verified

- Plausible, unresolved: C-116 (management summary PDF near the 30 s timeout; measured 9-12.5 s here, not reproduced).
- Refuted: C-052. Duplicates: C-014 (RT-019), C-154 (AUDIT-2026-09-15 finding 130).
- Observations (no defect asserted): C-042, C-046, C-081, C-085, C-086, C-091, C-106 (throughput regime change 17 Aug), C-125, C-126, C-147, C-150, C-151, C-153, C-169 (hanger 206 flagged by 0.6 pct margin), C-177, C-179.
- Not verified here: the live plant and IFL's server; the 10 Jul - 5 Aug archive; PLC behaviour and the scale in-range bit's physical correctness; sack production time; signed-in viewer/engineer/manager sessions; any printed page or Excel rendering; the plant PC time zone; PDAS limits reaching machines (F-31); real rule edits at IFL; incremental-sync fidelity on real data; real SQL 547 on acknowledgement deletes; validation of control limits against a known-good reference; Live-state rates (emulation, 61 s tick assumed); whether QCS silence 14-18 Aug is recorder or plant.
- **Added by the fix stage:** every operator-tool fix (backfill, rebuild, cutover, retention, verify, the DQ checks) was proven by fake-pool unit tests and read-only SQL demos, never by running the CLI; fixers did not run the harness, an independent re-verifier did; the owner's API on :4000 runs the old code until restarted after `npm run build`; committed HEAD does not typecheck on its own until the working-tree changes of C-133, C-134 and C-174 are committed (`DEFECTS.md` D-106).
- Oracle integrity: 58 of 1,535 figures re-derived blind with different SQL, 0 mismatches; no oracle metric suspended. P14 (simulator) not re-derived.

## 7. Go-live re-verification checklist (IFL live data)

1. Re-run the row-level source to raw to canonical reconciliation per epoch (counts and SUM(id) checksum, both directions) on the first live read, using read-only SQL.
2. Confirm the plant instance and the archive collation before `epoch:backfill` (C-010); re-run the overlap proof after the fix (the fix is in `53b695c`; it has been proven by unit test and read-only SQL, never by a live backfill).
3. After loading 10 Jul - 5 Aug: per-day cones/rejects/sacks against IFL's own SELECTs; run the DQ checks over the new history; look for reject-stream and sack silences (C-001, C-002).
4. Re-run the 17-period oracle comparison (same SQL files, new live periods) with the oracle re-derived blind.
5. Check shift attribution (0 mismatches against the recomputed 06/14/22) and the vendor Shift disagreement rate.
6. Check weights: plausibility and basis answers from IFL; mean/SD against SQL.
7. Check time zone of the plant PC and viewers (plant clock vs genuine UTC fields, C-113, C-119).
8. Run the harness periods for shift-range views after the C-003/C-007 fixes and confirm agreement with SQL (done on the dev copy; repeat on live).
9. Check Health/DQ: no simulator epoch on the live sidecar; acknowledge only data-fact findings.
10. Re-measure the live-state lag per winder against the live feed and the real sync cadence (C-008).
11. Rehearse backup restore and one `rebuild` on a scratch copy before any cutover (C-011, C-021, C-022 are fixed by unit tests only).
12. Print one report per type and open its XLSX in Excel; have a person read them (never done).
13. Sign-in sessions at viewer, engineer and manager rank (never exercised).
14. Confirm the KPI sheet rows with IFL (all rows "awaiting").

## 8. Fix stage results (2 Oct 2026)

**Method.** Five waves; in each, up to four fix workers (red test first, minimal change, neighbour and guard tests), an independent re-verifier measuring BEFORE on the old build and AFTER on the new one (`VERIFIED` / `NOT-VERIFIED` per item), a serial gate (typecheck, `npx vitest run` twice, a scratch web build, layout), and a serial committer (one commit per verified item, snapshot staging). Fix workers never ran a build, the harness, the CLI or git. The preamble that bound them is in `handover/INCIDENT-2026-10-02.md` §4.

**Items.** 58 eligible: **50 fixed and committed** (47 commits; six of them at the close-out, after the re-verifier's last pass, so C-133, C-015, C-138, C-174, C-134 and C-117 were not re-measured by the harness, only unit-proven plus, for C-133, an independent SQL check) and **8 dropped** with a reason (C-074, C-099, C-109, C-115, C-123, C-148, C-072, C-037). Two items needed more than the plan allowed and were finished at the close-out: C-117 (`Summary.tsx` added) and C-133 (hangers July count 2, the brief expected 1; independent SQL on `sms_audit` supports 2, so the brief was wrong).

**Fix commit SHAs (in commit order).**

| Wave | Commit | Audit id(s) | Register |
|---|---|---|---|
| 1 | `08cfe07` | C-003 | D-57 |
| 1 | `bb8f814` | C-130 | D-58 |
| 1 | `524c4e9` | C-158 | D-59 |
| 1 | `526df47` | C-007 | D-60 |
| 1 | `589a3ee` | C-009 | D-61 |
| 1 | `53b695c` | C-010, C-023 | D-62 |
| 1 | `3eabdcf` | C-024 | D-63 |
| 1 | `ff2eb9f` | C-030 | D-64 |
| 1 | `d61eb37` | C-011 | D-65 |
| 1 | `68f8b46` | C-029 | D-66 |
| 1 | `0c83636` | C-021 | D-67 |
| 1 | `e1c5bdc` | C-022 | D-68 |
| 1 | `d20b108` | C-026, C-027, C-028 | D-69, D-70, D-71 |
| 2 | `b31c3f1` | C-112 | D-72 |
| 2 | `5aea0da` | C-120 | D-73 |
| 2 | `03b527a` | C-113 | D-74 |
| 2 | `ec03678` | C-121 | D-75 |
| 2 | `7dbd053` | C-127 | D-76 |
| 2 | `ef9e5f9` | C-128 | D-77 |
| 2 | `d067a92` | C-016 | D-78 |
| 2 | `5b30711` | C-114 | D-82 |
| 3 | `f4d6c75` | C-018 | D-84 |
| 3 | `4b8dae3` | C-043 | D-85 |
| 3 | `e78eb52` | C-039 | D-86 |
| 3 | `199fd09` | C-157 | D-87 |
| 3 | `146e74c` | C-049 | D-88 |
| 3 | `bb8be28` | C-110 | D-89 |
| 3 | `dfcbc88` | C-056 | D-90 |
| 3 | `227d858` | C-136 | D-91 |
| 3 | `98a1789` | C-132 | D-92 |
| 3 | `7239ba2` | C-139 | D-94 |
| 3 | `3e6c0f8` | C-175 | D-95 |
| 3 | `da33550` | C-155 | D-96 |
| 3 | `ba88ed9` | C-156 | D-97 |
| 3 | `02c35af` | C-143 | D-99 |
| 4 | `baa247d` | C-036 | D-100 |
| 4 | `fc8114c` | C-119 | D-101 |
| 4 | `7a40156` | C-167 | D-102 |
| 4 | `95ca985` | C-170 | D-103 |
| 4 | `91b1303` | C-137 | D-104 |
| 5 | `c345e47` | C-141 | D-105 |

**Gate per wave** (typecheck `tsc -b shared sync-worker cli api web`, then `npx vitest run` twice, identical both times, 0 failed; baseline 321 files / 3,912 tests, 4 tests and 1 file skipped throughout):

| Wave | Typecheck | Test files passed (skipped) | Tests passed (skipped) | Layout (`npm run test:layout`) |
|---|---|---|---|---|
| baseline (2 Oct) | clean | 321 (1) | 3,912 (4) | 106 passed, 38 skipped, 0 failed |
| 1 | clean | 336 (1) | 3,945 (4) | not run (no web file changed) |
| 2 | clean | 356 (1) | 3,997 (4) | 106 / 38 / 0 |
| 3 | clean | 377 (1) | 4,041 (4) | 106 / 38 / 0 |
| 4 | clean | 385 (1) | 4,075 (4) | 106 / 38 / 0 |
| 5 | clean | 386 (1) | 4,077 (4) | 106 / 38 / 0 |
| close-out (on HEAD `becc956`) | clean | 388 (1) | 4,081 (4) | not re-run |

The web build stays one chunk over the 500 kB warning (626.85 kB at wave 1, 631.37 kB at wave 5; a pre-existing warning). The layout skips are the 38 specs that need `SMS_TEST_USERNAME`, deliberately not supplied. The wave gates ran on the working tree, which then included the uncommitted C-133, C-134 and C-174 edits; **the close-out gate was run on HEAD itself with no modified or untracked file under `sms/` besides `DEPLOY.md`, and HEAD typechecks (`DEFECTS.md` D-106 resolved).** The close-out web build (to a scratch directory) has the one chunk over the warning at 631.43 kB.

**RV-final** (`scratchpad/fix/final/matrix.json`, verdict **PASS_WITH_INTENDED_CHANGES**; read-only harness only; `dist` current at wave 5). The harness self-test passed 39 of 39 and `dist` was byte-identical to source (api 287, shared 14, sync-worker 64, cli 29 files).

- **A32 (62,582 figure comparisons across the report and period matrix):** matched before 62,037, after 62,013; **20 mismatches became matches**, 44 matches became mismatches that are all rows where the independent oracle encodes the old behaviour (shift-check sentence 30 rows, limits-changed 10 rows, zeroed-clock count 4 rows), **0 unintended regressions**, 525 still mismatched (pre-existing and untouched: station, cone-weight and calibration whole day against shift range 114 each, machine-product 147, shift 22, daily 18, reject 15, product 14, management-summary 7, rejected-cones 4). One residual rounding-boundary difference remains (P09 trend 2026-09-01 lower limit 10.36 against 10.3548). 692 rows keep matching with a changed value: 690 by-day-code rates now at two decimals, 2 P09 flags that now read False.
- **A41 (3,520 screen and surface checks):** matches 3,393 → 3,412, mismatches 91 → 72, **0 regressions**, 19 fixed: the P07 Rejects headline 0 → 185 rejected, quality 179, weight 6, produced 1 → 18,502, rate 0.0 % → 1.00 % (oracle 179 / 6 / 185 / 18,502); the P08 Health reconciliation 0 → 1,117 cones (plausible average 1,953.34 g); the P09 reject p-bar 9.49 → 12.56 % (oracle 12.5644); the P13 and P14 Weight mean and SD null for an empty period. The remaining 72 are pre-existing (definition differences in daily and summary average sack kilograms and stoppage counts, station `lineMeanG`, the sacks stock-ledger shift totals).

**What the fix stage did not do.** It did not run anything on the plant, open a printed page or an Excel file, sign in at any rank, or run a CLI command. It did not change a statistical method, an IFL definition or the live-state design. It did not fix the hangers executive-summary tile (`DEFECTS.md` D-54, still open) and did not commit its own files (the committer does that).

**Next actions for the owner:** (1) done at the close-out (the remaining app changes are committed and the gate re-run on HEAD); (2) restart the API on :4000 after `npm run build`; (3) read `DECISIONS-PENDING.md` §14 and decide; (4) decide whether to send `IFL-OPEN-QUESTIONS.md` items 30-41; (5) stop for approval before any further phase.

