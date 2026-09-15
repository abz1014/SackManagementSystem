/**
 * Tiny in-memory TTL cache (ARCHITECTURE §9). No Redis — the sidecar already
 * isolates IFL; this just smooths repeated dashboard refreshes. Trigger to
 * revisit Redis: measured app-DB strain under real concurrency.
 */
export class TtlCache<V> {
  private store = new Map<string, { expires: number; value: V }>();
  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    // <=, so a TTL of zero never serves a hit — "expires now" is expired.
    if (hit.expires <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    const now = Date.now();
    // Sweep expired entries on every write (roadmap Phase 11, 14 Sep 2026).
    // Expiry used to be enforced only on re-read of the SAME key, so a key
    // that was written once and never asked for again — a replay instant
    // (`live:<asOf>`), a one-off attention window — stayed in the map for the
    // life of the process. Bounded by the number of distinct keys ever seen,
    // which for a demo replaying many instants is not bounded at all. Writes
    // are rare next to reads (one per TTL per key), so the sweep is cheap.
    for (const [k, hit] of this.store) {
      if (hit.expires <= now) this.store.delete(k);
    }
    this.store.set(key, { expires: now + this.ttlMs, value });
  }

  /** Entries held — for the test that proves the sweep. */
  get size(): number {
    return this.store.size;
  }

  /** Drop everything — for a configuration write that must show on the next read. */
  clear(): void {
    this.store.clear();
  }
}
