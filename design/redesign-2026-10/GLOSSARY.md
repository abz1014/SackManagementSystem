# SMS redesign - Wording glossary and string table

Phase A (design only), worker A3. Date: 13 Oct 2026. Source of the old strings: `sms/web/src/lib/words.ts` (line numbers are that file, read 13 Oct 2026; "api" = `web/src/api.ts`). Evidence for the conflicts: survey T6 (`glossary-conflicts.md`, `top15.md`). Reader: GM, managers and process engineers who read English as a second language (ESL). Nothing here edits code.

**RESERVED** = the owner decides, not an agent (DECISIONS-PENDING section 14.5, the weight-basis question DP-1 / Q4-5, DP-4 "East Conveyor", "Assumed until IFL confirms", sack-stock receipt words, IFL's eight report titles). A reserved row keeps its old text as the live default and shows a proposal; the owner picks (A = keep old, B = proposal). **Nothing marked RESERVED may ship changed without that pick.**

---

## 1. Rules

### 1.1 One noun per concept

| Concept | The one word | Retired words (never on a primary surface) |
|---|---|---|
| A weighing position on the line (1-14) | **Station N** ("Station 5") | Winder, Machine, "Machine / station", Lifter (as a position) |
| One weigh event of a cone or sack | **reading** (a cone, a sack) | record, row, "ingest record" |
| The scale's own pass/fail on weight | **weight check** | "in-range bit", "in range", "within range" (as a verdict), "Passed / Rejected by the scale" |
| The visual/QCS check | **inspection** | "quality" (as in "quality reject"), "QCS" |
| A cone or sack that failed | **Failed weight check (scale)** / **Failed inspection** (see 1.3) | bare "rejected", "reject" as a verdict |
| The product's weight limits | **Product weight limits**; the middle value is the **target** | tolerance, setpoint |
| A production lot | **batch is not used for data** | "data batch" (use "data set" only in Diagnostics) |
| Product being made | **product** | material, blend/count/tube (those stay as catalogue field names in Products > Catalogue) |
| Time of the newest data | **latest reading** / "Data to 14:30" | "plant link", "sync", "acquisition lag", "as of" |
| Connection to IFL's database | **plant connection** | "plant link", "source", "feed" |

### 1.2 Stations: "Station N" is the primary label (RESERVED)

`stationLabel()` (api.ts:1451) returns the configured name, else `Station N`. In the new UI the **primary** label is always `Station N`; an assigned name such as "East Conveyor" is shown **secondary** (smaller, after the number: "Station 5 - East Conveyor"). Station names are owner-reserved (DP-4); the row stays RESERVED until the owner confirms the pair format. Setup pickers keep the name field.

### 1.3 Reject wording

Ban bare "rejected" as a label. Two named facts, each **always with its denominator**:

- **Failed weight check (scale)**: the scale marked the reading out of range. Print as "Failed weight check (scale): 123 of 8,402 cones weighed (1.5%)".
- **Failed inspection**: the inspection check marked it. Print as "Failed inspection: 87 of 8,402 cones weighed (1.0%)".

"quality" is merged into "inspection" everywhere ("quality reject" -> "failed inspection"). A cone that passed the scale but sits outside the product's limits is a **third** fact, named **"Outside product limits (scale passed)"** and shown only when a product was in force at that reading's time. IFL's report titles that contain "Rejected" are reserved and keep their words (see 3.5).

### 1.4 Dates and clocks

- One date form: **1 Sep 2026** (day, three-letter month, year). Never "7 Sept", "Mon 7 Sep", "06/05/2026", "13 October 2026".
- 24-hour clock only: **14:30** (seconds only where needed: 14:30:05). Never "12:00 PM".
- A plant time carries no "UTC" marker. Label: "Plant time".
- **Sheets and exports show both**: calendar date, then the production day (06:00 to 06:00): "1 Sep 2026, 02:15 - production day 31 Aug 2026". A production day is shown only when it differs from the calendar date.
- Period sentences: "1 Sep 2026 to 3 Sep 2026", "Morning shift, 1 Sep 2026, 06:00 to 14:00".

### 1.5 State words

Four states only, each paired with a glyph (colour is never the only cue): **OK**, **Watch**, **Act**, **No data**. Thresholds are written beside the state ("Act: failed weight check above 2x the line rate"). Banned as state words: "Steady", "Fine", "quiet", "stale", "silent", "degraded", "late".

### 1.6 Product tolerance

"Product weight limits" is a **separate second fact**, shown only when a product was in force at the reading's time (ONE STATUS VOCABULARY). Otherwise nothing is printed about it (not even "none").

### 1.7 Pipeline vocabulary is banned from primary surfaces

Not allowed on Today, Quality, Products & PDAS, Reports (screen or print): **batch, data batch, epoch, generation, gen N, source table (names like `pack1_TP1U2`), simulator, in-range bit, sync pass, transform / processing version, merge key, ingest record, watermark, rebuild, cutover, IFL copy**. They move to System > Diagnostics, or to a "How this is calculated" disclosure on the figure. Where a primary sentence needs the fact, say it in effect words: "Readings before 5 Aug 2026 are not counted (IFL rebuilt its database)."

### 1.8 Other standing rules (kept from the app's own rules)

No "AI". No "reduce station 7 by 9 g". No per-machine sack stock claim. Never call a sack under- or overweight. Never assert whether the line is running when the data is stale. Name which part failed to load. "IFL has not confirmed ..." sentences leave primary surfaces and print footers; they live in System > Setup and the project docs (RESERVED family, 3.4).

---

## 2. Banned and preferred terms (quick table)

| Banned | Use |
|---|---|
| Rejected cones / rejects (as a verdict) | Failed weight check (scale) / Failed inspection |
| quality reject | failed inspection |
| Rejected by the scale / Rejected by scale | Failed weight check (scale) |
| Rejected by inspection / Rejected at inspection | Failed inspection |
| Passed (scale) | Passed weight check |
| within range / in range / in-range | Passed weight check; "Within product limits" for the product fact |
| outside the product's limits | Outside product limits (scale passed) |
| could not be judged | Not checked (no product set) |
| quiet | No cones |
| Winder N / Machine N / Lifter N | Station N |
| data batch / generation / epoch | "before the 5 Aug 2026 rebuild" (primary); "Data set" (Diagnostics) |
| plant link | plant connection |
| 12:00 PM | 12:00 |

---

## 3. Old to new string table

Columns: # | words.ts key | line | old text (shortened) | new text | status. "OK" status = agent may apply. "RESERVED" = owner decision; old text stays until picked.

### 3.1 Shell and navigation

| # | Key | Line | Old | New | Status |
|---|---|---|---|---|---|
| 1 | nav.line | 32 | Line | Today | OK |
| 2 | nav.readings | 33 | Readings | Register | OK |
| 3 | nav.weight | 34 | Weight | Weight | OK |
| 4 | nav.rejects | 35 | Rejects | Rejects (tab name only; its headings use 1.3 wording) | OK |
| 5 | nav.sacks | 39 | Sacks | (no nav entry; section name "Sacks" on Today) | OK |
| 6 | nav.product | 43 | Product | Products & PDAS | OK |
| 7 | nav.report | 44 | Report | Reports | OK |
| 8 | nav.health | 47 | Health | Diagnostics | OK |
| 9 | wall | 49 | Wall | Wall display | OK |
| 10 | setup | 50 | Setup | Setup | OK |
| 11 | plantClock | 54 | plant clock | Plant time | OK |
| 12 | signOut | 55 | Sign out | Sign out | OK |
| 13 | question.line | 61 | Is the line running, what has it made this period, and does anything need attention? | Is the line running, what has it made, and does anything need attention? | OK |
| 14 | question.readings | 62 | Every cone and every sack that was weighed, with the rejected ones flagged. | Every cone and sack that was weighed, with the failed ones marked. | OK |
| 15 | question.weight | 63 | Are the cones at the right weight, and does any station's scale need attention? | Are the cones at the right weight? | OK |
| 16 | question.rejects | 64 | How many cones are being rejected, why, is it getting worse, and where? | How many cones failed a check, why, is it getting worse, and where? | OK |
| 17 | question.report | 65 | What did the line make over this period, on paper. | What did the line make in this period? Print or export it. | OK |
| 18 | question.setup | 66 | Accounts, stations, the rules this system applies, and the plant connection. | Accounts, stations and rules. | OK |
| 19 | question.product | 67 | What is each machine running, what are its limits, and how do I change it. | What is each station running, and how do I change it? | OK |
| 20 | health.question | 1486 | Is this system itself healthy: the plant link, the database, the service, and the backups. | Is SMS working: the plant connection, database, service and backups? | OK |

### 3.2 Period, time and data age

| # | Key | Line | Old | New | Status |
|---|---|---|---|---|---|
| 21 | period.shift | 73 | This shift | This shift | OK |
| 22 | period.pick | 78 | Pick dates | Choose dates | OK |
| 23 | period.range | 83 | Custom range | Custom range | OK |
| 24 | soFar | 86 | so far | so far | OK |
| 25 | lag.ok | 97 | Readings to {t} - they reach this system about {lag} after weighing. | Data to {t}. It arrives about {lag} after weighing. | OK |
| 26 | lag.okNoLag | 99 | Readings to {t}. | Data to {t}. | OK |
| 27 | lag.stale | 104 | No new readings since {t} - the plant link may be down. | No data since {t}. Check the plant connection. | OK |
| 28 | lag.details | 110 | details | Diagnostics | OK |
| 29 | lag.noData | 111 | Nothing has been received from the plant yet. | No data received yet. | OK |
| 30 | state.idle | 131 | has had no readings since {t} | No data since {t} | OK |
| 31 | state.unknown | 132 | Cannot tell whether the line is running | Line status unknown: no data since {t}. | OK |
| 32 | state.stopped | 124 | has had no readings for {span} - the line, or the plant's data recorder, may have stopped | No data for {span}. The line or the data recorder may have stopped. | OK |
| 33 | state.shiftOf / intoShift | 133-135 | {span} into the {shift}, {from} to {to} | {shift}, {from} to {to}, {span} in | OK |
| 34 | sync.preEpochPass | 1322 | before data batches were tracked | before 5 Aug 2026 (Diagnostics only) | OK |
| 35 | health.acquisition | 1500 | Plant link | Plant connection | OK |
| 36 | sync.ok | 1290 | The plant connection is healthy. | OK: the plant connection is working. | OK |
| 37 | sync.stale | 1291 | The plant connection has not delivered anything recently. | Watch: no data recently. | OK |
| 38 | couldNotLoad | 1370 | Could not load this. The plant connection may be down. | Could not load this. Check the plant connection. | OK |

### 3.3 Weight, reject and verdict vocabulary (the highest-exposure strings)

| # | Key | Line | Old | New | Status |
|---|---|---|---|---|---|
| 39 | passed | 187 | Passed | Passed weight check | OK |
| 40 | rejectedByScale | 188 | Rejected by the scale | Failed weight check (scale) | OK |
| 41 | readings.inspectionRejects | 574 | Rejected by inspection | Failed inspection | OK |
| 42 | readings.rejectedCones | 559 | Rejected cones | Cones that failed (scale) | OK |
| 43 | fig.rejected | 157 | rejected | failed | OK |
| 44 | fig.couldNotBeJudged | 164 | {n} could not be judged | {n} not checked (no product set) | OK |
| 45 | outsideProduct | 189 | outside the product's limits | Outside product limits (scale passed) | OK |
| 46 | alsoOutsideProduct | 190 | Also outside the product's limits: {limits} at this time, so {by}. | Also outside product limits at this time ({limits}): {by}. | OK |
| 47 | noProductThen | 192 | No product was recorded at this time, so there are no product limits to compare against. | No product was set at this time, so limits do not apply. | OK |
| 48 | disagreement | 193 | {n} cones in this period were passed by the scale but sit outside the product's limits. | {n} cones passed the weight check but are outside product limits. | OK |
| 49 | outsideLimitsThisPeriod | 204 | Cones passed by the scale sit outside the product's limits in this period. | Some cones passed the weight check but are outside product limits. | OK |
| 50 | withinLimits | 184 | {pct} within the scale's limits | {pct} passed the weight check | OK |
| 51 | ofEverything | 185 | {pct} of everything weighed | {pct} of {n} cones weighed | OK |
| 52 | splitRejects | 186 | {q} quality, {w} weight | {q} failed inspection, {w} failed weight check | OK |
| 53 | stationRejected | 541 | {n} rejected | {n} failed | OK |
| 54 | unattributedRejects | 546 | {n} rejects not attributed to a station | {n} failures with no station recorded | OK |
| 55 | rejects.headline | 979 | {n} cones rejected, {pct} of everything weighed - {q} for quality, {w} for weight | {n} of {total} cones failed ({pct}): {q} inspection, {w} weight check | OK |
| 56 | rejects.quality / weightKind | 1006-1007 | quality / weight | inspection / weight check | OK |
| 57 | rejects.steady | 985 | steady | OK (not rising) | OK |
| 58 | rejects.usualRange | 1005 | usual range | normal range | OK |
| 59 | rejects.noCode | 994 | No code recorded | No reason code | OK |
| 60 | rejects.codeUnnamed | 993 | Code {c} - not yet named | Reason code {c} (no name yet) | OK |
| 61 | rejects.nameIt | 1012 | Name it | Name this code | OK |
| 62 | rejects.byStation | 1022 | By station | By station | OK |
| 63 | rejects.seeTheCones | 1013 | See the rejected cones themselves | Open these cones in Register | OK |
| 64 | rejects.spansGenerations | 1003 | This window crosses the 5 August rebuild of IFL's tables. The usual range is worked out separately on each side of it. | This window includes the 5 Aug 2026 database rebuild. The normal range is worked out for each side separately. | OK |
| 65 | rejects.trendTitle | 998 | Reject rate over the last {n} days - this period shaded | Failure rate over the last {n} days (this period shaded) | OK |
| 66 | rejects.reasonsTitle | 1008 | Reasons, last {n} days | Reasons, last {n} days | OK |
| 67 | rejects.namesAwaited | 1011 | Reason names have not been supplied yet. An engineer or manager can name a code here. | Reason codes have no names yet. An engineer or manager can name them. | OK |
| 68 | readings.countLine | 583 | {n} weighed, {m} rejected by the scale ({pct}). | {n} weighed: {m} failed the weight check ({pct}). | OK |
| 69 | readings.filterOutsideLimits | 575 | Outside product limits | Outside product limits | OK |
| 70 | readings.nothingOutside | 582 | No cones in this period were passed by the scale but outside the product's limits. | No cones passed the weight check but fell outside product limits. | OK |
| 71 | readings.countLineFailed | 613 | Could not load this period's count. The plant connection may be down. | Could not load the count. Check the plant connection. | OK |
| 72 | reports.rejectedByScale | 2181 | Rejected by the scale | Failed weight check (scale) | OK |
| 73 | reports.rejectedAtInspection | 2182 | Rejected at inspection | Failed inspection | OK |
| 74 | reports.colRejected / colNotJudged | 2207-2208 | Rejected / Not judged | Failed / Not checked | OK |
| 75 | reports.colInRange | 2203 | In range | Passed weight check | OK |
| 76 | reports sack.rejectedByScale | 2626 | Rejected by scale | Failed weight check (scale) | OK |
| 77 | report split rejected | 2545 | Rejected by the scale | Failed weight check (scale) | OK |
| 78 | sack.inRangeShare | 2301 | {p} in range by the scale | {p} passed the weight check | OK |
| 79 | sack.sackRejected | 2302 | {n} rejected by the scale | {n} failed the weight check | OK |
| 80 | sacks.figInRange | 1968 | within range | passed weight check | OK |
| 81 | sacks.inRangeNote | 1972 | {n} of {of} the scale passed | {n} of {of} passed the weight check | OK |
| 82 | sacks.colInRange | 1984 | Within range | Passed weight check | OK |
| 83 | sacks.inRangeByProduct | 2011 | Within the scale's range, by product | Passed weight check, by product | OK |
| 84 | sacks.headline | 1963 | {period}: {n} sacks weighed, {kg} kg, {pct} within the scale's range. | {period}: {n} sacks weighed ({kg} kg); {pct} passed the weight check. | OK |
| 85 | sacks.noFlagNote | 1973 | {n} carry no verdict | {n} have no weight-check result | OK |

### 3.4 Stations, machines, products and states

| # | Key | Line | Old | New | Status |
|---|---|---|---|---|---|
| 86 | station | 527 | Station {n} | Station {n} | OK |
| 87 | stationLabel() fallback + named stations | api 1451 | East Conveyor (the station's configured name shown as the label) | Station 5 - East Conveyor (name secondary) | RESERVED (DP-4): A keep name as label; B number first, name secondary |
| 88 | reports.type.station (label) | 2113 | Machine / station | Station | RESERVED (DP-4): ties to row 87 |
| 89 | quiet | 528 | quiet | No cones | OK |
| 90 | quietFor | 529 | Station {n} has been quiet for {span} | Station {n}: no cones for {span} | OK |
| 91 | wallBoardIncomplete | 537 | The station roster could not be fully loaded - a quiet station may be missing from this row, not just quiet. | The station list did not fully load. A station may be missing. | OK |
| 92 | machineState.running | 2400 | Running | Running | OK |
| 93 | machineState.quiet | 2401 | No cones for {span} (last {t}) | No cones for {span} (last cone {t}) | OK |
| 94 | machineState.stale | 2402 | Not seen since {t} | No cones since {t} | OK |
| 95 | machineState.silent | 2403 | Not seen for over a week - check the machine or its scale | No cones for over a week. Check the station and its scale. | OK |
| 96 | machineState.lastProduct | 2408 | Last product it stamped: {label}, last cone {t}. | Last product on its cones: {label}, last cone {t}. | OK |
| 97 | machineState.thresholds | 2412 | Running means a cone within 2 hours of the newest reading ... Quiet means ... stale ... silent | Running: a cone in the last 2 hours. Otherwise No cones. (disclosed under "How this is calculated") | OK |
| 98 | setupTabs.machines / config.machines note | 1102, 1154 | Machines; the winders and the packer on this line | Stations; the 14 weighing stations and the packer | OK |
| 99 | config.machines kinds.winder | 1170 | winder | station (weighing) | OK |
| 100 | reports winder / byWinder / winderNo | 2450-2461 | By winder / Winder / Winder No. | By station / Station / Station | OK |
| 101 | reports winderTotal | 2478 | Winder total | Station total | OK |
| 102 | reports.noWinder | 2470 | {p} pass and {r} weight rejections carry no winder and are in the totals above but not in the winder rows below. | {p} passed and {r} failed weight checks have no station recorded. They are in the totals but not in the station rows. | OK |
| 103 | reports scopeStation | 2527 | Winder {n} only | Station {n} only | OK |
| 104 | config.stations note | 1159 | Stations are linked to the winder with the same number by default. IFL has not yet confirmed whether a machine and a station are the same thing. | Station N is the weighing position for winder N. (Open question moves to Setup help.) | RESERVED (DP-4 / IFL-dependency family) |
| 105 | product.title | 219 | Product recorded in this system | Product now running | OK |
| 106 | product.notSentToMachine | 225 | Recorded here for weight limits and reports. It is not sent to the machine. | Recorded here for limits and reports. Not sent to the machine. | OK |
| 107 | product.noneAtThisTime | 244 | No product was recorded for the line at this time. | No product set for the line at this time. | OK |
| 108 | product.changeLimits | 274 | Change weight limits | Change weight limits | OK |
| 109 | product.changeLimitsPropagation | 297 | IFL has not yet confirmed when the scale picks up new limits - check on the machine. | New limits may take time to reach the scale. Check at the machine. | RESERVED (IFL-dependency family) |
| 110 | product.writeNeedsRank | 273 | Changing products in PDAS needs an engineer account or higher. | Only engineer accounts and above can change products in PDAS. | OK |
| 111 | product.pdasTitle | 266 | Products in PDAS | Products in PDAS | OK |
| 112 | product.palletsTitle | 384 | Pallets in PDAS | Pallets in PDAS | OK |
| 113 | attention / nothingNeedsAttention | 207-208 | Attention / Nothing needs attention. | Needs attention / Nothing needs attention. | OK |
| 114 | lastReadings / lastSack / lastCone | 551-553 | Last readings / Last sack / Last cone | Latest readings / Latest sack / Latest cone | OK |

### 3.5 Data sets, pipeline words and Diagnostics

| # | Key | Line | Old | New | Status |
|---|---|---|---|---|---|
| 115 | state periodGenerations | 147 | {n} readings in this period belong to a different data batch (IFL rebuilt its tables) and are not counted in these figures, ... | {n} readings from before the 5 Aug 2026 IFL database rebuild are not counted. | OK |
| 116 | weight.oneGeneration | 854 | This chart covers one data batch of the source tables: {a} readings. Another {b} readings in this period belong to a different data batch ... | This chart shows {a} readings. {b} readings from before the 5 Aug 2026 rebuild are not shown. | OK |
| 117 | readings.batch.current / also | 732, 736 | Data batch: {name}. / Also in this period: {name}, {n} readings | (primary) removed; (Diagnostics) Data set: {name} / Also in this period: {name}, {n} readings | OK |
| 118 | readings.batch.show / backToDefault | 737, 739 | Show them / Back to the default batch | Show the older readings / Back to current readings | OK |
| 119 | readings.prov.generation | 696 | Data batch | (moves to "How this is calculated") Data set | OK |
| 120 | readings.prov.sourceTable / sourceSystem / sourceRow / rawRow | 694-702 | Source table / Source system / Source row id / Ingest record id | (moves to "How this is calculated") unchanged, Diagnostics wording | OK |
| 121 | readings.prov.transform / syncPass | 700, 703 | Processing version / Sync pass | (moves to "How this is calculated") unchanged | OK |
| 122 | readings.prov.insertedAt / readAt | 698-699 | Written by the plant / Read into this system | Recorded by the plant / Received by SMS | OK |
| 123 | readings.prov.plantShift | 705 | Plant-stored shift | Shift as stored by the plant (How this is calculated) | OK |
| 124 | readings.prov.attribution.source_column | 713 | from the reading's own material id | from the reading itself | OK |
| 125 | health.epochRegister.title | 1580 | Data batches | Data sets (Diagnostics) | OK |
| 126 | health.epochRegister.note | 1581 | Every physical batch of each source table this system has ever read from. A batch is registered by an administrator ... | Each version of IFL's weighing tables that SMS has read. An administrator registers a new version; syncing stops until then. | OK |
| 127 | sync.noOpenEpoch | 1350 | No data batch is registered for {table} - syncing stays halted on it until an administrator registers one. | Syncing is stopped for {table}: no data set is registered. An administrator must register one. | OK |
| 128 | sync.source | 1312 | Source: IFL SQL Server, read-only. There is no PLC connection. | Reads IFL's database only. No PLC connection. | OK |
| 129 | sync.lastPass | 1313 | Last successful pass | Last successful update | OK |
| 130 | sync.findings | 1315 | Blocking findings | Data problems that stop updates | OK |
| 131 | sync.perTable | 1316 | Per table | By table | OK |
| 132 | reports.generationNote | 2733 | Data batch {g}. Readings from another batch excluded: {n}. | Data from {from}. {n} older readings are not included. | OK |
| 133 | reports.spansGenerations | 2267 | This period includes more than one batch of recorded data; the band shown is from the batch the report was read from. | This period includes data from before the 5 Aug 2026 rebuild. The band shown is for the newer data. | OK |
| 134 | health.dbSize | 1495 | {mb} MB used of the {gb} GB SQL Server Express allows - {pct} %. | Database {mb} MB of {gb} GB limit ({pct} %). | OK |
| 135 | health.backupWarn | 1504 | Backups run nightly; more than two days without one means the scheduled task has stopped. Check Task Scheduler on the server. | Backups run every night. If the last is over 2 days old, the task has stopped. Check Task Scheduler. | OK |
| 136 | health.status.degraded | 1487 | Something needs attention. | Watch: something needs attention. | OK |
| 137 | health.dqFindings | 1529 | Data quality findings | Data checks that found a problem | OK |
| 138 | health.account / changePassword | 1507-1508 | Account / Change password | Account / Change password | OK |

### 3.6 RESERVED rows (owner picks)

| # | Key | Line | Old (stays live) | Proposal | Reason RESERVED |
|---|---|---|---|---|---|
| 139 | weight.headlineUnconfirmed | 749-750 | Average recorded weight is {mean}; the product target is {target} (weight basis not yet confirmed). | Average cone weight {mean}. Product target {target}. Gross or net weight is not confirmed. | Weight basis, DP-1 / Q4-5 |
| 140 | weight.headlineConfirmed | 751 | Average cone weight is {mean}, {delta} the {target} target. | unchanged (applies only after the owner confirms basis) | DP-1 / Q4-5 |
| 141 | config rules basis label | 1237 | Weight basis | Weight basis (gross or net) | DP-1 / Q4-5 |
| 142 | reports.pendingHeading | 2447 | Assumed until IFL confirms | A: keep. B: "Working assumptions" | Owner-reserved wording ("assumed until IFL confirms") |
| 143 | reports.definitionsNote | 2158 | Figure definitions are awaiting IFL's approval. | A: keep. B: "Definitions not yet approved by IFL." | IFL-approval family |
| 144 | sacks.ledger | 2017 | Stock ledger | A: keep. B: "Sack production ledger" | Sack-stock words (IFL Q28 reframed "stock" as production per shift/day) |
| 145 | sacks.ledgerNote | 2018 | line stock, not per machine | A: keep. B: "for the whole line, not per station" | Sack-stock words |
| 146 | sacks.colOpening | 2021 | Opening | A: keep. B: "At start" | Sack-stock words |
| 147 | sacks.colReceipts | 2022 | Receipts | A: keep. B: "Packed" | Sack-stock words ("receipt" = sack weighed, T6 top15 #10) |
| 148 | sacks.colIssues | 2023 | Issues | A: keep. B: "Issued out" | Sack-stock words |
| 149 | sacks.colConsumption | 2024 | Consumption | A: keep. B: "Used" | Sack-stock words |
| 150 | sacks.colAdjustments | 2025 | Adjustments | A: keep. B: "Corrections" | Sack-stock words |
| 151 | sacks.colClosing | 2026 | Closing | A: keep. B: "At end" | Sack-stock words |
| 152 | sacks.typeName.receipt / issue / consumption / adjustment | 2054-2057 | Received / Issued out / Consumed / Correction | unchanged (already plain; listed so the set is decided together) | Sack-stock words |
| 153 | reports stockCol* (Opening ... Closing) | 2307-2312 | Opening / Receipts / Issues / Consumption / Adjustments / Closing | same B column as rows 146-151 | Sack-stock words |
| 154 | sacks.perMachine / perMachineNone | 2046-2047 | Per machine / not available | A: keep. B: "Per station: not recorded" | Sack-stock words (no machine field exists) |
| 155 | sacks.ledgerCaveat | 2043 | (the long statement that stock is kept for the line, not per machine, ~69 words) | A: keep. B: "Stock is for the whole line, not per station." | Sack-stock words |
| 156 | reports.type.shift-production | 2121 | Shift-wise CTS Loop Production Report | keep (IFL title) | IFL's 8 titles |
| 157 | reports.type.rejected-cones | 2122 | List of Rejected Cones Against Weight | keep (IFL title); on-screen subtitle uses 1.3 wording | IFL's 8 titles |
| 158 | reports.type.rejected-sacks | 2123 | Rejected Sack Report - Daily | keep (IFL title) | IFL's 8 titles |
| 159 | reports.type.sps-packing | 2124 | SPS Production Report - Count-wise Packing at Each SPS | keep (IFL title) | IFL's 8 titles |
| 160 | reports.type.sack-weight-range | 2125 | SPS Sack Weight Range Report | keep (IFL title) | IFL's 8 titles |
| 161 | reports.type.sack-weight-summary | 2126 | Sack Packing Weight Summary | keep (IFL title) | IFL's 8 titles |
| 162 | reports.type.rejected-hangers | 2127 | Rejected Cone Hangers Report | keep (IFL title) | IFL's 8 titles |
| 163 | reports.type.rejected-unknown-lifter | 2128 | Rejected Unknown (Lifter) Report | keep (IFL title) | IFL's 8 titles |
| 164 | "IFL has not yet said ..." sentences | 1150, 1159, 1275, 1433 | e.g. "IFL has not confirmed whether reject reports should count by production day or by calendar date; this screen uses the production day." | A: keep as is. B: remove from primary pages and print; keep in Setup help and a "Open questions for IFL" list | IFL-dependency family (T6 top15 #14) |
| 165 | DECISIONS-PENDING 14.5.1: "about 3.8 hours" insert lag | (docs, not words.ts) | in CLAUDE.md / SCHEMA.md / QUESTIONS.md Q7 | none for UI; UI already states the measured lag (row 25) | 14.5.1, owner-only (docs wording; no UI string carries it) |
| 166 | DECISIONS-PENDING 14.5.2: PDAS write-path wording in CLAUDE.md and `.env` | (docs) | stale "ENABLED 22 Sep" comment | none for UI | 14.5.2, owner-only (docs; no UI string) |

Table size: 166 rows (rows 1-138 in sections 3.1-3.5, rows 139-166 in 3.6).

---

## 4. Summary of the changes the table asks for

1. **Retire three nouns** (Winder, Machine, Lifter as a position) in favour of "Station N" (rows 98-103). Needs the DP-4 pick on the name display (rows 87, 88, 104).
2. **Replace "Rejected by the scale / by inspection / quality"** with "Failed weight check (scale)" and "Failed inspection", each shown with its denominator (rows 39-85).
3. **Remove "data batch / generation / epoch / simulator / source table"** from primary text; keep in Diagnostics and "How this is calculated" (rows 115-133).
4. **One date and clock form** (rule 1.4); not a string table item because dates are formatted in `lib/fmt.ts`, not `words.ts`. The format helpers (`fmtClock`, `fmtClockOn`, `fmtSpan`) need review in the build phase: the survey found "7 Sept", "13 Oct", "06/05/2026", "13 October 2026" and "12:00 PM" in use.
5. **State words OK / Watch / Act / No data** replace "Steady", "quiet", "stale", "degraded" (rows 57, 89-95, 136).
6. **Owner decisions needed**: section 5.

---

## 5. RESERVED rows needing an owner decision

| Group | Rows | Question for the owner |
|---|---|---|
| Station naming (DP-4) | 87, 88, 104 | Show "Station 5 - East Conveyor" (number first, name second), or keep the name as the label? Keep "Machine / station" on the report picker? |
| Weight basis (DP-1 / Q4-5) | 139, 140, 141 | Is the recorded weight gross or net? Until confirmed, which headline sentence? (Proposal avoids "not yet confirmed" jargon but still states that the basis is unconfirmed.) |
| "Assumed until IFL confirms" family | 142, 143, 164, 109 | Keep the heading and the IFL-approval footnote on printed reports, or move them to Setup help? |
| Sack-stock words | 144-155 | Keep Receipts / Issues / Consumption / Adjustments / Closing, or use Packed / Issued out / Used / Corrections / At end? Keep "Stock ledger"? Where does the ledger live (IA-MAP section 7 item 1)? |
| IFL's eight report titles | 156-163 | Titles stay as IFL wrote them (including "Rejected" and "Lifter"). The proposal only adds a plain subtitle under each (using rule 1.3 wording). Confirm. |
| DECISIONS-PENDING 14.5.1 / 14.5.2 | 165, 166 | Owner-only documentation wording; no UI string depends on them. Listed so the set is complete. |

Total RESERVED rows: **32** (rows 87, 88, 104, 109 and 139 to 166 inclusive; rows 165 and 166 are documentation-only and carry no UI string).
