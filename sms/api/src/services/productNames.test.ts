/**
 * F7 (23 Sep 2026) — the six `205-IL0-SD` materials, and the export that
 * could not tell them apart.
 *
 * The fixture below is the REAL catalogue, read off the sidecar
 * (`sms.product` LEFT JOINed to `sms.blend` / `sms.yarn_count` /
 * `sms.tube_type`) on 23 Sep 2026 — not invented. Fourteen materials, of
 * which six share the description "205-IL0-SD", three share "201-IH0-SD" and
 * three share "204-ILT-BR". A fourth, "201-IHO-SD", differs from
 * "201-IH0-SD" by a letter O where the others carry a zero: it is a genuinely
 * different product whose name a reader cannot be expected to spot, which is
 * why the collision test must run on exact strings and not on anything
 * fuzzier.
 */
import { describe, expect, it } from 'vitest';
import { distinctProductLabels, plainProductLabel } from './productNames.js';

const CATALOGUE = [
  { productId: 11, description: '201-IH0-SD', color: 'PARROT', blend: 'PVSD8020', countText: '46', tubeType: 'LINE_GREEN' },
  { productId: 12, description: '201-IH0-SD', color: null, blend: 'PVSD8020', countText: '50', tubeType: 'ORANGE' },
  { productId: 13, description: '201-IH0-SD', color: null, blend: 'SLUBPVSD8020', countText: '40', tubeType: 'GREY' },
  { productId: 15, description: '201-IHO-SD', color: 'BLACK', blend: 'PVSD8020', countText: '36', tubeType: 'BROWN' },
  { productId: 14, description: '204-ILT-BR', color: 'BROWN', blend: 'PVT8020', countText: '30', tubeType: 'KHAKI' },
  { productId: 16, description: '204-ILT-BR', color: 'ORANGE', blend: 'PVT8020', countText: '20', tubeType: 'STAR_RED' },
  { productId: 18, description: '204-ILT-BR', color: 'Khaki-2', blend: 'PVT8020', countText: '30', tubeType: 'Khakhi-2' },
  { productId: 20, description: '205-IL0-SD', color: 'Star Green', blend: 'PVSD8020', countText: '18', tubeType: 'STAR_GREEN' },
  { productId: 21, description: '205-IL0-SD', color: 'Blue', blend: 'PVSD8020', countText: '36', tubeType: 'BLUE' },
  { productId: 1021, description: '205-IL0-SD', color: 'ORANGE', blend: 'PVSD8020', countText: '30', tubeType: 'ORANGE' },
  { productId: 1022, description: '205-IL0-SD', color: null, blend: 'PVSD8020', countText: '50', tubeType: 'CIR_RED' },
  { productId: 1023, description: '205-IL0-SD', color: 'ORANGE', blend: 'PVSD8020', countText: '20 Slub', tubeType: 'GREY' },
  { productId: 1024, description: '205-IL0-SD', color: 'YELLOW', blend: 'PVSD8020', countText: '36 Slub', tubeType: 'STAR_RED' },
  { productId: 17, description: 'STR-RED', color: 'ORANGE', blend: 'PVT8020', countText: '20', tubeType: 'STR-RED' },
];

describe('distinctProductLabels — the server-side disambiguator', () => {
  const labels = distinctProductLabels(CATALOGUE);

  it('gives every one of the fourteen real materials a label no other material shares', () => {
    expect(labels.size).toBe(CATALOGUE.length);
    expect(new Set(labels.values()).size).toBe(CATALOGUE.length);
  });

  it('separates the six 205-IL0-SD materials — the exact case the CSV shipped six times over', () => {
    const six = CATALOGUE.filter((p) => p.description === '205-IL0-SD').map((p) => labels.get(p.productId)!);
    expect(six).toEqual([
      '205-IL0-SD · Star Green · PVSD8020 · 18',
      '205-IL0-SD · Blue · PVSD8020 · 36',
      '205-IL0-SD · ORANGE · PVSD8020 · 30',
      '205-IL0-SD · PVSD8020 · 50',
      '205-IL0-SD · ORANGE · PVSD8020 · 20 Slub',
      '205-IL0-SD · YELLOW · PVSD8020 · 36 Slub',
    ]);
    // 1021 and 1023 are BOTH orange on the same blend: colour alone does not
    // separate them, and the count ("30" against "20 Slub") is what does.
    expect(labels.get(1021)).not.toBe(labels.get(1023));
  });

  it('leaves a name nobody else shares completely alone', () => {
    expect(labels.get(17)).toBe('STR-RED');
    // …including the near-miss pair: 201-IHO-SD (letter O) collides with
    // nothing, so it is not decorated, while the three 201-IH0-SD (zero) are.
    expect(labels.get(15)).toBe('201-IHO-SD');
    // 12 and 13 both carry a null colour, so colour alone leaves them tied
    // and the blend is appended to the whole group — including 11, which was
    // already unique. That is the rule working: one group, one basis.
    expect(labels.get(11)).toBe('201-IH0-SD · PARROT · PVSD8020');
    expect(labels.get(13)).toBe('201-IH0-SD · SLUBPVSD8020');
  });

  it('falls back to the PDAS id only when no attribute separates the group', () => {
    const twins = [
      { productId: 90, description: 'SAME', color: null, blend: null, countText: null, tubeType: null },
      { productId: 91, description: 'SAME', color: null, blend: null, countText: null, tubeType: null },
    ];
    expect([...distinctProductLabels(twins).values()]).toEqual(['SAME · #90', 'SAME · #91']);
  });

  it('plainProductLabel is the OLD behaviour — kept so the regression is visible, not to be printed', () => {
    const plain = CATALOGUE.filter((p) => p.description === '205-IL0-SD').map(plainProductLabel);
    expect(new Set(plain).size).toBe(1); // six rows, one name: the exported defect
  });

  it('falls through description → lotCode → id, as the mirror does', () => {
    expect(plainProductLabel({ productId: 7, description: null, lotCode: 'LOT-7' })).toBe('LOT-7');
    expect(plainProductLabel({ productId: 7, description: null, lotCode: null })).toBe('Product 7');
  });
});
