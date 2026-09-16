# SMS Frontend Inventory — Phase 1: what exists vs. what a user can discover

Audited against `sms/web/src` at HEAD `16bc219` (branch `floor-first-rework`,
59 commits ahead of `origin/main`, nothing pushed). Read-only audit; no file
under `sms/` was modified. All citations are `path:line` against files under
`sms/web/src` unless stated otherwise.

The test applied throughout: **built → API exists → UI exists → navigation
exists → user can discover it.** A capability whose code is perfect but whose
only route in is a typed URL, or a control nobody would click, fails this
test.

---

## 1. Screen table

The router is `sms/web/src/App.tsx`. The route lives in `?s=`
(`App.tsx:80-97` `parseRoute`); the nav bar is `sms/web/src/ui/Bar.tsx`.
`SCREENS` (`Bar.tsx:31`) = `line, readings, weight, rejects, sacks, report` —
these six, and only these six, appear as buttons in the top bar
(`Bar.tsx:301-311`). `wall`, `setup`, `health` are valid `?s=` values
(`App.tsx:46,64`) but are **not** in `SCREENS` and never appear as nav-bar
buttons.

| Screen | Route | In nav bar? | Question it answers | Key API wrappers | Client rank gate | How a user discovers it |
|---|---|---|---|---|---|---|
| Line | `?s=line` (default) | Yes | `W.question.line` (`words.ts:54`) | `getStations`, `getProduction`, `getProductAt`, `getAttention`, `getMachinesRunning` (`Line.tsx:37-39`) | write (Change product): `rank>=2` (`App.tsx:265`) | Landing page — default view, first nav-bar item |
| Readings | `?s=readings` | Yes | `W.question.readings` (`words.ts:55`) | `getEvents`, `getStations`, `eventsExportUrl` (`Readings.tsx:34-37`) | export: `rank>=EXPORT_RANK(3)` (`App.tsx:275`) | Nav bar |
| Weight | `?s=weight` | Yes | `W.question.weight` (`words.ts:56`) | `getSpc`, `getWeightStations`, `getStations`, `getProduction` (`Weight.tsx:40-43`) | none (read-only screen) | Nav bar |
| Rejects | `?s=rejects` | Yes | `W.question.rejects` (`words.ts:57`) | `getRejectsFiltered`, `getRejectSpcFiltered`, `getRejectsByDayCode`, `getRange`, `getStations`, `getProducts`, `setRejectLabel` (`Rejects.tsx:50-55`) | name a reason: `rank>=ENGINEER_RANK(2)` (`App.tsx:295`) | Nav bar |
| Sacks | `?s=sacks` | Yes | `W.sacks.question` (`words.ts:1053`) | `getSackSummary`, `getSackStock`, `getEvents`, `recordSackMovement`, `getProducts` (`Sacks.tsx:34-39`) | record a movement: `rank>=ENGINEER_RANK(2)` (`App.tsx:305`) | Nav bar |
| Report | `?s=report` | Yes | `W.reports.question[type]` (per report type) | `getReportOf`, `reportExportUrl`, `getStations`, `getProducts` (`Report.tsx:32-34`) | export: `rank>=EXPORT_MIN_RANK(3)`; management-summary read: `rank>=3` (`report/model.ts:33-37`) | Nav bar |
| Wall | `?s=wall` | **No** | (fullscreen board, no question line) | `getAttention`, `getStations`, plus `useLive` (`Wall.tsx:35`) | none | The **Wall** button at the right of the bar (`Bar.tsx:317-319`) — a plain button, not styled as nav; nothing else links to it |
| Setup | `?s=setup` | **No** | `W.question.setup` (`words.ts:59`) | `adminListUsers`, `adminGetAuditPage`, plus every `admin*` wrapper via its 7 sub-blocks | `rank>=4` — both to see the gear icon (`Bar.tsx:320`) and to render the screen instead of a refusal page (`App.tsx:314-322`) | The gear icon, shown **only to admins** (`Bar.tsx:320-324`); no other link anywhere in the app points at `?s=setup` |
| Health | `?s=health` | **No** | `W.health.question` (`words.ts:838`) | `getHealth` (`Health.tsx:21`), plus `SyncHealthBlock`'s `getOperations` | none (open to every signed-in account, `App.tsx:326`) | Only reachable by clicking the lag sentence in the strip ("… · details", `Bar.tsx:254-260`, wired via `onOpenSync`→`App.tsx:233`). No nav-bar entry, no link from any screen's body |

Observation: three of the nine reachable views (`wall`, `setup`, `health`)
have **no nav-bar presence at all**. Wall and Setup each have exactly one
discoverable entry point (a button); Health's only entry point is a sentence
in the health strip that most readers will parse as a status message, not as
a link, until they notice it is a `<button>` styled as text
(`Bar.tsx:254-260`, class `strip-link`).

---

## 2. Sheets (`?sheet=kind:id`)

`Sheet['kind']` (`App.tsx:51`) has seven values. Five component families
render them:

| Kind | Component | Opened from | `path:line` of the opener |
|---|---|---|---|
| `station` | `StationSheet.tsx` | Line's station grid, Line's "what each machine is running" table, Weight's station table | `Line.tsx:470` (machines table row), `Line.tsx:557` (station grid button), `Weight.tsx:534` (station table row), wired via `onOpenStation` in `App.tsx:262,284` |
| `cone` / `sack` / `reject` | `ReadingSheet.tsx` (one component for all three) | Line's "last readings", Readings' register rows, Sacks' register rows, ReasonSheet's reject rows | `Line.tsx:610`, `Readings.tsx` register rows (`onOpenReading`), `Sacks.tsx` (`onOpenReading`), `ReasonSheet.tsx:233` (`onOpenReading('reject', …)`), wired via `App.tsx:263,274,306,350` |
| `product` | `ProductSheet.tsx` | Line's "Change" button and its "History" link (both call the same `onChangeProduct`) | `Line.tsx:165,437`, wired via `App.tsx:264,339-341` |
| `reason` | `ReasonSheet.tsx` | Rejects' by-day-and-reason table only | `Rejects.tsx:731` (`ByDayTable` row `onOpen`), wired via `App.tsx:294,342-352` |
| `stock` | `StockSheet.tsx` | Sacks' stock ledger only | `Sacks.tsx` (`onOpenDay`), wired via `App.tsx:307,353` |

A sixth drill-down exists that is **not** in the `Sheet` union and carries no
URL state at all: `AccountSheet` (`screens/Account.tsx`), opened from local
`useState` inside `Bar.tsx`'s `UserMenu` (`Bar.tsx:131,204`). It cannot be
linked, and closing/reopening the user menu discards nothing important
(change-password is a one-shot form), so this is a minor, deliberate
omission rather than a failure — but it means "every drill-down" is not
literally true of the routed `Sheet` type; there are six drill-down
components, one of which is off the URL by design.

Every sheet in the `Sheet` union closes on Escape and is layered over the
underlying screen (`App.tsx:329-361`, `ui/Sheet.tsx`), so the screen's own
state under it survives — **except** that the screen's own state is mostly
not in the URL either (§4 below), so "survives" only covers the current
in-memory session, not a reload or a shared link.

**Nothing opens `sheet=cone`/`sack` from Weight or Rejects directly** —
Weight and Rejects only ever open `station` and `reason` sheets respectively;
a reader who wants to see the individual cone behind a flagged station's
number has no one-click path from Weight to that cone (they can open the
station sheet, but the station sheet lists daily means and an adjustment
log, not individual readings — `StationSheet.tsx:195-257`). This is a gap
between adjacent screens rather than a true 0-route failure, so it is listed
under discoverability failures (§4) rather than sheets.

---

## 3. Component inventory

`web/src/screens/*.tsx` (18 top-level screens/sheets), `web/src/screens/{health,product,report,setup}/*.tsx`
(19 sub-components), `web/src/ui/*.tsx` (6 shared modules) — 43 non-test
`.tsx` files total. An import-reference sweep (every file matched against
every other file for `from '.../<basename>'`) found **zero orphans**: every
component file is imported by at least one other file. The apparent
"unreachable" surfaces in this codebase are not orphaned components — they
are wired components whose *route* is unreachable (the changeover UI does
not exist as a component at all, §4) or wrappers with no caller (§4, the
`api.callers.test.ts` list).

Two components are intentionally shared across two different parents, which
is relevant to the rank-mismatch section (§9):
- `ProductLimitsBlock.tsx` — rendered from both `setup/RulesBlock.tsx` (admin,
  `rank>=4` to reach Setup) and `ProductSheet.tsx` (open to every signed-in
  account) — `ProductLimitsBlock.tsx:3-4` documents this explicitly; the block
  decides its own edit-visibility from the server's write-status endpoint
  rather than from either parent's rank.
- `SyncHealthBlock.tsx` — rendered from both `Setup.tsx:53` and
  `Health.tsx:40`, so Setup and the open-to-everyone Health screen cannot
  disagree about sync state.

---

## 4. Navigation and discoverability

### The navigation tree as a user actually sees it

```
Top bar (always visible once signed in):
  SMS (brand, not a link)
  [ Line | Readings | Weight | Rejects | Sacks | Report ]   <- SCREENS, Bar.tsx:301-311
  [ period control: This shift | Today | Yesterday | This week | This month | Pick dates ]
  [ Wall ] button                                            <- Bar.tsx:317-319
  [ gear icon ]  <- admins only (rank>=4), Bar.tsx:320-324 -> ?s=setup
  [ user initials menu ] -> Text size, Change password (AccountSheet), Sign out

Health strip (always visible, second row):
  <dot> <line name> · plant clock          <lag sentence> details   <- HealthLine, Bar.tsx:334-348
                                             ^ button -> ?s=health (the ONLY route to Health)

Within a screen, drill-down sheets open over it (?sheet=kind:id):
  Line       -> station sheet, product sheet, cone/sack sheet (last readings)
  Weight     -> station sheet
  Rejects    -> reason sheet (from the by-day table only)
  Sacks      -> stock sheet, cone/sack sheet (register rows)
  Readings   -> cone/sack/reject sheet (register rows)
  ReasonSheet -> cone/sack/reject sheet (its own rows), plus a link back into
                 Readings (narrowed to the day + inspection-reject filter)

Wall (?s=wall): full-screen, no nav bar, no sheets. Esc / onExit -> ?s=line only.
Setup (?s=setup): one long page, 9 sections stacked (SyncHealthBlock, Line,
  Machines, Stations, Sources, Rules, Reject codes, People, Audit log) —
  Setup.tsx:53-61. No sub-tabs, no URL sub-anchors: a "Setup > People" link
  cannot be constructed.
```

There is **no route, button, menu item, or search** for anything outside this
tree. In particular there is no in-app way to discover `?s=wall`,
`?s=setup`, or `?s=health` other than the three specific controls named
above — no help menu, no "what's here" listing, no keyboard-shortcut hint.

### Discoverability failures

Ordered roughly by how much was built vs. how invisible it is.

1. **The changeover workflow — IFL's single most important requirement — is
   reachable over HTTP and invisible in the product.** `sms/api/src/routes/changeover.ts:9-37`
   exposes `GET /api/changeover/refs`, `POST /api/changeover/plan`, `POST
   /api/changeover/execute`, and the route file's own header comment states
   plainly: *"The service … has existed since roadmap Wave F with zero
   non-test callers; this file is what makes it reachable over HTTP"*
   (`changeover.ts:1-7`). A grep for `changeover` across `web/src` (confirmed
   directly) shows **zero** matches in `web/src/api.ts` beyond one unrelated
   comment about "before confirming a changeover" (`api.ts:331`) — there is
   no `getChangeoverRefs`, `planChangeover`, or `executeChangeover` wrapper
   at all, no screen, no button, no sheet. This is not a wrapper with no
   caller (§ below covers those, and they at least exist as typed functions)
   — it is a route with **no client representation whatsoever**. Per Hassan
   sb's 15 Sep 2026 answer, per-machine product changeover per shift is the
   key requirement, and the only way to exercise it today is a raw HTTP
   client against `/api/changeover/plan`.

2. **Eleven `api.ts` wrapper functions have no caller anywhere in the UI**,
   per the guard test's own `ALLOW_LIST` (`web/src/api.callers.test.ts:35-61`).
   Three are genuinely built-and-working features with no screen:
   - `getReconciliation` — `/api/reconciliation` (rank 3, `sms/api/src/routes/cone.ts:110`) is designed and working, not wired to Report (`api.callers.test.ts:37-38`).
   - `getDowntime` — `/api/downtime` computes the full stoppage list, hourly buckets, MTBF/MTTR and `availabilityPct`; only a small subset (`stoppageCount`/`stoppedSeconds`) reaches Report via a different route (`api.callers.test.ts:39-40`).
   - `getCalibrationRules` — the Nelson rule labels built for the Weight/StationSheet Details block have never been wired to a screen (`api.callers.test.ts:41-42`).
   The other eight are superseded wrappers on endpoints a richer wrapper
   already calls (`adminGetAudit`, `getRejects`, `getWeights`,
   `getCalibration`, `getCalibrationAdjustments`, `recordCalibrationAdjustment`,
   `getRejectSpc`, `getReport` — `api.callers.test.ts:45-60`) — those are not
   discoverability failures, they are dead code the test is holding open a
   grace window on.

3. **Health is one click, but the click is not shaped like a link.**
   `HealthLine` (`Bar.tsx:226-261`) renders the lag sentence as a `<button
   className="strip-link">` — visually it is a sentence describing data
   freshness ("Readings to 10:34 · they reach this system about 18 min after
   weighing. details"), and the word "details" is appended so the whole
   thing reads as clickable, but there is nothing in the nav bar itself, no
   icon, and no mention on any screen that this is how you check whether the
   sync/database/backups are healthy. A reader who has not been told this
   exists has to notice that one specific sentence in the strip is a button.

4. **Setup has no sub-navigation**, so within the single long page
   (`Setup.tsx:53-61`, nine stacked sections) there is no way to jump to
   "People" or "Audit log" without scrolling past Sync health, Line,
   Machines, Stations, Sources, Rules and Reject codes first. Compare
   `W.setupTabs` (`words.ts:498-508`), which still defines tab labels
   (`sync`, `line`, `machines`, `stations`, `sources`, `rules`,
   `rejectCodes`, `people`, `audit`) — a vestige of a tabbed design that no
   longer exists in the rendered page; nothing in `Setup.tsx` reads
   `W.setupTabs` as navigation, only as section labels passed to `Block`.

5. **Weight's station table has no route to that station's individual
   readings.** Clicking a station row opens `StationSheet` (daily means, an
   adjustment log, a projection) — never a filtered `Readings` view for that
   station. A reader who wants to see the cones behind a flagged station
   must manually reopen Readings and set the station filter themselves;
   nothing hands off the station id.

6. **`W.reports` question strings per report type exist but nine of ten
   report types have no independent URL** — see §5, this is also a
   discoverability problem in the "can a colleague be sent straight to it"
   sense: there is no `?s=report&type=sack` to type or bookmark; every
   report beyond the default (`daily`) requires knowing to click a chip
   after arriving on Report.

7. **The `AccountSheet` (change password) is reachable only through the user
   menu** (`Bar.tsx:196-198`), which itself is reachable only by clicking the
   initials avatar (`Bar.tsx:170-179`) — there is no visual affordance (no
   label, no "Account" word anywhere in the bar) suggesting that a circle of
   initials is a menu; this is a minor, common pattern (most apps do this)
   but is included for completeness since the task asks for "every major
   capability."

### What is *not* a discoverability failure, despite looking like one

- Wall and Setup each have exactly one control (Wall button; gear icon),
  which is a normal, findable affordance — not zero routes.
- The reject/product/station filters and reason-naming inline edit on
  Rejects are all visible on the Rejects screen itself once a reader is
  there; they are not hidden behind another screen.
- `EXPORT_RANK`/`ENGINEER_RANK` gating removes a button from a role that
  cannot use it (`App.tsx:67-78`), which is a deliberate application of the
  project's own rule ("a control a role cannot use is absent",
  `Bar.tsx:246-248`) — not a discoverability bug, though it does mean a
  viewer/engineer account literally cannot discover Export exists at all
  unless told in words outside the product.

---

## 5. Context-preservation failures

**Known case, confirmed:** the selected report type lives in
`Report.tsx:53` (`const [type, setType] = useState<ReportType>('daily')`),
and the file's own header comment states it outright: *"The report type
lives in this screen's own state, not the URL … App.tsx carries no report
parameter"* (`Report.tsx:21-23`). A report cannot be linked or bookmarked to
anything but the default `daily` type.

**The same class extends further than the type alone — the report's
filters are in the same unshared state.** `Report.tsx:54`:
`const [filters, setFilters] = useState<ReportFilters>({})` holds `shift`,
`station`, and `product`, set from three `<select>`s (`Report.tsx:139-186`).
None of these reach the URL. A manager who sets Report to "Machine/station"
type, filters to Station 7, and copies the link gets a colleague looking at
"Daily, no filter" instead.

Every other instance found, all in local component `useState` with no URL
representation:

| Screen | State kept out of the URL | `path:line` |
|---|---|---|
| Report | report `type` (documented in-code as deliberate) | `Report.tsx:53` |
| Report | `filters.shift` / `filters.station` / `filters.product` | `Report.tsx:54` |
| Readings | `listing` (cones / sacks / rejected / inspectionRejects toggle) | `Readings.tsx:105` |
| Readings | `station` filter | `Readings.tsx:112` |
| Readings | `states` (the cone-state chip filter: within/low/high/rejected/unknown) | `Readings.tsx:115` |
| Readings | `page` (pagination position) | `Readings.tsx:116` |
| Rejects | `station`, `product`, `code` (the Pareto-bar drill-down) — **explicitly justified in-code** as "a working narrowing of this screen, not a period a colleague should inherit from a pasted link" (`Rejects.tsx:92-94`) | `Rejects.tsx:95-97` |
| Weight | chart `mode` (time vs. distribution toggle) | `Weight.tsx:54` |
| Weight | `chartStation` (which station's stream the chart shows) | `Weight.tsx:58` |
| Sacks | `unit` (sacks vs. kg toggle for the ledger figures) | `Sacks.tsx:67` |
| Sacks | `page` (register pagination within Sacks' own reused table) | `Sacks.tsx:432` |

Only `Readings`' `outsideOnly`/`inspectionRejects` filter (`rf=` in the URL,
`App.tsx:89,95,105`) and the global `period`/`sheet`/`at` are genuinely
URL-derived. Everything above is lost on refresh, cannot be linked, and (for
Readings/Weight/Sacks/Report) is not deliberately scoped-out the way
Rejects' comment argues for its own filters — there is no equivalent
comment in Readings.tsx, Weight.tsx, Report.tsx, or Sacks.tsx explaining
why *their* local state is excluded, which suggests Rejects' choice was a
considered decision applied once and never re-applied to its siblings,
rather than a project-wide rule.

**Distinct sub-case — sheets vs. the screen under them.** Because `sheet` IS
in the URL (`App.tsx:56-58,103`), a link to e.g. `?s=weight&sheet=station:7`
correctly reopens Station 7's sheet — but if the sender had also picked
"distribution" mode and station 7 in Weight's own chart selector before
opening the sheet, none of that survives the link; the recipient sees
Station 7's sheet floating over Weight's *default* time-chart / whole-line
state, not the state the sender was actually looking at.

---

## 6. State-handling table

`usePolling` (`lib/live.tsx:35-84`) is the shared fetch hook: **38 call
sites** across 12 files (`Line.tsx` ×6, `Rejects.tsx` ×10, `Weight.tsx` ×5,
`Sacks.tsx` ×4, `Readings.tsx` ×3, `Report.tsx` ×3, `Wall.tsx` ×2,
`Health.tsx` ×1, `health/SyncHealthBlock.tsx` ×1, `report/PrintHead.tsx` ×1,
`report/Calibration.tsx` ×1, `report/Sack.tsx` ×1). It keeps the last good
`data` on error (`live.tsx:58-59` — sets `error` but never clears `data`),
which is what makes the `Failed`-with-stale-data branches below possible;
the calling screen still has to check `error && !data` itself in every
block, which is why compliance varies block-by-block rather than
screen-by-screen.

The two now-fixed "headline asserts zero production on a failed fetch"
defects the coordinator flagged (finding H14) are both in `Line.tsx`, and
both are fixed with an explicit code comment marking the fix:
- `Line.tsx:126-135` — the totals figures: `totals.error && !totals.data`
  now renders `<Failed>`; previously this block rendered an unending
  skeleton (per the comment, "indistinguishable from 'still loading'").
- `Line.tsx:142-157` — the attention list: `attention.error && !attention.data`
  now renders `<Failed>`; previously an empty findings array (which a failed
  fetch also produces) rendered `W.nothingNeedsAttention`, i.e. the calm
  "Nothing needs attention" state on a check that never ran — the comment at
  `Line.tsx:142-145` calls this out as "the worst instance found."

Both are fixed as of this HEAD; I looked for remaining instances of the same
pattern (an empty-array/zero fallback rendered without checking `error &&
!data` first) across every `usePolling` call site and found none — every
other site either checks `error && !data` explicitly before falling through
to an empty-state render, or its "empty" render is behind a `!data` check
that also catches the error case correctly (data stays `null` until a first
success). This appears to have been a swept, not a spot, fix — the same
`Failed error={...} onRetry={...}` pattern recurs at essentially every call
site (`Weight.tsx:135,224,228`; `Rejects.tsx:243-244,263-268,312-317,331-332,348-349`;
`Readings.tsx` register block; `Sacks.tsx:84-85`; `Report.tsx:195-198`;
`Setup.tsx` People block `91`).

| Screen / block | Loading | Empty | Failure | Notes |
|---|---|---|---|---|
| Line — totals figures | `SkelFigures` (`Line.tsx:134`) | zero-value figures render as "0" (deliberate — `periodFigures`, `Line.tsx:298-320`, "Zeros, not dashes: an empty period is a normal fact") | `Failed` w/ retry (`Line.tsx:130`) | fixed H14 instance |
| Line — attention | `SkelLines` (`Line.tsx:339`) | `W.nothingNeedsAttention` (`Line.tsx:341-345`) | `Failed` w/ retry (`Line.tsx:147`) | fixed H14 instance |
| Line — product block | `SkelLines` (`ProductBlock`, `Line.tsx:421`) | `W.product.none` (`Line.tsx:422`) | `Failed` w/ retry (`Line.tsx:167-168`) | |
| Line — machines running | `SkelLines` (`Line.tsx:181`) | `Empty` (`MachinesBlock`, `Line.tsx:463`) | `Failed` w/ retry (`Line.tsx:178-179`) | |
| Line — station grid | `SkelStations` (`Line.tsx:537`) | n/a (always renders configured stations) | `Failed` w/ retry, combined with `perStation` (`Line.tsx:194-201`) | |
| Line — last readings | n/a (part of `line`, gated by the screen-level `if (!line)`) | `Empty` (`Line.tsx:605`) | n/a — no separate poll | |
| Weight — figures | n/a (part of `st`, screen-level gate) | `'—'` dash rendering when `count===0`, explicitly distinguished from loading (`Weight.tsx:159-183`, comment at `Weight.tsx:315-320` on the `!s\|\|s.count===0` fix) | screen-level `Failed` before render (`Weight.tsx:135`) | |
| Weight — chart | `SkelChart` (`Weight.tsx:230`) | `Empty` (`Weight.tsx:232`) | `Failed` w/ retry (`Weight.tsx:224-228`, comment on fixed H14 instance: "used to fall through to 'Nothing recorded'") | fixed H14 instance |
| Weight — station table | n/a | `Empty` (`StationTable`, `Weight.tsx:500`) | covered by screen-level gate | |
| Rejects — headline/figures | inline `'…'` while `q`/`w` null (`Rejects.tsx:234-235`) | n/a | `Failed` w/ retry (`Rejects.tsx:243-244`) | |
| Rejects — station/product chip lists | n/a | chips simply don't render if list empty | `Failed` w/ retry (`Rejects.tsx:263-268`) | correctly distinguishes "list failed" from "no stations exist" |
| Rejects — trend chart | `SkelChart` (`Rejects.tsx:318-319`) | `Empty` (`TrendChart`, `Rejects.tsx:487`) | `Failed` w/ retry, three branches (quality/weight/coded) (`Rejects.tsx:312-317`) | |
| Rejects — reasons list | `SkelLines` (`Reasons`, `Rejects.tsx:633`) | `Empty` (`Rejects.tsx:634`) | `Failed` w/ retry (`Rejects.tsx:331-332`) | inline rename failure has its own `saveError` state, reported not swallowed (`Rejects.tsx:640-649`) |
| Rejects — by-day table | `SkelLines` (`Rejects.tsx:351`) | `Empty` (`ByDayTable`, `Rejects.tsx:713`) | `Failed` w/ retry (`Rejects.tsx:348-349`) | |
| Readings — register | `SkelLines` (implicit in table skeleton) | `Empty` message `W.readings.nothing` | `Failed` w/ retry (register block) | station/products lists fetched but no explicit failed-state citation captured for the station filter dropdown itself |
| Report — header/body | `ReportSkeleton` (`Report.tsx:287-301`, matches real shape: 4 figures, a chart, 7 table rows) | n/a — `coverageNone` sentence covers a genuinely empty period (`words.ts:457`) | `Failed` w/ retry (`Report.tsx:195-198`); separately, `!canRead` renders `W.reports.notAllowed` rather than `Failed` (a refusal, correctly distinguished) | |
| Sacks — summary figures | `SkelFigures` (`Sacks.tsx:87`) | `headlineNone` sentence when `s.totals.sacks===0` (`Sacks.tsx:72-73`) | `Failed` w/ retry (`Sacks.tsx:84-85`) | |
| Setup — People | `SkelLines` (`Setup.tsx:92`) | n/a (table renders whatever the API returns) | `Failed` w/ retry (`Setup.tsx:91`) — comment cites finding H14: "used to swallow a fetch failure into an empty user list … the opposite of true" | fixed H14-class instance outside Line |
| Health — database block | `SkelLines` (`Health.tsx:46`) | n/a | `Failed` w/ retry (`Health.tsx:43-44`) | |
| StationSheet | `SkelLines` (`StationSheet.tsx:110-111`) | `Empty` w/ `W.stationNotFound` (`StationSheet.tsx:112-116`, explicitly the finding-H13 fix: "loaded successfully, but no station with this id holds any readings … distinct from still loading") | **Bare `<p className="state err">` (`StationSheet.tsx:108-109`), NOT the shared `Failed` component — no retry button, and no refusal-vs-outage distinction (`Failed`'s own purpose, `bits.tsx:194-198`).** | inconsistent with the rest of the app |
| ReadingSheet | `Loading` (`ReadingSheet.tsx:110`) | n/a (a row always exists once loaded, or it's an error) | **Same bare `<p className="state err">{W.couldNotLoad}</p>` (`ReadingSheet.tsx:107-108`) — no retry, no refusal distinction.** | inconsistent with the rest of the app |
| ProductSheet | `SkelLines` (`ProductSheet.tsx:67`) | `W.product.none` (`ProductSheet.tsx:120`) | `Failed` w/ retry (`ProductSheet.tsx:64-65`) | correct |
| ReasonSheet | `Loading` (`ReasonSheet.tsx:121`) | `M.sheetEmpty` (`ReasonSheet.tsx:213-214`) | `Failed` w/ retry (`ReasonSheet.tsx:118-119`) | correct |
| StockSheet | `Loading` (`StockSheet.tsx:50`) | `S.sheetEmpty` (`StockSheet.tsx:58-59`) | `Failed` w/ retry (`StockSheet.tsx:47-48`) | correct |
| Wall | n/a — deliberately never shows a loading/empty/failure state; "It never blanks on failure … the last good figures stay and the footer carries the error" (`Wall.tsx:25-28`) | n/a | error surfaces only in the pinned footer | intentional, documented design, not an oversight |

**New finding (not previously documented in-repo):** `StationSheet.tsx` and
`ReadingSheet.tsx` are the only two sheets that bypass the shared `Failed`
component (`ui/bits.tsx:194-213`) in favour of a bare error paragraph. This
means (a) neither offers a retry button on failure — the reader must close
and reopen the sheet — and (b) neither benefits from `Failed`'s
refusal-vs-outage distinction (`bits.tsx:196-198`: a 403 reads as "This is
only available to an administrator" rather than "the plant connection may be
down"). Every other sheet and every screen-level block in the app was
migrated to `Failed`; these two were not.

---

## 7. Data-trust surfaces

Where the UI tells the reader the data's age, that a source is stale, that a
reading could not be judged, or that a figure is approximate:

- **The health strip**, present on every screen except Wall's own footer
  equivalent: three states (ok/stale/late), `HealthLine` (`Bar.tsx:226-261`),
  words in `W.lag` (`words.ts:79-95`) — states the actual measured lag
  ("about 18 min"), never a hardcoded guess.
- **Replay banner**: `App.tsx:246-251` — printed whenever `line.replay` is
  true, states the frozen instant and "This is not live", with a "Leave
  replay" link.
- **Per-cone "not judged"**: `W.cone.notJudged.*` (`words.ts:919-924`) —
  three reasons (`no_limits`, `implausible`, `no_weight`), each its own
  sentence, never collapsed to a bare dash.
- **The scale-vs-product disagreement banner** on Weight
  (`Weight.tsx:188-193`) and the attention-list finding on Line
  (`Line.tsx:405-406`, `W.disagreement`) — states the count of cones where
  the two verdicts disagree, with a link to see them.
- **Approximate sack↔cone linkage**: `W.readings.aroundSack`
  (`words.ts:323-324`) — "About N cones were weighed between the previous
  sack and this one (approximate; the plant records no link…)" — printed on
  the reading sheet only for sacks, never on a cone (per CLAUDE.md's own
  rule against presenting it as a packing list).
- **Weight basis unconfirmed**: `W.weight.headlineUnconfirmed`
  (`words.ts:333-334`) — states mean and target as two separate facts, not a
  difference, until Setup confirms the basis; used at `Weight.tsx:328`.
- **No sack stock per machine**: `W.report.noSackStock` (`words.ts:473-474`)
  and the Sacks screen's own "not available" rendering with the server's
  reason (per `Sacks.tsx` header comment, lines 16-19) rather than a blank
  or a fabricated per-machine figure.
- **Coverage-first reporting**: `Report.tsx:231-250`, `headline()` — always
  states how many of the requested days actually hold data before any
  total, with three distinct sentences (`coverageAll`, `coveragePartial`,
  `coverageNone`, `words.ts:453-457`).
- **Provenance disclosure**: `ReadingSheet.tsx` (behind `Details`), states
  source table, generation, plant insert time vs. system ingest time,
  transform version, attribution method — every field either printed
  verbatim from the server or `W.readings.prov.notAvailable`
  (`words.ts:307`), never reconstructed client-side.
- **Rejects "reasons not yet named"**: `W.rejects.namesAwaited`
  (`words.ts:434`) — shown as the block's own `note` (`Rejects.tsx:304`) only
  when at least one visible reason is unlabelled, never asserted
  unconditionally.
- **Projection sentences** (`StationSheet.tsx:294-303`, `Line.tsx:397-398`) —
  every drift projection is printed with its own assumption clause ("if it
  continues at that rate") inline in the same sentence, per
  `W.calibration.projection*` (`words.ts:1007-1017`), so the number cannot
  be quoted without the caveat.

**Places a figure is presented with more confidence than it deserves —
things to watch, not defects found:**
- Weight's "two standard deviations either side of the average" spread
  figure (`Weight.tsx:176-183`, `W.weight.spreadNote`, `words.ts:348`) is
  explicitly *not* claimed as "95% of cones fall here" — the code comment at
  `words.ts:343-348` states this was deliberately walked back from an
  earlier, wrong version. No outstanding over-claim found here.
- The Sacks headline states an "in-range %" (`Sacks.tsx:74`) computed the
  same way as every other in-range share in the app (server-side,
  `getSackSummary`); no local computation found that could disagree with
  the server's own figure.
- No remaining instance of a percentage or count computed independently on
  the client from a different population than the sentence around it was
  found in the six screens read in full (Line, Weight, Rejects, Report,
  Sacks, Readings) — the project's own commit history (`554f18b`, `c9f2de8`,
  `37f716b`) suggests this class of bug has had recent, active attention.

---

## 8. Density and layout observations

Structural observations from source, not a live-browser pixel audit (time
did not permit a full desk-vs-wall rendering pass in addition to the source
read; the below are what the code itself demonstrates or documents):

- **`Block` (`ui/bits.tsx:23-68`) enforces one visual pattern for every
  section — a label in a 180px left margin, a full-bleed rule, and a single
  wrapping `<div>`** — so density is structurally uniform across screens;
  there is no per-screen layout drift to catalogue the way there would be in
  an app with ad hoc section markup.
- **`Figures` caps at four items** (`ui/bits.tsx:94-104`, comment: "Never
  five: past four they stop being read") — a deliberate constraint that
  rules out the classic "wall of KPI tiles" density problem by construction.
- **Report.tsx:128-136** renders all nine report-type chips in one wrapping
  row with no grouping or hierarchy — a manager scanning for "Machine
  product" (the tenth type, added for IFL's changeover request) has to read
  all ten chip labels linearly; there is no visual distinction marking which
  types are most relevant to IFL's stated priority (changeover/machine
  product) versus the other nine.
- **Setup.tsx is one long page with nine stacked sections and no jump
  links** (`Setup.tsx:53-61`) — an admin who wants "Audit log" (the last
  section) must scroll past Sync health, Line, Machines, Stations, Sources,
  Rules, Reject codes and People first. On a screen at Wall's UI scale
  (`--ui-scale`, `Bar.tsx:133-149`) or on a laptop, this is a materially long
  scroll for a page with no anchor navigation.
- **The word-budget discipline documented in `words.ts:8-11`** (Line 60
  words, Wall 30, Report 100, Readings chrome 40, Weight/Rejects 120) is a
  real, checkable constraint the copy was written against — this is the
  opposite of a density problem and is called out because it appears to have
  been honoured: no screen's `words.ts` entries for its primary surface ran
  noticeably long in the sections read.
- **Weight's station table has ten columns**
  (`Weight.tsx:513-526`: Station, Average, Median, SD, vs line, vs target,
  Pattern, Rejects, "What the data shows") on a screen whose own header
  comment (`Weight.tsx:22-24`) insists on "no reduce-by-9g" single-fact
  rows — the table is information-dense by necessity (it is the one station
  ranking table CLAUDE.md rule 6 mandates), and at up to 14 rows × 10
  columns it is the densest table in the app; this looks like a considered
  trade-off (one table instead of three, per the file's own framing) rather
  than an oversight, but it is worth flagging as the single highest local
  information density in the product.

---

## 9. Client-vs-server rank mismatches

Comparing every client-side `rank >= N` gate (`App.tsx:228,265,275,295,305,
315,326,334,340,345`; `Report.tsx:67,110`) against every server-side
`requireRole(N)` (`api/src/app.ts`, `api/src/routes/*.ts`):

| Action | Client gate | Server gate | Match? |
|---|---|---|---|
| Register CSV/XLSX export | `EXPORT_RANK=3` (`App.tsx:71,275`) | `requireRole(3)` on `/api/events/export` (`app.ts:918`) | Match |
| Name a reject reason | `ENGINEER_RANK=2` (`App.tsx:78,295`) | `requireRole(2)` on `PUT /api/reject-codes/:id` (`app.ts:1010`) | Match |
| Record a sack movement | `ENGINEER_RANK=2` (`App.tsx:305`) | `requireRole(2)` on `POST /api/sacks/movements` (`sacks.ts:115`) | Match — but see note below |
| Log a calibration adjustment | `rank>=2` (`App.tsx:334`, `StationSheet canAdjust`) | `requireRole(2)` on `POST /api/calibration/adjustments` (`app.ts:1147`) | Match |
| Set the running product / change limits (PDAS-facing) | `rank>=2` (`App.tsx:265,340`) | `requireRole(2)` on `POST /api/current-product` (`app.ts:1248`) | Match |
| Local (non-PDAS) product-limits edit, `ProductLimitsBlock` | server-driven — the block asks `/api/product-write/status`-equivalent and decides its own visibility rather than trusting a client constant (`ProductLimitsBlock.tsx:3-4,99` comment) | `requireRole(2)` on `POST /api/products/limits/local` (`cone.ts:70`) | Match by design — this is the one control explicitly built to never hold a client rank constant, specifically to avoid the mismatch class |
| Setup screen / admin gear icon | `rank>=4` (`Bar.tsx:320-324`, `App.tsx:315`) | `requireRole(4)` on every `/api/admin/*` route (`app.ts:1426-1792`) | Match |
| Report — management summary | `REPORT_MIN_RANK['management-summary']=3` (`report/model.ts:34`) | not directly confirmed against a specific `requireRole(3)` line for `/api/reports/management-summary` in this pass (report routes were not individually greped for `requireRole`) — **flag for follow-up**, not a confirmed mismatch | Unverified |
| Changeover plan/execute | **No client gate exists at all — no UI calls this endpoint** | `GET /api/changeover/refs` rank 1; `POST /api/changeover/plan` rank 1; `POST /api/changeover/execute` rank 2 (`PDAS_WRITE_RANK`) (`changeover.ts:9-37,161`) | N/A — not a mismatch, a total absence (§4 finding 1) |

**One stale-documentation instance found, not a functional mismatch:**
`Sacks.tsx:53` documents `canRecord` as *"Rank 3 — the developer's default
until IFL sets the rank for a stock entry"*, but the actual value passed by
`App.tsx:305` is `ENGINEER_RANK` (2), matching the server's `requireRole(2)`
correctly per IFL's 15 Sep 2026 Q43 answer (as `App.tsx:299-301`'s own
comment states). The code is correct; the comment inside `Sacks.tsx` was not
updated when the rank moved from 3 to 2, and would mislead a future reader
of that file specifically.

No case was found in this pass of the client gate being **more permissive**
than the server (i.e., a button shown to a role the server would 403) —
every client-side constant checked traces to a comment citing the matching
server route, which is consistent with the project's own stated rule
("a control a role cannot use is absent", `Bar.tsx:246-248`) having been
actively maintained.

---

## Summary counts

- **Screens (routed views):** 9 total — 6 in the nav bar (Line, Readings,
  Weight, Rejects, Sacks, Report), 3 reachable only by a single specific
  control each (Wall, Setup, Health).
- **Sheets:** 7 `Sheet['kind']` values across 5 components (`ReadingSheet`
  covers 3 kinds), plus 1 unrouted drill-down (`AccountSheet`) = 6 drill-down
  components total.
- **Orphaned components:** 0 (every one of 43 non-test `.tsx` files has at
  least one importer).
- **Discoverability failures:** 7 distinct instances documented in §4 —
  headlined by the changeover workflow (a fully-built, IFL-priority feature
  reachable only by hand-crafted HTTP calls) and the 11-wrapper
  `ALLOW_LIST`, of which 3 are genuine unwired features (`getReconciliation`,
  `getDowntime`, `getCalibrationRules`).
- **Context-preservation failures:** 10 distinct pieces of screen state
  found living outside the URL across 5 screens (Report ×2, Readings ×4,
  Rejects ×1 group, Weight ×2, Sacks ×2) — the report-type case is one of
  ten, not the only one.
- **State-handling gaps:** 0 remaining instances of the "headline asserts
  zero/calm on a failed fetch" class (both prior instances, in Line.tsx, are
  fixed and comment-marked); 2 sheets (`StationSheet`, `ReadingSheet`) still
  bypass the shared `Failed` component and so offer no retry button and no
  refusal-vs-outage distinction on failure.

## The three things I would fix first

1. **Give the changeover workflow a screen.** It is IFL's stated top
   priority, the service and three routes already exist and are tested
   server-side, and today the only way to use it is a raw HTTP client. This
   is the largest gap between "built" and "shippable" in the entire audit.
2. **Put Report's `type` and `filters` in the URL**, the same way `sheet`
   and `period` already are. This single change closes the headlined
   context-preservation defect and three of its siblings (`shift`,
   `station`, `product` filters) in one pass, since they are read from the
   same component state object.
3. **Wire the three genuinely-orphaned-but-working endpoints to a screen or
   remove them from the promise the tests keep re-affirming.**
   `getReconciliation`, `getDowntime`, and `getCalibrationRules` each answer
   a real question (data-quality reconciliation, full downtime/MTBF detail,
   named Nelson rules) that a manager or engineer would plausibly ask for,
   and the guard test (`api.callers.test.ts`) is explicitly designed to keep
   surfacing them as a written decision every time it runs rather than let
   them rot silently — that decision (wire vs. delete) is overdue.
