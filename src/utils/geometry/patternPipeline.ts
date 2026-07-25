import * as THREE from 'three';
import type { ManifoldToplevel, Mat4 } from 'manifold-3d';
import { generateTilePositions, getShapesBounds } from '../patternUtils';
import { SerializedShape, SerializedGeometry, deserializeShapes, geometryTransferables } from './serialize';
import { ManifoldOps, M, CS } from './manifoldOps';

/**
 * Pure, framework-free pattern generator built on Manifold (manifold-3d / wasm).
 *
 * All boolean geometry runs through Manifold: 2D offset/union/clip via CrossSection
 * (Clipper2), extrusion + 3D booleans via Manifold. Output is guaranteed watertight,
 * so the coplanar Z-expansion hacks the three-bvh-csg version needed are gone.
 *
 * No React, no scene graph, no DOM — runs inside the geometry worker. The caller turns
 * the returned MaterialSpec + geometry buffers into Mesh/Material (the only DOM/GL step).
 */

export type TilingDistribution =
  | 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave' | 'zigzag' | 'warped-grid';
export type TilingOrientation = 'none' | 'alternate' | 'random' | 'aligned';
export type TilingDirection = 'horizontal' | 'vertical';
export type HoleMode = 'default' | 'margin' | 'avoid';

/** How the main thread should build the material for a part. */
export type MaterialSpec =
  | { type: 'pattern' }
  | { type: 'masked'; color: string }
  | { type: 'basic'; colorHex: number; opacity: number; transparent: boolean; depthWrite: boolean };

export interface MeshPart {
  name: string;
  geometry: SerializedGeometry;
  material: MaterialSpec;
  castShadow?: boolean;
  receiveShadow?: boolean;
  translateZ?: number;
  visible?: boolean;
}

export interface InstancedPart {
  unit: SerializedGeometry;
  /** Flat array of 4x4 matrices, 16 floats per instance (column-major, THREE order). */
  matrices: Float32Array;
  count: number;
}

export type PatternUnit =
  | { kind: 'shapes'; shapes: SerializedShape[] }
  | { kind: 'geometry'; geometry: SerializedGeometry };

export interface PatternJob {
  jobId: number;

  size: number;
  thickness: number;
  patternScale: number;
  patternScaleZ?: number;
  isTiled: boolean;
  tileSpacing: number;
  patternMargin: number;
  holeMode: HoleMode;
  tilingDistribution: TilingDistribution;
  tilingDirection: TilingDirection;
  tilingOrientation: TilingOrientation;
  baseRotation: number;
  rotationClamp?: number;
  patternMaxHeight?: number;
  clipToOutline: boolean;
  maxInlayExtend: number;

  filledCutoutShapes: SerializedShape[];
  holeShapes: SerializedShape[];
  patternUnit: PatternUnit;
  exclusionShapes: SerializedShape[];
  inclusionShapes: SerializedShape[];
  avoidShapes: SerializedShape[];
  maskShapes: { shape: SerializedShape; color: string }[];

  debugPattern: boolean;
  debugHole: boolean;
  debugInlay: boolean;
}

export interface PatternResult {
  jobId: number;
  instanced?: InstancedPart;
  parts: MeshPart[];
  empty: boolean;
}

/** Collect all Transferable buffers from a result for a zero-copy postMessage. */
export function patternResultTransferables(r: PatternResult): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  if (r.instanced) {
    out.push(...geometryTransferables(r.instanced.unit));
    out.push(r.instanced.matrices.buffer as ArrayBuffer);
  }
  for (const p of r.parts) out.push(...geometryTransferables(p.geometry));
  return out;
}

export function generatePattern(job: PatternJob, wasm: ManifoldToplevel): PatternResult {
  const ops = new ManifoldOps(wasm);
  const { Manifold, CrossSection } = ops;
  const track = ops.track;
  const parts: MeshPart[] = [];

  const {
    size, thickness, patternScale, patternScaleZ, isTiled, tileSpacing, patternMargin,
    holeMode, tilingDistribution, tilingDirection, tilingOrientation, baseRotation,
    rotationClamp, patternMaxHeight, clipToOutline, maxInlayExtend,
  } = job;

  // Extrude shapes into a solid tall enough to span the whole model in Z (through-cutter).
  const spanHeight = thickness + Math.max(patternMaxHeight || 0, maxInlayExtend, 100) + 100;
  /** Per-job span cutter (tracked). Used for contours that change with every edit. */
  const spanExtrude = (cs: CS): M => track(track(Manifold.extrude(cs, spanHeight * 2)).translate(0, 0, -spanHeight));

  const basicPart = (name: string, m: M, colorHex: number, opacity: number): MeshPart => ({
    name,
    geometry: ops.serializeMesh(m, false),
    material: { type: 'basic', colorHex, opacity, transparent: true, depthWrite: false },
    visible: true,
  });

  const empty = (): PatternResult => {
    ops.flush();
    return { jobId: job.jobId, parts, empty: true };
  };

  try {
    // ---- A. Unit solid ----
    let unit: M | null = null;
    if (job.patternUnit.kind === 'geometry') {
      // Cached: the same STL is re-used across every settings change. Throws if not watertight.
      unit = ops.cachedManifoldFromGeometry(job.patternUnit.geometry);
    } else {
      const cs = ops.csFromShapes(job.patternUnit.shapes, 'EvenOdd');
      if (cs) unit = track(Manifold.extrude(cs, 1));
    }
    if (!unit || unit.numTri() === 0) return empty();

    // Center the unit in X/Y/Z
    let box = unit.boundingBox();
    unit = track(unit.translate(
      -(box.min[0] + box.max[0]) / 2,
      -(box.min[1] + box.max[1]) / 2,
      -(box.min[2] + box.max[2]) / 2,
    ));

    // Base rotation of the pattern unit (with optional clamp)
    if (baseRotation !== 0) {
      let rot = baseRotation;
      if (rotationClamp && rotationClamp > 0) rot = Math.round(baseRotation / rotationClamp) * rotationClamp;
      unit = track(unit.rotate(0, 0, rot));
    }
    box = unit.boundingBox();
    const unitW = box.max[0] - box.min[0];
    const unitH = box.max[1] - box.min[1];
    const unitZ = box.max[2] - box.min[2];

    // ---- B. Tile positions (THREE-based, unchanged) ----
    const filledTHREE = deserializeShapes(job.filledCutoutShapes);
    let bounds = new THREE.Box2(
      new THREE.Vector2(-size / 2, -size / 2),
      new THREE.Vector2(size / 2, size / 2),
    );
    if (filledTHREE.length > 0) {
      const sb = getShapesBounds(filledTHREE);
      bounds = new THREE.Box2(sb.min, sb.max);
    }

    const pWidth = unitW * patternScale;
    const pHeight = unitH * patternScale;

    const exclTHREE = deserializeShapes(job.exclusionShapes);
    const inclTHREE = deserializeShapes(job.inclusionShapes);
    let avoidTHREE = deserializeShapes(job.avoidShapes);
    if (holeMode === 'avoid' && job.holeShapes.length > 0) {
      avoidTHREE = [...avoidTHREE, ...deserializeShapes(job.holeShapes)];
    }

    const positions = isTiled
      ? generateTilePositions(
          bounds, pWidth, pHeight, tileSpacing,
          filledTHREE.length > 0 ? filledTHREE : null, patternMargin,
          clipToOutline,
          tilingDistribution, tilingOrientation, tilingDirection,
          exclTHREE, inclTHREE, avoidTHREE,
        )
      : [{ position: new THREE.Vector2(0, 0), rotation: 0, scale: 1 }];

    if (rotationClamp && rotationClamp > 0) {
      const radClamp = rotationClamp * (Math.PI / 180);
      positions.forEach((p) => { p.rotation = Math.round(p.rotation / radClamp) * radClamp; });
    }
    if (positions.length === 0) return empty();

    const actualScaleZ = (patternScaleZ !== undefined && patternScaleZ > 0) ? patternScaleZ : patternScale;
    let maxPatternHeight = unitZ * actualScaleZ;
    if (maxPatternHeight === 0) maxPatternHeight = actualScaleZ * 10;

    // Per-instance transform matrix (matches the legacy THREE dummy math).
    const dummy = new THREE.Object3D();
    const instanceMatrix = (p: { position: THREE.Vector2; rotation: number; scale: number }): THREE.Matrix4 => {
      dummy.scale.set(patternScale * p.scale, patternScale * p.scale, actualScaleZ * p.scale);
      const instH = unitZ * Math.abs(dummy.scale.z);
      const zCenter = thickness - 0.01 + instH / 2;
      dummy.position.set(p.position.x, p.position.y, zCenter);
      dummy.rotation.set(0, 0, p.rotation);
      dummy.updateMatrix();
      return dummy.matrix;
    };

    // ---- C. Strategy ----
    const hasExclusions = job.exclusionShapes.length > 0;
    const hasMasks = job.maskShapes.length > 0;
    const hasClipping = clipToOutline && job.filledCutoutShapes.length > 0;
    const hasHoles = job.holeShapes.length > 0;
    const hasHeightCut = patternMaxHeight !== undefined && patternMaxHeight > 0;
    const useCSG = hasClipping || hasExclusions || hasMasks || hasHoles || hasHeightCut;

    if (!useCSG) {
      // Instanced fast path — return unit geometry + per-instance matrices.
      const unitSer = ops.serializeMesh(unit, true);
      const matrices = new Float32Array(positions.length * 16);
      positions.forEach((p, i) => { instanceMatrix(p).toArray(matrices, i * 16); });
      return { jobId: job.jobId, instanced: { unit: unitSer, matrices, count: positions.length }, parts, empty: false };
    }

    // CSG path — compose all instances into one solid, then boolean.
    const instances: M[] = [];
    positions.forEach((p) => {
      instances.push(unit!.transform(instanceMatrix(p).toArray() as unknown as Mat4));
    });
    let result = track(Manifold.compose(instances));
    instances.forEach((i) => i.delete()); // compose copied them
    if (result.numTri() === 0) return empty();

    // 3a. Exclusions (subtract), with optional inclusion carve-outs.
    if (hasExclusions) {
      let exCS = ops.simplifiedCs(job.exclusionShapes);
      if (exCS) {
        if (job.inclusionShapes.length > 0) {
          const inCS = ops.simplifiedCs(job.inclusionShapes);
          if (inCS) exCS = track(exCS.subtract(inCS));
        }
        const exM = spanExtrude(exCS);
        if (job.debugInlay) {
          const waste = track(result.intersect(exM));
          if (waste.numTri() > 0) parts.push(basicPart('Debug_Pattern_Waste_Exclusion', waste, 0x00ff00, 0.5));
        }
        result = track(result.subtract(exM));
      }
    }

    // 3b. Clip to outline (intersect), with optional erosion margin.
    if (hasClipping) {
      const cutterDepth = thickness + Math.max(maxPatternHeight, maxInlayExtend) + 5;
      const erode = patternMargin && Math.abs(patternMargin) > 0.001 ? -patternMargin : 0;
      // Cached: the base outline and margin are unchanged by most edits, and this is the
      // single most expensive cutter in the pipeline.
      const cutter = ops.cachedCutterSolid(job.filledCutoutShapes, { height: cutterDepth, offset: erode });
      if (cutter) {
        if (job.debugPattern) {
          const waste = track(result.subtract(cutter));
          if (waste.numTri() > 0) parts.push(basicPart('Debug_Pattern_Waste', waste, 0x0000ff, 0.5));
        }
        result = track(result.intersect(cutter));
        if (job.debugPattern) parts.push(basicPart('Debug_Pattern_Cutter', cutter, 0x0000ff, 0.3));
      }
    }

    // 3c. Holes (subtract), with optional margin expansion.
    if (hasHoles) {
      const dilate = holeMode === 'margin' && patternMargin && Math.abs(patternMargin) > 0.001 ? patternMargin : 0;
      // Cached: base holes come from the outline and are stable across edits.
      const holeM = ops.cachedCutterSolid(job.holeShapes, {
        height: spanHeight * 2, translateZ: -spanHeight, offset: dilate,
      });
      if (holeM) {
        if (job.debugHole) {
          const waste = track(result.intersect(holeM));
          if (waste.numTri() > 0) parts.push(basicPart('Debug_Hole_Waste_Pattern', waste, 0xff0000, 0.5));
        }
        result = track(result.subtract(holeM));
        if (job.debugHole) parts.push(basicPart('Debug_Hole_Cutter', holeM, 0xff0000, 0.3));
      }
    }

    // 3d. Max-height cut — subtract a big box above the cut plane.
    if (hasHeightCut) {
      const cutStart = thickness + patternMaxHeight!;
      const cutHeight = maxPatternHeight + 1000;
      const boxCS = track(CrossSection.square([10000, 10000], true));
      const boxM = track(track(Manifold.extrude(boxCS, cutHeight)).translate(0, 0, cutStart));
      result = track(result.subtract(boxM));
    }

    /**
     * 3e. Colored masks — 2D layering (subtract upper masks in CrossSection space).
     *
     * Runs LAST, after the hole and max-height cuts, because the masked regions are carved
     * out of `result` and shipped as their own meshes. Splitting them off before those cuts
     * left them uncut: a recolour inlay over a base hole produced geometry floating across
     * the hole, and a max-height limit didn't clip the recoloured tiles.
     *
     * The main pattern is unaffected by the move — it ends up as
     * result \ holes \ box \ masks either way, and set difference is order independent.
     */
    if (hasMasks) {
      // Per-job, never cached: a traced recolour inlay can carry ~100 sub-shapes.
      const maskCSs = job.maskShapes.map((m) => ops.simplifiedCs([m.shape]));

      // Each mask shows only where no later mask covers it. Subtracting the later masks one
      // at a time is O(n^2) boolean ops (~4200 for a 92-shape traced inlay); since
      // A - B - C == A - (B | C), one suffix union per index gives the same regions in O(n).
      const upperUnion: (CS | null)[] = new Array(maskCSs.length).fill(null);
      for (let i = maskCSs.length - 2; i >= 0; i--) {
        const above = maskCSs[i + 1];
        const prev = upperUnion[i + 1];
        if (!above) upperUnion[i] = prev;
        else if (!prev) upperUnion[i] = above;
        else upperUnion[i] = track(CrossSection.union([above, prev]));
      }

      // Union of every mask, needed anyway to cut the masked area out of the main pattern.
      const allCS = ops.simplifiedCs(job.maskShapes.map((m) => m.shape));
      const allM = allCS ? spanExtrude(allCS) : null;

      // Every mask region lies inside that union, so P & Mi == (P & Munion) & Mi. Doing the
      // union intersection once lets each per-mask boolean run against a far smaller solid
      // than the full tiled pattern — same regions, much less work per mask.
      const maskedTotal = allM ? track(result.intersect(allM)) : result;

      job.maskShapes.forEach((m, idx) => {
        let myCS = maskCSs[idx];
        if (!myCS) return;
        const above = upperUnion[idx];
        if (above) myCS = track(myCS.subtract(above));
        const maskM = spanExtrude(myCS);
        const maskedPart = track(maskedTotal.intersect(maskM));
        if (maskedPart.numTri() > 0) {
          parts.push({
            name: `Pattern_Masked_${idx}_${m.color}`,
            geometry: ops.serializeMesh(maskedPart, true),
            material: { type: 'masked', color: m.color },
            castShadow: true,
            receiveShadow: true,
            translateZ: idx * 0.0001,
          });
        }
      });
      if (allM) result = track(result.subtract(allM));
    }

    // 4. Final pattern mesh
    if (result.numTri() > 0) {
      parts.push({
        name: 'Pattern',
        geometry: ops.serializeMesh(result, true),
        material: { type: 'pattern' },
        castShadow: true,
        receiveShadow: true,
      });
    }

    return { jobId: job.jobId, parts, empty: parts.length === 0 };
  } finally {
    ops.flush();
  }
}
