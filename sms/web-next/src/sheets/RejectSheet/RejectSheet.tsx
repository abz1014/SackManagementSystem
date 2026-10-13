/** Inspection-fail sheet (`sheet=reject:<id>`, TRACE A6-S4, A3-056): one cone that failed inspection, and why. */
import type { SheetProps } from '../../screens/registry';
import { ReadingSheet } from '../ConeSheet/ReadingSheet';

export function RejectSheet(props: SheetProps) {
  return <ReadingSheet {...props} kind="reject" />;
}
