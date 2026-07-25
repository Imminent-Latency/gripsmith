import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ManifoldToplevel } from 'manifold-3d';
import { generatePattern, PatternJob } from './patternPipeline';
import { generateInlay, InlayJob } from './inlayPipeline';
import { getManifold } from './manifoldModule';
import { deserializeGeometry } from './serialize';

/**
 * Export merges every visible mesh with BufferGeometryUtils.mergeGeometries, which
 * silently returns null (and logs) if the geometries disagree on their attribute set or
 * on indexed-ness. Pipeline output therefore has to stay uniform: position + normal +
 * index on every lit part. This guards the export path against a change in how meshes are
 * serialized.
 */
const square = (half: number, cx = 0, cy = 0) => ({
  points: [cx - half, cy - half, cx + half, cy - half, cx + half, cy + half, cx - half, cy + half],
  holes: [] as number[][],
});

describe('export merge compatibility', () => {
  let wasm: ManifoldToplevel;
  beforeAll(async () => { wasm = await getManifold(); }, 120000);

  const patternJob = (o: Partial<PatternJob> = {}): PatternJob => ({
    jobId: 1, size: 40, thickness: 0.6, patternScale: 1, patternScaleZ: undefined,
    isTiled: true, tileSpacing: 2, patternMargin: 0, holeMode: 'default',
    tilingDistribution: 'grid', tilingDirection: 'horizontal', tilingOrientation: 'none',
    baseRotation: 0, rotationClamp: undefined, patternMaxHeight: undefined,
    clipToOutline: true, maxInlayExtend: 0,
    filledCutoutShapes: [square(10)], holeShapes: [],
    patternUnit: { kind: 'shapes', shapes: [square(1)] },
    exclusionShapes: [], inclusionShapes: [], avoidShapes: [], maskShapes: [],
    debugPattern: false, debugHole: false, debugInlay: false,
    ...o,
  });

  it('every lit pattern part carries position + normal + index', () => {
    const res = generatePattern(patternJob({ maskShapes: [{ shape: square(3), color: 'red' }] }), wasm);
    const lit = res.parts.filter((p) => p.material.type !== 'basic');
    expect(lit.length).toBeGreaterThan(0);
    for (const p of lit) {
      expect(p.geometry.normal, `${p.name} missing normals`).toBeDefined();
      expect(p.geometry.index, `${p.name} missing index`).toBeDefined();
      expect(p.geometry.normal!.length).toBe(p.geometry.position.length);
    }
  });

  it('pattern normals are unit length, never zero', () => {
    const res = generatePattern(patternJob(), wasm);
    const part = res.parts.find((p) => p.name === 'Pattern')!;
    const n = part.geometry.normal!;
    let zero = 0;
    for (let i = 0; i < n.length; i += 3) {
      if (Math.hypot(n[i], n[i + 1], n[i + 2]) < 1e-6) zero++;
    }
    expect(zero).toBe(0);
    expect(n.length / 3).toBeGreaterThan(0);
  });

  it('the instanced fast path also emits real normals', () => {
    const res = generatePattern(patternJob({ clipToOutline: false }), wasm);
    const n = res.instanced!.unit.normal!;
    let zero = 0;
    for (let i = 0; i < n.length; i += 3) if (Math.hypot(n[i], n[i + 1], n[i + 2]) < 1e-6) zero++;
    expect(zero).toBe(0);
  });

  it('inlay parts carry normals too', () => {
    const job: InlayJob = {
      jobId: 1, thickness: 0.6, cutterExtra: 0,
      filledCutoutShapes: [square(10)], holeShapes: [square(1.5)],
      items: [{
        id: 'a', itemIndex: 0, scale: 2, rotation: 10, mirror: false, x: 0, y: 0,
        depth: 0.4, extend: 0, positions: [{ x: 0, y: 0, rot: 0 }],
        shapes: [{ shape: square(3), color: 'white' }],
      }],
    };
    const res = generateInlay(job, wasm);
    expect(res.parts.length).toBeGreaterThan(0);
    for (const p of res.parts) {
      expect(p.geometry.normal).toBeDefined();
      let zero = 0;
      const n = p.geometry.normal!;
      for (let i = 0; i < n.length; i += 3) if (Math.hypot(n[i], n[i + 1], n[i + 2]) < 1e-6) zero++;
      expect(zero).toBe(0);
    }
  });

  it('mergeGeometries succeeds across pattern + inlay + base as export does', () => {
    const pat = generatePattern(patternJob({ maskShapes: [{ shape: square(3), color: 'red' }] }), wasm);
    const inlay = generateInlay({
      jobId: 1, thickness: 0.6, cutterExtra: 0,
      filledCutoutShapes: [square(10)], holeShapes: [],
      items: [{
        id: 'a', itemIndex: 0, scale: 2, rotation: 0, mirror: false, x: 0, y: 0,
        depth: 0.4, extend: 0, positions: [{ x: 0, y: 0, rot: 0 }],
        shapes: [{ shape: square(3), color: 'white' }],
      }],
    }, wasm);

    const geos: THREE.BufferGeometry[] = [];
    // The base mesh, built on the main thread by ExtrudeGeometry.
    const baseShape = new THREE.Shape([
      new THREE.Vector2(-10, -10), new THREE.Vector2(10, -10),
      new THREE.Vector2(10, 10), new THREE.Vector2(-10, 10),
    ]);
    const base = new THREE.ExtrudeGeometry(baseShape, { depth: 0.6, bevelEnabled: false });
    // Export normalises to non-indexed via mergeGeometries' own requirements; mirror what
    // the app hands it: whatever the scene meshes hold.
    geos.push(base.toNonIndexed());
    for (const p of pat.parts.filter((x) => x.material.type !== 'basic')) {
      geos.push(deserializeGeometry(p.geometry).toNonIndexed());
    }
    for (const p of inlay.parts) {
      geos.push(deserializeGeometry(p.geometry).toNonIndexed());
    }
    // Drop attributes the exporter doesn't merge on (uv from ExtrudeGeometry), keeping
    // only what all sources share — this mirrors a real merge of the scene.
    for (const g of geos) {
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      }
    }
    expect(geos.length).toBeGreaterThan(2);
    const merged = mergeGeometries(geos);
    expect(merged, 'mergeGeometries returned null - attribute sets disagree').not.toBeNull();
    expect(merged!.getAttribute('position').count).toBeGreaterThan(0);
    expect(merged!.getAttribute('normal').count).toBe(merged!.getAttribute('position').count);
  });
});
