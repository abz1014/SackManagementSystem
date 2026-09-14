/**
 * Transform version — stamped on every canonical row (ARCHITECTURE §3).
 * Bump when raw→canonical logic changes; then rebuild canonical from raw so
 * rows record which logic produced them.
 *
 * HISTORY
 *
 * 1 — Phase 1 (Jul 2026). NullAttribution on every row; shift from the shared
 *     06/14/22 constant and the env's night rule; `ingest_run_id` a fresh UUID
 *     per transform pass that joined to nothing.
 *
 * 2 — roadmap Phases 2 and 3 (14 Sep 2026). A row stamped 2 was produced by
 *     a transform that:
 *       - attributes the product from the row's own `MaterialId`
 *         (`attribution_method = 'source_column'`, confidence 'high') and says
 *         'none' only where the column did not exist — cones, sacks AND
 *         rejects, which previously carried the material id but no method;
 *       - stamps `night_belongs_to` with the rule that produced `shift_date`;
 *       - carries `source_epoch`, the generation of the source table the raw
 *         row came from, and includes it in every merge key;
 *       - takes its shift boundaries from the newest `sms.shift_rule` row, not
 *         from a constant;
 *       - writes provenance the join can follow: `ingested_at_utc` is the raw
 *         row's `read_at_utc` (when SMS read it), and `ingest_run_id` is the
 *         raw row's `ingest_run_id` (= `sms.sync_run.run_id`), so canonical →
 *         raw → sync_run → source_epoch is a real chain rather than a promise.
 *     Rows stamped 1 still exist until `sms rebuild` restamps them; the
 *     backfill in migration 029 filled `ingested_at_utc`/`ingest_run_id` on
 *     them from raw but did not change their version, honestly — their shift
 *     and attribution logic is still version 1's.
 */
export const TRANSFORM_VERSION = 2;
