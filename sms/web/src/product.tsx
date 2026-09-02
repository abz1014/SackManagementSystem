/**
 * Current-product bar and its two helpers, moved out of App.tsx so the floor
 * "Now" screen can show (and, for supervisors, change) the running product
 * without importing the 7,000-line analysis module. Behaviour unchanged.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  getProducts,
  getCurrentProduct,
  setCurrentProduct,
  type ProductOption,
  type TimelineEntry,
} from './api';

export function productLabel(p: ProductOption): string {
  const base = p.description || p.lotCode || `Product ${p.productId}`;
  const wt = p.setpointG ? ` · ${p.setpointG}g` : '';
  return `${base}${wt} · #${p.productId}`;
}

export function ProductDetailLine({ p }: { p: ProductOption }) {
  const parts: string[] = [];
  if (p.blend) parts.push(`Blend ${p.blend}`);
  if (p.countText) parts.push(`Count ${p.countText}`);
  if (p.tubeType) parts.push(`Tube ${p.tubeType}${p.tubeWeightG != null ? ` (${p.tubeWeightG}g)` : ''}`);
  if (p.setpointG != null && (p.weightOffsetMinusG != null || p.weightOffsetPlusG != null)) {
    parts.push(`Tolerance ${p.setpointG}g −${p.weightOffsetMinusG ?? 0}/+${p.weightOffsetPlusG ?? 0}g`);
  }
  if (!parts.length && p.activeFlag !== false) return null;
  return (
    <span className="cp-detail">
      {parts.join(' · ')}
      {p.activeFlag === false && (
        <span className="cp-inactive-warn"> ⚠ marked inactive in PDAS</span>
      )}
    </span>
  );
}

export function CurrentProductBar({
  rank,
  onOpenTimeline,
  onProductChanged,
}: {
  rank: number;
  onOpenTimeline: () => void;
  onProductChanged: () => void;
}) {
  const [current, setCurrent] = useState<TimelineEntry | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [sel, setSel] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [justChanged, setJustChanged] = useState<ProductOption | null>(null);
  const canSet = rank >= 2; // supervisor+

  const load = () => {
    getCurrentProduct().then((r) => setCurrent(r.current)).catch(() => {});
  };
  useEffect(() => {
    load();
    getProducts().then((r) => setProducts(r.products)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!justChanged) return;
    const t = setTimeout(() => setJustChanged(null), 5000);
    return () => clearTimeout(t);
  }, [justChanged]);

  const sortedProducts = useMemo(
    () =>
      [...products].sort(
        (a, b) =>
          (a.description ?? '').localeCompare(b.description ?? '') ||
          (a.setpointG ?? 0) - (b.setpointG ?? 0) ||
          a.productId - b.productId,
      ),
    [products],
  );

  const currentDetail = current ? products.find((p) => p.productId === current.productId) ?? null : null;
  const selectedProduct = sel === '' ? null : products.find((p) => p.productId === Number(sel)) ?? null;

  const apply = async () => {
    if (sel === '') return;
    setSaving(true);
    try {
      const chosen = products.find((p) => p.productId === Number(sel)) ?? null;
      const r = await setCurrentProduct(Number(sel));
      setCurrent(r.current);
      setSel('');
      setJustChanged(chosen);
      onProductChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cpbar">
      <div className="cp-info">
        <span className="lab">Current product</span>
        {current ? (
          <>
            <span className="val">
              {current.productLabel} <span className="cp-id">#{current.productId}</span>
            </span>
            <span className="meta">
              since {new Date(current.effectiveFrom).toLocaleString()} · set by {current.changedBy ?? '—'}
            </span>
            {currentDetail && <ProductDetailLine p={currentDetail} />}
          </>
        ) : (
          <span className="val none">Not set — production is unattributed (Q1)</span>
        )}
        {justChanged && (
          <span className="cp-confirm">✓ Changed to {productLabel(justChanged)}</span>
        )}
        <button type="button" className="rr-link cp-history-link" onClick={onOpenTimeline}>
          View history →
        </button>
      </div>
      {canSet && (
        <div className="cp-set">
          <div className="cp-set-row">
            <select value={sel} onChange={(e) => setSel(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">Change product…</option>
              {sortedProducts.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {productLabel(p)}
                </option>
              ))}
            </select>
            <button disabled={sel === '' || saving} onClick={apply}>
              {saving ? 'setting…' : 'Set'}
            </button>
          </div>
          {selectedProduct && <ProductDetailLine p={selectedProduct} />}
        </div>
      )}
    </div>
  );
}
