/**
 * LIVE_ALLOW_SIMULATOR (Task T1, 28 Sep 2026): the dev-only flag that lets
 * the live scope (`resolveLiveScope`, services/live.ts) pick the plant
 * simulator's generation instead of always preferring the newest REAL one
 * (the owner's 23 Sep 2026 decision — see live.ts's own file header). On
 * this dev PC the frozen real September copy (generation 3, DATA_TP1U2_SEP07)
 * coexists with the live simulator (generation 4, DATA_TP1U2_SIM), so Line
 * always says "cannot tell" without it.
 *
 * `resolveLiveSimulator` (config.ts), modelled on `resolvePdasWrite`: never
 * throws, refuses rather than enables whenever either guard fails, and an
 * unset flag is refused before either guard is even consulted. The two
 * guards exist so this flag can never do anything against a real IFL
 * connection, no matter how it is set: IFL_DB_NAME_DATA must be a `_SIM`
 * database (the same invariant `scripts/simulate-plant.mjs` itself enforces
 * on write) and IFL_DB_SERVER, with any `\instance` suffix stripped, must be
 * a local server name.
 */
import { describe, expect, it } from 'vitest';
import { loadApiConfig, resolveLiveSimulator } from './config.js';

const BASE: NodeJS.ProcessEnv = {
  APP_DB_SERVER: 'localhost',
  APP_DB_PORT: '14330',
  APP_DB_NAME: 'sms',
  APP_DB_USER: 'u',
  APP_DB_PASSWORD: 'p',
  APP_DB_ENCRYPT: 'false',
  APP_DB_TRUST_SERVER_CERTIFICATE: 'true',
};

describe('resolveLiveSimulator — pure, never throws', () => {
  it('unset (requested=false) is off, no guard consulted', () => {
    const r = resolveLiveSimulator(false, 'DATA_TP1U2_SIM', 'localhost');
    expect(r.requested).toBe(false);
    expect(r.enabled).toBe(false);
    expect(r.disabledReason).not.toBeNull();
  });

  it('requested + a _SIM database on a local server is enabled', () => {
    const r = resolveLiveSimulator(true, 'DATA_TP1U2_SIM', 'localhost');
    expect(r.requested).toBe(true);
    expect(r.enabled).toBe(true);
    expect(r.disabledReason).toBeNull();
  });

  it('requested + a non-_SIM database is refused, naming _SIM', () => {
    const r = resolveLiveSimulator(true, 'DATA_TP1U2', 'localhost');
    expect(r.requested).toBe(true);
    expect(r.enabled).toBe(false);
    expect(r.disabledReason).toContain('_SIM');
  });

  it('requested + _SIM database + a non-local server is refused, naming "local"', () => {
    const r = resolveLiveSimulator(true, 'DATA_TP1U2_SIM', '192.168.100.37');
    expect(r.enabled).toBe(false);
    expect(r.disabledReason).toContain('local');
  });

  it('requested + _SIM database + a named remote instance (TP1-PDAS\\PDAS) is refused', () => {
    const r = resolveLiveSimulator(true, 'DATA_TP1U2_SIM', 'TP1-PDAS\\PDAS');
    expect(r.enabled).toBe(false);
    expect(r.disabledReason).toContain('local');
  });

  it('requested + database name unset is refused', () => {
    const r = resolveLiveSimulator(true, undefined, 'localhost');
    expect(r.enabled).toBe(false);
    expect(r.disabledReason).toContain('_SIM');
  });

  it('case-insensitive database name and a named local instance (localhost\\SQLEXPRESS) are both accepted', () => {
    const r = resolveLiveSimulator(true, 'data_tp1u2_sim', 'localhost\\SQLEXPRESS');
    expect(r.enabled).toBe(true);
    expect(r.disabledReason).toBeNull();
  });
});

describe('loadApiConfig — LIVE_ALLOW_SIMULATOR end to end', () => {
  it('unset env resolves to liveSimulator.enabled = false', () => {
    const cfg = loadApiConfig(BASE);
    expect(cfg.liveSimulator?.enabled).toBe(false);
    expect(cfg.liveSimulator?.requested).toBe(false);
  });

  it('true + DATA_TP1U2_SIM + localhost resolves enabled', () => {
    const cfg = loadApiConfig({
      ...BASE,
      LIVE_ALLOW_SIMULATOR: 'true',
      IFL_DB_NAME_DATA: 'DATA_TP1U2_SIM',
      IFL_DB_SERVER: 'localhost',
    });
    expect(cfg.liveSimulator?.enabled).toBe(true);
    expect(cfg.liveSimulator?.disabledReason).toBeNull();
  });

  it('an invalid literal value ("yes") fails zod validation', () => {
    expect(() => loadApiConfig({ ...BASE, LIVE_ALLOW_SIMULATOR: 'yes' })).toThrow();
  });
});
