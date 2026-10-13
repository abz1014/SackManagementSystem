/*
 * Small strings the general components need that have no row in copy.ts yet.
 * Sentences that exist in copy.ts (C) are used from there, not repeated.
 */
export const U = {
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
  checkDiagnostics: 'Check Diagnostics',
  diagnosticsHref: '?s=system&t=diagnostics',
  aboutFigures: 'About these figures',
  dismiss: 'Dismiss',
} as const;
