# R-17 scratch-DB integration runs — 29 Sep 2026

**Executed by agents on the dev PC, against scratch SQL Server databases only.
No production or live plant database was touched by either run. This record
was written after the fact — the runs happened earlier the same day, their
results were reported to the orchestrating session, and (as `DEFECTS.md` Part
12 and `CLAUDE.md`'s "owner-scope hardening loop" section correctly noted)
never made it into the repository. This file is that missing record.**

Scope: `sms epoch:backfill`, `sms verify --source-db`/`--epoch`, `sms
epoch:accept`'s data-vintage guard, and `sms rebuild` — the R-17 archive-ingest
path for the 10 Jul – 5 Aug 2026 gap, commits `b81eb1c`, `937616d`, `96f913e`,
`08df232`, `2eaa7a3` (RUN 1 predates `96f913e`/`08df232`; RUN 2 is on HEAD
`08df232`, with `2eaa7a3` landing between the two runs and re-verified live in
RUN 2).

Both runs used the fixture shapes at `sms/scripts/r17-fixture.sql`
(`R17_SRC_FIXTURE`, a well-formed July-shaped source) and a deliberately
tampered/altered copy (`R17_SRC_TAMPERED`), against scratch target databases,
never `sms` (the live/dev app DB) and never `DATA_TP1U2`/`PDAS_TP1U2`.

## RUN 1 — before fixes `96f913e`/`08df232`

- `sms epoch:backfill` dry-run, then `--confirm`: inserted exactly **2,000
  tail rows** (1,400 cone, 400 sack, 150 QCS, 50 weight) tagged to July
  epochs 1–4, plus **1** `sms.audit_log` row.
- Re-running the same backfill inserted **0** rows — idempotent on a second
  pass.
- `sms rebuild` worked on the closed epochs: 2026-07-15 went from **0 to 56
  cones** in the scratch database.
- The tampered archive (`R17_SRC_TAMPERED`) was refused.
- **Two bugs found by this run, both fixed the same day:**
  - (a) `sms verify --source-db` reconciled *every* closed epoch sharing that
    table name, not just the one the operator meant — 12 spurious STOPs.
    Fixed by `96f913e` (`--source-db` now requires `--epoch`).
  - (b) `epoch:accept`'s chronology guard used `sys.tables.create_date`, which
    a restored backup resets to "now" regardless of the data's real age — a
    restored old archive looked like a brand-new generation. `epoch:accept`
    against this run's restored/old-shaped data closed the live epochs 13–16
    and registered 17–20, **in the scratch database only**. Fixed by
    `08df232` (the data-vintage guard, `checkDataVintage()`).
- Scratch databases from this run were dropped afterward. The live `sms`
  database was never touched by this run — its own row counts only grew in
  the background, from the plant simulator, which kept running throughout.

## RUN 2 — on HEAD `08df232` (main checkout confirmed clean before starting)

Restored from a verified backup, `C:\sms-backups\sms-20260929-212238.bak`,
into a fresh scratch database `SMS_SCRATCH_R17` (never the live `sms`
database). Fixtures: `R17_SRC_FIXTURE` and `R17_SRC_TAMPERED`.

- `sms epoch:backfill --confirm`: **2,000 rows**, **1** audit row, immediate
  re-run **0** rows (idempotent, reconfirmed).
- `sms rebuild`, with a real snapshot backup taken first: cone
  **142,511 → 143,911**, sack **5,862**, reject **3,346**; **56 cones** on
  2026-07-15 (matches RUN 1's rebuild result).
- `sms verify --source-db --epoch=1,2,3,4`: every closed epoch reported OK.
  The only STOPs seen were on the **open** simulator epochs, which were
  drifting live while the run was in progress — not a defect in the closed-
  epoch reconciliation this pass tests. `2eaa7a3` (landing between RUN 1 and
  RUN 2) fixed exactly this by having `--epoch` skip any epoch not explicitly
  named, and that fix was reconfirmed live by this run.
- `sms verify --source-db` **without** `--epoch` → usage error, as `96f913e`
  intends.
- Epochs and watermarks were unchanged by the whole run (backfill only ever
  writes `sms_raw.*`, never watermark or `closed_utc` columns — reconfirmed).
- The tampered archive (`R17_SRC_TAMPERED`) was refused, including with
  `--confirm` passed.
- `epoch:accept` against the old archive was **refused** (exit code 2; source
  newest reading 2026-08-04 vs. the open epoch's earliest 2026-08-21 —
  exactly the implausible-vintage case the guard exists for). The override
  dry run (`--i-know-this-is-a-new-generation`, without actually confirming a
  real registration change) printed the audited warning and changed nothing.
- Cleanup: all **3** scratch databases (`SMS_SCRATCH_R17` plus the two
  fixture DBs) and the scratch backup file were deleted after the run. The
  live `sms` database's counts only grew during this run, from the simulator
  continuing to write in the background — nothing in this run wrote to it.
- **Operational note recorded by this run, not yet actioned:** loading the
  real archive when IFL sends it will need `CREATE USER sms_readonly` (or
  whatever `IFL_DB_USER` is at cutover) plus `db_datareader` granted on the
  archive database — the same grant `sms/DEPLOY.md`'s backfill runbook already
  asks IFL for in step 1, now stated with the exact grant shape observed
  while standing up the scratch fixtures.

## What this proves, and what it does not

**Proven:** `sms epoch:backfill` (dry-run and `--confirm`), its idempotency,
its refusal of tampered/mismatched source shapes, `sms rebuild` deriving
canonical rows from the backfilled raw rows, `sms verify --source-db
--epoch=<ids>` reconciling closed epochs correctly (and refusing to run
without `--epoch`), and `epoch:accept`'s data-vintage guard refusing a
restored/old archive masquerading as new (and its override flag behaving as
an audited, non-destructive dry run) — all against real SQL Server scratch
databases, not fake/mocked pools, end to end, twice, before and after
`96f913e`/`08df232`/`2eaa7a3`.

**Not proven by this:** anything against IFL's real 10 Jul – 5 Aug archive,
which IFL has not sent (`IFL-OPEN-QUESTIONS.md`); anything against the live
plant; whether the archive database as IFL will actually deliver it matches
the fixture's assumed shape exactly; the grant step itself, which is IFL's to
perform, not something these runs could exercise for real.

See also: `DEFECTS.md` Part 12 (R-17 section) and `CLAUDE.md`'s "Owner-scope
hardening loop" entry, both of which correctly flagged that no such record
existed in the repository before this file.
