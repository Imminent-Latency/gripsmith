import * as THREE from 'three';

/**
 * Deterministic layering for inlay shapes, which are coplanar decals on the base surface.
 *
 * An SVG inlay is a paint stack: later sub-shapes must appear over earlier ones. The pipeline
 * expresses that with a per-shape Z lift of `min(shapeIdx, 20) * 0.002mm`, which cannot work
 * as a depth-buffer mechanism:
 *  - 0.002mm is far below what a perspective depth buffer resolves at working distance, and
 *  - the cap at 20 makes every shape past the 21st *exactly* coplanar. A traced image inlay
 *    routinely has 90+ sub-shapes, so most of them share one plane and tear into speckle
 *    no matter how much depth precision is available.
 *
 * Draw order and depth bias are the right tools, because both are exact and independent of
 * depth-buffer resolution:
 *  - `renderOrder` pins the sequence, overriding THREE's camera-distance sort, so the paint
 *    order is honoured rather than being whatever the sort happened to produce.
 *  - `polygonOffset` biases in depth-buffer units, so a monotonically increasing bias per
 *    stack level guarantees each shape wins against everything below it even when the
 *    geometry is perfectly coplanar.
 *
 * The bias stays small in world terms. With the perspective near plane at 20mm a depth unit is
 * ~0.002mm at the default camera distance, so even a 90-deep stack spans ~0.2mm — an order of
 * magnitude below the height of the pattern tiles standing above the inlay, which is what stops
 * the inlay from incorrectly winning against them.
 *
 * NOTE: this depends on the renderer NOT using logarithmicDepthBuffer. That makes three.js
 * write gl_FragDepth, which replaces the rasteriser depth that polygonOffset adjusts and so
 * disables the offset completely. See the comment on the Canvas in ModelViewer.
 *
 * The Z lift in the geometry is deliberately left alone: it is part of the exported model.
 */

/** Cap so a many-item, many-shape scene cannot accumulate a large bias. */
const MAX_STACK = 200;

/**
 * Stack level for an inlay shape. Tiles are deliberately NOT part of this: tile copies are
 * spatially disjoint, so they never need ordering relative to each other.
 */
export function inlayStackLevel(itemIndex: number, shapeIndex: number): number {
  return Math.min(itemIndex * 100 + Math.min(shapeIndex, 99), MAX_STACK);
}

/** Apply the draw order and depth bias for a given stack level. */
export function applyInlayLayering(
  mesh: THREE.Mesh,
  material: THREE.Material,
  stackLevel: number,
): void {
  // Guard against a missing/NaN level: NaN silently disables the offset entirely, which
  // looks exactly like the bug this function exists to fix.
  const level = Number.isFinite(stackLevel) ? Math.max(0, Math.floor(stackLevel)) : 0;

  // Above the base and pattern (both at the default 0) and ascending through the stack.
  mesh.renderOrder = 1 + level;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  /*
   * One WHOLE unit per stack level. `units` is scaled by the implementation's minimum
   * resolvable depth difference, so a fractional step is a fraction of one LSB and rounds
   * away — and for coplanar surfaces the `factor * slope` term is identical, leaving `units`
   * as the only thing that can separate them, so a sub-unit step risks separating nothing.
   */
  material.polygonOffsetUnits = -(1 + level);
}
