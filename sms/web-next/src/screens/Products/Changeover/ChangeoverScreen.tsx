/**
 * Products > Changeover (task E10). TRACE A1-087..A1-089, A2-060..A2-062, A3-076, A4-05, A4-06, B3-04,
 * B5-10, B5-11, A6-L08 (the legacy ?s=product&pt=changeover link lands here).
 *
 * What this screen answers: how do I add a product to PDAS and retire the old one, and what exactly will happen?
 *
 *  - PLAN, REVIEW, EXECUTE. Plan builds a request; moving to Review asks the server for a dry run
 *    (`POST /api/changeover/plan`, rank 1, never opens the PDAS writer pool, so it works with writes off).
 *    Only the last step writes, and only from the Execute control.
 *  - THE SERVER SPEAKS, THE SCREEN PRINTS. Steps, blockers, warnings, the no-rollback sentence, the operator
 *    note, the disabled reason and every error message are shown as the server sent them: no rewording, no case
 *    change, no wrapping text around them (guards.test rule 4).
 *  - NO OPTIMISTIC UI. A result is drawn only from a 200 or 207 body, exactly as returned: done, failed, not done.
 *    A 503 or 409 is a refusal and is said to be one. There is no local "pretend" state and no success toast.
 *  - RETIRE-AND-RECREATE IS NOT AN EDIT. PDAS refuses a second product for the same blend, count and tube type,
 *    retired or not (-7001). When the server's blocker names that product, the screen links to Limits for it.
 *  - A CHANGEOVER DOES NOT REACH THE STATIONS. The operator picks the material at the station panel.
 *  - ONE AUDIENCE: every rank can plan and review; the Execute control is ABSENT below the engineer rank
 *    (a lock sentence stands in its place) and DISABLED, with the server's reason, while writes are off.
 */
import { useState } from 'react';
import {
  ApiError,
  executeChangeover,
  getChangeoverRefs,
  getProducts,
  planChangeover,
  type ChangeoverOutcome,
  type ChangeoverPlan,
  type ChangeoverRefs,
  type ChangeoverRequestBody,
  type ProductOption,
} from '../../../bridge/api';
import { pdasWords, productLabel } from '../../../bridge/lib';
import { useData, type DataState } from '../../../data';
import { ENGINEER_RANK } from '../../../ranks';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { ErrorState } from '../../../ui/ErrorState';
import { NumberField, ReasonField, SelectField } from '../../../ui/Field';
import { Icon } from '../../../ui/Icon';
import { hrefFor, plainClick } from '../../../ui/nav';
import { Segmented } from '../../../ui/Segmented';
import { Skeleton } from '../../../ui/Skeleton';
import { Wizard } from '../../../ui/Wizard';
import { WriteGate } from '../../../ui/WriteGate';
import type { ScreenProps } from '../../registry';
import { PdasStatusCard, usePdasWriteStatus } from '../PdasStatusCard';
import { ProductsTabs } from '../ProductsTabs';
import {
  REASON_MIN,
  buildBody,
  detailLine,
  emptyForm,
  limitsTargetOf,
  missingFor,
  type ChangeoverForm,
  type RefForm,
} from './model';
import { CO } from './strings';
import './changeover.css';

const errText = (e: unknown): string => String((e as { message?: string } | null)?.message ?? e);
const STEPS = [
  { id: 'plan', label: CO.steps.plan },
  { id: 'review', label: CO.steps.review },
  { id: 'execute', label: CO.steps.execute },
];

export function ProductsChangeoverScreen(props: ScreenProps) {
  return (
    <>
      <ProductsTabs route={props.route} go={props.go} />
      <ChangeoverBody {...props} />
    </>
  );
}

interface Planned { body: ChangeoverRequestBody; plan: ChangeoverPlan }
type Products = { products: ProductOption[] };

function ChangeoverBody({ rank, go }: ScreenProps) {
  const refs = useData('the lists to pick from', getChangeoverRefs, 'co:refs', { live: false });
  const products = useData('the products to retire', getProducts, 'co:products', { live: false });
  const pdas = usePdasWriteStatus();

  const [form, setFormState] = useState<ChangeoverForm>(emptyForm);
  const [step, setStep] = useState(0);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planned, setPlanned] = useState<Planned | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ status: number; message: string } | null>(null);
  const [outcome, setOutcome] = useState<ChangeoverOutcome | null>(null);

  const setForm = (patch: Partial<ChangeoverForm>) => {
    setFormState((f) => ({ ...f, ...patch }));
    // Any edit makes the checked plan stale: it can no longer be what Execute sends.
    setPlanned(null);
  };

  const packSchemaId = refs.data?.packSchemas[0]?.packSchemaId ?? 1;
  const missing = missingFor(form);

  const checkPlan = async () => {
    const body = buildBody(form, packSchemaId);
    if (!body) return;
    setPlanning(true);
    setPlanError(null);
    setOutcome(null);
    setRefusal(null);
    try {
      const plan = await planChangeover(body);
      setPlanned({ body, plan });
      setStep(1);
    } catch (e) {
      setPlanned(null);
      setPlanError(errText(e));
    } finally {
      setPlanning(false);
    }
  };

  const onStep = (i: number) => {
    if (i === 1 && step === 0) void checkPlan();
    else setStep(i);
  };

  const run = async () => {
    if (!planned) return;
    setConfirming(false);
    setBusy(true);
    setRefusal(null);
    setOutcome(null);
    try {
      setOutcome(await executeChangeover(planned.body));
    } catch (e) {
      setRefusal({ status: e instanceof ApiError ? e.status : 0, message: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  const plan = planned?.plan ?? null;
  const blocked = plan !== null && (plan.blockers == null || plan.blockers.length > 0);
  const nextBlocked = planning ? CO.checking : step === 0 ? missing : step === 1 ? (blocked ? CO.nextBlocked : null) : null;

  return (
    <div className="co">
      <header>
        <h1 className="co-h1">{CO.title}</h1>
        <p className="co-sub">{CO.sentence}</p>
        <p className="co-note">{CO.caption}</p>
      </header>

      {step === 0 && <PdasStatusCard status={pdas} />}

      <Wizard
        steps={STEPS}
        current={step}
        onStep={onStep}
        nextBlockedReason={nextBlocked}
        nextLabel={step === 0 ? CO.checkPlan : undefined}
        finalAction={plan ? (
          <ExecuteControl rank={rank} plan={plan} blocked={blocked} busy={busy} done={outcome !== null} onAsk={() => setConfirming(true)} />
        ) : null}
      >
        {step === 0 && <PlanStep form={form} setForm={setForm} refs={refs} products={products} />}
        {step === 0 && planError && (
          <div className="co-fail state" data-state="act" role="alert">
            <p className="co-fail__t"><Icon name="info" size={16} /> {CO.planFailed}</p>
            <p className="co-verbatim">{planError}</p>
            <p className="co-note">{CO.planFailedFix}</p>
          </div>
        )}
        {step === 1 && plan && <ReviewStep plan={plan} go={go} />}
        {step === 2 && plan && <ExecuteStep rank={rank} plan={plan} refusal={refusal} outcome={outcome} busy={busy} />}
      </Wizard>

      {plan && (
        <ConfirmDialog
          open={confirming}
          title={CO.confirmTitle(plan.steps.length)}
          confirmLabel={CO.confirm}
          busy={busy}
          onConfirm={() => void run()}
          onCancel={() => setConfirming(false)}
        >
          <p>{CO.confirmBody}</p>
          <p>{plan.noRollback}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Plan */

function TextField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const id = `co-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="wr-field">
      <label className="wr-field__label" htmlFor={id}>{label}</label>
      <input id={id} className="wr-input" type="text" value={value} onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined} />
      {hint && <div id={`${id}-hint`} className="wr-field__hint">{hint}</div>}
    </div>
  );
}

const MODES = [
  { id: 'existing', label: CO.useExisting },
  { id: 'new', label: CO.addNew },
] as const;

function RefField({ what, value, onChange, options }: { what: string; value: RefForm; onChange: (v: RefForm) => void; options: { id: number; name: string }[] }) {
  return (
    <div className="co-ref">
      <Segmented label={`${what}, existing or new`} options={MODES} value={value.mode} onChange={(m) => onChange({ ...value, mode: m === 'new' ? 'new' : 'existing' })} />
      {value.mode === 'existing' ? (
        <SelectField label={what} value={value.id} placeholder={CO.pickOne} onChange={(id) => onChange({ ...value, id })}
          options={options.map((o) => ({ value: String(o.id), label: o.name }))} />
      ) : (
        <TextField label={CO.newName(what.toLowerCase())} value={value.name} onChange={(name) => onChange({ ...value, name })} />
      )}
    </div>
  );
}

function PlanStep({ form, setForm, refs, products }: {
  form: ChangeoverForm;
  setForm: (p: Partial<ChangeoverForm>) => void;
  refs: DataState<ChangeoverRefs>;
  products: DataState<Products>;
}) {
  const r = refs.data;
  const productList: ProductOption[] = products.data?.products ?? [];
  const labels = productLabel.distinctProductLabels(productList);
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const tube = form.tube;
  const active = productList.filter((p) => p.activeFlag !== false);
  const pallets = r?.pallets ?? [];

  return (
    <div className="co-form">
      {refs.status === 'error' && <ErrorState part={CO.loadingLists} cause={refs.error} onRetry={refs.refresh} />}
      {refs.status === 'loading' && <Skeleton part={CO.loadingLists} lines={4} onRetry={refs.refresh} />}
      {r && (
        <>
          <div className="co-row">
            <RefField what="Blend" value={form.blend} onChange={(blend) => setForm({ blend })} options={r.blends} />
            <RefField what="Count" value={form.count} onChange={(count) => setForm({ count })} options={r.counts} />
          </div>

          <div className="co-ref">
            <Segmented label={`${CO.tube}, existing or new`} options={MODES} value={tube.mode}
              onChange={(m) => setForm({ tube: { ...tube, mode: m === 'new' ? 'new' : 'existing' } })} />
            {tube.mode === 'existing' ? (
              <SelectField label={CO.tube} value={tube.id} placeholder={CO.pickOne} onChange={(id) => setForm({ tube: { ...tube, id } })}
                options={r.tubeTypes.map((t) => ({
                  value: String(t.id),
                  label: CO.tubeOption(t.name, t.tubeWeightG, t.tubeForm),
                }))} />
            ) : (
              <div className="co-row">
                <TextField label={CO.newName('tube')} value={tube.name} onChange={(name) => setForm({ tube: { ...tube, name } })} />
                <SelectField label={CO.tubeForm} value={tube.form} onChange={(f) => setForm({ tube: { ...tube, form: f === '1' ? '1' : '2' } })}
                  options={[{ value: '2', label: CO.tubeFormOption(2) }, { value: '1', label: CO.tubeFormOption(1) }]} />
                <NumberField label={CO.tubeWeight} unit="g" value={tube.weight} onChange={(weight) => setForm({ tube: { ...tube, weight } })} min={0} step={0.1} />
              </div>
            )}
            {tube.mode === 'new' && <p className="co-note">{CO.tubeNewNote}</p>}
          </div>
        </>
      )}

      <div className="co-row">
        <NumberField label={CO.setpoint} unit="g" value={form.setpoint} onChange={(setpoint) => setForm({ setpoint })} min={0} step={1} />
        <NumberField label={CO.below} unit="g" value={form.below} onChange={(below) => setForm({ below })} min={0} step={1} />
        <NumberField label={CO.above} unit="g" value={form.above} onChange={(above) => setForm({ above })} min={0} step={1} />
      </div>
      <div className="co-row">
        <TextField label={CO.productName} value={form.productName} onChange={(productName) => setForm({ productName })} hint={CO.productNameHint} />
        <TextField label={CO.colour} value={form.colour} onChange={(colour) => setForm({ colour })} />
        <TextField label={CO.sackColour} value={form.sackColour} onChange={(sackColour) => setForm({ sackColour })} />
      </div>
      <p className="co-note">{CO.palletNote}</p>

      <fieldset className="co-retire">
        <legend>{CO.retireTitle}</legend>
        <p className="co-note">{CO.retireNote}</p>
        {products.status === 'error' && <ErrorState part={CO.loadingProducts} cause={products.error} onRetry={products.refresh} />}
        {products.status === 'loading' && <Skeleton part={CO.loadingProducts} lines={2} onRetry={products.refresh} />}
        {(products.status === 'ok' || products.status === 'empty') && active.length === 0 && pallets.length === 0 && (
          <p className="co-note">{CO.retireNone}</p>
        )}
        {(active.length > 0 || pallets.length > 0) && (
          <ul className="co-checks">
            {active.map((p) => (
              <li key={`p${p.productId}`}>
                <label>
                  <input type="checkbox" checked={form.retireProducts.includes(p.productId)}
                    onChange={() => setForm({ retireProducts: toggle(form.retireProducts, p.productId) })} />
                  <span>{CO.retireProduct(labels.get(p.productId) ?? productLabel.productLabel(p), p.productId)}</span>
                </label>
              </li>
            ))}
            {pallets.map((pl) => (
              <li key={`l${pl.palletId}`}>
                <label>
                  <input type="checkbox" checked={form.retirePallets.includes(pl.palletId)}
                    onChange={() => setForm({ retirePallets: toggle(form.retirePallets, pl.palletId) })} />
                  <span>{CO.retirePallet(`${labels.get(pl.productId) ?? pl.productLabel ?? `Product ${pl.productId}`}${pl.sackColour ? `, ${pl.sackColour}` : ''}`, pl.palletId)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <ReasonField label={CO.reason} hint={CO.reasonHint} value={form.reason} onChange={(reason) => setForm({ reason })} minLength={REASON_MIN} />
      <p className="co-note">{CO.planAddsNote}</p>
    </div>
  );
}

/* --------------------------------------------------------------- Review */

function ReviewStep({ plan, go }: { plan: ChangeoverPlan; go: ScreenProps['go'] }) {
  const blockersUnknown = plan.blockers == null;
  const blockers = plan.blockers ?? [];
  const warnings = plan.warnings ?? [];
  const open = blockersUnknown || blockers.length > 0;
  return (
    <div className="co-review">
      <div className="co-review__head">
        <h2 className="co-h2">{CO.steps.review}</h2>
        <span className="pill state" data-state={open ? 'act' : 'ok'}>{open ? CO.blockedPill : CO.ready}</span>
      </div>
      <p className="co-note">{CO.reviewIntro}</p>
      <ol className="co-plan" aria-label={CO.stepsLabel}>
        {plan.steps.map((s, i) => {
          const d = detailLine(s.detail);
          return (
            <li key={i}>
              <span className="co-plan__no" aria-hidden="true">{i + 1}</span>
              <div>
                <div className="co-plan__t">{s.label}</div>
                {(s.proc || d) && <div className="co-plan__d">{[s.proc, d].filter(Boolean).join(', ')}</div>}
              </div>
              <span className={`co-kind${s.action === 'retire' ? ' co-kind--ret' : ''}`}>{CO.kind[s.action] ?? s.action}</span>
            </li>
          );
        })}
      </ol>
      <p className="co-limits"><span className="co-note">{CO.limitsLine}</span> <strong>{plan.limits.label}</strong></p>

      {blockersUnknown && <p className="co-verbatim co-verbatim--act" role="alert">{CO.blockersUnknown}</p>}
      {blockers.length > 0 && (
        <section className="co-block state" data-state="act" role="alert" aria-label={CO.blockersTitle}>
          <h3 className="co-h3">{CO.blockersTitle}</h3>
          <p className="co-note">{CO.blockersNote}</p>
          <ul className="co-msgs">
            {blockers.map((b, i) => {
              const target = limitsTargetOf(b);
              const to = { s: 'products', t: 'limits', sheet: null, wall: false, keys: { pr: String(target) } } as const;
              return (
                <li key={i}>
                  <span className="co-verbatim">{b}</span>
                  {target !== null && (
                    <div className="co-linkrow">
                      <p className="co-note">{CO.changeLimitsWhy}</p>
                      <a className="ui-link" href={hrefFor(to)} onClick={(e) => plainClick(e, () => go(to))}>
                        {CO.changeLimitsOf(target)}
                      </a>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section className="co-warn state" data-state="watch" aria-label={CO.warningsTitle}>
          <h3 className="co-h3">{CO.warningsTitle}</h3>
          <p className="co-note">{CO.warningsNote}</p>
          <ul className="co-msgs">{warnings.map((w, i) => <li key={i} className="co-verbatim">{w}</li>)}</ul>
        </section>
      )}

      <ul className="co-facts">
        <li><Icon name="info" size={16} /> <span className="co-verbatim">{plan.noRollback}</span></li>
        <li><Icon name="info" size={16} /> <span>{CO.noReach}</span></li>
        <li><Icon name="info" size={16} /> <span className="co-verbatim">{plan.operatorNote}</span></li>
      </ul>

      {!plan.writesEnabled && <WritesOff plan={plan} />}
    </div>
  );
}

function WritesOff({ plan }: { plan: ChangeoverPlan }) {
  return (
    <div className="co-off state" data-state="watch">
      <p className="co-off__t"><Icon name="lock" size={16} /> {CO.writesOffTitle}</p>
      {plan.disabledReason && (
        <p className="co-verbatim"><span className="co-cap">{CO.reasonGiven}</span>{pdasWords.pdasReasonForDisplay(plan.disabledReason)}</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- Execute */

function ExecuteControl({ rank, plan, blocked, busy, done, onAsk }: {
  rank: number; plan: ChangeoverPlan; blocked: boolean; busy: boolean; done: boolean; onAsk: () => void;
}) {
  const reason = plan.writesEnabled ? null : (pdasWords.pdasReasonForDisplay(plan.disabledReason) ?? CO.writesOffTitle);
  return (
    <WriteGate rank={rank} minRank={ENGINEER_RANK} disabledReason={reason}>
      <button type="button" className="ui-btn" disabled={blocked || busy || done} onClick={onAsk} aria-busy={busy || undefined}>
        {busy ? CO.executing : CO.execute(plan.steps.length)}
      </button>
    </WriteGate>
  );
}

function ExecuteStep({ rank, plan, refusal, outcome, busy }: {
  rank: number; plan: ChangeoverPlan; refusal: { status: number; message: string } | null; outcome: ChangeoverOutcome | null; busy: boolean;
}) {
  return (
    <div className="co-exec">
      <h2 className="co-h2">{CO.steps.execute}</h2>
      <ol className="co-plan" aria-label={CO.stepsLabel}>
        {plan.steps.map((s, i) => (
          <li key={i}>
            <span className="co-plan__no" aria-hidden="true">{i + 1}</span>
            <div><div className="co-plan__t">{s.label}</div></div>
            <span className={`co-kind${s.action === 'retire' ? ' co-kind--ret' : ''}`}>{CO.kind[s.action] ?? s.action}</span>
          </li>
        ))}
      </ol>
      {rank < ENGINEER_RANK && (
        <p className="co-lock"><Icon name="lock" size={16} /> <span>{CO.viewerLock}</span></p>
      )}
      {rank >= ENGINEER_RANK && !plan.writesEnabled && (
        <>
          <WritesOff plan={plan} />
          <p className="co-note">{CO.nothingSent} {CO.planStillWorks}</p>
        </>
      )}
      {busy && <p className="co-note" role="status">{CO.executing}</p>}
      {outcome && <p className="co-note">{CO.alreadyRun}</p>}
      {refusal && <Refusal refusal={refusal} />}
      {outcome && <Outcome outcome={outcome} />}
    </div>
  );
}

function Refusal({ refusal }: { refusal: { status: number; message: string } }) {
  const lead = refusal.status === 503 ? CO.refusedOff : refusal.status === 409 ? CO.refusedBlocked : CO.unconfirmed;
  return (
    <div className="co-fail state" data-state="act" role="alert">
      <p className="co-fail__t"><Icon name="info" size={16} /> {lead}</p>
      <p className="co-verbatim">{pdasWords.pdasReasonForDisplay(refusal.message)}</p>
    </div>
  );
}

function Outcome({ outcome }: { outcome: ChangeoverOutcome }) {
  const total = outcome.done.length + (outcome.failed ? 1 : 0) + outcome.notDone.length;
  return (
    <section className="co-result" aria-label={CO.resultTitle}>
      <h3 className="co-h3">{CO.resultTitle}</h3>
      <p className="co-lead">{outcome.ok ? CO.resultAll(total) : CO.resultStopped}</p>
      <ul className="co-res">
        {outcome.done.map((s, i) => (
          <li key={`d${i}`}>
            <span className="pill state" data-state="ok">{CO.done}</span>
            <div>{s.label}<small>{CO.newId(s.resultId)}</small></div>
          </li>
        ))}
        {outcome.failed && (
          <li>
            <span className="pill state" data-state="act">{CO.failed}</span>
            <div>
              {outcome.failed.label}
              <small className="co-verbatim">{outcome.failed.error.message}</small>
              {outcome.failed.error.pdasErrorCode != null && <small>{CO.pdasCode(outcome.failed.error.pdasErrorCode)}</small>}
            </div>
          </li>
        )}
        {outcome.notDone.map((s, i) => (
          <li key={`n${i}`}>
            <span className="pill state" data-state="nodata">{CO.notDone}</span>
            <div>{s.label}</div>
          </li>
        ))}
      </ul>
      <p className="co-verbatim">{outcome.noRollback}</p>
    </section>
  );
}
