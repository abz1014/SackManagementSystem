/* Strings for the write controls that have no row in copy.ts yet. */
export const WS = {
  stepsLabel: 'Steps',
  back: 'Back',
  next: 'Next',
  cancel: 'Cancel',
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  reasonCount: (n: number, min: number) => `${n} of ${min} characters minimum`,
  reasonOk: (n: number) => `${n} characters`,
} as const;

/** Server minimum for every PDAS write reason (api/src/services/pdasWrite.ts MIN_REASON_CHARS). */
export const REASON_MIN_CHARS = 10;
