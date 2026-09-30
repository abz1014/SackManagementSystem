# LABELS.md — exact on-screen text, with source citations

Every row's `exact text` is copy-pasted verbatim from the cited source (capitalisation,
punctuation and apostrophe style preserved). `kind = literal` means the whole string always
renders exactly as shown; `kind = pattern` means the string is built from a template function —
`${var}` marks the part that varies, and only the literal fragments around it are checked by
`docs/guide/build/check_labels.py`.

Sources are `sms/web/src/lib/words.ts` (the central copy object `W`) and
`sms/web/src/lib/generationWords.ts` (simulator/provenance text) unless otherwise noted;
several strings are hard-coded directly in a screen's `.tsx` file rather than pulled from
`words.ts` — those are cited to the `.tsx` file.

---

## Shared chrome, Line, Readings, Weight, StationSheet, Rejects, ReasonSheet, Sacks, StockSheet

Covers shots S01-S12, S33-S34 and dialogs D01-D11. Extracted directly from
`sms/web/src/lib/words.ts`, `sms/web/src/lib/generationWords.ts`, `sms/web/src/ui/Bar.tsx`,
`sms/web/src/screens/Login.tsx`, and the Line/Readings/Weight/Rejects/Sacks screens and their
sheet components (`ReadingSheet.tsx`, `StationSheet.tsx`, `ReasonSheet.tsx`, `StockSheet.tsx`).

| ID | exact text | where it appears | source file:line | kind |
|---|---|---|---|---|
| L-nav-line | Line | top nav | sms/web/src/lib/words.ts:32 | literal |
| L-nav-readings | Readings | top nav | sms/web/src/lib/words.ts:33 | literal |
| L-nav-weight | Weight | top nav | sms/web/src/lib/words.ts:34 | literal |
| L-nav-rejects | Rejects | top nav | sms/web/src/lib/words.ts:35 | literal |
| L-nav-sacks | Sacks | top nav | sms/web/src/lib/words.ts:39 | literal |
| L-nav-product | Product | top nav | sms/web/src/lib/words.ts:43 | literal |
| L-nav-report | Report | top nav | sms/web/src/lib/words.ts:44 | literal |
| L-shared-brand | SMS | top nav brand | sms/web/src/lib/words.ts:30 | literal |
| L-shared-wall | Wall | top bar Wall button | sms/web/src/lib/words.ts:46 (W.wall) | literal |
| L-shared-setup | Setup | Setup gear aria-label/title | sms/web/src/lib/words.ts:47 (W.setup) | literal |
| L-menu-textSize | Text size | user menu row label | sms/web/src/ui/Bar.tsx:228 | literal |
| L-menu-desk | Desk | user menu text-size toggle | sms/web/src/ui/Bar.tsx:164 | literal |
| L-menu-wall | Wall | user menu text-size toggle | sms/web/src/ui/Bar.tsx:165 | literal |
| L-menu-changePassword | Change password | user menu item | sms/web/src/lib/words.ts:1489 (W.health.changePassword) | literal |
| L-menu-signOut | Sign out | user menu item | sms/web/src/lib/words.ts:52 (W.signOut) | literal |
| L-shared-plantClock | plant clock | strip, beside clock | sms/web/src/lib/words.ts:51 (W.plantClock) | literal |
| L-shared-lagOk | Readings to ${reading} · they reach this system about ${lag} after weighing. | strip lag sentence, healthy | sms/web/src/lib/words.ts:95 (W.lag.ok) | pattern |
| L-shared-lagOkNoLag | Readings to ${reading}. | strip lag sentence, no lag figure | sms/web/src/lib/words.ts:95 (W.lag.okNoLag) | pattern |
| L-shared-lagStale | No new readings since ${since} — the plant link may be down. | strip lag sentence, stale | sms/web/src/lib/words.ts:101 (W.lag.stale) | pattern |
| L-shared-lagLate | Readings are arriving ${lag} late — the line state below may be out of date. | strip lag sentence, late | sms/web/src/lib/words.ts:103 (W.lag.late) | pattern |
| L-shared-lagUnknown | Readings to ${reading} · delay not measured yet. | strip lag sentence, lag unknown | sms/web/src/lib/words.ts:106 (W.lag.lagUnknown) | pattern |
| L-shared-lagDetails | details | strip, end of lag link | sms/web/src/lib/words.ts:107 (W.lag.details) | literal |
| L-shared-lagNoData | Nothing has been received from the plant yet. | strip lag sentence, no data | sms/web/src/lib/words.ts:108 (W.lag.noData) | literal |
| L-period-shift | This shift | period control | sms/web/src/lib/words.ts:70 | literal |
| L-period-today | Today | period control | sms/web/src/lib/words.ts:71 | literal |
| L-period-yesterday | Yesterday | period control | sms/web/src/lib/words.ts:72 | literal |
| L-period-week | This week | period control | sms/web/src/lib/words.ts:73 | literal |
| L-period-month | This month | period control | sms/web/src/lib/words.ts:74 | literal |
| L-period-pick | Pick dates | period control | sms/web/src/lib/words.ts:75 | literal |
| L-period-from | From | Pick-dates date input aria-label | sms/web/src/ui/Bar.tsx:129 | literal |
| L-period-to | To | Pick-dates date input aria-label | sms/web/src/ui/Bar.tsx:134 | literal |
| L-period-toWord | to | between From/To inputs | sms/web/src/lib/words.ts:77 (W.periodTo) | literal |
| L-login-brand | SMS | sign-in form heading (`{W.brand}`, also composed at Login.tsx:46) | sms/web/src/lib/words.ts:30 | literal |
| L-login-subtitle | Sack Management System | sign-in form subheading | sms/web/src/screens/Login.tsx:47 | literal |
| L-login-username | Username | sign-in form field label | sms/web/src/screens/Login.tsx:50 | literal |
| L-login-password | Password | sign-in form field label | sms/web/src/screens/Login.tsx:62 | literal |
| L-login-error | That username and password did not match. | sign-in error | sms/web/src/screens/Login.tsx:37 | literal |
| L-login-lockout | Too many attempts. Try again in ${mins} ${mins === 1 ? 'minute' : 'minutes'}. | sign-in lockout error | sms/web/src/screens/Login.tsx:35 | pattern |
| L-login-signingIn | Signing in… | submit button, busy | sms/web/src/screens/Login.tsx:79 | literal |
| L-login-signIn | Sign in | submit button | sms/web/src/screens/Login.tsx:79 | literal |
| L-line-question | Is the line running, what has it made this period, and does anything need attention? | Line screen, under headline | sms/web/src/lib/words.ts:58 (W.question.line) | literal |
| L-line-running | is running | Line headline, running state | sms/web/src/lib/words.ts:108 (W.state.running) | literal |
| L-line-stopped | has had no readings for ${span} — the line, or the plant's data recorder, may have stopped | Line headline, stopped state | sms/web/src/lib/words.ts:124 (W.state.stopped) | pattern |
| L-line-stoppedUnknown | has had no readings — the line, or the plant's data recorder, may have stopped, for how long is not known | Line headline, stopped/unknown duration | sms/web/src/lib/words.ts:130 (W.state.stoppedUnknownDuration) | literal |
| L-line-idle | has had no readings since ${since} | Line headline, idle state | sms/web/src/lib/words.ts:128 (W.state.idle) | pattern |
| L-line-unknown | Cannot tell whether the line is running | Line headline, unknown state | sms/web/src/lib/words.ts:129 (W.state.unknown) | literal |
| L-line-intoShift | ${span} into the ${shift}, ${from} to ${to} | Line headline, running mid-shift | sms/web/src/lib/words.ts:131 (W.state.intoShift) | pattern |
| L-line-rightNow | right now | Line headline suffix | sms/web/src/lib/words.ts:138 (W.state.rightNow) | literal |
| L-line-figuresCover | Figures below cover ${period}. | Line headline, non-shift period | sms/web/src/lib/words.ts:139 (W.state.figuresCover) | pattern |
| L-line-shiftOf | ${shift}, ${from} to ${to} | Line headline scope clause | sms/web/src/lib/words.ts:120 (W.state.shiftOf) | pattern |
| L-line-stations | Stations | Stations block heading (combined with note) | sms/web/src/lib/words.ts:478 (W.stations); used sms/web/src/screens/Line.tsx:275 | literal |
| L-line-stationsNote | cones this period | Stations block heading suffix | sms/web/src/lib/words.ts:479 (W.stationsNote); used sms/web/src/screens/Line.tsx:275 | literal |
| L-line-stationsHeading | ${W.stations} — ${W.stationsNote} | Stations block full heading | sms/web/src/screens/Line.tsx:275 | pattern |
| L-line-stationsCompareAria | Cones this period, each station against the row's own median | station-compare chart aria-label | sms/web/src/lib/words.ts:486 (W.stationsCompareAria) | literal |
| L-line-stationsCompareZero | row median | station-compare chart zero-label | sms/web/src/lib/words.ts:487 (W.stationsCompareZero) | literal |
| L-line-quiet | quiet | station tag, quiet station | sms/web/src/lib/words.ts:519 (W.quiet); Line.tsx:1204 | literal |
| L-line-station | Station ${n} | station label | sms/web/src/lib/words.ts:521 (W.station) | pattern |
| L-line-stationRejected | ${n} rejected | station tag, rejects present | sms/web/src/lib/words.ts:530 (W.stationRejected) | pattern |
| L-line-attention | Attention | Attention block heading | sms/web/src/lib/words.ts:201 (W.attention) | literal |
| L-line-nothingAttention | Nothing needs attention. | Attention block, empty state | sms/web/src/lib/words.ts:199 (W.nothingNeedsAttention) | literal |
| L-line-tooFewDays | — only ${n} production day${s} in the window, too few to judge a station's drift. | Attention block, too-few-days empty state | sms/web/src/lib/words.ts:206 (W.tooFewProductionDays) | pattern |
| L-line-andMore | and ${n} more — see ${where} | Attention block overflow line | sms/web/src/lib/words.ts:200 (W.andMore) | pattern |
| L-line-seeThem | See them | Attention list link (outside-limits finding) | sms/web/src/lib/words.ts:188 (W.seeThem) | literal |
| L-line-outsideLimitsThisPeriod | Cones passed by the scale sit outside the product's limits in this period. | Attention list sentence, outside-limits finding | sms/web/src/lib/words.ts:195 (W.outsideLimitsThisPeriod) | literal |
| L-line-readsHeavier | Has read about ${g} heavier than the line for ${days} days — check its scale first. | Attention list, station-drift finding | sms/web/src/lib/words.ts:878 (W.weight.readsHeavier); used Line.tsx:797 | pattern |
| L-line-readsLighter | Has read about ${g} lighter than the line for ${days} days — check its scale first. | Attention list, station-drift finding | sms/web/src/lib/words.ts:880 (W.weight.readsLighter) | pattern |
| L-line-rejectRise | ${Kind} rejects have been rising since ${since} — ${ratePct} against a usual ${usualPct}. | Attention list, reject-rise finding sentence | sms/web/src/screens/Line.tsx:850 | pattern |
| L-line-pickDates | Pick dates | period control (Line uses shared control) | sms/web/src/lib/words.ts:75 | literal |
| L-line-conesPerDay | Cones weighed per production day | chart heading, spread=day | sms/web/src/lib/words.ts:490 (W.conesPerDay) | literal |
| L-line-conesPerShift | Cones weighed per shift | chart heading, spread=shift | sms/web/src/lib/words.ts:491 (W.conesPerShift) | literal |
| L-line-conesPerDayUnavailable | The per-day counts could not be read, so this chart is not drawn. The figures above come from a separate call and are unaffected. | chart failed state | sms/web/src/lib/words.ts:505 (W.conesPerDayUnavailable) | literal |
| L-line-chartStale | This chart is the last reading that arrived — the latest request failed, so it is not refreshing. | chart stale note | sms/web/src/lib/words.ts:503 (W.chartStale) | literal |
| L-line-onePointNoShapeDay | Fewer than two production days in this period hold readings, so there is no shape to compare yet. | chart empty state, day spread | sms/web/src/lib/words.ts:512 (W.onePointNoShape) | literal |
| L-line-onePointNoShapeShift | Only one shift in this period holds readings, so there is no shape to compare yet — pick This week or This month. | chart empty state, shift spread | sms/web/src/lib/words.ts:513 (W.onePointNoShape) | literal |
| L-line-lastReadings | Last readings | block heading | sms/web/src/lib/words.ts:542 (W.lastReadings) | literal |
| L-line-lastSack | Last sack | last-readings row label | sms/web/src/lib/words.ts:543 (W.lastSack) | literal |
| L-line-lastCone | Last cone | last-readings row label | sms/web/src/lib/words.ts:544 (W.lastCone) | literal |
| L-line-details | Details | Details disclosure summary | sms/web/src/lib/words.ts:1347 (W.details) | literal |
| L-line-detailsImplausible | ${n} readings in this period were outside the plausible range for a cone and are excluded from every figure above. | Details disclosure body | sms/web/src/lib/words.ts:1353 (W.detailsImplausible) | pattern |
| L-line-figCones | cones | figure tile unit | sms/web/src/lib/words.ts:146 (W.fig.cones) | literal |
| L-line-figSacks | sacks | figure tile unit | sms/web/src/lib/words.ts:147 (W.fig.sacks) | literal |
| L-line-figRejected | rejected | figure tile unit | sms/web/src/lib/words.ts:148 (W.fig.rejected) | literal |
| L-line-figKg | kg | figure tile unit | sms/web/src/lib/words.ts:149 (W.fig.kg) | literal |
| L-line-couldNotBeJudged | ${n} could not be judged | outside-limits figure note | sms/web/src/lib/words.ts:154 (W.fig.couldNotBeJudged) | pattern |
| L-line-couldNotRead | could not be read this period | figure tile, field missing | sms/web/src/lib/words.ts:168 (W.fig.couldNotRead) | literal |
| L-line-notCaughtUp | Cones weighed in the last ${lag} have not reached this system yet. | KPI empty state | sms/web/src/lib/words.ts:160 (W.fig.notCaughtUp) | pattern |
| L-line-withinLimits | ${pct} within the scale's limits | figure note | sms/web/src/lib/words.ts:175 (W.withinLimits) | pattern |
| L-line-ofEverything | ${pct} of everything weighed | figure note | sms/web/src/lib/words.ts:176 (W.ofEverything) | pattern |
| L-line-outsideProduct | outside the product's limits | figure unit label | sms/web/src/lib/words.ts:180 (W.outsideProduct) | literal |
| L-line-dataIssue | Part of this period's figures could not be read from the source. See Health for which. | headline replacement, data issue | sms/web/src/lib/words.ts:1369 (W.dataIssueThisPeriod) | literal |
| L-line-nothingHere | Nothing recorded in this period. | empty state | sms/web/src/lib/words.ts:1362 (W.nothingHere) | literal |
| L-line-noData | Nothing has been received from the plant yet. | Line top-level empty state | sms/web/src/lib/words.ts:108 (W.lag.noData); used Line.tsx:137 | literal |
| L-line-machinesTitle | What is being made | machine block heading | sms/web/src/lib/words.ts:1760 (W.cone.machinesTitle) | literal |
| L-line-machineRunning | Running | machine state | sms/web/src/lib/words.ts:2350 (W.machineState.running) | literal |
| L-line-machineQuiet | No cones for ${span} (last ${lastSeen}) | machine state, quiet | sms/web/src/lib/words.ts:2348 (W.machineState.quiet) | pattern |
| L-line-machineStale | Not seen since ${lastSeen} | machine state, stale | sms/web/src/lib/words.ts:2349 (W.machineState.stale) | pattern |
| L-line-machineSilent | Not seen for over a week — check the machine or its scale | machine state, silent | sms/web/src/lib/words.ts:2350 (W.machineState.silent) | literal |
| L-line-onMachines | On ${list} | product row, machine list | sms/web/src/lib/words.ts:303 (W.product.onMachines) | pattern |
| L-line-productNone | No product has been recorded for this line yet. | product block, never recorded | sms/web/src/lib/words.ts:230 (W.product.none) | literal |
| L-line-productNoneAtThisTime | No product was recorded for the line at this time. | product block, none in force | sms/web/src/lib/words.ts:235 (W.product.noneAtThisTime) | literal |
| L-line-productTarget | Target | product block label | sms/web/src/lib/words.ts:217 (W.product.target) | literal |
| L-line-productLimits | limits | product block label | sms/web/src/lib/words.ts:201 (W.product.limits) | literal |
| L-line-productHistory | History | product block button | sms/web/src/lib/words.ts:223 (W.product.history) | literal |
| L-line-productChange | Change | product block button | sms/web/src/lib/words.ts:222 (W.product.change) | literal |
| L-line-notSentToMachine | Recorded here for weight limits and reports. It is not sent to the machine. | product block note | sms/web/src/lib/words.ts:216 (W.product.notSentToMachine) | literal |
| L-line-retiredMarker | (retired in PDAS) | product/cone label suffix | sms/web/src/lib/words.ts:2378 (W.retiredProduct.marker) | literal |
| L-line-retiredStillRunning | This product is marked retired in PDAS but is still being produced — worth checking. | retired-product warning | sms/web/src/lib/words.ts:2377 (W.retiredProduct.stillRunning) | literal |
| L-line-noProductName | Product ${id} | machine/product fallback label | sms/web/src/lib/words.ts:1800 (W.cone.noProductName) | pattern |
| L-line-noMaterial | no product on the reading | machine list, no material | sms/web/src/lib/words.ts:1798 (W.cone.noMaterial) | literal |
| L-line-since | since ${t} | machine row, since when | sms/web/src/lib/words.ts:1691 (W.cone.since) | pattern |
| L-line-sinceAtLeast | for at least 2 h | machine row, since fallback | sms/web/src/lib/words.ts:1795 (W.cone.sinceAtLeast) | literal |
| L-line-conesInWindow | ${n} cones | machine row cone count | sms/web/src/lib/words.ts:1753 (W.cone.conesInWindow) | pattern |
| L-line-measuredToNewest | measured to the newest reading, ${t} | Stations block, degraded health prefix | sms/web/src/lib/words.ts:541 (W.measuredToNewest) | pattern |
| L-line-unattributedRejects | 1 reject not attributed to a station${slash}${n} rejects not attributed to a station | Stations block note (two-branch, singular/plural) | sms/web/src/lib/words.ts:537 (W.unattributedRejects) | pattern |
| L-shared-loading | Loading… | generic loading indicator | sms/web/src/lib/words.ts:1354 (W.loading) | literal |
| L-line-passed | Passed | last-cone/last-sack status | sms/web/src/lib/words.ts:178 (W.passed) | literal |
| L-line-rejectedByScale | Rejected by the scale | last-cone/last-sack status | sms/web/src/lib/words.ts:179 (W.rejectedByScale) | literal |
| L-readings-cones | Cones | listing toggle | sms/web/src/lib/words.ts:486 (W.readings.cones) | literal |
| L-readings-sacks | Sacks | listing toggle | sms/web/src/lib/words.ts:549 (W.readings.sacks) | literal |
| L-readings-rejectedCones | Rejected cones | listing toggle (rl=rejected) | sms/web/src/lib/words.ts:550 (W.readings.rejectedCones) | literal |
| L-readings-inspectionRejects | Rejected by inspection | listing toggle (rl=inspectionRejects) | sms/web/src/lib/words.ts:565 (W.readings.inspectionRejects) | literal |
| L-readings-filterOutsideLimits | Outside product limits | filter chip label | sms/web/src/lib/words.ts:566 (W.readings.filterOutsideLimits) | literal |
| L-readings-clear | Clear | filter chip clear button | sms/web/src/lib/words.ts:617 (W.readings.clear) | literal |
| L-readings-nothing | Nothing was weighed in this period. | empty state | sms/web/src/lib/words.ts:622 (W.readings.nothing) | literal |
| L-readings-nothingOutside | No cones in this period were passed by the scale but outside the product's limits. | empty state, outside-limits filter | sms/web/src/lib/words.ts:573 (W.readings.nothingOutside) | literal |
| L-readings-liveNote | new readings appear every 15 seconds | live-list note | sms/web/src/lib/words.ts:619 (W.readings.liveNote) | literal |
| L-readings-perPage | ${n} a page, newest first · ${total} in this period | pagination note | sms/web/src/lib/words.ts:618 (W.readings.perPage) | pattern |
| L-readings-next | Next | pagination button | sms/web/src/lib/words.ts:620 (W.readings.next) | literal |
| L-readings-previous | Previous | pagination button | sms/web/src/lib/words.ts:621 (W.readings.previous) | literal |
| L-readings-stationFilterUnavailable | Station filter unavailable | station filter, failed | sms/web/src/lib/words.ts:610 (W.readings.stationFilterUnavailable) | literal |
| L-readings-filterStation | Station | station filter label | sms/web/src/lib/words.ts:523 (W.readings.filterStation) | literal |
| L-readings-filterRejected | Rejected only | filter label | sms/web/src/lib/words.ts:612 (W.readings.filterRejected) | literal |
| L-readings-filterShift | Shift | filter label | sms/web/src/lib/words.ts:523 (W.readings.filterShift) | literal |
| L-readings-moreFilters | More filters | filter disclosure | sms/web/src/lib/words.ts:614 (W.readings.moreFilters) | literal |
| L-readings-weightRange | Weight range | filter label | sms/web/src/lib/words.ts:615 (W.readings.weightRange) | literal |
| L-readings-reason | Reason | filter label | sms/web/src/lib/words.ts:470 (W.readings.reason) | literal |
| L-readings-countLine | ${n} weighed, ${rejected} rejected by the scale (${pct}). | count sentence, normal | sms/web/src/lib/words.ts:575 (W.readings.countLine) | pattern |
| L-readings-countLineOutside | ${n} cones passed by the scale but outside the product's limits. | count sentence, outside-limits filter | sms/web/src/lib/words.ts:572 (W.readings.countLineOutside) | pattern |
| L-readings-countLineRejectUnknown | ${n} weighed; how many the scale rejected could not be loaded. | count sentence, reject count failed | sms/web/src/lib/words.ts:582 (W.readings.countLineRejectUnknown) | pattern |
| L-readings-countLinePending | counting the readings in this period… | count sentence, pending | sms/web/src/lib/words.ts:590 (W.readings.countLinePending) | literal |
| L-readings-countLineRejectPending | ${n} weighed; still counting how many the scale rejected. | count sentence, reject count pending | sms/web/src/lib/words.ts:592 (W.readings.countLineRejectPending) | pattern |
| L-readings-countLineNoRate | ${n} weighed, ${rejected} rejected by the scale. | count sentence, no rate | sms/web/src/lib/words.ts:600 (W.readings.countLineNoRate) | pattern |
| L-readings-countLineFailed | Could not load this period's count. The plant connection may be down. | count sentence, failed | sms/web/src/lib/words.ts:604 (W.readings.countLineFailed) | literal |
| L-readings-time | Time | table column header | sms/web/src/lib/words.ts:623 (W.readings.time) | literal |
| L-readings-sackNo | Sack | table column header (sack listing) | sms/web/src/lib/words.ts:543 (W.readings.sackNo) | literal |
| L-readings-record | Record | table column header (cone/reject listing) | sms/web/src/lib/words.ts:477 (W.readings.record) | literal |
| L-readings-weight | Weight | table column header | sms/web/src/lib/words.ts:557 (W.readings.weight) | literal |
| L-readings-status | Status | table column header (sack listing) | sms/web/src/lib/words.ts:451 (W.readings.status) | literal |
| L-readings-colState | State | table column header (cone listing) | sms/web/src/lib/words.ts:1723 (W.cone.colState) | literal |
| L-readings-colProduct | Product | table column header (cone listing) | sms/web/src/lib/words.ts:1726 (W.cone.colProduct) | literal |
| L-readings-noProductOnRow | — | product column, none recorded | sms/web/src/lib/words.ts:1592 (W.cone.noProductOnRow) | literal |
| L-readings-weightRejectFallback | Weight reject | inspection-reject row fallback label | sms/web/src/screens/Readings.tsx:627 | literal |
| L-readings-qualityRejectFallback | Quality reject | inspection-reject row fallback label | sms/web/src/screens/Readings.tsx:627 | literal |
| L-readings-openRecord | Open | row chevron label | sms/web/src/lib/words.ts:1335 (W.openRecord) | literal |
| L-readings-coneStateWithin | Within limits | cone state | sms/web/src/lib/words.ts:1710 (W.cone.state.within) | literal |
| L-readings-coneStateLow | Under the limit | cone state | sms/web/src/lib/words.ts:1711 (W.cone.state.low) | literal |
| L-readings-coneStateHigh | Over the limit | cone state | sms/web/src/lib/words.ts:1712 (W.cone.state.high) | literal |
| L-readings-coneStateRejected | Rejected by the scale | cone state | sms/web/src/lib/words.ts:1701 (W.cone.state.rejected) | literal |
| L-readings-coneStateUnknown | Not judged | cone state | sms/web/src/lib/words.ts:1714 (W.cone.state.unknown) | literal |
| L-readingSheet-titleSack | Sack | sheet title | sms/web/src/screens/ReadingSheet.tsx:117 | literal |
| L-readingSheet-titleReject | Rejected cone | sheet title | sms/web/src/screens/ReadingSheet.tsx:117 | literal |
| L-readingSheet-titleCone | Cone | sheet title | sms/web/src/screens/ReadingSheet.tsx:117 | literal |
| L-readingSheet-eyebrow | ${noun}${station} · ${shift} shift | sheet eyebrow | sms/web/src/screens/ReadingSheet.tsx:137 | pattern |
| L-readingSheet-couldNotLoad | Could not load this. The plant connection may be down. | sheet error state | sms/web/src/lib/words.ts:1355 (W.couldNotLoad) | literal |
| L-readingSheet-notWeighed | not weighed | weight value, quality reject | sms/web/src/lib/words.ts:646 (W.readings.notWeighed) | literal |
| L-readingSheet-rejectedFor | Rejected — ${reason} | headline state, reject sheet | sms/web/src/lib/words.ts:647 (W.readings.rejectedFor) | pattern |
| L-readingSheet-weightReject | weight reject | reject reason fallback | sms/web/src/lib/words.ts:639 (W.readings.weightReject) | literal |
| L-readingSheet-qualityRejectCode | quality reject, code ${pair} (not yet named) | reject reason fallback | sms/web/src/lib/words.ts:649 (W.readings.qualityRejectCode) | pattern |
| L-readingSheet-withinOf | Within the product's limits, ${limits}. | tolerance sentence | sms/web/src/lib/words.ts:1738 (W.cone.withinOf) | pattern |
| L-readingSheet-lowHigh | ${By}, ${limits} — passed by the scale. Which judgement governs is not yet confirmed by IFL. | tolerance sentence, scale/product disagree | sms/web/src/lib/words.ts:1741 (W.cone.lowHigh) | pattern |
| L-readingSheet-rejectedInside | Rejected by the scale; the weight sits inside the product's limits, ${limits}. Which judgement governs is not yet confirmed by IFL. | tolerance sentence, rejected but inside | sms/web/src/lib/words.ts:1744 (W.cone.rejectedInside) | pattern |
| L-readingSheet-rejectedOutside | Rejected by the scale; ${by}, ${limits}. | tolerance sentence, rejected and outside | sms/web/src/lib/words.ts:1744 (W.cone.rejectedOutside) | pattern |
| L-readingSheet-noLimits | Not judged against a tolerance: no product limits were in force at this time. | tolerance sentence, no limits | sms/web/src/lib/words.ts:1747 (W.cone.notJudged.no_limits) | literal |
| L-readingSheet-implausible | Not judged: the weight is outside the plausibility window (${lo} to ${hi}), so it is treated as a scale fault rather than a light or heavy cone. The window is not yet confirmed by IFL. | tolerance sentence, implausible weight | sms/web/src/lib/words.ts:1749 (W.cone.notJudged.implausible) | pattern |
| L-readingSheet-noWeight | Not judged: no weight was recorded. | tolerance sentence, no weight | sms/web/src/lib/words.ts:1750 (W.cone.notJudged.no_weight) | literal |
| L-readingSheet-noProductThen | No product was recorded at this time, so there are no product limits to compare against. | tolerance sentence, no product | sms/web/src/lib/words.ts:183 (W.noProductThen) | literal |
| L-readingSheet-noTargetWeight | The product recorded at this time carries no target weight, so there are no limits to compare against. | tolerance sentence, product with no target | sms/web/src/screens/ReadingSheet.tsx:203 | literal |
| L-readingSheet-alsoOutsideProduct | Also outside the product's limits: ${limits} at this time, so ${by}. | tolerance sentence, scale-passed but outside | sms/web/src/lib/words.ts:182 (W.alsoOutsideProduct) | pattern |
| L-readingSheet-weighed | Weighed | dt label | sms/web/src/lib/words.ts:646 (W.readings.weighed) | literal |
| L-readingSheet-recorded | Recorded | dt label (reject / sack insert-time) | sms/web/src/lib/words.ts:477 (W.readings.recorded) | literal |
| L-readingSheet-shift | Shift | dt label | sms/web/src/screens/ReadingSheet.tsx:227 | literal |
| L-readingSheet-station | Station | dt label | sms/web/src/screens/ReadingSheet.tsx:231 | literal |
| L-readingSheet-sackNo | Sack | dt label | sms/web/src/lib/words.ts:543 (W.readings.sackNo) | literal |
| L-readingSheet-record | Record | dt label (source row id) | sms/web/src/lib/words.ts:477 (W.readings.record) | literal |
| L-readingSheet-productThen | Product then | dt label | sms/web/src/screens/ReadingSheet.tsx:252 | literal |
| L-readingSheet-insertTimeCaveat | The plant records no separate weighing time for a sack — this is when the reading was written, which can trail the actual weighing. | sack caveat | sms/web/src/lib/words.ts:657 (W.readings.insertTimeCaveat) | literal |
| L-readingSheet-aroundSack | About ${n} cones were weighed between the previous sack and this one (approximate; the plant records no link between a cone and its sack). | sack "around" note | sms/web/src/lib/words.ts:716 (W.readings.aroundSack) | pattern |
| L-readingSheet-seeProductReport | See this product's report | link | sms/web/src/lib/words.ts:668 (W.readings.seeProductReport) | literal |
| L-readingSheet-seeProductReportNote | opens the product report for this product, on this reading's day | link note | sms/web/src/lib/words.ts:669 (W.readings.seeProductReportNote) | literal |
| L-readingSheet-seeProductCatalogue | See this product in the catalogue | link | sms/web/src/lib/words.ts:674 (W.readings.seeProductCatalogue) | literal |
| L-readingSheet-seeProductCatalogueNote | opens Product › Catalogue for this product | link note | sms/web/src/lib/words.ts:675 (W.readings.seeProductCatalogueNote) | literal |
| L-readingSheet-provenance | Where this reading came from | disclosure summary | sms/web/src/lib/words.ts:676 (W.readings.provenance) | literal |
| L-readingSheet-provenanceNote | Plant times are shown as the plant records them; the time it reached this system is shown in this computer's own time. | provenance intro | sms/web/src/lib/words.ts:683 (W.readings.provenanceNote) | literal |
| L-readingSheet-provSourceTable | Source table | provenance field | sms/web/src/lib/words.ts:685 | literal |
| L-readingSheet-provSourceSystem | Source system | provenance field | sms/web/src/lib/words.ts:686 | literal |
| L-readingSheet-provGeneration | Data batch | provenance field | sms/web/src/lib/words.ts:687 | literal |
| L-readingSheet-provSourceRow | Source row id | provenance field | sms/web/src/lib/words.ts:688 | literal |
| L-readingSheet-provReadAt | Read into this system | provenance field | sms/web/src/lib/words.ts:689 | literal |
| L-readingSheet-provInsertedAt | Written by the plant | provenance field | sms/web/src/lib/words.ts:690 | literal |
| L-readingSheet-provTransform | Processing version | provenance field | sms/web/src/lib/words.ts:691 | literal |
| L-readingSheet-provProduct | Product determined | provenance field | sms/web/src/lib/words.ts:692 | literal |
| L-readingSheet-provRawRow | Ingest record id | provenance field | sms/web/src/lib/words.ts:693 | literal |
| L-readingSheet-provSyncPass | Sync pass | provenance field | sms/web/src/lib/words.ts:694 | literal |
| L-readingSheet-provNightRule | Night shift counted to | provenance field | sms/web/src/lib/words.ts:695 | literal |
| L-readingSheet-provPlantShift | Plant-stored shift | provenance field | sms/web/src/lib/words.ts:696 | literal |
| L-readingSheet-provProductionDay | Production day | provenance field | sms/web/src/lib/words.ts:697 | literal |
| L-readingSheet-provNotAvailable | Not available for this reading. | provenance, no object | sms/web/src/lib/words.ts:699 | literal |
| L-readingSheet-provAttrSourceColumn | from the reading's own material id | attribution method | sms/web/src/lib/words.ts:704 | literal |
| L-readingSheet-provAttrNone | no product recorded on the reading | attribution method | sms/web/src/lib/words.ts:705 | literal |
| L-readingSheet-provAttrManual | set by hand on this line | attribution method | sms/web/src/lib/words.ts:706 | literal |
| L-readingSheet-provAttrUnknown | not recorded | attribution method | sms/web/src/lib/words.ts:707 | literal |
| L-weight-headlineUnconfirmed | Average recorded weight is ${mean}; the product target is ${target} (weight basis not yet confirmed). | headline, weight basis unconfirmed | sms/web/src/lib/words.ts:741 (W.weight.headlineUnconfirmed) | pattern |
| L-weight-headlineConfirmed | Average cone weight is ${mean}, ${delta} the ${target} target. | headline, confirmed | sms/web/src/lib/words.ts:743 (W.weight.headlineConfirmed) | pattern |
| L-weight-headlineNoTarget | Average cone weight is ${mean}. No product target is recorded for this period. | headline, no target | sms/web/src/lib/words.ts:744 (W.weight.headlineNoTarget) | pattern |
| L-weight-headlineStationDataFailed | Station and target data could not be loaded; the chart below may still be usable. | headline, station/target fetch failed | sms/web/src/lib/words.ts:942 (W.weight.headlineStationDataFailed) | literal |
| L-weight-headlineAvgOnlyFailed | Average cone weight is ${mean}. ${headlineStationDataFailed text} | headline, average known but station data failed | sms/web/src/screens/Weight.tsx:695 | pattern |
| L-weight-noneWeighed | No cones were weighed in this period. | headline, empty period | sms/web/src/screens/Weight.tsx:681 | literal |
| L-weight-countCouldNotRead | How many cones were weighed could not be read this period, so no average is shown. | headline, count field missing | sms/web/src/lib/words.ts:955 (W.weight.countCouldNotRead) | literal |
| L-weight-stationsNeedLook | One station's pattern shows drift — worth a look.${slash}${n} stations' patterns show drift — worth a look. | headline tail (two-branch, singular/plural) | sms/web/src/lib/words.ts:755 (W.weight.stationsNeedLook) | pattern |
| L-weight-allStationsSteady | No station's pattern shows drift. | headline tail, none flagged | sms/web/src/lib/words.ts:756 (W.weight.allStationsSteady) | literal |
| L-weight-lineOffset | ${prefix} read ${lo}–${hi} g ${dir} the ${target} target. That is a line-wide offset, not a station fault. | line-wide offset sentence (prefix is "All N stations" or "N of total stations") | sms/web/src/lib/words.ts:780 (W.weight.lineOffset) | pattern |
| L-weight-above | above | direction word | sms/web/src/lib/words.ts:649 (W.weight.above) | literal |
| L-weight-below | below | direction word | sms/web/src/lib/words.ts:639 (W.weight.below) | literal |
| L-weight-figGAverage | g average | figure tile unit | sms/web/src/lib/words.ts:150 (W.fig.gAverage) | literal |
| L-weight-spread | ${lo} to ${hi} | spread figure | sms/web/src/lib/words.ts:670 (W.weight.spread) | pattern |
| L-weight-spreadNote | two standard deviations either side of the average | spread figure note | sms/web/src/lib/words.ts:789 (W.weight.spreadNote) | literal |
| L-weight-noTarget | No product target | figure note | sms/web/src/lib/words.ts:750 (W.weight.noTarget) | literal |
| L-weight-targetUnknown | Target unknown — could not load | figure note, target fetch failed | sms/web/src/lib/words.ts:959 (W.weight.targetUnknown) | literal |
| L-weight-tabOverTime | Over time | chart tab | sms/web/src/lib/words.ts:852 (W.weight.overTime) | literal |
| L-weight-tabDistribution | Distribution | chart tab | sms/web/src/lib/words.ts:853 (W.weight.distribution) | literal |
| L-weight-limitsChangedOne | The product's limits changed once inside this period. The dashed lines are the version in force at its end and did not apply to every reading before the change. | chart note, 1 limits change | sms/web/src/lib/words.ts:850 (W.weight.limitsChanged) | literal |
| L-weight-limitsChangedMany | The product's limits changed ${n} times inside this period. The dashed lines are the version in force at its end and did not apply to every reading before the changes. | chart note, N limits changes | sms/web/src/lib/words.ts:851 (W.weight.limitsChanged) | pattern |
| L-weight-sackNoTarget | No product tolerance applies: the product target is a cone weight in grams, and this is a sack weight in kilograms. | sack chart note | sms/web/src/lib/words.ts:926 (W.weight.sackNoTarget) | literal |
| L-weight-sackChartOnly | The headline, the figures above and the station table below still describe cones, not this sack chart. | sack chart note | sms/web/src/lib/words.ts:933 (W.weight.sackChartOnly) | literal |
| L-weight-timeChartAriaSack | Average sack weight over time | time chart aria-label, sack unit | sms/web/src/screens/Weight.tsx:1032 | literal |
| L-weight-timeChartAriaCone | Average cone weight over time | time chart aria-label, cone unit | sms/web/src/screens/Weight.tsx:1032 | literal |
| L-weight-distChartAriaSack | Sack weight distribution | distribution chart aria-label, sack unit | sms/web/src/screens/Weight.tsx:1237 | literal |
| L-weight-distChartAriaCone | Cone weight distribution | distribution chart aria-label, cone unit | sms/web/src/screens/Weight.tsx:1237 | literal |
| L-weight-spanNote | group means in this period have ranged ${lo} to ${hi} | time chart resting caption | sms/web/src/lib/words.ts:806 (W.weight.spanNote) | pattern |
| L-weight-outsideBand | ${n} of ${total} group averages fell outside the control band — the band is set from the movement between one group and the next, so a slow change in level across the period puts many groups outside it. | control band note | sms/web/src/lib/words.ts:819 (W.weight.outsideBand) | pattern |
| L-weight-bandInvalid | No control band is drawn for this period: there are too few consecutive groups to measure one from. | control band note, invalid | sms/web/src/lib/words.ts:823 (W.weight.bandInvalid) | literal |
| L-weight-patternsWithheld | Run and trend patterns are not marked: measured against this line's own readings they flag roughly two groups in every five, which is too many to act on. | pattern-rules note | sms/web/src/lib/words.ts:833 (W.weight.patternsWithheld) | literal |
| L-weight-oneGeneration | This chart covers one data batch of the source tables: ${shown} readings. Another ${excluded} readings in this period belong to a different data batch — the tables were rebuilt and their numbering restarted — and are left out rather than mixed in, because the two are not one continuous record. | chart note, source-generation split | sms/web/src/lib/words.ts:846 (W.weight.oneGeneration) | pattern |
| L-weight-stationsTable | Stations | station table heading | sms/web/src/lib/words.ts:857 (W.weight.stationsTable) | literal |
| L-weight-sortNote | flagged first, then by distance from target | station table sort note | sms/web/src/lib/words.ts:859 (W.weight.sortNote) | literal |
| L-weight-sortNoteNoTarget | flagged first, then by distance from the line average | station table sort note, no target | sms/web/src/lib/words.ts:860 (W.weight.sortNoteNoTarget) | literal |
| L-weight-colStation | Station | station table column header | sms/web/src/lib/words.ts:864 (W.weight.colStation) | literal |
| L-weight-colAverage | Average | station table column header | sms/web/src/lib/words.ts:749 (W.weight.colAverage) | literal |
| L-weight-colVsLine | vs line | station table column header | sms/web/src/lib/words.ts:863 (W.weight.colVsLine) | literal |
| L-weight-colVsTarget | vs target | station table column header | sms/web/src/lib/words.ts:867 (W.weight.colVsTarget) | literal |
| L-weight-colPattern | Pattern | station table column header | sms/web/src/lib/words.ts:865 (W.weight.colPattern) | literal |
| L-weight-colTrend | 11-day trend | station table column header | sms/web/src/lib/words.ts:869 (W.weight.colTrend) | literal |
| L-weight-trendScale | Trend column: one shared scale for every station, ${lo} to ${hi}. | trend column note | sms/web/src/lib/words.ts:870 (W.weight.trendScale) | pattern |
| L-weight-colRejects | Rejects | station table column header | sms/web/src/lib/words.ts:649 (W.weight.colRejects) | literal |
| L-weight-colShows | What the data shows | station table column header | sms/web/src/lib/words.ts:872 (W.weight.colShows) | literal |
| L-weight-steady | Steady. | station row, steady | sms/web/src/lib/words.ts:873 (W.weight.steady) | literal |
| L-weight-readsHeavier | Has read about ${g} heavier than the line for ${days} days — check its scale first. | station row note | sms/web/src/lib/words.ts:878 (W.weight.readsHeavier) | pattern |
| L-weight-readsLighter | Has read about ${g} lighter than the line for ${days} days — check its scale first. | station row note | sms/web/src/lib/words.ts:880 (W.weight.readsLighter) | pattern |
| L-weight-adjustedSince | Adjusted ${span}, steady since. | station row note, post-adjustment | sms/web/src/lib/words.ts:883 (W.weight.adjustedSince) | pattern |
| L-weight-highestRejects | Highest reject rate on the line, mostly quality codes — look at tubes before scales. | station row note | sms/web/src/lib/words.ts:886 (W.weight.highestRejects) | literal |
| L-weight-andMoreSteady | and ${n} more stations, all steady | station table footer | sms/web/src/lib/words.ts:887 (W.weight.andMoreSteady) | pattern |
| L-weight-mixedTarget | No single target applies — ${n} materials ran here. | station table target cell | sms/web/src/lib/words.ts:906 (W.weight.mixedTarget) | pattern |
| L-weight-targetLineProduct | No material recorded for these readings — judged against the line-wide product instead. | station table target cell tooltip | sms/web/src/lib/words.ts:921 (W.weight.targetLineProduct) | literal |
| L-weight-limitsChangedTable | The line-wide target's limits changed once inside this window; stations show the version in force at its end.${slash}The line-wide target's limits changed ${n} times inside this window; stations show the version in force at its end. | station table note (two-branch) | sms/web/src/lib/words.ts:912 (W.weight.limitsChangedTable) | pattern |
| L-weight-productChangedTable | The line-wide Current Product changed once inside this window.${slash}The line-wide Current Product changed ${n} times inside this window. | station table note (two-branch) | sms/web/src/lib/words.ts:917 (W.weight.productChangedTable) | pattern |
| L-weight-logAdjustment | Log an adjustment | station sheet button | sms/web/src/lib/words.ts:888 (W.weight.logAdjustment) | literal |
| L-weight-adjustmentLog | Adjustment log | station sheet heading | sms/web/src/lib/words.ts:889 (W.weight.adjustmentLog) | literal |
| L-weight-adjustmentsIn | ${n} ${word} in the last ${days} days. | station sheet log note (word is adjustment/adjustments) | sms/web/src/lib/words.ts:891 (W.weight.adjustmentsIn) | pattern |
| L-weight-adjustmentResets | A logged adjustment restarts that station's pattern from that moment. | station sheet note | sms/web/src/lib/words.ts:892 (W.weight.adjustmentResets) | literal |
| L-weight-save | Save | adjustment form submit | sms/web/src/lib/words.ts:899 (W.weight.save) | literal |
| L-stationSheet-eyebrow | ${W.weight.stationsTable} · ${W.judgedOver(days)} | sheet eyebrow, composed from two words.ts strings joined by " · " | sms/web/src/screens/StationSheet.tsx:121 | pattern |
| L-stationSheet-couldNotLoad | Could not load this. The plant connection may be down. | sheet error state | sms/web/src/lib/words.ts:1355 (W.couldNotLoad) | literal |
| L-stationSheet-notFound | This station has no readings in the window this sheet looks at, or the number in the link no longer matches a station. | sheet empty state | sms/web/src/lib/words.ts:1360 (W.stationNotFound) | literal |
| L-stationSheet-colMedian | Median | figure row label | sms/web/src/lib/words.ts:1849 (W.calibration.colMedian) | literal |
| L-stationSheet-colSd | SD | figure row label | sms/web/src/lib/words.ts:1850 (W.calibration.colSd) | literal |
| L-stationSheet-sdNote | within-day spread of this station's readings | figure row note | sms/web/src/lib/words.ts:1851 (W.calibration.sdNote) | literal |
| L-stationSheet-flaggedDays | Days the pattern test fired | section heading | sms/web/src/lib/words.ts:1854 (W.calibration.flaggedDays) | literal |
| L-stationSheet-noFlaggedDays | The pattern test did not fire on any day in the window. | empty state | sms/web/src/lib/words.ts:1855 (W.calibration.noFlaggedDays) | literal |
| L-stationSheet-adjustmentLog | Adjustment log | section heading | sms/web/src/lib/words.ts:889 (W.weight.adjustmentLog) | literal |
| L-stationSheet-adjustmentsInZero | ${n} ${word} in the last ${days} days. | station sheet, same template as L-weight-adjustmentsIn shown with n=0 | sms/web/src/lib/words.ts:891 (W.weight.adjustmentsIn) | pattern |
| L-stationSheet-colWhen | When | adjustment log column header | sms/web/src/lib/words.ts:1647 (W.calibration.colWhen) | literal |
| L-stationSheet-colAmount | Amount | adjustment log column header | sms/web/src/lib/words.ts:1912 (W.calibration.colAmount) | literal |
| L-stationSheet-colBeforeAfter | Before → after | adjustment log column header | sms/web/src/lib/words.ts:1913 (W.calibration.colBeforeAfter) | literal |
| L-stationSheet-colProduct | Product | adjustment log column header | sms/web/src/lib/words.ts:1797 (W.calibration.colProduct) | literal |
| L-stationSheet-colWhy | Why | adjustment log column header | sms/web/src/lib/words.ts:1915 (W.calibration.colWhy) | literal |
| L-stationSheet-lineWide | whole line | adjustment log row tag | sms/web/src/lib/words.ts:1910 (W.calibration.lineWide) | literal |
| L-stationSheet-allAdjustments | 1 adjustment on record for this station, including line-wide ones.${slash}${n} adjustments on record for this station, including line-wide ones. | log footer (two-branch) | sms/web/src/lib/words.ts:1919 (W.calibration.allAdjustments) | pattern |
| L-stationSheet-adjustmentResets | A logged adjustment restarts that station's pattern from that moment. | note | sms/web/src/lib/words.ts:892 (W.weight.adjustmentResets) | literal |
| L-stationSheet-seeReadings | See this station's readings | link | sms/web/src/lib/words.ts:1926 (W.calibration.seeReadings) | literal |
| L-stationSheet-seeRejects | See this station's rejects | link | sms/web/src/lib/words.ts:1927 (W.calibration.seeRejects) | literal |
| L-stationSheet-seeCalibrationReport | See the calibration report | link | sms/web/src/lib/words.ts:1928 (W.calibration.seeCalibrationReport) | literal |
| L-stationSheet-seeShiftReport | See this machine by shift | link | sms/web/src/lib/words.ts:1929 (W.calibration.seeShiftReport) | literal |
| L-stationSheet-rulesRun | The drift test runs the eight Nelson rules on this station's daily averages, measured from the centreline and the day-to-day sigma below. | pattern-test explanation | sms/web/src/lib/words.ts:1857 (W.calibration.rulesRun) | literal |
| L-stationSheet-centreline | centreline ${g}, day-to-day sigma ${sigma} | pattern-test explanation suffix | sms/web/src/lib/words.ts:1861 (W.calibration.centreline) | pattern |
| L-stationSheet-restartedOn | restarted at the adjustment logged on ${day} | pattern-test explanation, restarted | sms/web/src/lib/words.ts:1862 (W.calibration.restartedOn) | pattern |
| L-stationSheet-cannotFire | On a series of ${points} consecutive days ${rules} cannot complete, so their absence says nothing. | pattern-test explanation | sms/web/src/lib/words.ts:1859 (W.calibration.cannotFire) | pattern |
| L-stationSheet-allCanFire | Every rule can complete on a series of ${points} consecutive days. | pattern-test explanation | sms/web/src/lib/words.ts:1860 (W.calibration.allCanFire) | pattern |
| L-stationSheet-notApproved | Which rules apply, and their use on daily averages, has not yet been confirmed by IFL. | pattern-test disclaimer | sms/web/src/lib/words.ts:1863 (W.calibration.notApproved) | literal |
| L-stationSheet-projection | At the current drift (${rate} over ${days} days) this station reaches the action limit (${limitG} from target) in about ${k} ${word}, if it continues at that rate. | drift projection (word is day/days) | sms/web/src/lib/words.ts:1868 (W.calibration.projection) | pattern |
| L-stationSheet-projectionRange | At the current drift (${rate} over ${days} days) this station reaches the action limit (${limitG} from target) in about ${lowK}–${highK} days (90% range), if it continues at that rate. | drift projection, ranged (RT-020) | sms/web/src/lib/words.ts:1877 (W.calibration.projectionRange) | pattern |
| L-stationSheet-projectionFar | At the current drift (${rate} over ${days} days) this station would not reach the action limit (${limitG} from target) within 90 days, if it continues at that rate. | drift projection, far | sms/web/src/lib/words.ts:1879 (W.calibration.projectionFar) | pattern |
| L-stationSheet-projectionNow | At the current drift (${rate} over ${days} days) this station is already past the action limit (${limitG} from target). | drift projection, already past | sms/web/src/lib/words.ts:1881 (W.calibration.projectionNow) | pattern |
| L-stationSheet-projectionAway | The daily average is moving back toward the target (${rate} over ${days} days). | drift projection, moving away from limit | sms/web/src/lib/words.ts:1883 (W.calibration.projectionAway) | pattern |
| L-stationSheet-projectionNotEstablished | Drift not established from ${days} days. ${reason} | drift projection, CI includes zero (RT-020) | sms/web/src/lib/words.ts:1890 (W.calibration.projectionNotEstablished) | pattern |
| L-stationSheet-projectionAssumption | A projection from recent readings: a straight line through the run's daily averages, assumed to continue at the same rate, with a 90% confidence range on the rate itself. It is not a forecast of what the scale will do. | drift projection tooltip | sms/web/src/lib/words.ts:1892 (W.calibration.projectionAssumption) | literal |
| L-stationSheet-projectionNoLimits | No product limits were in force, so there is no action limit to project to. | drift projection, no limits | sms/web/src/lib/words.ts:1893 (W.calibration.projectionNoLimits) | literal |
| L-stationSheet-projectionTooFewPoints | Only ${n} day${s} in this run — at least ${min} are needed before a drift projection, with a confidence range, can be stated. | drift projection, too few points (RT-020) | sms/web/src/lib/words.ts:1898 (W.calibration.projectionTooFewPoints) | pattern |
| L-stationSheet-adjustedAt | Adjusted at (plant time) | adjustment form field label | sms/web/src/lib/words.ts:1901 (W.calibration.adjustedAt) | literal |
| L-stationSheet-adjustedAtNote | Plant time. Stored as an app instant and converted with the offset the server reports, never the browser's. | adjustment form field note | sms/web/src/lib/words.ts:1920 (W.calibration.adjustedAtNote) | literal |
| L-stationSheet-adjustAmount | Amount (grams, signed) | adjustment form field label | sms/web/src/lib/words.ts:896 (W.weight.adjustAmount) | literal |
| L-stationSheet-adjustWhy | Why | adjustment form field label | sms/web/src/lib/words.ts:898 (W.weight.adjustWhy) | literal |
| L-stationSheet-note | Note | adjustment form field label | sms/web/src/lib/words.ts:1782 (W.calibration.note) | literal |
| L-stationSheet-referenceG | Reference weight (g) | adjustment form field label | sms/web/src/lib/words.ts:1905 (W.calibration.referenceG) | literal |
| L-stationSheet-beforeG | Reference read before (g) | adjustment form field label | sms/web/src/lib/words.ts:1903 (W.calibration.beforeG) | literal |
| L-stationSheet-afterG | Reference read after (g) | adjustment form field label | sms/web/src/lib/words.ts:1904 (W.calibration.afterG) | literal |
| L-stationSheet-productInForce | Product in force | adjustment form field label | sms/web/src/lib/words.ts:1906 (W.calibration.productInForce) | literal |
| L-stationSheet-productFromMachine | ${name} — from the machine's newest cones | adjustment form, auto-filled product | sms/web/src/lib/words.ts:1907 (W.calibration.productFromMachine) | pattern |
| L-stationSheet-productQuiet | nothing on this machine in the last 2 h — left blank | adjustment form, no recent product | sms/web/src/lib/words.ts:1908 (W.calibration.productQuiet) | literal |
| L-stationSheet-productClear | clear | adjustment form, clear product button | sms/web/src/lib/words.ts:1909 (W.calibration.productClear) | literal |
| L-stationSheet-save | Save | adjustment form submit button | sms/web/src/lib/words.ts:899 (W.weight.save) | literal |
| L-stationSheet-cancel | Cancel | adjustment form cancel button | sms/web/src/lib/words.ts:250 (W.product.cancel) | literal |
| L-rejects-question | How many cones are being rejected, why, is it getting worse, and where? | screen question | sms/web/src/lib/words.ts:61 (W.question.rejects) | literal |
| L-rejects-headline | ${n} cones rejected, ${pct} of everything weighed — ${quality} for quality, ${weight} for weight | headline | sms/web/src/lib/words.ts:965 (W.rejects.headline) | pattern |
| L-rejects-steady | steady | headline tail, not rising | sms/web/src/lib/words.ts:873 (W.rejects.steady) | literal |
| L-rejects-steadyAfterRisesOne | not rising now, after one rise in this window that ended ${lastEnded} | headline tail | sms/web/src/lib/words.ts:973 (W.rejects.steadyAfterRises) | pattern |
| L-rejects-steadyAfterRisesMany | not rising now, after ${n} rises in this window, the last ending ${lastEnded} | headline tail | sms/web/src/lib/words.ts:974 (W.rejects.steadyAfterRises) | pattern |
| L-rejects-risingSince | ${kind} rejects have been rising since ${when} | headline tail, rising | sms/web/src/lib/words.ts:975 (W.rejects.risingSince) | pattern |
| L-rejects-none | No cones were rejected in this period. | empty state | sms/web/src/lib/words.ts:1013 (W.rejects.none) | literal |
| L-rejects-fig-rejected | rejected | figure tile unit | sms/web/src/lib/words.ts:148 (W.fig.rejected) | literal |
| L-rejects-ofEverything | ${pct} of everything weighed | figure note | sms/web/src/lib/words.ts:176 (W.ofEverything) | pattern |
| L-rejects-reasonsTitle | Reasons, last ${days} days | Pareto heading | sms/web/src/lib/words.ts:993 (W.rejects.reasonsTitle) | pattern |
| L-rejects-vitalFew | ${n}${g0}reason accounts${g1}for ${pct} of rejects in this period.${slash}${n}${g2}reasons account${g3}for ${pct} of rejects in this period. | Pareto note (two-branch, singular/plural) | sms/web/src/lib/words.ts:1017 (W.rejects.vitalFew) | pattern |
| L-rejects-clickBarHint | Choose a reason to follow it through the trend and the days below. | Pareto hint | sms/web/src/lib/words.ts:1389 (W.rejectsMore.clickBarHint) | literal |
| L-rejects-cumulativePct | Cumulative % | Pareto bar aria-label | sms/web/src/lib/words.ts:1018 (W.rejects.cumulativePct) | literal |
| L-rejects-namesAwaited | Reason names have not been supplied yet. A manager can name a code here; the name applies to history. | Pareto note, no code names | sms/web/src/lib/words.ts:996 (W.rejects.namesAwaited) | literal |
| L-rejects-nameIt | Name it | inline "Name it" editor, open button | sms/web/src/lib/words.ts:997 (W.rejects.nameIt) | literal |
| L-rejects-nameForCode | Name for this code | inline editor input aria-label | sms/web/src/screens/Rejects.tsx:787 | literal |
| L-rejects-renameFailed | The name was not saved. Try again. | inline editor, save failure | sms/web/src/lib/words.ts:1425 (W.rejectsMore.renameFailed) | literal |
| L-rejects-notYetNamed | not yet named | reason fallback | sms/web/src/lib/words.ts:977 (W.rejects.notYetNamed) | literal |
| L-rejects-codeUnnamed | Code ${code} — not yet named | reason fallback | sms/web/src/lib/words.ts:978 (W.rejects.codeUnnamed) | pattern |
| L-rejects-noCode | No code recorded | reason fallback | sms/web/src/lib/words.ts:979 (W.rejects.noCode) | literal |
| L-rejects-trendTitle | Reject rate over the last ${days} days · usual range shaded | trend heading | sms/web/src/lib/words.ts:1396 (W.rejectsMore.trendTitle) | pattern |
| L-rejects-trendTitleNoShade | Reject rate over the last ${days} days | trend heading, no shading | sms/web/src/lib/words.ts:1396 (W.rejectsMore.trendTitleNoShade) | pattern |
| L-rejects-bandLabel | usual range | trend chart legend | sms/web/src/lib/words.ts:1396 (W.rejectsMore.bandLabel) | literal |
| L-rejects-bandNote | The shaded band is the usual range for quality rejects at that day's volume; the dashed line is the same ceiling for weight rejects. A marked day sits above its ceiling. | trend chart note | sms/web/src/lib/words.ts:1399 (W.rejectsMore.bandNote) | literal |
| L-rejects-bandNoteOneSeries | The shaded band is the usual range for this reason at that day's volume. A marked day sits above it. | trend chart note, single reason | sms/web/src/lib/words.ts:1400 (W.rejectsMore.bandNoteOneSeries) | literal |
| L-rejects-aboveUsual | above the usual range | trend chart marker note | sms/web/src/lib/words.ts:1401 (W.rejectsMore.aboveUsual) | literal |
| L-rejects-noReadingThisDay | no reading this day | trend chart hover, gap in series | sms/web/src/lib/words.ts:1408 (W.rejectsMore.noReadingThisDay) | literal |
| L-rejects-daysHoldReadings | Only ${n} of those ${of} days hold readings. | trend note | sms/web/src/lib/words.ts:986 (W.rejects.daysHoldReadings) | pattern |
| L-rejects-spansGenerations | This window crosses the 5 August rebuild of IFL's tables. The usual range is worked out separately on each side of it, never across. | trend note, spans generations | sms/web/src/lib/words.ts:989 (W.rejects.spansGenerations) | literal |
| L-rejects-usualRange | usual range | label | sms/web/src/lib/words.ts:989 (W.rejects.usualRange) | literal |
| L-rejects-byDayTitle | By day and reason | breakdown table heading | sms/web/src/lib/words.ts:1410 (W.rejectsMore.byDayTitle) | literal |
| L-rejects-byDayNote | Rate is that day's share of everything inspected. A day here is the production day, 06:00 to 06:00. | breakdown table note | sms/web/src/lib/words.ts:1411 (W.rejectsMore.byDayNote) | literal |
| L-rejects-dayBasisCaveat | IFL has not confirmed whether reject reports should count by production day or by calendar date; this screen uses the production day. | breakdown table caveat | sms/web/src/lib/words.ts:1414 (W.rejectsMore.dayBasisCaveat) | literal |
| L-rejects-colDay | Day | breakdown table column header | sms/web/src/lib/words.ts:1408 (W.rejectsMore.colDay) | literal |
| L-rejects-colReason | Reason | breakdown table column header | sms/web/src/lib/words.ts:1329 (W.rejectsMore.colReason) | literal |
| L-rejects-colCount | Rejects | breakdown table column header | sms/web/src/lib/words.ts:1420 (W.rejectsMore.colCount) | literal |
| L-rejects-colCones | Cones that day | breakdown table column header | sms/web/src/lib/words.ts:1418 (W.rejectsMore.colCones) | literal |
| L-rejects-colRate | Rate | breakdown table column header | sms/web/src/lib/words.ts:1406 (W.rejectsMore.colRate) | literal |
| L-rejects-noneForFilters | No rejects match these filters in this period. | breakdown table empty state | sms/web/src/lib/words.ts:1420 (W.rejectsMore.noneForFilters) | literal |
| L-rejects-seeTheCones | See the rejected cones themselves | link | sms/web/src/lib/words.ts:998 (W.rejects.seeTheCones) | literal |
| L-rejects-seeTheConesNote | opens Readings filtered to cones rejected by inspection, for this period | link note | sms/web/src/lib/words.ts:1006 (W.rejects.seeTheConesNote) | literal |
| L-rejects-byStation | By station | link | sms/web/src/lib/words.ts:1007 (W.rejects.byStation) | literal |
| L-rejects-byStationNote | opens the Weight station table, flagged stations first | link note | sms/web/src/lib/words.ts:1011 (W.rejects.byStationNote) | literal |
| L-rejects-filterStation | Station | filter chip label | sms/web/src/lib/words.ts:1190 (W.rejectsMore.filterStation) | literal |
| L-rejects-filterProduct | Product | filter chip label | sms/web/src/lib/words.ts:1385 (W.rejectsMore.filterProduct) | literal |
| L-rejects-all | All | filter chip option | sms/web/src/lib/words.ts:1356 (W.rejectsMore.all) | literal |
| L-rejects-predateProduct | ${n} of ${of} rejects in this period were recorded before the plant began recording a product, and are not shown under a product filter. | filter caveat | sms/web/src/lib/words.ts:1423 (W.rejectsMore.predateProduct) | pattern |
| L-rejects-openRecord | Open | row chevron label | sms/web/src/lib/words.ts:1335 (W.openRecord) | literal |
| L-rejects-weightRejectReason | weight reject | reason fallback for weight-type reject | sms/web/src/lib/words.ts:639 (W.readings.weightReject); used Rejects.tsx:605 | literal |
| L-reasonSheet-title | Rejects for one reason | sheet title | sms/web/src/lib/words.ts:1427 (W.rejectsMore.sheetTitle) | literal |
| L-reasonSheet-eyebrow | ${day} · production day | sheet eyebrow | sms/web/src/lib/words.ts:1428 (W.rejectsMore.sheetEyebrow) | pattern |
| L-reasonSheet-sheetCount | ${n} cones rejected for ${reason} | headline count sentence | sms/web/src/lib/words.ts:1429 (W.rejectsMore.sheetCount) | pattern |
| L-reasonSheet-sheetCountOne | 1 cone rejected for ${reason} | headline count sentence, singular | sms/web/src/lib/words.ts:1430 (W.rejectsMore.sheetCountOne) | pattern |
| L-reasonSheet-pass | counted as a pass | pass/fail note | sms/web/src/lib/words.ts:1452 (W.rejectsMore.pass) | literal |
| L-reasonSheet-fail | counted as a fail | pass/fail note | sms/web/src/lib/words.ts:1453 (W.rejectsMore.fail) | literal |
| L-reasonSheet-passUnknown | pass or fail not set | pass/fail note, unknown | sms/web/src/lib/words.ts:1454 (W.rejectsMore.passUnknown) | literal |
| L-reasonSheet-nameThisReason | Name this reason | naming editor, open button (no label yet) | sms/web/src/lib/words.ts:1448 (W.rejectsMore.nameThisReason) | literal |
| L-reasonSheet-rename | Rename | naming editor, open button (label exists) | sms/web/src/lib/words.ts:1449 (W.rejectsMore.rename) | literal |
| L-reasonSheet-save | Save | naming editor submit | sms/web/src/lib/words.ts:1450 (W.rejectsMore.save) | literal |
| L-reasonSheet-cancel | Cancel | naming editor cancel | sms/web/src/lib/words.ts:1451 (W.rejectsMore.cancel) | literal |
| L-reasonSheet-renameFailed | The name was not saved. Try again. | naming editor, save failure | sms/web/src/lib/words.ts:1425 (W.rejectsMore.renameFailed) | literal |
| L-reasonSheet-sheetEmpty | No rejects of this reason on this day. | empty state | sms/web/src/lib/words.ts:1431 (W.rejectsMore.sheetEmpty) | literal |
| L-reasonSheet-colTime | Time | table column header | sms/web/src/lib/words.ts:1242 (W.rejectsMore.colTime) | literal |
| L-reasonSheet-colStation | Station | table column header | sms/web/src/lib/words.ts:1437 (W.rejectsMore.colStation) | literal |
| L-reasonSheet-colProduct | Product | table column header | sms/web/src/lib/words.ts:1385 (W.rejectsMore.colProduct) | literal |
| L-reasonSheet-colWeight | Weight | table column header | sms/web/src/lib/words.ts:1231 (W.rejectsMore.colWeight) | literal |
| L-reasonSheet-colRecord | Record | table column header | sms/web/src/lib/words.ts:1341 (W.rejectsMore.colRecord) | literal |
| L-reasonSheet-noProductThen | not recorded | product column, none | sms/web/src/lib/words.ts:1438 (W.rejectsMore.noProductThen) | literal |
| L-reasonSheet-notWeighed | not weighed | weight column, quality reject | sms/web/src/lib/words.ts:1439 (W.rejectsMore.notWeighed) | literal |
| L-reasonSheet-sheetMore | Showing the first ${shown} of ${total}. | table footer | sms/web/src/lib/words.ts:1432 (W.rejectsMore.sheetMore) | pattern |
| L-reasonSheet-openRegister | See this day in Readings | link | sms/web/src/lib/words.ts:1440 (W.rejectsMore.openRegister) | literal |
| L-reasonSheet-openRegisterNote | opens Readings on the inspection rejects of this day; the reason itself is listed only here | link note | sms/web/src/lib/words.ts:1441 (W.rejectsMore.openRegisterNote) | literal |
| L-reasonSheet-openReport | See this day on the reject report | link | sms/web/src/lib/words.ts:1446 (W.rejectsMore.openReport) | literal |
| L-reasonSheet-openReportNote | opens the reject report for this day | link note | sms/web/src/lib/words.ts:1447 (W.rejectsMore.openReportNote) | literal |
| L-reasonSheet-dayBasisCaveat | IFL has not confirmed whether reject reports should count by production day or by calendar date; this screen uses the production day. | footer caveat | sms/web/src/lib/words.ts:1414 (W.rejectsMore.dayBasisCaveat) | literal |
| L-reasonSheet-openRecord | Open | row chevron label | sms/web/src/lib/words.ts:1335 (W.openRecord) | literal |
| L-sacks-question | How many sacks were weighed, how heavy, how many the scale passed — and what is in line stock. | screen question | sms/web/src/lib/words.ts:1943 (W.sacks.question) | literal |
| L-sacks-headline | ${period}: ${sacks} sacks weighed, ${kg} kg | headline, base form (period/count/weight only) | sms/web/src/lib/words.ts:1945 (W.sacks.headline) | pattern |
| L-sacks-headlineNone | ${period}: no sacks weighed. | headline, empty | sms/web/src/lib/words.ts:1946 (W.sacks.headlineNone) | pattern |
| L-sacks-figSacks | sacks | figure unit | sms/web/src/lib/words.ts:1950 (W.sacks.figSacks) | literal |
| L-sacks-figKg | kg | figure unit | sms/web/src/lib/words.ts:1944 (W.sacks.figKg) | literal |
| L-sacks-figInRange | within range | figure unit | sms/web/src/lib/words.ts:1949 (W.sacks.figInRange) | literal |
| L-sacks-figConesPerSack | cones per sack | figure unit | sms/web/src/lib/words.ts:1950 (W.sacks.figConesPerSack) | literal |
| L-sacks-avgNote | ${avg} average | figure note | sms/web/src/lib/words.ts:1857 (W.sacks.avgNote) | pattern |
| L-sacks-avgExcluded | ${n} implausible excluded from the average | figure note | sms/web/src/lib/words.ts:1952 (W.sacks.avgExcluded) | pattern |
| L-sacks-inRangeNote | ${n} of ${of} the scale passed | figure note | sms/web/src/lib/words.ts:1943 (W.sacks.inRangeNote) | pattern |
| L-sacks-noFlagNote | ${n} carry no verdict | figure note | sms/web/src/lib/words.ts:1954 (W.sacks.noFlagNote) | pattern |
| L-sacks-conesPerSackNote | approximate | figure note | sms/web/src/lib/words.ts:1955 (W.sacks.conesPerSackNote) | literal |
| L-sacks-unattributed | ${n} of ${of} sacks in this period carry no product. | note | sms/web/src/lib/words.ts:1956 (W.sacks.unattributed) | pattern |
| L-sacks-byShift | By shift | table heading | sms/web/src/lib/words.ts:1958 (W.sacks.byShift) | literal |
| L-sacks-byProduct | By product | table heading | sms/web/src/lib/words.ts:1959 (W.sacks.byProduct) | literal |
| L-sacks-colShift | Shift | column header | sms/web/src/lib/words.ts:1929 (W.sacks.colShift) | literal |
| L-sacks-colProduct | Product | column header | sms/web/src/lib/words.ts:1818 (W.sacks.colProduct) | literal |
| L-sacks-colSacks | Sacks | column header | sms/web/src/lib/words.ts:1947 (W.sacks.colSacks) | literal |
| L-sacks-colKg | kg | column header | sms/web/src/lib/words.ts:1944 (W.sacks.colKg) | literal |
| L-sacks-colAvg | Average | column header | sms/web/src/lib/words.ts:1964 (W.sacks.colAvg) | literal |
| L-sacks-colInRange | Within range | column header | sms/web/src/lib/words.ts:1965 (W.sacks.colInRange) | literal |
| L-sacks-noProduct | No product on the reading | product fallback | sms/web/src/lib/words.ts:1966 (W.sacks.noProduct) | literal |
| L-sacks-weighedPerDay | Sacks weighed per day | chart heading | sms/web/src/lib/words.ts:1975 (W.sacks.weighedPerDay) | literal |
| L-sacks-namesNotDistinct | The product master could not be read, so products that share a description are shown under the same name. | note | sms/web/src/lib/words.ts:1996 (W.sacks.namesNotDistinct) | literal |
| L-sacks-avgPerDay | Average sack weight, each day against the period | chart heading | sms/web/src/lib/words.ts:1982 (W.sacks.avgPerDay) | literal |
| L-sacks-avgPerDayZero | period average ${mean} | chart zero-label | sms/web/src/lib/words.ts:1984 (W.sacks.avgPerDayZero) | pattern |
| L-sacks-avgPerDayResting | Period average ${mean}, with no day's own average sitting more than ${worst} from it. The axis is held at ±0.1 kg or wider, so a steady period draws flat. | chart resting caption | sms/web/src/lib/words.ts:1986 (W.sacks.avgPerDayResting) | pattern |
| L-sacks-avgPerDayTooShort | Two production days or more are needed before a day can be compared to the period. | chart empty state | sms/web/src/lib/words.ts:1987 (W.sacks.avgPerDayTooShort) | literal |
| L-sacks-avgPerDayUnavailable | The per-day averages could not be read, so this chart is not drawn. Every other figure on this screen is unaffected. | chart failed state | sms/web/src/lib/words.ts:1990 (W.sacks.avgPerDayUnavailable) | literal |
| L-sacks-inRangeByProduct | Within the scale's range, by product | chart heading | sms/web/src/lib/words.ts:1992 (W.sacks.inRangeByProduct) | literal |
| L-sacks-ledger | Stock ledger | ledger block heading | sms/web/src/lib/words.ts:1998 (W.sacks.ledger) | literal |
| L-sacks-ledgerNote | line stock, not per machine | ledger block note | sms/web/src/lib/words.ts:1999 (W.sacks.ledgerNote) | literal |
| L-sacks-unitSacks | Sacks | unit toggle option | sms/web/src/lib/words.ts:1947 (W.sacks.unit.sacks) | literal |
| L-sacks-unitKg | kg | unit toggle option | sms/web/src/lib/words.ts:1944 (W.sacks.unit.kg) | literal |
| L-sacks-unitToggleLabel | Unit | unit toggle group label | sms/web/src/screens/Sacks.tsx:547 | literal |
| L-sacks-colDay | Day | ledger column header | sms/web/src/lib/words.ts:1858 (W.sacks.colDay) | literal |
| L-sacks-colOpening | Opening | ledger column header | sms/web/src/lib/words.ts:2002 (W.sacks.colOpening) | literal |
| L-sacks-colReceipts | Receipts | ledger column header | sms/web/src/lib/words.ts:2003 (W.sacks.colReceipts) | literal |
| L-sacks-colIssues | Issues | ledger column header | sms/web/src/lib/words.ts:2004 (W.sacks.colIssues) | literal |
| L-sacks-colConsumption | Consumption | ledger column header | sms/web/src/lib/words.ts:2005 (W.sacks.colConsumption) | literal |
| L-sacks-colAdjustments | Adjustments | ledger column header | sms/web/src/lib/words.ts:1916 (W.sacks.colAdjustments) | literal |
| L-sacks-colClosing | Closing | ledger column header | sms/web/src/lib/words.ts:2007 (W.sacks.colClosing) | literal |
| L-sacks-colCount | Stock count | ledger column header (opening count present) | sms/web/src/lib/words.ts:2008 (W.sacks.colCount) | literal |
| L-sacks-ledgerEmpty | No sacks and no movements in this period. | ledger empty state | sms/web/src/lib/words.ts:2009 (W.sacks.ledgerEmpty) | literal |
| L-sacks-openingBefore | ${n} in stock before this period. | ledger footer | sms/web/src/lib/words.ts:2010 (W.sacks.openingBefore) | pattern |
| L-sacks-closingNow | ${n} in stock at the end of it. | ledger footer | sms/web/src/lib/words.ts:2011 (W.sacks.closingNow) | pattern |
| L-sacks-kgIncomplete | The kg column is short by one recorded movement that had no weight.${slash}The kg column is short by ${n} recorded movements that had no weight. | ledger footer (two-branch, singular/plural) | sms/web/src/lib/words.ts:2015 (W.sacks.kgIncomplete) | pattern |
| L-sacks-ledgerCaveat | Every sack weighed at the packing scale counts as a receipt into line stock; that reading of “receipt”, and whether the ledger is kept in sacks or kg, are not yet confirmed by IFL.${gap}A sack's time is when the plant wrote the reading, which can trail the weighing. | ledger caveat, two concatenated sentences | sms/web/src/lib/words.ts:2022 (W.sacks.ledgerCaveat) | pattern |
| L-sacks-perMachine | Per machine | ledger per-machine label | sms/web/src/lib/words.ts:2023 (W.sacks.perMachine) | literal |
| L-sacks-perMachineNone | not available | ledger per-machine value | sms/web/src/lib/words.ts:2024 (W.sacks.perMachineNone) | literal |
| L-sacks-record | Record a movement | "record movement" open button | sms/web/src/lib/words.ts:2026 (W.sacks.record) | literal |
| L-sacks-recordNote | A correction is a new row that says why; nothing recorded here is edited or deleted. | movement form note | sms/web/src/lib/words.ts:2027 (W.sacks.recordNote) | literal |
| L-sacks-type | What happened | movement form field label | sms/web/src/lib/words.ts:2028 (W.sacks.type) | literal |
| L-sacks-typeNameOpening | Stock count (opening) | movement type option | sms/web/src/lib/words.ts:2030 (W.sacks.typeName.opening) | literal |
| L-sacks-typeNameReceipt | Received | movement type option | sms/web/src/lib/words.ts:2031 (W.sacks.typeName.receipt) | literal |
| L-sacks-typeNameIssue | Issued out | movement type option | sms/web/src/lib/words.ts:2032 (W.sacks.typeName.issue) | literal |
| L-sacks-typeNameConsumption | Consumed | movement type option | sms/web/src/lib/words.ts:2033 (W.sacks.typeName.consumption) | literal |
| L-sacks-typeNameAdjustment | Correction | movement type option | sms/web/src/lib/words.ts:2034 (W.sacks.typeName.adjustment) | literal |
| L-sacks-quantity | Sacks | movement form field label | sms/web/src/lib/words.ts:1947 (W.sacks.quantity) | literal |
| L-sacks-quantityKg | kg (if known) | movement form field label | sms/web/src/lib/words.ts:2044 (W.sacks.quantityKg) | literal |
| L-sacks-product | Product | movement form field label | sms/web/src/lib/words.ts:1906 (W.sacks.product) | literal |
| L-sacks-anyProduct | Not stated | movement form, product default option | sms/web/src/lib/words.ts:2046 (W.sacks.anyProduct) | literal |
| L-sacks-productListUnavailable | The product list could not be loaded — only "Not stated" is offered below. | movement form note, product list failed | sms/web/src/lib/words.ts:2052 (W.sacks.productListUnavailable) | literal |
| L-sacks-when | When (plant time) | movement form field label | sms/web/src/lib/words.ts:2053 (W.sacks.when) | literal |
| L-sacks-why | Why | movement form field label | sms/web/src/lib/words.ts:1915 (W.sacks.why) | literal |
| L-sacks-save | Record | movement form submit button | sms/web/src/lib/words.ts:1835 (W.sacks.save) | literal |
| L-sacks-cancel | Cancel | movement form cancel button | sms/web/src/lib/words.ts:2056 (W.sacks.cancel) | literal |
| L-sacks-saved | Recorded. | movement form success | sms/web/src/lib/words.ts:2057 (W.sacks.saved) | literal |
| L-sacks-saveFailed | Could not record this movement. | movement form failure | sms/web/src/lib/words.ts:2058 (W.sacks.saveFailed) | literal |
| L-sacks-productFallback | Product ${materialId} | ledger/product row fallback label | sms/web/src/screens/Sacks.tsx:156 | pattern |
| L-sacks-headline-pct | , ${pct} within the scale's range. | headline, optional tail appended when a within-range percentage is known | sms/web/src/lib/words.ts:1945 (W.sacks.headline) | pattern |
| L-sacks-history | Sack history | history list heading | sms/web/src/lib/words.ts:2071 (W.sacks.history) | literal |
| L-sacks-historyNote | ${n} in this period, newest first | history list note | sms/web/src/lib/words.ts:2072 (W.sacks.historyNote) | pattern |
| L-sacks-historyCountUnknown | The total for this period could not be confirmed — this is not the same as an empty period. | history list note, count unknown | sms/web/src/lib/words.ts:2077 (W.sacks.historyCountUnknown) | literal |
| L-stockSheet-sheetTitle | Stock movements | sheet title | sms/web/src/lib/words.ts:2060 (W.sacks.sheetTitle) | literal |
| L-stockSheet-sheetEyebrow | ${day} · production day | sheet eyebrow | sms/web/src/lib/words.ts:2061 (W.sacks.sheetEyebrow) | pattern |
| L-stockSheet-sheetWeighed | ${n} sacks weighed this day (${kg} kg) count as receipts. | headline sentence | sms/web/src/lib/words.ts:2062 (W.sacks.sheetWeighed) | pattern |
| L-stockSheet-sheetWeighedNone | No sacks were weighed this day. | headline sentence, none weighed | sms/web/src/lib/words.ts:2063 (W.sacks.sheetWeighedNone) | literal |
| L-stockSheet-sheetEmpty | No movements were recorded by hand this day. | empty state | sms/web/src/lib/words.ts:2064 (W.sacks.sheetEmpty) | literal |
| L-stockSheet-colTime | Time | table column header | sms/web/src/lib/words.ts:2065 (W.sacks.colTime) | literal |
| L-stockSheet-colWhat | What | table column header | sms/web/src/lib/words.ts:1939 (W.sacks.colWhat) | literal |
| L-stockSheet-colSacks | Sacks | table column header | sms/web/src/lib/words.ts:1947 (W.sacks.colSacks) | literal |
| L-stockSheet-colKg | kg | table column header | sms/web/src/lib/words.ts:1944 (W.sacks.colKg) | literal |
| L-stockSheet-colProduct | Product | table column header | sms/web/src/lib/words.ts:1818 (W.sacks.colProduct) | literal |
| L-stockSheet-colWho | Recorded by | table column header | sms/web/src/lib/words.ts:2067 (W.sacks.colWho) | literal |
| L-stockSheet-colWhy | Why | table column header | sms/web/src/lib/words.ts:1921 (W.sacks.colWhy) | literal |
| L-stockSheet-noActor | no one signed in | recorded-by fallback | sms/web/src/lib/words.ts:1504 (W.health.noActor) | literal |
| L-stockSheet-anyProduct | Not stated | product fallback | sms/web/src/lib/words.ts:2046 (W.sacks.anyProduct) | literal |
| L-stockSheet-productFallback | Product ${materialId} | product fallback, id only | sms/web/src/screens/StockSheet.tsx:80 | pattern |
| L-stockSheet-recordNote | A correction is a new row that says why; nothing recorded here is edited or deleted. | footer note | sms/web/src/lib/words.ts:2027 (W.sacks.recordNote) | literal |

## Product, Changeover, Report, Health, Wall, Account, simulator banner

| ID | exact text | where it appears | source file:line | kind |
|---|---|---|---|---|
| L-product-tab-running | Running | Product tab strip | sms/web/src/lib/words.ts:250 | literal |
| L-product-tab-changeover | Changeover | Product tab strip | sms/web/src/lib/words.ts:339 | literal |
| L-product-tab-catalogue | Catalogue | Product tab strip | sms/web/src/lib/words.ts:250 | literal |
| L-product-tab-history | History | Product tab strip | sms/web/src/lib/words.ts:338 | literal |
| L-product-retired-marker | (retired in PDAS) | suffix after a retired product's label (Product›Running, Line, Weight, ReadingSheet, Report) | sms/web/src/lib/words.ts:2378 | literal |
| L-product-retired-stillrunning | This product is marked retired in PDAS but is still being produced — worth checking. | one-time sentence when a retired product is still the running target | sms/web/src/lib/words.ts:2377 | literal |
| L-product-change-button | Change | Product › Running, change-the-running-product button | sms/web/src/lib/words.ts:222 | literal |
| L-changeover-checkplan | Check the plan | Changeover tab, dry-run button | sms/web/src/lib/words.ts:410 | literal |
| L-changeover-execute | Execute the changeover | Changeover tab, execute button | sms/web/src/lib/words.ts:411 | literal |
| L-changeover-disabled-static | Executing a changeover here is switched off until a full test of this feature has been run and passed on this computer. The plan below can still be checked. | Changeover tab, static sentence beside the server's own reason | sms/web/src/lib/words.ts:395 | literal |
| L-changeover-disabled-server | PDAS_WRITE_ENABLED is not true. | server-supplied `disabledReason`, printed verbatim | sms/api/src/config.ts:391 | literal |
| L-product-changelimits-button | Change weight limits | Product › Catalogue, per-product action | sms/web/src/lib/words.ts:265 | literal |
| L-report-type-daily | Daily | report type selector | sms/web/src/lib/words.ts:2087 | literal |
| L-report-type-shift | Shift | report type selector | sms/web/src/lib/words.ts:1935 | literal |
| L-report-type-product | Product | report type selector | sms/web/src/lib/words.ts:1959 | literal |
| L-report-type-station | Machine / station | report type selector | sms/web/src/lib/words.ts:2090 | literal |
| L-report-type-reject | Rejects | report type selector | sms/web/src/lib/words.ts:1933 | literal |
| L-report-type-coneweight | Cone weight | report type selector | sms/web/src/lib/words.ts:2092 | literal |
| L-report-type-sack | Sacks | report type selector | sms/web/src/lib/words.ts:1950 | literal |
| L-report-type-calibration | Calibration | report type selector | sms/web/src/lib/words.ts:1934 | literal |
| L-report-type-mgmtsummary | Management summary | report type selector | sms/web/src/lib/words.ts:2095 | literal |
| L-report-type-machineproduct | Product by machine | report type selector | sms/web/src/lib/words.ts:2096 | literal |
| L-report-print | Print | Report screen, Print button | sms/web/src/lib/words.ts:1054 | literal |
| L-report-exportcsv | Export CSV | Report screen, export button | sms/web/src/lib/words.ts:1055 | literal |
| L-report-exportxlsx | Export Excel | Report screen, export button | sms/web/src/lib/words.ts:1056 | literal |
| L-report-exportpdf | Export PDF | Report screen, export button | sms/web/src/lib/words.ts:1057 | literal |
| L-health-title | Health | Health screen page title | sms/web/src/lib/words.ts:1369 | literal |
| L-health-status-ok | Everything is healthy. | Health headline verdict, ok state | sms/web/src/lib/words.ts:1468 | literal |
| L-health-status-degraded | Something needs attention. | Health headline verdict, degraded state | sms/web/src/lib/words.ts:1468 | literal |
| L-health-status-down | The database cannot be reached. | Health headline verdict, down state | sms/web/src/lib/words.ts:1468 | literal |
| L-health-sync-ok | The plant connection is healthy. | Sync health block, per-table outcome | sms/web/src/lib/words.ts:1275 | literal |
| L-health-sync-stale | The plant connection has not delivered anything recently. | Sync health block, per-table outcome | sms/web/src/lib/words.ts:1276 | literal |
| L-health-sync-failing | The last sync attempt failed. | Sync health block, per-table outcome | sms/web/src/lib/words.ts:1277 | literal |
| L-health-sync-lagunknown | A reading has arrived, but its acquisition lag has not been measured yet — the connection state cannot be judged. | Sync health block, per-table outcome | sms/web/src/lib/words.ts:1293 | literal |
| L-health-sync-unknownkind | The plant connection state could not be read. | Sync health block, per-table outcome | sms/web/src/lib/words.ts:1294 | literal |
| L-health-db-label | Database | Health, DB block heading | sms/web/src/lib/words.ts:1474 | literal |
| L-health-dblatency | answering in ${ms} ms | DB latency line | sms/web/src/lib/words.ts:1475 | pattern |
| L-health-dbsize | ${mb} MB used of the ${capGb} GB SQL Server Express allows — ${pct} %. | DB size line | sms/web/src/lib/words.ts:1476 | pattern |
| L-health-dbsizeunknown | The size could not be read. | DB size fallback | sms/web/src/lib/words.ts:1477 | literal |
| L-health-service-label | Service | Health, service block heading | sms/web/src/lib/words.ts:1469 | literal |
| L-health-version | Version ${v} | service version line | sms/web/src/lib/words.ts:1470 | pattern |
| L-health-upsince | running for ${span} | service uptime line | sms/web/src/lib/words.ts:1471 | pattern |
| L-health-backup-label | Backups | Health, backups block heading | sms/web/src/lib/words.ts:1482 | literal |
| L-health-backuplast | Last backup ${span} ago (${file}). | backup age line | sms/web/src/lib/words.ts:1483 | pattern |
| L-health-backupnone | No backup file was found. | backup block, no file found | sms/web/src/lib/words.ts:1484 | literal |
| L-health-pdaswrite-title | PDAS write checking | PDAS write block heading | sms/web/src/lib/words.ts:1672 | literal |
| L-health-pdaswrite-offtitle | PDAS writes: off | PDAS write block, disabled headline | sms/web/src/lib/words.ts:1673 | literal |
| L-health-pdaswrite-off | This installation is not writing to PDAS. There is nothing to check. | PDAS write block, disabled body | sms/web/src/lib/words.ts:1674 | literal |
| L-health-pdaswrite-ontitle | PDAS writes: on | PDAS write block, enabled headline | sms/web/src/lib/words.ts:1675 | literal |
| L-health-pdaswrite-checkedyes | Checked after writing: yes. Every write is read back from PDAS and any mismatch raises a finding immediately. | PDAS write block, verified state | sms/web/src/lib/words.ts:1677 | literal |
| L-wall-state-running | is running | Wall headline, running (composed as `${name} ${W.state.running}` in Wall.tsx) | sms/web/src/lib/words.ts:108 | literal |
| L-wall-state-stopped | has had no readings for ${span} — the line, or the plant's data recorder, may have stopped | Wall headline, stopped (composed as `${name} ${W.state.stopped(span)}` in Wall.tsx) | sms/web/src/lib/words.ts:124 | pattern |
| L-wall-state-stopped-unknown | has had no readings — the line, or the plant's data recorder, may have stopped, for how long is not known | Wall headline, stopped with unknown duration | sms/web/src/lib/words.ts:130 | literal |
| L-wall-state-unknown | Cannot tell whether the line is running | Wall headline, unknown | sms/web/src/lib/words.ts:129 | literal |
| L-wall-stations-note | cones this shift | Wall, station row subheading | sms/web/src/lib/words.ts:517 | literal |
| L-wall-quiet | quiet | Wall, count of quiet stations suffix | sms/web/src/lib/words.ts:519 | literal |
| L-wall-lastsack | Last sack | Wall footer | sms/web/src/lib/words.ts:543 | literal |
| L-wall-lastcone | Last cone | Wall footer | sms/web/src/lib/words.ts:544 | literal |
| L-wall-incomplete | The station roster could not be fully loaded — a quiet station may be missing from this row, not just quiet. | Wall footer, partial-failure note | sms/web/src/lib/words.ts:528 | literal |
| L-simbanner-quiet-full | Figures here are the plant simulator's, not the plant's; newest reading: ${newestWhen}${ageText}. | Line screen's "why it's quiet" paragraph, simulator generation | sms/web/src/lib/generationWords.ts:99 | pattern |
| L-simbanner-quiet-short | Simulator readings, not the plant's — newest ${newestClock}; newer readings not counted | Wall footer, short form of the same sentence | sms/web/src/lib/generationWords.ts:112 | pattern |
| L-simbanner-provenance-label | Simulator | Health's data-batch table, provenance column value | sms/web/src/lib/words.ts:1615 | literal |
| L-account-title | Change password | Account sheet title/h2 | sms/web/src/lib/words.ts:1489 (used at Account.tsx:30-31) | literal |
| L-account-current | Current password | Account sheet field label | sms/web/src/lib/words.ts:1490 | literal |
| L-account-new | New password | Account sheet field label | sms/web/src/lib/words.ts:1491 | literal |
| L-account-confirm | New password again | Account sheet field label | sms/web/src/lib/words.ts:1492 | literal |
| L-account-mismatch | The two new passwords differ. | Account sheet validation error | sms/web/src/lib/words.ts:1493 | literal |
| L-account-wrongcurrent | The current password is not right. | Account sheet, server 403 error | sms/web/src/lib/words.ts:1494 | literal |
| L-account-save | Save | Account sheet submit button (W.weight.save) | sms/web/src/lib/words.ts:899 (used Account.tsx:74) | literal |
| L-account-cancel | Cancel | Account sheet cancel button (W.product.cancel) | sms/web/src/lib/words.ts:250 (used Account.tsx:75) | literal |

## Setup screen and its nine blocks

| ID | exact text | where it appears | source file:line | kind |
|---|---|---|---|---|
| L-setup-h1 | Setup | page h1 heading | sms/web/src/screens/Setup.tsx:51 | literal |
| L-setup-sync | Sync health | block heading | sms/web/src/lib/words.ts:1085 | literal |
| L-setup-line | Line | block heading | sms/web/src/lib/words.ts:958 | literal |
| L-setup-machines | Machines | block heading | sms/web/src/lib/words.ts:1087 | literal |
| L-setup-stations | Stations | block heading | sms/web/src/lib/words.ts:1091 | literal |
| L-setup-sources | Sources | block heading | sms/web/src/lib/words.ts:1089 | literal |
| L-setup-rules | Rules | block heading | sms/web/src/lib/words.ts:1090 | literal |
| L-setup-rejectcodes | Reject codes | block heading | sms/web/src/lib/words.ts:1091 | literal |
| L-setup-people | People | block heading (W.setupTabs.people) | sms/web/src/lib/words.ts:1092 | literal |
| L-setup-audit | Audit log | block heading (W.setupTabs.audit) | sms/web/src/lib/words.ts:1093 | literal |
| L-setup-addmachine-btn | Add a machine | Machines block, add button | sms/web/src/lib/words.ts:1156 | literal |
| L-setup-addmachine-num | Machine number (optional) | Machines add form, field label | sms/web/src/lib/words.ts:1157 | literal |
| L-setup-addmachine-numnote | The number the plant writes on each reading. Leave it blank for a machine the readings never name, such as the packer. | Machines add form, field note | sms/web/src/lib/words.ts:1158 | literal |
| L-setup-addmachine-kind | Kind | Machines add form field / table column | sms/web/src/lib/words.ts:998 (form), :1033 (column) | literal |
| L-setup-addmachine-name | Name | Machines add form field / table column | sms/web/src/lib/words.ts:1003 (form), :1036 (column) | literal |
| L-setup-addmachine-make | Make | Machines add form field / table column | sms/web/src/lib/words.ts:1147 (form), :1034 (column) | literal |
| L-setup-addmachine-model | Model | Machines add form field / table column | sms/web/src/lib/words.ts:1148 (form), :1035 (column) | literal |
| L-setup-addmachine-notes | Notes | Machines add form, field label | sms/web/src/lib/words.ts:1163 | literal |
| L-setup-addmachine-added | ${name} added. | Machines block, success message | sms/web/src/lib/words.ts:1164 | pattern |
| L-setup-addmachine-addedws | ${name} added, and station ${no} with it, linked to it. | Machines block, success message when a station is auto-created | sms/web/src/lib/words.ts:1165 | pattern |
| L-setup-addstation-btn | Add a station | Stations block, add button | sms/web/src/lib/words.ts:1180 | literal |
| L-setup-addstation-num | Station number | Stations add form, field label | sms/web/src/lib/words.ts:1181 | literal |
| L-setup-addstation-name | Name (optional) | Stations add form, field label | sms/web/src/lib/words.ts:1182 | literal |
| L-setup-addstation-nomachine | no machine | Stations block, empty-select option | sms/web/src/lib/words.ts:1050 | literal |
| L-setup-newaccount-btn | New account | People block, add-account button | sms/web/src/screens/Setup.tsx:211 (hard-coded, not a words.ts key) | literal |
| L-setup-newaccount-username | Username | New-account form, field label | sms/web/src/screens/Setup.tsx:252 (hard-coded) | literal |
| L-setup-newaccount-displayname | Display name (optional) | New-account form, field label | sms/web/src/screens/Setup.tsx:256 (hard-coded) | literal |
| L-setup-newaccount-password | Password | New-account form, field label | sms/web/src/screens/Setup.tsx:260 (hard-coded) | literal |
| L-setup-newaccount-role | Role | New-account form, field label | sms/web/src/screens/Setup.tsx:264 (hard-coded) | literal |
| L-setup-newaccount-roleoptions | ${r} | New-account form, role `<select>` options, one per rank name (viewer/engineer/manager/admin), default selected is "manager" | sms/web/src/screens/Setup.tsx:266 | pattern |
| L-setup-reset-done-zero | reset; the account was not signed in anywhere | People block, confirmation after reset (n=0 branch) | sms/web/src/lib/words.ts:1500 (W.health.resetDone) | literal |
| L-setup-reset-done-n | reset; signed out of ${n} session${s} | People block, confirmation after reset (n>0 branch) | sms/web/src/lib/words.ts:1500 (W.health.resetDone) | pattern |
| L-setup-reset-btn | Reset | People block, per-row reset button | sms/web/src/lib/words.ts:1499 (W.health.reset) | literal |
| L-setup-reset-placeholder | New password | Reset-password form, input placeholder | sms/web/src/lib/words.ts:1491 (W.health.newPassword) | literal |


---

## Not-capturable states (D19, D20) — for reference, not a label row

- **D19 — Print** opens the operating system's own print dialog; it is not part of the app's
  DOM and cannot be screenshotted from within the page. The guide describes this step in text
  only, referencing the `L-report-print` button above.
- **D20 — Export PDF/Excel/CSV** triggers a file download; there is no in-page dialog to
  capture. The guide describes this step in text only, referencing the `L-report-exportcsv` /
  `L-report-exportxlsx` / `L-report-exportpdf` buttons above; S17 shows the buttons themselves.


## Added in the 30 Sep 2026 refresh (Health backup/disk/heartbeat/acknowledge, Catalogue pallets, limits review, chart Back)

| ID | exact text | where it appears | source file:line | kind |
|---|---|---|---|---|
| L-health-verified-ok | This backup has been proven restorable — RESTORE VERIFYONLY passed and its size still matches. | Health, Backups block, when the newest backup is verified | sms/web/src/lib/healthWords.ts:34 | literal |
| L-health-verified-not | This backup has not been proven restorable. Do not rely on it until it verifies. | Health, Backups block, unverified backup | sms/web/src/lib/healthWords.ts:35 | literal |
| L-health-verified-newer | A newer backup file exists but has not verified yet; the figures on this page are the newest one that HAS. | Health, Backups block | sms/web/src/lib/healthWords.ts:37 | literal |
| L-health-verified-none | No verified backup was found. Every .bak in the folder is missing its verification, or none exists at all. | Health, Backups block | sms/web/src/lib/healthWords.ts:38 | literal |
| L-health-disk-title | Disk space | Health, disk block heading | sms/web/src/lib/healthWords.ts:41 | literal |
| L-health-disk-app | App/database volume: ${x} free. | Health, disk block | sms/web/src/lib/healthWords.ts:43 | pattern |
| L-health-disk-backup | Backup volume: ${x} free. | Health, disk block | sms/web/src/lib/healthWords.ts:45 | pattern |
| L-health-disk-low | below the ${x} warning line. | Health, disk block, low space | sms/web/src/lib/healthWords.ts:46 | pattern |
| L-health-verifyrun-none | No manual "sms verify" run is on record. This is informational only — it does not affect the status above. | Health, last verification block | sms/web/src/lib/healthWords.ts:51 | literal |
| L-health-verifyrun-note | This is the record of a run someone chose to make by hand, not a live, ongoing check. | Health, last verification block | sms/web/src/lib/healthWords.ts:52 | literal |
| L-health-recorder-both | The recorder last checked in at ${t} — newest reading at ${t2}. | Health, last verification block, worker heartbeat | sms/web/src/lib/healthWords.ts:61 | pattern |
| L-health-recorder-never | The recorder has never checked in. | Health, worker heartbeat | sms/web/src/lib/healthWords.ts:56 | literal |
| L-health-ack-control | Acknowledge | Health, data quality findings, per-finding button (engineer and above) | sms/web/src/lib/healthWords.ts:71 | literal |
| L-health-ack-submit | Record acknowledgement | Health, acknowledge form button | sms/web/src/lib/healthWords.ts:73 | literal |
| L-health-ack-summary | known data finding | Health, findings block, count sentence | sms/web/src/lib/healthWords.ts:70 | pattern |
| L-health-ack-by | Acknowledged by ${who} at ${when}. | Health, findings table | sms/web/src/lib/healthWords.ts:76 | pattern |
| L-health-ack-tooshort | Say a bit more — at least 10 characters. | Health, acknowledge form | sms/web/src/lib/healthWords.ts:75 | literal |
| L-health-ack-already | This finding was just acknowledged by someone else. | Health, acknowledge form | sms/web/src/lib/healthWords.ts:80 | literal |
| L-catalogue-pallets-title | Pallets in PDAS | Product › Catalogue, pallets block heading | sms/web/src/lib/words.ts:378 | literal |
| L-catalogue-pallets-none | No pallets recorded yet. | Product › Catalogue, pallets block | sms/web/src/lib/words.ts:381 | literal |
| L-catalogue-pallet-reactivate | Reactivate | Product › Catalogue, per-pallet button | sms/web/src/lib/words.ts:382 | literal |
| L-catalogue-pallet-retire | Retire | Product › Catalogue, per-pallet button | sms/web/src/lib/words.ts:319 | literal |
| L-catalogue-limits-step1 | Step 1 of 2 — Review the change | Change weight limits form | sms/web/src/lib/words.ts:295 | literal |
| L-catalogue-limits-step2 | Step 2 of 2 — Write to PDAS | Change weight limits form | sms/web/src/lib/words.ts:296 | literal |
| L-catalogue-limits-review | Review the change | Change weight limits form button | sms/web/src/lib/words.ts:295 | literal |
| L-catalogue-limits-back | Back | Change weight limits form button | sms/web/src/lib/words.ts:298 | literal |
| L-catalogue-limits-large | This is a large change | Change weight limits form, large-change warning | sms/web/src/lib/words.ts:311 | literal |
| L-catalogue-limits-largecheck | I have checked this large change | Change weight limits form, checkbox | sms/web/src/lib/words.ts:312 | literal |
| L-catalogue-limits-confirm | Change the limits | Change weight limits form, final button | sms/web/src/lib/words.ts:293 | literal |
| L-chart-back | Back to previous range | top bar button, appears after a chart zoom | sms/web/src/lib/words.ts:2455 | literal |
| L-health-dqfindings | Data quality findings | Health, findings block heading | sms/web/src/lib/words.ts:1513 | literal |
| L-health-backupverify-title | Backup verification | Health, backups block sub-heading | sms/web/src/lib/healthWords.ts:33 | literal |
| L-health-verifyrun-title | Last manual verification run | Health, last verification block heading | sms/web/src/lib/healthWords.ts:49 | literal |

## Coverage note

This file, together with `check_labels.py`, is the writers' only source of on-screen wording.
Do not quote any string in the guide that is not a row here with a verified `file:line`. If a
shot in the plan's section 3 needs a label not yet listed, add it here with its citation before
writing the corresponding chapter text — do not paraphrase from memory.
