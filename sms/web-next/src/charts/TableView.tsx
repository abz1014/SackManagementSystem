import type { ReactNode } from 'react';

export interface TableData {
  columns: string[];
  rows: ReactNode[][];
}

/** The accessible twin of every chart: the same numbers, as a real table. */
export function TableView({ caption, data }: { caption: string; data: TableData }) {
  return (
    <div className="ck-table-wrap">
      <table className="ck-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {data.columns.map((c, i) => (
              <th key={i} scope="col" className={i === 0 ? undefined : 'num'}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((cell, ci) => (ci === 0 ? <th key={ci} scope="row">{cell}</th> : <td key={ci} className="num">{cell}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
