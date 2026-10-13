// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../../route';
import { QualityTabs } from './QualityTabs';

const route: Route = { s: 'quality', t: 'rejects', sheet: { kind: 'reason', id: 'x' }, wall: false, keys: { p: 'week', st: '5' } };

describe('QualityTabs', () => {
  afterEach(cleanup);
  it('shows the four tabs in one order and marks the current one', () => {
    render(<QualityTabs route={route} go={() => {}} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Weight', 'Rejects', 'Stations', 'Register']);
    expect(screen.getByRole('tab', { name: 'Rejects' }).getAttribute('aria-selected')).toBe('true');
  });
  it('keeps the period, drops tab filters and the sheet', () => {
    const go = vi.fn();
    render(<QualityTabs route={route} go={go} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Stations' }));
    expect(go).toHaveBeenCalledWith({ s: 'quality', t: 'stations', sheet: null, wall: false, keys: { p: 'week' } });
  });
});
