/**
 * Schema fingerprint (ARCHITECTURE §7). Hashes ONLY the columns we depend on,
 * so a silent type change (e.g. decimal(6,2)->float) or a dropped column is
 * caught at startup instead of corrupting canonical. Pure + unit-tested.
 */
import { createHash } from 'node:crypto';

export interface SchemaColumn {
  name: string;
  dataType: string;
  numericPrecision: number | null;
  numericScale: number | null;
  charMaxLength: number | null;
}

/** Canonical, order-independent signature over the depended-on columns. */
export function buildSchemaSignature(
  cols: SchemaColumn[],
  dependedOn: string[],
): string {
  const want = new Set(dependedOn.map((c) => c.toLowerCase()));
  const parts = cols
    .filter((c) => want.has(c.name.toLowerCase()))
    .map(
      (c) =>
        `${c.name.toLowerCase()}:${c.dataType.toLowerCase()}:` +
        `${c.numericPrecision ?? ''}:${c.numericScale ?? ''}:${c.charMaxLength ?? ''}`,
    )
    .sort();
  return parts.join('|');
}

export function computeFingerprint(
  cols: SchemaColumn[],
  dependedOn: string[],
): string {
  const sig = buildSchemaSignature(cols, dependedOn);
  return createHash('sha256').update(sig).digest('hex').slice(0, 32);
}
