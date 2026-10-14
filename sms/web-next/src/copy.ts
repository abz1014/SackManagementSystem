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
import { fmtDate, fmtTime, fmtTimeSec } from './lib/fmt';
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
  /* Text size control and the zoomed-chart way back (folded in from ui/a11yCopy.ts) */
  a11y: {
    textSize: 'Text size',
    desk: 'Desk',
    wall: 'Wall',
    zoomedBack: 'Zoomed in · Back',
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
    /** The combined figure (inspection fails plus weight-reject records). Owner decision 14 Oct 2026 (GLOSSARY 1.8): never bare "rejected". */
    failedInspectionOrWeight: 'Failed inspection or weight check',
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
  /** A station in a picker: the same "Station N · <name>" as the tiles, or "Station N" when no name is configured. */
  stationOption: (s: { stationId: number; name?: string | null }) =>
    s.name?.trim() ? `Station ${s.stationId} · ${s.name.trim()}` : `Station ${s.stationId}`,
  /** GLOSSARY rows 115-116: older readings are named by the date IFL rebuilt its database, never by "batch". */
  rebuildNote: {
    notCounted: (n: string | null) =>
      `${n ? `${n} readings` : 'Some readings'} from before the 5 Aug 2026 IFL database rebuild are not counted.`,
    chartShows: (shown: string, excluded: string) =>
      `This chart shows ${shown} readings. ${excluded} readings from before the 5 Aug 2026 rebuild are not shown.`,
  },
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
    /* Fix-wave owner decision 13 Oct 2026: the wall is for large screens only (below 1024 px both are hidden / replaced). */
    openWall: 'Open TV wall',
    wallNeedsLargeScreen: 'The TV wall is designed for a large screen',
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
    replayUnreadable: (raw: string) => `The replay time "${raw}" could not be read, so the live picture is shown. Write it as a plant time, for example 2026-10-13T15:30.`,
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
    failedInspection: 'Failed inspection or weight check',
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
    kpi: { cones: 'Cones', sacks: 'Sacks', packed: 'Packed', failed: 'Failed inspection or weight check' },
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
    /** "Each one's rate of failed inspection or weight check is more than twice the line's 4.59 %." */
    actRule: (multiple: number, linePct: string) =>
      `Each one's rate of failed inspection or weight check is more than ${multiple === 2 ? 'twice' : `${multiple} times`} the line's ${linePct}.`,
    periodCaption: (span: string, days: number) => `${span}, ${days} production ${days === 1 ? 'day' : 'days'} (06:00 to 06:00 plant time)`,
    tableTitle: 'Stations, worst first',
    tableCaption: (n: number, cones: string, linePct: string) => `${n} stations · ${cones} cones · line rate of failed inspection or weight check ${linePct}`,
    tableAria: 'Stations, worst first',
    thisPeriod: (span: string) => `This period · ${span}`,
    patternHead: (span: string) => `Pattern check · always the last 14 production days (${span})`,
    patternHeadShort: 'Pattern check · always the last 14 production days',
    colStation: 'Station and product',
    colState: 'State',
    colCones: 'Cones',
    colFailedInspection: 'Failed inspection or weight check',
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
    kpiFailedInspection: 'Failed inspection or weight check',
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
    perProductLimits: "Cones in this view ran different products, so each is judged against its own product's limits and no single tolerance band is drawn.",
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
      /** Audit M7: when the cones ran different products there is no single band to print. */
      withinDetailPerProduct: (n: string) => `Own product limits · ${n} cones judged`,
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
    sheetCount: (n: string, reason: string) => `${n} ${n === '1' ? 'cone' : 'cones'} failed inspection for ${reason}`,
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

  /* ---- Quality > Register, record sheets and the sack stock ledger (folded in from the screen's own strings file) ---- */
  register: {
    question: 'Every cone and sack that was weighed, with the ones that failed a check marked.',
    listingLabel: 'What to list',
    listings: {
      cones: 'Cones',
      sacks: 'Sacks',
      inspectionRejects: 'Inspection or weight-check fails',
      rejected: 'Weight-check fails',
      stock: 'Sack stock',
    },

    /* count lines (a count that has not arrived is never printed as zero) */
    countFailed: "Couldn't load this period's count. The plant connection may be down.",
    countPending: (what: string) => `${what}: counting the readings in this period.`,
    conesWeighed: (what: string, n: string) => `${what}: ${n} ${n === '1' ? 'cone' : 'cones'} weighed.`,
    sacksWeighed: (what: string, n: string) => `${what}: ${n} sacks weighed.`,
    inspectionFails: (what: string, n: string) => `${what}: ${n} ${n === '1' ? 'cone' : 'cones'} failed inspection or the weight check.`,
    weightFails: (what: string, n: string) => `${what}: ${n} ${n === '1' ? 'cone' : 'cones'} failed the weight check (scale).`,
    filteredCones: (what: string, n: string, states: string) => `${what}: ${n} ${n === '1' ? 'cone' : 'cones'}, ${states}.`,
    outsideLimits: (what: string, n: string) => `${what}: ${n} ${n === '1' ? 'cone' : 'cones'} passed by the scale but outside the product limits.`,
    weightFailsUnknown: (what: string, n: string) => `${what}: ${n} cones weighed. How many failed the weight check could not be loaded.`,
    weightFailsPending: (what: string, n: string) => `${what}: ${n} cones weighed. Still counting how many failed the weight check.`,
    weightFailsNoRate: (what: string, n: string, f: string) => `${what}: ${n} cones weighed, ${f} failed the weight check (scale).`,

    /* filters */
    filterStation: 'Station',
    filterProduct: 'Product',
    filterState: 'Check result',
    anyState: 'Any',
    all: 'All',
    search: 'Search these rows',
    searchHint: 'Searches the rows loaded so far: record, sack number, station, product.',
    outsideChip: 'Outside product limits',
    stationsUnavailable: 'Station names could not be loaded, so stations show as numbers.',
    productsUnavailable: 'The product list could not be loaded, so products cannot be picked by name.',
    productNotForSacks: 'The product choice applies to cones. Sacks are listed for every product.',
    states: {
      within: 'Within product limits',
      low: 'Under the lower limit',
      high: 'Over the upper limit',
      rejected: 'Failed weight check (scale)',
      unknown: 'Not checked',
    },
    statesShort: {
      within: 'Within',
      low: 'Low',
      high: 'High',
      rejected: 'Failed',
      unknown: 'Not checked',
    },

    /* data sets */
    periodHoldsOther: (n: string) => `This period also holds ${n} readings from another data set. The list shows one.`,
    showOther: 'Show the other data set',
    showingOther: 'Showing the other data set.',
    backToDefault: 'Back to the default data set',

    /* actions */
    exportCsv: 'Export CSV',
    print: 'Print',

    /* columns */
    colTime: 'Time',
    colDay: 'Production day',
    colStation: 'Station',
    colRecord: 'Record',
    colSack: 'Sack',
    colWeight: 'Weight',
    colState: 'Check result',
    colScale: 'Scale check',
    colProduct: 'Product',
    colReason: 'Reason',
    noProductOnRow: 'No product',
    passedWeight: 'Passed weight check',
    failedWeight: 'Failed weight check (scale)',
    noStation: 'No station',
    tableCaption: (listing: string) => `Register: ${listing}`,

    /* states of the list */
    nothing: 'Nothing was weighed in this period.',
    nothingMatch: 'No rows match the search.',
    nothingOutside: 'No cones in this period passed the scale but sit outside the product limits.',
    nothingInspection: 'No cones failed inspection in this period.',
    nothingWeightFail: 'No cones failed the weight check in this period.',
    liveNote: 'New readings appear every 15 seconds.',
    perPage: (n: number, total: string) => `${n} a page, newest first. ${total} in this period.`,
    countUnknown: 'The total for this period could not be confirmed. That is not the same as an empty period.',
    printTitle: 'Register',

    /* sack stock */
    unitLabel: 'Show stock as',
    unitSacks: 'Sacks',
    colDayStock: 'Day',
    colCount: 'Stock count',
    colProductStock: 'Product',
    byProduct: 'By product',
    noProduct: 'No product',
    ledgerEmpty: 'No sacks and no movements in this period.',
    openingBefore: (n: string) => `${n} in stock before this period.`,
    openingBeforeDays: (n: string) => `${n} in stock before the first production day shown.`,
    closingNow: (n: string) => `${n} in stock at the end of it.`,
    wholeDays:
      'This ledger is kept per production day (06:00 to 06:00). It covers every shift of each day the period touches, so its figures are larger than the shift named above.',
    kgShort: (n: number) =>
      n === 1 ? 'The kg column is short by one recorded movement that had no weight.' : `The kg column is short by ${n} recorded movements that had no weight.`,

    /* the movement form */
    record: 'Record a movement',
    recordNote: 'A correction is a new row that says why. Nothing recorded here is edited or deleted.',
    formTitle: 'Record a stock movement',
    fType: 'What happened',
    fSacks: 'Sacks',
    fKg: 'Weight in kg (if known)',
    fProduct: 'Product',
    fAnyProduct: 'Not stated',
    fWhen: 'When (plant time)',
    fWhy: 'Why',
    fWhyHint: 'Required for a correction.',
    fSave: 'Record',
    fSaving: 'Recording',
    fCancel: 'Cancel',
    recorded: 'Recorded.',
    saveFailed: 'Could not record this movement.',
    productListUnavailable: 'The product list could not be loaded, so only "Not stated" is offered.',
    sacksInvalid: 'Enter a whole number of sacks.',
    whenInvalid: 'Enter the plant time the movement happened.',

    /* the stock day sheet */
    stockSheetTitle: 'Stock movements',
    stockSheetDay: (day: string) => `${day}, production day`,
    stockWeighed: (n: string, kg: string) => `${n} sacks weighed this day (${kg} kg) count as receipts.`,
    stockWeighedNone: 'No sacks were weighed this day.',
    stockEmpty: 'No movements were recorded by hand this day.',
    malformedDay: 'This day link is not a valid date.',
    colWhat: 'What',
    colSacksQty: 'Sacks',
    colWho: 'Recorded by',
    colWhy: 'Why',
    nobody: 'Not recorded',
    recordedAtOn: (when: string) => `Recorded ${when}`,

    /* reading sheets */
    coneTitle: 'Cone',
    sackTitle: 'Sack',
    rejectTitle: 'Inspection or weight-check fail',
    shift: 'Shift',
    station: 'Station',
    sourceRecord: 'Source record',
    productThen: 'Product then',
    weighed: 'Weighed',
    recordedLabel: 'Recorded',
    sackNo: 'Sack number',
    notWeighed: 'Not weighed',
    seeProductReport: 'See this product in Reports',
    seeProductCatalogue: 'See this product in the catalogue',
    seeStation: 'See this station in the Register',
    insertTimeCaveat:
      'The plant records no separate weighing time for a sack. This is when the reading was written, which can trail the actual weighing.',
    aroundSack: (n: string) =>
      `${n} cones were weighed between the previous sack and this one. The plant records no link between a cone and its sack, so this is an approximate count and never a packing list.`,
    noPreviousSack: 'There is no earlier sack on record to count cones from.',
    provenance: 'Where this reading came from',
    provenanceNote: 'Every line is a field the server sent. Nothing here is worked out in the browser.',
    provNotAvailable: 'Not available for this reading.',
    prov: {
      sourceTable: 'Source table',
      sourceSystem: 'Source system',
      dataSet: 'Data set',
      sourceRow: 'Source row',
      insertedAt: 'Written by the plant',
      readAt: 'Read by SMS',
      transform: 'Transform version',
      product: 'Product recorded by',
      rawRow: 'Raw row',
      syncPass: 'Read in pass',
      plantShift: "The plant's own shift label",
      productionDay: 'Production day filed under',
    },
    failedFor: (reason: string) => `Failed inspection: ${reason}`,
    codeName: (pair: string) => `Code ${pair} (not named yet)`,
    malformedId: 'This link is not a valid record.',
    missLow: (g: string) => `${g} under the lower limit`,
    missHigh: (g: string) => `${g} over the upper limit`,
    withinOf: (limits: string) => `Within the product limits, ${limits}.`,
    lowHigh: (by: string, limits: string, scalePassed: boolean | null) =>
      scalePassed
        ? `${by}, ${limits}. The scale passed it. Which judgement governs is not yet confirmed by IFL.`
        : `${by}, ${limits}.`,
    failedInside: (limits: string) =>
      `The scale failed it, but the weight sits inside the product limits, ${limits}. Which judgement governs is not yet confirmed by IFL.`,
    failedOutside: (by: string, limits: string) => `The scale failed it, and ${by}, ${limits}.`,
    noLimitsNow: 'No product limits were in force at this time, so nothing is compared.',
    noTarget: 'The product recorded at this time carries no target weight, so there are no limits to compare against.',
    noLimitsKnown: 'Not checked against a tolerance: no product limits were in force at this time.',
    implausible: (lo: string, hi: string) =>
      `Not checked: the weight is outside the plausibility window (${lo} to ${hi}), so it is treated as a scale fault. The window is not yet confirmed by IFL.`,
    noWeight: 'Not checked: no weight was recorded.',
  },
  /* ---- Products > Board and Catalogue, and the PDAS connection card (folded in from the screen's own strings file) ---- */
  products: {
    tabsLabel: 'Products and PDAS',

    status: {
      title: 'PDAS connection',
      badgeOn: 'Writes on',
      badgeOff: 'Writes switched off',
      badgeUnread: 'Not read',
      onLead: 'PDAS writes are on. Changes you confirm here are sent to PDAS.',
      onNoRank: 'Your account can look at PDAS but cannot change it.',
      offLead: 'SMS can read products from PDAS. Changing them from SMS is switched off on this server.',
      reasonLabel: 'Reason given by the server',
      noReason: 'The server gave no reason.',
      staysTitle: 'What stays available',
      staysPlans: 'Plans and reviews still work and nothing is sent to PDAS.',
      staysLocal: 'Local weight limits can still be changed in SMS.',
      staysDecision: "Turning PDAS writes on is an engineer's decision on the plant server.",
      rowPdas: 'Products and pallets in PDAS',
      rowLocal: 'Weight limits kept in SMS',
      canChange: 'Can be changed here',
      switchedOff: 'Switched off',
      yourAccountCannot: 'Your account cannot change them',
    },
    board: {
      title: 'Products and PDAS',
      asked: 'What each station is running, as seen from the cones it weighed.',
      shownAsAt: (when: string) => `Shown as at ${when}.`,
      headlineRunning: (stations: number, products: number, idle: number) =>
        `${stations === 1 ? '1 station is' : `${stations} stations are`} running ${products === 1 ? '1 product' : `${products} products`}. ${idle === 0 ? 'None are idle.' : `${idle} ${idle === 1 ? 'is' : 'are'} idle.`}`,
      headlineNone: (idle: number) => `No station is running. ${idle} ${idle === 1 ? 'is' : 'are'} idle.`,
      headlineEmpty: 'No stations were reported.',
      startChangeover: 'Start a changeover',
      changeoverOff: 'Planning works now. Executing is off on this server.',
      changeoverOn: 'Plan it, review it, then execute it.',
      changeoverUnknown: 'Plan it and review it first.',

      defaultTitle: 'Default for readings without a product',
      defaultNone: 'No default product has been set.',
      defaultSetBy: (who: string, when: string) => `Set by ${who} on ${when}.`,
      defaultSetOn: (when: string) => `Set on ${when}.`,
      defaultOnlyUsed: 'Only used for readings that carry no product, which are the older readings from before the plant recorded one.',
      defaultSeeCatalogue: 'See in catalogue',
      defaultChange: 'Change the default',
      defaultPick: 'Product',
      defaultPickPlaceholder: 'Choose a product',
      defaultReason: 'Reason (optional)',
      defaultReasonHint: 'Saved with the change.',
      defaultConfirmTitle: 'Change the default product?',
      defaultConfirmBody: (label: string) => `${label} becomes the default for readings without a product. This is kept in SMS only and is not sent to PDAS or to any station.`,
      defaultConfirm: 'Change default',
      defaultCancel: 'Cancel',
      defaultSaved: 'The default product was changed.',
      defaultListFailed: 'The product list did not load, so the default cannot be changed now.',
      defaultWriteFailed: 'The default product was not changed.',

      howTitle: 'How SMS knows the product',
      howBody:
        'No database stores which product a station is set to. The panel on each station stamps the product on every cone, so SMS shows the product of the latest cone it weighed. An idle station shows the last product it stamped and when that cone was weighed.',
      notReached:
        "PDAS changes do not reach the stations by themselves. The operator picks the material on each station's panel, and SMS sees the change at the first cone weighed with it.",

      stationsTitle: 'Stations',
      filterLabel: 'Show stations',
      filterAll: (n: number) => `All ${n}`,
      filterRunning: (n: number) => `Running ${n}`,
      filterIdle: (n: number) => `Idle ${n}`,
      running: 'Running',
      idle: 'Idle',
      station: (n: number) => `Station ${n}`,
      openStation: (name: string) => `Open ${name}`,
      lastStampedHeading: 'Last product it stamped',
      noProduct: 'No product recorded',
      noProductWhy: 'No product recorded on its cones.',
      since: 'Since',
      sinceAtLeast: 'Since at least',
      lastStamped: 'Last stamped',
      conesInPeriod: 'Cones in period',
      lastCone: 'Last cone',
      noCone: 'None on record',
      changedFrom: (from: string, when: string) => `Changed from ${from}. First cone of this product: ${when}.`,
      changedFromNone: (when: string) => `Changed from no product. First cone of this product: ${when}.`,
      noTarget: 'No target on record',
      retired: 'Retired in PDAS',
      emptyFilter: 'No station matches this filter.',
      showAll: 'Show all stations',
      conesFailed: 'The cone counts did not load, so cones in the period are shown as a dash.',
      productsFailed: 'The product list did not load, so targets and colours are not shown.',

      changesTitle: 'Product changes',
      changesNote: 'Timed at the first cone of the new product, not when the operator pressed the button.',
      changesNone: 'No product change was found in the cones SMS looked back over.',
      changeLine: (to: string, from: string | null) => (from ? `Started ${to}, replacing ${from}` : `Started ${to}`),
      allActions: 'All PDAS actions',
    },
    catalogue: {
      title: 'Catalogue',
      asked: 'Products and pallets as they exist in PDAS.',
      headline: (active: number, retired: number) => `${active} ${active === 1 ? 'product is' : 'products are'} active in PDAS. ${retired} ${retired === 1 ? 'is' : 'are'} retired.`,
      headlineNone: 'No products were read from PDAS.',
      newProduct: 'New product',
      newProductNote: 'Opens the changeover plan.',
      offBanner: 'PDAS writes are switched off on this server. Retire and Reactivate are off:',
      productsTitle: 'Products',
      filterLabel: 'Show products',
      filterActive: (n: number) => `Active ${n}`,
      filterRetired: (n: number) => `Retired ${n}`,
      filterAll: (n: number) => `All ${n}`,
      searchLabel: 'Search products',
      searchHint: 'Code, colour or tube',
      colCode: 'Code',
      colColour: 'Colour',
      colCount: 'Count',
      colTube: 'Tube',
      colTarget: 'Target',
      colTolerance: 'Tolerance',
      colStatus: 'Status',
      colRunning: 'Running it now',
      colActions: 'Actions',
      active: 'Active',
      retired: 'Retired',
      notStated: 'Not stated',
      stationsNow: (list: string) => list,
      none: 'None',
      runningFailed: 'The station products did not load, so "Running it now" is shown as a dash.',
      empty: 'No product matches this search. Clear the search or change the filter.',
      emptyClear: 'Clear the search',
      retiredNote: 'Retired products keep their history. They can be reactivated here.',
      whyTitle: 'Why a retired product cannot be recreated',
      whyBody: 'PDAS refuses a new product with the same blend, count and tube as an existing one, active or not. To change a target weight, use Limits on the existing product.',
      whyLink: 'Open limits and history',
      retire: 'Retire',
      reactivate: 'Reactivate',
      palletsTitle: 'Pallets in PDAS',
      palletsNone: 'PDAS holds no pallets.',
      colPallet: 'Pallet',
      colUsedFor: 'Used for',
      colPack: 'Pack schema',
      colLot: 'Lot',
      colSackColour: 'Sack colour',
      pallet: (n: number) => `Pallet ${n}`,
      noProductLabel: (n: number) => `Product ${n}`,

      retireTitle: (what: string) => `Retire ${what}?`,
      reactivateTitle: (what: string) => `Reactivate ${what}?`,
      retireBodyProduct: 'It is marked retired in PDAS. It keeps its history and can be reactivated. A product with the same blend, count and tube cannot be created in its place.',
      reactivateBodyProduct: 'It becomes active in PDAS again.',
      retireBodyPallet: 'The pallet is marked retired in PDAS. It can be reactivated.',
      reactivateBodyPallet: 'The pallet becomes active in PDAS again.',
      reasonLabel: 'Why is this being done?',
      reasonHint: 'Recorded in the PDAS action history with your name.',
      reasonShort: (min: number) => `Write at least ${min} characters so the history says why.`,
      notChanged: 'Not changed',
      didNotRun: (action: string, what: string) => `${action} ${what} did not run.`,
      serverSaid: 'The server said:',
      dismiss: 'Dismiss',
      doneRetired: (what: string) => `${what} was retired in PDAS.`,
      doneReactivated: (what: string) => `${what} was reactivated in PDAS.`,
      writeNoStatus: 'The PDAS connection status did not load, so Retire and Reactivate are off.',
    },
  },
  /* ---- Products > Changeover (folded in from the screen's own strings file) ---- */
  changeover: {
    title: 'Changeover',
    sentence: 'Plan a new product, check what will happen, then run it in PDAS.',
    caption: 'Planning and review change nothing. Only the last step writes to PDAS.',
    steps: { plan: 'Plan', review: 'Review', execute: 'Execute' },
    checkPlan: 'Check the plan',
    checking: 'Checking the plan',

    blend: 'Blend',
    count: 'Count',
    tube: 'Tube type',
    useExisting: 'Use existing',
    addNew: 'Add new',
    newName: (what: string) => `New ${what} name`,
    pickOne: 'Pick one',
    tubeWeight: 'Tube weight',
    tubeForm: 'Form',
    tubeFormOption: (f: 1 | 2) => (f === 2 ? 'Form 2, cone' : 'Form 1'),
    tubeOption: (name: string, weightG: number | null, form: number | null) =>
      `${name}${weightG != null ? `, ${weightG} g` : ''}, ${form != null ? `form ${form}` : 'form not recorded yet'}`,
    tubeNewNote: 'A new tube type needs its weight and form. PDAS refuses a name that matches an existing tube type of the same form.',

    setpoint: 'Target weight',
    below: 'Allowed below target',
    above: 'Allowed above target',
    productName: 'Product name',
    productNameHint: "Becomes the product's description and the pallet's lot in PDAS.",
    colour: 'Colour',
    sackColour: 'Sack colour',
    optional: 'Optional',
    palletNote: 'A pallet is created with every new product, so the operator can pick it at the station.',

    retireTitle: 'Retire when this runs',
    retireNote: 'Retired products stay in history. They cannot be picked for new work.',
    retireProduct: (label: string, id: number) => `${label}, product ${id}`,
    retirePallet: (label: string, id: number) => `${label}, pallet ${id}`,
    retireNone: 'Nothing to retire.',

    reason: 'Reason',
    reasonHint: 'Why is this changeover happening? It is kept in the history.',

    planAddsNote: 'A plan adds products to PDAS. Which station runs the new product is chosen at the station panel.',

    needsBlend: 'Pick or name a blend.',
    needsCount: 'Pick or name a count.',
    needsTube: 'Pick a tube type, or name a new one with its weight.',
    needsLimits: 'Enter the target weight and both allowed offsets in grams.',
    needsName: 'Enter a product name.',
    needsReason: (n: number) => `Write a reason of at least ${n} characters.`,

    planFailed: 'The plan could not be checked.',
    planFailedFix: 'Nothing was sent to PDAS. Try again.',

    reviewIntro: 'The server checked the plan. These steps run in this order.',
    stepsLabel: 'Steps in order',
    kind: { reuse: 'Already exists', add: 'New', create: 'New', retire: 'Retire' } as Record<string, string>,
    limitsLine: 'Limits in force from the first cone',
    ready: 'Ready to run',
    blockedPill: 'Blocked',
    blockersTitle: 'Blocked',
    blockersNote: 'Execute stays off while a blocker is open. Go back, change the plan and check it again.',
    warningsTitle: 'Warnings',
    warningsNote: 'These do not stop the run.',
    blockersUnknown: 'The server did not say whether anything blocks this plan, so it cannot be run.',
    changeLimitsOf: (id: number) => `Change the limits of product ${id}`,
    changeLimitsWhy: 'PDAS allows one product for each blend, count and tube type, even when the first is retired. To change a target weight, change the limits of the existing product.',
    noReach: 'This does not reach the stations. The operator picks the material at the station panel.',
    noRollbackLead: 'No automatic rollback.',
    nextBlocked: 'Fix the blockers before you can run this.',

    writesOffTitle: 'Writes to PDAS are switched off on this server',
    reasonGiven: 'Reason given by the server',
    nothingSent: 'Nothing was sent to PDAS.',
    planStillWorks: 'Planning and review still work.',
    viewerLock: 'Running a changeover needs the engineer role. You can plan and review it here.',
    execute: (n: number) => (n === 1 ? 'Execute 1 step' : `Execute ${n} steps`),
    executing: 'Running',
    confirmTitle: (n: number) => (n === 1 ? 'Run 1 step in PDAS?' : `Run ${n} steps in PDAS?`),
    confirmBody: 'Each step writes to PDAS as soon as it runs. A step that has run stays run.',
    confirm: 'Run in PDAS',
    alreadyRun: 'This plan has been run. Go back to plan another changeover.',

    refusedOff: 'Nothing was sent to PDAS. Writes are switched off.',
    refusedBlocked: 'Nothing was sent to PDAS. The server found a blocker.',
    unconfirmed: 'The server did not confirm the result. Before you try again, check the action history on Limits & History.',

    resultTitle: 'Result of the run',
    resultAll: (n: number) => (n === 1 ? 'The step ran.' : `All ${n} steps ran.`),
    resultStopped: 'The run stopped at a failed step. Steps that ran stay done.',
    done: 'Done',
    failed: 'Failed',
    notDone: 'Not done',
    newId: (id: number) => `PDAS id ${id}`,
    pdasCode: (c: number) => `PDAS code ${c}`,

    noPickers: 'The pickers could not load, so a plan cannot be made yet.',
    techDetail: 'Technical detail',
  },
  /* ---- Products > Limits and History (folded in from the screen's own strings file) ---- */
  limits: {
    title: 'Limits & History',
    sentence: "Change a product's weight limits, and see who changed what in PDAS.",
    caption: 'Each reading is judged by the limits in force when it was weighed. A change never rewrites earlier readings.',
    pdasOff: 'PDAS writes switched off',
    pdasOn: 'PDAS writes switched on',

    editorTitle: 'Weight limits',
    product: 'Product',
    inForceNow: 'In force now',
    accepts: (lo: string, hi: string) => `Accepts ${lo} to ${hi}.`,
    since: (when: string) => `In force since ${when}.`,
    sinceBound: (when: string) => `In force since no later than ${when}.`,
    noLimits: 'No limits are recorded for this product yet.',

    steps: { edit: 'Edit', review: 'Review', saved: 'Saved' },
    target: 'New target',
    below: 'Allowed below target',
    above: 'Allowed above target',
    reason: 'Reason',
    reasonHint: 'Why are the limits changing? It is kept in the history.',
    reviewNext: 'Review change',
    needsNumbers: 'Enter the target and both offsets in grams.',
    needsChange: 'Change at least one value to continue.',
    needsDestination: 'Choose where to save the change.',
    needsReason: (n: number) => `Write a reason of at least ${n} characters.`,
    needsTick: 'Tick the large-change confirmation to continue.',

    guardTitle: 'Guard check',
    guardWithin: 'Within guard',
    guardOutside: 'Outside guard',
    guardNone: 'No change',
    guardDetail: (pct: string, g: string) => `The target moves ${pct} %. The largest offset change is ${g} g.`,
    guardNote: (pct: string, g: string) => `Guard limits are ${pct} % of the target and ${g} g of an offset, as set on the server. They are developer defaults and not confirmed. The guard applies to saves in PDAS.`,
    guardNoteFallback: (pct: string, g: string) => `Guard limits of ${pct} % of the target and ${g} g of an offset are assumed here because the server did not state them. They are developer defaults and not confirmed. The guard applies to saves in PDAS.`,
    guardUnknown: 'PDAS values for this product are not known, so the guard cannot be checked.',

    where: 'Where it is saved',
    destSms: 'SMS',
    destSmsNote: 'Readings are judged by the new limits from the time you save. PDAS is not changed.',
    destPdas: 'PDAS',
    destPdasNote: 'Changes the product in PDAS. SMS records the change too.',
    smsUnavailable: 'Saving in SMS is not available for your role.',
    pdasNoValues: 'PDAS values for this product are not known, so it cannot be changed there.',
    reasonGiven: 'Reason given by the server',

    before: 'Before',
    after: 'After',
    range: (lo: string, hi: string) => `${lo} to ${hi}`,
    largeTitle: 'Large change',
    largeTick: 'I confirm this large change.',
    largeReason: 'A large change needs a reason of at least 20 characters.',
    noReach: 'Saving limits does not change what a station is doing. The operator picks the material at the station panel, and whether PDAS limits reach a station is not confirmed.',
    confirmSms: 'Confirm and save in SMS',
    confirmPdas: 'Confirm and save in PDAS',
    saving: 'Saving',
    saveFailed: 'The change was not saved.',
    saveUnconfirmed: 'The server did not confirm the result. Check the action history before trying again.',

    savedSms: (id: number) => `Saved in SMS as version ${id}.`,
    savedPdas: 'Saved in PDAS. SMS recorded it too.',
    pdasNow: (label: string) => `PDAS now holds ${label}.`,
    laterReadings: (label: string) => `Readings weighed from now on are judged by ${label}.`,
    changeAgain: 'Change again',

    versionsTitle: 'Limit versions',
    colLimits: 'Limits',
    colFrom: 'In force from',
    colSource: 'Source',
    colBy: 'By',
    colReason: 'Reason',
    noBound: 'No later than',
    sources: {
      pdas_observed: 'Seen in PDAS',
      pdas_created: 'Created in PDAS',
      sms_write: 'Changed in PDAS from SMS',
      sms_local: 'Saved in SMS',
    } as Record<string, string>,
    versionsNote: 'Every version keeps the time it began, so past readings stay judged by the limits of their day.',
    oneVersion: 'Only one version exists so far for this product.',
    noVersions: 'No versions are recorded for this product.',
    retireTitle: 'Retire and recreate does not change limits',
    retireBody: 'PDAS refuses a second product with the same blend, count and tube type, even when the first is retired. To change limits, edit the existing product here.',

    actionsTitle: 'PDAS action history',
    filterLabel: 'Filter by outcome',
    fAll: 'All',
    fDone: 'Done',
    fRefused: 'Refused',
    fNotSent: 'Not sent',
    colWhen: 'When',
    colWho: 'Who',
    colAction: 'Action',
    colOutcome: 'Outcome',
    colMessage: 'Reason or message',
    done: 'Done',
    refused: 'Refused',
    notSent: 'Not sent',
    neverReached: 'Never reached PDAS: writes were off when this was tried.',
    productN: (id: number) => `Product ${id}`,
    palletN: (id: number) => `Pallet ${id}`,
    effective: (when: string) => `Effective ${when}`,
    noActions: 'No PDAS actions are recorded yet.',
    noActionsFilter: 'No loaded action has this outcome.',

    timelineTitle: 'Products set as running in SMS',
    colProduct: 'Product',
    noTimeline: 'No product has been set as running in SMS yet.',

    noProducts: 'No products are recorded yet.',
  },
  /* ---- Reports (titles come from RESERVED) (folded in from the screen's own strings file) ---- */
  reports: {
    pageTitle: 'Reports',
    intro: 'Pick a report, set the period, then preview or download it.',
    startHere: 'Start here',
    useThis: 'Use this report',
    inUse: 'In use',
    managerOnly: 'Needs a manager account',
    managerOnlyHint: 'The management summary is for managers and admins. Sign in with a manager account to read it.',
    ifl: (n: number) => `IFL report ${n}`,
    builder: {
      heading: 'Build your report',
      report: 'Report',
      period: 'Period',
      periodHelp: 'Plant time. A production day runs 06:00 to 06:00.',
      fromShift: 'From shift',
      toShift: 'To shift',
      firstShift: 'First shift',
      lastShift: 'Last shift',
      shift: 'Shift',
      station: 'Station',
      product: 'Product',
      all: 'All',
      preview: 'Preview',
      print: 'Print',
      exportPdf: 'PDF',
      exportExcel: 'Excel',
      exportCsv: 'CSV',
      exportLocked: 'Downloads are for managers and admins. Viewers and engineers see the preview and can print.',
      stationsFailed: 'The station list could not be read, so the station filter is not offered.',
      productsFailed: 'The product list could not be read, so the product filter is not offered.',
    },
    periods: {
      whole: 'Whole data range',
      today: 'Today',
      yesterday: 'Yesterday',
      week: 'Last 7 days',
      month: 'This month',
      lastMonth: 'Last month',
      custom: 'Custom dates',
      current: 'Current period',
      from: 'First day',
      to: 'Last day',
      apply: 'Apply dates',
      badDates: 'Pick two real dates, the first on or before the last.',
    },
    preview: {
      heading: 'Preview',
      notAllowed: 'This report is for managers and above. Sign in with a manager account to read it.',
      empty: 'No cones were weighed on any station in this period.',
      iflNote: 'Figure definitions are awaiting IFL approval.',
      pageNote: 'Print it, or download it in the format you need.',
      needsClock: 'The report needs the plant clock to know which period to show.',
    },
    shiftMorning: 'Morning 06-14',
    shiftEvening: 'Evening 14-22',
    shiftNight: 'Night 22-06',
  },
  /* ---- System > Diagnostics, Setup and Account (folded in from the screen's own strings file) ---- */
  system: {
    title: 'System',
    tabsLabel: 'System',
    adminOnly: 'Admin',

    diag: {
      sentence: {
        working: 'SMS is working.',
        attention: 'Something needs attention.',
        down: 'SMS cannot reach its own database.',
        unreadable: 'SMS could not read its own status.',
        feedOk: "IFL's data feed is current.",
        feedQuiet: (span: string) => `IFL's data feed has sent nothing for ${span}.`,
        feedQuietNoSpan: "IFL's data feed has sent nothing recently.",
        feedLate: "IFL's data is arriving late.",
        feedUnmeasured: "IFL's data has arrived, but how late it is has not been measured yet.",
        feedNone: 'No data has arrived from IFL yet.',
        feedUnknown: "SMS could not tell whether IFL's data feed is current.",
      },
      lights: {
        feed: 'Data feed from IFL',
        database: 'Database',
        backups: 'Backups',
      },
      feed: {
        lastReading: (when: string) => `Last reading ${when} plant time.`,
        noReading: 'No reading yet.',
        cadence: (span: string) => `The feed is checked about every ${span}.`,
        verdict: {
          ok: "IFL's data is arriving as expected.",
          stale: 'Nothing new has arrived from IFL for a while. Check the connection to IFL.',
          late: 'Data is arriving later than it should, so the line cannot be judged as running or stopped.',
          unmeasured: "A reading has arrived, but how late it is has not been measured, so the line's state cannot be judged.",
          none: 'No reading has arrived yet.',
          unknown: "The state of IFL's data feed could not be read.",
        },
      },
      db: {
        used: (used: string, cap: string) => `${used} of ${cap} megabytes used.`,
        usedUnknown: 'The size could not be read.',
        barLabel: (pct: string) => `${pct} percent of the database limit used`,
        unreachable: 'The database did not answer.',
        nearCap: 'The database is close to the size limit of its free edition. Ask the process engineer to plan for it.',
      },
      backups: {
        none: 'No backup file was found.',
        verified: (when: string) => `${when}, checked and restorable.`,
        unverified: (when: string) => `${when}. Not yet proven restorable.`,
        newestUnverified: 'A newer backup file exists but has not been checked yet; this is the newest one that has.',
        overdue: 'Backups run nightly. More than two days without one means the scheduled task has stopped.',
        freeFor: (gb: string) => `${gb} free for backups.`,
      },
      feeds: {
        title: 'What IFL has sent',
        caption: 'The last check of each feed, in app time',
        colFeed: 'Feed',
        colChecked: 'Last checked',
        colAdded: 'Added at that check',
        colState: 'State',
        cones: 'Cones',
        sacks: 'Sacks',
        inspection: 'Inspection fails',
        weight: 'Weight-check fails',
        other: 'Other feed',
        neverChecked: 'Not checked yet',
        halted: (what: string) => `${what} is waiting for an engineer to accept a new IFL database.`,
        none: 'No feed has been checked yet.',
        stateOk: 'Checked',
        stateStopped: 'Stopped',
      },
      sources: {
        title: 'Data sources',
        current: 'Current IFL database',
        older: 'Older IFL database',
        practice: 'Practice data on this computer',
        currentLine: (n: string) => `${n} cones. Reports use this one.`,
        currentLineNoCount: 'Reports use this one.',
        olderLine: (n: string) => `${n} cones. Kept as history.`,
        olderLineNoCount: 'Kept as history.',
        practiceLine: 'Made for testing. Never counted in a report.',
        none: 'No data source has been registered yet.',
        detail: 'Technical detail',
        detailNote: 'When IFL rebuilds its tables, SMS stops and waits for an engineer to accept the new ones.',
      },
      checks: {
        title: 'Data checks',
        caption: 'Engineers and above can acknowledge',
        none: 'No data check has found anything open.',
        showAll: (n: number) => `Show all ${n} checks`,
        showFewer: 'Show fewer',
        ackSummary: (n: number) => (n === 1 ? '1 finding has been acknowledged.' : `${n} findings have been acknowledged.`),
        acknowledge: 'Acknowledge',
        reasonLabel: 'Why is this known and not worth acting on now?',
        record: 'Record acknowledgement',
        recording: 'Recording',
        cancel: 'Cancel',
        ackFailed: "Couldn't record the acknowledgement.",
        ackBy: (who: string, when: string) => `Acknowledged by ${who}, ${when}`,
        ackByUnknown: (when: string) => `Acknowledged, ${when}`,
        sourceRow: 'See the first reading it counts',
        sourceGone: 'That reading is no longer held. A rebuild may have replaced it.',
        sourceAmbiguous: 'This finding does not say whether the reading came from the inspection check or the weight scale, so it cannot be opened.',
        sourceBusy: 'Opening',
        systemState: 'Cannot be acknowledged: it describes the state of the system.',
        severity: { INFO: 'Info', WARNING: 'Watch', ERROR: 'Act', CRITICAL: 'Act' } as Record<string, string>,
        blockingUnread: 'How many findings are blocking could not be read. That is not the same as none being open.',
      },
      verify: {
        title: 'Checks against IFL',
        ranAt: (when: string, ago: string) => `Last compared with IFL's own data on ${when} (${ago} ago).`,
        none: 'SMS has never been compared with IFL data by hand.',
        matched: 'Everything matched.',
        mismatch: 'Something did not match.',
        manual: 'This is the record of one comparison somebody chose to run. It is not a live check.',
        recorder: (checkedIn: string) => `The recorder last checked in at ${checkedIn}.`,
        recorderBoth: (checkedIn: string, reading: string) => `The recorder last checked in at ${checkedIn}. Newest reading at ${reading}.`,
        recorderNever: 'The recorder has never checked in.',
      },
      service: {
        title: 'The SMS service',
        version: (v: string) => `Version ${v}`,
        restarted: 'A short run time beside an old start date means the service restarted.',
        disk: (free: string, what: string) => `${free} free on the ${what} drive.`,
        diskUnknown: (what: string) => `Free space on the ${what} drive could not be read.`,
        diskLow: 'Free space is low.',
      },
      counts: {
        title: 'Records SMS holds',
        caption: (span: string) => `Cones recorded for ${span}`,
        note: 'A count of the readings SMS has recorded. It is not a comparison with IFL.',
        colState: 'State',
        colCones: 'Cones',
        colAvg: 'Average',
        colMin: 'Lightest',
        colMax: 'Heaviest',
        total: 'All cones',
        plausible: 'Plausible weight',
        implausible: 'Implausible weight',
        noWeight: 'No weight',
        detail: 'Cones by state',
      },
      pdas: { text: 'The state of the product database write path is on Products & PDAS.', link: 'Go to Products & PDAS' },
      parts: {
      },
    },

    setup: {
      title: 'Setup',
      sentence: 'Names, rules and accounts for this line. Every change is recorded in the audit log.',
      notAllowed: 'This is only available to an administrator.',
      sections: {
        line: 'Line',
        machines: 'Machines',
        stations: 'Stations',
        sources: 'Data sources',
        rules: 'Rules',
        rejectCodes: 'Reject codes',
        people: 'People',
        audit: 'Audit log',
      },
      sourcesDetail: 'Technical detail',
      sourcesIntro: 'Which IFL tables SMS reads. Changing a table name is a change of data source, not a rename.',
      limitsMoved: 'Product limits are set under Products & PDAS.',
      limitsLink: 'Go to Limits & History',
    },

    account: {
      title: 'Account',
      sentence: 'Your sign-in and your password.',
      who: 'Signed in as',
      name: 'Name',
      username: 'Username',
      role: 'Role',
      rank: (n: number) => `Rank ${n} of 4`,
      roleRead: 'You can read every screen. What you may change depends on your role.',
      password: 'Change password',
      current: 'Current password',
      next: 'New password',
      again: 'New password again',
      save: 'Save new password',
      mismatch: 'The two new passwords differ.',
      wrongCurrent: 'The current password is not right.',
      failed: "Couldn't change the password.",
      changed: (n: number) =>
        n === 1 ? 'Password changed. 1 other sign-in was ended.' : n === 0 ? 'Password changed. No other sign-ins were open.' : `Password changed. ${n} other sign-ins were ended.`,
      signOut: 'Sign out',
      signOutFailed: "Couldn't sign out.",
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

/** "1 Sep 2026" from a plant-clock ISO string or millisecond value (plant wall clock, no UTC marker shown). Built in lib/fmt. */
export function formatDate(at: string | number | Date): string {
  return fmtDate(at);
}

/** "14:30", or "14:30:05" when seconds are asked for. Built in lib/fmt. */
export function formatClock(at: string | number | Date, seconds = false): string {
  return seconds ? fmtTimeSec(at) : fmtTime(at);
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
  register: {
    rowsPart: 'the register rows',
    ledgerPart: 'the stock ledger',
    stockPart: 'the movements for this day',
    aroundPart: 'the cones between sacks',
    detailPart: 'this reading',
    unitWordSacks: 'sacks',
    unitWordKg: 'kg',
    weightFailRecord: 'weight-check record',
    retired: '(retired in PDAS)',
  },
  changeover: {
    loadingLists: 'the lists to pick from',
    loadingProducts: 'the products to retire',
    /*
     * Review step wording (fix-wave D19). Every value is an existing Plan label, by reference, so the
     * Review step says "Target weight" where the server sends setpointG. Keys with no entry here are
     * shown only inside the Technical detail disclosure (techDetail), never as prose.
     */
    stepWords: {
      /* step.step -> the word for the kind of step */
      step: {
        blend: C.changeover.blend,
        count: C.changeover.count,
        tube_type: C.changeover.tube,
        material: C.changeover.productName,
        pallet: null, // no existing Plan label for a pallet step; the action word and the label carry it
        retire_material: C.changeover.retireProduct,
        retire_pallet: C.changeover.retirePallet,
      } as Record<string, string | ((label: string, id: number) => string) | null>,
      /* step.detail key -> label of the value */
      detail: {
        tubeWeightG: C.changeover.tubeWeight,
        tubeForm: C.changeover.tubeForm,
        setpointG: C.changeover.setpoint,
        offsetMinusG: C.changeover.below,
        offsetPlusG: C.changeover.above,
        lot: C.changeover.productName,
        sackColour: C.changeover.sackColour,
      } as Record<string, string>,
    },
  },
  limits: {
    olderPart: 'older PDAS actions',
    loadingHistory: 'the limit versions',
    loadingProducts: 'the product list',
    loadingStatus: 'whether saving is allowed',
    loadingActions: 'the PDAS action history',
    loadingTimeline: 'the running-product record',
  },
  /* ---- Names drawn only inside a Technical detail disclosure (folded in from the screen's own strings file) ---- */
  systemTech: {
    /* The old Health batch table, verbatim by reference (fix-wave D18/P5), shown inside Technical detail. */
    batchesTitle: W.health.epochRegister.title,
    batchesNote: W.health.epochRegister.note,
    batchesNone: W.health.epochRegister.none,
    batchCol: {
      table: W.health.epochRegister.colTable,
      batch: W.health.epochRegister.colOrdinal,
      source: W.health.epochRegister.colProvenance,
      firstSeen: W.health.epochRegister.colFirstSeen,
      lastSeen: W.health.epochRegister.colLastSeen,
      status: W.health.epochRegister.colStatus,
      registeredBy: W.health.epochRegister.colBy,
      rows: W.health.epochRegister.colRows,
    },
    batchFirstSeenNote: W.health.epochRegister.firstSeenIsRegistration,
    batchLastSeenNote: W.health.epochRegister.lastSeenNeverRecorded,
    colGeneration: 'Generation',
    colTable: 'Table',
    colDatabase: 'IFL database',
    colRows: 'Rows',
    colSource: 'Source',
    colRegistered: 'Registered',
    colStatus: 'Status',
    open: 'Open',
    closed: (when: string) => `Closed ${when}`,
    rebuildsTitle: 'Rebuilds',
    rebuildsNone: 'No rebuild has been run.',
    rebuildRow: (table: string, from: number, to: number) => `${table}, transform v${from} to v${to}`,
    verifyAgainst: (server: string, db: string) => `Compared with ${server} / ${db}.`,
    subjectTable: (t: string) => `About: ${t}`,
    checkName: (n: string) => `Check: ${n}`,
    syncFeeds: 'Feed tables',
    colOutcome: 'Outcome',
    colBatch: 'Batch',
    colWritten: 'Rows written',
    colAge: 'Age',
  },
  registerParts: {
    unitKg: 'kg',
    colKgQty: 'kg',
  },
  productsParts: {
    status: {
      part: 'the PDAS connection status',
    },
    board: {
      defaultFailedPart: 'the default product',
      partMachines: 'the stations',
      partProducts: 'the product list',
      partCones: 'the cone counts',
      partDefault: 'the default product',
      machinesFailed: 'the station products',
    },
    catalogue: {
      id: (n: number) => `id ${n}`,
      tolerance: (plus: string) => `± ${plus}`,
      toleranceSplit: (minus: string, plus: string) => `-${minus} / +${plus}`,
      unknown: '—',
      dash: '—',
      palletsPart: 'the pallet list',
      productsPart: 'the product list',
      machinesPart: 'the station products',
    },
  },
  reportsParts: {
    preview: {
      failed: (title: string) => `the ${title} report`,
    },
  },
  systemParts: {
    diag: {
      feed: {
        sinceCheck: 'since the last check',
      },
      db: {
        answering: 'to answer',
      },
      backups: {
        daysSince: 'days since the newest',
      },
      service: {
        upFor: (span: string) => `running for ${span}`,
        appDrive: 'database',
        backupDrive: 'backup',
      },
      parts: {
        health: 'the system status',
        checks: 'the data checks',
        history: 'the data sources',
        counts: 'the record counts',
        period: 'the period',
      },
    },
  },
} as const;

/**
 * Joins a group of sentences in C with its lowercase fragments in FRAGMENTS (part names after "Couldn't load",
 * unit words, symbols). The two live apart so the sentence-case rule in copy.test.ts holds C to account; a
 * screen reads them as one object.
 */
export function withFragments<A extends object, B extends object>(a: A, b: B): A & B {
  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = v && typeof v === 'object' && cur && typeof cur === 'object' ? withFragments(cur as object, v as object) : v;
  }
  return out as A & B;
}
