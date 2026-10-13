/*
 * Words for the Today screen (task E2).
 *
 * Kept beside the screen, not in copy.ts, because five screens are being built at once and copy.ts
 * would carry all of their uncommitted groups. Same rules as copy.ts C (GLOSSARY): sentence case, no
 * all-caps, no ellipsis, no bare "rejected", no pipeline vocabulary. todayCopy.test.ts applies the same
 * banned-word list to every string here. Owner-reserved wording is referenced from copy.ts RESERVED
 * and from words.ts, never copied.
 */
import { C } from '../../copy';

export const T = {
  title: C.nav.today,
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
    plantTime: 'plant time',
    comparedWith: (what: string) => `compared with ${what}`,
    comparisonMissing: "The comparison period didn't load, so no changes are shown.",
    updatedLive: 'This period is still running. Counts grow until it ends.',
  },

  kpi: {
    cones: 'Cones',
    sacks: 'Sacks',
    packed: 'Packed',
    kg: 'kg',
    percent: '%',
    coneCount: (n: string) => `${n} cones`,
    ofCones: (n: string, total: string) => `${n} of ${total} cones`,
    partName: 'the totals',
    couldNotRead: 'Could not be read',
    soFar: 'so far',
    points: (v: string) => `${v} points`,
    vsCount: (prev: string) => `vs ${prev}`,
    vsKg: (prev: string) => `vs ${prev} kg`,
    vsRate: (prev: string) => `vs ${prev} %`,
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
    partName: 'the station states',
    stationsWord: (n: number) => (n === 1 ? 'Station' : 'Stations'),
    none: 'No stations reported in this period.',
  },

  productChange: {
    changed: (station: string, product: string | null) =>
      product ? `${station} changed product to ${product}.` : `${station} changed product.`,
    firstCone: (when: string) => `Its first cone of the new product was at ${when}.`,
    others: (n: number) => (n === 1 ? '1 other station also changed product.' : `${n} other stations also changed product.`),
    link: 'See products by station',
    partName: 'the product changes',
    sinceAtLeast: (when: string) => `since at least ${when}`,
    since: (when: string) => `since ${when}`,
  },

  shifts: {
    title: (spread: 'day' | 'shift') => (spread === 'day' ? 'Cones per day' : 'Cones per shift'),
    unit: 'cones',
    series: 'Cones',
    caption: (period: string, total: string, sacks: string | null) =>
      `Plant time, ${period}. Total ${total} cones.${sacks ? ` ${sacks}` : ''}`,
    sacksBy: (parts: string) => `Sacks packed: ${parts}.`,
    partName: 'the cones chart',
    onePoint: (spread: 'day' | 'shift') =>
      spread === 'day' ? 'Only one production day has cones, so there is no shape to draw.' : 'Only one shift has cones, so there is no shape to draw.',
  },

  reasons: {
    title: 'Failed inspection by reason',
    unit: 'cones',
    caption: (period: string, total: string) => `${period}. ${total} cones in total.`,
    unnamed: (tube: number | null, mat: number | null) => `Code ${tube ?? '?'}/${mat ?? '?'} (not named yet)`,
    partName: 'the failed inspection reasons',
    none: 'No cones failed inspection in this period.',
  },

  attention: {
    caption: (days: number, from: string, to: string) => `Last ${days} production days (${from} to ${to}). The period above does not change this list.`,
    partName: 'the attention check',
    tooFew: (days: number) => `Only ${days} production days are on record, too few for the drift test to say anything.`,
    more: (n: number) => (n === 1 ? '1 more finding on Quality.' : `${n} more findings on Quality.`),
    openQuality: 'Open Quality',
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
    partName: 'the latest readings',
    none: 'No readings yet.',
    unknownStation: 'Station not recorded',
  },

  sacks: {
    title: 'Sacks',
    unitLabel: 'Show sacks as',
    unitSacks: 'Sacks',
    unitKg: 'kg',
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
    partName: 'the sack summary',
    productsPartName: 'the product names',
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
    openDiagnostics: 'Open Diagnostics',
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
    productStamped: "A station's product is the last product it stamped on a cone, not a setting read from the machine.",
    lookback: 'Where no product change was found in the look-back window, a product is described as running since at least its first cone in that window, never as a start time.',
    plantTimes: 'Times are plant time.',
    notLoaded: (parts: string) => `Not loaded at the moment: ${parts}. The figures above that did load are unaffected.`,
    detectors: (days: number | null, g: string | null, held: number | null) =>
      `Needs attention is judged over the last ${days ?? 'few'} production days, not the selected period, because the station tests need consecutive days. A station is named when it has held one side of the line by at least ${g ?? 'the drift limit'} for ${held ?? 'several'} days or more.`,
    lag: (lag: string, stop: string) =>
      `The line is judged against the newest reading rather than the clock, because the plant writes a cone's row about ${lag} after it is weighed. It reads as stopped once that gap exceeds ${stop}.`,
  },
} as const;
