/**
 * T-SQL LIKE pattern matching, in JS — so the changeover plan can tell, before
 * anything is written, whether PDAS's own vendor procedures would refuse a
 * "new" name because it collides with an existing row as a WILDCARD PATTERN,
 * not just as an exact duplicate.
 *
 * WHY THIS EXISTS (defect B4). `AddBlend`, `AddCount` and `AddTubeType` each
 * guard their INSERT with `IF NOT EXISTS (SELECT * FROM <table> WHERE <col>
 * LIKE @newName [AND TubeForm = @tubeForm])` — read directly from the proc
 * bodies on `PDAS_TP1U2_SEP07` via `sqlcmd -E` (read-only), 24 Sep 2026:
 *
 *   AddBlend:     IF NOT EXISTS (SELECT * FROM [dbo].[Blends]    WHERE [Blend]    LIKE @blend)
 *   AddCount:     IF NOT EXISTS (SELECT * FROM [dbo].[Counts]    WHERE [Count]    LIKE @count)
 *   AddTubeType:  IF NOT EXISTS (SELECT * FROM [dbo].[TubeTypes] WHERE TubeType LIKE @tubeType AND TubeForm = @tubeForm)
 *
 * The proc treats the CALLER'S input as the LIKE *pattern* and tests it
 * against every stored value. `_` matches any single character, `%` matches
 * any run (including none), and `[...]`/`[^...]` match or exclude a character
 * class — so a caller asking to add tube type `R_D` is refused (-5001) if
 * `RED` already exists, even though `R_D` is not textually equal to `RED`.
 * `changeover.ts`'s old check compared new names to existing ones with exact
 * (normalised) string equality only, so it planned `R_D` as `add` and the
 * plan looked clean right up until PDAS refused it mid-sequence.
 *
 * `CreatePallet`'s own duplicate check (`WHERE MaterialID = @materialId AND
 * PackSchemaId = @packSchemaId AND Lot = @lot`) uses plain `=`, not `LIKE` —
 * verified the same way — so pallets are NOT in scope for this helper.
 *
 * Collation, verified against `PDAS_TP1U2_SEP07`
 * (`DATABASEPROPERTYEX('PDAS_TP1U2_SEP07','Collation')` = `Latin1_General_CI_AS`):
 * case-insensitive, accent-sensitive — `likePatternToRegExp` compiles with
 * the `i` flag to match. Trailing spaces: `=` ignores them (`'RED ' = 'RED'`
 * is true) and callers already `.trim()` the requested name before this
 * helper ever sees it, so that is handled upstream. `LIKE`'s own trailing-
 * space behaviour is NOT a clean mirror of `=` — measured directly:
 * `'RED  ' LIKE 'RED'` is true (the text pads to the pattern) but
 * `'RED' LIKE 'RED '` is false (a trailing space typed into the pattern is
 * NOT stripped) — so this helper does not attempt to special-case trailing
 * spaces inside a wildcard pattern beyond the caller's own `.trim()`. That is
 * a deliberately narrow gap, not an oversight: it can only make this helper
 * MISS a collision PDAS would refuse (a false negative on a pattern nobody
 * would type on purpose — a trailing space after `%`/`_`/`]`), never invent
 * one that is not there.
 */

/** Characters JS regex treats specially that T-SQL LIKE does not. */
const REGEX_METACHARS = new Set(['.', '*', '+', '?', '^', '$', '(', ')', '{', '}', '|', '\\', '/']);

/**
 * Compile a T-SQL LIKE pattern (no ESCAPE clause — none of the vendor procs
 * this helper serves use one) into a case-insensitive JS RegExp that
 * anchors the whole string, the same way `col LIKE @pattern` tests the whole
 * column value.
 */
export function likePatternToRegExp(pattern: string): RegExp {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '%') {
      out += '.*';
      i++;
      continue;
    }
    if (ch === '_') {
      out += '.';
      i++;
      continue;
    }
    if (ch === '[') {
      const close = findClassClose(pattern, i);
      if (close === -1) {
        // No matching ']' — T-SQL treats a lone, unclosed '[' as a literal.
        out += '\\[';
        i++;
        continue;
      }
      out += '[' + compileClassBody(pattern.slice(i + 1, close)) + ']';
      i = close + 1;
      continue;
    }
    out += REGEX_METACHARS.has(ch) ? '\\' + ch : ch;
    i++;
  }
  return new RegExp('^' + out + '$', 'i');
}

/** Index of the ']' that closes the class opened at `openIdx`, or -1. */
function findClassClose(pattern: string, openIdx: number): number {
  // A ']' immediately after '[' or '[^' is a literal member of the class,
  // per T-SQL's own bracket-expression rule — it does not close the class.
  let j = openIdx + 1;
  if (pattern[j] === '^') j++;
  if (pattern[j] === ']') j++;
  while (j < pattern.length && pattern[j] !== ']') j++;
  return j < pattern.length ? j : -1;
}

/** Turn the inside of a T-SQL [...] class into a safe JS regex class body. */
function compileClassBody(body: string): string {
  let out = '';
  for (let k = 0; k < body.length; k++) {
    const c = body[k]!;
    if (c === '\\' || c === ']') out += '\\' + c;
    else out += c; // '^' (only special at position 0, already handled by caller passing it through) and '-' (ranges) pass through unescaped
  }
  return out;
}

/** True if `text` would be matched by T-SQL's `text LIKE pattern` (case-insensitive, `Latin1_General_CI_AS`). */
export function likeMatches(text: string, pattern: string): boolean {
  return likePatternToRegExp(pattern).test(text);
}
