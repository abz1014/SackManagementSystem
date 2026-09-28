/**
 * Task B (28 Sep 2026, owner decision): "Sacks history uses auto plus one
 * disclosure sentence." No switch here (Readings owns that) — this is the
 * same rows in a second place, per Sacks.tsx's own file header.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE, REGISTER_PAGE_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import { History } from './Sacks';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PERIOD: Period = {
  key: 'shift', from: '2026-09-07', to: '2026-09-07', tsFrom: '2026-09-07T09:00:00Z', tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening', live: true, days: 1,
} as unknown as Period;

function noop(): void {}
function baseProps() {
  return { period: PERIOD, page: 1, onPageChange: noop, onOpenReading: noop };
}

describe('Sacks — History batch disclosure (owner decision, 28 Sep 2026)', () => {
  it('appends the "Data batch" sentence to the existing count note when the response names one', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/events': {
        data: {
          ...REGISTER_PAGE_FIXTURE.data,
          generation: {
            generation: { key: 'DATA_TP1U2_SEP07#3', ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy', label: 'September copy - sacks', simulator: false },
            spansGenerations: true, otherGenerationExcluded: 4, excludedSimulator: 4,
          },
        },
        metadata: META_FIXTURE,
      },
    });

    const { container } = renderWithLive(<History {...baseProps()} />);
    await waitFor(() => {
      expect(container.textContent).toContain(W.readings.batch.current('IFL data batch 3'));
    });
  });

  it('no batch sentence when the response carries no generation (an older server, or nothing to disclose)', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/events': { data: REGISTER_PAGE_FIXTURE.data, metadata: META_FIXTURE },
    });

    const { container } = renderWithLive(<History {...baseProps()} />);
    await waitFor(() => {
      expect(container.textContent).toContain(W.sacks.historyNote(String(REGISTER_PAGE_FIXTURE.data.total)));
    });
    expect(container.textContent).not.toContain('Data batch:');
  });
});
