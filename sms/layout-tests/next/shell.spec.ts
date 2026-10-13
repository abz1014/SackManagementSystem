/**
 * Shell (sidebar, phone tab bar, top bar, user menu, shared controls) on web-next.
 * Ports: css-001, css-002, css-007, css-028, css-039, css-058, css-059.
 * One test() per id; each loops over its cells and reports every failing cell at once.
 */
import { expect, test, type Page } from '@playwright/test';
import { openApp, pageOverflow, pokingOut, PD1, settle } from './support/page';

async function cell(page: Page, qs: string, w: number, h: number, scale = 1, extra: Record<string, unknown> = {}) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.addInitScript((s) => { try { localStorage.setItem('sms.uiScale', String(s)); } catch { /* ignore */ } }, scale);
  return openApp(page, qs, { width: w, height: h, ...extra });
}

test('css-001 every nav target is hit-testable and clear of the period chip (M-01)', async ({ page }) => {
  const bad: string[] = [];
  const cells: Array<[number, number, number, string]> = [
    [375, 812, 1, `s=today${PD1}`], [320, 700, 1, 's=today'], [600, 900, 1, `s=quality&t=weight${PD1}`], [820, 900, 1, `s=today${PD1}`], [900, 900, 1.3, 's=today'],
  ];
  for (const [w, h, scale, qs] of cells) {
    await cell(page, qs, w, h, scale);
    const res = await page.evaluate(() => {
      const items = [...document.querySelectorAll<HTMLElement>('.sh-side .sh-item, .sh-tabbar .sh-tab')].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0);
      const chip = document.querySelector('.pp-chip, [class*="pp-chip"]')?.getBoundingClientRect();
      return items.map((l) => {
        const r = l.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const onScreen = r.left >= -0.5 && r.right <= innerWidth + 0.5;
        const hitsChip = !!chip && r.left < chip.right && r.right > chip.left && r.top < chip.bottom && r.bottom > chip.top;
        return { text: (l.textContent ?? '').trim().slice(0, 14), ok: !!hit && (hit === l || l.contains(hit)), onScreen, hitsChip };
      });
    });
    if (res.length < 4) bad.push(`${w}@${scale}: only ${res.length} nav items found`);
    for (const r of res) if (!r.ok || !r.onScreen || r.hitsChip) bad.push(`${w}@${scale} "${r.text}" hit=${r.ok} onScreen=${r.onScreen} overlapsChip=${r.hitsChip}`);
    if ((await pageOverflow(page)) > 1) bad.push(`${w}@${scale}: page scrolls sideways; poking out: ${(await pokingOut(page)).slice(0, 3).join(' | ')}`);
  }
  expect(bad).toEqual([]);
});

test('css-002 the user menu stays fully on screen (M-02)', async ({ page }) => {
  const bad: string[] = [];
  const cells: Array<[number, number, number]> = [[320, 700, 1], [375, 812, 1], [600, 900, 1], [1050, 900, 1], [1366, 768, 1.3]];
  for (const [w, h, scale] of cells) {
    await cell(page, `s=today${PD1}`, w, h, scale);
    const btn = page.locator('.sh-user-btn:visible').first();
    if (!(await btn.count())) { bad.push(`${w}@${scale}: no visible user button`); continue; }
    await btn.click();
    const menu = page.locator('.sh-popover[role="menu"]');
    await menu.waitFor({ state: 'visible' });
    const m = await page.evaluate(() => {
      const r = document.querySelector('.sh-popover[role="menu"]')!.getBoundingClientRect();
      const items = [...document.querySelectorAll('.sh-popover [role="menuitem"]')].map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: (e.textContent ?? '').trim().slice(0, 12) }; });
      return { l: r.left, r: r.right, vw: document.documentElement.clientWidth, items };
    });
    if (m.l < 0 || m.r > m.vw + 0.5) bad.push(`${w}@${scale}: menu ${Math.round(m.l)}..${Math.round(m.r)} in ${m.vw}`);
    for (const i of m.items) if (i.l < 0 || i.r > m.vw + 0.5) bad.push(`${w}@${scale}: item "${i.t}" ${Math.round(i.l)}..${Math.round(i.r)}`);
  }
  expect(bad).toEqual([]);
});

test('css-007 toggles, tab strips and segmented controls never widen the phone page (M-06)', async ({ page }) => {
  const bad: string[] = [];
  const screens = [
    `s=today${PD1}`, `s=quality&t=weight&wt=cone&wm=time${PD1}`, `s=quality&t=rejects${PD1}`, `s=quality&t=stations${PD1}`,
    `s=quality&t=register&rl=cones${PD1}`, `s=products&t=board${PD1}`, `s=products&t=changeover`, `s=products&t=limits`, `s=reports&rt=daily${PD1}`, `s=system&t=diagnostics`,
  ];
  for (const w of [320, 375]) {
    for (const qs of screens) {
      await cell(page, qs, w, 812);
      const o = await pageOverflow(page);
      const out = await page.evaluate(() => [...document.querySelectorAll('.ui-seg, .ui-tabs, .sh-tabbar')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => String((e as HTMLElement).className).slice(0, 30)));
      if (o > 1 || out.length) bad.push(`${w} ${qs.split('&').slice(0, 2).join('&')}: overflow ${o}px, controls past the edge: ${out.join(',')}`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-028 the last nav target stays reachable between 901 and 945 px at text size 1.3 (M-01)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [901, 920, 945]) {
    for (const qs of [`s=today${PD1}`, 's=system&t=diagnostics']) {
      await cell(page, qs, w, 900, 1.3);
      const m = await page.evaluate(() => {
        const items = [...document.querySelectorAll<HTMLElement>('.sh-side .sh-item, .sh-tabbar .sh-tab')].filter((e) => e.offsetParent !== null);
        const last = items[items.length - 1];
        if (!last) return null;
        const r = last.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { right: r.right, left: r.left, covered: !(hit === last || last.contains(hit)), ov: document.documentElement.scrollWidth - innerWidth };
      });
      if (!m) bad.push(`${w} ${qs}: no nav items`);
      else if (m.ov > 1 || m.left < 0 || m.right > w || m.covered) bad.push(`${w} ${qs}: overflow=${m.ov} ${Math.round(m.left)}..${Math.round(m.right)} covered=${m.covered}`);
    }
  }
  expect(bad).toEqual([]);
});

test('css-039 Escape in the user menu returns focus to the user button (M-02)', async ({ page }) => {
  const bad: string[] = [];
  for (const w of [1366, 375]) {
    await cell(page, `s=today${PD1}`, w, 800);
    const btn = page.locator('.sh-user-btn:visible').first();
    await btn.click();
    await page.locator('.sh-popover[role="menu"]').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => ({ closed: !document.querySelector('.sh-popover[role="menu"]'), onBtn: !!document.activeElement?.closest('.sh-user-btn'), active: document.activeElement?.tagName + '.' + String((document.activeElement as HTMLElement)?.className).slice(0, 30) }));
    if (!m.closed) bad.push(`${w}: menu still open`);
    if (!m.onBtn) bad.push(`${w}: focus went to ${m.active}, not the user button`);
  }
  expect(bad).toEqual([]);
});

/** Controls that carry a selected state; `sel`/`other` are the selected and an unselected sibling. */
const SELECTABLE: Array<{ name: string; qs: string; sel: string; other: string }> = [
  { name: 'Segmented', qs: `s=quality&t=weight&wt=cone&wm=time${PD1}`, sel: '.ui-seg [aria-checked="true"], .ui-seg [aria-pressed="true"], .ui-seg__opt[data-selected], .ui-seg__opt.is-on', other: '.ui-seg [aria-checked="false"], .ui-seg [aria-pressed="false"]' },
  { name: 'Tabs', qs: `s=quality&t=weight${PD1}`, sel: '.ui-tabs [aria-selected="true"]', other: '.ui-tabs [aria-selected="false"]' },
  { name: 'Sidebar item', qs: `s=today${PD1}`, sel: '.sh-side [aria-current="page"], .sh-side .sh-item.is-on', other: '.sh-side .sh-item:not([aria-current])' },
];
const STYLE_PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderBottomColor', 'borderBottomWidth', 'outlineStyle', 'textDecorationLine', 'fontWeight', 'boxShadow'] as const;
const styleOf = (page: Page, sel: string) => page.locator(sel).first().evaluate((el, props) => { const cs = getComputedStyle(el); return Object.fromEntries(props.map((p) => [p, (cs as any)[p]])); }, STYLE_PROPS as unknown as string[]);

test('css-058 every selectable control shows a focus ring on keyboard focus (M-25)', async ({ page }) => {
  const bad: string[] = [];
  await cell(page, `s=quality&t=weight&wt=cone&wm=time${PD1}`, 1366, 800);
  const targets = ['.ui-seg button, .ui-seg [role="radio"], .ui-seg__opt', '.ui-tabs [role="tab"], .ui-tabs__tab', '.pp-chip, [class*="pp-chip"] button, button.pp-chip', '.sh-item'];
  for (const sel of targets) {
    const loc = page.locator(sel).filter({ visible: true }).first();
    if (!(await loc.count())) { bad.push(`${sel}: not found`); continue; }
    await loc.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab'); // arrives by keyboard so :focus-visible applies
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, cls: String(el.className).slice(0, 30), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, shadow: cs.boxShadow !== 'none' };
    });
    if (!ring || !(ring.outline || ring.shadow)) bad.push(`${sel}: focused ${ring?.tag}.${ring?.cls} has no outline or box-shadow ring`);
  }
  expect(bad).toEqual([]);
});

test('css-059 the selected state differs from the unselected one in forced-colours mode (M-25)', async ({ page }) => {
  const bad: string[] = [];
  await page.emulateMedia({ forcedColors: 'active' });
  for (const c of SELECTABLE) {
    await cell(page, c.qs, 1366, 800);
    await page.emulateMedia({ forcedColors: 'active' });
    if (!(await page.locator(c.sel).first().count()) || !(await page.locator(c.other).first().count())) { bad.push(`${c.name}: selected or unselected sibling not found (${c.sel} / ${c.other})`); continue; }
    const a = await styleOf(page, c.sel);
    const b = await styleOf(page, c.other);
    if (JSON.stringify(a) === JSON.stringify(b)) bad.push(`${c.name}: selected and unselected look identical in forced colours`);
  }
  await settle(page, 1000);
  expect(bad).toEqual([]);
});
