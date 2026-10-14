/**
 * Plain wording for the "this period spans a database rebuild" line the old report renderers print (fix-wave defect 2,
 * GLOSSARY rows 115-116, 1.7): never "Data batch", never "Excluded from another data batch".
 * The old renderer's default text is untouched; this is mounted only by web-next's ReportDocument.
 */
import type { ReactNode } from 'react';
import { DisclosureTextContext, type DisclosureText } from '../../../web/src/lib/reportTextContext';
import { C } from '../copy';

export const NEXT_DISCLOSURE: DisclosureText = (h) => {
  if (h.spansGenerations) {
    const n = h.otherGenerationExcluded?.count;
    return C.rebuildNote.notCounted(n != null ? n.toLocaleString('en-GB') : null);
  }
  if (h.simulatorSource) return C.rebuildNote.testData;
  return null;
};

export function NextDisclosureText({ children }: { children: ReactNode }) {
  return <DisclosureTextContext.Provider value={NEXT_DISCLOSURE}>{children}</DisclosureTextContext.Provider>;
}
