/**
 * Products > Limits & History (task E10). TRACE A1-027, A1-031, A1-035, A1-072, A1-073, A1-090, A2-031, A2-033,
 * A2-037, A2-063..A2-065, A3-078, A3-079, A4-09, A4-11, B3-02, B5-11, B5-12, B5-13, G-12 (one tab, decision E-2).
 *
 * What this screen answers: what limits judge this product's readings, how do I change them, and who changed what?
 *
 *  - TWO DESTINATIONS, ONE CHOICE. SMS saves a new limit version (rank 2, independent of the PDAS flag, gated on the
 *    server's `local.canWrite`). PDAS changes the product itself through the guarded single-row update; SMS records it
 *    as a version too. While PDAS writes are off the PDAS choice is disabled and the server's own reason is printed.
 *  - TWO STEPS. Edit, then Review (before and after, destination, reason), then one separate confirming click. One
 *    click never writes. A change over the guard needs a tick and a 20-character reason; otherwise 10 characters.
 *  - NO OPTIMISTIC UI. "Saved" is drawn only from the server's 200 body. A refusal is printed as the server sent it
 *    and the form stays on Review.
 *  - TIME-VERSIONED. A reading is judged by the limits in force when it was weighed; a new version never rewrites an
 *    earlier one. The versions table says so and keeps every start time.
 *  - RETIRE-AND-RECREATE IS NOT AN EDIT, and the screen says where to edit instead.
 *  - HISTORY LIVES HERE: the PDAS action trail with an outcome filter. A row with outcome "disabled" is labelled as an
 *    attempt that never reached PDAS.
 *  - ONE AUDIENCE: reading is open to every rank; the editor is absent below the engineer rank.
 *  - EVERY FETCH HAS ITS OWN FAILURE STATE that names the part.
 */
import { C, FRAGMENTS, withFragments } from '../../../copy';
import { useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  getProductChanges,
  getProductLimitHistory,
  getProductTimeline,
  getProducts,
  setLocalLimitVersion,
  updateProductLimits,
  type LimitHistoryProduct,
  type LimitHistoryVersion,
  type ProductChangeEntry,
  type ProductOption,
  type TimelineEntry,
} from '../../../bridge/api';
import { fmt, pdasWords, productLabel } from '../../../bridge/lib';
import { useData } from '../../../data';
import { ENGINEER_RANK } from '../../../ranks';
import { DataTable, type Column } from '../../../ui/DataTable';
import { ErrorState } from '../../../ui/ErrorState';
import { NumberField, ReasonField, SelectField } from '../../../ui/Field';
import { Icon } from '../../../ui/Icon';
import { Segmented } from '../../../ui/Segmented';
import { Skeleton } from '../../../ui/Skeleton';
import { Wizard } from '../../../ui/Wizard';
import type { ScreenProps } from '../../registry';
import { usePdasWriteStatus } from '../PdasStatusCard';
import { ProductsTabs } from '../ProductsTabs';
import { LARGE_REASON_MIN, REASON_MIN, boundsOf, type GuardBounds, fieldsOf, guardOf, limitsLabel, outcomeKind, rangeOf, versionLabel, type OutcomeKind } from './model';
import './limits.css';
const LM = withFragments(C.limits, FRAGMENTS.limits);

const errText = (e: unknown): string => String((e as { message?: string } | null)?.message ?? e);
const STEPS = [
  { id: 'edit', label: LM.steps.edit },
  { id: 'review', label: LM.steps.review },
  { id: 'saved', label: LM.steps.saved },
];
const intKey = (v: string | undefined): number | null => (v !== undefined && /^\d{1,9}$/.test(v) ? Number(v) : null);
const num = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

export function ProductsLimitsScreen(props: ScreenProps) {
  return (
    <>
      <ProductsTabs route={props.route} go={props.go} />
      <LimitsBody {...props} />
    </>
  );
}

/** Same screen under the legacy `history` tab key: History lives in Limits & History (decision E-2). */
export const ProductsHistoryScreen = ProductsLimitsScreen;

type Dest = 'sms' | 'pdas';
interface Saved { dest: Dest; text: string; pdasLabel: string | null; newLabel: string }

function LimitsBody({ route, rank, go }: ScreenProps) {
  const history = useData('the limit versions', getProductLimitHistory, 'lm:history', { live: false });
  const catalogue = useData('the product list', getProducts, 'lm:products', { live: false });
  const status = usePdasWriteStatus();

  const [picked, setPicked] = useState<number | null>(intKey(route.keys.pr));
  const histProducts = history.data?.products ?? [];
  const labels = useMemo(() => {
    const parts = new Map((catalogue.data?.products ?? []).map((p) => [p.productId, p]));
    return productLabel.distinctProductLabels(histProducts.map((p) => {
      const c = parts.get(p.productId);
      return { productId: p.productId, description: p.label, color: c?.color ?? null, blend: c?.blend ?? null, countText: c?.countText ?? null, tubeType: c?.tubeType ?? null };
    }));
  }, [histProducts, catalogue.data]);
  const selectedId = picked !== null && histProducts.some((p) => p.productId === picked) ? picked : (histProducts[0]?.productId ?? null);
  const selected: LimitHistoryProduct | null = histProducts.find((p) => p.productId === selectedId) ?? null;
  const mirror: ProductOption | null = catalogue.data?.products.find((p) => p.productId === selectedId) ?? null;

  const choose = (id: number) => {
    setPicked(id);
    go({ ...route, keys: { ...route.keys, pr: String(id) } }, { replace: true });
  };

  const refreshAll = () => {
    history.refresh();
    catalogue.refresh();
    status.refresh();
  };
  const [actionsNonce, setActionsNonce] = useState(0);

  const pdasOff = status.data ? !status.data.enabled : null;

  return (
    <div className="lm">
      <header className="lm-head">
        <div>
          <h1 className="lm-h1">{LM.title}</h1>
          <p className="lm-sub">{LM.sentence}</p>
          <p className="lm-note">{LM.caption}</p>
        </div>
        {pdasOff !== null && (
          <span className="pill state" data-state={pdasOff ? 'watch' : 'ok'}>{pdasOff ? LM.pdasOff : LM.pdasOn}</span>
        )}
      </header>

      <div className="lm-grid">
        <section className="lm-card" aria-labelledby="lm-editor">
          <h2 id="lm-editor" className="lm-h2">{LM.editorTitle}</h2>
          {history.status === 'error' && <ErrorState part={LM.loadingHistory} cause={history.error} onRetry={history.refresh} />}
          {history.status === 'loading' && <Skeleton part={LM.loadingHistory} lines={5} onRetry={history.refresh} />}
          {history.data && histProducts.length === 0 && <p className="lm-note">{LM.noProducts}</p>}
          {history.data && selected && (
            <>
              <SelectField
                label={LM.product}
                value={String(selected.productId)}
                onChange={(v) => choose(Number(v))}
                options={histProducts.map((p) => ({ value: String(p.productId), label: `${labels.get(p.productId) ?? p.label}, id ${p.productId}` }))}
              />
              <InForce product={selected} />
              {rank >= ENGINEER_RANK && (
                <Editor
                  key={selected.productId}
                  product={selected}
                  mirror={mirror}
                  statusState={status}
                  onSaved={() => { refreshAll(); setActionsNonce((n) => n + 1); }}
                />
              )}
            </>
          )}
          {catalogue.status === 'error' && <ErrorState part={LM.loadingProducts} cause={catalogue.error} onRetry={catalogue.refresh} />}
        </section>

        <section className="lm-card" aria-labelledby="lm-versions">
          <h2 id="lm-versions" className="lm-h2">{LM.versionsTitle}</h2>
          {selected && <p className="lm-note">{labels.get(selected.productId) ?? selected.label}</p>}
          {selected && <Versions product={selected} />}
          <details className="lm-disc">
            <summary>{LM.retireTitle}</summary>
            <p className="lm-note">{LM.retireBody}</p>
          </details>
        </section>
      </div>

      <ActionHistory nonce={actionsNonce} />
      <Timeline />
    </div>
  );
}

/* ------------------------------------------------------------- in force */

function InForce({ product }: { product: LimitHistoryProduct }) {
  const v = product.versions[0];
  if (!v || v.setpointG == null || v.offsetMinusG == null || v.offsetPlusG == null) return <p className="lm-note">{LM.noLimits}</p>;
  const r = rangeOf(v.setpointG, v.offsetMinusG, v.offsetPlusG);
  const when = `${fmt.fmtDay(v.effectiveFromPlant)} ${fmt.fmtClock(v.effectiveFromPlant)}`;
  return (
    <div className="lm-now">
      <span className="lm-cap">{LM.inForceNow}</span>
      <span className="lm-big">{versionLabel(v)}</span>
      <span className="lm-note">{LM.accepts(r.lo, r.hi)} {v.effectiveIsLowerBound ? LM.sinceBound(when) : LM.since(when)}</span>
    </div>
  );
}

/* --------------------------------------------------------------- editor */

type StatusState = ReturnType<typeof usePdasWriteStatus>;

function Editor({ product, mirror, statusState, onSaved }: {
  product: LimitHistoryProduct; mirror: ProductOption | null; statusState: StatusState; onSaved: () => void;
}) {
  const latest = product.versions[0];
  const initial = () => ({
    sp: latest?.setpointG != null ? String(latest.setpointG) : mirror?.setpointG != null ? String(mirror.setpointG) : '',
    om: latest?.offsetMinusG != null ? String(Math.abs(latest.offsetMinusG)) : '',
    op: latest?.offsetPlusG != null ? String(Math.abs(latest.offsetPlusG)) : '',
  });
  const [vals, setVals] = useState(initial);
  const [reason, setReason] = useState('');
  const [destPick, setDestPick] = useState<Dest | null>(null);
  const [tick, setTick] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ status: number; message: string } | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  const st = statusState.data;
  const localOk = st?.local?.canWrite === true;
  const before = fieldsOf(mirror);
  const pdasEnabled = st?.enabled === true && st.canWrite === true && before !== null;
  const dest: Dest | null = destPick ?? (localOk ? 'sms' : pdasEnabled ? 'pdas' : null);

  const sp = num(vals.sp), om = num(vals.om), op = num(vals.op);
  const numbersOk = sp !== null && sp > 0 && om !== null && om > 0 && op !== null && op > 0;
  const after = numbersOk ? { setpointG: sp!, offsetMinusG: om!, offsetPlusG: op! } : null;
  const cur = latest && latest.setpointG != null && latest.offsetMinusG != null && latest.offsetPlusG != null
    ? { setpointG: latest.setpointG, offsetMinusG: Math.abs(latest.offsetMinusG), offsetPlusG: Math.abs(latest.offsetPlusG) } : null;
  const changed = after !== null && (cur === null || after.setpointG !== cur.setpointG || after.offsetMinusG !== cur.offsetMinusG || after.offsetPlusG !== cur.offsetPlusG);
  const bounds = boundsOf(st?.limits);
  const guard = before && after ? guardOf(before, after, bounds) : null;
  const large = dest === 'pdas' && guard !== null && guard.large;
  const need = large ? LARGE_REASON_MIN : REASON_MIN;
  const reasonOk = reason.trim().length >= need;

  const editBlock = !numbersOk ? LM.needsNumbers : !changed ? LM.needsChange : dest === null ? LM.needsDestination : !reasonOk ? LM.needsReason(need) : null;
  const reviewBlock = large && !tick ? LM.needsTick : null;
  const afterLabel = after ? limitsLabel(after.setpointG, after.offsetMinusG, after.offsetPlusG) : '';

  const save = async () => {
    if (!after || dest === null) return;
    setBusy(true);
    setFailure(null);
    try {
      if (dest === 'sms') {
        const r = await setLocalLimitVersion({ productId: product.productId, ...after, reason: reason.trim() });
        setSaved({ dest, text: LM.savedSms(r.versionId), pdasLabel: null, newLabel: r.label ?? afterLabel });
      } else {
        const r = await updateProductLimits(product.productId, before!, { ...before!, ...after }, reason.trim(), large && tick);
        const o = r.observedAfter;
        setSaved({ dest, text: LM.savedPdas, pdasLabel: limitsLabel(o.setpointG, o.offsetMinusG, o.offsetPlusG), newLabel: limitsLabel(o.setpointG, o.offsetMinusG, o.offsetPlusG) });
      }
      setStep(2);
      onSaved();
    } catch (e) {
      setFailure({ status: e instanceof ApiError ? e.status : 0, message: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const onStep = (i: number) => {
    if (i === 2 && step === 1) { void save(); return; }
    if (step === 2) {
      setVals(initial());
      setReason('');
      setTick(false);
      setSaved(null);
      setFailure(null);
      setStep(0);
      return;
    }
    setFailure(null);
    setStep(i);
  };

  const pdasReason = st && !st.enabled ? (pdasWords.pdasReasonForDisplay(st.reason) ?? LM.pdasOff) : null;

  return (
    <div className="lm-edit">
      {statusState.status === 'error' && <ErrorState part={LM.loadingStatus} cause={statusState.error} onRetry={statusState.refresh} />}
      <Wizard
        steps={STEPS}
        current={step}
        onStep={onStep}
        nextBlockedReason={busy ? LM.saving : step === 0 ? editBlock : step === 1 ? reviewBlock : null}
        nextLabel={step === 0 ? LM.reviewNext : dest === 'pdas' ? LM.confirmPdas : LM.confirmSms}
        finalAction={<button type="button" className="wr-btn" onClick={() => onStep(0)}>{LM.changeAgain}</button>}
      >
        {step === 0 && (
          <div className="lm-form">
            <div className="lm-row">
              <NumberField label={LM.target} unit="g" value={vals.sp} onChange={(sp2) => setVals({ ...vals, sp: sp2 })} min={0} step={1} />
              <NumberField label={LM.below} unit="g" value={vals.om} onChange={(om2) => setVals({ ...vals, om: om2 })} min={0} step={1} />
              <NumberField label={LM.above} unit="g" value={vals.op} onChange={(op2) => setVals({ ...vals, op: op2 })} min={0} step={1} />
            </div>

            <Guard guard={guard} known={before !== null} bounds={bounds} fromServer={st?.limits != null} />

            <fieldset className="lm-dest">
              <legend>{LM.where}</legend>
              <label className={`lm-dest__row${localOk ? '' : ' lm-dest__row--off'}`}>
                <input type="radio" name={`dest-${product.productId}`} checked={dest === 'sms'} disabled={!localOk} onChange={() => setDestPick('sms')} />
                <span><strong>{LM.destSms}</strong><small>{localOk ? LM.destSmsNote : LM.smsUnavailable}</small></span>
              </label>
              <label className={`lm-dest__row${pdasEnabled ? '' : ' lm-dest__row--off'}`}>
                <input type="radio" name={`dest-${product.productId}`} checked={dest === 'pdas'} disabled={!pdasEnabled} onChange={() => setDestPick('pdas')} />
                <span>
                  <strong>{LM.destPdas}</strong>
                  <small>{LM.destPdasNote}</small>
                  {pdasReason !== null && (
                    <small className="lm-lock"><Icon name="lock" size={16} /> <span className="lm-verbatim">{pdasReason}</span></small>
                  )}
                  {pdasReason === null && st?.enabled && before === null && <small>{LM.pdasNoValues}</small>}
                </span>
              </label>
            </fieldset>

            <ReasonField label={LM.reason} hint={large ? LM.largeReason : LM.reasonHint} value={reason} onChange={setReason} minLength={need} />
          </div>
        )}

        {step === 1 && after && (
          <div className="lm-review">
            <div className="lm-ba">
              <div className="lm-ba__box">
                <span className="lm-cap">{LM.before}</span>
                <span className="lm-big">{cur ? limitsLabel(cur.setpointG, cur.offsetMinusG, cur.offsetPlusG) : '—'}</span>
                {cur && <span className="lm-note">{LM.range(rangeOf(cur.setpointG, cur.offsetMinusG, cur.offsetPlusG).lo, rangeOf(cur.setpointG, cur.offsetMinusG, cur.offsetPlusG).hi)}</span>}
              </div>
              <span className="lm-ba__arrow" aria-hidden="true">to</span>
              <div className="lm-ba__box lm-ba__box--new">
                <span className="lm-cap">{LM.after}</span>
                <span className="lm-big">{afterLabel}</span>
                <span className="lm-note">{LM.range(rangeOf(after.setpointG, after.offsetMinusG, after.offsetPlusG).lo, rangeOf(after.setpointG, after.offsetMinusG, after.offsetPlusG).hi)}</span>
              </div>
            </div>
            <p className="lm-line"><span className="lm-cap">{LM.where}</span>{dest === 'pdas' ? LM.destPdas : LM.destSms}</p>
            <p className="lm-line"><span className="lm-cap">{LM.reason}</span>{reason.trim()}</p>
            {large && (
              <div className="lm-large state" data-state="watch">
                <p className="lm-large__t">{LM.largeTitle}</p>
                {guard && <p className="lm-note">{LM.guardDetail(guard.pct.toFixed(1), String(guard.maxOffsetG))}</p>}
                <label className="lm-tick">
                  <input type="checkbox" checked={tick} onChange={(e) => setTick(e.target.checked)} />
                  <span>{LM.largeTick}</span>
                </label>
              </div>
            )}
            <p className="lm-note">{LM.noReach}</p>
            {failure && (
              <div className="lm-fail state" data-state="act" role="alert">
                <p className="lm-fail__t"><Icon name="info" size={16} /> {failure.status === 0 || (failure.status >= 500 && failure.status !== 503) ? LM.saveUnconfirmed : LM.saveFailed}</p>
                <p className="lm-verbatim">{failure.message}</p>
              </div>
            )}
          </div>
        )}

        {step === 2 && saved && (
          <div className="lm-done state" data-state="ok" role="status">
            <p className="lm-done__t"><Icon name="check" size={16} /> {saved.text}</p>
            {saved.pdasLabel && <p className="lm-note">{LM.pdasNow(saved.pdasLabel)}</p>}
            <p className="lm-note">{LM.laterReadings(saved.newLabel)}</p>
          </div>
        )}
      </Wizard>
    </div>
  );
}

function Guard({ guard, known, bounds, fromServer }: { guard: ReturnType<typeof guardOf> | null; known: boolean; bounds: GuardBounds; fromServer: boolean }) {
  if (!known) return <p className="lm-note">{LM.guardUnknown}</p>;
  const state = guard === null || !guard.changed ? 'nodata' : guard.large ? 'watch' : 'ok';
  const word = guard === null || !guard.changed ? LM.guardNone : guard.large ? LM.guardOutside : LM.guardWithin;
  return (
    <div className="lm-guard state" data-state={state}>
      <span className="pill state" data-state={state}>{word}</span>
      <div>
        {guard && guard.changed && <p className="lm-verbatim">{LM.guardDetail(guard.pct.toFixed(1), String(guard.maxOffsetG))}</p>}
        <p className="lm-note">{(fromServer ? LM.guardNote : LM.guardNoteFallback)(String(bounds.maxSetpointChangePct), String(bounds.maxOffsetChangeG))}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- versions */

function Versions({ product }: { product: LimitHistoryProduct }) {
  const cols: Column<LimitHistoryVersion>[] = [
    { key: 'limits', header: LM.colLimits, render: (v) => <strong>{versionLabel(v)}</strong> },
    {
      key: 'from', header: LM.colFrom,
      render: (v) => <>{v.effectiveIsLowerBound && <span className="lm-note">{LM.noBound} </span>}{fmt.fmtDay(v.effectiveFromPlant)} {fmt.fmtClock(v.effectiveFromPlant)}</>,
    },
    { key: 'source', header: LM.colSource, render: (v) => LM.sources[v.source] ?? v.source },
    { key: 'by', header: LM.colBy, render: (v) => v.changedBy ?? '—' },
    { key: 'reason', header: LM.colReason, render: (v) => v.reason ?? '—' },
  ];
  return (
    <>
      <DataTable
        columns={cols}
        rows={product.versions}
        rowKey={(v) => String(v.versionId)}
        caption={LM.versionsTitle}
        empty={<p className="lm-note">{LM.noVersions}</p>}
      />
      <p className="lm-note">{product.versions.length === 1 ? `${LM.oneVersion} ` : ''}{LM.versionsNote}</p>
    </>
  );
}

/* -------------------------------------------------------- action history */

const PAGE = 40;
type Filter = 'all' | OutcomeKind;

function ActionHistory({ nonce }: { nonce: number }) {
  const first = useData('the PDAS action history', () => getProductChanges(null, PAGE), `lm:changes:${nonce}`, { live: false });
  const [older, setOlder] = useState<ProductChangeEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null | undefined>(undefined);
  const [olderErr, setOlderErr] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => { setOlder([]); setNextBefore(undefined); setOlderErr(null); }, [nonce]);

  const cursor = nextBefore === undefined ? (first.data?.nextBefore ?? null) : nextBefore;
  const rows = [...(first.data?.entries ?? []), ...older];
  const shown = filter === 'all' ? rows : rows.filter((c) => outcomeKind(c) === filter);

  const loadMore = async () => {
    if (cursor === null) return;
    setLoadingMore(true);
    setOlderErr(null);
    try {
      const r = await getProductChanges(cursor, PAGE);
      setOlder((o) => [...o, ...r.entries]);
      setNextBefore(r.nextBefore);
    } catch (e) {
      setOlderErr(errText(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const pill = (k: OutcomeKind) => (
    <span className="pill state" data-state={k === 'done' ? 'ok' : k === 'refused' ? 'act' : 'nodata'}>
      {k === 'done' ? LM.done : k === 'refused' ? LM.refused : LM.notSent}
    </span>
  );
  const cols: Column<ProductChangeEntry>[] = [
    { key: 'when', header: LM.colWhen, render: (c) => fmt.fmtAppInstant(c.changedAtUtc) },
    { key: 'who', header: LM.colWho, render: (c) => c.changedByName ?? '—' },
    {
      key: 'action', header: LM.colAction,
      render: (c) => (
        <>
          <strong>{c.procName ?? c.operation}</strong>
          {c.productId != null && <small className="lm-sub2">{LM.productN(c.productId)}</small>}
          {c.palletId != null && <small className="lm-sub2">{LM.palletN(c.palletId)}</small>}
          {c.effectiveFromUtc && <small className="lm-sub2">{LM.effective(fmt.fmtAppInstant(c.effectiveFromUtc))}</small>}
        </>
      ),
    },
    {
      key: 'outcome', header: LM.colOutcome,
      render: (c) => <>{pill(outcomeKind(c))}{outcomeKind(c) === 'notSent' && <small className="lm-sub2">{LM.neverReached}</small>}</>,
    },
    {
      key: 'message', header: LM.colMessage,
      render: (c) => (
        <>
          {c.reason && <span>{c.reason}</span>}
          {c.message && <small className="lm-sub2 lm-verbatim">{pdasWords.pdasReasonForDisplay(c.message)}{c.pdasErrorCode != null ? ` (${c.pdasErrorCode})` : ''}</small>}
          {!c.reason && !c.message && '—'}
        </>
      ),
    },
  ];
  const filters = [
    { id: 'all', label: LM.fAll }, { id: 'done', label: LM.fDone }, { id: 'refused', label: LM.fRefused }, { id: 'notSent', label: LM.fNotSent },
  ] as const;

  return (
    <section className="lm-card" aria-labelledby="lm-actions">
      <div className="lm-actions__head">
        <h2 id="lm-actions" className="lm-h2">{LM.actionsTitle}</h2>
        <Segmented label={LM.filterLabel} options={filters} value={filter} onChange={(f) => setFilter(f as Filter)} />
      </div>
      {first.status === 'error' && <ErrorState part={LM.loadingActions} cause={first.error} onRetry={first.refresh} />}
      {first.status === 'loading' && <Skeleton part={LM.loadingActions} lines={4} onRetry={first.refresh} />}
      {first.data && (
        <DataTable
          columns={cols}
          rows={shown}
          rowKey={(c) => String(c.changeId)}
          caption={LM.actionsTitle}
          empty={<p className="lm-note">{rows.length === 0 ? LM.noActions : LM.noActionsFilter}</p>}
          hasMore={cursor !== null}
          onLoadMore={() => void loadMore()}
          loadingMore={loadingMore}
        />
      )}
      {olderErr && <ErrorState part={LM.olderPart} cause={olderErr} onRetry={() => void loadMore()} />}
    </section>
  );
}

/* ------------------------------------------------------------- timeline */

function Timeline() {
  const t = useData('the running-product record', getProductTimeline, 'lm:timeline', { live: false });
  const rows: TimelineEntry[] = [...(t.data?.timeline ?? [])].sort((a, b) => (b.changedAt ?? '').localeCompare(a.changedAt ?? ''));
  const cols: Column<TimelineEntry>[] = [
    { key: 'from', header: LM.colFrom, render: (r) => (r.effectiveFrom == null ? '—' : fmt.fmtAppInstant(r.effectiveFrom)) },
    { key: 'product', header: LM.colProduct, render: (r) => r.productLabel },
    { key: 'by', header: LM.colBy, render: (r) => r.changedBy ?? '—' },
    { key: 'reason', header: LM.colReason, render: (r) => r.reason ?? '—' },
  ];
  return (
    <section className="lm-card" aria-labelledby="lm-timeline">
      <h2 id="lm-timeline" className="lm-h2">{LM.timelineTitle}</h2>
      {t.status === 'error' && <ErrorState part={LM.loadingTimeline} cause={t.error} onRetry={t.refresh} />}
      {t.status === 'loading' && <Skeleton part={LM.loadingTimeline} lines={3} onRetry={t.refresh} />}
      {t.data && (
        <DataTable columns={cols} rows={rows} rowKey={(r) => String(r.timelineId)} caption={LM.timelineTitle} empty={<p className="lm-note">{LM.noTimeline}</p>} />
      )}
    </section>
  );
}
