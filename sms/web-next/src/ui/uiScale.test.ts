import { describe, expect, it } from 'vitest';
import { parseUiScale, readUiScale, wallScale } from './uiScale';

describe('uiScale', () => {
  it('reads the old app key values', () => {
    expect(parseUiScale('1')).toBe(1);
    expect(parseUiScale('1.3')).toBe(1.3);
  });
  it('falls back to 1 for anything else', () => {
    for (const v of [null, undefined, '', '2', 'abc', '0']) expect(parseUiScale(v)).toBe(1);
  });
  it('survives blocked storage', () => {
    expect(readUiScale({ getItem: () => { throw new Error('blocked'); } })).toBe(1);
    expect(readUiScale({ getItem: () => '1.3' })).toBe(1.3);
  });
  it('multiplies the wall base', () => {
    expect(wallScale(1)).toBe(1.6);
    expect(wallScale(1.3)).toBe(1.7);
    expect(wallScale(7)).toBe(1.6);
  });
});
