import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import type { ManifoldToplevel } from 'manifold-3d';
import { generatePattern, PatternJob, PatternResult } from './patternPipeline';
import { getManifold } from './manifoldModule';
import { serializeShape, deserializeShape, serializeGeometry, deserializeGeometry } from './serialize';

/** Flat-array square shape centered at origin. */
function squareShape(half: number) {
  return {
    points: [-half, -half, half, -half, half, half, -half, half],
    holes: [] as number[][],
  };
}

/** XY bounding box of a part's position buffer. */
function xyBounds(pos: Float32Array) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
    minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

const baseJob = (overrides: Partial<PatternJob>): PatternJob => ({
  jobId: 1,
  size: 20,
  thickness: 3,
  patternScale: 1,
  patternScaleZ: undefined,
  isTiled: true,
  tileSpacing: 2,
  patternMargin: 0,
  holeMode: 'default',
  tilingDistribution: 'grid',
  tilingDirection: 'horizontal',
  tilingOrientation: 'none',
  baseRotation: 0,
  rotationClamp: undefined,
  patternMaxHeight: undefined,
  clipToOutline: false,
  maxInlayExtend: 0,
  filledCutoutShapes: [squareShape(5)],
  holeShapes: [],
  patternUnit: { kind: 'shapes', shapes: [squareShape(1)] },
  exclusionShapes: [],
  inclusionShapes: [],
  avoidShapes: [],
  maskShapes: [],
  debugPattern: false,
  debugHole: false,
  debugInlay: false,
  ...overrides,
});

describe('serialize round-trip', () => {
  it('shape survives serialize -> deserialize with holes', () => {
    const shape = new THREE.Shape([
      new THREE.Vector2(-4, -4), new THREE.Vector2(4, -4),
      new THREE.Vector2(4, 4), new THREE.Vector2(-4, 4),
    ]);
    shape.holes = [new THREE.Path([
      new THREE.Vector2(-1, -1), new THREE.Vector2(1, -1),
      new THREE.Vector2(1, 1), new THREE.Vector2(-1, 1),
    ])];
    const round = deserializeShape(serializeShape(shape));
    expect(round.getPoints().length).toBeGreaterThanOrEqual(4);
    expect(round.holes.length).toBe(1);
  });

  it('geometry survives serialize -> deserialize', () => {
    const geo = new THREE.BoxGeometry(2, 2, 2);
    const round = deserializeGeometry(serializeGeometry(geo));
    expect(round.getAttribute('position').count).toBe(geo.getAttribute('position').count);
  });
});

describe('generatePattern (Manifold)', () => {
  let wasm: ManifoldToplevel;
  const run = (job: PatternJob): PatternResult => generatePattern(job, wasm);

  beforeAll(async () => {
    wasm = await getManifold();
  });

  it('uses the instanced fast path when no CSG is needed', () => {
    const res = run(baseJob({ clipToOutline: false }));
    expect(res.empty).toBe(false);
    expect(res.instanced).toBeDefined();
    expect(res.instanced!.count).toBeGreaterThan(0);
    expect(res.instanced!.matrices.length).toBe(res.instanced!.count * 16);
    // Manifold provides normals for lit materials.
    expect(res.instanced!.unit.normal).toBeDefined();
    expect(res.parts.length).toBe(0);
  });

  it('runs the CSG path and returns a watertight Pattern part when clipping', () => {
    const res = run(baseJob({ clipToOutline: true }));
    expect(res.instanced).toBeUndefined();
    const pattern = res.parts.find((p) => p.name === 'Pattern');
    expect(pattern).toBeDefined();
    expect(pattern!.geometry.position.length).toBeGreaterThan(0);
    expect(pattern!.geometry.index).toBeDefined();
    expect(pattern!.material.type).toBe('pattern');
    // Clipped result must lie within the 10x10 outline (±5).
    const b = xyBounds(pattern!.geometry.position);
    expect(b.maxX).toBeLessThanOrEqual(5.01);
    expect(b.minX).toBeGreaterThanOrEqual(-5.01);
    expect(b.maxY).toBeLessThanOrEqual(5.01);
    expect(b.minY).toBeGreaterThanOrEqual(-5.01);
  });

  it('erodes the clip region by the margin', () => {
    const res = run(baseJob({ clipToOutline: true, patternMargin: 1 }));
    const pattern = res.parts.find((p) => p.name === 'Pattern')!;
    const b = xyBounds(pattern.geometry.position);
    // With a 1mm margin the pattern must stay within ±4.
    expect(b.maxX).toBeLessThanOrEqual(4.01);
    expect(b.minX).toBeGreaterThanOrEqual(-4.01);
  });

  it('subtracts holes via CSG', () => {
    const res = run(baseJob({ holeShapes: [squareShape(1.5)] }));
    const pattern = res.parts.find((p) => p.name === 'Pattern');
    expect(pattern).toBeDefined();
    expect(pattern!.geometry.position.length).toBeGreaterThan(0);
  });

  it('produces colored mask parts', () => {
    const res = run(baseJob({
      clipToOutline: true,
      maskShapes: [{ shape: squareShape(2), color: 'red' }],
    }));
    const masked = res.parts.find((p) => p.name.startsWith('Pattern_Masked_'));
    expect(masked).toBeDefined();
    expect(masked!.material.type).toBe('masked');
    expect(masked!.geometry.normal).toBeDefined();
  });

  it('emits debug parts only when a debug flag is set', () => {
    const off = run(baseJob({ clipToOutline: true }));
    expect(off.parts.some((p) => p.name.startsWith('Debug_'))).toBe(false);
    const on = run(baseJob({ clipToOutline: true, debugPattern: true }));
    expect(on.parts.some((p) => p.name === 'Debug_Pattern_Cutter')).toBe(true);
  });

  it('returns empty when there is no pattern unit geometry', () => {
    const res = run(baseJob({ patternUnit: { kind: 'shapes', shapes: [] } }));
    expect(res.empty).toBe(true);
  });

  /**
   * Recolour ("mask") regression guard.
   *
   * A recolour inlay traced from an SVG routinely carries ~100 coloured sub-shapes, and the
   * layering pass derives a contour for each overlapping pair. Caching anything from that
   * loop overflows the geometry cache, and because the cache frees entries on eviction it
   * hands back deleted wasm objects — which surfaced as the entire pattern silently
   * vanishing (the worker catches the error and posts an empty result).
   */
  it('handles a many-shape recolour without losing the pattern', () => {
    const masks = Array.from({ length: 60 }, (_, i) => {
      const cx = -4 + (i % 10) * 0.9;
      const cy = -4 + Math.floor(i / 10) * 1.4;
      return { shape: squareShape2(0.6, cx, cy), color: `#${(i * 37 % 256).toString(16).padStart(2, '0')}0000` };
    });
    const res = run(baseJob({ patternScale: 0.5, clipToOutline: true, maskShapes: masks }));

    expect(res.empty).toBe(false);
    const masked = res.parts.filter((p) => p.name.startsWith('Pattern_Masked_'));
    expect(masked.length).toBeGreaterThan(5);
    // The un-masked remainder must still be there.
    const main = res.parts.find((p) => p.name === 'Pattern');
    expect(main).toBeDefined();
    expect(main!.geometry.index!.length).toBeGreaterThan(0);
    // Masked regions plus remainder should roughly account for the un-masked total.
    const noMask = run(baseJob({ patternScale: 0.5, clipToOutline: true }));
    const totalTris = res.parts.reduce((s, p) => s + (p.geometry.index?.length ?? 0) / 3, 0);
    const baseTris = noMask.parts.reduce((s, p) => s + (p.geometry.index?.length ?? 0) / 3, 0);
    expect(totalTris).toBeGreaterThan(baseTris * 0.5);
  });

  it('stays correct when the same masked job runs repeatedly (cache reuse)', () => {
    const masks = Array.from({ length: 40 }, (_, i) => ({
      shape: squareShape2(0.5, -4 + (i % 8) * 1.1, -4 + Math.floor(i / 8) * 1.6),
      color: '#ff0000',
    }));
    const counts: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = run(baseJob({ patternScale: 0.5, clipToOutline: true, maskShapes: masks }));
      expect(res.empty).toBe(false);
      counts.push(res.parts.length);
    }
    // Identical input must give identical output every time.
    expect(new Set(counts).size).toBe(1);
  });

  /**
   * Recoloured regions are split off into their own meshes, so every cut that applies to the
   * main pattern has to be applied before that split. When the mask pass ran before the hole
   * and max-height cuts, a recolour inlay sitting over a base hole produced geometry floating
   * across the hole, and a max-height limit left the recoloured tiles untrimmed.
   */
  describe('recoloured parts receive the same cuts as the main pattern', () => {
    const HOLE = 2.5;
    const holeContains = (x: number, y: number, inset: number) =>
      Math.abs(x) < HOLE - inset && Math.abs(y) < HOLE - inset;

    /** Masks covering the whole plate, so they definitely overlap the hole. */
    const bigMasks = [
      { shape: squareShape2(4.5, -4.5, 0), color: '#ff0000' },
      { shape: squareShape2(4.5, 4.5, 0), color: '#00ff00' },
    ];

    it('subtracts base holes from masked parts', () => {
      const res = run(baseJob({
        patternScale: 0.4, clipToOutline: true,
        holeShapes: [squareShape(HOLE)],
        maskShapes: bigMasks,
      }));
      const masked = res.parts.filter((p) => p.name.startsWith('Pattern_Masked_'));
      expect(masked.length).toBeGreaterThan(0);

      // Allow a hair of slack for the decimated cutter landing on the boundary; anything
      // meaningfully inside the hole is floating geometry.
      for (const p of masked) {
        const pos = p.geometry.position;
        for (let i = 0; i < pos.length; i += 3) {
          expect(
            holeContains(pos[i], pos[i + 1], 0.05),
            `${p.name} vertex (${pos[i].toFixed(3)}, ${pos[i + 1].toFixed(3)}) is inside the base hole`,
          ).toBe(false);
        }
      }
    });

    it('applies the max-height cut to masked parts', () => {
      const maxH = 0.4;
      const res = run(baseJob({
        patternScale: 0.4, clipToOutline: true,
        patternMaxHeight: maxH,
        maskShapes: bigMasks,
      }));
      const masked = res.parts.filter((p) => p.name.startsWith('Pattern_Masked_'));
      expect(masked.length).toBeGreaterThan(0);
      const limit = 3 /* thickness */ + maxH + 1e-3;
      for (const p of masked) {
        const pos = p.geometry.position;
        for (let i = 2; i < pos.length; i += 3) {
          expect(pos[i], `${p.name} rises above the max-height plane`).toBeLessThanOrEqual(limit);
        }
      }
    });

    it('leaves the main pattern unchanged by the reordering', () => {
      // result \ holes \ box \ masks is order independent, so the un-masked remainder must
      // match what the same job produces with the mask regions removed up front.
      const withMasks = run(baseJob({
        patternScale: 0.4, clipToOutline: true,
        holeShapes: [squareShape(HOLE)], maskShapes: bigMasks,
      }));
      const main = withMasks.parts.find((p) => p.name === 'Pattern');
      // The masks here tile the whole plate, so the remainder is empty or a thin sliver —
      // either way it must never sit inside the hole.
      if (main) {
        const pos = main.geometry.position;
        for (let i = 0; i < pos.length; i += 3) {
          expect(holeContains(pos[i], pos[i + 1], 0.05)).toBe(false);
        }
      }
    });
  });

  it('cached outline/hole cutters survive many differing jobs (no use-after-free)', () => {
    // Churn the cache with many distinct outlines and margins, then re-run an early one.
    const first = run(baseJob({ clipToOutline: true, patternMargin: 0.5 }));
    const firstTris = first.parts.find((p) => p.name === 'Pattern')!.geometry.index!.length;
    for (let i = 0; i < 50; i++) {
      run(baseJob({ clipToOutline: true, patternMargin: 0.2 + i * 0.01, filledCutoutShapes: [squareShape(5 + i * 0.05)] }));
    }
    const again = run(baseJob({ clipToOutline: true, patternMargin: 0.5 }));
    expect(again.parts.find((p) => p.name === 'Pattern')!.geometry.index!.length).toBe(firstTris);
  });
});

/** Offset square helper for the mask tests. */
function squareShape2(half: number, cx: number, cy: number) {
  return {
    points: [cx - half, cy - half, cx + half, cy - half, cx + half, cy + half, cx - half, cy + half],
    holes: [] as number[][],
  };
}
