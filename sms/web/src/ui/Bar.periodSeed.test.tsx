// @vitest-environment jsdom
/**
 * X-2 (owner, 8 Oct 2026). User impact: clicking "Custom range" or "Pick dates" jumped to the plant clock's today
 * (8 Oct, while the data ends 7 Sep), so the page went blank. Both buttons must start from the period already shown.
 * Runs without a session: pure component, no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PeriodControl } from './Bar';
import { resolvePeriod, type PeriodParams } from '../lib/period';

const NOW = '2026-10-08T10:00:00.000Z';
const anchor = {
  shiftDate: '2026-10-08', shiftCode: 'morning' as const, shiftStartUtc: '2026-10-08T06:00:00.000Z',
  plantNowUtc: NOW, dataAsOfUtc: '2026-09-07T16:41:00.000Z',
};

function setup(value: PeriodParams) {
  const onChange = vi.fn();
  const current = resolvePeriod(value.key, anchor, value.picked, value.range);
  render(<PeriodControl value={value} onChange={onChange} plantNowUtc={NOW} current={current} />);
  return onChange;
}

describe('PeriodControl seeds from the period on screen (X-2)', () => {
  afterEach(cleanup);

  it('Pick dates from a range keeps the range days, not the plant clock week', () => {
    const range = { from: { date: '2026-09-05', shift: 'morning' as const }, to: { date: '2026-09-07', shift: 'night' as const } };
    const onChange = setup({ key: 'range', range });
    fireEvent.click(screen.getByRole('button', { name: 'Pick dates' }));
    expect(onChange).toHaveBeenCalledWith({ key: 'pick', picked: { from: '2026-09-05', to: '2026-09-07' } });
  });

  it('Custom range from picked dates covers those whole days', () => {
    const onChange = setup({ key: 'pick', picked: { from: '2026-09-01', to: '2026-09-07' } });
    fireEvent.click(screen.getByRole('button', { name: /Custom range/ }));
    expect(onChange).toHaveBeenCalledWith({
      key: 'range',
      range: { from: { date: '2026-09-01', shift: 'morning' }, to: { date: '2026-09-07', shift: 'night' } },
    });
  });

  it('Custom range from a single shift is that one shift', () => {
    const onChange = setup({ key: 'shift' });
    fireEvent.click(screen.getByRole('button', { name: /Custom range/ }));
    expect(onChange).toHaveBeenCalledWith({
      key: 'range',
      range: { from: { date: '2026-10-08', shift: 'morning' }, to: { date: '2026-10-08', shift: 'morning' } },
    });
  });

  it('clicking the range already shown changes nothing', () => {
    const range = { from: { date: '2026-09-05', shift: 'morning' as const }, to: { date: '2026-09-07', shift: 'night' as const } };
    const onChange = setup({ key: 'range', range });
    fireEvent.click(screen.getByRole('button', { name: /5 Sep/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never sends a bare range when a period is on screen', () => {
    const onChange = setup({ key: 'week' });
    fireEvent.click(screen.getByRole('button', { name: /Custom range/ }));
    expect(onChange.mock.calls[0]![0].range).toBeTruthy();
  });
});
