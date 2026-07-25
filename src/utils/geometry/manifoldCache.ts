import { SerializedShape, SerializedGeometry } from './serialize';

/**
 * Content-keyed LRU for long-lived wasm objects (CrossSections, cutter solids, the
 * pattern unit).
 *
 * Scrubbing a setting re-runs the whole pipeline, but almost nothing the pipeline builds
 * actually changed: dragging "pattern scale" leaves the base outline, its eroded clip
 * region, the hole cutters and the pattern unit all byte-identical, yet each was being
 * rebuilt from scratch every frame — and building the outline cutter alone (CrossSection
 * + offset + extrude on a ~4800 point contour) costs more than the boolean it feeds.
 *
 * Entries are keyed by a hash of the geometry they were derived from plus whatever
 * parameters shaped them, so a hit is only ever an identical object. Manifold objects use
 * value semantics — a derived object stays valid after its source is freed (covered by a
 * test in manifoldCache.test.ts) — so evicting a source cannot invalidate anything built
 * from it.
 */

/** FNV-1a over the raw bits of a number sequence. Fast and stable across runs. */
class Hasher {
  private h = 0x811c9dc5;
  private buf = new DataView(new ArrayBuffer(8));

  num(v: number): this {
    // Hash the exact float bits so 0 / -0 and any rounding difference are distinguished.
    this.buf.setFloat64(0, v);
    for (let i = 0; i < 8; i++) {
      this.h ^= this.buf.getUint8(i);
      this.h = Math.imul(this.h, 0x01000193);
    }
    return this;
  }

  nums(v: ArrayLike<number>): this {
    this.num(v.length);
    for (let i = 0; i < v.length; i++) this.num(v[i]);
    return this;
  }

  str(s: string): this {
    this.num(s.length);
    for (let i = 0; i < s.length; i++) {
      this.h ^= s.charCodeAt(i);
      this.h = Math.imul(this.h, 0x01000193);
    }
    return this;
  }

  get value(): string {
    return (this.h >>> 0).toString(36);
  }
}

export function hashShapes(shapes: SerializedShape[]): string {
  const h = new Hasher();
  h.num(shapes.length);
  for (const s of shapes) {
    h.nums(s.points);
    h.num(s.holes.length);
    for (const hole of s.holes) h.nums(hole);
  }
  return h.value;
}

export function hashGeometry(g: SerializedGeometry): string {
  const h = new Hasher();
  h.nums(g.position);
  if (g.index) h.nums(g.index);
  return h.value;
}

export function hashParams(...parts: (number | string | boolean | undefined)[]): string {
  const h = new Hasher();
  for (const p of parts) {
    if (typeof p === 'string') h.str(p);
    else if (typeof p === 'boolean') h.num(p ? 1 : 0);
    else if (p === undefined) h.num(NaN);
    else h.num(p);
  }
  return h.value;
}

interface Deletable {
  delete(): void;
}

export class WasmCache {
  /** Map iteration order is insertion order, which we re-establish on every hit. */
  private entries = new Map<string, Deletable>();
  private hits = 0;
  private misses = 0;

  /**
   * SAFETY INVARIANT: eviction frees the object, so a caller must never still be holding an
   * entry that eviction can reach. Eviction always removes the *least* recently used entry,
   * so anything touched during the current job is safe as long as `max` comfortably exceeds
   * the number of entries a single job touches. Today a job touches at most ~4 (pattern
   * unit, outline cutter, hole cutter, and the inlay pass's two), against a limit of 48.
   *
   * The corollary is the important one: never cache objects produced inside an unbounded
   * loop. Doing that for the recolour mask chain (~100 sub-shapes, one contour per
   * overlapping pair) overflowed the cache mid-job and handed back freed objects.
   */
  constructor(private readonly max = 48) {}

  /**
   * Return the cached object for `key`, or build, store and return it.
   *
   * `make` must return an object the caller does NOT also register for per-job disposal —
   * the cache owns its entries and frees them on eviction.
   */
  getOrCreate<T extends Deletable>(key: string, make: () => T): T {
    const found = this.entries.get(key);
    if (found) {
      this.hits++;
      // Refresh recency.
      this.entries.delete(key);
      this.entries.set(key, found);
      return found as T;
    }
    this.misses++;
    const made = make();
    this.entries.set(key, made);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      const victim = this.entries.get(oldest.value)!;
      this.entries.delete(oldest.value);
      try { victim.delete(); } catch { /* already freed */ }
    }
    return made;
  }

  get stats() {
    return { size: this.entries.size, hits: this.hits, misses: this.misses };
  }

  clear() {
    for (const v of this.entries.values()) {
      try { v.delete(); } catch { /* already freed */ }
    }
    this.entries.clear();
  }
}

/**
 * Process-wide cache. Lives for the life of the worker, so it warms on the first
 * generation and every subsequent settings change reuses it.
 */
export const geometryCache = new WasmCache(48);
