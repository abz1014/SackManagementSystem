/**
 * RT24-04 GUARD. `sms.plausibility_rule` / `sms.weight_rule` / `sms.shift_rule`
 * are append-only, time-versioned rule tables (ruleAsOf.ts's own header has
 * the full story). A `SELECT ... FROM sms.<rule table> ... ORDER BY
 * effective_from DESC` with no accompanying `effective_from <=` clause reads
 * whatever is newest, including a future-dated row — "in force now" only by
 * accident, and "in force at a reading's own time" not at all.
 *
 * This is the same dumb-but-effective node:fs + regex idiom as
 * `generationScope.guard.test.ts` and `web/src/reliability.guard.test.ts`:
 * no AST, no type information, scoped to `api/src/services/**` and
 * `api/src/*.ts`, deliberately excluding `*.test.ts` (fixtures legitimately
 * build fake SQL text) and `ruleAsOf.ts` itself (the one file allowed to
 * define what "as of" means).
 *
 * A query passes if the same statement's text also contains
 * `effective_from <=` (or `effective_from<=`) somewhere in the surrounding
 * window — either the "now" guard (`effective_from <= SYSUTCDATETIME()`) or
 * the values ruleAsOf.ts's own loaders don't need this guard for at all,
 * because they select the WHOLE history with no TOP 1 / no upper bound, by
 * design — see EXEMPTIONS.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API_SRC_DIR = join(__dirname, '..'); // api/src — recursive, covers services/**, app.ts, envelope.ts

/**
 * Files whose whole-history SELECT (no TOP 1, no ORDER BY .. DESC cutoff) is
 * the load-bearing implementation `ruleAsOf`'s callers rely on — they READ
 * everything and let `ruleAsOf`/`ruleChangesWithin` do the as-of selection,
 * so they correctly carry no `effective_from <=` clause of their own.
 */
const EXEMPT_FILES = new Set(['ruleAsOf.ts']);

const RULE_TABLES = ['sms.plausibility_rule', 'sms.weight_rule', 'sms.shift_rule'];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Every `FROM sms.<rule table>` occurrence, with a window of surrounding text to check for the guard. */
function findUnguardedReads(filePath: string, source: string): string[] {
  const problems: string[] = [];
  for (const table of RULE_TABLES) {
    const re = new RegExp(`FROM\\s+${table.replace('.', '\\.')}`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const windowStart = Math.max(0, m.index - 400);
      const windowEnd = Math.min(source.length, m.index + 400);
      const window = source.slice(windowStart, windowEnd);
      const hasOrderByDesc = /ORDER BY\s+effective_from\s+DESC/i.test(window);
      if (!hasOrderByDesc) continue; // whole-history read (or TOP-N on something else) — not this defect shape
      const hasAsOfGuard = /effective_from\s*<=/i.test(window);
      if (!hasAsOfGuard) {
        const line = source.slice(0, m.index).split('\n').length;
        problems.push(`${filePath}:${line} — FROM ${table} ... ORDER BY effective_from DESC with no effective_from <= guard`);
      }
    }
  }
  return problems;
}

describe('RT24-04 guard: every rule-table ORDER BY effective_from DESC read is bounded', () => {
  it('carries an effective_from <= guard, or is ruleAsOf.ts itself', () => {
    const unique = Array.from(new Set(collectTsFiles(API_SRC_DIR)));
    const problems: string[] = [];
    for (const filePath of unique) {
      const base = filePath.split(/[\\/]/).pop()!;
      if (EXEMPT_FILES.has(base)) continue;
      const source = readFileSync(filePath, 'utf8');
      problems.push(...findUnguardedReads(filePath, source));
    }
    expect(problems).toEqual([]);
  });

  it('fails when the guard is missing — proves the check actually bites', () => {
    const bad = `
      const r = await pool.request().input('line', mssql.Int, lineId).query(
        \`SELECT TOP 1 cone_lo_g cl FROM sms.plausibility_rule WHERE line_id=@line ORDER BY effective_from DESC\`,
      );
    `;
    expect(findUnguardedReads('fixture.ts', bad).length).toBeGreaterThan(0);
  });

  it('passes when the guard is present', () => {
    const good = `
      const r = await pool.request().input('line', mssql.Int, lineId).query(
        \`SELECT TOP 1 cone_lo_g cl FROM sms.plausibility_rule WHERE line_id=@line AND effective_from <= SYSUTCDATETIME() ORDER BY effective_from DESC\`,
      );
    `;
    expect(findUnguardedReads('fixture.ts', good)).toEqual([]);
  });
});
