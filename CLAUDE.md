# CLAUDE.md — IFL Sack Management System (SMS)

## Project purpose

Build a **Sack Management System** web application for **Ibrahim Fibres Limited (IFL)**, reporting on sack and cone production from the TP1 Line 3 / Unit 2 yarn spinning line. Styled and architected to match our existing **Energy Management System (EMS)** app.

The plant runs Siemens S7-1500 PLCs that weigh every cone and every sack; readings land in SQL Server via a tag-acquisition layer. SMS surfaces that data as dashboards, reports, and (pending scope confirmation) CRUD screens.

**Primary source of truth for the data model: [`SCHEMA.md`](SCHEMA.md).** Read it before writing any query.

**Client-facing questionnaire: [`QUESTIONS.md`](../QUESTIONS.md)** — the 22 questions sent to IFL, written in plain language. *(Currently located at `Desktop/QUESTIONS.md`, one level above the project root.)* `SCHEMA.md` §4 holds the same items as technical open questions (OQ-1 … OQ-15); `QUESTIONS.md` is the shareable version. Keep the two in sync as answers arrive.

**Phase 1 scope and design: [`SPEC.md`](SPEC.md).**

**Phase 2 architecture — [`ARCHITECTURE.md`](ARCHITECTURE.md) — FROZEN BUILD CONTRACT (23 Jul 2026).** Raw→canonical layers, transform versioning, time-versioned attribution, reference-data tables, CDC-safe watermark (overlap window + schema fingerprint), DQ+Operations with severity, generalized+metadata API, CLI verify tool, retention/backup policy. Further architecture changes come from running-code evidence only. Build order: Models→Reader→Transform→CLI→Operations→API→**Dashboard (demo, step 7)**→analyses→Auth→Admin→Hardening.

## Current phase

**Resuming after a break? Start with [`HANDOVER-2026-09-15.md`](HANDOVER-2026-09-15.md)** — repo state, the dirty working tree, phase board, IFL's 15 Sep answers, and what to do next, verified against the running repo.

### Roadmap execution — the IFL requirement (from 14 Sep 2026)

`IFL_SMS_Claude_Code_Development_Roadmap.md` is **the requirement** from IFL's
quotation document, not a proposal to be argued with: existing code is credit
toward it, and where the code differs the difference is a clarification to
confirm with IFL, never a reason to call the roadmap wrong. Three files carry
its execution and must be kept true:

- **`PROJECT_STATUS.md`** — roadmap rule 15 (completed / in progress /
  blocked / IFL dependency / test status). Update it at the end of every wave
  or phase; never mark a phase complete without it (rule 14).
- **`BASELINE.md`** — the frozen Phase 0 picture at tag `v0.1.0-baseline`
  (`a585302`); not updated.
- **`ROADMAP-GAP-ANALYSIS.md`** — verified per-phase gap analysis, the wave
  plan (§15), the defect register (§17) and the IFL clarifications (§18).

Day 0 and Wave A are done (`92df608`, `478c456`, `a473d4d` + the docs/CI
commit). Wave B onward waits on IFL answers or owner decisions listed in
`PROJECT_STATUS.md` §4–§5. Rule 17: never guess past an IFL dependency.

**Phase 0 (Database Discovery) — COMPLETE.** → `SCHEMA.md`, `QUESTIONS.md`
### September 2026 — IFL's rebuilt source, and what the app does about it (11 Sep 2026)

A second sample from IFL (`SPS.rar`, 7 Sep) showed the plant **dropped and recreated its four weighing tables on 2026-08-05**, restarting every identity at 1, renaming `Source` → `MachineNo`, and adding **`MaterialId` to every row** (populated on 100 %, joins to `PDAS.Materials`, confirmed trustworthy by IFL). Three things followed, all built and verified:

1. **Source generations ("epochs").** `sms.source_epoch` names each physical generation of each source table; the worker resolves its generation before every read and **halts** on an unknown one (`sms epoch:accept` registers it — never automatic). July's 142,511 cones and September's 132,552 coexist under different epochs. The sidecar is the archive of record; IFL keeps about a month. **`sms verify` reconciles per generation to the checksum (`SUM(id)`).** Full record: `SEPT-2026-EPOCH-DECISION.md`.
2. **Product attribution is real.** `NullAttribution` is retired for rows that carry `MaterialId` (`attribution_method = 'source_column'`); older rows keep `'none'` honestly. Limits are **time-versioned** (`sms.product_limit_version`): a reading is judged by the limits in force at its own time, never by today's mirror. Up to six materials run concurrently on different machines, so the line-wide "Current Product" is now only the fallback for pre-`MaterialId` rows.
3. **The PDAS write path exists and is OFF.** Add / Retire / Change-limits, through the vendor's own procs (there is no UPDATE proc; changing a setpoint is one guarded single-row UPDATE with the vendor's own event-log row), rank ≥ 3, `PDAS_WRITE_ENABLED=false`, a **separate** writer login. It stays off until IFL confirms **in writing** that SMS may write to PDAS — the read-only rule for `DATA_TP1U2` is unchanged. Retire-and-recreate is **not** an edit: `CreateMaterial` refuses a duplicate blend/count/tube regardless of active flag (IFL's own engineer hit this four times on 18 Aug — **unverified**, 15 Sep 2026 audit finding H6: the field notes this cites are ten SSMS screenshots at `Desktop/SPS unzip/SPS/*.jpg`, and they contain no error of any kind — every executed call shown returns `@error`/`@errorMsg` = `NULL`/`NULL`. The real behaviour is to be established by an offline proof against the local `_SEP07` copy, not repeated to IFL as fact until it is).

**Still to ask IFL for:** the 10 Jul – 5 Aug data (exists, not sent); `db_datareader` on both DBs; written authority for PDAS writes; whether the PLC reads limits live.

**Phase 1 — COMPLETE (build steps 0–13 done & verified).** Full stack under `sms/`: sync-worker (IFL→raw→canonical, continuous self-healing loop) · CLI (sync/verify/summary/rebuild/user:create) · Express API (auth, RBAC, /production, /operations, /shift-analysis, /rejects, /weights, admin) · React web (Dashboard, Shift, Rejects, Weights, Admin, login, Current Product). 31 app tables after 27 migrations (27 `sms.*` + 4 `sms_raw.*`; this line used to say 25, and README said 21 — both were wrong), session-cookie auth (argon2), 266 tests in 28 files (the "17 tests" this line carried was Phase 1's count), perf 11–15ms. Deployment: `DEPLOY.md`. All four blocked client questions (Q1/Q4-5/Q7/Q10) resolved or self-answering + one admin action from applying. **Awaiting IFL answers + go-live cutover — which is repointing `IFL_DB_*` *plus* `sms epoch:accept` for the live generation; "repoint and nothing else" stopped being true on 5 Aug 2026.**

### Visual redesign applied from the design handoff (3 Sep 2026)

A second, purely visual pass, delivered by the designer as
`Sack Management System Redesign.zip` and applied in full. It changed no
route, API, query or metric, and renamed nothing. Sources kept in
`design/handoff-2026-09-03/`.

**What changed.** `web/src/app.css` was replaced by the bundle’s production
stylesheet (eleven marked edits). **Instrument Sans** variable, self-hosted at
`web/public/fonts/InstrumentSans-Variable.woff2`, replaced Archivo — one file,
weights 400-700, and the plant PC has no internet, so a Google Fonts link
would silently fall back to Segoe UI on the one machine that matters. New
display step at 56px so a shift’s output outranks the sentence describing it.
Block labels hang in a 180px left margin; rules are carried by full-bleed
bands, so a hairline reaches both bezels while text stops at 1100px. Report
gained the **verdict mark**, the one ink fill in the application. Wall was
rebuilt as a composed board: stations encode their count as bar height, the
state sentence is 79px at 1920, and the footer is pinned.

**Three defects found while applying it, and fixed:**
1. `.h2 .note` in the bundled CSS could never match a grid item, so every
   block’s note overprinted its own label. The selector was extended and the
   declarations left untouched; both changes are marked in `app.css`.
2. The same rule’s `-1.5em` then placed the note a line too high once it was a
   real grid item.
3. The register’s Export button was offered at rank 2 while the server gates it
   at 3 — a control that could only ever answer 403. `EXPORT_RANK` now matches
   `requireRole(3)`.

**Eleven of the twelve acceptance checks pass, verified in the browser.**
Skeletons were added to every block so nothing changes height as it lands
(check 9): the figure, chart and station skeletons match their real boxes
exactly — measured 90/90, 250/250 and 86/86. **Check 1, at most four of the
six type steps, is the one that cannot pass**, and it is unreachable by
arithmetic rather than by oversight: the spec’s own Line, Weight, Rejects and
Report compositions each need a headline, display figures, a qualifier, body
text, captions and axis ticks, which is all six. The one avoidable size — a
30px inline on Weight — is gone, replaced by the `.fig-val.small` class the
bundle ships for exactly that case.

**Four corrections to the bundled CSS, each marked in place in `app.css`:**
`.h2 .note` could never match a grid item, so every note overprinted its own
label; its `-1.5em` then over-corrected once the note was a real grid item;
`.skel.fig` summed the note’s font size rather than its line box, so it
under-reserved by 9px; and `.bars` reserved about 340px of fixed columns
before the bar, so “reasons as horizontal bars” rendered with no bars once the
spec’s own two-column Rejects layout put them in a half-width column.

**Two conformance fixes in the app.** The station cell now always renders
`.st-tag`, the reserved line the spec asks for so the row does not reflow as a
station goes quiet; it was rendered only WHEN quiet, which caused the reflow
the rule exists to prevent. Both trend charts now choose a tick count that
fits their width, after the narrower Rejects column made four hardcoded labels
overprint each other.

**Open question 4 is resolved as its own recommendation suggested:** the report
CSV carries attribution in the filename and in trailing rows after a blank
line, never as a comment header, which Excel shows as a mangled first row.

### UI redesign — BUILT AND LIVE (3 Sep 2026)

The floor-first rework below did not cure the interface; the owner's verdict
after a day of point fixes was "unusable". A three-agent audit plus two
adversarial critics produced **[`REDESIGN.md`](REDESIGN.md)** and a mockup;
the owner chose **Option A** and the redesign was built the same day.

**What the app is now.** One slim top bar — SMS, then Line · Readings · Weight
· Rejects · Report — one global period control, and one sentence about how old
the data is. Seven screens, each answering one question, under
`web/src/screens/`; shared pieces under `web/src/ui/`; the rules that must not
differ between screens under `web/src/lib/`. The 7,400-line `App.tsx`, the icon
rail, the section column, the "Light Steel" stylesheet, the floor and wall
screens and the three endpoints no requirement asks for (`/api/oee`,
`/api/shift-analysis`, `/api/stoppage-patterns`) are **deleted**, not unrouted.
Net: 8,058 lines added, 10,375 removed.

**Rules the code now enforces, each of which was a real defect before.** Do not
undo any of these without reading why they exist:

1. **ONE STATUS VOCABULARY.** The scale's own in-range bit is the single flag,
   named as the scale's ("Passed" / "Rejected by the scale"). The product's
   tolerance is a SECOND, separately-named fact, shown only when a product was
   in force at that reading's time — `api/src/services/productAt.ts`. The old
   app applied today's tolerance to readings weeks old and printed a difference
   that meant nothing.
2. **TWO CLOCKS, NAMED.** `api/src/services/plantClock.ts`. Production
   timestamps are the plant's wall clock labelled UTC; app-written instants
   (product timeline, rules, adjustments, sync runs) are genuine UTC. They are
   five hours apart on this plant. Never compare them unconverted.
3. **THE DETECTORS IGNORE THE PERIOD.** Station drift, the attention list and
   reject episodes run over a fixed 14 production days (`lib/period.ts`
   `trailingWindow`), because the pattern tests need consecutive DAYS and one
   shift is a single point.
4. **THE HEALTH DECISION IS SERVER-SIDE AND MEASURED.** `live.ts` reports the
   sync cadence it observes, freshness from the OLDEST source table (not the
   newest — one dead feed used to hide behind three healthy ones), and the lag
   as measured up to a day. When it is not `ok`, no screen asserts whether the
   line is running.
5. **NO OVER-CLAIMING.** No "reduce station 7 by 9 g": weighing data cannot
   tell a heavy scale from heavy cones. No product limits without a product.
   The Weight headline states the mean and the target as two facts until the
   weight basis is confirmed in Setup.
6. **ONE STATION TABLE** in the whole application, on Weight, and it shows bias
   against the line AND against the target. On live data every station sits
   within 3 g of the line and 9-12 g below target: the old "difference from the
   line" column alone would have read "Fine" on all fourteen rows.

**Still to do, in this order:** the role rename to viewer/engineer/manager/
admin; a *Product limits* rule in Setup; the per-day-per-code reason sheet;
the line-level sack ledger once IFL answers. **The five questions in
`REDESIGN.md` §11 have not been sent.**

> **Update, Sep 2026 audit fix (finding H3):** the app-owned product-details
> overlay (dropped from the list above — it is done, not pending) is now built
> as `web/src/screens/ProductSheet.tsx`, opened from Line's "Change" button and
> its "History" link — both previously dead ends: the button navigated to
> admin-only Setup, which has no product section, and the link pointed at a
> `#history` anchor that existed nowhere on the page. It is a sheet, not a
> Setup section, because Setup is gated at `rank >= 4` while setting the
> product is a `rank >= 2` action server-side; nesting it in Setup would have
> hidden it from every supervisor/manager account IFL actually uses.

### Floor-first rework (2 Sep 2026) — response to IFL's first review

IFL's reaction to the demo was **very poor**: too complicated for a
non-technical floor worker, nothing live, unclear what period any number
described, and per-sack / per-cone detail buried. All four were true in the
code, not a matter of taste: no polling anywhere in `sms/web`; Line opened on
the day *before* the newest data under a "Live picture" label with three tabs
wired to nothing; ~17 analysis sub-screens of SPC/OEE/Cpk; Records exposed
merge keys and transform versions. The response, built and verified live:

- **Floor screens for every role — `?v=now` (the landing page), `?v=sacks`,
  `?v=cones`, `?v=wall`.** Plain words (every string in
  `web/src/floor/strings.ts`, kept there so an Urdu set can be added without
  touching a screen), big type, ten-second refresh through `GET /api/live`
  (`api/src/services/live.ts`: plant clock, current shift window,
  running / stopped / idle from the same 120 s inter-cone split as downtime,
  this-shift counts, last sack / cone / reject, per-station activity). Lists
  re-read every 15 s and slide new rows in. **One time selector everywhere** —
  This shift / Today / Yesterday / Pick a day — anchored on the plant clock the
  API reports, never the browser's.
- **Wall mode** (`?v=wall`): fullscreen, no navigation, viewport-unit type for
  a TV; one card per line the API reports (one today — `LINE_NAME`). Sessions
  now renew while in use (`api/src/auth.ts`), so a display never logs itself
  out.
- **Line's section tabs are wired at last** (Latest day / Day before). They had
  changed the URL and the highlight but never the content.

### Live rehearsal and the plant simulator (2 Sep 2026)

`sms/scripts/simulate-plant.mjs` writes synthetic source readings so the app can
be exercised against data that is arriving *now*. It writes ONLY to
`DATA_TP1U2_SIM`, never to `DATA_TP1U2` — the read-only rule gets no local-copy
exemption, and the script refuses any target not ending in `_SIM` and any
non-local server. Its distributions are measured from the real 19 days, not
invented: cone gap buckets, weight mean and spread, reject rate and code Pareto,
sack intervals, station bias, and the plant's own Shift-from-insert-time bug.
Usage and setup are in `DEPLOY.md`.

**What the first rehearsal found — a defect no amount of work against the July
copy could have surfaced.** IFL's acquisition layer writes a cone's row about
**18 minutes** after the cone is weighed (909 s min, 1090 s mean, over 142,509
rows). The newest production timestamp available is therefore always ~18 minutes
old on a perfectly healthy line. The live screens compared it against the wall
clock and so reported **"Stopped 17 min" permanently**, with "cones in the last
ten minutes" structurally zero. Against weeks-old data everything read "no
readings", so nothing looked wrong.

Fixed in `api/src/services/live.ts`: the line is judged against `now - lag`,
where the lag is the median of `src_Date - src_ProductionDate` over recent raw
rows — IFL's own insert time against their own production time. Every "recent"
window is anchored on the newest reading rather than the clock, the per-hour
rate divides by the time the counts actually cover, and the screens state the
lag so "the line stopped" is distinguishable from "the reading has not arrived".
Three regression tests lock this down.

**The general lesson, worth applying to anything else time-relative:** this
software never sees the present. It sees the plant as it was one acquisition lag
ago. Any screen that compares a production timestamp to `Date.now()` is wrong
unless it accounts for that.

### ⚠️ The user base is ONE audience — corrected 2 Sep 2026

For a few hours on 2 Sep 2026 this project split the app in two, putting the
analysis screens behind the manager role, on the assumption that the audience
included non-technical floor staff. **IFL's own representative then confirmed
the software is for the GM, managers, and engineers of the process
department.** There is no second audience. The split was removed the same day.

What this means, and it governs every future UI decision here:

1. **Every screen is open to every signed-in account.** Only Setup is
   restricted (`rank >= 4` in `web/src/App.tsx`; there is no `shell.tsx` —
   that file belonged to the 2 Sep intermediate structure and was deleted in
   the 3 Sep redesign). Do not reintroduce read-access tiers.
2. **Roles remain for WRITES only** — setting the running product, logging a
   calibration adjustment, exporting the raw register, and Setup — enforced
   server-side. That is requirement 9's access control. **Create IFL's accounts
   at manager rank** so none of those gates obstruct them (see `DEPLOY.md`).
3. **"Too complicated" never meant "too advanced."** A process engineer reads a
   control chart without help. IFL's stated objection is *"overflow of useless
   information and a solution not implemented smartly."* The failure was
   density, duplication and organisation, not statistical content.
4. **No two screens may answer the same question.** The two-tier split had
   quietly produced exactly that — Now beside Line for the current state,
   Sacks/Cones beside Records for the register — because each tier grew its
   own. The rail is now seven items ordered by time window, with `sacks` and
   `cones` kept as routes only (the Now screen's tiles open their record card,
   which has no equivalent in Records).
5. **The Output/Shifts withdrawal still stands**, for the original reason and
   not the retracted one. It was never "too advanced for the reader"; it is
   that no requirement asks for OEE, and the figure is inferred from event
   timestamps rather than measured. An engineer is the reader most likely to
   ask how it was derived and least satisfied by the answer. The measured part,
   time lost and stop count, survives on the Report screen.
- **The sack ↔ cone link is approximate and says so.** The plant records no
  key from a cone to its sack, and cones between consecutive sack timestamps
  range 0–250 (measured 2 Sep 2026), not ~25. A sack's card shows "cones
  weighed between the previous sack and this one" with the caveat printed —
  never a packing list. Do not present it as one.
- **Replay, for demos and verification:** `?at=<ISO>` moves the plant clock
  (server flag `LIVE_ALLOW_AS_OF` — **false in production**, true in dev where
  the copy ends 10 Jul 2026). A replay is always bannered on screen.
- **Still open from this review:** which device the floor will use (TV, shared
  PC, phone); Urdu labels; and whether the demo ran on the July copy or live
  data (if the copy, half of "not live" was stale source data and disappears
  at cutover — the missing refresh was real and is now fixed).

### Requirement mapping and the Output/Shifts cut (2 Sep 2026)

IFL's original requirement list was read back against the build for the first
time on 2 Sep 2026. Ten lines. The mapping, and it is the reason for the cut:

| IFL asked for | State |
|---|---|
| Connectivity with PLCs, HMIs, machines, databases | SQL only; PLC path deferred on IFL's own later answer (Q22) |
| Cone weight collection, flag weights outside limits | Built |
| Screens to view and **update product details on machines** | **Built, off:** Add / Retire / Change-limits write to PDAS through the vendor's procs behind `PDAS_WRITE_ENABLED` (11 Sep 2026). Still never written to a *machine* (Q22); whether the PLC reads the values live is an open question for IFL |
| History logs and trend graphs for rejected cones | Built |
| **AI**-based analytics recommending calibration adjustments | Built as statistics (Nelson rules, station drift, ledger), not AI |
| Collection and logging of all sack data | Built |
| **Sack stock tracking per machine** | **Not built.** See the blocker below |
| Comprehensive **reporting**, analytics, graphical dashboards | Analytics and dashboards yes; **reporting missing** |
| User-friendly interface, access control, data security | Access and security built; "user-friendly" is the complaint above |
| Scalable to more machines and data points | `line_id` throughout; multi-line not built |

**Nothing in that list asks for OEE.** Not availability, performance, quality,
downtime, stoppage clustering, MTBF/MTTR, or shift-versus-shift. Output
(`?v=performance`) and Shifts (`?v=shift`), five sub-screens, answered a
question no customer posed, and they carried the charts IFL called unreadable.
They were **removed from the product** on 2 Sep 2026 and then **deleted
outright** in the 3 Sep redesign (commit `f4b941a`): the screens, their
services (`oee.ts`, `shiftAnalysis.ts`) and the routes `/api/oee`,
`/api/shift-analysis`, `/api/stoppage-patterns` are gone, and the view
parameter itself changed from `?v=` to `?s=`, so an old URL lands on Line.
Restoring them means recovering the code from git history (`git show
f4b941a^:<path>`), not flipping a switch. Three orphaned client wrappers
(`getOee`, `getShiftAnalysis`, `getStoppagePatterns` in `web/src/api.ts`)
remain and target endpoints that now 404.

The "availability below normal" finding was dropped with them, since its only
destination was Output. Time lost returns as a finding once the period report
exists. The Line ribbon still shows availability as a plain figure.

**Kept because they ARE contracted, not because the data allowed them:** the
reject trend graphs (requirement 4) and the weight control chart plus station
drift, which are the machinery under the calibration requirement (5).

**The sack-stock blocker, to raise with IFL.** `sack1_TP1U2` carries no machine
or station column — only sack number, weight, in-range and insert time. Sack
stock *per machine* is therefore not computable from the data IFL supplied, by
anyone. It needs the PLC path they deferred, or a manual entry screen on the
floor. This question has a long turnaround and blocks the largest missing
module, so it goes to IFL before the report screen is finished.

**On the AI expectation (confirmed open with IFL, 2 Sep 2026).** They are
non-technical here and simply expect AI in the product. Do not fabricate it,
and do not promise anything cloud-hosted: the plant is air-gapped by their own
hosting constraint. The honest deliverable is to extend the existing
calibration advisory from "this station is off target today" to "this station
reaches the action limit in about N days at the current drift", which is a real
prediction from real data and is defensible when challenged.

### IFL answers — decisive points (23 Jul 2026)

- **Q1:** no product data in DB; **product-wise historical reporting not required.** App adds a **Current Product** selector (Process Engineer sets it), stored in the **app-owned DB**. → `NullAttribution` default for history; `ManualEntryAttribution` forward-only. **Superseded 11 Sep 2026:** IFL's rebuilt tables carry `MaterialId` on every row; attribution is now the plant's own for those rows.
- **Q21 (HARD):** **zero modifications to IFL's DB** — no schema, indexes, tables, procs, or data. Retires the "add indexes" option. All optimisation is app-side.
- **Q22:** **no PLC integration in scope.** Component B is now indefinitely deferred; `cone_id` column stays nullable but its PLC path is dormant. Q2 redirects cone traceability to `rejectWeight1_TP1U2.[Source]` (a station, not a unique id).
- **Q12:** dispatch **not required** (confirmed out).
- **Q19 vs Q21 vs Q1 → open decision D0:** IFL says "connect directly" (Q19) but forbids DB indexes (Q21), while Q1 forces an app-owned writable DB anyway. **Recommend sidecar sync (SPEC §1 Option B).** Needs user call.
- **Still blocking:** weights gross/net + units (Q4/Q5), reject-code meanings (Q10), shift fix-vs-reproduce (Q7). Shift boundaries confirmed 06/14/22 (Q8).
- **Still pending:** single vs multi-line (Q14), hosting (Q20) — both to be settled at the upcoming textile-team meeting.

### Revised phase plan (21 July 2026)

Commissioning is split by **component**, not just by activity. Phase 1 does **not** touch the PLCs.

| Component | Phase | Status |
|---|---|---|
| **A** — Read-only sync: IFL SQL Server → local sidecar DB | **1** | Specced |
| **B** — Direct S7-1500 PLC reader for `P1_ConeID` | **2 — DEFERRED** | **Stub + disabled flag only** |
| **C** — Web app, queries local sidecar DB only | **1** | Specced |

**Phase 1 = A + C.** **Stop for user approval between every phase.**

### 🚫 Phase 1 hard constraints

1. **Do not implement Component B.** No PLC reader logic. (Q22: PLC integration is out of scope entirely.)
2. **Do not add any PLC dependency** — no `snap7`, `python-snap7`, `S7NetPlus`, or equivalent, in any manifest.
3. **Do not write to IFL's acquisition database (`DATA_TP1U2`), and do not alter it in any way** — no schema, **indexes**, tables, procs, or data (Q21, hard client constraint). Reads only. Writes (Current Product, users, notes) go to the **app-owned DB only**. **The one exception, 11 Sep 2026, is the PDAS write path** — a separate `sms_pdas_writer` login, behind `PDAS_WRITE_ENABLED`, which **ships off and stays off until IFL confirms in writing** that SMS may write to PDAS. That confirmation has not happened, so none of what follows runs against any plant database today. What the write path actually does, as of roadmap Wave F (15 Sep 2026, `sms/api/src/services/pdasWrite.ts`), is wider than "Materials plus nhs_events" — corrected here (finding H6, 15 Sep 2026 audit) into what IFL has confirmed versus what is only built:
   - **Authorised today** — the client confirmed on 2026-09-11 that these replace the hand-written SSMS `EXEC`s its engineers already run: `CreateMaterial` (create a product) and `SetMaterialStatusActive` (retire/reactivate a product).
   - **Written into the code, awaiting IFL's written authority, never executed against any plant database:** `AddBlend`, `AddCount`, `AddTubeType`, `CreatePallet`, `SetPalletStatusActive` (roadmap Phase 6 / Wave F, the rest of IFL's own "QCS ID Creation by P-DAS" SOP — `sms/api/src/services/pdasWrite.ts`); the guarded single-row `UPDATE dbo.Materials` that changes limits (the vendor supplies no UPDATE proc for this); and the `INSERT dbo.nhs_events` row written alongside it, in the vendor's own event-log format.

   That is **nine rights, not two** — every one of them across `dbo.Materials`, `dbo.Blends`, `dbo.Counts`, `dbo.TubeTypes`, `dbo.Pallets` and `dbo.nhs_events`. The two rules that bounded the old, shorter promise still bound the longer one without exception: **no new PDAS objects, no DELETE, no other table, ever.** The written-authority request to IFL must name all nine rights above — see `sms/DEPLOY.md`'s credentials table for the `sms_pdas_writer` grant they cover.
4. **Web app queries the app-owned DB** (sidecar). *Pending D0:* IFL's Q19 says "connect directly"; do not finalise the data-access path until D0 is decided.

### Phase 2 readiness — VERIFIED STATUS (audited 17 Aug 2026)

> **Read this section as a status report, not as a design intent.** Three of the
> five items below were previously written here as accomplished fact and were
> not true in the code. They were corrected only after an audit grepped for them
> and found nothing — after they had already been repeated to the customer-facing
> side of the project. **Anything in this file that claims a capability must be
> greppable in the code, or must say plainly that it is a plan.**
> Marked ✅ implemented / ⚠️ partial / ❌ designed only.

1. ✅ **IMPLEMENTED — `cone_id` column exists and is nullable** on `sms.cone_event`, alongside **`cone_id_source`** (provenance: `plc_direct` \| `sql_sync` \| null). Both null in Phase 1. Verified: `sms/db/migrations/003_cone_event.sql:36`.
2. ❌ **DESIGNED ONLY — ingestion is NOT adapter-based.** There is no `IngestionAdapter` interface anywhere in the codebase (zero hits in any `.ts`). `SPEC.md` §3 and `ARCHITECTURE.md` §10 describe an *intended* shape. In reality the runner news a concrete `IflSqlAdapter`, `transform.ts` bakes in `source_system: 'ifl_sql'`, and `persistRaw` is insert-only. Adding a second source is a refactor (~1.5 wk), not a drop-in. **Do not quote §3 as evidence of pluggability.**
3. ✅ **IMPLEMENTED — cross-source merge key** `(line_id, production_ts_utc_ms, hanger_num)` is on every row and enforced by a unique index. Verified: `UX_cone_merge` on `(line_id, production_ts_utc_ms, hanger_num, ingest_seq)`, `003_cone_event.sql:55`. See `SPEC.md` §3.2 for the DQ-2 collision caveat. *Caveat:* a `plc_direct` row arriving on an existing merge key would **violate** this index, not enrich the row — Phase 2 needs a merge-and-enrich upsert, not `UPDATE ... SET cone_id`.
4. ❌ **DESIGNED ONLY — there is no PLC stub and no test.** `PLC_READER_ENABLED` and the host/rack/slot keys appear **only** in `.env.example`; no TypeScript file reads them, nothing validates them, no stub class exists, and **no test asserts anything about them** (3 test files total: `appConfig`, `fingerprint`, `transform` — zero PLC references). What IS true, and is the only version safe to state externally: **no PLC library appears in any of the five package manifests.** That is a convention, enforced by review, not by a test. Describe this as *a documented, dependency-free re-entry point* — never as "PLC-ready" or "a stub".
5. ✅ **RESOLVED BY IFL'S DATA (11 Sep 2026).** `transform.ts` now stamps `attribution_method = 'source_column'` from the row's own `MaterialId` (132,551 of 132,552 September cones) and `'none'` only where the column did not exist (all July rows). `/api/production?product=` is live and reports the unattributed count alongside its rows so a screen can say which readings predate product recording.

### Consequence of unanswered Q1

Phase 1 shipped with `NullAttribution`. **From the September 2026 sample onward, product attribution comes from IFL's own `MaterialId`** and product-wise reporting is possible for those rows. Rows from before the column existed stay unattributed — do not fabricate attribution for them.

## Working rules (apply to the whole project)

1. **Never hardcode credentials.** Connection details come from environment variables only, loaded from `.env`. `.env` is in `.gitignore`; commit a `.env.example` with placeholder values.
2. **Treat the client DB as production data.** Default to **read-only** queries. Do not issue `INSERT`/`UPDATE`/`DELETE`/`CREATE`/`ALTER` — including adding indexes — without explicit user approval. (See OQ-14 and SCHEMA.md §5.9.)
3. **Parameterised queries only.** No string-concatenated SQL, ever.
4. **Ask before adding any dependency** or making an architectural decision not already agreed.
5. **Keep docs current.** Update `CLAUDE.md` and `SCHEMA.md` whenever a decision is made or understanding changes. Record answered open questions in `SCHEMA.md` (mark them RESOLVED with the answer and date) rather than deleting them.
6. **Flag ambiguity, don't guess.** If a column's meaning, unit, or semantics is unclear, add it to the open-questions list.
7. **Validate all inputs**; handle loading and error states in every UI slice.
8. After each vertical slice: **run it**, tell the user how to verify it, and commit with a clear message.

## Database

Two SQL Server databases, delivered as a detached `DATA` folder inside `SPS.adding` (a RAR archive despite the extension).

| DB | Role |
|---|---|
| `DATA_TP1U2` | PLC acquisition — sack/cone weights, rejects. **The main SMS source.** |
| `PDAS_TP1U2` | Product master (blends, counts, tube types, materials, pallets) + vendor label module. |

**Local analysis instance:** attached to `.\SQLEXPRESS` as `DATA_TP1U2` and `PDAS_TP1U2`.
**Production instance:** not yet known — see OQ-12.

### Connection approach

```
# .env  (never committed)
DB_SERVER=<plant-server>\<instance>
DB_NAME_DATA=DATA_TP1U2
DB_NAME_PDAS=PDAS_TP1U2
DB_USER=<read-only login>
DB_PASSWORD=<secret>
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true   # plant-local server, self-signed cert
```

Request a **dedicated read-only SQL login** from IFL — do not use `sa` or the vendor app's account.

### Non-negotiable query rules (from SCHEMA.md)

- Query the **`*_TP1U2` wide tables** (`sack1_TP1U2`, `pack1_TP1U2`, `rejectQCS1_TP1U2`, `rejectWeight1_TP1U2`). **Never** the raw EAV tables (`sack1`, `pack1`, …) — 6× the rows, zero extra information.
- Event time for cone/reject data is **`ProductionDate`**, not `Date`. `Date` is insert time and lags by ~3.8 h on average.
- The stored `Shift` column is derived from insert time and is therefore **wrong for many rows**. Recompute from `ProductionDate` (pending OQ-4).
- Row key is **`id`**. Never `SackNum` (resets to 0) or `reference_value` (collides; 8.4 % of groups).
- Filter vendor seed data: `Materials.MaterialId > 10`, `Pallets.PalletId > 10`.
- Cast `Counts.Count` (nvarchar) to int before ordering.
- Exclude/flag outliers in aggregates: sacks < 40 kg, cones < 1500 g.

### Known constraints

- **`DATA_TP1U2` has no foreign keys** and no views or stored procedures — only triggers.
- **The two databases cannot be joined** — there is no product/lot key on the weighing data (OQ-1, blocking).
- **No dispatch data exists** anywhere (OQ-15). If dispatch is in scope it is a new module.
- Wide tables have only a clustered PK on `id`; date-range queries will scan. Index additions need client approval.
- Two samples, two source generations: **19 production days** (2026-06-22 → 2026-07-10, July sample) and **34 days** (2026-08-05 → 2026-09-07, September sample), with the month between them not yet sent by IFL. Two further
  dates appear in the raw data and are excluded as clock faults: 1969-12-31 and
  2026-06-21, holding 1 and 2 readings.

## Security

- **Do not reuse `DATA_TP1U2.Users`.** It holds 3 accounts with **plaintext passwords equal to the usernames** and no role column. Build fresh auth with hashed passwords (see OQ-8 re: AD/SSO vs app-local).
- Deployment target is the **plant intranet, no cloud dependency** — but still hash passwords, use parameterised queries, and scope the DB login to read-only.

## Tech stack — DECIDED (23 Jul 2026)

**React + Node + TypeScript, end to end.** Chosen for a **solo developer**: one language across frontend, API, and sync worker; shared types; minimal moving parts. EMS uses a different stack — we are deliberately *not* mirroring it (the brief's "mirror EMS" is superseded here; UI/UX freedom was the explicit goal).

| Decision | Choice | Notes |
|---|---|---|
| **D0** data access | **Sidecar sync** (SPEC §1 Option B) | App-owned DB required anyway (Q1). **Deployment plan (confirmed by user):** develop against the supplied copy, then integrate on IFL's live DB — under sidecar this is just **repointing the sync worker's source connection string** (copy → live); API/UI unchanged. Read-only, no load or index needs on the live server (honours Q21). |
| **D1** app/sidecar DB engine | **SQL Server Express** | Already on the plant PC; same driver as source; free. |
| **D2** stack | **React + Node + TypeScript** | Frontend: React + TypeScript. Backend API + Component A sync worker: Node + TypeScript. |
| **D3** sync cadence | 60 s incremental on `MAX(id)` watermark | Per table. |
| **D4** backfill | One-off full-history load, then incremental | |
| **D5** auth | Session cookies (not JWT) | Single-server intranet. AD vs app-local pending Q18. |

**Provisional library choices (ask before adding anything beyond these):**
- SQL Server driver: `mssql` (Tedious under the hood) — used by both the API and the sync worker.
- Sync worker supervised as a Windows Service via **NSSM** or `node-windows` (boots with machine, restarts on crash).
- Frontend build: Vite. API framework: TBD at first slice (Express vs Fastify) — will propose, not assume.

Target environment: SQL Server on the plant LAN, app on a local industrial PC/server, no cloud dependency.

Record further decisions here as they are made.

## Conventions

To be established in Phase 2 (naming, folder structure, error handling, commit message style). Mirror EMS patterns where they exist.

## Repository layout (current)

```
SPS.adding              # original client archive (RAR) — do not commit
extracted/              # unpacked MDF/LDF files — do not commit
schema_dump/            # raw introspection output — do not commit
introspect.sql          # metadata introspection script
dq.sql, dq2.sql         # data-quality profiling scripts
SCHEMA.md               # ← data model source of truth (IFL's DB)
SPEC.md                 # ← Phase 1 scope, sidecar schema, interfaces
CLAUDE.md               # ← this file
../QUESTIONS.md         # ← client questionnaire (moved to Desktop)
```

`.gitignore` must exclude `.env`, `SPS.adding`, `extracted/`, `schema_dump/`, and any `*.mdf` / `*.ldf`.
