import { forwardRef } from 'react';
import { C } from '../copy';
import { StatusPill, STATE_WORD, type UiState } from './StatusPill';
import '../components/state.css';

/** Mirrors api/src/services/stationStatus.ts StationStatusRow. State arrives decided. */
export interface StationItem {
  station: number;
  name: string | null;
  cones: number;
  failedPct: number | null;
  state: UiState;
  reasons: string[];
  vsTargetG: number | null;
  product: string | null;
}

export function stationText(s: Pick<StationItem, 'station' | 'name'>): string {
  return s.name ? C.stationWithName(s.station, s.name) : C.station(s.station);
}

export interface StationTileProps {
  item: StationItem;
  tabIndex?: number;
  onOpen?: (station: number) => void;
}

export const StationTile = forwardRef<HTMLButtonElement, StationTileProps>(function StationTile(
  { item, tabIndex, onOpen },
  ref,
) {
  const label = stationText(item);
  const nodata = item.state === 'nodata';
  return (
    <button
      ref={ref}
      type="button"
      className={`tile tile-${item.state}`}
      data-station={item.station}
      data-state={item.state}
      tabIndex={tabIndex}
      onClick={() => onOpen?.(item.station)}
    >
      <span className="tile-top">
        <span className="tile-name">{label}</span>
        <StatusPill state={item.state} compact />
      </span>
      <span className="tile-big">
        {nodata || item.failedPct == null ? C.state.noData : `${item.failedPct.toFixed(1)}%`}
      </span>
      <span className="tile-small">
        {nodata ? C.noCones : `${C.stationUi.failedInspection.toLowerCase()} · ${C.stationUi.cones(item.cones)}`}
      </span>
      {!nodata && (
        <span className="tile-small">
          {item.vsTargetG != null ? `${C.stationUi.vsTarget(item.vsTargetG)} · ` : ''}
          {item.product ?? C.stationUi.noProduct}
        </span>
      )}
      <span className="tile-state-word">{STATE_WORD[item.state]}</span>
    </button>
  );
});
