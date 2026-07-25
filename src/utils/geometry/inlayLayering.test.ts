import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyInlayLayering, inlayStackLevel } from './inlayLayering';

const apply = (itemIndex: number, shapeIndex: number) => {
  const mesh = new THREE.Mesh();
  const mat = new THREE.MeshStandardMaterial();
  applyInlayLayering(mesh, mat, inlayStackLevel(itemIndex, shapeIndex));
  return { mesh, mat };
};

describe('inlay decal layering', () => {
  it('draws every inlay shape after the base and pattern', () => {
    // Base and pattern meshes keep the default renderOrder of 0.
    for (const [i, s] of [[0, 0], [0, 50], [3, 7]] as const) {
      expect(apply(i, s).mesh.renderOrder).toBeGreaterThan(0);
    }
  });

  it('biases each successive shape strictly closer to the camera', () => {
    // This is what makes coplanar shapes deterministic: geometry Z cannot express the
    // ordering (shapes past the 21st share one plane exactly), so the bias must.
    let prevOrder = -Infinity;
    let prevUnits = Infinity;
    for (let s = 0; s < 99; s++) {
      const { mesh, mat } = apply(0, s);
      expect(mat.polygonOffset).toBe(true);
      expect(mesh.renderOrder).toBeGreaterThan(prevOrder);
      expect(mat.polygonOffsetUnits).toBeLessThan(prevUnits);
      prevOrder = mesh.renderOrder;
      prevUnits = mat.polygonOffsetUnits;
    }
  });

  it('orders later items above earlier ones', () => {
    const a = apply(0, 99);
    const b = apply(1, 0);
    expect(b.mesh.renderOrder).toBeGreaterThan(a.mesh.renderOrder);
    expect(b.mat.polygonOffsetUnits).toBeLessThan(a.mat.polygonOffsetUnits);
  });

  it('steps by at least a whole depth unit per level', () => {
    // Fractional units are a fraction of one LSB and round away, and for coplanar surfaces
    // the factor*slope term is identical — so a sub-unit step separates nothing.
    for (let s = 1; s < 99; s++) {
      const prev = apply(0, s - 1).mat.polygonOffsetUnits;
      const cur = apply(0, s).mat.polygonOffsetUnits;
      expect(prev - cur).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps the total bias bounded so it cannot fight pattern geometry above it', () => {
    // With the perspective near plane at 20mm a depth unit is ~0.002mm at working distance,
    // so the whole stack must stay in the low hundreds of units to remain well under the
    // height of a pattern tile (~1.5mm for a typical unit at default scale).
    for (const [i, s] of [[0, 0], [9, 99], [99, 99]] as const) {
      const { mat } = apply(i, s);
      expect(Math.abs(mat.polygonOffsetUnits)).toBeLessThanOrEqual(210);
    }
  });

  it('never emits NaN when the stack level is missing', () => {
    const mesh = new THREE.Mesh();
    const mat = new THREE.MeshStandardMaterial();
    applyInlayLayering(mesh, mat, undefined as unknown as number);
    expect(Number.isFinite(mesh.renderOrder)).toBe(true);
    expect(Number.isFinite(mat.polygonOffsetUnits)).toBe(true);
    expect(mat.polygonOffset).toBe(true);
  });

  it('is bounded and monotonic non-decreasing in the stack level', () => {
    let prev = -1;
    for (let i = 0; i < 5; i++) {
      for (let s = 0; s < 120; s++) {
        const level = inlayStackLevel(i, s);
        expect(level).toBeGreaterThanOrEqual(prev);
        expect(level).toBeLessThanOrEqual(200);
        prev = level;
      }
    }
  });
});
