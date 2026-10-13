/**
 * Bridge for Quality > Register (task E8): the register's print masthead is reused as it is
 * (it states line, period, generated-at on the plant clock, and a degraded block when its fetch fails;
 * it never substitutes the browser's clock). Kept in its own file so no other bridge file is touched.
 */
export { RegisterPrintHead } from '../../../web/src/screens/report/PrintHead';
