// @vitest-environment jsdom
/**
 * Products & PDAS > Catalogue (task E9), on the real product list of design/redesign-2026-10/mockup-data.json.
 * TRACE rows verified here:
 *   A3-077 / A1-028            products table: code, colour, count, tube, target, tolerance, status, stations now
 *   A1-034 / A4-08 / A2-036    retire and reactivate: absent at rank 1, disabled while writes are off (server reason
 *                              printed once, verbatim), confirm + reason (10 characters), nothing until the server answers
 *   A1-036 / A1-037 / A4-10 / D-34  pallets, retire and reactivate (both directions)
 *   A1-032 / A4-07             "New product" opens the changeover plan
 *   (failure naming rule)      a failed part is named; what did load keeps its figures
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LiveProvider } from '../../../../../web/src/lib/live';
import { installDomStubs } from '../../../../../web/src/testkit/domStubs';
import { installFakeFetch, type Routes } from '../../../../../web/src/testkit/fetchRouter';
import { parseRoute } from '../../../route';
import type { ScreenProps } from '../../registry';
import { ProductsCatalogueScreen } from './ProductsCatalogue';
import { STATUS_ON, boardRoutes } from '../testkit/mock';

installDomStubs();

const USER = { username: 'u', displayName: 'U', role: 'viewer' } as never;
type GoMock = ReturnType<typeof vi.fn<ScreenProps['go']>>;

const PALLETS = {
  pallets: [
    { palletId: 1023, productId: 1022, productLabel: '205-IL0-SD', packSchemaId: 1, packSchemaLabel: '30 kg', lot: 'L1', active: true, sackColour: 'White', labelType: null, steamProg: null, routing: null, pdasCreatedAt: null },
    { palletId: 1010, productId: 11, productLabel: '201-IH0-SD', packSchemaId: 1, packSchemaLabel: null, lot: null, active: false, sackColour: null, labelType: null, steamProg: null, routing: null, pdasCreatedAt: null },
  ],
};

function mount(over: Routes = {}, rank = 1, url = '/next/?s=products&t=catalogue', go: GoMock = vi.fn<ScreenProps['go']>()) {
  window.history.replaceState(null, '', url);
  const route = parseRoute(new URLSearchParams(window.location.search));
  const ff = installFakeFetch(boardRoutes({ '/api/pallets': PALLETS, ...over }));
  const utils = render(
    <LiveProvider asOf={null}>
      <ProductsCatalogueScreen route={route} rank={rank} user={USER} go={go} />
    </LiveProvider>,
  );
  return { ...utils, go, route, ff };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const rowOf = (id: number) => screen.getByText(`id ${id}`).closest('tr') as HTMLElement;
const bodyRows = (c: HTMLElement, section: number) => Array.from(c.querySelectorAll('section')[section]!.querySelectorAll('tbody tr'));

async function loaded() {
  await screen.findByText('6 products are active in PDAS. 8 are retired.');
}

describe('Products > Catalogue', () => {
  it('counts active and retired products and lists the active ones first by default', async () => {
    const { container } = mount();
    await loaded();
    await screen.findByText('id 20');
    const rows = bodyRows(container, 1);
    expect(rows).toHaveLength(6);
    expect(rowOf(21).textContent).toContain('Blue');
    expect(rowOf(21).textContent).toMatch(/1,960\s?g/);
    expect(rowOf(21).textContent).toMatch(/± 50\s?g/);
    expect(rowOf(21).textContent).toContain('BLUE');
    expect(rowOf(21).textContent).toContain('36');
    expect(rowOf(21).textContent).toContain('Active');
  });

  it('filters retired and all, and searches by colour', async () => {
    const { container } = mount();
    await loaded();
    fireEvent.click(screen.getByRole('radio', { name: 'Retired 8' }));
    await waitFor(() => expect(bodyRows(container, 1)).toHaveLength(8));
    expect(rowOf(11).textContent).toContain('Retired');
    fireEvent.click(screen.getByRole('radio', { name: 'All 14' }));
    await waitFor(() => expect(bodyRows(container, 1)).toHaveLength(14));
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'star green' } });
    await waitFor(() => expect(bodyRows(container, 1)).toHaveLength(1));
    expect(screen.getByText('id 20')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'nothing like this' } });
    await screen.findByText('No product matches this search. Clear the search or change the filter.');
  });

  it('says which stations run each product now', async () => {
    mount();
    await loaded();
    await waitFor(() => expect(rowOf(21).textContent).toContain('8, 9, 10'));
    expect(rowOf(20).textContent).toContain('1, 2');
    expect(rowOf(1022).textContent).toContain('14');
    expect(rowOf(1021).textContent).toContain('None');
  });

  it('a link from the board marks the product it names', async () => {
    mount({}, 1, '/next/?s=products&t=catalogue&pr=21');
    await loaded();
    await screen.findByText('id 21');
    expect(rowOf(21).querySelector('[aria-current="true"]')).toBeTruthy();
    expect(rowOf(20).querySelector('[aria-current="true"]')).toBeNull();
  });

  it('New product opens the changeover plan', async () => {
    const { go } = mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'New product' }));
    expect(go).toHaveBeenCalledWith(expect.objectContaining({ s: 'products', t: 'changeover' }));
  });

  it('explains why a retired product cannot be recreated', async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByText('Why a retired product cannot be recreated'));
    expect(screen.getByText(/PDAS refuses a new product with the same blend, count and tube/)).toBeTruthy();
  });
});

describe('Retire and reactivate', () => {
  it('rank 1: no actions column and no buttons, products and pallets alike', async () => {
    mount();
    await loaded();
    await screen.findByText('Pallet 1023').catch(() => undefined);
    await screen.findByText('id 20');
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).toBeNull();
  });

  it('rank 2 with writes off: buttons are there but disabled, pointing at the one server reason', async () => {
    const { container } = mount({}, 2);
    await loaded();
    await screen.findByText('id 20');
    await waitFor(() => expect(container.querySelector('#pds-reason')).toBeTruthy());
    expect(container.querySelector('#pds-reason')!.textContent).toBe('Writing to PDAS was switched off in this system’s settings.');
    const b = within(rowOf(20)).getByRole('button', { name: 'Retire' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-describedby')).toBe('pds-reason');
    expect(container.textContent!.split('Writing to PDAS was switched off in this system’s settings.').length - 1).toBe(1);
  });

  it('rank 2 with writes on: needs a reason of ten characters, then sends it, and shows nothing before the answer', async () => {
    let body: unknown = null;
    let refetched = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mount({
      '/api/product-write/status': STATUS_ON,
      '/api/products': () => { refetched++; return boardRoutes()['/api/products']; },
      '/api/products/20/active': async ({ init }: { init?: RequestInit }) => {
        body = JSON.parse(String(init?.body));
        await gate;
        return { productId: 20, active: false, products: [] };
      },
    }, 2);
    await loaded();
    await screen.findByText('id 20');
    fireEvent.click(within(rowOf(20)).getByRole('button', { name: 'Retire' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Retire 205-IL0-SD/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retire' }));
    expect(await screen.findByText('Write at least 10 characters so the history says why.')).toBeTruthy();
    expect(body).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Why is this being done?'), { target: { value: 'Product 20 is no longer made' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(body).toEqual({ active: false, reason: 'Product 20 is no longer made' }));
    expect(screen.queryByText(/was retired in PDAS/)).toBeNull();
    const before = refetched;
    release();
    await screen.findByText(/was retired in PDAS\./);
    await waitFor(() => expect(refetched).toBeGreaterThan(before));
  });

  it('reactivating a retired product asks for active: true', async () => {
    let body: unknown = null;
    mount({
      '/api/product-write/status': STATUS_ON,
      '/api/products/11/active': async ({ init }: { init?: RequestInit }) => {
        body = JSON.parse(String(init?.body));
        return { productId: 11, active: true, products: [] };
      },
    }, 2);
    await loaded();
    fireEvent.click(screen.getByRole('radio', { name: 'Retired 8' }));
    fireEvent.click(within(await waitFor(() => rowOf(11))).getByRole('button', { name: 'Reactivate' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText('Why is this being done?'), { target: { value: 'Needed again for the autumn run' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(body).toEqual({ active: true, reason: 'Needed again for the autumn run' }));
    await screen.findByText(/was reactivated in PDAS\./);
  });

  it('a refusal is printed as the server worded it, and the page says nothing changed', async () => {
    mount({
      '/api/product-write/status': STATUS_ON,
      '/api/products/20/active': () => new Response(JSON.stringify({ error: 'Material already exist' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
    }, 2);
    await loaded();
    await screen.findByText('id 20');
    fireEvent.click(within(rowOf(20)).getByRole('button', { name: 'Retire' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText('Why is this being done?'), { target: { value: 'Retiring on purpose here' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retire' }));
    const banner = await screen.findByText('Not changed');
    const box = banner.closest('.pc-refusal') as HTMLElement;
    expect(box.textContent).toContain('Retire 205-IL0-SD');
    expect(box.querySelector('.pc-refusal__server')!.textContent).toBe('Material already exist');
    expect(screen.queryByText(/was retired in PDAS/)).toBeNull();
  });

  it('pallets: retire sends active: false, a retired pallet offers Reactivate', async () => {
    let body: unknown = null;
    mount({
      '/api/product-write/status': STATUS_ON,
      '/api/pallets/1023/active': async ({ init }: { init?: RequestInit }) => {
        body = JSON.parse(String(init?.body));
        return { palletId: 1023, active: false, pallets: [] };
      },
    }, 2);
    await loaded();
    const pallets = (await waitFor(() => {
      const t = document.querySelector('.ui-dt__wrap[aria-label="Pallets in PDAS"]');
      if (!t || !t.querySelector('tbody td')) throw new Error('pallets not drawn yet');
      return t;
    })) as HTMLElement;
    expect(within(pallets).getByRole('button', { name: 'Reactivate' })).toBeTruthy();
    fireEvent.click(within(pallets).getByRole('button', { name: 'Retire' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Retire Pallet 1023/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Why is this being done?'), { target: { value: 'Pallet is no longer used' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retire' }));
    await waitFor(() => expect(body).toEqual({ active: false, reason: 'Pallet is no longer used' }));
    await screen.findByText(/Pallet 1023 was retired in PDAS\./);
  });
});

describe('Catalogue failures name the part', () => {
  it('failed product list: named, with a way to try again, and no invented headline', async () => {
    mount({ '/api/products': () => new Response('{"error":"boom"}', { status: 500 }) });
    await screen.findByText("Couldn't load the product list.");
    expect(screen.queryByText(/products are active in PDAS/)).toBeNull();
  });

  it('failed pallet list: named; the products stay', async () => {
    mount({ '/api/pallets': () => new Response('{"error":"not found"}', { status: 404 }) });
    await loaded();
    await screen.findByText("Couldn't load the pallet list.");
    await screen.findByText('id 20');
  });

  it('failed station answer: "Running it now" is a dash and the part is named', async () => {
    mount({ '/api/machines/running': () => new Response('{"error":"boom"}', { status: 500 }) });
    await loaded();
    await screen.findByText(/The station products did not load/);
    expect(rowOf(21).textContent).not.toContain('None');
  });

  it('failed connection status: rank 2 is told the buttons are off for that reason', async () => {
    const { container } = mount({ '/api/product-write/status': () => new Response('{"error":"boom"}', { status: 500 }) }, 2);
    await loaded();
    await screen.findByText(/connection status did not load/);
    await screen.findByText('id 20');
    expect((within(rowOf(20)).getByRole('button', { name: 'Retire' }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('#pds-reason')).toBeNull();
  });
});
