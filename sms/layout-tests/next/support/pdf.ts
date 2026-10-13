/**
 * PDF text for the print specs: PyMuPDF (plain python from a fresh temp directory) reads the browser-generated PDF that
 * `page.pdf()` returned. Page text is split per page; words carry their boxes so overprint can be counted.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PY = process.env.PYTHON ?? 'python';
const SCRIPT = [
  'import sys,json,fitz',
  'd=fitz.open(sys.argv[1])',
  'print(json.dumps({"pages":[p.get_text("text") for p in d],"words":[[i,w[0],w[1],w[2],w[3],w[4]] for i,p in enumerate(d) for w in p.get_text("words")],"sizes":[[p.rect.width,p.rect.height] for p in d]}))',
].join('\n');

export interface PdfWord { page: number; x0: number; y0: number; x1: number; y1: number; t: string }
export interface PdfText { pages: string[]; words: PdfWord[]; sizes: Array<[number, number]> }

export function readPdf(pdf: Buffer): PdfText {
  const dir = mkdtempSync(path.join(tmpdir(), 'sms-next-pdf-'));
  const f = path.join(dir, 'p.pdf');
  writeFileSync(f, pdf);
  // `python -I` would hide PyMuPDF (installed in the user site), so run plain `python -c` from the fresh directory
  // that holds only this PDF: nothing else can be imported from the working directory.
  const raw = JSON.parse(execFileSync(PY, ['-c', SCRIPT, f], { cwd: dir, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })) as {
    pages: string[];
    words: Array<[number, number, number, number, number, string]>;
    sizes: Array<[number, number]>;
  };
  return { pages: raw.pages, sizes: raw.sizes, words: raw.words.map(([page, x0, y0, x1, y1, t]) => ({ page, x0, y0, x1, y1, t })) };
}

/** Pairs of words on one page whose boxes overlap (overprinted text). */
export function overlappingWordPairs(words: PdfWord[]): number {
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const a = words[i]!, b = words[j]!;
      if (a.page !== b.page) continue;
      const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const minH = Math.min(a.y1 - a.y0, b.y1 - b.y0);
      if (w > 1 && h > 0.3 * minH) n++;
    }
  }
  return n;
}

/** "Page N of M" occurrences on each page. */
export const footersPerPage = (pages: string[]) => pages.map((t) => (t.match(/Page \d+ of \d+/g) ?? []).length);
