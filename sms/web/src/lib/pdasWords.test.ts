/**
 * `pdasReasonForDisplay` — FIX A (28 Sep 2026). Covers the four reasons
 * `resolvePdasWrite` (`api/src/config.ts`) can produce, the plain-ish
 * fallback the write services use when no `disabledReason` was set, and the
 * pass-through for anything this module does not recognise.
 */
import { describe, expect, it } from 'vitest';
import { pdasReasonForDisplay } from './pdasWords';

describe('pdasReasonForDisplay', () => {
  it('translates the stored "PDAS_WRITE_ENABLED is not true." reason', () => {
    expect(pdasReasonForDisplay('PDAS_WRITE_ENABLED is not true.')).toBe(
      'Writing to PDAS was switched off in this system’s settings.',
    );
  });

  it('translates the plain fallback reason the write services use directly', () => {
    expect(pdasReasonForDisplay('The PDAS write path is not enabled.')).toBe(
      'Writing to PDAS was switched off in this system’s settings.',
    );
  });

  it('translates a missing-credentials reason regardless of which keys are missing', () => {
    const raw =
      'PDAS_WRITE_ENABLED is true but PDAS_WRITE_SERVER / PDAS_WRITE_USER is not set. ' +
      'The write login must be provisioned separately from the read-only sync login.';
    expect(pdasReasonForDisplay(raw)).toBe(
      'Writing to PDAS is switched on, but the write login is not fully set up in this system’s settings.',
    );
  });

  it('translates a database-mismatch reason', () => {
    const raw =
      'PDAS_WRITE_DATABASE ("PDAS_TP1U2_SEP07") does not match IFL_DB_NAME_PDAS ("PDAS_TP1U2"). ' +
      'The writer must point at the same database the sync worker reads.';
    expect(pdasReasonForDisplay(raw)).toBe(
      'Writing to PDAS is switched off: the write login is not pointed at the right database.',
    );
  });

  it('translates a same-login reason', () => {
    const raw =
      'PDAS_WRITE_USER is the same login as IFL_DB_USER ("sms_reader"). ' +
      'The read-only sync login must never be the writer.';
    expect(pdasReasonForDisplay(raw)).toBe(
      'Writing to PDAS is switched off: the write login is not kept separate from the read-only login.',
    );
  });

  it('passes an unrecognised reason through verbatim, rather than hiding it', () => {
    expect(pdasReasonForDisplay('PDAS says no for a reason this list has never seen.')).toBe(
      'PDAS says no for a reason this list has never seen.',
    );
  });

  it('passes null and undefined through unchanged', () => {
    expect(pdasReasonForDisplay(null)).toBeNull();
    expect(pdasReasonForDisplay(undefined)).toBeNull();
  });
});
