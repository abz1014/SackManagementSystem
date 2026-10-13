/**
 * Wording for Products > Limits & History. Local to the screen; held to the copy.test rules.
 * The server's own sentences (the write-status reason, error messages, the stored message of an
 * action) are never written here: they are printed as sent.
 */
export const LM = {
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
  guardNote: 'Guard limits are 3 % of the target and 20 g of an offset. They are developer defaults and not confirmed. The guard applies to saves in PDAS.',
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
  olderPart: 'older PDAS actions',

  timelineTitle: 'Products set as running in SMS',
  colProduct: 'Product',
  noTimeline: 'No product has been set as running in SMS yet.',

  loadingHistory: 'the limit versions',
  loadingProducts: 'the product list',
  loadingStatus: 'whether saving is allowed',
  loadingActions: 'the PDAS action history',
  loadingTimeline: 'the running-product record',
  noProducts: 'No products are recorded yet.',
} as const;

/** Every string, with sample arguments, for the wording test. */
export function collectStrings(node: unknown = LM, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'function') out.push((node as (...a: unknown[]) => string)('Aa', 2));
  // Keys named loading* / olderPart are lower-case fragments for "Couldn't load {part}", not sentences.
  else if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => { if (!/^(loading|olderPart)/.test(k)) collectStrings(v, out); });
  return out;
}
