/**
 * Product › Catalogue — "Which products exist, what are their limits, and
 * how do I add or retire one?" (IA-PROPOSAL.md §3.2).
 *
 * `PdasProducts` and its three forms (`LimitsForm`/`ActiveForm`/`CreateForm`)
 * are moved VERBATIM in behaviour from the old product sheet component (UX Phase 6 Brief 1,
 * 16 Sep 2026) — same requests, same validation, same copy. Nothing here
 * redesigns what they send.
 *
 * `<ProductLimitsBlock/>` — the SMS-local limit history/editor, shared with
 * Setup › Rules — is mounted UN-COLLAPSED: it was buried inside a
 * `<Details>` in the old product sheet component, four levels deep with no outside
 * signpost (IA-PROPOSAL.md §6.4). It decides its own write visibility from
 * the server (`GET /api/product-write/status`'s `local.canWrite`), so
 * mounting it costs one JSX line and no new gating logic here.
 *
 * DEEP LINK. `productId` is the shared `pr` key (App.tsx's Route note, the
 * same one Report and Rejects filter by). When set, the matching row in the
 * PDAS table is scrolled into view and marked — this table is the one part
 * of this screen addressable by a single product; `ProductLimitsBlock`
 * always lists every product's history and is not filtered by it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { W } from '../../lib/words';
import { Block, Failed, SkelLines } from '../../ui/bits';
import { fmtG } from '../../lib/fmt';
import { distinctProductLabels } from '../../lib/productLabel';
import { pdasReasonForDisplay } from '../../lib/pdasWords';
import { ProductLimitsBlock } from './ProductLimitsBlock';
import {
  getProducts, getProductWriteStatus, getProductOptions, createProduct, setProductActive, updateProductLimits,
  getPallets, setPalletActive,
  type ProductOption, type ProductWriteStatus, type ProductOptions, type ProductFields, type PalletRow,
} from '../../api';

function label(p: { description: string | null; lotCode: string | null; productId: number }): string {
  return p.description || p.lotCode || `Product ${p.productId}`;
}

export function CatalogueTab({
  productId,
}: {
  productId: number | null;
  /**
   * The setter half of the shared `pr` route field is accepted by
   * `Product.tsx` (App.tsx's Route note) but not needed here: the deep link
   * is never cleared once followed — see `PdasProducts`'s own note on why
   * clearing it would undo the highlight before a reader saw it.
   */
  onProductIdChange: (v: number | null) => void;
}) {
  const [products, setProducts] = useState<ProductOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setError(null);
    getProducts()
      .then((r) => setProducts(r.products))
      .catch((e) => setError(String((e as Error).message ?? e)));
  }, [nonce]);

  // Task L1 (28 Sep 2026): pallets are a separate mirror table from
  // products, fetched and refreshed independently — same shape as the
  // products fetch above, deliberately not folded into PdasProducts (see
  // this component's own file header: keep the change to PdasProducts
  // minimal so pdasDisabledReason.test.tsx's existing Catalogue test, which
  // never registers `/api/pallets`, is unaffected).
  const [pallets, setPallets] = useState<PalletRow[] | null>(null);
  const [palletsError, setPalletsError] = useState<string | null>(null);
  const [palletsNonce, setPalletsNonce] = useState(0);

  useEffect(() => {
    setPalletsError(null);
    getPallets()
      .then((r) => setPallets(r.pallets))
      .catch((e) => setPalletsError(String((e as Error).message ?? e)));
  }, [palletsNonce]);

  return (
    <>
      <Block label={W.product.catalogueTitle} note={W.product.catalogueNote}>
        {error ? (
          // UX Phase 7 Brief 1: a bare <p> with no retry button — the one
          // failure state in this codebase without one (compare History.tsx's
          // TimelineBlock, the textbook version of this three-way pattern).
          // `nonce` already exists to re-trigger the effect above after a
          // write; reusing it here costs nothing new.
          <Failed error={error} onRetry={() => setNonce((n) => n + 1)} />
        ) : !products ? (
          <SkelLines n={5} short />
        ) : (
          <PdasProducts
            products={products}
            linkedId={productId}
            onChanged={() => setNonce((n) => n + 1)}
          />
        )}
      </Block>

      <Block label={W.product.palletsTitle} note={W.product.palletsNote}>
        {palletsError ? (
          <Failed error={palletsError} onRetry={() => setPalletsNonce((n) => n + 1)} />
        ) : !pallets ? (
          <SkelLines n={5} short />
        ) : (
          <PdasPallets pallets={pallets} onChanged={() => setPalletsNonce((n) => n + 1)} />
        )}
      </Block>

      <Block label={W.cone.limitsSection}>
        <ProductLimitsBlock />
      </Block>
    </>
  );
}

/* ------------------------------------------------------------ PDAS writes */

function fieldsOf(p: ProductOption): ProductFields | null {
  if (p.setpointG == null || p.weightOffsetMinusG == null || p.weightOffsetPlusG == null) return null;
  return {
    setpointG: p.setpointG,
    offsetMinusG: Math.abs(p.weightOffsetMinusG),
    offsetPlusG: Math.abs(p.weightOffsetPlusG),
    desc1: p.description,
    desc2: p.color,
    active: p.activeFlag ?? false,
  };
}

function rangeLabel(f: ProductFields): string {
  return `${fmtG(f.setpointG - f.offsetMinusG)} – ${fmtG(f.setpointG + f.offsetPlusG)}`;
}

function errText(e: unknown): string {
  return String((e as { message?: string })?.message ?? e);
}

function PdasProducts({
  products,
  linkedId,
  onChanged,
}: {
  products: ProductOption[];
  /**
   * The `pr` deep link — the matching row is marked AND kept marked (the
   * link was a deliberate "go to this product", not a one-off flash), and
   * scrolled into view once. Deliberately NOT cleared back to the parent's
   * route state after the scroll: clearing it would re-render with
   * `linkedId: null` on the very same tick, in effect undoing the highlight
   * before a reader could see it. A local ref (below), not route state,
   * tracks whether the one-time scroll already ran.
   */
  linkedId: number | null;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<ProductWriteStatus | null>(null);
  const [mode, setMode] = useState<{ kind: 'limits'; id: number } | { kind: 'active'; id: number; active: boolean } | { kind: 'create' } | null>(null);
  const linkedRef = useRef<HTMLTableRowElement | null>(null);
  const scrolledRef = useRef(false);
  /**
   * One name per row, distinct within this table — friction audit F15,
   * 23 Sep 2026. Six of these materials are described "205-IL0-SD", three
   * "201-IH0-SD" and three "204-ILT-BR", and every row carries a "Change
   * weight limits" button onto the guarded single-row `UPDATE dbo.Materials`.
   * The id column beside the name has always been the unambiguous answer, but
   * it is a PDAS surrogate key: a reader scanning descriptions sees the same
   * words six times. `distinctProductLabels` (lib/productLabel.ts — the same
   * helper Sacks, Rejects, Line, Product › Running and the Sack/Product
   * reports use, ported server-side for the CSVs as
   * api/src/services/productNames.ts) appends the parts that actually differ,
   * from PDAS's own columns already on this payload. The id column STAYS: the
   * appended parts are unique on today's data, not unique by construction.
   */
  const labels = useMemo(() => distinctProductLabels(products), [products]);

  useEffect(() => {
    getProductWriteStatus().then(setStatus).catch(() => setStatus({ enabled: false, reason: 'status unavailable', canWrite: false, local: { canWrite: false } }));
  }, []);

  useEffect(() => {
    if (linkedId != null && linkedRef.current && !scrolledRef.current) {
      linkedRef.current.scrollIntoView({ block: 'center' });
      scrolledRef.current = true;
    }
  }, [linkedId]);

  const active = products.filter((p) => p.activeFlag !== false);
  const retired = products.filter((p) => p.activeFlag === false);

  return (
    <>
      <p className="mut sm">{W.product.pdasNote}</p>
      {status && !status.canWrite && (
        <p className="mut sm" style={{ marginTop: 8 }}>
          {status.enabled ? W.product.writeNeedsRank : W.product.writeUnavailable(pdasReasonForDisplay(status.reason) ?? '—')}
        </p>
      )}
      <table style={{ marginTop: 10 }}>
        <tbody>
          {[...active, ...retired].map((p) => {
            const f = fieldsOf(p);
            const linked = linkedId === p.productId;
            return (
              <tr
                key={p.productId}
                ref={linked ? linkedRef : undefined}
                className={[p.activeFlag === false ? 'mut' : '', linked ? 'acc' : ''].filter(Boolean).join(' ')}
              >
                <td>{labels.get(p.productId) ?? label(p)}{p.activeFlag === false ? ` · ${W.product.retired}` : ''}</td>
                <td className="n">{p.productId}</td>
                <td>{f ? `${fmtG(f.setpointG)} · ${rangeLabel(f)}` : '—'}</td>
                {status?.canWrite && (
                  <td className="n">
                    {f && (
                      <button type="button" className="linkish" onClick={() => setMode({ kind: 'limits', id: p.productId })}>
                        {W.product.changeLimits}
                      </button>
                    )}{' '}
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => setMode({ kind: 'active', id: p.productId, active: p.activeFlag === false })}
                    >
                      {p.activeFlag === false ? W.product.activate : W.product.retire}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {status?.canWrite && mode === null && (
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={() => setMode({ kind: 'create' })}>
          {W.product.newProduct}
        </button>
      )}
      {mode?.kind === 'limits' && (
        <LimitsForm product={products.find((p) => p.productId === mode.id)!} onDone={() => { setMode(null); onChanged(); }} onCancel={() => setMode(null)} />
      )}
      {mode?.kind === 'active' && (
        <ActiveForm productId={mode.id} active={mode.active} onDone={() => { setMode(null); onChanged(); }} onCancel={() => setMode(null)} />
      )}
      {mode?.kind === 'create' && (
        <CreateForm products={products} onDone={() => { setMode(null); onChanged(); }} onCancel={() => setMode(null)} />
      )}
    </>
  );
}

/** Signed "+5 g" / "-5 g"; 0 prints "+0 g", never a bare "0 g" that could read as "no change" ambiguously. */
function signedG(n: number): string {
  const r = Math.round(n);
  return `${r >= 0 ? '+' : ''}${r.toLocaleString('en-US')} g`;
}

/** Signed "+0.25" / "-0.25", two decimal places, no '%' — the word function appends that. */
function signedPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

/**
 * Task W1-D (failure analysis F-26/F-27/F-31): the SAME large-change
 * thresholds `PdasWriter.limitChangeBound` enforces server-side
 * (pdasWrite.ts), mirrored here only to decide whether THIS FORM shows the
 * large-change checkbox and reason hint before submitting — a UI
 * convenience, not the actual gate. The server re-checks unconditionally
 * against its own (possibly env-overridden) bounds and is the only thing
 * that can refuse the write; a client/server mismatch here means at most an
 * unnecessary checkbox or a 400 the operator did not expect, never a bound
 * that goes unenforced.
 */
const LARGE_CHANGE_SETPOINT_PCT = 3;
const LARGE_CHANGE_OFFSET_G = 20;
const LARGE_CHANGE_REASON_MIN = 20;

/** Action A — in place; keeps the MaterialId. Two steps: review, then a separate write click — one click must never write. */
function LimitsForm({ product, onDone, onCancel }: { product: ProductOption; onDone: () => void; onCancel: () => void }) {
  const before = fieldsOf(product)!;
  const [sp, setSp] = useState(String(before.setpointG));
  const [om, setOm] = useState(String(before.offsetMinusG));
  const [op, setOp] = useState(String(before.offsetPlusG));
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [largeChangeChecked, setLargeChangeChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const after: ProductFields = { ...before, setpointG: Number(sp), offsetMinusG: Number(om), offsetPlusG: Number(op) };
  const valid = Number.isFinite(after.setpointG) && Number.isFinite(after.offsetMinusG) && Number.isFinite(after.offsetPlusG);

  const setpointDeltaG = valid ? after.setpointG - before.setpointG : 0;
  const setpointPct = valid && before.setpointG !== 0 ? (setpointDeltaG / before.setpointG) * 100 : 0;
  const offsetMinusDeltaG = valid ? after.offsetMinusG - before.offsetMinusG : 0;
  const offsetPlusDeltaG = valid ? after.offsetPlusG - before.offsetPlusG : 0;
  const isLargeChange =
    valid &&
    (Math.abs(setpointPct) > LARGE_CHANGE_SETPOINT_PCT ||
      Math.abs(offsetMinusDeltaG) > LARGE_CHANGE_OFFSET_G ||
      Math.abs(offsetPlusDeltaG) > LARGE_CHANGE_OFFSET_G);
  const reasonLongEnoughForLargeChange = reason.trim().length >= LARGE_CHANGE_REASON_MIN;
  // The confirm button on step 2: an ordinary change needs only the usual
  // 10-char reason (checked server-side and, redundantly, again just before
  // the request below); a large change ALSO needs the checkbox ticked and a
  // 20-char reason.
  const canWrite = !busy && (!isLargeChange || (largeChangeChecked && reasonLongEnoughForLargeChange));

  return (
    <form
      style={{ marginTop: 14 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (reason.trim().length < 10) { setErr(W.product.reasonTooShort); return; }
        if (step === 'edit') {
          // Step 1 -> 2 only. This submit NEVER writes — see the button's own
          // label change below (Review the change / Change the limits).
          setErr(null);
          setStep('confirm');
          return;
        }
        // Step 2: the actual write. Re-checked here, not just via `disabled`,
        // in case component state and the disabled attribute ever drift.
        if (isLargeChange && !(largeChangeChecked && reasonLongEnoughForLargeChange)) {
          setErr(W.product.largeChangeReasonHint);
          return;
        }
        setBusy(true); setErr(null);
        try { await updateProductLimits(product.productId, before, after, reason.trim(), isLargeChange && largeChangeChecked); onDone(); }
        catch (x) { setErr(errText(x)); } finally { setBusy(false); }
      }}
    >
      <div style={{ fontSize: 'var(--fs-qual)' }}>
        {W.product.changeLimitsHeading(label(product), product.blend ?? '—', product.countText ?? '—', product.tubeType ?? '—', product.productId)}
      </div>
      <p className="mut sm">{step === 'edit' ? W.product.changeLimitsReviewStep : W.product.changeLimitsWriteStep}</p>
      {step === 'edit' ? (
        <>
          <p>
            {W.product.targetTo(fmtG(before.setpointG), fmtG(after.setpointG || before.setpointG))}
            {' · '}
            {W.product.rangeTo(rangeLabel(before), valid ? rangeLabel(after) : '—')}
          </p>
          <p className="mut sm">{W.product.changeLimitsNote}</p>
          <p className="mut sm">{W.product.changeLimitsKeepsNumber(product.productId)}</p>
          <p className="mut sm">{W.product.changeLimitsPropagation}</p>
          <label><span>{W.product.setpointG}</span><input type="number" step="1" value={sp} onChange={(e) => setSp(e.target.value)} /></label>
          <label><span>{W.product.offsetMinusG}</span><input type="number" step="1" min="0" value={om} onChange={(e) => setOm(e.target.value)} /></label>
          <label><span>{W.product.offsetPlusG}</span><input type="number" step="1" min="0" value={op} onChange={(e) => setOp(e.target.value)} /></label>
          <label><span>{W.product.whyRequired}</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          {err && <p className="acc sm">{err}</p>}
          <button type="submit" className="btn" disabled={!valid}>{W.product.changeLimitsReviewNext}</button>{' '}
          <button type="button" className="btn" onClick={onCancel}>{W.product.cancel}</button>
        </>
      ) : (
        <>
          <p>
            {W.product.changeLimitsDelta(
              W.product.changeLimitsDeltaTarget, fmtG(before.setpointG), fmtG(after.setpointG),
              signedG(setpointDeltaG), signedPct(setpointPct),
            )}
          </p>
          <p>
            {W.product.changeLimitsDelta(
              W.product.changeLimitsDeltaBelow, fmtG(before.offsetMinusG), fmtG(after.offsetMinusG),
              signedG(offsetMinusDeltaG), null,
            )}
          </p>
          <p>
            {W.product.changeLimitsDelta(
              W.product.changeLimitsDeltaAbove, fmtG(before.offsetPlusG), fmtG(after.offsetPlusG),
              signedG(offsetPlusDeltaG), null,
            )}
          </p>
          {isLargeChange && (
            <div className="acc sm" style={{ marginTop: 8 }}>
              <p>{W.product.largeChangeHeading}</p>
              <label>
                <input type="checkbox" checked={largeChangeChecked} onChange={(e) => setLargeChangeChecked(e.target.checked)} />{' '}
                {W.product.largeChangeCheckbox}
              </label>
              <p className="mut sm">{W.product.largeChangeReasonHint}</p>
            </div>
          )}
          <label><span>{W.product.whyRequired}</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          {err && <p className="acc sm">{err}</p>}
          <button type="submit" className="btn" disabled={!canWrite}>{W.product.changeLimitsConfirm}</button>{' '}
          <button type="button" className="btn" onClick={() => setStep('edit')}>{W.product.changeLimitsBack}</button>{' '}
          <button type="button" className="btn" onClick={onCancel}>{W.product.cancel}</button>
        </>
      )}
    </form>
  );
}

/** Action C — deactivate/reactivate; never "delete". */
function ActiveForm({ productId, active, onDone, onCancel }: { productId: number; active: boolean; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      style={{ marginTop: 14 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (reason.trim().length < 10) { setErr(W.product.reasonTooShort); return; }
        setBusy(true); setErr(null);
        try { await setProductActive(productId, active, reason.trim()); onDone(); }
        catch (x) { setErr(errText(x)); } finally { setBusy(false); }
      }}
    >
      <p>{active ? W.product.activateNote(productId) : W.product.retireNote(productId)}</p>
      <label><span>{W.product.whyRequired}</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {err && <p className="acc sm">{err}</p>}
      <button type="submit" className="btn" disabled={busy}>{active ? W.product.activate : W.product.retire}</button>{' '}
      <button type="button" className="btn" onClick={onCancel}>{W.product.cancel}</button>
    </form>
  );
}

/** Action B — the only path that produces a new MaterialId. */
function CreateForm({ products, onDone, onCancel }: { products: ProductOption[]; onDone: () => void; onCancel: () => void }) {
  const [opts, setOpts] = useState<ProductOptions | null>(null);
  const [blendId, setBlendId] = useState<number | ''>('');
  const [countId, setCountId] = useState<number | ''>('');
  const [tubeTypeId, setTubeTypeId] = useState<number | ''>('');
  const [sp, setSp] = useState('1960');
  const [om, setOm] = useState('50');
  const [op, setOp] = useState('50');
  const [desc1, setDesc1] = useState('');
  const [desc2, setDesc2] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getProductOptions().then(setOpts).catch((x) => setErr(errText(x))); }, []);

  // PDAS allows one product per (blend, count, tube) — active or not. Say so
  // before the proc refuses with -7001.
  const clash = products.find((p) =>
    opts && blendId !== '' && countId !== '' && tubeTypeId !== '' &&
    p.blend === opts.blends.find((b) => b.id === blendId)?.name &&
    p.countText === opts.counts.find((c) => c.id === countId)?.name &&
    p.tubeType === opts.tubeTypes.find((t) => t.id === tubeTypeId)?.name);

  return (
    <form
      style={{ marginTop: 14 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (blendId === '' || countId === '' || tubeTypeId === '') return;
        if (reason.trim().length < 10) { setErr(W.product.reasonTooShort); return; }
        setBusy(true); setErr(null);
        try {
          await createProduct({
            blendId, countId, tubeTypeId,
            fields: { setpointG: Number(sp), offsetMinusG: Number(om), offsetPlusG: Number(op), desc1: desc1 || null, desc2: desc2 || null, active: true },
            reason: reason.trim(),
          });
          onDone();
        } catch (x) { setErr(errText(x)); } finally { setBusy(false); }
      }}
    >
      <div style={{ fontSize: 'var(--fs-qual)' }}>{W.product.newProduct}</div>
      <p className="mut sm">{W.product.newProductNote}</p>
      {opts === null && !err ? <SkelLines n={3} short /> : opts && (
        <>
          <label><span>{W.product.blend}</span>
            <select value={blendId} onChange={(e) => setBlendId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">—</option>{opts.blends.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></label>
          <label><span>{W.product.count}</span>
            <select value={countId} onChange={(e) => setCountId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">—</option>{opts.counts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <label><span>{W.product.tubeType}</span>
            <select value={tubeTypeId} onChange={(e) => setTubeTypeId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">—</option>{opts.tubeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></label>
          {clash && (
            <p className="acc sm">
              {W.product.newProductTriple(clash.blend ?? '—', clash.countText ?? '—', clash.tubeType ?? '—', clash.productId)}
            </p>
          )}
          <label><span>{W.product.setpointG}</span><input type="number" step="1" value={sp} onChange={(e) => setSp(e.target.value)} /></label>
          <label><span>{W.product.offsetMinusG}</span><input type="number" step="1" min="0" value={om} onChange={(e) => setOm(e.target.value)} /></label>
          <label><span>{W.product.offsetPlusG}</span><input type="number" step="1" min="0" value={op} onChange={(e) => setOp(e.target.value)} /></label>
          <label><span>{W.product.desc1}</span><input value={desc1} onChange={(e) => setDesc1(e.target.value)} /></label>
          <label><span>{W.product.colour}</span><input value={desc2} onChange={(e) => setDesc2(e.target.value)} /></label>
          <label><span>{W.product.whyRequired}</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </>
      )}
      {err && <p className="acc sm">{err}</p>}
      <button type="submit" className="btn" disabled={busy || !opts || !!clash || blendId === '' || countId === '' || tubeTypeId === ''}>
        {W.product.newProductConfirm}
      </button>{' '}
      <button type="button" className="btn" onClick={onCancel}>{W.product.cancel}</button>
    </form>
  );
}

/* ------------------------------------------------------------- pallets */

/**
 * Task L1 (28 Sep 2026) — "Pallets in PDAS", filling DEFECTS.md D-34 (the
 * "no control to reactivate a retired pallet" finding from the 28 Sep
 * PDAS e2e harness's third pass): before this, a pallet retired through
 * Changeover's retire checklist had no way back into the app.
 *
 * Deliberately its own write-status fetch (`getProductWriteStatus` is the
 * one endpoint both this block and the products block above need — see the
 * file header on why it is duplicated rather than shared), so this
 * component is independent of `PdasProducts` and can be added without
 * touching it.
 */
function PdasPallets({ pallets, onChanged }: { pallets: PalletRow[]; onChanged: () => void }) {
  const [status, setStatus] = useState<ProductWriteStatus | null>(null);
  const [mode, setMode] = useState<{ palletId: number; active: boolean } | null>(null);

  useEffect(() => {
    getProductWriteStatus().then(setStatus).catch(() => setStatus({ enabled: false, reason: 'status unavailable', canWrite: false, local: { canWrite: false } }));
  }, []);

  const active = pallets.filter((p) => p.active !== false);
  const retired = pallets.filter((p) => p.active === false);

  return (
    <>
      {status && !status.canWrite && (
        <p className="mut sm" style={{ marginTop: 8 }}>
          {status.enabled ? W.product.writeNeedsRank : W.product.writeUnavailable(pdasReasonForDisplay(status.reason) ?? '—')}
        </p>
      )}
      {pallets.length === 0 ? (
        <p className="mut sm">{W.product.palletsNone}</p>
      ) : (
        <table style={{ marginTop: 10 }}>
          <tbody>
            {[...active, ...retired].map((p) => (
              <tr key={p.palletId} className={p.active === false ? 'mut' : ''}>
                <td className="n">{p.palletId}</td>
                <td>{p.productLabel || `Product ${p.productId}`}</td>
                <td>{p.packSchemaLabel ?? '—'}</td>
                <td>{p.lot ?? '—'}</td>
                <td>
                  {p.sackColour ?? '—'}
                  {p.active === false ? ` · ${W.product.retired}` : ''}
                </td>
                {status?.canWrite && (
                  <td className="n">
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => setMode({ palletId: p.palletId, active: p.active === false })}
                    >
                      {p.active === false ? W.product.palletReactivate : W.product.retire}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {mode && (
        <PalletActiveForm
          palletId={mode.palletId}
          active={mode.active}
          onDone={() => { setMode(null); onChanged(); }}
          onCancel={() => setMode(null)}
        />
      )}
    </>
  );
}

/** A copy of the materials `ActiveForm` above, for a pallet instead of a product. */
function PalletActiveForm({ palletId, active, onDone, onCancel }: { palletId: number; active: boolean; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      style={{ marginTop: 14 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (reason.trim().length < 10) { setErr(W.product.reasonTooShort); return; }
        setBusy(true); setErr(null);
        try { await setPalletActive(palletId, active, reason.trim()); onDone(); }
        catch (x) { setErr(errText(x)); } finally { setBusy(false); }
      }}
    >
      <p>{active ? W.product.palletReactivateNote(palletId) : W.product.palletRetireNote(palletId)}</p>
      <label><span>{W.product.whyRequired}</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {err && <p className="acc sm">{err}</p>}
      <button type="submit" className="btn" disabled={busy}>{active ? W.product.palletReactivate : W.product.retire}</button>{' '}
      <button type="button" className="btn" onClick={onCancel}>{W.product.cancel}</button>
    </form>
  );
}
