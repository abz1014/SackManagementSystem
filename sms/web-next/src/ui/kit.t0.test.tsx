// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { KpiCard } from './KpiCard';
import { ChartSkeleton, KpiRowSkeleton, Skeleton } from './Skeleton';
import { PageHead } from './PageHead';

afterEach(cleanup);

describe('KpiCard (fix-wave T0)', () => {
  it('loading renders the same slots as a loaded card, with placeholder bars', () => {
    const { container } = render(<KpiCard label="Cones produced" loading />);
    const card = container.querySelector('.kpi')!;
    expect(card.getAttribute('data-status')).toBe('loading');
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect(card.querySelector('.kpi-chip')).toBeTruthy();
    expect(card.querySelector('.kpi-label')).toBeTruthy();
    expect(card.querySelectorAll('.kpi-skel').length).toBeGreaterThanOrEqual(2);
    expect(card.textContent).toContain('Cones produced');
  });
  it('the label keeps its text and the help button sits beside it, outside the clamp', () => {
    const { container } = render(<KpiCard label="A very long label that wraps onto a second line" value="12" unit="kg" info="How it is counted" />);
    const label = container.querySelector('.kpi-label')!;
    expect(label.textContent).toContain('A very long label');
    expect(label.querySelector('.kpi-info')).toBeNull();
    expect(container.querySelector('.kpi-head .kpi-info')).toBeTruthy();
  });
  it('value and unit are separate wrapping items', () => {
    const { container } = render(<KpiCard label="Weight" value="1,950" unit="g" />);
    const v = container.querySelector('.kpi-value')!;
    expect(v.querySelector('.kpi-figure')?.textContent).toBe('1,950');
    expect(v.querySelector('.kpi-unit')?.textContent).toBe('g');
    expect(v.textContent).toBe('1,950g');
  });
});

describe('Skeleton helpers', () => {
  it('rows renders a header and N body rows at the table row height', () => {
    const { container } = render(<Skeleton part="the table" rows={5} />);
    expect(container.querySelectorAll('.ui-skel__row')).toHaveLength(5);
    expect(container.querySelector('.ui-skel__head')).toBeTruthy();
    expect((container.querySelector('.ui-skel__row') as HTMLElement).style.height).toBe('var(--row-h)');
  });
  it('rowHeight overrides', () => {
    const { container } = render(<Skeleton part="the table" rows={2} rowHeight={60} />);
    expect((container.querySelector('.ui-skel__row') as HTMLElement).style.height).toBe('60px');
  });
  it('KpiRowSkeleton renders real loading KpiCards', () => {
    const { container } = render(<KpiRowSkeleton cards={3} />);
    expect(container.querySelectorAll('.kpi.kpi-loading')).toHaveLength(3);
  });
  it('ChartSkeleton uses the Frame card box and plot height', () => {
    const { container } = render(<ChartSkeleton part="the chart" height={180} />);
    expect(container.querySelector('.ck-frame')).toBeTruthy();
    expect((container.querySelector('.ck-skel') as HTMLElement).style.height).toBe('180px');
  });
});

describe('PageHead', () => {
  it('has one h1, one sentence and optional actions', () => {
    const { container } = render(<PageHead title="Weight" sentence="How heavy the cones are." actions={<a href="#">Open TV wall</a>} />);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('.ui-pagehead__sentence')?.textContent).toBe('How heavy the cones are.');
    expect(container.querySelector('.ui-pagehead__actions a')?.textContent).toBe('Open TV wall');
  });
  it('omits empty sentence and actions', () => {
    const { container } = render(<PageHead title="Weight" />);
    expect(container.querySelector('.ui-pagehead__sentence')).toBeNull();
    expect(container.querySelector('.ui-pagehead__actions')).toBeNull();
  });
});
