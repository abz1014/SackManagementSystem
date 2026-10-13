/**
 * Record a calibration adjustment (TRACE A1-078, A2-028, A4-12; rank 2, server requireRole(2)).
 *
 * The ledger entry says WHEN (plant time, default the plant clock now), HOW MUCH (signed grams),
 * WHY, a note, the reference readings before and after, and the product the winder is running.
 * No optimistic UI: nothing appears in the log until the server has accepted the entry, and a
 * failed save says so and keeps what was typed. SMS never adjusts a scale; this only records that
 * someone did. The calibration route has no "writes are off" switch of its own (unlike PDAS), so
 * the gate has no server reason to print; WriteGate still owns the rank rule.
 */
import { useId, useState, type FormEvent } from 'react';
import { recordAdjustment, type MachineRunning } from '../../bridge/api';
import { live, plantClock } from '../../bridge/lib';
import { W } from '../../bridge/words';
import { NumberField } from '../../ui/Field';
import { WriteGate } from '../../ui/WriteGate';
import { ENGINEER_RANK } from '../../ranks';
import { S } from '../../screens/Quality/Stations/stationsCopy';
import '../../ui/components/write.css';

export interface AdjustmentFormProps {
  rank: number;
  station: number;
  stationLabel: string;
  offsetMinutes: number;
  /** The winder's row, to suggest the product in force. null while unknown or when the fetch failed. */
  machine: MachineRunning | null;
  onLogged: () => void;
}

function TextField(p: { label: string; value: string; onChange: (v: string) => void; type?: 'text' | 'datetime-local'; hint?: string }) {
  const id = useId();
  return (
    <div className="wr-field">
      <label className="wr-field__label" htmlFor={id}>{p.label}</label>
      <input id={id} className="wr-input" type={p.type ?? 'text'} value={p.value} onChange={(e) => p.onChange(e.target.value)} aria-describedby={p.hint ? `${id}-hint` : undefined} />
      {p.hint && <div id={`${id}-hint`} className="wr-field__hint">{p.hint}</div>}
    </div>
  );
}

const num = (s: string): number | undefined => {
  const v = Number(s.trim());
  return s.trim() === '' || !Number.isFinite(v) ? undefined : v;
};

export function AdjustmentForm(p: AdjustmentFormProps) {
  return (
    <WriteGate rank={p.rank} minRank={ENGINEER_RANK}>
      <Block {...p} />
    </WriteGate>
  );
}

function Block({ station, stationLabel, offsetMinutes, machine, onLogged }: AdjustmentFormProps) {
  const plantNow = live.usePlantNow();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const [why, setWhy] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [before, setBefore] = useState('');
  const [after, setAfter] = useState('');
  const [reference, setReference] = useState('');
  const suggested =
    machine && !machine.quiet && machine.materialId != null
      ? { id: machine.materialId, label: machine.productName ?? W.cone.noProductName(machine.materialId) }
      : null;
  const [cleared, setCleared] = useState(false);
  const product = cleared ? null : suggested;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const start = () => {
    if (plantNow && when === '') setWhen(plantClock.plantLocalValue(plantNow));
    setOpen(true);
  };

  if (!open) {
    return (
      <section className="ss-sec" aria-labelledby="ss-adjust-h">
        <h3 id="ss-adjust-h" className="ss-h">{S.adjustTitle}</h3>
        <p className="ss-note">{S.adjustIntro}</p>
        <button type="button" className="ui-btn" onClick={start}>{S.adjustOpen}</button>
      </section>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFailed(false);
    try {
      await recordAdjustment({
        stationId: station,
        // A typed plant time becomes the genuine-UTC instant the ledger stores, through the
        // offset the API reported, never the browser's own zone.
        adjustedAt: when ? plantClock.fromPlantLocal(when, offsetMinutes) : undefined,
        reason: why.trim() || undefined,
        note: note.trim() || undefined,
        amountG: num(amount),
        beforeG: num(before),
        afterG: num(after),
        referenceG: num(reference),
        productId: product?.id,
      });
      setOpen(false);
      setWhy('');
      setNote('');
      setAmount('');
      setBefore('');
      setAfter('');
      setReference('');
      setWhen('');
      onLogged();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ss-sec" aria-labelledby="ss-adjust-h">
      <h3 id="ss-adjust-h" className="ss-h">{S.adjustTitle}</h3>
      <form className="ss-form" onSubmit={submit}>
        <TextField type="datetime-local" label={W.calibration.adjustedAt} value={when} onChange={setWhen} hint={W.calibration.adjustedAtNote} />
        <NumberField label={W.weight.adjustAmount} value={amount} onChange={setAmount} unit="g" step={0.1} />
        <TextField label={`${W.weight.adjustWhy} — ${stationLabel}`} value={why} onChange={setWhy} />
        <TextField label={W.calibration.note} value={note} onChange={setNote} />
        <NumberField label={W.calibration.referenceG} value={reference} onChange={setReference} unit="g" step={0.1} />
        <NumberField label={W.calibration.beforeG} value={before} onChange={setBefore} unit="g" step={0.1} />
        <NumberField label={W.calibration.afterG} value={after} onChange={setAfter} unit="g" step={0.1} />
        <div className="wr-field">
          <span className="wr-field__label">{W.calibration.productInForce}</span>
          <span>
            {product == null ? (
              <span className="ss-mut">{W.calibration.productQuiet}</span>
            ) : (
              <>
                {W.calibration.productFromMachine(product.label)}{' '}
                <button type="button" className="ui-link" onClick={() => setCleared(true)}>{W.calibration.productClear}</button>
              </>
            )}
          </span>
        </div>
        {failed && <p className="ss-error" role="alert">{S.saveFailed}</p>}
        <div className="ss-actions">
          <button type="submit" className="ui-btn" disabled={busy}>{busy ? S.saving : W.weight.save}</button>
          <button type="button" className="wr-btn" onClick={() => setOpen(false)}>{S.cancel}</button>
        </div>
      </form>
    </section>
  );
}
