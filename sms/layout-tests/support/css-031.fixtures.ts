/** CSS-031 fixtures: synthetic Readings listing rows (enough for a multi-page print) and a pdftotext page splitter. Synthetic only. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function readingRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    event_id: 900000 + i, source_row_id: 5000 + i, source_epoch: 9, source_epoch_label: 'Sample - cones',
    reject_type: 'quality', tube_inspect_code: 1, material_inspect_code: 2, reject_label: null,
    production_ts_utc: `2026-09-03T0${i % 9}:${String(10 + (i % 50)).padStart(2, '0')}:2${i % 9}Z`, shift_code: 'A', shift_date: '2026-09-03', shift_code_legacy: null,
    weight_g: 1950 + i, weight_kg: null, in_range: true, state: 'within', product_name: '205-IL0-SD',
  }));
}

const CANDIDATES = ['pdftotext', 'C:/Program Files/Git/mingw64/bin/pdftotext.exe', 'C:/msys64/mingw64/bin/pdftotext.exe'];

/** The PDF's text, one string per page (pdftotext separates pages with a form feed). */
export function pdfPages(pdf: Buffer): string[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'css031-'));
  const f = path.join(dir, 'p.pdf');
  writeFileSync(f, pdf);
  let lastErr: unknown;
  for (const bin of CANDIDATES) {
    try {
      const txt = execFileSync(bin, ['-layout', f, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const pages = txt.split('\f');
      if (pages[pages.length - 1]!.trim() === '') pages.pop();
      return pages;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`pdftotext not available: ${String(lastErr)}`);
}
