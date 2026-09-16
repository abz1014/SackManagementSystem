/**
 * `canWriteLocal` is the pure derivation `ProductLimitsBlock.tsx` uses
 * instead of dereferencing `status.local.canWrite` directly. It exists
 * because `ProductWriteStatus.local` is typed as required (api.ts) but that
 * is only a compile-time promise: a server built before commit 2e8b470 added
 * `local` to `GET /api/product-write/status` returns a body with no `local`
 * field at all, and the direct read throws "Cannot read properties of
 * undefined (reading 'canWrite')" — which is exactly what took the Setup
 * screen down (see CLAUDE.md's Sep 2026 notes on the running API process
 * predating this commit). No DOM needed, so this runs in the project's
 * Node-environment suite alongside the component's other logic tests.
 */
import { describe, expect, it } from 'vitest';
import { canWriteLocal } from './ProductLimitsBlock';
import type { ProductWriteStatus } from '../../api';

describe('canWriteLocal', () => {
  it('is false when no status has loaded yet', () => {
    expect(canWriteLocal(undefined)).toBe(false);
    expect(canWriteLocal(null)).toBe(false);
  });

  it('is false for a status body missing `local` entirely — the stale-server shape', () => {
    // Cast through `unknown`: this is deliberately NOT the declared
    // ProductWriteStatus shape, because that is the whole point — the
    // runtime body from an older server does not match the type the client
    // compiles against.
    const staleServerBody = { enabled: true, reason: null, canWrite: true } as unknown as ProductWriteStatus;
    expect(canWriteLocal(staleServerBody)).toBe(false);
  });

  it('is false when `local` is present but malformed', () => {
    const malformed = { enabled: true, reason: null, canWrite: true, local: null } as unknown as ProductWriteStatus;
    expect(canWriteLocal(malformed)).toBe(false);

    const wrongType = { enabled: true, reason: null, canWrite: true, local: { canWrite: 'yes' } } as unknown as ProductWriteStatus;
    expect(canWriteLocal(wrongType)).toBe(false);
  });

  it('is false for a well-formed status where the user lacks rank', () => {
    const status: ProductWriteStatus = { enabled: true, reason: null, canWrite: true, local: { canWrite: false } };
    expect(canWriteLocal(status)).toBe(false);
  });

  it('is true for a well-formed status granting the local write', () => {
    const status: ProductWriteStatus = { enabled: false, reason: 'PDAS writes off', canWrite: false, local: { canWrite: true } };
    expect(canWriteLocal(status)).toBe(true);
  });
});
