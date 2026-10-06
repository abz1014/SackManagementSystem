/** CSS-017 fixture: /api/system-history with four source generations whose "Registered by" text is long (as real entries are). Synthetic only. */
import { META } from './mocks';

export function systemHistory() {
  const gens = [
    ['pack1_TP1U2', 1, 'cli:epoch-accept', '2026-06-22T04:10:00Z', '2026-07-10T11:23:10Z', '2026-07-10T12:00:00Z', 142511],
    ['pack1_TP1U2', 2, 'cli:epoch-accept', '2026-08-05T04:10:00Z', '2026-09-07T12:00:28Z', null, 132552],
    ['sack1_TP1U2', 1, 'cli:epoch-accept', '2026-06-22T04:10:00Z', '2026-07-10T11:23:10Z', '2026-07-10T12:00:00Z', 5462],
    ['sack1_TP1U2', 2, 'cli:epoch-accept', '2026-08-05T04:10:00Z', '2026-09-07T12:00:28Z', null, 5435],
  ] as const;
  return {
    data: {
      generations: gens.map((g, i) => ({
        epochId: i + 1, sourceTable: g[0], label: `${g[0]} generation ${g[1]}`, generationOrdinal: g[1], provenance: 'ifl_sql',
        sourceServer: 'PLANT\SQL', sourceDb: 'DATA_TP1U2', firstSeenUtc: g[3], lastSeenUtc: g[4], closedUtc: g[5],
        registeredBy: g[2], archivedBelowId: null, archivedObservedUtc: null, rawRowCount: g[6],
      })),
      rebuilds: [],
      verifyRuns: [],
    },
    metadata: META,
  };
}
