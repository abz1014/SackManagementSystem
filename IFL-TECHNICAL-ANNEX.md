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

No schema change, no new index, no new stored procedure, no trigger, and no
write of any kind to `DATA_TP1U2` — this is a hard constraint enforced by
design: `sync-worker`'s connection to `DATA_TP1U2` is opened with the
read-only login above, and no code path in this application issues
`INSERT`, `UPDATE`, `DELETE`, `CREATE` or `ALTER` against it.

`PDAS_TP1U2` is different, by IFL's own written request (the product
changeover workflow), and only through a dedicated login, `sms_pdas_writer`,
separate from the read-only one above. That login is limited to the nine
rights IFL authorised in writing on 19 September 2026: the vendor's own
Add / Retire / activate stored procedures for materials, blends, counts,
tube types and pallets, one guarded single-row update to a product's
weight limits (the vendor supplies no procedure for that), and one insert
of an audit event row. No new database objects, no `DELETE`, and no table
outside those covered by the nine rights. This write path stays switched
off (`PDAS_WRITE_ENABLED=false`) until it has been proven to work end to
end on a local copy of the data; it is not yet in use against the plant
database.

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

The sync worker issues one bounded, parameterised, indexed-by-primary-key
read per source table per interval (default every 60 seconds). It never
scans a whole table more than once, at first startup. Every other query
this application ever runs — dashboards, reports, exports — reads SMS's own
database, not IFL's, so browsing the application, running a report, or
exporting a workbook puts no additional load on the plant's SQL Server at
all.

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
