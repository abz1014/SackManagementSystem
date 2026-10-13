/**
 * Bridge for Quality > Register (task E8): the register's print masthead is reused as it is
 * (it states line, period, generated-at on the plant clock, and a degraded block when its fetch fails;
 * it never substitutes the browser's clock). Kept in its own file so no other bridge file is touched.
 *
 * Dates (fix-wave T7a1, owner decision 13 Oct 2026): the Register is not an IFL report, so its masthead prints the app's one
 * format ("1 Sep 2026", "1 Sep 2026 21:33"), not the IFL house-style "01-09-2026" the IFL report mastheads keep.
 */
import type { ComponentProps } from 'react';
import { RegisterPrintHead as OldRegisterPrintHead } from '../../../web/src/screens/report/PrintHead';
import { NonIflDateFmt } from './dateFmt';

export function RegisterPrintHead(props: ComponentProps<typeof OldRegisterPrintHead>) {
  return (
    <NonIflDateFmt>
      <OldRegisterPrintHead {...props} />
    </NonIflDateFmt>
  );
}
