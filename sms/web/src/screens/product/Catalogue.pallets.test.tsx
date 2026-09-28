/**
 * Task L1 (28 Sep 2026) — Catalogue's new "Pallets in PDAS" block (between
 * the products block and the SMS-local limits block), fixing D-31/D-34
 * (DEFECTS.md Part 10): before this, a retired pallet had no path back to
 * active in the UI at all.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { render } from '../../testkit/render';
import { installFakeFetch, type RouteRequest } from '../../testkit/fetchRouter';
import type { PalletRow } from '../../api';
import { W } from '../../lib/words';
import { CatalogueTab } from './Catalogue';

const PALLET_ACTIVE: PalletRow = {
  palletId: 1023,
  productId: 100,
  productLabel: '205-IL0-SD',
  packSchemaId: 1,
  packSchemaLabel: 'Sack 3x4',
  lot: 'LOT1',
  active: true,
  sackColour: 'Blue',
  labelType: 1,
  steamProg: 0,
  routing: 0,
  pdasCreatedAt: '2026-09-20T00:00:00Z',
};

const PALLET_RETIRED: PalletRow = {
  palletId: 1024,
  productId: 101,
  productLabel: null,
  packSchemaId: 1,
  packSchemaLabel: 'Sack 3x4',
  lot: 'LOT-OLD',
  active: false,
  sackColour: null,
  labelType: 1,
  steamProg: 0,
  routing: 0,
  pdasCreatedAt: '2026-08-01T00:00:00Z',
};

const BASE_ROUTES = {
  '/api/products': { products: [] },
  '/api/products/limits/history': { products: [] },
};

describe('Product › Catalogue — Pallets in PDAS block', () => {
  it('(a) lists an active pallet and a retired pallet', async () => {
    installFakeFetch({
      ...BASE_ROUTES,
      '/api/product-write/status': { enabled: false, reason: 'x', canWrite: false, local: { canWrite: false } },
      '/api/pallets': { pallets: [PALLET_ACTIVE, PALLET_RETIRED] },
    });

    const { container } = render(<CatalogueTab productId={null} onProductIdChange={() => {}} />);

    await waitFor(() => {
      expect(container.textContent ?? '').toContain(W.product.palletsTitle);
    });
    const text = container.textContent ?? '';
    expect(text).toContain('1023');
    expect(text).toContain('205-IL0-SD');
    expect(text).toContain('LOT1');
    expect(text).toContain('Blue');
    expect(text).toContain('1024');
    // Retired pallet: productLabel is null, falls back to "Product 101".
    expect(text).toContain('Product 101');
    expect(text).toContain(W.product.retired);
  });

  it('(b) Retire/Reactivate buttons, a short reason is refused client-side, a valid reason POSTs', async () => {
    let lastBody: unknown = null;
    installFakeFetch({
      ...BASE_ROUTES,
      '/api/product-write/status': { enabled: true, reason: null, canWrite: true, local: { canWrite: true } },
      '/api/pallets': { pallets: [PALLET_ACTIVE, PALLET_RETIRED] },
      '/api/pallets/1024/active': (req: RouteRequest) => {
        lastBody = JSON.parse((req.init?.body as string) ?? '{}');
        return { palletId: 1024, active: true, pallets: [PALLET_ACTIVE, { ...PALLET_RETIRED, active: true }] };
      },
    });

    const { container, getAllByText, getByText } = render(
      <CatalogueTab productId={null} onProductIdChange={() => {}} />,
    );

    // Wait for the write-status fetch to resolve so the buttons render.
    await waitFor(() => {
      expect(getAllByText(W.product.retire).length).toBeGreaterThan(0);
    });

    // Pallet 1023 is active -> "Retire"; pallet 1024 is retired -> "Reactivate".
    const reactivateBtn = getByText(W.product.palletReactivate);
    fireEvent.click(reactivateBtn);

    await waitFor(() => {
      expect(container.textContent ?? '').toContain(W.product.palletReactivateNote(1024));
    });

    const reasonInput = getByText(W.product.whyRequired).closest('label')!.querySelector('input')!;
    fireEvent.change(reasonInput, { target: { value: 'short' } });
    fireEvent.click(getByText(W.product.palletReactivate, { selector: 'button[type="submit"]' }));

    await waitFor(() => {
      expect(container.textContent ?? '').toContain(W.product.reasonTooShort);
    });
    expect(lastBody).toBeNull();

    fireEvent.change(reasonInput, { target: { value: 'a good enough reason' } });
    fireEvent.click(getByText(W.product.palletReactivate, { selector: 'button[type="submit"]' }));

    await waitFor(() => {
      expect(lastBody).toEqual({ active: true, reason: 'a good enough reason' });
    });
  });

  it('(c) writes disabled shows plain words and no buttons, never the raw config text', async () => {
    installFakeFetch({
      ...BASE_ROUTES,
      '/api/product-write/status': { enabled: false, reason: 'PDAS_WRITE_ENABLED is not true.', canWrite: false, local: { canWrite: false } },
      '/api/pallets': { pallets: [PALLET_ACTIVE, PALLET_RETIRED] },
    });

    const { container, queryByText } = render(<CatalogueTab productId={null} onProductIdChange={() => {}} />);

    await waitFor(() => {
      expect(container.textContent ?? '').toContain(W.product.palletsTitle);
    });
    const text = container.textContent ?? '';
    expect(text).not.toContain('PDAS_WRITE_ENABLED');
    expect(queryByText(W.product.palletReactivate)).toBeNull();
    // "Retire" also appears as a materials-block label; assert no button
    // carries it once writes are disabled.
    const retireButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === W.product.retire);
    expect(retireButtons.length).toBe(0);
  });
});
