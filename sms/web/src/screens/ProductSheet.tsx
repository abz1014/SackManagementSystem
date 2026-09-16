/**
 * Current Product — the Q1 changeover control.
 *
 * Fixes finding H3 (Sep 2026 audit): the backend (currentProduct.ts,
 * /api/products, /api/current-product, /api/product-timeline) and this
 * screen's own copy (lib/words.ts `product`) were both fully built, but
 * Line's "Change" button navigated to Setup, which has no product section —
 * a dead end for the one feature that resolves Q1 and answers requirement 3.
 *
 * It opens as a SHEET, not a Setup section, because Setup is admin-only
 * (`rank >= 4` in App.tsx) while setting the product is a supervisor+ action
 * server-side (`requireRole(2)` on POST /api/current-product) — nesting it in
 * Setup would have hidden it from every supervisor and manager account IFL
 * actually uses. This is the "app-owned product-details overlay" CLAUDE.md's
 * redesign sign-off lists as still to do.
 */
import { useEffect, useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Details, Failed, SkelLines } from '../ui/bits';
import { W } from '../lib/words';
import { fmtDayLong, fmtG } from '../lib/fmt';
import { ProductLimitsBlock } from './product/ProductLimitsBlock';
import {
  getCurrentProduct, getProducts, getProductTimeline, setCurrentProduct,
  getProductWriteStatus, getProductOptions, createProduct, setProductActive, updateProductLimits,
  type ProductOption, type TimelineEntry, type ProductWriteStatus, type ProductOptions, type ProductFields,
} from '../api';

function label(p: { description: string | null; lotCode: string | null; productId: number }): string {
  return p.description || p.lotCode || `Product ${p.productId}`;
}

function limitsLabel(p: ProductOption | undefined): string | null {
  if (!p || p.setpointG == null || p.weightOffsetMinusG == null || p.weightOffsetPlusG == null) return null;
  const minus = Math.abs(p.weightOffsetMinusG);
  const plus = Math.abs(p.weightOffsetPlusG);
  // fmtG rather than a third hand-rolled copy of its body: it carries the
  // non-breaking space, so "1,960 ± 40 g" cannot wrap between number and unit.
  if (minus === plus) return `${fmtG(p.setpointG)} ± ${fmtG(plus)}`;
  return `${fmtG(p.setpointG - minus)} to ${fmtG(p.setpointG + plus)}`;
}

export function ProductSheet({ canWrite, onClose }: { canWrite: boolean; onClose: () => void }) {
  const [current, setCurrentState] = useState<TimelineEntry | null | undefined>(undefined);
  const [products, setProducts] = useState<ProductOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const load = () => {
    setError(null);
    Promise.all([getCurrentProduct(), getProducts()])
      .then(([c, p]) => {
        setCurrentState(c.current);
        setProducts(p.products);
      })
      .catch((e) => setError(String((e as Error).message ?? e)));
  };
  useEffect(load, [nonce]);

  const loading = current === undefined || products === null;

  return (
    <Sheet title={W.product.title} onClose={onClose}>
      {error ? (
        <Failed error={error} onRetry={() => setNonce((n) => n + 1)} />
      ) : loading ? (
        <SkelLines n={5} short />
      ) : (
        <Body
          current={current ?? null}
          products={products!}
          canWrite={canWrite}
          onChanged={() => setNonce((n) => n + 1)}
        />
      )}
    </Sheet>
  );
}

function Body({
  current,
  products,
  canWrite,
  onChanged,
}: {
  current: TimelineEntry | null;
  products: ProductOption[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const currentOption = current ? products.find((p) => p.productId === current.productId) : undefined;
  const limits = limitsLabel(currentOption);

  return (
    <>
      {current ? (
        <>
          <div className="big">{current.productLabel}</div>
          <dl className="kv" style={{ marginTop: 18 }}>
            {/* The value is a range ("1,960 ± 40 g"), so it cannot be
                labelled with the bare word Target. */}
            <dt>{W.product.targetAndLimits}</dt>
            <dd>{limits ?? '—'}</dd>
            {currentOption?.color && (
              <>
                <dt>{W.product.colour}</dt>
                <dd>{currentOption.color}</dd>
              </>
            )}
            <dt>{W.product.since}</dt>
            <dd>{fmtDayLong(current.effectiveFrom)}</dd>
            <dt>{W.product.setBy}</dt>
            <dd>{current.changedBy ?? '—'}</dd>
          </dl>
          {currentOption?.activeFlag === false && (
            <p className="acc sm" style={{ marginTop: 10 }}>{W.product.inactive}</p>
          )}
        </>
      ) : (
        <p className="mut" style={{ marginTop: 12 }}>{W.product.none}</p>
      )}

      <p className="mut sm" style={{ marginTop: 14 }}>{W.product.notSentToMachine}</p>

      {canWrite && <ChangeForm products={products} currentId={current?.productId ?? null} onChanged={onChanged} />}

      {/* The PDAS products themselves — the write path (§5). Shown to anyone
          who could act on the line-wide product; the buttons appear only when
          the server has the path enabled AND the account is a manager. */}
      {canWrite && <PdasProducts products={products} onChanged={onChanged} />}

      {/* The SMS-local limits editor — the SAME component (not a copy)
          Setup › Rules renders, un-collapsed there and here on purpose: it
          decides its own visibility exactly once, so the two cannot drift.
          Never gated on `canWrite` above (that prop is this sheet's own
          rank>=2 threshold for the PDAS-facing controls above; the local
          editor asks the server for ITS OWN write status, a different rank
          gate that does not depend on PDAS_WRITE_ENABLED) — visible to every
          signed-in account, same as the rest of this sheet; only the edit
          control inside it is conditional. */}
      <ProductLimitsBlock />

      <Details summary={W.product.history}>
        <History />
      </Details>
    </>
  );
}

function ChangeForm({
  products,
  currentId,
  onChanged,
}: {
  products: ProductOption[];
  currentId: number | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn" style={{ marginTop: 18 }} onClick={() => setOpen(true)}>
        {W.product.change}
      </button>
    );
  }

  const chosen = typeof productId === 'number' ? products.find((p) => p.productId === productId) : undefined;
  const preview = chosen ? limitsLabel(chosen) : null;

  return (
    <form
      style={{ marginTop: 18, display: 'grid', gap: 10 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (typeof productId !== 'number') return;
        setBusy(true);
        setFailed(false);
        try {
          await setCurrentProduct(productId, reason.trim() || undefined);
          setOpen(false);
          setReason('');
          setProductId('');
          onChanged();
        } catch {
          setFailed(true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>{W.product.change}</span>
        <select
          value={productId}
          autoFocus
          onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">—</option>
          {products.map((p) => (
            <option key={p.productId} value={p.productId} disabled={p.productId === currentId}>
              {label(p)}
              {p.color ? ` — ${p.color}` : ''}
              {p.activeFlag === false ? ' (inactive in product master)' : ''}
            </option>
          ))}
        </select>
      </label>
      {preview && <p className="mut sm">{W.product.previewLimits(preview)}</p>}
      {chosen?.activeFlag === false && <p className="acc sm">{W.product.inactive}</p>}
      <label className="field">
        <span>{W.product.reason}</span>
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {failed && <p className="acc sm">{W.couldNotLoad}</p>}
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy || typeof productId !== 'number'}>
          {W.product.confirm}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>{W.product.cancel}</button>
      </div>
    </form>
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

function PdasProducts({ products, onChanged }: { products: ProductOption[]; onChanged: () => void }) {
  const [status, setStatus] = useState<ProductWriteStatus | null>(null);
  const [mode, setMode] = useState<{ kind: 'limits'; id: number } | { kind: 'active'; id: number; active: boolean } | { kind: 'create' } | null>(null);

  useEffect(() => {
    getProductWriteStatus().then(setStatus).catch(() => setStatus({ enabled: false, reason: 'status unavailable', canWrite: false, local: { canWrite: false } }));
  }, []);

  const active = products.filter((p) => p.activeFlag !== false);
  const retired = products.filter((p) => p.activeFlag === false);

  return (
    <Details summary={W.product.pdasTitle}>
      <p className="mut sm">{W.product.pdasNote}</p>
      {status && !status.canWrite && (
        <p className="mut sm" style={{ marginTop: 8 }}>
          {status.enabled ? W.product.writeNeedsRank : W.product.writeUnavailable(status.reason ?? '—')}
        </p>
      )}
      <table style={{ marginTop: 10 }}>
        <tbody>
          {[...active, ...retired].map((p) => {
            const f = fieldsOf(p);
            return (
              <tr key={p.productId} className={p.activeFlag === false ? 'mut' : ''}>
                <td>{label(p)}{p.activeFlag === false ? ` · ${W.product.retired}` : ''}</td>
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
    </Details>
  );
}

/** Action A — in place; keeps the MaterialId. */
function LimitsForm({ product, onDone, onCancel }: { product: ProductOption; onDone: () => void; onCancel: () => void }) {
  const before = fieldsOf(product)!;
  const [sp, setSp] = useState(String(before.setpointG));
  const [om, setOm] = useState(String(before.offsetMinusG));
  const [op, setOp] = useState(String(before.offsetPlusG));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const after: ProductFields = { ...before, setpointG: Number(sp), offsetMinusG: Number(om), offsetPlusG: Number(op) };
  const valid = Number.isFinite(after.setpointG) && Number.isFinite(after.offsetMinusG) && Number.isFinite(after.offsetPlusG);

  return (
    <form
      style={{ marginTop: 14 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (reason.trim().length < 10) { setErr(W.product.reasonTooShort); return; }
        setBusy(true); setErr(null);
        try { await updateProductLimits(product.productId, before, after, reason.trim()); onDone(); }
        catch (x) { setErr(errText(x)); } finally { setBusy(false); }
      }}
    >
      <div className="big" style={{ fontSize: '1.1em' }}>
        {W.product.changeLimitsHeading(label(product), product.blend ?? '—', product.countText ?? '—', product.tubeType ?? '—', product.productId)}
      </div>
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
      <button type="submit" className="btn" disabled={busy || !valid}>{W.product.changeLimitsConfirm}</button>{' '}
      <button type="button" className="btn" onClick={onCancel}>{W.product.cancel}</button>
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
      <div className="big" style={{ fontSize: '1.1em' }}>{W.product.newProduct}</div>
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

function History() {
  const [rows, setRows] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Finding H14's exact defect, which the first draft of this file
  // reintroduced: swallowing the failure into an empty list made a failed
  // fetch render "No product has been recorded for this line yet." — the
  // changeover log asserting itself empty because it could not be read.
  const load = () => {
    setError(null);
    getProductTimeline()
      .then((r) => setRows(r.timeline))
      .catch((e) => setError(String((e as Error).message ?? e)));
  };
  useEffect(load, []);
  if (error) return <Failed error={error} onRetry={load} />;
  if (!rows) return <SkelLines n={3} short />;
  if (rows.length === 0) return <p className="mut sm">{W.product.none}</p>;
  return (
    <table>
      <tbody>
        {rows.slice(0, 20).map((r) => (
          <tr key={r.timelineId}>
            <td style={{ width: '10em' }}>{fmtDayLong(r.effectiveFrom)}</td>
            <td>
              {r.productLabel}
              {r.changedBy && <span className="mut"> · {r.changedBy}</span>}
              {r.reason && <span className="mut"> — {r.reason}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
