/** Small shared pieces for the floor screens: status pill, replay banner, footer. */
import { ageLabel, freshnessLevel } from '../format';
import { useLive, usePlantNow, useTicker } from './live';
import { S } from './strings';
import { fmtAgo, fmtClockSec, fmtDay, type Measured } from './fmt';

/**
 * A number with its unit set smaller beside it, so the pair scales together and
 * the unit can never be the part that falls off the edge of the card.
 */
export function Measure({ parts }: { parts: Measured }) {
  return (
    <>
      <span className="m-val">{parts.value}</span>
      {parts.unit && <span className="m-unit">{parts.unit}</span>}
    </>
  );
}

/** OK / OUT from the plant's own in-range bit; "—" when the plant left it blank. */
export function Pill({ inRange, big }: { inRange: boolean | null | undefined; big?: boolean }) {
  const cls = big ? 'pill big' : 'pill';
  if (inRange == null) return <span className={`${cls} none`}>—</span>;
  return inRange ? (
    <span className={`${cls} on`} title={S.inRange}>{S.ok}</span>
  ) : (
    <span className={`${cls} off`} title={S.outOfRange}>{S.out}</span>
  );
}

/** Shown whenever the plant clock has been moved by ?at= — never silent. */
export function ReplayBanner() {
  const { line } = useLive();
  if (!line?.replay) return null;
  return (
    <div className="replay-banner" role="status">
      <b>{S.replayBanner}</b> {fmtDay(line.plantNowUtc)}, {fmtClockSec(line.plantNowUtc)}. {S.replayNote}
    </div>
  );
}

/** "Updated 4 s ago · Plant data synced 57m ago", plus an offline warning. */
export function LiveFooter() {
  const { meta, error, updatedAt } = useLive();
  const now = useTicker(1000);
  const plantNow = usePlantNow();
  const age = updatedAt == null ? null : Math.round((now - updatedAt) / 1000);
  return (
    <div className="floor-foot">
      {error && (
        <div className="floor-offline" role="alert">
          <b>{S.offline}</b> {error}
        </div>
      )}
      <span>
        {S.updated} {fmtAgo(age)}
        {plantNow && <> · {S.plantTime} {fmtClockSec(plantNow)}</>}
      </span>
      {meta && (
        <span className="floor-sync">
          <span className={`dot ${freshnessLevel(meta.sourceAgeSeconds)}`} />
          {S.plantLink} {ageLabel(meta.sourceAgeSeconds)}
        </span>
      )}
    </div>
  );
}
