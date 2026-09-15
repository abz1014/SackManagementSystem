/** `sms sync` — run one full pass (seed, Reader→raw, Transform→canonical). */
import { openContext, cliLog } from '../context.js';
import { runFullSync, TableHaltsError, clearPersistentFailure, type FullSyncResult } from '@sms/sync-worker';

function report(started: number, r: FullSyncResult): void {
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (r.productMirrorError) {
    console.warn(`  WARNING: PDAS product mirror failed (readings still ingested): ${r.productMirrorError}`);
  }
  for (const o of r.reader) {
    console.log(`  raw ${o.table.replace('sms_raw.', '').padEnd(20)} read=${o.read} written=${o.written}`);
  }
  for (const o of r.transform) {
    console.log(`  canon ${o.table.padEnd(14)} read=${o.read} written=${o.written}`);
  }
  console.log(`done in ${secs}s (source probe ${r.sourceProbeMs} ms)`);
}

export async function sync(): Promise<number> {
  const ctx = await openContext({ needIfl: true });
  try {
    const started = Date.now();
    try {
      report(started, await runFullSync(ctx.app, ctx.ifl, ctx.cfg));
      // A clean pass clears a standing persistent_sync_failure finding, the
      // same as the service loop does (15 Sep 2026 recovery rehearsal).
      await clearPersistentFailure(ctx.app);
      return 0;
    } catch (err) {
      // Per-table isolation (Phase 2): some tables synced and were
      // transformed; the rest halted. Print both, exit 1.
      if (err instanceof TableHaltsError && err.partial) {
        report(started, err.partial as FullSyncResult);
        console.error(`\n${err.message}`);
        cliLog.error('sync: some tables did not sync', { halted: err.halts.map((h) => h.sourceTable) });
        return 1;
      }
      throw err;
    }
  } finally {
    await ctx.close();
  }
}
