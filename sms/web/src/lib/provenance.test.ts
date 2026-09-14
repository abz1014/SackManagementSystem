import { describe, expect, it } from 'vitest';
import { describeAttribution } from './provenance';
import { W } from './words';

describe('describeAttribution', () => {
  it('says each known method in words', () => {
    expect(describeAttribution('source_column', null)).toBe(W.readings.prov.attribution.source_column);
    expect(describeAttribution('none', null)).toBe(W.readings.prov.attribution.none);
    expect(describeAttribution('manual_entry', null)).toBe(W.readings.prov.attribution.manual_entry);
  });

  it('appends the confidence when the server stated one', () => {
    expect(describeAttribution('source_column', 'high')).toBe(
      `${W.readings.prov.attribution.source_column} (${W.readings.prov.confidence.high})`,
    );
    expect(describeAttribution('none', 'low')).toBe(`${W.readings.prov.attribution.none} (${W.readings.prov.confidence.low})`);
  });

  it('reads a null method as "not recorded" and never qualifies it', () => {
    expect(describeAttribution(null, null)).toBe(W.readings.prov.attribution.unknown);
    expect(describeAttribution(undefined, undefined)).toBe(W.readings.prov.attribution.unknown);
    // A confidence beside a missing method is not a judgement about anything.
    expect(describeAttribution(null, 'low')).toBe(W.readings.prov.attribution.unknown);
  });

  it('prints a value it does not know as itself rather than as "not recorded"', () => {
    // A later transform version may add a method; the client must not turn
    // it into the sentence that means "nothing was recorded".
    expect(describeAttribution('plc_direct', null)).toBe('plc_direct');
    expect(describeAttribution('plc_direct', 'certain')).toBe('plc_direct (certain)');
  });
});
