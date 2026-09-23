/**
 * One name per product, unique within the catalogue — SERVER SIDE.
 *
 * WHY THIS EXISTS HERE AS WELL AS IN THE BROWSER (friction audit F7, 23 Sep
 * 2026). PDAS holds several materials with the same description: on this line
 * "205-IL0-SD" is six materials (ids 20, 21, 1021, 1022, 1023, 1024) and
 * "201-IH0-SD" three, differing by colour, blend, count and tube type. The
 * disambiguation was implemented in the BROWSER only
 * (`web/src/lib/productLabel.ts`), so the Product, Sack and Management-summary
 * screens showed six distinguishable rows while the CSV exports of those same
 * three reports wrote `205-IL0-SD` six times over. An exported file is what
 * actually reaches IFL — detached from the app, mailed on, opened weeks later,
 * with no row to click — so six rows with one name and six different sets of
 * numbers is worse on paper than it ever was on screen.
 *
 * This is a deliberate port of `web/src/lib/productLabel.ts`, rule for rule,
 * so the exported file and the screen say the same thing about the same
 * product. `productNames.test.ts` pins the two against each other by reading
 * the client file off disk; if one is changed the other must be too.
 *
 * WHAT ACTUALLY DISTINGUISHES THEM, measured against the sidecar on
 * 23 Sep 2026 rather than assumed: `sms.product.color` (PDAS MaterialDesc2),
 * then `sms.blend.blend`, then `sms.yarn_count.count_text`, then
 * `sms.tube_type.tube_type`. For the six `205-IL0-SD` materials colour alone
 * separates four of six (ORANGE is shared by 1021 and 1023); adding the count
 * ("30" against "20 Slub") separates the last pair. The PDAS id is the last
 * resort, printed as "#20", because it is the one thing guaranteed distinct —
 * it is never the FIRST answer, because a surrogate key is not something a
 * reader of a spreadsheet can decode.
 */

export interface ProductNameParts {
  productId: number;
  /**
   * Optional here where the browser's copy has it required, for one reason:
   * `ProductCatalogue` (productLimits.ts) has always carried the plain name
   * in its own `label` field and passes THAT in as the description, so a
   * caller — including every existing test that builds a catalogue by hand —
   * never has to restate it.
   */
  description?: string | null;
  lotCode?: string | null;
  color?: string | null;
  blend?: string | null;
  countText?: string | null;
  tubeType?: string | null;
}

/** The plain name, with no disambiguation: what the screen and the CSV both used to print. */
export function plainProductLabel(p: ProductNameParts): string {
  return p.description || p.lotCode || `Product ${p.productId}`;
}

/**
 * Labels for a whole list, made distinct where the plain names collide.
 * Products whose name is already unique keep it unchanged.
 */
export function distinctProductLabels<T extends ProductNameParts>(products: readonly T[]): Map<number, string> {
  const byName = new Map<string, T[]>();
  for (const p of products) {
    const name = plainProductLabel(p);
    byName.set(name, [...(byName.get(name) ?? []), p]);
  }
  const out = new Map<number, string>();
  for (const [name, group] of byName) {
    if (group.length === 1) {
      out.set(group[0]!.productId, name);
      continue;
    }
    // The distinguishing parts, in the order a process engineer would name
    // them; keep adding until every label in the group is unique.
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
