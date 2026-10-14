// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GenerationDisclosure } from '../../../web/src/screens/report/PrintHead';
import type { ReportHeader } from '../../../web/src/api';
import { NextDisclosureText } from './disclosureText';

const header = {
  spansGenerations: true,
  simulatorSource: false,
  sourceGeneration: 'IFL data batch 3',
  otherGenerationExcluded: { count: 1234, percent: null, simulator: 0 },
  generationLine: 'Data batch: IFL data batch 3. Excluded from another data batch: 1234 readings.',
} as unknown as ReportHeader;

describe('report provenance line', () => {
  it('the old renderer keeps its text by default', () => {
    const { container } = render(<GenerationDisclosure header={header} />);
    expect(container.textContent).toContain('Data batch');
  });
  it('web-next says it in effect words, with no "data batch"', () => {
    const { container } = render(<NextDisclosureText><GenerationDisclosure header={header} /></NextDisclosureText>);
    expect(container.textContent).toBe('1,234 readings from before the 5 Aug 2026 IFL database rebuild are not counted.');
    expect(container.textContent?.toLowerCase()).not.toContain('batch');
  });
  it('a simulator-only period is still disclosed, plainly', () => {
    const h = { ...header, spansGenerations: false, simulatorSource: true } as ReportHeader;
    const { container } = render(<NextDisclosureText><GenerationDisclosure header={h} /></NextDisclosureText>);
    expect(container.textContent).toContain('test data');
  });
});
