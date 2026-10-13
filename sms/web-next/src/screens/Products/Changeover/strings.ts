/**
 * Wording for Products > Changeover. Local to the screen; held to the copy.test rules
 * (sentence case, no pipeline words, no "machine", no bare "rejected"). The server's own
 * sentences (blockers, warnings, the no-rollback line, the operator note, the disabled
 * reason, errors) are NEVER written here: they are printed as the server sent them.
 */
export const CO = {
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

  loadingLists: 'the lists to pick from',
  loadingProducts: 'the products to retire',
  noPickers: 'The pickers could not load, so a plan cannot be made yet.',
} as const;

/** Every string, with sample arguments, for the wording test. */
export function collectStrings(node: unknown = CO, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'function') out.push((node as (...a: unknown[]) => string)('Aa', 2));
  // Keys named loading* / olderPart are lower-case fragments for "Couldn't load {part}", not sentences.
  else if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => { if (!/^(loading|olderPart)/.test(k)) collectStrings(v, out); });
  return out;
}
