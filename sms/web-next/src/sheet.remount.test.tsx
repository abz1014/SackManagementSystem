/**
 * Port of sms/web/src/sheet.remount.test.tsx to the redesign (fix-wave T6, TRACE B6-10).
 *
 * A sheet is an OVERLAY: opening one must not rebuild the screen under it. In the old app the screen's error
 * boundary was keyed on the sheet too, so every drilldown remounted the screen, every poll refetched from null,
 * and for a second the headline printed numbers it did not have ("0 weighed, 402 rejected by the scale (0%)").
 * Two guards:
 *  1. NO REMOUNT: a DOM node of the screen is the SAME node after a sheet opens and closes, and nothing is
 *     refetched (the register list is asked for exactly as often as before).
 *  2. THE IMPOSSIBLE PAIR: with the register's own count held in flight while the reject count answers, the
 *     headline never states a zero count and never states the other query's number. Every sentence the headline
 *     takes during the whole load is recorded and checked.
 * Mounts the real <App/> over the recorded fixtures (layout-tests/next/support/fixtures/api.json), manager rank.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import '../../web/src/testkit/render';
import { installDomStubs } from '../../web/src/testkit/domStubs';
import { installFakeFetch, type FakeFetch, type RouteRequest, type Routes } from '../../web/src/testkit/fetchRouter';
import { App } from './App';
import { navigate } from './appRoute';
import { parseRoute } from './route';

installDomStubs();

type Fx = Record<string, { status: number; body: any }>;
// jsdom's import.meta.url is not a file URL; resolve from this file's directory (vitest provides __dirname), else from sms/.
const SMS_ROOT = typeof __dirname === 'string' ? resolve(__dirname, '../..') : process.cwd();
const FX: Fx = JSON.parse(readFileSync(resolve(SMS_ROOT, 'layout-tests/next/support/fixtures/api.json'), 'utf8'));

const PERIOD_KEYS = new Set(['from', 'to', 'tsTo', 'asOf', 'at', 'fromShift', 'toShift', 'shift', 'periodFrom', 'periodTo', 'p', 'cmp', 'compare']);
const keyOf = (pathname: string, search: URLSearchParams) => {
  const kept = [...search.entries()].filter(([k]) => !PERIOD_KEYS.has(k)).sort(([a], [b]) => a.localeCompare(b));
  return pathname + (kept.length ? '?' + kept.map(([k, v]) => `${k}=${v}`).join('&') : '');
};
const body = (key: string) => {
  const f = FX[key];
  if (!f) throw new Error(`fixture ${key} missing; re-run capture-fixtures.mjs`);
  return f.body;
};

/** A fake-fetch route table answering every recorded pathname from the fixtures, with per-pathname replacements. */
export function fixtureRoutes(rank: string, overrides: Routes = {}): Routes {
  const routes: Routes = {};
  for (const key of Object.keys(FX)) {
    const pathname = key.split('?')[0]!;
    if (routes[pathname]) continue;
    routes[pathname] = (req: RouteRequest) => {
      const k = keyOf(req.pathname, req.search);
      const hit = FX[k] ?? FX[req.pathname] ?? Object.entries(FX).find(([x]) => x.startsWith(req.pathname + '?'))?.[1];
      if (!hit) throw new Error(`no fixture for ${k}`);
      return hit.body;
    };
  }
  routes['/api/auth/me'] = { user: { username: 'tester', displayName: 'Test User', role: rank } };
  routes['/api/auth/logout'] = { ok: true };
  return { ...routes, ...overrides };
}

let fake: FakeFetch | null = null;
afterEach(() => {
  cleanup();
  fake?.restore();
  fake = null;
  window.history.replaceState(null, '', '/');
});

const URL_REG = '/next/?s=quality&t=register&rl=cones&p=pick&from=2026-09-01&to=2026-09-01';
const sentence = (c: HTMLElement) => c.querySelector('main .ui-pagehead__sentence')?.textContent ?? '';
const isFailsCount = (r: RouteRequest) => r.search.get('inRange') === 'false' && r.search.get('pageSize') === '1';
const isList = (r: RouteRequest) => r.search.get('type') === 'cone' && !isFailsCount(r);

const LIST_BODY = body('/api/events?batch=auto&dir=desc&page=1&pageSize=100&sort=time&type=cone');
const FAILS_RECORDED = body('/api/events?batch=auto&dir=desc&inRange=false&page=1&pageSize=1&sort=time&type=cone');
// The recorded day has no weight rejects (total 0); the race needs a reject count that is not zero and not the list's.
const FAILS_BODY = { ...FAILS_RECORDED, data: { ...FAILS_RECORDED.data, total: 402 } };
const nf = (n: number) => n.toLocaleString('en-GB');

/** The two sentences the old headline printed mid-load: a zero count, or the other query's number alone. */
const isImpossible = (s: string, listTotal: number, failsTotal: number) =>
  /(^|[^\d,.])0 (cones|weighed|readings)/.test(s) || (s.includes(nf(failsTotal)) && !s.includes(nf(listTotal)));

describe('a drilldown sheet is an overlay, not a new screen (web-next)', () => {
  it('canary on the technique: a screen keyed on its sheet IS remounted and the identity check sees it; an unkeyed one is not', () => {
    function Toy({ keyed }: { keyed: boolean }) {
      const [sheet, setSheet] = useState<string | null>(null);
      return (
        <div>
          <button onClick={() => setSheet('cone:1')}>open</button>
          <section key={keyed ? String(sheet) : 'fixed'} data-testid="screen" />
        </div>
      );
    }
    for (const keyed of [true, false]) {
      const { container, unmount } = render(<Toy keyed={keyed} />);
      const before = container.querySelector('section');
      act(() => container.querySelector('button')!.click());
      expect(container.querySelector('section') === before, `keyed=${keyed}`).toBe(!keyed);
      unmount();
    }
  });

  it('canary on the oracle: the old impossible headlines are recognised, the honest ones are not', () => {
    expect(isImpossible('0 weighed, 402 rejected by the scale (0%).', 1000, 402)).toBe(true);
    expect(isImpossible('1 Sep 2026: 402 failed the weight check.', 1000, 402)).toBe(true);
    expect(isImpossible('1 Sep 2026: counting the readings in this period.', 1000, 402)).toBe(false);
    expect(isImpossible('1 Sep 2026: 1,000 cones weighed, 402 failed the weight check.', 1000, 402)).toBe(false);
  });

  it('canary: the fixtures carry a register list with rows and a distinct reject count', () => {
    expect(LIST_BODY.data.rows.length).toBeGreaterThan(5);
    expect(LIST_BODY.data.total).toBeGreaterThan(0);
    expect(FAILS_BODY.data.total).not.toBe(LIST_BODY.data.total);
  });

  it('does not remount the screen underneath when a sheet opens and closes, and refetches nothing', async () => {
    window.history.replaceState(null, '', URL_REG);
    fake = installFakeFetch(fixtureRoutes('manager'));
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('main table tbody tr')).toBeTruthy(), { timeout: 8000 });
    await waitFor(() => expect(sentence(container)).toContain(nf(LIST_BODY.data.total)), { timeout: 8000 });

    const table = container.querySelector('main table');
    const head = container.querySelector('main .ui-pagehead');
    const settledSentence = sentence(container);
    const listsBefore = fake.requests.filter((r) => r.startsWith('/api/events?') && r.includes('type=cone') && !r.includes('inRange=false')).length;
    expect(table && head).toBeTruthy();

    const id = String(LIST_BODY.data.rows[0].event_id);
    act(() => navigate({ ...parseRoute(new URLSearchParams(window.location.search)), sheet: { kind: 'cone', id } }));
    await waitFor(() => expect(document.querySelector('.ui-sheet-root, [role="dialog"]')).toBeTruthy(), { timeout: 8000 });

    expect(container.querySelector('main table')).toBe(table);
    expect(container.querySelector('main .ui-pagehead')).toBe(head);
    expect(sentence(container)).toBe(settledSentence);

    act(() => navigate({ ...parseRoute(new URLSearchParams(window.location.search)), sheet: null }));
    await waitFor(() => expect(document.querySelector('.ui-sheet-root [role="dialog"], .ui-sheet__body')).toBeNull(), { timeout: 8000 });
    expect(container.querySelector('main table')).toBe(table);
    expect(container.querySelector('main .ui-pagehead')).toBe(head);

    const listsAfter = fake.requests.filter((r) => r.startsWith('/api/events?') && r.includes('type=cone') && !r.includes('inRange=false')).length;
    expect(listsAfter, 'opening and closing an overlay asked the register for its rows again').toBe(listsBefore);
  });

  it('never prints a count it does not have: the register count held in flight while the reject count answers', async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    window.history.replaceState(null, '', URL_REG);
    fake = installFakeFetch(
      fixtureRoutes('manager', {
        '/api/events': async (req: RouteRequest) => {
          if (isFailsCount(req)) return FAILS_BODY;
          if (isList(req)) await held;
          return LIST_BODY;
        },
      }),
    );
    const { container } = render(<App />);
    const seen = new Set<string>();
    const record = () => {
      const s = sentence(container);
      if (s) seen.add(s);
    };
    const mo = new MutationObserver(record);
    mo.observe(container, { subtree: true, childList: true, characterData: true });

    await waitFor(() => expect(fake!.requests.some((r) => r.includes('inRange=false'))).toBe(true), { timeout: 8000 });
    await waitFor(() => expect(sentence(container)).not.toBe(''), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 120));
    record();
    const mid = sentence(container);
    expect(mid, 'the headline while the count is in flight').toMatch(/count|counting|loading/i);
    expect(mid).not.toMatch(/(^|[^\d,.])0 (cones|weighed|readings)/);
    expect(mid).not.toContain(nf(FAILS_BODY.data.total));

    release();
    await waitFor(() => expect(sentence(container)).toContain(nf(LIST_BODY.data.total)), { timeout: 8000 });
    record();
    mo.disconnect();

    const impossible = [...seen].filter((s) => isImpossible(s, LIST_BODY.data.total, FAILS_BODY.data.total));
    expect(impossible, `these headline sentences were printed with a count the screen did not have: ${JSON.stringify(impossible)}`).toEqual([]);
  });
});
