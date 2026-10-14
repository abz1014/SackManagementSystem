import { useState } from 'react';
import { C, FRAGMENTS } from '../copy';
import { period as P } from '../bridge/lib';
import { usePlantClock } from '../data/useLive';
import { useRange } from '../data/hooks';
import { usePeriod } from '../data/usePeriod';
import { Icon } from './Icon';
import { PeriodPanel } from './PeriodPanel';
import './components/period.css';

/**
 * The one period control: a pill showing the resolved period in words (plus the
 * compare tag) that opens PeriodPanel. Reads and writes the URL through usePeriod.
 */
export function PeriodChip({ className }: { className?: string }) {
  const state = usePeriod();
  const clock = usePlantClock();
  const range = useRange();
  const [open, setOpen] = useState(false);

  const line = clock.line;
  const maxDate = range.data?.maxDate ?? null;
  const anchor: P.PeriodAnchor | null = line
    ? {
        shiftDate: line.shift.shiftDate,
        shiftCode: line.shift.code,
        shiftStartUtc: line.shift.startUtc,
        plantNowUtc: line.plantNowUtc,
        dataAsOfUtc: line.dataAsOfUtc ?? (maxDate ? `${maxDate}T00:00:00Z` : null),
        firstDay: range.data?.minDate ?? null,
      }
    : null;

  const { period, compare, status } = state;
  const sentence = period ? P.describePeriod(period) : status === 'error' ? C.periodUi.unavailable : C.periodUi.loading;
  const cmpTag = compare ? (compare === 'prev' ? FRAGMENTS.vsPrevious : FRAGMENTS.vsLastWeek) : null;

  return (
    <>
      <button
        type="button"
        className={`pp-chip${className ? ` ${className}` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!period}
        title={(clock.failed || clock.broken) && !anchor ? C.periodUi.clockUnread : undefined}
        aria-label={period ? C.periodUi.chipLabel(sentence + (cmpTag ? `, ${cmpTag}` : '')) : sentence}
        onClick={() => setOpen(true)}
      >
        <Icon name="calendar" size={16} />
        <span className="pp-chip__text">{sentence}</span>
        {cmpTag && <span className="pp-chip__cmp">· {cmpTag}</span>}
      </button>
      <PeriodPanel open={open} onClose={() => setOpen(false)} state={state} anchor={anchor} maxDate={maxDate} />
    </>
  );
}
