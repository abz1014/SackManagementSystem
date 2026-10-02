// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PeriodControl } from './Bar';

describe('PeriodControl pick inputs (C-016)', () => {
  afterEach(cleanup);
  it('clearing From does not report a period with an empty bound', () => {
    const onChange = vi.fn();
    render(
      <PeriodControl
        value={{ key: 'pick', picked: { from: '2026-08-18', to: '2026-08-19' } }}
        onChange={onChange}
        plantNowUtc="2026-09-01T16:39:00.000Z"
      />,
    );
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } });
    for (const call of onChange.mock.calls) {
      expect(call[0].picked?.from).toBeTruthy();
    }
  });

  it('a complete valid date still changes the period', () => {
    const onChange = vi.fn();
    render(
      <PeriodControl
        value={{ key: 'pick', picked: { from: '2026-08-18', to: '2026-08-19' } }}
        onChange={onChange}
        plantNowUtc="2026-09-01T16:39:00.000Z"
      />,
    );
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-20' } });
    expect(onChange).toHaveBeenCalledWith({ key: 'pick', picked: { from: '2026-08-18', to: '2026-08-20' } });
  });
});
