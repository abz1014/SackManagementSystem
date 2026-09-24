# Technical annex — for whoever runs IFL's database and network

Companion to `IFL-WHAT-SMS-IS.md`. Does not repeat `IFL-DEMO-WALKTHROUGH.md`
(how to run the demo) or `IFL-OPEN-QUESTIONS.md` (what we are asking IFL
for) — read both alongside this one. Every claim below is checked against
the running code or a direct measurement of the two data samples IFL has
sent, not against another document.

## 1. What is being installed

Two Node.js processes and one SQL Server Express database, on one PC
supplied by the plant owner, on the plant's own intranet:

```
Plant SQL Server ──read-only──▶ sync-worker (Windows Service) ──▶ SMS's own database (SQL Express)
   (IFL, live)                                                          │
                                                       api (Windows Service, port 4000)
                                                       serves the REST API and the web app
                                                                          │
                                                    browsers on the plant LAN ─▶ http://<host>:4000
```

- **`sync-worker` is the only process that ever connects to IFL's database.**
  It reads on a fixed interval and writes only to SMS's own database.
- **`api`** serves the web application and the REST endpoints. It never
  connects to IFL's database directly.
- The web app and the API are the same web service on port 4000 — one
  address for every browser on the plant LAN, no separate proxy needed.
- No internet connection is required or used anywhere in the running
  application: the built web app references no external host, fonts are
  shipped in the install rather than fetched from a CDN, and nothing in the
  application code makes an outbound request beyond the two databases named
  above.

## 2. What IFL's database must provide

- **A dedicated read-only SQL Server login**, not `sa` and not the vendor
  application's own account, with `db_datareader` on both `DATA_TP1U2` and
  `PDAS_TP1U2`. A ready-to-run grant script for IFL's DBA exists in the
  codebase (`sms/db/bootstrap/10_ifl_readonly_login.template.sql`) so this
  is a script to execute, not a specification to interpret.
- **The server and instance name**, and confirmation the supplied PC can
  open a TCP connection to it — including, if the PLC and server networks
  are kept on separate address ranges, which side the PC should sit on.
- **Read access to `PDAS_TP1U2`'s tables specifically**, not only to
  `DATA_TP1U2`. A login with execute-only rights on PDAS's stored
  procedures (which is what IFL's own engineering account carries today)
  has no table read at all, and the product mirror this software depends on
  for every weight limit and product name fails without it.

Nothing else is required from IFL's systems. No schema change, no new
index, no new stored procedure, no trigger, and no write of any kind to
`DATA_TP1U2` or `PDAS_TP1U2` — this is a hard constraint enforced by design:
only `sync-worker` ever opens a connection to IFL's server, and that
connection is opened with the read-only login above. There is no code path
in this application, in any of its three processes, that issues `INSERT`,
`UPDATE`, `DELETE`, `CREATE` or `ALTER` against either of IFL's databases.

## 3. What the sync process actually does

Every 60 seconds (configurable), the sync worker reads new rows from IFL's
four acquisition tables (`sack1_TP1U2`, `pack1_TP1U2`,
`rejectQCS1_TP1U2`, `rejectWeight1_TP1U2`) past the last row it has already
read, and copies them into SMS's own database unchanged, before deriving
the figures the screens show from that copy. IFL's server is queried; it
is never written to, and no query it receives does more than a bounded
read of new rows.

**Source-generation tracking.** On 5 August 2026 IFL's own system dropped
and recreated all four of these tables, restarting every row's identity
counter at 1. SMS records each such rebuild as a separate "generation" and
refuses to silently combine two generations' counts — an operator has to
register a new generation by name before the software will treat it as
continuous with the last one. This is not hypothetical: it is exactly what
happened once already, between the two data samples IFL has sent.

**What happens if the connection drops.** The sync worker retries on its
own schedule; a broken connection is logged and does not crash the
service. Every screen states how old its data is, measured from the oldest
of the four source tables, so a stale feed is visible rather than silently
reported as current.

## 4. Load on IFL's server

**Everything in this section was measured, not estimated**, by running the
exact queries the sync worker issues (`sync-worker/src/reader/IflSqlAdapter.ts`,
`epoch.ts`, `pipeline.ts`, `seed/seedProducts.ts`) by hand with
`SET STATISTICS IO, TIME, PROFILE ON` against the two real data samples IFL
has supplied, attached locally: the June–July sample (142,511 cone rows,
pre-rebuild schema) and the August–September sample (132,552 cone rows, the
current schema). Full method and every raw number:
`sms/PERFORMANCE-SOURCE-LOAD-2026-09-24.md`. Every other query this
application ever runs — dashboards, reports, exports — reads SMS's own
database, not IFL's, so browsing the application, running a report, or
exporting a workbook puts no additional load on the plant's SQL Server at
all; nothing in this section describes those.

**Steady state, every 60 seconds, forever.** The read of new rows from each
of the four wide tables (`sack1_TP1U2`, `pack1_TP1U2`, `rejectQCS1_TP1U2`,
`rejectWeight1_TP1U2`) is `SELECT ... WHERE [id] > @after ORDER BY [id]`,
where `@after` sits within a small overlap window of the last row already
read. Confirmed by `SET STATISTICS PROFILE ON` against both samples: this
plan is a **Clustered Index Seek** (`SEEK:([id] > [@1]) ORDERED FORWARD`) on
the table's own existing primary-key index — not a scan — costing **2–3
logical page reads per table per cycle**, a cost that does not grow as the
table grows, because a seek's cost is bounded by index depth plus the
handful of rows actually returned. At IFL's own measured arrival rate this
is on the order of 0–5 new rows per table per cycle. Alongside it, a small
set of system-catalogue lookups run every cycle so the software can detect
if IFL renames or adds a column (as happened when `Source` became
`MachineNo` and `MaterialId` was added on 5 August 2026): as of 24 September
2026 this is **three** catalogue round trips per table per cycle, down from
four — a measured redundancy (the same column-list query run twice) was
found and removed. Total steady-state footprint against `DATA_TP1U2` is on
the order of a few hundred logical page reads per cycle, almost all of it
catalogue metadata that stays resident in SQL Server's buffer pool after the
first pass, plus the handful of production rows actually returned.

**The product-reference mirror, against `PDAS_TP1U2`.** Separately from the
four acquisition tables, the software mirrors PDAS's six reference tables
(blends, counts, tube types, materials, pack schemas, pallets — 14 rows
total across all six in the current sample) so product names and weight
limits stay current. As of 24 September 2026 this no longer re-reads all six
tables in full every cycle: a single cheap round trip checks whether any
table's highest row id has moved, and a full read only runs when it has, or
at least once every 10 minutes as a backstop (an in-place edit to an
existing row, such as retiring a product, does not change its id and so
cannot be seen by the cheap check alone). Net effect: roughly 60 one-round-
trip checks per hour plus at most 6 full six-table reads per hour, in place
of 60 full reads per hour previously. A newly created product is visible
within about 60 seconds; an edit to an existing product's row is visible
within 10 minutes.

**Backfill — the one time the source is read in full.** On first startup
(and only then; every later cycle seeks from where it left off), each table
is read in one uninterrupted `SELECT` with no batching or paging. Measured
against both real samples: **1,300 logical reads (July sample, 151,119
rows) and 1,320 logical reads (September sample, 144,077 rows) across all
four tables combined**, completing in under 100 ms of SQL Server time in
every warm run measured (a single cold run against the largest table, cone
readings, took up to 506 ms with an empty buffer cache; every subsequent run
against the same data, warm, took 6–79 ms). This is a one-time cost per
table — every cycle after it is the 2–3-logical-read seek described above,
regardless of how large the table has since grown.

**Concurrency and locking.** One connection to IFL's server is opened per
sync cycle and closed before the cycle ends — never held open in the gap
between cycles. Within a cycle, the four table reads and the PDAS mirror
check run one after another, never concurrently, so the application never
holds more than one connection to IFL's server at a time. No isolation-level
hint is set anywhere in the code (confirmed by search: no `NOLOCK`, no `READ
UNCOMMITTED`); every read runs at the driver's ordinary default, READ
COMMITTED — the same locking behaviour any other read-only client would get,
taking and releasing ordinary shared row/page locks as it goes, holding
nothing across statements or across the gap between cycles.

**What this login must be able to read.** Beyond ordinary table `SELECT` on
the four acquisition tables and the six PDAS reference tables, the schema-
drift and generation-detection mechanism above depends on the login being
able to read four system catalogue views: `sys.tables`, `sys.columns`,
`sys.types`, and `INFORMATION_SCHEMA.COLUMNS`. `db_datareader` ordinarily
includes this, but it has not been confirmed against IFL's actual grant
because that login does not exist yet — see `IFL-OPEN-QUESTIONS.md` item 1.
Without it, the mechanism that caught the 5 August rebuild — and stopped the
software from silently reporting success while reading nothing — cannot run
at all.

**What this section does NOT claim, because only IFL's own server can
answer it:**

1. **IFL's server hardware and whatever else is running on it.** Every
   millisecond figure above was measured on a development machine's local
   SQL Server Express instance against a detached copy of IFL's own data
   files. The query shape and the logical-read counts (a property of the
   query and the data) carry over to any server; elapsed time does not, and
   no claim is made here about what it will be on IFL's actual hardware
   under IFL's actual concurrent load.
2. **Network latency across IFL's own intranet.** This measurement's
   connection was local, with no network hop. The real deployment crosses
   IFL's LAN between the installed PC and their SQL Server; every round trip
   above pays that latency once per cycle, and it cannot be measured without
   a connection to their actual network.
3. **Live table sizes beyond the two samples measured.** IFL keeps roughly a
   month of history before pruning; the two samples measured (34 and 19
   production days) are the only windows this project holds. A live table
   could be larger between prunes. A steady-state cycle's cost does not grow
   with table size (it is a seek), but a live backfill's cost is
   proportional to row count, so it would cost more than the ~1,300 logical
   reads measured here if the live table holds more rows than either sample.
4. **Whether the read-only login IFL provides actually permits the four
   catalogue reads named above.** This is the one item in this section that
   is a request, not a measurement — see `IFL-OPEN-QUESTIONS.md` item 1.

The first-hour installation checklist (`INSTALLATION-FIRST-HOUR.md`) gives
IFL's DBA the exact read-only queries to answer all four of these directly
against the live server, before the software runs its first real cycle.

## 5. Data retention and continuity

- IFL's own acquisition tables are retained by IFL for roughly a month
  before being overwritten, based on the gap observed between the two
  samples supplied to date (the June–July sample ends 10 July 2026; the
  August–September sample begins 5 August 2026 — 26 days exist at IFL and
  have not been sent).
- SMS's own database keeps every reading it has ever copied, with no
  automatic deletion of production data. This is what "permanent history"
  means in practice: once a reading has been synced, it survives independent
  of how long IFL's own system keeps it.
- SMS's database is backed up nightly to disk on the same host, with a
  monthly restore rehearsal as a matter of routine operations.

## 6. Security

- Every account signs in with a password stored as a salted hash
  (argon2), never in plain text — a deliberate departure from the
  plaintext-password accounts found in IFL's own acquisition database
  during the original discovery phase, which this application does not
  reuse.
- Every screen is open to every signed-in account; only a small number of
  write actions (setting a running product, logging a calibration note,
  exporting the raw register, and system setup) are restricted by role,
  and that restriction is enforced on the server, not only hidden in the
  interface.
- All SQL queries are parameterised. No query anywhere concatenates
  user-supplied text into SQL.
- The application is designed to run over the plant's own intranet without
  an internet connection; encrypting traffic with TLS is supported if
  plant policy requires it, but is not required for the software to run.

## 7. What has been verified, and how

- **Against two data samples IFL supplied**, attached to a local SQL
  Server instance: one covering 22 June – 10 July 2026 (142,511 cone
  readings, 5,462 sack readings), one covering 5 August – 7 September 2026
  (132,552 cone readings, 5,435 sack readings). Every measured figure in
  this document and in `IFL-WHAT-SMS-IS.md` — the acquisition lag, the
  rebuild date, the report export behaviour — comes from one of these two
  copies.
- **Excel and PDF export were run end to end against a running copy of
  the application** for the first time on 23 September 2026: the Excel
  workbook returned in 684 ms as a valid OOXML file with eight worksheet
  parts and a real chart part, not styled cells alone; the PDF returned in
  2.3 seconds as a valid four-page `%PDF-1.4` document, rendered by a
  headless browser engine on the server rather than a browser's own print
  function.
- **Nothing in this software has been run against IFL's live plant
  database.** Every measurement above is against a detached copy on a
  development machine. This is stated plainly rather than implied,
  because it is checkable: every number in a live demonstration is IFL's
  own data, and IFL can compare it against their own records.

## 8. Known open items that affect how numbers are read

These do not block installation; they affect the precision of certain
figures until IFL confirms them. Full detail and priority order:
`IFL-OPEN-QUESTIONS.md`.

- Whether the 1,960 g cone weight target includes the tube (sack weight is
  already confirmed gross, i.e. the whole sack, as of 15 September 2026).
- The reporting-definitions sheet (32 KPI rows) awaits IFL's sign-off.
- Six months or more of production history is the practical minimum before
  any drift projection is more than a short-run statistical estimate; SMS
  currently holds 53 production days across the two samples sent.

## 9. What is explicitly out of scope

- No direct PLC connection or automation — confirmed out of scope by IFL.
- No OEE, availability, MTBF or shift-versus-shift analysis — not a
  requirement, deliberately not built.
- No AI model of any kind. The calibration guidance is control-chart
  statistics — drift detection and a linear projection to an action limit —
  chosen because it is explainable and checkable, not because it is
  simpler to build.
