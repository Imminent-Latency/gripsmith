/** A 0..1 uniform draw. */
export type Rng = () => number;

/** The seed every schema, job and call site defaults to. */
export const DEFAULT_SEED = 1;

/** mulberry32. Any number in; NaN/float coerced via trunc + >>> 0 (NaN >>> 0 === 0). */
export function makeRng(seed: number): Rng {
  let a = Math.trunc(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the label, mixed with the seed. Same family as the existing Hasher
 *  (src/utils/geometry/manifoldCache.ts:20-53) — reuse the idea, not the class:
 *  that one is a wasm-handle cache key and returns base36. */
export function hashLabel(seed: number, label: string): number {
  let h = (2166136261 ^ (Math.trunc(seed) >>> 0)) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = (h ^ label.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** makeRng(hashLabel(seed, label)) — one persisted seed, many independent streams. */
export const rngFor = (seed: number, label: string): Rng => makeRng(hashLabel(seed, label));
