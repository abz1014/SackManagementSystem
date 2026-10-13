/**
 * Shell-only words that copy.ts (C) does not carry yet: sidebar group names, control labels, health-dot
 * short labels. Everything C or the bridged W already says is read from there, not repeated here.
 */
export const SHELL = {
  appName: 'SMS',
  plant: 'Ibrahim Fibres, TP1 Line 3',
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
  pageFailed: 'this page',
  closeMenu: 'Close',
  health: {
    title: 'Data status',
    ok: 'Data current',
    late: 'Data late',
    lagUnknown: 'Delay unknown',
    stale: 'Data stale',
    none: 'No data',
    unknown: 'Status unknown',
    unknownSentence: "Couldn't read the data status. Check the plant connection.",
    open: 'Open Diagnostics',
  },
} as const;
