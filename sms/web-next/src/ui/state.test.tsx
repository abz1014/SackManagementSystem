import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '../../../web/src/testkit/render';
import { StatusPill, STATE_GLYPH, type UiState } from './StatusPill';
import { KpiCard } from './KpiCard';
import { StationHeatGrid, sortStations } from './StationHeatGrid';
import type { StationItem } from './StationTile';
import { AttentionList } from './AttentionList';

const st = (station: number, state: UiState, failedPct: number | null, over: Partial<StationItem> = {}): StationItem => ({
  station, name: null, cones: 100, failedPct, state, reasons: [], vsTargetG: null, product: null, ...over,
});

describe('StatusPill', () => {
  it.each([['ok', 'OK'], ['watch', 'Watch'], ['act', 'Act'], ['nodata', 'No data']] as const)('%s shows word and glyph', (s, word) => {
    const { container } = render(<StatusPill state={s} />);
    expect(screen.getByText(word)).toBeTruthy();
    expect(container.textContent).toContain(STATE_GLYPH[s]);
  });
  it('compact variant has a tooltip with the word', () => {
    render(<StatusPill state="act" compact />);
    expect(screen.getByRole('img').getAttribute('title')).toBe('Act');
  });
});

describe('KpiCard', () => {
  it('loading never shows 0 or a value', () => {
    const { container } = render(<KpiCard label="Cones" value="0" status="loading" />);
    expect(container.textContent).not.toMatch(/0/);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });
  it('error shows dash, message, and retries', () => {
    const retry = vi.fn();
    render(<KpiCard label="Cones" status="error" part="cones" onRetry={retry} />);
    expect(screen.getByText("Couldn't load cones.")).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    expect(retry).toHaveBeenCalled();
  });
  it('empty shows No data pill', () => {
    render(<KpiCard label="Cones" status="empty" />);
    expect(screen.getByText('No data')).toBeTruthy();
  });
  it('delta is in ink, not state-coloured, even when state is act', () => {
    const { container } = render(
      <KpiCard label="Failed" value="3.1" unit="%" state="act" delta={{ text: '0.4 pt', direction: 'up', vs: 'vs previous' }} />,
    );
    const d = container.querySelector('.kpi-delta')!;
    expect(d.className).toBe('kpi-delta');
    expect(d.textContent).toContain('▲');
    expect(container.querySelector('.kpi')!.className).toContain('kpi-act');
  });
  it('note prints under the value, and only when there is a value', () => {
    const { container, rerender } = render(<KpiCard label="Failed" value="3.1" unit="%" note="14 of 450 cones" />);
    expect(container.querySelector('.kpi-note')!.textContent).toBe('14 of 450 cones');
    expect(container.querySelector('.kpi-unit')!.textContent).toBe('%');
    rerender(<KpiCard label="Failed" value={null} note="14 of 450 cones" />);
    expect(container.querySelector('.kpi-note')).toBeNull();
  });
  it('state comes from the prop, not the number', () => {
    render(<KpiCard label="Failed" value="99.9" state="ok" />);
    expect(screen.getByText('OK')).toBeTruthy();
    expect(screen.queryByText('Act')).toBeNull();
  });
});

describe('StationHeatGrid', () => {
  it('prop state wins over conflicting numbers', () => {
    render(<StationHeatGrid stations={[st(1, 'ok', 50), st(2, 'act', 0.1)]} />);
    expect(within(screen.getByText('Station 1').closest('button')!).getAllByText('OK').length).toBeGreaterThan(0);
    expect(screen.getByText('Station 2').closest('button')!.getAttribute('data-state')).toBe('act');
  });
  it('tiles whose code and colour collide show the segment that tells them apart; full label in the tooltip', () => {
    const A = '205-IL0-SD · ORANGE · PVSD8020 · 30';
    const B = '205-IL0-SD · ORANGE · PVSD8020 · 20 Slub';
    const C = '205-IL0-SD · Blue · PVSD8020 · 30';
    render(<StationHeatGrid stations={[st(1, 'ok', 1, { product: A, productBasis: 'own' }), st(2, 'ok', 1, { product: B, productBasis: 'own' }), st(3, 'ok', 1, { product: C, productBasis: 'own' })]} />);
    const prod = (n: number) => screen.getByText('Station ' + n).closest('button')!.querySelector('[title^="205"]')!;
    expect(prod(1).textContent).toContain(A);
    expect(prod(2).textContent).toContain(B);
    expect(prod(3).textContent).toContain('205-IL0-SD · Blue');
    expect(prod(3).textContent).not.toContain('PVSD8020');
    expect(prod(2).getAttribute('title')).toBe(B);
  });
  it('sorts worst first then by failedPct desc', () => {
    const r = sortStations([st(1, 'ok', 9), st(2, 'nodata', null), st(3, 'watch', 2), st(4, 'act', 1), st(5, 'watch', 3)], 'worst');
    expect(r.map((s) => s.station)).toEqual([4, 5, 3, 2, 1]);
  });
  it('toggle sorts by number and labels use name', () => {
    render(<StationHeatGrid stations={[st(2, 'act', 5, { name: 'Alpha' }), st(1, 'ok', 1)]} />);
    expect(screen.getByText('Station 2 · Alpha')).toBeTruthy();
    expect(screen.getAllByRole('button').filter((b) => b.dataset.station)[0]?.dataset.station).toBe('2');
    fireEvent.click(screen.getByText('By station number'));
    expect(screen.getAllByRole('button').filter((b) => b.dataset.station)[0]?.dataset.station).toBe('1');
  });
  it('arrow keys move focus, Enter (click) opens', () => {
    const open = vi.fn();
    render(<StationHeatGrid stations={[st(1, 'act', 5), st(2, 'watch', 4), st(3, 'ok', 1)]} onOpen={open} />);
    const tiles = () => screen.getAllByRole('button').filter((b) => b.dataset.station) as [HTMLElement, HTMLElement, HTMLElement];
    tiles()[0].focus();
    fireEvent.keyDown(tiles()[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tiles()[1]);
    fireEvent.keyDown(tiles()[1], { key: 'End' });
    expect(document.activeElement).toBe(tiles()[2]);
    fireEvent.keyDown(tiles()[2], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tiles()[1]);
    fireEvent.click(tiles()[1]);
    expect(open).toHaveBeenCalledWith(2);
  });
  it('order is frozen while hovered and re-sorts after', () => {
    const a = [st(1, 'ok', 1), st(2, 'act', 5)];
    const { rerender } = render(<StationHeatGrid stations={a} />);
    const order = () => screen.getAllByRole('button').filter((b) => b.dataset.station).map((b) => b.dataset.station);
    expect(order()).toEqual(['2', '1']);
    const grid = screen.getByRole('group', { name: 'Stations' });
    fireEvent.mouseEnter(grid);
    rerender(<StationHeatGrid stations={[st(1, 'act', 9), st(2, 'ok', 1)]} />);
    expect(order()).toEqual(['2', '1']);
    expect(screen.getByText('Station 1').closest('button')!.getAttribute('data-state')).toBe('act');
    fireEvent.mouseLeave(grid);
    expect(order()).toEqual(['1', '2']);
  });
});

describe('AttentionList', () => {
  it('empty shows the calm line', () => {
    render(<AttentionList items={[]} />);
    expect(screen.getByText('Nothing needs attention.')).toBeTruthy();
  });
  it('renders server items as given', () => {
    const open = vi.fn();
    render(<AttentionList items={[{ id: 1, state: 'watch', sentence: 'Station 7 is 9 g below target', time: '14:30' }]} onOpen={open} />);
    expect(screen.getByText('Station 7 is 9 g below target')).toBeTruthy();
    expect(screen.getByText('Watch')).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(open).toHaveBeenCalled();
  });
});

describe('KpiCard info popover', () => {
  it('opens on click with aria-expanded, closes on Escape, hidden by default', () => {
    render(<KpiCard label="Within tolerance" value="9" info="Share of cones inside the limits." />);
    const b = screen.getByRole('button', { name: /how within tolerance is counted/i });
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(b);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('note').textContent).toContain('inside the limits');
    fireEvent.keyDown(b, { key: 'Escape' });
    expect(screen.queryByRole('note')).toBeNull();
  });
  it('shows a note without a value only when asked', () => {
    const { unmount } = render(<KpiCard label="T" value={null} note="withheld" />);
    expect(screen.queryByText('withheld')).toBeNull();
    unmount();
    render(<KpiCard label="T" value={null} note="withheld" noteWhenEmpty />);
    expect(screen.getByText('withheld')).toBeTruthy();
  });
});
