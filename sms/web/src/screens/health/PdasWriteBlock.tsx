/**
 * RT24-05 — PDAS write read-back verification, on Health for every signed-in
 * account (the same audience as the rest of this screen — see Health.tsx's
 * header comment; this is not gated to admin/Setup).
 *
 * WHY THIS BLOCK EXISTS. `pdasWrite.ts`'s echo-back check (a CRITICAL
 * 'pdas_write_echo_mismatch' finding on any difference between what was
 * requested and what PDAS now holds) can only fire if the writer login can
 * read the table it just wrote — IFL's own SOP has their engineers running
 * the vendor's procedures directly, an EXECUTE-only shape that carries no
 * assumed SELECT grant. Under that shape the echo-back read throws on every
 * write, the mismatch check can never fire, and before this fix the write
 * was recorded as a plain 'ok' with no visible sign that verification never
 * happened at all — the write silently un-checked, forever, with nothing on
 * screen to say so. This block states in words whether that gap exists,
 * rather than let a green "ok" outcome be read as "and confirmed".
 *
 * Reads GET /api/health's `pdasWrite` block (health.ts's PdasWriteHealth),
 * itself folded from pdasWrite.ts's own in-memory read-back record
 * (getReadbackStatus) and a live SQL Server permission probe
 * (pdasPermissions.ts, via pdasWrite.ts's probePermissions).
 */
import { W } from '../../lib/words';
import { Block, SkelLines, Failed } from '../../ui/bits';
import { fmtAppInstant } from '../../lib/fmt';
// GET /api/health is already polled once by Health.tsx for the rest of the
// screen; this block takes that same report as a prop rather than fetching a
// second time, so the two can never show different pdasWrite facts on one page.
import type { HealthReport } from '../../api';

export function PdasWriteBlock({ report, error, onRetry }: {
  report: HealthReport | null;
  error: string | null;
  onRetry: () => void;
}) {
  const pw = report?.pdasWrite ?? null;

  return (
    <Block label={W.health.pdasWriteTitle}>
      {error && !report ? (
        <Failed error={error} onRetry={onRetry} />
      ) : !report ? (
        <SkelLines n={2} short />
      ) : pw == null || !pw.enabled ? (
        <>
          <p style={{ fontSize: 'var(--fs-qual)' }}>{W.health.pdasWriteOffTitle}</p>
          <p className="mut sm" style={{ marginTop: 8 }}>{W.health.pdasWriteOff}</p>
        </>
      ) : (
        <>
          <p style={{ fontSize: 'var(--fs-qual)' }}>{W.health.pdasWriteOnTitle}</p>
          <p className={pw.canReadBack === true ? '' : 'acc'} style={{ marginTop: 8 }}>
            {pw.canReadBack === true
              ? W.health.checkedYes
              : pw.canReadBack === false
                ? W.health.checkedNo(pw.missingSelect.join(', '))
                : W.health.checkedUnknown}
          </p>
          {pw.missingExecute.length > 0 && (
            <p className="acc sm" style={{ marginTop: 8 }}>{W.health.missingExecuteNote(pw.missingExecute.join(', '))}</p>
          )}

          <p className="mut sm" style={{ marginTop: 20 }}>
            {pw.lastVerifiedUtc ? W.health.lastVerified(fmtAppInstant(pw.lastVerifiedUtc)) : W.health.lastVerifiedNever}
          </p>

          <p className="mut sm" style={{ marginTop: 20 }}>{W.health.unverifiedTablesTitle}</p>
          <p className={pw.unverifiedSinceStartup.length > 0 ? 'acc' : 'mut'} style={{ marginTop: 6 }}>
            {pw.unverifiedSinceStartup.length === 0
              ? W.health.unverifiedTablesNone
              : W.health.unverifiedTablesNote(pw.unverifiedSinceStartup.join(', '))}
          </p>
        </>
      )}
    </Block>
  );
}
