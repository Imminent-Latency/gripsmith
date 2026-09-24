import * as THREE from 'three';

export interface OutlineTransform { mirror: boolean; rotationDeg: number; }

/** Mirror x, rotate about the origin, then reverse mirrored rings to preserve winding. */
export function transformOutlinePoints(pts: THREE.Vector2[], t: OutlineTransform): THREE.Vector2[] {
  if (t.mirror) {
    pts = pts.map(p => new THREE.Vector2(-p.x, p.y));
  }
  if (t.rotationDeg !== 0) {
    const rad = t.rotationDeg * (Math.PI / 180);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    pts = pts.map(p => new THREE.Vector2(
      p.x * cos - p.y * sin,
      p.x * sin + p.y * cos
    ));
  }
  if (t.mirror) {
    pts.reverse();
  }
  return pts;
}

/** Samples at the preview's default resolution; export must sample raw curves first. */
export function transformOutlineShapes(shapes: THREE.Shape[], t: OutlineTransform): THREE.Shape[] {
  return shapes.map(shape => {
    const transformed = new THREE.Shape(transformOutlinePoints(shape.getPoints(), t));
    transformed.holes = shape.holes.map(hole => new THREE.Path(transformOutlinePoints(hole.getPoints(), t)));
    return transformed;
  });
}
