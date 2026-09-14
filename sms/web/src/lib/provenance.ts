/**
 * The reading sheet's provenance lines that are more than a field printed
 * as-is (roadmap Phase 3, 14 Sep 2026).
 *
 * There is exactly one: `attribution_method` is a code ('source_column',
 * 'none', 'manual_entry') and the sheet must say it in words. The mapping
 * lives here rather than inline so it can be tested without a DOM, and so
 * a value this client has never heard of — a method a later transform
 * version adds — is printed as itself rather than silently swallowed into
 * "not recorded", which is what `null` means and a different fact.
 */
import { W } from './words';

const METHOD: Record<string, string> = W.readings.prov.attribution;
const CONFIDENCE: Record<string, string> = W.readings.prov.confidence;

/**
 * How the product on a reading was determined, with the confidence when the
 * server stated one. `null` method → "not recorded", with no confidence
 * appended: "not recorded (low confidence)" would claim a judgement was
 * made about something that was never recorded.
 */
export function describeAttribution(
  method: string | null | undefined,
  confidence: string | null | undefined,
): string {
  if (method == null) return METHOD.unknown ?? '';
  const how = METHOD[method] ?? method;
  if (confidence == null) return how;
  return `${how} (${CONFIDENCE[confidence] ?? confidence})`;
}
