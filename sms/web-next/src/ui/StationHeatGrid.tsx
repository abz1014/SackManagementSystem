import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { C } from '../copy';
import { StationTile, type StationItem } from './StationTile';
import '../components/state.css';

const RANK = { act: 0, watch: 1, nodata: 2, ok: 3 } as const;

/** Order only: the state of each tile is whatever the server said. */
export function sortStations(items: StationItem[], by: 'worst' | 'number'): StationItem[] {
  const out = [...items];
  if (by === 'number') return out.sort((a, b) => a.station - b.station);
  return out.sort(
    (a, b) =>
      RANK[a.state] - RANK[b.state] ||
      (b.failedPct ?? -1) - (a.failedPct ?? -1) ||
      a.station - b.station,
  );
}

export interface StationHeatGridProps {
  stations: StationItem[];
  onOpen?: (station: number) => void;
  /** Initial sort. */
  sort?: 'worst' | 'number';
  /** Most tiles in one row (default 7: 14 stations make two full rows, never a short last one). */
  maxPerRow?: number;
}

export function StationHeatGrid({ stations, onOpen, sort = 'worst', maxPerRow = 7 }: StationHeatGridProps) {
  const [by, setBy] = useState<'worst' | 'number'>(sort);
  const [frozen, setFrozen] = useState<number[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const refs = useRef(new Map<number, HTMLButtonElement>());

  const sorted = useMemo(() => sortStations(stations, by), [stations, by]);
  const ordered = useMemo(() => {
    if (!frozen) return sorted;
    const pos = new Map(frozen.map((id, i) => [id, i]));
    return [...sorted].sort((a, b) => (pos.get(a.station) ?? 1e6) - (pos.get(b.station) ?? 1e6));
  }, [sorted, frozen]);

  const ids = ordered.map((s) => s.station);
  const current: number = active != null && ids.includes(active) ? active : (ids[0] ?? -1);

  const focusAt = useCallback(
    (i: number) => {
      const id = ids[Math.max(0, Math.min(ids.length - 1, i))];
      if (id === undefined) return;
      setActive(id);
      refs.current.get(id)?.focus();
    },
    [ids],
  );

  const columns = () => {
    const first = ids[0] === undefined ? undefined : refs.current.get(ids[0]);
    if (!first) return 1;
    const top = first.offsetTop;
    let n = 0;
    for (const id of ids) if (refs.current.get(id)?.offsetTop === top) n++;
    return n >= ids.length ? 1 : n;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = ids.indexOf(current);
    const map: Record<string, number> = {
      ArrowRight: i + 1,
      ArrowLeft: i - 1,
      ArrowDown: i + columns(),
      ArrowUp: i - columns(),
      Home: 0,
      End: ids.length - 1,
    };
    const target = map[e.key];
    if (target !== undefined) {
      e.preventDefault();
      focusAt(target);
    }
  };

  return (
    <div className="heat">
      <div className="heat-bar">
        <button type="button" className="heat-toggle" aria-pressed={by === 'number'} onClick={() => setBy(by === 'worst' ? 'number' : 'worst')}>
          {by === 'worst' ? C.stationUi.byNumber : C.stationUi.worstFirst}
        </button>
      </div>
      <div
        className="heat-grid"
        role="group"
        aria-label={C.stationUi.stations}
        /* D14: columns fill the width, but no tile is narrower than a seventh of it, so a wide screen never leaves an orphan row. */
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(max(var(--tile-min, 136px), calc((100% - ${maxPerRow - 1} * var(--space-3)) / ${maxPerRow})), 1fr))` }}
        onKeyDown={onKey}
        onMouseEnter={() => setFrozen(ids)}
        onMouseLeave={() => setFrozen(null)}
      >
        {ordered.map((s) => (
          <StationTile
            key={s.station}
            item={s}
            shownProducts={ordered.map((o) => o.product)}
            ref={(el) => {
              if (el) refs.current.set(s.station, el);
              else refs.current.delete(s.station);
            }}
            tabIndex={s.station === current ? 0 : -1}
            onOpen={(n) => {
              setActive(n);
              onOpen?.(n);
            }}
          />
        ))}
      </div>
    </div>
  );
}
