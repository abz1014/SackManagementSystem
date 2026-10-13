/*
 * Copy table for the redesign (design/redesign-2026-10/GLOSSARY.md, 13 Oct 2026).
 *
 *  - `C`        the new strings the redesign introduces. Plain words, sentence case,
 *               no pipeline vocabulary (GLOSSARY 1.7), no bare "rejected" (1.3).
 *  - `RESERVED` owner-reserved wording (GLOSSARY section 3.6 and rows 87, 88, 104,
 *               109). Re-exported BY REFERENCE to the live words.ts values, never
 *               copied, so the owner's pick (A keep / B proposal) is made in one place
 *               and an agent cannot change it here.
 *
 * Reserved rows with no words.ts key (docs-only, no UI string):
 *   row 165  DECISIONS-PENDING 14.5.1, the "about 3.8 hours" insert-lag wording
 *   row 166  DECISIONS-PENDING 14.5.2, PDAS write-path wording in CLAUDE.md and .env
 * Rows that share a key: row 141 is W.config.rules.basis; row 153 is the
 * W.reports.stockCol* set; row 164 is a family of four sentences (iflNotSaid).
 */
import { W } from './bridge/words';
import { stationLabel } from './bridge/api';

export const C = {
  /* Navigation (GLOSSARY 3.1, rows 1-10) */
  nav: {
    today: 'Today',
    quality: 'Quality',
    products: 'Products & PDAS',
    reports: 'Reports',
    system: 'System',
  },
  /* Keys match route.ts TABS 1:1 (APPROVAL / TRACE E-2). `history` is only a legacy alias of `limits`. */
  tabs: {
    quality: { weight: 'Weight', rejects: 'Rejects', stations: 'Stations', register: 'Register' },
    products: {
      board: 'Board',
      changeover: 'Changeover',
      catalogue: 'Catalogue',
      limits: 'Limits & History',
      history: 'Limits & History',
    },
    system: { diagnostics: 'Diagnostics', setup: 'Setup', account: 'Account' },
  },
  signOut: 'Sign out',
  plantTime: 'Plant time',

  /* The four state words (GLOSSARY 1.5). Colour is never the only cue. */
  state: {
    ok: 'OK',
    watch: 'Watch',
    act: 'Act',
    noData: 'No data',
  },

  /* Check vocabulary (GLOSSARY 1.3, rows 39-45). Always shown with a denominator. */
  checks: {
    passedWeight: 'Passed weight check',
    failedWeight: 'Failed weight check (scale)',
    failedInspection: 'Failed inspection',
    outsideLimits: 'Outside product limits (scale passed)',
    withinLimits: 'Within product limits',
    notChecked: 'Not checked (no product set)',
    /** "Failed weight check (scale): 123 of 8,402 cones weighed (1.5%)" */
    failedWeightOf: (n: string, total: string, pct: string) =>
      `Failed weight check (scale): ${n} of ${total} cones weighed (${pct})`,
    /** "Failed inspection: 87 of 8,402 cones weighed (1.0%)" */
    failedInspectionOf: (n: string, total: string, pct: string) =>
      `Failed inspection: ${n} of ${total} cones weighed (${pct})`,
  },

  /* Stations: "Station N" is the primary label (GLOSSARY 1.2). */
  station: (n: number) => `Station ${n}`,
  /** Decision E-9: "Station N · <name>", the existing name string verbatim. */
  stationWithName: (n: number, name: string) => `Station ${n} · ${name}`,
  noCones: 'No cones',
  noConesFor: (n: number, span: string) => `Station ${n}: no cones for ${span}`,

  /* Dates and clocks (GLOSSARY 1.4). Use formatDate / formatClock below. */
  dateNote: 'Dates read 1 Sep 2026. Times use the 24-hour clock, 14:30.',
  productionDay: (calendar: string, day: string) => `${calendar} - production day ${day}`,
  period: (from: string, to: string) => `${from} to ${to}`,
  shiftPeriod: (shift: string, date: string, from: string, to: string) =>
    `${shift}, ${date}, ${from} to ${to}`,

  /* Data age and empty / error phrasing (GLOSSARY 3.2, rows 25-38) */
  dataTo: (t: string) => `Data to ${t}.`,
  dataToWithLag: (t: string, lag: string) => `Data to ${t}. It arrives about ${lag} after weighing.`,
  noDataSince: (t: string) => `No data since ${t}. Check the plant connection.`,
  noDataYet: 'No data received yet.',
  lineStatusUnknown: (t: string) => `Line status unknown: no data since ${t}.`,
  nothingInPeriod: (newest: string) => `Nothing in this period. Newest data: ${newest}.`,
  nothingInPeriodNoNewest: 'Nothing in this period.',
  couldntLoad: (part: string) => `Couldn't load ${part}.`,
  couldntLoadCheck: (part: string) => `Couldn't load ${part}. Check the plant connection.`,
  tryAgain: 'Try again',
  stationListIncomplete: 'The station list did not fully load. A station may be missing.',
  attention: 'Needs attention',
  nothingNeedsAttention: 'Nothing needs attention.',

  /* Pre-rebuild data, said in effect words (GLOSSARY 1.7) */
  beforeRebuild: (date: string) => `Readings before ${date} are not counted (IFL rebuilt its database).`,

  /* Thresholds are written beside the state (GLOSSARY 1.5) */
  threshold: (state: string, rule: string) => `${state}: ${rule}`,

  /* Disclosure that holds the pipeline detail */
  howCalculated: 'How this is calculated',

  /* ---- Shell (was ui/shellCopy.ts) ---- */
  shell: {
    appName: 'SMS',
    groups: { monitor: 'Monitor', operate: 'Operate', analyse: 'Analyse', system: 'System' },
    more: 'More',
    register: 'Register',
    account: 'Account',
    mainNav: 'Main navigation',
    phoneNav: 'Screens',
    skip: 'Skip to content',
    collapse: 'Collapse sidebar',
    expand: 'Expand sidebar',
    userMenu: 'Account menu',
    signedInAs: (name: string, role: string) => `${name}, ${role}`,
    signOutFailed: "Couldn't sign out. Try again.",
    pageFailed: 'This page',
    closeMenu: 'Close',
    health: {
      title: 'Data status',
      ok: 'Data current',
      late: 'Data late',
      lagUnknown: 'Delay unknown',
      stale: 'Data out of date',
      none: 'No data',
      unknown: 'Status unknown',
      unknownSentence: "Couldn't read the data status. Check the plant connection.",
      open: 'Open diagnostics',
    },
  },

  /* ---- App frame: sign-in, placeholders, banners ---- */
  login: {
    title: 'Sign in',
    subtitle: 'Sack management system',
    username: 'Username',
    password: 'Password',
    submit: 'Sign in',
    busy: 'Signing in',
    mismatch: 'That username and password did not match.',
    tooMany: (mins: number) => `Too many attempts. Try again in ${mins} ${mins === 1 ? 'minute' : 'minutes'}.`,
  },
  app: {
    checking: 'Checking your sign-in',
    wallTitle: 'Wall display',
    leaveReplay: 'Leave replay',
    placeholder: 'This screen is being rebuilt.',
    placeholderSheet: 'This detail view is being rebuilt.',
    openCurrent: 'Open it in the current app',
  },

  /* ---- General components (was ui/strings.ts) ---- */
  ui: {
    showDate: (date: string) => `Show ${date}`,
    showingRange: (a: number, b: number, total?: number) =>
      total === undefined ? `Showing ${a}–${b}` : `Showing ${a}–${b} of ${total.toLocaleString('en-GB')}`,
    loadMore: 'Load more',
    loadingMore: 'Loading',
    scrollForMore: 'Scroll for more',
    showAll: 'Show all',
    close: 'Close',
    remove: (label: string) => `Remove ${label}`,
    takingTooLong: (part: string) => `${part} is taking too long to load.`,
    serverSilent: 'The server did not answer.',
    checkDiagnostics: 'Check diagnostics',
    aboutFigures: 'About these figures',
    dismiss: 'Dismiss',
  },

  /* ---- Station tiles, heat grid, KPI card (were local constants) ---- */
  stationUi: {
    failedInspection: 'Failed inspection',
    cones: (n: number) => `${n.toLocaleString('en-GB')} cones`,
    noProduct: 'No product',
    vsTarget: (g: number) => `${g > 0 ? '+' : g < 0 ? '-' : ''}${Math.abs(g)} g vs target`,
    worstFirst: 'Worst first',
    byNumber: 'By station number',
    stations: 'Stations',
  },

  /* ---- Chart kit (was charts/chartCopy.ts) ---- */
  chart: {
    showAsTable: 'Show as table',
    showAsChart: 'Show as chart',
    inLimits: 'In limits',
    upperLimit: (v: string) => `Upper limit ${v}`,
    lowerLimit: (v: string) => `Lower limit ${v}`,
    cumulative: 'Cumulative share',
    cumulativeAxis: 'Cumulative share (%)',
    vitalFew: (k: number, total: number) =>
      k === 1 ? `1 of ${total} reasons makes up most of the rejects.` : `${k} of ${total} reasons make up most of the rejects.`,
    binWidth: (w: string, unit: string) => `Each bar is ${w}${unit ? ` ${unit}` : ''} wide.`,
    loading: 'Loading',
    tableCaption: (title: string) => `${title}, as a table`,
    noValue: 'No value',
    outside: 'Outside limits',
    zoomedBack: W.chart.zoomedBack,
  },

  /* ---- Period control (was ui/period/strings.ts) ---- */
  periodUi: {
    title: 'Period',
    plantTime: 'Plant time, 24 hours',
    chipLabel: (sentence: string) => `Period: ${sentence}. Change period`,
    loading: 'Loading period',
    clockUnread: 'The plant clock could not be read, so relative periods are unavailable.',
    unavailable: 'Period unavailable',
    quick: 'Quick periods',
    presets: {
      shift: 'This shift',
      today: 'Today',
      yesterday: 'Yesterday',
      week: 'This week',
      lastWeek: 'Last week',
      month: 'This month',
      lastMonth: 'Last month',
    },
    custom: 'Pick dates and shifts',
    fromDate: 'From date',
    fromShift: 'From shift',
    toDate: 'To date',
    toShift: 'To shift',
    shifts: { whole: 'Whole day', morning: 'Morning 06-14', evening: 'Evening 14-22', night: 'Night 22-06' },
    dayRule: 'A production day runs 06:00 to 06:00.',
    needStart: 'Enter a start date',
    needEnd: 'Enter an end date',
    endBeforeStart: 'End is before start',
    shows: (s: string) => `Shows ${s}`,
    compare: 'Compare',
    compareOff: 'Off',
    newestData: (date: string) => `Newest data: ${date}`,
    goNewest: 'Go to newest',
    cancel: 'Cancel',
    apply: 'Apply',
  },

  /* ---- Write controls (was ui/writeStrings.ts) ---- */
  write: {
    stepsLabel: 'Steps',
    back: 'Back',
    next: 'Next',
    cancel: 'Cancel',
    stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
    reasonCount: (n: number, min: number) => `${n} of ${min} characters minimum`,
    reasonOk: (n: number) => `${n} characters`,
  },

  /* ---- Today screen (folded in from the screen's own strings file) ---- */
  today: {
    answers: 'Is the line running, what has it made, and does anything need attention?',

    band: {
      nothing: 'Nothing has been recorded in this period.',
      ranAll: 'Line ran all three shifts.',
      ranShifts: (k: number, n: number) => `Line ran ${k} of ${n} shifts.`,
      ranShift: 'Line ran in this shift.',
      ranDays: (k: number, n: number) => `Line ran on ${k} of ${n} production days.`,
      running: (line: string) => `${line} is running.`,
      needAction: (n: number) => (n === 1 ? '1 station needs action' : `${n} stations need action`),
      toWatch: (n: number) => `${n} to watch`,
      watchOnly: (n: number) => (n === 1 ? '1 station to watch' : `${n} stations to watch`),
      noneNeedAction: 'No station needs action.',
      comparisonMissing: "The comparison period didn't load, so no changes are shown.",
      updatedLive: 'This period is still running. Counts grow until it ends.',
    },

    kpi: {
      cones: 'Cones',
      sacks: 'Sacks',
      packed: 'Packed',
      coneCount: (n: string) => `${n} cones`,
      ofCones: (n: string, total: string) => `${n} of ${total} cones`,
      couldNotRead: 'Could not be read',
      points: (v: string) => `${v} points`,
      pointsMoved: (v: string, way: 'lower' | 'higher') => `${v} points ${way}`,
    },

    links: {
      label: 'Open the readings behind these figures',
      cones: 'Cones',
      sacks: 'Sack list',
      failedInspection: 'Failed inspections',
      outsideLimits: (n: string | null) => (n === null ? 'Outside product limits (scale passed)' : `Outside product limits (scale passed): ${n}`),
    },

    stations: {
      title: 'Stations, worst first',
      caption: (period: string) => `Percent of cones that failed inspection, ${period}.`,
      noCones: (list: string, period: string) => `${list} recorded no cones in ${period}.`,
      stationsWord: (n: number) => (n === 1 ? 'Station' : 'Stations'),
      none: 'No stations reported in this period.',
    },

    productChange: {
      changed: (station: string, product: string | null) =>
        product ? `${station} changed product to ${product}.` : `${station} changed product.`,
      firstCone: (when: string) => `Its first cone of the new product was at ${when}.`,
      others: (n: number) => (n === 1 ? '1 other station also changed product.' : `${n} other stations also changed product.`),
      link: 'See products by station',
    },

    shifts: {
      title: (spread: 'day' | 'shift') => (spread === 'day' ? 'Cones per day' : 'Cones per shift'),
      series: 'Cones',
      caption: (period: string, total: string, sacks: string | null) =>
        `Plant time, ${period}. Total ${total} cones.${sacks ? ` ${sacks}` : ''}`,
      sacksBy: (parts: string) => `Sacks packed: ${parts}.`,
      onePoint: (spread: 'day' | 'shift') =>
        spread === 'day' ? 'Only one production day has cones, so there is no shape to draw.' : 'Only one shift has cones, so there is no shape to draw.',
    },

    reasons: {
      title: 'Failed inspection by reason',
      caption: (period: string, total: string) => `${period}. ${total} cones in total.`,
      unnamed: (tube: number | null, mat: number | null) => `Code ${tube ?? '?'}/${mat ?? '?'} (not named yet)`,
      none: 'No cones failed inspection in this period.',
    },

    attention: {
      caption: (days: number, from: string, to: string) => `Last ${days} production days (${from} to ${to}). The period above does not change this list.`,
      tooFew: (days: number) => `Only ${days} production days are on record, too few for the drift test to say anything.`,
      more: (n: number) => (n === 1 ? '1 more finding on Quality.' : `${n} more findings on Quality.`),
      openQuality: 'Open the Quality screen',
      driftUnreadable: (station: string) => `${station} has drifted from the line, but the size could not be read.`,
      rejectRise: (kind: string, since: string, rate: string, usual: string) =>
        `${kind} has been rising since ${since}: ${rate} against a usual ${usual}.`,
      failedInspectionKind: 'Failed inspection',
      failedWeightKind: 'Failed weight check (scale)',
    },

    latest: {
      title: 'Latest readings',
      cone: 'Latest cone',
      sack: 'Latest sack',
      failed: 'Latest failed inspection',
      coneText: (g: string, verdict: string, station: string, when: string) => `${g} · ${verdict} · ${station} · ${when}`,
      sackText: (kg: string, verdict: string, when: string) => `${kg} · ${verdict} · ${when}`,
      failedText: (station: string, when: string) => `${station} · ${when}`,
      failedHop: 'See failed inspections',
      none: 'No readings yet.',
      unknownStation: 'Station not recorded',
    },

    sacks: {
      title: 'Sacks',
      unitLabel: 'Show sacks as',
      unitSacks: 'Sacks',
      perDay: (unit: 'sacks' | 'kg') => (unit === 'kg' ? 'Packed per day (kg)' : 'Sacks per day'),
      perShift: (unit: 'sacks' | 'kg') => (unit === 'kg' ? 'Packed per shift (kg)' : 'Sacks per shift'),
      byProduct: 'Sacks by product',
      colShift: 'Shift',
      colProduct: 'Product',
      colSacks: 'Sacks',
      colKg: 'Packed, kg',
      colAvg: 'Average, kg',
      colPassed: 'Passed weight check',
      average: 'Average sack',
      passedScale: 'Passed weight check (scale)',
      conesPerSack: 'Cones per sack (approximate)',
      none: 'No sacks were packed in this period.',
      namesNotDistinct: "Product names didn't load, so products with the same name can't be told apart.",
      noProduct: 'No product recorded',
      unattributed: (n: string, of: string) => `${n} of ${of} sacks carry no product.`,
      list: 'Sack list',
      stock: 'Sack stock',
      weights: 'Sack weights',
    },

    empty: {
      lineMayBeStopped: (age: string) =>
        `The line may be stopped or data is delayed. The newest reading is ${age} old.`,
      openDiagnostics: 'Open the Diagnostics tab',
      noReadings: 'No readings in this period',
    },

    states: {
      title: 'How states are decided',
      rule: (act: string, watch: string, actPct: string | null, watchPct: string | null, period: string) =>
        `Act: a station's failed-inspection rate is more than ${act} times the line's rate${actPct ? ` (over ${actPct} on ${period})` : ''}. Watch: more than ${watch} times${watchPct ? ` (over ${watchPct})` : ''}. A station with no cones in the period shows No data, never OK.`,
      minCones: (n: number) => `A station with fewer than ${n} cones is not judged.`,
    },

    about: {
      countedOnce: 'Cones that failed inspection and cones the scale marked out of range are counted separately, and each cone once.',
      productStamped: "A station's product is the last product it stamped on a cone, not a setting read from the station itself.",
      lookback: 'Where no product change was found in the look-back window, a product is described as running since at least its first cone in that window, never as a start time.',
      plantTimes: 'Times are plant time.',
      notLoaded: (parts: string) => `Not loaded at the moment: ${parts}. The figures above that did load are unaffected.`,
      detectors: (days: number | null, g: string | null, held: number | null) =>
        `Needs attention is judged over the last ${days ?? 'few'} production days, not the selected period, because the station tests need consecutive days. A station is named when it has held one side of the line by at least ${g ?? 'the drift limit'} for ${held ?? 'several'} days or more.`,
      lag: (lag: string, stop: string) =>
        `The line is judged against the newest reading rather than the clock, because the plant writes a cone's row about ${lag} after it is weighed. It reads as stopped once that gap exceeds ${stop}.`,
    },
  },

  /* ---- TV wall (folded in from the screen's own strings file) ---- */
  wall: {
    exit: 'Exit wall',
    updated: 'Updated',
    notUpdatingSince: (clock: string) => `Not updating since ${clock}`,
    notUpdating: 'Not updating',
    stationsAction: (n: number) => `${n} ${n === 1 ? 'station needs' : 'stations need'} action`,
    stationsWatch: (n: number) => `${n} to watch`,
    allStationsOk: 'No station needs action.',
    kpi: { cones: 'Cones', sacks: 'Sacks', packed: 'Packed', failed: 'Failed inspection' },
    unreadable: 'Not available',
    shiftBars: 'Cones by shift',
    quietSince: (clock: string) => `No cones since ${clock}`,
    silentSince: (clock: string) => `No readings since ${clock}`,
    lastProduct: 'No product',
    couldntRead: (part: string) => `Could not read ${part}.`,
    waiting: 'Waiting for the first reading',
    boardIncomplete: 'Part of this board could not be read.',
    loading: 'Loading',
    periodLabel: 'Period',
  },

  /* ---- Quality > Stations and the station sheet (folded in from the screen's own strings file) ---- */
  qualityStations: {
    title: 'Stations',
    noneNeedAction: 'No station needs action.',
    needAction: (n: number) => (n === 1 ? '1 station needs action.' : `${n} stations need action.`),
    /** "Each one's failed-inspection rate is more than twice the line's 4.59 %." */
    actRule: (multiple: number, linePct: string) =>
      `Each one's failed-inspection rate is more than ${multiple === 2 ? 'twice' : `${multiple} times`} the line's ${linePct}.`,
    periodCaption: (span: string, days: number) => `${span}, ${days} production ${days === 1 ? 'day' : 'days'} (06:00 to 06:00 plant time)`,
    tableTitle: 'Stations, worst first',
    tableCaption: (n: number, cones: string, linePct: string) => `${n} stations · ${cones} cones · line failed-inspection rate ${linePct}`,
    tableAria: 'Stations, worst first',
    thisPeriod: (span: string) => `This period · ${span}`,
    patternHead: (span: string) => `Pattern check · always the last 14 production days (${span})`,
    patternHeadShort: 'Pattern check · always the last 14 production days',
    colStation: 'Station and product',
    colState: 'State',
    colCones: 'Cones',
    colFailedInspection: 'Failed inspection',
    colFailedWeight: 'Failed weight check (scale)',
    colVsTarget: 'Mean weight vs target',
    colDaysNote: 'Days with a note',
    colResult: 'Result',
    conesSub: (n: string) => `${n} cones`,
    nothingFlagged: 'Nothing flagged',
    noProduct: 'No product',
    noData: 'No data',
    stationsMissingFromFeed: (list: string) =>
      `${list} did not appear in the weight-by-station feed, so their weight figures show No data.`,
    failedWeightNote: 'Failed weight check is the share of cones the scale itself failed, rounded to 0.1 %.',
    howStatesDecided: 'How states are decided',
    actRuleLong: (multiple: number, pct: string, span: string) =>
      `Act: a station's failed-inspection rate is more than ${multiple} times the line's rate (over ${pct} for ${span}).`,
    watchRuleLong: (multiple: number, pct: string) => `Watch: more than ${multiple} times (over ${pct}).`,
    tooFew: (min: number) => `A station with fewer than ${min} cones in the period is not judged and shows OK. A station with no cones shows No data, never OK.`,
    boxExplain:
      'The two columns in the box are not affected by the period you pick: pattern tests need consecutive days, so they always look at the last 14 production days.',
    failedPart: (part: string) => `Couldn't load ${part}. Its columns show a dash.`,
    dataNotCurrent: 'The data is not current, so these figures describe the readings received so far.',
    open: (label: string) => `Open ${label}`,
    phonePattern: 'Pattern check, last 14 days',

    /* ---- station sheet ---- */
    sheetPeriod: (span: string) => `${span}`,
    kpiFailedInspection: 'Failed inspection',
    kpiFailedWeight: 'Failed weight check (scale)',
    kpiMeanVsTarget: 'Mean cone weight vs target',
    kpiCones: 'Cones weighed',
    nOfCones: (n: string, total: string) => `${n} of ${total} cones`,
    dailyTitle: 'Cone weight by day',
    seriesSince: 'Since the last adjustment',
    seriesBefore: 'Before the last adjustment',
    limitsNote: 'The shaded band is the product tolerance in force for the line.',
    patternTitle: 'Pattern check',
    patternSub: (days: number) => `Always the last ${days} production days, whatever period is chosen.`,
    noPatternData: 'No weight readings in the last 14 production days, so there is no pattern check.',
    reasonsTitle: 'Top reasons',
    reasonsNone: 'No failed inspections in this period.',
    productTitle: 'Product',
    productJudged: 'Judged against',
    runningNow: (name: string, since: string) => `Running now: ${name}, since ${since}`,
    lastStamped: (name: string, at: string) => `Last product it stamped: ${name}, as of its last cone (${at})`,
    productFromCones: 'A station’s product is known only from the cones it weighed.',
    lastReading: 'Last reading',
    noReading: 'No reading yet',
    hopsTitle: 'See the evidence',
    hopRegister: (label: string) => `Open in Register \u00b7 ${label}`,
    hopRejects: 'Rejects at this station',
    hopCalibration: 'Calibration report',
    hopMachineProduct: 'Product by station report',
    adjustTitle: 'Record an adjustment',
    adjustIntro: 'Records that someone adjusted this scale. SMS never adjusts a scale itself.',
    adjustOpen: W.weight.logAdjustment,
    saving: 'Saving',
    saveFailed: "Couldn't save the adjustment. Nothing was recorded. Try again.",
    cancel: 'Cancel',
    noAdjustments: W.weight.adjustmentsIn,
    assumedHeading: W.iflReports.pendingHeading,
  },

  /* ---- Quality > Weight (folded in from the screen's own strings file) ---- */
  qualityWeight: {
    question: 'Weight',
    headline: {
      mean: (m: string) => `Average cone weight is ${m}.`,
      noCones: 'No cones were weighed in this period.',
      noSacks: 'No sacks were weighed in this period.',
      sack: (kg: string, n: string) => `Average sack weight is ${kg}, from ${n} sacks.`,
      sackNoMean: (n: string) => `${n} sacks were weighed, and none had a plausible weight to average.`,
    },
    sackKpi: {
      weighed: 'Sacks weighed',
      weighedDetail: 'Every sack the scale recorded in the period.',
      mean: 'Mean sack weight',
      passed: 'Passed by the scale',
      infoPassed: 'Share of sacks the scale itself marked as in range.',
    },
    kpi: {
      mean: 'Mean cone weight',
      meanDetail: (spread: string) => `Spread ${spread} (standard deviation)`,
      medianDetail: (median: string, spread: string) => `Median ${median}. Spread ${spread} (standard deviation)`,
      target: 'Target',
      noTarget: 'No product target',
      offset: 'Mean minus target',
      offsetDetail: 'Two separate facts until the weight basis is confirmed.',
      offsetNone: 'Needs a product target.',
      within: 'Within product tolerance',
      withinDetail: (lo: string, hi: string, n: string) => `${lo} to ${hi} · ${n} cones judged`,
      withinNone: 'Not checked (no product set)',
      failedCheck: 'Failed weight check (scale)',
      failedDetail: (n: string) => `Of ${n} cones weighed. The scale\u2019s own check.`,
      infoMean: 'Average of every cone weighed in the period.',
      infoWithin: 'Share of judged cones between the product\u2019s lower and upper limit.',
      infoFailed: 'Share of cones the scale itself marked as out of range.',
    },
    toolbar: { chart: 'Chart', weight: 'Weight of', station: 'Station' },
    charts: {
      overTimeCone: 'Average cone weight over time',
      overTimeSack: 'Average sack weight over time',
      distCone: 'How cone weights are spread',
      distSack: 'How sack weights are spread',
      offsets: 'Station offset from the line',
      offsetsCaption: 'Mean weight of each station minus the line mean, over the period.',
      offsetsEmpty: 'No station weighed cones in this period.',
      stationNoData: 'No data',
      sackPerDay: 'Average sack weight per day',
      sackPerDayCaption: (mean: string) => `Each production day\u2019s mean against the period mean of ${mean}.`,
      sackPerDayShort: 'Fewer than two production days with sacks, so there is no day-to-day comparison.',
      target: 'Target',
      coneMean: 'Mean cone weight',
      sackMean: 'Mean sack weight',
      stationMean: 'Mean',
      offsetName: 'Offset from the line',
      vsPeriodMean: 'Against the period mean',
      withinBand: (g: string) => `Within ${g} g of the line`,
      openStation: 'Open this station.',
      groupsCaption: (groups: string, per: string) => `${groups} groups of about ${per}`,
      binNote: (lo: string, hi: string) => `Weights outside ${lo} to ${hi} are not drawn.`,
      limitsPeriod: (p: string) => `Limits shown are those in force at the end of ${p}.`,
    },
    sack: {
      byProduct: 'Sacks the scale passed, by product',
      byProductCaption: 'The scale’s own in-range check. IFL has confirmed no sack tolerance, so no sack is called over- or underweight.',
      colProduct: 'Product',
      colSacks: 'Sacks',
      colPassed: 'Passed by the scale',
      noProduct: 'No product on the reading',
      namesMissing: 'The product list did not load, so some products are shown by their number.',
      none: 'Fewer than two products have sacks in this period.',
    },
    advisory: {
      title: 'Stations to look at',
      window: (days: number) => `Pattern tests run over a fixed ${days} production days, whatever period is chosen.`,
      seeStations: 'Open the station table',
      recommendationOnly: 'This is what the readings show, not an instruction to adjust a scale.',
    },
    about: {
      title: 'About these figures',
      basisLabel: 'Weight basis',
      basisSentence: 'Weight basis: as set in Setup (gross or net to be confirmed).',
      plantTime: 'Times are plant time.',
      targetSource: (label: string) => `The target and limits come from the product in force at the end of the period: ${label}.`,
      agreement: (a: string, b: string, c: string) =>
        `Scale against product over this period: ${a} passed by the scale but outside the product’s limits, ${b} failed by the scale but inside them, out of ${c} judged.`,
      unjudged: (n: string) => `${n} could not be judged because no product was recorded at the time.`,
      working: (n: string, word: string, mean: string, sdAll: string, sdWithin: string, unit: string, bucket: string) =>
        `Over this period: ${n} ${word}, mean ${mean}, standard deviation ${sdAll} ${unit} overall and ${sdWithin} ${unit} within ${bucket} groups.`,
    },
    offsetBarAria: (n: number, g: string) => `Station ${n}: ${g} against the line mean`,
    hopStations: 'Stations',
    zoomHint: 'Select a point to zoom to its shifts.',
  },

  /* ---- Quality > Rejects and the reason sheet (folded in from the screen's own strings file) ---- */
  qualityRejects: {
    question: 'How many cones failed a check, why, is it getting worse, and where?',
    failedInspection: 'Failed inspection',
    failedWeight: 'Failed weight check (scale)',
    weightRecords: 'Weight-reject records',
    topReasonShare: 'Top reason share',
    /** "6,048 of 132,665 cones checked" */
    ofChecked: (n: string, total: string) => `${n} of ${total} cones checked`,
    /** The two verdicts together: the one figure Today and Reports print as the line's failure rate. */
    together: (n: string, pct: string, total: string) =>
      `Together ${n} of ${total} cones checked (${pct}), the same rate Today and Reports use.`,
    rangeFromTo: (from: string, to: string) => `${from} to ${to}`,

    paretoTitle: 'Failed inspection by reason',
    paretoCaption: (period: string, total: string) => `Cones, ${period}. Share is of ${total} cones that failed inspection.`,
    colReason: 'Reason',
    colCones: 'Cones',
    colShare: 'Share',
    follow: 'Follow this reason',
    following: 'Following',
    showAll: (n: number) => `Show all ${n}`,
    showTop: (n: number) => `Show top ${n}`,
    coverTop: (k: number, pct: string) => `The ${k} biggest reasons cover ${pct} of cones that failed inspection.`,
    noReasons: 'No cones failed inspection in this period.',

    heatTitle: 'When each reason happened',
    heatCaption: "Share of the day's cones, by production day",
    heatLegendLabel: 'Share of the day\'s cones',
    heatCapped: (k: number, n: number) => `Top ${k} reasons shown. Use "Show all ${n}" above for the rest.`,
    heatOpen: (reason: string, day: string, pct: string) => `${reason}, ${day}: ${pct}. Open this day.`,
    heatNoRows: 'No cones failed inspection on any day in this period.',

    trendTitle: (days: number | null) => (days === null ? 'Daily failed-inspection rate' : `Daily failed-inspection rate, last ${days} production days`),
    trendTitleOne: (reason: string, days: number | null) => (days === null ? `Daily rate for ${reason}` : `Daily rate for ${reason}, last ${days} production days`),
    trendEmpty: (days: number | null, newest: string | null) =>
      `No readings fall in ${days === null ? 'this fixed window' : `the last ${days} production days`}, so there is no daily rate to draw.${newest ? ` The newest reading is from ${newest}.` : ''}`,
    trendCaption: 'Percent of the day\'s cones. Fixed window: it does not follow the period, because a rise needs consecutive days.',
    seriesDaily: 'Daily rate',
    seriesMean: 'Window mean',
    rising: (since: string) => `Failed inspection has been rising since ${since}.`,
    notRising: 'Not rising now.',
    notRisingAfter: (n: number, last: string) =>
      n === 1 ? `Not rising now, after one rise in this window that ended ${last}.` : `Not rising now, after ${n} rises in this window, the last ending ${last}.`,
    daysHold: (n: number, of: number) => `Only ${n} of those ${of} days hold readings.`,

    filterStation: 'Station',
    filterProduct: 'Product',
    all: 'All',
    reasonChip: (name: string) => `Reason: ${name}`,
    predateProduct: (n: string, of: string) =>
      `${n} of ${of} failures in this period were recorded before the plant began recording a product, and are not shown under a product filter.`,

    hopCones: 'See the cones',
    hopStations: 'By station',

    aboutTitle: 'About these figures',
    about: [
      'A cone that failed inspection and a cone the scale marked out of range are counted separately, each cone once.',
      'Reason codes are the plant\'s numbers (tube, material). IFL has not named them yet, so they show as codes until an engineer names them.',
      'Percentages use cones that were checked. Times are plant time and a production day runs 06:00 to 06:00.',
    ],
    aboutCounts: (inspection: string, weight: string) =>
      `In this period ${inspection} cones failed inspection and ${weight} weight-reject records were logged. The reason list holds the inspection failures only.`,
    aboutScale: (records: string) =>
      `Weight-reject records (${records}) are rows in the weight-reject log. "Failed weight check (scale)" on Today and Reports counts the cones the scale flagged out of range, which can be more: some flagged cones have no reject record.`,
    recordsOf: (n: string, total: string) => `${n} records over ${total} cones checked`,
    detectorFixed: (days: number) => `The trend and its rising verdict always look at the last ${days} production days.`,
    spansBatches: 'This window includes the 5 Aug 2026 database rebuild. The normal range is worked out for each side separately.',
    dayBasis: 'IFL has not confirmed whether reject reports should count by production day or by calendar date; this screen uses the production day.',
    periodGenerations: 'This period includes the 5 Aug 2026 database rebuild; the figures above are for one data set.',

    nameIt: 'Name it',
    rename: 'Rename',
    nameLabel: 'Name for this reason',
    nameHint: 'A short name, then Save',
    save: 'Save',
    cancel: 'Cancel',
    saveFailed: "Couldn't save the name.",
    namesAwaited: 'Reason names have not been supplied yet. An engineer or manager can name a code here; the name applies to history.',

    /* reason sheet */
    sheetTitle: 'Failures for one reason',
    malformed: 'This link does not name a reason and a day.',
    dayBasisLine: (day: string) => `${day} · production day`,
    sheetCount: (n: string, reason: string) => `${n} cones failed inspection for ${reason}`,
    sheetCountWeight: (n: string) => `${n} weight-reject records`,
    stationNamesMissing: "Station names couldn't be loaded, so stations show as numbers.",
    perDayTitle: 'Day by day in this period',
    noDaysForReason: 'No cones failed for this reason in this period.',
    conesOnDay: (day: string) => `Cones on ${day}`,
    sheetEmpty: 'No cones failed for this reason on this day.',
    colDay: 'Day',
    colConesThatDay: 'Cones that day',
    colRate: 'Rate',
    colTimeStation: 'Time and station',
    colProductRecord: 'Product and record',
    colWeight: 'Weight',
    noProductThen: 'Product not recorded',
    notWeighed: 'No weight on this record',
    noWeightNote: 'A failed-inspection record does not carry the cone weight. Open the cone to see its weighed value if it has one.',
    hopDayRegister: 'See this day in the Register',
    hopDayReport: 'See this day on the reject report',

    part: {
    },
  },
} as const;

/** Plant name: a proper noun, so it sits outside C (whose strings are checked for sentence case). */
export const PLANT_NAME = 'Ibrahim Fibres, TP1 Line 3';

/** Where "Check diagnostics" points. A URL, not copy. */
export const DIAGNOSTICS_HREF = '?s=system&t=diagnostics';

/** Server minimum for every PDAS write reason (api/src/services/pdasWrite.ts MIN_REASON_CHARS). */
export const REASON_MIN_CHARS = 10;

/* ---- helpers for the date and clock rule (GLOSSARY 1.4) ----------------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "1 Sep 2026" from a plant-clock ISO string or millisecond value (plant wall clock, no UTC marker shown). */
export function formatDate(at: string | number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "14:30", or "14:30:05" when seconds are asked for. */
export function formatClock(at: string | number | Date, seconds = false): string {
  const d = at instanceof Date ? at : new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${seconds ? `:${p(d.getUTCSeconds())}` : ''}`;
}

/* ---- RESERVED wording, by reference ------------------------------------- */

export const RESERVED = {
  /* Station naming, DP-4 (rows 87, 88, 104) */
  stationLabel, // row 87: configured name, else "Station N" (lives in api.ts, not W)
  reportTypeStation: W.reports.type.station, // row 88
  stationDefaultLink: W.config.machines.defaultLink, // row 104

  /* Product limits reaching the scale (row 109) */
  changeLimitsPropagation: W.product.changeLimitsPropagation,

  /* Weight basis, DP-1 / Q4-5 (rows 139-141) */
  weightHeadlineUnconfirmed: W.weight.headlineUnconfirmed,
  weightHeadlineConfirmed: W.weight.headlineConfirmed,
  weightBasisLabel: W.config.rules.basis,

  /* "Assumed until IFL confirms" family (rows 142, 143, 164) */
  assumedHeading: W.iflReports.pendingHeading,
  definitionsNote: W.reports.definitionsNote,
  iflNotSaid: {
    oneLine: W.config.line.oneLine,
    defaultLink: W.config.machines.defaultLink,
    rejectCodesIntro: W.config.rejectCodes.intro,
    dayBasisCaveat: W.rejectsMore.dayBasisCaveat,
  },

  /* Sack-stock words (rows 144-155) */
  sackLedger: W.sacks.ledger,
  sackLedgerNote: W.sacks.ledgerNote,
  sackColOpening: W.sacks.colOpening,
  sackColReceipts: W.sacks.colReceipts,
  sackColIssues: W.sacks.colIssues,
  sackColConsumption: W.sacks.colConsumption,
  sackColAdjustments: W.sacks.colAdjustments,
  sackColClosing: W.sacks.colClosing,
  sackTypeName: W.sacks.typeName,
  reportStockColOpening: W.reports.stockColOpening,
  reportStockColReceipts: W.reports.stockColReceipts,
  reportStockColIssues: W.reports.stockColIssues,
  reportStockColConsumption: W.reports.stockColConsumption,
  reportStockColAdjustments: W.reports.stockColAdjustments,
  reportStockColClosing: W.reports.stockColClosing,
  sackPerMachine: W.sacks.perMachine,
  sackPerMachineNone: W.sacks.perMachineNone,
  sackLedgerCaveat: W.sacks.ledgerCaveat,

  /* IFL's eight report titles (rows 156-163), verbatim */
  iflReportTitles: {
    'shift-production': W.reports.type['shift-production'],
    'rejected-cones': W.reports.type['rejected-cones'],
    'rejected-sacks': W.reports.type['rejected-sacks'],
    'sps-packing': W.reports.type['sps-packing'],
    'sack-weight-range': W.reports.type['sack-weight-range'],
    'sack-weight-summary': W.reports.type['sack-weight-summary'],
    'rejected-hangers': W.reports.type['rejected-hangers'],
    'rejected-unknown-lifter': W.reports.type['rejected-unknown-lifter'],
  },
} as const;

/** Dotted path of each RESERVED leaf in W (used by copy.test.ts). */
export const RESERVED_SOURCES: Record<string, string> = {
  reportTypeStation: 'reports.type.station',
  stationDefaultLink: 'config.machines.defaultLink',
  changeLimitsPropagation: 'product.changeLimitsPropagation',
  weightHeadlineUnconfirmed: 'weight.headlineUnconfirmed',
  weightHeadlineConfirmed: 'weight.headlineConfirmed',
  weightBasisLabel: 'config.rules.basis',
  assumedHeading: 'iflReports.pendingHeading',
  definitionsNote: 'reports.definitionsNote',
  'iflNotSaid.oneLine': 'config.line.oneLine',
  'iflNotSaid.defaultLink': 'config.machines.defaultLink',
  'iflNotSaid.rejectCodesIntro': 'config.rejectCodes.intro',
  'iflNotSaid.dayBasisCaveat': 'rejectsMore.dayBasisCaveat',
  sackLedger: 'sacks.ledger',
  sackLedgerNote: 'sacks.ledgerNote',
  sackColOpening: 'sacks.colOpening',
  sackColReceipts: 'sacks.colReceipts',
  sackColIssues: 'sacks.colIssues',
  sackColConsumption: 'sacks.colConsumption',
  sackColAdjustments: 'sacks.colAdjustments',
  sackColClosing: 'sacks.colClosing',
  sackTypeName: 'sacks.typeName',
  reportStockColOpening: 'reports.stockColOpening',
  reportStockColReceipts: 'reports.stockColReceipts',
  reportStockColIssues: 'reports.stockColIssues',
  reportStockColConsumption: 'reports.stockColConsumption',
  reportStockColAdjustments: 'reports.stockColAdjustments',
  reportStockColClosing: 'reports.stockColClosing',
  sackPerMachine: 'sacks.perMachine',
  sackPerMachineNone: 'sacks.perMachineNone',
  sackLedgerCaveat: 'sacks.ledgerCaveat',
  'iflReportTitles.shift-production': 'reports.type.shift-production',
  'iflReportTitles.rejected-cones': 'reports.type.rejected-cones',
  'iflReportTitles.rejected-sacks': 'reports.type.rejected-sacks',
  'iflReportTitles.sps-packing': 'reports.type.sps-packing',
  'iflReportTitles.sack-weight-range': 'reports.type.sack-weight-range',
  'iflReportTitles.sack-weight-summary': 'reports.type.sack-weight-summary',
  'iflReportTitles.rejected-hangers': 'reports.type.rejected-hangers',
  'iflReportTitles.rejected-unknown-lifter': 'reports.type.rejected-unknown-lifter',
};

/**
 * Lowercase fragments that are appended to other text ("5.1% vs previous"), so the
 * sentence-case rule in copy.test.ts does not apply to them.
 */
export const FRAGMENTS = {
  vsPrevious: 'vs previous',
  vsLastWeek: 'vs last week',
  compareOpts: { off: 'Off', prev: 'vs previous', week: 'vs last week' },
  /* Per-screen fragments that sit inside other sentences or are units and part names, so they are lowercase
     and the sentence-case rule does not apply. Same group names as C. */
  today: {
    band: {
      plantTime: 'plant time',
      comparedWith: (what: string) => `compared with ${what}`,
    },
    kpi: {
      kg: 'kg',
      percent: '%',
      partName: 'the totals',
      soFar: 'so far',
      vsCount: (prev: string) => `vs ${prev}`,
      vsKg: (prev: string) => `vs ${prev} kg`,
      vsRate: (prev: string) => `vs ${prev} %`,
      wasRate: (prev: string) => `(was ${prev} %)`,
    },
    stations: {
      partName: 'the station states',
    },
    productChange: {
      partName: 'the product changes',
      sinceAtLeast: (when: string) => `since at least ${when}`,
      since: (when: string) => `since ${when}`,
    },
    shifts: {
      unit: 'cones',
      partName: 'the cones chart',
    },
    reasons: {
      unit: 'cones',
      partName: 'the failed inspection reasons',
    },
    attention: {
      partName: 'the attention check',
    },
    latest: {
      partName: 'the latest readings',
    },
    sacks: {
      unitKg: 'kg',
      partName: 'the sack summary',
      productsPartName: 'the product names',
    },
  },
  qualityStations: {
    partSheetMachine: 'the station’s product',
    vsTargetSub: 'vs product target',
    ofConesWeighed: (n: string) => `of ${n} cones weighed`,
    dash: '\u2013',
    partCounts: 'the per-station counts',
    partPattern: 'the 14-day pattern check',
    partStations: 'the station list',
    partProduct: 'the station product',
    dailyCaption: (days: number) => `daily mean over the last ${days} production days, grams`,
    chartPart: 'the station weight chart',
    reasonsCaption: 'whole line, not split by station yet',
    partSheetStatus: 'the station state',
    partSheetCounts: 'this station\u2019s counts',
    partSheetPattern: 'the 14-day pattern check',
    partSheetReasons: 'the reject reasons',
    partSheetLog: 'the adjustment log',
    partSheetStations: 'the station names',
  },
  qualityRejects: {
    cones: 'cones',
    heatLegendNone: 'none',
    trendUnit: '% of cones',
    trendPart: 'the failed-inspection trend',
    hopConesNote: 'opens the Register on cones that failed inspection, for this period',
    hopStationsNote: 'opens Stations, worst first',
    hopDayRegisterNote: 'opens cones that failed inspection on this day; the reason itself is listed only here',
    hopDayReportNote: 'opens the reject report for this day',
    part: {
      thisReason: 'this reason',
      reasons: 'the reasons',
      figures: 'the failure rates',
      trend: 'the trend',
      byDay: 'the days by reason',
      stations: 'the station list',
      products: 'the product list',
      figureInspection: 'the failed-inspection rate',
      figureWeight: 'the weight-reject rate',
    },
  },
  wall: {
    parts: { stations: 'station status', production: 'production figures', shifts: 'shift output' },
  },
} as const;
