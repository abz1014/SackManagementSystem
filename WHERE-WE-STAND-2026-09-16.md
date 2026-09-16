# Where we stand — IFL Sack Management System

**16 September 2026** · branch `floor-first-rework`, clean tree, 55 commits ahead of `origin/main`
Suite: **1,064 passing · 4 skipped · 97 files passed, 1 skipped** (11.1 s). `npm run typecheck` clean.
Source: 41,571 lines of application code, 15,874 lines of tests, 36 migrations, 72 API routes, 16 screens and sheets.

This document answers four questions: what the software does today, what it will do when the engineering
is finished, what changes when the delivery is finished, and what is required to reach each. Every
capability claim below was checked against the code today. Where a claim could not be verified, it says so.

Sections marked **[internal]** are judgements and risks for the owner. They are not written for a client.

---

## Contents

1. [What the software does today](#1-what-the-software-does-today)
2. [What it will do when the engineering is finished](#2-what-it-will-do-when-the-engineering-is-finished)
3. [What changes when the delivery is finished](#3-what-changes-when-the-delivery-is-finished)
4. [What is left](#4-what-is-left)
5. [The prerequisites](#5-the-prerequisites)
6. [Two numbers, with the reasoning](#6-two-numbers-with-the-reasoning)
7. [The shortest path](#7-the-shortest-path)
8. [Corrections found while verifying](#8-corrections-found-while-verifying-internal) **[internal]**

---

## 1. What the software does today

Three states are kept strictly apart below:

- **Reachable** — a signed-in person can get to it from a screen.
- **Built, not reachable** — the server does it, tested, but nothing in the interface asks for it.
- **Not built** — no code does it.

### 1.1 The shape of the application

One top bar. Six screens — **Line · Readings · Weight · Rejects · Sacks · Report** — plus a gear that opens
**Setup** (admin only), a **Wall** button for a TV, and a data-age sentence that opens **Health**. One global
period control (This shift / Today / Yesterday / Pick a day) that every screen obeys; the period and the
screen both live in the URL, so a pasted link opens on the same period for a colleague.

Four roles, enforced on the server: **viewer (1) · engineer (2) · manager (3) · admin (4)**.
Every screen except Setup is open to every signed-in account. Roles gate **writes and exports only**.

Sign-in is username and password (argon2), session cookie, rate-limited by IP and by username, with
lockout. A user can change their own password from the avatar menu; an admin can reset anyone's.

### 1.2 Screen by screen — reachable and working

| Screen | What a person can do | Writes, and the rank needed |
|---|---|---|
| **Line** | See whether the line is running, stopped (with for how long) or idle — judged against the newest reading, not the wall clock, because the plant's own acquisition writes a cone's row about 18 minutes after it is weighed. Cones, sacks and kilograms for the chosen period. Up to three attention findings (station drift with a projection, a reject rise, cones passed by the scale but outside the product's limits). A table of **what each machine is running right now** — its product, since when, cones in the last two hours, and a "quiet" tag. A grid of cones per station. Last sack, last cone. | Opens the product sheet (**rank 2**) |
| **Readings** | The register. Four listings — cones, sacks, cones rejected by the scale, inspection rejects — with time, id, weight, state and product; 100 rows a page. Filter by station, by state, or by "outside the product's limits". Print with a proper header (line, period, who, when, version). | Export CSV (**rank 3**) |
| **Weight** | Are cones at the right weight, and does any scale need attention. Mean against target, percentage rejected by the scale, ±2σ spread. A control chart over time or a distribution, line-wide or per station, with the product's own limit lines. The **one station table in the application** — average, median, SD, difference from the line *and* from target, days carrying a non-random pattern, reject rate, verdict. Cp/Cpk and which Nelson rules could and could not fire at the available number of points. | — |
| **Rejects** | How many, why, is it rising, where. Total and rate with a quality/weight split. A trend over a fixed 14-day window with the chosen period shaded and p-chart bands. A Pareto of reasons. A day-by-reason table that opens one day's rejects of one code, row by row, each with its own product and station. | Name a reject code (**rank 2**) |
| **Sacks** | Sacks, kilograms, average weight, in-range share, and cones per sack (labelled approximate — the plant records no key from a cone to its sack). By shift and by product. A **line-level stock ledger** per production day: opening, receipts, issues, consumption, adjustments, closing, in sacks or kilograms, each day opening a sheet of that day's movements. Full sack history. | Record a stock movement (**rank 2**) |
| **Report** | **Ten report types**, all selectable: Daily · Shift · Product · Machine/station · Rejects · Cone weight · Sacks · Calibration · Management summary · **Product by machine**. Each carries a header with line, period, filters, who generated it, when on the plant's clock, and the software version. Filters offered per type are exactly the filters the server accepts. Print, **Export CSV**, **Export Excel (.xlsx)**. | Exports (**rank 3**); Management summary is **rank 3** to read |
| **Setup** (admin) | Rename plant/unit/line. Add and edit machines and stations, and link stations to machines. Enable and rename source tables. Set the weight basis, the shift boundaries and the plausibility bounds, each versioned with a reason. Name reject codes and set severity. **Edit a product's limits** (see the defect in §8). Create users, change roles, activate, reset passwords. Read the audit log, paged. | Everything here (**rank 4** to reach) |
| **Health** | Open to every account. Sync verdict, age of the last pass, the **oldest** source table's freshness, the plant probe, blocking data-quality findings, any halted table with the worker's own reason and the command to clear it, per-table detail with watermarks. Database latency, size against the 10 GB Express cap. Service version and uptime. Age of the newest backup file. | — |
| **Wall** | Fullscreen, no navigation, sized for a 1920×1080 TV: the state sentence in very large type, the shift's figures, station bars, a pinned footer with the data-age sentence. Sessions renew while in use so a display never logs itself out. | — |

**Drill-downs** (open over the screen, close with Escape): one station's evidence and its adjustment
ledger, with a **log-an-adjustment** form (rank 2); one reading's full record with its provenance — source
table, source generation, the plant's own row id, the plant's write time against its production time, the
transform version, and how the product was attributed; the **product sheet** (change the running product,
see the changeover history, see and edit the versioned limits); one day's rejects of one code; one day's
stock movements.

### 1.3 What runs outside the browser, today

- **The sync worker.** Every 60 seconds: probe the source, mirror PDAS reference data (blends, counts,
  tube types, materials, **pallets and pack schemas**), read new rows into a raw archive, transform to
  canonical under a lock. It resolves the **source generation** before every read and **halts** on one it
  does not recognise rather than guessing — IFL dropped and recreated their four weighing tables on
  5 August 2026 and restarted every id at 1, so a table wipe is a fact the software must survive. It
  measures the acquisition lag, raises 17 named data-quality findings, and self-clears the ones that are
  states rather than events.
- **The `sms` command line**, twelve commands: `sync`, `verify`, `summary`, `rebuild`, `cutover`,
  `retention`, `user:create`, `user:password`, `epoch:list`, `epoch:accept`, `epoch:purge`, `epoch:drop`.
  Three of them need the live source: `sync`, `verify`, `epoch:accept`.
- **`sms verify` is the only source-versus-SMS comparison in the whole product.** Per source table, per
  generation, it compares `COUNT(*)`, `MIN(id)`, `MAX(id)` and `SUM(id)` between IFL's table and our raw
  archive; `--weights` adds count, sum, average, min and max of the weights across all three layers;
  `--from`/`--to` scopes it to a production-day window, which is the form an acceptance engineer asks for.
  It also checks raw against canonical in both directions by key, so one row missing and one duplicated
  cannot hide inside a matching count.

### 1.4 Built on the server, not reachable from any screen

Six endpoints are live, tested and have no caller in the interface. Each has a typed client function in
`web/src/api.ts` that nothing imports.

| Endpoint | What it does | Why it is unreachable |
|---|---|---|
| `GET /api/reconciliation` (rank 3) | **Not a source comparison.** One grouped query over our own cone table: how many readings in a period, what they weigh, split by state and by whether the plausibility rule excluded them. It exists so the Report's count, the Weight chart's population and the register's states can be shown to be one set of numbers. | No screen asks for it |
| `GET /api/report` | The original single daily summary | Superseded by `/api/reports/daily` |
| `GET /api/downtime` | Stoppages inferred from gaps between cones | The figure survives only inside the daily report |
| `GET /api/weights` | Weight distribution, giveaway, outliers | Weight uses `/api/spc` instead |
| `GET /api/calibration` | Per-station daily drift | Superseded by `/api/weight-stations` |
| `GET /api/calibration/rules` | The Nelson rule table | The rules now ride along on the station data |

Two larger pieces of server work have **no HTTP route at all**:

- **`changeover.ts` — 441 lines, zero callers outside its own file, no test.** This is IFL's own PDAS
  procedure run as one server-side sequence: reuse or create the blend, the count and the tube type, create
  the material, create the pallet, retire the old one. It is the machinery behind the single most important
  thing Hassan sb asked for on 15 September — *machine 1 runs product A in the morning, the engineer
  changes it in the software, the evening shift runs product B*. It is deliberately not routed: the PDAS
  write authority has not been requested, let alone granted.
- **`pdasWrite.ts` — 1,241 lines**, the nine write rights across `Materials`, `Blends`, `Counts`,
  `TubeTypes`, `Pallets` and `nhs_events`. Reachable from the product sheet, but the server refuses every
  one of them: `PDAS_WRITE_ENABLED` defaults to false, and three further guards disable it even if it is
  set (no writer credentials, a write database that is not the configured PDAS database, or reuse of the
  read-only login).

### 1.5 Not built

| | |
|---|---|
| **PDF reports** | IFL asked for "Excel **and** PDF, designed, with graphics" (15 Sep). The Excel writer exists and is dependency-free; it contains no charts. The only route to paper is the browser's own print. |
| **Sack production, or sack stock, per machine** | Not computable from the data IFL supplied by anyone: `sack1_TP1U2` carries no machine or station column at any layer. The screen says so, in the server's own words, rather than omitting the question. The replacement IFL named — *product by machine and shift* — **is** built and reachable, derived from each cone's own `MaterialId`. |
| **A declared per-machine changeover** | The report shows what each machine *actually* ran. Recording what an engineer *declares* it should run, per machine, is the unrouted `changeover.ts`. |
| **Reject-code filter on the register** | You can reach one day's rejects of one code from the Rejects screen, but you cannot filter the register itself by code. This is roadmap Phase 5's single acceptance criterion. |
| **Archive ingest** | The 10 July – 5 August data, and the six months the owner is pursuing, are in the earlier table shape. The reader for that shape is not enabled. |
| **Multi-line** | `line_id` is carried everywhere; a second line has never been configured. Parked on IFL's answer. |
| **AI/ML** | Not started, and correctly so: the roadmap gates it on six months of history and we have 53 production days. The calibration advisory is statistics and Nelson rules, and the roadmap forbids calling it AI unless IFL accepts statistics as satisfying the RFQ — **which they have not been asked**. |
| **PLC / OPC** | Closed by IFL on 15 September (Q63). The re-entry point stays documented and dependency-free; no PLC library appears in any of the five manifests. |

---

## 2. What it will do when the engineering is finished

"Engineering finished" here means the software is ready to be witnessed — a third party can work down a
written protocol and record pass or fail against each row. It does **not** mean the client has approved
anything or that a plant PC exists; those are §3.

**Newly possible for a user:**

1. **Declare a product changeover on one machine, for one shift.** Today the software reports what each
   machine ran. When `changeover.ts` is routed and given a screen, an engineer declares what machine 7
   should run from the evening shift; the report then shows **declared against actual**, which is the check
   Hassan sb's own example is asking for. The declaration records intent and makes the material available
   on the panels; it does not select it on the machine, and the screen will say so.
2. **Prove the numbers against IFL's own query, on screen.** `sms verify --from --to` exists at the command
   line. Surfacing the reconciliation on a screen — ours against theirs, for a named period — turns a
   developer's command into something a manager can run in front of an acceptance engineer.
3. **A report that reaches the people who do not open a browser.** PDF, and charts inside the workbook.
   Today they get a spreadsheet of correct numbers with no picture in it.
4. **Filter the register by reject code**, so a bar on the Pareto resolves to rows without going through
   the day sheet.
5. **Set the calibration threshold.** The advisory's fallback threshold is hardcoded at
   `0.1 × tolerance` or `0.3 × standard deviation`. Until it has a configuration row, a route and a control,
   IFL cannot discharge this dependency even by answering the question.
6. **Load the missing history.** The six months, once it arrives, in the older table shape, as
   non-displacing archive generations.

**Honestly, the rest is not new capability — it is what makes the existing capability defensible:**

- Every SQL statement in the product executed against a real engine at least once, not only against
  hand-written fake pools. The migration harness landed today and proves the 36 migrations; the query
  surface of the services is still unproven.
- A recorded transcript for every claim: migrations from zero, backup and restore on the *current* schema,
  an application restart, a SQL-service restart, a service restart, a network hang.
- A performance floor that has actually been executed rather than assumed — today `MAX_RANGE_DAYS = 366`
  is a number nobody has run.
- `FAT-PROTOCOL.md`, an offline installation procedure, a release artefact the plant PC can install without
  reaching the npm registry, and a living defect register.
- Documentation: six of the roadmap's thirteen Phase 13 deliverables do not exist; five more are partial.

---

## 3. What changes when the delivery is finished

This is the part that is easy to over-promise, because **most of it is not software**. It is IFL signing
things, IFL granting a login, and a plant PC existing. The right way to read this section is: *what can the
system claim once these arrive that it cannot claim today?*

The roadmap's contract for "finished" is its **Definition of Done for Final Product**. Quoted verbatim:

> The final system is ready for IFL FAT when:
>
> - All agreed source integrations work.
> - Cone data reconciles.
> - Sack data reconciles.
> - Product attribution is defined and traceable.
> - Reject codes are approved.
> - Product limits are approved.
> - Reports are approved.
> - User roles are approved.
> - Sack stock method is approved.
> - Calibration advisory is validated.
> - AI/ML is either accepted as an optional module or implemented against agreed criteria.
> - Backup/restore is tested.
> - Failure recovery is tested.
> - Security is tested.
> - No critical/high unresolved defects remain.
> - Installation and FAT documentation is complete.

Sixteen lines. **Seven of them are a signature only IFL can give.** Six more cannot be closed until a plant
host exists. Here is what each unlocks.

| What arrives | What the system can then claim that it cannot today |
|---|---|
| **A read-only login on the live database, and the host** | *"Cone data reconciles"* and *"Sack data reconciles"* stop being method demonstrations against a copy and become a run against production. No `ifl_live` generation has ever existed; today's runs are against IFL's two delivered samples. The cutover — repointing the source **and** `sms epoch:accept` for the live generation — becomes rehearsable against the real thing. |
| **Reject-code meanings** | Every reject reason on every screen and report gets a **name** instead of a numeric pair. Nothing changes in the code: it is data entry through a screen that already exists. Until then, the Pareto's largest bar is labelled with a code. |
| **Written authority for PDAS writes (all nine rights)** | The product-management half of requirement 3 switches from "built, refused" to working: an engineer creates a product, retires one, changes its limits, and the whole changeover sequence runs through the vendor's own procedures with an event-log row beside it. Nothing about this can be turned on by us. |
| **Approval of the product limits, the reject codes, the report layouts, the 34 KPI rows, the role matrix and the sack-stock method** | Six lines of the Definition of Done move from *proposed* to *approved*. Every KPI row in `KPI-DEFINITIONS.md` today reads "IFL approval: awaiting". A report whose layout is approved is a deliverable; one that is not is a draft with correct numbers in it. |
| **IFL's engineers logging calibration adjustments, and the sign-off** | The advisory becomes *validated*. Today the ledger holds one row — a developer's own test on station 7 — so **none** of the twelve drift episodes the sweep found can be confirmed or refuted against reality. |
| **An answer on whether statistics satisfy the RFQ's "AI" line** | Either the optional module is accepted as deferred, or criteria are agreed and Phase 10 becomes startable — and it still needs six months of history against the 53 days we hold. **This question has never been asked.** |
| **The plant PC** | Backup and restore tested on the real machine under the real service account, on the real disk. Failure recovery tested through a real service restart and a real boot order. The installation procedure rehearsed by someone other than its author. Audit tamper-evidence, which needs the `sms_migrate`/`sms_app` split performed at install. Performance at the real production rate on the real hardware. |
| **A FAT date and a signatory** | The protocol stops being a document and becomes a record. Each row is passed, failed, or explicitly marked "SAT, not FAT" with its dev-machine rehearsal attached. |
| **The missing history** | Continuity: 10 July – 5 August, and the six months. Without it the product's own claim — that the sidecar is the archive of record because IFL keeps about a month — has a hole in it where July and August should be. |

**[internal]** The pattern worth holding on to: an open question sent to a client returns silence; a
sentence with a signature block returns a signature or an edit, and both are progress. Six of the nine
IFL asks should go out as instruments to be signed, not as questions.

---

## 4. What is left

### 4.1 Engineering — what we can do alone

Effort is for the engineering only, in working days, solo. It does not include the client's turnaround.

| # | Item | Why it matters | Effort |
|---|---|---|---|
| E1 | **Push the branch and let CI run once.** 55 commits, four weeks of work, exist on one laptop. CI has never executed — there is no workflow file on the remote. | The single largest risk in the project is not technical | hours |
| E2 | **Fix the limit editor being reverted by the mirror** (§8, finding 1) | The feature shipped today survives about one sync interval | 0.5 |
| E3 | **Finish the query-surface half of the integration harness**, then fix what it finds | 1,064 tests give zero coverage of query-string-versus-schema agreement | 4–6 |
| E4 | **Reject-code filter on the register** | Phase 5's only acceptance criterion | 1 |
| E5 | **Calibration threshold floor** — a config row, a route, a Setup control | Without it IFL cannot answer the question even if they want to | 1–1.5 |
| E6 | **Run the injected-drift scenario** in the simulator and record it | The half of the validation that proves the detector *catches* a drift. Never run | 0.5 + run |
| E7 | **Surface reconciliation on a screen** (and fix the population defect the assessment recorded) | Turns a CLI command into something demonstrable at the FAT | 1–1.5 |
| E8 | **Rehearsal transcripts**: migrations from zero on the current schema; backup and restore on the current schema; application restart; SQL-service restart; NSSM service restart; a network hang via a firewall DROP | "There is no stored transcript of any run anywhere in the repository." A witnessed FAT needs artefacts, not prose | 3–4 |
| E9 | **Install NSSM on the development machine and run the worker as a service, once** | It has never run as a Windows service anywhere. The log files `DEPLOY.md` says it creates do not exist | 0.5 |
| E10 | **Performance floor**: synthetic volume to ~400 production days, then set `MAX_RANGE_DAYS` to a number that has been executed | 366 days is an assumed limit | 2 |
| E11 | **Security evidence**: header assertions, a 429 test, `npm audit`, a route-coverage test, a registry-parity test (client and server report tables must be equal) | The two defects this class has actually produced — the tenth report type omitted from the UI, and the rank bypass by percent-encoding — would both have been caught by the parity pair | 1.5 |
| E12 | **Fix `DEPLOY.md`'s false instructions** — `--role=operator` at line 87 is rejected by the CLI; step 8 repeats the wrong role names; step 1 forward-references an offline procedure that does not exist | A stranger cannot follow the installation manual today | 0.5 |
| E13 | **Neutralise the ngrok tooling** (§8, finding 2) | A public tunnel URL fronting the API is committed to the remote | 0.5 |
| E14 | **`FAT-PROTOCOL.md`** — one row per Definition-of-Done line and per phase acceptance criterion, each with evidence, steps, expected result, a pass/fail box, and a mark for the rows that are IFL's or the host's | This is the deliverable that converts approvals and the missing host from failures into a jointly owned checklist | 2–3 |
| E15 | **Offline install procedure and a release artefact** | Today the plant PC is told to run `npm ci` against a registry it cannot reach | 2 |
| E16 | **`DEFECTS.md`** — a living register with a status column and a closing commit per row | Zero HIGH defects remain, and no document in the project says so | 0.5 |
| E17 | **Documentation truth pass** — the data dictionary is nine migrations stale; `CLAUDE.md`, `PROJECT_STATUS.md` and `DEPLOY.md` all carry wrong counts (§8) | Roadmap rule 15 | 1 |
| | **Subtotal — the FAT-ready set** | | **~22–27 days** |
| E18 | Route the changeover and give it a screen | IFL's single most important requirement, currently unreachable | 5 |
| E19 | PDF reports, and charts in the workbook | IFL asked for both, explicitly | 8–10 |
| E20 | Archive ingest for the older table shape | So the six months load the week they arrive | 7–12 |
| E21 | The remaining four manuals (database architecture, integration spec, user, admin, troubleshooting, change control, release notes) | Roadmap Phase 13: six absent, five partial | 8–12 |
| E22 | Multi-line | Parked on IFL's answer; do not build past it | 5+ |
| | **Subtotal — beyond FAT-ready** | | **~33–44 days** |

### 4.2 Delivery — what needs someone else

| # | Item | Who | What it gates |
|---|---|---|---|
| D1 | **A dedicated read-only `db_datareader` login on both live databases, and the host** | IFL's DBA | Definition-of-Done lines 1, 2, 3. Longest lead item in the project |
| D2 | **Written authority for SMS to write to PDAS — naming all nine rights** | IFL, in writing | Requirement 3's write half; the entire changeover module |
| D3 | **Reject-code meanings** | IFL | Line 5 ("Reject codes are approved") |
| D4 | **Approval of the product limits in force** | IFL | Line 6 |
| D5 | **Approval of the report layouts and the 34 KPI definitions** | IFL | Line 7 |
| D6 | **Approval of the role matrix** | IFL | Line 8. The role *model* they confirmed on 15 Sep; the matrix has not been signed |
| D7 | **Approval of the sack-stock method** | IFL | Line 9 |
| D8 | **Calibration sign-off, and their engineers logging adjustments** | IFL | Line 10. Seven sign-off rows, all "awaiting" |
| D9 | **Whether statistics satisfy the RFQ's "AI" line** | IFL — **never asked** | Line 11 |
| D10 | **Approval of the 24-case classification fixture** | IFL | Line 4's traceability half |
| D11 | **The 10 Jul – 5 Aug data and the six-month archive** | IFL | Continuity of history |
| D12 | **A plant PC, on the plant network** | Owner supplies (IFL's 15 Sep answer, Q65–70) | Lines 12, 13, and 14's tamper-evidence half |
| D13 | **A FAT date and a signatory** | IFL + owner | Line 16 |

---

## 5. The prerequisites

For each half, what must be *available* before it can be completed.

### 5.1 What the owner must do himself

| | Prerequisite | What it gates |
|---|---|---|
| **O1** | **Push `floor-first-rework` with upstream set.** The branch has no upstream; `origin/main` is at a commit from 19 August holding 128 files. | Everything. CI has never run. Four weeks of work has one physical copy. |
| **O2** | **A copy of `D:\sms-backups\*` on other hardware.** The July generation — 142,511 cones — exists nowhere else; IFL dropped that table. | The archive-of-record claim, which is the product's reason to exist |
| **O3** | **Check whether `github.com/abz1014/SackManagementSystem` is private**, then act on the answer. A live public ngrok URL fronting the API is in `sms/ops/sms-watchdog.ps1`, on the remote since before 19 August, alongside IFL's database names and schema details. **[internal]** If it is public this is a client-relationship question, not an engineering one. | E13; and a conversation with IFL that should not happen by surprise |
| **O4** | **Decision: jsdom + testing-library for UI tests?** Default no, with a registry-parity plus route-coverage substitute at one day instead of one to one-and-a-half weeks. | E11's scope; ±1–1.5 weeks |
| **O5** | **Decision: a scratch SQL database for the integration test?** Effectively answered yes by today's work — but the four tests are **skipped by default** and there is no committed transcript of the run. | E3, and one FAT row's wording |
| **O6** | **Decision: provision `sms_pdas_writer` locally against the `_SEP07` copy?** | The offline proof of the PDAS write path, including whether `CreateMaterial` really refuses a duplicate blend/count/tube |
| **O7** | **Send the client pack.** Six instruments, batched by turnaround: the login request; the reject-code sheet; the approvals packet (fixture, sack-stock method, role matrix); the PDAS authority request; reports/KPIs/PDF/AI/calibration; the parked questions. | Every one of D1–D11 |

### 5.2 What IFL must supply

| | Prerequisite | What it gates |
|---|---|---|
| **I1** | The read-only login and the host (D1) | DoD 1, 2, 3 — and the cutover |
| **I2** | Written PDAS authority, nine rights (D2) | The changeover module; requirement 3's write half |
| **I3–I8** | Six approvals: reject codes, product limits, reports and KPIs, roles, sack-stock method, calibration (D3–D8) | DoD 5, 6, 7, 8, 9, 10 |
| **I9** | An answer on "AI" (D9) | DoD 11 |
| **I10** | The classification fixture sign-off (D10) | DoD 4's traceability half |
| **I11** | The missing data (D11) | E20 is not worth starting before this is confirmed |

**Ten approvals in total** (I2 through I10 plus the fixture), one login, one host, and one data delivery.

### 5.3 What must physically exist

| | Prerequisite | What it gates |
|---|---|---|
| **P1** | **A plant PC**, imaged, on the plant network, with SQL Server Express and disk headroom. **Set its OS timezone to the plant's before anything else** — a freshly imaged Windows host defaults to UTC, on which every reading arrives five hours in the future, silently. | DoD 12, 13, 14's tamper-evidence half; the installation rehearsal; performance on real hardware |
| **P2** | **A second machine, today**, for O2 | The archive |
| **P3** | **A FAT date and a signatory** | DoD 16. A protocol nobody has agreed to witness is a document, not an acceptance |

---

## 6. Two numbers, with the reasoning

Both are re-derived below rather than carried over.

### 6.1 Engineering: **67 / 100**

**Denominator:** seventeen engineering-ownable capability areas — the roadmap's own "Core functions" list
minus the AI module (which is gated on data volume, not on engineering) plus four areas that FAT-readiness
requires and the core-function list does not name. Each scored 0–1 against evidence in the code.

| Area | Score | Why |
|---|---|---|
| Cone acquisition and monitoring | 1.00 | Epochs, fingerprint, watermark, overlap, lag, DQ, halts |
| Cone weight limit checking and limit administration | 0.85 | Time-versioned limits are solid; the editor is reverted by the mirror (§8) |
| Reject monitoring, history, trends | 0.90 | No reject-code filter on the register |
| Product management and attribution | 0.65 | Attribution real; declared per-machine changeover unrouted; PDAS writes off |
| Sack data acquisition and history | 1.00 | |
| Sack stock / production per machine | 0.50 | Line ledger and the machine-product report built; per-machine stock impossible from the source |
| Dashboards and reports | 0.70 | Ten types, CSV and XLSX, print. No PDF, no charts in the workbook |
| Statistical calibration advisory | 0.80 | Built; no threshold floor, no config row, no control |
| User, RBAC, security, audit | 0.85 | Built and tested; security evidence missing |
| Historical data retention | 0.80 | Retention, epochs, archived floor; archive ingest not built |
| Integration health monitoring | 0.95 | |
| Backup and restore | 0.60 | Two real rehearsals — both on a schema nine migrations old; config backup never run |
| Scalable line/machine configuration | 0.80 | Configurable in Setup; multi-line unbuilt |
| Real-schema execution proof | 0.50 | Harness built and run once; query surface uncovered; skipped by default; no transcript |
| Failure-recovery rehearsal | 0.35 | Application restart done; service, SQL and network cases never run |
| Performance floor at volume | 0.00 | Never executed |
| FAT and installation documentation, release artefact | 0.20 | `DEPLOY.md` is substantial; six Phase 13 deliverables absent, five partial |
| **Total** | **11.45 / 17 = 67 %** | |

**Where this differs from ~55.** It does not, materially — it differs in the denominator. Against the
narrow, testable target (*the software is witnessable*) the evidence gives **67**. Against the assessment's
fuller "finished" — which adds PDF, routed changeover, archive ingest, multi-line, four more manuals and a
sweep of 59 MEDIUM defects — the same scoring method gives about **50** (11.75 out of a 24-area
denominator). The figure of 55 sits between the two and is defensible under a blend of them. I would steer
by 67, because the narrow target is the one with an exit condition.

**What moved today:** four HIGH defects closed, the tenth report type made reachable, XLSX served and
offered, the pallet mirror built, `sms verify` made prune-safe, the API given its own pool, and the
migration runner executed against a real engine for the first time. That is roughly eight points of the
sixty-seven, earned in one day, and most of it came from the risk-reduction stages rather than from
features.

### 6.2 Delivery: **13 / 100**

**Denominator:** twelve items that require someone other than the developer — the nine approval lines of
the Definition of Done, plus the live login and host, the missing data, and the plant host with a FAT date.

| Item | Score | Why |
|---|---|---|
| Live read-only login and host | 0.00 | Never requested formally; no `ifl_live` generation has existed |
| Written PDAS authority (nine rights) | 0.00 | Not requested. The boundary document that must precede it landed yesterday |
| Reject codes named | 0.20 | Mechanism confirmed 15 Sep ("set in Setup, no predefined list"); no values |
| Product limits approved | 0.20 | Method confirmed ("changeable in admin settings"); no values |
| Reports and KPIs approved | 0.10 | 34 KPI rows drafted, every one "awaiting"; nothing sent |
| User roles approved | 0.50 | The four-role model is IFL's own 15 Sep answer and is built; the matrix is unsigned |
| Sack-stock method approved | 0.40 | Q28 answered and it *moved* the requirement; the method document does not exist |
| Calibration advisory validated | 0.10 | One half of the method run, with an unflattering result; seven sign-off rows all awaiting; their ledger holds one developer test row |
| AI/ML accepted or scoped | 0.00 | Never asked |
| Missing history delivered | 0.10 | Owner pursuing; nothing received |
| Plant PC exists | 0.00 | |
| FAT date and signatory | 0.00 | |
| **Total** | **1.60 / 12 = 13 %** | |

**Where this differs from ~15.** Within noise. I score roles higher than zero because IFL genuinely
answered the role question on 15 September, and everything else at or near zero because **nothing has been
sent**. The 15 September meeting was real progress on *requirements*; it produced no *approvals*, and the
Definition of Done asks for approvals.

**[internal]** The asymmetry between 67 and 13 is the whole strategic picture. Engineering is the half we
control and it is two-thirds done. Delivery is the half we do not control and it has barely started, and
its longest item — the live login — is measured in weeks or months. **The client track should have started
before the build track, and starting it is worth more per hour today than any code.**

---

## 7. The shortest path

### Start now — nothing blocks these

1. **Push, with upstream set. Then check the repository's visibility.** (O1, O3) — minutes, and it
   determines whether E13 is a tidy-up or something to do before anything else today.
2. **Send the client pack.** (O7) Six instruments, batched by turnaround, sent as things to sign rather
   than questions to answer. The login request goes alone and is re-sent weekly.
3. **Copy the backups to other hardware.** (O2)
4. **Fix the limit editor's reversion.** (E2) It shipped today and does not survive a sync interval.
5. **Finish the integration harness's query-surface half, and fix what it finds.** (E3) This is the only
   remaining item whose findings are unknown; everything else is a known quantity. Discover early.
6. **Capture evidence while building it** — every rehearsal in E8 and E9 produces a committed transcript
   the first time it is run, not a second time later for the record.

### Next, in this order

7. Reject-code filter (E4) · calibration threshold floor and its control (E5) · the drift scenario (E6) —
   each one gives an IFL answer somewhere to land, so their replies cost zero engineering on return.
8. Security evidence and the registry-parity pair (E11) · performance floor (E10).
9. `DEPLOY.md`'s false instructions (E12) · the offline install procedure and release artefact (E15).
10. `FAT-PROTOCOL.md` (E14) and `DEFECTS.md` (E16), last — because the protocol's rows are the evidence
    produced in steps 5 through 9, and writing it earlier means writing it twice.

### Waits on an answer, and should not be started before it

- **Routing the changeover (E18)** — waits on the written PDAS authority. A FAT cannot test a feature that
  is disabled by design. **[internal]** Reversing this is the owner's call; it costs about a week.
- **PDF (E19)** — waits on IFL's own answer about layouts. One to two days of browser print against two
  weeks of generated PDF is a fork worth having them choose.
- **Archive ingest (E20)** — waits on confirmation the data is coming.
- **Multi-line (E22)** and the shift-attribution mode — one sentence each from IFL. Building past either
  is the expensive mistake.

### Cannot be closed at all until there is a plant host and live data

State these to IFL as jointly owned from the start, not as engineering debt discovered on the day:

- *"Cone data reconciles"* and *"Sack data reconciles"* against live source — no live generation has ever
  existed. The same command run against the delivered copies, with its transcript attached, is the nearest
  available evidence.
- The cutover and `epoch:accept` for the live generation.
- *"Backup/restore is tested"* on the real machine, service account and disk.
- *"Failure recovery is tested"* through a real service restart and boot order.
- The tamper-evidence half of *"Security is tested"* — it needs the `sms_migrate`/`sms_app` split performed
  at install.
- Performance at the real production rate on real hardware, with real concurrent users.
- The installation rehearsal on hardware that is not this laptop.
- The calibration walkthrough with IFL's engineers, on live data, after go-live.

Everything in that list belongs in the protocol marked **"SAT, not FAT"**, with its dev-machine rehearsal
attached. A FAT that pretends the approvals and the host do not exist fails on the day; one that names them
turns them into a checklist both sides own.

---

## 8. Corrections found while verifying **[internal]**

Six things turned up that contradict what the project's own documents say. The first is a live defect.

**1. The product-limit editor that shipped today is undone by the sync worker within one pass.**
`POST /api/products/limits/local` appends an `sms_local` row to `sms.product_limit_version`
(`api/src/services/productLimits.ts:355`). On its next pass, `seedProducts` compares PDAS's values against
*the newest recorded version of any source* and appends a `pdas_observed` row when they differ
(`sync-worker/src/seed/seedProducts.ts:184-213` — the query has no `WHERE source = 'pdas_observed'`).
So: an engineer widens a limit; sixty seconds later the mirror sees PDAS still says the old value,
disagrees with the newest version, and writes a `pdas_observed` row stamped *now* — which supersedes the
engineer's change for every subsequent reading. `SOURCE_PRIORITY` does not save it: it is a tie-break for
two rows sharing the same millisecond, not a precedence rule over time. No test catches this; `seed.test.ts`
still asserts that `seedProducts` "is the only writer of `sms.product_limit_version`", which stopped being
true today. **This is a HIGH, and it is new.** The fix is to exclude deliberate writes from the comparison —
or to record the mirror's observation without letting it supersede one.

**2. The migration-harness claim needs three corrections.** The harness is genuine and well built: it
imports the *real* runner from `scripts/migrate-core.mjs`, and it refuses any database not named
`sms_test_*` before opening a connection. But (a) it is **opt-in on `SMS_TEST_DB_SERVER`** — its four tests
are precisely the four skipped in the 1,064/4 run, so the suite you quoted did not execute it, and CI never
will; (b) there were **35** migration files at that commit, not 36 — 038 arrived afterwards, and the file's
own header comment says "001..036", now stale twice over; (c) **there is no committed evidence of the run** —
no log, no transcript, no artefact. The run is attested only by its own commit message, which is exactly the
thing the dev plan says a FAT cannot accept. Also: "the first time any SQL in this project executed against
a real engine" is not right — `DATA-DICTIONARY.md:3` records being generated against a live sidecar with
29 migrations applied. The accurate, narrower claim is that it is the first time any *test* did.

**3. The plant-timezone fix is a warning, not an enforcement.** There is no `PLANT_TZ` anywhere. The plant
clock is still the host's OS timezone (`shared/src/domain/plantClock.ts:2`). What was added is an optional
cross-check on `PLANT_UTC_OFFSET_MINUTES`: unset, it is skipped entirely; set and mismatched, it logs a
warning and raises a WARNING data-quality finding. The code says so deliberately — "Neither treats a
mismatch as fatal" — on the reasoning that refusing to start on a misconfigured plant PC would be worse than
the silent bug. That is a defensible choice, but it means **P1 stands**: the timezone must be set on the
plant PC before it is built, and the software will not stop you if it is not.

**4. `/api/reconciliation` is exactly what you said it is** — a within-SMS weight-population check, not a
source comparison. Confirmed at `api/src/services/reconcile.ts:1-19`, one grouped query over
`sms.cone_event` alone. The real source comparison is `sms verify`. Worth adding: it is also **unreachable**
— `getReconciliation` exists in `web/src/api.ts:1554` with no caller in any screen.

**5. Several counts in the project's own documents are wrong.** `CLAUDE.md` says "31 app tables after 27
migrations" and "266 tests in 28 files"; the truth is **40 tables (36 `sms.*` + 4 `sms_raw.*`) after 36
migration files** (001–030 and 033–038 — 031 and 032 do not exist) and **1,068 tests in 98 files**.
`CLAUDE.md` also says `getOee`, `getShiftAnalysis` and `getStoppagePatterns` "remain" in `web/src/api.ts`;
they were deleted on 15 September and only a tombstone comment is left. `PROJECT_STATUS.md` says nine
roadmap phases are COMPLETE while the assessment says zero are; its §3 says "the next planned work is
Wave B and it has not begun" while its own §2 lists Wave B as done. `DATA-DICTIONARY.md` is nine migrations
stale. `DEPLOY.md:87` instructs the installer to run a command the CLI now rejects.

**6. The ngrok exposure already exists.** The assessment treats it as a pre-push concern; it is not.
`sms/ops/sms-watchdog.ps1` and `install-sms-watchdog.ps1` are on `origin/main` and have been since before
19 August, and the watchdog embeds a live public tunnel URL fronting the API. Pushing does not widen it.
The visibility check (O3) is what determines whether this is an hour's cleanup or something more.

---

*Verified against the working tree at `2e8b470`, 16 September 2026. Every capability claim in §1 was
checked against the route tables in `sms/web/src/App.tsx` and `sms/api/src/app.ts` and against the screens
themselves, not against any summary.*
