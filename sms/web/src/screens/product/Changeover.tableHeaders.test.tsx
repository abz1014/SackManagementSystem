/**
 * Accessibility fix (29 Sep 2026): Changeover's two tables — the plan-steps
 * table and the executed-outcome table — had no <thead>/<th> at all, so
 * screen-reader users got no column context. Fixed with an sr-only header
 * row (this design shows no visible header on any table) and a proper
 * <th scope="row"> for each row's step label. This locks down that every
 * column now has an accessible name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor, within } from '@testing-library/react';
import { render } from '../../testkit/render';
import { installFakeFetch } from '../../testkit/fetchRouter';
import { W } from '../../lib/words';
import type { ChangeoverPlan, ChangeoverOutcome, ChangeoverRequestBody } from '../../api';
import { PlanReview } from './Changeover';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PLAN: ChangeoverPlan = {
  writesEnabled: false,
  disabledReason: 'PDAS_WRITE_ENABLED is not true.',
  steps: [
    { step: 'blend', action: 'reuse', proc: null, label: 'BlendA', id: 1, detail: {} },
    { step: 'count', action: 'reuse', proc: null, label: 'CountA', id: 2, detail: {} },
  ],
  blockers: [],
  warnings: [],
  noRollback: 'There is no automatic rollback.',
  limits: { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, label: '1960 g (+30/-30)' },
  reachesMachine: false,
  operatorNote: 'This plan is a dry run.',
};

describe('Product › Changeover — plan-steps table has an accessible header', () => {
  it('exposes Step, Description and Action as column headers', () => {
    const { getByRole } = render(
      <PlanReview plan={PLAN} canWrite={false} buildBody={() => null} />,
    );

    const table = getByRole('table');
    expect(within(table).getByRole('columnheader', { name: W.product.changeover.step })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: W.product.changeover.colDescription })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: W.product.changeover.colAction })).toBeTruthy();

    const rowHeaders = within(table).getAllByRole('rowheader');
    expect(rowHeaders.length).toBe(2);
    expect(rowHeaders[0]!.tagName).toBe('TH');
    expect(rowHeaders[0]!.textContent).toBe('blend');
  });
});

describe('Product › Changeover — outcome table has an accessible header', () => {
  it('exposes Step, Description and Result ID as column headers once a changeover has executed', async () => {
    const outcome: ChangeoverOutcome = {
      ok: true,
      materialId: 1025,
      palletId: null,
      done: [
        { step: 'blend', action: 'reuse', proc: null, label: 'BlendA', id: 1, detail: {}, resultId: 1 },
        { step: 'material', action: 'create', proc: 'CreateMaterial', label: 'a new lot', id: null, detail: {}, resultId: 1025 },
      ],
      failed: null,
      notDone: [],
      noRollback: 'There is no automatic rollback.',
    };

    installFakeFetch({
      '/api/changeover/execute': outcome,
    });

    const body: ChangeoverRequestBody = {
      blend: { id: 1 },
      count: { id: 2 },
      tubeType: { id: 3 },
      material: { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30, lot: 'LOT1', ppColour: null },
      pallet: { packSchemaId: 1, lot: null, sackColour: null },
      retire: { productIds: [], palletIds: [] },
      reason: 'testing outcome table headers',
    };

    // Mounted via PlanReview directly, with a plan whose writes are enabled
    // and no blockers, so Execute actually fires and renders the outcome.
    const { getByRole, findByText } = render(
      <PlanReview plan={{ ...PLAN, writesEnabled: true, disabledReason: null }} canWrite={true} buildBody={() => body} />,
    );

    const executeBtn = getByRole('button', { name: W.product.changeover.execute });
    executeBtn.click();

    await findByText(/BlendA/);
    await waitFor(() => {
      const tables = document.querySelectorAll('table');
      expect(tables.length).toBeGreaterThanOrEqual(2);
    });

    const outcomeTable = Array.from(document.querySelectorAll('table')).find((t) =>
      (t.textContent ?? '').includes('a new lot'),
    )!;
    expect(within(outcomeTable).getByRole('columnheader', { name: W.product.changeover.step })).toBeTruthy();
    expect(within(outcomeTable).getByRole('columnheader', { name: W.product.changeover.colDescription })).toBeTruthy();
    expect(within(outcomeTable).getByRole('columnheader', { name: W.product.changeover.colResult })).toBeTruthy();

    const rowHeaders = within(outcomeTable).getAllByRole('rowheader');
    expect(rowHeaders.length).toBe(2);
    expect(rowHeaders[1]!.tagName).toBe('TH');
    expect(rowHeaders[1]!.textContent).toBe('material');
  });
});
