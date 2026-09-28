/**
 * Plain-words translation for the PDAS write path's `disabledReason` /
 * `message` text (FIX A, 28 Sep 2026).
 *
 * `resolvePdasWrite` (`api/src/config.ts`) composes that text for the OWNER
 * reading `.env`, not for the product screens: "PDAS_WRITE_ENABLED is not
 * true." names an environment variable no operator ever set themselves, and
 * it reaches the screen verbatim in three places — `sms.product_change
 * .message` (stored as-is, read by History's trail), `ChangeoverPlan
 * .disabledReason` / the execute route's 503 `error` field (Changeover), and
 * `ProductWriteStatus.reason` (Catalogue). Nineteen API tests assert
 * `resolvePdasWrite`'s exact raw strings, so the source is not the place to
 * change this — this module translates for DISPLAY only.
 *
 * The four reasons `resolvePdasWrite` can produce are matched here, plus the
 * plain-ish fallback (`pdasWrite.ts`'s `disabled()`, `changeover.ts`'s
 * `executeChangeover`) used when no `disabledReason` was set at all. A
 * reason this list does not recognise — the server started saying something
 * new — is shown verbatim rather than hidden, so nothing is ever silently
 * swallowed.
 *
 * WHY THIS IS NOT IN `words.ts`. Same merge-safety reason as
 * `generationWords.ts` in this same folder: a small, single-purpose module
 * that stays out of the file every concurrent worker's screen touches. Fold
 * it into `words.ts` once that file is quiet, same as that one.
 */
export function pdasReasonForDisplay(raw: string | null | undefined): string | null {
  if (raw == null) return null;

  if (raw === 'PDAS_WRITE_ENABLED is not true.' || raw === 'The PDAS write path is not enabled.') {
    return 'Writing to PDAS was switched off in this system’s settings.';
  }
  if (/^PDAS_WRITE_ENABLED is true but PDAS_WRITE_/.test(raw)) {
    return 'Writing to PDAS is switched on, but the write login is not fully set up in this system’s settings.';
  }
  if (/^PDAS_WRITE_DATABASE \(/.test(raw)) {
    return 'Writing to PDAS is switched off: the write login is not pointed at the right database.';
  }
  if (/^PDAS_WRITE_USER is the same login as IFL_DB_USER/.test(raw)) {
    return 'Writing to PDAS is switched off: the write login is not kept separate from the read-only login.';
  }
  return raw;
}
