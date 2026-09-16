/**
 * Setup › Rules — what this system applies when it reads the plant's
 * numbers: the weight basis, the shift boundaries, and the bounds outside
 * which a reading is a scale fault.
 *
 * Three forms, in roadmap Phase 1 (14 Sep 2026), where there was a
 * read-only list. The three writers in api.ts had existed since 3 Sep with
 * no caller, so the only way to change a rule was SQL on the plant PC — and
 * the shift rule's boundary times were not even in the request: the server
 * held '06:00','14:00','22:00' as literals. They are the form's three time
 * inputs now.
 *
 * Every rule table is append-only and the newest row wins, so a save is a
 * new version with a reason and an author, never an overwrite. What happens
 * next differs per rule and the API says it in its `note`, shown verbatim:
 * the shift rule restamps only NEW rows until a rebuild is run (finding H5),
 * the plausibility rule applies at read time to every query at once.
 */
import { useState } from 'react';
import {
  adminGetRules, adminSetPlausibilityRule, adminSetShiftRule, adminSetWeightRule,
  getRange, getShiftCheck,
  type Basis, type NightBelongsTo, type Rules, type ShiftMode,
} from '../../api';
import { shiftOrderProblem } from '../../lib/shiftTimes';
import { fmtInt, fmtPct1 } from '../../lib/fmt';
import { W } from '../../lib/words';
import { Block, Failed, SkelLines } from '../../ui/bits';
import { ProductLimitsBlock } from '../product/ProductLimitsBlock';
import { Said, useResource, useWrite } from './shared';

const BASES: Basis[] = ['as_recorded', 'gross', 'net'];
const MODES: ShiftMode[] = ['corrected', 'legacy'];
const NIGHTS: NightBelongsTo[] = ['start_day', 'calendar_day'];

/* What the system applies when a rule table is empty — the same values the
   API falls back to (weights.ts: tube 70 g, tare 0.5 kg; admin.ts
   PLAUSIBILITY_FALLBACK; the 06/14/22 shift default with the .env mode and
   night rule). Shown in the form so the admin sees what is in force, and
   the form says they are defaults, not a recorded rule. */
const DEFAULT_WEIGHT = { basis: 'as_recorded' as Basis, coneTubeWeightG: 70, sackTareKg: 0.5 };
const DEFAULT_SHIFT = { morningStart: '06:00', eveningStart: '14:00', nightStart: '22:00', mode: 'corrected' as ShiftMode, nightBelongsTo: 'start_day' as NightBelongsTo };
const DEFAULT_PLAUSIBILITY = { coneLoG: 1500, coneHiG: 2100, sackLoKg: 40, sackHiKg: 60 };

export function RulesBlock() {
  const res = useResource(() => adminGetRules());

  // Finding H14 (Sep 2026 audit): this used to swallow a fetch failure into
  // `rules: null`, which rendered identically to "still loading".
  if (res.error) return <Block label={W.setupTabs.rules}><Failed error={res.error} onRetry={res.reload} /></Block>;
  if (!res.data) return <Block label={W.setupTabs.rules}><SkelLines n={6} short /></Block>;

  const rules = res.data;
  // Keyed on the loaded values so each form re-seeds after its own save.
  return (
    <Block label={W.setupTabs.rules} note={W.config.rules.note}>
      <div style={{ display: 'grid', gap: 32 }}>
        <WeightForm key={JSON.stringify(rules.weight)} rules={rules} onSaved={res.reload} />
        <ShiftForm key={JSON.stringify(rules.shift)} rules={rules} onSaved={res.reload} />
        <PlausibilityForm key={JSON.stringify(rules.plausibility)} rules={rules} onSaved={res.reload} />
        <ProductLimitsBlock />
      </div>
    </Block>
  );
}

function Title({ children, none }: { children: string; none: boolean }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ fontWeight: 500 }}>{children}</p>
      {none && <p className="mut sm">{W.config.rules.noRuleYet}</p>}
    </div>
  );
}

function Reason({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{W.config.why}</span>
      <input type="text" value={value} maxLength={255} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/* ---------------------------------------------------------------- weight */

function WeightForm({ rules, onSaved }: { rules: Rules; onSaved: () => void }) {
  const cur = rules.weight ?? DEFAULT_WEIGHT;
  const [basis, setBasis] = useState<Basis>(BASES.includes(cur.basis as Basis) ? (cur.basis as Basis) : 'as_recorded');
  const [tube, setTube] = useState(String(cur.coneTubeWeightG));
  const [tare, setTare] = useState(String(cur.sackTareKg));
  const [reason, setReason] = useState('');
  const w = useWrite();

  const tubeN = Number(tube);
  const tareN = Number(tare);
  const valid = tube.trim() !== '' && tare.trim() !== '' && Number.isFinite(tubeN) && tubeN >= 0 && Number.isFinite(tareN) && tareN >= 0;

  return (
    <form
      style={{ display: 'grid', gap: 10, maxWidth: '28em' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void w.run(
          () => adminSetWeightRule({ basis, coneTubeWeightG: tubeN, sackTareKg: tareN, reason: reason.trim() || undefined }),
          () => {
            setReason('');
            onSaved();
          },
        );
      }}
    >
      <Title none={rules.weight == null}>{W.config.rules.weight}</Title>
      <label className="field">
        <span>{W.config.rules.basis}</span>
        <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
          {BASES.map((b) => (
            <option key={b} value={b}>{W.config.rules.bases[b]}</option>
          ))}
        </select>
        {/* The consequence Weight's headline lives under, stated where the
            admin can change it. */}
        {basis === 'as_recorded' && <span>{W.config.rules.basisUnconfirmed}</span>}
      </label>
      <div className="row top">
        <label className="field">
          <span>{W.config.rules.tubeG}</span>
          <input type="number" min={0} step="0.1" value={tube} required onChange={(e) => setTube(e.target.value)} style={{ width: '9em' }} />
        </label>
        <label className="field">
          <span>{W.config.rules.tareKg}</span>
          <input type="number" min={0} step="0.01" value={tare} required onChange={(e) => setTare(e.target.value)} style={{ width: '9em' }} />
        </label>
      </div>
      <Reason value={reason} onChange={setReason} />
      <div className="row">
        <button type="submit" className="btn primary" disabled={w.busy || !valid}>{W.config.save}</button>
      </div>
      <Said outcome={w.outcome} />
    </form>
  );
}

/* ----------------------------------------------------------------- shift */

function ShiftForm({ rules, onSaved }: { rules: Rules; onSaved: () => void }) {
  const cur = rules.shift ?? DEFAULT_SHIFT;
  const [morning, setMorning] = useState(cur.morningStart);
  const [evening, setEvening] = useState(cur.eveningStart);
  const [night, setNight] = useState(cur.nightStart);
  const [mode, setMode] = useState<ShiftMode>(MODES.includes(cur.mode as ShiftMode) ? (cur.mode as ShiftMode) : 'corrected');
  const [nightBelongsTo, setNightBelongsTo] = useState<NightBelongsTo>(
    NIGHTS.includes(cur.nightBelongsTo as NightBelongsTo) ? (cur.nightBelongsTo as NightBelongsTo) : 'start_day',
  );
  const [reason, setReason] = useState('');
  const w = useWrite();

  // Judged on every render, said under the fields, and it holds the Save
  // button: the server refuses the same thing, but only after a round trip.
  const problem = shiftOrderProblem(morning, evening, night);

  return (
    <form
      style={{ display: 'grid', gap: 10, maxWidth: '28em' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (problem) return;
        void w.run(
          () => adminSetShiftRule({ morningStart: morning, eveningStart: evening, nightStart: night, mode, nightBelongsTo, reason: reason.trim() || undefined }),
          () => {
            setReason('');
            onSaved();
          },
        );
      }}
    >
      <Title none={rules.shift == null}>{W.config.rules.shifts}</Title>
      <div className="row top">
        <label className="field">
          <span>{W.config.rules.morningStart}</span>
          <input type="time" value={morning} required step={60} onChange={(e) => setMorning(e.target.value)} />
        </label>
        <label className="field">
          <span>{W.config.rules.eveningStart}</span>
          <input type="time" value={evening} required step={60} onChange={(e) => setEvening(e.target.value)} />
        </label>
        <label className="field">
          <span>{W.config.rules.nightStart}</span>
          <input type="time" value={night} required step={60} onChange={(e) => setNight(e.target.value)} />
        </label>
      </div>
      {problem && (
        <p className="acc sm" role="alert">
          {problem === 'out_of_order' ? W.config.rules.shiftOrder : W.config.rules.shiftTimeInvalid}
        </p>
      )}
      <label className="field">
        <span>{W.config.rules.nightBelongsTo}</span>
        <select value={nightBelongsTo} onChange={(e) => setNightBelongsTo(e.target.value as NightBelongsTo)}>
          {NIGHTS.map((n) => (
            <option key={n} value={n}>{W.config.rules.nights[n]}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{W.config.rules.mode}</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as ShiftMode)}>
          {MODES.map((m) => (
            <option key={m} value={m}>{W.config.rules.modes[m]}</option>
          ))}
        </select>
        {/* Q7 is open: the mode is recorded and applied nowhere. A select
            that changes nothing must say so, or the admin will look for the
            change it made. */}
        <span>{W.config.rules.modeNote}</span>
        {/* What the mode WOULD change (roadmap Phase 4 item 5): over the last
            seven production days, how often the plant's stored shift and the
            derived one disagree. The same figure the Report prints. */}
        <ShiftCheckNote />
      </label>
      <Reason value={reason} onChange={setReason} />
      <div className="row">
        <button type="submit" className="btn primary" disabled={w.busy || problem != null}>{W.config.save}</button>
      </div>
      <Said outcome={w.outcome} />
    </form>
  );
}

/**
 * The shift attribution check for the last 7 production days, anchored on
 * the newest day on record rather than today — a server whose source has
 * stopped would otherwise compare an empty week.
 */
function ShiftCheckNote() {
  const res = useResource(async () => {
    const range = await getRange();
    const to = range.maxDate ?? null;
    if (!to) return null;
    const from = new Date(new Date(`${to}T12:00:00Z`).getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
    return (await getShiftCheck(from, to)).data;
  });
  if (res.error) return <span className="mut sm">{W.couldNotLoad}</span>;
  // Loading, or no production days on record: nothing to say yet.
  if (!res.data) return null;
  const d = res.data;
  const compared = d.cones - d.noLegacyShift;
  return (
    <span className="mut sm">
      {compared > 0 ? W.cone.shiftFormNote(fmtInt(d.mismatched), fmtInt(compared), fmtPct1(d.mismatchPct)) : W.cone.shiftFormNone}
    </span>
  );
}

/* ---------------------------------------------------------- plausibility */

function PlausibilityForm({ rules, onSaved }: { rules: Rules; onSaved: () => void }) {
  const cur = rules.plausibility ?? DEFAULT_PLAUSIBILITY;
  const [coneLo, setConeLo] = useState(String(cur.coneLoG));
  const [coneHi, setConeHi] = useState(String(cur.coneHiG));
  const [sackLo, setSackLo] = useState(String(cur.sackLoKg));
  const [sackHi, setSackHi] = useState(String(cur.sackHiKg));
  const [reason, setReason] = useState('');
  const w = useWrite();

  const n = [coneLo, coneHi, sackLo, sackHi].map((s) => (s.trim() === '' ? NaN : Number(s)));
  const [cl, ch, sl, sh] = n as [number, number, number, number];
  const allNumbers = n.every((x) => Number.isFinite(x) && x > 0);
  // The server refines the same two inequalities; said here first.
  const ordered = allNumbers && cl < ch && sl < sh;

  return (
    <form
      style={{ display: 'grid', gap: 10, maxWidth: '28em' }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ordered) return;
        void w.run(
          () => adminSetPlausibilityRule({ coneLoG: cl, coneHiG: ch, sackLoKg: sl, sackHiKg: sh, reason: reason.trim() || undefined }),
          () => {
            setReason('');
            onSaved();
          },
        );
      }}
    >
      <Title none={rules.plausibility == null}>{W.config.rules.plausibility}</Title>
      <p className="mut sm">{W.config.rules.plausibilityNote}</p>
      <div className="row top">
        <label className="field">
          <span>{W.config.rules.coneLoG}</span>
          <input type="number" min={0} step="1" value={coneLo} required onChange={(e) => setConeLo(e.target.value)} style={{ width: '9em' }} />
        </label>
        <label className="field">
          <span>{W.config.rules.coneHiG}</span>
          <input type="number" min={0} step="1" value={coneHi} required onChange={(e) => setConeHi(e.target.value)} style={{ width: '9em' }} />
        </label>
      </div>
      <div className="row top">
        <label className="field">
          <span>{W.config.rules.sackLoKg}</span>
          <input type="number" min={0} step="0.1" value={sackLo} required onChange={(e) => setSackLo(e.target.value)} style={{ width: '9em' }} />
        </label>
        <label className="field">
          <span>{W.config.rules.sackHiKg}</span>
          <input type="number" min={0} step="0.1" value={sackHi} required onChange={(e) => setSackHi(e.target.value)} style={{ width: '9em' }} />
        </label>
      </div>
      {allNumbers && !ordered && (
        <p className="acc sm" role="alert">{W.config.rules.loBeforeHi}</p>
      )}
      <Reason value={reason} onChange={setReason} />
      <div className="row">
        <button type="submit" className="btn primary" disabled={w.busy || !ordered}>{W.config.save}</button>
      </div>
      <Said outcome={w.outcome} />
    </form>
  );
}

/* Product limits (read-only history + the SMS-local editor) moved to
   ../product/ProductLimitsBlock.tsx, 15 Sep 2026 — the same component now
   renders in the Product sheet too, so the two cannot show this differently
   (roadmap Phase 4 item 2; see that file's header). */
