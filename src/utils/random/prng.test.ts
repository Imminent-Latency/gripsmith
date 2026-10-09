import { describe, it, expect } from 'vitest';
import { makeRng, hashLabel, rngFor, DEFAULT_SEED, type Rng } from './prng';

const draws = (rng: Rng, n: number) => Array.from({ length: n }, () => rng());

describe('mulberry32 PRNG', () => {
  it('DEFAULT_SEED is 1', () => {
    expect(DEFAULT_SEED).toBe(1);
  });

  it('makeRng(1) twice produces the same first 100 draws', () => {
    expect(draws(makeRng(1), 100)).toEqual(draws(makeRng(1), 100));
  });

  it('makeRng(1) and makeRng(2) produce different sequences', () => {
    expect(draws(makeRng(1), 100)).not.toEqual(draws(makeRng(2), 100));
  });

  it('every draw is in [0, 1) over 10000 draws', () => {
    const rng = makeRng(12345);
    for (let i = 0; i < 10000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  // E1 — mulberry32 advances its state before mixing, so seed 0 is a good stream.
  it('makeRng(0) is reproducible and not constant', () => {
    const a = draws(makeRng(0), 100);
    expect(draws(makeRng(0), 100)).toEqual(a);
    expect(new Set(a).size).toBeGreaterThan(1);
    expect(a).not.toEqual(draws(makeRng(1), 100));
  });

  // E2 — NaN >>> 0 === 0, so a hand-edited NaN seed degrades to stream 0.
  it('makeRng(NaN) matches makeRng(0), and floats truncate', () => {
    expect(draws(makeRng(NaN), 50)).toEqual(draws(makeRng(0), 50));
    expect(draws(makeRng(3.7), 50)).toEqual(draws(makeRng(3), 50));
  });
});

describe('hashLabel and rngFor', () => {
  it('hashLabel is a stable uint32', () => {
    const h = hashLabel(1, 'pos');
    expect(h).toBe(hashLabel(1, 'pos'));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it('different labels and different seeds hash differently', () => {
    expect(hashLabel(1, 'pos')).not.toBe(hashLabel(1, 'rot'));
    expect(hashLabel(1, 'pos')).not.toBe(hashLabel(2, 'pos'));
  });

  // §4.3 — two independent streams from one persisted seed.
  it("rngFor(1, 'pos') and rngFor(1, 'rot') produce different sequences", () => {
    expect(draws(rngFor(1, 'pos'), 100)).not.toEqual(draws(rngFor(1, 'rot'), 100));
  });

  it('rngFor is reproducible for the same seed and label', () => {
    expect(draws(rngFor(7, 'pos'), 100)).toEqual(draws(rngFor(7, 'pos'), 100));
  });
});
