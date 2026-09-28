/**
 * FIX A (28 Sep 2026) — the raw PDAS write-path "disabled" reason
 * (`resolvePdasWrite`, `api/src/config.ts`; e.g. the literal string
 * "PDAS_WRITE_ENABLED is not true.") reached the product screens verbatim
 * in three places: History's trail (a stored `sms.product_change.message`),
 * Changeover's plan/execute refusal, and Catalogue's write-status note.
 * `lib/pdasWords.ts`'s `pdasReasonForDisplay()` now sits in front of each —
 * this proves all three render plain words, not the raw `.env`-reading
 * sentence, for both an old stored row (History) and a fresh disabled
 * response (Changeover, Catalogue).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { render } from '../../testkit/render';
import { installFakeFetch } from '../../testkit/fetchRouter';
import type { ChangeoverPlan, ChangeoverRequestBody, ProductChangeEntry } from '../../api';
import { HistoryTab } from './History';
import { PlanReview } from './Changeover';
import { CatalogueTab } from './Catalogue';

afterEach(() => {
  vi.unstubAllGlobals();
});

const RAW_REASON = 'PDAS_WRITE_ENABLED is not true.';
const PLAIN_REASON = 'Writing to PDAS was switched off in this system’s settings.';

describe('Product › History — the trail translates a stored disabled reason', () => {
  it('renders plain words for an old sms.product_change row, never the raw config text', async () => {
    const row: ProductChangeEntry = {
      changeId: 2,
      productId: null,
      palletId: null,
      procName: 'CreateMaterial',
      operation: 'create',
      outcome: 'disabled',
      pdasErrorCode: null,
      message: RAW_REASON,
      reason: 'Changeover for machine 3',
      changedByName: 'engineer1',
      changedAtUtc: '2026-09-16T10:00:00Z',
      effectiveFromUtc: null,
    };
    installFakeFetch({
      '/api/product-timeline': { timeline: [] },
      '/api/product-changes': { entries: [row], nextBefore: null },
    });

    const { container } = render(<HistoryTab />);

    await waitFor(() => {
      expect(container.textContent ?? '').toContain(PLAIN_REASON);
    });
    expect(container.textContent ?? '').not.toContain(RAW_REASON);
    expect(container.textContent ?? '').not.toContain('PDAS_WRITE_ENABLED');
  });
});

describe('Product › Changeover — plan and execute refusals translate the reason', () => {
  const PLAN: ChangeoverPlan = {
    writesEnabled: false,
    disabledReason: RAW_REASON,
    steps: [],
    blockers: [],
    warnings: [],
    noRollback: 'There is no automatic rollback.',
    limits: { setpointG: 1950, offsetMinusG: 20, offsetPlusG: 20, label: '1930–1970 g' },
    reachesMachine: false,
    operatorNote: 'This plan is a dry run.',
  };

  it('renders plain words for GET /api/changeover/plan\'s disabledReason', () => {
    const { container } = render(
      <PlanReview plan={PLAN} canWrite={true} buildBody={() => null} />,
    );

    expect(container.textContent ?? '').toContain(PLAIN_REASON);
    expect(container.textContent ?? '').not.toContain(RAW_REASON);
    expect(container.textContent ?? '').not.toContain('PDAS_WRITE_ENABLED');
  });

  it('renders plain words for a fresh POST /api/changeover/execute 503 refusal', async () => {
    installFakeFetch({
      '/api/changeover/execute': new Response(
        JSON.stringify({ error: RAW_REASON, code: 'DISABLED', reachesMachine: false }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    });

    // Writes enabled here so the Execute button is not disabled — this test
    // is about the error text the response carries, not the gating.
    const enabledPlan: ChangeoverPlan = { ...PLAN, writesEnabled: true, disabledReason: null };
    const body: ChangeoverRequestBody = {
      blend: { id: 1 },
      count: { id: 1 },
      tubeType: { id: 1 },
      material: { setpointG: 1950, offsetMinusG: 20, offsetPlusG: 20, lot: 'L1', ppColour: null },
      pallet: { packSchemaId: 1, lot: null, sackColour: null },
      retire: { productIds: [], palletIds: [] },
      reason: 'test',
    };
    const { container, getByText } = render(
      <PlanReview plan={enabledPlan} canWrite={true} buildBody={() => body} />,
    );

    fireEvent.click(getByText('Execute the changeover'));

    await waitFor(() => {
      expect(container.textContent ?? '').toContain(PLAIN_REASON);
    });
    expect(container.textContent ?? '').not.toContain(RAW_REASON);
  });
});

describe('Product › Catalogue — the write-status note translates the reason', () => {
  it('renders plain words for ProductWriteStatus.reason, never the raw config text', async () => {
    installFakeFetch({
      '/api/products': { products: [] },
      '/api/product-write/status': { enabled: false, reason: RAW_REASON, canWrite: false, local: { canWrite: false } },
      '/api/products/limits/history': { products: [] },
    });

    const { container } = render(<CatalogueTab productId={null} onProductIdChange={() => {}} />);

    await waitFor(() => {
      expect(container.textContent ?? '').toContain(PLAIN_REASON);
    });
    expect(container.textContent ?? '').not.toContain(RAW_REASON);
    expect(container.textContent ?? '').not.toContain('PDAS_WRITE_ENABLED');
  });
});
