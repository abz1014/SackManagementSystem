# Friction audit — hidden, truncated, defeated or buried content

Investigator pass, 23 Sep 2026, against the running app at `http://localhost:5173`
(session already signed in, admin/manager-rank account — not created by me).
Primary viewport **1366×768**; a couple of items re-checked in the DOM/JS
console rather than by eye where clicking became unreliable (noted below).
Scope: the class of defect the owner flagged — *the interface hides,
truncates, defeats or buries something instead of reporting it* — excluding
the Weight station table and the `overflow-x` sweep (assigned elsewhere) and
chart size/count on Sacks/Line/Health (assigned elsewhere).

**Concurrent editing note:** Weight, Sacks, Line and `app.css` are stated as
being under active edit by other workers while this pass ran (23 Sep 2026,
approx. 11:15–11:35 local). Everything below is what I observed at that time,
with file:line — if a finding is already fixed by the time this is read, the
line numbers will have moved and that is why.

---

## Finding 1 — Opening ANY reading/station/reason sheet remounts the whole
screen and briefly shows an impossible, false-zero headline

**CONFIRMED**, reproduced twice.

**What I did:** Readings screen, period "This month" (`2026-09-01` to
`2026-09-23`), 1366×768. Waited for the real headline to settle
(`149,492 weighed, 402 rejected by the scale (0.3%)`), then clicked a row to
open its detail sheet.

**What I saw:** The instant the sheet opens, the headline behind it changes
to **`0 weighed, 0 rejected by the scale (0%)`** — and on the first
repro, closing the sheet again produced a worse, self-contradictory
in-between state: **`0 weighed, 402 rejected by the scale (0%)`** (zero
weighed but 402 rejected, at a stated rate of 0%). Both clear after roughly
1–2 seconds as the real numbers reload. This is not a failed fetch — the API
never errors — it is the screen actually discarding its own data on every
sheet open/close.

**Root cause (read, not guessed — traced from the symptom to the code):**
`web/src/App.tsx:425` builds `screenKey` from `route.view` **and
`route.sheet`**:
```
const screenKey = `${route.view}:${route.sheet ? `${route.sheet.kind}:${route.sheet.id}` : 'none'}`;
```
`web/src/App.tsx:455` keys the `<ErrorBoundary>` wrapping every screen on
this value: `<ErrorBoundary key={screenKey} ...>`. React remounts everything
inside on any key change — so opening or closing *any* sheet (a reading, a
station, a reject reason, a stock day — every one of `onOpenReading`,
`onOpenStation`, `onOpenReason`, `onOpenDay` across Line, Readings, Sacks,
Rejects, Product and Health, all of which call `go({ sheet: {...} })`)
remounts the current screen from scratch. `usePolling`
(`web/src/lib/live.tsx:61-81`) initialises `data` to `null` on mount, so every
number on screen falls back to its zero default for one fetch cycle —
`web/src/screens/Readings.tsx:177-178`
(`const total = rows.data?.data.total ?? 0;`) and the percentage at
`Readings.tsx:352` (`total > 0 ? ... : '0%'`, so 0 weighed always prints
`0%` regardless of what `rejected` holds).

The remount is deliberate — the comment above it (`App.tsx:421-424`) says
it exists so leaving a **crashed** screen via the Bar clears the crash
without a hard reload. It was not written with sheets in mind; a sheet
opening is not a screen change and is not a crash, but it pays the same
remount cost.

**Why it matters:** this is the exact class of defect CLAUDE.md's
reliability rule targets — a state the screen asserts that isn't true — just
self-inflicted rather than fetch-triggered. A worker who taps a cone in the
register to see its detail sees the shift's totals flash to zero (or to an
arithmetically impossible combination) behind the drawer they just opened.
It happens on every single drilldown across six screens, several times a
minute of real use.

**Fix size:** small–medium. Drop `route.sheet` from `screenKey` (a sheet is
an overlay, not a distinct screen — it doesn't need its own remount boundary),
or keep the ErrorBoundary keyed on `route.view` alone and let the sheet
overlay unmount independently. No API change.

---

## Finding 2 — Sacks "By product" table collapses different products into
identical, unlabelled rows with contradictory stats

**CONFIRMED** — reproduced on screen and independently confirmed by a React
console warning (55 occurrences captured).

**What I did:** Sacks screen, period "This month", 1366×768
(`http://localhost:5173/?s=sacks&p=month`).

**What I saw:** the "By product" table prints **six separate rows all
labelled `205-IL0-SD`**, with materially different stats and no way to tell
them apart:

| Product (as shown) | Sacks | Within range |
|---|---|---|
| 205-IL0-SD | 344 | **78.2%** |
| 205-IL0-SD | 335 | 96.1% |
| 205-IL0-SD | 79 | 94.9% |
| 205-IL0-SD | 40 | 100.0% |
| 205-IL0-SD | 26 | 96.2% |
| 205-IL0-SD | 18 | **27.8%** |

A reader has no way to know these are six different underlying products
(almost certainly six different `MaterialId`s from the plant's
retire-and-recreate pattern CLAUDE.md already documents for PDAS) rather than
one product with noisy stats — and the worst-performing group, 27.8% within
range, is indistinguishable on screen from the best, 100%.

**File:line:** `web/src/screens/Sacks.tsx:110-111` —
```
rows={s.byProduct.map((r) => ({ label: r.productName ?? (r.materialId == null ? W.sacks.noProduct : `Product ${r.materialId}`), ...r }))}
```
falls back to a synthetic `Product ${materialId}` label only when
`productName` is null; when the API *does* return a name, nothing
disambiguates two rows that share it. `Sacks.tsx:198` then keys the row on
that same non-unique label: `<tr key={r.label}>`.

**Independent confirmation:** the browser console shows the resulting React
defect directly — 55 instances of `Warning: Encountered two children with
the same key, 205-IL0-SD ... at GroupTable (Sacks.tsx:270:3)`, i.e. React
itself is warning that rows may be silently duplicated or dropped on
re-render, which is the mechanical symptom of the same root cause.

**Fix size:** small for the key/crash-risk half (key on `materialId` instead
of `label`); the informational half (telling two same-named products apart)
needs the API to also return `materialId` per `byProduct` row if it doesn't
already — flagging, not designing.

---

## Finding 3 — Line headline states a fixed shift regardless of the period
selected (previously known; reconfirmed live, unfixed as of this pass)

**CONFIRMED**, reproduced.

**What I did:** Line screen, switched the period control from "This shift"
to "This month", 1366×768, 23 Sep 2026 ~11:28 local.

**What I saw:** the big red/black headline still reads **"Morning shift,
6:00 AM to 2:00 PM."** under a 23-day period selection — the four KPI
figures below correctly reflect the whole month (149,492 cones etc.), so the
screen states two different time scopes in the same sentence.

**File:line:** `web/src/screens/Line.tsx:270-283`, the `Headline` function —
`shiftName`/`from`/`to` come from `line.shift` (today's live shift, via
`useLive()`), never from the `period` prop the rest of the screen uses. This
is the same defect CLAUDE.md already names ("the Line headline says 'Morning
shift' under a 7-day pick") — I list it here only because it is still
present, reproduced fresh in this session, not because it is new.

**Fix size:** small–medium: the headline needs a period-aware branch (only
name the shift when the selected period actually is "this shift"), which
touches the same function three other status branches (`running`/`stopped`/
`idle`) also use.

---

## What I checked and found FINE

- **Readings drilldown sheet itself** (`web/src/screens/Readings.tsx`, sheet
  content): weight, product-in-force, station, record id, and two working
  links ("See this product's report", "See this product in the catalogue")
  plus an expandable "Where this reading came from" — nothing hidden,
  nothing dead-ended, confirmed by opening one on `This month`.
- **Rejects screen** (`?s=rejects&p=month`): the "not yet named" reason
  state is intentional and self-explanatory ("Reason names have not been
  supplied yet. A manager can name a code here; the name applies to
  history."), not a bug — matches the documented open question on reject
  code meanings (Q10).
- **Product › Changeover form**: reachable, scrolls to a working "Check the
  plan" action and a "Why is this changing? (required)" validation note;
  the tube-type picker now offers "Add" (matches the 21 Sep 2026 CLAUDE.md
  entry that lifted the existing-only restriction) — confirmed present for
  Blend, Count and Tube type alike.
  Not fully verified end-to-end: I could not reliably drive a full plan→
  execute cycle this pass (see note below), so I cannot confirm the plan
  step's own output rendering; the form's static content and scroll-reach are
  fine as far as I got.
- **Setup / Health screens' sync-health block**: correctly states "The plant
  connection has not delivered anything recently" rather than silently
  showing zeros, with last-successful-pass time, oldest table, and a
  blocking-findings count — this reads as the Phase 7 reliability fix working
  as designed, not a defect.
- **Health's data-quality findings table**: the long "Source row" explanation
  text ("The source row cannot be identified for this finding: this system
  does not record whether...") looked cut off in a screenshot but is **not**
  truncated — `get_page_text` confirms the full sentence is present in the
  DOM; it simply wraps across several lines and my screenshot's viewport
  ended before the wrap finished. Not a defect.
- **Top nav bar at 1366px**: all seven items (Line, Readings, Weight,
  Rejects, Sacks, Product, Report) plus period controls, Wall and Setup are
  present in the accessibility tree (`read_page`) even in a screenshot where
  "Product" rendered visually as "Prod." — that abbreviation is a rendering/
  scaling artifact of the screenshot tool at reduced scale, not a truncation
  in the real DOM (confirmed via `read_page`, which returns the full string
  "Product" as the button's accessible name).

## A tooling caveat, stated plainly

For roughly the second half of this session, coordinate-based clicks in the
Browser pane started landing on the wrong nav item (e.g. a click aimed at
"Product" registering on "Report" or "Health" one tab-width in either
direction, apparently after a screen change shifted the pixel grid the tool
was still using). I worked around it with `read_page`/`find`-sourced refs and
direct URL navigation (`?s=<screen>&pt=<tab>&p=<period>`) wherever possible,
but it means my walk of Product's Running/Catalogue/History tabs and of every
Report type was **not completed** this pass — Product › Changeover and
Report › Daily are the only two of those I managed to verify directly. This
is a tooling limitation on my end, not an app defect, but it does mean the
brief's "walk every screen" instruction is only partially fulfilled: Line,
Readings, Weight, Sacks, Rejects, Health, Setup and Product › Changeover are
covered; Product's other three tabs, Wall, and eight of the nine Report types
are not.

---
---

# Second pass — Reports, Wall, Product (23 Sep 2026)

Investigator pass 2, 23 Sep 2026 ~11:38–12:05 local, against the running app
at `http://localhost:5173` (session already signed in; no account created,
reset or guessed). Primary viewport **1366×768**, Wall re-checked at
**1920×1080**. Scope: exactly the gap pass 1 declared — **all ten report
types** (the nav offers ten, not nine: the tenth, *Product by machine*, was
added on IFL's 15 Sep answer to Q28 — see `web/src/screens/Report.tsx:1-32`),
**Wall**, and **Product › Running / Catalogue / History**. I did not re-audit
Line, Readings, Weight, Sacks, Rejects, Health, Setup or Product › Changeover.

**Method note.** Coordinate clicking was avoided entirely after pass 1's
report of drift: every screen below was reached by URL (`?s=`, `?rt=`, `?pt=`,
`?p=pick&from=&to=`) in a tab of my own, and every observation is from
`get_page_text` / `read_page` / DOM measurement rather than from a screenshot.
The screenshot tool in this pane renders the app at a visibly wrong scale, so
no finding below rests on a screenshot.

**Working condition, stated so no number below is misread.** The sidecar
pools simulator data (epoch 13) with real IFL data (epoch 9), and
`api/src/routes/reports.ts:100`'s `newestProductionDay` returns a simulator
day. **Every report below was therefore opened with an explicit period,
`?p=pick&from=2026-08-05&to=2026-09-07`**, stated again per finding. I have
deliberately NOT reported "the totals look wrong" — pollution is known and
owned elsewhere. Everything below is a defect in the screen, the export or
the words, not in the denominator.

---

## Finding 4 — "vs line" and "Mean" are computed over different populations and disagree in SIGN on 5 of 14 stations, on three report types and in the CSV

**CONFIRMED.** Observed on two separate report screens showing the same rows,
and re-derived arithmetically from the API payload.

**What I did:** Report › Machine / station and Report › Cone weight, both at
`?p=pick&from=2026-08-05&to=2026-09-07`, 1366×768, ~11:41 local. Read the
station table on each, then fetched `/api/reports/station?from=2026-08-05&to=2026-09-07`
and computed `meanG − lineMeanG` for every row.

**What I saw:** the table prints a station's period `Mean` and its `vs line`
side by side, and they contradict each other. Line mean is 1951.5 g.

| Station | Mean (col 3) | implied vs line | `vs line` as printed |
|---|---|---|---|
| 3 | 1952.6 g (**above**) | +1.02 | **−0.3 g** |
| 5 (East Conveyor) | 1951.9 g (above) | +0.31 | **−0.7 g** |
| 9 | 1950.5 g (below) | −1.02 | **−0.7 g** |
| 11 | 1950.4 g (**below**) | −1.18 | **+1.2 g** |
| 14 | 1952.3 g (**above**) | +0.77 | **−0.4 g** |

Five of fourteen rows carry the wrong sign relative to their own Mean column;
the other nine disagree in magnitude by up to 1.2 g. On Report › Cone weight
the table is *sorted by* `vs line`, so the contradiction is unmissable: the
list runs −2.6, +1.8, +1.6, +1.2, −1.1 … while the Mean column beside it does
not descend at all.

**Root cause (read, not guessed):** `api/src/services/weightStations.ts:308`
— `vsLineG: round(runMean - lineMeanG)`. `runMean` is the mean over the
station's most recent **consecutive-drift run** (`daysHeld` days — 1, 2, 3, 7,
15 in this period), not over the period. `meanG` is the period mean
(`st.grandMean`). Two different populations, adjacent columns, no label saying
so. `vsTargetG` at `weightStations.ts:288` has the same basis.

**Where it renders:** `web/src/screens/report/Station.tsx:85`,
`web/src/screens/report/ConeWeight.tsx:75`,
`web/src/screens/report/Calibration.tsx:100` — three of the ten report types.
It is also in the export: `vs_line_g` in the Calibration CSV carries `'-0.31`
for station 3 whose `mean_g` is 1952.56 against a line mean of 1951.54. The
Station report's deviation **bar chart** is drawn from the same `vsLineG`
(`Station.tsx:31`), so the picture is wrong the same way.

**Why it matters:** this is the calibration requirement's core table. A
process engineer reading "Station 11 is +1.2 g above the line" and then
reading "Station 11 mean 1950.4 g, line 1951.5 g" two columns away has been
handed two opposite conclusions about which way to adjust a scale, on the one
page whose output leaves the building.

**Fix:** either print the run mean in the Mean column (and say the run's
length), or compute `vsLineG` from `grandMean` and keep the run mean for the
flag test only; whichever, label the basis. **Size: small in code, but it is a
semantics decision — flag to the owner, do not pick silently.**

---

## Finding 5 — Report › Calibration silently drops the only adjustment row; the CSV for the same period contains it

**CONFIRMED.** The highest-value class the brief asked for: the export and the
screen disagree, and the screen is the one that is wrong.

**What I did:** Report › Calibration,
`?s=report&rt=calibration&p=pick&from=2026-08-05&to=2026-09-07`, 1366×768,
~11:44 local. Read the page, counted `tbody` rows in the DOM, then fetched
both the report JSON and the CSV export.

**What I saw:** the station table's *Adjustments* column shows **1** for
Station 7 and *Last adjusted* `03/09/2026, 16:56:07` — inside the period. The
block below, headed **"Adjustments in the period"**, renders its five column
headers (When / Station / Amount / Reason / By) and **zero rows, with no
message of any kind**. DOM check:
`[...document.querySelectorAll('table')].map(t => t.querySelectorAll('tbody tr').length)`
→ `[14, 0]`.

The CSV for the identical period **does** carry it:

```
adjustment,7,,,,,,,,,,,4,2026-09-03T11:56:07.499Z,,verification test - reference weight checked,,Plant Admin
```

**Root cause:** a **type mismatch between two routes**.
`/api/reports/calibration` returns `adjustmentId: 4` (number);
`/api/calibration/adjustments` returns `adjustmentId: "4"` (string) — both
verified by fetching them. `web/src/screens/report/Calibration.tsx:127-130`
builds `own = new Map(d.adjustments.map(a => [a.adjustmentId, a]))` (number
keys) and filters the richer route's rows with `own.has(a.adjustmentId)`
(string) — always false, so `rich` is `[]`. The empty-state guard one line
later, `Calibration.tsx:137`, tests `d.adjustments.length === 0` — the
*report's* ledger, which is non-empty — so the "No adjustments were logged"
message never fires and the table renders headers over nothing.

The file's own header comment (`Calibration.tsx:5-11`) states the intent
exactly: "the page never prints an empty table because a route was not there".
It does.

**Fix:** coerce both sides to one type in the `own` map (e.g. `String(...)`),
and make the empty guard test the rows actually about to be rendered
(`(rich ?? d.adjustments).length === 0`), not `d.adjustments`. **Size: small
(two lines), but it needs the API's id type settled so it cannot recur.**

---

## Finding 6 — The cone-weight / station / calibration target is a limits version that took effect FOUR DAYS AFTER the period, printed as if it were in force during it

**CONFIRMED.** Verified from the API payload, not inferred from the screen.

**What I did:** Report › Cone weight, `?p=pick&from=2026-08-05&to=2026-09-07`,
1366×768, ~11:43 local.

**What I saw:** under the mean figure, `target 1960.0 g (201-IH0-SD) · in
force since 11/09/2026, 20:03:15` — **11 September**, for a period that ends
**7 September**. The caption directly beneath it says: *"The target is the
line-wide product in force at the END of this period, from the same versioned
limits the station table below uses — never today's product applied backwards
over the whole period."* The payload:

```
{"setpointG":1960,"productId":12,"label":"201-IH0-SD",
 "inForceAtUtc":"2026-09-11T15:03:15.957Z",
 "limitsChangedInPeriod":0,"source":"in_force_at_period_end"}
```

It declares `source: 'in_force_at_period_end'` while carrying an instant after
the period end.

**Root cause:** `api/src/services/productLimits.ts:145-152` — `versionAt`
correctly finds no version with `effectiveFromMs <= tsMs` (product 12's only
version begins 11 Sep), so it falls back to the oldest version **and marks it
`effectiveIsLowerBound: true`**, which is the honest, documented behaviour.
But `api/src/services/weightStations.ts:196` reads only `.effectiveFromUtc`
off that result and **drops the `effectiveIsLowerBound` flag**;
`api/src/services/reports/coneWeight.ts:144-146` then publishes the date as
`inForceAtUtc` with `source: 'in_force_at_period_end'`. The lower bound is
lost between the two layers.

**Why it matters:** this is the §8 rule — *a reading is judged by the limits
in force at its own time, never by today's mirror* — being broken on the three
screens that most loudly claim to honour it. The Phase 5 guard
(`web/src/targets.guard.test.ts`) requires a `target` to state an
`inForceAtUtc`; it does not check that the instant precedes the period, so the
guard passes.

**Fix:** carry `effectiveIsLowerBound` through `weightStations.ts:196` into
the report target, and render it as the Catalogue already renders the same
case — *"no later than Fri 11 Sept 3:03 PM"* (`?s=product&pt=catalogue` uses
exactly that wording) — or drop to `source: 'none'`. **Size: small–medium; the
guard test wants extending too.**

---

## Finding 7 — Product, Sack and Management-summary CSVs collapse six different products into six rows all named `205-IL0-SD`; the screen does not

**CONFIRMED.** Screen-vs-export disagreement number two, and the mirror image
of pass 1's Finding 2: here the screen is right and the exported file is not.

**What I did:** Report › Product at `?p=pick&from=2026-08-05&to=2026-09-07`,
1366×768, ~11:40 local; then fetched `/api/reports/product/export` for the
same period.

**What I saw on screen:** six distinguishable rows —
`205-IL0-SD · Star Green · PVSD8020 · 18`, `· Blue · PVSD8020 · 36`,
`· ORANGE · PVSD8020 · 30`, `· PVSD8020 · 50`, `· ORANGE · PVSD8020 · 20 Slub`,
`· YELLOW · PVSD8020 · 36 Slub`.

**What the CSV that reaches IFL contains:** six rows whose `product` column is,
verbatim, `205-IL0-SD`, `205-IL0-SD`, `205-IL0-SD`, `205-IL0-SD`, `205-IL0-SD`,
`205-IL0-SD`. Only the numeric `product_id` (20, 21, 1021, 1022, 1023, 1024)
tells them apart, and that is a PDAS surrogate key no reader of a spreadsheet
can decode.

**Root cause:** the disambiguation is **client-side only**.
`api/src/services/reports/product.ts:140` sets `productLabel` to the bare
`catalogue.product(productId)?.label`; `productCsv` (same file, ~:182) writes
that field straight out. The screen adds the differing parts in the browser:
`web/src/screens/report/Product.tsx:15-16` via `distinctProductLabels`. The
same split exists on `web/src/screens/report/Sack.tsx:24,73` (the "By product"
block, whose CSV has the same flaw) and
`web/src/screens/report/Summary.tsx:35,138`.

**Fix:** move `distinctProductLabels` server-side, or have the CSV writer
append the differing attributes. **Size: medium — three report types and a
shared helper, and it needs the API to expose what the client uses. Note it,
do not design it here.**

---

## Finding 8 — Report › Product asserts "0 … carry no product" above a table showing 6,200 of 11,634 sacks with no product

**CONFIRMED.**

**What I did / period / viewport:** as Finding 7.

**What I saw:** the coverage sentence, printed *first, before any figure*, on
the screen whose whole purpose is attribution:

> "0 of 267,798 cone readings and 0 of 9,180 rejects in this period predate
> product recording and carry no product."

Fourteen lines below, the table's last row: **`No product on the reading |
Sacks 6,200`** — 53 % of the period's 11,634 sacks. The Sacks column in the six
product rows sums to 5,434; 5,434 + 6,200 = 11,634.

**Root cause:** `api/src/services/reports/product.ts:158-167` computes
`unattributed.sacks` and `unattributed.ofSacks` and returns them.
`web/src/screens/report/Product.tsx:27-29` calls
`W.reports.unattributedSentence(...)` with **cones and rejects only**; the
string at `web/src/lib/words.ts:1729` takes four arguments and has no sack
clause. A sack-specific sentence already exists and is used elsewhere —
`words.ts:1566`, `"${n} of ${of} sacks in this period carry no product."`

**Fix:** pass `u.sacks` / `u.ofSacks` and append the existing `words.ts:1566`
sentence. **Size: small.**

---

## Finding 9 — Product › Running says "Products in force now … in the last 2 hours of plant time" from readings 23 hours old, and never states the as-of

**CONFIRMED.**

**What I did:** `?s=product&pt=running`, 1366×768, ~11:47 local; then fetched
`/api/machines/running` and `/api/live`.

**What I saw:** a block headed **"Products in force now"**, fourteen stations
each "for at least 2 h · 42 cones", and a footer reading **"from each machine's
newest cones in the last 2 hours of plant time"**. No date, no as-of, no
staleness caveat anywhere on the tab.

The payload: `asOfUtc: 2026-09-22T12:29:22Z`,
`windowStartUtc: 2026-09-22T10:29:22Z` — **yesterday**. `/api/live` at the same
moment: `plantNowUtc 2026-09-23T11:46Z`, `health.kind: "stale"`,
`ageSeconds: 82743` (23 h). The last two hours *of plant time* (09:46–11:46
today) hold zero cones; the window is the last two hours **of data**. The
footer sentence is therefore not merely unqualified, it is false as written.

**File:line:** `web/src/lib/words.ts:274` (`runningNow: 'Products in force
now'`), `words.ts:1431` (`machinesWindow: 'from each machine's newest cones in
the last 2 hours of plant time'`), rendered at
`web/src/screens/product/Running.tsx:98`. `asOfUtc` is in the payload the
component already holds and is rendered nowhere.

**Cross-screen corroboration (not a Product finding, recorded because I saw it
while checking agreement):** on Line at the same moment, the "Stations — cones
this period" block shows all fourteen stations **"0 · quiet"**, while the
"What is being made" block *immediately beneath it on the same screen* shows
the same fourteen stations running with 34–51 cones each. Two blocks, one
screen, opposite statements about the same fourteen machines. Line is outside
my scope and another worker holds it — passing it on, not writing it up.

**Fix:** print the as-of the payload already returns, and reword
`words.ts:1431` to "in the two hours before the newest reading". **Size:
small.**

---

## Finding 10 — Wall reports a 23-hour-old feed as a bare clock time, with no date, on an unattended TV

**CONFIRMED at 1920×1080**, the brief's stated Wall condition.

**What I did:** `?s=wall`, viewport set to 1920×1080, ~11:46 local; read the
page text and fetched `/api/live`.

**What I saw, and what is genuinely good:** the headline is **"Cannot tell
whether the line is running"** — large, red, unambiguous, and correct. The
three big figures below it (0 cones, 0 sacks · 0 kg, 0 rejected) are the
current shift's true counts, not a failed fetch rendered as zero. Phase 7's
rule holds here.

**The defect:** the footer reads **"No new readings since 12:29 PM — the plant
link may be down."** and **"Last sack 47.18 kg 12:42 PM · Last cone 1,951 g
12:29 PM"**. There is **no date anywhere on the screen**. The actual last cone
is `2026-09-22T12:29:22Z` — yesterday, `ageSeconds: 82743`. From across a room,
"since 12:29 PM" on a screen whose own clock reads 11:45 AM reads as *this
morning was fine, we're an hour or two behind*. It is a day.

**File:line:** `web/src/screens/Wall.tsx:272` —
`W.lag.stale(fmtClock(health.readingUtc))`; `Wall.tsx:238-240` — the same
`fmtClock` for last sack and last cone. `fmtClock` is time-of-day only. The
string is `web/src/lib/words.ts:96`.

**Fix:** on Wall, when the age exceeds one shift, print the elapsed duration
("no new readings for 23 hours") or a dated instant, rather than a clock time.
**Size: small.** *(This is the one place in the app where a bare clock is
actively dangerous: every other screen has a reader close enough to question
it.)*

---

## Finding 11 — Report › Calibration's headline says "0 stations flagged" over a column reading up to 21 flagged days out of 34

**CONFIRMED.**

**What I did / period / viewport:** Report › Calibration,
`?p=pick&from=2026-08-05&to=2026-09-07`, 1366×768, ~11:44 local.

**What I saw:** the block headline — `0 stations flagged for drift · Line mean
1951.5 g · target 1960.0 g (201-IH0-SD)` — above a table whose **Days flagged**
column reads 21/34 (Station 11), 20/34 (Station 12), 18/28 (Station 9), 17/30
(Station 6), 15/34, 14/34, 13/34, 13/28 … and whose **Flagged** column is `—`
on all fourteen rows. The explanatory paragraph defines what *Flagged* means
(a pattern test inside a run of at least `minDaysHeld` days, at least
`thresholdG` away) but never says what *Days flagged* counts or why a station
can have 21 of them and still not be flagged.

**File:line:** `web/src/screens/report/Calibration.tsx:42`
(`W.reports.stationsFlagged(d.flaggedStationCount)`) against
`Calibration.tsx:104` (`{s.daysFlagged} / {s.daysWithData}`).

**Fix:** one clause in the caption distinguishing "days a test fired" from
"flagged now (the run is still open)". **Size: small, wording only.** I am not
claiming either number is wrong — only that the page does not let a reader
reconcile them.

---

## Finding 12 — Management summary states a **+2,117.8 %** improvement that is an artefact of product attribution not existing in the prior period

**CONFIRMED.**

**What I did:** Report › Management summary,
`?p=pick&from=2026-08-05&to=2026-09-07`, 1366×768, ~11:45 local. The screen
itself chose the comparison period: 2 Jul – 4 Aug 2026.

**What I saw:**

| Figure | This period | Period before | Change |
|---|---|---|---|
| Within product limits · higher is better | 99.8 % | **4.5 %** | **+95.3 (+2117.8 %)** |

The prior period's own "Products run" table, on the same page, shows **`No
product on the reading — 67,044`** and one cone of `STR-RED`. There was no
product on those readings, so nothing could be "within product limits"; 4.5 %
is the absence of attribution, not a quality level. The page suppresses exactly
this distortion for the count KPIs — nine rows read "not comparable", with a
correct explanation ("Prior period covers 10 of 34 days with readings…
comparing the totals would measure that coverage gap") — but the coverage guard
is shape-based (`KpiShape = 'total' | 'rate'`,
`api/src/services/reports/summary.ts`, per the Phase 5 note in CLAUDE.md) and a
*rate* is exempt. This rate is not coverage-sensitive; it is
**attribution**-sensitive, which the guard does not model.

**Why it matters:** this is the page a GM signs, and it is the single largest
number on it. It reports a 21-fold improvement in product conformance that did
not happen. CLAUDE.md's NO OVER-CLAIMING rule names this class exactly.

**Fix:** suppress the comparison for `Within product limits` when the compared
period's unattributed share materially exceeds the current one — the number is
already computed (`unattributed` on the product report). **Size: small–medium;
needs an API field on the summary, so flag it.**

---

## Finding 13 — Nine of seventeen columns on Report › Product, and 91 % of Report › Product-by-machine, are off-screen at 1366 px

**CONFIRMED by DOM measurement**, 1366×768, ~11:40 and ~11:46 local.
**Stated with the caveat the brief asked for:** a separate worker is fixing
`overflow-x` right now, so check against the current tree before acting.

`[...document.querySelectorAll('.tw')].map(e => ({sw: e.scrollWidth, cw: e.clientWidth}))`,
measured on each report in turn:

| Report | columns | table width | visible | hidden |
|---|---|---|---|---|
| **Product by machine** (`?rt=machine-product`) | 103 | 8,652 px | 816 px | **91 %** |
| **Product** (`?rt=product`) | 17 | 1,588 px | 816 px | **49 %** |
| **Machine / station** (`?rt=station`) | 16 | 1,516 px | 816 px | **46 %** |
| Calibration | 10 | 816 px | 816 px | none |
| Daily, Shift, Rejects, Sacks, Cone weight, Mgmt summary | ≤7 | fits | — | none |

On Report › Product the columns lost past the fold are `vs target`, `Within`,
`Low`, `High`, `Rejected`, `Not judged` and `Excluded` — i.e. every conformance
column, on the conformance report. On Report › Machine/station the same set is
lost. The content pane is 816 px inside a 1366 px window (1100 px cap less the
180 px hanging-label margin), so this does not improve on a wider plant monitor
until roughly 1700 px.

**Product by machine additionally has no sticky first column** — verified:
`getComputedStyle(firstBodyCell).position === 'static'`. Scroll right to reach
3 September and the machine names scroll away with it, so the cells under the
cursor belong to no named row. That table is the answer to IFL's own Q28
("which product ran on which machine, per shift"), and reaching one shift's
cell takes roughly ten horizontal scroll gestures with no row label in view.

Phase 9 addressed this table **for print only** (it now renders a separate
`.tw.print-only` variant, 111 columns, `display:none` on screen —
`web/src/screens/report/MachineProduct.tsx:99,132`). On screen it is unchanged.

**Fix:** `position: sticky` on the first column of the machine-product table is
the cheap half and is worth doing on its own. The wide-report half is the other
worker's sweep. **Size: small (sticky) / not mine (overflow sweep).**

---

## Finding 14 — Product › Running presents the line-wide product without saying it is retired; Product › Catalogue, one tab away, marks it retired

**CONFIRMED.**

**What I did:** `?s=product&pt=running` then `?s=product&pt=catalogue`,
1366×768, ~11:47–11:49 local.

**What I saw:** Running's first block — `Product recorded in this system ·
201-IH0-SD · Target and limits 1,960 ± 40 g · since Wednesday, 2 September 2026
· set by Plant Admin` — with no status marker. Catalogue, same product, same
limits (id 12, `1,960 g · 1,920 g – 2,000 g` = ±40): **`201-IH0-SD · retired`**.

That same retired product is what Report › Machine/station, Report › Cone
weight and Report › Calibration all name as "the target" (see Finding 6), and
it produced **nothing** in 5 Aug – 7 Sep — Report › Product shows six
`205-IL0-SD` materials and no `201-IH0-SD` at all for that period.

`web/src/screens/product/Running.tsx:228` does render `W.product.inactive` when
`chosen?.activeFlag === false`, but only inside the *change* form's preview —
never for the product currently displayed.

**Fix:** show the same `· retired` marker Catalogue uses on the displayed
line-wide product. **Size: small.** Whether a retired product should be the
line-wide product at all, and what that means for three reports' targets, is a
question for the owner, not a code fix.

---

## Finding 15 — Product identity is spelled three different ways across the three Product tabs, and the change history cannot say which product changed

**CONFIRMED**, low severity but it compounds Findings 7 and 14.

Same session, 1366×768, ~11:47–11:51 local:

- **Running**: `205-IL0-SD · Blue · PVSD8020 · 36` (full disambiguation).
- **Catalogue**, top list: `205-IL0-SD` + a separate numeric id column
  (20, 21, 1021 …) — workable.
- **Catalogue**, *Product limits* section below: **fourteen consecutive
  blocks**, each with its own repeated 5-column header and the identical
  boilerplate reason ("Bootstrapped from the sms.product mirror at migration
  027; true start unknown."), headed by the **bare description only** — six read
  `205-IL0-SD`, three read `201-IH0-SD · retired`. **Each carries its own
  "Change limits" button.** A manager cannot tell which of six identical
  headings belongs to the product they mean. This is an ambiguous target on a
  *write* control, which is why I am recording it rather than filing it under
  cosmetics.
- **History**: the Product column is the bare description again, so
  `201-IH0-SD` (which is three distinct PDAS ids, 11/12/13) repeats down the
  table, one row away from `201-IHO-SD` — a *different* product whose name
  differs by a letter O for a zero. A change log that cannot say which product
  it changed to does not do its job.
- **Report › Product by machine** uses a fourth form again: `205-IL0-SD #20`.

**File:line:** `web/src/screens/product/Catalogue.tsx` and `History.tsx` do not
import `distinctProductLabels`; `Running.tsx:300` does (verified by grep across
`web/src/screens/product/`).

**Fix:** apply the existing `distinctProductLabels` in Catalogue's limits
headings and in History's product column. **Size: small**, the helper already
exists and is already used two tabs away.

---

## Finding 16 — Two smaller ones, recorded for completeness

**16a — An empty "By product" table with headers and no message.** CONFIRMED.
`?s=report&rt=machine-product&p=pick&from=2026-07-15&to=2026-07-20` (the
10 Jul – 5 Aug gap), 1366×768, ~12:00 local. The *Changeovers* block correctly
says "No changeovers were read in this period"; the *By product* block below it
renders `Product | Cones | Machines | First reading | Last reading` over nothing
at all. Same shape as Finding 5, different file. Every other empty state I tried
was good — see below. **Size: small.**

**16b — The CSV's `generated_at_plant_time` carries a `Z`.** CONFIRMED by
reading any export. `api/src/services/reports/header.ts:42` builds
`generatedAtPlantUtc` by `new Date(plantNowMs()).toISOString()` — the plant wall
clock serialised with a UTC designator — and
`api/src/services/reports/csv.ts:46` writes it under the header
`generated_at_plant_time`. The screen renders it correctly ("Generated 23 Sept
2026, 11:39"); the file states a field named *plant time* whose value declares
itself UTC, five hours away on this plant. Any consumer that parses it as ISO
gets the wrong hour; the header comment at `header.ts:8-11` shows the two-clocks
rule was understood and the serialisation still went out `Z`-suffixed. **I have
NOT observed a consumer mis-parse it — this is a reading of the format, not of a
failure.** **Size: small; wording or format decision, flag to the owner.**

---

## What I checked and found FINE

- **Report › Daily.** Screen and CSV agree row for row — I compared all 34 day
  rows, all three shift rows and the total
  (`?p=pick&from=2026-08-05&to=2026-09-07`). Coverage sentence first, verdict
  mark present, the sack-stock-per-machine limitation stated in plain words, the
  scale-reject vs inspection-reject populations explicitly separated, the
  7,826-row shift disagreement with the plant's own column disclosed. This is
  the report working as designed.
- **Report › Shift.** Three shift blocks, per-day tables, implausible-excluded
  counts per shift, and — good — an explicit refusal: "Time lost is not split by
  shift: a stoppage is a gap between consecutive cones over the whole day, and a
  gap across a shift boundary belongs to neither shift."
- **Report › Sacks.** All four tables fit at 1366. The three caveats a reader
  needs are all present and correct: sack time is insert time, no sack is
  attributed to a machine, and cones-per-sack is an approximation "not a packing
  list". The stock ledger states "Line-level stock; no sack is attributed to a
  machine" in the block itself, not only in the footnote.
- **Report › Rejects.** Fits at 1366. The unnamed reject codes print as their
  raw pair ("Tube 2 · Mat 1") with the reason stated, matching Q10's open
  status. The Pareto's cumulative column is present. *One thing I could not
  resolve and am not filing as a finding:* the trend block reads "52 days" under
  a 34-day period heading, and quotes "Usual rate 2.2 %" beside a table of daily
  rates from 5.6 % to 14.6 %. The note explains the denominator differs, and the
  figures are internally consistent with `reject.ts`'s own rule; I could not
  determine in the time available whether the 52-day window is intended warm-up
  for the control band or a period bug. **UNCONFIRMED — worth someone's
  half-hour.**
- **Empty and failure states.** `?p=pick&from=2026-07-15&to=2026-07-20` (no
  data): Management summary → "no production data" in the headline plus "Nothing
  recorded in this period."; Calibration → "Nothing recorded in this period."
  AND "No adjustments were logged in this period."; Product by machine → an
  all-`—` grid plus "14 machines, 0 products this period." and "No changeovers
  were read in this period." None went blank; none rendered a failure as a zero.
  (The one exception is 16a.)
- **Report › Product by machine's caption** is honest about a real limit:
  "Sacks carry no machine and are not on this page."
- **Product › Running vs Line's machine table.** They agree exactly — same 14
  stations, same products, same cone counts, same window; Running pivots by
  product, Line by machine. No contradiction between them. (The contradiction is
  *inside* Line, between its own two blocks — see Finding 9's note.)
- **Product › Changeover** was covered by pass 1; I did not revisit it.
- **Wall's headline honesty** — see Finding 10; the state sentence and the shift
  counts are right, only the age wording is wrong.
- **Export availability gating.** Print and both Export buttons are correctly
  `disabled` while a report is loading (`Report.tsx:138-153`), so a half-loaded
  report cannot be printed or exported — the gap pass 1 noted on Readings' Print
  button does not exist here.

## What I could not reach

- **No print render exists in this sandbox.** I made no print claims. Where a
  print-only element exists I said only that it exists (Finding 13); I did not
  and cannot say what it puts on paper.
- **Excel and PDF exports** — I compared the **CSV** against the screen for
  Daily, Product and Calibration. `Export Excel` and the PDF path
  (`api/src/services/reports/{xlsx,pdf}.ts`) were **not** opened: `xlsx.ts`
  produces a binary and I had no way to open the workbook in this environment
  without writing a file. **Findings 5 and 7 concern the CSV only — whether the
  XLSX shares them is unverified**, though both root causes sit above the format
  layer, so I would expect it to.
- **Report filters.** I read every report at its default (no shift, no station,
  no product filter). The shift / station / product chips were **not** exercised
  on any type, so nothing above claims anything about filtered output.
- **Wall over time.** I observed Wall in one state (stale feed). I did not see it
  with a healthy feed, nor watch it across a shift boundary or a fetch failure,
  so Finding 10 is about what it says when stale, not a general verdict on its
  reliability states.
- **Nothing here was seen on real plant data or by a real user**, and the local
  sidecar's epoch pollution stands behind every figure quoted.
