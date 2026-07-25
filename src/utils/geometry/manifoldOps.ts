import type {
  ManifoldToplevel,
  Manifold as ManifoldObj,
  CrossSection as CrossSectionObj,
  Vec2,
  FillRule,
} from 'manifold-3d';
import { SerializedShape, SerializedGeometry } from './serialize';
import { geometryCache, hashShapes, hashGeometry, hashParams } from './manifoldCache';
import { computeSharpNormals } from './normals';

/**
 * Shared Manifold helpers used by the pattern and inlay pipelines. Manifold objects
 * are wasm-backed and must be freed explicitly; a ManifoldOps instance tracks every
 * object it creates so a single `flush()` releases them all.
 */

export type M = ManifoldObj;
export type CS = CrossSectionObj;

/** Preserve hard edges (>60°) as facets while smoothing genuinely curved surfaces. */
export const SHARP_ANGLE = 60;

/**
 * Contour tolerance for CUTTER geometry (outline clip, holes, exclusions, masks), in mm.
 *
 * Imported outlines are wildly over-sampled: a typical DXF grip outline arrives as ~4800
 * points over a ~900mm perimeter (0.19mm average segment, hundreds of segments under
 * 0.01mm, ~1200 effectively collinear points), because arcs and splines are flattened at
 * a fixed division count regardless of radius. That density is pure cost — it inflates the
 * extruded cutter to ~18k triangles, and it injects thousands of meaningless vertices into
 * the result along every cut edge.
 *
 * 1 micron is deliberately far tighter than the process can resolve — 1/200th of a print
 * layer, 1/400th of a nozzle, and ~50x below the flattening error the DXF import already
 * baked in — while still collapsing that redundancy almost entirely. Measured on an XR Stock
 * outline: 4761 contour points -> 541, extruded cutter 18464 tris -> 1584, and the pipeline
 * roughly 2x faster overall.
 *
 * Loosening further buys very little. Going to 0.01mm (10x this) saves only ~3ms on a
 * typical regeneration and ~8% on a dense one, because the cutter is no longer the
 * bottleneck; the meaningful step is simply not carrying 4800 redundant points.
 *
 * Deliberately NOT applied to the pattern unit or inlay shapes: those are the geometry the
 * user is actually looking at, they are cheap to process, and they stay bit-exact.
 */
export const CUTTER_TOLERANCE = 0.001;

export class ManifoldOps {
  readonly Manifold: ManifoldToplevel['Manifold'];
  readonly CrossSection: ManifoldToplevel['CrossSection'];
  readonly Mesh: ManifoldToplevel['Mesh'];
  private items: { delete(): void }[] = [];

  constructor(wasm: ManifoldToplevel) {
    this.Manifold = wasm.Manifold;
    this.CrossSection = wasm.CrossSection;
    this.Mesh = wasm.Mesh;
  }

  /** Track a wasm object for disposal; returns it for chaining. */
  track = <T extends { delete(): void }>(x: T): T => {
    this.items.push(x);
    return x;
  };

  flush() {
    for (const it of this.items) {
      try { it.delete(); } catch { /* already freed */ }
    }
    this.items = [];
  }

  private contoursOf(s: SerializedShape, mirror = false): Vec2[][] {
    const sx = mirror ? -1 : 1;
    const toPairs = (flat: number[]): Vec2[] => {
      const o: Vec2[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) o.push([flat[i] * sx, flat[i + 1]]);
      return o;
    };
    return [toPairs(s.points), ...s.holes.map(toPairs)];
  }

  /** One shape (outer + holes) as a CrossSection; optional X mirror. */
  csFromShape(s: SerializedShape, mirror = false, fill: FillRule = 'EvenOdd'): CS | null {
    if (s.points.length < 6) return null;
    return this.track(new this.CrossSection(this.contoursOf(s, mirror), fill));
  }

  /** Union of several shapes into one CrossSection (overlap-safe). */
  csFromShapes(shapes: SerializedShape[], fill: FillRule = 'EvenOdd'): CS | null {
    const sections = shapes
      .filter((s) => s.points.length >= 6)
      .map((s) => this.track(new this.CrossSection(this.contoursOf(s), fill)));
    if (sections.length === 0) return null;
    if (sections.length === 1) return sections[0];
    return this.track(this.CrossSection.union(sections));
  }

  /**
   * Decimated cutter contour, tracked for per-job disposal.
   *
   * Use this for contours that change on essentially every edit, or that can be numerous:
   * exclusions, inclusions and colour masks. A recolour inlay traced from an SVG can carry
   * ~100 sub-shapes, and the mask layering pass derives a contour per pair, so these are
   * emphatically NOT cache material — see the note on `cachedCutterSolid`.
   */
  simplifiedCs(shapes: SerializedShape[], fill: FillRule = 'EvenOdd'): CS | null {
    const raw = this.csFromShapes(shapes, fill);
    if (!raw) return null;
    return this.track(raw.simplify(CUTTER_TOLERANCE));
  }

  /**
   * Fully cached cutter solid: contour -> optional offset -> extrude, decimated to
   * CUTTER_TOLERANCE and keyed on the source shapes plus every parameter.
   *
   * Reserved for the base outline and the base holes. Those two are (a) genuinely
   * expensive — a DXF grip outline arrives with ~4800 points, and building its eroded,
   * extruded cutter costs more than the boolean it feeds — and (b) unchanged by the edits
   * that actually trigger regeneration, so the hit rate is nearly 100% while scrubbing.
   *
   * IMPORTANT: only ever cache a bounded, stable set of objects. The cache frees entries
   * on eviction, so caching something produced inside an unbounded loop can evict an object
   * the caller is still holding — which is a use-after-free, not a cache miss. Anything
   * per-edit or per-shape belongs in `simplifiedCs` above.
   */
  cachedCutterSolid(
    shapes: SerializedShape[],
    opts: { height: number; offset?: number; translateZ?: number; join?: 'Miter' | 'Round' | 'Square'; miterLimit?: number; fill?: FillRule },
  ): M | null {
    const usable = shapes.filter((s) => s.points.length >= 6);
    if (usable.length === 0) return null;
    const fill = opts.fill ?? 'EvenOdd';
    const join = opts.join ?? 'Miter';
    const miterLimit = opts.miterLimit ?? 2;
    const offset = opts.offset ?? 0;
    const translateZ = opts.translateZ ?? 0;
    const key = `solid:${hashShapes(usable)}:${fill}:${CUTTER_TOLERANCE}:${hashParams(offset, join, miterLimit, opts.height, translateZ)}`;

    return geometryCache.getOrCreate(key, () => {
      // Build through a scratch ops so every intermediate is freed; only the final solid
      // escapes (Manifold values do not alias their inputs — see manifoldCache.test.ts).
      const scratch = new ManifoldOps({
        Manifold: this.Manifold,
        CrossSection: this.CrossSection,
        Mesh: this.Mesh,
      } as ManifoldToplevel);
      try {
        let cs = scratch.track(scratch.csFromShapes(usable, fill)!.simplify(CUTTER_TOLERANCE));
        if (offset !== 0) cs = scratch.track(cs.offset(offset, join, miterLimit));
        const solid = this.Manifold.extrude(cs, opts.height);
        if (translateZ === 0) return solid;
        const moved = solid.translate(0, 0, translateZ);
        solid.delete();
        return moved;
      } finally {
        scratch.flush();
      }
    });
  }

  /**
   * Cached form of manifoldFromGeometry. The pattern unit (an uploaded STL) is identical
   * across every settings change, but welding + Manifold.ofMesh was re-running each time.
   * Manifold ops are non-mutating, so callers can freely transform the returned object.
   */
  cachedManifoldFromGeometry(geo: SerializedGeometry): M {
    return geometryCache.getOrCreate(`unit:${hashGeometry(geo)}`, () => {
      const numVert = geo.position.length / 3;
      const triVerts = geo.index
        ? new Uint32Array(geo.index)
        : Uint32Array.from({ length: numVert }, (_v, i) => i);
      const mesh = new this.Mesh({ numProp: 3, vertProperties: new Float32Array(geo.position), triVerts });
      mesh.merge();
      return this.Manifold.ofMesh(mesh);
    });
  }

  /** Build a Manifold from raw geometry buffers (welds coincident verts first). */
  manifoldFromGeometry(geo: SerializedGeometry): M {
    const numVert = geo.position.length / 3;
    const triVerts = geo.index
      ? new Uint32Array(geo.index)
      : Uint32Array.from({ length: numVert }, (_v, i) => i);
    const mesh = new this.Mesh({ numProp: 3, vertProperties: new Float32Array(geo.position), triVerts });
    mesh.merge(); // weld coincident vertices so an STL triangle-soup becomes a manifold
    return this.track(this.Manifold.ofMesh(mesh));
  }

  /**
   * Extract position (+optional sharp-edge normals) and index buffers.
   *
   * Normals come from computeSharpNormals rather than Manifold's calculateNormals: the
   * latter is quadratic on sharp-edged meshes (which every faceted grip pattern is) and
   * was the dominant cost of the whole pipeline. See normals.ts.
   */
  serializeMesh(m: M, withNormals: boolean): SerializedGeometry {
    const mesh = m.getMesh();
    const np = mesh.numProp;
    const vp = mesh.vertProperties;
    const nv = vp.length / np;
    let position: Float32Array;
    if (np === 3) {
      // Common case: position-only mesh, so the buffer is already the layout we want.
      position = new Float32Array(vp.buffer as ArrayBuffer, vp.byteOffset, nv * 3).slice();
    } else {
      position = new Float32Array(nv * 3);
      for (let i = 0; i < nv; i++) {
        position[i * 3] = vp[i * np];
        position[i * 3 + 1] = vp[i * np + 1];
        position[i * 3 + 2] = vp[i * np + 2];
      }
    }
    const index = new Uint32Array(mesh.triVerts);
    if (!withNormals) return { position, index };
    return computeSharpNormals(position, index, SHARP_ANGLE);
  }
}
