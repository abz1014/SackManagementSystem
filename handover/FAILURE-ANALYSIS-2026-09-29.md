# SMS Failure Analysis — What Can Go Wrong, How We Would Know, and What Is Still Unproven

**System:** IFL Sack Management System (SMS), TP1 Line 3 / Unit 2
**Prepared for:** technical evaluation round (GM, managers, process engineers, and a technical reviewer)
**As of:** 29 September 2026, branch `floor-first-rework`, HEAD `dff393b`
**Basis:** the repository, its defect register (`DEFECTS.md`), the deployment runbook (`sms/DEPLOY.md`), the code, and read-only queries run on the development PC on the date above. **Nothing in this document was observed on IFL's plant.** Every figure comes from IFL's two sample database copies (July and September 2026) plus a plant simulator, all on one development PC.

---

## 0. How to read this document

### Words used, each explained once

| Term | Meaning here |
|---|---|
| **PLC** | The Siemens controllers on the machines that weigh each cone and sack. SMS does not connect to them. |
| **Acquisition layer** | IFL's own software, which copies PLC readings into IFL's SQL Server database (`DATA_TP1U2`). |
| **SQL Server / SQL Express** | Microsoft's database. IFL's plant runs SQL Server. SMS keeps its own copy in the free "Express" edition, which limits each database to 10 GB. |
| **Sidecar database** | SMS's own database (`sms`) on the SMS PC. The screens read only this database. They never read IFL's database. |
| **Sync worker** | The SMS background program that reads new rows from IFL every 60 seconds and copies them into the sidecar. It is the only part of SMS that connects to IFL's data. |
| **Watermark** | The highest IFL row number the sync worker has already copied. The next pass reads everything above it. |
| **Generation (epoch)** | One "life" of an IFL table. When IFL drops and recreates a table, row numbers restart at 1 and a new generation begins. SMS keeps generations apart so that it never adds them together by mistake. |
| **Fingerprint** | A summary of the columns SMS reads from a table. If it changes, SMS stops rather than guess. |
| **API** | The SMS server program that answers the browser's requests and serves the screens. |
| **RBAC / rank** | Role-based access control. The roles are viewer (1), engineer (2), manager (3) and admin (4). Every screen is readable at every rank. Ranks only gate write actions. |
| **PDAS** | IFL's product master database (`PDAS_TP1U2`): blends, counts, tube types, products (with weight setpoint and limits), and pallets. It is the only IFL database SMS can write to, and that write path is switched off at the plant. |
| **Echo-back** | After writing to PDAS, SMS reads the row back and checks that PDAS now holds what was requested. |
| **DQ finding** | A data-quality alert raised by SMS about suspicious data, such as a zero weight or an impossible timestamp. |
| **Health** | The SMS screen, and the `/api/health` address behind it, that reports whether data is fresh, whether backups exist, and whether the database is near its cap. |
| **NSSM** | A small tool that runs a program as a Windows service, so it starts at boot and restarts after a crash. |
| **FMEA** | Failure Mode and Effects Analysis. The table in section 3 lists each way a part can fail, what happens, how we would notice, and what reduces the risk. |
| **FAT / SAT** | Factory Acceptance Test (off-site) and Site Acceptance Test (on the plant). |

### Scoring used in section 3

- **Likelihood:** Low / Med / High. **Almost all of these are engineering judgement, not measurements.** Nothing has run at the plant, so no failure rate has been measured. Where a likelihood rests on something observed (for example, "this happened once in the data"), the row says so.
- **Severity (1–5):** 1 = cosmetic. 2 = inconvenience or confusion. 3 = a misleading screen or an outage of hours. 4 = a wrong figure that could drive a decision, loss of recent data, or a wrong value written to PDAS. 5 = loss of irreplaceable data, or a wrong value reaching production with no one noticing.
- **Risk score** (used for the top-10 list) = Likelihood (Low 1, Med 2, High 3) × Severity.
- **"Built and verified"** means code exists and a test or recorded run proves it. **"Designed only"** means it is documented but has never been run.

---

## 1. What SMS is today, and what it is not

**What it is:**

- **An information system.** It shows cone weights, rejects, sacks, calibration drift and reports for one line.
- **A reader of a copy.** It reads IFL's acquisition database read-only, every 60 seconds (`SYNC_INTERVAL_SECONDS=60`), into its own sidecar database. The screens read only the sidecar.
- **About 18 minutes behind the plant, by construction.** IFL's acquisition layer writes each cone's row about 18 minutes after the cone is weighed: 909 s minimum and 1,090 s mean, measured over 142,509 real rows (`CLAUDE.md:1072-1086`, `sms/DEPLOY.md:255-268`). Add up to one sync cycle (60 s) and one screen refresh (10–30 s). SMS never sees the present, only the plant as it was about 18–20 minutes ago. The screens state this lag and judge "running / stopped" against "now minus lag" (`api/src/services/live.ts:575-595`).
  *Documentation inconsistency, flagged:* `SCHEMA.md:158` says the same insert-versus-production gap "averages ~3.8 hours". The live system measures the lag rather than assuming it, so the screens are unaffected. The two documents still disagree and should be reconciled on the first live day.
- **A writer to PDAS only, and that is switched off for the plant.** Through IFL's own stored procedures, plus one guarded single-row update for limits, SMS can create products, retire or reactivate them, add blends, counts and tube types, create pallets, and change weight limits. All nine write rights have been proven end to end, **against a local copy of PDAS only** (harness 19/19 PASS, `57882f9`; `DEFECTS.md` Part 10). The plant's PDAS has never been touched.

**What it is not:**

- **Not a control system.** It has no connection to any PLC and no PLC library in any package manifest. This is a review convention, not an automated test: `sms/DEPLOY.md:850` says so explicitly. IFL confirmed that PLC work is out of scope (Q22).
- **Not real-time, and not a safety system.** Nothing in SMS should be relied on to stop a machine, raise a machine alarm, or prevent a bad cone leaving the line.
- **Not the system of record.** IFL's own databases remain the source of truth. SMS is a copy with analysis on top.

---

## 2. System map, with every failure point marked

```
 PLC scales on the line
   │  [FP1] PLC / station clock faults (1970 dates), scale faults (0 kg)
   ▼
 IFL acquisition layer (IFL software)
   │  [FP2] writes rows ~18 min late; can lag more; can stop while line runs
   ▼
 IFL SQL Server: DATA_TP1U2 (weighings)      IFL SQL Server: PDAS_TP1U2 (products)
   │  [FP3] table rebuilt (new generation)       ▲  host TP1-PDAS\PDAS (192.168.100.37),
   │  [FP4] schema change / restore               │  separate box (DEPLOY.md:830)
   │  [FP5] IFL keeps only ~1 month of data       │  [FP16] wrong limits / concurrency /
   │  [FP6] read login lacks rights               │         echo mismatch / PLC may not
   ▼                                              │         read limits live
 Plant LAN  [FP7] network path unconfirmed (IFL #2); plain HTTP on LAN
   ▼                                              │
 ┌──────────────── ONE plant PC (supplied by us) ─┼──────────────────────────┐
 │ Sync worker (Windows service, 60 s loop)       │                          │
 │   [FP8] crash/stop; not restarted if the       │                          │
 │         service is not installed               │                          │
 │   [FP9] watermark / duplicates                 │                          │
 │   ▼                                            │                          │
 │ Sidecar DB: SQL Express `sms`                  │                          │
 │   [FP10] disk full   [FP11] 10 GB cap          │                          │
 │   [FP12] corruption / power loss               │                          │
 │   ▼                                            │                          │
 │ API (Windows service, :4000) ──PDAS writer (off at plant)────────────────┘
 │   [FP13] crash / memory / pool; auth; RBAC                                │
 │ Backups (nightly task → local folder)                                     │
 │   [FP14] never scheduled; same disk; Health trusts any .bak file          │
 │ Clock / time zone  [FP15] OS time zone ≠ UTC+5; NTP drift                 │
 │ Windows Update / reboot [FP17]  ·  No outside monitoring [FP18]           │
 └────────────────────────────────────────────────────────────────────────────┘
   ▼
 Browsers on the plant LAN (Edge tested; others not)
   [FP19] stale shown as live · misleading figures · chart errors · alarm fatigue
   ▼
 People: GM, managers, process engineers
   [FP20] misreading · unapproved KPI definitions · unknown reject codes ·
          simulator mistaken for real · loss of trust after one wrong number

 Off to the side: the developer's laptop (source code + the only copy of IFL's July data)
   [FP21] code not pushed; one developer; no off-site copy
```

---

## 3. Failure mode table

Owner key: **Us** = the SMS developer/vendor. **IFL** = IFL management or IT. **On-site** = done at installation or SAT on the plant PC.

### 3a. Data from IFL

| ID | Component | Failure mode | Cause | Effect on users / plant | Detection today (where) | Likelihood | Sev | Current mitigation (honest status) | Residual risk | Recommended action (owner) |
|---|---|---|---|---|---|---|---|---|---|---|
| F-01 | IFL tables | IFL drops and recreates a weighing table: a new generation, with row numbers restarting at 1 | IFL maintenance or vendor work. This **already happened** on 5 Aug 2026 (`DEPLOY.md:662-664`) | Sync halts for that table rather than guessing. Screens freeze at the last reading and say so. Nothing new arrives until someone runs `sms epoch:accept` on the plant PC. If that takes about a month, IFL's own retention (about one month, `IFL-OPEN-QUESTIONS.md` #9) may discard rows SMS never read | Health › "N of 4 tables did not sync", naming the command to run. A `halted` row per table in `sms.sync_run` (`sync-worker/src/runner.ts:138-148`, `epoch.ts:140-171`, `DEPLOY.md:521`) | **Med.** One occurrence in about 3 months of history we hold | 4 | **Built and tested:** the halt-not-guess gate (`epoch.test.ts`, `epochIngest.test.ts`). Exercised on the dev PC when the September copy was accepted. Recovery is manual by design | Needs an expert step with a time limit. See key-person risk F-35 | Us: a one-page recovery card and training for IFL's admin. IFL: warn us before any table rebuild |
| F-02 | IFL tables | The source changes underneath a live generation: a column renamed or retyped, a table restored from backup (row numbers rewound), or row numbers reused | Vendor change or DB restore | The table halts: fingerprint mismatch, "source has gone backwards", or `raw_read_without_write` (ERROR). A column that is only *added* raises a WARNING and ingestion continues | Health halt reason and DQ finding (`runner.ts:160-187`, `runner.ts:236-251`) | **Low.** Not seen in the data held | 3 | **Built and unit-tested** (`reader/fingerprint.test.ts`, `runner.test.ts`) | A real schema change needs a code change by us | IFL: change notice to us. Us: adapt the reader when told |
| F-03 | Acquisition layer | Lag spikes beyond 2 h, or cannot be measured | IFL backlog, clock fault, or a freshly opened generation with no rows | Screens stop asserting "running / stopped". The state reads "late" (lag over 2 h) or "lag unknown". Figures still show, labelled | Top bar and Health (`live.ts:127` `MAX_CREDIBLE_LAG_SECONDS = 2*3600`; `live.ts:464`, `552-563`). RT-006 fixed in `7558854` | **Med (guess).** Lag has never been measured on the live plant | 2 | **Built, with regression tests** | The two documented lag figures disagree (`SCHEMA.md:158` vs `CLAUDE.md:1073`) | On-site: record the measured lag on day 1 (`DEPLOY.md:270-273`) |
| F-04 | Acquisition layer | IFL's acquisition stops while the line keeps running | IFL service, PC or PLC-link fault | Sync is healthy but receives nothing new. **SMS reports the line as "stopped"**: from SQL alone it cannot tell a stopped line from a stopped recorder | **Nothing distinguishes the two.** Per-machine states go running → quiet → stale → silent (`machinesRunning.ts:51-54`, `4e8513c`). `sack_blackout` covers sacks only | **Med (guess).** No information on IFL's acquisition reliability | 3 | None specific | A wrong "stopped" headline for as long as the outage lasts | Us: reword to "no new readings — the line stopped, or the plant's data recorder stopped". IFL: is there an acquisition heartbeat or status table we could read? |
| F-05 | PLC / scale data | Bad readings: clock-fault timestamps (1970-01-01, 1969-12-31, 2026-06-21), a misdated row inside the data gap (2026-07-12), or weights of exactly 0 | PLC clock reset, scale fault, or test weighing | These could have hijacked "latest reading" anchors, created phantom days, or dragged averages | DQ findings `stale_timestamp`, `future_timestamp`, `isolated_production_day`, `nonpositive_weight` (`sync-worker/src/transform/dq.ts` header, `isolatedDay.ts`) | **High.** Present in both IFL samples. 3 real zero-weight rows (`DEFECTS.md` Part 11) | 2 | **Fixed and tested:** anchors floored against sentinels (RT-021, `7558854`); D-29 closed with a regression test (`b4284ac`); RT24-09 (`edae627`). Zero weights are excluded from averages by the plausibility rules | Rows are kept and flagged, not excluded, by design. What a zero weight means is unknown. These findings also keep Health "degraded" for months (see F-24) | IFL: answer #16 (what a weight of exactly 0 means). Owner: confirm the "flag, don't exclude" policy |
| F-06 | History | The 10 Jul – 5 Aug 2026 data is missing | IFL has not sent it. IFL keeps about one month | A gap in every trend. Reports for those days say "Nothing recorded". **Even if IFL sends it, SMS cannot load it yet** (R-17, HIGH, open) | Reports print "Nothing recorded in this period". Documented in `CLAUDE.md:446` | **High (certain)** | 2 | None. R-17 open (`DEFECTS.md` Part 1) | Likely already discarded at IFL | IFL: send it if it still exists. Us: fix R-17 before the data arrives |
| F-07 | Shift attribution | IFL's stored `Shift` column is derived from *insert* time, not production time (`SCHEMA.md:261`, DQ-4) | Vendor trigger bug | SMS recomputes shift from production time, so **SMS shift totals will not match IFL's own screens**. That will be the first question in any comparison | Nothing on screen says "differs from the vendor screen" | **High** | 2 | Shift rule versioned and read as-of (`1315d23`, `8f5c80c`). `shift_rule_drift` DQ check | RT-025 (shift baked in at ingest) is open. The RT24-04 backfill of rows transformed before the fix has not been run (`DEFECTS.md` Part 6) | IFL: decide #7 (correct or reproduce). Us: add a report footnote; run the backfill with a snapshot |
| F-08 | Product attribution | Rows before the 5 Aug rebuild have no `MaterialId` (all 142,511 July cones) | The column did not exist yet | Product-wise reports cannot cover July. SMS does not invent attribution | `/api/production` reports an unattributed count (`CLAUDE.md:1242`) | **High (certain)** | 1 | **Built.** September data is 132,551 of 132,552 attributed | None | State it in the handover |
| F-09 | Limits and rules history | The limit shown as "in force" on a past date is wrong | A setpoint changed by direct SQL in PDAS leaves no trace (IFL #4). Rule edits before RT24-04 were not backfilled | A target or verdict on an old report is judged against the wrong limit | Nothing can detect a direct SQL edit | **Low (guess)** | 3 | Limits dated from PDAS's own creation timestamps. Rules read as-of their time (`1315d23`, `8f5c80c`) | Backfill open | IFL: answer #4. Us: run the backfill |

### 3b. Sync worker

| ID | Component | Failure mode | Cause | Effect | Detection | Likelihood | Sev | Mitigation | Residual | Action (owner) |
|---|---|---|---|---|---|---|---|---|---|---|
| F-10 | Sync worker | Crashes, hangs or stops | Bug, SQL down, host reboot, network | Screens freeze. After 180 s (3× cadence) every screen stops asserting running/stopped, and Health says "stale" | `live.ts:143-147`, `541`. After 5 consecutive failed passes, the CRITICAL finding `persistent_sync_failure` (`sync-worker/src/config.ts:162`). Orphaned "running" rows are closed on restart (`DEPLOY.md:695`) | **Med** | 3 | Transient reads retried (`runner.ts:207-216`). Per-table isolation. **Restart by NSSM is designed only** (`DEPLOY.md:445-483`) and has never been installed on any machine (`COMMISSIONING-GAPS.md` §1). R-5: the write step is not retried | Until services are installed, nothing restarts the worker | On-site: install the services and run a kill test and a reboot test at SAT |
| F-11 | Watermark | Duplicate or missing rows at the watermark boundary | Overlap re-read, or a crash mid-batch | Double-counted or missing cones | `sms verify` compares count/min/max/sum per generation (`DEPLOY.md:518`, `672`). `raw_read_without_write` | **Low** | 3 | **Built and tested:** a 500-row overlap re-read (`sync-worker/src/config.ts:160`, `runner.ts:191`), idempotent insert keyed on (line, generation, source id), and a unique merge index (`003_cone_event.sql:55`). Verify reconciled on dev after rebuilds | `verify` is manual, not scheduled | Us: schedule a daily verify and show the result on Health (`sms.verify_run` already exists) |
| F-12 | Read login | IFL provides the wrong login shape, e.g. one like `ibrahim`: EXECUTE on procedures and no table read on PDAS | IFL hands over the login that already exists | The product mirror runs before the reader, so **all ingestion stops on day one** (`DEPLOY.md:28`) | Health halt with an `[auth]` class (`runner.ts:280-293`, `DEPLOY.md:483`) | **Med.** It is the only login shape seen at IFL | 4 | DBA template plus four pre-day test queries (`db/bootstrap/10_ifl_readonly_login.template.sql`) | Cutover has never been rehearsed against the real login | IFL: #1. On-site: run the four test queries before install day |

### 3c. Sidecar database, backups and restore

| ID | Component | Failure mode | Cause | Effect | Detection | Likelihood | Sev | Mitigation | Residual | Action (owner) |
|---|---|---|---|---|---|---|---|---|---|---|
| F-13 | Plant PC disk | Disk full | Database growth, plus **30 nightly full backups on the same machine** (`backup-appdb.ps1:95-97`), plus logs. The dev database file is 520 MB today, so 30 copies of a database that size is about 15 GB, growing | SQL Server cannot write. Sync and transform fail, and the API errors | **No free-disk check on Health.** Health only reports database size against the 10 GB cap (`api/src/services/health.ts:77-79`). A failed scheduled backup is visible only in Task Scheduler | **Med** | 4 | NSSM log rotation at 50 MB (designed). 30-day backup retention | Not monitored. No log clean-up task exists in the repo | Us: add a free-disk check to Health. On-site: size the disk; send backups to a second disk or host |
| F-14 | SQL Express | Database reaches the 10 GB cap | Readings are never pruned; only `sync_run`, non-critical DQ findings and sessions are (`DEPLOY.md:713-725`) | Inserts refused, sync stops | `database_size` WARNING at 80 %. Health goes "degraded" (`health.ts:77-79`, `410`) | **Low within 3 years.** Projection in §6: about 1.1–2.2 GB/year | 4 | Warning built. Retention of readings deliberately left to IFL | A second line, or a history backfill, speeds this up | IFL: decide retention. Us: add a raw-layer pruning rule before year 3 |
| F-15 | Backups | Nightly backup never runs, fails, or exists only on the same PC | Scheduled task never registered on any machine (`COMMISSIONING-GAPS.md` §1). The dev PC's newest backup was 15 days old (`CLAUDE.md:45-47`). Every copy is on one laptop's two disks (`PROJECT_STATUS.md` §4 item 2) | **Loss of the only irreplaceable data:** users, configuration, product timeline, calibration log, audit log, PDAS change history. Readings can be re-read from IFL only within its ~1-month retention. **The July generation exists nowhere else** | Health warns "backup missing or stale" after 2 days (`health.ts:81`, `367-391`). **Gap found by reading the code, not reproduced:** Health trusts any `*.bak` by date, and the script deliberately leaves a file that failed verification (`backup-appdb.ps1:78`, `91`), so a bad backup can read as fresh | **High** | 5 | The script was fixed and rehearsed by hand. On 19 Aug the rehearsal caught that `WITH COMPRESSION` fails on Express and that the old script reported success regardless. The script now uses CHECKSUM and `RESTORE VERIFYONLY`, and checks exit codes (`backup-appdb.ps1:75-92`). A task installer exists (`install-scheduled-tasks.ps1`). **Never run unattended** | High until run unattended and copied off the machine | On-site: register the task, watch 7 nights, copy to a second host or NAS. Us: have Health ignore unverified files (e.g. a verified-marker file) |
| F-16 | Restore | A restore fails on the target when needed | Never rehearsed on the plant PC: service-account paths, login mappings | Extended outage and data loss | None until attempted | **Med** | 4 | Rehearsed on dev three times: 19 Aug (9.4 s), 14 Sep (5 s, all 31 tables matched), and the 28 Sep `WITH REPLACE` restores during the PDAS test passes (`DEFECTS.md` Part 10) | The target PC is untested | On-site: restore into a scratch database during SAT, then monthly (`DEPLOY.md:557`) |

### 3d. API

| ID | Component | Failure mode | Cause | Effect | Detection | Likelihood | Sev | Mitigation | Residual | Action (owner) |
|---|---|---|---|---|---|---|---|---|---|---|
| F-17 | API process | Crash, slow memory growth, or connection-pool exhaustion | A bug; many cold report queries at once | Browsers show "Could not reach the server" over the last numbers, or become slow | `service.uptimeSeconds` resets on `/api/health`. Unhandled rejections are logged and mark Health degraded (`api/src/index.ts:108-116`, fix `3e0d349` for RT24-01) | **Med (guess).** No soak or concurrency test has ever run (`sms/PERFORMANCE-APP-2026-09-24.md:227`) | 3 | Crash guard. Pool of 10 connections with a 30 s timeout, adjustable without a rebuild (`api/src/config.ts:45-47`, `DEPLOY.md:791-804`). Whether the in-memory cache ever frees old entries has not been checked (`DEFECTS.md` Part 1) | Memory over months is unknown. Cold reads measured 1–3 s against the stated targets of 300 ms for a dashboard and 100 ms for the API (`DEPLOY.md:759-760`) | Us: a 72-hour soak test with several browsers polling. On-site: watch uptime for resets in week 1 |
| F-18 | API input/output | Oversized or invalid requests | Very wide date ranges, calendar-invalid dates, inverted ranges | Without guards: a crash or silent empty results. With them: a plain 400 or 413 | 413 over 50,000 rows or 20 MB (`config.ts:75`, `77`; `855045f`). RT-016 fixed on all three known surfaces (`5d42cf5`, `11ce30b`, `60d397f`). Inverted range fixed (`47da942`) | **Low** | 2 | **Built and tested** | RT-028 open: `/api/production` and `/api/weights` have no 366-day cap (`app.ts:989-998`); the size cap and timeout back them up. There was no full sweep for other date shapes | Us: add the range cap |
| F-19 | Authentication and sessions | Password guessing, session theft, cookie problems | — | Account takeover | Lock-out after 8 failures in 15 minutes (`api/src/auth.ts:110-112`). Passwords hashed with argon2. Server-side sessions, 7 days, renewed while in use (`auth.ts:13`, `283-286`). Cookie is httpOnly and SameSite=Strict (`auth.ts:347-349`) | **Low** | 3 | **Built** | Wall-display sessions never expire while in use (by design). Plain HTTP: see F-39 | None beyond F-39 |
| F-20 | RBAC | Below-admin roles behave differently live than tested, and **every IFL user can write to PDAS** | Only an admin session has ever existed. PDAS writes are gated at rank 2 "engineer" (`app.ts:1666`, `routes/changeover.ts:61`), while `DEPLOY.md:352-356` says to create every IFL user as manager (rank 3) | Once PDAS writes are on, every IFL account can change product limits | Static cross-check of all 31 gated routes (`5584e82`). Rank matrix tested in a simulated browser (`web/src/rank.matrix.test.tsx`). The live kit `handover/REHEARSAL-RBAC-BELOW-RANK.md` **has not been run** | **Med** | 4 | Server-side gates exist | No live proof. Who may write to PDAS is not decided person by person | Owner: run the kit. IFL: name the people allowed to write. Us: consider a separate, higher permission for PDAS writes |
| F-21 | Installation configuration | Silent install traps | `COOKIE_SECURE=true` over plain HTTP makes login fail silently from other PCs (`DEPLOY.md:45-64`). Font folder not copied gives a silent font fallback (`DEPLOY.md:289-295`). `BACKUP_DIR` not matching the task's folder makes Health look in the wrong place (`DEPLOY.md:711`) | Looks like a wrong password, a wrong font, or a false "no backup" | A warning is logged for the cookie case; nothing for the others | **Med (install day)** | 2 | Documented | Relies on the installer reading the runbook | On-site: a SAT checklist line for each |

### 3e. Web screens

| ID | Component | Failure mode | Cause | Effect | Detection | Likelihood | Sev | Mitigation | Residual | Action (owner) |
|---|---|---|---|---|---|---|---|---|---|---|
| F-22 | Screens | Old data shown as if live | Sync stopped, lag unknown, partial API response | Managers act on an old state | The top bar shows data age measured from the *oldest* of the four tables. When health is not "ok", no screen asserts running or stopped (`DEPLOY.md:647`, `live.ts:442-464`) | **Low now** | 4 | **Fixed and tested:** D-30 false "OK" (`5b2b56a`), RT-006 (`7558854`), per-machine states (`4e8513c`) | Per-machine thresholds (2 h / 7 days, `machinesRunning.ts:51-54`) are not yet confirmed by the owner | Owner: confirm the thresholds |
| F-23 | Figures | A misleading KPI | Data batches pooled; a missing field shown as zero; rejects double-counted | A wrong reject rate, count or weight on a report | Guard tests: `generationScope.guard.test.ts`, `rejectRateThreeWayAgreement.test.ts`, `missingField.fuzz.test.tsx` | **Med.** This class has recurred: 8 CRITICAL findings in the 23 Sep audit (RT-001…008), and a 10× register inflation found 28 Sep (`c15ca06`) | 4 | Extensive fixes, each with a test proven to fail against the old code. At the plant, generations follow one another in time, so most pooling paths do nothing by construction | Unknown unknowns. `newestProductionDay()` still pools (`COMMISSIONING-GAPS.md` §2). A real generation cutover has never been exercised | Us and IFL: a 2-week parallel run, reconciling SMS against IFL's own figures |
| F-24 | Health (**new finding, not yet in `DEFECTS.md`**) | Health reads "degraded" for months: it cries wolf | Any ERROR or CRITICAL DQ finding counts as blocking (`health.ts:342-346`, `412`). Data findings are never cleared (`dq.ts:356-368`). Retention keeps them 365 days (`DEPLOY.md:720`). There is no "acknowledge" | A real outage hides behind a permanent amber. Any outside monitor keyed on "degraded" is permanently red | This row *is* the detection problem | **High.** The dev PC is "degraded" today for exactly this reason (real zero-weight rows, `DEFECTS.md` Part 11) | 3 | None | Alarm fatigue | Us: separate "facts about data" from "system health", add acknowledge, and record it in `DEFECTS.md` |
| F-25 | Charts, browsers, print | A chart misdraws, a zoom sets the wrong period, a browser renders differently, printing clips | The chart overhaul is 1–2 days old (20+ commits, 28–29 Sep). Only Edge is tested (`playwright.config.ts:80`). 13 signed-in layout tests have never run. No real printer has ever been used | Wrong or unreadable chart; a clipped printout | Playwright suite: 77 passed / 13 skipped (`a407b27`). It found 5 layout defects, all fixed 29 Sep | **Med** | 2 | PDF proven end to end through headless Edge; returns a clean 503 if Edge is missing (`DEFECTS.md` Part 8). Fonts self-hosted for an offline plant (`DEPLOY.md:275-295`) | The plant's browser and version are unknown. The landscape print rule depends on a UI text string (a guard test covers it) | On-site: confirm the browser; print one of each report. Us: run the 13 signed-in tests |

### 3f. PDAS write path (switched off at the plant today)

| ID | Component | Failure mode | Cause | Effect | Detection | Likelihood | Sev | Mitigation | Residual | Action (owner) |
|---|---|---|---|---|---|---|---|---|---|---|
| F-26 | Change limits | Wrong limits written | A typo or misunderstanding that is still inside the plausible bounds. The setpoint must sit inside the plausibility window; each offset can be anywhere from 0 to half the setpoint (`api/src/services/pdasWrite.ts:505-518`) | Once machines pick it up, the scale accepts bad cones or rejects good ones until someone notices | A reason of at least 10 characters (`pdasWrite.ts:280`). An inline before→after sentence, then **one click** (`web/src/screens/product/Catalogue.tsx:253-297`). An audit row and History entry for every write | **Med** | 4 | **Built and tested locally** | No second approval. The bounds are wide | Us: tighten the bounds to within N % of the current value; add a confirmation that states the change in words; optional two-person approval. IFL: name who may change limits |
| F-27 | Concurrent or partial writes | Two people edit the same product; a multi-step changeover stops halfway | A PDAS vendor screen used at the same moment; a vendor procedure refuses one step | A lost update; a blend or count created without its product | Optimistic check inside a transaction returns CONFLICT (`pdasWrite.ts:788-801`). Exactly-one-row rule (`818-823`). A partial changeover is audited as `changeover.partial` listing done and not-done steps, and a retry reuses what exists (`api/src/services/changeover.ts:540-615`) | **Low** | 3 | **Built.** Proven by the local harness (19/19) | **From reading the code, not reproduced:** the check-read has no update lock, so a vendor-screen write in the milliseconds between check and UPDATE would not be caught. There is no rollback across steps, by design | Us: add `WITH (UPDLOCK, HOLDLOCK)` to the check-read |
| F-28 | Echo-back | PDAS holds something other than what was requested, or SMS cannot read it back | A trigger or rounding; a plant login with EXECUTE rights but no SELECT | A mismatch raises CRITICAL `pdas_write_echo_mismatch`. A failed read-back marks the write "UNVERIFIED" and raises CRITICAL `pdas_write_unverified` (`25b02bc`) | Health and Product › History | **Med**, if the plant login lacks SELECT | 4 | **Built and unit-tested** (`pdasWrite.echo.test.ts`, `07fde6a`) | The "unverified" path has never fired live. The rehearsal kit `handover/REHEARSAL-RT24-05-EXECUTE-ONLY.md` has not been run | Owner: run the kit |
| F-29 | Vendor procedures | Retire-then-recreate is refused; the vendor log names the wrong product | `CreateMaterial` refuses a duplicate blend+count+tube even when retired (-7001). Its `nhs_events` line logs `@blendId` instead of the real product id (`CLAUDE.md:223-266`) | IFL engineers try a workflow that cannot work. IFL's own event log misattributes products SMS created | Both confirmed by execution on 23 Sep. SMS's own history keeps the true id | **High** | 2 | The UI never offers retire-and-recreate. The plan step blocks duplicates before execute | IFL has not been told formally | Us: tell IFL in the handover. "Change limits" is the correct path |
| F-30 | Plant writer login | The plant writer login is not provisioned, or a personal login is used instead | `sms_pdas_writer` does not exist at the plant. PDAS lives on a separate host (`DEPLOY.md:828-837`) | The write path is unusable at go-live, or writes are attributed to a person | Config refuses to use the read login as the writer (`config.ts:388-395`) | **High (it simply is not done)** | 2 | Local proof 19/19 (`57882f9`) | The plant has never been touched | IFL: #3, provision the login with the nine rights plus SELECT. On-site: test it |
| F-31 | PDAS → machines | New limits do not reach the machines, or reach them only later | Unknown vendor/PLC behaviour. IFL has never said whether the PLC reads limits live (`CLAUDE.md:1149`) | SMS judges cones against the new limit from the moment of writing while the machine may still use the old one, so SMS verdicts and machine verdicts disagree. **The UI states as fact:** "The scale picks up the new limits when the product is next selected on the machine" (`web/src/lib/words.ts:271`). That claim is unverified | Nothing in SMS can see a machine. Only an indirect signal (a change in the reject pattern) | **Med (guess)** | 4 | None | Unknown behaviour, stated as known | IFL: confirm how the PLC reads limits. On-site: one test product on one machine. Us: soften the text until confirmed |
| F-32 | Feature switches | A switch is left in the wrong state | A dev `.env` copied to the plant. The dev PC today has `PDAS_WRITE_ENABLED=true` (pointed at the local copy), `LIVE_ALLOW_SIMULATOR=true` and `LIVE_ALLOW_AS_OF=true` (`sms/.env:50`, `58-61`, `66`) | PDAS writes turned on before the rehearsals; the simulator driving live screens; replay URLs available | **PDAS:** the database name must equal the read database's PDAS name, and the writer must differ from the reader (`config.ts:364-396`); when disabled, a write returns 503 and is audited. **Simulator:** refused unless the database name ends in `_SIM` *and* the server is local (`config.ts:442-469`, tested in `config.liveSimulator.test.ts`), so it cannot take effect against the plant. **Replay:** not guarded, but every replay is bannered on screen (`CLAUDE.md:1132-1134`) | **Low** | 4 | **Built and tested** | A correctly configured `.env` with valid plant credentials is the only gate on PDAS writes. The stale `.env` comment (RT-024) is still open | On-site: build the plant `.env` from `.env.example`, never from the dev copy. Us: an explicit "writing to plant" acknowledgement setting |

### 3g. Operations

| ID | Component | Failure mode | Cause | Effect | Detection | Likelihood | Sev | Mitigation | Residual | Action (owner) |
|---|---|---|---|---|---|---|---|---|---|---|
| F-33 | The single plant PC | Hardware failure, power cut, Windows or database corruption | One box runs sync, API, database and backups. There is no standby. UPS unknown (IFL #12) | Total outage. Possible database corruption | `/api/health` returns 503 "down", but only if something polls it. Weekly `DBCC CHECKDB` (a corruption check) is designed as a scheduled task (`DEPLOY.md:727-739`) | **Med** | 4 | Readings resume from the stored watermark after a restart, as long as it is within IFL's ~1-month retention. An interrupted pass is reconciled on restart | The CHECKDB task has never been installed. No spare PC | IFL: UPS. Us/IFL: a spare PC plus a restore drill |
| F-34 | Code and data custody | The developer laptop is lost or fails | Branch **319 commits ahead of `origin/main` and 119 ahead of `origin/floor-first-rework`** (measured 29 Sep 2026; the remote branch's newest commit is dated 24 Sep). CI (`.github/workflows/ci.yml`, Ubuntu) has not seen those 119 commits and does not test Windows-specific behaviour. The July generation (142,511 cones) exists only on this laptop | Loss of weeks of work and of irreplaceable IFL data | None | **Med** | 5 | None | — | Owner: push today; copy `D:\sms-backups` off the machine |
| F-35 | People | The only developer is unavailable | 370 of 371 commits are by one author | Nobody else can accept a new generation, rebuild, restore or diagnose | — | **High** | 4 | Manuals exist: `handover/ADMIN-DEPLOY-MANUAL.md`, `handover/OPERATOR-MANUAL.md`, `handover/FAT-PROTOCOL.md`, and `sms/DEPLOY.md` | No one else has ever followed them | Us: have a second person do a restore and an `epoch:accept` from the manuals alone. IFL: name an admin |
| F-36 | Monitoring | The PC or a service stops overnight and nobody is told | Air-gapped plant: no email, no outside alerting (`DEPLOY.md:693`) | Found only when someone opens a browser | `/api/health` is open to an outside monitor without login (`DEPLOY.md:682`) | **High** | 3 | Endpoint built | No monitor configured. F-24 would make one permanently red | IFL IT: point PRTG/Zabbix or a scheduled check at `/api/health`, after F-24 is fixed |
| F-37 | Reboots and Windows Update | Processes do not come back after a reboot | Services not installed. On the dev PC they are plain processes, deliberately (`DEPLOY.md:237-244`) | A silent stop after every monthly patch reboot | Health "stale", if someone looks | **High** until services are installed | 3 | NSSM design with auto-start, SQL dependency and restart delay (`DEPLOY.md:445-483`) | Never installed | On-site: install the services; do a reboot test at SAT; agree update windows |
| F-38 | Clocks and time zone | Plant PC time zone is not UTC+5, `PLANT_UTC_OFFSET_MINUTES` is unset, or the clock drifts | A fresh Windows image defaults to UTC (`DEPLOY.md:66-70`) | Every shift attribution and every "running / stopped" judgement is shifted, by 5 hours in the UTC case | Startup warning plus a standing WARNING finding. **Neither program refuses to start** | **Med** | 4 | Warning built and tested (`config.plantOffset.test.ts`, `plantClockCheck.test.ts`) | Warn only | Us: refuse to start on a mismatch. On-site: SAT check plus NTP |

### 3h. Security

| ID | Component | Failure mode | Cause | Effect | Detection | Likelihood | Sev | Mitigation | Residual | Action (owner) |
|---|---|---|---|---|---|---|---|---|---|---|
| F-39 | Network position and transport | The plant PC is compromised, or LAN traffic is read | The PC reaches both IFL servers and, once writes are enabled, holds a PDAS write credential. The API listens on all interfaces (`0.0.0.0:4000`) over **plain HTTP**, so passwords and session cookies cross the LAN unencrypted (RT-035). The IFL connection is encrypted but does not check the server certificate | Plant data read, or product limits changed through PDAS | Nothing in the app | **Low** | 5 | TLS option built and verified 19 Aug (`DEPLOY.md:363-421`). Separate least-privilege logins (`DEPLOY.md:817-843`). The ngrok review tunnel is dev-only and must never be on the plant PC (`DEPLOY.md:297-300`, RT-036) | — | IFL IT: VLAN or firewall allow-list; enable TLS; keep PDAS writes off unless needed |
| F-40 | IFL `Users` table | Plaintext vendor passwords readable with SMS's read login | `DATA_TP1U2.Users` holds 3 accounts whose passwords equal their usernames (`SCHEMA.md:187`). Any `db_datareader`, including SMS's read login, can read it | Anyone holding SMS's read credential can read vendor app passwords | SMS never reads the table (`CLAUDE.md:1308`) | **Low** | 4 | Not used | — | IFL: `DENY SELECT ON dbo.Users` to the SMS read login; change those passwords |
| F-41 | Stored credentials | A credential leaks | The plant `.env` holds database passwords in clear text. The dev laptop also holds three older copies (`.env.backup-before-sim`, `.env.bak-20260924`, `.env.e2e-writer`). All are git-ignored | Database access by an unauthorised person | — | **Med** | 4 | No secrets in git history (verified at Phase 0). The config backup restricts folder access (`DEPLOY.md:743`) | — | Owner: delete the stale copies (`PROJECT_STATUS.md` §4 item 4). On-site: restrict `.env` to the service account; rotate passwords after install |

### 3i. Human factors

| ID | Component | Failure mode | Cause | Effect | Detection | Likelihood | Sev | Mitigation | Residual | Action (owner) |
|---|---|---|---|---|---|---|---|---|---|---|
| F-42 | Reading the screens | A figure is misread | The 18-minute lag; the sack↔cone link is approximate (`CLAUDE.md:1127-1131`); gross vs net weight; days-to-limit is a range (`b182297`) | A wrong decision | Screens state the lag and print the caveats | **Med** | 3 | Plain wording; caveats on screen | — | Us: a training session plus the operator manual |
| F-43 | Definitions | KPI definitions not approved; reject-code meanings unknown; the word "AI" not agreed | All 32 KPI rows read "awaiting" (`IFL-OPEN-QUESTIONS.md` #5); Q10; #8(c) | A dispute at month-end or at acceptance | `KPI-DEFINITIONS.md` | **High** | 3 | The definition sheet exists | — | IFL: sign off #5; enter reject-code labels; settle #8(c) |
| F-44 | Simulator data | Simulated data mistaken for real | — | A decision based on invented numbers | Banner on screens (`3abc113`), disclosure in exports (`ede3c64`, `ee0407e`), on-screen report disclosure (`8794985`) | **Low** at the plant, which has no `_SIM` database | 4 | **Built and tested** | — | On-site: confirm no `_SIM` database exists on the plant PC |
| F-45 | Trust | One wrong number discredits the whole system | History: several wrong-number defects were found and fixed in the last week (see F-23) | People stop using SMS | Every figure drills down to its rows. Three-way agreement tests | **Med** | 4 | Traceability | — | A parallel run with reconciliation sign-off, and a published "report a wrong number" route with a same-day response |

---

## 4. Top 10 risks (Likelihood × Severity)

Scores use Low = 1, Med = 2, High = 3. Likelihoods are judgement (see §0).

| Rank | ID | Risk | Score | The one action that most reduces it |
|---|---|---|---|---|
| 1 | F-15 | Backups never run unattended, live on the same machine, and Health can trust an unverified file | 3×5 = **15** | Register the nightly task on the plant PC, confirm 7 successful nights, and copy each backup off the machine. Fix Health to count only verified files. |
| 2 | F-35 | One developer holds all the know-how | 3×4 = **12** | Have a second person do a restore and an `epoch:accept` using only the written manuals, before go-live. |
| 3 | F-34 | Code unpushed (319/119 commits) and the only July data on one laptop | 2×5 = **10** | Push the branch and copy `D:\sms-backups` to other hardware **today**. |
| 4 | F-37 | Programs do not survive a reboot (services not installed) | 3×3 = **9** | Install both NSSM services and run a reboot test at SAT. |
| 5 | F-36 | No outside monitoring: a dead PC is found only by a user | 3×3 = **9** | Point IFL's existing monitor, or a scheduled check, at `/api/health` (after F-24). |
| 6 | F-24 | Health permanently "degraded" from data findings (alarm fatigue) | 3×3 = **9** | Separate data-fact findings from system health and add acknowledge. |
| 7 | F-43 | KPI definitions and reject-code meanings not approved by IFL | 3×3 = **9** | Obtain IFL's sign-off on the 32-row KPI sheet before month-end reporting. |
| 8 | F-26 | A wrong limit written to PDAS by one click | 2×4 = **8** | Tighten the bounds to within a small percentage of the current value, and add a worded confirmation step (two-person approval for limits if IFL agrees). |
| 9 | F-31 | Limits may not reach machines when SMS says they do | 2×4 = **8** | IFL confirms how the PLC reads limits. Until then, test one product on one machine and soften the UI sentence. |
| 10 | F-01 | An IFL table rebuild halts sync, with IFL keeping only about a month of data | 2×4 = **8** | A recovery card plus a trained IFL admin, and IFL's commitment to warn us before rebuilds. |

**Tied at 8, not listed above:** F-12 (read login shape), F-13 (disk full), F-16 (restore on target), F-20 (RBAC and who may write), F-23 (misleading figures), F-28 (echo-back under the plant login), F-33 (single PC / UPS), F-38 (time zone), F-41 (stored credentials), F-45 (trust). Ranks 8–10 were chosen for plant consequence. Several of these ties are cheaper to close, e.g. F-12 is four test queries before install day.

---

## 5. What would change if SMS were given PLC control

IFL has said PLC work is out of scope (Q22), and SMS has no PLC connection. This section exists because the question will be asked.

### A new failure class

Today the worst SMS can do is **show** a wrong number or **write** a wrong value into PDAS, which (per F-31) may or may not reach a machine later. With PLC control, a command from SMS would **reach a machine directly**: a wrong setpoint, a start or stop at the wrong time, a command meant for machine 7 arriving at machine 17. That can scrap product, damage equipment, or put people at risk, and it happens within seconds rather than at the next report.

### Why SMS must never be in a control loop

- **It sees the plant about 18 minutes late** (§1). A loop that sees the plant 18 minutes late cannot control it.
- **It runs on one Windows PC**, with Windows Update reboots (F-37), no standby (F-33) and no timing guarantees.
- **Its inputs are a copy of a copy.** They are PLC → acquisition layer → SQL → sync worker, and they carry clock faults and zero weights (F-05).
- **It is not built or assessed as a safety or control system.** It has no deterministic behaviour, no certified components, and no failure-mode proof for control.
- **Its whole test base runs against fakes and one development PC.** Nothing has run on the plant.

Control belongs in the PLC. At most, SMS could **propose** a value, and the PLC could accept it under the PLC's own rules.

### Minimum safeguards if IFL ever wants SMS to send values to a PLC

1. **The PLC validates every value.** Hard limits live in the PLC program; SMS's own checks are not trusted.
2. **Allow-list.** SMS may write only named tags (e.g. a setpoint request), never outputs, modes, interlocks or safety tags.
3. **Handshake.** SMS writes a *request*. The PLC copies it to the active value only when the machine is in a safe state (e.g. at a product change) and sets an acknowledgement.
4. **Heartbeat with a safe state.** If SMS's heartbeat stops, the PLC ignores pending requests and keeps its last good local value.
5. **Two-step confirmation in the UI,** with a second person for setpoint changes.
6. **Read-back from the PLC.** Report success only when the PLC's *active* value matches, not when the write call returned.
7. **Audit.** Record who, what, when, the before and after values, and the PLC's acknowledgement.
8. **OPC UA security** (the standard secure protocol for this kind of link): sign-and-encrypt mode, certificate trust per machine, a dedicated low-privilege account, and a firewall allowing only that path.
9. **Testing before any real machine:** Siemens PLCSIM, then a FAT against a copy of the PLC program, then a SAT on one machine with production stopped, then a supervised pilot.
10. **A formal risk assessment** by IFL's controls engineer, who signs off each tag.

---

## 6. What has NOT been verified

Stated plainly, so that nothing here is mistaken for proven:

1. **Real plant data.** Every figure comes from two IFL sample copies (July 2026 and September 2026) and a plant simulator on one development PC.
2. **The plant network and the plant login.** Neither the host, the read login (IFL #1) nor PC-to-plant reachability (IFL #2) exists yet. Cutover has never been rehearsed against the real login shape.
3. **Below-admin roles live.** Only an admin has ever signed in. The viewer/engineer rehearsal kit has not been run.
4. **The PDAS write path under the plant's login.** It is proven locally (19/19), but never against the plant, and never with an EXECUTE-only login. The RT24-05 kit has not been run.
5. **Whether PDAS limit changes reach the machines** (F-31).
6. **A real print pipeline.** PDF is proven through headless Edge; no physical printer has ever been used.
7. **A real unattended backup and a restore on the target PC.** Both were done by hand on the dev PC only.
8. **Windows services, reboot survival and outside monitoring.** None has ever been installed.
9. **Load over months.** No soak test, no concurrency test, no multi-browser test. Cold report queries take 1–3 s today on 34 days of data.
10. **The 13 signed-in browser layout tests** have never run. The chart overhaul is 1–2 days old.
11. **A real generation cutover at the plant,** and loading the 10 Jul – 5 Aug archive (R-17).

### 10 GB growth projection (computed 29 Sep 2026 from the dev database, read-only)

**Measured stored size per row** (both layers SMS keeps, the raw copy and the processed rows, including indexes):

| Table | Rows now | Space used | Size per row |
|---|---|---|---|
| cones (`sms.cone_event` + `sms_raw.cone_raw`) | 539,661 | 385.4 MB | **≈ 749 bytes** |
| sacks | 22,988 | 18.0 MB | **≈ 819 bytes** |
| rejects (quality + weight) | 15,236 | 17.4 MB | **≈ 1,199 bytes** |

The dev database file is 520 MB today (including simulator rows).

**Measured daily volumes, from IFL's real samples:**

| Sample | Cones/day | Sacks/day | Rejects/day | Storage/day | Storage/year |
|---|---|---|---|---|---|
| July (19 days) | ≈ 7,500 | ≈ 287 | ≈ 166 | ≈ 5.8 MB | **≈ 2.2 GB** |
| September (34 days) | ≈ 3,900 | ≈ 160 | ≈ 179 | ≈ 3.1 MB | **≈ 1.1 GB** |

On top of this, the sync log (`sms.sync_run`) settles at about 150 MB: 4 tables × 1,440 passes/day × ~290 bytes, kept 90 days.

**Result:**

- Health's 80 % warning (≈ 8.2 GB) arrives after about **3.6 years at the July rate, or 7.1 years at the September rate**.
- The 10 GB cap arrives after about **4.6 or 8.9 years**.

**Caveats:**

- The per-row sizes come from a dev database that has been rebuilt several times, so they include some free space.
- Index rebuilds need extra working room.
- A second line, or a 6–12 month history backfill, brings the date forward proportionally.
- `DEPLOY.md:762-772`'s "~1 GB/year" sits at the low end of this range, because it did not count indexes or the raw layer.

The conclusion is unchanged: **years of headroom, not months**. But IFL's retention decision (F-14) should be made within the first two years.

---

## 7. Readiness verdict and conditions to go live

### Verdict

- **Reading and reporting (sync, screens, reports):** the software is functionally complete and heavily tested against IFL's sample data (2,770 tests passing, typecheck and build clean, 77 real-browser layout tests passing, 29 Sep 2026). It is **not yet ready for unattended production use.** What is missing is mostly operational — backups, services, monitoring and custody — plus IFL-side prerequisites. It is ready for a **supervised pilot** once conditions G1–G8 below are met.
- **Writing to PDAS:** **stays off at the plant.** It is proven locally, but the plant login, the EXECUTE-only rehearsal, the below-admin rehearsal, and IFL's confirmation of how limits reach machines are all outstanding (conditions W1–W6).
- **PLC control:** **not in scope, and not recommended** in any form that puts SMS inside a control loop (§5).

### Conditions to go live: reading and reporting (supervised pilot, then production)

| # | Condition | Owner |
|---|---|---|
| G1 | Read-only login with table read on **both** `DATA_TP1U2` and `PDAS_TP1U2`, plus the host name; the four pre-day test queries pass from the plant PC (F-12; IFL #1, #2) | IFL + on-site |
| G2 | Branch pushed, CI green on the release commit, release tagged; IFL sample archives and the July generation copied off the laptop (F-34) | Us (owner) |
| G3 | Both services installed; a kill test and a reboot test pass; time zone and `PLANT_UTC_OFFSET_MINUTES=300` confirmed; NTP on (F-37, F-38) | On-site |
| G4 | Nightly backup runs unattended for 7 nights, is copied off the PC, and is restored once into a scratch database **on the target PC**; the weekly corruption check (`DBCC CHECKDB`) is registered; free-disk monitoring is in place (F-13, F-15, F-16) | On-site + us |
| G5 | Health fixed so data findings do not hold it "degraded" (F-24); then an outside monitor polls `/api/health` (F-36) | Us + IFL IT |
| G6 | A two-week parallel run: SMS totals reconciled against IFL's own figures per shift and per day, with the known shift-column difference explained (F-07, F-23, F-45) | Us + IFL |
| G7 | KPI definitions signed off; reject codes labelled; policy on zero weights decided (F-43; IFL #5, #16) | IFL |
| G8 | A second person performs a restore and an `epoch:accept` from the manuals; IFL names an admin (F-35, F-01) | Us + IFL |

### Additional conditions before switching on PDAS writes at the plant

| # | Condition | Owner |
|---|---|---|
| W1 | `sms_pdas_writer` provisioned at the plant with the nine rights **plus SELECT** for read-back (F-30) | IFL |
| W2 | EXECUTE-only rehearsal (`REHEARSAL-RT24-05-EXECUTE-ONLY.md`) and below-admin rehearsal (`REHEARSAL-RBAC-BELOW-RANK.md`) both run and passed (F-20, F-28) | Owner |
| W3 | IFL confirms how the PLC reads product limits; the UI sentence matches that answer (F-31) | IFL + us |
| W4 | Tighter limit bounds and a worded confirmation step; IFL names who may write (F-20, F-26) | Us + IFL |
| W5 | One test product created, changed and retired on the plant, verified in PDAS **and on one machine**, with a fresh PDAS backup taken first | On-site |
| W6 | The update-lock hint added to the concurrency check (F-27) | Us |

---

*Evidence note: every file and line reference, commit SHA and DEFECTS ID above was read in the repository on 29 Sep 2026. Two findings in this document are new and not yet in `DEFECTS.md`:*
- *F-24: Health held "degraded" by data findings that are never cleared.*
- *F-15's detail: Health trusts any `.bak` file by date, including one that failed verification.*

*Two further observations come from reading the code and are unreproduced:*
- *F-27: the concurrency check-read takes no update lock.*
- *F-31: the UI asserts limit propagation to the scale as fact.*

*These should be entered in the register.*

---

### Critical files for implementation

- `C:\Users\ABDULLAH SAJID\Desktop\sag database\sms\api\src\services\health.ts`
- `C:\Users\ABDULLAH SAJID\Desktop\sag database\sms\scripts\backup-appdb.ps1`
- `C:\Users\ABDULLAH SAJID\Desktop\sag database\sms\api\src\services\pdasWrite.ts`
- `C:\Users\ABDULLAH SAJID\Desktop\sag database\sms\sync-worker\src\runner.ts`
- `C:\Users\ABDULLAH SAJID\Desktop\sag database\sms\DEPLOY.md`

---

## Status addendum (29 Sep, later)

Written after the owner-scope hardening loop (37 commits, `72efd5e..HEAD`; full
account `DEFECTS.md` Part 12). This section updates the status of the failure
modes and conditions this loop actually touched, in place, without deleting
the original text above — the original readiness verdict, and every risk not
named below, is unchanged.

**F-15 (Backups, rank 1, score 15) — narrowed, still open as the top risk.**
A verified-backup marker mechanism now exists (`f166183`) and a real BOM bug
that silently broke every marker's `JSON.parse` was found and fixed by
actually running the script (`00c3174` — one manual run, `sms-20260929-
212238.bak.verified.json`, confirmed no-BOM, `GET /api/health` then reported
`backup.verified=true`). **This is still one hand-run against the app DB's
own backup directory, not a proven unattended nightly run**, and every copy
of every backup still lives on the same laptop. The action that most reduces
this risk is unchanged: register the task, watch 7 nights, copy off the
machine.

**F-26 (Change limits, wrong value written, rank 8) — closed.** A two-step
UI review (`Catalogue.tsx`'s `'edit' | 'confirm'` flow) plus a tightened,
named plausibility window
(`PDAS_LIMIT_MAX_SETPOINT_CHANGE_PCT=3`, `PDAS_LIMIT_MAX_OFFSET_CHANGE_G=20`)
now exist, gating any change outside those bounds behind a ≥20-character
reason and an explicit checkbox (`8e8c893`). **The bounds themselves are
still a developer placeholder, not an IFL-confirmed policy** — this row's
"IFL names who may change limits" action item is unaffected; see
`IFL-OPEN-QUESTIONS.md`.

**F-27 (Concurrent/partial writes, rank tied at 3) — narrowed.** The
check-read this row flagged as lacking an update lock now takes
`WITH (UPDLOCK, HOLDLOCK)` when called for a write (`readFields(...,
{forUpdate: true})`, `8e8c893`), closing the specific gap this row named.
Proven only by code reading and the local 19/19 harness — never against a
real concurrent write race with two live sessions.

**F-24 (Health stuck "degraded" from data findings) — mechanism built, not
yet exercised.** A DQ-finding acknowledge route now exists
(`POST /api/dq-findings/:id/ack`, migration 042, `4298ac4`), excluding
acknowledged findings from Health's blocking-findings count. It only covers
six DATA-FACT checks, by design — system-state checks remain
un-acknowledgeable so a real outage can never be silenced this way. Nothing
has been acknowledged on the dev database as of this addendum; Health will
keep reading `degraded` from `dq_finding` 92/96 until an engineer actually
uses this on those two genuine IFL zero-weight rows.

**R-17 / §6 item 11 (the 10 Jul – 5 Aug archive cannot be loaded as-is) —
code exists, still not proven end to end; one claim corrected.**
`sms epoch:backfill`, the `sms verify --epoch`/`--source-db` scoping fixes,
and an `epoch:accept` data-vintage guard were all built and unit-tested this
loop (`b81eb1c`, `937616d`, `96f913e`, `08df232`, `2eaa7a3`). Every test
covering them runs against a fake pool; the fixture meant to rehearse this
against a real scratch SQL Server instance
(`sms/scripts/r17-fixture.sql`) has, by its own commit message, been
"parse-checked... never executed." **A specific claim of an end-to-end
scratch-DB proof circulated for this loop's own write-up and was searched
for across this repository and not found — do not repeat it.** §6 item 11
above is otherwise unchanged: this remains something SMS itself is not yet
ready for, independent of whether IFL has sent the data.

**RT-028 (§ not previously named in this document by id) — closed.**
`/api/production` and `/api/weights` now share the same `MAX_RANGE_DAYS =
366` cap every sibling report route already had (`a6afbae`).

**Not touched by this loop, named so nobody assumes otherwise:** F-01, F-09,
F-12, F-13, F-16, F-20, F-22 (per-machine thresholds still unconfirmed),
F-23, F-28, F-30, F-31, F-33, F-34, F-35, F-36, F-37, F-38 (still
warning-only, no refuse-to-start), F-41, F-43, F-45, and every G1-G8/W1-W6
go-live condition in §7 above — none of them changed by a documentation-only
pass. The readiness verdict in §7 stands exactly as written above this
addendum.
