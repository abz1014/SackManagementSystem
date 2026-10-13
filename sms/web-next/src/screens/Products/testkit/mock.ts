/**
 * Real figures for the Products tests: design/redesign-2026-10/mockup-data.json, fetched read-only from
 * sms_audit on 13 Oct 2026. PD1 is 1 Sep 2026; machines/running is replayed at 1 Sep 2026 21:53 (the
 * 2-hour window ends at the newest cone before 22:00). That snapshot predates `runStartUtc` and
 * `lastChange`, so tests that need them add them to a copy (see `withRun`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIVE_FIXTURE } from '../../../../../web/src/testkit/fixtures';
import type { Routes } from '../../../../../web/src/testkit/fetchRouter';

// vitest runs from sms/; the design folder sits beside it. (import.meta.url is not a file URL in jsdom.)
const FILE = resolve(process.cwd(), '..', 'design', 'redesign-2026-10', 'mockup-data.json');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MOCK: any = JSON.parse(readFileSync(FILE, 'utf8'));

export const META = LIVE_FIXTURE.metadata;
export const URL_PD1 = '/next/?s=products&t=board&p=pick&from=2026-09-01&to=2026-09-01';
export const RANGE = { minDate: '2026-08-05', maxDate: '2026-09-07', excludedDays: [], minProductionRows: 50 };

export const STATUS_OFF = { enabled: false, reason: 'PDAS_WRITE_ENABLED is not true.', canWrite: false, local: { canWrite: true } };
export const STATUS_ON = { enabled: true, reason: null, canWrite: true, local: { canWrite: true } };

export function machines() {
  return JSON.parse(JSON.stringify(MOCK.pd1.raw.machinesRunning));
}

export type MachinePatch = Record<number, Record<string, unknown>>;

/** The machines answer with fields patched on chosen stations. */
export function withRun(patch: MachinePatch) {
  const m = machines();
  for (const row of m.machines) Object.assign(row, patch[row.station] ?? {});
  return m;
}

export function production() {
  return { data: MOCK.pd1.raw.prodStation, metadata: META };
}

export function products() {
  return JSON.parse(JSON.stringify(MOCK.refs.products));
}

export function boardRoutes(over: Routes = {}): Routes {
  return {
    '/api/live': LIVE_FIXTURE,
    '/api/range': RANGE,
    '/api/machines/running': { data: machines(), metadata: META },
    '/api/products': products(),
    '/api/current-product': MOCK.refs.currentProduct,
    '/api/production': production(),
    '/api/product-write/status': STATUS_OFF,
    ...over,
  };
}
