/**
 * Task W1-D (29 Sep 2026, failure analysis F-26/F-27/F-31) — Catalogue's
 * "Change weight limits" form (`LimitsForm`) becomes two steps: review, then
 * a separate write. Proves:
 *  - a single click on the review-step submit never calls
 *    POST /api/products/:id/limits;
 *  - review then confirm calls it exactly once, with the requested body;
 *  - for a large change (more than the client's own mirror of the server's
 *    default bounds — 3% setpoint / 20 g either offset), the confirm button
 *    stays disabled until the large-change checkbox is ticked AND the reason
 *    is at least 20 characters; ticking/untyping toggles it live.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { render } from '../../testkit/render';
import { installFakeFetch, type RouteRequest } from '../../testkit/fetchRouter';
import type { ProductOption } from '../../api';
import { W } from '../../lib/words';
import { CatalogueTab } from './Catalogue';

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

const BASE_ROUTES = {
  '/api/products': { products: [PRODUCT] },
  '/api/products/limits/history': { products: [] },
  '/api/pallets': { pallets: [] },
  '/api/product-write/status': { enabled: true, reason: null, canWrite: true, local: { canWrite: true } },
};

async function openLimitsForm() {
  const utils = render(<CatalogueTab productId={null} onProductIdChange={() => {}} />);
  await waitFor(() => {
    expect(utils.getAllByText(W.product.changeLimits).length).toBeGreaterThan(0);
  });
  fireEvent.click(utils.getAllByText(W.product.changeLimits)[0]!);
  await waitFor(() => {
    expect(utils.container.textContent ?? '').toContain(W.product.changeLimitsReviewStep);
  });
  return utils;
}

describe('Product › Catalogue — change-limits form is two steps; one click never writes', () => {
  it('a small change: step 1 submit does not POST; step 2 confirm POSTs exactly once', async () => {
    let calls = 0;
    let lastBody: unknown = null;
    installFakeFetch({
      ...BASE_ROUTES,
      '/api/products/21/limits': (req: RouteRequest) => {
        calls += 1;
        lastBody = JSON.parse((req.init?.body as string) ?? '{}');
        return { productId: 21, observedAfter: { setpointG: 1965, offsetMinusG: 30, offsetPlusG: 30, desc1: null, desc2: null, active: true }, products: [PRODUCT] };
      },
    });

    const { container, getByText } = await openLimitsForm();

    // Change the setpoint by a small, ordinary amount (well under the 3% bound).
    const spInput = getByText(W.product.setpointG).closest('label')!.querySelector('input')!;
    fireEvent.change(spInput, { target: { value: '1965' } });
    const reasonInput = getByText(W.product.whyRequired).closest('label')!.querySelector('input')!;
    fireEvent.change(reasonInput, { target: { value: 'A good enough reason for this change' } });

    // Step 1 submit: moves to the review step, never calls the write route.
    fireEvent.click(getByText(W.product.changeLimitsReviewNext, { selector: 'button[type="submit"]' }));
    await waitFor(() => {
      expect(container.textContent ?? '').toContain(W.product.changeLimitsWriteStep);
    });
    expect(calls).toBe(0);

    // The review step shows the signed delta.
    expect(container.textContent ?? '').toContain('1,965');
    expect(container.textContent ?? '').toContain('+5');

    // No large-change checkbox for an ordinary change.
    expect(container.textContent ?? '').not.toContain(W.product.largeChangeHeading);

    // Step 2 confirm: exactly one POST, with the requested before/after/reason.
    fireEvent.click(getByText(W.product.changeLimitsConfirm, { selector: 'button[type="submit"]' }));
    await waitFor(() => {
      expect(calls).toBe(1);
    });
    expect(lastBody).toMatchObject({
      before: { setpointG: 1960, offsetMinusG: 30, offsetPlusG: 30 },
      after: { setpointG: 1965, offsetMinusG: 30, offsetPlusG: 30 },
      reason: 'A good enough reason for this change',
    });
  });

  it('a large change: confirm is disabled until the checkbox is ticked and the reason is >= 20 chars', async () => {
    let calls = 0;
    let lastBody: unknown = null;
    installFakeFetch({
      ...BASE_ROUTES,
      '/api/products/21/limits': (req: RouteRequest) => {
        calls += 1;
        lastBody = JSON.parse((req.init?.body as string) ?? '{}');
        return { productId: 21, observedAfter: { setpointG: 2100, offsetMinusG: 30, offsetPlusG: 30, desc1: null, desc2: null, active: true }, products: [PRODUCT] };
      },
    });

    const { container, getByText, getByRole } = await openLimitsForm();

    // 1960 -> 2100 is +7.1%, well past the 3% mirror threshold.
    const spInput = getByText(W.product.setpointG).closest('label')!.querySelector('input')!;
    fireEvent.change(spInput, { target: { value: '2100' } });
    const reasonInput1 = getByText(W.product.whyRequired).closest('label')!.querySelector('input')!;
    fireEvent.change(reasonInput1, { target: { value: 'short but 10+ chars' } });

    fireEvent.click(getByText(W.product.changeLimitsReviewNext, { selector: 'button[type="submit"]' }));
    await waitFor(() => {
      expect(container.textContent ?? '').toContain(W.product.largeChangeHeading);
    });

    const confirmBtn = getByText(W.product.changeLimitsConfirm, { selector: 'button[type="submit"]' }) as HTMLButtonElement;
    // Not yet checked, and the carried-over reason ('short but 10+ chars',
    // 20 chars) is right at the edge — assert disabled while unchecked regardless.
    expect(confirmBtn.disabled).toBe(true);

    const checkbox = getByRole('checkbox') as HTMLInputElement;
    fireEvent.click(checkbox);
    // Checked, but the reason on step 2 is still whatever was carried over;
    // force it short to prove the reason length is checked independently of the checkbox.
    const reasonInput2 = getByText(W.product.whyRequired).closest('label')!.querySelector('input')!;
    fireEvent.change(reasonInput2, { target: { value: 'too short' } });
    expect((getByText(W.product.changeLimitsConfirm, { selector: 'button[type="submit"]' }) as HTMLButtonElement).disabled).toBe(true);

    // A reason of at least 20 characters, checkbox still ticked: now enabled.
    fireEvent.change(reasonInput2, { target: { value: 'A twenty character reason, easily' } });
    await waitFor(() => {
      expect((getByText(W.product.changeLimitsConfirm, { selector: 'button[type="submit"]' }) as HTMLButtonElement).disabled).toBe(false);
    });

    fireEvent.click(getByText(W.product.changeLimitsConfirm, { selector: 'button[type="submit"]' }));
    await waitFor(() => {
      expect(calls).toBe(1);
    });
    expect(lastBody).toMatchObject({ largeChangeConfirmed: true });
  });
});
