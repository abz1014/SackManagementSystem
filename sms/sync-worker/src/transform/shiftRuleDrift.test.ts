import { describe, expect, it } from 'vitest';
import type { ConnectionPool } from 'mssql';
import { shiftRuleDriftFindingsFor, checkShiftRuleDrift } from './shiftRuleDrift.js';
import type { ShiftRuleVersion } from './ruleHistory.js';
import { wallClockOf, shiftCodeOf, shiftDateOf } from './wallClock.js';

const oldRule: ShiftRuleVersion = {
  effectiveAtPlantMs: -Infinity,
  rule: { boundaries: { morningStart: 360, eveningStart: 840, nightStart: 1320 }, nightBelongsTo: 'start_day', mode: 'corrected' },
};
const newRule: ShiftRuleVersion = {
  effectiveAtPlantMs: Date.parse('2026-09-14T15:43:19Z'), // plant time, already converted
  rule: { boundaries: { morningStart: 330, eveningStart: 810, nightStart: 1290 }, nightBelongsTo: 'start_day', mode: 'corrected' },
};

describe('shiftRuleDriftFindingsFor — a fixture that mismatches', () => {
  it('fires when a stored row was stamped under a rule that was not in force at its own time', () => {
    // 09:15 plant time, AFTER the new rule (05:30 boundary) took effect — the row
    // is truly in the morning shift under both rules, but it was WRONGLY stamped
    // as 'night' (as if the old 06:00 boundary meant it hadn't started yet is not
    // even consistent — this simulates a stale-rule restamp: the OLD rule's shift
    // code was baked in after the new rule should have applied).
    const rowMs = newRule.effectiveAtPlantMs + 3 * 60 * 60_000; // 3h after the rule change
    const rows = [
      {
        raw_id: 42,
        production_ts_utc_ms: rowMs,
        shift_code: 'night', // wrong: should be 'morning' under either rule at this hour, planted to force a mismatch
        shift_date: new Date('2000-01-01'),
      },
    ];
    const findings = shiftRuleDriftFindingsFor(rows, [oldRule, newRule], 1);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.check_name).toBe('shift_rule_drift');
    expect(findings[0]!.severity).toBe('WARNING');
    expect(findings[0]!.count).toBe(1);
    expect(findings[0]!.subject_ref).toBe(42);
    expect(findings[0]!.detail).toMatch(/1 of 1 sampled/);
    expect(findings[0]!.detail).toMatch(/2 sms\.shift_rule versions/);
  });

  it('is a no-op when every sampled row already matches its as-of rule', () => {
    const rowMs = newRule.effectiveAtPlantMs + 3 * 60 * 60_000; // 3h after the rule change
    const wc = wallClockOf(new Date(rowMs));
    const expectedCode = shiftCodeOf(wc, newRule.rule.boundaries);
    const expectedDate = shiftDateOf(wc, newRule.rule.nightBelongsTo, newRule.rule.boundaries);
    // Built to genuinely match what the resolver computes for this row's own time.
    const rows = [{ raw_id: 1, production_ts_utc_ms: rowMs, shift_code: expectedCode, shift_date: expectedDate }];
    const findings = shiftRuleDriftFindingsFor(rows, [oldRule, newRule], 1);
    expect(findings).toEqual([]);
  });
});

describe('checkShiftRuleDrift — DB wrapper', () => {
  it('is a no-op and never queries when only one shift_rule version exists', async () => {
    let queried = false;
    const pool = {
      request() {
        return {
          input() {
            return this;
          },
          async query() {
            queried = true;
            return { recordset: [] };
          },
        };
      },
    } as unknown as ConnectionPool;
    const findings = await checkShiftRuleDrift(pool, 1, [oldRule]);
    expect(findings).toEqual([]);
    expect(queried).toBe(false);
  });

  it('queries and samples when more than one version exists', async () => {
    let queried = false;
    const pool = {
      request() {
        const req = {
          input() {
            return req;
          },
          async query() {
            queried = true;
            return { recordset: [] };
          },
        };
        return req;
      },
    } as unknown as ConnectionPool;
    const findings = await checkShiftRuleDrift(pool, 1, [oldRule, newRule]);
    expect(findings).toEqual([]);
    expect(queried).toBe(true);
  });
});
