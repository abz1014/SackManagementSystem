/** Cone sheet (`sheet=cone:<id>`, TRACE A6-S2, A3-056). The weight-check fails of the Register open here too. */
import type { SheetProps } from '../../screens/registry';
import { ReadingSheet } from './ReadingSheet';

export function ConeSheet(props: SheetProps) {
  return <ReadingSheet {...props} kind="cone" />;
}
