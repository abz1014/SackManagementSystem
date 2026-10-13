/**
 * Shape check for an API body (fix-wave T7a1, missing-field robustness).
 *
 * A 200 answer with a hole in one field must never crash a screen and never print a figure the field would have
 * supplied. A screen that reads a field it cannot draw without names that field's part as "could not be read":
 * `useData(..., { shape: [...] })` turns a body missing a required path into a failed fetch, so the screen's own
 * named-part error state shows (and the last good data stays, with its stale note, when there is one).
 *
 * Path syntax: dot-separated keys; a segment ending in `[]` means "this is an array, check every element":
 * `data.stations[].cones` requires `data.stations` to be an array and every element to have `cones`.
 * A required key is present when its value is not undefined (an explicit null is the server's own "nothing").
 */
export type Shape = readonly string[];

function missingAt(v: unknown, segs: readonly string[]): string | null {
  if (segs.length === 0) return null;
  const [head, ...rest] = segs as [string, ...string[]];
  const each = head.endsWith('[]');
  const key = each ? head.slice(0, -2) : head;
  if (v === null || typeof v !== 'object') return key;
  const child = (v as Record<string, unknown>)[key];
  // undefined is a hole; an explicit null is the server saying "nothing to report" and is a present value.
  if (child === undefined) return key;
  if (child === null) return rest.length === 0 && !each ? null : key;
  if (each) {
    if (!Array.isArray(child)) return key;
    for (const el of child) {
      const m = missingAt(el, rest);
      if (m !== null) return `${key}[].${m}`;
    }
    return null;
  }
  const m = missingAt(child, rest);
  return m === null ? null : `${key}.${m}`;
}

/** The first required path the body lacks, or null when the body has them all. */
export function missingField(body: unknown, shape: Shape): string | null {
  for (const p of shape) {
    const m = missingAt(body, p.split('.'));
    if (m !== null) return p.includes('[]') ? m : p;
  }
  return null;
}

/** Throws a plain-words Error naming the part and the missing field. Returns the body when complete. */
export function assertShape<T>(body: T, shape: Shape, part: string): T {
  const m = missingField(body, shape);
  if (m !== null) throw new Error(`The ${part} answer arrived incomplete (no "${m}")`);
  return body;
}
