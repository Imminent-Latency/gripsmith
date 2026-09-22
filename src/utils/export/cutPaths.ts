import * as THREE from 'three';
import type { SerializedShape } from '../geometry/serialize';

export type CutLayerName = 'OUTLINE' | 'HOLES' | 'PATTERN';

export interface CutRegion {
  /** Layer for the outer ring; holes always emit on HOLES. */
  layer: Exclude<CutLayerName, 'HOLES'>;
  /** Millimetres, implicitly closed. Non-zero-area outers are CCW, holes CW. */
  shape: SerializedShape;
}

export interface CutPathSet {
  regions: CutRegion[];
  /** Millimetres, +Y up. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export function dropTerminalDuplicate(ring: number[]): number[] {
  if (ring.length >= 4 && Math.hypot(ring[0] - ring[ring.length - 2], ring[1] - ring[ring.length - 1]) <= 1e-9) {
    return ring.slice(0, -2);
  }
  return ring.slice();
}

function wind(ring: number[], ccw: boolean): number[] {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i < ring.length; i += 2) points.push(new THREE.Vector2(ring[i], ring[i + 1]));
  const area = THREE.ShapeUtils.area(points);
  if ((ccw && area < 0) || (!ccw && area > 0)) {
    const reversed: number[] = [];
    for (let i = ring.length - 2; i >= 0; i -= 2) reversed.push(ring[i], ring[i + 1]);
    return reversed;
  }
  // Zero-area rings retain their exact coordinates and order (A12a).
  return ring.slice();
}

export function enforceWinding(shape: SerializedShape): SerializedShape {
  return { points: wind(shape.points, true), holes: shape.holes.map(hole => wind(hole, false)) };
}

export function isDegenerate(ring: number[]): boolean {
  return ring.length < 6;
}

export function hasSelfIntersection(ring: number[]): boolean {
  const points = dropTerminalDuplicate(ring);
  const n = points.length / 2;
  const cross = (a: number, b: number, c: number) =>
    (points[b * 2] - points[a * 2]) * (points[c * 2 + 1] - points[a * 2 + 1]) -
    (points[b * 2 + 1] - points[a * 2 + 1]) * (points[c * 2] - points[a * 2]);
  const onSegment = (a: number, b: number, c: number) =>
    points[c * 2] >= Math.min(points[a * 2], points[b * 2]) &&
    points[c * 2] <= Math.max(points[a * 2], points[b * 2]) &&
    points[c * 2 + 1] >= Math.min(points[a * 2 + 1], points[b * 2 + 1]) &&
    points[c * 2 + 1] <= Math.max(points[a * 2 + 1], points[b * 2 + 1]);
  for (let a = 0; a < n; a++) {
    const b = (a + 1) % n;
    for (let c = a + 1; c < n; c++) {
      const d = (c + 1) % n;
      if (b === c || d === a) continue;
      const abc = cross(a, b, c), abd = cross(a, b, d);
      const cda = cross(c, d, a), cdb = cross(c, d, b);
      if ((Math.sign(abc) * Math.sign(abd) < 0 && Math.sign(cda) * Math.sign(cdb) < 0) ||
          (abc === 0 && onSegment(a, b, c)) || (abd === 0 && onSegment(a, b, d)) ||
          (cda === 0 && onSegment(c, d, a)) || (cdb === 0 && onSegment(c, d, b))) return true;
    }
  }
  return false;
}

export function boundsOf(regions: CutRegion[]): CutPathSet['bounds'] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { shape } of regions) {
    for (const ring of [shape.points, ...shape.holes]) {
      for (let i = 0; i < ring.length; i += 2) {
        minX = Math.min(minX, ring[i]);
        minY = Math.min(minY, ring[i + 1]);
        maxX = Math.max(maxX, ring[i]);
        maxY = Math.max(maxY, ring[i + 1]);
      }
    }
  }
  return minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}
