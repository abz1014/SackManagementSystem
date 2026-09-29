/**
 * Accessibility fix (29 Sep 2026): Catalogue's two PDAS tables (products,
 * pallets) had no <thead>/<th> at all, so screen-reader users got no column
 * context. Fixed with an sr-only header row (this design shows no visible
 * header on any table) and a proper <th scope="row"> for the product/
 * pallet identifying cell. This locks down that every column now has an
 * accessible name, and that the row actions (Retire/Reactivate, "Change
 * weight limits") still work.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { render } from '../../testkit/render';
import { installFakeFetch } from '../../testkit/fetchRouter';
import type { ProductOption, PalletRow } from '../../api';
import { W } from '../../lib/words';
import { CatalogueTab } from './Catalogue';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PRODUCT: ProductOption = {
  productId: 21,
  description: '205-IL0-SD',
  lotCode: null,
  setpointG: 1960,
  blend: 'PolyBlend',
  countText: '30s',
  tubeType: 'PP Tube',
  tubeWeightG: 12,
  weightOffsetMinusG: 30,
  weightOffsetPlusG: 30,
  activeFlag: true,
  color: 'Blue',
};

const PALLET: PalletRow = {
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

const ROUTES = {
  '/api/products': { products: [PRODUCT] },
  '/api/products/limits/history': { products: [] },
  '/api/pallets': { pallets: [PALLET] },
  '/api/product-write/status': { enabled: true, reason: null, canWrite: true, local: { canWrite: true } },
};

describe('Product › Catalogue — products table has an accessible header', () => {
  it('exposes Product, Product ID, Limits and Actions as column headers, and "Change weight limits" still works', async () => {
    installFakeFetch(ROUTES);
    const { findByRole, getAllByText } = render(<CatalogueTab productId={null} onProductIdChange={() => {}} />);

    // Anchor on Product ID, which is unique to this table — "Product" and
    // "Actions" are also column headers on the pallets table below.
    const productIdHeader = await findByRole('columnheader', { name: W.product.colProductId });
    const table = productIdHeader.closest('table')!;
    expect(within(table).getByRole('columnheader', { name: W.product.colProduct })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: W.product.colLimits })).toBeTruthy();
    // The Actions column only renders once the write-status fetch resolves.
    expect(await within(table).findByRole('columnheader', { name: W.product.colActions })).toBeTruthy();

    const rowHeader = within(table).getByRole('rowheader');
    expect(rowHeader.tagName).toBe('TH');
    expect(rowHeader.textContent).toContain('205-IL0-SD');

    await waitFor(() => expect(getAllByText(W.product.changeLimits).length).toBeGreaterThan(0));
    fireEvent.click(getAllByText(W.product.changeLimits)[0]!);
    await waitFor(() => {
      expect(getAllByText(W.product.changeLimitsReviewStep).length).toBeGreaterThan(0);
    });
  });
});

describe('Product › Catalogue — pallets table has an accessible header', () => {
  it('exposes Pallet ID, Product, Pack schema, Lot, Colour and Actions as column headers, and Retire still works', async () => {
    installFakeFetch(ROUTES);
    const { findByRole } = render(<CatalogueTab productId={null} onProductIdChange={() => {}} />);

    const palletIdHeader = await findByRole('columnheader', { name: W.product.colPalletId });
    const table = palletIdHeader.closest('table')!;
    expect(within(table).getByRole('columnheader', { name: W.product.colProduct })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: W.product.colPackSchema })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: W.product.colLot })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: W.product.colour })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: W.product.colActions })).toBeTruthy();

    const rowHeader = within(table).getByRole('rowheader');
    expect(rowHeader.tagName).toBe('TH');
    expect(rowHeader.textContent).toBe('1023');

    fireEvent.click(within(table).getByText(W.product.retire, { selector: 'button' }));
    await waitFor(() => {
      expect(document.body.textContent ?? '').toContain(W.product.palletRetireNote(1023));
    });
  });
});
