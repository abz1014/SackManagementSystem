#!/usr/bin/env node
/**
 * docs/guide/capture/capture.mjs — screenshot tool for the illustrated SMS
 * guide (WORKER T4). Drives the demo instance of the app (never the real
 * plant, never the dev copy) with playwright-core + the installed Edge, and
 * saves PNGs under docs/guide/images/.
 *
 * SAFETY, ENFORCED HERE, NOT JUST IN shots.json:
 *   - Refuses to navigate to any URL whose host is not the allowed base host
 *     (127.0.0.1:4100 by default, or --base=<url>'s host), unless --allow-test-host
 *     is passed for pipeline smoke-testing against a local static file.
 *   - Refuses any click whose accessible name or text matches /execute/i.
 *   - Refuses to `fill` into any input[type=password].
 *   - Blocks downloads (acceptDownloads: false) and stubs window.print so a
 *     real OS print dialog can never appear and block the run.
 *   - Scans document.body.innerText against a redaction denylist before
 *     every save and fails the shot (no PNG written) on a hit.
 *
 * USAGE (from repo root):
 *   node docs/guide/capture/capture.mjs --dry
 *   node docs/guide/capture/capture.mjs --only=S01
 *   node docs/guide/capture/capture.mjs --base=http://127.0.0.1:4100
 *   node docs/guide/capture/capture.mjs --allow-test-host --base=file:///... --only=T_TEST
 *
 * Credentials: read from docs/guide/demo/demo-login.env
 * (SMS_TEST_USERNAME / SMS_TEST_PASSWORD) — never printed, never logged.
 * Session state is cached at docs/guide/capture/.auth/state.json (gitignored
 * by docs/guide/.gitignore).
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GUIDE_ROOT = path.resolve(__dirname, '..');
const SMS_PACKAGE_JSON = path.join(REPO_ROOT, 'sms', 'package.json');
const IMAGES_DIR = path.join(GUIDE_ROOT, 'images');
const MANIFEST_PATH = path.join(IMAGES_DIR, 'manifest.json');
const AUTH_DIR = path.join(__dirname, '.auth');
const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'state.json');
const SHOTS_JSON_PATH = path.join(__dirname, 'shots.json');
const DEMO_LOGIN_ENV_PATH = path.join(GUIDE_ROOT, 'demo', 'demo-login.env');
const REDACTION_MD_PATH = path.join(GUIDE_ROOT, 'facts', 'REDACTION.md');

/* ---------------------------------------------------------------- args -- */

function parseArgs(argv) {
  const args = { only: null, dry: false, base: null, allowTestHost: false };
  for (const a of argv) {
    if (a === '--dry') args.dry = true;
    else if (a === '--allow-test-host') args.allowTestHost = true;
    else if (a.startsWith('--only=')) args.only = a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--base=')) args.base = a.slice('--base='.length);
  }
  return args;
}

/* ----------------------------------------------------- playwright-core -- */

function loadPlaywrightCore() {
  if (!fs.existsSync(SMS_PACKAGE_JSON)) {
    throw new Error(`Cannot find ${SMS_PACKAGE_JSON} — this script must be run from a checkout that has sms/ beside docs/.`);
  }
  const req = createRequire(SMS_PACKAGE_JSON);
  return req('playwright-core');
}

/* --------------------------------------------------------------- shots -- */

function loadShots() {
  const raw = fs.readFileSync(SHOTS_JSON_PATH, 'utf8');
  return JSON.parse(raw);
}

const PLACEHOLDER_RE = /\{\{[A-Z0-9_]+\}\}/g;

function findPlaceholders(shots) {
  const found = new Map(); // id -> [placeholders]
  for (const s of shots.shots) {
    const text = JSON.stringify(s);
    const matches = text.match(PLACEHOLDER_RE);
    if (matches && matches.length) found.set(s.id, [...new Set(matches)]);
  }
  return found;
}

function validateShots(shots) {
  const problems = [];
  const seen = new Set();
  for (const s of shots.shots) {
    if (!s.id) problems.push('a shot entry has no id');
    if (seen.has(s.id)) problems.push(`duplicate id: ${s.id}`);
    seen.add(s.id);
    if (!s.notCapturable && !s.url) problems.push(`${s.id}: no url and not marked notCapturable`);
    if (s.notCapturable && !s.reason) problems.push(`${s.id}: notCapturable but no reason given`);
  }
  return problems;
}

/* ----------------------------------------------------------- redaction -- */

const FALLBACK_DENYLIST = [
  'ABDULLAH', 'SAJID', 'C:\\Users\\', '14330',
  'DATA_TP1U2_SEP07', 'PDAS_TP1U2_SEP07', 'TP1-PDAS', '192.168.100.37', 'Hassan',
];

function loadDenylist() {
  const list = new Set(FALLBACK_DENYLIST);
  // Runtime facts, never hardcoded: this machine's own hostname/username must
  // never appear in a saved screenshot's text.
  try { list.add(os.hostname()); } catch { /* ignore */ }
  if (process.env.USERNAME) list.add(process.env.USERNAME);
  if (process.env.USER) list.add(process.env.USER);

  if (fs.existsSync(REDACTION_MD_PATH)) {
    const text = fs.readFileSync(REDACTION_MD_PATH, 'utf8');
    // Pull every backtick-quoted token — the expected way a denylist term
    // would be written in a markdown fact sheet. Falls back to the built-in
    // list above (already added) if none are found, so a not-yet-written or
    // differently-formatted REDACTION.md never leaves the scan empty.
    // Only the first backticked token of each table row (the real value in
    // the "real -> replacement" first column). Backticks in prose elsewhere in
    // REDACTION.md (allowed names, "and", IFL, ...) are NOT denylist terms.
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('|')) continue;
      const m = line.match(/`([^`]+)`/);
      if (!m) continue;
      const v = m[1].trim();
      if (v.length >= 3 && v.toLowerCase() !== 'ibrahim') list.add(v);
    }
  }
  return [...list].filter(Boolean);
}

function scanForDenylistHits(innerText, denylist) {
  const hits = [];
  for (const term of denylist) {
    if (term && innerText.includes(term)) hits.push(term);
  }
  if (/ibrahim/.test(innerText)) hits.push('ibrahim');
  return hits;
}

/* -------------------------------------------------------------- login --- */

function parseEnvFile(p) {
  if (!fs.existsSync(p)) return null;
  const out = {};
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

async function ensureSignedIn(browser, baseUrl, log) {
  mkdirp(AUTH_DIR);
  if (fs.existsSync(STORAGE_STATE_PATH)) {
    const context = await browser.newContext({
      storageState: STORAGE_STATE_PATH,
      viewport: { width: 1440, height: 900 },
      acceptDownloads: false,
    });
    const page = await context.newPage();
    await page.goto(baseUrl + '/');
    const stillOnLogin = await page.getByLabel('Username').isVisible().catch(() => false);
    await page.close();
    if (!stillOnLogin) {
      log('reusing cached session');
      return context;
    }
    await context.close();
  }

  const creds = parseEnvFile(DEMO_LOGIN_ENV_PATH);
  if (!creds || !creds.SMS_TEST_USERNAME || !creds.SMS_TEST_PASSWORD) {
    throw new Error(
      `No usable session and no credentials at ${DEMO_LOGIN_ENV_PATH} ` +
      '(needs SMS_TEST_USERNAME / SMS_TEST_PASSWORD). Per this task\'s constraints, ' +
      'no sign-in is attempted until that file exists — it is written by the owner ' +
      'during the OWNER STOP step, not by any worker.',
    );
  }

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: false,
  });
  const page = await context.newPage();
  await page.goto(baseUrl + '/');
  await page.getByLabel('Username').fill(creds.SMS_TEST_USERNAME);
  await page.getByLabel('Password').fill(creds.SMS_TEST_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await Promise.race([
    page.getByLabel('Username').waitFor({ state: 'detached', timeout: 8000 }),
    page.getByRole('alert').waitFor({ state: 'visible', timeout: 8000 }),
  ]).catch(() => {});
  const alertVisible = await page.getByRole('alert').isVisible().catch(() => false);
  if (alertVisible) {
    const t = await page.getByRole('alert').textContent().catch(() => null);
    await page.close();
    await context.close();
    throw new Error(`Sign-in was rejected by the server: ${t ?? '(no message)'}`);
  }
  await page.close();
  await context.storageState({ path: STORAGE_STATE_PATH });
  log('signed in and cached session state');
  return context;
}

/* --------------------------------------------------------------- utils -- */

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

function hostOf(urlStr) {
  try { return new URL(urlStr).host; } catch { return null; }
}

/** Refuses a click whose accessible name or literal text names Execute — the
 *  one action nothing in this tool may ever perform (product/Changeover.tsx's
 *  "Execute the changeover" button, and anything shaped like it). */
export function assertClickAllowed(nameOrText) {
  if (nameOrText && /execute/i.test(nameOrText)) {
    throw new Error(`Refused: click target "${nameOrText}" matches /execute/i — this tool never clicks Execute.`);
  }
}

/* ------------------------------------------------------------- actions -- */

async function locatorFor(page, action) {
  if (action.by === 'role') {
    return page.getByRole(action.role, { name: action.name, exact: false });
  }
  if (action.by === 'text') {
    return page.getByText(action.text, { exact: false });
  }
  if (action.by === 'css') {
    return page.locator(action.selector);
  }
  throw new Error(`Unknown locator "by": ${action.by}`);
}

export async function runAction(page, action, opts) {
  switch (action.type) {
    case 'click': {
      const label = action.name ?? action.text ?? action.selector;
      assertClickAllowed(label);
      const loc = (await locatorFor(page, action)).first();
      // Re-check the resolved element's own accessible text too, not just the
      // selector string used to find it — belt and braces against a CSS
      // selector that happens to land on an Execute-labelled control.
      const resolvedText = await loc.textContent().catch(() => null);
      assertClickAllowed(resolvedText);
      if (action.optional) {
        const count = await loc.count().catch(() => 0);
        if (count === 0) return { skipped: true, reason: 'optional action target not found' };
      }
      await loc.click({ timeout: 8000 });
      return { ok: true };
    }
    case 'press': {
      await page.keyboard.press(action.key);
      return { ok: true };
    }
    case 'fill': {
      const loc = (await locatorFor(page, action)).first();
      const type = await loc.evaluate((el) => el.getAttribute('type')).catch(() => null);
      if (type === 'password') {
        throw new Error('Refused: fill target is input[type=password] — this tool never fills password fields.');
      }
      await loc.fill(action.value);
      return { ok: true };
    }
    case 'waitForText': {
      await page.getByText(action.text, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 });
      return { ok: true };
    }
    case 'waitForSelector': {
      if (action.by === 'role') {
        await page.getByRole(action.role, { name: action.name }).first().waitFor({ state: 'visible', timeout: 8000 });
      } else {
        await page.locator(action.selector).first().waitFor({ state: 'visible', timeout: 8000 });
      }
      return { ok: true };
    }
    case 'wait': {
      await page.waitForTimeout(action.ms ?? 500);
      return { ok: true };
    }
    case 'scrollSheetBottom': {
      await page.locator('.sheet[role=dialog]').first().evaluate((el) => { el.scrollTop = el.scrollHeight; });
      return { ok: true };
    }
    case 'scrollTo': {
      const tgt = action.by ? (await locatorFor(page, action)).last() : page.locator(action.selector).first();
      await tgt.scrollIntoViewIfNeeded({ timeout: 8000 });
      return { ok: true };
    }
    case 'selectIndex': {
      const loc = page.locator(action.selector).nth(action.nth ?? 0);
      await loc.selectOption({ index: action.index ?? 1 }, { timeout: 8000 });
      return { ok: true };
    }
    case 'fillPlaceholderNote': {
      // A documentation-only marker in shots.json (D13) — deliberately not an
      // executable action. The operator fills the changeover form by hand
      // (or with their own extra actions) before this shot is captured.
      return { skipped: true, reason: action._note ?? 'placeholder note, no-op' };
    }
    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

/* ---------------------------------------------------------- screenshot -- */

async function waitForNoLoading(page, loadingText) {
  await page.waitForFunction(
    (text) => !document.body.innerText.includes(text),
    loadingText,
    { timeout: 15000 },
  ).catch(() => { /* proceed; the scan below still reports honestly if stuck */ });
  await page.waitForTimeout(1500);
}

/** .bar and .strip are two adjacent top-of-page elements (sms/web/src/ui/Bar.tsx);
 *  Playwright's locator.screenshot() only shoots one element, so S03's crop
 *  unions their bounding boxes into one CSS clip via a temporary wrapper. */
async function screenshotBarStripUnion(page, outPath) {
  const box = await page.evaluate(() => {
    const bar = document.querySelector('.bar');
    const strip = document.querySelector('.strip');
    if (!bar || !strip) return null;
    const b = bar.getBoundingClientRect();
    const s = strip.getBoundingClientRect();
    return {
      x: Math.min(b.left, s.left),
      y: Math.min(b.top, s.top),
      width: Math.max(b.right, s.right) - Math.min(b.left, s.left),
      height: Math.max(b.bottom, s.bottom) - Math.min(b.top, s.top),
    };
  });
  if (!box) throw new Error('.bar / .strip not found on page for S03 crop');
  await page.screenshot({ path: outPath, clip: box });
}

async function takeShotScreenshot(page, shot, outPath) {
  if (shot.id === 'S03') {
    await screenshotBarStripUnion(page, outPath);
    return;
  }
  if (shot.crop && shot.cropChildren) {
    // cropChildren: [first, last] 1-based children of the block's grid div;
    // shoots the union of those children (used to split tall blocks, e.g. S30/S30b).
    const loc = page.locator(shot.crop).first();
    await loc.waitFor({ state: 'visible', timeout: 8000 });
    const box = await loc.evaluate((el, [a, z]) => {
      const kids = el.querySelectorAll(':scope > div > div > *');
      const f = kids[a - 1], l = kids[z - 1];
      if (!f || !l) return null;
      const fr = f.getBoundingClientRect(), lr = l.getBoundingClientRect();
      const br = el.getBoundingClientRect(); const x = br.left, r = br.right;
      return { x: x + window.scrollX, y: fr.top + window.scrollY, width: r - x, height: lr.bottom - fr.top };
    }, shot.cropChildren);
    if (!box) throw new Error('cropChildren not found for ' + shot.id);
    await page.screenshot({ path: outPath, clip: box, fullPage: true });
    return;
  }
  if (shot.crop) {
    const loc = page.locator(shot.crop).first();
    await loc.waitFor({ state: 'visible', timeout: 8000 });
    await loc.screenshot({ path: outPath });
    return;
  }
  await page.screenshot({ path: outPath, fullPage: Boolean(shot.fullPage) });
}

/* ------------------------------------------------------------ manifest -- */

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { shots: [] };
  try { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch { return { shots: [] }; }
}

function saveManifestEntry(entry) {
  mkdirp(IMAGES_DIR);
  const manifest = loadManifest();
  const idx = manifest.shots.findIndex((s) => s.id === entry.id);
  if (idx >= 0) manifest.shots[idx] = entry;
  else manifest.shots.push(entry);
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}

/* ------------------------------------------------------------ one shot -- */

async function captureOneShot(browser, shots, shot, args, denylist, log) {
  if (shot.notCapturable) {
    log(`${shot.id}: not capturable — ${shot.reason}`);
    saveManifestEntry({ id: shot.id, takenAt: new Date().toISOString(), url: null, viewport: null, pass: 'skipped', reason: shot.reason });
    return;
  }

  const baseUrl = args.base ?? shots.defaults.baseUrl;
  const targetUrl = new URL(shot.url, baseUrl).toString();
  const allowedHost = hostOf(baseUrl);
  const requestedHost = hostOf(targetUrl);
  if (!args.allowTestHost && requestedHost !== allowedHost) {
    throw new Error(`Refused: ${shot.id}'s URL host "${requestedHost}" is not the allowed host "${allowedHost}". Pass --allow-test-host only for pipeline smoke tests.`);
  }

  const viewport = shot.viewport ?? shots.defaults.viewport;
  const dpr = shot.dpr ?? shots.defaults.dpr;

  let context;
  if (shot.signedOut) {
    context = await browser.newContext({ viewport, deviceScaleFactor: dpr, acceptDownloads: false });
  } else {
    context = await ensureSignedIn(browser, baseUrl, log);
    await context.setDefaultTimeout?.(10000);
  }

  // Stub window.print before any navigation so a real OS print dialog can
  // never appear and block a headless run.
  await context.addInitScript(() => { window.print = () => {}; });

  const page = await context.newPage();
  if (!shot.signedOut) await page.setViewportSize(viewport);
  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    if (!shot.signedOut) {
      await page.evaluate((scale) => {
        try { window.localStorage.setItem('sms.uiScale', scale); } catch { /* ignore */ }
      }, shots.defaults.uiScale);
    }

    for (const action of shot.actions ?? []) {
      await runAction(page, action, { shot });
    }

    await waitForNoLoading(page, shots.defaults.loadingText);

    const innerText = await page.evaluate(() => document.body.innerText);
    const hits = scanForDenylistHits(innerText, denylist);
    if (hits.length) {
      throw new Error(`Refused to save ${shot.id}: denylisted term(s) visible on page: ${hits.join(', ')}`);
    }

    mkdirp(IMAGES_DIR);
    const outPath = path.join(IMAGES_DIR, `${shot.id}.png`);
    await takeShotScreenshot(page, shot, outPath);

    for (const action of shot.closeActions ?? []) {
      await runAction(page, action, { shot }).catch(() => {});
    }

    saveManifestEntry({
      id: shot.id, takenAt: new Date().toISOString(), url: targetUrl,
      viewport, dpr, pass: 'pass', reason: null,
    });
    log(`${shot.id}: OK -> images/${shot.id}.png`);
  } catch (err) {
    saveManifestEntry({
      id: shot.id, takenAt: new Date().toISOString(), url: targetUrl,
      viewport, dpr, pass: 'fail', reason: String(err.message ?? err),
    });
    log(`${shot.id}: FAILED — ${err.message ?? err}`);
  } finally {
    await page.close().catch(() => {});
    if (shot.signedOut) await context.close().catch(() => {});
  }
}

/* --------------------------------------------------------------- diagram */

async function captureDiagram(browser, shots, args, log) {
  const d = shots.diagram;
  const htmlPath = path.resolve(__dirname, d.htmlFile);
  if (!fs.existsSync(htmlPath)) {
    log(`diagram: ${htmlPath} does not exist yet — skipping`);
    return;
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const context = await browser.newContext({
    viewport: d.viewport, deviceScaleFactor: d.dpr, acceptDownloads: false,
  });
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    mkdirp(IMAGES_DIR);
    const outPath = path.join(IMAGES_DIR, `${d.id}.png`);
    await page.screenshot({ path: outPath, fullPage: true });
    saveManifestEntry({ id: d.id, takenAt: new Date().toISOString(), url: `file://${htmlPath}`, viewport: d.viewport, dpr: d.dpr, pass: 'pass', reason: null });
    log(`${d.id}: OK -> images/${d.id}.png`);
  } catch (err) {
    saveManifestEntry({ id: d.id, takenAt: new Date().toISOString(), url: `file://${htmlPath}`, viewport: d.viewport, dpr: d.dpr, pass: 'fail', reason: String(err.message ?? err) });
    log(`${d.id}: FAILED — ${err.message ?? err}`);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/* ----------------------------------------------------------------- main */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = (...a) => console.log(...a);
  const shots = loadShots();

  const problems = validateShots(shots);
  const placeholders = findPlaceholders(shots);

  if (args.dry) {
    log(`shots.json: ${shots.shots.length} entries, diagram id "${shots.diagram.id}"`);
    if (problems.length) {
      log('SCHEMA PROBLEMS:');
      for (const p of problems) log(`  - ${p}`);
    } else {
      log('schema: OK');
    }
    if (placeholders.size) {
      log('UNRESOLVED PLACEHOLDERS (fill from docs/guide/demo/DEMO-STATE.md before capturing these):');
      for (const [id, tokens] of placeholders) log(`  - ${id}: ${tokens.join(', ')}`);
    } else {
      log('placeholders: none (all shots have concrete values)');
    }
    const notCapturable = shots.shots.filter((s) => s.notCapturable);
    log(`notCapturable (documented, no PNG expected): ${notCapturable.map((s) => s.id).join(', ') || '(none)'}`);
    if (problems.length) process.exitCode = 1;
    return;
  }

  let ids = shots.shots.map((s) => s.id);
  if (args.only) ids = ids.filter((id) => args.only.includes(id));
  const wantDiagram = !args.only || args.only.includes(shots.diagram.id);

  const pw = loadPlaywrightCore();
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
  const denylist = loadDenylist();
  log(`denylist: ${denylist.length} terms loaded`);

  try {
    for (const id of ids) {
      const shot = shots.shots.find((s) => s.id === id);
      if (!shot) { log(`${id}: not found in shots.json — skipping`); continue; }
      await captureOneShot(browser, shots, shot, args, denylist, log);
    }
    if (wantDiagram) await captureDiagram(browser, shots, args, log);
  } finally {
    await browser.close();
  }
}

// Guarded so this file can be `import`-ed (e.g. by a safety-guard test
// script) without immediately launching a browser and running the full shot
// list — only runs main() when invoked directly as `node capture.mjs`.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('capture.mjs failed:', err);
    process.exitCode = 1;
  });
}
