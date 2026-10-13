/** Shift rows in production-day order (06:00 morning, 14:00 evening, 22:00 night), whatever order the server sent them. */
export const SHIFT_ORDER = ['morning', 'evening', 'night'] as const;

export function inShiftOrder<T extends { group: string }>(rows: readonly T[]): T[] {
  const rank = (g: string) => {
    const i = (SHIFT_ORDER as readonly string[]).indexOf(g);
    return i < 0 ? SHIFT_ORDER.length : i;
  };
  return rows.filter((r) => r.group !== 'total').map((r, i) => ({ r, i })).sort((a, b) => rank(a.r.group) - rank(b.r.group) || a.i - b.i).map((x) => x.r);
}
