// @vitest-environment jsdom
/**
 * Products > Changeover (task E10). TRACE rows verified here:
 *   A1-087 / A2-060  the pickers come from GET /api/changeover/refs (a failed fetch names the part)
 *   A1-088 / A2-061 / A4-05  planning is a dry run: it never calls execute
 *   B5-11            a duplicate-triple blocker is printed as sent and links to Limits for that product
 *   A1-089 / A2-062 / A4-06  Execute is absent at rank 1, disabled with the server's reason while writes are off
 *   B5-10            503 and 409 are printed as sent; a result is drawn only from a returned body (no optimistic UI)
 *   B3-04            the engineer rank (2) is the write gate
 */
import { C, FRAGMENTS, withFragments } from '../../../copy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../../../../web/src/testkit/render';
import { installDomStubs } from '../../../../../web/src/testkit/domStubs';
import { installFakeFetch, type FakeFetch, type Routes } from '../../../../../web/src/testkit/fetchRouter';
import { LIVE_FIXTURE } from '../../../../../web/src/testkit/fixtures';
import { live } from '../../../bridge/lib';
import { parseRoute } from '../../../route';
import { ProductsChangeoverScreen } from './ChangeoverScreen';
import { buildBody, emptyForm, limitsTargetOf, missingFor } from './model';
const CO = withFragments(C.changeover, FRAGMENTS.changeover);

installDomStubs();

const ME = { username: 'test-user', displayName: 'Test User', role: 'engineer' } as const;
const DISABLED_REASON = 'PDAS_WRITE_ENABLED is not true.'; // what the server sends
const PLAIN_REASON = 'Writing to PDAS was switched off in this system’s settings.'; // what the current app shows for it
const DUP = 'PDAS allows only one product per blend + count + tube type, active or not: 205-IL0 · 30 · AMBER already exists as product 21 (205-IL0-SD Blue). Change one of the three, or change the limits on product 21 instead.';

const REFS = {
  blends: [{ id: 1, name: '205-IL0' }, { id: 2, name: '201-IH0' }],
  counts: [{ id: 3, name: '30' }, { id: 4, name: '20 Slub' }],
  tubeTypes: [{ id: 5, name: 'AMBER', tubeWeightG: 118, tubeForm: 2 }, { id: 6, name: 'BLUE', tubeWeightG: 120, tubeForm: null }],
  packSchemas: [{ packSchemaId: 1, description: null, conesPerLayer: null, packTypeId: null }],
  pallets: [{ palletId: 1023, productId: 1023, productLabel: '205-IL0-SD', packSchemaId: 1, packSchemaLabel: null, lot: '205-IL0-SD', active: true, sackColour: 'Orange', labelType: 1, steamProg: null, routing: null, pdasCreatedAt: null }],
};
const PRODUCT = (id: number, description: string, active = true) => ({
  productId: id, description, lotCode: null, setpointG: 1960, blend: '205-IL0', countText: '30', tubeType: 'AMBER', tubeWeightG: 118,
  weightOffsetMinusG: 50, weightOffsetPlusG: 50, activeFlag: active, color: null,
});
const PRODUCTS = { products: [PRODUCT(21, '205-IL0-SD'), PRODUCT(1023, 'Old product'), PRODUCT(1100, 'Gone', false)] };
const STATUS_ON = { enabled: true, reason: null, canWrite: true, local: { canWrite: true } };
const STATUS_OFF = { enabled: false, reason: DISABLED_REASON, canWrite: false, local: { canWrite: true } };

const STEP = (step: string, action: string, label: string, proc: string | null = 'AddBlend') => ({ step, action, proc, label, id: null, detail: { name: label, active: true } });
const PLAN = (over: Record<string, unknown> = {}) => ({
  writesEnabled: true,
  disabledReason: null,
  steps: [STEP('tube_type', 'add', 'Add tube type AMBER', 'AddTubeType'), STEP('material', 'create', 'Create product 205-IL0-SD Amber', 'CreateMaterial'), STEP('retire_material', 'retire', 'Retire Old product', 'SetMaterialStatusActive')],
  blockers: [],
  warnings: ['"AMBER" already exists as tube type 5 ("AMBER") in form 2 and will be used as it is.'],
  noRollback: 'There is no automatic rollback: a step that has run stays run.',
  limits: { setpointG: 1960, offsetMinusG: 50, offsetPlusG: 50, label: '1,960 ± 50 g' },
  reachesMachine: false,
  operatorNote: 'This makes the product selectable in PDAS. The operator still selects it on the winder panel.',
  ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function routes(extra: Routes = {}, status: unknown = STATUS_ON): Routes {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/changeover/refs': REFS,
    '/api/products': PRODUCTS,
    '/api/product-write/status': status,
    '/api/changeover/plan': PLAN(),
    '/api/changeover/execute': () => { throw new Error('execute must not be called'); },
    ...extra,
  } as Routes;
}

let ff: FakeFetch | null = null;
const go = vi.fn();
function open(rank: number, extra: Routes = {}, status: unknown = STATUS_ON) {
  ff = installFakeFetch(routes(extra, status));
  const route = parseRoute(new URLSearchParams('s=products&t=changeover'));
  return render(
    <live.LiveProvider asOf={null}>
      <ProductsChangeoverScreen route={route} rank={rank} user={ME as never} go={go} />
    </live.LiveProvider>,
  );
}
beforeEach(() => { go.mockReset(); localStorage.clear(); });
afterEach(() => { cleanup(); ff?.restore(); ff = null; });

const pick = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function fillPlan() {
  await screen.findByLabelText('Blend');
  pick('Blend', '1');
  pick('Count', '3');
  pick('Tube type', '5');
  type('Target weight', '1960');
  type('Allowed below target', '50');
  type('Allowed above target', '50');
  type('Product name', '205-IL0-SD Amber');
  type('Reason', 'Customer moved to the amber tube');
}
const nextBtn = () => screen.getByRole('button', { name: CO.checkPlan });
async function toReview() {
  await fillPlan();
  fireEvent.click(nextBtn());
  await screen.findByText(CO.reviewIntro);
}
const posts = (path: string) => (ff?.requests ?? []).filter((r) => r.startsWith(path));

describe('Plan step (A1-087, A2-060)', () => {
  it('lists the pickers from the refs and disables Check the plan with the first missing thing', async () => {
    open(1);
    await screen.findByLabelText('Blend');
    expect((nextBtn() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(CO.needsBlend)).toBeTruthy();
    pick('Blend', '1');
    expect(screen.getByText(CO.needsCount)).toBeTruthy();
  });

  it('a tube type with an unknown form says so, and a new tube type asks for weight and form', async () => {
    open(1);
    await screen.findByLabelText('Blend');
    expect(screen.getByRole('option', { name: /BLUE, 120 g, form not recorded yet/ })).toBeTruthy();
    const tubeGroup = screen.getByRole('radiogroup', { name: `${CO.tube}, existing or new` });
    fireEvent.click(within(tubeGroup).getByRole('radio', { name: CO.addNew }));
    expect(screen.getByLabelText(CO.tubeWeight)).toBeTruthy();
    expect(screen.getByLabelText(CO.tubeForm)).toBeTruthy();
    expect(screen.getByText(CO.tubeNewNote)).toBeTruthy();
  });

  it('retire list shows active products and pallets only', async () => {
    open(1);
    await screen.findByLabelText('Blend');
    expect(await screen.findByLabelText(/Old product, product 1023/)).toBeTruthy();
    expect(screen.queryByText(/Gone/)).toBeNull();
    expect(screen.getByLabelText(/pallet 1023/)).toBeTruthy();
  });

  it('a failed refs fetch names the part and keeps the rest', async () => {
    open(3, { '/api/changeover/refs': json(500, { error: 'refs down' }) });
    expect(await screen.findByText(`Couldn't load ${CO.loadingLists}.`)).toBeTruthy();
    expect(screen.getByLabelText('Target weight')).toBeTruthy();
  });

  it('a failed product fetch names the part and the pickers still work', async () => {
    open(3, { '/api/products': json(500, { error: 'products down' }) });
    expect(await screen.findByText(`Couldn't load ${CO.loadingProducts}.`)).toBeTruthy();
    expect(await screen.findByLabelText('Blend')).toBeTruthy();
  });
});

describe('Review step: a plan never executes (A1-088, A4-05)', () => {
  it('sends the dry-run body, shows steps, warnings, the no-rollback line and the operator note as sent', async () => {
    open(2);
    await toReview();
    expect(posts('/api/changeover/plan')).toHaveLength(1);
    expect(posts('/api/changeover/execute')).toHaveLength(0);
    const steps = screen.getByRole('list', { name: CO.stepsLabel });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    expect(within(steps).getByText('Add tube type AMBER')).toBeTruthy();
    expect(screen.getByText(PLAN().warnings[0]!)).toBeTruthy();
    expect(screen.getAllByText(PLAN().noRollback).length).toBeGreaterThan(0);
    expect(screen.getByText(PLAN().operatorNote)).toBeTruthy();
    expect(screen.getByText(CO.noReach)).toBeTruthy();
    expect(screen.getByText(CO.ready)).toBeTruthy();
    expect(posts('/api/changeover/execute')).toHaveLength(0);
  });

  it('sends the request body the server expects', async () => {
    let seen: unknown = null;
    open(2, { '/api/changeover/plan': ({ init }: { init?: RequestInit }) => { seen = JSON.parse(String(init?.body)); return PLAN(); } });
    await toReview();
    expect(seen).toMatchObject({
      blend: { id: 1 }, count: { id: 3 }, tubeType: { id: 5 },
      material: { setpointG: 1960, offsetMinusG: 50, offsetPlusG: 50, lot: '205-IL0-SD Amber', ppColour: null },
      pallet: { packSchemaId: 1, lot: null, sackColour: null },
      retire: { productIds: [], palletIds: [] },
      reason: 'Customer moved to the amber tube',
    });
  });

  it('an edit after planning is a new plan: going back and forward asks the server again', async () => {
    open(2);
    await toReview();
    fireEvent.click(screen.getByRole('button', { name: CO.steps.plan }));
    type('Target weight', '1970');
    fireEvent.click(nextBtn());
    await waitFor(() => expect(posts('/api/changeover/plan')).toHaveLength(2));
  });

  it('a blocked plan prints the blocker as sent, links to Limits for that product, and cannot go on', async () => {
    open(2, { '/api/changeover/plan': PLAN({ blockers: [DUP], steps: [] }) });
    await toReview();
    expect(screen.getByText(DUP)).toBeTruthy();
    expect(screen.getAllByText(CO.blockedPill).length).toBeGreaterThan(0);
    const link = screen.getByRole('link', { name: CO.changeLimitsOf(21) });
    expect(link.getAttribute('href')).toContain('t=limits');
    expect(link.getAttribute('href')).toContain('pr=21');
    fireEvent.click(link);
    expect(go).toHaveBeenCalledTimes(1);
    expect(go.mock.calls[0]![0]).toMatchObject({ s: 'products', t: 'limits', keys: { pr: '21' } });
    const next = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    expect(screen.getByText(CO.nextBlocked)).toBeTruthy();
    expect(posts('/api/changeover/execute')).toHaveLength(0);
  });

  it('a plan with no blockers field cannot be run (unknown is treated as blocked)', async () => {
    open(2, { '/api/changeover/plan': PLAN({ blockers: undefined }) });
    await toReview();
    expect(screen.getByText(CO.blockersUnknown)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a plan the server could not make shows its message and stays on Plan', async () => {
    open(2, { '/api/changeover/plan': json(400, { error: 'invalid changeover request' }) });
    await fillPlan();
    fireEvent.click(nextBtn());
    expect(await screen.findByText('invalid changeover request')).toBeTruthy();
    expect(screen.getByText(CO.planFailed)).toBeTruthy();
    expect(screen.queryByText(CO.reviewIntro)).toBeNull();
  });
});

describe('Execute (A1-089, A4-06, B5-10)', () => {
  const toExecute = async (rank: number, extra: Routes = {}, status: unknown = STATUS_ON) => {
    open(rank, extra, status);
    await toReview();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  };

  it('is absent at rank 1: no Execute control, a lock sentence instead', async () => {
    await toExecute(1);
    expect(screen.getByText(CO.viewerLock)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Execute \d+ steps?$/ })).toBeNull();
  });

  it('is disabled at rank 2 while writes are off, with the reason worded as the current app words it', async () => {
    await toExecute(2, { '/api/changeover/plan': PLAN({ writesEnabled: false, disabledReason: DISABLED_REASON }) }, STATUS_OFF);
    const btn = screen.getByRole('button', { name: CO.execute(3) }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // the same sentence, character for character, in its own element (never inside a longer string)
    const hits = screen.getAllByText(PLAIN_REASON);
    expect(hits.length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('PDAS_WRITE_ENABLED');
    expect(screen.getByText(`${CO.nothingSent} ${CO.planStillWorks}`)).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(posts('/api/changeover/execute')).toHaveLength(0);
  });

  it('asks for confirmation first; Cancel sends nothing', async () => {
    await toExecute(2);
    fireEvent.click(screen.getByRole('button', { name: CO.execute(3) }));
    const dlg = screen.getByRole('alertdialog');
    expect(within(dlg).getByText(CO.confirmTitle(3))).toBeTruthy();
    expect(within(dlg).getByText(PLAN().noRollback)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(posts('/api/changeover/execute')).toHaveLength(0);
  });

  it('503 DISABLED is printed in the words of the current app, says nothing was sent, and draws no result', async () => {
    await toExecute(2, { '/api/changeover/execute': json(503, { error: DISABLED_REASON, code: 'DISABLED' }) });
    fireEvent.click(screen.getByRole('button', { name: CO.execute(3) }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: CO.confirm }));
    expect(await screen.findByText(CO.refusedOff)).toBeTruthy();
    expect(screen.getByText(PLAIN_REASON)).toBeTruthy();
    expect(screen.queryByText(CO.resultTitle)).toBeNull();
    expect(screen.queryByText(CO.done)).toBeNull();
  });

  it('409 BLOCKED is printed as sent', async () => {
    await toExecute(2, { '/api/changeover/execute': json(409, { error: 'Blocked: the lot name is required.', code: 'BLOCKED' }) });
    fireEvent.click(screen.getByRole('button', { name: CO.execute(3) }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: CO.confirm }));
    expect(await screen.findByText(CO.refusedBlocked)).toBeTruthy();
    expect(screen.getByText('Blocked: the lot name is required.')).toBeTruthy();
    expect(screen.queryByText(CO.resultTitle)).toBeNull();
  });

  it('a server error does not claim that nothing was sent', async () => {
    await toExecute(2, { '/api/changeover/execute': json(500, { error: 'boom' }) });
    fireEvent.click(screen.getByRole('button', { name: CO.execute(3) }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: CO.confirm }));
    expect(await screen.findByText(CO.unconfirmed)).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.queryByText(CO.refusedOff)).toBeNull();
  });

  it('no optimistic result: while the run is in flight nothing is drawn as done', async () => {
    await toExecute(2, { '/api/changeover/execute': () => new Promise(() => {}) });
    fireEvent.click(screen.getByRole('button', { name: CO.execute(3) }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: CO.confirm }));
    await waitFor(() => expect(posts('/api/changeover/execute')).toHaveLength(1));
    expect(screen.queryByText(CO.resultTitle)).toBeNull();
    expect(screen.queryByText(CO.done)).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(CO.executing);
  });

  it('a 207 result lists done, failed and not done exactly as returned', async () => {
    const outcome = {
      ok: false,
      done: [{ ...STEP('tube_type', 'add', 'Add tube type AMBER', 'AddTubeType'), resultId: 28 }],
      failed: { ...STEP('pallet', 'create', 'Create pallet AMBER-30', 'CreatePallet'), error: { code: 'PDAS_ERROR', message: 'Pallet already exists', pdasErrorCode: -5001 } },
      notDone: [STEP('retire_material', 'retire', 'Retire Old product', 'SetMaterialStatusActive')],
      materialId: null, palletId: null,
      noRollback: 'Steps that ran stay run; nothing was undone.',
    };
    await toExecute(2, { '/api/changeover/execute': json(207, outcome) });
    fireEvent.click(screen.getByRole('button', { name: CO.execute(3) }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: CO.confirm }));
    const res = await screen.findByRole('region', { name: CO.resultTitle });
    expect(within(res).getByText(CO.resultStopped)).toBeTruthy();
    expect(within(res).getByText('Add tube type AMBER')).toBeTruthy();
    expect(within(res).getByText(CO.newId(28))).toBeTruthy();
    expect(within(res).getByText('Pallet already exists')).toBeTruthy();
    expect(within(res).getByText(CO.pdasCode(-5001))).toBeTruthy();
    expect(within(res).getByText('Retire Old product')).toBeTruthy();
    expect(within(res).getByText(CO.done)).toBeTruthy();
    expect(within(res).getByText(CO.failed)).toBeTruthy();
    expect(within(res).getByText(CO.notDone)).toBeTruthy();
    expect(within(res).getByText(outcome.noRollback)).toBeTruthy();
    // it cannot be run twice from this plan
    expect((screen.getByRole('button', { name: CO.execute(3) }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a 200 result says all steps ran', async () => {
    const outcome = {
      ok: true,
      done: [{ ...STEP('material', 'create', 'Create product 205-IL0-SD Amber', 'CreateMaterial'), resultId: 1025 }],
      failed: null, notDone: [], materialId: 1025, palletId: null, noRollback: 'x',
    };
    await toExecute(2, { '/api/changeover/execute': json(200, outcome) });
    fireEvent.click(screen.getByRole('button', { name: CO.execute(3) }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: CO.confirm }));
    expect(await screen.findByText(CO.resultAll(1))).toBeTruthy();
  });

  it('the write gate is the engineer rank', async () => {
    await toExecute(2);
    expect(screen.getByRole('button', { name: CO.execute(3) })).toBeTruthy();
  });
});

describe('model', () => {
  it('builds nothing until the form is complete, and trims', () => {
    const f = emptyForm();
    expect(buildBody(f, 1)).toBeNull();
    expect(missingFor(f)).toBe(CO.needsBlend);
    f.blend = { mode: 'new', id: '', name: '  205-NEW ' };
    f.count = { mode: 'existing', id: '3', name: '' };
    f.tube = { mode: 'new', id: '', name: 'AMBER', weight: '118', form: '1' };
    f.setpoint = '1960'; f.below = '50'; f.above = '40'; f.productName = ' X '; f.reason = '  at least ten chars  ';
    expect(missingFor(f)).toBeNull();
    expect(buildBody(f, 1)).toMatchObject({
      blend: { name: '205-NEW' }, count: { id: 3 }, tubeType: { name: 'AMBER', tubeWeightG: 118, tubeForm: 1 },
      material: { lot: 'X', offsetMinusG: 50, offsetPlusG: 40 }, reason: 'at least ten chars',
    });
    f.reason = 'too short';
    expect(missingFor(f)).toBe(CO.needsReason(10));
  });
  it('finds the product a duplicate blocker points at, and nothing else', () => {
    expect(limitsTargetOf(DUP)).toBe(21);
    expect(limitsTargetOf('The new blend has no name.')).toBeNull();
  });
});
