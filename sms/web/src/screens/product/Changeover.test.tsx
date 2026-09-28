/**
 * FIX 2 (28 Sep 2026, Task K2 live pass): a tester on Product › Changeover
 * ticked a pallet-retire checkbox, filled in the reason, and the Plan
 * request never fired — with no error and no explanation on screen. Root
 * cause: `canSubmitPlan` (Changeover.tsx) requires a blend, count AND tube
 * type to be chosen, matching the server's request shape (a changeover plan
 * always includes the create sequence; `services/changeover.ts` has no
 * retire-only variant), but the screen gave no visible reason the Plan
 * button stayed disabled when only retire fields were filled.
 *
 * This mounts the real `ChangeoverTab` against fake refs/products fixtures
 * and asserts:
 *   1. ticking only the pallet-retire checkbox and filling the reason
 *      leaves Plan disabled AND now shows the explanatory message (this is
 *      the part that was silent before the fix — it fails against the
 *      pre-fix component, which rendered no such message);
 *   2. once an existing blend/count/tube are also picked, Plan is enabled,
 *      clicking it actually POSTs `/api/changeover/plan`, and the returned
 *      plan's `retire_pallet` / `SetPalletStatusActive` step renders — i.e.
 *      a pallet-retire plan can be built and posted through the UI.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '../../testkit/render';
import { installFakeFetch } from '../../testkit/fetchRouter';
import { W } from '../../lib/words';
import type { ChangeoverPlan, ChangeoverRefs, ProductOption } from '../../api';
import { ChangeoverTab } from './Changeover';

afterEach(() => {
  vi.unstubAllGlobals();
});

const REFS: ChangeoverRefs = {
  blends: [{ id: 1, name: 'BlendA' }],
  counts: [{ id: 2, name: 'CountA' }],
  tubeTypes: [{ id: 3, name: 'TubeA', tubeWeightG: 12, tubeForm: 2 }],
  packSchemas: [{ packSchemaId: 1, description: null, conesPerLayer: null, packTypeId: null }],
  pallets: [
    {
      palletId: 9, productId: 100, productLabel: '205-IL0-SD',
      packSchemaId: 1, packSchemaLabel: null, lot: 'LOT1',
      active: true, sackColour: 'RED', labelType: 1, steamProg: null, routing: null, pdasCreatedAt: null,
    },
  ],
};

const PRODUCTS: ProductOption[] = [
  {
    productId: 100, description: '205-IL0-SD', lotCode: 'LOT1', setpointG: 1960,
    blend: 'BlendA', countText: 'CountA', tubeType: 'TubeA', tubeWeightG: 12,
    weightOffsetMinusG: 30, weightOffsetPlusG: 30, activeFlag: true, color: null,
  },
];

const PLAN_FIXTURE: ChangeoverPlan = {
  writesEnabled: false,
  disabledReason: 'PDAS_WRITE_ENABLED is not true.',
  steps: [
    { step: 'blend', action: 'reuse', proc: null, label: 'BlendA', id: 1, detail: {} },
    { step: 'count', action: 'reuse', proc: null, label: 'CountA', id: 2, detail: {} },
    { step: 'tube_type', action: 'reuse', proc: null, label: 'TubeA', id: 3, detail: {} },
    { step: 'material', action: 'create', proc: 'CreateMaterial', label: 'a new lot', id: null, detail: {} },
    { step: 'pallet', action: 'create', proc: 'CreatePallet', label: 'a new pallet', id: null, detail: {} },
    {
      step: 'retire_pallet', action: 'retire', proc: 'SetPalletStatusActive',
      label: 'pallet 9 · 205-IL0-SD', id: 9, detail: { active: false, productId: 100 },
    },
  ],
  blockers: [],
  warnings: [],
  noRollback: 'There is no automatic rollback.',
  limits: { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, label: '1960 g (+30/-30)' },
  reachesMachine: false,
  operatorNote: 'This plan is a dry run.',
};

function routes(onPlan?: () => void) {
  return {
    '/api/changeover/refs': REFS,
    '/api/products': { products: PRODUCTS },
    '/api/changeover/plan': () => {
      onPlan?.();
      return PLAN_FIXTURE;
    },
  };
}

describe('Product › Changeover — pallet-retire plan', () => {
  it('leaves Plan disabled and explains why when only the pallet-retire box and reason are filled', async () => {
    installFakeFetch(routes());
    render(<ChangeoverTab canWrite={true} />);

    await waitFor(() => expect(screen.getByText(W.product.tabs.changeover)).toBeTruthy());

    // Tick only the pallet's retire checkbox (index 1: index 0 is the one
    // active product's own retire checkbox from the same fixture).
    const checkboxes = await screen.findAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(checkboxes[1]!);

    // The reason `<label>` also wraps a conditional "too short" hint, so its
    // full text is not an exact match for getByLabelText — locate it via the
    // label's own caption text instead, then its sibling input.
    const reasonInput = screen.getByText(W.product.whyRequired).closest('label')!.querySelector('input')!;
    fireEvent.change(reasonInput, { target: { value: 'testing pallet retire only' } });

    const planButton = screen.getByRole('button', { name: W.product.changeover.dryRun });
    expect((planButton as HTMLButtonElement).disabled).toBe(true);

    // This is the regression this fix closes: before it, nothing on screen
    // said why the button would not fire.
    expect(screen.getByText(W.product.changeover.needsFullSelection)).toBeTruthy();
  });

  it('builds and posts a pallet-retire plan once blend/count/tube are also picked', async () => {
    let planCalls = 0;
    installFakeFetch(routes(() => { planCalls += 1; }));
    render(<ChangeoverTab canWrite={true} />);

    await waitFor(() => expect(screen.getByText(W.product.tabs.changeover)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(W.product.blend), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(W.product.count), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(W.product.tubeType), { target: { value: '3' } });

    const checkboxes = await screen.findAllByRole('checkbox');
    fireEvent.click(checkboxes[1]!); // the pallet's own retire checkbox

    fireEvent.change(
      screen.getByText(W.product.whyRequired).closest('label')!.querySelector('input')!,
      { target: { value: 'testing pallet retire only' } },
    );

    // No more silent block: the disabled-reason message is gone once the
    // required pickers are filled.
    expect(screen.queryByText(W.product.changeover.needsFullSelection)).toBeNull();

    const planButton = screen.getByRole('button', { name: W.product.changeover.dryRun });
    expect((planButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(planButton);

    await waitFor(() => expect(planCalls).toBe(1));
    // Proves SetPalletStatusActive was actually planned, not silently dropped.
    expect(await screen.findByText(/SetPalletStatusActive/)).toBeTruthy();
    expect(screen.getByText(/pallet 9/)).toBeTruthy();
  });
});
