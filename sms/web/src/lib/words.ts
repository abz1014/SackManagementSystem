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

export const W = {
  /* ------------------------------------------------------------- the shell */
  brand: 'SMS',
  nav: {
    line: 'Line',
    readings: 'Readings',
    weight: 'Weight',
    rejects: 'Rejects',
    report: 'Report',
  } as const,
  wall: 'Wall',
  setup: 'Setup',
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
    idle: (since: string) => `has had no readings since ${since}`,
    unknown: 'Cannot tell whether the line is running',
    intoShift: (span: string, shift: string, from: string, to: string) =>
      `${span} into the ${shift}, ${from}${nbsp}to${nbsp}${to}`,
    shiftOf: (shift: string, from: string, to: string) => `${shift}, ${from} to ${to}`,
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

  /* ------------------------------------------------------------- attention */
  attention: 'Attention',
  nothingNeedsAttention: 'Nothing needs attention.',
  andMore: (n: number, where: string) => `and ${n} more — see ${where}`,

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
    limits: 'limits',
    since: 'since',
    setBy: 'set by',
    change: 'Change',
    history: 'History',
    none: 'No product has been recorded for this line yet.',
    inactive: 'This product is marked inactive in the product master.',
    previewLimits: (limits: string) => `New limits would be ${limits}.`,
    confirm: 'Record this product',
    cancel: 'Cancel',
    reason: 'Why (optional)',
  } as const,

  /* -------------------------------------------------------------- stations */
  stations: 'Stations',
  stationsNote: 'cones this period',
  station: (n: number) => `Station ${n}`,
  quiet: 'quiet',
  quietFor: (span: string, n: number) => `Station ${n} has been quiet for ${span}`,
  lastReadings: 'Last readings',
  lastSack: 'Last sack',
  lastCone: 'Last cone',

  /* -------------------------------------------------------------- readings */
  readings: {
    cones: 'Cones',
    sacks: 'Sacks',
    rejectedCones: 'Rejected cones',
    countLine: (n: string, rejected: string, pct: string) =>
      `${n} weighed, ${rejected} rejected by the scale (${pct}).`,
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
    weighed: 'Weighed',
    provenance: 'Provenance',
    provenanceNote: 'Where this reading came from and when it arrived.',
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
    stationsNeedLook: (n: number) => (n === 1 ? 'One station needs a look.' : `${n} stations need a look.`),
    allStationsSteady: 'Every station is steady.',
    above: 'above',
    below: 'below',
    spread: (lo: string, hi: string) => `${lo} to ${hi}`,
    spreadNote: '95 of every 100 cones fall in this range',
    overTime: 'Over time',
    distribution: 'Distribution',
    stationsTable: 'Stations',
    sortNote: 'flagged first, then by distance from target',
    colStation: 'Station',
    colAverage: 'Average',
    colVsLine: 'vs line',
    colVsTarget: 'vs target',
    colPattern: 'Pattern',
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
    adjustedSince: (span: string, who: string) => `Adjusted ${span} ago by ${who}, steady since.`,
    highestRejects: 'Highest reject rate on the line, mostly quality codes — look at tubes before scales.',
    andMoreSteady: (n: number) => `and ${n} more stations, all steady`,
    logAdjustment: 'Log an adjustment',
    adjustmentLog: 'Adjustment log',
    adjustmentsIn: (n: number, days: number) =>
      `${n} ${n === 1 ? 'adjustment' : 'adjustments'} in the last ${days} days.`,
    adjustmentResets: "A logged adjustment restarts that station's pattern from that moment.",
    adjustAmount: 'Amount (grams, signed)',
    adjustWhen: 'When',
    adjustWhy: 'Why',
    save: 'Save',
    noTarget: 'No product target',
  } as const,

  /* --------------------------------------------------------------- rejects */
  rejects: {
    headline: (n: string, pct: string, quality: number, weight: number) =>
      `${n} cones rejected, ${pct} of everything weighed — ${quality} for quality, ${weight} for weight`,
    steady: 'steady',
    risingSince: (when: string, kind: string) => `${kind} rejects have been rising since ${when}`,
    topReason: 'the top reason',
    notYetNamed: 'not yet named',
    codeUnnamed: (code: string) => `Code ${code} — not yet named`,
    noCode: 'No code recorded',
    trendTitle: (days: number) => `Reject rate over the last ${days} days · this period shaded`,
    usualRange: 'usual range',
    quality: 'quality',
    weightKind: 'weight',
    reasonsTitle: (days: number) => `Reasons, last ${days} days`,
    /* IFL has not supplied the meaning of the inspection codes. Until they do
       the list must not present a raw code pair as if it were a reason. */
    namesAwaited: 'Reason names have not been supplied yet. A manager can name a code here; the name applies to history.',
    nameIt: 'Name it',
    seeTheCones: 'See the rejected cones themselves',
    seeTheConesNote: 'opens Readings with the Rejected toggle and this period',
    byStation: 'By station',
    byStationNote: 'opens the Weight station table sorted by reject rate',
    perDay: 'Rejects per day',
    none: 'No cones were rejected in this period.',
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
    noSackStock:
      "Sack stock per machine is not shown: the plant's sack records carry no machine and no record of a sack leaving. IFL has been asked how sacks are linked to machines and how they leave stock.",
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
    printedAt: 'Printed',
    printedBy: 'by',
  } as const,

  /* ------------------------------------------------------------------ setup */
  setupTabs: {
    people: 'People',
    stations: 'Stations',
    rules: 'Rules',
    sync: 'Sync health',
    audit: 'Audit log',
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
    none: 'None',
  } as const,

  /* ------------------------------------------------------------- the sheet */
  close: 'Close',
  esc: 'Esc',

  /* --------------------------------------------------------- shared chrome */
  working: 'Show the working',
  details: 'Details',
  loading: 'Loading…',
  couldNotLoad: 'Could not load this. The plant connection may be down.',
  retry: 'Try again',
  nothingHere: 'Nothing recorded in this period.',
  replay: 'REPLAY — showing the plant as it was at',
  replayNote: 'This is not live.',
  offline: 'Could not reach the server — showing the last numbers received.',
  ago: 'ago',
  of: 'of',
  and: 'and',
} as const;

export type Words = typeof W;
