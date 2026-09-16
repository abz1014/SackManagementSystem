# SMS Information Architecture — proposal

**Phase 2a of the UX programme. A proposal, not a build.** No file under `sms/` was
written, edited or deleted in producing this. No code, no wireframes, no visual design.
The owner approves the tree before anything is built.

Repo: `C:/Users/ABDULLAH SAJID/Desktop/sag database`. Branch `floor-first-rework`,
HEAD `16bc219`.

Inputs: [`EXPOSURE-MATRIX.md`](EXPOSURE-MATRIX.md) (94 capabilities, an Action verb on
each), [`FRONTEND-INVENTORY.md`](FRONTEND-INVENTORY.md) (9 routed views, 6 drill-downs,
10 context-preservation failures), [`BACKEND-INVENTORY.md`](BACKEND-INVENTORY.md),
`CLAUDE.md`, `REDESIGN.md`.

Every claim about what exists today cites `path:line` under `sms/`, or the matrix.

---

## Contents

- [0. The answer in one page](#0-the-answer-in-one-page)
- [1. Today's tree, as a user meets it](#1-todays-tree-as-a-user-meets-it)
- [2. The owner's tree, mapped to what exists](#2-the-owners-tree-mapped-to-what-exists)
- [3. The recommended tree](#3-the-recommended-tree)
- [4. Where I depart from the owner's tree, and why](#4-where-i-depart-from-the-owners-tree-and-why)
- [5. Report types: navigation, chips, or both](#5-report-types-navigation-chips-or-both)
- [6. The guided-navigation map](#6-the-guided-navigation-map)
- [7. Context to preserve across every transition](#7-context-to-preserve-across-every-transition)
- [8. Migration impact](#8-migration-impact)
- [9. What I would NOT do](#9-what-i-would-not-do)
- [10. What this proposal cannot settle](#10-what-this-proposal-cannot-settle)

---

## 0. The answer in one page

**The tension, stated honestly.** The owner proposes six groups and roughly twenty-four
leaves. Today there are six words in one bar (`ui/Bar.tsx:31`) plus three views reachable
by exactly one control each (`App.tsx:64`). That flatness was not laziness: on 3 September
2026 about seventeen analysis sub-screens were deleted because IFL's verdict on the
previous build was *"overflow of useless information and a solution not implemented
smartly"* (`REDESIGN.md` §1, §9). Two rules came out of it and are in `CLAUDE.md`: **no two
screens may answer the same question**, and **one audience** — never tier by role.

**Both sides of the tension are right about something, and each is wrong about the other's
half.**

- The owner is right that the product buries its own work. Phase 1 measured it: 92 built →
  85 routed → 71 rendered → **64 discoverable**, and 24 capabilities reach no user by any
  route they would find (matrix §2, §4).
- But the owner's remedy misdiagnoses where the burial happens. Count where the 24 live:
  **eleven of them are in the product / limits / PDAS / changeover cluster**, behind one
  chain — Line's "Change" button (`screens/Line.tsx:437`) or its "History" note-link
  (`screens/Line.tsx:165`) → `ProductSheet` → a `<Details>` disclosure
  (`screens/ProductSheet.tsx:265`) → the forms (matrix §1.6). **Six more are in
  operations / data integrity**, behind one sentence in the status strip that happens to be
  a `<button className="strip-link">` (`ui/Bar.tsx:254-260`). Almost none of them are
  report types.
- Meanwhile five of the owner's proposed Production leaves — Daily, Shift, Product,
  Machine/Station, Product by Machine — **are already on screen, all ten of them, every
  time a reader opens Report** (`screens/Report.tsx:128-136`). They are not buried. They
  are *unaddressable*: the selected type is component state (`screens/Report.tsx:53`) and
  the filters with it (`screens/Report.tsx:54`), so a pasted link always lands on `daily`,
  unfiltered. That is a URL defect, and a parallel worker is already fixing it. **Promoting
  them to navigation would spend five of twenty-four leaves re-answering one question** —
  the exact thing the duplication rule forbids, and the exact shape of the sub-tab row the
  redesign deleted (`REDESIGN.md` §9).

**So the recommendation is neither the owner's tree nor the status quo.** It is **one new
primary destination, one renamed secondary one, and addressable sub-state everywhere
else**:

```
Bar (primary, 7):   Line · Readings · Weight · Rejects · Sacks · Product · Report
Always-visible (4): Wall · System · Setup (admin) · Account
```

**Product** is new and is the change that matters most: it converts the single most-buried
cluster in the application — and IFL's own stated top requirement, per-machine changeover
per shift — from a disclosure inside a sheet inside a button into a destination with a
word in the bar. **System** is today's Health screen (`?s=health`, `App.tsx:326`) given a
name and a second entry point, and it absorbs the operations/data-integrity six.

That is **+1 primary item and +0 routes that break**. Everything else the owner wants is
served by making existing sub-state addressable and by wiring seventeen cross-screen hops
that do not exist today.

**Numbers.** Of the 94 capabilities, 29 carry an Action other than None (4 Expose, 6 Route,
10 Surface, 9 Decide) plus 2 Build = **31 items needing a decision. 25 get a home below.
6 are declared homeless** — every one of them by an explicit *delete* or *leave as it is*
decision, none by oversight.

---

## 1. Today's tree, as a user meets it

The router is `web/src/App.tsx`; the route is `?s=` (`App.tsx:80-97`), the nav bar is
`web/src/ui/Bar.tsx`. Nine views are valid (`App.tsx:64`); six of them are buttons
(`Bar.tsx:31`, rendered `Bar.tsx:301-311`).

```
Top bar ─ always visible once signed in
  SMS                                          (brand, not a link)
  Line │ Readings │ Weight │ Rejects │ Sacks │ Report      ← the whole primary tree
  [ This shift ▾ ]                             (one global period control)
  [ Wall ]                                     (Bar.tsx:317-319)
  [ ⚙ ]                                        (Bar.tsx:320-324 — admins only, rank ≥ 4)
  [ AB ▾ ]                                     (initials; Text size · Change password · Sign out)

Health strip ─ second row, every screen
  ● Line 3 · plant clock 14:07      Readings to 13:49 · about 18 min … details
                                    └──── the ONLY route to ?s=health (Bar.tsx:254-260)

Drill-downs (?sheet=kind:id, over the current screen, Esc closes)
  Line     → station · product · cone/sack
  Weight   → station
  Rejects  → reason
  Sacks    → stock · cone/sack
  Readings → cone/sack/reject
```

| Item | Route | How a user finds it | Discoverability |
|---|---|---|---|
| **Line** | `?s=line` (default) | Landing page, first in the bar | **Good.** |
| **Readings** | `?s=readings` | Bar | **Good.** |
| **Weight** | `?s=weight` | Bar | **Good.** |
| **Rejects** | `?s=rejects` | Bar | **Good.** |
| **Sacks** | `?s=sacks` | Bar | **Good.** |
| **Report** | `?s=report` | Bar | **Good as a screen. Poor inside it:** ten report types render as one wrapping row of undifferentiated chips (`Report.tsx:128-136`), and the tenth — `machine-product`, added for IFL's stated priority — is the tenth chip a reader scans (matrix §1.8). No type has a URL. |
| **Wall** | `?s=wall` | One plain button at the right of the bar (`Bar.tsx:317-319`) | **Adequate.** One control, findable, and the kiosk shortcut is documented (`DEPLOY.md:79,83-84`). |
| **Setup** | `?s=setup` | The gear, admins only (`Bar.tsx:320-324`; screen gated `App.tsx:314-322`) | **Adequate for admins.** Nine sections stacked with no sub-navigation and no anchors (`screens/Setup.tsx:53-61`), so "Setup › People" cannot be linked. |
| **Health** | `?s=health` | Clicking the lag sentence in the strip — the single entry (`Bar.tsx:254-260` → `App.tsx:233`) | **Poor.** Open to every account (`App.tsx:326`), rank-1 data, and the only way in is noticing that one status sentence is a button. No word anywhere names the destination. Matrix: **Surface** ×2. |
| **Product** | *(no route)* | The "Change" button on Line, rank ≥ 2 only (`Line.tsx:437`), or the "History" link rendered as a block *note* (`Line.tsx:165`) — both open the same sheet | **Bad.** Everything about products, limits, the PDAS write path and the changeover reference data sits two to four levels below a button labelled only "Change" (matrix §1.6). |
| **Changeover** | *(no client code at all)* | Nothing | **Absent.** `GET /api/changeover/refs`, `POST /api/changeover/plan`, `POST /api/changeover/execute` exist and are tested (`api/src/routes/changeover.ts:121,150,161`); `web/src` contains no wrapper, no screen, no button (`FRONTEND-INVENTORY.md` §4.1). IFL's named top requirement. |
| **Account** | *(no route)* | Initials avatar → menu (`Bar.tsx:170-198`) | **Adequate**, and conventional. |

**The shape of the failure, in one sentence:** the six bar items are all discoverable and
all fine; everything that is not discoverable is either *inside* one of them with no
address, or hanging off a single unlabelled control.

---

## 2. The owner's tree, mapped to what exists

Every leaf of the proposed tree, what it corresponds to in the code today, and whether
promoting it to navigation would put a second screen on a question something already
answers.

| Proposed leaf | What it is today | Duplicates an existing answer? |
|---|---|---|
| **Dashboard › Overview** | The **Line** screen, `?s=line`, the default view. Question: *"Is the line running, what has it made this period, and does anything need attention?"* (`lib/words.ts:54`) | **Yes, exactly.** A "Dashboard" parent holding one leaf that is the landing page adds a node and no information. |
| **Production › Daily** | Report type `daily` — `screens/report/Daily.tsx`, `GET /api/reports/daily` rank 1 (matrix §1.8) | **Yes.** Same question as Report, same period control, same export, same print header. |
| **Production › Shift** | Report type `shift` — `screens/report/Shift.tsx` | **Yes.** Same, plus Report already carries a Shift *filter* for four other types (`report/model.ts:16-30`), so "Shift" would be both a nav item and a filter value. |
| **Production › Product** | Report type `product` — `screens/report/Product.tsx` | **Yes**, and it collides by name with the owner's own *Master Data › Products*. |
| **Production › Machine/Station** | Report type `station` — `screens/report/Station.tsx` | **Yes**, and worse: it would be the third place a station is ranked, after Weight's station table (`screens/Weight.tsx:263`) and the station sheet. `CLAUDE.md` rule 6 permits **one** station table in the application. |
| **Production › Product by Machine** | Report type `machine-product` — `screens/report/MachineProduct.tsx`, `services/machineProducts.ts:127`. IFL's answer to "sack stock per machine" | **Yes as a screen** — but this is the one leaf whose *intent* I accept. It is IFL's priority rendered as chip ten of ten. It gets a prominent deep link, not a nav item (§5). |
| **Quality › Cone Weight** | The **Weight** screen, `?s=weight` (`lib/words.ts:56`) | **Yes.** Already in the bar. |
| **Quality › Rejects** | The **Rejects** screen, `?s=rejects` (`lib/words.ts:57`) | **Yes.** Already in the bar. |
| **Quality › Calibration** | Two things, neither a screen: the **station sheet's** adjustment ledger and drift projection (`screens/StationSheet.tsx`, `GET /api/calibration/adjustments` `app.ts:1113`), and report type `calibration` (`screens/report/Calibration.tsx`) | **Yes, twice.** A Calibration screen would be a second station ranking (rule 6) and a second calibration report. |
| **Sacks › Sack Production** | The **Sacks** screen's summary block (`screens/Sacks.tsx`, `GET /api/sacks/summary` `routes/sacks.ts:79`) | **Yes.** Already in the bar. |
| **Sacks › Stock Ledger** | The same screen's ledger block (`Sacks.tsx:66`, `GET /api/sacks/stock` `routes/sacks.ts:93`) | **Yes.** Splitting one screen's two blocks into two leaves re-creates the Sacks/Cones/Records triplication the redesign deleted (`REDESIGN.md` §9). |
| **Sacks › Pallets** | **A capability with no UI.** `services/pallets.ts:47,76` is read only inside `GET /api/changeover/refs` (`routes/changeover.ts:121`); create/retire exist only as steps inside `POST /api/changeover/execute` (matrix §1.6, Actions **Expose** and **Route**) | **No duplication — but the wrong parent.** Pallets are PDAS reference data consumed by a changeover. `sack1_TP1U2` carries no pallet column any more than it carries a machine column (matrix §1.5). Under Sacks it would imply a link the data does not have. |
| **Master Data › Products** | `ProductSheet`'s product list and `PdasProducts` block (`ProductSheet.tsx:52`, `:265`), `GET /api/products` rank 1 | **No.** This is real, buried, and needs a home. |
| **Master Data › Product Limits** | `product/ProductLimitsBlock.tsx`, rendered in two buried places — inside the sheet (`ProductSheet.tsx:141`) and inside admin-only Setup › Rules (`setup/RulesBlock.tsx:61`) — plus limit history `GET /api/products/limits/history` (`routes/cone.ts:46`), matrix §1.6 **Surface** ×2 | **No.** Real, buried, needs a home. |
| **Master Data › Changeover** | **Nothing in the client.** Three routes, a full service with dry run, blockers, warnings and `NO_ROLLBACK`, zero client representation (`routes/changeover.ts`, `FRONTEND-INVENTORY.md` §4.1) | **No.** The largest built-vs-shipped gap in the product. |
| **Reports › Production Reports** | A grouping that does not exist. Types `daily`, `shift`, `product`, `station`, `machine-product` | **Yes** — a group node over chips on one screen. |
| **Reports › Quality Reports** | Types `reject`, `cone-weight`, `calibration` | **Yes**, same. |
| **Reports › Shift Reports** | Type `shift` — already counted under Production above | **Yes**, and it double-books `shift` into two groups. |
| **Reports › Export Center** | Nothing. Export is a link at the top of the screen whose data it exports: `Report.tsx:110-118` (CSV and XLSX, rank 3), `Readings.tsx:239` (CSV, rank 3) | **No duplication of an answer — but a fourth place to ask for a file.** Separating an export from the data it exports is the pattern that produced "overflow" in the first place. |
| **Administration › Users** | Setup's People block (`Setup.tsx`, `/api/admin/users*` rank 4) | **Yes.** Already a Setup section; needs an anchor, not a nav item. |
| **Administration › Roles** | Not a separate surface — a role is a column on a user row, derived from `ROLE_RANK` (`Setup.tsx:44`) | **Yes**, and it would be a nav leaf over a `<select>`. |
| **Administration › Audit** | Setup's AuditLog block, `GET /api/admin/audit` rank 4 (`app.ts:1792`) — **and a second, unrelated trail**: `sms.product_change`, written on every PDAS write attempt since migration 027 and **never read back by any route** (`grep "FROM sms.product_change" api/src` → zero hits, matrix §1.6, **Route**) | **Partly.** One audit exists and is fine. The *other* one is genuinely homeless and is not the same table. |
| **Administration › System Health** | The **Health** screen, `?s=health` (`screens/Health.tsx`), open to every signed-in account (`App.tsx:326`), serving `GET /api/health` (`app.ts:203`) and `GET /api/operations` rank 1 (`app.ts:703`) | **No duplication — but a rank error.** Placing rank-1 system health under an Administration branch repeats precisely the defect the matrix records for shift-check: rank-1 evidence rendered inside a rank-4 screen where IFL's manager accounts cannot reach it (matrix §1.9, §5.1). |

**Score.** Of the 24 leaves: **14 duplicate a question something already answers**, 4 are
real and homeless (Products, Product Limits, Changeover, and the `product_change` trail),
3 are right in substance but wrong in placement (Pallets, System Health, Product by
Machine), and 3 are structural wrappers with no content of their own (the group nodes).

---

## 3. The recommended tree

Two tiers, and the distinction is load-bearing:

- **Primary** — a word in the top bar. One per *question*. Reachable in one click from
  anywhere, every screen, every role.
- **Secondary** — a named control that is visible on every screen but is not a question
  about production: the wall, the system, the configuration, the account. Plus addressable
  sub-state *within* a primary screen (`&t=`), which is navigation the URL can express but
  the bar does not have to.

Nothing is gated by role in either tier. Only Setup is rank-gated (`App.tsx:314-322`), and
only because every panel inside it is a rank-4 write; the reads on every other screen are
open, per the one-audience rule.

### 3.1 Primary — seven words in the bar

| # | Item | Route | The single question it answers | Capabilities that live here |
|---|---|---|---|---|
| 1 | **Line** | `?s=line` | *Is the line running, what has it made this period, and does anything need attention?* (`words.ts:54`) | Live line state · attention findings · acquisition lag · production-day range · machines running · last sack/cone · station grid (matrix §1.1, §1.7) |
| 2 | **Readings** | `?s=readings` | *Every cone and every sack that was weighed, with the rejected ones flagged.* (`words.ts:55`) | Cone/sack/reject register · reading detail sheet + provenance · sack↔cone approximate linkage · register CSV export (rank 3) · print · **register XLSX export** *(Build)* |
| 3 | **Weight** | `?s=weight` | *Are the cones at the right weight, and does any station's scale need attention?* (`words.ts:56`) | Cone weight SPC · **the one** station table · Nelson drift detection · drift projection · calibration ledger + record adjustment (via the station sheet) · **Nelson rule reference table** *(Decide → wire, in Details)* |
| 4 | **Rejects** | `?s=rejects` | *How many cones are being rejected, why, is it getting worse, and where?* (`words.ts:57`) | Reject Pareto · p-chart with burst detection · per-day-per-code breakdown · reason sheet · name a reason (rank 2) · **reject code dictionary — pass-flag and severity** *(Surface)* |
| 5 | **Sacks** | `?s=sacks` | *How many sacks, what do they weigh, and what is the line's sack stock?* (`words.ts:1053`) | Sack summary · line-level stock ledger · stock day sheet · record a movement (rank 2) · the server's own refusal of per-machine stock · **sack weight SPC** *(Expose)* |
| 6 | **Product** ⭐ **NEW** | `?s=product` | *What is each machine running, what are its limits, and how do I change it?* | See §3.2 — eleven capabilities |
| 7 | **Report** | `?s=report&t=<type>` | *What did the line make over this period, on paper.* (`words.ts:58`) | All ten report types · CSV + XLSX export (rank 3) · print header · **shareable report state** *(Surface)* · **server-side PDF** *(Build)* |

Order is unchanged for 1–5 and 7 — time window ascending, as the redesign laid it out
(`Bar.tsx:24-30`). **Product** goes between Sacks and Report: after the five screens that
report what happened, before the one that prints it, because it is the only primary item
that is about *doing* rather than *seeing*.

### 3.2 Product — the one new destination, in detail

Four addressable sections, `?s=product&t=`. They are sections of one screen, not four
screens: one period control, one product vocabulary, one write-status source.

| Section | Route | Answers | Capabilities housed | Matrix action |
|---|---|---|---|---|
| **Running** *(default)* | `?s=product` | What is each machine running right now, and what is recorded for the line? | Machines running (`services/machinesRunning.ts`, `GET /api/machines/running` `routes/cone.ts:131`) · current product · **set the running product** (rank 2, `POST /api/current-product` `app.ts:1248`) · product-at-instant + 5-state verdict | **Surface** ×1 |
| **Changeover** | `?s=product&t=changeover` | Put machine N onto product X for this shift — what would that take, and what would it not do? | **Changeover workflow**: refs, dry-run plan with blockers and warnings, execute (`routes/changeover.ts:121,150,161`). The dry run works today with `PDAS_WRITE_ENABLED` off; only the execute button waits on IFL's written authority · **pallet / pack-schema reference (read)** | **Expose** ×2 |
| **Catalogue** | `?s=product&t=catalogue` | Which products exist, what are their limits, and how do I add or retire one? | Product master list · **PDAS create / retire / change-limits** (rank 2, `app.ts:1348,1374,1393`, 503 while writes are off) · **product limits history** (`routes/cone.ts:46`) · **SMS-local limit version write** (`routes/cone.ts:70`) · product option pickers · **PDAS add blend / count / tube type** *(gated on IFL)* · **PDAS create / retire pallet** *(gated on IFL)* | **Surface** ×3, **Route** ×2 |
| **History** | `?s=product&t=history` | What changed, when, by whom — and what did the plant database say about it? | **Changeover history / product timeline** (`GET /api/product-timeline` `app.ts:1239`) · **PDAS `product_change` audit trail** — one row per write *attempt*, including `outcome='disabled'`, written since migration 027 and never read back | **Surface** ×1, **Route** ×1 |

**Why this is not a second answer to a question Line already answers.** Line's product
block states one fact — *what is recorded for the line right now* — as one of six things on
the "is the line running" screen. Under this proposal that block **stops being a control
and becomes a link**: `Line.tsx:437`'s "Change" button and `Line.tsx:165`'s "History"
note-link both point at `?s=product`, and `ProductSheet` is retired as the home of writes.
One fact on Line, all the doing on Product, the history on paper in Report. Three time
windows, three destinations, no overlap.

**Why a screen and not a Setup section.** Setup is `rank >= 4` (`App.tsx:315`); setting the
product is `requireRole(2)` server-side (`app.ts:1248`) and the changeover execute is rank
2 (`routes/changeover.ts`). `ProductSheet.tsx:9-15` already makes this argument for the
sheet; the same argument makes the screen. Nesting products under Setup would hide IFL's
top requirement from every manager account IFL actually uses (`DEPLOY.md`, `CLAUDE.md`).

### 3.3 Secondary — four named controls, visible everywhere

| Item | Route | Entry | Answers | Capabilities housed |
|---|---|---|---|---|
| **Wall** | `?s=wall` | The existing button (`Bar.tsx:317-319`) — **unchanged** | The board for a monitor | Wall display |
| **System** ⭐ **renamed** | `?s=health` (**route unchanged**) | Two entries: the strip sentence it has today (`Bar.tsx:254-260`) **plus the word "System" beside Wall in the bar-right cluster** | *Can I trust these numbers, and did the sync get everything?* | See below |
| **Setup** | `?s=setup` | The gear, admins only — **unchanged**, plus section anchors (`?s=setup#people`) | Configuration and accounts | Line/machines/stations/sources/rules CRUD · reject-code dictionary (admin mirror) · users, roles, password reset · app audit log · weight-basis rule |
| **Account** | *(menu)* | Initials avatar — **unchanged** | Own password, text size, sign out | Own password change |

**System** absorbs the operations/data-integrity cluster, in four blocks:

| Block | Capabilities housed | Matrix action |
|---|---|---|
| **Plant link** | Sync health (verdict, last pass, per-table outcome, watermark, halt reason and the command that clears it) · **archived floor** — "the gap below id X is IFL's own retention, confirmed as of Y" (`sync-worker/src/epoch.ts:237-255`; `grep archived_below_id api/src` → zero hits) | **Surface**, **Route** |
| **Data quality** | **DQ findings, listed** — the rows are already on the wire in full (`api.ts:945`) and the block renders only a count of ERROR+CRITICAL (`health/SyncHealthBlock.tsx:51,98`) · **shift-check (Q7 evidence)** — rank-1 data whose only rendering today is inside rank-4 Setup › Rules (`setup/RulesBlock.tsx:236-242`, matrix §5.1) | **Expose**, **Surface** |
| **Reconciliation** | **`sms verify`** — source ⇄ raw ⇄ canonical per source generation, the only thing that answers *"did the sync get everything?"*, today reachable only from a terminal on the plant PC (`cli/src/commands/verify.ts:399-431`) · **`/api/reconciliation`** (rank 3, within-canonical totals) *(Decide → **wire**)* | **Route**, **Decide** |
| **Generations** | **Source generation history** (`epoch:list`, `cli/src/commands/epoch.ts:22`) — today only the open generation is served, so July's 142,511 cones and September's 132,552 have no visible boundary in the app · **`sms.rebuild_audit`** *(Decide → **serve**, one line)* | **Route**, **Decide** |

Renaming the label from "Health" to "System" is deliberate: the strip already says
*"details"*, and a reader who has just read a sentence about data age needs the destination
named as something other than the health they were just told about. The **route does not
change** — `?s=health` stays valid (§8).

### 3.4 Sub-state that is navigation but not a nav item

| Where | Address | Why not a bar item |
|---|---|---|
| Report type | `?s=report&t=<type>` + the type index (§5) | Ten groupings of one question |
| Product section | `?s=product&t=running\|changeover\|catalogue\|history` | Four parts of one job |
| Setup section | `?s=setup#people` etc. (`Setup.tsx:53-61`) | Nine admin sections; anchors, not nav |
| Drill-down sheets | `?sheet=kind:id` (`App.tsx:51,80-97`) — **unchanged** | A sheet is evidence for the screen under it |

### 3.5 Every non-`None` capability, housed or homeless

31 items (4 Expose + 6 Route + 10 Surface + 9 Decide + 2 Build). **25 housed, 6 homeless.**

| # | Capability | Action | Home |
|---|---|---|---|
| 1 | Changeover workflow | Expose | **Product › Changeover** |
| 2 | Data-quality findings, listed | Expose | **System › Data quality** |
| 3 | Sack weight SPC | Expose | **Sacks** — see the departure note in §4.7 |
| 4 | Pallet / pack-schema reference (read) | Expose | **Product › Changeover** (rides with the refs call) |
| 5 | `sms verify` reconciliation | Route | **System › Reconciliation** |
| 6 | PDAS `product_change` audit trail | Route | **Product › History** |
| 7 | Archived floor | Route | **System › Plant link** |
| 8 | Source generation history | Route | **System › Generations** |
| 9 | PDAS add blend / count / tube type | Route | **Product › Catalogue** *(controls absent until IFL's written authority)* |
| 10 | PDAS create / retire pallet | Route | **Product › Catalogue** *(same gate)* |
| 11 | Sync health | Surface | **System › Plant link** + the named bar affordance |
| 12 | System health | Surface | **System** (the screen itself) |
| 13 | Set the running product | Surface | **Product › Running** — the screen's primary action |
| 14 | PDAS product write (create/retire/limits) | Surface | **Product › Catalogue** |
| 15 | Product limits history | Surface | **Product › Catalogue** |
| 16 | SMS-local limit version write | Surface | **Product › Catalogue** |
| 17 | Changeover history / product timeline | Surface | **Product › History** |
| 18 | Shift-check (Q7 evidence) | Surface | **System › Data quality** (Setup › Rules keeps the same component as its admin mirror, the way `SyncHealthBlock` already serves two parents) |
| 19 | Shareable report state | Surface | **Report** — `?s=report&t=…&sh=…&st=…&pr=…` (§7) |
| 20 | Reject code dictionary (pass-flag, severity) | Surface | **Rejects › Details** — the server accepts rank 2 (`app.ts:1010`); the only UI today is admin-only |
| 21 | `/api/reconciliation` | Decide → **WIRE** | **System › Reconciliation**, beside `sms verify`, labelled as the different question it answers |
| 22 | Nelson rule reference table | Decide → **WIRE** | **Weight › Details** and the station sheet's Details — the block it was built for |
| 23 | `sms.rebuild_audit` | Decide → **SERVE** | **System › Generations**, one line: when the canonical tables were last rebuilt |
| 24 | Server-side PDF reports | Build | **Report** — beside CSV and XLSX (`Report.tsx:110-118`) |
| 25 | Register XLSX export | Build | **Readings** — beside the CSV link (`Readings.tsx:239`) |
| — | **Downtime detail** (stoppage list, hourly buckets, MTBF/MTTR, availability) | Decide → **DELETE the detail** | **HOMELESS.** No requirement line asks for OEE, and `CLAUDE.md` withdrew it deliberately; the measured part — time lost and stop count — already reaches Report via `reports/daily.ts:98-99`. Keep `/api/downtime` only as that feed; delete the detail and `getDowntime`. |
| — | **Replay `?at=`** | Decide → **NO CONTROL** | **HOMELESS by design.** `LIVE_ALLOW_AS_OF` is false in production and the route answers 400 when it is off (`app.ts:362`). A control that can only fail on the machine that matters is a bug, not a feature. It stays URL-only, documented in `DEPLOY.md:95`; the banner and "Leave replay" already handle the state (`App.tsx:246-251`). |
| — | `/api/weights` (legacy) | Decide → **DELETE** | **HOMELESS.** Superseded by `/api/spc` + `/api/weight-stations`, both discoverable. |
| — | `/api/calibration` (legacy station drift) | Decide → **DELETE** | **HOMELESS.** Superseded by `/api/weight-stations`; `CLAUDE.md` rule 6 forbids a second station table, so there is nowhere it could go. |
| — | `/api/report` (legacy) | Decide → **DELETE** | **HOMELESS.** Superseded by `/api/reports/daily`. Deleting it also removes the last caller of `getStoppagePatterns` (`services/report.ts:225`, matrix §5.5). |
| — | `services/audit.ts:226` `listAudit` | Decide → **DELETE** | **HOMELESS.** Dead code, no caller anywhere in the monorepo. |

Plus the 8 superseded client wrappers held open by `api.callers.test.ts:45-60` — dead
weight on live endpoints, deleted with the wrappers above, not a capability decision.

**Sack stock per machine** remains a **None**: not computable by anyone from IFL's data
(`sack1_TP1U2` has no machine column; `services/sackStock.ts:124` states the refusal in the
server's own words), and IFL's 15 Sep 2026 answer redefines "stock" as production per
shift, which `machine-product` delivers. It is an answered question, not a gap, and the
tree must not create a leaf that implies otherwise.

---

## 4. Where I depart from the owner's tree, and why

**Ten departures.** Each is argued on evidence. Where the owner is right, §4.11 says so.

### 4.1 No "Dashboard" group over one leaf. Line stays Line.

A parent node holding exactly the landing page adds a click to reach what is already the
default view (`App.tsx:83`) and puts a word in the tree that names no question. Every
screen in this application states the question it answers on the page, not on hover
(`words.ts:52-60`, a deliberate choice recorded in that comment because *"hover does not
exist on a wall display or a touch screen"*). "Dashboard" is the one word in the owner's
tree that cannot be turned into a question.

### 4.2 The five Production leaves stay report types, not nav items.

This is the departure the brief flagged, and it is the one I am most confident about.

- **They are one question, five groupings.** Daily, Shift, Product, Station and
  Machine-product share one period control, one filter table (`report/model.ts:16-30`), one
  export path (`Report.tsx:110-118`), one print header (`report/PrintHead.tsx`) and one
  coverage sentence (`Report.tsx:231-250`). Five bar items over one screen's state is the
  sub-tab row `REDESIGN.md` §9 deleted by name.
- **It breaks the duplication rule five times.** `CLAUDE.md`: *"No two screens may answer
  the same question."* Daily-in-the-bar and Report-in-the-bar answer the same one.
- **Machine/Station would be the third station ranking.** `CLAUDE.md` rule 6 allows one
  station table, on Weight, *because* the previous build had three and they disagreed.
- **The actual defect is a URL defect, and nav does not fix it.** The type is component
  state (`Report.tsx:53`) with the filters (`Report.tsx:54`); a pasted link always lands on
  `daily`, unfiltered. A bar item would make the type addressable *by accident*, at the
  cost of five leaves. A query parameter makes it addressable *on purpose*, at the cost of
  none — and a parallel worker is already building exactly that.
- **What I concede, and what §5 does about it:** navigation is also a discovery mechanism,
  and ten undifferentiated chips are weak discovery — the matrix says so of
  `machine-product` specifically (§1.8). The answer is an index inside Report and deep
  links into it from the screens that raise the question, not five words in the bar.

### 4.3 No "Quality" and no "Sacks" group wrappers.

Weight, Rejects and Sacks are already in the bar and already discoverable (matrix: **None**
for all three clusters). A group node over items that are one click away today makes them
two clicks away tomorrow. The bar is a flat list of seven because seven questions fit on a
line; the moment it needs grouping it has too many items, which is the failure mode this
proposal is trying to avoid, not adopt.

### 4.4 No Calibration screen.

Calibration is not a question a reader asks on arrival; it is the *evidence behind* a
finding on Weight. It lives where the finding is: the station sheet's ledger, projection
and adjustment form (`StationSheet.tsx`, `POST /api/calibration/adjustments` rank 2). A
third surface would be the third station table, and `CLAUDE.md` rule 6 exists because that
previously happened. The `calibration` report type stays a report type.

### 4.5 Pallets move from Sacks to Product.

Pallets are PDAS reference data read by the changeover refs call (`services/pallets.ts:47,76`
inside `routes/changeover.ts:121`) and written only as steps inside a changeover
(`changeover.ts:474,484`). Under **Sacks** they would sit beside a register whose source
table has no pallet column — the same absent-link problem as sack stock per machine
(matrix §1.5), and the same risk: a reader will assume a relationship the data cannot
support. Under **Product › Catalogue** they sit with the blends, counts and tube types they
are actually used with.

### 4.6 Sack Production and Stock Ledger stay one screen.

They are two blocks of `screens/Sacks.tsx` today (summary `routes/sacks.ts:79`, ledger
`routes/sacks.ts:93`), both discoverable, both **None** in the matrix. The previous build
had three screens for one register — Sacks, Cones, Records — and the redesign collapsed
them for exactly this reason (`REDESIGN.md` §9). Splitting them again re-opens it.

### 4.7 Sack weight SPC goes on Sacks, not as a toggle on Weight.

This departs from the matrix's own suggestion (§3.1 item 3: *"a cone/sack toggle on
Weight"*), so it needs arguing. Weight's question is *"Are the **cones** at the right
weight…"* (`words.ts:56`); a toggle that silently repoints the whole screen at sacks makes
one screen answer two questions and makes the headline sentence wrong in one of its two
states. The engine already takes `SpcType = 'cone' | 'sack'` (`services/spc.ts:297`) and
the route already accepts `type=sack` (`app.ts:789-791`); only `Weight.tsx:91,108` hardcode
`'cone'`. Putting the sack chart on **Sacks**, under the summary that already reports sack
count, kg, average and in-range share, adds evidence to a question that screen already
asks. No new route, no new nav item.

### 4.8 No three-way split of Reports, and no Export Center.

Splitting ten types into Production / Quality / Shift forces a reader to know which group
holds "Calibration" before they can look for it, and double-books `shift` (it is both a
type and a filter on four other types — `report/model.ts:16-30`). An **Export Center** is
worse: export today is a link at the top of the screen whose data it exports
(`Report.tsx:110-118`, `Readings.tsx:239`), which is the only placement where the reader can
see what they are about to download. A separate export destination re-asks the period, the
type and the filters in a second place — a fourth answer to "give me a file", and precisely
the kind of unrequested surface IFL called overflow.

### 4.9 Users / Roles / Audit stay Setup sections with anchors.

They are rank-4 writes on an already-rank-4 screen (`App.tsx:314-322`,
`/api/admin/*` `app.ts:1426-1792`). Promoting them to three nav leaves would put three
admin-only words in a bar that every manager sees — which is a role-tiered tree by the back
door, and `CLAUDE.md`'s one-audience rule forbids it. "Roles" in particular is not a
surface at all: it is a `<select>` on a user row (`Setup.tsx:44`). The real defect the
owner has spotted is that Setup's nine sections have no sub-navigation and no anchors
(`Setup.tsx:53-61`), so "Setup › People" cannot be linked. The fix is anchors, which cost
nothing and break nothing.

### 4.10 System Health comes **out** of Administration, not into it.

`GET /api/health` is served at `app.ts:203` with detail nulled when unauthenticated;
`GET /api/operations` is rank 1 (`app.ts:703`); the Health screen is open to every
signed-in account (`App.tsx:326`) *because* it was admin-only while IFL's accounts are
created at manager (`screens/Health.tsx:5-8` records this in the code). Putting it under an
Administration branch would reverse a fix this project already made once, and would repeat
the defect the matrix records for shift-check: rank-1 evidence rendered inside a rank-4
screen, invisible to every account IFL uses (matrix §5.1). It becomes **System**, named in
the bar-right cluster, open to everyone.

### 4.11 Where the owner is right, and I am adopting it wholesale

Three of the four genuinely homeless things in the whole application are in the owner's
**Master Data** branch — Products, Product Limits, Changeover — and he found them by
inspection of the tree, which is the point of drawing one. **That branch is the correct
diagnosis and I am building on it, with two changes:**

1. **Call it Product, not Master Data.** The readers are the GM, managers and process
   engineers (`CLAUDE.md`, one-audience). "Master Data" is a database administrator's
   phrase for a screen whose primary action is *change what machine 7 is spinning this
   shift*.
2. **Put Changeover first inside it, not third.** It is IFL's named single most important
   requirement (Hassan sb, 15 Sep 2026) and it has *zero* client code
   (`FRONTEND-INVENTORY.md` §4.1). Listing it third under a data-administration heading
   would ship the most important missing feature as the least prominent item on the screen
   that finally holds it.

And the owner is right about **Product by Machine** being under-served: it is IFL's answer
to the sack-stock question and it renders as the tenth of ten identical chips (matrix
§1.8). It gets a named deep link from Product › Running — the one place a reader is already
thinking about which machine runs what — rather than a bar item.

---

## 5. Report types: navigation, chips, or both

**Recommendation: chips, made addressable, plus an index and deep links in. Not navigation
items. Not both.**

Concretely, three changes inside one screen:

1. **The type goes in the URL** — `?s=report&t=machine-product` — with the three filters
   beside it (`?sh=`, `?st=`, `?pr=`). This is the mechanism the parallel worker is
   building; the tree depends on it and should not duplicate it.
2. **The chip row becomes a labelled index.** Ten chips in one undifferentiated wrapping
   row (`Report.tsx:128-136`) is a list, not a structure. Two inline groups with a small
   label each — *Production*: daily, shift, product, station, machine-product;
   *Quality and stock*: reject, cone-weight, sack, calibration; and **management-summary
   set apart**, because it is the one page meant for the GM and the one type gated at rank
   3 (`routes/reports.ts:98-112`, `report/model.ts:34`). The grouping the owner wanted,
   *inside* the screen, costing no clicks and no leaves.
3. **Every screen that raises a report's question links into that report type**, carrying
   the period and any narrowing filter (§6). A reader reaches `machine-product` because
   Product › Running offered it while they were looking at machines — not because they
   scanned ten chip labels.

**Why not both.** "Both" means a bar item and a chip that land on the same view. That is
either two routes for one screen — which is how a reader ends up unsure whether they are
somewhere new — or a bar item that is a bookmark into another screen's state, which is a
sub-tab row wearing a nav item's clothes. `CLAUDE.md` forbids two screens answering one
question; two *entrances* to one screen from the same bar is the same defect with the
duplication moved into the chrome. The deep links in §6 are not a second entrance: they are
a transition **from a different screen answering a different question**, which is exactly
what guided navigation is.

**What this gives up, stated plainly.** A reader who has never opened Report still has to
open Report to learn that ten types exist. The mitigation is (2) and (3), not a bar item —
and it is worth noting that no evidence says report types are undiscoverable *once inside*:
the matrix marks all ten **discoverable** and **None** (§1.8). The measured defect is that
they cannot be *linked to*, and a URL fixes that completely.

---

## 6. The guided-navigation map

"One click to the next useful screen." For each origin: what a reader wants next, where it
goes, and whether it exists today.

**Legend:** ✓ exists · ◐ exists but drops the context that would make it useful · ✗ absent.

### 6.1 A KPI → the exception behind it

| From | To | Today |
|---|---|---|
| Line · attention finding | Weight / Rejects / Readings — the finding already names its screen (`services/attention.ts:61-62`), and `Line.tsx:356-360` navigates there | ◐ **The station id is not carried.** A station-drift finding (`attention.ts:189`, `screen: 'weight'`) lands on Weight with fourteen unsorted rows and no indication which one it meant. Only the `outside_product_limits` kind passes a filter. |
| Line · "cones rejected, N%" figure | Rejects, same period | ✗ The figure is not a link. |
| Line · sacks figure | Sacks, same period | ✗ |
| Report · any total | The screen that explains it | ✗ **Report has no outbound link of any kind.** It is a leaf. |
| Wall · a station's bar | — | ✗ deliberate; Wall has no navigation by design (`Wall.tsx`). Correct as is. |

### 6.2 An exception → the machine

| From | To | Today |
|---|---|---|
| Line · station grid box | Station sheet (`Line.tsx:207,557` → `?sheet=station:N`) | ✓ |
| Line · machines-running row | Station sheet (`Line.tsx:470`) | ✓ |
| Weight · station table row | Station sheet (`Weight.tsx:263,534`) | ✓ |
| Rejects · "By station" | Weight (`Rejects.tsx:363`) | ◐ **Arrives unsorted and unfiltered.** `REDESIGN.md` §5.4 line 5 promised *"opens the Weight station table sorted by reject rate"*; the link passes nothing (`App.tsx` `onSeeStations` → plain `view: 'weight'`). |
| Attention finding · station drift | That station's sheet directly | ✗ — see 6.1. |

### 6.3 A machine → its product and its shift

| From | To | Today |
|---|---|---|
| Station sheet → the product that station is running | **Product › Running**, that machine | ✗ The product appears only *inside the adjust form*, auto-filled from the machine's newest cones (`StationSheet.tsx:438-453`), and is not a link. |
| Station sheet → this machine by shift | `?s=report&t=machine-product&st=N` | ✗ |
| Product › Running row → that machine's readings / drift | Readings filtered, station sheet | ✗ *(the screen does not exist yet)* |
| Line · machines row → "how it ran by shift" | `?s=report&t=machine-product` | ✗ |

### 6.4 A product → its limits and its history

| From | To | Today |
|---|---|---|
| Line · product block "Change" | Product sheet (`Line.tsx:437`) | ◐ Rank ≥ 2 only, and the label "Change" names an action, not a destination. |
| Line · product block "History" | The **same** sheet (`Line.tsx:165`) | ◐ Two controls, one destination; the history is then behind a `<Details>` inside it (`ProductSheet.tsx:143`). |
| Product → its limits | `ProductLimitsBlock` inside the sheet (`ProductSheet.tsx:141`) | ◐ Present, buried; the only other copy is in admin-only Setup › Rules (`setup/RulesBlock.tsx:61`). |
| Product → the PDAS catalogue | `<Details>` inside the sheet (`ProductSheet.tsx:265`) | ◐ Four levels deep, no outside signpost. |
| Reading sheet → the product in force at that reading | Product › Catalogue, that product | ✗ The sheet shows the product-at verdict but does not link to the product. |
| Product → *what it produced* | `?s=report&t=product&pr=N` | ✗ |

### 6.5 A reject code → its days and its readings

| From | To | Today |
|---|---|---|
| Rejects · by-day-and-reason row | Reason sheet (`Rejects.tsx:353,731`) | ✓ |
| Reason sheet → that day's register | Readings, narrowed to the day + inspection rejects (`ReasonSheet.tsx:254`) | ◐ **Carries the day, not the code** — Readings has no reason filter, and `App.tsx`'s own comment says so. The sheet states the limitation, which is honest, but the hop under-delivers. |
| Reason sheet · row | That reject's reading sheet (`ReasonSheet.tsx:233`) | ✓ |
| Rejects · "See the cones" | Readings, `inspectionRejects` (`Rejects.tsx:359`) | ✓ |
| Rejects · a Pareto bar | Its reason sheet | ◐ It narrows Rejects in place (`Rejects.tsx:95-97`) rather than opening the sheet. Defensible; noted, not a defect. |
| Reject code → the reject report | `?s=report&t=reject&pr=…` | ✗ |

### 6.6 A station → its drift and its adjustments

| From | To | Today |
|---|---|---|
| Station sheet → daily means, flagged days, projection | In the sheet (`StationSheet.tsx:294-303`) | ✓ |
| Station sheet → its adjustment ledger | In the sheet | ✓ |
| Station sheet → **that station's readings** | Readings, filtered to station N | ✗ **The gap Phase 1 headlined** (`FRONTEND-INVENTORY.md` §4.5): a reader who wants the cones behind a flagged station must reopen Readings and set the filter by hand. Nothing hands off the station id. |
| Station sheet → that station's rejects | Rejects, station N | ✗ |
| Station sheet → the calibration report for it | `?s=report&t=calibration&st=N` | ✗ |
| Weight · "N cones passed but outside limits" | Readings, `outsideLimits` (`Weight.tsx:191`) | ✓ |

### 6.7 System and trust

| From | To | Today |
|---|---|---|
| Strip lag sentence → System | `?s=health` (`Bar.tsx:254-260`) | ◐ The single entry, and it is shaped like a status message. |
| System · a blocking DQ finding → the table it came from | Readings / System › Generations | ✗ The findings are not rendered at all — only counted (`health/SyncHealthBlock.tsx:51,98`). |
| System · halt reason → the command that clears it | Printed verbatim (`SyncHealthBlock.tsx:120-127`) | ✓ Correct as is: registering a generation is an operator act, not a web action. |
| Any screen → "why is this figure missing" | System | ✗ |

**Tally: of 27 hops a reader would plausibly want, 9 exist and carry what they need, 6
exist but drop the context, and 12 do not exist.** The single most valuable one to build is
**station → that station's filtered readings**, because it is the hop from a claim
("this station has read 9 g heavy for four days") to the evidence for it, and the station
sheet was built on the argument that *"a claim with no visible working is one they will not
trust and should not act on"* (`StationSheet.tsx:7-12`) — an argument the sheet itself
does not finish.

---

## 7. Context to preserve across every transition

Five things a transition must carry. **Two are carried today, three are dropped.**

| Context | In the URL today? | Mechanism | Verdict |
|---|---|---|---|
| **Period** | **Yes** — `p`, and `from`/`to` when picked (`lib/period.ts:214-233`, written `App.tsx:99-107`) | `go()` merges into the existing route (`App.tsx:137-142`), so every navigation keeps it unless the caller overrides | ✓ **Carried.** The one thing the redesign got structurally right. |
| **Replay instant** | **Yes** — `at` (`App.tsx:104`, `readAsOf`) | Same merge; the banner and "Leave replay" read it (`App.tsx:246-251`) | ✓ **Carried.** Keep exactly as is. |
| **Shift** | **No** | Only implicitly, when the period key is `shift`. Report's own shift filter is component state (`Report.tsx:54`); Readings and Rejects have no shift control at all | ✗ **Dropped.** A reader looking at the night shift on Report who clicks through to Readings loses the shift. |
| **Station** | **Only as an open sheet** — `sheet=station:7` (`App.tsx:80-97`) | As a *filter* it is local state in three different places: `Readings.tsx:112`, `Weight.tsx:58` (`chartStation`), `Report.tsx:54` | ✗ **Dropped, and worse — it is three different variables for one idea.** This is why no hop can hand a station off. |
| **Product** | **No** | `Rejects.tsx:95-97` (deliberately excluded, argued in `Rejects.tsx:92-94`), `Report.tsx:54`. `/api/production?product=` exists server-side | ✗ **Dropped.** |

**Recommendation: one shared context vocabulary in the URL, read by whichever screen can
use it and ignored by the rest.**

```
s=<screen>            the destination
t=<section|type>      report type · product section
p / from / to         the period                         (exists — unchanged)
at=<ISO>              the replay instant                 (exists — unchanged)
sh=<shift>            morning | evening | night          (new)
st=<station>          one station                        (new — replaces three local variables)
pr=<productId>        one product                        (new)
sheet=<kind>:<id>     the open drill-down                (exists — unchanged)
rf=<filter>           Readings' narrowing                (exists — folds into the above over time)
```

Three rules that make it work, and each is a rule the app already half-applies:

1. **A transition keeps every context value unless the destination cannot use it.** `go()`'s
   merge already does this for `p` and `at` (`App.tsx:137-142`); the new keys ride the same
   path. Report already drops filters a type would refuse (`report/model.ts` `filtersFor`) —
   the same discipline, applied to navigation instead of to one screen's chips.
2. **A transition that deliberately narrows says so on arrival.** `ReasonSheet`'s hop into
   Readings already overrides the period to a single day and states it (`App.tsx` comment on
   `onOpenRegister`). That is the right behaviour and the right honesty; generalise it.
3. **One name per idea.** `Readings`' station filter, `Weight`'s `chartStation` and
   `Report`'s station filter become one `st`. Without this, §6's hops cannot be built at
   all — which is why the parallel worker's URL pass should adopt this vocabulary rather
   than lifting each screen's local name into its own parameter.

`Rejects.tsx:92-94`'s argument for keeping *its* filters out of the URL — *"a working
narrowing of this screen, not a period a colleague should inherit from a pasted link"* — is
a good argument about **sharing**, not about **transitions**. Both are served by keeping
the value in the URL and letting a hop decide whether to pass it on.

---

## 8. Migration impact

**The headline: no existing route changes, and no existing URL stops working.** Every
change below is additive.

### 8.1 `?s=` values

`VIEWS` is `[...SCREENS, 'setup', 'wall', 'health']` (`App.tsx:64`), and an unrecognised
value falls back to `line` (`App.tsx:83`) — which is how `?v=` URLs from before the 3 Sep
redesign land somewhere sensible rather than erroring (`DEPLOY.md:79`).

| Value | Change | Why it must not move |
|---|---|---|
| `line` `readings` `weight` `rejects` `sacks` `report` | **None** | In the bar; bookmarked. |
| `wall` | **None** | Baked into the plant PC's kiosk shortcut: `msedge --kiosk http://<plant-ip>:4000/?s=wall` (`DEPLOY.md:83-84`). Changing it silently breaks the TV. |
| `health` | **Route unchanged; label becomes "System"** | Documented at `CHANGELOG.md:33`. A label change breaks nothing; a route change would. |
| `setup` | **None**, gains `#section` anchors | `App.tsx:314-322`. |
| `product` | **NEW** | Additive. Nothing today produces this value, so nothing can collide. |

### 8.2 What breaks, concretely

| Change | What references the old form | Impact |
|---|---|---|
| Line's "Change" / "History" point at `?s=product` instead of `?sheet=product:current` | `Line.tsx:165,437`; `App.tsx:264,339-341` | Low. **Keep `sheet=product:current` valid** — have it redirect to `?s=product` so any pasted link or bookmark survives. `Sheet['kind']` keeps `'product'` in the union (`App.tsx:51`) even after `ProductSheet` retires as the write surface. |
| `ProductSheet` retires as the home of writes | `App.tsx:339-341`, `ProductSheet.tsx` | Medium — it is a move of real components (`ChangeForm`, `PdasProducts`, `ProductLimitsBlock`, `History`), not a rewrite. `ProductLimitsBlock` is already built to serve two parents and to decide its own visibility from the server (`ProductLimitsBlock.tsx:3-4`), so a third parent costs nothing. |
| `?s=report&t=…` | `Report.tsx:53,54`; `report/model.ts`; `report/model.test.ts` | Low, and **already in flight** with the parallel worker. `REPORT_TYPES` (`api.ts:1860`) is the enumeration; `t` values are exactly its members. |
| One `st` replacing three station variables | `Readings.tsx:112`, `Weight.tsx:58`, `Report.tsx:54` | Medium. Worth doing **before** the parallel worker lifts each local name into its own parameter, or the vocabulary hardens wrong. |
| Health → "System" label + a second entry | `Bar.tsx:254-260,317-324`; `words.ts` | Low. The bar-right cluster gains one word. |
| Setup section anchors | `Setup.tsx:53-61`; `words.ts:498-508` already defines the labels (`W.setupTabs`, a vestige of a tabbed design) | Low; the strings exist. |
| Deleting `/api/weights`, `/api/calibration`, `/api/report`, `listAudit`, downtime detail | `api.callers.test.ts:35-61` `ALLOW_LIST`; `services/report.ts:225` (the last caller of `getStoppagePatterns`) | Low, and the guard test is *designed* to be edited here: it exists so "nobody calls this" is a written decision. Entries are removed as wrappers go. |

### 8.3 Tests

No test in `web/src` parses a route or asserts navigation. The web suite is logic-only:
`lib/period.test.ts`, `lib/plantClock.test.ts`, `lib/productLabel.test.ts`,
`lib/provenance.test.ts`, `lib/shiftTimes.test.ts`, `lib/syncHealth.test.ts`,
`screens/report/model.test.ts`, `screens/product/ProductLimitsBlock.test.ts`,
`ui/ErrorBoundary.test.ts`, `api.callers.test.ts`.

**Two consequences.** First, the tree can change without a test rewrite. Second — and this
is the risk, already recorded as a finding in `AUDIT-2026-09-15.md:555` — **nothing
automated will catch a broken route**, so every hop in §6 needs a browser walkthrough
before it ships. `api.callers.test.ts` is the only test that will notice this work at all,
and only by counting wrappers.

One more place a route is reconstructed: `ui/ErrorBoundary.tsx:142` resets to the bare path
on recovery, dropping `?s=…&sheet=…`. Adding a screen does not change that behaviour, but
the new context keys (§7) are dropped by it too, and that is now a slightly bigger loss
than it was.

### 8.4 Documents to update when the tree is approved

`audit/FRONTEND-INVENTORY.md` §1; `CHANGELOG.md`; `sms/DEPLOY.md` (the wall URL section
stays correct; add `?s=product`); `CLAUDE.md`'s "UI redesign — BUILT AND LIVE" section, and
its "Still to do" list, from which the *Product limits* rule and the per-day-per-code reason
sheet can be struck. **`BASELINE.md:56` is the frozen Phase 0 picture and is not updated.**
`CAPABILITIES.md` §3 still describes the pre-redesign `?v=` screens and is already stale —
this is the moment to either refresh it or mark it superseded.

---

## 9. What I would NOT do

The restraint list. Each of these was considered and rejected on evidence.

1. **Not group nodes with one leaf** — "Dashboard › Overview", "Quality › Rejects". A node
   that adds a click and no information is what "not implemented smartly" describes.
2. **Not a tree that hides capability by role.** Every primary and secondary item is open to
   every signed-in account; only Setup is rank-gated (`App.tsx:314-322`) and only because
   every panel in it is a rank-4 write. `CLAUDE.md`'s one-audience rule is not negotiable,
   and §4.10 shows how easily a tree reintroduces tiering by accident.
3. **Not report types as nav items** (§4.2, §5).
4. **Not a Calibration screen** — it would be the third station ranking; `CLAUDE.md` rule 6
   allows one.
5. **Not an Export Center** — export belongs at the top of the screen whose data it exports
   (`Report.tsx:110-118`, `Readings.tsx:239`).
6. **Not a second audit screen.** Setup's audit log (`sms.audit_log`, app writes) and
   Product › History (`sms.product_change`, PDAS write attempts) are different tables with
   different readers; each must state in one sentence what it does *not* cover, or they will
   become two answers to one question.
7. **Not a revival of OEE, MTBF/MTTR or stoppage detail.** No requirement line asks for it
   (`CLAUDE.md`'s requirement mapping), it was deleted deliberately in `f4b941a`, and the
   measured part already survives on Report.
8. **Not a control for `?at=`.** `LIVE_ALLOW_AS_OF` is false in production and the route
   400s when it is off (`app.ts:362`).
9. **Not a sidebar, a mega-menu, breadcrumbs or a global search.** The bar stays one row of
   seven words plus four named controls. A search box over eleven destinations is the tell
   of a tree that grew too large; if this tree ever needs one, this tree is wrong.
10. **Not renaming `?s=` or any existing value** (§8.1) — the plant PC's kiosk shortcut
    depends on `?s=wall` (`DEPLOY.md:83-84`), and the `?v=` → `?s=` change already spent the
    project's one free route rename.
11. **Not splitting Sacks, and not moving Setup's nine sections into navigation.**
12. **Not a "Sack stock per machine" leaf, in any branch.** It is not computable from IFL's
    data by anyone (`services/sackStock.ts:124`), and a nav item promising it would be a
    fabricated capability in the tree itself.
13. **Not a per-screen date control anywhere.** One global period (`Bar.tsx`, `lib/period.ts`)
    is the fix for "unclear what period any number describes" and must survive this tree
    intact.
14. **Not building the changeover *execute* button yet.** The dry run works today with PDAS
    writes off (`routes/changeover.ts:14-27`); execute waits on IFL's written authority for
    all nine rights (`CLAUDE.md`). The tree makes room for it; the build stops at the plan.

---

## 10. What this proposal cannot settle

1. **Nobody has watched a user.** "Discoverable" in the matrix is a code-read judgement and
   it says so (matrix §6.2). This tree inherits that limit. The seven-item bar is a
   judgement that seven questions fit on one line for this audience; a walkthrough with
   IFL's representative on the simulator (`REDESIGN.md` §12 gate 5) is what would settle it.
2. **Product › Changeover's shape is not designed here.** This document says it is a section
   of the Product screen with four pickers, a plan result and a disabled execute. Whether
   the plan reads better as a sheet over Product › Running is a design question for Phase 2b.
3. **Six capabilities are gated on IFL** — the PDAS rights beyond create/retire/change-limits
   — and their controls cannot be finalised until the written authority arrives. The tree
   reserves the space; the buttons stay absent, not disabled.
4. **The parallel URL work and this tree must agree on one vocabulary** (§7). If the URL pass
   lands `station`, `chartStation` and a third name as three parameters, §6's hops become
   unbuildable without a second migration.
5. **This is structure, not design.** No layout, no wireframe, no visual treatment is
   proposed or should be inferred from the order of anything above.

---

*Phase 2a proposes. It does not build. No file under `sms/` was modified in producing this
document, and nothing here has been committed or pushed.*
