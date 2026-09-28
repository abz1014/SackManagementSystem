/**
 * Product › Changeover — IFL's own key requirement (Hassan sb, 15 Sep 2026):
 * "put machine N onto product X for this shift." Replaces Brief 1's stub
 * (UX Phase 6 Brief 2, 16 Sep 2026).
 *
 * THREE STEPS, ONE PAGE. Pickers (from `GET /api/changeover/refs`) build a
 * request; "Check the plan" sends it to `POST /api/changeover/plan` (rank 1,
 * never opens the PDAS writer pool — it works today, flag on or off) and
 * renders the response whole: ordered steps, blockers, warnings, the limits
 * label, the no-rollback statement and the operator note, all printed
 * VERBATIM from the server, never reworded. Execute (`POST
 * /api/changeover/execute`, rank 2) is always rendered as a button; it is
 * only ever enabled when the plan says writes are on, has no blockers, and
 * this account is rank >= 2 — otherwise it stays visibly present and
 * disabled, with the server's own `disabledReason` on screen beside the one
 * static line Brief 1 wrote for this (`W.product.changeover.executionDisabled`).
 * FIX A (28 Sep 2026): `disabledReason` is a `.env`-reading sentence
 * (`PDAS_WRITE_ENABLED is not true.` and three siblings — `api/src/config.ts`'s
 * `resolvePdasWrite`), not writer for this screen. It is now passed through
 * `lib/pdasWords.ts`'s `pdasReasonForDisplay()` before it renders, which
 * substitutes plain words for the four known reasons and passes an
 * unrecognised one through unchanged — still no hardcoded sentence invented
 * client-side for a case this list does not know.
 *
 * NO OPTIMISTIC UI. A 200/207 response body is the only thing that may ever
 * say a write happened — there is no local "pretend" state and no toast
 * celebrating completion. A refusal (503 `DISABLED` — the normal, current state; 409
 * `BLOCKED` — the flag is on but the plan itself has a blocker) surfaces as
 * a thrown `ApiError`; its `status` distinguishes the two, its `message` is
 * the server's own `error` text — also run through `pdasReasonForDisplay()`
 * before it renders, same reason as above.
 *
 * TUBE TYPE OFFERS A NEW NAME TOO, LIKE BLEND AND COUNT (changed 21 Sep
 * 2026 — see CLAUDE.md's dated section of the same date). Until then this
 * screen restricted the tube-type picker to existing entries only, because
 * `AddTubeType`'s OUTPUT parameter name was unverified against the vendor.
 * That gap closed on 21 Sep 2026: a Windows-authenticated (`sqlcmd -E`,
 * read-only) query of `sys.procedures`/`sys.parameters` on
 * `PDAS_TP1U2_SEP07` read the procedure's signature directly — no
 * `GRANT VIEW DEFINITION` needed, contrary to what project rule 17
 * previously required waiting on — and confirmed `typeTypeId` as the
 * OUTPUT id name `pdasWrite.ts` already bound. With the reason for the
 * restriction gone, the picker now offers the same two paths Blend and
 * Count already did: pick an existing tube type by id, or type a new name
 * plus the weight and form `AddTubeType` also requires. **This does not
 * change execute's gating**: `api/src/routes/changeover.ts`'s body schema
 * already accepted the `{ name, tubeWeightG, tubeForm? }` shape and
 * `services/changeover.ts` already called `PdasWriter.addTubeType` for it
 * — both existed, unreachable from this screen, since roadmap Wave F.
 * Execute is still `requireRole(PDAS_WRITE_RANK)` and still `503 DISABLED`
 * while `PDAS_WRITE_ENABLED=false`, exactly as it already gated
 * `AddBlend`/`AddCount`; a new tube type is no more dangerous to plan than
 * a new blend or count, and confirming the signature only means this app
 * CAN call the procedure correctly if execute is ever turned on — not that
 * IFL has authorised it (that authority is still only given for
 * `CreateMaterial` / `SetMaterialStatusActive`, per CLAUDE.md, 11 Sep 2026).
 *
 * PACK SCHEMA HAS NO PICKER, DELIBERATELY, NOT AS A GAP: the SOP
 * (`services/changeover.ts` header) says PackSchemaId is always 1, and
 * `words.ts` has no "pack schema" or "pallet" label anywhere to caption a
 * picker with — also searched, also not present. Defaulting silently to the
 * first schema the mirror reports (or 1) matches the SOP and avoids
 * inventing a field label; if IFL ever uses more than one schema this needs
 * both a picker AND the missing string, not one without the other.
 */
import { useEffect, useMemo, useState } from 'react';
import { W } from '../../lib/words';
import { Block, Failed, SkelLines } from '../../ui/bits';
import { fmtG, fmtInt } from '../../lib/fmt';
import { pdasReasonForDisplay } from '../../lib/pdasWords';
import {
  ApiError,
  getChangeoverRefs,
  getProducts,
  planChangeover,
  executeChangeover,
  type ChangeoverRefs,
  type ChangeoverRequestBody,
  type ChangeoverRefChoice,
  type ChangeoverTubeChoice,
  type ChangeoverPlan,
  type ChangeoverPlanStep,
  type ChangeoverOutcome,
  type ProductOption,
} from '../../api';
import { distinctProductLabels, productLabel } from '../../lib/productLabel';

const MIN_REASON_CHARS = 10;

function errText(e: unknown): string {
  return String((e as { message?: string })?.message ?? e);
}

/** Every plan step's `detail` is a flat record of primitives — rendered generically so a new field the server adds shows up without a code change here. */
function detailLine(detail: Record<string, string | number | boolean | null>): string {
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${k}: ${v === true ? 'yes' : String(v)}`)
    .join(' · ');
}

/* --------------------------------------------------------------- the form */

interface RefOrNew {
  mode: 'ref' | 'new';
  id: number | '';
  name: string;
}
const emptyRefOrNew = (): RefOrNew => ({ mode: 'ref', id: '', name: '' });

function choiceOf(r: RefOrNew): ChangeoverRefChoice | null {
  if (r.mode === 'ref') return r.id === '' ? null : { id: r.id };
  const name = r.name.trim();
  return name.length === 0 ? null : { name };
}

/* Tube type needs the same ref-or-new shape as blend/count, plus the two
   extra fields `AddTubeType` requires for a new entry (weight and form) —
   see the file header on why this is now offered at all. */
interface TubeRefOrNew {
  mode: 'ref' | 'new';
  id: number | '';
  name: string;
  tubeWeightG: string;
  tubeForm: '1' | '2';
}
const emptyTubeRefOrNew = (): TubeRefOrNew => ({ mode: 'ref', id: '', name: '', tubeWeightG: '', tubeForm: '2' });

function tubeChoiceOf(r: TubeRefOrNew): ChangeoverTubeChoice | null {
  if (r.mode === 'ref') return r.id === '' ? null : { id: r.id };
  const name = r.name.trim();
  const tubeWeightG = Number(r.tubeWeightG);
  if (name.length === 0 || !Number.isFinite(tubeWeightG) || tubeWeightG <= 0) return null;
  return { name, tubeWeightG, tubeForm: r.tubeForm === '1' ? 1 : 2 };
}

export function ChangeoverTab({ canWrite }: { canWrite: boolean }) {
  const [refs, setRefs] = useState<ChangeoverRefs | null>(null);
  const [products, setProducts] = useState<ProductOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setLoadError(null);
    Promise.all([getChangeoverRefs(), getProducts()])
      .then(([r, p]) => {
        setRefs(r);
        setProducts(p.products);
      })
      .catch((e) => setLoadError(errText(e)));
  }, [nonce]);

  // The form's own fields, kept above the plan/execute so re-checking after
  // an edit is just clicking `dryRun` again.
  const [blend, setBlend] = useState<RefOrNew>(emptyRefOrNew());
  const [count, setCount] = useState<RefOrNew>(emptyRefOrNew());
  const [tube, setTube] = useState<TubeRefOrNew>(emptyTubeRefOrNew());
  const [setpointG, setSetpointG] = useState('1960');
  const [offsetMinusG, setOffsetMinusG] = useState('30');
  const [offsetPlusG, setOffsetPlusG] = useState('30');
  const [lot, setLot] = useState('');
  const [ppColour, setPpColour] = useState('');
  const [sackColour, setSackColour] = useState('');
  const [retireProductIds, setRetireProductIds] = useState<number[]>([]);
  const [retirePalletIds, setRetirePalletIds] = useState<number[]>([]);
  const [reason, setReason] = useState('');

  const [plan, setPlan] = useState<ChangeoverPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  // Silent default, not a gap: the SOP (services/changeover.ts header) says
  // PackSchemaId is always 1, and words.ts has no "pack schema" caption to
  // put a picker behind — see the file header. Falls back to the mirror's
  // first reported schema, or literal 1 to match the SOP if the mirror has
  // none at all.
  const packSchemaId = refs?.packSchemas[0]?.packSchemaId ?? 1;

  const buildBody = (): ChangeoverRequestBody | null => {
    const b = choiceOf(blend);
    const c = choiceOf(count);
    const t = tubeChoiceOf(tube);
    if (!b || !c || !t) return null;
    return {
      blend: b,
      count: c,
      tubeType: t,
      material: {
        setpointG: Number(setpointG),
        offsetMinusG: Number(offsetMinusG),
        offsetPlusG: Number(offsetPlusG),
        lot,
        ppColour: ppColour.trim() || null,
      },
      pallet: {
        packSchemaId,
        // Left unset: the server defaults the pallet's lot to the material's own (services/changeover.ts:309).
        lot: null,
        sackColour: sackColour.trim() || null,
      },
      retire: { productIds: retireProductIds, palletIds: retirePalletIds },
      reason,
    };
  };

  const checkPlan = async () => {
    const body = buildBody();
    if (!body) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      const p = await planChangeover(body);
      setPlan(p);
    } catch (e) {
      setPlanError(errText(e));
      setPlan(null);
    } finally {
      setPlanBusy(false);
    }
  };

  const canSubmitPlan = choiceOf(blend) !== null && choiceOf(count) !== null && tubeChoiceOf(tube) !== null;

  return (
    <>
      <Block label={W.product.tabs.changeover}>
        {loadError ? (
          <Failed error={loadError} onRetry={() => setNonce((n) => n + 1)} />
        ) : !refs || !products ? (
          <SkelLines n={6} short />
        ) : (
          <PickersForm
            refs={refs}
            products={products}
            blend={blend}
            setBlend={setBlend}
            count={count}
            setCount={setCount}
            tube={tube}
            setTube={setTube}
            setpointG={setpointG}
            setSetpointG={setSetpointG}
            offsetMinusG={offsetMinusG}
            setOffsetMinusG={setOffsetMinusG}
            offsetPlusG={offsetPlusG}
            setOffsetPlusG={setOffsetPlusG}
            lot={lot}
            setLot={setLot}
            ppColour={ppColour}
            setPpColour={setPpColour}
            sackColour={sackColour}
            setSackColour={setSackColour}
            retireProductIds={retireProductIds}
            setRetireProductIds={setRetireProductIds}
            retirePalletIds={retirePalletIds}
            setRetirePalletIds={setRetirePalletIds}
            reason={reason}
            setReason={setReason}
          />
        )}
        {refs && products && (
          <div style={{ marginTop: 14 }}>
            <button type="button" className="btn" disabled={planBusy || !canSubmitPlan} onClick={checkPlan}>
              {W.product.changeover.dryRun}
            </button>
            {/* FIX 2 (28 Sep 2026): the button used to go disabled with no
                visible reason when blend/count/tube were left unpicked — e.g.
                a tester who only ticked a pallet-retire box and filled in the
                reason. A plan always needs all three (services/changeover.ts
                has no retire-only request shape), so say so instead of
                staying silent. */}
            {!canSubmitPlan && !planBusy && (
              <p className="mut sm" style={{ marginTop: 8 }}>{W.product.changeover.needsFullSelection}</p>
            )}
            {planError && <p className="acc sm" style={{ marginTop: 8 }}>{planError}</p>}
          </div>
        )}
      </Block>

      {plan ? (
        <PlanReview plan={plan} canWrite={canWrite} buildBody={buildBody} />
      ) : (
        !planBusy && (
          <Block>
            <p className="mut">{W.product.changeover.noneYet}</p>
          </Block>
        )
      )}
    </>
  );
}

/* ------------------------------------------------------------- the pickers */

function RefPicker({
  fieldLabel,
  value,
  onChange,
  options,
}: {
  fieldLabel: string;
  value: RefOrNew;
  onChange: (v: RefOrNew) => void;
  options: { id: number; name: string }[];
}) {
  return (
    <label className="field">
      <span>{fieldLabel}</span>
      {value.mode === 'ref' ? (
        <span className="row">
          <select
            value={value.id}
            onChange={(e) => onChange({ ...value, id: e.target.value === '' ? '' : Number(e.target.value) })}
          >
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <button type="button" className="linkish sm" onClick={() => onChange({ mode: 'new', id: '', name: '' })}>
            {W.config.add}
          </button>
        </span>
      ) : (
        <span className="row">
          <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder={fieldLabel} />
          <button type="button" className="linkish sm" onClick={() => onChange({ mode: 'ref', id: '', name: '' })}>
            {W.product.cancel}
          </button>
        </span>
      )}
    </label>
  );
}

/* Same ref-or-new shape as RefPicker, but a new tube type needs two more
   fields than a new blend or count does (AddTubeType has no "name only"
   INSERT) — see the file header on why this is offered at all. */
function TubePicker({
  value,
  onChange,
  options,
}: {
  value: TubeRefOrNew;
  onChange: (v: TubeRefOrNew) => void;
  // tubeForm added (migration 041): AddTubeType's own duplicate check is
  // name AND form together, so the picker shows which form each existing
  // tube type already is — null = the reference mirror has not yet recorded it.
  options: { id: number; name: string; tubeWeightG: number | null; tubeForm: number | null }[];
}) {
  return (
    <label className="field">
      <span>{W.product.tubeType}</span>
      {value.mode === 'ref' ? (
        <span className="row">
          <select
            value={value.id}
            onChange={(e) => onChange({ ...value, id: e.target.value === '' ? '' : Number(e.target.value) })}
          >
            <option value="">—</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}{o.tubeWeightG != null ? ` (${fmtG(o.tubeWeightG)})` : ''}
                {o.tubeForm != null ? ` · form ${o.tubeForm}` : ` · ${W.product.changeover.tubeFormUnknown}`}
              </option>
            ))}
          </select>
          <button type="button" className="linkish sm" onClick={() => onChange({ ...emptyTubeRefOrNew(), mode: 'new' })}>
            {W.config.add}
          </button>
        </span>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          <span className="row">
            <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder={W.product.tubeType} />
            <button type="button" className="linkish sm" onClick={() => onChange({ ...emptyTubeRefOrNew(), mode: 'ref' })}>
              {W.product.cancel}
            </button>
          </span>
          <span className="row">
            <label className="field sm"><span>{W.product.changeover.tubeWeightG}</span>
              <input type="number" step="0.1" min="0" value={value.tubeWeightG} onChange={(e) => onChange({ ...value, tubeWeightG: e.target.value })} />
            </label>
            <label className="field sm"><span>{W.product.changeover.tubeForm}</span>
              <select value={value.tubeForm} onChange={(e) => onChange({ ...value, tubeForm: e.target.value === '1' ? '1' : '2' })}>
                <option value="2">2</option>
                <option value="1">1</option>
              </select>
            </label>
          </span>
          <span className="mut sm">{W.product.changeover.tubeNewNote}</span>
        </div>
      )}
    </label>
  );
}

function PickersForm({
  refs,
  products,
  blend,
  setBlend,
  count,
  setCount,
  tube,
  setTube,
  setpointG,
  setSetpointG,
  offsetMinusG,
  setOffsetMinusG,
  offsetPlusG,
  setOffsetPlusG,
  lot,
  setLot,
  ppColour,
  setPpColour,
  sackColour,
  setSackColour,
  retireProductIds,
  setRetireProductIds,
  retirePalletIds,
  setRetirePalletIds,
  reason,
  setReason,
}: {
  refs: ChangeoverRefs;
  products: ProductOption[];
  blend: RefOrNew;
  setBlend: (v: RefOrNew) => void;
  count: RefOrNew;
  setCount: (v: RefOrNew) => void;
  tube: TubeRefOrNew;
  setTube: (v: TubeRefOrNew) => void;
  setpointG: string;
  setSetpointG: (v: string) => void;
  offsetMinusG: string;
  setOffsetMinusG: (v: string) => void;
  offsetPlusG: string;
  setOffsetPlusG: (v: string) => void;
  lot: string;
  setLot: (v: string) => void;
  ppColour: string;
  setPpColour: (v: string) => void;
  sackColour: string;
  setSackColour: (v: string) => void;
  retireProductIds: number[];
  setRetireProductIds: (v: number[]) => void;
  retirePalletIds: number[];
  setRetirePalletIds: (v: number[]) => void;
  reason: string;
  setReason: (v: string) => void;
}) {
  // The disambiguator over the FULL product list, not just the retire
  // filter's subset — a collision can involve an inactive product too.
  const retireLabels = useMemo(() => distinctProductLabels(products), [products]);
  const toggle = (list: number[], id: number, on: (v: number[]) => void) =>
    on(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <RefPicker fieldLabel={W.product.blend} value={blend} onChange={setBlend} options={refs.blends} />
      <RefPicker fieldLabel={W.product.count} value={count} onChange={setCount} options={refs.counts} />

      <TubePicker value={tube} onChange={setTube} options={refs.tubeTypes} />

      <label className="field"><span>{W.product.setpointG}</span>
        <input type="number" step="1" value={setpointG} onChange={(e) => setSetpointG(e.target.value)} />
      </label>
      <label className="field"><span>{W.product.offsetMinusG}</span>
        <input type="number" step="1" min="0" value={offsetMinusG} onChange={(e) => setOffsetMinusG(e.target.value)} />
      </label>
      <label className="field"><span>{W.product.offsetPlusG}</span>
        <input type="number" step="1" min="0" value={offsetPlusG} onChange={(e) => setOffsetPlusG(e.target.value)} />
      </label>
      <label className="field"><span>{W.product.desc1}</span>
        <input value={lot} onChange={(e) => setLot(e.target.value)} />
      </label>
      <label className="field"><span>{W.product.ppColour}</span>
        <input value={ppColour} onChange={(e) => setPpColour(e.target.value)} />
      </label>

      <label className="field"><span>{W.product.sackColour}</span>
        <input value={sackColour} onChange={(e) => setSackColour(e.target.value)} />
      </label>

      {(products.filter((p) => p.activeFlag !== false).length > 0 || refs.pallets.length > 0) && (
        <div className="field">
          <span>{W.product.retire}</span>
          <div style={{ display: 'grid', gap: 4 }}>
            {/* Six PDAS materials on this line share the description
                "205-IL0-SD" (productLabel.ts's own header, first found on
                Rejects 15 Sep 2026, recurring here); the plain label alone
                made all six retire checkboxes read identically. Run through
                the one disambiguator instead of the raw `description`. */}
            {products.filter((p) => p.activeFlag !== false).map((p) => (
              <label key={`product-${p.productId}`} className="row">
                <input
                  type="checkbox"
                  checked={retireProductIds.includes(p.productId)}
                  onChange={() => toggle(retireProductIds, p.productId, setRetireProductIds)}
                />
                <span>{retireLabels.get(p.productId) ?? productLabel(p)} ({p.productId})</span>
              </label>
            ))}
            {refs.pallets.map((pl) => {
              // A pallet's own `lot` field IS the product's label at PDAS
              // (Pallets.MatDesc, mirrored as `lot`) — printing it after the
              // product label duplicated the same text twice on every one
              // of the six pallets (e.g. "205-IL0-SD · 205-IL0-SD (id)").
              // `sackColour` (PalletDesc1) is the pallet's own genuinely
              // distinguishing attribute; the lot is shown only when it
              // actually differs from the raw product description, and the
              // pallet id is always appended as the guaranteed-unique
              // fallback.
              const productPart = retireLabels.get(pl.productId) ?? pl.productLabel ?? `product ${pl.productId}`;
              const lotPart = pl.lot && pl.lot !== pl.productLabel ? pl.lot : null;
              return (
                <label key={`pallet-${pl.palletId}`} className="row">
                  <input
                    type="checkbox"
                    checked={retirePalletIds.includes(pl.palletId)}
                    onChange={() => toggle(retirePalletIds, pl.palletId, setRetirePalletIds)}
                  />
                  <span>
                    {productPart}
                    {pl.sackColour ? ` · ${pl.sackColour}` : ''}
                    {lotPart ? ` · ${lotPart}` : ''} ({pl.palletId})
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      <label className="field">
        <span>{W.product.whyRequired}</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
        {reason.trim().length < MIN_REASON_CHARS && <span className="mut sm">{W.product.reasonTooShort}</span>}
      </label>
    </div>
  );
}

/* --------------------------------------------------------------- the plan */

function StepRow({ step }: { step: ChangeoverPlanStep }) {
  const d = detailLine(step.detail);
  return (
    <tr>
      <td className="mut" style={{ width: '10em' }}>{step.step}</td>
      <td>
        {step.label}
        {step.proc && <span className="mut sm"> · {step.proc}</span>}
        {d && <div className="mut sm">{d}</div>}
      </td>
      <td className="mut sm">{step.action}</td>
    </tr>
  );
}

export function PlanReview({
  plan,
  canWrite,
  buildBody,
}: {
  plan: ChangeoverPlan;
  canWrite: boolean;
  buildBody: () => ChangeoverRequestBody | null;
}) {
  const [busy, setBusy] = useState(false);
  const [execError, setExecError] = useState<{ status: number; message: string } | null>(null);
  const [outcome, setOutcome] = useState<ChangeoverOutcome | null>(null);

  // RT24-13 remainder (25 Sep 2026): `blockers` is required on the wire
  // type (ChangeoverPlan) but was read with a bare `.length` — a
  // malformed/partial plan response missing it used to crash this whole
  // block instead of refusing to execute. blockers gates a real PDAS
  // write, so "could not read whether there are blockers" must resolve to
  // "cannot execute", the same direction as an actual blocker, never to
  // "0 blockers" by accident of `undefined.length` never being reached.
  const blockersUnknown = plan.blockers == null;
  const canExecute = plan.writesEnabled && !blockersUnknown && plan.blockers.length === 0 && canWrite;

  const onExecute = async () => {
    const body = buildBody();
    if (!body) return;
    setBusy(true);
    setExecError(null);
    setOutcome(null);
    try {
      const o = await executeChangeover(body);
      setOutcome(o);
    } catch (e) {
      if (e instanceof ApiError) {
        setExecError({ status: e.status, message: e.message });
      } else {
        setExecError({ status: 0, message: errText(e) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Block label={W.product.changeover.planTitle}>
      <table>
        <tbody>
          {plan.steps.map((s, i) => (
            <StepRow key={i} step={s} />
          ))}
        </tbody>
      </table>

      <dl className="kv" style={{ marginTop: 14 }}>
        <dt>{W.product.targetAndLimits}</dt>
        <dd>{plan.limits.label}</dd>
      </dl>

      {blockersUnknown && (
        <p className="acc sm" style={{ marginTop: 14 }}>{W.product.changeover.blockersUnknown}</p>
      )}

      {!blockersUnknown && plan.blockers.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontWeight: 500 }}>{W.product.changeover.blockers}</p>
          <p className="mut sm">{W.product.changeover.blockersNote}</p>
          <ul>
            {plan.blockers.map((b, i) => (
              <li key={i} className="acc sm">{b}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.warnings != null && plan.warnings.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontWeight: 500 }}>{W.product.changeover.warnings}</p>
          <p className="mut sm">{W.product.changeover.warningsNote}</p>
          <ul>
            {plan.warnings.map((w, i) => (
              <li key={i} className="mut sm">{w}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mut sm" style={{ marginTop: 14 }}>{plan.noRollback}</p>
      <p className="mut sm" style={{ marginTop: 8 }}>{plan.operatorNote}</p>

      {!plan.writesEnabled && (
        <div style={{ marginTop: 14 }}>
          <p className="mut sm">{W.product.changeover.executionDisabled}</p>
          {plan.disabledReason && <p className="mut sm">{pdasReasonForDisplay(plan.disabledReason)}</p>}
        </div>
      )}
      {plan.writesEnabled && !canWrite && (
        <p className="mut sm" style={{ marginTop: 14 }}>{W.product.writeNeedsRank}</p>
      )}

      <div style={{ marginTop: 14 }}>
        <button type="button" className="btn primary" disabled={!canExecute || busy} onClick={onExecute}>
          {W.product.changeover.execute}
        </button>
      </div>

      {execError && (
        <p className={execError.status === 409 ? 'acc sm' : 'mut sm'} style={{ marginTop: 10 }}>
          {pdasReasonForDisplay(execError.message)}
        </p>
      )}

      {outcome && <OutcomeView outcome={outcome} />}
    </Block>
  );
}

/* ------------------------------------------------------------ the outcome */

/**
 * Only ever rendered from a 200/207 response body (`PlanReview`'s `outcome`
 * state is set nowhere else) — the one thing allowed to say a write reached
 * PDAS.
 */
function OutcomeView({ outcome }: { outcome: ChangeoverOutcome }) {
  return (
    <div style={{ marginTop: 18 }}>
      <p style={{ fontWeight: 500 }}>
        {outcome.ok ? W.product.historyTrail.outcome.applied : W.product.historyTrail.outcome.failed}
      </p>
      {outcome.materialId != null && (
        <p className="mut sm">{W.product.title}: {fmtInt(outcome.materialId)}{outcome.palletId != null ? ` · pallet ${fmtInt(outcome.palletId)}` : ''}</p>
      )}
      {outcome.done.length > 0 && (
        <table style={{ marginTop: 8 }}>
          <tbody>
            {outcome.done.map((s, i) => (
              <tr key={i}>
                <td className="mut" style={{ width: '10em' }}>{s.step}</td>
                <td>{s.label}</td>
                <td className="n">{fmtInt(s.resultId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {outcome.failed && (
        <p className="acc sm" style={{ marginTop: 8 }}>
          {outcome.failed.step}: {outcome.failed.error.message}
        </p>
      )}
      {outcome.notDone.length > 0 && (
        <ul style={{ marginTop: 8 }}>
          {outcome.notDone.map((s, i) => (
            <li key={i} className="mut sm">{s.step} — {s.label}</li>
          ))}
        </ul>
      )}
      <p className="mut sm" style={{ marginTop: 8 }}>{outcome.noRollback}</p>
    </div>
  );
}
