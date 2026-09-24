# Installation, first hour — what to check on IFL's network before go-live

Internal checklist for the owner. Answers the four things
`IFL-TECHNICAL-ANNEX.md` §4 states cannot be measured off-site: IFL's own
hardware/load, network latency, live table sizes, and whether the read-only
login actually permits what the sync worker needs. Every query below is
**read-only** — `SELECT`, `SET STATISTICS`, or a DMV read. Nothing here
writes, creates, alters, or accepts an epoch. Do not run `sync`, `rebuild`,
`cutover`, or any `epoch:*` command during this checklist — it is a
pre-flight, not the first real cycle.

Run everything through `sqlcmd` using the read-only login IFL provides
(`sms_readonly` or equivalent), against IFL's live server — not Windows
auth, not `sa`. If a query fails with a permission error, that failure is
itself the finding; do not retry with a more privileged login.

---

## Check 1 — Can the login read the four catalogue views the sync worker needs?

**Why:** schema-drift detection and source-generation identification (the
mechanism that caught IFL's own 5 August 2026 table rebuild) depend on
`sys.tables`, `sys.columns`, `sys.types`, and `INFORMATION_SCHEMA.COLUMNS`.
`db_datareader` ordinarily includes these, but this project has already
seen a plant login (`ibrahim`, PDAS) that was EXECUTE-only with no
`db_datareader` and no `VIEW DEFINITION` at all — so this is not assumed.

```sql
-- Run once against each of DATA_TP1U2 and PDAS_TP1U2
SELECT TOP 1 name FROM sys.tables WHERE name = 'pack1_TP1U2';
SELECT TOP 1 c.name FROM sys.columns c
  WHERE c.object_id = OBJECT_ID('pack1_TP1U2');
SELECT TOP 1 name FROM sys.types;
SELECT TOP 1 COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'pack1_TP1U2';
```

- **Good:** all four return one row, no error.
- **Bad:** any one of the four errors with a permission/denied message, or
  returns zero rows where the table is known to exist and have columns.
- **If bad:** do not proceed to install. Ask IFL's DBA to grant the specific
  permission that failed (`sys.tables`/`sys.columns`/`sys.types` are usually
  covered by `VIEW DEFINITION`; `INFORMATION_SCHEMA.COLUMNS` by
  `db_datareader`). Re-run this check after the grant, before touching
  anything else on this list.

## Check 2 — Time one steady-state cycle and one backfill against the live tables

**Why:** the measured figures in the annex (2–3 logical reads per table per
cycle, ~1,300 logical reads for a full backfill, under 100 ms SQL time) were
measured against detached copies on a development machine. This confirms
the same query shape behaves the same way — a seek, not a scan — on IFL's
real hardware and real data, and puts a real elapsed-time number next to
the logical-read count.

```sql
-- Steady-state shape: pick the live MAX(id) for pack1_TP1U2 first,
-- then simulate "the last 500 rows are new" the way the sync worker's
-- overlap window would see it on a cold start.
SET STATISTICS IO, TIME ON;
DECLARE @hi INT = (SELECT MAX([id]) FROM [pack1_TP1U2]);
SELECT [id], [Date], [Shift], [Area], [ProductionDate], [HangerNum],
       [MachineNo], [Lifter], [Weight], [inRange], [MaterialId]
  FROM [pack1_TP1U2]
 WHERE [id] > @hi - 500
 ORDER BY [id];
SET STATISTICS IO, TIME OFF;
```

Check the "Table 'pack1_TP1U2'" line in the IO output for `logical reads`,
and the elapsed time SSMS/`sqlcmd` reports. Repeat with `SET STATISTICS
PROFILE ON` instead of `IO` to confirm the plan says **Clustered Index
Seek**, not Scan.

```sql
-- Backfill shape (READ-ONLY — do not let this run as part of an actual
-- sync; this is a timing rehearsal only, on the SAME connection you are
-- already using read-only).
SET STATISTICS IO, TIME ON;
SELECT COUNT(*) FROM (
  SELECT [id] FROM [pack1_TP1U2] WHERE [id] > -1
) x;
SET STATISTICS IO, TIME OFF;
```

- **Good:** the steady-state query shows a Clustered Index Seek and a
  handful of logical reads (single digits to low tens); the backfill query
  completes in well under a second and logical reads are on the order of
  1–2 per 100 rows (roughly 1,200–1,400 for a table the size of either
  sample).
- **Bad:** the steady-state plan shows a Scan instead of a Seek (would mean
  the live table's index differs from both samples — unexpected and worth
  stopping for); either query takes more than a few seconds; logical reads
  for the backfill are wildly higher than row count would suggest.
- **If bad:** do not assume the annex's timing figures apply here. Note the
  actual elapsed times and logical reads observed, and treat the 60-second
  sync interval as a starting point to reconsider, not a fixed constant.

## Check 3 — Compare live row counts against the two samples this project holds

**Why:** IFL keeps roughly a month of history before pruning. The two
samples this project has measured are 19 and 34 production days; the live
tables could be larger, and a larger live table changes the backfill's cost
(linear in row count) even though it does not change the steady-state
cost (a seek).

```sql
SELECT
  (SELECT COUNT(*) FROM [pack1_TP1U2])         AS cone_rows,
  (SELECT COUNT(*) FROM [sack1_TP1U2])         AS sack_rows,
  (SELECT COUNT(*) FROM [rejectQCS1_TP1U2])    AS reject_qcs_rows,
  (SELECT COUNT(*) FROM [rejectWeight1_TP1U2]) AS reject_weight_rows,
  (SELECT MIN([id]) FROM [pack1_TP1U2])        AS cone_min_id,
  (SELECT MAX([id]) FROM [pack1_TP1U2])        AS cone_max_id;
```

- **Good:** cone row count is in the same order of magnitude as the
  samples (roughly 130,000–150,000 for a month), or smaller if IFL has
  pruned more aggressively than assumed.
- **Bad:** cone row count is an order of magnitude larger (e.g. several
  million) — a live table that large would make backfill take proportionally
  longer than the ~100 ms measured here, and is worth timing directly with
  Check 2's backfill query before committing to a go-live window.
- **If bad:** re-run Check 2's backfill timing against the real count before
  scheduling the first production backfill; consider running it outside
  production hours if the timed figure is more than a few seconds.

## Check 4 — Confirm no lock waits on IFL's own writers during a cycle

**Why:** the software's own code review found no `NOLOCK`/isolation-level
override anywhere, and every read runs at ordinary READ COMMITTED — but
that is a claim about the code, not a live observation. This confirms it
holds true against IFL's actual acquisition process writing to the same
tables at the same time.

```sql
-- Run this WHILE a steady-state-shaped read (Check 2's first query) is
-- in flight from a second session, or immediately after the sync worker's
-- first real cycle once installed.
SELECT r.session_id, r.blocking_session_id, r.wait_type, r.wait_time,
       t.text AS blocked_or_blocking_sql
  FROM sys.dm_exec_requests r
  CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
 WHERE r.blocking_session_id <> 0
    OR r.wait_type LIKE 'LCK%';
```

- **Good:** zero rows returned — nothing is waiting on a lock.
- **Bad:** a row appears naming the sync worker's session (or this
  rehearsal's own session) as blocked, or as blocking IFL's own acquisition
  process's session.
- **If bad:** stop and do not schedule the sync worker's interval any
  tighter than confirmed safe. A blocked/blocking pair here would be the
  first real evidence contradicting the annex's "ordinary shared
  row/page locks, released as it goes" claim, and is worth a second,
  longer observation window before proceeding.

---

## After all four checks pass

Confirm the server/instance name and the read-only login's exact
permissions against `sms/db/bootstrap/10_ifl_readonly_login.template.sql`
match what was actually granted, then proceed with the normal install steps
in `DEPLOY.md`. Keep the raw output of all four checks above — it is the
first real evidence this software has ever produced from IFL's live
server, and worth keeping next to `PERFORMANCE-SOURCE-LOAD-2026-09-24.md`
as the live counterpart to that offline measurement.
