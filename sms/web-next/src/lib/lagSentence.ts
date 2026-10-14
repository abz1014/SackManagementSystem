import { fmt, health as healthLib } from '../bridge/lib';
import { W } from '../bridge/words';
import { fmtTime } from './fmt';

/**
 * The one sentence that says how old the newest reading is and how long the plant takes to write one down
 * (the acquisition lag). It is what lets "the line stopped" be told apart from "the reading has not arrived yet".
 * Wall footer and Today both print it; the wording is the old app's W.lag.*.
 */
export function lagSentence(health: ReturnType<typeof healthLib.assessHealth>): string {
  switch (health.kind) {
    case 'stale':
      return W.lag.stale(health.readingUtc ? fmtTime(health.readingUtc) : '—');
    case 'late':
      return W.lag.late(fmt.fmtSpan(health.lagSeconds));
    case 'ok':
      return health.lagSeconds != null
        ? W.lag.ok(fmtTime(health.readingUtc), fmt.fmtSpan(health.lagSeconds))
        : W.lag.okNoLag(fmtTime(health.readingUtc));
    default:
      return W.lag.noData;
  }
}
