/**
 * PLANT_UTC_OFFSET_MINUTES in loadSyncConfig (roadmap H7, 15 Sep 2026): the
 * worker reads the same variable the API always has, with the same
 * "unset means skip the cross-check" semantics — see @sms/shared's
 * checkPlantOffset and api/src/config.ts's identical field.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSyncConfig } from './config.js';

const BASE: NodeJS.ProcessEnv = {
  APP_DB_SERVER: 'localhost',
  APP_DB_PORT: '14330',
  APP_DB_NAME: 'sms',
  APP_DB_USER: 'u',
  APP_DB_PASSWORD: 'p',
  APP_DB_ENCRYPT: 'false',
  APP_DB_TRUST_SERVER_CERTIFICATE: 'true',
  IFL_DB_SERVER: 'localhost',
  IFL_DB_PORT: '14330',
  IFL_DB_NAME_DATA: 'DATA_TP1U2_SEP07',
  IFL_DB_USER: 'u',
  IFL_DB_PASSWORD: 'p',
  IFL_DB_ENCRYPT: 'false',
  IFL_DB_TRUST_SERVER_CERTIFICATE: 'true',
};

describe('loadSyncConfig — PLANT_UTC_OFFSET_MINUTES', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is undefined — not 0, not NaN — when absent, so the cross-check is skipped rather than run against 0', () => {
    expect(loadSyncConfig({ ...BASE }).plantUtcOffsetMinutes).toBeUndefined();
  });

  it('is undefined when present but blank ("PLANT_UTC_OFFSET_MINUTES=" with nothing after the "="), not silently 0', () => {
    // Number('') is 0 in JS, which would otherwise mean "the plant is at
    // UTC" for an installer who just left the line blank — the opposite of
    // "not configured". This pins that the blank case still skips.
    expect(loadSyncConfig({ ...BASE, PLANT_UTC_OFFSET_MINUTES: '' }).plantUtcOffsetMinutes).toBeUndefined();
    expect(loadSyncConfig({ ...BASE, PLANT_UTC_OFFSET_MINUTES: '   ' }).plantUtcOffsetMinutes).toBeUndefined();
  });

  it('reads the configured plant offset, including zero and a negative (west-of-Greenwich) value', () => {
    expect(loadSyncConfig({ ...BASE, PLANT_UTC_OFFSET_MINUTES: '300' }).plantUtcOffsetMinutes).toBe(300);
    expect(loadSyncConfig({ ...BASE, PLANT_UTC_OFFSET_MINUTES: '0' }).plantUtcOffsetMinutes).toBe(0);
    expect(loadSyncConfig({ ...BASE, PLANT_UTC_OFFSET_MINUTES: '-240' }).plantUtcOffsetMinutes).toBe(-240);
  });

  it('refuses a non-numeric or non-whole value instead of silently coercing it to NaN or truncating it', () => {
    expect(() => loadSyncConfig({ ...BASE, PLANT_UTC_OFFSET_MINUTES: 'five hundred' })).toThrow();
    expect(() => loadSyncConfig({ ...BASE, PLANT_UTC_OFFSET_MINUTES: '5.5' })).toThrow();
  });

  it('is read from process.env by default, the same way every other key in this file is (vi.stubEnv, restored in afterEach)', () => {
    for (const [k, v] of Object.entries(BASE)) vi.stubEnv(k, v);
    vi.stubEnv('PLANT_UTC_OFFSET_MINUTES', '300');
    expect(loadSyncConfig().plantUtcOffsetMinutes).toBe(300);
  });
});
