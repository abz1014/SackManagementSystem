/**
 * The display scale the old app saved under localStorage "sms.uiScale" ("1" Desk, "1.3" Wall). The new app
 * honours the same key so a TV that was set to Wall keeps its size. Anything else (missing, blocked
 * storage, a stray value) reads as 1. Pure so it can be tested without a browser.
 */
export const UI_SCALE_KEY = 'sms.uiScale';
export const UI_SCALES = [1, 1.3] as const;

export function parseUiScale(raw: string | null | undefined): number {
  const n = raw == null ? NaN : Number(raw);
  return (UI_SCALES as readonly number[]).includes(n) ? n : 1;
}

export function readUiScale(storage: Pick<Storage, 'getItem'> | null = safeStorage()): number {
  try {
    return parseUiScale(storage?.getItem(UI_SCALE_KEY));
  } catch {
    return 1;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The Wall's own base multiplier (tokens.css --wall-scale, already a TV size) and what the saved scale
 * does to it. The old "Wall" setting (1.3) made desk type 30 % larger; applied on top of the TV board's
 * 1.6 that is 2.08 and 14 stations, four figures and the shift bars no longer fit one 1080p screen.
 * So the saved scale moves the board only as far as it still fits: Desk keeps 1.6, Wall is 1.7.
 */
export const WALL_BASE_SCALE = 1.6;
const WALL_SCALE_BY_UI: Record<number, number> = { 1: WALL_BASE_SCALE, 1.3: 1.7 };
export function wallScale(ui: number): number {
  return WALL_SCALE_BY_UI[ui] ?? WALL_BASE_SCALE;
}
