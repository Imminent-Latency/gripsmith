import { describe, it, expect, beforeAll } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { getManifold } from './manifoldModule';
import { WasmCache, hashShapes, hashGeometry, hashParams } from './manifoldCache';
import { ManifoldOps, CUTTER_TOLERANCE } from './manifoldOps';

const square = (half: number) => ({
  points: [-half, -half, half, -half, half, half, -half, half],
  holes: [] as number[][],
});

describe('hashing', () => {
  it('is stable for identical input and differs for changed input', () => {
    expect(hashShapes([square(5)])).toBe(hashShapes([square(5)]));
    expect(hashShapes([square(5)])).not.toBe(hashShapes([square(5.0001)]));
    expect(hashShapes([square(5)])).not.toBe(hashShapes([square(5), square(2)]));
    // Hole content must participate.
    const withHole = { points: square(5).points, holes: [square(1).points] };
    expect(hashShapes([withHole])).not.toBe(hashShapes([square(5)]));
  });

  it('distinguishes 0 from -0 and different array lengths', () => {
    expect(hashParams(0)).not.toBe(hashParams(-0));
    expect(hashParams(1, 2)).not.toBe(hashParams(12));
    expect(hashParams(undefined)).toBe(hashParams(undefined));
    expect(hashParams('a', 1)).not.toBe(hashParams('a', 2));
  });

  it('hashes geometry buffers including the index', () => {
    const a = { position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), index: new Uint32Array([0, 1, 2]) };
    const b = { position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), index: new Uint32Array([0, 2, 1]) };
    expect(hashGeometry(a)).toBe(hashGeometry({ ...a }));
    expect(hashGeometry(a)).not.toBe(hashGeometry(b));
  });
});

describe('WasmCache', () => {
  it('returns the same instance on a hit and only builds once', () => {
    const cache = new WasmCache(4);
    let builds = 0;
    const make = () => { builds++; return { delete() {} }; };
    const a = cache.getOrCreate('k', make);
    const b = cache.getOrCreate('k', make);
    expect(a).toBe(b);
    expect(builds).toBe(1);
    expect(cache.stats.hits).toBe(1);
    expect(cache.stats.misses).toBe(1);
  });

  it('evicts least-recently-used entries and frees them', () => {
    const cache = new WasmCache(2);
    const freed: string[] = [];
    const mk = (id: string) => () => ({ delete() { freed.push(id); } });
    cache.getOrCreate('a', mk('a'));
    cache.getOrCreate('b', mk('b'));
    cache.getOrCreate('a', mk('a')); // refresh 'a' so 'b' is now oldest
    cache.getOrCreate('c', mk('c')); // evicts 'b'
    expect(freed).toEqual(['b']);
    expect(cache.stats.size).toBe(2);
  });

  it('clear() frees everything', () => {
    const cache = new WasmCache(8);
    const freed: string[] = [];
    cache.getOrCreate('a', () => ({ delete() { freed.push('a'); } }));
    cache.getOrCreate('b', () => ({ delete() { freed.push('b'); } }));
    cache.clear();
    expect(freed.sort()).toEqual(['a', 'b']);
    expect(cache.stats.size).toBe(0);
  });

  it('tolerates an entry that is already freed', () => {
    const cache = new WasmCache(1);
    cache.getOrCreate('a', () => ({ delete() { throw new Error('already freed'); } }));
    expect(() => cache.getOrCreate('b', () => ({ delete() {} }))).not.toThrow();
  });
});

describe('Manifold value semantics (the assumption caching relies on)', () => {
  let wasm: ManifoldToplevel;
  beforeAll(async () => { wasm = await getManifold(); }, 120000);

  it('a derived object stays valid after its source is deleted', () => {
    // Cached cutter contours are built from scratch objects that are then flushed, and
    // eviction can free a source while derived solids are still in use. Both are only safe
    // because Manifold objects do not alias their inputs.
    const ops = new ManifoldOps(wasm);
    const src = ops.Manifold.cube([10, 10, 10], true);
    const derived = src.translate(1, 2, 3);
    const deeper = derived.subtract(ops.Manifold.sphere(3, 16));
    const expectTris = deeper.numTri();

    src.delete();
    expect(derived.numTri()).toBe(12);
    derived.delete();
    expect(deeper.numTri()).toBe(expectTris);
    expect(deeper.volume()).toBeGreaterThan(0);
    deeper.delete();
    ops.flush();
  });

  /** A circle sampled far more finely than CUTTER_TOLERANCE needs. */
  const denseCircle = (R: number, n = 2000) => {
    const pts: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push(Math.cos(a) * R, Math.sin(a) * R);
    }
    return [{ points: pts, holes: [] as number[][] }];
  };

  it('cachedCutterSolid returns the same object for identical input and outlives a flush', () => {
    const dense = denseCircle(50);
    const ops = new ManifoldOps(wasm);
    const first = ops.cachedCutterSolid(dense, { height: 10, offset: -2 })!;
    const tris = first.numTri();
    expect(tris).toBeGreaterThan(0);
    ops.flush();
    // Still alive after the per-job flush, because the cache owns it (not `track`).
    expect(first.numTri()).toBe(tris);

    const ops2 = new ManifoldOps(wasm);
    const second = ops2.cachedCutterSolid(dense, { height: 10, offset: -2 })!;
    expect(second).toBe(first);
    // Any differing parameter must be a different entry.
    expect(ops2.cachedCutterSolid(dense, { height: 10, offset: -3 })).not.toBe(first);
    expect(ops2.cachedCutterSolid(dense, { height: 11, offset: -2 })).not.toBe(first);
    expect(ops2.cachedCutterSolid(dense, { height: 10, offset: -2, translateZ: -5 })).not.toBe(first);
    ops2.flush();
    expect(first.numTri()).toBe(tris);
  });

  it('returns null rather than throwing for degenerate input', () => {
    const ops = new ManifoldOps(wasm);
    expect(ops.cachedCutterSolid([], { height: 10 })).toBeNull();
    expect(ops.cachedCutterSolid([{ points: [0, 0, 1, 1], holes: [] }], { height: 10 })).toBeNull();
    expect(ops.simplifiedCs([])).toBeNull();
    ops.flush();
  });

  it('simplifiedCs decimates and is tracked (freed by flush, never cached)', () => {
    const ops = new ManifoldOps(wasm);
    const R = 50;
    const dense = denseCircle(R);
    const a = ops.simplifiedCs(dense)!;
    const verts = a.numVert();
    // Expected segment count for a circle decimated to CUTTER_TOLERANCE: the sagitta of a
    // chord subtending angle t is R(1-cos(t/2)) ~ R t^2 / 8, so t ~ sqrt(8*tol/R) and
    // n ~ 2*pi/t. Deriving it keeps this test correct if the tolerance changes.
    const expected = (2 * Math.PI) / Math.sqrt((8 * CUTTER_TOLERANCE) / R);
    expect(verts).toBeGreaterThan(expected * 0.5);
    expect(verts).toBeLessThan(expected * 2);
    expect(verts).toBeLessThan(2000); // fewer than the input, i.e. decimation happened
    // Not cached: a second call is a distinct object, so a long mask chain can never
    // evict-and-free something still in use.
    const b = ops.simplifiedCs(dense)!;
    expect(b).not.toBe(a);
    ops.flush();
  });

  it('stays within CUTTER_TOLERANCE of the original contour', () => {
    const ops = new ManifoldOps(wasm);
    const R = 50;
    const slack = CUTTER_TOLERANCE * 1.1; // allow for Clipper's own rounding
    const cs = ops.simplifiedCs(denseCircle(R))!;
    // Every retained vertex must still lie on the circle to within the tolerance.
    for (const contour of cs.toPolygons()) {
      for (const [x, y] of contour) {
        expect(Math.abs(Math.hypot(x, y) - R)).toBeLessThan(slack);
      }
    }
    // And the chords between them must not sag further than the tolerance either — that is
    // the bound simplify() actually promises, and what the printed part will follow.
    for (const contour of cs.toPolygons()) {
      const pts = contour as unknown as [number, number][];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        expect(Math.abs(Math.hypot(mx, my) - R)).toBeLessThan(slack);
      }
    }
    ops.flush();
  });

  it('a long chain of simplifiedCs subtractions never exhausts the cache', () => {
    // This is the shape of the recolour ("mask") layering pass that previously caused a
    // use-after-free once the chain exceeded the cache capacity.
    const ops = new ManifoldOps(wasm);
    const sq = (half: number, cx: number, cy: number) => ({
      points: [cx - half, cy - half, cx + half, cy - half, cx + half, cy + half, cx - half, cy + half],
      holes: [] as number[][],
    });
    const parts = Array.from({ length: 80 }, (_, i) => ops.simplifiedCs([sq(2, (i % 10) * 3, Math.floor(i / 10) * 3)])!);
    let acc = parts[0];
    for (let i = 1; i < parts.length; i++) acc = ops.track(acc.subtract(parts[i]));
    expect(() => acc.numVert()).not.toThrow();
    ops.flush();
  });
});
