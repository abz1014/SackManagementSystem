/**
 * RT-017 (ENGINEERING-RED-TEAM-AUDIT-2026-09-23.md): the on-screen
 * MachineProduct matrix used to be one row per machine and one column per
 * day×shift — measured at ~102 columns on the real 34-day dev range, only
 * 17.7% of the table ever visible (`scrollWidth: 4616px` vs `clientWidth:
 * 816px`) and no sticky first column, so scrolling right lost the machine
 * label entirely. The fix (MachineProduct.tsx `MachineProductTables`)
 * transposes the SCREEN table only: machines run across, day×shift runs
 * down as rows, inside a `.mp-scroll` box with a sticky header row and a
 * sticky first column (app.css). jsdom computes no layout, so this cannot
 * assert scrolling or stickiness visually — it asserts the thing that
 * previously silently truncated: every machine × day×shift cell is present
 * somewhere in the rendered DOM, not just the first page of columns.
 */
import { describe, expect, it } from 'vitest';
import { render } from '../../testkit/render';
import { MachineProductSection } from './MachineProduct';
import type { MachineProductReportData, MachineProductRow, MachineProductColumn, MachineShiftCell } from '../../api';

const SHIFTS: MachineShiftCell['shift'][] = ['morning', 'evening', 'night'];
const MACHINES = 14;
const DAYS = 34;

function fixture(): MachineProductReportData {
  const columns: MachineProductColumn[] = [];
  for (let d = 0; d < DAYS; d++) {
    // 2026-08-05 + d days, kept as plain YYYY-MM-DD arithmetic (no Date
    // object) so every column has a genuinely distinct day, unlike a
    // modulo-28 scheme that wraps back onto earlier dates.
    const ms = Date.UTC(2026, 7, 5) + d * 86400000;
    const day = new Date(ms).toISOString().slice(0, 10);
    for (const shift of SHIFTS) columns.push({ day, shift, cones: 10 });
  }
  const rows: MachineProductRow[] = Array.from({ length: MACHINES }, (_, i) => {
    const station = i + 1;
    const cells = columns.map((c, ci) => ({
      station,
      stationName: null,
      machineName: `M${station}`,
      day: c.day,
      shift: c.shift,
      materials: [{ materialId: 100 + station, productName: `Product ${station}`, cones: 5, firstUtc: '2026-08-05T00:00:00Z', lastUtc: '2026-08-05T00:00:00Z' }],
      dominantMaterialId: 100 + station,
      cones: 5,
      changedDuringShift: false,
      // A distinctive marker so each cell can be found uniquely: cone count encodes (machine, column index).
      __ci: ci,
    })) as unknown as (MachineShiftCell | null)[];
    return {
      station, stationName: null, machineName: `M${station}`, cells, cones: cells.length * 5, materials: 1,
    };
  });
  return {
    period: { period: 'custom', from: '2026-08-01', to: '2026-09-03' },
    filters: {},
    columns,
    rows,
    changes: [],
    products: [],
    labels: {},
    conesWithoutStation: 0,
    note: 'note',
  };
}

describe('MachineProductSection — screen table (RT-017)', () => {
  it('renders every machine as a column header on screen (no page truncated to a subset of machines)', () => {
    const d = fixture();
    const { container } = render(<MachineProductSection d={d} onOpen={() => {}} />);
    const screenTable = container.querySelector('.mp-scroll table')!;
    expect(screenTable).toBeTruthy();
    const headerCells = screenTable.querySelectorAll('thead th');
    // 1 "When" column + one per machine.
    expect(headerCells.length).toBe(MACHINES + 1);
    for (let i = 1; i <= MACHINES; i++) {
      expect(screenTable.textContent).toContain(`M${i}`);
    }
  });

  it('renders one row per day×shift on screen — DAYS * 3 shifts rows, none dropped', () => {
    const d = fixture();
    const { container } = render(<MachineProductSection d={d} onOpen={() => {}} />);
    const screenTable = container.querySelector('.mp-scroll table')!;
    const bodyRows = screenTable.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(DAYS * SHIFTS.length);
  });

  it('every machine x day-shift cell (14 x 102 = 1428) is present in the screen table, not silently truncated', () => {
    const d = fixture();
    const { container } = render(<MachineProductSection d={d} onOpen={() => {}} />);
    const screenTable = container.querySelector('.mp-scroll table')!;
    const bodyRows = Array.from(screenTable.querySelectorAll('tbody tr'));
    expect(bodyRows.length).toBe(d.columns.length);
    let totalDataCells = 0;
    for (const row of bodyRows) {
      // First <td> is the day/shift label; the rest are one per machine.
      const cells = row.querySelectorAll('td');
      expect(cells.length).toBe(MACHINES + 1);
      totalDataCells += cells.length - 1;
    }
    expect(totalDataCells).toBe(MACHINES * d.columns.length);
  });

  it('a machine header opens that station on click, same as before transposing', () => {
    const d = fixture();
    let opened: number | null = null;
    const { container } = render(<MachineProductSection d={d} onOpen={(st) => { opened = st; }} />);
    const th = Array.from(container.querySelectorAll('.mp-scroll thead th')).find((el) => el.textContent?.includes('M7'))!;
    (th as HTMLElement).click();
    expect(opened).toBe(7);
  });
});
