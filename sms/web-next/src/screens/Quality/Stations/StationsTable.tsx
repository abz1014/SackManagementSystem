/**
 * The ONE station table (CLAUDE.md: one station table in the whole application).
 *
 * Two column groups, said in a header row and drawn as two things:
 *   - This period: the columns that follow the period chip.
 *   - Pattern check: a boxed group that ALWAYS reads the last 14 production days
 *     (the detectors ignore the period; this is the confusion F38 recorded).
 * It looks like ui/DataTable (same classes, same keyboard and phone behaviour) but has the
 * grouped header DataTable cannot draw.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { W } from '../../../bridge/words';
import { fmt } from '../../../bridge/lib';
import { C, FRAGMENTS } from '../../../copy';
import { StatusPill } from '../../../ui/StatusPill';
import { stationText } from '../../../ui/StationTile';
import { useMediaQuery } from '../../../ui/useMediaQuery';
import '../../../ui/components/DataTable.css';
import './stations.css';
import { pct, type PatternCell, type StationRowModel, type TargetCell } from './model';

const S = C.qualityStations;
const SF = FRAGMENTS.qualityStations;

export interface StationsTableProps {
  rows: readonly StationRowModel[];
  periodSpan: string;
  patternSpan: string | null;
  /** The per-station counts could not be read: failed-inspection n and weight columns show a dash. */
  countsFailed: boolean;
  /** The 14-day check could not be read: the boxed columns show a dash. */
  patternFailed: boolean;
  selected: number | null;
  onOpen: (station: number) => void;
}

const Dash = () => (
  <span className="qs-mut" aria-label={S.noData}>
    {SF.dash}
  </span>
);

function PatternResult({ cell, failed }: { cell: PatternCell; failed: boolean }): ReactNode {
  if (failed || cell.kind === 'unavailable') return <Dash />;
  if (cell.kind === 'nodata') return <span className="qs-mut">{S.noData}</span>;
  if (cell.kind === 'clear') return <span className="qs-mut">{S.nothingFlagged}</span>;
  return <span className="qs-result">{cell.text}</span>;
}

function patternDays(cell: PatternCell, failed: boolean): ReactNode {
  if (failed || cell.kind === 'unavailable') return <Dash />;
  if (cell.kind === 'nodata') return <span className="qs-mut">{S.noData}</span>;
  return fmt.fmtInt(cell.days);
}

function TargetValue({ cell, failed }: { cell: TargetCell; failed: boolean }): ReactNode {
  if (failed) return <Dash />;
  switch (cell.kind) {
    case 'value':
      return (
        <span title={cell.lineProduct ? W.weight.targetLineProduct : undefined}>
          <b>{cell.text}</b>
          <span className="qs-sub">{SF.vsTargetSub}</span>
        </span>
      );
    case 'mixed':
      return (
        <span title={W.weight.mixedTarget(cell.materials)} className="qs-mut">
          {W.weight.mixedTargetShort(cell.materials)}
        </span>
      );
    case 'none':
      return <span className="qs-mut">{W.weight.noTarget}</span>;
    case 'nodata':
      return <span className="qs-mut">{S.noData}</span>;
    default:
      return <Dash />;
  }
}

function FailedInspection({ r, failed }: { r: StationRowModel; failed: boolean }): ReactNode {
  const p = pct(r.failedPct);
  if (p == null) return <span className="qs-mut">{S.noData}</span>;
  return (
    <>
      <b>{p}</b>
      <span className="qs-sub">{failed || r.failedN == null ? SF.dash : S.conesSub(fmt.fmtInt(r.failedN))}</span>
    </>
  );
}

function FailedWeight({ r, failed }: { r: StationRowModel; failed: boolean }): ReactNode {
  if (failed) return <Dash />;
  const p = pct(r.weightFailPct);
  if (p == null) return <span className="qs-mut">{S.noData}</span>;
  return <>{p}</>;
}

export function StationsTable(p: StationsTableProps) {
  const phone = useMediaQuery('(max-width: 767px)');
  const wrap = useRef<HTMLDivElement>(null);
  const [cue, setCue] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el || phone) return;
    const check = () => setCue(el.scrollWidth > el.clientWidth + 1 && el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', check);
      ro?.disconnect();
    };
  }, [phone, p.rows.length]);
  const key = (e: KeyboardEvent, n: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      p.onOpen(n);
    }
  };

  if (phone) {
    return (
      <div className="qs-cards" role="list" aria-label={S.tableAria}>
        {p.rows.map((r) => (
          <PhoneCard key={r.station} r={r} p={p} onKey={key} />
        ))}
      </div>
    );
  }

  return (
    <div className="ui-dt">
      <div className="ui-dt__frame">
        <div ref={wrap} className="ui-dt__wrap qs-wrap" tabIndex={0} role="region" aria-label={S.tableAria}>
          <table className="ui-dt__table qs-table">
            <caption className="ui-sr">{S.tableAria}</caption>
            <thead>
              <tr className="qs-group">
                <th colSpan={6} scope="colgroup" className="qs-group__period">
                  {S.thisPeriod(p.periodSpan)}
                </th>
                <th colSpan={2} scope="colgroup" className="qs-pat qs-pat--l qs-pat--r qs-pat--head">
                  {p.patternSpan ? S.patternHead(p.patternSpan) : S.patternHeadShort}
                </th>
                <th className="ui-dt__chev-col" aria-hidden="true" />
              </tr>
              <tr>
                <th scope="col">{S.colStation}</th>
                <th scope="col">{S.colState}</th>
                <th scope="col" className="ui-dt__num">{S.colCones}</th>
                <th scope="col" className="ui-dt__num">{S.colFailedInspection}</th>
                <th scope="col" className="ui-dt__num">{S.colFailedWeight}</th>
                <th scope="col" className="ui-dt__num">{S.colVsTarget}</th>
                <th scope="col" className="ui-dt__num qs-pat qs-pat--l">{S.colDaysNote}</th>
                <th scope="col" className="qs-pat qs-pat--r">{S.colResult}</th>
                <th scope="col" className="ui-dt__chev-col">
                  <span className="ui-sr">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((r, i) => {
                const last = i === p.rows.length - 1;
                return (
                  <tr
                    key={r.station}
                    className={`ui-dt__row ui-dt__row--open${p.selected === r.station ? ' qs-sel' : ''}`}
                    data-station={r.station}
                    tabIndex={0}
                    aria-label={S.open(stationText(r))}
                    onClick={() => p.onOpen(r.station)}
                    onKeyDown={(e) => key(e, r.station)}
                  >
                    <td className="qs-name">
                      <b>{stationText(r)}</b>
                      <span className="qs-sub">{r.product ?? S.noProduct}</span>
                    </td>
                    <td>
                      <StatusPill state={r.state} />
                    </td>
                    <td className="ui-dt__num">{fmt.fmtInt(r.cones)}</td>
                    <td className="ui-dt__num">
                      <FailedInspection r={r} failed={p.countsFailed} />
                    </td>
                    <td className="ui-dt__num">
                      <FailedWeight r={r} failed={p.countsFailed} />
                    </td>
                    <td className="ui-dt__num">
                      <TargetValue cell={r.target} failed={false} />
                    </td>
                    <td className={`ui-dt__num qs-pat qs-pat--l${last ? ' qs-pat--b' : ''}`}>{patternDays(r.pattern, p.patternFailed)}</td>
                    <td className={`qs-pat qs-pat--r qs-pat--result${last ? ' qs-pat--b' : ''}`}>
                      <PatternResult cell={r.pattern} failed={p.patternFailed} />
                    </td>
                    <td className="ui-dt__chev-col" aria-hidden="true">
                      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 5l5 5-5 5" />
                      </svg>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {cue && <div className="ui-dt__fade" aria-hidden="true" />}
      </div>
      {cue && <div className="ui-dt__cue">{C.ui.scrollForMore}</div>}
    </div>
  );
}

function PhoneCard({ r, p, onKey }: { r: StationRowModel; p: StationsTableProps; onKey: (e: KeyboardEvent, n: number) => void }) {
  const [all, setAll] = useState(false);
  return (
    <div
      className="ui-dt__card ui-dt__card--open"
      role="listitem"
      tabIndex={0}
      data-station={r.station}
      aria-label={S.open(stationText(r))}
      onClick={() => p.onOpen(r.station)}
      onKeyDown={(e) => onKey(e, r.station)}
    >
      <div className="ui-dt__card-title qs-card-title">
        <span>{stationText(r)}</span>
        <StatusPill state={r.state} />
      </div>
      <span className="qs-sub">{r.product ?? S.noProduct}</span>
      <dl className="ui-dt__card-fields">
        <div>
          <dt>{S.colCones}</dt>
          <dd>{fmt.fmtInt(r.cones)}</dd>
        </div>
        <div>
          <dt>{S.colFailedInspection}</dt>
          <dd><FailedInspection r={r} failed={p.countsFailed} /></dd>
        </div>
        {all && (
          <>
            <div>
              <dt>{S.colFailedWeight}</dt>
              <dd><FailedWeight r={r} failed={p.countsFailed} /></dd>
            </div>
            <div>
              <dt>{S.colVsTarget}</dt>
              <dd><TargetValue cell={r.target} failed={false} /></dd>
            </div>
          </>
        )}
      </dl>
      {all && (
        <div className="qs-pat qs-pat-card">
          <p className="qs-pat-card__head">{S.phonePattern}</p>
          <dl className="ui-dt__card-fields">
            <div>
              <dt>{S.colDaysNote}</dt>
              <dd>{patternDays(r.pattern, p.patternFailed)}</dd>
            </div>
            <div>
              <dt>{S.colResult}</dt>
              <dd><PatternResult cell={r.pattern} failed={p.patternFailed} /></dd>
            </div>
          </dl>
        </div>
      )}
      {!all && (
        <button
          type="button"
          className="ui-link"
          onClick={(e) => {
            e.stopPropagation();
            setAll(true);
          }}
        >
          {C.ui.showAll}
        </button>
      )}
    </div>
  );
}
