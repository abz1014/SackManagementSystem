/**
 * Every word the floor and wall screens show, in one place.
 *
 * IFL's first reaction to the app (2 Sep 2026) was that it was too complicated
 * for a non-technical floor worker. Part of that is vocabulary: the analysis
 * screens speak in OEE, Cpk, sigma bands and control limits. These screens use
 * short, plain words, and keep them here rather than inline so an Urdu (or
 * bilingual) set can be added as a second object without touching a screen.
 * Nothing on the floor or wall screens should render a string that is not in
 * this file.
 */
export const S = {
  // navigation
  now: 'Now',
  sacks: 'Sacks',
  cones: 'Cones',
  wall: 'Wall',
  analysis: 'Analysis',
  back: 'Back',
  exitWall: 'Exit wall mode',

  // line state
  running: 'Running',
  stopped: 'Stopped',
  noReadings: 'No readings',
  noData: 'No data yet',
  noDataDetail: 'Nothing has been received from the plant yet.',
  runningFor: 'for',
  lastConeAgo: 'last cone',
  since: 'since',
  stoppedAt: 'stopped at',

  // shift
  shift: { morning: 'Morning shift', evening: 'Evening shift', night: 'Night shift' } as const,
  shiftShort: { morning: 'Morning', evening: 'Evening', night: 'Night' } as const,
  shiftStarted: 'started',
  shiftEnds: 'ends',
  plantTime: 'Plant time',

  // counters
  conesThisShift: 'Cones this shift',
  sacksThisShift: 'Sacks this shift',
  rejectedThisShift: 'Rejected cones',
  thisShift: 'this shift',
  perHour: 'per hour',
  inWeightRange: 'in weight range',
  totalKg: 'total',
  last10Min: 'Cones, last 10 min',
  lastHourCones: 'Cones, last hour',
  lastHourSacks: 'Sacks, last hour',
  noneYet: 'none yet',

  // last readings
  lastSack: 'Last sack',
  lastCone: 'Last cone',
  lastReject: 'Last reject',
  sack: 'Sack',
  cone: 'Cone',
  station: 'Station',
  stations: 'Winding stations',
  stationsNote: 'Cones per station this shift. A dim station has not produced in the last 5 minutes.',
  hanger: 'Hanger',
  weight: 'Weight',
  time: 'Time',
  ok: 'OK',
  out: 'OUT',
  outOfRange: 'Out of weight range',
  inRange: 'In weight range',
  weighedAt: 'Weighed',
  recordNo: 'Record no.',
  open: 'Open',

  // lists
  scope: { shift: 'This shift', today: 'Today', yesterday: 'Yesterday', day: 'Pick a day' } as const,
  scopeNote: {
    shift: 'since the shift started',
    today: 'the current production day (06:00 to 06:00)',
    yesterday: 'the previous production day',
    day: 'one production day',
  } as const,
  newestFirst: 'newest first',
  showMore: 'Show more',
  nothingInScope: 'Nothing recorded in this period.',
  live: 'Live',
  rows: (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`,

  // record card
  conesBeforeSack: 'Cones weighed between the previous sack and this one',
  conesBeforeSackNote:
    'Approximate. The plant does not record which cones go into which sack, so this is the cones weighed in that time, not a packing list.',
  nextSackAfterCone: 'Next sack weighed after this cone',
  nextSackNote: 'Approximate, for the same reason: the plant records no link from a cone to a sack.',
  noPreviousSack: 'No earlier sack on record, so the 10 minutes before this one are shown.',
  notFound: 'This record was not found.',
  loading: 'Loading…',

  // freshness
  updated: 'Updated',
  justNow: 'just now',
  plantLink: 'Plant data synced',
  replayBanner: 'REPLAY — showing the plant as it was at',
  replayNote: 'This is not live.',
  offline: 'Could not reach the server — showing the last numbers received.',
  ago: 'ago',
} as const;
