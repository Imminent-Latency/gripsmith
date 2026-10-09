import * as THREE from 'three';
import { serializeShape } from '../geometry/serialize';
import { transformOutlinePoints } from '../geometry/outlineTransform';
import type { OutlineTransform } from '../geometry/outlineTransform';
import { isPointInShape } from '../patternUtils';
import { boundsOf, dropTerminalDuplicate, enforceWinding, isDegenerate } from './cutPaths';
import type { CutPathSet, CutRegion } from './cutPaths';

/** Chord sag budget for exported cut paths, in millimetres. */
export const FLAT_TOLERANCE_MM = 0.05;

/** Dropped rings after sampling and terminal-duplicate removal; no UI concerns. */
export interface OutlineDropReport {
  droppedOuterRings: number;
  droppedHoleRings: number;
}

/** Bounding radius about the bounding-box midpoint; divisions clamped to [12, 512]. */
function divisionsForTolerance(shape: THREE.Shape, tolMm: number): number {
  const points = [shape, ...shape.holes].flatMap(path => path.getPoints());
  if (points.length === 0) return 12;
  const box = new THREE.Box2().setFromPoints(points);
  const radius = box.getSize(new THREE.Vector2()).length() / 2;
  if (radius <= tolMm) return 12;
  return Math.min(512, Math.max(12, Math.ceil(Math.PI / Math.acos(1 - tolMm / radius))));
}

export function outlineToCutPaths(shapes: THREE.Shape[] | null | undefined, t: OutlineTransform, reportDrops?: (report: OutlineDropReport) => void): CutPathSet | null {
  if (!shapes || shapes.length === 0) return null;
  const regions: CutRegion[] = [];
  const dropped: OutlineDropReport = { droppedOuterRings: 0, droppedHoleRings: 0 };
  for (const raw of shapes) {
    const divisions = divisionsForTolerance(raw, FLAT_TOLERANCE_MM);
    // Sample live curves first; rebuilding below retains those samples as line segments.
    const outerPoints = transformOutlinePoints(raw.getPoints(divisions), t);
    const sampled = new THREE.Shape(outerPoints.length ? outerPoints : undefined);
    sampled.holes = raw.holes.map(hole => {
      const holePoints = transformOutlinePoints(hole.getPoints(divisions), t);
      return new THREE.Path(holePoints.length ? holePoints : undefined);
    });
    const serialized = serializeShape(sampled);
    const points = dropTerminalDuplicate(serialized.points);
    const holes: number[][] = [];
    const outerIsDegenerate = isDegenerate(points);
    if (outerIsDegenerate) dropped.droppedOuterRings++;
    for (const rawHole of serialized.holes) {
      const hole = dropTerminalDuplicate(rawHole);
      if (isDegenerate(hole)) {
        dropped.droppedHoleRings++;
      } else if (outerIsDegenerate || !isPointInShape(new THREE.Vector2(hole[0], hole[1]), sampled)) {
        regions.push({ layer: 'OUTLINE', shape: enforceWinding({ points: hole, holes: [] }) });
      } else {
        holes.push(hole);
      }
    }
    if (!outerIsDegenerate) regions.push({ layer: 'OUTLINE', shape: enforceWinding({ points, holes }) });
  }
  if (dropped.droppedOuterRings || dropped.droppedHoleRings) reportDrops?.(dropped);
  return { regions, bounds: boundsOf(regions) };
}
