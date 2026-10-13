import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { linear } from '../bridge/chart';
import { LimitBand } from './LimitBand';

describe('LimitBand on an x axis', () => {
  it('clips a band wider than the data to the plot', () => {
    const x = linear([1926, 1980], [100, 500]);
    const { container } = render(
      <svg>
        <LimitBand limits={{ lower: 1920, upper: 2000, lowerText: '1,920', upperText: '2,000' }} scale={x} axis="x" from={10} to={200} bounds={[100, 500]} />
      </svg>,
    );
    const r = container.querySelector('rect')!;
    expect(Number(r.getAttribute('x'))).toBe(100);
    expect(Number(r.getAttribute('x')) + Number(r.getAttribute('width'))).toBe(500);
    expect(container.querySelectorAll('line').length).toBe(0);
  });
});
