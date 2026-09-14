/**
 * The three numeric env keys used to go through a bare `Number()`, and NaN
 * passed every guard downstream: `Math.max(5, NaN)` is NaN and Node runs a
 * NaN `setTimeout` delay as 1 ms, so a typo in SYNC_INTERVAL_SECONDS turned
 * the 60 s loop into a tight loop against both databases, silently. These pin
 * that a bad value refuses to start and names the key, and that the defaults
 * and legitimate values still load.
 */
import { describe, expect, it } from 'vitest';
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

describe('loadSyncConfig — numeric keys', () => {
  it('applies the documented defaults when the keys are absent or blank', () => {
    const c = loadSyncConfig({ ...BASE, SYNC_INTERVAL_SECONDS: '' });
    expect(c.lineId).toBe(1);
    expect(c.overlapRows).toBe(500);
    expect(c.intervalSeconds).toBe(60);
  });

  it('reads legitimate values, including a zero overlap', () => {
    const c = loadSyncConfig({ ...BASE, LINE_ID: '2', SYNC_OVERLAP_ROWS: '0', SYNC_INTERVAL_SECONDS: ' 30 ' });
    expect(c.lineId).toBe(2);
    expect(c.overlapRows).toBe(0);
    expect(c.intervalSeconds).toBe(30);
  });

  it('refuses a non-numeric interval instead of running a tight loop', () => {
    expect(() => loadSyncConfig({ ...BASE, SYNC_INTERVAL_SECONDS: '6O' })).toThrow(/SYNC_INTERVAL_SECONDS must be a whole number/);
    expect(() => loadSyncConfig({ ...BASE, SYNC_INTERVAL_SECONDS: '1.5' })).toThrow(/whole number/);
  });

  it('enforces the 5 s interval floor the old Math.max meant to', () => {
    expect(() => loadSyncConfig({ ...BASE, SYNC_INTERVAL_SECONDS: '2' })).toThrow(/at least 5/);
    expect(loadSyncConfig({ ...BASE, SYNC_INTERVAL_SECONDS: '5' }).intervalSeconds).toBe(5);
  });

  it('refuses a non-numeric or negative overlap', () => {
    expect(() => loadSyncConfig({ ...BASE, SYNC_OVERLAP_ROWS: 'five hundred' })).toThrow(/SYNC_OVERLAP_ROWS/);
    expect(() => loadSyncConfig({ ...BASE, SYNC_OVERLAP_ROWS: '-1' })).toThrow(/at least 0/);
  });

  it('refuses a non-positive LINE_ID — every row is stamped with it', () => {
    expect(() => loadSyncConfig({ ...BASE, LINE_ID: '0' })).toThrow(/LINE_ID must be at least 1/);
    expect(() => loadSyncConfig({ ...BASE, LINE_ID: 'one' })).toThrow(/LINE_ID must be a whole number/);
  });
});
