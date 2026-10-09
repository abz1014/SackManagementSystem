/** C-005: synthetic Product report payloads (invented rows shaped like the measured 11 Aug evening figures), with and without the station filter. */
import { reportEnvelope } from './mocks';

const NOTE = 'Sacks are not shown: the sack scale records no winder, so sack figures cannot be narrowed to station 4.';
const STATES = { within: 40, low: 2, high: 1, rejected: 1, unknown: 0 };

function row(id: number, cones: number, rej: number, sacks: number | null) {
  return {
    group: String(id), cones, rejectedCones: rej, rejectRatePct: 2, conesInRangePct: 97,
    sacks, sackWeightKg: sacks == null ? null : sacks * 47, avgSackKg: sacks == null ? null : 47, conesPerSack: sacks ? 25 : null,
    productId: id, productLabel: `Product ${id}`, weight: { n: cones, avgG: 1951, sdG: 12, minG: 1920, maxG: 1985 },
    states: STATES, implausible: 0, target: null, vsTargetG: null, productActive: true,
  };
}

export function productReportEnvelope(stationFiltered: boolean): unknown {
  const env = JSON.parse(JSON.stringify(reportEnvelope('station')));
  env.data.header = { ...env.data.header, reportType: 'product', title: 'Product', filters: stationFiltered ? { station: 4 } : {} };
  env.data.report = stationFiltered
    ? {
        period: env.data.header.period, filters: { station: 4 },
        rows: [row(21, 44, 1, null), row(1021, 69, 3, null)],
        unattributed: { cones: 0, rejects: 0, sacks: null, ofCones: 113, ofRejects: 4, ofSacks: null },
        note: 'Each reading is grouped by the product recorded on it by the plant.',
        sacksOmitted: true, sackNote: NOTE,
      }
    : {
        period: env.data.header.period, filters: {},
        rows: [row(20, 532, 15, 20), row(21, 1103, 14, 43), row(1021, 278, 37, 0)],
        unattributed: { cones: 0, rejects: 0, sacks: 0, ofCones: 1913, ofRejects: 66, ofSacks: 63 },
        note: 'Each reading is grouped by the product recorded on it by the plant.',
      };
  return env;
}
