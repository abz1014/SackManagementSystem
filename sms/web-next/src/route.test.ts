import { describe, expect, it } from 'vitest';
import { RANK4_TABS, SCREENS, TABS, legacyRedirect, parseRoute, writeRoute } from './route';

const q = (s: string) => new URLSearchParams(s);
const redir = (s: string) => {
  const r = legacyRedirect(q(s));
  return r ? Object.fromEntries(r.entries()) : null;
};

describe('legacyRedirect, one case per IA-MAP section 3 row', () => {
  it('s=line', () => expect(redir('s=line')).toEqual({ s: 'today' }));
  it('s=readings keeps listing keys', () =>
    expect(redir('s=readings&rl=sacks&rf=outsideLimits&rcs=low,high&rp=3&st=5')).toEqual({
      s: 'quality', t: 'register', rl: 'sacks', rf: 'outsideLimits', rcs: 'low,high', rp: '3', st: '5',
    }));
  it('s=weight keeps wm wt st', () =>
    expect(redir('s=weight&wm=time&wt=sack&st=2')).toEqual({ s: 'quality', t: 'weight', wm: 'time', wt: 'sack', st: '2' }));
  it('s=weight with station sheet', () =>
    expect(redir('s=weight&sheet=station:7')).toEqual({ s: 'quality', t: 'weight', sheet: 'station:7' }));
  it('s=rejects keeps jc st pr', () =>
    expect(redir('s=rejects&jc=12&st=3&pr=9')).toEqual({ s: 'quality', t: 'rejects', jc: '12', st: '3', pr: '9' }));
  it('s=sacks keeps su', () => expect(redir('s=sacks&su=kg')).toEqual({ s: 'today', su: 'kg' }));
  it('s=sacks&sp=N', () =>
    expect(redir('s=sacks&sp=4')).toEqual({ s: 'quality', t: 'register', rl: 'sacks', rp: '4' }));
  it('s=sacks with stock sheet', () =>
    expect(redir('s=sacks&sheet=stock:2026-09-01')).toEqual({
      s: 'quality', t: 'register', rl: 'stock', sheet: 'stock:2026-09-01',
    }));
  it('s=product', () => expect(redir('s=product')).toEqual({ s: 'products', t: 'board' }));
  it.each([
    ['running', 'board'],
    ['changeover', 'changeover'],
    ['catalogue', 'catalogue'],
    ['history', 'history'],
  ])('s=product&pt=%s', (pt, t) => expect(redir(`s=product&pt=${pt}`)).toEqual({ s: 'products', t }));
  it('s=product&pt=catalogue&pr=ID', () =>
    expect(redir('s=product&pt=catalogue&pr=21')).toEqual({ s: 'products', t: 'catalogue', pr: '21' }));
  it('sheet=product:* (with and without s)', () => {
    expect(redir('sheet=product:current')).toEqual({ s: 'products', t: 'board' });
    expect(redir('s=line&sheet=product:current')).toEqual({ s: 'products', t: 'board' });
  });
  it('s=report keeps rt rsh st pr', () =>
    expect(redir('s=report&rt=daily&rsh=night&st=1&pr=2')).toEqual({
      s: 'reports', rt: 'daily', rsh: 'night', st: '1', pr: '2',
    }));
  it('s=report with no rt opens the daily report (P3)', () => expect(redir('s=report')).toEqual({ s: 'reports', rt: 'daily' }));
  it.each(['shift', 'product', 'station', 'sack'])('s=report&rt=%s keeps rt', (rt) =>
    expect(redir(`s=report&rt=${rt}`)).toEqual({ s: 'reports', rt }));
  it('s=health', () => expect(redir('s=health')).toEqual({ s: 'system', t: 'diagnostics' }));
  it('s=setup', () => expect(redir('s=setup')).toEqual({ s: 'system', t: 'setup' }));
  it('s=wall', () => expect(redir('s=wall')).toEqual({ s: 'today', wall: '1' }));
  it('p from to at sheet pass through', () =>
    expect(redir('s=readings&p=range&from=2026-09-01&to=2026-09-02&at=2026-09-03T00:00:00Z&sheet=cone:55')).toEqual({
      s: 'quality', t: 'register', p: 'range', from: '2026-09-01', to: '2026-09-02', at: '2026-09-03T00:00:00Z', sheet: 'cone:55',
    }));
  it('unknown s redirects to today', () => expect(redir('s=nonsense&p=week')).toEqual({ s: 'today', p: 'week' }));
  it('new-model URLs and bare URLs are not rewritten', () => {
    expect(legacyRedirect(q('s=quality&t=weight'))).toBeNull();
    expect(legacyRedirect(q(''))).toBeNull();
  });
});

describe('parseRoute / writeRoute', () => {
  it('unknown or missing s -> today', () => {
    expect(parseRoute(q('s=bogus')).s).toBe('today');
    expect(parseRoute(q('')).s).toBe('today');
  });
  it('default and invalid tabs', () => {
    expect(parseRoute(q('s=quality')).t).toBe('weight');
    expect(parseRoute(q('s=products&t=zzz')).t).toBe('board');
    expect(parseRoute(q('s=system')).t).toBe('diagnostics');
    expect(parseRoute(q('s=reports&t=weight')).t).toBeNull();
    expect(parseRoute(q('s=today')).t).toBeNull();
  });
  it('wall only on today', () => {
    expect(parseRoute(q('s=today&wall=1')).wall).toBe(true);
    expect(parseRoute(q('s=quality&wall=1')).wall).toBe(false);
  });
  it('lists the rank-4 tabs', () => {
    expect(RANK4_TABS).toEqual([{ s: 'system', t: 'setup' }]);
    expect(TABS.system).toContain('setup');
  });
  it('every screen and tab round-trips', () => {
    for (const s of SCREENS) {
      const tabs: readonly (string | null)[] = (TABS as Record<string, readonly string[]>)[s] ?? [null];
      for (const t of tabs) {
        const r = { s, t, sheet: null, wall: false, keys: {} };
        expect(parseRoute(writeRoute(r))).toEqual(r);
      }
    }
  });
  it('every section 2.3 key round-trips untouched', () => {
    const keys = {
      p: 'range', from: '2026-09-01', to: '2026-09-02', at: '2026-09-03T00:00:00Z', rf: 'outsideLimits', rl: 'stock',
      rcs: 'low,high', rp: '3', st: '5', pr: '9', wm: 'dist', wt: 'sack', jc: '12', su: 'kg', rt: 'daily', rsh: 'night',
    };
    const r = { s: 'quality' as const, t: 'register', sheet: { kind: 'cone' as const, id: '55' }, wall: false, keys };
    expect(parseRoute(writeRoute(r))).toEqual(r);
  });
  it('wall flag and every sheet kind round-trip', () => {
    expect(parseRoute(writeRoute({ s: 'today', t: null, sheet: null, wall: true, keys: {} })).wall).toBe(true);
    for (const kind of ['station', 'cone', 'sack', 'reject', 'reason', 'stock'] as const) {
      const r = { s: 'today' as const, t: null, sheet: { kind, id: 'x:1' }, wall: false, keys: {} };
      expect(parseRoute(writeRoute(r))).toEqual(r);
    }
  });
  it('redirected output parses to the intended route with keys kept', () => {
    const r = parseRoute(legacyRedirect(q('s=sacks&sp=4&su=kg&p=week'))!);
    expect(r).toEqual({ s: 'quality', t: 'register', sheet: null, wall: false, keys: { rl: 'sacks', rp: '4', su: 'kg', p: 'week' } });
  });
});
