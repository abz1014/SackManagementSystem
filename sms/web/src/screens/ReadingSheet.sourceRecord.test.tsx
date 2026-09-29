/**
 * Re-audit fix (29 Sep 2026): ReadingSheet.tsx's own top-level field showed
 * `row.source_row_id` under the word "Record" (`W.readings.record`) — the
 * exact same word the Readings LIST column uses for `event_id`, the
 * canonical PK (Readings.tsx:601/613). Same word, two different ids,
 * depending on whether you were looking at the list or the sheet. Relabelled
 * "Source record" (`W.readings.sourceRecord`); the provenance block's own
 * "Source row id" line is kept — not fully redundant, since it renders only
 * when the fuller `provenance` object is present, while the top-level field
 * renders whenever `source_row_id` itself is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeFetch } from '../testkit/fetchRouter';
import { renderWithLive } from '../testkit/render';
import { LIVE_FIXTURE } from '../testkit/fixtures';
import { W } from '../lib/words';
import { ReadingSheet } from './ReadingSheet';

afterEach(() => {
  vi.unstubAllGlobals();
});

function noop(): void {}

const SOURCE_ROW_ID = 4242;

function routes() {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/stations': { stations: [] },
    '/api/product-at': {
      at: '2026-09-07T10:00:00Z', product: null, limits: null, neverRecorded: true, attribution: null, verdict: null, limitsAreLowerBound: false,
    },
    '/api/events/cone/1': {
      row: {
        event_id: 1, source_row_id: SOURCE_ROW_ID, source_epoch: 9, source_epoch_label: 'September copy',
        production_ts_utc: '2026-09-07T10:00:00Z', shift_code: 'morning', shift_date: '2026-09-07', shift_code_legacy: 'morning',
        weight_g: 1900, in_range: true, material_id: null, hanger_num: 1, source_station: null, merge_key_is_unique: true,
      },
    },
  };
}

describe('ReadingSheet — top-level id field, relabelled (re-audit fix, 29 Sep 2026)', () => {
  it('labels the top-level source_row_id field "Source record", never "Record"', async () => {
    installFakeFetch(routes());
    const { findByText, queryByText } = renderWithLive(
      <ReadingSheet type="cone" id="1" onClose={noop} onOpenProductReport={noop} onOpenProductCatalogue={noop} />,
    );

    await findByText(W.readings.sourceRecord);
    await findByText(String(SOURCE_ROW_ID));
    // The old, ambiguous label must be gone from the sheet's top-level
    // fields — Readings.tsx's own list column still legitimately uses
    // "Record" for event_id elsewhere; this sheet must not.
    expect(queryByText(W.readings.record)).toBeNull();
  });
});
