/**
 * URL model for the redesigned IA (design/redesign-2026-10/IA-MAP.md sections 1, 2.3, 3).
 * Pure functions over URLSearchParams; no window access, so they are testable in node.
 */

export const SCREENS = ['today', 'quality', 'products', 'reports', 'system'] as const;
export type Screen = (typeof SCREENS)[number];

/** Tabs per screen; the first entry is the default. Screens absent here have no tabs. */
export const TABS = {
  quality: ['weight', 'rejects', 'stations', 'register'],
  products: ['board', 'changeover', 'catalogue', 'limits', 'history'],
  system: ['diagnostics', 'setup', 'account'],
} as const satisfies Partial<Record<Screen, readonly string[]>>;

/** Tabs that exist only for rank 4 (admin). Gating itself is done by the shell, not here. */
export const RANK4_TABS: ReadonlyArray<{ s: Screen; t: string }> = [{ s: 'system', t: 'setup' }];

export const SHEET_KINDS = ['station', 'cone', 'sack', 'reject', 'reason', 'stock'] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];
export interface SheetRef {
  kind: SheetKind;
  id: string;
}

export interface Route {
  s: Screen;
  /** Tab within the screen; null when the screen has no tabs. */
  t: string | null;
  sheet: SheetRef | null;
  /** Wall display flag; only meaningful on Today. */
  wall: boolean;
  /** Every other key (p, from, to, at, st, pr, rf, rl, rcs, rp, wm, wt, jc, su, rt, rsh ...), untouched. */
  keys: Record<string, string>;
}

const isScreen = (v: string | null): v is Screen => !!v && (SCREENS as readonly string[]).includes(v);

function tabsOf(s: Screen): readonly string[] | undefined {
  return (TABS as Partial<Record<Screen, readonly string[]>>)[s];
}

export function defaultTab(s: Screen): string | null {
  const tabs = tabsOf(s);
  return tabs ? tabs[0]! : null;
}

function parseSheet(raw: string | null): SheetRef | null {
  const m = raw?.match(/^(station|cone|sack|reject|reason|stock):(.+)$/);
  return m ? { kind: m[1] as SheetKind, id: m[2]! } : null;
}

const RESERVED = new Set(['s', 't', 'sheet', 'wall']);

/** Read a (new-model) URL. Unknown s falls back to today; unknown t to the screen's default tab. */
export function parseRoute(sp: URLSearchParams): Route {
  const raw = sp.get('s');
  const s: Screen = isScreen(raw) ? raw : 'today';
  const tabs = tabsOf(s);
  const tRaw = sp.get('t');
  const t = tabs ? (tRaw && tabs.includes(tRaw) ? tRaw : tabs[0]!) : null;
  const keys: Record<string, string> = {};
  sp.forEach((v, k) => {
    if (!RESERVED.has(k)) keys[k] = v;
  });
  return { s, t, sheet: parseSheet(sp.get('sheet')), wall: s === 'today' && sp.get('wall') === '1', keys };
}

/** Write a route back to a query. parseRoute(writeRoute(r)) equals r for any valid r. */
export function writeRoute(r: Route): URLSearchParams {
  const p = new URLSearchParams();
  p.set('s', r.s);
  if (r.t) p.set('t', r.t);
  for (const [k, v] of Object.entries(r.keys)) if (!RESERVED.has(k)) p.set(k, v);
  if (r.sheet) p.set('sheet', `${r.sheet.kind}:${r.sheet.id}`);
  if (r.s === 'today' && r.wall) p.set('wall', '1');
  return p;
}

const PRODUCT_TABS: Record<string, string> = {
  running: 'board',
  changeover: 'changeover',
  catalogue: 'catalogue',
  history: 'history',
};

/**
 * IA-MAP section 3. Returns the rewritten query for a legacy URL, or null when the URL is
 * already in the new model, or carries no `s` at all (parseRoute then defaults to today and
 * nothing needs rewriting). Every key not named below is preserved.
 */
export function legacyRedirect(sp: URLSearchParams): URLSearchParams | null {
  const out = new URLSearchParams(sp);
  const sheet = sp.get('sheet');
  const raw = sp.get('s');

  // Deleted product sheet: any sheet=product:* goes to Products > Board.
  if (sheet?.startsWith('product:')) {
    out.delete('sheet');
    out.set('s', 'products');
    out.set('t', 'board');
    return out;
  }
  if (raw === null || isScreen(raw)) return null;

  switch (raw) {
    case 'readings':
      out.set('s', 'quality');
      out.set('t', 'register');
      break;
    case 'weight':
      out.set('s', 'quality');
      out.set('t', 'weight');
      break;
    case 'rejects':
      out.set('s', 'quality');
      out.set('t', 'rejects');
      break;
    case 'sacks': {
      const stock = sheet?.startsWith('stock:') ?? false;
      const page = sp.get('sp');
      if (stock) {
        out.set('s', 'quality');
        out.set('t', 'register');
        out.set('rl', 'stock');
        out.delete('sp');
      } else if (page !== null) {
        out.set('s', 'quality');
        out.set('t', 'register');
        out.set('rl', 'sacks');
        out.delete('sp');
        out.set('rp', page);
      } else {
        out.set('s', 'today');
      }
      break;
    }
    case 'product': {
      const pt = sp.get('pt');
      out.set('s', 'products');
      out.set('t', (pt && PRODUCT_TABS[pt]) || 'board');
      out.delete('pt');
      break;
    }
    case 'report':
      out.set('s', 'reports');
      if (!out.get('rt')) out.set('rt', 'daily');
      break;
    case 'health':
      out.set('s', 'system');
      out.set('t', 'diagnostics');
      break;
    case 'setup':
      out.set('s', 'system');
      out.set('t', 'setup');
      break;
    case 'wall':
      out.set('s', 'today');
      out.set('wall', '1');
      break;
    default: // 'line' and any unknown value
      out.set('s', 'today');
      break;
  }
  return out;
}
