/**
 * Wording for Products & PDAS, Board and Catalogue (task E9). Local to the screens, in the idiom of the
 * Today copy table: sentence case, GLOSSARY words ("station", never the machine word; "idle", never
 * "quiet" or "stale"). A server's own sentence (the PDAS reason, a refusal) is never written here: it is
 * printed as the server sent it.
 */
export const PC = {
  tabsLabel: 'Products and PDAS',

  status: {
    title: 'PDAS connection',
    part: 'the PDAS connection status',
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
} as const;
