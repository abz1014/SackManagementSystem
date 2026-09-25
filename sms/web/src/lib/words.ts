/**
 * Every word the redesigned app shows, in one place.
 *
 * Two reasons this file exists rather than strings sitting inline:
 *
 * 1. URDU. IFL has not yet answered whether they want Urdu labels (§11). When
 *    they do, it is a second object in this file, not a pass over every screen.
 * 2. THE WORD BUDGET IS A REAL CONSTRAINT. REDESIGN.md §12 step 5 caps the
 *    visible words per screen — Line 60, Wall 30, Report 100, Readings chrome
 *    40, Weight and Rejects 120 on the default view. A budget you cannot count
 *    is a budget nobody keeps; with the copy in one file it can be counted.
 *
 * RULES FOR ANYTHING ADDED HERE, from IFL's own verdict on the old app
 * ("overflow of useless information") and from both critics:
 *  - Plain words on every primary surface. Sigma, Cpk, subgroup, Nelson,
 *    p-chart, control band, merge key and transform version belong under
 *    `working` (the Details disclosure) and nowhere else.
 *  - No question numbers (Q1, Q10) and no data-quality ids (DQ-2). Say the
 *    plain state instead: "Code names not yet supplied".
 *  - One caveat per screen, as a footnote, never a box or a paragraph.
 *  - A verdict states what the data shows and stops. No diagnosis the
 *    measurement cannot support.
 */

const nbsp = String.fromCharCode(0xa0);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export const W = {
  /* ------------------------------------------------------------- the shell */
  brand: 'SMS',
  nav: {
    line: 'Line',
    readings: 'Readings',
    weight: 'Weight',
    rejects: 'Rejects',
    /* Roadmap Phase 7 (15 Sep 2026): the sack screen joins the top bar after
       Rejects — the one edit outside the `sacks` namespace, because the bar
       indexes this object by screen. */
    sacks: 'Sacks',
    /* UX Phase 6 Brief 1 (16 Sep 2026): the 7th nav item, absorbing the old
       Product sheet. Sits between Sacks and Report in time-window order —
       see Bar.tsx's SCREENS note. */
    product: 'Product',
    report: 'Report',
  } as const,
  wall: 'Wall',
  setup: 'Setup',
  /* The strip's clock is labelled because the lag sentence beside it carries a
     second time; unlabelled, the two read as the same clock. It is the PLANT's
     clock, from /api/live — never the browser's. */
  plantClock: 'plant clock',
  signOut: 'Sign out',
  skipToContent: 'Skip to content',

  /* The question each screen answers, printed under the headline rather than
     shown on hover: hover does not exist on a wall display or a touch screen. */
  question: {
    line: 'Is the line running, what has it made this period, and does anything need attention?',
    readings: 'Every cone and every sack that was weighed, with the rejected ones flagged.',
    weight: "Are the cones at the right weight, and does any station's scale need attention?",
    rejects: 'How many cones are being rejected, why, is it getting worse, and where?',
    report: 'What did the line make over this period, on paper.',
    setup: 'Accounts, stations, the rules this system applies, and the plant connection.',
    /* UX Phase 6 Brief 1 (16 Sep 2026). */
    product: 'What is each machine running, what are its limits, and how do I change it.',
  } as const,

  /* ---------------------------------------------------------- the period */
  period: {
    shift: 'This shift',
    today: 'Today',
    yesterday: 'Yesterday',
    week: 'This week',
    month: 'This month',
    pick: 'Pick dates',
  } as const,
  periodTo: 'to',
  soFar: 'so far',
  /** Shown when a screen cannot judge anything over the chosen period. */
  tooShort: (what: string, days: number) =>
    `This period is too short to judge ${what}; showing the last ${days} production days.`,
  judgedOver: (days: number) => `judged over the last ${days} production days`,

  /* ------------------------------------------------ the lag, in three states */
  lag: {
    /* Healthy. The newest reading's time and the MEASURED lag — never a
       literal "about 18 minutes", which stops being true the day IFL's
       acquisition layer changes. */
    ok: (reading: string, lag: string) =>
      `Readings to ${reading} · they reach this system about ${lag} after weighing.`,
    okNoLag: (reading: string) => `Readings to ${reading}.`,
    /* The sync worker has missed three cadences. Within two minutes of a sync
       failure the newest reading ages past the stop threshold and the line
       would read "Stopped" though it is running, so no screen may assert
       Running or Stopped while this is showing. */
    stale: (since: string) => `No new readings since ${since} — the plant link may be down.`,
    /* Lag beyond the credible ceiling: the figures stand, the state does not. */
    late: (lag: string) => `Readings are arriving ${lag} late — the line state below may be out of date.`,
    details: 'details',
    noData: 'Nothing has been received from the plant yet.',
  } as const,

  /* ------------------------------------------------------------ line state */
  state: {
    running: 'is running',
    stopped: (span: string) => `has been stopped for ${span}`,
    /* UX Phase WS-B2 (23 Sep 2026): the SAME "stopped" fact as `stopped`
       above, for when `behindSeconds` itself is null — `fmtSpan(null ?? 0)`
       used to print a real-looking "0 s", claiming a duration the server
       never measured. Never used together with `stopped` on the same line;
       a caller picks one OR the other depending on whether it has a span. */
    stoppedUnknownDuration: 'has been stopped — for how long is not known',
    idle: (since: string) => `has had no readings since ${since}`,
    unknown: 'Cannot tell whether the line is running',
    intoShift: (span: string, shift: string, from: string, to: string) =>
      `${span} into the ${shift}, ${from}${nbsp}to${nbsp}${to}`,
    shiftOf: (shift: string, from: string, to: string) => `${shift}, ${from} to ${to}`,
    /* UX charts pass 2 (23 Sep 2026). The home screen's headline used to name
       the SHIFT IN PROGRESS whatever the period control said, so "This month"
       printed "Morning shift, 6:00 AM to 2:00 PM" above a month of counts.
       The state clause is about now and says so; this one names what the
       figures below actually cover. */
    rightNow: 'right now',
    figuresCover: (period: string) => `Figures below cover ${period}.`,
  } as const,
  shift: { morning: 'morning shift', evening: 'evening shift', night: 'night shift' } as const,
  shiftName: { morning: 'Morning', evening: 'Evening', night: 'Night' } as const,

  /* -------------------------------------------------------------- figures */
  fig: {
    cones: 'cones',
    sacks: 'sacks',
    rejected: 'rejected',
    kg: 'kg',
    gAverage: 'g average',
    /* Line's fourth KPI (OVERVIEW-SPEC.md §3.1): the note under "outside the
       product's limits" — data.states.unknown, always shown, never only on a
       non-zero count, so a period with no product in force reads "0 outside
       the limits, N could not be judged" rather than a bare, misleading 0. */
    couldNotBeJudged: (n: string) => `${n} could not be judged`,
    /* The KPI block's own empty-state note (OVERVIEW-SPEC.md §3.1 case 6,
       "the source has not caught up"): a live period is always short by the
       acquisition lag, and a zero here can mean that rather than a stopped
       line. Never a literal "about 18 minutes" — the lag is measured. */
    notCaughtUp: (lag: string) => `Cones weighed in the last ${lag} have not reached this system yet.`,
    /* WS-B1 (23 Sep 2026 red-team remediation, RED 2): the server names a
       field absent from a row that was otherwise present (production.ts
       `dataIssues[]`, WS-P) rather than silently returning 0 for it. A
       figure this covers shows a dash, never the server's placeholder 0,
       with this note beside it — never the ordinary note that field would
       otherwise carry, which would assert something about a number that
       was not actually read. */
    couldNotRead: 'could not be read this period',
  } as const,
  /* ONE status vocabulary, and it names its basis every time it appears.
     Two verdicts exist on every cone — the scale's own in-range bit and the
     product's tolerance — and they disagree on about a thousand cones in the
     record. A screen that says "outside limits" without saying which one is
     the defect both critics refused to sign. */
  withinLimits: (pct: string) => `${pct} within the scale's limits`,
  ofEverything: (pct: string) => `${pct} of everything weighed`,
  splitRejects: (quality: number, weight: number) => `${quality} quality, ${weight} weight`,
  passed: 'Passed',
  rejectedByScale: 'Rejected by the scale',
  outsideProduct: "outside the product's limits",
  alsoOutsideProduct: (limits: string, by: string) =>
    `Also outside the product's limits: ${limits} at this time, so ${by}.`,
  noProductThen: 'No product was recorded at this time, so there are no product limits to compare against.',
  disagreement: (n: number) =>
    n === 1
      ? "1 cone in this period was passed by the scale but sits outside the product's limits."
      : `${n} cones in this period were passed by the scale but sit outside the product's limits.`,
  seeThem: 'See them',
  /* Line's Attention block (OVERVIEW-SPEC.md §3.2 change (b)): a countless
     sentence, so the outside-limits finding does not print a second number
     for the fact KPI figure 4 already states, from a different SQL
     population (see productDisagreement, D2). W.disagreement stays for
     Weight's banner, which counts a different population and is out of
     scope of this change. */
  outsideLimitsThisPeriod: "Cones passed by the scale sit outside the product's limits in this period.",

  /* ------------------------------------------------------------- attention */
  attention: 'Attention',
  nothingNeedsAttention: 'Nothing needs attention.',
  andMore: (n: number, where: string) => `and ${n} more — see ${where}`,
  /* Line's Attention block, empty state (OVERVIEW-SPEC.md §3.2 change,
     "a second empty case"): when the trailing window held fewer production
     days than the drift rule needs, "Nothing needs attention" is a
     statement about the record, not the line. */
  tooFewProductionDays: (n: number) =>
    `— only ${n} production day${n === 1 ? '' : 's'} in the window, too few to judge a station's drift.`,

  /* --------------------------------------------------------------- product */
  product: {
    title: 'Product recorded in this system',
    /* Requirement 3 says "update product details on machines". Nothing here
       reaches a machine — the selection is written to this application's own
       database and the PLC path is out of scope by IFL's own answer. Saying so
       on the screen is the difference between a half-built feature and a
       misrepresented one. */
    notSentToMachine: 'Recorded here for weight limits and reports. It is not sent to the machine.',
    target: 'Target',
    targetAndLimits: 'Target and limits',
    limits: 'limits',
    since: 'since',
    setBy: 'set by',
    change: 'Change',
    history: 'History',
    /* Roadmap Phase 2b guided-navigation pass (16 Sep 2026, IA-PROPOSAL.md
       §6.4 "a product → what it produced"). No Product Catalogue screen
       exists yet (Phase 6), so this points at the one place production is
       already broken out by product: the Product report type. */
    seeReport: 'See what it produced',
    seeReportNote: 'opens the product report, filtered to this product',
    none: 'No product has been recorded for this line yet.',
    /* Distinct from `none` above (OVERVIEW-SPEC.md §3.4 empty states, D4):
       `none` is /api/product-at's neverRecorded === true; this is the
       ordinary case on a July-generation period or under replay, where a
       product exists but none was in force at the queried instant. */
    noneAtThisTime: 'No product was recorded for the line at this time.',
    inactive: 'This product is marked inactive in the product master.',
    /* Finding M10 (Sep 2026 audit): PDAS's MaterialDesc2 carries real color
       data (e.g. 'PARROT', 'Khaki-2') that was never selected or shown. */
    colour: 'Colour',
    /* Sep 2026 audit fix: Changeover.tsx rendered the material's PP colour
       (PDAS MaterialDesc2) and the pallet's sack colour (PDAS PalletDesc1)
       BOTH under this one `colour` label — two different fields, one visible
       caption. These are the distinct ones; `colour` above stays as the
       Catalogue tab's single-field label (Running/Catalogue only ever show
       one colour at a time). */
    ppColour: 'PP colour',
    sackColour: 'Sack colour',
    previewLimits: (limits: string) => `New limits would be ${limits}.`,
    confirm: 'Record this product',
    cancel: 'Cancel',
    reason: 'Why (optional)',

    /* ---- PDAS write path (SEPT-2026-EPOCH-DECISION §5.5). Two distinct
       actions, never one "Edit" button: one keeps the product number and one
       cannot exist for the same blend + count + tube type. Never "Delete",
       never anything implying we wrote to the PLC. */
    pdasTitle: 'Products in PDAS',
    pdasNote:
      'These are written to PDAS through its own procedures, as the process engineer does by hand today. Nothing is sent to a machine.',
    writeUnavailable: (why: string) => `Changing products in PDAS is not available here: ${why}`,
    writeNeedsRank: 'Changing products in PDAS needs a manager account.',
    changeLimits: 'Change weight limits',
    changeLimitsHeading: (label: string, blend: string, count: string, tube: string, id: number) =>
      `Change weight limits — ${label} · ${blend} · ${count} · ${tube} (product ${id})`,
    targetTo: (from: string, to: string) => `Target ${from} → ${to}`,
    rangeTo: (from: string, to: string) => `Accepted range ${from} → ${to}`,
    changeLimitsNote:
      'This changes the limits the scale uses from now on. Readings already recorded keep the limits that were in force when they were weighed.',
    changeLimitsKeepsNumber: (id: number) =>
      `Product ${id} keeps its number, so past and future readings stay under the same product. If this is really a different yarn, create a new product instead.`,
    /* Pending IFL's answer on propagation (§6.2 q1). Not optional. */
    changeLimitsPropagation: 'The scale picks up the new limits when the product is next selected on the machine.',
    whyRequired: 'Why is this changing? (required)',
    changeLimitsConfirm: 'Change the limits',
    newProduct: 'Create a new product',
    newProductNote: 'A new product gets a new number. Readings from now on are recorded against it; nothing already recorded moves.',
    newProductTriple: (blend: string, count: string, tube: string, id: number) =>
      `PDAS allows only one product per blend + count + tube type. ${blend} · ${count} · ${tube} already exists as product ${id}. To create a new product, change one of those three — or change the limits on product ${id} instead.`,
    newProductConfirm: 'Create the product',
    retire: 'Retire',
    activate: 'Activate',
    retireNote: (id: number) =>
      `Retire product ${id}. It stops being selectable on the machine. Readings already recorded keep it, and you can bring it back later.`,
    activateNote: (id: number) => `Make product ${id} selectable on the machine again.`,
    setpointG: 'Target (g)',
    offsetMinusG: 'Below target (g)',
    offsetPlusG: 'Above target (g)',
    desc1: 'Lot / description',
    blend: 'Blend',
    count: 'Count',
    tubeType: 'Tube type',
    retired: 'retired',
    reasonTooShort: 'Please give a reason of at least 10 characters.',
    written: 'Written to PDAS.',

    /* ---- UX Phase 6 Brief 1 (16 Sep 2026): the Product screen shell,
       absorbing the old product sheet component. The tab strip, URL key `pt`. */
    tabs: {
      running: 'Running',
      changeover: 'Changeover',
      catalogue: 'Catalogue',
      history: 'History',
    } as const,
    /* Running tab: the line-wide recorded product (the old sheet's "current"
       section) plus the SAME /api/machines/running payload Line's
       MachinesBlock draws, pivoted BY PRODUCT rather than by station — a
       different question (which products are in force, on which machines)
       from Line's (is the line running), so the same numbers on two screens
       is not the duplication CLAUDE.md:305 forbids. */
    runningNow: 'Products in force now',
    runningNowNote: 'The same reading window Line uses, grouped by product instead of by machine.',
    runningNowEmpty: 'No product is recorded as running on any machine right now.',
    /* One row's machine list: "Station 3, Station 7" plus the since/cones
       facts MachinesBlock already states per machine. */
    onMachines: (list: string) => `On ${list}`,
    /* Catalogue tab: un-collapsed PdasProducts + LimitsForm/ActiveForm/
       CreateForm (moved verbatim) + ProductLimitsBlock. */
    catalogueTitle: 'Product catalogue',
    catalogueNote: 'Every product recorded in PDAS, its limits, and how to add, retire or re-limit one.',
    /* The `pr` deep link: which row this permalink pointed at. */
    catalogueLinkedNote: 'Linked from elsewhere in this system.',

    /* ---- Changeover tab (Brief 2 builds the screen; strings fixed here so
       Brief 2 never opens this file). Put machine N onto product X for this
       shift: a dry-run plan with blockers and warnings, and an execute step
       that stays refused until the local end-to-end test on the local
       database copy has passed (DEFECTS.md D-12; IFL's own written
       permission was given 19 Sep 2026, see
       handover/PDAS-WRITE-GRANT-2026-09-19.md). */
    changeover: {
      /* The one static line this brief's own instruction requires: it must
         not duplicate or contradict the server's own `disabledReason`,
         which Brief 2 prints verbatim beside it. */
      executionDisabled: 'Executing a changeover here is switched off until a full test of this feature has been run and passed on this computer. The plan below can still be checked.',
      planTitle: 'What this changeover would do',
      step: 'Step',
      blockers: 'Blockers',
      blockersNote: 'These stop the changeover; it cannot run until each is resolved.',
      warnings: 'Warnings',
      warningsNote: 'These do not stop the changeover, but are worth reading first.',
      noRollback: 'There is no automatic rollback. Reversing a changeover means recording another one.',
      operatorNote: 'This plan is a dry run: nothing on the machine or in PDAS changes until the changeover is executed, and execution is off (above).',
      dryRun: 'Check the plan',
      execute: 'Execute the changeover',
      noneYet: 'No changeover has been planned yet.',
      /* Field labels for a new tube type — AddTubeType has no "name only"
         INSERT, unlike AddBlend/AddCount, so the "new" branch needs two more
         inputs than RefPicker's. */
      tubeWeightG: 'Tube weight (g)',
      tubeForm: 'Tube form',
      /* Renamed from tubeExistingOnly 21 Sep 2026: AddTubeType's parameter
         signature was confirmed that day (CLAUDE.md, dated section of the
         same date), so the picker no longer restricts to existing tube
         types only — this note now just explains the extra fields a new
         entry needs, the same role RefPicker's blend/count pickers fill
         with no note at all because they need nothing extra. */
      tubeNewNote: 'A new tube type also needs its weight and form (1 or 2) — AddTubeType requires both.',
      /* Added with migration 041 (tube-form mirror fix): the picker now shows
         each existing tube type's form beside it, since AddTubeType's own
         duplicate check is name AND form together — a name match in a
         different form is a different tube type, not the same one. This
         string covers a mirror row whose form has not been recorded yet
         (an old row, before the next reference mirror refresh). */
      tubeFormUnknown: 'form unknown until the reference mirror refreshes',
    } as const,

    /* ---- History tab (Brief 3 builds the screen; strings fixed here so
       Brief 3 never opens this file). The product-change trail: SMS's own
       timeline plus PDAS's own `product_change` audit rows, one per write
       ATTEMPT — including attempts recorded while PDAS_WRITE_ENABLED was
       off, which never reached PDAS at all. Named `historyTrail`, not
       `history` — `product.history` above is already the old sheet's
       "History" button label and TS refuses a duplicate key. */
    historyTrail: {
      title: 'Product change history',
      colWhen: 'When',
      colProduct: 'Product',
      colBy: 'By',
      colOutcome: 'Outcome',
      colReason: 'Why',
      outcome: {
        applied: 'Applied to PDAS',
        failed: 'PDAS refused it',
        /* The honest reading of a row logged while the write path was off:
           the attempt was recorded, but it never reached PDAS at all — not
           a failure PDAS answered, and not silently dropped either. */
        disabled: 'Recorded here; never sent to PDAS (writes were off)',
      } as const,
      none: 'No product change has been recorded for this line yet.',
    } as const,
  } as const,

  /* -------------------------------------------------------------- stations */
  stations: 'Stations',
  stationsNote: 'cones this period',
  /* The one comparative chart replacing the fourteen 85x56px per-cell marks
     (UX chart-primitives pass, 23 Sep 2026) — see Line.tsx's StationCompare.
     Deliberately not "vs line": Weight's own "vs line" language means grams
     against the line's weight mean, a different measurement on a different
     unit; this is cone counts against the row's own median, and reusing the
     phrase would suggest the two charts measure the same thing. */
  stationsCompareAria: 'Cones this period, each station against the row’s own median',
  stationsCompareZero: 'row median',
  /* UX charts pass 2 (23 Sep 2026): the period's own shape, on the home
     screen, under the figures it belongs to. */
  conesPerDay: 'Cones weighed per production day',
  conesPerShift: 'Cones weighed per shift',
  conesPerDayAria: 'Cones weighed per production day',
  conesPerShiftAria: 'Cones weighed per shift',
  conesResting: (n: number, spread: 'day' | 'shift', total: string, most: string, mostLabel: string) =>
    `${n} ${spread === 'day' ? (n === 1 ? 'production day' : 'production days') : (n === 1 ? 'shift' : 'shifts')} · ${total} cones · busiest ${most} on ${mostLabel}`,
  /* A MARK READS AS EVIDENCE, which is why a chart drawn from a fetch that
     has since failed is worse than a stale number: nothing about a bar says
     when it was read. usePolling keeps its last payload on failure, so the
     chart stays on screen (dropping it would lose a true reading); this line
     says the reading stopped refreshing. Found next door on Wall.tsx, 23 Sep
     2026, where a frozen /api/live payload kept "Line 3 is running" on a TV
     for as long as the fetch stayed dead. */
  chartStale: 'This chart is the last reading that arrived — the latest request failed, so it is not refreshing.',
  conesPerDayUnavailable:
    'The per-day counts could not be read, so this chart is not drawn. The figures above come from a separate call and are unaffected.',
  /* Two points are the minimum a comparison can be made from, and WHICH kind
     of point is missing decides the sentence: on "Today" the grouping is by
     shift, and telling a reader who has already picked Today to "pick Today"
     was the first draft's own bug. */
  onePointNoShape: (spread: 'day' | 'shift') =>
    spread === 'day'
      ? 'Fewer than two production days in this period hold readings, so there is no shape to compare yet.'
      : 'Only one shift in this period holds readings, so there is no shape to compare yet — pick This week or This month.',
  /* The wall has no period control: its per-station counts are measured
     from the start of the shift (live.ts), so it must not borrow Line's
     "this period" wording. */
  stationsNoteShift: 'cones this shift',
  station: (n: number) => `Station ${n}`,
  quiet: 'quiet',
  quietFor: (span: string, n: number) => `Station ${n} has been quiet for ${span}`,
  /* UX Phase 7 Brief 1, Wall's footer: /api/stations or /api/attention
     failing means the board is built only from stations that have live rows
     (Wall.tsx's `ids`, derived from `names` and `line.stations`) — a station
     the roster would normally list but that has produced nothing this shift
     DISAPPEARS from the row entirely instead of showing as a visible gap.
     On a TV with nobody to press retry this must be said, not silently
     absorbed; kept to one footer sentence, no skeleton, no layout change. */
  wallBoardIncomplete: 'The station roster could not be fully loaded — a quiet station may be missing from this row, not just quiet.',
  /* The station grid's tag line (OVERVIEW-SPEC.md §3.3): quiet always wins —
     a machine that stopped is the bigger fact than one that rejected a few
     cones — so this is only ever shown when a station is NOT quiet. */
  stationRejected: (n: number) => `${n} rejected`,
  /* groupBy=station groups rejects by source_station, which is null for
     rejects the QCS path never attached to a station. Rendered in the
     block's note only when the sum is above zero, so the boxes' rejects
     never silently disagree with KPI figure 3. */
  unattributedRejects: (n: number) => (n === 1 ? '1 reject not attributed to a station' : `${n} rejects not attributed to a station`),
  /* Prefixed to the stations block note when health is not 'ok': the quiet
     tags are still true (measured to dataAsOfUtc, never the clock), but a
     reader would otherwise read "quiet" as "quiet right now". */
  measuredToNewest: (t: string) => `measured to the newest reading, ${t}`,
  lastReadings: 'Last readings',
  lastSack: 'Last sack',
  lastCone: 'Last cone',

  /* -------------------------------------------------------------- readings */
  readings: {
    cones: 'Cones',
    sacks: 'Sacks',
    rejectedCones: 'Rejected cones',
    /* A different population from rejectedCones above: those are cones the
       SCALE rejected (cone_event.in_range = 0); these are inspection rejects,
       logged in a separate table (reject_event) with no join key back to
       cone_event. Added for finding H4 (Sep 2026 audit) — Rejects' "see the
       rejected cones" link had nowhere that actually listed this population
       until now.
       Corrected 23 Sep 2026 (Weight brief item 4): this used to read
       "Rejected before weighing", asserting an order the data contradicts —
       matching reject_event to cone_event by millisecond+station finds a
       weighed cone for 5,933 of 6,049 quality rejects, 5,925 of those already
       `in_range = 1` (weighed fine, THEN rejected). Most inspection rejects
       are not "before weighing" at all; the two tables just carry no formal
       link, so a raw inspection-reject row is described by what it is
       (a separate check), not by a timing claim this system cannot support. */
    inspectionRejects: 'Rejected by inspection',
    filterOutsideLimits: 'Outside product limits',
    /* The count sentence while the outside-limits filter is on. It may NOT
       reuse countLine's "N weighed, M rejected (P%)": with the filter on
       those two counts describe different populations, and the percentage
       between them is unbounded (40 against 160 printed "400.0%"). */
    countLineOutside: (n: string) =>
      `${n} cones passed by the scale but outside the product's limits.`,
    nothingOutside: 'No cones in this period were passed by the scale but outside the product’s limits.',
    countLine: (n: string, rejected: string, pct: string) =>
      `${n} weighed, ${rejected} rejected by the scale (${pct}).`,
    /* UX Phase 7 Brief 1: the register's own count can load while the
       separate scale-reject count fails — two independent requests — and the
       old headline silently substituted 0 for the missing one, printing "0
       rejected by the scale (0%)" as if the scale had rejected nothing. Says
       what is known (the weighed count) and names what is not. */
    countLineRejectUnknown: (n: string) =>
      `${n} weighed; how many the scale rejected could not be loaded.`,
    /* 23 Sep 2026 (sheet-remount brief). A count that has not ARRIVED yet is
       not a count of zero, and these three say so rather than letting the
       headline fall back to 0. The screen used to print "0 weighed, 0
       rejected by the scale (0%)" for the whole of the first fetch — and,
       once a drilldown click made that happen on every sheet open, the
       lighter reject count sometimes landed first and printed "0 weighed,
       402 rejected by the scale (0%)": a pair that cannot exist. */
    countLinePending: 'counting the readings in this period…',
    countLineRejectPending: (n: string) =>
      `${n} weighed; still counting how many the scale rejected.`,
    /* Both counts are real and the register returned none weighed while the
       scale rejected some. There is no rate to state between them (the old
       sentence printed "(0%)", which is not what 402 out of 0 means), so
       this states the two numbers and nothing more. Unreachable from a
       half-loaded screen since the fix above; if it ever shows, the
       contradiction is in the data, not in the fetch. */
    countLineNoRate: (n: string, rejected: string) =>
      `${n} weighed, ${rejected} rejected by the scale.`,
    /* The headline replaces the whole sentence, not just the numbers, when
       the register itself (not just the reject count) failed to load — the
       body below already shows Failed with its own retry. */
    countLineFailed: 'Could not load this period’s count. The plant connection may be down.',
    /* UX Phase 7 Brief 1: when /api/stations fails, StationChip used to
       return null — removing the filter from the toolbar with no trace, so
       a viewer could not tell "there is no station filter here" from "the
       station list could not be reached". Shown in the chip's own place so
       the toolbar's shape does not change on a failed request either. */
    stationFilterUnavailable: 'Station filter unavailable',
    filterStation: 'Station',
    filterRejected: 'Rejected only',
    filterShift: 'Shift',
    moreFilters: 'More filters',
    weightRange: 'Weight range',
    reason: 'Reason',
    clear: 'Clear',
    perPage: (n: number, total: string) => `${n} a page, newest first · ${total} in this period`,
    liveNote: 'new readings appear every 15 seconds',
    next: 'Next',
    previous: 'Previous',
    nothing: 'Nothing was weighed in this period.',
    time: 'Time',
    sackNo: 'Sack',
    weight: 'Weight',
    status: 'Status',
    record: 'Record',
    /* The reject sheet. A quality reject's OWN row carries no weight column
       (reject_event has none); a weight reject's does. Neither has in_range.
       This used to say a quality reject "is pulled before the scale sees
       it" — corrected 23 Sep 2026: matching reject_event to cone_event by
       millisecond+station finds a weighed cone, already in-range, for most
       quality rejects (see `readings.inspectionRejects` above). The row
       having no weight of its own is a fact about this table; it is not
       evidence the cone was never weighed. */
    notWeighed: 'not weighed',
    rejectedFor: (reason: string) => `Rejected \u2014 ${reason}`,
    weightReject: 'weight reject',
    qualityRejectCode: (pair: string) => `quality reject, code ${pair} (not yet named)`,
    weighed: 'Weighed',
    /* Finding M7 (Sep 2026 audit): mapSack flags every sack row
       production_ts_is_insert_time=true — the plant has no separate weighing
       time for a sack (DQ-5) — and that flag was captured end-to-end but
       never shown anywhere. A sack's "Weighed" time is actually when the
       reading was written, which can trail the real event. */
    recorded: 'Recorded',
    insertTimeCaveat: "The plant records no separate weighing time for a sack — this is when the reading was written, which can trail the actual weighing.",
    /* Roadmap Phase 3 (14 Sep 2026): lineage a person can follow. The block
       lives under a disclosure — transform version and run ids belong there
       by this file's own rule — but everything in it is stated in words,
       and nothing in it is worked out on the client: each line prints a
       field the server sent, or "not available" when it sent none. */
    /* Roadmap Phase 2b guided-navigation pass (16 Sep 2026, IA-PROPOSAL.md
       §6.4 "the product in force at a reading → its report"). No Product
       Catalogue screen exists yet (Phase 6); this opens the Product report
       for that product, narrowed to this reading's own production day — the
       same day-narrowing ReasonSheet's register link already uses. */
    seeProductReport: 'See this product’s report',
    seeProductReportNote: 'opens the product report for this product, on this reading’s day',
    /* UX Phase 6 Brief 1 (16 Sep 2026): the second of the two Phase-4
       drilldown hops that had no destination until the Product screen's
       Catalogue tab existed (IA-PROPOSAL.md §6.4: "the product in force at
       a reading → Product › Catalogue, that product"). */
    seeProductCatalogue: 'See this product in the catalogue',
    seeProductCatalogueNote: 'opens Product › Catalogue for this product',
    provenance: 'Where this reading came from',
    /* TWO CLOCKS, named (CLAUDE.md). The plant's times are its wall clock;
       the moment the reading reached this system is a real UTC instant shown
       in this computer's zone. On the plant PC they sit five hours apart, and
       a reader who is not told so will read the gap as an 18-minute lag that
       became five hours. */
    provenanceNote:
      "Plant times are shown as the plant records them; the time it reached this system is shown in this computer's own time.",
    prov: {
      sourceTable: 'Source table',
      sourceSystem: 'Source system',
      generation: 'Generation',
      sourceRow: 'Source row id',
      readAt: 'Read into this system',
      insertedAt: 'Written by the plant',
      transform: 'Transform version',
      product: 'Product determined',
      rawRow: 'Raw row',
      syncPass: 'Sync pass',
      nightRule: 'Night shift counted to',
      plantShift: 'Plant-stored shift',
      productionDay: 'Production day',
      /** The server answered without a provenance object — an API from before it existed. */
      notAvailable: 'Not available for this reading.',
      /* attribution_method, in words. 'none' is honest for every row from
         before 5 Aug 2026, when IFL's tables had no MaterialId column; it is
         not a fault and must not read as one. */
      attribution: {
        source_column: "from the reading's own material id",
        none: 'no product recorded on the reading',
        manual_entry: 'set by hand on this line',
        unknown: 'not recorded',
      } as const,
      confidence: { high: 'high confidence', low: 'low confidence', ambiguous: 'ambiguous' } as const,
    } as const,
    /* The plant records no link from a cone to a sack; cones between two
       consecutive sacks range from 0 to 254 in the real data. This may be
       shown on a SACK, once, with the caveat printed — and never on a cone,
       where it would read as a packing list. */
    aroundSack: (n: number) =>
      `About ${n} cones were weighed between the previous sack and this one (approximate; the plant records no link between a cone and its sack).`,
  } as const,

  /* ---------------------------------------------------------------- weight */
  weight: {
    /* Until the weight basis is confirmed in Setup, the headline states the
       mean and the target as two facts and does NOT state the difference as a
       finding: if the recorded weight and the setpoint are stated on opposite
       bases, the comparison is out by a whole tube. */
    headlineUnconfirmed: (mean: string, target: string) =>
      `Average recorded weight is ${mean}; the product target is ${target} (weight basis not yet confirmed).`,
    headlineConfirmed: (mean: string, delta: string, target: string) =>
      `Average cone weight is ${mean}, ${delta} the ${target} target.`,
    headlineNoTarget: (mean: string) => `Average cone weight is ${mean}. No product target is recorded for this period.`,
    /* This states the PATTERN-TEST verdict (weightStations.ts `flagged`, a
       run of consecutive days on one side of the line — see calibration.ts),
       not whether a station is on target. It used to read "Every station is
       steady"/"N stations need a look" sitting directly beside the `vs
       target` column, which reads as the on-target verdict to a scanning
       eye — the exact confusion the audit found live (2026-09-23): a line
       ~9 g under target on every station, printed with this sentence saying
       "steady". Reworded, not deleted — the drift-pattern fact is still
       true and still worth stating; it now names what it is a verdict ON. */
    stationsNeedLook: (n: number) =>
      n === 1 ? "One station's pattern shows drift — worth a look." : `${n} stations' patterns show drift — worth a look.`,
    allStationsSteady: "No station's pattern shows drift.",
    /* The line-level counterpart to the per-row `vs target` column — added
       23 Sep 2026 (Weight brief item 1). `vsTargetG` was rendered only per
       station (Weight.tsx, StationSheet.tsx, four report screens); a shared
       offset across (nearly) every station therefore printed as fourteen
       small numbers and was never once stated as the single fact it is.
       States the READING, not a shortfall: whether the readings mean the
       line is genuinely light is exactly the question the weight basis
       (Q4/Q5, headlineUnconfirmed above) has not yet answered, and this
       sentence needs no answer to that question because it only describes
       what the scale recorded — never "the line is under weight". Only
       shown when it is true: (nearly) all stations read the same side of a
       single shared target; if stations disagree, or more than one target
       is in force among them, nothing is said and the per-row column is left
       to speak for itself. */
    lineOffset: (n: number, total: number, lo: string, hi: string, dir: string, target: string) =>
      (n === total
        ? `All ${n} stations`
        : `${n} of ${total} stations`) +
      ` read ${lo}–${hi} g ${dir} the ${target} target. That is a line-wide offset, not a station fault; whether it is a real shortfall depends on the weight basis, which is not yet confirmed.`,
    above: 'above',
    below: 'below',
    spread: (lo: string, hi: string) => `${lo} to ${hi}`,
    /* States the arithmetic, not an unmeasured distributional claim. It
       used to read "95 of every 100 cones fall in this range": the range is
       mean ± 2 standard deviations, nothing counts the share that actually
       lands inside, and the population is a mixture of fourteen
       differently-biased stations, so the normal-theory 95% does not follow. */
    spreadNote: 'two standard deviations either side of the average',
    /* The chart's y-domain excludes the spec limits (UX defect fix, 22 Sep
       2026 — they used to set the scale and flatten the real ~7 g of
       subgroup-to-subgroup movement to a few pixels). Zoomed in, a 3 g
       wobble can read as a crisis; a drawn control band was investigated and
       rejected (ragged subgroup n swings it 4.5x across one shift).
       Formerly `noiseFloor`, stating how much a group of this size moves "by
       chance alone" from σ_within/√n (±~2 g). Removed 23 Sep 2026 (Weight
       brief item 3): on real plant data the subgroup MEANS themselves range
       1937.3–1962.1 g, an SD about three times that theoretical figure — the
       group-to-group movement is not sampling noise, it is real, and "by
       chance alone" told a reader watching ±10 g swings that they were
       looking at nothing. The limit model is being replaced in parallel to
       measure the real between-subgroup variation properly; until it lands
       this chart states only what it can measure directly — the actual
       spread of the group means themselves, no distributional claim
       attached. */
    spanNote: (lo: string, hi: string) => `group means in this period have ranged ${lo} to ${hi}`,
    /* THE X̄ BAND, RESTORED 23 Sep 2026 (DEFECTS.md D-10). The band the dots
       and this sentence report is no longer X̿ ± 3σ_within/√n — that model
       assumed zero movement between one group and the next and flagged
       16-38% of groups. It is now an I-MR band on the group averages
       themselves, X̿ ± 2.66·MR̄, measured only from time-contiguous groups of
       one source generation (api/src/services/spc.ts). The second clause is
       not decoration: measured on this plant's own readings the band still
       puts 5.6% (September) to 13.1% (July) of groups outside it, and
       without saying WHY a reader counts 218 crises in a fortnight. A band
       set from adjacent-group movement is by construction narrow against a
       level that wanders over weeks. */
    outsideBand: (n: string, total: string) =>
      `${n} of ${total} group averages fell outside the control band — the band is set from the movement between one group and the next, so a slow change in level across the period puts many groups outside it.`,
    /* spc.ts marks the band invalid below 3 time-contiguous group pairs and
       forces every violation false. Nothing is drawn then, and the screen
       says that rather than leaving an unexplained bare line. */
    bandInvalid: 'No control band is drawn for this period: there are too few consecutive groups to measure one from.',
    /* The pattern rules (runs, trends, zone tests — Nelson 2-8) stay
       suppressed, and this says so rather than letting their absence read as
       "no patterns found". Measured 23 Sep 2026 against the two real source
       generations on the dev copy: 54.8% of groups flag on July's full
       range, 38.8% and 37.6% on September's — mostly rule 2 (nine in a row
       on one side) and rule 6 (four of five beyond 1σ), which is what an
       autocorrelated, slowly wandering level looks like to rules written for
       independent samples. A mark on two groups in five is not a finding. */
    patternsWithheld:
      'Run and trend patterns are not marked: measured against this line’s own readings they flag roughly two groups in every five, which is too many to act on.',
    /* ONE SOURCE GENERATION (23 Sep 2026). IFL dropped and recreated their
       four weighing tables on 5 Aug 2026, restarting every id at 1; the app
       calls each physical instance a generation and refuses to pool them.
       The chart is therefore right to exclude the others — but excluding
       them SILENTLY is the no-over-claiming rule read backwards, because the
       screen then implies the period is fully represented when it is not.
       Measured on the dev copy: a 21 Aug - 15 Sep window held 219,942
       readings and the chart drew 55,058 of them. Deliberately says
       "generation", never how a particular generation arose — the case this
       has to read correctly for is IFL's own table rebuild. */
    oneGeneration: (shown: string, excluded: string) =>
      `This chart covers one generation of the source tables: ${shown} readings. Another ${excluded} readings in this period belong to a different generation — the tables were rebuilt and their numbering restarted — and are left out rather than mixed in, because the two are not one continuous record.`,
    /* One pair of limit lines, one version of the tolerance. */
    limitsChanged: (n: number) =>
      n === 1
        ? 'The product’s limits changed once inside this period. The dashed lines are the version in force at its end and did not apply to every reading before the change.'
        : `The product’s limits changed ${n} times inside this period. The dashed lines are the version in force at its end and did not apply to every reading before the changes.`,
    overTime: 'Over time',
    distribution: 'Distribution',
    stationsTable: 'Stations',
    /* Two sorts, because weightStations.ts sorts by distance from TARGET
       only when a product was in force at the window's end, and by distance
       from the line average otherwise — which is the default state, and
       exactly when every "vs target" cell reads "—". */
    sortNote: 'flagged first, then by distance from target',
    sortNoteNoTarget: 'flagged first, then by distance from the line average',
    colStation: 'Station',
    colAverage: 'Average',
    colVsLine: 'vs line',
    colVsTarget: 'vs target',
    colPattern: 'Pattern',
    /* UX experiment (22 Sep 2026): replaces `vs line` + `Pattern` in the
       station table with the sparkline column — see Weight.tsx's
       Sparkline/StationTable. */
    colTrend: '11-day trend',
    trendScale: (lo: string, hi: string) => `Trend column: one shared scale for every station, ${lo} to ${hi}.`,
    colRejects: 'Rejects',
    colShows: 'What the data shows',
    steady: 'Steady.',
    /* Never "reduce by 9 g": weighing data cannot tell a scale that reads 9 g
       heavy from cones that are genuinely 9 g heavy, and the two need opposite
       actions. The wording states the observation and stops. */
    readsHeavier: (g: string, days: number) =>
      `Has read about ${g} heavier than the line for ${days} days — check its scale first.`,
    readsLighter: (g: string, days: number) =>
      `Has read about ${g} lighter than the line for ${days} days — check its scale first.`,
    // No "by <name>": the row carries no name, and the adjustment log in the
    // station sheet is where an adjustment is attributed, beside its reason.
    adjustedSince: (span: string) => `Adjusted ${span}, steady since.`,
    adjustedSpan: (days: number) =>
      days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`,
    highestRejects: 'Highest reject rate on the line, mostly quality codes — look at tubes before scales.',
    andMoreSteady: (n: number) => `and ${n} more stations, all steady`,
    logAdjustment: 'Log an adjustment',
    adjustmentLog: 'Adjustment log',
    adjustmentsIn: (n: number, days: number) =>
      `${n} ${n === 1 ? 'adjustment' : 'adjustments'} in the last ${days} days.`,
    adjustmentResets: "A logged adjustment restarts that station's pattern from that moment.",
    /* Was already drafted but never wired to a field until finding M9 (Sep
       2026 audit) — REDESIGN.md §5.3 specifies "station, signed grams, time,
       why", and LogForm below had a place for why but not for the number. */
    adjustAmount: 'Amount (grams, signed)',
    adjustWhen: 'When',
    adjustWhy: 'Why',
    save: 'Save',
    noTarget: 'No product target',
    /* UX Phase 5 Brief 2 (16 Sep 2026), strings for the station table's own
       per-station target (WeightStationRow.targetBasis) — pre-added here so
       the Wave 3 worker on Weight.tsx/StationSheet.tsx does not need to open
       this file. A station that ran more than one material in the window has
       no single target: say so, not "unknown". */
    mixedTarget: (n: number) => `No single target applies — ${n} materials ran here.`,
    /* Sibling of `limitsChanged` above, for underneath the STATION TABLE
       rather than the chart. */
    limitsChangedTable: (n: number) =>
      n === 1
        ? 'The line-wide target’s limits changed once inside this window; stations show the version in force at its end.'
        : `The line-wide target’s limits changed ${n} times inside this window; stations show the version in force at its end.`,
    /* The line-wide Current Product itself changing (a new product_timeline entry), not just a limits revision on the same product. */
    productChangedTable: (n: number) =>
      n === 1
        ? 'The line-wide Current Product changed once inside this window.'
        : `The line-wide Current Product changed ${n} times inside this window.`,
    /* A station whose readings carry no material_id at all (the July
       generation) is judged against the line-wide product, not its own
       material — say which basis applies. */
    targetLineProduct: 'No material recorded for these readings — judged against the line-wide product instead.',
    /* The sack weight chart (spc.ts returns source:'none' for sacks
       deliberately): the product setpoint is a CONE weight in grams, so no
       tolerance applies to a sack weight in kilograms. State the absence,
       never a number. */
    sackNoTarget: 'No product tolerance applies: the product target is a cone weight in grams, and this is a sack weight in kilograms.',
    /* Companion to sackNoTarget: the toggle only changes the chart below it.
       The headline, the three figures above and the station table below all
       stay cone-only regardless of the toggle (Weight.tsx always queries
       coneLine for those, never spc). Say so once, beside sackNoTarget,
       so a reader cannot read the kilogram chart into the gram numbers
       around it. */
    sackChartOnly: 'The headline, the figures above and the station table below still describe cones, not this sack chart.',
    /* UX Phase 7 Brief 5 (21 Sep 2026): `st` (getWeightStations) feeds the
       headline's station count, the target note on the first figure, and the
       whole station table — but the chart above (`spc`/`stationSpc`/
       `coneLine`) is a SEPARATE fetch and used to be blanked along with
       everything else by one `if (st.error && !st.data) return <Failed/>` at
       the top of the screen. Named distinctly from the chart's own Failed
       state and from `couldNotLoad` (coneLine's total-failure headline) so
       the two can never be confused on screen. */
    headlineStationDataFailed: 'Station and target data could not be loaded; the chart below may still be usable.',
    /* WS-GF (23 Sep 2026 red-team remediation, missingField.fuzz.test.tsx):
       the empty-period gate below used to be `s.count === 0` alone, which a
       field-stripped `count` (undefined — a valid 200 with a hole in it,
       missingField.fuzz.test.tsx's own subject) does not satisfy, so the
       headline fell through and stated the still-present `mean` as if the
       response were whole. Distinct from BOTH `couldNotLoad` (the whole
       fetch failed) and the genuine-empty sentence below (a real count of
       0) — the count itself is the one thing unknown here, so no mean may
       be printed beside it. Same "state the absence, never a confident
       number" rule Line.tsx/Rejects.tsx's `fig.couldNotRead` closes for the
       figure tiles (ae7a59b), reworded as a full sentence for this
       screen's one-line headline. */
    countCouldNotRead: 'How many cones were weighed could not be read this period, so no average is shown.',
    /* The figure tile's own note, when the target/station fetch failed
       rather than genuinely holding no target — distinct from `noTarget`
       above, which is the honest "none recorded" case. */
    targetUnknown: 'Target unknown — could not load',
  } as const,

  /* --------------------------------------------------------------- rejects */
  rejects: {
    headline: (n: string, pct: string, quality: number, weight: number) =>
      `${n} cones rejected, ${pct} of everything weighed — ${quality} for quality, ${weight} for weight`,
    /* "steady" is only honest when the WINDOW was steady. The rising test
       asks whether an episode is still running at the NEWEST bucket, so a
       fortnight holding three rises that ended on Tuesday read "steady." to a
       reader looking straight at those spikes on the chart below it. */
    steady: 'steady',
    steadyAfterRises: (n: number, lastEnded: string) =>
      n === 1
        ? `not rising now, after one rise in this window that ended ${lastEnded}`
        : `not rising now, after ${n} rises in this window, the last ending ${lastEnded}`,
    risingSince: (when: string, kind: string) => `${kind} rejects have been rising since ${when}`,
    topReason: 'the top reason',
    notYetNamed: 'not yet named',
    codeUnnamed: (code: string) => `Code ${code} — not yet named`,
    noCode: 'No code recorded',
    /* The shaded band is only drawn when the selected period overlaps the
       trailing window; pick dates older than it and the title promised a
       band that is not there. */
    trendTitle: (days: number) => `Reject rate over the last ${days} days · this period shaded`,
    trendTitleNoShade: (days: number) => `Reject rate over the last ${days} days`,
    /** Only printed when fewer days hold readings than the window asked for. */
    daysHoldReadings: (n: number, of: number) => `Only ${n} of those ${of} days hold readings.`,
    /** The window crosses the 5 Aug 2026 rebuild of IFL's tables. */
    spansGenerations:
      "This window crosses the 5 August rebuild of IFL's tables. The usual range is worked out separately on each side of it, never across.",
    usualRange: 'usual range',
    quality: 'quality',
    weightKind: 'weight',
    reasonsTitle: (days: number) => `Reasons, last ${days} days`,
    /* IFL has not supplied the meaning of the inspection codes. Until they do
       the list must not present a raw code pair as if it were a reason. */
    namesAwaited: 'Reason names have not been supplied yet. A manager can name a code here; the name applies to history.',
    nameIt: 'Name it',
    seeTheCones: 'See the rejected cones themselves',
    // Fixed alongside finding H4/M8 (Sep 2026 audit): this used to describe
    // the SCALE-rejected cone toggle, but the link actually opens the
    // inspection-reject listing — a different population (reject_event, not
    // cone_event.in_range=0). See Readings.tsx's 'inspectionRejects' listing.
    // Corrected 23 Sep 2026 (Weight brief item 4), same reason as
    // `readings.inspectionRejects` above: "before weighing" is an order this
    // data does not support for most rows.
    seeTheConesNote: 'opens Readings filtered to cones rejected by inspection, for this period',
    byStation: 'By station',
    // Fixed alongside finding M8 (Sep 2026 audit): described a reject-rate
    // sort that has never existed — weightStations.ts sorts flagged stations
    // first, then by distance from target (or from the line with no target).
    byStationNote: 'opens the Weight station table, flagged stations first',
    perDay: 'Rejects per day',
    none: 'No cones were rejected in this period.',
    /* UX Phase 5 Brief 2 (16 Sep 2026), pre-added for the Wave 3 worker on
       Rejects.tsx: the Pareto's "vital few" sentence and its cumulative
       column, so that worker never needs to open this file. */
    vitalFew: (n: number, pct: string) => `${n} ${n === 1 ? 'reason accounts' : 'reasons account'} for ${pct} of rejects in this period.`,
    cumulativePct: 'Cumulative %',
  } as const,

  /* ---------------------------------------------------------------- report */
  report: {
    coverageAll: (period: string, days: number) =>
      `${period}: all ${days} ${days === 1 ? 'day holds' : 'days hold'} production data.`,
    coveragePartial: (period: string, withData: number, of: number, first: string, last: string) =>
      `${period}: ${withData} of ${of} days hold production data (${first} to ${last}).`,
    coverageNone: (period: string) => `${period}: no production data.`,
    newestDayWithData: (day: string) => `The most recent day with data is ${day}.`,
    showThat: 'Show that period',
    conesPerDay: 'Cones per day',
    perSack: 'cones per sack',
    averageSack: 'average sack',
    timeLost: (span: string, stops: number) =>
      `Time lost ${span} in ${stops} ${stops === 1 ? 'stop' : 'stops'}`,
    timeLostCaveat: 'planned breaks and faults cannot be told apart in the data',
    /* Requirement 7 is the largest thing IFL asked for and it is not built,
       because their sack table carries no machine and no record of a sack
       leaving. A GM who looks for stock must find the reason, not a blank. */
    /* Says only what is true. The previous wording ended "IFL has been
       asked how sacks are linked to machines…" — but IFL_SACK_STOCK_QUESTION.md
       still reads "drafted 2 Sep 2026, not yet sent". This prints on the
       Report, the one screen that leaves the building, possibly to IFL. */
    noSackStock:
      "Sack stock per machine is not shown: the plant's sack records carry no machine and no record of a sack leaving.",
    byShift: 'By shift',
    byDay: 'By day',
    colShift: 'Shift',
    colDay: 'Day',
    colCones: 'Cones',
    colSacks: 'Sacks',
    colSackWeight: 'Sack weight',
    colRejected: 'Rejected',
    colRate: 'Rate',
    print: 'Print',
    exportCsv: 'Export CSV',
    exportXlsx: 'Export Excel',
    exportPdf: 'Export PDF',
    printedAt: 'Printed',
    printedBy: 'by',
    /* The label on the verdict mark — the one ink fill in the application,
       and the only thing that names it. */
    verdict: 'Verdict',
    /* UX chart-primitives pass (22 Sep 2026), for `RankBars`/`DeviationBars`
       (report/shared.tsx) — pre-added so the two workers who build report
       graphics on top of them never need to open this file. Parameterised,
       not screen-specific: a caller names its own metric and unit, these
       state what the marks mean without repeating a colour rule in prose. */
    rankedBy: (metric: string, unit: string) => `Ranked by ${metric}${unit ? `, ${unit}` : ''}.`,
    deviationScale: (metric: string, unit: string) => `${metric}, in ${unit}, against zero.`,
    refLineZero: 'Zero line',
    refLineMean: 'Line mean',
    refLineThreshold: (what: string) => `Flag threshold — ${what}`,
    tooFewRows: 'Too few rows to draw a chart here — see the table.',
    /* A per-day bar series scoped to one shift, for the Shift report — the
       existing `conesPerDay` caption names no shift, so a chart drawn once
       per shift needs its own label or two would print identically. */
    conesPerDayFor: (shift: string) => `Cones per day — ${shift}`,
  } as const,

  /* ------------------------------------------------------------------ setup */
  /* In the order the page shows them: the connection first, then what the
     line IS (line, machines, stations, sources), then what this system
     applies to it (rules, reject codes), then who may change any of it. */
  setupTabs: {
    sync: 'Sync health',
    line: 'Line',
    machines: 'Machines',
    stations: 'Stations',
    sources: 'Sources',
    rules: 'Rules',
    rejectCodes: 'Reject codes',
    people: 'People',
    audit: 'Audit log',
  } as const,

  /* Roadmap Phase 1 (14 Sep 2026): the configuration sections. The same
     rules as everywhere else — plain words, no question numbers in the copy
     (the number an IFL answer is waiting on goes in the code comment beside
     the string, never on the screen), and a seeded default that an answer
     could change says so in a sentence. */
  config: {
    save: 'Save',
    cancel: 'Cancel',
    add: 'Add',
    edit: 'Edit',
    saved: 'Saved.',
    noChange: 'Nothing has changed.',
    why: 'Why (optional)',
    yes: 'yes',
    no: 'no',
    notKnown: 'not known',
    none: 'none',
    active: 'Active',
    inactive: 'inactive',
    /* A write that failed for a reason the server did not name. Distinct from
       couldNotLoad: the admin's change was NOT made, and the sentence must
       say so rather than talk about loading. */
    couldNotSave: 'Could not save this. The plant connection may be down.',

    line: {
      note: 'the names every screen prints',
      plant: 'Plant',
      unit: 'Unit',
      lineName: 'Line',
      displayName: 'Display name',
      code: (code: string) => `code ${code}`,
      /* The display name is also the subject of the headline sentence, so an
         admin choosing one needs to know it will be read as "<name> is
         running" on a wall display. */
      displayNameNote:
        'Printed in the top bar, on the report, and as the subject of the headline — “… is running” — so keep it short.',
      // Q14 (single vs multi-line) is still open with IFL; the screens serve
      // one line and say so rather than pretend otherwise.
      oneLine:
        'This installation serves one line. IFL has not yet said whether a second line is wanted; the screens are built for one.',
    } as const,

    machines: {
      note: 'the winders and the packer on this line',
      // Q3: seeded link station N ↔ winder N (migration 028). If IFL says a
      // machine and a station are different things, the links are edited
      // here, not the code — and this sentence says the default is a default.
      defaultLink:
        'Stations are linked to the winder with the same number by default. IFL has not yet confirmed whether a machine and a station are the same thing.',
      colNo: 'No.',
      colKind: 'Kind',
      colMake: 'Make',
      colModel: 'Model',
      colName: 'Name',
      colActive: 'Active',
      colStation: 'Linked station',
      /** The packer: no reading ever names it. */
      noNumber: 'no number',
      notLinked: 'none',
      kinds: { winder: 'winder', packer: 'packer', other: 'other' } as const,
      add: 'Add a machine',
      number: 'Machine number (optional)',
      numberNote: 'The number the plant writes on each reading. Leave it blank for a machine the readings never name, such as the packer.',
      kind: 'Kind',
      name: 'Name',
      make: 'Make',
      model: 'Model',
      notes: 'Notes',
      added: (name: string) => `${name} added.`,
      addedWithStation: (name: string, no: number) => `${name} added, and station ${no} with it, linked to it.`,
    } as const,

    stations: {
      note: 'the names every screen uses',
      colNo: '#',
      colName: 'Name',
      colMachine: 'Machine',
      colActive: 'Active',
      notNamed: 'not named',
      noMachine: 'no machine',
      /* How the link was made — the seeded default by number, or set here. */
      linkedByNumber: 'linked by number',
      linkedHere: 'linked here',
      rename: 'Rename',
      add: 'Add a station',
      number: 'Station number',
      name: 'Name (optional)',
      machine: 'Machine',
      added: (id: number) => `Station ${id} added.`,
    } as const,

    sources: {
      note: 'where the readings come from',
      /* Secrets stay in the file on the plant PC; the table says what each
         connection is FOR. An admin who expects to type a password here
         should learn at once that this is not where it goes. */
      intro: 'Server, database and login stay in the .env file on the plant PC. This lists what each connection is for, and which tables this line reads.',
      colSource: 'Source',
      colRole: 'Role',
      colConnection: 'Connection',
      colEnabled: 'Enabled',
      colNotes: 'Notes',
      roles: { acquisition: 'weighing acquisition', product_master: 'product master', sack_packing: 'sack packing' } as const,
      // Seeded disabled (migration 028): the roadmap names a sack-packing
      // database, IFL has not identified one, and sack rows come from the
      // acquisition database. Enabling it here changes nothing until a
      // connection block for it exists.
      packingUnknown: 'A separate sack-packing database has not been identified by IFL; sack readings come from the acquisition database.',
      /* What the toggle does, said once under the table rather than beside
         each switch (roadmap Phase 2, 14 Sep 2026). The worker loads only
         tables whose source AND row are enabled (loadSourceTables), so a
         disabled source is skipped on every pass — nothing is read from it,
         and nothing already copied is touched. */
      disabledNotRead:
        'A source that is disabled is not read by the sync worker: none of its tables are read on any pass until it is enabled again. Readings already copied stay as they are.',
      tablesTitle: 'Tables this line reads',
      colKind: 'Kind',
      colTable: 'Table in the source database',
      colRaw: 'Copied into',
      kinds: { cone: 'cones', sack: 'sacks', reject_qcs: 'quality rejects', reject_weight: 'weight rejects' } as const,
      tableNameInvalid: 'A table name is letters, digits and underscores, starting with a letter or underscore.',
    } as const,

    rules: {
      note: "what this system applies when it reads the plant's numbers",
      weight: 'Weight',
      basis: 'Weight basis',
      bases: { as_recorded: 'as recorded', gross: 'gross', net: 'net' } as const,
      basisUnconfirmed:
        'Until this is confirmed, the Weight screen states the average and the target as two facts rather than as a difference.',
      tubeG: 'Cone tube weight (g)',
      tareKg: 'Sack tare (kg)',
      shifts: 'Shifts',
      morningStart: 'Morning starts',
      eveningStart: 'Evening starts',
      nightStart: 'Night starts',
      /* Said BEFORE submitting, in the form, the moment the three times stop
         being in order — the server refuses the same thing, but a round trip
         to learn it is a round trip too many. */
      shiftOrder: 'Morning must start before evening, and evening before night.',
      shiftTimeInvalid: 'Each start is a time of day, as HH:MM.',
      mode: 'Shift attribution',
      modes: { corrected: 'corrected — from the weighing time', legacy: 'legacy — as the plant recorded it' } as const,
      // Q7 (fix vs reproduce the plant's Shift column) is still open; the
      // mode is stored for the day it is answered and changes nothing yet.
      modeNote: "Recorded for when IFL says whether the plant's own shift column should be corrected or reproduced. It does not change anything yet.",
      nightBelongsTo: 'A night shift belongs to',
      nights: { start_day: 'the day it starts', calendar_day: 'the calendar day of each reading' } as const,
      plausibility: 'Plausible readings',
      plausibilityNote: 'Readings outside these bounds are treated as scale faults and left out of every average.',
      coneLoG: 'Lightest plausible cone (g)',
      coneHiG: 'Heaviest plausible cone (g)',
      sackLoKg: 'Lightest plausible sack (kg)',
      sackHiKg: 'Heaviest plausible sack (kg)',
      loBeforeHi: 'Each lower bound must be below its upper bound.',
      /** The rule table is empty: the form shows what the system applies in that case. */
      noRuleYet: 'No rule has been recorded yet; the values shown are what this system applies until one is.',
    } as const,

    rejectCodes: {
      note: 'what each inspection code means',
      /* IFL has not supplied the meanings (the same state Rejects reports).
         Naming one here applies to history: the label is joined at read
         time, never stamped on rows. */
      intro: 'IFL has not supplied the meaning of the codes. A name given here applies to every reading, past and future.',
      colType: 'Type',
      colTube: 'Tube code',
      colMaterial: 'Material code',
      colLabel: 'Name',
      colPass: 'Pass?',
      colSeverity: 'Severity',
      types: { quality: 'quality', weight: 'weight' } as const,
      pass: { yes: 'yes', no: 'no', unknown: 'not known' } as const,
      severities: { none: 'none', INFO: 'info', WARNING: 'warning', ERROR: 'error', CRITICAL: 'critical' } as const,
      none: 'No reject codes have been seen in the readings yet.',
      unnamed: 'not yet named',
    } as const,
  } as const,
  sync: {
    ok: 'The plant connection is healthy.',
    stale: 'The plant connection has not delivered anything recently.',
    failing: 'The last sync attempt failed.',
    /* Requirement 1's real status, visible in the product rather than only in
       a document. */
    source: 'Source: IFL SQL Server, read-only. There is no PLC connection.',
    lastPass: 'Last successful pass',
    oldestTable: 'Oldest table',
    findings: 'Blocking findings',
    perTable: 'Per table',
    /* The reason the worker stopped, from the sync_run row it now writes on
       every halt (14 Sep 2026). Before that a halt wrote nothing, so this
       screen could only say the data was ageing, never why. */
    lastFailure: (table: string) => `Last failure, on ${table}:`,
    /** A pass recorded before source generations existed — true, and worth saying. */
    preEpochPass: 'before generations were recorded',
    /* The H5 hazard, said plainly. Changing the night rule restamps only
       NEW rows, so until a rebuild runs the table holds two regimes and every
       shift_date figure blends them. Migration 023 marks each row so this can
       be detected at all. */
    mixedShiftRules: (tables: string) =>
      `${tables} hold readings attributed under two different night-shift rules. Every figure counted by production day blends them until a rebuild is run.`,
    none: 'None',
    /* Roadmap Phase 2 (14 Sep 2026): the worker probes the plant connection
       once at the start of every pass and records the result. "At the last
       pass" is the honest scope — this API cannot reach the plant itself,
       so it can only report what the worker last found. */
    probe: 'Plant connection',
    probeOk: (at: string) => `reachable at the last pass (${at})`,
    probeFailed: (at: string) => `not reachable at the last pass (${at})`,
    probeNotMeasured: 'not yet measured',
    /* Halted is a decision, not a fault: the worker refused to read a table
       (an unregistered source generation, a source that went backwards) and
       wrote why. The reason is the worker's own text, printed verbatim,
       because it names the command that clears it. */
    halted: (n: number, tables: string) =>
      n === 1 ? `1 table is halted: ${tables}.` : `${n} tables are halted: ${tables}.`,
    lastReason: 'Last reason:',
    /* Per source table, from the epoch register: every generation of the
       table is closed and none is open, so the worker halts on it before
       reading. Rare — a table the worker has never seen has no epoch rows at
       all and does not appear here — but when it happens nothing else on
       this screen says why the age is climbing. */
    noOpenEpoch: (sourceTable: string) =>
      `No source generation is registered for ${sourceTable} — the worker halts on it until sms epoch:accept is run.`,
  } as const,

  /* ------------------------------------------------------------- the sheet */
  /** Screen-reader only: what the chevron on a clickable row means. */
  openRecord: 'Open',
  close: 'Close',
  esc: 'Esc',

  /* --------------------------------------------------------- shared chrome */
  working: 'Show the working',
  details: 'Details',
  /* Line's Details disclosure, third paragraph (OVERVIEW-SPEC.md §3.6): the
     honest home for a fact that would be noise in a KPI note and a lie of
     omission if dropped entirely — readings the population rule excluded as
     scale faults, already on the wire as /api/production's `implausible`. */
  detailsImplausible: (n: string) =>
    `${n} readings in this period were outside the plausible range for a cone and are excluded from every figure above.`,
  loading: 'Loading…',
  couldNotLoad: 'Could not load this. The plant connection may be down.',
  notAllowed: 'This is only available to an administrator.',
  /* Finding H13 (Sep 2026 audit): StationSheet had no branch for "loaded, but
     this station isn't in the data" — an invalid or renamed station id spun
     on a loading skeleton forever, indistinguishable from a slow network. */
  stationNotFound: 'This station has no readings in the window this sheet looks at, or the number in the link no longer matches a station.',
  retry: 'Try again',
  nothingHere: 'Nothing recorded in this period.',
  /* WS-B1 (23 Sep 2026 red-team remediation): the KPI block's OWN empty-
     state note (`kpiBlockNote`, Line.tsx) used to be reachable from a data
     issue too — a malformed row's forced-0 cones/sacks/rejects summed to
     zero and printed `nothingHere` above, a false "the line made nothing"
     over a row the server itself flagged as unreadable. Checked first,
     ahead of the real-empty-period case, so it can never be shadowed by it. */
  dataIssueThisPeriod: "Part of this period's figures could not be read from the source. See Health for which.",
  replay: 'REPLAY — showing the plant as it was at',
  replayNote: 'This is not live.',
  offline: 'Could not reach the server — showing the last numbers received.',
  ago: 'ago',
  of: 'of',
  and: 'and',

  /* --------------------------------------------- rejects, roadmap Phase 5 */
  /* The drilldowns the requirement names (date, shift, product, machine,
     reject code) and the per-day-per-code breakdown, added 14 Sep 2026. Kept
     apart from `rejects` so the two can be reviewed as one change. Plain
     words on the screen; "p-chart" and "control band" stay under Details. */
  rejectsMore: {
    /* The chips. */
    filterStation: 'Station',
    filterProduct: 'Product',
    all: 'All',
    codeChip: (name: string) => `Reason: ${name}`,
    clearCode: 'clear',
    clickBarHint: 'Choose a reason to follow it through the trend and the days below.',
    /* The second figure: the top reason, and that it is the period's. */
    topReasonThisPeriod: (reason: string) => `${reason} · the top reason this period`,
    /* Which figures follow the period and which do not. Stated once. */
    reasonsFollowPeriod: 'Reasons and the days below follow the selected period.',
    detectorFixed: (days: number) =>
      `The trend and its "rising" verdict always look at the last ${days} production days, because a rise cannot be seen inside one shift.`,
    trendTitle: (days: number) => `Reject rate over the last ${days} days · usual range shaded`,
    trendTitleNoShade: (days: number) => `Reject rate over the last ${days} days`,
    bandLabel: 'usual range',
    bandNote: 'The shaded band is the usual range for quality rejects at that day’s volume; the dashed line is the same ceiling for weight rejects. A marked day sits above its ceiling.',
    bandNoteOneSeries: 'The shaded band is the usual range for this reason at that day’s volume. A marked day sits above it.',
    aboveUsual: 'above the usual range',
    /* UX Phase WS-B2 (23 Sep 2026): the reject-trend hover readout, for the
       day under the cursor when that bucket has no valid rate at all — a
       gap in the series (rejectSpc.ts sets no `rate` for a day too thin, or
       the weight series simply has no matching bucket that day), not a
       measured 0%. Reported by `report/shared.tsx`'s own `fmtRateOrGap`,
       which used a local constant of the same text pending this entry. */
    noReadingThisDay: 'no reading this day',
    /* The per-day-per-code breakdown. */
    byDayTitle: 'By day and reason',
    byDayNote: 'Rate is that day’s share of everything inspected. A day here is the production day, 06:00 to 06:00.',
    /* IFL has not said whether their reject reporting counts by production
       day or by calendar date. Printed, not implied. */
    dayBasisCaveat: 'IFL has not confirmed whether reject reports should count by production day or by calendar date; this screen uses the production day.',
    colDay: 'Day',
    colReason: 'Reason',
    colCount: 'Rejects',
    colCones: 'Cones that day',
    colRate: 'Rate',
    noneForFilters: 'No rejects match these filters in this period.',
    /* The caveat under a product filter — the same sentence Line uses for cones. */
    predateProduct: (n: string, of: string) =>
      `${n} of ${of} rejects in this period were recorded before the plant began recording a product, and are not shown under a product filter.`,
    /* Inline rename failure. The old screen swallowed it. */
    renameFailed: 'The name was not saved. Try again.',
    /* The reason sheet. */
    sheetTitle: 'Rejects for one reason',
    sheetEyebrow: (day: string) => `${day} · production day`,
    sheetCount: (n: string, reason: string) => `${n} cones rejected for ${reason}`,
    sheetCountOne: (reason: string) => `1 cone rejected for ${reason}`,
    sheetEmpty: 'No rejects of this reason on this day.',
    sheetMore: (shown: number, total: number) => `Showing the first ${shown} of ${total}.`,
    colTime: 'Time',
    colStation: 'Station',
    colProduct: 'Product',
    colWeight: 'Weight',
    colRecord: 'Record',
    noProductThen: 'not recorded',
    notWeighed: 'not weighed',
    openRegister: 'See this day in Readings',
    openRegisterNote: 'opens Readings on the inspection rejects of this day; the reason itself is listed only here',
    /* Roadmap Phase 2b guided-navigation pass (16 Sep 2026, IA-PROPOSAL.md
       §6.5 "a reject code → the days and readings behind it"). The reject
       report has no per-code filter (FILTERS_BY_TYPE), so this narrows to
       the same day the sheet is already showing rather than the code alone. */
    openReport: 'See this day on the reject report',
    openReportNote: 'opens the reject report for this day',
    nameThisReason: 'Name this reason',
    rename: 'Rename',
    save: 'Save',
    cancel: 'Cancel',
    pass: 'counted as a pass',
    fail: 'counted as a fail',
    passUnknown: 'pass or fail not set',
  } as const,

  /* ------------------------------------------ health & account (Phase 11) */
  /* Roadmap Phase 11 (14 Sep 2026). The Health screen is open to every
     signed-in account — IFL's people are created at manager, and until now
     the only place that said whether the sync was alive was admin-only. The
     same rules as everywhere: plain words, and a threshold that is the
     developer's default says so (IFL has not stated a retention or backup
     regime — Phase 11 clarifications). */
  health: {
    nav: 'Health',
    title: 'Health',
    question: 'Is this system itself healthy: the plant link, the database, the service, and the backups.',
    status: { ok: 'Everything is healthy.', degraded: 'Something needs attention.', down: 'The database cannot be reached.' } as const,
    service: 'Service',
    version: (v: string) => `Version ${v}`,
    upSince: (span: string) => `running for ${span}`,
    restarted: 'A short uptime beside an old "since" means the service restarted — the crash record is in the log.',
    degradedBecause: (reason: string) => `The service reported a database problem: ${reason}`,
    database: 'Database',
    dbLatency: (ms: number) => `answering in ${ms} ms`,
    dbSize: (mb: string, pct: string, capGb: number) => `${mb} MB used of the ${capGb} GB SQL Server Express allows — ${pct} %.`,
    dbSizeUnknown: 'The size could not be read.',
    /* Over 80 %: the one sentence that says what happens and whose decision
       the remedy is. Raw and canonical retention is IFL's call, not ours. */
    dbNearCap: 'Past 80 % of the cap. At 100 % every write fails and readings stop arriving. Only removing old readings brings it down, and how long readings are kept is a decision for IFL — it has not been made.',
    acquisition: 'Plant link',
    backup: 'Backups',
    backupLast: (span: string, file: string) => `Last backup ${span} ago (${file}).`,
    backupNone: 'No backup file was found.',
    backupWarn: 'Backups run nightly; more than two days without one means the scheduled task has stopped. Check Task Scheduler on the server.',
    backupDir: (dir: string) => `Looking in ${dir}.`,
    /* The account menu and the password sheet. */
    account: 'Account',
    changePassword: 'Change password',
    currentPassword: 'Current password',
    newPassword: 'New password',
    confirmPassword: 'New password again',
    mismatch: 'The two new passwords differ.',
    wrongCurrent: 'The current password is not right.',
    changed: (n: number) =>
      n === 0 ? 'Password changed.' : n === 1 ? 'Password changed. One other session of yours was signed out.' : `Password changed. ${n} other sessions of yours were signed out.`,
    /* Setup › People: the admin reset. */
    password: 'Password',
    reset: 'Reset',
    resetDone: (n: number) => (n === 0 ? 'reset; the account was not signed in anywhere' : `reset; signed out of ${n} session${n === 1 ? '' : 's'}`),
    ownPasswordHint: 'from the account menu',
    /* Setup › Audit log paging and the no-actor rows. */
    older: 'Show older',
    noActor: 'no one signed in',

    /* ---- UX Phase 6 Brief 4 (System screen; strings fixed here now so
       Brief 4 never opens words.ts). */
    /* A list of data-quality findings the sync's own checks raised — never a
       comparison against IFL's source, since this system cannot read it live. */
    dqFindings: 'Data quality findings',
    dqFindingsNone: 'No data quality findings are open.',
    /* A count of SMS's OWN readings by table and generation — explicitly a
       census of what this system holds, not a reconciliation against IFL's
       database (which this system has no standing live connection to check). */
    reconciliationTitle: 'Reconciliation — what this system holds',
    /* Corrected Sep 2026 audit (finding: this string claimed a grouping the
       endpoint does not do). api/src/services/reconcile.ts groups by scale
       state (within/low/high/rejected/unknown) crossed with plausibility
       bucket (plausible/implausible/no weight) over sms.cone_event — no
       source-table or generation dimension anywhere in the query. */
    reconciliationNote: 'A census of the readings this system has recorded, grouped by scale/tolerance state and by whether the weight is plausible. This is not a comparison against IFL’s database; nothing here reads it live.',

    /* ---- UX Phase 7 Brief 1 (reliability states; strings fixed here now
       so Brief 3 — the Health screen's reliability-states work — never
       opens words.ts, the same convention Brief 4 followed above). This
       phase's flagship fix: a blocking-findings COUNT that could not be
       read must never look identical to a count of zero — that confusion
       (a failed fetch rendering as an empty answer) is the defect this
       whole phase exists to close. See CLAUDE.md's "why this phase exists". */
    dqBlockingCouldNotLoad: 'How many findings are blocking could not be read — this is not the same as none being open.',
    /* A DQ finding links to ONE example row so a reader can look at it —
       never named as "the offending reading" (that implies the row itself
       is at fault, which a data-quality finding does not establish), and
       never left to imply it is the only row the finding covers. */
    dqFindingSourceRow: 'the first of the rows this finding counts',
    /* The row a DQ finding or a rebuild-audit entry links to can outlive its
       own link — superseded by a later rebuild, or from a generation this
       system no longer holds. "No longer in the register" says why the
       click failed without implying a broken link or a bug. */
    sourceRowGone: 'That reading is no longer in the register — it may have been superseded by a rebuild, or belong to a source generation this system no longer holds.',
    /* A reject finding's subjectRef is real but unresolvable from the client
       alone: sms.reject_event does not record whether the offending row came
       from the QCS check (reject_qcs_raw) or the weight scale
       (reject_weight_raw) — Brief 2 tried resolving a real ref against both
       and got two different, both-plausible readings. A wrong guess is worse
       than admitting the source row cannot be pinned down, so this finding
       type never offers a link at all. */
    dqRejectSourceUnresolvable: 'The source row cannot be identified for this finding: this system does not record whether a reject reading came from the QCS check or the weight scale.',
    /* UX Phase 7 Brief 3: the source-table list (/api/admin/sources, isAdmin
       only) failing is a DIFFERENT fact from /api/operations failing — the
       sync rows themselves (outcome, rows written, age) still loaded fine,
       only the epoch-placement join could not run. Never let this read as
       the ordinary non-admin case, where there is simply nothing to place. */
    sourceListCouldNotLoad: 'The source-table list could not be read, so a halted table below cannot be placed on its row — the halt itself, when there is one, is still named.',

    /* The source-generation register (sms.source_epoch; CLAUDE.md's "Source
       generations (epochs)" — IFL dropped and recreated its weighing
       tables on 2026-08-05, restarting every identity, so each physical
       generation of each source table is named and tracked separately). */
    epochRegister: {
      title: 'Source generations',
      note: 'Every physical generation of each source table this system has ever read from. A generation is registered by hand, with sms epoch:accept — never automatically — and the worker halts on any table with no open generation.',
      none: 'No source generation is registered yet.',
      colTable: 'Source table',
      colOrdinal: 'Generation',
      /* UX Phase 7 Brief 5 (21 Sep 2026): this column renders `g.provenance`
         (sms.source_epoch.provenance — 'ifl_live' | 'ifl_copy' | 'simulator',
         db/migrations/025_source_epoch.sql:29), which of the three physical
         SOURCES produced this generation — never who registered it, or when.
         The header used to read "Registered", which is what the LAST column
         (`colBy`, `g.registeredBy` + `g.firstSeenUtc`) actually says; the two
         were interchangeable-looking labels over two different facts, in a
         provenance table of all places. */
      colProvenance: 'Source',
      colFirstSeen: 'First seen',
      /* Never populated: `last_seen_utc` (migration 025) has no writer
         anywhere in sync-worker, cli or api — verified by repo-wide grep,
         21 Sep 2026. Every row therefore reads "—" here, correctly: this is
         not a bug, it is a column the system has not been built to keep
         yet. Said once, in the block's own note, rather than left for a
         column of bare dashes to be read as a fault. */
      colLastSeen: 'Last seen',
      colStatus: 'Status',
      colBy: 'Registered by',
      colRows: 'Rows held',
      open: 'open',
      closed: (when: string) => `closed ${when}`,
      /* UX overflow sweep (23 Sep 2026): this used to append `when` a second
         time — `g.firstSeenUtc`, the exact instant already printed one column
         over under "First seen" (both ARE the same fact per the comment
         above: first_seen_utc IS the registration instant). Printing it
         twice widened this column for no new information and was part of
         why the whole table needed a horizontal scrollbar at 1366px. The
         name alone is what "Registered by" asks; the "when" belongs to
         "First seen", not to a second, redundant cell. */
      registeredBy: (who: string) => who,
      provenanceLabel: (p: string) => (p === 'ifl_copy' ? 'IFL copy' : p === 'ifl_live' ? 'IFL live' : p === 'simulator' ? 'Simulator' : p),
      /* "First seen" is this row's REGISTRATION instant (first_seen_utc
         defaults to SYSUTCDATETIME() on insert — the epoch's own PK
         constraint DF_se_first, migration 025:38), not the timestamp of the
         earliest raw row this system observed under it. Honest about which
         one it is, rather than let the column name imply the latter. */
      firstSeenIsRegistration: 'first seen = when this generation was registered, not the earliest reading under it',
      lastSeenNeverRecorded: '"Last seen" is not yet written by any part of this system — it always reads "—", not a fault in this row.',
      /* The archived floor: the oldest day this system still holds a copy
         of, for a table whose earlier generations are no longer local —
         IFL keeps about a month of the plant's own copy (CLAUDE.md), so an
         old generation can be closed here and gone from the plant both. */
      archivedFloor: (day: string) => `Readings before ${day} are archived, not deleted — the sidecar database is the record of them, not IFL's source.`,
    } as const,

    /* sms.rebuild_audit — every canonical rebuild this system has run
       (a re-derivation of attribution/shift/classification over already-
       synced rows, not a re-fetch from IFL). */
    rebuildAudit: {
      title: 'Rebuilds',
      note: 'Every time this system’s own canonical figures were recomputed over already-synced readings — a shift-rule correction or a re-attribution, never a re-fetch from IFL.',
      none: 'No rebuild has been run.',
      colWhen: 'When',
      colReason: 'Reason',
      colBy: 'By',
      colRows: 'Rows affected',
    } as const,

    /* The LAST `sms verify` run — a manual, point-in-time reconciliation
       against IFL's OWN source, per source generation, to the checksum
       (CLAUDE.md: "sms verify reconciles per generation to the checksum").
       Named and worded apart from reconciliationTitle/reconciliationNote
       above on purpose: that block is a census of SMS's own data and never
       touches IFL's database at all; this one is the only place in the
       whole application that does, and only when a person runs the command. */
    lastVerify: {
      title: 'Last reconciliation against IFL’s source',
      none: 'sms verify has not been run against this copy.',
      ranAt: (when: string) => `Last run ${when}.`,
      against: (server: string, db: string) => `against ${server} / ${db}`,
      verdict: { ok: 'matched', mismatch: 'did not match', notRun: 'not yet run' } as const,
      /* This sentence is load-bearing: without it a reader could mistake a
         green "matched" verdict for an ongoing guarantee, when it is a
         photograph of one command run once. */
      isManual: 'This is the record of one manual run of the sms verify command — not a live or continuous check. This system holds no standing connection that watches IFL’s database for changes.',
    } as const,

    /* ---- RT24-05 (23 Sep 2026): PDAS write read-back verification. Appended
       here, one block, so this fix never has to reopen words.ts a second
       time — see api/src/services/pdasWrite.ts's raiseReadbackFailed and
       api/src/services/pdasPermissions.ts. The point of every sentence below
       is the project's own reliability rule: a fact this system could not
       check must say so in words, never render as though nothing is wrong. */
    pdasWriteTitle: 'PDAS write checking',
    pdasWriteOffTitle: 'PDAS writes: off',
    pdasWriteOff: 'This installation is not writing to PDAS. There is nothing to check.',
    pdasWriteOnTitle: 'PDAS writes: on',
    /* canReadBack === true: the writer login can read back every table it writes to. */
    checkedYes: 'Checked after writing: yes. Every write is read back from PDAS and any mismatch raises a finding immediately.',
    /* canReadBack === false: named tables the writer login cannot SELECT, so
       a write to them can never be verified — this is not the same as a
       failure, it is a standing gap in what this system can prove. */
    checkedNo: (tables: string) => `Checked after writing: no — the writer login cannot read ${tables}. Writes there are accepted by PDAS but this system cannot confirm what PDAS now holds.`,
    /* canReadBack === null: the permission probe itself could not run (writes
       just turned on, or the probe's own connection failed) — distinct from
       a confirmed "no", and must not collapse into one. */
    checkedUnknown: 'Checked after writing: could not be determined — the permission check itself did not complete. Treat this the same as "no" until it does.',
    missingExecuteNote: (procs: string) => `The writer login also cannot execute: ${procs}. Any write through one of those procedures will fail outright, not just go unverified.`,
    /* Per the fix decided 23 Sep 2026: a write whose follow-up read fails is
       still recorded as a successful write (PDAS accepted it) — only
       unverified, never wrongly called a failure or a proven mismatch. */
    unverifiedTablesTitle: 'Tables with unverified writes',
    unverifiedTablesNone: 'No table has had a write go unverified since this service started.',
    unverifiedTablesNote: (tables: string) => `${tables} — the first write to each since this service started could not be read back, and a standing finding has been raised for each on Setup › Sync health.`,
    lastVerified: (when: string) => `Last confirmed read-back ${when}.`,
    lastVerifiedNever: 'No write has been confirmed read back since this service started.',
  } as const,

  /* -------------------------------------------- cone weight (Phase 4) */
  /* Roadmap Phase 4 (14 Sep 2026). The five states are the ONE cone
     classification (shared/src/domain/classification.ts): the words here are
     the only words for them, on the register, the sheet, the report and the
     CSV alike. "Rejected by the scale" is the scale's own verdict, kept in
     its own words (REDESIGN rule 1); low/high are the product's tolerance,
     which is the second fact; "not judged" is honest for a reading with no
     product limits in force at its time or a weight the plausibility rule
     treats as a scale fault. Which judgement governs when the scale and the
     tolerance disagree is not yet confirmed by IFL — this is the developer's
     rule, stated as such where the two facts are printed together. */
  cone: {
    state: {
      within: 'Within limits',
      low: 'Under the limit',
      high: 'Over the limit',
      rejected: 'Rejected by the scale',
      unknown: 'Not judged',
    } as const,
    stateShort: {
      within: 'Within',
      low: 'Low',
      high: 'High',
      rejected: 'Rejected',
      unknown: 'Not judged',
    } as const,
    filterState: 'State',
    anyState: 'Any',
    colState: 'State',
    colProduct: 'Product',
    noProductOnRow: '—',
    /* The sheet's headline, one sentence for each state. `by` is
       "12 g under the lower limit" from the server's signed distance. */
    withinOf: (limits: string) => `Within the product's limits, ${limits}.`,
    lowHigh: (by: string, limits: string, scalePassed: boolean | null) =>
      scalePassed
        ? `${cap(by)}, ${limits} — passed by the scale. Which judgement governs is not yet confirmed by IFL.`
        : `${cap(by)}, ${limits}.`,
    rejectedInside: (limits: string) =>
      `Rejected by the scale; the weight sits inside the product's limits, ${limits}. Which judgement governs is not yet confirmed by IFL.`,
    rejectedOutside: (by: string, limits: string) => `Rejected by the scale; ${by}, ${limits}.`,
    notJudged: {
      no_limits: 'Not judged against a tolerance: no product limits were in force at this time.',
      implausible: (lo: string, hi: string) =>
        `Not judged: the weight is outside the plausibility window (${lo} to ${hi}), so it is treated as a scale fault rather than a light or heavy cone. The window is not yet confirmed by IFL.`,
      no_weight: 'Not judged: no weight was recorded.',
    },
    /* The count sentence when a state filter is on. */
    countLineState: (n: string, states: string) => `${n} cones ${states}.`,
    /* Line › What each machine is running. Anchored on the newest reading,
       never the clock: the plant writes a cone about a quarter of an hour
       after it is weighed. */
    /* OVERVIEW-SPEC.md §3.4/§7: this block now merges "what each machine is
       running" with the line-wide product record, so the label asks the
       single question both answers. Sole use is Line.tsx. */
    machinesTitle: 'What is being made',
    /**
     * THE AS-OF IS PART OF THE NOTE, NOT DECORATION (23 Sep 2026).
     *
     * `/api/machines/running` anchors its two-hour window on the newest
     * reading ON RECORD \u2014 never on the clock, for the acquisition-lag reason
     * above \u2014 and it does NOT take the selected period. Those are both
     * correct, and together they mean the window can sit hours, days or
     * weeks away from the period the rest of the screen is reporting.
     *
     * Reproduced on this sidecar: with the period on the current day, Line's
     * "Stations \u2014 cones this period" block showed all fourteen stations at 0
     * (true: the day holds no readings) while this block showed the same
     * fourteen running 34-51 cones each (also true: the two hours to
     * 22 Sep 12:29 PM, the newest reading, a day earlier). One screen, two
     * opposite-sounding statements about fourteen machines, and nothing on
     * either block named its own window.
     *
     * They measure different things and must stay different \u2014 making the
     * numbers agree would destroy the answer this block exists to give. So
     * the WINDOW IS NAMED instead, everywhere it is shown.
     */
    machinesNote: (n: number, when: string | null) => {
      const products = n === 1 ? '1 product running' : `${n} products running`;
      return when == null ? products : `${products} \u00b7 as of ${when}`;
    },
    machinesWindow: (when: string) =>
      `From each machine\u2019s newest cones, in the two hours ending ${when} \u2014 the newest reading on record. This window is anchored on that reading, not on the selected period, and does not move with it.`,
    /* Shown only when the as-of demonstrably falls outside the selected
       period, so the reader is never left to reconcile this block with the
       per-period counts above it by themselves. */
    machinesOutsidePeriod: (when: string, period: string) =>
      `These readings are from ${when}, outside the selected period (${period}). The per-station counts above cover the period; these do not.`,
    quietWindow: 'nothing in this window',
    since: (t: string) => `since ${t}`,
    sinceAtLeast: 'for at least 2 h',
    conesInWindow: (n: string) => `${n} cones`,
    noProductName: (id: number) => `Product ${id}`,
    noMaterial: 'no product on the reading',
    /* Weight › the station selector beside the chart. */
    stationSelect: 'Station',
    wholeLine: 'Whole line',
    excludedNote: (n: string, m: string) => `${n} readings, of which ${m} implausible excluded`,
    /* Setup › Rules › Product limits, and the Product sheet — ONE component
       (ProductLimitsBlock), rendered in both (roadmap Phase 4 item 2, 15 Sep
       2026: IFL wants limits editable from Setup; the write is rank 2, so
       Setup alone would hide it from every engineer account — finding H3's
       mistake, not to be repeated). */
    limitsSection: 'Product limits',
    limitsNote:
      'The versioned history this system judges every reading by — each reading by the limits in force at its own time. Changing a limit here records a NEW version; it never rewrites or removes an old one, and readings already recorded keep the limits that were in force when they were weighed.',
    limitsNoneYet: 'No limits recorded yet for this product.',
    limitsNoProducts: 'No products are known yet — the product master has not been mirrored.',
    colLimits: 'Limits',
    colEffective: 'In force from',
    colSource: 'Source',
    colBy: 'By',
    colReason: 'Reason',
    noLaterThan: 'no later than',
    noLaterThanNote:
      '\u201cNo later than\u201d marks a version first seen at that instant, not known to have started then: the oldest one is a lower bound.',
    source: { pdas_observed: 'seen in PDAS', sms_write: 'written by SMS to PDAS', sms_local: 'recorded in SMS' } as const,
    retired: 'retired',
    /* The local (non-PDAS) limits editor. */
    changeLimitsLocal: 'Change limits',
    changeLimitsLocalNote:
      'This records a new limits version in SMS. It does not change PDAS or the product master, and it does not rewrite any past version: readings already recorded keep the limits that were in force when they were weighed.',
    changeLimitsLocalUnavailable: 'Changing limits needs an engineer account.',
    localWasLabel: (from: string, to: string) => `${from} → ${to}`,
    localFirstRecorded: 'first recorded here',
    /* Report and Setup › Rules: the shift attribution check. */
    readingsSentence: (n: string, m: string) =>
      `${n} cone readings, of which ${m} implausible were excluded from the weight figures.`,
    shiftSentence: (n: string, m: string, hour: string | null) =>
      `SMS re-derives the shift from the weighing time; the plant\u2019s own column disagrees on ${n} of ${m} readings this period` +
      (hour ? `, mostly around ${hour}.` : '.'),
    shiftFormNote: (n: string, m: string, pct: string) =>
      `Over the last 7 days the plant\u2019s stored shift differs from the derived shift on ${n} of ${m} readings (${pct}). That is what the mode above would change.`,
    shiftFormNone: 'Over the last 7 days there are no readings to compare the plant\u2019s stored shift against.',
  } as const,

  /* ------------------------------------------- roadmap Phase 9: calibration */
  /* Calibration analytics (15 Sep 2026). The projection is a PROJECTION from
     recent readings under a stated assumption \u2014 never "prediction", never
     "AI" \u2014 and the assumption is printed beside the figure, not in Details,
     so the number cannot travel without it. */
  calibration: {
    /* Weight \u203a the figure row and the station table. */
    medianNote: (median: string) => `median ${median}`,
    colMedian: 'Median',
    colSd: 'SD',
    sdNote: 'within-day spread of this station\u2019s readings',
    /* The pattern rules, named. The labels come from the API's rule table. */
    patternOn: (rules: string) => `pattern: ${rules}`,
    flaggedDays: 'Days the pattern test fired',
    noFlaggedDays: 'The pattern test did not fire on any day in the window.',
    rulesRun:
      'The drift test runs the eight Nelson rules on this station\u2019s daily averages, measured from the centreline and the day-to-day sigma below.',
    cannotFire: (rules: string, points: number) =>
      `On a series of ${points} consecutive days ${rules} cannot complete, so their absence says nothing.`,
    allCanFire: (points: number) => `Every rule can complete on a series of ${points} consecutive days.`,
    centreline: (g: string, sigma: string) => `centreline ${g}, day-to-day sigma ${sigma}`,
    restartedOn: (day: string) => `restarted at the adjustment logged on ${day}`,
    notApproved: 'Which rules apply, and their use on daily averages, has not yet been confirmed by IFL.',
    /* The projection sentence. `rate` is "+0.8 g/day", `limitG` is "+40 g".
       The assumption is IN the sentence — "if it continues at that rate" —
       so it cannot be quoted without it. */
    projection: (rate: string, days: number, limitG: string, k: number) =>
      `At the current drift (${rate} over ${days} days) this station reaches the action limit (${limitG} from target) in about ${k} ${k === 1 ? 'day' : 'days'}, if it continues at that rate.`,
    /* RT-020 (25 Sep 2026): the range version of `projection`, used whenever
       the slope's 90% confidence interval is available (daysLow/daysHigh
       both non-null and not equal to a single day, i.e. not the "already
       past" case, which keeps using `projectionNow`). `lowK`/`highK` are the
       days-to-limit computed from the shallow and steep ends of the CI. */
    projectionRange: (rate: string, days: number, limitG: string, lowK: number, highK: number) =>
      lowK === highK
        ? `At the current drift (${rate} over ${days} days) this station reaches the action limit (${limitG} from target) in about ${lowK} ${lowK === 1 ? 'day' : 'days'} (90% range), if it continues at that rate.`
        : `At the current drift (${rate} over ${days} days) this station reaches the action limit (${limitG} from target) in about ${lowK}\u2013${highK} days (90% range), if it continues at that rate.`,
    projectionFar: (rate: string, days: number, limitG: string) =>
      `At the current drift (${rate} over ${days} days) this station would not reach the action limit (${limitG} from target) within 90 days, if it continues at that rate.`,
    projectionNow: (rate: string, days: number, limitG: string) =>
      `At the current drift (${rate} over ${days} days) this station is already past the action limit (${limitG} from target).`,
    projectionAway: (rate: string, days: number) =>
      `The daily average is moving back toward the target (${rate} over ${days} days).`,
    /* RT-020: printed instead of a day count when the slope's 90% CI
       includes zero (or disagrees in sign with the point estimate) \u2014 the
       drift itself is not established at that confidence, so no day count,
       range or otherwise, is stated. `reason` is the server's own sentence
       naming the interval and the point count. */
    projectionNotEstablished: (days: number, reason: string) =>
      `Drift not established from ${days} days. ${reason}`,
    projectionAssumption:
      'A projection from recent readings: a straight line through the run\u2019s daily averages, assumed to continue at the same rate, with a 90% confidence range on the rate itself. It is not a forecast of what the scale will do.',
    projectionNoLimits: 'No product limits were in force, so there is no action limit to project to.',
    /* RT-020: fewer than MIN_PROJECTION_POINTS (5) daily points \u2014 the run
       fired the pattern test but there is not enough data for even a point
       estimate, let alone an uncertainty range. */
    projectionTooFewPoints: (n: number, min: number) =>
      `Only ${n} day${n === 1 ? '' : 's'} in this run \u2014 at least ${min} are needed before a drift projection, with a confidence range, can be stated.`,
    gPerDay: (g: string) => `${g}/day`,
    /* The adjustment ledger form and list. */
    adjustedAt: 'Adjusted at (plant time)',
    note: 'Note',
    beforeG: 'Reference read before (g)',
    afterG: 'Reference read after (g)',
    referenceG: 'Reference weight (g)',
    productInForce: 'Product in force',
    productFromMachine: (name: string) => `${name} \u2014 from the machine\u2019s newest cones`,
    productQuiet: 'nothing on this machine in the last 2 h — left blank',
    productClear: 'clear',
    lineWide: 'whole line',
    colWhen: 'When',
    colAmount: 'Amount',
    colBeforeAfter: 'Before \u2192 after',
    colProduct: 'Product',
    colWhy: 'Why',
    allAdjustments: (n: number) =>
      n === 1
        ? '1 adjustment on record for this station, including line-wide ones.'
        : `${n} adjustments on record for this station, including line-wide ones.`,
    adjustedAtNote: 'Plant time. Stored as an app instant and converted with the offset the server reports, never the browser\u2019s.',
    /* Roadmap Phase 2b guided-navigation pass (16 Sep 2026, IA-PROPOSAL.md
       \u00a76.6 "a station \u2192 its drift and its adjustments" and the hops beside
       it) \u2014 the evidence in this sheet is one tap away, but the cones and
       rejects BEHIND it were not, and neither was this station's own place
       in a report. Every link carries this station and the sheet's period. */
    seeReadings: 'See this station\u2019s readings',
    seeRejects: 'See this station\u2019s rejects',
    seeCalibrationReport: 'See the calibration report',
    seeShiftReport: 'See this machine by shift',
  } as const,

  /* ------------------------------------ sacks and the stock ledger (Phase 7) */
  /* Roadmap Phase 7 (15 Sep 2026). One screen for the sack half of
     requirement 6 and the LINE-level half of requirement 7. The words obey
     three facts the data forces, and each is printed once as a footnote:
     a sack's time is when the plant wrote it, not when it was weighed; no
     sack is attributed to a machine because the source records none and
     this system will not infer one; the cone count around a sack is an
     approximation. What a "receipt" is, and which unit the ledger is kept
     in, are the developer's reading until IFL confirms \u2014 said where the
     ledger is shown, not hidden in a tooltip. */
  sacks: {
    question: 'How many sacks were weighed, how heavy, how many the scale passed \u2014 and what is in line stock.',
    headline: (period: string, sacks: string, kg: string, pct: string | null) =>
      `${period}: ${sacks} sacks weighed, ${kg} kg` + (pct ? `, ${pct} within the scale\u2019s range.` : '.'),
    headlineNone: (period: string) => `${period}: no sacks weighed.`,
    figSacks: 'sacks',
    figKg: 'kg',
    figInRange: 'within range',
    figConesPerSack: 'cones per sack',
    avgNote: (avg: string) => `${avg} average`,
    avgExcluded: (n: string) => `${n} implausible excluded from the average`,
    inRangeNote: (n: string, of: string) => `${n} of ${of} the scale passed`,
    noFlagNote: (n: string) => `${n} carry no verdict`,
    conesPerSackNote: 'approximate',
    unattributed: (n: string, of: string) => `${n} of ${of} sacks in this period carry no product.`,
    /* The by-shift and by-product tables. */
    byShift: 'By shift',
    byProduct: 'By product',
    colShift: 'Shift',
    colProduct: 'Product',
    colSacks: 'Sacks',
    colKg: 'kg',
    colAvg: 'Average',
    colInRange: 'Within range',
    noProduct: 'No product on the reading',
    /* The daily bar chart (UX chart-primitives pass, 23 Sep 2026): the
       screen's own question is answered by three numbers (how many, how
       heavy, how many passed) and the register below lists every sack, but
       nothing showed the day-to-day shape between them — this screen was
       measured at 0% chart pixel area against 7,400+ px of page. Drawn from
       the ledger's own `weighed` figures (never a new statistic), so it
       cannot pool across the 5 Aug source-generation boundary any more than
       the ledger table beside it already does. */
    weighedPerDay: 'Sacks weighed per day',
    weighedPerDayAria: 'Sacks weighed per day',
    weighedResting: (days: number, total: string, most: string, mostDay: string) =>
      `${days} ${days === 1 ? 'day' : 'days'} · ${total} sacks weighed · busiest ${most} on ${mostDay}`,
    /* UX charts pass 2 (23 Sep 2026). Three more marks, so this screen's own
       question is answerable without reading a table. Each is drawn from a
       figure an endpoint already returns. */
    avgPerDay: 'Average sack weight, each day against the period',
    avgPerDayAria: 'Average sack weight per day, as a difference from the period average',
    avgPerDayZero: (mean: string) => `period average ${mean}`,
    avgPerDayResting: (mean: string, worst: string) =>
      `Period average ${mean}. No day’s own average sits more than ${worst} from it. The axis is held at ±0.1 kg or wider, so a steady period draws flat.`,
    avgPerDayTooShort: 'Two production days or more are needed before a day can be compared to the period.',
    /* Named, not blanket (CLAUDE.md, "name which part failed"): every other
       figure on this screen comes from a different endpoint and is unaffected. */
    avgPerDayUnavailable: 'The per-day averages could not be read, so this chart is not drawn. Every other figure on this screen is unaffected.',
    byProductAria: 'Sacks weighed, by product',
    inRangeByProduct: 'Within the scale’s range, by product',
    inRangeByProductAria: 'Share of sacks the scale passed, by product, worst first',
    byShiftAria: 'Sacks weighed, by shift',
    namesNotDistinct:
      'The product master could not be read, so products that share a description are shown under the same name.',
    /* The ledger. */
    ledger: 'Stock ledger',
    ledgerNote: 'line stock, not per machine',
    unit: { sacks: 'Sacks', kg: 'kg' } as const,
    colDay: 'Day',
    colOpening: 'Opening',
    colReceipts: 'Receipts',
    colIssues: 'Issues',
    colConsumption: 'Consumption',
    colAdjustments: 'Adjustments',
    colClosing: 'Closing',
    colCount: 'Stock count',
    ledgerEmpty: 'No sacks and no movements in this period.',
    openingBefore: (n: string) => `${n} in stock before this period.`,
    closingNow: (n: string) => `${n} in stock at the end of it.`,
    kgIncomplete: (n: number) =>
      n === 1
        ? 'The kg column is short by one recorded movement that had no weight.'
        : `The kg column is short by ${n} recorded movements that had no weight.`,
    /* The three facts, as one footnote under the ledger. */
    ledgerCaveat:
      'Every sack weighed at the packing scale counts as a receipt into line stock; that reading of \u201creceipt\u201d, and whether the ledger is kept in sacks or kg, are not yet confirmed by IFL. ' +
      'Stock is for the line, not per machine: the plant\u2019s sack record carries no machine, the sack scale publishes none, and this system does not infer one from which cones were weighed around a sack. ' +
      'A sack\u2019s time is when the plant wrote the reading, which can trail the weighing.',
    perMachine: 'Per machine',
    perMachineNone: 'not available',
    /* Recording a movement (rank 3). */
    record: 'Record a movement',
    recordNote: 'A correction is a new row that says why; nothing recorded here is edited or deleted.',
    type: 'What happened',
    typeName: {
      opening: 'Stock count (opening)',
      receipt: 'Received',
      issue: 'Issued out',
      consumption: 'Consumed',
      adjustment: 'Correction',
    } as const,
    typeShort: {
      opening: 'Count',
      receipt: 'Receipt',
      issue: 'Issue',
      consumption: 'Consumption',
      adjustment: 'Correction',
    } as const,
    quantity: 'Sacks',
    quantityKg: 'kg (if known)',
    product: 'Product',
    anyProduct: 'Not stated',
    /* UX Phase 7 Brief 1: on a failed /api/products, the movement form's
       product dropdown used to silently offer only "Not stated" — a shorter
       list than the product actually running, with no sign anything failed.
       The form is still usable (a movement can genuinely have no product),
       so this is a note beside the field rather than a block on submission. */
    productListUnavailable: 'The product list could not be loaded — only "Not stated" is offered below.',
    when: 'When (plant time)',
    why: 'Why',
    save: 'Record',
    cancel: 'Cancel',
    saved: 'Recorded.',
    saveFailed: 'Could not record this movement.',
    /* The stock sheet: one day's movements. */
    sheetTitle: 'Stock movements',
    sheetEyebrow: (day: string) => `${day} \u00b7 production day`,
    sheetWeighed: (n: string, kg: string) => `${n} sacks weighed this day (${kg} kg) count as receipts.`,
    sheetWeighedNone: 'No sacks were weighed this day.',
    sheetEmpty: 'No movements were recorded by hand this day.',
    colTime: 'Time',
    colWhat: 'What',
    colWho: 'Recorded by',
    colRecorded: 'Recorded at',
    colWhy: 'Why',
    /* The sack history list under the ledger. */
    history: 'Sack history',
    historyNote: (n: string) => `${n} in this period, newest first`,
    /* WS-CN (23 Sep 2026): register.ts's countEvents/listEvents can now name
       a hole in its own pooled total (dataIssues[], field 'total') rather
       than silently letting a malformed tally row read as a genuine zero.
       Mirrors dqBlockingCouldNotLoad's phrasing — "not the same as none". */
    historyCountUnknown: 'The total for this period could not be confirmed — this is not the same as an empty period.',
  } as const,
  /* ---------------------------------------------------------------- reports */
  /* Roadmap Phase 8 (15 Sep 2026): the nine report types on one surface.
     Plain words; the definitions themselves live in KPI-DEFINITIONS.md and
     every figure is "awaiting IFL's approval" until they sign it. No
     question numbers on screen. */
  reports: {
    selectorLabel: 'Report',
    type: {
      daily: 'Daily',
      shift: 'Shift',
      product: 'Product',
      station: 'Machine / station',
      reject: 'Rejects',
      'cone-weight': 'Cone weight',
      sack: 'Sacks',
      calibration: 'Calibration',
      'management-summary': 'Management summary',
      'machine-product': 'Product by machine',
    } as const,
    /* The one-line question each report answers, under its title. */
    question: {
      daily: 'What did the line make each day of this period.',
      shift: 'What each shift made, day by day.',
      product: 'What was made of each product, and how it weighed.',
      station: 'What each station weighed, how it sat against the line, and what it rejected.',
      reject: 'Why cones were rejected, on which days, and whether it is getting worse.',
      'cone-weight': 'How the cones weighed: the mean, the median, the spread and the shape.',
      sack: 'How many sacks, how heavy, and what the stock ledger says.',
      calibration: 'Which stations drifted, and what was adjusted.',
      'management-summary': 'The figures that matter, beside the period before.',
      'machine-product': 'Which product ran on which machine, in which shift.',
    } as const,
    /* The print header. */
    generated: 'Generated',
    generatedBy: 'by',
    version: 'SMS',
    definitionsNote: 'Definitions: KPI-DEFINITIONS.md — awaiting IFL’s approval.',
    /* UX Phase 9: the register's Print button has no `disabled` gate, so a
       failed /api/reports/header must still leave a printed page with SOME
       statement of what it is — never silence, and never the viewer's own
       clock standing in for the plant's. This is that statement: it names
       the three facts the page cannot state, and leaves the ones it still
       can (line, title, period, filters) above it. */
    generatedUnavailable: 'This page could not read when it was generated, by whom, or from which SMS version.',
    printedSelectionNote: 'The line, period and filters above are the selection this page was printed from.',
    /* Filters. */
    filterShift: 'Shift',
    filterStation: 'Station',
    filterProduct: 'Product',
    all: 'All',
    notAccepted: (what: string) => `This report does not narrow by ${what}.`,
    /* UX Phase 7 Brief 1: the station and product filter chips vanished on a
       failed fetch exactly the way Readings' station chip did (same
       `list.length === 0` gate covering both "empty" and "could not load"),
       silently offering a report with fewer filters than it actually has
       rather than saying the list failed. */
    filterStationUnavailable: 'Station filter unavailable',
    filterProductUnavailable: 'Product filter unavailable',
    /* The two reject populations, named apart (the gap analysis found them one word). */
    rejectedByScale: 'Rejected by the scale',
    rejectedAtInspection: 'Rejected at inspection',
    /* The SACK counterpart of the cone in-range share, worded as the SCALE's
       own verdict (CLAUDE.md, ONE STATUS VOCABULARY). There is deliberately
       no "within tolerance" column beside it: IFL's sack table carries an
       inRange bit and no limits of any kind, so a tolerance figure for a
       sack would have to be invented. See production.ts
       `sacksPassedScalePct`. */
    colSacksPassedScale: 'Sacks passed by scale',
    ofConesWeighed: (p: string) => `${p} of cones weighed`,
    ofInspected: (p: string) => `${p} of cones plus rejects`,
    timeLostNotSplit: 'Time lost is not split by shift.',
    /* Shift report. */
    shiftSection: (name: string) => `${name} shift`,
    /* Product report. */
    unattributedSentence: (cones: string, ofCones: string, rejects: string, ofRejects: string) =>
      `${cones} of ${ofCones} cone readings and ${rejects} of ${ofRejects} rejects in this period predate product recording and carry no product.`,
    colProduct: 'Product',
    colWeighed: 'Weighed',
    colMean: 'Mean',
    colMedian: 'Median',
    colSpread: 'Spread',
    colInRange: 'In range',
    colWithin: 'Within',
    colLow: 'Low',
    colHigh: 'High',
    colRejected: 'Rejected',
    colNotJudged: 'Not judged',
    colExcluded: 'Excluded',
    /* Station report. */
    colStation: 'Station',
    colVsLine: 'vs line',
    colVsTarget: 'vs target',
    colDaysHeld: 'Days held',
    colFlagged: 'Flagged',
    colRejectRate: 'Reject rate',
    colLastAdjusted: 'Last adjusted',
    flaggedYes: 'yes',
    flaggedNo: '—',
    lineMean: (g: string) => `Line mean ${g}`,
    target: (g: string, label: string) => `target ${g} (${label})`,
    noTarget: 'no product target recorded',
    /* UX Phase 5 Brief 2 (16 Sep 2026): the cone-weight report's one target
       (U1) — printed with its product label and the instant it took effect,
       never a bare number, and never a fabricated one when nothing was in
       force. */
    targetNone: 'No product was in force at the end of this period.',
    targetSince: (instant: string) => `in force since ${instant}`,
    /* F6 (23 Sep 2026): the WEAKER claim, for a limits version the app merely
       observed already in place (`effectiveIsLowerBound`). The limits did
       apply; only their start is unproven, so the instant is a lower bound
       and must be printed as one. `targetSince` above states a start date and
       may only be used for a version that genuinely carries one. Product ›
       Catalogue already says "no later than" for the identical fact
       (`product.noLaterThan`); this is the same words in the sentence form
       the report/Weight captions need. */
    targetNoLaterThan: (instant: string) => `in force no later than ${instant}`,
    limitsChangedInPeriod: (n: number) =>
      n === 1
        ? 'The target’s limits changed once inside this period; this is the version in force at its end.'
        : `The target’s limits changed ${n} times inside this period; this is the version in force at its end.`,
    /* Product report (U3): each row's own target, never borrowed from another product or the line-wide mirror. */
    colTarget: 'Target',
    targetNoProduct: 'No product',
    targetNoLimits: 'No limits recorded',
    /* Management summary (U5): a KPI whose delta would measure a coverage
       gap, not a change in production, reads as an em dash with the reason
       printed — never a percentage. */
    notComparable: 'not comparable',
    incomparableNote: 'Why some figures above read “not comparable”:',
    productMix: 'Products run',
    productMixNone: 'No product recorded on these readings.',
    /* Reject report. */
    reasons: 'Reasons',
    byDayCode: 'By day and reason',
    trend: 'Daily rate with its control band',
    colDay: 'Day',
    colReason: 'Reason',
    colCount: 'Count',
    colShare: 'Share',
    colCones: 'Cones',
    colInspected: 'Inspected',
    colRate: 'Rate',
    colBand: 'Band',
    outOfControl: 'out of band',
    pBar: (p: string) => `Usual rate ${p}`,
    spansGenerations: 'The period spans a source rebuild; the band is the newest generation’s.',
    rejectUnattributed: (n: string, of: string) => `${n} of ${of} rejects in this period predate product recording.`,
    /* Cone weight report. */
    meanLabel: 'mean',
    medianLabel: 'median',
    spreadLabel: 'spread (SD)',
    minMax: (lo: string, hi: string) => `${lo} to ${hi}`,
    readingsExcluded: (n: string, m: string) => `${n} readings, of which ${m} implausible excluded`,
    states: 'By state',
    histogram: (g: number) => `Distribution, ${g} g buckets`,
    histogramKg: (kg: number) => `Distribution, ${kg} kg buckets`,
    /**
     * The x axis is linear in value, so a handful of far strays would leave
     * the body of the distribution a 55px spike on a 760px plot. The axis is
     * clipped to the body and those readings are NAMED here — never dropped,
     * and never left to a chevron on its own. They remain inside every
     * figure the report prints; only the axis is shorter.
     */
    histogramClipped: (
      nBelow: string | null, lowest: string | null,
      nAbove: string | null, highest: string | null,
      lo: string, hi: string,
    ) => {
      const parts: string[] = [];
      if (nBelow && lowest) parts.push(`${nBelow} below ${lo} (lowest bucket ${lowest})`);
      if (nAbove && highest) parts.push(`${nAbove} above ${hi} (highest bucket ${highest})`);
      return `Axis clipped to the body of the distribution: ${parts.join(' and ')}. Those readings are still counted in every figure on this report — only the axis is shorter.`;
    },
    byStation: 'By station',
    medianFromReport: 'The median is computed by the report over the same readings as the mean.',
    /* Sack report. */
    sacks: 'sacks',
    kg: 'kg',
    perSackApprox: 'cones per sack (approx.)',
    inRangeShare: (p: string) => `${p} in range by the scale`,
    sackRejected: (n: string) => `${n} rejected by the scale`,
    byProduct: 'By product',
    stock: 'Stock ledger',
    stockNotStarted: 'Stock ledger not started.',
    stockNotAvailable: 'Stock ledger not available yet.',
    stockColOpening: 'Opening',
    stockColReceipts: 'Receipts',
    stockColIssues: 'Issues',
    stockColConsumption: 'Consumption',
    stockColAdjustments: 'Adjustments',
    stockColClosing: 'Closing',
    stockBasis: 'Line-level stock; no sack is attributed to a machine.',
    /* Calibration report. */
    stationsFlagged: (n: number) => (n === 1 ? '1 station flagged for drift' : `${n} stations flagged for drift`),
    /* WS-OR (23 Sep 2026 red-team remediation, missingField.fuzz.test.tsx):
       `stationsFlagged(n)` was interpolated with no null guard, so a
       stripped `flaggedStationCount` on an otherwise-real 200 response made
       `n === 1` false and fell to the else branch, printing the literal
       string "undefined stations flagged for drift" — worse than a
       confident zero, since it does not even read as a plausible count.
       Reworded as a full sentence for this report's one-line summary, the
       same idiom `Weight.tsx`'s `countCouldNotRead` and `Line.tsx`'s
       `fig.couldNotRead` already use for "state the absence, never a
       number". */
    stationsFlaggedUnknown: 'How many stations are flagged for drift could not be read this period.',
    colDaysFlagged: 'Days flagged',
    colAdjustments: 'Adjustments',
    adjustments: 'Adjustments in the period',
    noAdjustments: 'No adjustments were logged in this period.',
    adjustmentsNotAvailable: 'Adjustment details not available yet.',
    colWhen: 'When',
    colAmount: 'Amount',
    colBefore: 'Before',
    colAfter: 'After',
    colReasonAdj: 'Reason',
    colBy: 'By',
    wholeLine: 'whole line',
    /* Management summary. */
    kpi: 'Figure',
    thisPeriod: 'This period',
    priorPeriod: 'Period before',
    change: 'Change',
    priorSpan: (from: string, to: string) => `compared with ${from} to ${to}`,
    priorCoverage: (withData: number | null | undefined, of: number | null | undefined) =>
      withData == null || of == null ? 'how many days there hold readings could not be read' : `${withData} of ${of} days there hold readings`,
    priorNoData: 'The period before holds no readings, so there is nothing to compare with.',
    betterHigher: 'higher is better',
    betterLower: 'lower is better',
    betterNeither: '',
    approval: 'awaiting IFL’s approval',
    /* Product by machine and shift — the tenth type (15 Sep 2026). */
    colMachine: 'Machine',
    colFrom: 'From',
    colTo: 'To',
    colFirst: 'First reading',
    colLast: 'Last reading',
    colMachinesCount: 'Machines',
    machineProductSummary: (machines: string, products: string) => `${machines} machines, ${products} products this period.`,
    conesWithoutStation: (n: string) => `${n} cones carry no machine and are not on this matrix.`,
    changeovers: 'Changeovers',
    noChangeovers: 'No changeovers were read in this period.',
    /* UX Phase 9 Brief D (21 Sep 2026) suppressed this matrix from print
       entirely — over 100 columns on a month-long range, a structural limit
       no type size or orientation fixes on one sheet. Owner overruled the
       suppression 22 Sep 2026 ("print the machine product as well"): it now
       paginates instead (MachineProduct.tsx, `MACHINE_PRODUCT_COLS_PER_PAGE`),
       tiling the columns across as many A4-landscape sheets as it takes, the
       row-label column repeated on every page. This string names the span so
       a reader mid-stack knows where they are; it replaces the old blanket
       "too wide" message, which is now unused (removed, grep-verified). */
    machineProductPageSpan: (fromCol: string, toCol: string, total: string, page: string, pages: string) =>
      `Columns ${fromCol}–${toCol} of ${total} · page ${page} of ${pages}`,
    /* Errors. */
    notAllowed: 'This report is for managers and above.',
  } as const,
  /* Per-machine state (Line/Product-Running/Wall), added 24 Sep 2026,
     Task #8 — `machinesRunning.ts`'s new `state`/`lastSeenUtc` fields.
     Appended, not interleaved: this file is append-only for concurrent
     workers. */
  machineState: {
    running: 'Running',
    quiet: (span: string, lastSeen: string) => `No cones for ${span} (last ${lastSeen})`,
    stale: (lastSeen: string) => `Not seen since ${lastSeen}`,
    silent: 'Not seen for over a week — check the machine or its scale',
    /** Product › Running's new section heading for the machines
     *  `groupByProduct` does not list (no cone in the current window). */
    notRunning: 'Not currently running',
  } as const,
  /* RT-014 (ENGINEERING-RED-TEAM-AUDIT-2026-09-24.md): the API now caps
     oversized results server-side and answers 413 {error, limit, hint}
     instead of letting an unbounded query run. `Failed` (ui/bits.tsx) shows
     this instead of the generic "could not load" sentence when the status
     is 413, so a genuinely huge query reads as "narrow your request", not
     as a fault with the plant connection. Appended, not interleaved: this
     file is append-only for concurrent workers. */
  errorDisplay: {
    tooMuchData: 'Too much data for one view — choose a shorter period or filter.',
  } as const,
} as const;

export type Words = typeof W;
