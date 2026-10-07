/** CSS-059 helper (6 Oct 2026): a minimal 8-bit non-interlaced PNG decoder so the spec can count changed pixels without an image library. */
import { inflateSync } from 'node:zlib';

function decodePng(buf: Buffer): { w: number; h: number; bpp: number; px: Buffer } {
  let o = 8; let w = 0; let h = 0; let ct = 0; const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString('ascii', o + 4, o + 8); const d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]!; }
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp; const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp]! : 0;
      let r = v;
      if (f === 1) r = v + a; else if (f === 2) r = v + b; else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      px[y * stride + x] = r & 255;
    }
  }
  return { w, h, bpp, px };
}

/** Pixels whose colour differs by more than 32 in any channel between two same-size screenshots. */
export function changedPixels(a: Buffer, b: Buffer): number {
  const p = decodePng(a); const q = decodePng(b);
  if (p.w !== q.w || p.h !== q.h) return Math.max(p.w * p.h, q.w * q.h);
  let n = 0;
  for (let i = 0; i < p.w * p.h; i++) {
    for (let k = 0; k < 3; k++) {
      if (Math.abs(p.px[i * p.bpp + k]! - q.px[i * q.bpp + k]!) > 32) { n++; break; }
    }
  }
  return n;
}
