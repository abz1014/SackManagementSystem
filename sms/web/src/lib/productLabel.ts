/**
 * One name per product, unique in a list.
 *
 * PDAS holds several materials with the same description — on this line
 * "205-IL0-SD" is six materials and "201-IH0-SD" three, differing by blend,
 * count, tube or colour — so a select that prints the description alone
 * shows the same words six times and the reader cannot tell which is which
 * (seen on Rejects' product filter, 15 Sep 2026, roadmap Phase 5 check).
 * When names collide within the list, the parts that differ are appended;
 * the PDAS id is the last resort, printed as "#20", because it is the one
 * thing guaranteed distinct.
 */
export interface ProductNameParts {
  productId: number;
  description: string | null;
  lotCode?: string | null;
  color?: string | null;
  blend?: string | null;
  countText?: string | null;
  tubeType?: string | null;
}

export function productLabel(p: ProductNameParts): string {
  return p.description || p.lotCode || `Product ${p.productId}`;
}

/** Labels for a whole list, made distinct where the plain names collide. */
export function distinctProductLabels<T extends ProductNameParts>(products: T[]): Map<number, string> {
  const plain = new Map<number, string>();
  const byName = new Map<string, T[]>();
  for (const p of products) {
    const name = productLabel(p);
    plain.set(p.productId, name);
    byName.set(name, [...(byName.get(name) ?? []), p]);
  }
  const out = new Map<number, string>();
  for (const [name, group] of byName) {
    if (group.length === 1) {
      out.set(group[0]!.productId, name);
      continue;
    }
    // Try the distinguishing parts in order of how a process engineer would
    // name them; keep adding until every label in the group is unique.
    const parts: ((p: T) => string | null | undefined)[] = [
      (p) => p.color,
      (p) => p.blend,
      (p) => p.countText,
      (p) => p.tubeType,
    ];
    const labels = new Map<number, string>(group.map((p) => [p.productId, name]));
    const unique = () => new Set(labels.values()).size === group.length;
    for (const part of parts) {
      if (unique()) break;
      for (const p of group) {
        const v = part(p);
        if (v) labels.set(p.productId, `${labels.get(p.productId)} · ${v}`);
      }
    }
    if (!unique()) for (const p of group) labels.set(p.productId, `${labels.get(p.productId)} · #${p.productId}`);
    for (const [id, l] of labels) out.set(id, l);
  }
  return out;
}
