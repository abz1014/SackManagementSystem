// @vitest-environment jsdom
/**
 * Products & PDAS > Board (task E9), on the real figures of design/redesign-2026-10/mockup-data.json.
 * TRACE rows verified here:
 *   A3-075 / A1-074 / A2-067  one card per station from machines/running; running vs idle
 *   B4-02 / F-1               an idle station shows the last product it stamped and the time of that cone
 *   B4-03 / F-2 / VERIFY-D2-D4 changes are timed at the first cone; "since at least" at the lookback limit;
 *                             no change note when the server found none
 *   A1-029 / A1-030 / A4-04   the default product ("Default for readings without a product"), retired marker,
 *                             the change control absent below rank 2, a refusal printed as sent, no optimistic UI
 *   A1-031 / A3-065           the PDAS connection card on the board, the server reason as sent
 *   A3-028                    the machine matrix lives here (14 stations)
 *   (failure naming rule)     a failed part is named; what did load keeps its figures
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LiveProvider } from '../../../../../web/src/lib/live';
import { installDomStubs } from '../../../../../web/src/testkit/domStubs';
import { installFakeFetch, type Routes } from '../../../../../web/src/testkit/fetchRouter';
import { parseRoute } from '../../../route';
import type { ScreenProps } from '../../registry';
import { ProductsBoardScreen } from './ProductsBoard';
import { META, STATUS_ON, URL_PD1, boardRoutes, withRun } from '../testkit/mock';

installDomStubs();

const USER = { username: 'u', displayName: 'U', role: 'viewer' } as never;
type GoMock = ReturnType<typeof vi.fn<ScreenProps['go']>>;

function mount(over: Routes = {}, rank = 1, go: GoMock = vi.fn<ScreenProps['go']>()) {
  window.history.replaceState(null, '', URL_PD1);
  const route = parseRoute(new URLSearchParams(window.location.search));
  const ff = installFakeFetch(boardRoutes(over));
  const utils = render(
    <LiveProvider asOf={null}>
      <ProductsBoardScreen route={route} rank={rank} user={USER} go={go} />
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

const cardOf = (c: HTMLElement, n: number) => c.querySelector(`article[data-station="${n}"]`) as HTMLElement;
const cards = (c: HTMLElement) => Array.from(c.querySelectorAll('article[data-station]')) as HTMLElement[];

describe('Products > Board on PD1 (replayed at 1 Sep 2026)', () => {
  it('says how many stations run how many products, from the 14 station cards', async () => {
    const { container } = mount();
    await screen.findByText('6 stations are running 3 products. 8 are idle.');
    expect(cards(container)).toHaveLength(14);
    expect(screen.getByText(/Shown as at 1 Sep, 21:53\./)).toBeTruthy();
  });

  it('a running station shows its product, colour, target and tolerance, and the cones of the period', async () => {
    const { container } = mount();
    await screen.findByText('6 stations are running 3 products. 8 are idle.');
    const c = cardOf(container, 8);
    expect(c.textContent).toContain('Running');
    expect(c.textContent).toContain('205-IL0-SD');
    expect(c.textContent).toContain('Blue');
    expect(c.textContent).toMatch(/1,960\s?g ± 50\s?g/);
    await waitFor(() => expect(cardOf(container, 8).textContent).toContain('412'));
    expect(cardOf(container, 1).textContent).toContain('801');
  });

  it('an idle station names the last product it stamped and the time of that cone (F-1)', async () => {
    const { container } = mount();
    await screen.findByText('6 stations are running 3 products. 8 are idle.');
    const c = cardOf(container, 4);
    expect(c.textContent).toContain('Idle');
    expect(c.textContent).toContain('Last product it stamped');
    expect(c.textContent).toContain('205-IL0-SD');
    expect(c.textContent).toContain('Orange');
    expect(c.textContent).toContain('Last stamped');
    expect(c.textContent).toContain('28 Aug, 12:45');
    expect(c.textContent).toContain('7 Sep, 12:00');
    // Station 11 last stamped Blue (material 21); station 5 carries the plant's own name.
    expect(cardOf(container, 11).textContent).toContain('Blue');
    expect(cardOf(container, 5).textContent).toContain('East Conveyor');
  });

  it('an idle station whose cones carry no product says so instead of inventing one', async () => {
    const m = withRun({ 11: { lastMaterialId: null, lastProductName: null, lastProductActive: null, lastStampedUtc: null } });
    const { container } = mount({ '/api/machines/running': { data: m, metadata: META } });
    await screen.findByText('6 stations are running 3 products. 8 are idle.');
    const c = cardOf(container, 11);
    expect(c.textContent).toContain('No product recorded');
    expect(c.textContent).not.toContain('Blue');
  });

  it('wording: the run start is "since", and "since at least" at the lookback limit (VERIFY-D2-D4)', async () => {
    const m = withRun({
      1: { runStartUtc: '2026-09-01T19:55:53.890Z', runStartIsLookbackLimit: false },
      2: { runStartUtc: '2026-08-19T02:33:56.000Z', runStartIsLookbackLimit: true },
    });
    const { container } = mount({ '/api/machines/running': { data: m, metadata: META } });
    await screen.findByText('6 stations are running 3 products. 8 are idle.');
    const one = within(cardOf(container, 1));
    expect(one.getByText('Since')).toBeTruthy();
    expect(cardOf(container, 1).textContent).toContain('1 Sep, 19:55');
    const two = within(cardOf(container, 2));
    expect(two.getByText('Since at least')).toBeTruthy();
    expect(cardOf(container, 2).textContent).toContain('19 Aug, 02:33');
    // An older answer without runStartUtc falls back to the window start, which is never a start time.
    expect(within(cardOf(container, 8)).getByText('Since at least')).toBeTruthy();
  });

  it('a product change is timed at the first cone of the new product, on the card and in the timeline', async () => {
    const m = withRun({
      14: { runStartUtc: '2026-09-01T20:56:41.000Z', runStartIsLookbackLimit: false, lastChange: { fromMaterialId: 21, fromProductName: '205-IL0-SD', atUtc: '2026-09-01T20:56:41.000Z' } },
      9: { runStartUtc: '2026-09-01T20:43:14.000Z', runStartIsLookbackLimit: false, lastChange: { fromMaterialId: null, fromProductName: null, atUtc: '2026-09-01T20:43:14.000Z' } },
    });
    const { container } = mount({ '/api/machines/running': { data: m, metadata: META } });
    await screen.findByText('6 stations are running 3 products. 8 are idle.');
    expect(cardOf(container, 14).textContent).toContain('Changed from 205-IL0-SD Blue. First cone of this product: 1 Sep, 20:56.');
    expect(cardOf(container, 9).textContent).toContain('Changed from no product.');
    const items = Array.from(container.querySelectorAll('.pb-changes li'));
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('1 Sep, 20:56');
    expect(items[0]!.textContent).toContain('Station 14');
    expect(items[0]!.textContent).toContain('Started 205-IL0-SD CIR_RED, replacing 205-IL0-SD Blue');
    expect(screen.getByText('Timed at the first cone of the new product, not when the operator pressed the button.')).toBeTruthy();
  });

  it('no change note and an honest empty timeline when the server found no change', async () => {
    const { container } = mount();
    await screen.findByText('6 stations are running 3 products. 8 are idle.');
    expect(container.textContent).not.toContain('Changed from');
    expect(screen.getByText('No product change was found in the cones SMS looked back over.')).toBeTruthy();
  });

  it('the Running and Idle filters show 6 and 8 cards', async () => {
    const { container } = mount();
    await screen.findByText('6 stations are running 3 products. 8 are idle.');
    fireEvent.click(screen.getByRole('radio', { name: 'Running 6' }));
    expect(cards(container)).toHaveLength(6);
    fireEvent.click(screen.getByRole('radio', { name: 'Idle 8' }));
    expect(cards(container)).toHaveLength(8);
    fireEvent.click(screen.getByRole('radio', { name: 'All 14' }));
    expect(cards(container)).toHaveLength(14);
  });

  it('a station name opens the station sheet; the call to action goes to Changeover', async () => {
    const { container, go, route } = mount();
    await screen.findByText('6 stations are running 3 products. 8 are idle.');
    fireEvent.click(within(cardOf(container, 8)).getByRole('button', { name: 'Open Station 8' }));
    expect(go).toHaveBeenCalledWith({ ...route, sheet: { kind: 'station', id: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start a changeover' }));
    expect(go).toHaveBeenLastCalledWith(expect.objectContaining({ s: 'products', t: 'changeover', sheet: null }));
    expect(screen.getByText('Planning works now. Executing is off on this server.')).toBeTruthy();
  });

  it('prints the PDAS connection reason exactly as the server sent it', async () => {
    const { container } = mount();
    await screen.findByText('Writes switched off');
    expect(container.querySelector('#pds-reason')!.textContent).toBe('Writing to PDAS was switched off in this system’s settings.');
  });
});

describe('Default for readings without a product', () => {
  it('names the default with its limits and a retired marker, and says when it applies', async () => {
    const { container } = mount();
    const head = await screen.findByText('Default for readings without a product');
    const block = head.closest('section') as HTMLElement;
    await waitFor(() => expect(block.textContent).toContain('201-IH0-SD'));
    expect(block.textContent).toContain('(retired in PDAS)');
    expect(block.textContent).toMatch(/1,960\s?g ± 40\s?g/);
    expect(block.textContent).toContain('Set by Plant Admin on 2 Sep 2026.');
    expect(block.textContent).toContain('Only used for readings that carry no product');
    expect(container.textContent).toContain('See in catalogue');
  });

  it('the change control is absent at rank 1 and present at rank 2', async () => {
    mount({}, 1);
    await screen.findByText('Default for readings without a product');
    await screen.findByText('Set by Plant Admin on 2 Sep 2026.');
    expect(screen.queryByRole('button', { name: 'Change the default' })).toBeNull();
    cleanup();
    mount({}, 2);
    await screen.findByRole('button', { name: 'Change the default' });
  });

  it('changes only after confirming, sends the choice, and shows nothing until the server answers', async () => {
    let posted: unknown = null;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mount({
      '/api/current-product': async ({ init }: { init?: RequestInit }) => {
        if (init?.method === 'POST') {
          posted = JSON.parse(String(init.body));
          await gate;
          return { current: null };
        }
        return { current: { timelineId: '23', productId: 12, productLabel: '201-IH0-SD', effectiveFrom: '2026-09-02T07:03:58.046Z', changedAt: '2026-09-02T07:03:58.047Z', changedBy: 'Plant Admin', reason: null } };
      },
    }, 2);
    fireEvent.click(await screen.findByRole('button', { name: 'Change the default' }));
    fireEvent.change(await screen.findByLabelText('Product'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change default' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(posted).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change default' }));
    await waitFor(() => expect(posted).toEqual({ productId: 20 }));
    expect(screen.queryByText('The default product was changed.')).toBeNull();
    release();
    await screen.findByText('The default product was changed.');
  });

  it('a refusal from the server is shown as the server worded it', async () => {
    mount({
      '/api/current-product': async ({ init }: { init?: RequestInit }) =>
        init?.method === 'POST'
          ? new Response(JSON.stringify({ error: 'Product 20 is not in the product master.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
          : { current: null },
    }, 2);
    fireEvent.click(await screen.findByRole('button', { name: 'Change the default' }));
    fireEvent.change(await screen.findByLabelText('Product'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change default' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Change default' }));
    const alert = await screen.findByText(/The default product was not changed\./);
    expect(alert.textContent).toContain('Product 20 is not in the product master.');
  });

  it('writes on does not change the board: the connection card reads Writes on without a reason block', async () => {
    const { container } = mount({ '/api/product-write/status': STATUS_ON });
    await screen.findByText('Writes on');
    expect(container.querySelector('#pds-reason')).toBeNull();
    expect(screen.getByText('Plan it, review it, then execute it.')).toBeTruthy();
  });
});

describe('Board failures name the part', () => {
  it('failed cone counts: the cards stay, the figure is a dash, and the part is named', async () => {
    const { container } = mount({ '/api/production': () => new Response('{"error":"boom"}', { status: 500 }) });
    await screen.findByText('6 stations are running 3 products. 8 are idle.');
    await screen.findByText(/The cone counts did not load/);
    expect(cardOf(container, 8).textContent).toContain('Blue');
    expect(within(cardOf(container, 8)).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('failed product list: stations still show their products by name, and the part is named', async () => {
    const { container } = mount({ '/api/products': () => new Response('{"error":"boom"}', { status: 500 }) });
    await screen.findByText('6 stations are running 3 products. 8 are idle.');
    await screen.findByText(/The product list did not load/);
    expect(cardOf(container, 8).textContent).toContain('205-IL0-SD');
    expect(cardOf(container, 8).textContent).toContain('No target on record');
  });

  it('failed station answer: names the stations and offers to try again, with no invented headline', async () => {
    mount({ '/api/machines/running': () => new Response('{"error":"boom"}', { status: 500 }) });
    await screen.findByText("Couldn't load the stations.");
    expect(screen.queryByText(/stations are running/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('failed default product: names the part', async () => {
    mount({ '/api/current-product': () => new Response('{"error":"boom"}', { status: 500 }) });
    await screen.findByText("Couldn't load the default product.");
  });
});
