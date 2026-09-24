/**
 * RT24-05: PdasWriteBlock renders health's `pdasWrite` fold in plain words —
 * follows the project's reliability rule (CLAUDE.md): a fact this system
 * could not check must say so, never render as though nothing is wrong.
 * Takes `report` as a plain prop (no `useLive()`), so a plain RTL render is
 * enough — no LiveProvider/fetch fixtures needed.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { W } from '../../lib/words';
import { PdasWriteBlock } from './PdasWriteBlock';
import type { HealthReport } from '../../api';

const BASE_REPORT: HealthReport = {
  status: 'ok',
  service: { version: '1.0.0', uptimeSeconds: 100, startedAtUtc: '2026-09-24T00:00:00.000Z', pid: 1 },
  database: { ok: true, latencyMs: 3, sizeMb: 100, capMb: 10240, pctOfCap: 1 },
  acquisition: { kind: 'ok', ageSeconds: 10, cadenceSeconds: 60, halted: [], generation: null },
  backup: null,
  degradedReason: null,
  pdasWrite: null,
};

describe('PdasWriteBlock', () => {
  it('writes disabled: states plainly that there is nothing to check', () => {
    const { getByText } = render(
      <PdasWriteBlock report={{ ...BASE_REPORT, pdasWrite: { enabled: false, canReadBack: null, missingSelect: [], missingExecute: [], unverifiedSinceStartup: [], lastVerifiedUtc: null } }} error={null} onRetry={() => {}} />,
    );
    getByText(W.health.pdasWriteOffTitle);
    getByText(W.health.pdasWriteOff);
  });

  it('writes enabled, canReadBack true: "Checked after writing: yes"', () => {
    const { getByText } = render(
      <PdasWriteBlock
        report={{ ...BASE_REPORT, pdasWrite: { enabled: true, canReadBack: true, missingSelect: [], missingExecute: [], unverifiedSinceStartup: [], lastVerifiedUtc: '2026-09-24T01:00:00.000Z' } }}
        error={null}
        onRetry={() => {}}
      />,
    );
    getByText(W.health.checkedYes);
    getByText(W.health.unverifiedTablesNone);
  });

  /* The exact scenario RT24-05 exists for: an EXECUTE-only writer login that
     cannot read Blends, Counts, TubeTypes, Pallets back. */
  it('writes enabled, canReadBack false — renders "Checked after writing: no" naming the tables', () => {
    const { getByText } = render(
      <PdasWriteBlock
        report={{
          ...BASE_REPORT,
          pdasWrite: {
            enabled: true,
            canReadBack: false,
            missingSelect: ['Blends', 'Counts', 'TubeTypes', 'Pallets'],
            missingExecute: [],
            unverifiedSinceStartup: ['blend', 'yarn_count'],
            lastVerifiedUtc: null,
          },
        }}
        error={null}
        onRetry={() => {}}
      />,
    );
    getByText(W.health.checkedNo('Blends, Counts, TubeTypes, Pallets'));
    getByText(W.health.unverifiedTablesNote('blend, yarn_count'));
    getByText(W.health.lastVerifiedNever);
  });

  it('canReadBack null (probe itself failed) renders the "could not be determined" sentence, never "yes" or "no"', () => {
    const { getByText, queryByText } = render(
      <PdasWriteBlock
        report={{ ...BASE_REPORT, pdasWrite: { enabled: true, canReadBack: null, missingSelect: [], missingExecute: [], unverifiedSinceStartup: [], lastVerifiedUtc: null } }}
        error={null}
        onRetry={() => {}}
      />,
    );
    getByText(W.health.checkedUnknown);
    expect(queryByText(W.health.checkedYes)).toBeNull();
  });

  it('a failed /api/health fetch renders the shared Failed state, not a false "off"', () => {
    const { getByText } = render(<PdasWriteBlock report={null} error="network down" onRetry={() => {}} />);
    getByText(W.couldNotLoad);
  });
});
