/**
 * Words for Quality > Register, the record sheets and the sack stock ledger (task E8).
 * Local until integration folds them into copy.ts. Same rules as copy.ts: sentence case, none of the
 * pipeline words GLOSSARY 1.7 bans, and never a bare "rejected" (a check is named, with its denominator).
 * Owner-reserved sack-stock wording is NOT written here: it is read from RESERVED at the use site.
 */
export const R = {
  question: 'Every cone and sack that was weighed, with the ones that failed a check marked.',
  listingLabel: 'What to list',
  listings: {
    cones: 'Cones',
    sacks: 'Sacks',
    inspectionRejects: 'Inspection fails',
    rejected: 'Weight-check fails',
    stock: 'Sack stock',
  },

  /* count lines (a count that has not arrived is never printed as zero) */
  countFailed: "Couldn't load this period's count. The plant connection may be down.",
  countPending: (what: string) => `${what}: counting the readings in this period.`,
  conesWeighed: (what: string, n: string) => `${what}: ${n} cones weighed.`,
  sacksWeighed: (what: string, n: string) => `${what}: ${n} sacks weighed.`,
  inspectionFails: (what: string, n: string) => `${what}: ${n} cones failed inspection.`,
  weightFails: (what: string, n: string) => `${what}: ${n} cones failed the weight check (scale).`,
  filteredCones: (what: string, n: string, states: string) => `${what}: ${n} cones, ${states}.`,
  outsideLimits: (what: string, n: string) => `${what}: ${n} cones passed by the scale but outside the product limits.`,
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
  unitKg: 'kg',
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
  colKgQty: 'kg',
  colWho: 'Recorded by',
  colWhy: 'Why',
  nobody: 'Not recorded',
  recordedAtOn: (when: string) => `Recorded ${when}`,

  /* reading sheets */
  coneTitle: 'Cone',
  sackTitle: 'Sack',
  rejectTitle: 'Inspection fail',
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
} as const;

/** Fragments that sit inside a sentence (a part name after "Couldn't load", a unit word, a marker): lower case by design, outside the sentence rules. */
export const RF = {
  rowsPart: 'the register rows',
  ledgerPart: 'the stock ledger',
  stockPart: 'the movements for this day',
  aroundPart: 'the cones between sacks',
  detailPart: 'this reading',
  unitWordSacks: 'sacks',
  unitWordKg: 'kg',
  weightFailRecord: 'weight-check record',
  retired: '(retired in PDAS)',
} as const;
