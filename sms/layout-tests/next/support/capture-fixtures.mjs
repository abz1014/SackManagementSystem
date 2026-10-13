/**
 * Records small API fixtures for the web-next Playwright port (fix-wave T6).
 *
 *   SMS_CAPTURE_URL=http://127.0.0.1:<port> SMS_CAPTURE_COOKIE=<render token> node capture-fixtures.mjs
 *
 * Run it against a READ-ONLY copy only (the audit harness serving sms_audit). It performs GET navigation only:
 * it opens each web-next page in Edge, records every GET /api/* response, and writes ./fixtures/api.json.
 * It refuses :4000 and :5173. The specs never use this file at run time.
 *
 * Fixtures are keyed by pathname plus the query with the period params removed (so one body serves any period),
 * arrays are cut to 48 items, and operator names are replaced with stable pseudonyms (operator-1, ...).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SMS_CAPTURE_URL;
const COOKIE = process.env.SMS_CAPTURE_COOKIE;
if (!BASE || !COOKIE) throw new Error('set SMS_CAPTURE_URL and SMS_CAPTURE_COOKIE (a read-only harness)');
const u = new URL(BASE);
if (['4000', '5173'].includes(u.port)) throw new Error('refusing the owner ports 4000 and 5173');

const PERIOD_KEYS = new Set(['from', 'to', 'tsTo', 'asOf', 'at', 'fromShift', 'toShift', 'shift', 'periodFrom', 'periodTo', 'p', 'cmp', 'compare']);
export const keyOf = (pathname, search) => {
  const sp = new URLSearchParams(search);
  const kept = [...sp.entries()].filter(([k]) => !PERIOD_KEYS.has(k)).sort(([a], [b]) => a.localeCompare(b));
  return pathname + (kept.length ? '?' + kept.map(([k, v]) => `${k}=${v}`).join('&') : '');
};

const PD1 = '&p=pick&from=2026-09-01&to=2026-09-01';
const PL = '&p=pick&from=2026-08-05&to=2026-09-07';
const RT = ['management-summary', 'daily', 'shift', 'shift-production', 'reject', 'rejected-cones', 'rejected-hangers', 'rejected-unknown-lifter', 'rejected-sacks', 'sack-weight-summary', 'sack', 'sack-weight-range', 'sps-packing', 'machine-product', 'product', 'cone-weight', 'station', 'calibration'];
const reason = encodeURIComponent('reason:2026-09-01|quality|2|1');
const PAGES = [
  's=today', 's=today&cmp=prev', 's=today&wall=1',
  's=quality&t=weight&wt=cone&wm=time', 's=quality&t=weight&wt=cone&wm=dist', 's=quality&t=weight&wt=sack&wm=time', 's=quality&t=weight&wt=sack&wm=dist',
  's=quality&t=rejects', 's=quality&t=stations',
  's=quality&t=register&rl=cones', 's=quality&t=register&rl=sacks', 's=quality&t=register&rl=rejected', 's=quality&t=register&rl=stock',
  's=quality&t=stations&sheet=station%3A8', 's=quality&t=rejects&sheet=' + reason, 's=quality&t=register&rl=stock&sheet=stock%3A2026-09-01',
  's=products&t=board', 's=products&t=catalogue', 's=products&t=changeover', 's=products&t=limits', 's=products&t=history',
  's=reports', ...RT.map((t) => 's=reports&rt=' + t),
  's=system&t=diagnostics', 's=system&t=setup', 's=system&t=account',
].flatMap((q) => (q.includes('wall') ? [q + PD1] : [q + PD1, q + PL])).filter((q) => !process.env.SMS_CAPTURE_ONLY || new RegExp(process.env.SMS_CAPTURE_ONLY).test(q));

const names = new Map();
const pseudo = (v) => {
  if (!names.has(v)) names.set(v, `operator-${names.size + 1}`);
  return names.get(v);
};
const PERSON_KEY = /^(username|displayName|operator|user|generatedBy|changedBy|setBy|registeredBy|recordedBy|acknowledgedBy|createdBy|enteredBy|updatedBy)$/;
function clean(v, key = '') {
  if (Array.isArray(v)) return v.slice(0, 48).map((x) => clean(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, k)]));
  if (typeof v === 'string' && PERSON_KEY.test(key) && v.trim() !== '') return pseudo(v);
  if (typeof v === 'string' && /[\w.+-]+@[\w-]+\.[\w.]+/.test(v)) return '[email removed]';
  return v;
}

const MERGE = process.env.SMS_CAPTURE_MERGE === '1';
const FILE = join(HERE, 'fixtures', 'api.json');
const out = MERGE && existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.addCookies([{ name: 'sms_pdf_render', value: COOKIE, url: BASE }]);
const page = await ctx.newPage();
page.on('response', async (r) => {
  const req = r.request();
  const url = new URL(r.url());
  if (req.method() !== 'GET' || !url.pathname.startsWith('/api/')) return;
  try {
    const key = keyOf(url.pathname, url.search);
    if (out[key]) return;
    const text = await r.text();
    out[key] = { status: r.status(), body: r.status() < 300 ? clean(JSON.parse(text)) : null };
  } catch { /* skip bodies that are not JSON */ }
});
let first = true;
for (const q of PAGES) {
  await page.goto(`${BASE}/next/?${q}`, { waitUntil: 'load' });
  await page.waitForTimeout(first ? 3500 : 2000);
  first = false;
  try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch { /* keep going */ }
}
// Sheets that need an id taken from what the register returned.
if (!process.env.SMS_CAPTURE_ONLY) {
  const firstRow = (needle) => Object.entries(out).find(([k, v]) => k.startsWith('/api/events?') && k.includes(needle) && v.body?.data?.rows?.length)?.[1].body.data.rows[0];
  const cone = firstRow('type=cone');
  const sack = firstRow('type=sack');
  const sheets = [];
  if (cone) sheets.push(`s=quality&t=register&rl=cones&sheet=cone%3A${cone.event_id}`);
  if (sack) sheets.push(`s=quality&t=register&rl=sacks&sheet=sack%3A${sack.event_id}`);
  for (const q of sheets) {
    await page.goto(`${BASE}/next/?${q}${PD1}`, { waitUntil: 'load' });
    await page.waitForTimeout(2200);
  }
}
await browser.close();
mkdirSync(join(HERE, 'fixtures'), { recursive: true });
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(FILE, JSON.stringify(sorted));
console.log('recorded', Object.keys(sorted).length, 'routes;', names.size, 'names replaced');
