/**
 * Task B (28 Sep 2026, owner decision): the Readings register lists ONE
 * data batch by default and discloses the others, with a switch to them.
 *
 * Driven by payloads (`installFakeFetch`), same idiom as Sacks.history.test.tsx
 * and hops.test.tsx — the real `ReadingsScreen`, a fake `/api/events` that
 * answers per the `batch` query param it was actually asked with, and RTL's
 * `fireEvent` for the switch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE, META_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import type { Period } from '../lib/period';
import { ReadingsScreen } from './Readings';
import type { RegisterPage, RegisterRow } from '../api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const PERIOD: Period = {
  key: 'shift', from: '2026-09-07', to: '2026-09-07', tsFrom: '2026-09-07T09:00:00Z', tsTo: '2026-09-07T17:00:00Z',
  shift: 'evening', live: false, days: 1,
} as unknown as Period;

function noop(): void {}

function baseProps() {
  return {
    period: PERIOD,
    listing: 'sacks' as const,
    onListingChange: noop,
    station: null,
    onStationChange: noop,
    states: [],
    onStatesChange: noop,
    page: 1,
    onPageChange: noop,
    onOpenReading: noop,
    canExport: false,
  };
}

const SEPT_ROW: RegisterRow = {
  event_id: 1, source_row_id: 1, source_epoch: 9, source_epoch_label: 'September copy - sacks',
  production_ts_utc: '2026-09-07T16:00:00Z', shift_code: 'evening', shift_date: '2026-09-07', shift_code_legacy: 'evening',
  sack_num: 1, weight_kg: 49.1, in_range: true, material_id: null, lot_code: null, merge_key_is_unique: true,
};
const SIM_ROW: RegisterRow = {
  ...SEPT_ROW, event_id: 101, source_epoch: 14, source_epoch_label: 'sack1_TP1U2 gen 4',
};

const GEN_SEPT = { key: 'DATA_TP1U2_SEP07#3', ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', label: 'September copy - sacks', simulator: false, rows: 1 };
const GEN_SIM = { key: 'DATA_TP1U2_SIM#4', ordinal: 4, sourceDb: 'DATA_TP1U2_SIM', label: 'sack1_TP1U2 gen 4', simulator: true, rows: 1 };

function pageFor(batch: string | null): RegisterPage {
  const sim = batch === 'DATA_TP1U2_SIM#4';
  return {
    rows: [sim ? SIM_ROW : SEPT_ROW],
    total: 1,
    page: 1,
    pageSize: 100,
    generations: [GEN_SEPT, GEN_SIM],
    generation: {
      generation: sim
        ? { key: GEN_SIM.key, ordinal: 4, sourceDb: 'DATA_TP1U2_SIM', provenance: 'ifl_copy', label: GEN_SIM.label, simulator: true }
        : { key: GEN_SEPT.key, ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy', label: GEN_SEPT.label, simulator: false },
      spansGenerations: true,
      otherGenerationExcluded: 1,
      excludedSimulator: 1,
    },
  };
}

function routes() {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/stations': { stations: [] },
    '/api/events': ({ search }: { search: URLSearchParams }) => ({
      data: pageFor(search.get('batch')),
      metadata: META_FIXTURE,
    }),
  };
}

describe('Readings — batch disclosure and switch (owner decision, 28 Sep 2026)', () => {
  it('defaults to auto and discloses the other batch with a count and a "Show them" switch', async () => {
    installFakeFetch(routes());
    const { findByText, container } = renderWithLive(<ReadingsScreen {...baseProps()} />);

    await findByText(W.readings.batch.current('IFL data batch 3'));
    await waitFor(() => {
      expect(container.textContent).toContain(W.readings.batch.also('Simulator data batch 4', '1'));
    });
    await findByText(W.readings.batch.show);
  });

  it('clicking "Show them" re-fetches with the explicit batch key and now shows that batch as current', async () => {
    const fake = installFakeFetch(routes());
    const { findByText } = renderWithLive(<ReadingsScreen {...baseProps()} />);

    const show = await findByText(W.readings.batch.show);
    fireEvent.click(show);

    await findByText(W.readings.batch.showing('Simulator data batch 4'));
    await findByText(W.readings.batch.backToDefault);

    await waitFor(() => {
      const asked = fake.requests.find((r) => r.includes('/api/events') && r.includes('batch=DATA_TP1U2_SIM'));
      expect(asked).toBeTruthy();
    });
  });

  it('"Back to the default batch" returns to auto', async () => {
    installFakeFetch(routes());
    const { findByText } = renderWithLive(<ReadingsScreen {...baseProps()} />);

    fireEvent.click(await findByText(W.readings.batch.show));
    fireEvent.click(await findByText(W.readings.batch.backToDefault));

    await findByText(W.readings.batch.current('IFL data batch 3'));
  });

  it('no disclosure line at all when the period holds only one batch', async () => {
    installFakeFetch({
      '/api/live': LIVE_FIXTURE,
      '/api/stations': { stations: [] },
      '/api/events': {
        data: {
          rows: [SEPT_ROW], total: 1, page: 1, pageSize: 100,
          generations: [GEN_SEPT],
          generation: {
            generation: { key: GEN_SEPT.key, ordinal: 3, sourceDb: 'DATA_TP1U2_SEP07', provenance: 'ifl_copy', label: GEN_SEPT.label, simulator: false },
            spansGenerations: false, otherGenerationExcluded: 0, excludedSimulator: 0,
          },
        },
        metadata: META_FIXTURE,
      },
    });
    const { findByText, queryByText } = renderWithLive(<ReadingsScreen {...baseProps()} />);
    await findByText(W.readings.batch.current('IFL data batch 3'));
    expect(queryByText(W.readings.batch.show)).toBeNull();
  });
});
