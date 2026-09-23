/**
 * Product limits — the versioned history AND the SMS-local editor, ONE
 * component rendered in both Setup › Rules (admin, rank >= 4 to reach the
 * screen) and the Product sheet (open to managers/engineers, rank >= 2 to
 * reach the sheet). Changing a limit is a rank-2 action server-side
 * (POST /api/products/limits/local, requireRole(2) — routes/cone.ts), so
 * putting the editor only in Setup would hide it from every engineer account
 * IFL actually uses — the exact mistake finding H3 already named once for
 * the product-details overlay (CLAUDE.md, Sep 2026 audit fix). Follows the
 * SyncHealthBlock precedent (health/SyncHealthBlock.tsx): one self-sufficient
 * component, fetching its own data, so the two screens cannot show this
 * differently.
 *
 * WHAT THIS DOES NOT DO. It never writes to PDAS and never requires
 * PDAS_WRITE_ENABLED — that write path is Product › Catalogue's separate
 * PdasProducts/LimitsForm (product/Catalogue.tsx, UX Phase 6 Brief 1,
 * 16 Sep 2026 — moved here from the deleted product sheet), still there,
 * still off. This one appends a row to
 * sms.product_limit_version with source 'sms_local' (productLimits.ts's
 * setLocalLimitVersion) and nothing else: not sms.product, not any PDAS
 * table. The control's availability comes from the server's reported
 * `local.canWrite` (GET /api/product-write/status) — never a rank constant
 * in this file — because a rank the server stops honouring must not leave a
 * button here that only ever answers 403.
 */
import { useMemo, useState } from 'react';
import {
  getProductLimitHistory, getProductWriteStatus, getProducts, setLocalLimitVersion,
  type LimitHistoryProduct, type LimitHistoryVersion, type ProductOption, type ProductWriteStatus,
} from '../../api';
import { fmtClock, fmtDay, fmtG } from '../../lib/fmt';
import { distinctProductLabels } from '../../lib/productLabel';
import { W } from '../../lib/words';
import { Failed, SkelLines } from '../../ui/bits';
import { Said, useResource, useWrite } from '../setup/shared';

/**
 * Whether the SMS-local limit editor should be offered, derived defensively
 * rather than by dereferencing `status.local.canWrite` directly. `local` is
 * typed as required on `ProductWriteStatus` (api.ts), but that type is a
 * compile-time promise, not a runtime guarantee: `get()` hands back whatever
 * JSON the server actually sent, unvalidated. A server built before
 * `local` was added to `GET /api/product-write/status` (commit 2e8b470) — or
 * one from a future rollback, or a shape a proxy mangled — returns a body
 * with no `local` at all, and `status.local.canWrite` throws
 * "Cannot read properties of undefined (reading 'canWrite')", taking the
 * whole screen down through the error boundary. A missing or malformed
 * `local` must read as "cannot write" and let the history render anyway —
 * kept a pure function, with no DOM, so it is unit-tested directly below.
 */
export function canWriteLocal(status: ProductWriteStatus | undefined | null): boolean {
  return Boolean(status && typeof status === 'object' && status.local && status.local.canWrite === true);
}

/**
 * One heading per product, distinct within this list — friction audit F15,
 * 23 Sep 2026.
 *
 * `GET /api/products/limits/history` labels a product from `sms.product`'s
 * description alone (productLimits.ts's `listLimitHistory`), and on this line
 * that description is not unique: six materials are called "205-IL0-SD"
 * (ids 20, 21, 1021-1024), three "201-IH0-SD" and three "204-ILT-BR". This
 * block rendered one heading per product, so fourteen blocks carried nine
 * repeated names — EACH with its own "Change limits" button, i.e. an
 * ambiguous target on a write control.
 *
 * The disambiguating parts come from the server, `GET /api/products`
 * (`color`/`blend`/`countText`/`tubeType`, PDAS's own columns), and are
 * applied by the SAME helper every other screen uses —
 * `lib/productLabel.ts`'s `distinctProductLabels`, ported rule-for-rule
 * server-side for the CSV exports as `api/src/services/productNames.ts` — so
 * Sacks, Rejects, Report and this block cannot invent different names for the
 * same material. Measured on this dataset: `blend` is "PVSD8020" on all six
 * and discriminates nothing; colour separates four of the six, and the count
 * ("30" against "20 Slub") separates the remaining ORANGE pair.
 *
 * If `/api/products` has not arrived or failed, the helper still runs over the
 * plain names alone and falls back to its own last resort, "· #20" — the PDAS
 * MaterialId, the one field GUARANTEED distinct. A heading is therefore never
 * ambiguous, whether or not the second fetch succeeded; it is only less
 * friendly. That is why this block renders its history as soon as the history
 * itself arrives rather than waiting on the catalogue.
 */
function headingLabels(
  history: LimitHistoryProduct[],
  catalogue: ProductOption[] | null,
): Map<number, string> {
  const parts = new Map((catalogue ?? []).map((p) => [p.productId, p]));
  return distinctProductLabels(
    history.map((p) => {
      const c = parts.get(p.productId);
      return {
        productId: p.productId,
        // The server's own plain name; `productLabel()` applies the same
        // description -> lotCode -> "Product N" fallback it was built with.
        description: p.label,
        color: c?.color ?? null,
        blend: c?.blend ?? null,
        countText: c?.countText ?? null,
        tubeType: c?.tubeType ?? null,
      };
    }),
  );
}

export function ProductLimitsBlock() {
  const res = useResource(() => getProductLimitHistory());
  const status = useResource(() => getProductWriteStatus());
  const cat = useResource(() => getProducts());
  const canWrite = canWriteLocal(status.data);
  const products = res.data?.products;
  const labels = useMemo(
    () => headingLabels(products ?? [], cat.data?.products ?? null),
    [products, cat.data],
  );

  return (
    <div>
      <p style={{ fontWeight: 500, marginBottom: 4 }}>{W.cone.limitsSection}</p>
      <p className="mut sm">{W.cone.limitsNote}</p>
      {/* Signed in but below engineer rank, or the status call itself failed
          silently (status.error is not surfaced here — the history above
          still loads and is the more important half): say once, not per
          product, matching PdasProducts's single top-of-block note. */}
      {status.data && !canWrite && <p className="mut sm">{W.cone.changeLimitsLocalUnavailable}</p>}
      {res.error ? (
        <Failed error={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <SkelLines n={4} short />
      ) : res.data.products.length === 0 ? (
        <p className="mut sm">{W.cone.limitsNoProducts}</p>
      ) : (
        <div style={{ display: 'grid', gap: 18, marginTop: 12 }}>
          {res.data.products.map((p) => (
            <ProductHistory
              key={p.productId}
              product={p}
              /* The heading a reader picks the block by (see headingLabels). */
              heading={labels.get(p.productId) ?? p.label}
              /* The PDAS row itself, for the editor's restatement of WHICH
                 product is about to gain a version. Absent while
                 /api/products is in flight or if it failed — the editor says
                 what it can and always states the id. */
              parts={cat.data?.products.find((c) => c.productId === p.productId) ?? null}
              canWrite={canWrite}
              onChanged={res.reload}
            />
          ))}
          <p className="mut sm">{W.cone.noLaterThanNote}</p>
        </div>
      )}
    </div>
  );
}

/** "1,960 ± 40 g" alone for the oldest row on record; "1,960 ± 40 g → 1,970 ± 40 g" for every row with an older version to compare against — before → after, for every source, not only sms_local ones. */
function limitsCell(v: LimitHistoryVersion, older: LimitHistoryVersion | undefined): string {
  const cur = v.label ?? (v.setpointG != null ? fmtG(v.setpointG) : '—');
  if (!older) return cur;
  const prev = older.label ?? (older.setpointG != null ? fmtG(older.setpointG) : '—');
  return prev === cur ? cur : W.cone.localWasLabel(prev, cur);
}

function ProductHistory({
  product, heading, parts, canWrite, onChanged,
}: {
  product: LimitHistoryProduct;
  heading: string;
  parts: ProductOption | null;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <p style={{ fontWeight: 500 }}>
          {heading}
          {product.activeFlag === false && <span className="mut"> · {W.cone.retired}</span>}
        </p>
        {canWrite && !editing && (
          <button type="button" className="linkish sm" onClick={() => setEditing(true)}>{W.cone.changeLimitsLocal}</button>
        )}
      </div>
      {product.versions.length === 0 ? (
        <p className="mut sm">{W.cone.limitsNoneYet}</p>
      ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>{W.cone.colLimits}</th>
                <th>{W.cone.colEffective}</th>
                <th>{W.cone.colSource}</th>
                <th>{W.cone.colBy}</th>
                <th>{W.cone.colReason}</th>
              </tr>
            </thead>
            <tbody>
              {product.versions.map((v, i) => (
                <tr key={v.versionId}>
                  <td style={{ whiteSpace: 'nowrap' }}>{limitsCell(v, product.versions[i + 1])}</td>
                  {/* "In force from" on the PRODUCTION-TIME convention
                      (effectiveFromPlant, UTC-pinned formatters) — never the
                      viewer's own browser zone, which could be a manager
                      opening this away from the plant PC and five hours off
                      the shift the changeover actually fell in. */}
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {v.effectiveIsLowerBound && <span className="mut">{W.cone.noLaterThan} </span>}
                    {fmtDay(v.effectiveFromPlant)} {fmtClock(v.effectiveFromPlant)}
                  </td>
                  <td>{W.cone.source[v.source] ?? v.source}</td>
                  <td>{v.changedBy ?? '—'}</td>
                  <td className="mut">{v.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <LocalLimitsForm
          product={product}
          parts={parts}
          onDone={() => { setEditing(false); onChanged(); }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function LocalLimitsForm({
  product, parts, onDone, onCancel,
}: {
  product: LimitHistoryProduct;
  parts: ProductOption | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const latest = product.versions[0];
  const [sp, setSp] = useState(latest?.setpointG != null ? String(latest.setpointG) : '');
  const [om, setOm] = useState(latest?.offsetMinusG != null ? String(Math.abs(latest.offsetMinusG)) : '');
  const [op, setOp] = useState(latest?.offsetPlusG != null ? String(Math.abs(latest.offsetPlusG)) : '');
  const [reason, setReason] = useState('');
  const w = useWrite();

  const spN = Number(sp);
  const omN = Number(om);
  const opN = Number(op);
  const valid =
    sp.trim() !== '' && om.trim() !== '' && op.trim() !== '' &&
    Number.isFinite(spN) && spN > 0 && Number.isFinite(omN) && omN > 0 && Number.isFinite(opN) && opN > 0;

  return (
    <form
      style={{ marginTop: 10, display: 'grid', gap: 10, maxWidth: '28em' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void w.run(
          () => setLocalLimitVersion({ productId: product.productId, setpointG: spN, offsetMinusG: omN, offsetPlusG: opN, reason: reason.trim() || undefined }),
          () => onDone(),
        );
      }}
    >
      {/* WHICH product is about to gain a version, restated before the fields
          — friction audit F15, 23 Sep 2026. The heading above is distinct on
          this dataset, but it is distinct by colour and count, which merely
          HAPPEN to differ here; the PDAS MaterialId is the only field
          guaranteed unique, so the restatement ends with it and the engineer
          is agreeing to a row, not to a label. Uses the PLAIN name in the
          first slot (the heading already carries the same parts spelled out
          beside it) and the existing `changeLimitsHeading` string, the one
          Product › Catalogue's PDAS editor states its own target with, so the
          two editors identify a product the same way. `—` where
          /api/products has not arrived: the id alone still identifies it. */}
      <p style={{ fontSize: 'var(--fs-qual)' }}>
        {W.product.changeLimitsHeading(
          product.label,
          parts?.blend ?? '—',
          parts?.countText ?? '—',
          parts?.tubeType ?? '—',
          product.productId,
        )}
      </p>
      {/* Makes plain up front what this button does — a NEW version, never a
          rewrite (roadmap Phase 4 item 2, the point the task named). */}
      <p className="mut sm">{W.cone.changeLimitsLocalNote}</p>
      <label className="field">
        <span>{W.product.setpointG}</span>
        <input type="number" min={0} step="1" value={sp} required onChange={(e) => setSp(e.target.value)} style={{ width: '9em' }} />
      </label>
      <label className="field">
        <span>{W.product.offsetMinusG}</span>
        <input type="number" min={0} step="1" value={om} required onChange={(e) => setOm(e.target.value)} style={{ width: '9em' }} />
      </label>
      <label className="field">
        <span>{W.product.offsetPlusG}</span>
        <input type="number" min={0} step="1" value={op} required onChange={(e) => setOp(e.target.value)} style={{ width: '9em' }} />
      </label>
      <label className="field">
        <span>{W.config.why}</span>
        <input type="text" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="row">
        <button type="submit" className="btn primary" disabled={w.busy || !valid}>{W.config.save}</button>
        <button type="button" className="btn" onClick={onCancel}>{W.product.cancel}</button>
      </div>
      <Said outcome={w.outcome} />
    </form>
  );
}
