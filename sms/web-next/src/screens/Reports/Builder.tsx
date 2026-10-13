/**
 * "Build your report": the report variant, the period, the shift range and the filters this type takes, then
 * Preview, Print and the downloads. It owns no state of its own: the period is the ONE global period (written
 * through usePeriod), the variant and filters live in the URL (`rt`, `rsh`, `st`, `pr`), and the downloads are the
 * server's own export links built from the same query as the preview.
 *
 * Downloads (PDF, Excel, CSV) are rank 3 (EXPORT_MIN_RANK, the server's gate) and ABSENT below it, never greyed:
 * a 403 is a bug, not a state. While the report is still arriving they are disabled, so a half-loaded report
 * cannot be downloaded or printed.
 */
import { useState } from 'react';
import { reportExportUrl, type ProductOption, type ReportFilters, type ReportType, type StationRow } from '../../bridge/api';
import { period as P, productLabel } from '../../bridge/lib';
import { EXPORT_MIN_RANK, FILTERS_BY_TYPE } from '../../bridge/report';
import { C, withFragments, FRAGMENTS } from '../../copy';
import type { PeriodState } from '../../data/usePeriod';
import { SelectField } from '../../ui/Field';
import { WriteGate } from '../../ui/WriteGate';
import { cardOf } from './model';
import { QUICK_ORDER, paramsForQuick, quickOf, withShifts, type QuickPeriod, type ShiftChoice } from './periods';
import type { ReportState } from './useReport';
const R = withFragments(C.reports, FRAGMENTS.reportsParts);

const RB = R.builder;
const RP = R.periods;

export interface BuilderProps {
  type: ReportType;
  rank: number;
  period: PeriodState;
  /** The production day in progress, from the plant clock; null until known. */
  today: string | null;
  range: { minDate: string; maxDate: string } | null;
  filters: ReportFilters;
  state: ReportState;
  stations: { names: StationRow[]; failed: boolean };
  products: { list: ProductOption[]; failed: boolean };
  onType: (t: ReportType) => void;
  onFilter: (key: 'rsh' | 'st' | 'pr', value: string | null) => void;
  onPreview: () => void;
}

const SHIFT_LABEL: Record<P.ShiftCode, string> = { morning: R.shiftMorning, evening: R.shiftEvening, night: R.shiftNight };

export function Builder({ type, rank, period: ps, today, range, filters, state, stations, products, onType, onFilter, onPreview }: BuilderProps) {
  const card = cardOf(type);
  const allowed = FILTERS_BY_TYPE[type];
  const period = ps.period;
  const quick = quickOf(period, range);
  const [custom, setCustom] = useState(false);
  const [dates, setDates] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [problem, setProblem] = useState<string | null>(null);

  const labels = productLabel.distinctProductLabels(products.list);
  const fromShift: ShiftChoice = period?.fromShift && !(period.fromShift.shift === 'morning' && period.toShift?.shift === 'night') ? period.fromShift.shift : '';
  const toShift: ShiftChoice = period?.toShift && !(period.fromShift?.shift === 'morning' && period.toShift.shift === 'night') ? period.toShift.shift : '';

  const choose = (id: string) => {
    setProblem(null);
    if (id === 'custom') {
      setCustom(true);
      setDates({ from: period?.from ?? '', to: period?.to ?? '' });
      return;
    }
    if (id === 'current') return;
    setCustom(false);
    if (!today) return;
    const next = paramsForQuick(id as Exclude<QuickPeriod, 'custom'>, today, range);
    if (next) ps.setParams(next);
  };
  const applyDates = () => {
    if (!P.isRealDate(dates.from) || !P.isRealDate(dates.to) || dates.from > dates.to) {
      setProblem(RP.badDates);
      return;
    }
    setProblem(null);
    ps.setParams({ key: 'pick', picked: { from: dates.from, to: dates.to } });
    setCustom(false);
  };
  const shifts = (f: ShiftChoice, t: ShiftChoice) => {
    if (!period) return;
    const next = withShifts(period.from, period.to, f, t);
    if (!next) {
      setProblem(C.periodUi.endBeforeStart);
      return;
    }
    setProblem(null);
    ps.setParams(next);
  };

  const q = state.q;
  const ready = state.data !== null && q !== null;
  const exportBtn = (label: string, format: 'pdf' | 'xlsx' | 'csv') =>
    ready ? (
      <a className="rp-btn rp-btn--quiet" href={reportExportUrl(type, q, format)}>{label}</a>
    ) : (
      <button type="button" className="rp-btn rp-btn--quiet" disabled>{label}</button>
    );

  return (
    <aside className="rp-build" aria-labelledby="rp-build-h">
      <h2 id="rp-build-h" className="rp-build__h">{RB.heading}</h2>
      <p className="rp-build__sel">{card.title}</p>

      <SelectField
        label={RB.report}
        value={type}
        onChange={(v) => onType(v as ReportType)}
        options={card.variants.map((x) => ({ value: x.type, label: x.title }))}
      />

      <SelectField
        label={RB.period}
        hint={RB.periodHelp}
        value={custom ? 'custom' : (quick ?? 'current')}
        onChange={choose}
        options={[
          ...(quick === null && !custom ? [{ value: 'current', label: period ? `${RP.current}: ${P.describePeriod(period)}` : RP.current }] : []),
          ...QUICK_ORDER.map((id) => ({ value: id, label: RP[id] })),
        ]}
      />
      {custom && (
        <div className="rp-build__row">
          <label className="rp-field">
            <span>{RP.from}</span>
            <input type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} />
          </label>
          <label className="rp-field">
            <span>{RP.to}</span>
            <input type="date" value={dates.to} onChange={(e) => setDates({ ...dates, to: e.target.value })} />
          </label>
          <button type="button" className="rp-btn rp-btn--quiet" onClick={applyDates}>{RP.apply}</button>
        </div>
      )}

      <div className="rp-build__row">
        <SelectField
          label={RB.fromShift}
          value={fromShift}
          onChange={(v) => shifts(v as ShiftChoice, toShift)}
          options={[{ value: '', label: RB.firstShift }, ...(['morning', 'evening', 'night'] as const).map((s) => ({ value: s, label: SHIFT_LABEL[s] }))]}
        />
        <SelectField
          label={RB.toShift}
          value={toShift}
          onChange={(v) => shifts(fromShift, v as ShiftChoice)}
          options={[{ value: '', label: RB.lastShift }, ...(['morning', 'evening', 'night'] as const).map((s) => ({ value: s, label: SHIFT_LABEL[s] }))]}
        />
      </div>
      {problem && <p className="rp-build__problem" role="alert">{problem}</p>}

      {allowed.includes('shift') && (
        <SelectField
          label={RB.shift}
          value={filters.shift ?? ''}
          onChange={(v) => onFilter('rsh', v || null)}
          options={[{ value: '', label: period?.shift ? SHIFT_LABEL[period.shift] : RB.all }, ...(['morning', 'evening', 'night'] as const).map((s) => ({ value: s, label: SHIFT_LABEL[s] }))]}
        />
      )}
      {allowed.includes('station') &&
        (stations.failed ? (
          <p className="rp-build__problem">{RB.stationsFailed}</p>
        ) : (
          stations.names.length > 0 && (
            <SelectField
              label={RB.station}
              value={filters.station != null ? String(filters.station) : ''}
              onChange={(v) => onFilter('st', v || null)}
              options={[
                { value: '', label: RB.all },
                ...stations.names.map((s) => ({ value: String(s.stationId), label: s.name?.trim() ? C.stationWithName(s.stationId, s.name.trim()) : C.station(s.stationId) })),
              ]}
            />
          )
        ))}
      {allowed.includes('product') &&
        (products.failed ? (
          <p className="rp-build__problem">{RB.productsFailed}</p>
        ) : (
          products.list.length > 0 && (
            <SelectField
              label={RB.product}
              value={filters.product != null ? String(filters.product) : ''}
              onChange={(v) => onFilter('pr', v || null)}
              options={[
                { value: '', label: RB.all },
                ...products.list.map((p) => ({ value: String(p.productId), label: labels.get(p.productId) ?? p.description ?? `Product ${p.productId}` })),
              ]}
            />
          )
        ))}

      <div className="rp-acts">
        <button type="button" className="rp-btn" onClick={onPreview}>{RB.preview}</button>
        <button type="button" className="rp-btn rp-btn--quiet" disabled={!ready} onClick={() => window.print()}>{RB.print}</button>
        <WriteGate rank={rank} minRank={EXPORT_MIN_RANK}>
          <div className="rp-exports" role="group" aria-label="Download">
            {exportBtn(RB.exportPdf, 'pdf')}
            {exportBtn(RB.exportExcel, 'xlsx')}
            {exportBtn(RB.exportCsv, 'csv')}
          </div>
        </WriteGate>
      </div>
      {rank < EXPORT_MIN_RANK && <p className="rp-build__lock">{RB.exportLocked}</p>}
    </aside>
  );
}
