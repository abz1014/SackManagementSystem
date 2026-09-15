# How far is the IFL Sack Management System from finished?

**Assessment date:** 15 September 2026
**Repository:** `C:/Users/ABDULLAH SAJID/Desktop/sag database`, branch `floor-first-rework` at `7d90418`
**Measured against:** `IFL_SMS_Claude_Code_Development_Roadmap.md` — 14 phases plus the 16-line Definition of Done. The roadmap is the contract; existing code is credit toward it.

**Method and its limits.** Every claim below either carries a `path:line` citation I verified in the working tree today, or is explicitly marked unverified. I did not run the application, the sync worker, any migration or any database query — so anything that can only be established by execution (does migration 036 apply from zero, does the ledger return correct numbers against real rows, how fast is a 366-day query) is marked as unverified rather than inferred. Where two assessors disagreed, both readings are given and the disagreement is named. Where a refutation overturned an assessment, **the refutation wins and the change is stated.**

**Documents you should not trust while reading this.** `ROADMAP-GAP-ANALYSIS.md` is a snapshot of commit `e86357f` from 12 Sep; its acceptance criteria are sound, its status verdicts are stale. `PROJECT_STATUS.md` §3 claims a clean working tree against 36 dirty paths, and its test figure of 888 predates today's 938. `AUDIT-2026-09-15.md` is current as of this morning and predates today's fixes. `CLAUDE.md` still says "266 tests in 28 files" and "31 app tables after 27 migrations"; the tree holds 84 test files and 34 migration files.

---

## 1. The answer, in a paragraph

**The engineering is roughly 10 to 14 weeks from finished for a solo developer, but the product cannot be *delivered* on engineering alone — and the smaller number matters more: a credible Factory Acceptance Test is about 3 to 4 weeks of code away.** The application is substantially built and substantially correct. Thirteen of the fifteen roadmap phases have real, tested code behind them; 938 tests across 84 files pass; typecheck is clean; the hard client constraints have held absolutely — nothing has ever written to `DATA_TP1U2`, and `PDAS_WRITE_ENABLED=false` in every configuration (`sms/.env.example:43`). What is missing is not architecture. It is four open high-severity defects, a set of features that are written but reachable from no user interface, an entire missing test level (nothing in the suite ever opens a real SQL Server), seven of thirteen required documents including the FAT protocol itself, and — the item that gates every other one — **the code exists on exactly one laptop**: `origin/main` last received a commit on 19 August, the working branch has no upstream, and 39 commits plus 36 uncommitted paths (including two migrations already applied to the development database) have no copy anywhere else.

**The single most important qualification, and it is the thing to act on: finishing the engineering does not finish the product.** Seven of the sixteen Definition-of-Done lines are signatures only IFL can give — reject-code meanings, product limits, report layouts and KPIs, the sack-stock method, the calibration advisory, the AI/ML question, and the role matrix. Six more cannot be closed at all until a plant host exists with a live read-only login, because they are claims about reconciliation, backup, recovery and installation *on the real machine*. A developer working flat out for three months and sending nothing to IFL would arrive at a product that still cannot pass FAT. The approvals have a turnaround measured in weeks and several of them are cheap to request today. **Send the approval requests this week; build in parallel.**

---

## 2. Two piles

The relative sizes are the decision. Here they are, unsentimentally.

### Pile A — engineering we can do, no client input needed

Roughly **65 working days** of solo effort across all fifteen phases, with a variable of up to three further weeks depending on one client answer about PDF. Broken down by what it buys:

| Band | Effort | What it is |
|---|---|---|
| **Must land before any FAT** | **~3–4 weeks** | 4 open HIGH defects · surface the machine-product report · route the XLSX writer · commit and push · integration harness against a real SQL Server · FAT and SAT protocols |
| Should land before delivery | ~4–5 weeks | SMS-owned editable product limits · mount `changeover.ts` and `pallets.ts` · pallet/pack-schema mirror · offline write-path tests · UI test harness · configurable calibration thresholds · Excel-with-graphics or designed print |
| Documentation | ~8–12 days | User manual, administrator manual, troubleshooting guide, integration spec, database architecture, change control, release notes |
| Deferred by the roadmap's own gate | — | Phase 10 (AI/ML) is forbidden to start until six months of history exists |

### Pile B — approvals and access only IFL can give

**Nine items. None of them is engineering, several are one page of paper, and together they gate seven Definition-of-Done lines outright and six more indirectly.**

The asymmetry is the finding: Pile A is large but entirely within your control and can start this afternoon. Pile B is small, cheap for IFL, and **nothing in Pile A can substitute for any of it**. Two items in Pile B have the longest lead times in the whole project — the live read-only login, and the written PDAS authority — and both have been outstanding for weeks.

**One correction the documents have not caught up with.** IFL answered fifteen questions on 15 September (`handover/IFL-ANSWERS-2026-09-15.md`). Three of those answers are being carried in the status documents as still-blocking when they are not — and one of them, Q28, moved a requirement rather than closing it. Details in §5.

**A caution on what "approved" means.** Every IFL answer on file is a verbal relay from the owner's 15 September meeting, recorded by the owner. There is no document from IFL with a name against it. At FAT, "approved" means a signature. Treat the 15 Sep answers as direction to build to, not as approvals already banked.

---

## 3. Phase board

Verdicts are as assessed, **corrected by the refutations**. Five phases were originally marked *complete-pending-IFL*; four of those five were overturned, and the pattern was identical each time — the phase was called client-blocked when the next move was actually ours. Those corrections are marked **↓ corrected**.

| # | Phase | Verdict | What remains in code | What remains from IFL | Code effort |
|---|---|---|---|---|---|
| 0 | Freeze and baseline | **Partial** | No new code. Re-run the from-zero migration rehearsal (recorded run covers 001–027; tree has 34 files through 036 — `sms/DEPLOY.md:173`). Re-run restore on the 036 schema. Commit the tree. Push, so CI runs once. | Nothing. A clean-checkout rehearsal on non-dev hardware waits on the host, and blocks nothing. | 0.5 day ops |
| 1 | Configurable platform | **Partial** | All ten config entities exist and are audited transactionally. Live gaps: the configured weight basis is set and ignored (`api/src/app.ts:1051` defaults to `as_recorded`); migration 035 hardcodes `line_id = 1` in five places; `scripts/db-maintenance.sql:31` hardcodes `USE [sms]`; **no SMS-owned product-limit editor exists** (see Phase 4). | Q14 single vs multi-line — decides whether the multi-line residuals are a 1-hour cleanup or a 2-week build. Q7 shift fix-vs-reproduce. Q11 machine names. | 3–5 days |
| 2 | Integration layer | **Partial** ↓ corrected | `SourceAdapter` + registry are real and the PLC exclusion is enforced, not merely absent. **But the boundary was formalized for one of two SQL sources**: `PDAS_TP1U2` — origin of every product limit — is read with raw interpolated queries outside the adapter (`sync-worker/src/seed/seedProducts.ts:35-45`): no probe, epoch, fingerprint, watermark or reconciliation, and a mirror failure is deliberately non-blocking, so it can go stale indefinitely while health reads OK. Pallet/pack-schema mirror never written. `verify.ts:118,211` bypass the adapter. | Whether a separate "Sack Packing database" exists (roadmap line 120) — unverifiable from the repo. Live `db_datareader`. PLC model, if IFL ever reverses Q22. | 1 day + 2–3 for a real-SQL harness |
| 3 | Canonical data model | **Partial** | All 11 record types have a TypeScript contract; 9 of 9 provenance fields are real columns; traceability is demonstrable on screen, in JSON and in CSV. Gaps: the transform reads raw with **no `line_id` filter** and one shared watermark (`runTransform.ts:278-284`); `maxCanonicalTs` is scoped by neither line nor epoch, so a rebuild flags the older generation stale; `sms.pallet`/`sms.pack_schema` have no contract and no dictionary entry; `DATA-DICTIONARY.md` is 7 migrations stale. | Reject-code meanings. Cone weight basis. The 10 Jul – 5 Aug data. Whether insert-time sack stamps are acceptable for reporting. | 1–1.5 days |
| 4 | Cone weight module | **Partial** ↓ corrected | One five-state classification, one SQL mirror, one tested fixture, one population rule — genuinely good. **But IFL's own Q10 answer (limits editable in settings) is unbuilt**: `appendLimitVersion` has exactly two callers, both inside the disabled PDAS path (`api/src/services/pdasWrite.ts:413,653`), and Setup's limits section says in its own header "Nothing here edits" (`web/src/screens/setup/RulesBlock.tsx:331`). **No account of any rank can change a product limit today.** `/api/reconciliation` is built, routed and called by no screen. Limits history is admin-only while limits are an engineer's job. | **Approve the 24-case fixture** (`sms/test/fixtures/cone-classification.json:4` — "developer-proposed"). Decide scale-vs-tolerance precedence. Confirm the plausibility window. Confirm cone weight basis. Agree the sample period. | 2–3 days + 2–4 for the limit editor |
| 5 | Reject management | **Partial** ↓ corrected | Per-day-per-code drilldown built; all five drilldowns on the API; period agreement fixed and pinned by a test that applies predicates rather than canning a recordset. **But the phase's single acceptance criterion breaks at the reject code**: there is no code filter on the register, server-side or client-side (`api/src/services/register.ts:42-70`), so a Pareto bar reading "code 3/2 — 14 rejects" cannot be resolved to its rows. The dictionary sits behind rank-4 Setup while the write is rank 2. | **The reject-code meanings themselves** — this is the phase's own task 2 and is pure IFL data. `is_pass`/severity semantics. Production day vs calendar date. | ~1 day |
| 6 | Product / PDAS | **Partial** | Write path built against the vendor's own procs with real rails (fail-closed, before-image, `rowsAffected===1`, echo-back). **But `changeover.ts` (441 lines) and `pallets.ts` are reachable from no HTTP route** — verified: nothing imports either outside themselves — so IFL's stated key requirement has no surface. `sms.pallet`/`sms.pack_schema` are structurally guaranteed empty (only writer is the disabled path), so the changeover's pallet pre-check can never succeed. Offline write tests are 5 cases covering the disabled path only. TOCTOU on the one non-proc UPDATE. `createProduct` reports a committed write as a failure if bookkeeping throws. | **Written PDAS authority** — and the write surface must be reconciled first (see §6, H6). Writer login provisioned. Approved test window. Live `db_datareader` on PDAS. | 1.5–2 weeks |
| 7 | Sack and stock ledger | **Partial** ↓ corrected | Ledger complete and correct; machine-level stock refused at three layers (DB CHECK, INSERT, request schema) — the phase's acceptance holds by construction. **But IFL already answered the blocking question and the answer is unbuilt on the client.** Q28: "sack stock per machine" means *production per machine by shift and day*, not a receipts/issues ledger. That report exists server-side as the tenth report type; the web client declares nine (`web/src/api.ts:1829`) and cannot request it. Two strings the app prints — "has not been asked" and "the developer's reading" (`api/src/services/sackStock.ts:72,76`) — are now false and appear on the report IFL reads. | Confirm the Q28 reframe in writing. Q29–32 still open (who enters movements, is stock tracked today, sack type codes). Sack timestamp semantics confirmed **in words**. | 3–5 days |
| 8 | Dashboards and reports | **Partial** | Nine report types, one dispatcher, one UI surface, print header, KPI sheet. Gaps: the **tenth type is server-only**; **Excel export is dead code** — nothing imports `reports/xlsx.ts`, and the export route sends CSV only (`api/src/routes/reports.ts:214-217`); **PDF does not exist** (browser print); weight basis hardcoded in three builders; six of nine report sections have no chart; **no render test anywhere in the web package**. | **Approve report layouts and KPI definitions** — `KPI-DEFINITIONS.md` carries 34 "awaiting". Decide whether browser print satisfies "PDF with graphics" (this is a 1–2 day vs 2-week fork). Q42: who may see reports. | ~1 week + PDF variable |
| 9 | Calibration analytics | **Partial** ↓ corrected | Every one of the roadmap's eight named items is built and tested; naming discipline holds under grep (7 hits, all disclaimers). **But the validation ran and failed on the path measured**: 11 of 12 episodes came from the fallback threshold and none would have fired at a defensible one (`CALIBRATION-VALIDATION.md:88,94`), and the document's own fix is marked "not made in code" — `driftThresholdG` is a hardcoded formula with no floor, no config row and no Setup control (`api/src/services/attention.ts:116-121`), **so IFL cannot discharge this dependency even by answering.** `spc.ts:450` is the one run-detector with no contiguity guard. | The seven sign-off rows of `CALIBRATION-VALIDATION.md` §4, all "awaiting". Which Nelson rules apply. Engineers must start logging adjustments — the ledger holds one row, a test. | 3–4 days |
| 10 | Optional AI/ML | **Blocked** | Correctly unbuilt — the roadmap forbids starting. Buildable preparatory work only: the archive-ingest path (1.5–2.5 wks), which is what lets six months of history load the week it arrives instead of six weeks later. | 6–12 months of history (53 days held). A prediction target. Whether "AI" is contractual at all — never asked. | Not startable |
| 11 | Security, reliability, ops | **Partial** | All fifteen named tasks built. Gaps: `z.coerce.boolean()` on env strings means `*_TRUST_SERVER_CERTIFICATE=false` evaluates **true**, so cert validation can never be switched on; no allow-list forcing the PDAS writer to differ from the sync login; **two of five acceptance failure modes never rehearsed** (SQL service restart, NSSM restart — both doable locally); audit-integrity trigger untested; no release artifact; CI is Linux-only and has never run. | Live login and host. Written PDAS authority. Password/session policy as IFL's policy. Which events must be audited, and by whom. Raw/canonical retention against Express's caps. | 3–5 days + 1–2 rehearsal |
| 12 | Testing and release | **Partial** | Unit level is genuinely strong (782 `it()` declarations). **Three whole levels are absent**: no test ever opens a real SQL Server (`grep` for `.connect(`/`new ConnectionPool(` across all 84 test files returns nothing) — so all 34 migrations and every query string are unexercised; **no UI test at all** (no jsdom, no testing-library, no Playwright in any manifest; 42 `.tsx` files untested); **no performance test of any kind**. No FAT or SAT checklist exists. | Concurrent-user count and peak rate (the perf target). Which workflows are "critical". What "audit integrity" means. Where FAT is held and who signs. **Owner, not IFL:** approval for a test dependency, and the push. | 2.5–3.5 weeks |
| 13 | Documentation | **Partial** | 4 of 13 documents usable, 1 stale, **8 absent**: database architecture, integration spec, user manual, administrator manual, troubleshooting guide, FAT protocol, SAT protocol, change control. `DEPLOY.md` has four instructions that are now false — including `:80`, `user:create --role=operator`, a command the CLI **refuses** since migration 035. Also missing and not in the roadmap's 13: a third-party licence inventory. | Manual language (Urdu). Floor device. FAT venue and signatory. IFL's backup and retention policy in their words. | 8–12 days |
| 14 | Site commissioning | **Blocked** | Out of the development roadmap by its own terms. The code and packaging that must land first: **no release artifact** (the air-gapped plant PC is told to run `npm ci`, which needs the registry and a native argon2 build); **review-only ngrok tooling is tracked and would ship** (`sms/ops/sms-watchdog.ps1:9` carries a live public URL); go-live data disposition unowned. | Live login, network route, site access, downtime window, SAT sign-off, training plan, sample-data disposition. Hardware is settled — the owner supplies the PC. | 3–5 days packaging |

**Totals: 0 complete · 13 partial · 2 blocked.** No phase is finished. That reads worse than it is — most "partial" phases are 80–95% code-complete with a specific, named, small remainder. It also reads better than it is in one respect: four phases were being reported as client-blocked when the next move was ours, and that misattribution is the single most costly error in the current status set, because it would have led to waiting instead of building.

---

## 4. The Definition of Done — the actual gate

All 16 lines verbatim from `IFL_SMS_Claude_Code_Development_Roadmap.md:526-541`. **Result: 0 met, 9 partially met, 7 not met.** Work through this as a checklist; the "Owner" column is the whole argument of this document.

---

**1. "All agreed source integrations work."** — **PARTIALLY MET** · Owner: **mixed**
The SQL adapter works, against detached copies on the developer's local SQLEXPRESS. `IFL_DB_SERVER=.\SQLEXPRESS` (`sms/.env.example:22`) is the only source ever configured; no `ifl_live` generation has ever been registered. The PDAS read path mirrors four tables and not `dbo.Pallets`/`dbo.PackSchemas` (`seedProducts.ts:35-45`, verified). No integration test of any kind exists.
*To close:* **us** — add the pallet/pack-schema read (~half a day); build the integration harness (already specified at `handover/contracts/WAVE-E-CONTRACT.md:7`). **IFL** — the live `db_datareader` login and host; then run the `DEPLOY.md:359` cutover and keep the transcript as the FAT artefact; and say whether a separate Sack Packing database exists.

**2. "Cone data reconciles."** — **PARTIALLY MET** · Owner: **mixed**
`sms verify` is genuinely well built: per generation, identity and fingerprint first, then COUNT/MIN/MAX/**SUM(id)** — the SUM is what catches equal-count-one-missing-one-extra — then raw⇄canonical by key in both directions. But it has only ever run against copies, no sample period has been agreed, and **there is no stored transcript of any run anywhere in the repository** — an acceptance engineer is offered prose, not evidence. One live arithmetic defect: `api/src/services/reconcile.ts:113` pushes the no-weight bucket into the average, so `byState.unknown.avgG` reads low.
*To close:* **us** — fix `reconcile.ts:113`; capture a dated transcript; surface the result in-app (`/api/reconciliation` exists and no screen calls it). **IFL** — name the sample period; supply the live login.

**3. "Sack data reconciles."** — **PARTIALLY MET** · Owner: **mixed**
Same machinery, same coverage, same two blockers. Sack-specific facts are handled honestly rather than papered over: `production_ts_is_insert_time` is on every row and printed; the basis is IFL's own Q24 answer as a versioned rule row; no sack is attributed to a machine anywhere.
*To close:* **us** — nothing; the code is complete. **IFL** — confirm in words what the sack timestamp means (it is acquisition insert time, ~18 min after the event); the sample period; the live login.

**4. "Product attribution is defined and traceable."** — **PARTIALLY MET** · Owner: **mixed**
The closest to met. Attribution is defined in one function with no fabrication, stamped on all three reading types, and the trace is followable by a person on screen, in JSON and in CSV. Two gaps: traceable from 5 Aug 2026 only (142,511 July cones carry `'none'` permanently — correct, but it means any product report over held history is partial); and the per-machine changeover IFL named as the key requirement is written and reachable from nothing.
*To close:* **us** — add `machine-product` to the web client (~1 day, UI only); mount `changeover.ts`. **IFL** — confirm **in writing** that `MaterialId` is the product of record (today it is a verbal relay recorded at `transform.ts:116`), and accept that pre-5-Aug readings will never be assigned a product.

**5. "Reject codes are approved."** — **NOT MET** · Owner: **IFL data**
Not one reject code has a meaning in the system. The seeder inserts the numeric triples found in the data and leaves every label NULL by design (`seedRejectCodes.ts:2-3`). IFL's Q12 answer — "meanings are set in settings, no predefined list" — settles the mechanism and supplies no meanings.
*To close:* export the current `sms.reject_code` contents for the live line as a one-page list with each code's share of rejects, send it, get a meaning + pass-flag + severity for each. **Zero engineering.** The naming UI is built at both rank-2 and admin surfaces. The real distribution is a short tail, so this is a small list, not a project. **This is the cheapest item on the whole board and it has been outstanding for weeks.**

**6. "Product limits are approved."** — **NOT MET** · Owner: **mixed**
Two separate gaps, and the first is ours. **(a)** IFL's Q10 answer requires limits editable in admin settings. The app cannot change a limit at all: the only writer of `sms.product_limit_version` is the PDAS path, which answers 503 while the flag is false; Setup's section states "Nothing here edits". **Verified today.** **(b)** The rule that turns a limit into a verdict is a developer proposal awaiting sign-off.
*To close:* **us** — build an SMS-owned, versioned, rank-2 limit editor writing a new source value independent of `PDAS_WRITE_ENABLED` (2–4 days; the hard part is reconciling an SMS-owned limit with the PDAS mirror that MERGE-overwrites every 60 s). **IFL** — sign the 24-case fixture, the disagreement rule and the plausibility window; and settle whether the PLC reads limits live, which decides whether a limit change needs a second confirmation step.

**7. "Reports are approved."** — **NOT MET** · Owner: **mixed**
Three blockers, all ours before IFL can even be asked. The tenth report type — the one IFL asked for — is absent from the client (`web/src/api.ts:1829` lists nine; verified). Excel is dead code and PDF does not exist, against a Q30/36 answer of "Excel AND PDF, with graphics". And `KPI-DEFINITIONS.md` documents nine reports, so the signing instrument is already behind the API. All 34 KPI rows read "awaiting".
*To close:* **us** — add machine-product to the client; route the XLSX writer; decide the PDF answer; add the tenth report's rows to the KPI sheet. **IFL** — sign the KPI sheet plus one printed specimen of each report over a real period; answer Q42.

**8. "User roles are approved."** — **PARTIALLY MET** · Owner: **mixed**
The rename is genuinely finished — ranks agree between database, API, CLI and UI, verified today (`web/src/api.ts:137`, `web/src/App.tsx:77`, `cli/src/commands/user.ts:26`), enforcement is server-side and 61 rank cases run against the real Express app. But the approval is a verbal relay with no name against it, the per-action matrix was never specified by IFL, no named-person mapping exists, and **our own documents would mislead IFL today**: `DEPLOY.md:80` instructs a command the CLI now refuses.
*To close:* **us** — correct `DEPLOY.md` and `CAPABILITIES.md`; produce a one-page capability→rank→enforcing-route table. **IFL** — confirm it in writing, answer Q39/Q42, name the people, and state AD/SSO vs app-local (never asked).

**9. "Sack stock method is approved."** — **PARTIALLY MET** · Owner: **mixed**
The ledger is complete and the machine-level refusal is enforced in three places. But IFL's Q28 answer reframes the requirement as a production report rather than a receipts/issues ledger — and the project's own decision table anticipated exactly this and prescribed the opposite of what shipped (`IFL_SACK_STOCK_QUESTION.md:88`: "do not call it stock"). The delivered surface is named "stock" throughout.
*To close:* **us** — correct the two stale printed strings; lead the Sacks screen with production per shift/day/product and demote the ledger to a secondary block; implement `byDay`/`byDayShift`, which the client already types and the API never produces; surface machine-product. Write a one-page `SACK-STOCK-METHOD.md` with a sign-off table. **IFL** — sign it; answer Q29–32.

**10. "Calibration advisory is validated."** — **NOT MET** · Owner: **mixed**
The validation document is labelled AWAITING IFL and, more to the point, **the part that would prove the detector works has not been run**. Only the false-positive sweep was executed, and it found the method failing on the path measured. The simulator change the drift scenario needs is described, not made.
*To close:* **us** — add the simulator drift term and run the 21-day scenario (~2 hours plus the run); put a floor on the fallback threshold and give it a config row, a route and a Setup control, **so IFL's answer has somewhere to land**. **IFL** — the seven sign-off rows, the walkthrough with their engineers on live data after go-live, and — critically — their engineers must start logging adjustments, because 0 of 12 detected episodes could be confirmed or refuted against a ledger holding one test row.

**11. "AI/ML is either accepted as an optional module or implemented against agreed criteria."** — **NOT MET** · Owner: **IFL approval**
Neither branch. Implementation is forbidden by the roadmap's own gate (53 production days against a 6-month minimum; one ledger row; no prediction target). Acceptance as optional has **never been asked** — it is unsent question 7 in `DECISIONS-PENDING.md:86`. Q46–48 settled the safety rule (advisory only) and explicitly left the contractual question open.
*To close:* take the acceptance branch; the implementation branch is at least six months past a go-live that is not dated. **Us:** one page — what the advisory is (a four-test detector, eight Nelson rules, I-MR sigma, a least-squares projection), what it is not, the prerequisite table, and two acceptance options with a signature block. **IFL:** sign one of them. Do **not** offer the projection as the "implemented" branch — the code and the user-facing words correctly refuse to call it a model, and representing it as one breaches roadmap rule 8 (line 504). Send this in one packet with line 10.

**12. "Backup/restore is tested."** — **PARTIALLY MET** · Owner: **mixed (mostly owner)**
The strongest of the sixteen, and still refutable. Two dated rehearsals with real numbers exist and are genuine acceptance evidence — but the newer one covers migrations 001–027 and the sidecar is at 036; the nightly task has only ever been rehearsed with `-WhatIf`; `backup-config.ps1` has no rehearsal record at all; the host-rebuild procedure has never been executed end to end; and two defects are open (30 full copies retained with no free-space guard, and `-Server` defaulting to the developer's port 14330).
*To close:* **owner, today** — re-run backup + scratch restore on the 036 schema and **capture the transcript as a file**; fix the two script defects; run `backup-config.ps1` once. **On the plant host** — register the tasks for real, let the nightly fire once unattended, restore the machine-written `.bak`, and rebuild the host from the config snapshot.

**13. "Failure recovery is tested."** — **PARTIALLY MET** · Owner: **mixed (mostly owner)**
Three of the roadmap's five modes were rehearsed on 15 Sep with real results, including no-loss/no-duplication verified at 275,063/275,063. Two were not — SQL Server service restart and NSSM-supervised restart — and both are blocked on nothing but installing NSSM on the dev box. Network interruption was simulated as a refused port, not a hung link. None of it is automated: nothing in the suite would fail if recovery broke, and neither entrypoint is imported by any test.
*To close:* **owner, today** — install NSSM locally, execute the two missing modes, capture transcripts; use a firewall DROP rule for a genuine hang; promote the NSSM bat block to a versioned install script. **On the plant host** — repeat, because boot ordering is a host fact.

**14. "Security is tested."** — **PARTIALLY MET** · Owner: **us (code), with one IFL definition needed**
Posture is good and the two roadmap categories that *are* tested are tested well — 53–58 gated routes driven over real HTTP at all four ranks, the percent-encoding bypass closed and pinned, cookie flags, lockout, CSV formula injection, transactional audit. Not tested: **not one assertion on any of six security headers** (grep returns zero); no HTTP-level 429 test; `TRUST_PROXY=true` never exercised; **the append-only audit trigger can be reached by nothing** because no test opens a database — and `sms_app` holds `db_ddladmin`, so the audit log is actor-recorded but not tamper-evident against the app's own login (`DEPLOY.md:602`). No dependency scan has ever run. A latent MEDIUM: `z.coerce.boolean()` makes `*_TRUST_SERVER_CERTIFICATE=false` evaluate true.
*To close:* **us** — the missing assertions, the trigger test (or a hand transcript), `npm audit`, the push. **IFL** — define what "audit integrity" means to them, since tamper-evidence needs the `sms_migrate`/`sms_app` login split performed at install.

**15. "No critical/high unresolved defects remain."** — **NOT MET** · Owner: **us, entirely**
*Assessors disagreed here; I have taken the refutation.* One assessment marked it partially-met on the grounds that 4 of 8 distinct highs are closed. The criterion is binary — either none remain or some do — and **four remain, each verified in the working tree today**: H4, H6, H7, H8 (§6). Zero criticals. Behind it sits a structural problem: **there is no living defect register**. `AUDIT-2026-09-15.md` is a one-shot snapshot with no status column, so today's four closures are invisible to any reader of the project's own documents.
*To close:* fix the four (§6 gives the exact edits; three are hours, one is a document change that must precede the PDAS authority request), then start a register with severity + status + evidence + closing commit.

**16. "Installation and FAT documentation is complete."** — **NOT MET** · Owner: **us (document)**
**FAT documentation does not exist.** `FAT-PROTOCOL.md` and `SAT-PROTOCOL.md` are absent — verified. This is also Phase 12's acceptance criterion, so it blocks two phases. `DEPLOY.md` is a real 620-line runbook but carries four false instructions, of which `:80` **actively fails when followed**, and promises an offline install procedure in a section that contains none — on a plant IFL has said is air-gapped. Seven of Phase 13's thirteen documents are absent.
*To close:* **us, not blocked on anyone** — write `FAT-PROTOCOL.md` in the shape already specified at `handover/contracts/WAVE-E-CONTRACT.md:11`: one row per DoD line and per phase acceptance criterion, each with evidence artefact, reproduction steps, expected result, pass/fail box, **and an explicit "IFL dependency" mark on every row whose acceptance is an approval rather than an engineering fact**. That marking is the deliverable's real value — it turns this document's two piles into something the owner can hand to IFL. Then fix the four `DEPLOY.md` errors and write the actual offline procedure. **IFL** owns only the venue, date and signatory.

---

## 5. What only IFL can unblock

In the order they should be asked. The first three are cheap for IFL, gate the most, and have been outstanding longest.

| # | Ask | Gates | Cost to IFL |
|---|---|---|---|
| 1 | **A dedicated read-only `db_datareader` login on the LIVE plant server** for `DATA_TP1U2` and `PDAS_TP1U2`, plus the host and network route | DoD lines 1, 2, 3, 12, 13 and the whole of Phase 14. Without it nothing has ever been reconciled against live data and no cutover, NSSM install or scheduled backup can be rehearsed. **The longest-lead item in the project.** | A DBA's ten minutes |
| 2 | **The reject-code meanings** — send the exported code list, get back a meaning, pass-flag and severity for each | DoD line 5 outright; Phase 5's own task 2. A short tail, not a project. | One page |
| 3 | **Written authority for SMS to write to PDAS** — but reconcile the surface first (§6, H6) | DoD line 6 (b); Phase 6 entirely; the limits route. **Do not send until the seven-procedure, five-table surface is documented**, or the authority will be granted for something narrower than what ships. | One letter |
| 4 | **Approve the classification fixture** (24 cases), the scale-vs-tolerance precedence, and the plausibility window | Phase 4's acceptance is literally "matches *approved* test cases" | Half an hour with an engineer |
| 5 | **Approve report layouts and KPI definitions** — 34 rows, plus one printed specimen of each report | DoD line 7; Phase 8's acceptance | An hour |
| 6 | **The 10 Jul – 5 Aug data**, and the ~6-month archive being retrieved | Completeness of history; Phase 10 eventually. ⚠️ Note the contradiction: the reader **deliberately refuses the July table shape** (`iflTables.ts:35-38`), so if they send it, ingesting it is a code change, not an import. Ask anyway; plan the archive path. | An export |
| 7 | **Q14 — single or multi-line**, and if multi, does a second line share one database | Decides whether Phase 1's multi-line residuals are an hour or two weeks. **Do not build past this** (rule 17). | One sentence |
| 8 | **Q7 — shift: reproduce the plant's attribution or correct it** | `sms.shift_rule.mode` is stored, versioned, audited and applied nowhere, by design, pending this | One sentence |
| 9 | **Is "AI" contractual?** Never asked. Send with the calibration sign-off. | DoD line 11 | One paragraph |

### Answered on 15 September and not yet reflected in the documents

These are direction to build to. The status set still carries several of them as blocking.

- **Q28 — sack stock.** Means *production per machine by shift and day*, not a receipts/issues ledger. This **moved** the requirement rather than closing it: the deliverable exists server-side and is unreachable, and two strings in the shipping app now misstate the position to the client.
- **Q10 / Q40 — product limits** are to be editable in settings, by the engineer. **Not built** — see DoD line 6. `HANDOVER-2026-09-15.md:319` calls this "already built"; that refers to the table, not a writer.
- **Q3 — machine vs station.** Station N is machine N by IFL's own word; migration 035 flips the links to `confirmed_by_ifl`. The largest Phase 3 IFL blocker is closed.
- **Q24 — sack weight is gross.** Written into `sms.weight_rule` as a versioned row. The cone basis is still unconfirmed.
- **Q12 — reject-code meanings** are set in Setup, no predefined list. Mechanism settled, **meanings still owed** (ask #2).
- **Q19/Q40/Q41/Q43 — the process engineer** (rank 2) owns limits, products, reject-code naming and sack movements. The code now matches; the per-action matrix was never specified.
- **Q46–48 — recommendation only, no automatic adjustment.** Confirms the shape built. Does not answer ask #9.
- **Q30/Q36 — Excel AND PDF, with graphics.** Neither is deliverable today.
- **Q65–70 — the owner supplies the PC.** Hardware is no longer an IFL blocker; the login and route still are.

---

## 6. Defect register, reconciled

All 22 rows of `ROADMAP-GAP-ANALYSIS.md` §17 were decomposed into 113 individually verifiable defects and checked against the code. **76 closed · 1 superseded · 36 live.** Nothing was unverifiable.

The register is far deader than it looks: every Sync, Model, Ops/CLI and Build row is essentially cleared, Rejects is fully cleared (13/13), Calibration is 4 of 5. The 14–15 September work closed most of it and left a comment at each site naming the old behaviour.

### The four open HIGH findings — all verified today, all ours

| ID | Defect | Evidence | Fix |
|---|---|---|---|
| **H4** | **The Weight control chart judges any past period against today's product.** The client sends only `trailingDays`/`periodFrom`/`periodTo`/`shift` — never `from`/`to`; the server therefore falls back to the newest production day and resolves product identity, USL/LSL, Cp/Cpk and the disagreement counts there. Pick June and you are reading a material that was not running. **This is the one open high that puts a wrong number in front of a reader**, and it is exactly what redesign rule 1 exists to prevent. | `web/src/api.ts:1229-1241` (verified: no from/to); `api/src/app.ts:603` `q.data.to ?? await newestProductionDay()`; `services/weightStations.ts:137-139` | ~1 hour |
| **H6** | **The documented PDAS write boundary understates the code by five tables and five procedures.** `CLAUDE.md:364` promises `Materials` + `nhs_events`, "no other table, ever"; `DEPLOY.md:600` grants EXECUTE on two procs. The code touches `dbo.Materials`, `dbo.Blends`, `dbo.Counts`, `dbo.TubeTypes` and `dbo.Pallets` across seven procedures. Runtime risk is nil (flag off). **The live risk is that the authority request about to go to IFL describes a narrower surface than what ships.** | `pdasWrite.ts:513,608,767,818,890,931` — verified | Half a day, **and it is a prerequisite for ask #3** |
| **H7** | **The two-clocks design depends on the host's OS timezone.** The cross-check exists only in the API and returns early when unset; `PLANT_UTC_OFFSET_MINUTES` ships **commented out**; grep returns **zero hits** in the sync worker and **zero** in `DEPLOY.md`. The owner supplies the PC; a freshly imaged Windows host defaults to UTC, on which every reading arrives five hours in the future — silently. **A commissioning defect: fix before the PC is built, not after.** | `.env.example:117` (commented); no hit in `sync-worker/src` or `DEPLOY.md` — verified | Half a day |
| **H8** | **The configured weight basis is honoured by only part of the app.** Three report builders and the `/api/weights` default hardcode `'as_recorded'` while `production.ts`, `sacks.ts` and `sackStock.ts` read the rule. Latent only because migration 035 chose `gross`, which subtracts nothing — **the moment an admin selects `net` in Setup, a control that ships enabled, the reports and the screens disagree about the same kilograms while the API envelope declares a basis the figures did not use.** | `reports/coneWeight.ts:88`, `reports/sack.ts:66`, `reports/summary.ts:94`, `api/src/app.ts:1051` — verified | ~2 hours |

### The other live defects that matter, ranked

1. **R22d — `epoch:accept` ordinals can silently break the reject control chart.** Generation ordinals are computed per table as MAX+1, but `rejectSpc.ts` now groups the p-chart's limits **by** that ordinal, depending on the four tables sharing one. A single-table `--table=…` accept desynchronises them and turns every reject chart into all-cones or all-rejects. Nothing enforces `--all`; the cutover happens to use it. **This is the one entry whose severity is higher today than when written, because the dependency was added after the defect.**
2. **R09c / R09d — the last consumers using a line-wide, present-tense product target.** `weights.ts` resolves the newest timeline product with a hardcoded 1950 g fallback and feeds three contracted reports; the station table judges every station against one line-wide target. Up to six materials run concurrently on different machines, so this is wrong by construction for live data and collides directly with IFL's per-machine requirement.
3. **R20a / R20i — the documentation counts regressed rather than being fixed.** Four documents claim 31/31/31/23 tables and 27 migrations against a true **40 tables and 34 migration files** (verified), and `DEPLOY.md`'s is the number an installer follows. `CLAUDE.md` quotes 266 tests against 938 and describes as done a tree of 36 uncommitted paths on a branch never pushed.
4. **R19b / R19e — audit integrity and route coverage.** `sms_app` holds `db_ddladmin`, so the audit log is actor-recorded but not tamper-evident; and `auth.ts:290-293` claims a router-walking test that does not exist, so a new route with neither a gate nor a hand-maintained table entry would go untested.
5. **R22a — the July shape is deliberately unsupported** while `CLAUDE.md` still lists the 10 Jul – 5 Aug data as something to request. Asking for it and being unable to ingest it are currently both true.

**Latent until approved — the PDAS write cluster** (R08a–R08g) is unreachable while the flag is false. **R08c is the one to fix before that flag is ever turned on**: on `createProduct`, the bookkeeping runs inside the try, so a *successful* PDAS write can be reported to the operator as a failure, with no product id and no undo path.

---

## 7. Delivery risks today

Eleven rows of the original risk register were re-checked: **3 closed, 1 superseded, 7 live** — plus **8 risks the original list did not anticipate**, two of them serious. Plus nine FAT-readiness gaps that sit outside every frame used so far.

### Critical

**1. The deliverable exists on one laptop, and the off-machine copies are stale.**
`origin/main` is at `b1c6de2`, dated 19 August, holding the **pre-redesign app IFL called unusable**. The branch is 39 commits ahead with no upstream; the remote has zero tags; `.github/` does not exist on the remote, so **CI has never executed once** — every "938 tests passing" claim is a local assertion by the machine that wrote the code. The mitigation `PROJECT_STATUS.md` §2 leans on does not cover this: the newest git bundle on D: stops at `8bf9c91`, six commits and ~31,350 insertions behind HEAD. **Phases 1, 2, 3, 4, 5, 7, 8, 9 and 11 exist on exactly one NTFS volume.** The app *database* has a same-day backup; the code does not. And 36 uncommitted paths include migrations 035 and 036 which are **already applied to the development sidecar** — the database is ahead of the source of truth, so a clean checkout cannot reproduce the running system.
*Blocked on: nobody. This is one `git push`, and it is the highest-value action on the board.*

### High

**2. `sms verify` cannot pass on live data once IFL deletes a row.** It demands exact COUNT/MIN/MAX/SUM(id) equality between the **whole** live source table and the whole raw archive (verified, `verify.ts:206-215, 415-419`), while the product's stated premise is that the sidecar keeps what IFL discards after about a month. The first pruned row makes it exit 1 **forever**, and correctly-held archive rows are what trip it. Worse, the diagnosis it prints — "the worker's backwards gate halts on this" — is wrong: that gate watches only MAX(id) (`runner.ts:173`, verified), which deleting old rows never moves, so the operator is sent to hunt a halt that has not happened. Two DoD lines are demonstrated by this command; on live data it would fail the demonstration it exists to give. Invisible today only because both samples are unpruned snapshots. *The fix — an archived-floor id per epoch — works under either answer to the open question of whether IFL prunes in place, so it need not wait. ~1 day.*

**3. Features built and reachable from nothing.** `changeover.ts` (441 lines) and `pallets.ts` have **no importer outside themselves** (verified); `reports/xlsx.ts` has none (verified); the machine-product report is server-complete and absent from the client (verified). Roughly 1,000 lines answering IFL's stated key requirement and their stated report format, invisible in the product — and untracked in git, so a future audit will misread them as shipped.

**4. `sms.pallet` and `sms.pack_schema` are structurally guaranteed empty.** Migration 036 names two intended writers; the read-side mirror was assigned to a task that did not land (`036_pallet_mirror.sql:22-24`) and `seedProducts.ts` reads four tables, not six (verified). The only other writer runs after a PDAS write that cannot happen. So the changeover's pallet pre-check always finds nothing — the module is not merely unrouted, it is **non-functional against the mirror as it stands**.

**5. Performance has never been measured, and three findings compound.** The API inherited the sync worker's pool verbatim — **5 connections, a 10-minute query timeout** — numbers chosen for a backfill. One uncached `/api/live` fires seven parallel queries, and the 5-second cache has no in-flight coalescing, so concurrent viewers all miss together. Against that, five route guards permit **366 days** while the sidecar has never held more than 53 production days: the largest legal request is seven times the largest tested dataset, and "show me the last year" is the most likely thing a manager does at a FAT. No load-testing tool of any kind exists in the repository.

**6. Every capacity document discusses the wrong ceiling.** A repo-wide search for "1410", "buffer pool", "max server memory", "4 cores" or "CPU socket" returns **zero hits**. Express's 10 GB *file* cap is discussed everywhere and is years away; the **1,410 MB buffer-pool cap** and the four-core limit are what actually govern query latency, and at ~1 GB/year of rows plus seven indexes on the hot table, that ceiling arrives inside the first year or two — at which point the 366-day queries above stop being served from RAM.

### Medium

**7. Review-only tooling would ship in the handover.** `sms/ops/sms-watchdog.ps1` and its installer are **tracked** (verified), and the watchdog embeds a live public tunnel URL at `:9` and `:100` plus hardcoded `C:\sms` paths. `DEPLOY.md` disclaims ngrok as review-time-only; the scripts ship in any clone regardless.

**8. No error boundary anywhere in the web client.** No `ErrorBoundary`, no `componentDidCatch`, no `window.onerror`, no `unhandledrejection` — `main.tsx` mounts `<App/>` bare, so any uncaught render exception blanks the whole page with no message and no route back. The **Wall screen** is the exposure: designed to run unattended on a TV, it handles *fetch* failures well, which makes it easy to believe it is already resilient. A render throw is a different path. First FAT instruction likely to expose it: "leave the wall display running overnight."

**9. `DEPLOY.md` states to IFL a justification the code has since falsified.** `:28` tells the reader in bold that a login without PDAS table read "stops **all** ingestion". That has not been true since `pipeline.ts:118-136` guarded the seed. The ask is still right; the consequence is overstated, and IFL's DBA can falsify it. This item is on the outgoing question pack.

**10. Multi-line is schema-deep and one environment variable wide.** `line_id` is on every row and `sms.line` holds many, but ~30 routes pass `cfg.lineId` from an env var, **no route accepts a line parameter**, the web takes `lines[0]`, `listLines()` is consumed by nothing, and `cutover` deletes with no line predicate. A second line is a second worker, a second API process and a second URL — not a selector. *Ask IFL whether a second line is in FAT scope before building anything; the two answers are weeks apart.*

**11. The status documents drifted again within a day**, including the specific self-check `CLAUDE.md` added to prevent it. Low severity in isolation — listed because these are the files consulted when deciding what to send IFL.

### Recommend closing rather than costing

**12. Urdu.** Mechanically the client is well prepared — a 1,286-line central string table with 993 call sites and 16 stray literals. What does not exist is everything else: no `dir` handling, `lang="en"` hardcoded, physical-left margins rather than logical properties, and a vendored typeface with no Urdu glyphs on a machine with no internet to fetch one. "Add Urdu" is an RTL and typography project, not a translation pass — and the question descends from a floor-worker audience IFL retracted on 2 September. *Ask IFL to close it.*

### Cannot be assessed until a host exists

**13. Plant-host preconditions.** Browser version against Vite's default ES-module baseline (no `build.target`, no browserslist); OS timezone against the two-clocks design (H7); the production SQL instance, edition and login (OQ-12); backup disk headroom for 30 full copies. None of these is a property of the code and none can be checked today. **Schedule "stand up the plant PC and rehearse against it" as its own task** rather than discovering them at the FAT.

---

## 8. What a Factory Acceptance Test would fail on today

Assume IFL arrives tomorrow with the roadmap in hand and works down the Definition of Done. These are the failures, in the order they would surface.

1. **"Show me the FAT protocol."** It does not exist. Neither does the SAT protocol. Verified. The test cannot be conducted in a witnessable form.
2. **"Show me sack production per machine, by shift."** The report is served by the API and absent from the client. This is the requirement IFL themselves named as key on 15 September.
3. **"Export that to Excel."** Every export is CSV. The XLSX writer is in the tree, imported by nothing. PDF means the browser's print dialog.
4. **"Open the weight chart for June."** It returns July/September's product limits and Cp/Cpk — a wrong number, presented as a fact (H4).
5. **"Change a product limit."** No account of any rank can. The one path answers 503 by design, and Setup's section says "Nothing here edits".
6. **"What does reject code 3/2 mean?"** No reject code has a meaning. IFL's own to supply — but they will ask, and the answer is "we asked you".
7. **"Trace that reject count back to the rows."** The register has no reject-code filter. Phase 5's single acceptance criterion breaks at the last dimension.
8. **"Reconcile the last week against our own SELECT."** `sms verify` aggregates whole tables per generation with no period scoping, has no stored transcript of any run, and has never touched a live source. `/api/reconciliation` exists and no screen calls it.
9. **"Set the weight basis to net."** The reports and the screens then disagree about the same kilograms, while the envelope declares the basis the figures did not use (H8).
10. **"Run the wall display overnight."** One uncaught render exception blanks the TV with no recovery path.
11. **"Show me the last year."** 366 days is legal and has never been executed at any volume above 53 days, on a 5-connection pool.
12. **"Install it from the documentation."** Step `:80` fails — `--role=operator` is a name the CLI refuses. The migration claim is seven files stale. The offline procedure the document twice promises is not written, on an air-gapped plant.
13. **"Show me the user manual."** Absent. So are the administrator manual, the troubleshooting guide, the integration spec, the database architecture and the change-control procedure.
14. **"Prove the audit log cannot be altered."** The database trigger exists and no test has ever executed it, because nothing in the suite opens a database — and `sms_app` can drop it.
15. **"How many concurrent users does it support?"** Unknown. No load testing exists anywhere in the repository.
16. **"Show me the tested backup on this machine."** The rehearsal is on the developer's laptop, on a schema seven migrations old, and the nightly task has only been rehearsed with `-WhatIf`.

Items 1–5 and 12 are the ones that would end the day early. All six are ours, none needs IFL, and together they are roughly two weeks.

---

## 9. The shortest credible path to "finished"

### Week 0 — today and tomorrow (hours, not days)

These have no dependencies and unblock everything downstream.

1. **Commit the 36 paths and push the branch.** CI runs for the first time; its clean-tree and secret-file gates become real; the work acquires an off-machine existence. *Expect CI to fail the first time — that is the point.*
2. **Send the four cheap approval requests**: the reject-code list, the classification fixture, the PDAS authority *(after step 4)*, and the AI/ML + calibration packet. Ask for the live login again, in writing, naming what it blocks.
3. **Fix H4** (~1 hour) — it is the only open high that shows a wrong number.
4. **Fix H6** — correct `CLAUDE.md:364` and the `DEPLOY.md:600` grant to name all five tables and seven procedures. **This must precede the authority request.**
5. **Fix H7 and H8** (~half a day together).
6. **Correct the two false strings in `sackStock.ts`** — they print on the report IFL reads and currently misstate the project's position to the client.

### Weeks 1–2 — make it demonstrable

7. Surface the **machine-product report** in the client (~1 day) and **route the XLSX writer** with tests (~1 day). These are the two things IFL asked for and cannot see.
8. Add the **pallet/pack-schema mirror** to `seedProducts` (~half a day), then **mount `changeover.ts` and `pallets.ts`** behind audited rank-2 routes (~2 days). Until the mirror lands, the changeover is non-functional.
9. Fix the **`sms verify` prune blindness** (~1 day) and its wrong diagnosis. Without this, reconciliation fails at the plant within a month of go-live.
10. Build the **SMS-owned product-limit editor** (2–4 days) — IFL's Q10 answer, and the only way DoD line 6 closes without PDAS authority.
11. **Write `FAT-PROTOCOL.md`** (~1 day), marking every IFL-dependency row. This is the artefact that makes the two piles legible to the client.
12. **Rehearse locally what can be rehearsed**: migration 001→036 from zero, backup + restore on the 036 schema, the SQL-service and NSSM restarts. Capture transcripts as files.

### Weeks 3–5 — make it testable and honest

13. **Integration harness** against a real SQL Server (1–1.5 wks). This is the largest single gap and the one that makes every other claim verifiable; 34 migrations and every query string are currently unexercised.
14. **UI test harness** (1–1.5 wks; needs a dependency decision first). Note the concrete cost of not having one: the machine-product omission is exactly the class of defect no existing test can see.
15. **Calibration threshold configuration** (1–2 days) so IFL's answer has somewhere to land, plus the simulator drift run.
16. Weight basis threaded properly; contiguity guard on `spc.ts`; line/epoch scoping on the transform's three unscoped queries; error boundary; reconciliation surface.

### Weeks 6–9 — documentation and packaging

17. The **seven missing documents** (8–12 days).
18. **Release artifact and offline install** (2–3 days; the native argon2 build is the risk and the reason this cannot be assumed easy). Strip the ngrok tooling from the delivered tree.
19. **Phase 6's offline write-path tests** (3–4 days), which will surface the TOCTOU and the `createProduct` bookkeeping bug.
20. Excel-with-graphics or the designed print pass — **the size of this depends entirely on IFL's answer about PDF**, so ask before building.

### Waits on a client answer — do not build past these

- **Multi-line** (Q14). An hour of cleanup or two weeks of work; nothing in between.
- **Shift mode** (Q7). The rule is stored, versioned and deliberately applied nowhere.
- **Archive ingest** for the July shape and the 6-month history. 1.5–2.5 weeks, worth starting **only** once IFL confirms the data is coming — but worth starting *then*, so it loads the week it arrives rather than six weeks later.
- **A second Sack Packing source.** ~1 week, and unverifiable from the repository whether it exists at all.

### Cannot be closed until there is a plant host and live data — at any effort

State these plainly to IFL rather than carrying them as engineering debt:

- **Cone and sack reconciliation against live source** — no `ifl_live` generation has ever existed.
- **The cutover itself**, and `epoch:accept --provenance=ifl_live`.
- **Backup and restore on the real machine**, under the real service account, with a real unattended run.
- **SQL-service and NSSM restart recovery on the plant host** — boot ordering is a host fact, not a code fact.
- **NSSM service installation, TLS provisioning, the firewall rule, the scheduled tasks.**
- **The calibration walkthrough** with IFL's engineers, which by design happens on live data after go-live — and which needs their engineers to have started logging adjustments.
- **SAT.**
- **The plant-host preconditions** — browser version, OS timezone, SQL instance and edition, disk headroom.

---

### The one-sentence version

**Three to four weeks of focused engineering gets to a product that can survive a Factory Acceptance Test; ten to fourteen gets to one that is genuinely finished — but neither number gets to a *signed* FAT, because seven Definition-of-Done lines are IFL's signature and six more need a plant host that does not yet exist. Push the branch today, send the four cheap approval requests this week, and build the FAT-critical list while they turn around.**
