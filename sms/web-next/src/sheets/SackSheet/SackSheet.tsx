/** Sack sheet (`sheet=sack:<id>`, TRACE A6-S3, A3-056): the cones since the previous sack, as an approximate count. */
import type { SheetProps } from '../../screens/registry';
import { ReadingSheet } from '../ConeSheet/ReadingSheet';

export function SackSheet(props: SheetProps) {
  return <ReadingSheet {...props} kind="sack" />;
}
