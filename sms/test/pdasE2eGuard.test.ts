/**
 * Regression for the PDAS e2e harness's live pre-flight guard
 * (`scripts/pdas-e2e-local.mjs` GUARD LAYER 2, factored into
 * `scripts/pdas-e2e-guard.mjs`). Before this fix (28 Sep 2026) the guard
 * compared `.env`'s `PDAS_WRITE_SERVER` ("localhost") literally against the
 * live `@@SERVERNAME` host ("DESKTOP-G1MSH4I"), so it refused a valid local
 * setup before any harness case ran. This is a pure-function test — it
 * never opens a database connection.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs sibling module, no type declarations
import { checkPdasE2ePreflight, isLocalAliasHost } from '../scripts/pdas-e2e-guard.mjs';

describe('checkPdasE2ePreflight', () => {
  it('passes: localhost in .env, live @@SERVERNAME is this host\'s own SQLEXPRESS', () => {
    const v = checkPdasE2ePreflight({
      liveSrv: 'DESKTOP-X\\SQLEXPRESS',
      liveDb: 'PDAS_TP1U2_SEP07',
      envServer: 'localhost',
      envDatabase: 'PDAS_TP1U2_SEP07',
      hostname: 'DESKTOP-X',
    });
    expect(v.ok).toBe(true);
  });

  it('refuses: .env server is a non-local IP address', () => {
    const v = checkPdasE2ePreflight({
      liveSrv: 'DESKTOP-X\\SQLEXPRESS',
      liveDb: 'PDAS_TP1U2_SEP07',
      envServer: '192.168.1.5',
      envDatabase: undefined,
      hostname: 'DESKTOP-X',
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/PDAS_WRITE_SERVER/);
  });

  it('refuses: .env says localhost but the live server is a different host', () => {
    const v = checkPdasE2ePreflight({
      liveSrv: 'OTHERHOST\\SQLEXPRESS',
      liveDb: 'PDAS_TP1U2_SEP07',
      envServer: 'localhost',
      envDatabase: undefined,
      hostname: 'DESKTOP-X',
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/@@SERVERNAME host/);
  });

  it('refuses: live database is PDAS_TP1U2, not the _SEP07 copy', () => {
    const v = checkPdasE2ePreflight({
      liveSrv: 'DESKTOP-X\\SQLEXPRESS',
      liveDb: 'PDAS_TP1U2',
      envServer: 'localhost',
      envDatabase: undefined,
      hostname: 'DESKTOP-X',
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/DB_NAME/);
  });

  it('refuses: live instance is not SQLEXPRESS', () => {
    const v = checkPdasE2ePreflight({
      liveSrv: 'DESKTOP-X\\SQLEXPRESS2',
      liveDb: 'PDAS_TP1U2_SEP07',
      envServer: 'localhost',
      envDatabase: undefined,
      hostname: 'DESKTOP-X',
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/SQLEXPRESS/);
  });

  it('passes: .env states this machine\'s hostname directly instead of an alias', () => {
    const v = checkPdasE2ePreflight({
      liveSrv: 'DESKTOP-X\\SQLEXPRESS',
      liveDb: 'PDAS_TP1U2_SEP07',
      envServer: 'DESKTOP-X',
      envDatabase: 'PDAS_TP1U2_SEP07',
      hostname: 'desktop-x',
    });
    expect(v.ok).toBe(true);
  });

  it('refuses: .env database disagrees with the live database', () => {
    const v = checkPdasE2ePreflight({
      liveSrv: 'DESKTOP-X\\SQLEXPRESS',
      liveDb: 'PDAS_TP1U2_SEP07',
      envServer: 'localhost',
      envDatabase: 'PDAS_TP1U2',
      hostname: 'DESKTOP-X',
    });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/PDAS_WRITE_DATABASE/);
  });

  it('passes: no .env server/database stated at all (falls back to defaults upstream)', () => {
    const v = checkPdasE2ePreflight({
      liveSrv: 'DESKTOP-X\\SQLEXPRESS',
      liveDb: 'PDAS_TP1U2_SEP07',
      envServer: '',
      envDatabase: '',
      hostname: 'DESKTOP-X',
    });
    expect(v.ok).toBe(true);
  });
});

describe('isLocalAliasHost', () => {
  it.each(['localhost', '127.0.0.1', '.', '(local)', '::1', 'DESKTOP-X'])(
    'accepts %s as this machine',
    (alias) => {
      expect(isLocalAliasHost(alias, 'desktop-x')).toBe(true);
    },
  );

  it('rejects an unrelated hostname or IP', () => {
    expect(isLocalAliasHost('192.168.1.5', 'desktop-x')).toBe(false);
    expect(isLocalAliasHost('OTHERHOST', 'desktop-x')).toBe(false);
  });
});
