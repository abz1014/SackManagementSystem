import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { U } from './strings';
import { useMediaQuery } from './useMediaQuery';
import './components/DataTable.css';

export interface Column<T> {
  key: string;
  header: string;
  /** Cell content; default row[key]. */
  render?: (row: T) => ReactNode;
  /** Numbers: right-aligned, tabular. */
  numeric?: boolean;
  /** Present: the column can be sorted (client side) by this value. */
  sortValue?: (row: T) => string | number | null;
}
export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}
export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Whole-row click or Enter opens the Sheet. */
  onRowOpen?: (row: T) => void;
  /** Accessible name of the table. */
  caption: string;
  /** Controlled sort; leave out for client-side sorting by sortValue. */
  sort?: SortState | null;
  onSortChange?: (s: SortState) => void;
  /** Total matching rows when known: "Showing 1-50 of 1,204". */
  total?: number;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  /** Shown in the body when rows is empty (an EmptyState). The header stays. */
  empty?: ReactNode;
  /** Shown in the body for a failed fetch (an ErrorState). The header stays. */
  error?: ReactNode;
  /** Skeleton rows of the same height. */
  loading?: boolean;
  loadingRows?: number;
  /** Card list: fields shown before "Show all" (max 6). */
  cardFields?: number;
}

export function DataTable<T>(p: DataTableProps<T>) {
  const { columns, rows, rowKey, onRowOpen, caption } = p;
  const phone = useMediaQuery('(max-width: 767px)');
  const [localSort, setLocalSort] = useState<SortState | null>(null);
  const sort = p.sort !== undefined ? p.sort : localSort;

  const sorted = useMemo(() => {
    if (p.sort !== undefined || !sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    const m = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = sv(a);
      const y = sv(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * m;
    });
  }, [rows, columns, sort, p.sort]);

  const toggle = (c: Column<T>) => {
    const next: SortState = sort?.key === c.key && sort.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' };
    p.onSortChange?.(next);
    if (p.sort === undefined) setLocalSort(next);
  };

  const cell = (c: Column<T>, r: T): ReactNode => (c.render ? c.render(r) : ((r as Record<string, unknown>)[c.key] as ReactNode));

  /* scroll cue: fade + caption while a wide table is unscrolled */
  const wrap = useRef<HTMLDivElement>(null);
  const [cue, setCue] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el || phone) return;
    const check = () => setCue(el.scrollWidth > el.clientWidth + 1 && el.scrollLeft < 8);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', check);
      ro?.disconnect();
    };
  }, [phone, rows.length, columns.length]);

  const openKey = (r: T) => (e: KeyboardEvent) => {
    if (!onRowOpen) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowOpen(r);
    }
  };

  const footer = (
    <div className="ui-dt__foot">
      {rows.length > 0 && <span className="ui-dt__range">{U.showingRange(1, rows.length, p.total)}</span>}
      {p.hasMore && p.onLoadMore && (
        <button type="button" className="ui-btn" onClick={p.onLoadMore} disabled={p.loadingMore}>
          {p.loadingMore ? U.loadingMore : U.loadMore}
        </button>
      )}
    </div>
  );

  const loadingEmpty = !!p.loading && rows.length === 0;
  const state: ReactNode = p.error ?? (!loadingEmpty && rows.length === 0 ? (p.empty ?? null) : null);
  const nLoad = p.loadingRows ?? 5;

  if (phone) {
    const n = Math.min(p.cardFields ?? 4, 6);
    return (
      <div className="ui-dt ui-dt--cards">
        <div role="list" aria-label={caption}>
          {state ??
            (loadingEmpty
              ? Array.from({ length: nLoad }, (_, i) => <div key={i} className="ui-dt__card ui-dt__skel" aria-hidden="true" />)
              : sorted.map((r) => (
                  <CardRow key={rowKey(r)} columns={columns} row={r} n={n} cell={cell} onOpen={onRowOpen ? () => onRowOpen(r) : undefined} onKey={openKey(r)} />
                )))}
        </div>
        {footer}
      </div>
    );
  }

  const span = columns.length + (onRowOpen ? 1 : 0);
  return (
    <div className="ui-dt">
      <div className="ui-dt__frame">
        <div className="ui-dt__wrap" ref={wrap} tabIndex={0} role="region" aria-label={caption}>
          <table className="ui-dt__table">
            <caption className="ui-sr">{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  const sortable = !!c.sortValue || (!!p.onSortChange && p.sort !== undefined);
                  const ariaSort = sortable ? (active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined;
                  return (
                    <th key={c.key} scope="col" aria-sort={ariaSort} className={c.numeric ? 'ui-dt__num' : undefined}>
                      {sortable ? (
                        <button type="button" className="ui-dt__sort" onClick={() => toggle(c)}>
                          {c.header}
                          <span className="ui-dt__arrows" aria-hidden="true">
                            {active ? (sort!.dir === 'asc' ? '▲' : '▼') : '▲▼'}
                          </span>
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
                {onRowOpen && (
                  <th scope="col" className="ui-dt__chev-col">
                    <span className="ui-sr">Open</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {loadingEmpty ? (
                Array.from({ length: nLoad }, (_, i) => (
                  <tr key={i} className="ui-dt__skelrow" aria-hidden="true">
                    <td colSpan={span}>
                      <span className="ui-dt__skel" />
                    </td>
                  </tr>
                ))
              ) : state ? (
                <tr>
                  <td colSpan={span} className="ui-dt__state">
                    {state}
                  </td>
                </tr>
              ) : (
                sorted.map((r) => (
                  <tr
                    key={rowKey(r)}
                    className={onRowOpen ? 'ui-dt__row ui-dt__row--open' : 'ui-dt__row'}
                    tabIndex={onRowOpen ? 0 : undefined}
                    onClick={onRowOpen ? () => onRowOpen(r) : undefined}
                    onKeyDown={openKey(r)}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={c.numeric ? 'ui-dt__num' : undefined}>
                        {cell(c, r)}
                      </td>
                    ))}
                    {onRowOpen && (
                      <td className="ui-dt__chev-col" aria-hidden="true">
                        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 5l5 5-5 5" />
                        </svg>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {cue && <div className="ui-dt__fade" aria-hidden="true" />}
      </div>
      {cue && <div className="ui-dt__cue">{U.scrollForMore}</div>}
      {footer}
    </div>
  );
}

function CardRow<T>({
  columns,
  row,
  n,
  cell,
  onOpen,
  onKey,
}: {
  columns: readonly Column<T>[];
  row: T;
  n: number;
  cell: (c: Column<T>, r: T) => ReactNode;
  onOpen?: () => void;
  onKey: (e: KeyboardEvent) => void;
}) {
  const [all, setAll] = useState(false);
  const [title, ...rest] = columns;
  if (!title) return null;
  const shown = all ? rest : rest.slice(0, n - 1);
  return (
    <div className={`ui-dt__card${onOpen ? ' ui-dt__card--open' : ''}`} role="listitem" tabIndex={onOpen ? 0 : undefined} onClick={onOpen} onKeyDown={onKey}>
      <div className="ui-dt__card-title">{cell(title, row)}</div>
      <dl className="ui-dt__card-fields">
        {shown.map((c) => (
          <div key={c.key}>
            <dt>{c.header}</dt>
            <dd>{cell(c, row)}</dd>
          </div>
        ))}
      </dl>
      {rest.length > n - 1 && !all && (
        <button
          type="button"
          className="ui-link"
          onClick={(e) => {
            e.stopPropagation();
            setAll(true);
          }}
        >
          {U.showAll}
        </button>
      )}
    </div>
  );
}
