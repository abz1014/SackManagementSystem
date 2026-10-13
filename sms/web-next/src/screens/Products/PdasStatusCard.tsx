/**
 * "PDAS connection": whether SMS may write to PDAS, and why not. Shared by every Products tab.
 *
 * The status is the server's (`GET /api/product-write/status`): `enabled` is the flag plus the write
 * login, `canWrite` is that AND this account's rank. The client never works either out from a rank
 * constant. The server's `reason` is printed exactly as sent, in its own element: it is the one
 * sentence that tells an engineer what to change on the plant server, so it is never reworded.
 * `local.canWrite` is a separate gate for the weight limits SMS keeps itself; it does not depend on PDAS.
 */
import { pdasWords } from '../../bridge/lib';
import { getProductWriteStatus, type ProductWriteStatus } from '../../bridge/api';
import { C, withFragments, FRAGMENTS } from '../../copy';
import { useData, type DataState } from '../../data';
import { ErrorState } from '../../ui/ErrorState';
import { Icon } from '../../ui/Icon';
import { Skeleton } from '../../ui/Skeleton';
import './products.css';
const PC = withFragments(C.products, FRAGMENTS.productsParts);

const S = PC.status;

/** One fetch of the write status; the card and the tab's write controls read the same answer. */
export function usePdasWriteStatus(): DataState<ProductWriteStatus> {
  return useData(S.part, () => getProductWriteStatus(), 'products:write-status', { live: false });
}

export interface PdasStatusCardProps {
  status: DataState<ProductWriteStatus>;
  /** Id of the element that holds the server reason, so a disabled control can point at it. */
  reasonId?: string;
  /** Badge and the server's reason only: for tabs where the card is a reminder, not the subject. */
  compact?: boolean;
}

export function PdasStatusCard({ status, reasonId = 'pds-reason', compact = false }: PdasStatusCardProps) {
  const d = status.data;
  let body;
  let badge: { text: string; kind: 'on' | 'off' | 'unread' };
  if (!d) {
    badge = { text: S.badgeUnread, kind: 'unread' };
    body =
      status.status === 'error' ? (
        <ErrorState part={S.part} cause={status.error ?? undefined} onRetry={status.refresh} />
      ) : (
        <Skeleton part={S.part} height={96} onRetry={status.refresh} />
      );
  } else if (d.enabled) {
    badge = { text: S.badgeOn, kind: 'on' };
    body = (
      <>
        <p className="pds__lead">{S.onLead}</p>
        {!d.canWrite && <p className="pds__note">{S.onNoRank}</p>}
        {!compact && <Rows d={d} />}
      </>
    );
  } else {
    badge = { text: S.badgeOff, kind: 'off' };
    body = (
      <>
        <p className="pds__lead">{S.offLead}</p>
        <div className="pds__reason">
          <span className="pds__reason-label">{S.reasonLabel}</span>
          <p id={reasonId} className="pds__reason-text">
            {pdasWords.pdasReasonForDisplay(d.reason) ?? S.noReason}
          </p>
        </div>
        {!compact && (
          <div className="pds__stays">
            <h3 className="pds__stays-title">{S.staysTitle}</h3>
            <p className="pds__note">
              {S.staysPlans} {d.local.canWrite ? S.staysLocal : ''} {S.staysDecision}
            </p>
          </div>
        )}
        {!compact && <Rows d={d} />}
      </>
    );
  }

  return (
    <section className={`card pds${compact ? ' pds--compact' : ''}`} aria-labelledby="pds-title">
      <div className="pds__head">
        <h2 id="pds-title" className="pds__title">
          {S.title}
        </h2>
        <span className={`pds__badge pds__badge--${badge.kind}`}>
          <Icon name={badge.kind === 'on' ? 'check' : 'lock'} size={16} />
          {badge.text}
        </span>
      </div>
      {body}
      {status.staleError && (
        <p className="pds__note" role="alert">
          {C.couldntLoad(S.part)}
        </p>
      )}
    </section>
  );
}

function Rows({ d }: { d: ProductWriteStatus }) {
  return (
    <dl className="pds__rows">
      <div>
        <dt>{S.rowPdas}</dt>
        <dd>{d.canWrite ? S.canChange : d.enabled ? S.yourAccountCannot : S.switchedOff}</dd>
      </div>
      <div>
        <dt>{S.rowLocal}</dt>
        <dd>{d.local.canWrite ? S.canChange : S.yourAccountCannot}</dd>
      </div>
    </dl>
  );
}
