import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { computeSharpNormals } from './normals';

/** Pull position/index out of a THREE geometry as the pipeline's buffer pair. */
function buffers(geo: THREE.BufferGeometry) {
  const g = geo.index ? geo : geo.toNonIndexed();
  const position = new Float32Array(g.getAttribute('position').array as ArrayLike<number>);
  const index = g.index
    ? new Uint32Array(g.index.array as ArrayLike<number>)
    : Uint32Array.from({ length: position.length / 3 }, (_v, i) => i);
  return { position, index };
}

/** Every normal must be unit length and free of NaN. */
function expectUnitNormals(normal: Float32Array) {
  for (let i = 0; i < normal.length; i += 3) {
    const l = Math.hypot(normal[i], normal[i + 1], normal[i + 2]);
    expect(Number.isFinite(l)).toBe(true);
    expect(Math.abs(l - 1)).toBeLessThan(1e-5);
  }
}

/**
 * Merge vertices sharing a position, mirroring Manifold's `mesh.merge()`. Real pipeline
 * input is always welded, and welding is what lets adjacent faces smooth together —
 * THREE's primitives keep split seam vertices, so tests must weld to be representative.
 */
function weld(position: Float32Array, index: Uint32Array) {
  const map = new Map<string, number>();
  const remap = new Uint32Array(position.length / 3);
  const out: number[] = [];
  for (let v = 0; v < position.length / 3; v++) {
    const k = `${position[v * 3].toFixed(5)},${position[v * 3 + 1].toFixed(5)},${position[v * 3 + 2].toFixed(5)}`;
    let id = map.get(k);
    if (id === undefined) {
      id = out.length / 3;
      map.set(k, id);
      out.push(position[v * 3], position[v * 3 + 1], position[v * 3 + 2]);
    }
    remap[v] = id;
  }
  const idx = new Uint32Array(index.length);
  for (let i = 0; i < index.length; i++) idx[i] = remap[index[i]];
  // Drop degenerate triangles the weld may have collapsed, as Manifold would.
  const keep: number[] = [];
  for (let f = 0; f < idx.length / 3; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    if (a !== b && b !== c && a !== c) keep.push(a, b, c);
  }
  return { position: new Float32Array(out), index: new Uint32Array(keep) };
}

describe('computeSharpNormals', () => {
  it('gives a box exact axis-aligned face normals (all edges sharp)', () => {
    const { position, index } = buffers(new THREE.BoxGeometry(2, 2, 2));
    const out = computeSharpNormals(position, index, 60);
    expect(out.normal).toBeDefined();
    expectUnitNormals(out.normal!);
    // Each normal must point exactly along one axis.
    for (let i = 0; i < out.normal!.length; i += 3) {
      const n = [out.normal![i], out.normal![i + 1], out.normal![i + 2]];
      const axes = n.filter((v) => Math.abs(Math.abs(v) - 1) < 1e-5).length;
      const zeros = n.filter((v) => Math.abs(v) < 1e-5).length;
      expect(axes, `normal ${n}`).toBe(1);
      expect(zeros, `normal ${n}`).toBe(2);
    }
  });

  it('keeps a sphere smooth (no vertex splitting, normals point outward)', () => {
    const raw = buffers(new THREE.SphereGeometry(5, 32, 24));
    const { position, index } = weld(raw.position, raw.index);
    const out = computeSharpNormals(position, index, 60);
    expectUnitNormals(out.normal!);
    // Smoothing must not split anything on a sphere: one normal per welded vertex.
    expect(out.position.length).toBe(position.length);

    // Where nothing splits, the result must match THREE's own area-weighted smoothing —
    // so smooth surfaces shade identically to every other mesh in the app.
    const ref = new THREE.BufferGeometry();
    ref.setAttribute('position', new THREE.BufferAttribute(position.slice(), 3));
    ref.setIndex(new THREE.BufferAttribute(index.slice(), 1));
    ref.computeVertexNormals();
    const refN = ref.getAttribute('normal').array as ArrayLike<number>;
    let worstVsThree = 0;
    for (let i = 0; i < out.normal!.length; i += 3) {
      worstVsThree = Math.max(worstVsThree, Math.hypot(
        out.normal![i] - refN[i],
        out.normal![i + 1] - refN[i + 1],
        out.normal![i + 2] - refN[i + 2],
      ));
    }
    expect(worstVsThree).toBeLessThan(1e-5);

    // And they genuinely point outward (loose bound: the poles carry the usual
    // area-weighted discretisation error of a lat/long sphere).
    let worstRadial = 0;
    for (let i = 0; i < out.position.length; i += 3) {
      const px = out.position[i], py = out.position[i + 1], pz = out.position[i + 2];
      const l = Math.hypot(px, py, pz);
      worstRadial = Math.max(worstRadial, Math.hypot(
        out.normal![i] - px / l,
        out.normal![i + 1] - py / l,
        out.normal![i + 2] - pz / l,
      ));
    }
    expect(worstRadial).toBeLessThan(0.15);
  });

  it('splits a cylinder at the cap rim but keeps the barrel smooth', () => {
    const geo = new THREE.CylinderGeometry(3, 3, 6, 48, 1, false);
    const { position, index } = buffers(geo);
    const out = computeSharpNormals(position, index, 60);
    expectUnitNormals(out.normal!);
    // Cap normals are +/-Y; barrel normals have ~zero Y.
    let caps = 0, barrel = 0;
    for (let i = 0; i < out.normal!.length; i += 3) {
      const ny = out.normal![i + 1];
      if (Math.abs(Math.abs(ny) - 1) < 1e-4) caps++;
      else if (Math.abs(ny) < 1e-4) barrel++;
    }
    expect(caps).toBeGreaterThan(0);
    expect(barrel).toBeGreaterThan(0);
    expect(caps + barrel).toBe(out.normal!.length / 3);
  });

  it('never welds across an edge at or beyond the threshold', () => {
    // Two quads meeting at exactly 90 degrees.
    const position = new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, // z=0 plane
      0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, // y=0 plane, shares the (0,0,0)-(1,0,0) edge
    ]);
    const index = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    const out = computeSharpNormals(position, index, 60);
    expectUnitNormals(out.normal!);
    // With a 60-degree threshold a 90-degree crease must stay split: no normal should be
    // an average of the two face normals (which would have two non-zero components).
    for (let i = 0; i < out.normal!.length; i += 3) {
      const n = [out.normal![i], out.normal![i + 1], out.normal![i + 2]];
      const nz = n.filter((v) => Math.abs(v) > 1e-4).length;
      expect(nz, `normal ${n} should be axis aligned`).toBe(1);
    }
  });

  it('welds across a shallow crease but splits a steep one', () => {
    // Two quads sharing the edge v0-v1 (shared INDICES, as a welded mesh has).
    //   v0=(0,0,0) v1=(1,0,0) v2=(1,1,0) v3=(0,1,0)   -> +Z facing quad
    //   v4=(1,-1,h) v5=(0,-1,h)                        -> quad tilted by `deg`
    const build = (deg: number) => {
      const h = Math.tan((deg * Math.PI) / 180);
      const position = new Float32Array([
        0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
        1, -1, h, 0, -1, h,
      ]);
      //                 quad A            quad B (winding keeps both facing +Z-ish)
      const index = new Uint32Array([0, 1, 2, 0, 2, 3, 0, 5, 4, 0, 4, 1]);
      return { position, index };
    };

    // 8 degree crease -> below the 60 degree threshold -> smooth, no split.
    const shallow = build(8);
    const smooth = computeSharpNormals(shallow.position, shallow.index, 60);
    expectUnitNormals(smooth.normal!);
    expect(smooth.position.length / 3).toBe(6); // nothing split

    // 80 degree crease -> beyond the threshold -> v0 and v1 must split.
    const steep = build(80);
    const split = computeSharpNormals(steep.position, steep.index, 60);
    expectUnitNormals(split.normal!);
    expect(split.position.length / 3).toBeGreaterThan(6);
  });

  it('survives degenerate and isolated geometry without emitting NaN', () => {
    const position = new Float32Array([
      0, 0, 0, 1, 0, 0, 2, 0, 0, // zero-area triangle (collinear)
      5, 5, 5, // isolated, referenced by nothing
    ]);
    const index = new Uint32Array([0, 1, 2]);
    const out = computeSharpNormals(position, index, 60);
    expectUnitNormals(out.normal!);
  });

  it('preserves the triangle set exactly (same triangles, same positions)', () => {
    const geo = new THREE.TorusKnotGeometry(4, 1.2, 90, 12);
    const { position, index } = buffers(geo);
    const out = computeSharpNormals(position, index, 60);
    expect(out.index!.length).toBe(index.length);
    // Every output triangle must occupy the same coordinates as the input triangle.
    for (let f = 0; f < index.length / 3; f++) {
      for (let k = 0; k < 3; k++) {
        const src = index[f * 3 + k] * 3;
        const dst = out.index![f * 3 + k] * 3;
        for (let c = 0; c < 3; c++) {
          expect(out.position[dst + c]).toBe(position[src + c]);
        }
      }
    }
  });

  it('is linear enough to handle a large tiled mesh quickly', () => {
    // ~150k triangles of sharp-edged boxes: the shape that made Manifold quadratic.
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4000; i++) {
      const b = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
      b.translate((i % 100) * 3, Math.floor(i / 100) * 3, 0);
      parts.push(b);
    }
    const merged = mergePositions(parts);
    const t0 = performance.now();
    const out = computeSharpNormals(merged.position, merged.index, 60);
    const dt = performance.now() - t0;
    console.log(`  computeSharpNormals: ${merged.index.length / 3} tris in ${dt.toFixed(0)}ms`);
    expect(out.normal).toBeDefined();
    // Manifold's calculateNormals took ~5800ms for this shape; a linear pass must be
    // orders of magnitude below that even on a slow machine.
    expect(dt).toBeLessThan(2000);
  });
});

function mergePositions(geos: THREE.BufferGeometry[]) {
  let total = 0;
  for (const g of geos) total += g.getAttribute('position').count;
  const position = new Float32Array(total * 3);
  const index = new Uint32Array(total);
  let off = 0;
  for (const g of geos) {
    const a = g.getAttribute('position');
    position.set(a.array as ArrayLike<number>, off * 3);
    for (let i = 0; i < a.count; i++) index[off + i] = off + i;
    off += a.count;
  }
  return { position, index };
}
