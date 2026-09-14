/** One full pass: seed reference, Reader→raw, Transform→canonical. Reused by
 *  the worker entrypoint and the CLI `sync` command. */
import type { ConnectionPool } from 'mssql';
import { randomUUID } from 'node:crypto';
import type { SyncConfig } from './config.js';
import { seedReference } from './seed/seedReference.js';
import { seedProducts } from './seed/seedProducts.js';
import { runOnce, probeSource, TableHaltsError, type TableOutcome } from './runner.js';
import { runTransform, type TransformOutcome } from './transform/runTransform.js';
import { withTransformLock } from './lock.js';
import { fallbackHaltTargets, rawShortName, type IflTableDef } from './reader/iflTables.js';
import { loadSourceTables } from './reader/sourceTables.js';
import { recordHaltedRun } from './store.js';
import { clearFindings, persistFindings } from './transform/dq.js';

export interface FullSyncResult {
  reader: TableOutcome[];
  transform: TransformOutcome[];
  /** Set when the PDAS product mirror failed this pass. Ingestion still ran. */
  productMirrorError: string | null;
  /** Round trip of the source probe that opened the pass (roadmap Phase 2 item 5). */
  sourceProbeMs: number;
}

/** Check names of the worker's own state findings, cleared when the state clears. */
export const PRODUCT_MIRROR_FAILED = 'product_mirror_failed';
export const TRANSFORM_FAILED = 'transform_failed';

/**
 * A halt that happened before the reader ran leaves one 'halted' row per
 * source table, so the Setup screen counts every table as "did not sync"
 * and carries the reason — instead of four ageing 'success' rows.
 *
 * The tables are the line's configured ones (roadmap Phase 1). When the
 * configuration itself cannot be read — the app database is not migrated, or
 * the line has no rows — the halt still owes a row per raw table the schema
 * has, so it falls back to every kind with the adapter marked unknown rather
 * than writing nothing, which is the silence this function exists to end.
 */
export async function recordPassHalt(
  appPool: ConnectionPool,
  cfg: SyncConfig,
  stage: string,
  err: unknown,
): Promise<void> {
  const runId = randomUUID();
  const reason = err instanceof Error ? err.message : String(err);
  let targets: { targetTable: string; adapter: string }[];
  try {
    targets = (await loadSourceTables(appPool, cfg.lineId)).map((d) => ({
      targetTable: rawShortName(d.rawTable),
      adapter: d.systemCode,
    }));
  } catch {
    targets = fallbackHaltTargets();
  }
  for (const t of targets) {
    await recordHaltedRun(appPool, {
      runId,
      adapter: t.adapter,
      targetTable: t.targetTable,
      lineId: cfg.lineId,
      sourceEpoch: null,
      watermarkFrom: null,
      error: `Pass halted at ${stage}, before any table was read. ${reason}`,
    });
  }
}

const trim = (s: string, n = 480) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function runFullSync(
  appPool: ConnectionPool,
  iflPool: ConnectionPool,
  cfg: SyncConfig,
): Promise<FullSyncResult> {
  // ---- source probe (roadmap Phase 2 item 5) ---------------------------------
  // One round trip before any table is approached: is the source there, does
  // the login work, can it see the catalogue. A failure here is a PASS-level
  // halt — every table gets the row, with the classification in front of the
  // driver's message — because nothing per-table has been established yet.
  // The tables are loaded only to know which adapter to probe through; if
  // they cannot be loaded, runOnce records that halt itself, so the probe is
  // skipped rather than duplicating it.
  let sourceProbeMs = 0;
  let configured: IflTableDef[] | null = null;
  try {
    configured = await loadSourceTables(appPool, cfg.lineId);
  } catch {
    configured = null;
  }
  if (configured) {
    const probe = await probeSource(iflPool, configured);
    if (!probe.ok) {
      const err = new Error(`[${probe.classification}] source probe failed: ${probe.error}`);
      await recordPassHalt(appPool, cfg, 'source probe', err);
      throw err;
    }
    sourceProbeMs = probe.roundTripMs;
  }

  try {
    await seedReference(appPool, cfg);
  } catch (err) {
    await recordPassHalt(appPool, cfg, 'reference seed', err);
    throw err;
  }

  // The PDAS mirror is reference data for the product screens; the readings
  // are the record. Until 14 Sep 2026 the two were coupled: a login without
  // table read on PDAS, or PDAS simply being down, threw here and stopped
  // ALL ingestion — every cone, sack and reject — for the sake of a product
  // list that is unchanged from one pass to the next. Now the failure is
  // recorded as a standing finding (deduplicated by persistFindings, so a
  // 60 s retry does not grow the table), the pass carries on, and the
  // finding is cleared the moment a mirror succeeds. Nothing downstream
  // needs the mirror to ingest: canonical rows carry IFL's own MaterialId,
  // and no foreign key ties them to sms.product.
  let productMirrorError: string | null = null;
  try {
    await seedProducts(appPool, iflPool, cfg.pdasDbName);
    await clearFindings(appPool, PRODUCT_MIRROR_FAILED);
  } catch (err) {
    productMirrorError = err instanceof Error ? err.message : String(err);
    await persistFindings(appPool, randomUUID(), [
      {
        check_name: PRODUCT_MIRROR_FAILED,
        severity: 'ERROR',
        subject_table: 'product',
        count: 0,
        detail: trim(
          `The PDAS product mirror failed; readings are still being ingested, but new or ` +
            `changed products will not appear until it succeeds. ${productMirrorError}`,
        ),
      },
    ]);
  }

  // ---- reader, with per-table isolation (roadmap Phase 2 item 3) -------------
  // A halted table no longer stops the pass: runOnce writes its halt row,
  // reads the rest, and throws TableHaltsError carrying what DID sync. The
  // transform runs on that, and the aggregate is rethrown afterwards so the
  // log and the CLI still report the pass as not clean.
  let reader: TableOutcome[];
  let readerHalts: TableHaltsError | null = null;
  try {
    reader = await runOnce(appPool, iflPool, cfg);
  } catch (err) {
    if (!(err instanceof TableHaltsError) || err.outcomes.length === 0) throw err;
    reader = err.outcomes;
    readerHalts = err;
  }

  // Mutually exclusive with `sms rebuild` (finding C1, Sep 2026 audit): both
  // write the same canonical tables and transform watermarks, and nothing
  // previously stopped them running at the same time.
  //
  // A transform failure is NOT a sync_run halt — the raw tables did sync, and
  // their rows say so truthfully. What has stopped is the canonical layer, and
  // the only symptom of that used to be the top bar's data age creeping up
  // while every per-table row read 'success'. It is a standing finding now,
  // cleared by the next transform that completes.
  let transform: TransformOutcome[];
  try {
    transform = await withTransformLock(cfg.app, () => runTransform(appPool, cfg));
    await clearFindings(appPool, TRANSFORM_FAILED);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await persistFindings(appPool, randomUUID(), [
      {
        check_name: TRANSFORM_FAILED,
        severity: 'CRITICAL',
        subject_table: null,
        count: 0,
        detail: trim(
          `Raw rows are arriving but the transform to canonical tables failed, so every ` +
            `screen is falling behind. ${reason}`,
        ),
      },
    ]);
    throw err;
  }
  const result: FullSyncResult = { reader, transform, productMirrorError, sourceProbeMs };
  if (readerHalts) {
    readerHalts.partial = result;
    throw readerHalts;
  }
  return result;
}
