/**
 * R-10 regression: `epoch:purge`'s epoch id list used to be joined into a
 * literal `IN (${list})` clause rather than bound as parameters. The ids are
 * already filtered to `Number.isInteger(n) && n > 0` before reaching this
 * point, so it was not exploitable in practice — but it was exactly the
 * string-concatenated SQL shape CLAUDE.md's working rules forbid outright,
 * and it is fixed here by binding each id as its own named parameter.
 */
import { describe, expect, it } from 'vitest';
import { idInClause } from './epoch.js';

interface FakeReq {
  inputs: Map<string, unknown>;
  input: (name: string, type: unknown, value: unknown) => FakeReq;
}
function fakeRequest(): FakeReq {
  const inputs = new Map<string, unknown>();
  const req: FakeReq = { inputs, input: (name, _t, value) => { inputs.set(name, value); return req; } };
  return req;
}

describe('idInClause', () => {
  it('produces a parameter placeholder per id, never a literal number in the SQL text', () => {
    const c = idInClause([5, 6, 7, 8]);
    expect(c.sql).toBe('(@e0,@e1,@e2,@e3)');
    expect(c.sql).not.toMatch(/[5678]/);
  });

  it('bind() attaches every id as its own named input, in order', () => {
    const c = idInClause([12, 34]);
    const req = fakeRequest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake mssql.Request stand-in
    c.bind(req as any);
    expect(req.inputs.get('e0')).toBe(12);
    expect(req.inputs.get('e1')).toBe(34);
  });

  it('a fresh request must be bound independently — inputs are per-request, not shared', () => {
    const c = idInClause([1]);
    const reqA = fakeRequest();
    const reqB = fakeRequest();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c.bind(reqA as any);
    expect(reqB.inputs.has('e0')).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c.bind(reqB as any);
    expect(reqB.inputs.get('e0')).toBe(1);
  });
});
