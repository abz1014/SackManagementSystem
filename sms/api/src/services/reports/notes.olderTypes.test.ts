/**
 * C-114 (D-82): the ten older report types carry caveats in their JSON that the screen prints but
 * `reportNotesOf` did not return, so the CSV `report_note` rows and the workbook header sheet omitted them.
 * `reportNotesOf` now returns the same existing strings the screen prints, with no new wording.
 */
import { describe, expect, it } from 'vitest';
import { reportNotesOf } from './notes.js';

const BASIS = 'Weights as the scale recorded them (the weight basis is not yet confirmed by IFL). Targets are the limits in force.';

describe('reportNotesOf: the ten older types carry their screen notes (C-114)', () => {
  it('cone-weight returns its weight-basis note', () => {
    expect(reportNotesOf('cone-weight', { note: BASIS, generationNote: null })).toEqual([BASIS]);
  });

  it('calibration returns its method note', () => {
    const note = 'Drift is judged on daily station means against the line. Weighing data cannot tell a heavy scale from heavy cones.';
    expect(reportNotesOf('calibration', { note, stations: [] })).toEqual([note]);
  });

  it('daily returns the two-populations note, shift its time-lost note, sack its three caveats', () => {
    expect(reportNotesOf('daily', { rejectPopulations: { note: 'Two populations.' } })).toEqual(['Two populations.']);
    expect(reportNotesOf('shift', { timeLostNote: 'Time lost is measured.' })).toEqual(['Time lost is measured.']);
    expect(reportNotesOf('sack', { caveats: { time: 'T', machine: 'M', conesPerSack: 'C' } })).toEqual(['T', 'M', 'C']);
  });

  it.each(['product', 'station', 'reject', 'management-summary', 'machine-product'] as const)('%s returns its note', (t) => {
    expect(reportNotesOf(t, { note: 'N.' })).toEqual(['N.']);
  });

  it('a payload with no notes, or a non-object, yields none and never throws', () => {
    expect(reportNotesOf('cone-weight', {})).toEqual([]);
    expect(reportNotesOf('sack', { caveats: null })).toEqual([]);
    expect(reportNotesOf('daily', null)).toEqual([]);
  });
});
