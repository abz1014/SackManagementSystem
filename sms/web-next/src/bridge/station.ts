/**
 * Bridge to the existing station-sheet wording (decision E-3: reuse, never re-implement).
 * `projectionSentence` carries RT-020: a 90% range on the days-to-limit, or "drift not
 * established" when the range includes zero. web-next prints that sentence as it is.
 */
export { projectionSentence } from '../../../web/src/screens/StationSheet';
