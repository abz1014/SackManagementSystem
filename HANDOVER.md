# HANDOVER — IFL Sack Management System (SMS)

Written 28 Oct 2026 for the move to a new Claude account. It replaces `HANDOVER-2026-09-15.md` as the place to start (that file is historical). Every fact below was checked against the repository, the dev machine or the past chat transcripts on 28 Oct 2026; where something could not be checked, it says so.

**If you are the new Claude session, read in this order:**
1. This file, top to bottom.
2. `CLAUDE.md`, only the first entry under "Current phase" ("Full UI redesign - web-next at /next") and the sections "Phase 1 hard constraints", "Working rules", "Database" and "Non-negotiable query rules". The rest of `CLAUDE.md` is a dated history; skim it only when a topic comes up.
3. `design/redesign-2026-10/VERIFY-PRESWITCH-H2H.md`, `VERIFY-PRESWITCH-PARITY.md` and `IFL-REQUIREMENTS-SCORECARD.md`. These are the three newest reports, and the open decision below comes from them.
4. `SCHEMA.md` before you write any SQL.

---

## 1. What the project is (one paragraph)

SMS is a web app for **Ibrahim Fibres Limited (IFL)**. It reports on cone and sack weighing from one yarn line: TP1, Unit 2, Line 3, with 14 Rieter winders, called "stations" 1-14. The plant's PLCs write the weighings into IFL's SQL Server (`DATA_TP1U2`; the product catalogue is in `PDAS_TP1U2`). A **sync worker** copies them read-only into SMS's own database (`sms`, a "sidecar"). An **Express API** and a **React UI** read only from that sidecar. The stack is TypeScript end to end in an npm-workspaces monorepo under `sms/`: `shared`, `sync-worker`, `cli`, `api`, `web` (old UI) and `web-next` (new UI). The owner, Abdullah, is the **only developer** and works with Claude; nobody else reviews the code. IFL's users are their GM, managers and process engineers, who form one technical audience.

---

## 2. Development checkpoint (as of 28 Oct 2026)

| Item | State |
|---|---|
| Branch | `floor-first-rework` |
| HEAD | `c0e08be` "docs(redesign): old vs new head-to-head before the switch" (15 Oct 2026) |
| Last code commit | `e5f853a` (15 Oct 2026): the `pl()` plural helper |
| Pushed? | **No.** `origin/floor-first-rework` is at `f829d30` (2 Oct 2026). **262 commits are local only** (261 before this handover), and 631 are ahead of `origin/main`. Remote: `https://github.com/abz1014/SackManagementSystem.git`. **Only the owner pushes.** |
| CI | Has never run on this branch. |
| Work since 15 Oct | None in this repo. The 26 Oct activity in the "Orchestrator workflow setup" chat was only a compaction. |
| Working tree | `VERIFICATION-2026-09-23.md` modified (+31 lines, not committed). Untracked: proposal build files under `proposal/IFL-SMS-2026-09/`, `drafts/`, `docs/guide/capture/proof/`, two screenshots (`bar375_top.png`, `zeroed_768.png`), `scratch-serve.log`, a stray root copy of `simulate-plant.mjs`, and `.claude/worktrees/` (two leftover agent worktrees; both branches are already merged into HEAD, so they are safe to remove with `git worktree remove`). |
| Dev API (:4000) | **Not running** on 28 Oct. It was last restarted on 15 Oct to serve the new build. |
| SQL Server | `.\SQLEXPRESS`, reachable on **`tcp:localhost,14330`**. Named pipes and the instance name fail from `sqlcmd`, so use the TCP form. |

### The new UI (`web-next`) — where it stands
- It was built 13-14 Oct 2026 after the owner approved a full redesign ("approved, go with your recommendations and start building"; `design/redesign-2026-10/APPROVAL.md`).
- It is served by the same API at **`/next`**. The old UI is still at `/`.
- Verification (`VERIFY-V3.md`, 14 Oct): 0 open defects, 10 known limits; vitest 5,047 passed and 0 failed; Playwright `playwright.next.config.ts` 81/81, twice.
- Fixes from 14-15 Oct were then live-checked against the simulator: station product labels, per-station targets that follow the shift, the reason sheet following the shift, the scale count 53, and plurals.
- **15 Oct, 07:43: the owner said "switch over to the new app".** Before acting, Claude ran three read-only checks. All three are committed:
  - **`IFL-REQUIREMENTS-SCORECARD.md`** (`99795d1`). 74 rows: DONE 23, PARTLY 38, NOT DONE 0, BLOCKED-ON-IFL 8, OUT-OF-SCOPE 5. **Correction:** its "buildable now" item (2) lists four polish items: the lag on Today, `?at=` without a Z, station product labels, and the "data batch" wording. All four were already fixed and live-checked on 14 Oct; the scorecard read an older note.
  - **`VERIFY-PRESWITCH-PARITY.md`** (`5805b66`). The new app equals independent SQL and the old app on every figure checked: about 190 headline figures, 382 station figures, 1,489 register rows, about 63,000 report tokens and 36 byte-identical CSVs. There are **no wrong numbers**, but there are four wording defects, D1-D4.
  - **`VERIFY-PRESWITCH-H2H.md`** (`c0e08be`). The new app is the same or better on most things. It is worse on one missing interaction (W1) and on speed and request counts on three screens (W2-W7).

### ⏸ THE OPEN DECISION (the very next thing to resolve)
Claude's last message to the owner (15 Oct, unanswered) recommended **one fix round, a quick re-check, then the switch**, and asked: *"Shall I go ahead with that fix round, then the switch? Or switch now and fix afterwards?"*

**Ask the owner this again before doing anything else.** Explain it plainly (see the rules in §6). Here is the fix round that was proposed:

| # | Item | Where / how | Sev |
|---|---|---|---|
| W1 | The Rejects trend chart lost click-to-zoom and "Zoomed in - Back" (the old app had it) | Pass `periodFor` and `onZoom` to the trend `LineChart` in `sms/web-next/src/screens/Quality/Rejects/`, as Weight and Today already do. The old wiring is in `web/src/screens/report/shared.tsx` (~line 1300) and `Rejects.tsx:566`. | Med |
| W2-W4 | Slower to settle: Rejects at 1 day (+0.8 s), Reports daily at 34 days (+0.6 s), Today at 1 day cold (+0.7 s). Each sends more requests than the old app (15 vs 12, 11 vs 6, 16 vs 11) | Find which extra requests block the first view, and defer the ones whose content is off screen | Med |
| W5 | Today polls 40 requests a minute against the old 24 | Poll `/api/live` (every 10 s) and refresh the heavy reads only when it reports a change | Low-Med |
| W7 | The Register caps at 5,000 rows ("Load more", `MAX_PAGES` 50 × 100) | Say so on screen when the cap is hit, beside the CSV export | Low |
| D1 | On Quality › Stations, the "No product target" / "N products" wording for multi-product stations comes from the 14-day pattern data, not the selected period | `targetOf()` in `web-next/src/screens/Quality/Stations/model.ts`: use `productBasis` / `materialsInPeriod` from the station-status row | S3 |
| D2 | "N readings from before the 5 Aug 2026 IFL database rebuild are not counted" on Weight and the report pages is false on the dev copy, where those readings are simulator readings | The same fix as audit M3, which was already done on Rejects | S3 |
| D3 | The station sheet's "Cone weight by day" chart draws the line-default band (±40 g) while the figure above it uses the station's own product (±50 g) | Use the station's product limits for the band | S4 |
| D4 | "1 days / 1 readings / 1 products" in the legacy report bodies | Use the `pl()` helper (`e5f853a`) | S4 |
| Old | Record sheets print the production day next to the clock time, so a cone weighed at 05:54 on 2 Sep reads "1 Sep 05:54:56". This affects every reading from 00:00 to 05:59, about a quarter of all records. The old app has the same bug. | Print the calendar date (`ReadingSheet` equivalent in web-next) | S3 |

W6 (bundle size, +35 %) and W8 (no Wall below 1024 px, an owner decision) were judged not needing a fix.

### The switch-over itself (plan as told to the owner on 15 Oct)
1. **The switch, low risk and reversible.** The new app becomes `/`, old bookmarks and `/next/` links redirect into it, and the old app stays at **`/old/`** as a fallback. This is a server change in `api/src/app.ts` (around lines 2384-2410: `WEB_NEXT_DIST` / `WEB_DIST`), plus test and guard updates, `DEPLOY.md`, a rebuild, a restart and a live check.
2. **Retiring the old code, later and separate.** `web-next` still imports the old `web/src/api.ts`, `web/src/lib`, the report renderers and the Setup forms through `web-next/src/bridge`. Those must be moved across before `sms/web` can be deleted. Do this only after the owner is happy with step 1.

---

## 3. What is left — the full list

### A. Owner-only actions (never do these yourself)
1. **Answer the open decision above** and review `/next`.
2. **`git push origin floor-first-rework`** (262 commits). Pushing is the owner's alone, and the permission classifier has blocked agent pushes before.
3. **Supply the Manrope woff2 font file.** Until then the UI falls back to the self-hosted Instrument Sans.
4. **Run the two rehearsal kits:** `handover/REHEARSAL-RBAC-BELOW-RANK.md` (a real viewer or engineer sign-in) and `handover/REHEARSAL-RT24-05-EXECUTE-ONLY.md` (an EXECUTE-only PDAS login). Agents may not create logins.
5. **Send the IFL questions.** `IFL-OPEN-QUESTIONS.md` is the single list: the first asks, then items 22-29 (the eight reports' assumed definitions) and 30-41 (data-trust audit). **None has ever been sent.**
6. **Make an off-machine backup.** Every copy of IFL's data and of this repo sits on one laptop (C: and D: are the same machine). The minimum set that preserves IFL's originals is about 274 MB (the July `SPS.adding` archive and one September `SPS.rar`). They belong on an encrypted external drive, **not GitHub**.
7. **Check the server PDF export route on a real host.** Here, puppeteer cannot launch Edge, and the management-summary PDF returned 502 in 3 of 5 concurrent runs.
8. **Security:** `SCHEMA.md` (around line 184) and `QUESTIONS.md` still reproduce IFL's `DATA_TP1U2.Users` table, with plaintext passwords equal to the usernames, and it is on GitHub. The redaction was offered on 24 Sep and **never done**. Repo visibility is unknown. Steps: check visibility; tell IFL to change those passwords; redact the current files (Claude can do this when the owner says "redact"); a history rewrite is the owner's call.
9. **Decide the owner-reserved wording.** The legacy "rejected" titles and the `rejected_at_inspection` CSV header for the combined figure (audit M2) are untouched. The ledger note and opening issues (M5a/M5b) are pre-existing in both apps. Also undecided: whether Hassan's product-per-shift scenario needs a declared changeover record (the owner decided against it on 7 Oct).
10. **Decisions in `DECISIONS-PENDING.md` §14** (data-trust audit, about 50 entries) and §15 (redesign). These are still open.

### B. Blocked on IFL (do not guess past these; roadmap rule 17)
- A live read-only SQL login and host, and whether the owner's PC can reach the plant databases.
- The **10 Jul - 5 Aug 2026 data**, which exists at IFL but was never sent, plus the "last 6 months" archive. The ingest path (R-17) is built and proven on scratch copies.
- **Approval** of every KPI definition (all rows are "IFL approval: awaiting") and of the eight reports' definitions (printed as "Assumed until IFL confirms").
- The meanings of the reject codes, entered in Setup. Labels are blank until then.
- The cone weight basis (gross or net, tube or tare). Sacks are confirmed gross.
- Sack stock **per machine**. It is impossible from their data, because `sack1_TP1U2` has no machine column.
- Whether the PLC reads limits from PDAS live, and how a winder takes its product.
- The formal written confirmation back to IFL and the `sms_pdas_writer` login for the plant. The plant PDAS path stays OFF.
- Urdu, the floor device, the station-state thresholds (2× / 1.5× / 50-cone floor, assumed), and "AI". What exists is statistics; never call it AI until IFL agrees.

### C. Buildable now, if the owner wants it
- The fix round in §2 (recommended before the switch).
- The switch-over, then retiring the old UI.
- Restyling the Excel and PDF exports to the new look. IFL asked for "beautiful, with graphics". This was explicitly deferred.
- Moving the Reports and Setup bodies onto the new DataTable components. They are currently old markup restyled.
- Known limits from `VERIFY-V3.md`: the page moves while loading; 11 of 14 IFL tables scroll sideways at 768 px; three S4 cosmetics (D29, D31, D32).
- A SAT protocol, a change-control procedure, release notes, and updating `handover/OPERATOR-MANUAL.md` and `ADMIN-DEPLOY-MANUAL.md` to describe `/next` (they describe the old screens).
- Re-triage of the open-items index in `DEFECTS.md` Part 3. It still lists D-1 and R-17 (HIGH) as open, though later parts record both as addressed.
- Performance owner items from `PERFORMANCE-2026-10-12.md`: indexes IDX-1/2 on a scratch restore of `sms` only (never IFL's), response compression (a new dependency, so ask first), a PDF queue, and an `/api/spc` profile.

**Do not build:** per-machine sack stock, PLC links, AI/ML, OEE / Output / Shifts screens, or anything that guesses an IFL answer.

---

## 4. Dev environment

**Paths.** The repo root is `C:\Users\ABDULLAH SAJID\Desktop\sag database`, and the app is in `sms\`. `QUESTIONS.md` (the client questionnaire) lives one level up, on the Desktop. Backups are in `D:\sms-backups` (the same laptop).

**SQL Server `.\SQLEXPRESS`** (mixed auth, static TCP port 14330). Databases that matter:

| DB | What | Rule |
|---|---|---|
| `DATA_TP1U2` | IFL July sample (22 Jun - 10 Jul 2026) | **Read only. Never write, not even indexes.** |
| `DATA_TP1U2_SEP07` | IFL September sample (5 Aug - 7 Sep 2026; tables rebuilt on 5 Aug with ids reset and `MaterialId` added) | Read only |
| `PDAS_TP1U2`, `PDAS_TP1U2_SEP07` | IFL product catalogue copies | Local PDAS write tests go to `_SEP07` **only**: back up first, restore after |
| `DATA_TP1U2_SIM` | Plant simulator output | The only DB the simulator may write to |
| `sms` | SMS's own sidecar (`sms.*`, `sms_raw.*`) | Read and write; it holds real data plus simulator epochs 13-16 |
| `sms_audit` | **Read-only** copy of `sms`, used by every audit and verification harness | Use this for checks; it makes the live DB unreachable |
| `sms_real` | 336 MB, purpose documented nowhere | Ask before touching |
| `SMS_DEMO`, `DATA_DEMO_SIM`, `PDAS_DEMO` | For the user-guide demo (`docs/guide/demo/`) | Leave alone |
| `BaleDisplayDb*`, `LMSdb*`, `db_SCADA*`, `BDS_*` | **Other projects of the owner.** Not SMS. | Never touch |

**`sms/.env` right now** (non-secret values; never print or commit the secret ones):
- `IFL_DB_NAME_DATA=DATA_TP1U2_SIM`: the worker reads the **simulator**. Setting it back to `DATA_TP1U2` is the same one-line change as the real cutover.
- `IFL_DB_NAME_PDAS=PDAS_TP1U2_SEP07`.
- `PDAS_WRITE_ENABLED=true` and `PDAS_WRITE_DATABASE=PDAS_TP1U2_SEP07`: writes are on **locally only**, against the copy. The plant path is off.
- `LIVE_ALLOW_AS_OF=true` (the `?at=` replay) and `LIVE_ALLOW_SIMULATOR=true`. Both are **dev only and must be false at IFL**.
- `API_PORT=4000`, `CACHE_TTL_SECONDS=5`.
- `sms/.env.example` documents every key.

**Build, run and test** (from `sms/`; Windows PowerShell 5.1 has no `&&`, so run the commands one at a time or use Git Bash):
```bash
npm run build
```
```bash
node api/dist/index.js
```
- The API serves the old UI at `/` and the new UI at `/next` (`WEB_NEXT_DIST`, defaulting to `web-next/dist` relative to the working directory). **Start it from `sms/`**, or `/next` is not found.
- Sync worker: `node sync-worker/dist/index.js`. Simulator: `node scripts/simulate-plant.mjs --live` (also `--check`, `--days=N`, `--reset`; it refuses any DB not ending in `_SIM`).
- CLI: `node cli/dist/index.js verify | summary | sync | rebuild | epoch:accept | epoch:backfill | user:create | retention`. **Never run `rebuild`, `cutover` or `retention` against `sms` casually.** A demo script did that on 2 Oct and emptied the database (`handover/INCIDENT-2026-10-02.md`).
- Gate: `npm run typecheck`, `npx vitest run` (run it twice; there is a rare known flake, D-7), `npm run test:layout:next` (Playwright for the new UI) and `npm run test:layout` (old UI).
- The old-UI dev server is Vite on :5173, proxying `/api` to :4000.

**Accounts on the dev `sms` DB** (read from `sms.app_user` on 28 Oct): `admin` (admin), `super` (engineer) and `floor` (viewer) are active. `curltest_eng`, `phase2bdemo` and `verify_live_fix` were created by agents and are already deactivated. **`overview_test` (manager) is active and documented nowhere**, probably another agent-made account; ask the owner whether to deactivate it (`UPDATE sms.app_user SET active = 0`, never delete). The passwords are the owner's; ask, and do not write them into any file. Ranks are 1 viewer, 2 engineer, 3 manager, 4 admin. For browser checks without a password, the verification harness uses an in-process **render token** (see the `S/...` harness scripts referenced in `design/redesign-2026-10/VERIFY-*.md`). Those scripts live in old session scratchpads and are **not in the repo**, so a new account will have to recreate a harness if needed.

**SQL from the shell:** `sqlcmd -S tcp:localhost,14330 -E -W -Q "..."`. Read-only `SELECT`s only, unless the owner approves otherwise.

---

## 5. Data facts that trip everyone up
- **The 18-minute lag.** IFL writes a cone's row 15-34 minutes after it is weighed. The app never sees the present. Never compare a production time with "now" without the measured lag (`api/src/services/live.ts`).
- **Two clocks.** Production timestamps are the plant's wall clock labelled UTC; app-written instants are real UTC, 5 hours apart (`plantClock.ts`).
- **Event time is `ProductionDate`, not `Date`.** The stored `Shift` column is wrong; recompute it from production time. Shifts are 06/14/22; the production day runs 06:00-06:00.
- **Use the `*_TP1U2` wide tables only, never the EAV tables.** The row key is `id`, never `SackNum` or `reference_value`.
- **Source generations ("epochs")**: July is 1-4, September 9-12, the simulator 13-16. The worker halts on an unknown generation, and `sms epoch:accept` registers one, never automatically.
- **Product.** PDAS is a catalogue only. A winder's product is chosen on its panel or PLC and stamped as `MaterialId` on every cone (since 5 Aug). SMS **observes** product changes from the cone stamps and **cannot switch a winder**. July rows have no product.
- **Limits are time-versioned.** A reading is judged by the limits in force at its own time.
- **Rejects.** Every weight reject also appears as a cone row in IFL's real data, so avoid double counting (`getUnmatchedRejects`). There are two figures: "Failed inspection" (inspection only, 6,048 for 5 Aug-7 Sep) and "Failed inspection or weight check" (combined, 6,089). The scale-flagged count for that period is 53.
- **Retire-and-recreate cannot change a setpoint.** `CreateMaterial` refuses a duplicate blend/count/tube. A limits change is the guarded single-row `UPDATE dbo.Materials`.
- **Sacks have no machine and no production timestamp.** Their times are insert times.
- **Sack ↔ cone link.** There is no key. Cones between consecutive sacks range from 0 to 250, so never present that list as a packing list.

---

## 6. How the owner wants Claude to work (carry these over; they came from real incidents)
1. **The owner decides; explain options plainly first.** Lead with what each option does and costs, then give a recommendation. When the owner delegates, decide, say why in one line, and proceed.
2. **Never do these without the owner:** push; create any account or SQL login, even to verify your own work (three appeared unasked on 16 Sep); send anything to IFL; delete data; change `.env` comments; write to `DATA_TP1U2`.
3. **Orchestrator style.** For big tasks the owner often opens with an "ORCHESTRATOR" prompt: Opus plans via a planner sub-agent, Sonnet workers do all hands-on work, results are reviewed against acceptance criteria, then a short report. The owner said *"dont set anything without me giving you a plan to follow"*: do not pick models or launch waves without a plan they have seen.
4. **Hard cap: 12 sub-agents at once**, including inside workflows. Fewer, larger, well-specified tasks are better, because the owner reviews every diff.
5. **Show a design before building UI.** The owner reacted badly twice to things first seen after they were built.
6. **Verify by rendering and measuring, not by reading code.** Report honestly what was **not** verified. Every "done" so far is on the dev PC only: no plant, no real printer, no Excel opened by a person, no signed-in viewer or engineer, no physical TV.
7. **Name which part failed.** A screen fed by several fetches must say which part is missing, never collapse to one blanket error, and never print a zero it doesn't have.
8. **One audience.** Never tier read access by role; roles govern writes only. Every screen must trace to a line of IFL's requirements.
9. **The roadmap is the requirement** (`IFL_SMS_Claude_Code_Development_Roadmap.md`). Differences from it are questions for IFL, not the roadmap being wrong.
10. **Documentation convention.** Keep docs current. Correct stale statements **dated, in place, keeping the old text** ("superseded-not-deleted"). Every capability claim must be greppable in code or tied to a recorded run. Update `PROJECT_STATUS.md` and `DEFECTS.md` (the living defect register; the redesign is Part 19) when work lands.
11. **Commits.** Use path-limited commits with clear messages, one item per commit. When staging hunks from shared files, use full-context hunks and parse-check before committing (a `-U0` apply once broke `words.ts`).
12. **Long tasks.** The owner asks "how much longer?", so give time estimates and progress lines. When a session is interrupted they say "continue", so pick up from the last committed state.

---

## 7. Document map

| Need | File |
|---|---|
| Project rules and dated history | `CLAUDE.md` |
| IFL's source data model | `SCHEMA.md` |
| Living status and owner/IFL asks | `PROJECT_STATUS.md` (§4-§5) |
| Defects | `DEFECTS.md` (Part 19 is the redesign; Part 15 is the data-trust audit) |
| Owner decisions pending | `DECISIONS-PENDING.md` (§14, §15) |
| Questions for IFL (unsent) | `IFL-OPEN-QUESTIONS.md`; the shareable version is `../QUESTIONS.md` |
| IFL's 15 Sep answers | `handover/IFL-ANSWERS-2026-09-15.md` |
| KPI definitions | `KPI-DEFINITIONS.md` |
| Redesign contract and evidence | `design/redesign-2026-10/` (`APPROVAL.md`, `DESIGN-SYSTEM.md`, `GLOSSARY.md`, `IA-MAP.md`, `TRACE.md`, `VERIFY-*.md`) |
| PDAS write path | `HANDOVER-PDAS.md`, `handover/PDAS-E2E-RESULTS-2026-09-28.md`, `handover/PDAS-WRITE-GRANT-2026-09-19.md` |
| QA / break-it sessions | `HANDOVER-QA.md` |
| Deploy and operations | `sms/DEPLOY.md`, `handover/ADMIN-DEPLOY-MANUAL.md`, `handover/OPERATOR-MANUAL.md`, `handover/FAT-PROTOCOL.md` |
| Performance | `PERFORMANCE-2026-10-12.md` |
| Architecture (frozen contract) | `ARCHITECTURE.md`, `SPEC.md` |

---

## 8. Moving accounts — practical notes
- **Memory.** Claude Code's memory for this project lives at `C:\Users\ABDULLAH SAJID\.claude\projects\C--Users-ABDULLAH-SAJID-Desktop-sag-database\memory\` (20 notes). It is local to this Windows user, so it may or may not follow a new account. §5 and §6 above carry everything important from it. If the new account doesn't see it, copy that folder or re-save the rules from §6.
- **Past chats** are in the same folder as `*.jsonl` transcripts. The SMS ones are "Orchestrator workflow setup" (13-15 Oct, the redesign build and the pre-switch checks), "Usability and design survey" (13 Oct), "Product information template" (7 Oct, a marketing write-up; the owner chose the mockup option) and "Sagpacking project audit" (24 Sep).
- **Databases are not in git** and must never be. On the same machine, nothing needs moving. On a new machine, attach copies from the original archives (see `DEPLOY.md` and `INSTALLATION-FIRST-HOUR.md`) and recreate the SQL logins. The owner does that, not an agent.
- **First message for the new session:** "Read HANDOVER.md, then ask me the open switch-over decision."

---

## 9. What is not on GitHub (checked 28 Oct 2026, after `git fetch`)

- **Commits:** `floor-first-rework` has **262 commits that exist only on this laptop** (everything after `f829d30`, 2 Oct, including this handover commit). That is the whole CSS recovery, Stage 3, the performance pass and the web-next redesign. Every other local branch is already contained in origin. The tag `v0.1.0-baseline` is on origin, and there is no stash. Fix: `git push origin floor-first-rework`, which is the owner's step.
- **Remote-only:** `origin/claude/stoic-thompson-8e1775` holds 1 commit not in HEAD (the caveman skill, from a cloud session). It is harmless and can be ignored.
- **Committed with this handover:** `HANDOVER.md`, the 23 Sep addendum to `VERIFICATION-2026-09-23.md` (I-1 re-verified), and the user-guide proof screenshots in `docs/guide/capture/proof/`.
- **Still untracked, waiting for the owner's call:**
  - `proposal/IFL-SMS-2026-09/`: the commercial and technical offer (QTS-IFL-4771 docx/pdf, BOQ and site-survey xlsx, the build scripts in `src/`, rendered pages). It holds pricing, so commit it only if the repo is private. Leave out the Word lock files `out/~$*.docx`.
  - `drafts/IFL-email-2026-10-02-eight-reports.md`: an unsent draft to IFL that names their staff and email addresses.
  - `handover/AUDIT-DECISIONS-AND-DEFECTS-2026-10-02.docx`: the audit decisions document for the owner.
  - Scratch files to delete rather than commit: `bar375_top.png`, `zeroed_768.png`, `scratch-serve.log`, a 0-byte root `simulate-plant.mjs` (the real one is `sms/scripts/simulate-plant.mjs`), and `.claude/worktrees/` (two merged agent worktrees).
- **Correctly ignored, and must never go to GitHub:** `sms/.env` and its backups (`.env.backup-before-sim`, `.env.bak-20260924`, `.env.e2e-writer`), `docs/guide/demo/*.env`, the `.auth/` folders, IFL's databases and archives (`extracted/`, `extracted-sps-2026-09-07/`, `schema_dump/`, `*.mdf`, `*.ldf`, `*.rar`), logs, and build output. **A new machine needs `sms/.env` and the database files copied by hand** (on an encrypted drive).
