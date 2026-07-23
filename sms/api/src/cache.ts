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
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { expires: Date.now() + this.ttlMs, value });
  }
}
