# Data-trust audit, 2 Oct 2026: how to recompute everything

**Written 2 Oct 2026 by the documentation pass.** This is the "run it again" guide for the audit in `DATA-TRUST-AUDIT-2026-10-02.md`: what to run, where the files are, what each fixed item's repro query is and what it must return, and the checklist for the first run against IFL's live data. **Everything here is read-only.** The incident that shaped these rules is `handover/INCIDENT-2026-10-02.md`; read its §4 first.

## 1. Safety rules (non-negotiable)

1. **No database writes, ever.** Nothing but `SELECT` against `sms_audit` or the source databases (`DATA_TP1U2`, `DATA_TP1U2_SEP07`). Never the live dev database `sms` (`sqlro.sh` refuses it).
2. **Never run an SMS CLI command**: `rebuild`, `cutover`, `retention`, `sync`, `epoch:*`, `verify` (it inserts into `sms.verify_run`), `migrate`, `user:*`, or `node cli/dist/index.js ...` in general. Prove CLI behaviour with the existing fake-pool unit tests.
3. **Never search recursively from the repository root**, and never run any search, copy, hash or `ls -R` that could open files under `extracted*`, `schema_dump`, any `DATA` / `*.mdf` / `*.ldf` folder or `SPS*`. Use the Grep and Glob tools scoped to `sms/api/src`, `sms/web/src`, `sms/cli/src`, `sms/sync-worker/src`, `sms/shared/src`.
4. **One SQL file at a time**, and check the state of `DATA_TP1U2_SEP07` first (`SELECT name, state_desc FROM sys.databases WHERE name = DATA_TP1U2_SEP07` through `sqlro.sh master`). If it is not ONLINE, stop.
5. HTTP figures only through the harness (`withApp`, which forces `sms_audit`), always `liveAllowSimulator:false` and an explicit `from` / `to`. End every script with `process.exit(0)`.
6. No `npm install`, no `.env` edits, no change to `PDAS_WRITE_ENABLED` or `LIVE_ALLOW_SIMULATOR`, no migrations. Never touch git state from an audit script.

## 2. Where the files are (they live in the session scratchpad)

All audit and fix-stage working files are in the Claude session scratchpad, **not in the repository**:

`C:\Users\ABDULL~1\AppData\Local\Temp\claude\C--Users-ABDULLAH-SAJID-Desktop-sag-database\985ecc68-39f3-4880-b375-e43ed532d822\scratchpad\` (Git Bash: `/c/Users/ABDULL~1/AppData/Local/Temp/claude/C--Users-ABDULLAH-SAJID-Desktop-sag-database/985ecc68-39f3-4880-b375-e43ed532d822/scratchpad`), written `S` below.

**The scratchpad is session-local.** `handover/contracts/` holds build contracts and `handover/tools/` holds one PowerShell helper (`sqlexec.ps1`); neither holds similar material, so the files below were **not copied into the repository**. If the owner wants this re-runnable after the session folder is cleaned, copy at least `S/harness`, `S/A40`, `S/A41`, `S/A32`, `S/fix` and `S/incident` to a permanent folder outside the repository root first.

| Folder | What it holds |
|---|---|
| `S/harness/` | the read-only harness: `README.txt` (read it first), `app-harness.mjs` (`withApp`: the real compiled API in-process behind `ro-guard`), `services.mjs` (`withPool`), `sqlro.sh` (guarded `sqlcmd`), `browser.mjs` (Edge via Playwright), `ROUTES.md` (every GET route and the period matrix as query strings), `selftest.mjs`, `dist-freshness.mjs`, `refused.log` |
| `S/A40/` | the independent oracle: `sql/` (every SQL file by period), `oracle/README.md`, `oracle/figures.json` (golden figures per period and metric), `oracle/hanger_flags.json`, `py/verify.py` and `py/verify_tables.py` (blind pure-Python re-derivation: 2,030 headline values and 13,299 table rows compared, 0 mismatches) |
| `S/A41/` | the screen matrix (browser captures of every screen for the period matrix): `cap*.mjs`, `shots.mjs`, `result.json` |
| `S/A32/` | the report-and-export matrix: `fetch_all.mjs`, `edge_fetch.mjs`, `filter_fetch.mjs`, `pdf_probe*.mjs`, `result.full.json` |
| `S/A10` to `S/A60/` | the 19 discovery tasks: `result.json` (findings with claim, location, observed, expected, repro), `sql/`, scripts, `out/` |
| `S/verification2/` | the 50 refuters (re-run on `sms_audit`): `RB*-*/result.json` and `sql/`; `verdicts.json` (compact final verdicts) |
| `S/A90/` | `trust-verdict-draft.md` (now `DATA-TRUST-AUDIT-2026-10-02.md`), `eligible.json` (58 fix-eligible items with files and outlines), `gen.py` |
| `S/fixplan/` | `plan.md`, `_PREAMBLE.md` (the safety rules), the per-worker briefs, `GATE.md`, `RV.md`, `COMMIT.md`, `DOCS.md` |
| `S/fix/<cid>/` | per fixed item: `red.txt`, `green.txt`, `neighbours.txt`, `fix.json` (`harness_repro` = the exact query below), `after.json` (RV verdict), `snap/` (the committed file contents), `sha.txt` |
| `S/fix/final/` | RV-final: `a32_fetch.mjs`, `a32_cmp.py`, `a32_diff.json`, `a41_cmp.py`, `a41_diff.json`, `matrix.json`, `selftest.out`, `base/` (the preserved BEFORE baselines) |
| `S/gate/W1`-`W5/` | per-wave gate output: `typecheck.txt`, `vitest1.txt`, `vitest2.txt`, `webbuild.txt`, `layout.txt`, `gate.json` |
| `S/incident/` | the incident notes (`00_INDEX.txt`, `forensic/NOTES.txt`, `restore/01-09*.txt`, `taint.md`) |

## 3. The harness self-test (do this first)

```
cd "C:/Users/ABDULLAH SAJID/Desktop/sag database/sms"
node "$S/harness/selftest.mjs"      # exit 0 only if every test passes; writes S/harness/selftest.json
node "$S/harness/dist-freshness.mjs" # is api/dist current against src? (the gate rebuilds dist; RV-final: api 287, shared 14, sync-worker 64, cli 29 files byte-identical)
```

RV-final recorded **39 of 39** self-tests passing and `dist` fresh at wave 5. A stale `dist` means the harness measures the old code: run `npm run build` from `sms/` (that is the gate's job, not an audit script's).

## 4. The 17-period oracle comparison

The oracle (`S/A40`) computes the golden figures from IFL's **source** tables only, with SQL written from the written definitions (it never read the app code). The app side is `S/A32/fetch_all.mjs` and `S/A41` (HTTP and browser). The comparison is `S/fix/final/a32_cmp.py` and `a41_cmp.py`. SQL for one period: `S/A40/sql/<P>/<P>_cones.sql`, `_rejects.sql`, `_sacks.sql`, `_stops.sql` (and `_hangers.sql` for P02 and P05), run with `bash S/harness/sqlro.sh <db> <file> <out>`; the manifest is `S/A40/sql/manifest.txt`.

| Period | Name | From | To | Filter | Scope |
|---|---|---|---|---|---|
| P01 | JUL-DAY | 2026-07-03 | 2026-07-03 | - | real (J) |
| P02 | JUL-ALL | 2026-06-22 | 2026-07-10 | - | real (J) |
| P03 | SEP-DAY | 2026-08-19 | 2026-08-19 | - | real (S) |
| P04 | SEP-GAP | 2026-08-15 | 2026-08-15 | - | real (S) |
| P05 | SEP-ALL | 2026-08-05 | 2026-09-07 | - | real (S) |
| P06 | CROSS-GEN | 2026-07-01 | 2026-08-20 | - | real (J, S) |
| P07 | STRAY | 2026-07-08 | 2026-07-14 | - | real (J, S) |
| P08 | NIGHT | 2026-09-02 | 2026-09-02 | shift=night | real (S) |
| P09 | SHIFT-RANGE | 2026-09-01 | 2026-09-02 | shift range | real (S) |
| P10a | DAY-EDGE-0820 | 2026-08-20 | 2026-08-20 | - | real (S) |
| P10b | DAY-EDGE-0821 | 2026-08-21 | 2026-08-21 | - | real (S) |
| P10c | DAY-EDGE-0820-0821 | 2026-08-20 | 2026-08-21 | - | real (S) |
| P11 | SENTINEL | 2026-06-21 | 2026-06-23 | - | real (J, S) |
| P12 | SIM-OVERLAP | 2026-08-21 | 2026-09-07 | - | real (S) |
| P12sim | SIM-OVERLAP-SIMULATOR-REFERENCE | 2026-08-21 | 2026-09-07 | - | simulator (not an oracle for a real screen) (M) |
| P13 | EMPTY | 2026-07-20 | 2026-07-25 | - | real (J, S) |
| P14 | SIM-ONLY | 2026-09-14 | 2026-09-14 | - | simulator (not an oracle for a real screen) (M) |
| P14a | SIM-ONLY-DEMO-DB | 2026-09-14 | 2026-09-14 | - | simulator (not an oracle for a real screen) (D) |
| P14b | SIM-ONLY-0916 | 2026-09-16 | 2026-09-16 | - | simulator (not an oracle for a real screen) (M) |
| P15 | REBUILD-DAY | 2026-08-05 | 2026-08-05 | - | real (S) |
| X01 | DOC-CHECK-SEPT-0805-0820 | 2026-08-05 | 2026-08-20 | - | real (S) |

J = July generation (`DATA_TP1U2`), S = September (`DATA_TP1U2_SEP07`), M and D = simulator databases. The audit's 17 matrix periods are P01 to P15 (P10 is three periods: a, b and c); P14 is a simulator-only day with no data in `DATA_TP1U2_SIM` on 14 Sep, and P12sim, P14a, P14b and X01 are extra references outside the matrix. Production day = `CAST(DATEADD(hour,-6,ProductionDate) AS date)`; shifts 06/14/22; plausible cone 1500-2100 g, plausible sack 40-60 kg; matched reject = same generation, same millisecond `ProductionDate`, same `HangerNum`.

**Agreement recorded 2 Oct 2026:** 1,535 figure comparisons across 17 periods, 0 unexplained mismatches before the fix stage (every difference was a finding); 58 of them re-derived with different SQL, 0 mismatches. After the fix stage (RV-final): A32 62,582 comparisons, 20 mismatches fixed, 44 intended changes (the oracle encodes the old behaviour), 0 unintended regressions; A41 3,520 checks, 19 fixed, 0 regressions (`DATA-TRUST-AUDIT-2026-10-02.md` §8).

## 5. Re-running the matrices

```
cd "C:/Users/ABDULLAH SAJID/Desktop/sag database/sms"
node "$S/fix/final/a32_fetch.mjs"     # every report type x every period, JSON and exports   (read-only, through withApp)
python "$S/fix/final/a32_cmp.py"      # compare against S/A40/oracle/figures.json and the preserved BEFORE baseline in S/fix/final/base/A32_out
node "$S/fix/final/rv_capb.mjs"       # browser captures (A41-style); also rv_capshift.mjs, rv_capwall.mjs
python "$S/fix/final/a41_cmp.py"      # compare screens against the oracle and the preserved baseline S/fix/final/base/A41_browser
```

Set `process.env.RO_GUARD_TAG` to your own task id first so refusals in `S/harness/refused.log` are attributable. **Expected refusals:** every export route fires one fire-and-forget `INSERT INTO sms.audit_log`; the guard refuses it and the HTTP response is still 200. Any other refusal from a GET route is itself a finding.

## 6. Each fixed item: repro query and expected after-value

Run each through `withApp({ rank: 3, liveAllowSimulator: false }, ...)` (`get`, `getText`, `getBuffer`), or in the browser harness for the screen items, or `sqlro.sh sms_audit` for the SQL demos. The expected values are the re-verifier's AFTER measurements (`S/fix/<cid>/after.json`). Items proven by unit test only are marked.

| Audit id | Register | Commit | Repro (exact) and expected after-value |
|---|---|---|---|
| C-003 | D-57 | `08cfe07` | GET /api/reports/reject?period=custom&from=2026-09-01&to=2026-09-02&fromShift=2026-09-01.evening&toShift=2026-09-02.morning expect pBarPct 12.56, trend sums 3098/390; July range pBarPct 3.15 |
| C-130 | D-58 | `bb8f814` | GET /api/reports/daily?period=custom&from=2026-08-19&to=2026-08-19&shift=night -> 45 of 1050 (4.3%); P09 range -> 43 of 3098 (1.4%); plain day 65 of 3297 unchanged |
| C-158 | D-59 | `524c4e9` | GET /api/production?from=2026-07-20&to=2026-07-25&groupBy=none -> no scale-verdict dataIssues, sacks 0; control 2026-08-19 unchanged |
| C-007 | D-60 | `526df47` | weight-stations from=2026-08-20&to=2026-09-02&periodFrom=periodTo=2026-09-02&shift=night -> line 1.875, st8 1.44, st2 0, st7 0, st9 2.31, st10 0, st1 0.67; 2026-08-19 morning/evening/night 4.43/4.93/3.52 |
| C-009 | D-61 | `589a3ee` | reject-spc from=2026-07-01&to=2026-07-31&bucket=day -> totalProduced 75178, generations names July; control 2026-08-05..2026-09-07 pBar unchanged |
| C-010 | D-62 | `53b695c` | S/fix/C-010/sql/demo.sql via sqlro.sh sms_audit: new_src==new_raw for cone/sack/qcs/weight (314195731021, 9753198976, 92673009433, 39920776402); xor.sql: old equal 144/144, new 428/430 |
| C-023 | D-62 | `53b695c` | Same demo as C-010 (one change). |
| C-024 | D-63 | `3eabdcf` | S/fix/C-024/sql/stale_per_epoch.sql on sms_audit: own-order stale 5 / 9 / 0 for epochs 1/9/13 (real genuine counts, not the whole-table-seed artefact) |
| C-030 | D-64 | `ff2eb9f` | S/fix/C-030/sql/pred.sql on sms_audit: findings 116 and 121 -> old predicate 'exists (dropped)', new 'not exists (recorded)' for a new batch, 'exists (skipped)' for the same batch |
| C-011 | D-65 | `d61eb37` | No harness repro (the command writes). Unit test only: re-run the green test files in `S/fix/C-011/green.txt` and read `red.txt` for the red reason; for the FK items re-run the read-only `S/A11/sql/q02_ack_fk.sql` against `sms_audit` (`FK_dq_ack_finding` must still read NO_ACTION). |
| C-029 | D-66 | `68f8b46` | No harness repro (the command writes). Unit test only: re-run the green test files in `S/fix/C-029/green.txt` and read `red.txt` for the red reason; for the FK items re-run the read-only `S/A11/sql/q02_ack_fk.sql` against `sms_audit` (`FK_dq_ack_finding` must still read NO_ACTION). |
| C-021 | D-67 | `0c83636` | No harness repro (the command writes). Unit test only: re-run the green test files in `S/fix/C-021/green.txt` and read `red.txt` for the red reason; for the FK items re-run the read-only `S/A11/sql/q02_ack_fk.sql` against `sms_audit` (`FK_dq_ack_finding` must still read NO_ACTION). |
| C-022 | D-68 | `e1c5bdc` | No harness repro (the command writes). Unit test only: re-run the green test files in `S/fix/C-022/green.txt` and read `red.txt` for the red reason; for the FK items re-run the read-only `S/A11/sql/q02_ack_fk.sql` against `sms_audit` (`FK_dq_ack_finding` must still read NO_ACTION). |
| C-026 | D-69 | `d20b108` | No harness repro (the command writes). Unit test only: re-run the green test files in `S/fix/C-026/green.txt` and read `red.txt` for the red reason; for the FK items re-run the read-only `S/A11/sql/q02_ack_fk.sql` against `sms_audit` (`FK_dq_ack_finding` must still read NO_ACTION). |
| C-027 | D-70 | `d20b108` | No harness repro (the command writes). Unit test only: re-run the green test files in `S/fix/C-027/green.txt` and read `red.txt` for the red reason; for the FK items re-run the read-only `S/A11/sql/q02_ack_fk.sql` against `sms_audit` (`FK_dq_ack_finding` must still read NO_ACTION). |
| C-028 | D-71 | `d20b108` | No harness repro (the command writes). Unit test only: re-run the green test files in `S/fix/C-028/green.txt` and read `red.txt` for the red reason; for the FK items re-run the read-only `S/A11/sql/q02_ack_fk.sql` against `sms_audit` (`FK_dq_ack_finding` must still read NO_ACTION). |
| C-112 | D-72 | `b31c3f1` | Station report CSV for 2026-08-05 to 2026-09-07 (`getBuffer('/api/reports/station/export?format=csv&period=custom&from=2026-08-05&to=2026-09-07')`): count cells matching `^'-\d`. Expected 0 (before: 9 at the finder, 13 at the re-verifier); a control column sum of -61 stays unquoted. |
| C-120 | D-73 | `5aea0da` | Register export CSV (`/api/events/export?...format=csv`): first three bytes. Expected `ef bb bf` (before `65 76 65`). Use `getBuffer`, because `getText` hides a BOM. |
| C-113 | D-74 | `03b527a` | getBuffer('/api/reports/calibration/export?format=xlsx&period=custom&from=2026-08-05&to=2026-09-07'): Adjustment sheet C5 serial ~46268.7057 (before 46268.4973) |
| C-121 | D-75 | `ec03678` | getBuffer('/api/reports/daily/export?format=xlsx&period=custom&from=2026-09-01&to=2026-09-02&fromShift=2026-09-01.evening&toShift=2026-09-02.morning'): banner row has no 'All shifts' |
| C-127 | D-76 | `7dbd053` | getText('/api/reports/management-summary/export?format=csv&period=custom&from=2026-09-01&to=2026-09-02&fromShift=2026-09-01.evening&toShift=2026-09-02.morning') -> cones_weighed row period columns contain '1 Sep evening shift' and '31 Aug evening shift'; values 3098/3159 |
| C-128 | D-77 | `ef9e5f9` | GET /api/reports/management-summary?period=custom&from=2026-08-19&to=2026-08-19 -> stations_flagged current null; from=2026-06-22&to=2026-07-10 -> 6; PDF for 2026-07-03 has no 'No station was flagged' |
| C-016 | D-78 | `d067a92` | browser: /?s=line&p=pick&from=2026-08-18&to=2026-08-19, focus From, Backspace -> no /api/production request lacking from; headline still 6,565 cones |
| C-114 | D-82 | `5b30711` | cone-weight and calibration P05 CSV: report_note rows == header.reportNotes count, >0 |
| C-018 | D-84 | `f4d6c75` | /api/weight-stations?from=2026-08-06&to=2026-08-19&periodFrom=2026-08-19&periodTo=2026-08-19&trailingDays=14 ; /api/attention?from=2026-08-19&to=2026-08-19 ; /api/reports/cone-weight?period=custom&from=2026-08-19&to=2026-08-19 : byte-equal (modulo generatedAt) to pre-fix capture. |
| C-043 | D-85 | `4b8dae3` | POST /api/admin/rules/plausibility is a write; do NOT run. Verify by reading app.ts note string. |
| C-039 | D-86 | `e78eb52` | GET /api/reports/product?period=custom&from=2026-08-05&to=2026-09-07 -> target.limitsChangedInPeriod 0 for 1021/1022/1023/1024 (before 1); /api/spc?type=cone&from=2026-08-05&to=2026-09-07&productId=1022 -> spec.limitsChangedInPeriod 0. |
| C-157 | D-87 | `199fd09` | /api/weight-stations?from=2026-07-12&to=2026-07-25&periodFrom=2026-07-20&periodTo=2026-07-25&trailingDays=14 -> station 7 sdG null (before 0). |
| C-049 | D-88 | `146e74c` | /api/spc?type=cone&from=2026-07-20&to=2026-07-25 -> count 0, mean null, stdevOverall null, stdevWithin null (before 0); browser /?s=weight&p=pick&from=2026-07-20&to=2026-07-25 -> no 'mean 0 g'. |
| C-110 | D-89 | `bb8be28` | /api/rejects/by-day-code?from=2026-08-15&to=2026-08-15 -> ratePct 0.04; browser rejects pick 2026-08-15 -> 0.04% |
| C-056 | D-90 | `dfcbc88` | calibration PDF period=custom&from=2026-07-20&to=2026-07-25 text has no-readings sentence |
| C-136 | D-91 | `227d858` | calibration P05 adjustments unchanged (1 real row, station 7) |
| C-132 | D-92 | `98a1789` | daily report note text and reject/hangers PDFs contain the new wording; no figure changes |
| C-139 | D-94 | `7239ba2` | Browser: Readings rp=24 on range morning..night then narrow to evening..night -> page 1; Sacks sp=9 on 2026-08-05..09-07 then pick 2026-08-19 -> page 1, rows shown. |
| C-175 | D-95 | `3e6c0f8` | Open ?s=health&p=range&from=2026-09-06.evening&to=2026-09-07.night; /api/reconciliation request must carry fromShift/toShift; night range n 1,117 per brief. |
| C-155 | D-96 | `da33550` | Line default This shift / P13 (2026-07-20..25): reject tile note reads "— of everything weighed". |
| C-156 | D-97 | `ba88ed9` | Readings on a day with 0 weighed: headline '0 weighed, 0 rejected by the scale.' no percent. |
| C-143 | D-99 | `02c35af` | S/A50/poll.mjs line-yesterday "s=line&p=yesterday" 60 -> /api/data-batch 0 repeats after first. |
| C-036 | D-100 | `baa247d` | P03 from=2026-08-19&to=2026-08-19: /api/weights weightRuleChangedInPeriod false, plausibilityRuleChangedInPeriod true; reportNotes of daily, product, station, cone-weight, management-summary contain the plausible-weight-window sentence; sack-weight-summary no longer prints the weight-basis sentence. P01/P02 no rule notes. |
| C-119 | D-101 | `fc8114c` | cone-weight CSV P05 -> row key target_in_force_at_plant_time, no Z; machine-product CSV P05 -> headers first_plant_time/last_plant_time, 0 ISO-Z cells; browser cone-weight screen material 1022 -> 10:24:59. |
| C-167 | D-102 | `7a40156` | /api/reports/management-summary?period=custom&from=2026-09-01&to=2026-09-02&fromShift=2026-09-01.evening&toShift=2026-09-02.morning -> prior.fromShift 2026-08-31.evening, prior.toShift 2026-09-01.morning; browser caption 'compared with 31 Aug evening shift to 1 Sep morning shift'. |
| C-170 | D-103 | `95ca985` | browser: s=sacks&p=shift (or a range) -> the ledger block shows the whole-day sentence; p=yesterday does not. |
| C-137 | D-104 | `91b1303` | S/A50/poll.mjs line-yesterday 's=line&p=yesterday' 120 and rejects-yesterday -> 0 repeats after first fetch; line-today -> ~2/min |
| C-141 | D-105 | `c345e47` | Browser: route-block /api/weight-stations (A50 leads.mjs L8), Weight p=pick 2026-08-19; expect error text by ~31 s and a retry request. |

Committed at the close-out (SHAs in the register column; repro as the worker recorded it; RV verdict in brackets, with the final state where it differs):

| Audit id | Register | Repro |
|---|---|---|
| C-015 | D-79 `f64bf85` | browser: /?s=line&p=pick&from=2026-07-01&to=2026-08-20 (and s=weight, s=rejects): the 'different data batch' sentence is visible under the headline [RV NOT-VERIFIED: Rejects never showed the sentence; fixed at close-out in `rejectSpc.ts` (the series now also reports the scope's `spansGenerations`), unit-proven; re-run this repro to measure it] |
| C-138 | D-80 `dfabc1e` | browser: p=range 2026-09-02.evening..2026-09-02.evening on s=line/readings/sacks: headline names '2 Sep, evening shift', figures 1,080; 2026-09-01.evening..2026-09-02.morning: '1 Sep evening shift - 2 Sep morning shift', 3,098 [VERIFIED] |
| C-174 | D-81 `f4f00f0` | browser, print media: Readings for 1 Sep evening - 2 Sep morning: print head names '1 Sep evening shift - 2 Sep morning shift'; night of 2 Sep names the night shift [VERIFIED] |
| C-133 | D-83 `99caf8c` | rejected-cones July P02 -> excludedClockFault 1, list 245; Sept P05 0; rejected-hangers P05 1, July P02 1; rejected-sacks 0. Confirm via S/A31/sql/m8_zero.sql first. [RV NOT-VERIFIED on the brief's 1 for hangers July; independent SQL supports 2, so expect 2] |
| C-134 | D-93 `a929512` | /api/reports/rejected-hangers?period=custom&from=2026-08-05&to=2026-09-07&station=14 note and PDF name station 14; unfiltered unchanged [RV NOT-VERIFIED then; the note wording in `notes.ts` had in fact landed, expect both tile and note to name station 14] |
| C-117 | D-98 `becc956` | management summary P09: cones per sack 24.2 / 22.7 / +1.5 [fixed at close-out, unit-proven, not re-measured in a browser] |

## 7. The go-live re-verification checklist (first run against IFL's live data)

From `DATA-TRUST-AUDIT-2026-10-02.md` §7, with the tool to use for each:

1. Row-level source to raw to canonical reconciliation per epoch (counts and `SUM(id)` checksum, both directions), read-only SQL. *Tool:* adapt `S/A10` SQL; **not** `sms verify` (it writes).
2. Confirm the plant instance and the archive collation before `epoch:backfill`; re-run the overlap proof. *Tool:* `SELECT SERVERPROPERTY(Collation)` and `sys.databases.collation_name`; the fix is `53b695c`, proven by unit test and `S/fix/C-010/sql/demo.sql` only.
3. After loading 10 Jul - 5 Aug: per-day cones, rejects and sacks against IFL's own SELECTs; DQ checks over the new history; look for reject-stream and sack silences. *Tool:* `S/A40` SQL by day; look for gaps like 14-18 Aug (C-001) and 27 Jun (C-002).
4. Re-run the 17-period oracle comparison on the new live periods, oracle re-derived blind. *Tool:* §4 and §5.
5. Shift attribution: 0 mismatches against the recomputed 06/14/22; vendor Shift disagreement rate. *Tool:* `S/A12` shift check (275,061 real cones, 0 mismatches before).
6. Weights: plausibility and basis answers from IFL; mean and SD against SQL. *Tool:* `S/A21` SQL.
7. Time zone of the plant PC and viewers (plant clock against genuine UTC fields). *Tool:* C-113, C-119, C-145.
8. Shift-range views after the C-003 and C-007 fixes agree with SQL. *Tool:* §6 rows C-003, C-007, C-130, C-127 on live periods.
9. Health and DQ: no simulator epoch on the live sidecar; acknowledge only data-fact findings. *Tool:* Health screen; `dq_finding` by epoch.
10. Re-measure the live-state lag per winder against the live feed and the real sync cadence. *Tool:* C-008; `S/A23` lag SQL and emulation (assumes a 61 s tick).
11. Rehearse a backup restore and one `rebuild` on a scratch copy before any cutover. *Tool:* owner-run, never an agent (C-011, C-021, C-022).
12. Print one report per type and open its XLSX in Excel; have a person read them. *Tool:* never done.
13. Sign-in sessions at viewer, engineer and manager rank. *Tool:* never exercised; needs IFL-created accounts.
14. Confirm the KPI sheet rows with IFL (all rows "awaiting"). *Tool:* `KPI-DEFINITIONS.md` §5-§6.

## 8. What this guide does not cover

It does not run anything on the plant or IFL's server, does not open a printed page or an Excel file, and cannot reproduce the CLI fixes live (they are proven by fake-pool tests). The session scratchpad may be cleaned by the operating system; copy what you need (§2) before relying on it.

