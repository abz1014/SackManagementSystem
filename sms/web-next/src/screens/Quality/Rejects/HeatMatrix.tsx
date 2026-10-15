/**
 * Reason x production day, as a real table (the 16-screen by-day list it replaces). One ramp of one hue
 * (--seq-*), light to dark; every non-zero cell also prints its number, so colour is never the only cue.
 * A cell opens the reason sheet for that reason and day. Capped by the caller (top 8, then "Show all").
 */
import { C, FRAGMENTS, pl } from '../../../copy';
import { fmt } from '../../../bridge/lib';
import { dayLabel, heatStep, HEAT_STEPS, type Heat, type HeatRow } from './model';
import { fmtRate, reasonName, reasonShort } from './format';
import './qualityRejects.css';

const R = C.qualityRejects;
const RF = FRAGMENTS.qualityRejects;

export interface HeatMatrixProps {
  heat: Heat;
  rows: HeatRow[];
  activeCode: string | null;
  onOpen: (row: HeatRow, day: string) => void;
}

const cellClass = (pct: number): string => `qr-heat__cell qr-heat__cell--s${heatStep(pct)}`;

export function HeatMatrix({ heat, rows, activeCode, onOpen }: HeatMatrixProps) {
  return (
    <div className="qr-heat">
      <div className="qr-heat__scroll" tabIndex={0} role="region" aria-label={R.heatTitle}>
        <table className="qr-heat__table">
          <caption className="ui-sr">{`${R.heatTitle}. ${R.heatCaption}`}</caption>
          <thead>
            <tr>
              <th scope="col" className="qr-heat__corner">{R.colReason}</th>
              {heat.days.map((d, i) => (
                <th key={d} scope="col" className="qr-heat__day" title={dayLabel(d)}>
                  {i === 0 || d.slice(8, 10) === '01' ? dayLabel(d).replace(/^\w+ /, '') : Number(d.slice(8, 10))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code} className={activeCode === row.code ? 'qr-heat__row qr-heat__row--on' : 'qr-heat__row'}>
                <th scope="row" className="qr-heat__name" title={reasonName(row.reason)}>
                  {reasonShort(row.reason)}
                </th>
                {row.cells.map((c) => (
                  <td key={c.day} className="qr-heat__td">
                    {c.count > 0 ? (
                      <button
                        type="button"
                        className={cellClass(c.pct)}
                        aria-label={R.heatOpen(reasonName(row.reason), dayLabel(c.day), `${fmtRate(c.pct)}, ${pl(fmt.fmtInt(c.count), 'cone', 'cones')}`)}
                        onClick={() => onOpen(row, c.day)}
                      >
                        {c.pct >= 10 ? Math.round(c.pct) : c.pct.toFixed(1)}
                      </button>
                    ) : (
                      <span className="qr-heat__cell qr-heat__cell--s0" aria-label={`${reasonName(row.reason)}, ${dayLabel(c.day)}: ${RF.heatLegendNone}`} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="qr-heat__legend" aria-label={R.heatLegendLabel}>
        <li><span className="qr-heat__swatch qr-heat__cell--s0" aria-hidden="true" />{RF.heatLegendNone}</li>
        <li><span className="qr-heat__swatch qr-heat__cell--s1" aria-hidden="true" />{`under ${HEAT_STEPS[0]} %`}</li>
        <li><span className="qr-heat__swatch qr-heat__cell--s2" aria-hidden="true" />{`under ${HEAT_STEPS[1]} %`}</li>
        <li><span className="qr-heat__swatch qr-heat__cell--s3" aria-hidden="true" />{`under ${HEAT_STEPS[2]} %`}</li>
        <li><span className="qr-heat__swatch qr-heat__cell--s4" aria-hidden="true" />{`under ${HEAT_STEPS[3]} %`}</li>
        <li><span className="qr-heat__swatch qr-heat__cell--s5" aria-hidden="true" />{`${HEAT_STEPS[3]} % or more`}</li>
      </ul>
    </div>
  );
}
