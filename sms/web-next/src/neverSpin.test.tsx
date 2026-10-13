/**
 * A part must never spin forever (fix-wave T7a1, item 2). When the plant clock cannot be read there is no period, and two
 * parts used to wait on a never-settling promise behind a skeleton: the Reason sheet's "days for this reason" and the
 * Reports preview. Both now name the failure.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import '../../web/src/testkit/render';
import { installFakeFetch, type FakeFetch } from '../../web/src/testkit/fetchRouter';
import { live } from './bridge/lib';
import { ReasonSheet } from './sheets/ReasonSheet/ReasonSheet';
import { ReportDocument } from './screens/Reports/ReportDocument';
import type { ReportState } from './screens/Reports/useReport';

let fake: FakeFetch | null = null;
afterEach(() => {
  cleanup();
  fake?.restore();
  fake = null;
});

const down = () => new Response('{"error":"down"}', { status: 500 });
const USER = { username: 'u', displayName: 'U', role: 'manager' };

describe('no perpetual skeleton when the plant clock fails', () => {
  it('Reason sheet: the days part names the failure instead of spinning', async () => {
    fake = installFakeFetch({
      '/api/live': down,
      '/api/range': down,
      '/api/rejects/reason': down,
      '/api/stations': { stations: [] },
    });
    const route = { s: 'quality', t: 'rejects', keys: {}, wall: false, sheet: { kind: 'reason', id: '2026-09-01|quality|3|4' } } as never;
    const { baseElement } = render(
      <live.LiveProvider asOf={null}>
        <ReasonSheet route={route} rank={2} user={USER as never} go={() => {}} onClose={() => {}} />
      </live.LiveProvider>,
    );
    await waitFor(
      () => {
        const t = baseElement.textContent ?? '';
        expect(t).toMatch(/plant clock|data range|could not be read|couldn.t load/i);
      },
      { timeout: 4000 },
    );
    // the day table is not a skeleton: no loading placeholder remains inside the sheet's day table
    await waitFor(() => expect(baseElement.querySelector('.rs-body .ui-dt__skel')).toBeNull(), { timeout: 4000 });
  });

  it('Reports preview: with no period and a failed clock the document names the failure', () => {
    const state: ReportState = {
      q: null,
      readable: true,
      data: null,
      error: null,
      fetch: { status: 'loading', data: null, error: null, part: 'report', updatedAt: null, refresh: () => {} },
    };
    fake = installFakeFetch({ '/api/live': down });
    const { baseElement } = render(
      <live.LiveProvider asOf={null}>
        <ReportDocument
          type="daily"
          period={null}
          periodFailed="plant clock"
          state={state}
          user={USER as never}
          names={[]}
          products={[]}
          onOpenStation={() => {}}
          onOpenCode={() => {}}
        />
      </live.LiveProvider>,
    );
    expect(baseElement.textContent).toMatch(/plant clock/);
    expect(baseElement.textContent).toMatch(/needs the plant clock/);
    expect(baseElement.querySelector('.ui-skel')).toBeNull();
  });
});
