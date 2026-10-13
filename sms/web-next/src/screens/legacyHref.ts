/**
 * The same view in the current (old) app, for screens that are not rebuilt yet.
 * The reverse of route.ts legacyRedirect: new (s, t) back to the old `s` / `pt` /
 * sheet vocabulary. Every other key (period, filters, `at`) is passed through, so
 * the old app opens on the same period. The old app is served at the site root.
 */
import { SHEET_KINDS, type Route } from '../route';

const OLD_SCREEN: Record<string, { s: string; pt?: string }> = {
  'today/': { s: 'line' },
  'quality/weight': { s: 'weight' },
  'quality/stations': { s: 'weight' },
  'quality/rejects': { s: 'rejects' },
  'quality/register': { s: 'readings' },
  'products/board': { s: 'product', pt: 'running' },
  'products/changeover': { s: 'product', pt: 'changeover' },
  'products/catalogue': { s: 'product', pt: 'catalogue' },
  'products/limits': { s: 'product', pt: 'catalogue' },
  'products/history': { s: 'product', pt: 'history' },
  'reports/': { s: 'report' },
  'system/diagnostics': { s: 'health' },
  'system/setup': { s: 'setup' },
  'system/account': { s: 'line' },
};

export function legacyHref(route: Route): string {
  const target = route.wall ? { s: 'wall' } : (OLD_SCREEN[`${route.s}/${route.t ?? ''}`] ?? { s: 'line' });
  const p = new URLSearchParams();
  p.set('s', target.s);
  if (target.pt) p.set('pt', target.pt);
  for (const [k, v] of Object.entries(route.keys)) p.set(k, v);
  if (route.sheet && (SHEET_KINDS as readonly string[]).includes(route.sheet.kind)) {
    p.set('sheet', `${route.sheet.kind}:${route.sheet.id}`);
  }
  return `/?${p.toString()}`;
}
