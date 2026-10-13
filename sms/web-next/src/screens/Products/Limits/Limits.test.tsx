// @vitest-environment jsdom
/**
 * Products > Limits & History (task E10). TRACE rows verified here:
 *   A1-072 / A2-064  current limits and the version table come from the history route
 *   A1-073 / A2-065 / A4-11  SMS-local save: rank 2, gated on the server's local.canWrite, not on PDAS
 *   A1-035 / A2-037 / A4-09 / B5-12  PDAS save: guard, two steps, 10 characters, 20 and a tick for a large change
 *   B5-10            the write-status reason is printed as sent; no optimistic "Saved"
 *   B5-13            a reading is judged by the limits in force when it was weighed (stated, versions keep their start)
 *   A1-090 / A2-063 / A3-079  the PDAS action history with an outcome filter; "disabled" is an attempt that never reached PDAS
 *   A1-027           the running-product record
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../../../../web/src/testkit/render';
import { installDomStubs } from '../../../../../web/src/testkit/domStubs';
import { installFakeFetch, type FakeFetch, type Routes } from '../../../../../web/src/testkit/fetchRouter';
import { LIVE_FIXTURE } from '../../../../../web/src/testkit/fixtures';
import { live } from '../../../bridge/lib';
import { parseRoute } from '../../../route';
import { ProductsLimitsScreen } from './LimitsScreen';
import { guardOf, limitsLabel, outcomeKind } from './model';
import { LM, collectStrings } from './strings';

installDomStubs();

const ME = { username: 'test-user', displayName: 'Test User', role: 'engineer' } as const;
const OFF_REASON = 'PDAS_WRITE_ENABLED is not true.';
const STATUS_ON = { enabled: true, reason: null, canWrite: true, local: { canWrite: true } };
const STATUS_OFF = { enabled: false, reason: OFF_REASON, canWrite: false, local: { canWrite: true } };
const STATUS_NO_LOCAL = { enabled: false, reason: OFF_REASON, canWrite: false, local: { canWrite: false } };

const VERSION = (id: number, sp: number, om: number, op: number, source: string, from: string, over: Record<string, unknown> = {}) => ({
  versionId: id, setpointG: sp, offsetMinusG: om, offsetPlusG: op,
  effectiveFromUtc: `${from}T05:00:00.000Z`, effectiveFromPlant: `${from}T10:00:00.000Z`, effectiveIsLowerBound: false,
  source, changedBy: null, reason: null, recordedAtUtc: `${from}T05:00:00.000Z`, label: null, ...over,
});
const HISTORY = {
  products: [
    { productId: 20, label: '205-IL0-SD', activeFlag: true, versions: [VERSION(2, 1960, 50, 50, 'sms_local', '2026-08-20', { changedBy: 'Hira', reason: 'Spec sheet update' }), VERSION(1, 1950, 50, 50, 'pdas_observed', '2026-08-05', { effectiveIsLowerBound: true })] },
    { productId: 21, label: '205-IL0-SD', activeFlag: true, versions: [VERSION(3, 1960, 40, 40, 'pdas_observed', '2026-08-05')] },
  ],
};
const PRODUCT = (id: number, color: string) => ({
  productId: id, description: '205-IL0-SD', lotCode: null, setpointG: 1960, blend: '205-IL0', countText: '30', tubeType: 'AMBER', tubeWeightG: 118,
  weightOffsetMinusG: 50, weightOffsetPlusG: 50, activeFlag: true, color,
});
const PRODUCTS = { products: [PRODUCT(20, 'GREEN'), PRODUCT(21, 'BLUE')] };
const CHANGE = (id: number, outcome: string, over: Record<string, unknown> = {}) => ({
  changeId: id, productId: 20, palletId: null, procName: 'Change limits', operation: 'update_limits', outcome, pdasErrorCode: null,
  message: null, reason: 'Align with the spec sheet', changedByName: 'Hira', changedAtUtc: `2026-10-${10 + id}T09:14:00.000Z`, effectiveFromUtc: null, ...over,
});
const CHANGES = {
  entries: [
    CHANGE(1, 'ok'),
    CHANGE(2, 'pdas_error', { procName: 'CreateMaterial', operation: 'create', pdasErrorCode: -7001, message: 'Material already exist', reason: 'Add amber' }),
    CHANGE(3, 'disabled', { procName: 'CreateMaterial', operation: 'create', message: OFF_REASON, reason: null }),
  ],
  nextBefore: null,
};
const TIMELINE = { timeline: [{ timelineId: 1, productId: 20, productLabel: '205-IL0-SD GREEN', effectiveFrom: '2026-08-05T06:00:00.000Z', changedAt: '2026-08-05T06:00:00.000Z', changedBy: 'Hira', reason: 'Start of September run' }] };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function routes(extra: Routes = {}, status: unknown = STATUS_ON): Routes {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/products/limits/history': HISTORY,
    '/api/products': PRODUCTS,
    '/api/product-write/status': status,
    '/api/product-changes': CHANGES,
    '/api/product-timeline': TIMELINE,
    '/api/products/limits/local': () => { throw new Error('local save must not be called'); },
    '/api/products/20/limits': () => { throw new Error('PDAS save must not be called'); },
    ...extra,
  } as Routes;
}

let ff: FakeFetch | null = null;
const go = vi.fn();
function open(rank: number, extra: Routes = {}, status: unknown = STATUS_ON, query = 's=products&t=limits') {
  ff = installFakeFetch(routes(extra, status));
  const route = parseRoute(new URLSearchParams(query));
  return render(
    <live.LiveProvider asOf={null}>
      <ProductsLimitsScreen route={route} rank={rank} user={ME as never} go={go} />
    </live.LiveProvider>,
  );
}
beforeEach(() => { go.mockReset(); localStorage.clear(); });
afterEach(() => { cleanup(); ff?.restore(); ff = null; });

const calls = (path: string) => (ff?.requests ?? []).filter((r) => r === path || r.startsWith(`${path}?`));
const setNum = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
const setReason = (v: string) => fireEvent.change(screen.getByLabelText(LM.reason), { target: { value: v } });
const reviewBtn = () => screen.getByRole('button', { name: LM.reviewNext }) as HTMLButtonElement;
const dest = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement;
async function editor() { await screen.findByLabelText(LM.target); }

describe('what is in force (A1-072, B5-13)', () => {
  it('shows the current limits, their range and the start time, and says earlier readings keep theirs', async () => {
    open(1);
    expect(await screen.findByText('1,960 ± 50 g', { selector: '.lm-big' })).toBeTruthy();
    expect(screen.getByText(/Accepts 1,910\s?g to 2,010\s?g\./)).toBeTruthy();
    expect(screen.getByText(LM.caption)).toBeTruthy();
    expect(screen.getByText(LM.versionsNote, { exact: false })).toBeTruthy();
  });

  it('lists every version with its start, source and who, marking a lower bound', async () => {
    open(1);
    const table = await screen.findByRole('table', { name: LM.versionsTitle });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(1 + 2);
    expect(within(rows[1]!).getByText('Saved in SMS')).toBeTruthy();
    expect(within(rows[1]!).getByText('Spec sheet update')).toBeTruthy();
    expect(within(rows[2]!).getByText('Seen in PDAS')).toBeTruthy();
    expect(within(rows[2]!).getByText(new RegExp(LM.noBound))).toBeTruthy();
  });

  it('the product picker follows the pr key and writes it back', async () => {
    open(1, {}, STATUS_ON, 's=products&t=limits&pr=21');
    expect(await screen.findByText('1,960 ± 40 g', { selector: '.lm-big' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(LM.product), { target: { value: '20' } });
    expect(go.mock.calls.at(-1)![0].keys.pr).toBe('20');
    expect(go.mock.calls.at(-1)![1]).toEqual({ replace: true });
    expect(await screen.findByText('1,960 ± 50 g', { selector: '.lm-big' })).toBeTruthy();
  });

  it('a failed history fetch names the part', async () => {
    open(1, { '/api/products/limits/history': json(500, { error: 'down' }) });
    expect(await screen.findByText(`Couldn't load ${LM.loadingHistory}.`)).toBeTruthy();
  });
});

describe('the editor is for engineers (A4-11)', () => {
  it('is absent at rank 1', async () => {
    open(1);
    await screen.findByRole('table', { name: LM.versionsTitle });
    expect(screen.queryByLabelText(LM.target)).toBeNull();
    expect(screen.queryByRole('button', { name: LM.reviewNext })).toBeNull();
  });

  it('is there at rank 2 and starts from the limits in force', async () => {
    open(2);
    await editor();
    expect((screen.getByLabelText(LM.target) as HTMLInputElement).value).toBe('1960');
    expect((screen.getByLabelText(LM.below) as HTMLInputElement).value).toBe('50');
    expect(reviewBtn().disabled).toBe(true);
    expect(screen.getByText(LM.needsChange)).toBeTruthy();
  });

  it('PDAS writes off: the PDAS choice is disabled and the server reason is shown as sent', async () => {
    open(2, {}, STATUS_OFF);
    await editor();
    await waitFor(() => expect(dest(/^PDAS/).disabled).toBe(true));
    expect(screen.getAllByText(OFF_REASON).length).toBeGreaterThan(0);
    expect(dest(/^SMS/).disabled).toBe(false);
    expect(dest(/^SMS/).checked).toBe(true);
    expect(screen.getByText(LM.pdasOff)).toBeTruthy();
  });

  it('SMS saving not allowed for this role: the SMS choice is disabled and says so', async () => {
    open(2, {}, STATUS_NO_LOCAL);
    await editor();
    await waitFor(() => expect(dest(/^SMS/).disabled).toBe(true));
    expect(screen.getByText(LM.smsUnavailable)).toBeTruthy();
  });
});

describe('guard and reason lengths (B5-12)', () => {
  it('a small change is within the guard and needs 10 characters', async () => {
    open(2);
    await editor();
    setNum(LM.target, '1970');
    expect(await screen.findByText(LM.guardWithin, { selector: '.pill' })).toBeTruthy();
    setReason('123456789');
    expect(reviewBtn().disabled).toBe(true);
    expect(screen.getByText(LM.needsReason(10))).toBeTruthy();
    setReason('1234567890');
    expect(reviewBtn().disabled).toBe(false);
  });

  it('a change over 3 % is outside the guard; saving in PDAS needs 20 characters, then a tick', async () => {
    open(2);
    await editor();
    await waitFor(() => expect(dest(/^PDAS/).disabled).toBe(false));
    setNum(LM.target, '2100');
    expect(await screen.findByText(LM.guardOutside, { selector: '.pill' })).toBeTruthy();
    fireEvent.click(dest(/^PDAS/));
    setReason('twelve chars');
    expect(reviewBtn().disabled).toBe(true);
    expect(screen.getByText(LM.needsReason(20))).toBeTruthy();
    setReason('Revised customer specification');
    fireEvent.click(reviewBtn());
    expect(await screen.findByText(LM.largeTitle)).toBeTruthy();
    const confirm = () => screen.getByRole('button', { name: LM.confirmPdas }) as HTMLButtonElement;
    expect(confirm().disabled).toBe(true);
    expect(screen.getByText(LM.needsTick)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: LM.largeTick }));
    expect(confirm().disabled).toBe(false);
  });

  it('an offset change over 20 g is outside the guard too', () => {
    const before = { setpointG: 1960, offsetMinusG: 50, offsetPlusG: 50, desc1: null, desc2: null, active: true };
    expect(guardOf(before, { setpointG: 1960, offsetMinusG: 71, offsetPlusG: 50 }).large).toBe(true);
    expect(guardOf(before, { setpointG: 1960, offsetMinusG: 70, offsetPlusG: 50 }).large).toBe(false);
    expect(guardOf(before, { setpointG: 2019, offsetMinusG: 50, offsetPlusG: 50 }).large).toBe(true);
    expect(guardOf(before, { setpointG: 1960, offsetMinusG: 50, offsetPlusG: 50 }).changed).toBe(false);
    expect(limitsLabel(1960, -50, 40)).toBe('1,960 g, minus 50, plus 40');
  });
});

describe('saving: two steps, no optimistic result (A1-073, A1-035, B5-10)', () => {
  const toReview = async (status: unknown = STATUS_ON, extra: Routes = {}) => {
    open(2, extra, status);
    await editor();
    setNum(LM.target, '1970');
    setReason('Align with the spec sheet');
    fireEvent.click(reviewBtn());
    await screen.findByText(LM.before);
  };

  it('review shows before and after and the destination; nothing has been sent yet', async () => {
    await toReview();
    const ba = document.querySelector('.lm-ba') as HTMLElement;
    expect(within(ba).getByText('1,960 ± 50 g')).toBeTruthy();
    expect(within(ba).getByText('1,970 ± 50 g')).toBeTruthy();
    expect(within(document.querySelector('.lm-review') as HTMLElement).getByText('Align with the spec sheet')).toBeTruthy();
    expect(screen.getByText(LM.noReach)).toBeTruthy();
    expect(calls('/api/products/limits/local')).toHaveLength(0);
  });

  it('SMS save sends the new version and says Saved only after the server answers', async () => {
    let body: unknown = null;
    let release: (r: unknown) => void = () => {};
    const pending = new Promise((res) => { release = res; });
    await toReview(STATUS_ON, { '/api/products/limits/local': async ({ init }: { init?: RequestInit }) => { body = JSON.parse(String(init?.body)); return pending; } });
    fireEvent.click(screen.getByRole('button', { name: LM.confirmSms }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toMatchObject({ productId: 20, setpointG: 1970, offsetMinusG: 50, offsetPlusG: 50, reason: 'Align with the spec sheet' });
    expect(screen.queryByText(/Saved in SMS as version/)).toBeNull();
    release({ versionId: 25, label: '1,970 ± 50 g', products: HISTORY.products });
    expect(await screen.findByText(LM.savedSms(25))).toBeTruthy();
    expect(screen.getByText(LM.laterReadings('1,970 ± 50 g'))).toBeTruthy();
  });

  it('a refusal is printed as sent and the form stays on Review', async () => {
    await toReview(STATUS_ON, { '/api/products/limits/local': json(400, { error: 'Setpoint 1970 g is outside the plausible cone range.', code: 'IMPLAUSIBLE' }) });
    fireEvent.click(screen.getByRole('button', { name: LM.confirmSms }));
    expect(await screen.findByText('Setpoint 1970 g is outside the plausible cone range.')).toBeTruthy();
    expect(screen.getByText(LM.saveFailed)).toBeTruthy();
    expect(screen.queryByText(/Saved in SMS as version/)).toBeNull();
    expect(screen.getByText(LM.before)).toBeTruthy();
  });

  it('PDAS save sends before and after from the PDAS values and shows what PDAS now holds', async () => {
    let body: { before: unknown; after: unknown; reason: string; largeChangeConfirmed?: boolean } | null = null;
    const ok = { productId: 20, observedAfter: { setpointG: 1970, offsetMinusG: 50, offsetPlusG: 50, desc1: null, desc2: null, active: true }, products: PRODUCTS.products };
    open(2, { '/api/products/20/limits': ({ init }: { init?: RequestInit }) => { body = JSON.parse(String(init?.body)); return ok; } });
    await editor();
    await waitFor(() => expect(dest(/^PDAS/).disabled).toBe(false));
    setNum(LM.target, '1970');
    fireEvent.click(dest(/^PDAS/));
    setReason('Align with the spec sheet');
    fireEvent.click(reviewBtn());
    fireEvent.click(await screen.findByRole('button', { name: LM.confirmPdas }));
    expect(await screen.findByText(LM.savedPdas)).toBeTruthy();
    expect(body).toMatchObject({ before: { setpointG: 1960, offsetMinusG: 50 }, after: { setpointG: 1970, offsetMinusG: 50 }, reason: 'Align with the spec sheet' });
    expect(screen.getByText(LM.pdasNow('1,970 ± 50 g'))).toBeTruthy();
  });

  it('a 503 from PDAS is printed as sent and nothing is shown as saved', async () => {
    open(2, { '/api/products/20/limits': json(503, { error: OFF_REASON, code: 'DISABLED' }) });
    await editor();
    await waitFor(() => expect(dest(/^PDAS/).disabled).toBe(false));
    setNum(LM.target, '1970');
    fireEvent.click(dest(/^PDAS/));
    setReason('Align with the spec sheet');
    fireEvent.click(reviewBtn());
    fireEvent.click(await screen.findByRole('button', { name: LM.confirmPdas }));
    expect(await screen.findByText(OFF_REASON, { selector: '.lm-fail .lm-verbatim' })).toBeTruthy();
    expect(screen.queryByText(LM.savedPdas)).toBeNull();
  });

  it('Back from Review changes nothing on the server', async () => {
    await toReview();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByLabelText(LM.target)).toBeTruthy();
    expect(calls('/api/products/limits/local')).toHaveLength(0);
  });
});

describe('PDAS action history (A1-090, A3-079)', () => {
  it('shows every attempt and labels a disabled one as never having reached PDAS', async () => {
    open(1);
    const table = await screen.findByRole('table', { name: LM.actionsTitle });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 3);
    expect(within(table).getByText(LM.neverReached)).toBeTruthy();
    expect(within(table).getByText(LM.notSent)).toBeTruthy();
    expect(within(table).getByText(LM.refused)).toBeTruthy();
    expect(within(table).getByText(LM.done)).toBeTruthy();
    expect(within(table).getByText(/Material already exist \(-7001\)/)).toBeTruthy();
    expect(within(table).getAllByText(OFF_REASON).length).toBeGreaterThan(0);
  });

  it('the outcome filter narrows the rows', async () => {
    open(1);
    const table = await screen.findByRole('table', { name: LM.actionsTitle });
    const grp = screen.getByRole('radiogroup', { name: LM.filterLabel });
    fireEvent.click(within(grp).getByRole('radio', { name: LM.fNotSent }));
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 1);
    fireEvent.click(within(grp).getByRole('radio', { name: LM.fRefused }));
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 1);
    expect(within(table).getByText('Add amber')).toBeTruthy();
    fireEvent.click(within(grp).getByRole('radio', { name: LM.fAll }));
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 3);
  });

  it('a failed history fetch names the part and the rest of the screen still works', async () => {
    open(1, { '/api/product-changes': json(500, { error: 'down' }) });
    expect(await screen.findByText(`Couldn't load ${LM.loadingActions}.`)).toBeTruthy();
    expect(await screen.findByRole('table', { name: LM.versionsTitle })).toBeTruthy();
  });

  it('loads older actions with the cursor the server gave', async () => {
    open(1, {
      '/api/product-changes': ({ search }: { search: URLSearchParams }) =>
        search.get('before') === '1' ? { entries: [CHANGE(0, 'ok', { reason: 'Very old change' })], nextBefore: null } : { ...CHANGES, nextBefore: 1 },
    });
    await screen.findByRole('table', { name: LM.actionsTitle });
    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(await screen.findByText('Very old change')).toBeTruthy();
  });

  it('lists the products set as running in SMS', async () => {
    open(1);
    const table = await screen.findByRole('table', { name: LM.timelineTitle });
    expect(within(table).getByText('205-IL0-SD GREEN')).toBeTruthy();
    expect(within(table).getByText('Start of September run')).toBeTruthy();
  });
});

describe('model and wording', () => {
  it('outcome kinds', () => {
    expect(outcomeKind({ outcome: 'ok' })).toBe('done');
    expect(outcomeKind({ outcome: 'disabled' })).toBe('notSent');
    for (const o of ['conflict', 'implausible', 'not_found', 'pdas_error', 'error', 'mismatch']) expect(outcomeKind({ outcome: o })).toBe('refused');
  });

  it('retire and recreate is explained as not a way to change limits', async () => {
    open(1);
    await screen.findByRole('table', { name: LM.versionsTitle });
    expect(screen.getByText(LM.retireTitle)).toBeTruthy();
  });

  const banned = [/\bbatch(es)?\b/i, /\bepochs?\b/i, /\bgenerations?\b/i, /\bsimulator\b/i, /\brejected\b/i, /\bwinder\b/i, /\bmachines?\b/i, /\blifter\b/i, /\bAI\b/, /\bAssumed\b/];
  const ACRONYMS = new Set(['OK', 'PDAS', 'SMS', 'IFL', 'CSV', 'PDF', 'PLC']);
  it('keeps the copy rules: sentence case, no pipeline words, no ellipsis', () => {
    for (const s of collectStrings()) {
      expect(s, s).toMatch(/^[A-Z]/);
      expect(s, s).not.toContain('…');
      expect(s, s).not.toContain('...');
      for (const re of banned) expect(s, `${s} ~ ${re}`).not.toMatch(re);
      for (const w of s.match(/[A-Za-z]{2,}/g) ?? []) if (w === w.toUpperCase()) expect(ACRONYMS.has(w), `${w} in ${s}`).toBe(true);
      expect(s.replace(/\b(Aa|Bb|Cc|Dd)\b/g, 'x'), s).not.toMatch(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/);
    }
  });
});
