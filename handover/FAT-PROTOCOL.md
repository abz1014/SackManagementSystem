# FAT-PROTOCOL.md — Factory Acceptance Test protocol for SMS

**Drafted 24 Sep 2026, for the Sack Management System (SMS) built for Ibrahim Fibres
Limited (IFL), TP1 Line 3 / Unit 2.** Written to close the roadmap's own Phase 13
documentation deliverable ("FAT protocol", `IFL_SMS_Claude_Code_Development_Roadmap.md`
line 473) and the roadmap's own Definition of Done (lines 519–541), against evidence
in this repository as of commit `HEAD` on `floor-first-rework` at the time of writing.
This is a protocol to run, not a claim that it has been run — every row below states
plainly whether it has been exercised, against what, and by whom.

**This document does not itself constitute a FAT.** It is the checklist IFL and the
supplier execute together, at IFL's premises or against IFL's own data, before go-live.
Nothing in this file should be read as "already passed" — see the **[UNVERIFIED]**
convention in §2.

---

## 1. Purpose and scope

### 1.1 Purpose

To confirm, jointly with IFL, that SMS performs the ten requirements of the original
quotation (`IFL_Hassan_Simple_Requirements_Questions.md` and the mapping in `CLAUDE.md`
§"Requirement mapping and the Output/Shifts cut"), meets the roadmap's own Definition of
Done (`IFL_SMS_Claude_Code_Development_Roadmap.md` lines 519–541), and is safe to run
against IFL's live plant data and PDAS system, before the supplier hands the system over
for Site Acceptance Testing (SAT, roadmap Phase 14 — explicitly out of the Claude Code
development roadmap's own scope and not covered by this document).

### 1.2 Scope

Covered: the seven navigation screens (Line, Readings, Weight, Rejects, Sacks, Product,
Report — `sms/web/src/ui/Bar.tsx` `SCREENS`), Health, Setup, all nine report types and
their export formats, the product changeover / PDAS write-back path, rule editing and
its as-of-time behaviour, backup/restore, and the security controls (login, rank gates,
malformed-session handling).

Not covered: PLC integration (Component B — out of scope per IFL's own answer, Q22 /
Q63, `CLAUDE.md`); Site Acceptance Testing itself (roadmap Phase 14); any capability not
built (see §6, Known Limitations).

### 1.3 How to read a test row

Each row's **Witness** column is filled in at execution time, not by this document. A
row marked **[UNVERIFIED]** in the Steps/Expected column has never been exercised
against the condition FAT requires (live plant data, a live PDAS write, a real signed-in
account at that rank, etc.) and states the specific reason. Passing it here, in this
document, does nothing — it must be re-run at FAT itself.

---

## 2. Preconditions

Before FAT begins, the following must be in place. Where a precondition is itself
unmet as of this writing, that is stated, not glossed over.

### 2.1 Environment

| Item | Requirement | Status as of 24 Sep 2026 |
|---|---|---|
| Read-only login + host for the live `DATA_TP1U2` server | Must exist before FAT | **Not provided by IFL** — `COMMISSIONING-GAPS.md` §1, IFL open item #1 |
| Network reachability, FAT PC → plant server | Confirmed before FAT | **Unconfirmed** — `COMMISSIONING-GAPS.md` §1, IFL open item #2 |
| FAT PC | Owner-supplied per IFL's 15 Sep answer (Q65-70) — "the owner supplies a PC with the software installed" | Hardware not yet delivered/configured for FAT |
| SMS Windows service (sync worker) | Installed via NSSM (or equivalent) and exercised at least once on the FAT machine | **Never installed or exercised on any machine** — `COMMISSIONING-GAPS.md` §1 |
| `sms.epoch:accept` run for the live source generation | Required at cutover — repointing alone is not sufficient once IFL's source has been rebuilt (5 Aug 2026 reset) | Not yet run against a live source; only exercised against `_SEP07`/`_SIM` dev copies |
| Nightly backup job | Scheduled and proven to run unattended, not only on paper | **Not yet run unattended** — `COMMISSIONING-GAPS.md` §1 |

### 2.2 Data set

FAT should be run against **the live plant data**, once the read-only login and
network path exist. Until then, any dry run against the `_SEP07`/`_SIM` local dev copy
(34 real production days, 5 Aug – 7 Sep 2026, plus a simulator sidecar) is a rehearsal
only, and every row exercised that way must be marked **[UNVERIFIED — dev copy only]**
in the FAT record, not left silent. The 10 Jul – 5 Aug 2026 data gap (IFL has it, has
not sent it) does not block FAT but should be noted if reports are compared across it.

### 2.3 Accounts, by rank

Roles are `1 viewer · 2 engineer · 3 manager · 4 admin`
(`sms/db/migrations/035_roles_and_answers.sql`, IFL's 15 Sep answer: "the process
engineer on the floor" owns product/limit/sack-adjustment writes → rank 2). IFL or the
owner must create one real account at each rank before FAT, specifically so rank-gated
behaviour is witnessed live rather than only read from code:

| Rank | Role name | Who creates it | Created for FAT? |
|---|---|---|---|
| 1 | viewer | IFL | **Not yet — no viewer has ever signed in on a live instance** (`CLAUDE.md`, UX Phase 8/9 sections) |
| 2 | engineer | IFL | Needed for changeover / limits-edit steps below |
| 3 | manager | IFL | Needed for Export steps below |
| 4 | admin | IFL or owner (Setup access) | Only an admin session has ever existed to date |

**No agent or supplier developer creates these accounts** — per the project's own rule
(memory: "No agent-created accounts" — workers must never make logins to verify their
own work). This must be done by IFL or the human owner, ahead of the FAT session.

### 2.4 PDAS writer login and write-back readiness

- `sms_pdas_writer`, the dedicated least-privilege login for the nine PDAS write rights,
  has been created and driven **only against the local `PDAS_TP1U2_SEP07` copy**
  (`PDAS-EXECUTION-2026-09-24.md`, commits `58a705c`/`c21dfa9`). It is **not provisioned
  against the plant.**
- IFL's written authority for PDAS writes was given 19 Sep 2026
  (`handover/PDAS-WRITE-GRANT-2026-09-19.md`) and covers all nine rights.
  `PDAS_WRITE_ENABLED` in the real, on-disk `sms/.env` remains `false`; it must be
  turned on **only** once the plant login/role is confirmed and RT24-05 (below) is
  fixed.
- **A defect blocks enabling this against the plant as-is**: RT24-05 — the write path's
  own post-commit verification cannot detect a real mismatch under the plant's
  anticipated EXECUTE-only role, and silently downgrades a would-be CRITICAL to a
  WARNING (`COMMISSIONING-GAPS.md` §4, `DEFECTS.md` Part 6). **This must be fixed and
  re-verified before FAT exercises any PDAS write against the plant.** Against the
  local copy only, all nine write rights have been driven through the app's own code
  and read back correctly (`PDAS-EXECUTION-2026-09-24.md`).

### 2.5 Backups

- A full backup of the live `DATA_TP1U2`/`PDAS_TP1U2` databases (or the FAT rehearsal
  copies) must be taken and its restorability **proven into a scratch database** —
  the same protocol the 23 Sep 2026 PDAS execution passes followed
  (`PDAS-EXECUTION-2026-09-23.md`) — before any write-back test in §3.7 runs.
- SMS's own sidecar database must likewise be backed up before FAT, so a FAT run that
  writes `sms.product_change` / `sms.product_limit_version` rows can be rolled back
  cleanly afterward if IFL wants a clean instance to go live with.

---

## 3. Test table

Columns: **ID | Requirement traced | Steps | Expected result | Pass/Fail | Witness**.
"Requirement traced" cites the 10-line requirement mapping in `CLAUDE.md` /
`IFL_Hassan_Simple_Requirements_Questions.md`, the roadmap Definition of Done item, or
the specific screen/file. Fill Pass/Fail and Witness (name + rank) at execution time —
they are blank here by design.

### 3.1 Requirement coverage (the ten IFL requirements)

| ID | Requirement traced | Steps | Expected result | Pass/Fail | Witness |
|---|---|---|---|---|---|
| R1 | "Connectivity with PLCs, HMIs, machines, databases" | Confirm SMS's sync worker reads `DATA_TP1U2`/`PDAS_TP1U2` on the live server | Sync worker connects read-only, no schema/index/data change on IFL's DB (Q21) | | **[UNVERIFIED — no live login yet, §2.1]** |
| R2 | "Cone weight collection, flag weights outside limits" | On Weight and Readings, locate a cone reading outside its product's limits at the time it was recorded | Reading shows `low`/`high` classification per the limits in force **at its own time**, never today's mirror (`CLAUDE.md` §8 rule) | | |
| R3 | "Screens to view and update product details on machines" | On Product › Running, view current product per machine; on Product › Changeover, submit a plan and execute | Running product shown per machine (station 1–14); changeover writes to PDAS via the vendor's own procs, gated by rank ≥ 2 and `PDAS_WRITE_ENABLED` | | Execute step **[UNVERIFIED against plant — §2.4]** |
| R4 | "History logs and trend graphs for rejected cones" | Open Rejects; view trend chart and per-day-per-code breakdown | Trend chart renders without plotting a missing bucket as a false zero (RT-011, fixed); reject rate matches Line/Report for the same period (RT-001/004/009, fixed 23 Sep 2026) | | |
| R5 | "AI-based analytics recommending calibration adjustments" | Open Weight; view station drift flag and the "reaches the action limit in about N days" projection | Statistical advisory (Nelson rules, station drift, X̄ chart), explicitly **not AI** — must never be presented to IFL as AI until agreed (`CLAUDE.md`, IFL 15 Sep answer Q46-48) | | Projection has **no confidence interval shown** (RT-020, open) — note this to IFL |
| R6 | "Collection and logging of all sack data" | Open Sacks; view sack register and per-shift/day production report | All sacks logged, gross weight (IFL confirmed Q24), no machine attribution (sacks carry none — R7 below) | | |
| R7 | "Sack stock tracking per machine" | Attempt to view per-machine sack stock | **Not computable** — sacks carry no machine/station column in IFL's data, in either sample (§6.1). SMS instead reports sack production per shift/day/product (IFL's own reframing, Q28) | | Known limitation — do not fail FAT on this; confirm IFL accepts the reframing |
| R8 | "Comprehensive reporting, analytics, graphical dashboards" | Run all nine report types (§3.3); view Line/Weight/Rejects dashboards | Reports render with graphics per IFL's Q30/Q36 answer ("beautiful, Excel AND PDF, with graphics") | | Excel/PDF "beautiful… with graphics" is a requirement gap tracked as D-6, not fully closed — confirm with IFL at FAT |
| R9 | "User-friendly interface, access control, data security" | Sign in at each rank (§2.3); attempt a write above/below gate | Nav open to all ranks (one audience — `CLAUDE.md`); writes gated server-side per rank; malformed cookie → 401 (§3.9) | | |
| R10 | "Scalable to more machines and data points" | Inspect `line_id` filtering throughout the schema | Present throughout; multi-line UI not built (single line, `LINE_ID`, in scope for this contract) | | Code-inspection only, not exercised live |

### 3.2 Screen-by-screen (seven nav screens + Health + Setup)

| ID | Requirement traced | Steps | Expected result | Pass/Fail | Witness |
|---|---|---|---|---|---|
| S1 | Line | Load Line for This shift / Today / Yesterday / Pick a day | Correct machine table, availability figure, reject rate matching Report for the same period; provenance banner correctly names any simulator/excluded generation (RT-007) | | |
| S2 | Readings | Load register, filter to `outsideLimits`/`inspectionRejects` from a drilldown link | Correct filtered population; Print button state matches load/error state (flagged gap: `Readings.tsx:253` prints while still loading, per `CLAUDE.md` UX Phase 9) | | Confirm print-while-loading behaviour with IFL — flagged, not fixed |
| S3 | Weight | Load control chart, per-station table, target-vs-actual | Station table shows bias against line AND target (not "difference from line" alone — this was the pre-redesign defect); X̄ chart rule-1 only (rules 2-8 suppressed, D-10) | | Nelson rules 2-8 suppression is an owner decision pending, not a bug — confirm with IFL |
| S4 | Rejects | Load Pareto and per-code trend | Pareto bars fit the half-width column (D-5, fixed); reject rate agrees with Line/Report (RT-001) | | |
| S5 | Sacks | Load sack register and stock/production report | Gross weight; per-shift/day/product breakdown per IFL's Q28 reframing | | |
| S6 | Product › Running | View current product per machine | Correct per-machine product, retired products marked (RT-018 open — see below) | | **A retired product can render with no "retired" marker** (RT-018, unfixed) — must fail this step until fixed, or be accepted in writing by IFL |
| S7 | Product › Changeover | Plan then execute a changeover (see §3.7) | Plan is rank 1 read-only; execute is rank ≥ 2, gated by `PDAS_WRITE_ENABLED` | | |
| S8 | Product › Catalogue | View PDAS catalogue (blends/counts/tube types/materials/pallets) | Renders vendor seed-filtered rows (`MaterialId > 10` etc.) | | |
| S9 | Product › History | View `sms.product_change` trail | Includes `outcome='disabled'` rows labelled as attempts that never reached PDAS | | |
| S10 | Report | Run each of the nine report types (§3.3) | See §3.3 | | |
| S11 | Health | View DQ findings, sync health, system history, reconciliation | A failed fetch states in words that a count could not be read, never renders as "none"/zero (RT-005/012/013, fixed); System History states plainly it is a manual-run record, not a live check | | |
| S12 | Setup | View/edit Line, Machines, Reject codes, Sources, Rules (rank ≥ 4) | Setup restricted to rank 4; edits create versioned rows (see §3.6) | | |
| S13 | Wall | Load `?v=wall` fullscreen mode | No navigation, viewport-unit type, session renews without logging out | | |

### 3.3 Reports and exports

Nine report types (`sms/api/src/services/reports/*.ts`, `sms/web/src/screens/report/`):
Summary, Daily, Shift, Product, Station, Sack, Reject, Cone Weight, Calibration,
MachineProduct.

| ID | Requirement traced | Steps | Expected result | Pass/Fail | Witness |
|---|---|---|---|---|---|
| RP1 | Summary report | Run for a period spanning one generation | KPI figures match `KPI-DEFINITIONS.md` formulas; every row still shows `approval: 'awaiting'` — **no KPI has IFL sign-off** (`CLAUDE.md` Q33-37) | | Sign-off on KPI definitions is a FAT-day decision, not pre-done |
| RP2 | Daily report | Run for one production day | Reject rate divides by `cones + unmatchedRejects` (RT-003/closed 23 Sep) | | |
| RP3 | Shift report | Run for one shift | Shift derived from `ProductionDate`, not the plant's own `Shift` column (per SMS's own rule); shift mismatch % shown | | |
| RP4 | Product report | Run for a period with ≥2 materials on one station | `targetBasis` correctly marked `station_material`/`mixed`/`line_product` | | |
| RP5 | Station report | Run for a period | No arithmetically impossible row (more within-tolerance cones than produced — RT-002, fixed) | | |
| RP6 | Sack report | Run for a period | Gross weight, per-shift/day/product | | |
| RP7 | Reject report | Run per-day-per-code | Matches Rejects screen and Line for the same period (closed 23 Sep 2026, three-way agreement test) | | |
| RP8 | Cone Weight report | Run for a period | Figure tile and `vs target` column use the SAME versioned target (Phase 5 fix, no longer two answers in one report) | | |
| RP9 | Calibration report | Run and export CSV | All columns present; print layout not clipped (10-column table verified complete, not clipped, per Phase 9) | | Print claim is **[UNVERIFIED beyond viewport-resize simulation]** — no real print dialog has run against it; see §3.4 for the layout harness update |
| RP10 | MachineProduct report | View on screen, then export CSV | On-screen table suppressed in print with a one-line pointer to the CSV (RT-017 unfixed for the SCREEN itself — ~82% of columns still off-screen with no sticky column) | | Fails on-screen usability check; export path is the accepted workaround per Phase 9, confirm IFL accepts it |
| RP11 | CSV export | Export any report as CSV | Attribution in filename and trailing rows after a blank line, never a comment header (verified against Excel's mangled-first-row behaviour, 3 Sep 2026 fix) | | |
| RP12 | XLSX export | Export any report as XLSX | Generation-scope disclosure present (RT24-03, fixed) | | |
| RP13 | PDF export | Export any report as PDF | Renders with the landscape/portrait rule intact (Report screen landscape, Readings register portrait) | | **[UNVERIFIED end-to-end]** — `COMMISSIONING-GAPS.md` §4: "PDF export has never been invoked end to end outside a script" |
| RP14 | Generation-warning on export | Export a report covering a period with more than one source generation | Report states which generation(s) it excluded, in the exported file itself, not only the on-screen version | | Confirm exported (not just on-screen) generation disclosure at FAT — this is the specific gap RT24-03 closed for CSV/XLSX; re-confirm for PDF |

### 3.4 Print / PDF layout

| ID | Requirement traced | Steps | Expected result | Pass/Fail | Witness |
|---|---|---|---|---|---|
| PL1 | Print CSS, landscape reports | Print (or PDF-export) a Report-screen page | Reports print landscape, Readings register stays portrait; Calibration's 10 columns fit, not clipped | | A real browser/layout harness now exists (Playwright, `sms/playwright.config.ts`, commit `b866754`, run 24 Sep 2026: 3 passed/13 skipped/0 failed) — the 13 skipped cases need a signed-in session (owner credentials not yet supplied). **[UNVERIFIED by real print dialog for the signed-in cases]** |
| PL2 | MachineProduct print suppression | Print Product report with MachineProduct active | On-screen table hidden from print; one line names the CSV export as the full data source | | |
| PL3 | Landscape/copy-string guard | Confirm `web/src/print.landscape.guard.test.ts` passes | Test fails if `words.ts`'s `selectorLabel` and `app.css`'s `aria-label` selector diverge | | Code-level guard, not a FAT-floor observation — mention as a design fragility to whoever edits copy next (e.g. an Urdu pass) |

### 3.5 Product changeover and PDAS write-back

| ID | Requirement traced | Steps | Expected result | Pass/Fail | Witness |
|---|---|---|---|---|---|
| PW1 | Plan a changeover (new blend/count/tube name) | As engineer (rank 2), open Product › Changeover, enter a new product's blend/count/tube | Plan resolves read-only, never opens the PDAS writer pool at plan time | | |
| PW2 | Execute — happy path | Execute the plan from PW1 | `503 DISABLED` while `PDAS_WRITE_ENABLED=false`; **[against the plant]**; against the local copy with the harness's own enabled config, all nine write rights commit and read back correctly (`PDAS-EXECUTION-2026-09-24.md`) | | **[UNVERIFIED against the plant — §2.4]** |
| PW3 | Execute — blocked case | Attempt execute while `PDAS_WRITE_ENABLED=false` | `503 DISABLED`, server's `disabledReason` shown verbatim, no optimistic UI | | |
| PW4 | Execute — duplicate blend/count/tube | Attempt to create a material with an existing (Blend, Count, Tube) triple | Refused, `@error=-7001`, `'Material already exist'`, no row inserted — reproduced by execution 23 Sep 2026 | | Verified against local `PDAS_TP1U2_SEP07` copy only |
| PW5 | Execute — retire-then-recreate (must be refused) | Retire a material, then attempt `CreateMaterial` with the identical triple | **Must be refused** with the same `-7001` — retire-and-recreate does not work by the vendor's own uniqueness check, confirmed by execution 23 Sep 2026. **The Changeover screen must never offer this as a path to "change a setpoint."** | | |
| PW6 | Execute — stale plan | Plan a changeover, let another session write a conflicting change, then execute the stale plan | Execute detects the staleness and refuses or reports a blocker, not a silent overwrite | | **[UNVERIFIED — confirm this specific race is covered by a test before FAT]** |
| PW7 | Execute — `LIKE`-pattern near-duplicate | Plan a new blend/count/tube name that is a `LIKE` pattern match (not exact) for an existing name (e.g. `"R_D"` vs `"RED"`) | Plan blocks BEFORE any write reaches PDAS (fixed `a9b85b5`, 24 Sep 2026, tested at plan time via `likePattern.ts`) | | |
| PW8 | Read back in PDAS | After PW2/PW4 succeed against the local copy, query `PDAS.Materials`/`Blends`/`Counts`/`TubeTypes` directly | New row(s) present with correct values; `sms.product_change` row recorded, not mislabeled (see the known `nhs_events` logging bug below) | | Note to FAT witnesses: `nhs_events`' own info-row text logs `@blendId`, not the real `MaterialId` — a vendor logging bug, confirmed independently twice (23 Sep 2026). Do not use `nhs_events` text alone to attribute a created row; use the real `MaterialId`/OUTPUT value. |
| PW9 | Change limits (the only real "edit setpoint" path) | As engineer, edit an existing material's limits via the guarded single-row `UPDATE dbo.Materials` | Commits; `nhs_events` row written in the vendor's own event-log format; `sms.product_limit_version` versioned row created | | |
| PW10 | Post-commit verification under EXECUTE-only role | Execute a write using a role with EXECUTE-only (no SELECT) permission on PDAS tables, simulating the plant's anticipated grant | **Currently fails silently** — RT24-05: the write path's own verification cannot detect a real mismatch under this role and downgrades a would-be CRITICAL to a WARNING | | **Known open defect — must be fixed before this step can pass; do not enable `PDAS_WRITE_ENABLED` against the plant until it is** |

### 3.6 Rules edit and history-as-of behaviour

| ID | Requirement traced | Steps | Expected result | Pass/Fail | Witness |
|---|---|---|---|---|---|
| RU1 | Edit a product's limits in Setup (rank ≥ 4, or via `POST /api/products/limits/local`, rank 2) | Change the setpoint/tolerance for a currently-running product | New `sms.product_limit_version` row created, old row's `valid_to` set, not overwritten | | |
| RU2 | As-of read — old readings | View a cone reading recorded BEFORE the RU1 edit | Reading is still judged by the LIMITS IN FORCE AT ITS OWN TIME (the old value), never today's mirror | | This is the core rule CLAUDE.md calls "§8" — a regression here is CRITICAL by the project's own defect-severity scale |
| RU3 | As-of read — new readings | View a cone reading recorded AFTER the RU1 edit | Reading judged by the new value | | |
| RU4 | Reject-code meaning edit (Setup › Reject codes) | Add/edit a reject code's meaning | No fixed predefined list (IFL's own 15 Sep answer, Q12); change is versioned and audited | | |
| RU5 | Rule-as-of at transform time | Confirm `plausibility_rule`/`weight_rule`/`shift_rule` reads use the reading's own time, not "whatever is newest" | Fixed RT24-04 (commits `1315d23`/`8f5c80c`) | | **Rows transformed BEFORE this fix are not retroactively rewritten** — note as an open backfill item, not a live defect |

### 3.7 Backup and restore

| ID | Requirement traced | Steps | Expected result | Pass/Fail | Witness |
|---|---|---|---|---|---|
| BR1 | Full backup, live databases | Take a backup of `DATA_TP1U2`/`PDAS_TP1U2` (or the FAT rehearsal copies) | Backup completes; size and row counts recorded | | |
| BR2 | Restore into scratch DB | Restore BR1's backup into a scratch database | Row counts match the source exactly (protocol already proven twice against the local copy, `PDAS-EXECUTION-2026-09-23.md`) | | |
| BR3 | Restore after a write test | After PW2/PW4/PW9 above run against the FAT copy, restore from the pre-test backup | Row counts match pre-test state exactly | | |
| BR4 | Sidecar backup | Back up `sms`'s own database | Completes; restorability proven the same way | | |
| BR5 | Nightly backup job, unattended | Confirm the scheduled job runs without a person present | **Currently unproven — `COMMISSIONING-GAPS.md` §1: "Nightly backup scheduled only on paper, never run unattended"** | | **Must run and be observed at least once before FAT sign-off** |

### 3.8 Health / degraded states

| ID | Requirement traced | Steps | Expected result | Pass/Fail | Witness |
|---|---|---|---|---|---|
| H1 | Kill the sync worker mid-session | Stop the sync worker process; reload Health, Line, Weight | Screens state which specific fetch failed, not a blanket error; no screen asserts the line is/isn't running while unhealthy | | |
| H2 | Zero-lag edge case | Force a reading with zero acquisition lag | Reports `lag_unknown`, not a false "stopped" (RT-006, fixed) | | |
| H3 | `/api/health` `degraded` with null reason | Trigger a degraded state | **Currently can report `degraded` with `degradedReason: null`** (RT24-12) | | **Open defect — must show a reason, or the screen must handle null gracefully; confirm before sign-off** |
| H4 | Stale vs dead machine | Compare a machine quiet 3 minutes vs quiet for weeks | **Currently render identically** (RT24-08, in progress) | | **Open defect** |
| H5 | Calendar-invalid date | Submit `2026-13-45` as a report/period parameter | Must return `400`, not a silent-empty `200` or a crash (RT24-06 fixed for the endpoints checked 24 Sep; RT-016 notes a driver crash was found on other endpoints — re-check breadth at FAT) | | Re-verify breadth: RT-016 said 9/9 endpoints crashed before RT24-06; confirm the fix's scope matches |

### 3.9 Security

| ID | Requirement traced | Steps | Expected result | Pass/Fail | Witness |
|---|---|---|---|---|---|
| SEC1 | Login lockout | Attempt repeated failed logins for one account | Account locks out per policy; lockout is logged | | |
| SEC2 | Rank gate — Export | As rank 1 or 2, attempt Export | 403; UI does not even offer the control below rank 3 (`EXPORT_RANK` matches `requireRole(3)`, 3 Sep 2026 fix) | | |
| SEC3 | Rank gate — Setup | As rank < 4, attempt to reach Setup | Blocked client-side and server-side; `rank.crosscheck.test.ts` mechanically checks this | | |
| SEC4 | Rank gate — Changeover execute | As rank 1, attempt `POST /api/changeover/execute` | 403 (`requireRole(PDAS_WRITE_RANK)` = 2) | | |
| SEC5 | Malformed session cookie | Send a request with a corrupted/malformed session cookie | `401`, not a server crash (RT24-01, fixed `3e0d349` — previously CRITICAL: killed the whole API process, unauthenticated) | | |
| SEC6 | Viewer (rank 1) live session | Sign in as a real rank-1 account (once created per §2.3) | All 7 nav screens render; Setup absent; write controls absent one rank below their server gate | | **[UNVERIFIED live — no viewer has ever signed in on a live instance]**; rendering-only proven by `rank.matrix.test.tsx` against a faked `/api/auth/me` |
| SEC7 | Audit integrity | Attempt to alter or delete an `audit_log` row via the app login | Refused — `sms_app`'s `db_ddladmin` grant (which could alter/drop the append-only trigger) was found and fixed before this pass (R-13) | | |
| SEC8 | Response size cap | Request a report/endpoint designed to return an unusually large row count | **No server-side response-size/row-count cap independent of SQL exists today** (RT-014, unfixed) | | **Open defect — blocks Phase 11 (Security & operations) returning to COMPLETE per `PROJECT_STATUS.md`** |

---

## 4. Test count

- §3.1 Requirement coverage: **10**
- §3.2 Screen-by-screen: **13**
- §3.3 Reports/exports: **14**
- §3.4 Print/PDF layout: **3**
- §3.5 Changeover/PDAS write-back: **10**
- §3.6 Rules/as-of: **5**
- §3.7 Backup/restore: **5**
- §3.8 Health/degraded: **5**
- §3.9 Security: **8**

**Total: 73 test rows.**

**Rows marked [UNVERIFIED] or naming a specific open defect that would fail the row
as written: 16** (R7 known-limitation, R8, S2, S3, S6/RT-018, RP1, RP9, RP10, RP13,
RP14, PL1, PW2, PW6, PW10/RT24-05, H3/RT24-12, H4/RT24-08, SEC6, SEC8/RT-014 — count
includes rows citing an open defect as well as rows never yet exercised under the FAT
condition; several rows carry more than one caveat, counted once each by row).

---

## 5. Known-limitations annex

Stated here so FAT does not fail on, or waste time re-discovering, what the project has
already found and recorded:

1. **Sack stock per machine is not computable** from IFL's own data — `sack1_TP1U2`
   carries no machine/station column in either sample supplied. IFL's own 15 Sep 2026
   answer reframed the requirement as a per-shift/day/product production report
   instead (Q28) — SMS builds that, not a per-machine stock ledger.
2. **"AI" is statistics, not AI.** The calibration advisory (Nelson rules, station
   drift, days-to-limit projection) is real, defensible statistical analysis of real
   data — never present it to IFL as AI/ML until IFL and the supplier explicitly agree
   the statistical deliverable satisfies the RFQ's "AI-based analytics" line
   (`CLAUDE.md`, IFL 15 Sep answer Q46-48).
3. **PLC integration is deferred, by IFL's own confirmed answer** (Q22, Q63) — not a
   gap in the build. `cone_id`/`cone_id_source` columns exist, nullable, as a
   documented re-entry point only; no PLC library is in any manifest.
4. **Open RT (red-team audit) items, unfixed as of this writing:**
   - RT-014 — no server-side response-size/row-count cap independent of SQL
   - RT-016 — a calendar-invalid date crashes the DB driver on some endpoints (partially
     fixed as RT24-06; breadth not re-confirmed)
   - RT-017 — MachineProduct's on-screen column clipping (~82% of columns off-screen)
   - RT-018 — a retired product can render as "the target" with no marker
   - RT-020 — no confidence interval on the days-to-limit projection
   - RT-022, RT-025, RT-026, RT-027, RT-028, RT-031, RT-034 — confirmed still open by
     reading the code (see `DEFECTS.md` Part 4 for each finding's own text)
   - RT-019 — Nelson rules 2-8 flag 37.6–54.8% of station-groups on real data; kept
     deliberately suppressed pending an owner decision among four options (`DEFECTS.md`
     D-10) — not a bug, a pending call
   - RT24-05 — PDAS write-back verification cannot detect a mismatch under an
     EXECUTE-only role (see §2.4, §3.5 PW10) — **must be fixed before plant PDAS writes
     are enabled**
   - RT24-07, RT24-08, RT24-09, RT24-12 — in progress or open, see `COMMISSIONING-GAPS.md`
     §2 for current text
5. **Nothing in this system has been observed by a real user on real plant data.**
   Every measurement cited anywhere in this protocol's source documents is against the
   local `_SEP07`/`_SIM` dev copy unless stated otherwise. This is the single largest
   caveat governing this entire FAT protocol's pre-conditions (§2).
6. **The rare test-suite flake** (~1 failure in 74 full `vitest run` executions, never
   captured with a test name, `DEFECTS.md` D-7 root-caused and fixed 22 Sep 2026) means
   a single clean CI/test run on FAT day is not, by itself, proof the suite is
   permanently green — note this if FAT includes a "run the test suite" step.
7. **36 of the original 70-question pack remain unsent to IFL** as of the last dated
   entry in `CLAUDE.md`; some may need answers before FAT sign-off can be final (e.g.
   KPI approval, Q33-37, all still `awaiting` in `KPI-DEFINITIONS.md` §5).
8. **The branch has never been pushed or seen by CI** — `floor-first-rework` is
   materially ahead of both `origin/main` and `origin/floor-first-rework` (counts have
   changed almost daily this month; re-measure with `git rev-list --count` on FAT day
   rather than trusting any number written here).

---

## 6. Sign-off block

This FAT is considered complete when every row in §3 has a recorded Pass/Fail and
Witness, every **[UNVERIFIED]** row has either been exercised and re-marked, or been
explicitly accepted as an open item by both parties below (with a target date), and no
row tagged CRITICAL or HIGH in `DEFECTS.md` remains unresolved without such acceptance.

| Role | Name | Signature | Date |
|---|---|---|---|
| IFL — General Manager / process department representative | | | |
| IFL — Process engineer (rank-2 account holder) | | | |
| Supplier — developer / project owner | | | |

**Open items accepted at sign-off, if any, listed here with owner and target date:**

| Item | Owner | Target date |
|---|---|---|
| | | |
| | | |
| | | |

---

*Sources read for this document: `IFL_SMS_Claude_Code_Development_Roadmap.md` (FAT/SAT
and Definition of Done, lines ~444–541), `IFL_Hassan_Simple_Requirements_Questions.md`
(the 70-question pack), `handover/IFL-ANSWERS-2026-09-15.md`, `IFL-DEMO-WALKTHROUGH.md`,
`COMMISSIONING-GAPS.md`, `KPI-DEFINITIONS.md`, `PDAS-EXECUTION-2026-09-24.md`,
`PDAS-EXECUTION-2026-09-23.md`, `DEFECTS.md`, `IFL-QUESTIONS-STATUS.md`,
`sms/web/src/ui/Bar.tsx`, `sms/web/src/screens/**`, `CLAUDE.md`.*
