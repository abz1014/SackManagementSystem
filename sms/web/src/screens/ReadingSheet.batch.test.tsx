/**
 * Task B (28 Sep 2026): "ReadingSheet passes batch=epoch:<sack epochId> for
 * the cones-since-previous-sack count" — both the previous-sack lookup and
 * the cones-in-between count must carry the OPEN sack's own generation, or
 * the count could silently mix two source generations (see
 * `conesSincePreviousSack`'s own comment in ReadingSheet.tsx).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import { ReadingSheet } from './ReadingSheet';

afterEach(() => {
  vi.unstubAllGlobals();
});

function noop(): void {}

const CURRENT_SACK_TS = '2026-09-07T16:00:00Z';
const PREVIOUS_SACK_TS = '2026-09-07T15:30:00Z';
const SACK_EPOCH_ID = 9;

function routes() {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/stations': { stations: [] },
    '/api/product-at': {
      at: CURRENT_SACK_TS, product: null, limits: null, neverRecorded: true, attribution: null, verdict: null, limitsAreLowerBound: false,
    },
    '/api/events/sack/1': {
      row: {
        event_id: 1, source_row_id: 1, source_epoch: SACK_EPOCH_ID, source_epoch_label: 'September copy - sacks',
        production_ts_utc: CURRENT_SACK_TS, shift_code: 'evening', shift_date: '2026-09-07', shift_code_legacy: 'evening',
        sack_num: 5, weight_kg: 49.1, in_range: true, material_id: null, lot_code: null, merge_key_is_unique: true,
        provenance: {
          sourceSystem: 'ifl_sql', sourceTable: 'sack1_TP1U2', epochLabel: 'September copy - sacks',
          sourceRowId: 1, rawId: 1, sourceInsertUtc: null, ingestedAtUtc: null, ingestRunId: null,
          transformVersion: 1, attributionMethod: null, attributionConfidence: null, nightBelongsTo: null,
          epochId: SACK_EPOCH_ID, epochOrdinal: 3, epochSimulator: false,
        },
      },
    },
    '/api/events': ({ search }: { search: URLSearchParams }) => {
      if (search.get('type') === 'sack') {
        // The previous-sack lookup — one row, earlier than the open sack.
        return {
          data: {
            rows: [{
              event_id: 0, source_row_id: 0, source_epoch: SACK_EPOCH_ID, source_epoch_label: 'September copy - sacks',
              production_ts_utc: PREVIOUS_SACK_TS, shift_code: 'evening', shift_date: '2026-09-07', shift_code_legacy: 'evening',
              sack_num: 4, weight_kg: 48.9, in_range: true, material_id: null, lot_code: null, merge_key_is_unique: true,
            }],
            total: 1, page: 1, pageSize: 2,
          },
          metadata: {},
        };
      }
      // The cones-in-between count.
      return { data: { rows: [], total: 37, page: 1, pageSize: 1 }, metadata: {} };
    },
  };
}

describe('ReadingSheet — cones-since-previous-sack carries the open sack\'s own batch (Task B, 28 Sep 2026)', () => {
  it('both the previous-sack lookup and the cone count are scoped to epoch:<the open sack\'s own epochId>', async () => {
    const fake = installFakeFetch(routes());
    const { findByText } = renderWithLive(
      <ReadingSheet type="sack" id="1" onClose={noop} onOpenProductReport={noop} onOpenProductCatalogue={noop} />,
    );

    await findByText(W.readings.aroundSack(37));

    await waitFor(() => {
      const sackLookup = fake.requests.find((r) => r.includes('/api/events') && r.includes('type=sack') && r.includes('tsTo='));
      const coneCount = fake.requests.find((r) => r.includes('/api/events') && r.includes('type=cone'));
      expect(sackLookup, 'previous-sack lookup was not requested').toBeTruthy();
      expect(coneCount, 'cone count was not requested').toBeTruthy();
      expect(new URL(sackLookup!, 'http://localhost').searchParams.get('batch')).toBe(`epoch:${SACK_EPOCH_ID}`);
      expect(new URL(coneCount!, 'http://localhost').searchParams.get('batch')).toBe(`epoch:${SACK_EPOCH_ID}`);
    });
  });
});
