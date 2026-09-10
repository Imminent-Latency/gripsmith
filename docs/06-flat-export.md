# Flat cut-path export — SVG and DXF for vinyl and laser

**Doc ID:** `06-flat-export`
**Status:** Ready to implement (06a) · Gated (06b)
**Owner:** @liamstar
**Root doc:** [`./00-architecture.md`](./00-architecture.md) — its §5 contracts and §10 rules bind this document.
**Evidence base:** `docs/_source/00-recon-report.md` (§2 "No flat (2D) export path" row, §5 "06 — flat export", §6 M4a/M4b). The §9 recon is **done**; every task below starts from that report.

| | **06a — outline flat export** | **06b — pattern footprint export** |
|---|---|---|
| Milestone | **M4a** (root §8) | **M4b** (root §8) |
| Touches the core? | **No.** Main thread only. | **Yes.** `patternPipeline.ts` + the worker protocol. |
| Blocked by | Nothing. Shippable in parallel with M2/M3. | (1) the root §10 **read-only contour channel amendment** — *adopted 2026-09-03*; (2) **M3** (docs 02/03) for a 2D pattern unit to project. |
| Blocks | Nothing. | Nothing. |
| Effort | S–M | M |

The two halves share one in-memory contour model and both file writers. Everything else about them differs — cost, risk, blockers, and acceptance. **They are separately shippable and separately acceptance-tested. 06a must not wait for 06b.**

---

## 1. Summary

Upstream has **four** download sites and none is vector: binary STL (`src/components/OutputPanel.tsx:125-136`), 3MF (`:206-216`), a watermarked PNG (`src/components/ScreenshotManager.tsx:110-114`), and the project `.zip` (`src/utils/projectUtils.ts:79-86`). Riders who cut grip tape on a vinyl plotter or a laser get nothing.

This doc adds the fork's **second physical output**: closed cut paths in millimetres, written as an **SVG document** and an **R12 DXF**, both emitted from one shared in-memory contour list.

- **06a** exports the **pad perimeter and its holes**. The source is already a complete 2D `THREE.Shape[]` sitting on the main thread — `BaseSettings.cutoutShapes` (`src/types/schemas.ts:14`), the same array the base plate extrudes from at `src/components/ImperativeModel.tsx:449-451`, with holes still attached and curves still un-flattened. `OutputPanel` is constructed inside the component that owns that state (`src/App.tsx:107-113`), so the wiring is three props and `src/components/Controls.tsx` is not edited at all. Mirror and rotation are a **mesh transform** on the preview (`src/components/ImperativeModel.tsx:472-474`), never baked into `cutoutShapes`, so the exporter must apply them itself.
- **06b** exports the **pattern footprint**. There is no 2D source for it anywhere: every `CrossSection` is freed by `finally { ops.flush() }` (`src/utils/geometry/patternPipeline.ts:369-371`) and `PatternResult` carries only mesh buffers (`:84-89`). Contours must therefore be produced inside the worker and returned across the boundary.

**Do not chain SVG → DXF.** Revision 1 of the root doc proposed `Polygon[] → SVG → SVG→DXF`; that hop is the wrong shape and is dead. Reasons, all checkable: `generateSVGPath` concatenates every shape into **one** `d` string (`src/utils/dxfUtils.ts:471`, `:492`) so region identity is destroyed; it re-encodes holes as reversed subpaths that only mean anything under the SVG `evenodd` fill rule (`:481-489`), and **DXF has no fill rule**, so hole identity would have to be re-derived by point-in-polygon after being thrown away; and `dxf-parser` is read-only — its class declares only readers, `parse`, `parseSync` and `parseStream`, plus `registerEntityHandler`, and no serializer (`node_modules/dxf-parser/dist/DxfParser.d.ts`), so there is nothing to parse an SVG-derived DXF back through. One contour list, two independent writers.

## 2. Goals / Non-Goals

**Goals**

1. Emit a **closed**, millimetre-accurate cut path for the pad outline, holes included, correctly nested (06a).
2. Emit the same for the generated pattern footprint, matching the 3D preview exactly (06b).
3. Two formats from one model: an SVG document (not a bare `d` string) and an R12 DXF.
4. Layer and colour conventions that survive both LightBurn's and Silhouette Studio's import behaviour (§6.2).
5. Set an **explicit flattening tolerance** at export, replacing the implicit `getPoints()` default of 12 divisions (root §7, "Curves are flattened at 12 divisions and never recover"). **Sampling must happen before the mirror/rotate transform** — transforming first rebuilds the shape out of line segments and the tolerance becomes a no-op (§4.3).
6. Ship 06a without touching the core, the worker, or `Controls.tsx`.

**Non-Goals**

- **No kerf/blade compensation in 06a.** Offsetting a polygon requires `CrossSection.offset` (`src/utils/geometry/manifoldOps.ts:151`), which lives in the wasm; calling it on the main thread means a second Manifold realm — `getManifold` memoizes its promise per realm (`src/utils/geometry/manifoldModule.ts:15`, `:17-27`) — and therefore a second compile of the 541.47 kB wasm (`docs/_source/baseline-verification.md:74`). Rule 5 permits a second realm only *with a stated reason*, and there is none here: the offset can run worker-side. `offsetUtils` — the only main-thread alternative — is deleted in M0 (root §4.1). Kerf is a **06b-only** feature, applied worker-side before readback (task 17).
- No slicing of the assembled model. The exported model is a multi-body assembly of interpenetrating solids with **no boolean union between Base, Pattern and Inlays** (root §7, Correctness). 06a takes the outline, 06b takes the pattern footprint, and they are combined **downstream in the cut file**, never upstream in geometry.
- No inlay flat export. Inlays are a separate lane with their own placeholder/clipping asymmetry (`src/components/ImperativeModel.tsx:639`); out of scope here.
- No registration marks, nesting/tiling for sheet layout, weeding boxes, or machine-specific G-code.
- No changes to STL or 3MF (root §3 non-goal 4). `handleExport` (`src/components/OutputPanel.tsx:77-137`) and `handleExport3MF` (`:181-226`) are untouched.
- No PDF, EPS, or AI output.

## 3. Contract mapping (root §5)

| §5 contract | Produce / consume | Real name and location |
|---|---|---|
| **`Polygon`** | consume, then **re-use the existing wire type** — the geometry this doc carries is unmodified `SerializedShape`; see §4.2 for why the `CutRegion` wrapper is not a seventh representation | Main thread (06a): `THREE.Shape` with `.holes: THREE.Path[]` — `src/types/schemas.ts:14`. Wire and cut model (both halves): **`SerializedShape { points: number[]; holes: number[][] }`** — `src/utils/geometry/serialize.ts:15-18`, flat `[x0,y0,x1,y1,…]`, mm, implicitly closed. CSG readback (06b): `SimplePolygon = Vec2[]` from `CrossSection.toPolygons()` — `node_modules/manifold-3d/manifold-encapsulated-types.d.ts:394`, `node_modules/manifold-3d/manifold-global-types.d.ts:80`. |
| **`Outline`** | consume | `BaseSettings.cutoutShapes` — `src/types/schemas.ts:14` (`ThreeShapeSchema` asserts only `Array.isArray`, `:7`), plus `baseOutlineRotation` (`:15`) and `baseOutlineMirror` (`:16`). Written by `handleOutlineLoaded` (`src/components/controls/BaseControls.tsx:31-38`), shared by upload and library. |
| **`ShapeSource`** | **neither** | This doc is a *sink*, not a source. It produces no shapes into `patternShapes` and defines no producer. |
| **`Generator<P>`** | consume, indirectly (06b only) | 06b reads the output of whatever occupies `PatternJob.patternUnit` (`src/utils/geometry/patternPipeline.ts:73`). It adds no generator param. |
| **`DesignState`** (`ProjectSchemaV1` → `ProjectData`, `src/types/schemas.ts:87-96`) | **neither** | Export settings are transient and user-initiated. Per rule 3, only tunables *that change the geometry* belong in a settings schema; a kerf value and a tolerance change the **file**, not the design. Nothing is added to `ProjectSchemaV1`, so `getDefaults` (`src/utils/schemaDefaults.ts:6-12`) is untouched. *(Revisit only if kerf ever needs to persist per-project — see §8 Q4.)* |

**New names coined by this doc.** Each is marked **(new — does not exist yet)** at first use in §4 and appears nowhere in `src/` today:
`CutLayerName`, `CutRegion`, `CutPathSet`, `dropTerminalDuplicate`, `enforceWinding`, `isDegenerate`, `hasSelfIntersection`, `boundsOf`, `writeCutSvg`, `writeCutDxf`, `outlineToCutPaths`, `patternContoursToCutPaths`, `transformOutlinePoints`, `transformOutlineShapes`, `OutlineTransform`, `divisionsForTolerance`, `downloadText`, `FLAT_TOLERANCE_MM`, `PatternJob.emitContours`, `PatternJob.kerfMm`, `PatternResult.contours`, `submitFlat`, worker kind `'flat'`.

Verify before implementing: `grep -rn "CutPathSet\|CutRegion\|outlineToCutPaths\|transformOutlinePoints\|dropTerminalDuplicate\|enforceWinding\|isDegenerate\|hasSelfIntersection\|boundsOf\|emitContours\|kerfMm\|submitFlat" src/` returns **zero hits** on the tree as received, as does `grep -rniE "selfintersect|self-intersect|self_intersect" src/`.

## 4. Design

### 4.1 File layout

New code lives in a **new folder**, `src/utils/export/`. It is under `src/utils/**`, which is already on the Vitest coverage allowlist (`vite.config.ts:30-35`) — **no `vite.config.ts` edit is needed for `src/utils/export/**` or for `src/utils/geometry/outlineTransform.ts`**, unlike most workstreams.

**But the UI wiring is not covered.** The allowlist is exactly `src/utils/**`, `src/context/**`, `src/components/DebouncedInput.tsx`, `src/components/Spinner.tsx` (`vite.config.ts:30-35`). The new button and handler code in `src/components/OutputPanel.tsx` (task 8, root §8 M4a's exit) therefore **reports 0 % silently** — root rule 6's shared-file table names this exact failure for this exact line (`docs/00-architecture.md:296`). This is **accepted**: `OutputPanel.tsx` is tested behaviourally by criterion A7b and simply is not counted. If a coverage number for it is ever wanted, add `src/components/OutputPanel.tsx` to `vite.config.ts:30-35` — that is a config edit and must be called out in the commit.

```
src/utils/export/                       NEW FOLDER — no upstream file here
  cutPaths.ts          CutLayerName, CutRegion, CutPathSet, ring hygiene, bounds,
                       hasSelfIntersection
  cutPaths.test.ts
  outlineContours.ts   06a producer: cutoutShapes + transform -> CutPathSet
  outlineContours.test.ts
  patternContours.ts   06b producer: SerializedShape[] from the worker -> CutPathSet
  patternContours.test.ts
  svgWriter.ts         writeCutSvg(set): string
  svgWriter.test.ts
  dxfWriter.ts         writeCutDxf(set): string   (R12 / AC1009)
  dxfWriter.test.ts
  download.ts          downloadText(filename, mime, text)

src/utils/geometry/
  outlineTransform.ts  NEW FILE in a shared folder — the single mirror/rotate helper
  outlineTransform.test.ts
```

Shared files that must be touched, and why isolation is impossible:

| File | Lines | Change | Why it cannot be isolated |
|---|---|---|---|
| `src/components/OutputPanel.tsx` | `:9-13` props; insert after `:248` | 3 optional props + 2 buttons | The export UI is this component. There is no button registry — `exportControls` is a single opaque `ReactNode` (`src/components/Controls.tsx:29`, rendered `:302-306`). |
| `src/App.tsx` | `:108-113` | 3 JSX attributes on the existing `<OutputPanel>` | `OutputPanel` is constructed here, inside the component that owns `baseSettings` (`:15`). |
| `src/components/ImperativeModel.tsx` | `:183-202` (outers), `:211-228` (holes) | replace two inline transform blocks with calls to `transformOutlinePoints` | The mirror/rotate maths is duplicated **in place**; extracting it is the only way to satisfy root §8 M4a's "a single extracted helper — not a fourth copy". Pure substitution, no behaviour change **only if the whole block is replaced** — see the warning below. |
| `src/utils/geometry/patternPipeline.ts` | `:51-82`, `:84-89`, `:224-228`, `:298-311` window, `:357-366`/`:368`; **06b task 17 adds the `kerfMm` offset before `toPolygons()` on *both* contour paths** — the CSG capture serialised into the `return` at `:368`, and the instanced fast path at `:224-228` | **06b only.** Three optional fields + two additive capture blocks + the kerf offset on both | The pattern footprint exists only here. Permitted by the root §10 amendment under its five conditions (§4.6). |
| `src/workers/geometryWorker.ts` | `:21-24`, `:36-42`, `:44-48` | **06b only.** third request kind | Closed union; one file. |
| `src/utils/geometry/patternClient.ts` | `:17`, `:31-32`, `:63`, after `:101` | **06b only.** third slot + `submitFlat` | Single client, hardcoded pump priority. |

`src/components/Controls.tsx` is **not** in this table and must remain untouched (root §8 M4a exit criterion).

> **Warning — replace the whole transform block, mirror included.** Each of the two blocks is *three* steps in source order: mirror (`:183-185` outers, `:211-213` holes), rotate (`:188-196`, `:215-223`), reverse-on-mirror (`:200-202`, `:226-228`). `transformOutlinePoints` performs all three (§4.3). Replacing only the rotation step leaves the original mirror at `:183-185` / `:211-213` in place **and** applies it again inside the helper — a double negation, i.e. identity — which silently breaks mirrored-outline clipping in shipped code. Nothing in the current suite covers `baseOutlineMirror` through this `useMemo` — `grep -rln baseOutlineMirror src/ | grep test` returns only `src/utils/schemaDefaults.test.ts` — so `pnpm test` will stay green while the preview is wrong. The substitution is behaviour-preserving **only** when the two ranges in the table above (`:183-202` and `:211-228`) are replaced **whole**. Every narrower range is unbalanced: `:189` and `:216` are the bodies of the rotation `if`s opened at `:188`/`:215`, `:212` is the body of the mirror `if` opened at `:211`, and `:201` sits inside the reverse `if` opened at `:200`.

Note, so nobody is surprised: `renderFooter` is called twice (`src/components/Controls.tsx:408` mobile, `:411` desktop), so **`OutputPanel` mounts twice**, each behind a responsive `hidden` class. Any state added to it exists in two instances. This is already true of the STL/3MF buttons; keep the new buttons stateless.

### 4.2 The shared cut model

```ts
// src/utils/export/cutPaths.ts                      (new — does not exist yet)
import type { SerializedShape } from '../geometry/serialize';

/** Layer identity. This is what a cutter maps to a tool/speed/power setting. */
export type CutLayerName = 'OUTLINE' | 'HOLES' | 'PATTERN';   // (new)

export interface CutRegion {                                   // (new)
  /** Layer for the OUTER ring. Hole rings always emit on 'HOLES'. */
  layer: Exclude<CutLayerName, 'HOLES'>;
  /**
   * EXISTING type — `src/utils/geometry/serialize.ts:15-18`. Millimetres.
   * Rings are implicitly closed (root rule 1): no duplicate terminal vertex.
   * Outer ring CCW (positive signed area), holes CW.
   */
  shape: SerializedShape;
}

export interface CutPathSet {                                  // (new)
  regions: CutRegion[];
  /** Millimetres, in three.js axis convention (+Y up). Writers flip if their format needs it. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}
```

**Why `SerializedShape` and not a new geometry type.** The root §5 preamble records six live representations and instructs *convert at the existing seam*, not *invent another*. `SerializedShape` is already exactly "flat outer ring + flat hole rings, millimetres, implicitly closed", it is already the worker wire type, and — decisively for 06b — it is plain `number[]`, so it structured-clones by copy and needs **no entry in `patternResultTransferables`** (`src/utils/geometry/patternPipeline.ts:92-100`).

**Is `CutRegion` a seventh representation?** Structurally it is the same shape as live representation #2, `{ shape: THREE.Shape; color: string }` (root §5 table row 2 — `src/utils/shapeLoader.ts:53`, mirrored as `InlayJobShape` at `src/utils/geometry/inlayPipeline.ts:15-18`), which the root doc names as "the one un-named wrapper" and blames for `InlayItemSchema.shapes` degrading to `z.array(z.any())` (`src/types/schemas.ts:22`). So the honest claim is not "no seventh representation" — it is that this wrapper does not carry that wrapper's cost, for three checkable reasons:

1. **It is a terminal sink.** A `CutPathSet` is consumed only by `writeCutSvg` / `writeCutDxf` and then by a `Blob`. It never re-enters `patternPipeline.ts`, never crosses back over the worker serialisation seam, and no producer emits it — §3 already records this doc as neither a `ShapeSource` nor a `Generator<P>`.
2. **It is never persisted.** Nothing is added to `ProjectSchemaV1` (§3, `DesignState` row), so it can never become a `z.any()` in a schema the way representation #2 did.
3. **The geometry it carries is unmodified `SerializedShape`.** The wrapper adds one string field (`layer`) and no coordinate semantics; drop the wrapper and you are holding the existing wire type.

That is what root §5's *convert at the existing seam* asks for. If any of the three ever stops being true — a cut set is fed back into the pipeline, or persisted — this decision must be revisited.

Helpers in the same module. All five are **(new — do not exist yet)**; the `// src/utils/export/cutPaths.ts (new — does not exist yet)` header above applies to them:

| Function | Contract |
|---|---|
| `dropTerminalDuplicate(ring: number[]): number[]` | Removes a final vertex within `1e-9` of the first. **Required**: DXF-sourced rings *always* carry an explicit duplicate, because `build()` is called with `force = true` for closed **and** open chains (`src/utils/dxfUtils.ts:384`, `:387-388`), while shapes from `new THREE.Shape(points)` do not. |
| `enforceWinding(shape: SerializedShape): SerializedShape` | Outer CCW, holes CW, via signed area. Precedent for CCW outers: `src/utils/dxfUtils.ts:392-397`. |
| `isDegenerate(ring: number[]): boolean` | `ring.length < 6` — fewer than 3 vertices. Mirrors the silent drop at `src/utils/geometry/manifoldOps.ts:86` (also `:93`, `:132`), but here it must **report**, not vanish. |
| `hasSelfIntersection(ring: number[]): boolean` | True when any two non-adjacent segments of the flat ring cross. Pure predicate, **no repair** — 06a has no 2D engine to repair with (§6.1). O(n²) segment-pair test is acceptable: it runs once per ring at export time, never in the preview loop. Zero prior art in the tree — `grep -rniE "selfintersect\|self-intersect\|self_intersect" src/` returns nothing. Called by the export button over the returned `CutPathSet`, not by `outlineToCutPaths` (§6.1). Pinned by criteria A12a/A12b. |
| `boundsOf(regions: CutRegion[])` | Bounding box in mm, over every ring including holes. |

### 4.3 06a — outline producer

```
BaseSettings.cutoutShapes   schemas.ts:14   (raw, holes attached, curves intact)
baseOutlineMirror           schemas.ts:16
baseOutlineRotation         schemas.ts:15
        │
        ▼   props on OutputPanel        src/components/OutputPanel.tsx:9-13
outlineToCutPaths(shapes, t)            src/utils/export/outlineContours.ts      (new)
        │   1. refuse when cutoutShapes is null/empty
        │   2. SAMPLE FIRST: shape.getPoints(divisionsForTolerance(shape, FLAT_TOLERANCE_MM))
        │      — on the RAW shape, while its absarc curves are still alive
        │   3. THEN transformOutlinePoints(pts, t)   src/utils/geometry/outlineTransform.ts (new file)
        │      mirror x → rotate → REVERSE ring when mirrored
        │   4. dropTerminalDuplicate · enforceWinding · isDegenerate
        ▼
      CutPathSet
        ├──────────────► hasSelfIntersection(ring) over set.regions, in the BUTTON
        │                → one useAlert warning; the file is written anyway (§6.1)
        ├──────────────► writeCutSvg()   svgWriter.ts   → downloadText(*.svg)
        └──────────────► writeCutDxf()   dxfWriter.ts   → downloadText(*.dxf)
```

**Why the raw array and not `filledCutoutShapes`.** The `useMemo` at `src/components/ImperativeModel.tsx:158-237` produces exactly the wrong thing for cutting: it **promotes every hole to a top-level shape** in a separate `holeShapes` array (declared `:177`, filled by the hole loop `:207-234` — the `holes.push(holeShape)` at `:232` — returned `:236`), destroying nesting, and it flattens through `getPoints()` at the default 12 divisions (`:180`). Raw `cutoutShapes` keeps holes attached and — for a DXF outline — still carries live `absarc` curves (`src/utils/dxfUtils.ts:171-172`), because `parseDxfToShapes` only rebuilds *negative-area* rings as polylines (`:395`). That is the whole reason 06a can sample at a chosen tolerance instead of inheriting 12.

**The transform helper.**

```ts
// src/utils/geometry/outlineTransform.ts               (new — does not exist yet)
export interface OutlineTransform { mirror: boolean; rotationDeg: number; }   // (new)

/** mirror x → rotate about (0,0) → reverse the ring if mirrored (mirror flips winding). */
export function transformOutlinePoints(                                        // (new)
  pts: THREE.Vector2[], t: OutlineTransform,
): THREE.Vector2[];

/** Same, applied to outers and holes, holes preserved as holes. NOT on the export path — see below. */
export function transformOutlineShapes(                                        // (new)
  shapes: THREE.Shape[], t: OutlineTransform,
): THREE.Shape[];
```

**Order is load-bearing: sample first, transform second.** `transformOutlinePoints` is defined over `THREE.Vector2[]`, so applying it *per shape* necessarily means `getPoints()` → transform → `new THREE.Shape(pts)` — exactly the destructive sequence at `src/components/ImperativeModel.tsx:180` then `:204`. A `THREE.Shape` rebuilt from a point list holds only `LineCurve`s, and `CurvePath.getPoints(n)` resolves a line curve at resolution **1 regardless of `n`** (`node_modules/three/src/extras/core/CurvePath.js:207-210`), so after that rebuild `divisionsForTolerance` has nothing left to resample and every mirrored or rotated outline silently exports at the default 12. `outlineToCutPaths` therefore **must not** call `transformOutlineShapes`: it samples each *raw* shape at `divisionsForTolerance(shape, FLAT_TOLERANCE_MM)` and applies `transformOutlinePoints` to the resulting array. `transformOutlineShapes` exists as the shape-level wrapper for main-thread callers that need `THREE.Shape[]` back out (the `useMemo` shape); it is not part of the export path, and criterion A10 is written to catch a build that wires it in anyway.

Semantics are copied verbatim from `src/components/ImperativeModel.tsx:183-202` (outers) and `:211-228` (holes) — all three steps, in that order: mirror x (`:183-185` / `:211-213`), rotate (`:188-196` / `:215-223`), then `pts.reverse()` when mirrored (`:200-202` / `:226-228`). The reverse is deliberate and commented: `// Mirror flips winding. Explicit reverse if mirrored.` at `:199`, and `// 4. Enforce Winding for Holes` at `:225`. **Do not copy `:472-474`**, the *mesh* transform, which is a negative scale with no index reversal and is exactly the bug that makes the mirrored base export with inverted facets (root §7, Correctness).

**Five sites apply `baseOutlineRotation * (Math.PI / 180)` today**, not three. `grep -n` finds four in `ImperativeModel.tsx` (`:189`, `:216`, `:474`, `:499`) plus one in `ModelViewer.tsx` (`:526`):

| # | Site | Kind | Disposition |
|---|---|---|---|
| 1 | `ImperativeModel.tsx:189-190` | point transform, outers | **Collapsed by task 2** into `transformOutlinePoints`. |
| 2 | `ImperativeModel.tsx:216-217` | point transform, holes | **Collapsed by task 2.** |
| 3 | `ImperativeModel.tsx:472-474` | mesh transform, inside the extrude effect (deps `:490`) | **Out of scope.** Carries the un-reversed-winding bug; do not "fix" it here. |
| 4 | `ImperativeModel.tsx:498-499` | mesh transform, inside the separate `Base transform (mirror / rotation)` effect at `:492-500` | **Out of scope.** A second copy that re-applies scale and rotation on every rotation/mirror change without rebuilding geometry. Easy to miss; it is not a regression when it survives task 2. |
| 5 | `ModelViewer.tsx:526-527` | green outline overlay | **Out of scope**, stays. |

Only sites 1 and 2 are point transforms, and only they are replaced. Criterion A8 is scoped accordingly.

**Flattening tolerance.** Root §7 requires this doc to set one explicitly. `getPoints()` defaults to 12 divisions, resolved per curve type (`node_modules/three/src/extras/core/CurvePath.js:199-212`), so a DXF `CIRCLE` becomes a 24-gon at any radius — **0.428 mm sag at R = 50**, four hundred times `CUTTER_TOLERANCE = 0.001` mm (`src/utils/geometry/manifoldOps.ts:47`).

```ts
// src/utils/export/outlineContours.ts
/** Chord sag budget for exported cut paths, mm. Tighter than a vinyl blade or a laser kerf. */
export const FLAT_TOLERANCE_MM = 0.05;                                        // (new)

/** n ≥ π / arccos(1 − τ/R), clamped to [12, 512]; R from the shape's bounding radius. */
function divisionsForTolerance(shape: THREE.Shape, tolMm: number): number;    // (new)
```

Two honest limits on this, both of which belong in the doc rather than in a surprised implementer's head:

- It only helps where curves survived import. It is real for DXF outer rings; it is **worthless for SVG-sourced outlines**, because `centerShapes` re-samples through `getPoints()` at the default and rebuilds with `moveTo`/`lineTo` (`src/utils/patternUtils.ts:961-985`), permanently flattening at import. This is not on the critical path, because **the outline uploader is gated to DXF in code**: `allowedTypes={['dxf']}` (`src/components/controls/BaseControls.tsx:53`), so an `.svg` cannot be selected into the outline slot at all. Corroborated by the catalog — all 17 outline presets are `.dxf` (`src/components/PatternLibraryModal.tsx:49-65`, 17 matching files in `public/outlines/`). The one remaining way an SVG reaches the slot is the deliberate content-sniff override in `parseShapeFile`, which re-types a `.dxf`-named file to `svg` when its content starts with `<svg`/`<?xml` (`src/utils/shapeLoader.ts:20-29`; the report records this override as deliberate and test-pinned, `docs/_source/00-recon-report.md:254`).
- It is also worthless for DXF rings with negative area, which `parseDxfToShapes` rebuilds as polylines, **discarding their arcs** (`src/utils/dxfUtils.ts:395`).

The import-side half of the fix is task 9 — optional, behaviour-changing in shared code, and must be coordinated with docs 01 and 07.

**Refusal.** `outlineToCutPaths` returns `null` when `cutoutShapes` is `null` or empty. It must **never** fall back to the synthesised square built at `src/components/ImperativeModel.tsx:163-174`; that square is a clip-boundary convenience with no physical meaning, and it is sized from `BaseSettings.size` (`src/types/schemas.ts:11`, default 300 but user-editable), so **do not gate on the value 300**. The button surfaces the refusal through `useAlert`, already imported and used in this file (`src/components/OutputPanel.tsx:4`, `:91`).

### 4.4 The SVG writer

```ts
// src/utils/export/svgWriter.ts
export function writeCutSvg(set: CutPathSet): string;      // (new — does not exist yet)
```

Output shape:

```svg
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1"
     width="206.1mm" height="173.4mm"
     viewBox="-103.05 -86.7 206.1 173.4">
  <g id="OUTLINE" fill="none" stroke="#000000" stroke-width="0.1">
    <path d="M -103.05 -86.7 L … Z"/>
  </g>
  <g id="HOLES" fill="none" stroke="#0000FF" stroke-width="0.1">
    <path d="M 12.5 -30.2 L … Z"/>
  </g>
</svg>
```

Rules, each with its reason:

| Rule | Reason |
|---|---|
| `width`/`height` carry the literal `mm` suffix; `viewBox` is the same numbers unitless | An importer given a unitless SVG guesses a DPI. `SVGLoader` in this very repo demonstrates the failure: it keeps px/90 defaults and never reads `viewBox`, so `100mm` becomes 354.33 units (`src/utils/shapeLoader.ts:43`; `node_modules/three-stdlib/loaders/SVGLoader.js:7-8`). |
| Y is **negated at write time**; no `transform` attribute anywhere | three.js is +Y up, SVG is +Y down. `DXFThumbnail.tsx:42-56` handles this by biasing the viewBox and applying `scale(1,-1)` at render (its comment at `:48-53` walks the algebra). A `transform` on a group is a risk in thin SVG importers — bake the flip into the coordinates so the file needs no interpretation. `viewBox` minY is therefore `-bounds.maxY`, matching `DXFThumbnail.tsx:55` exactly, minus its padding. |
| One `<path>` per ring; one `<g>` per layer | Region identity and layer identity must both survive. This is the single thing `generateSVGPath` cannot do (`src/utils/dxfUtils.ts:471`, `:492`). |
| Every `d` ends in `Z`; **no duplicate terminal vertex before it** | `Z` closes the subpath; a repeated first point plus `Z` produces a zero-length segment that some cutters treat as a dwell. |
| `fill="none"`, explicit `stroke`, `stroke-width="0.1"` | A cutter follows strokes. A filled path can import as a raster/engrave region. |
| Coordinates formatted with `toFixed(4)`, trailing zeros stripped | 0.1 µm resolution, far under any machine tolerance, and it makes output byte-stable for tests. |

### 4.5 The DXF writer

```ts
// src/utils/export/dxfWriter.ts
export function writeCutDxf(set: CutPathSet): string;      // (new — does not exist yet)
```

`dxf-parser` (`package.json:24`) is **read-only** — its class declares only readers (`parse`, `parseSync`, `parseStream`) plus `registerEntityHandler`; there is no serializer (`node_modules/dxf-parser/dist/DxfParser.d.ts`). There is no writer in the dependency tree. We author one.

Structure: `HEADER` → `TABLES` (`LAYER` table with our three layers) → `ENTITIES` → `EOF`.

| Header var | Value | Note |
|---|---|---|
| `$ACADVER` | `AC1009` | R12. |
| `$INSUNITS` | `4` | Millimetres. `parseDxfToShapes` reads exactly this and maps `4 → scaleFactor 1.0` (`src/utils/dxfUtils.ts:60-71`). |
| `$MEASUREMENT` | `1` | Metric. Belt and braces: if a reader ignores `$INSUNITS`, this is the fallback our own parser consults (`src/utils/dxfUtils.ts:76-81`), and `measurement === 0` would silently scale by 25.4. |
| `$EXTMIN` / `$EXTMAX` | from `set.bounds` | Lets an importer frame the drawing without scanning entities. |

**Entity: `POLYLINE` / `VERTEX` / `SEQEND` with `70 = 1` (closed) — not `LWPOLYLINE`.**

**The rule this writer follows: emit what the target readers accept, and declare the lowest version that carries it.** That rule, not version purism, decides both the entity choice and the header block above — `$INSUNITS` and `$MEASUREMENT` are themselves post-R12 header variables and are written anyway, for the same pragmatic reason, and they are load-bearing for criterion A5's round trip because our own parser reads exactly them (`src/utils/dxfUtils.ts:60-71`, `:76-81`). Applied to entities, the rule lands the other way: `LWPOLYLINE` was introduced with AC1014 (R14), it is not needed by either target reader, and `POLYLINE`/`VERTEX`/`SEQEND` is accepted by both — so there is no reason to pay for the inconsistency of declaring `$ACADVER = AC1009` while emitting an R14 entity, and Silhouette Studio's DXF reader is the conservative half of our target pair.

Root §8 M4a's exit criterion says "closed LWPOLYLINE". **That wording is wrong for an R12 file and this doc deliberately diverges from it.** The *substance* of the criterion — drop the terminal duplicate vertex before writing a closed polyline — is kept and tested (§6.4, criterion A6). §8 Q1 settles entity choice and the two header variables together, and **root §8 M4a's exit at `docs/00-architecture.md:433` must be amended to match whichever wins before M4a is signed off** — until then the doc set contradicts itself and an implementer reading the root milestone writes an `LWPOLYLINE`.

Round-tripping through our own parser works and is the basis of the acceptance test: `parseDxfToShapes` handles `'LWPOLYLINE' || 'POLYLINE'` in one branch (`src/utils/dxfUtils.ts:119`) and reads closure from `poly.shape || poly.closed` (`:126`), and `dxf-parser` ships a `polyline` entity handler (`node_modules/dxf-parser/dist/entities/polyline.js`) alongside `vertex.js`.

Axis: DXF is **+Y up**, the same as three.js. **No Y flip in the DXF writer.** This asymmetry against the SVG writer is deliberate and is pinned by a test (§6.4, criterion A4) because it is the single easiest thing to get backwards.

### 4.6 06b — the worker contour channel

06b operates strictly inside the root §10 amendment. Its five conditions map to this design one-to-one.

**First, reconcile conditions 1 and 3.** Condition 3 says "prefer a `kind:'flat'` request over widening `PatternResult`" (`docs/00-architecture.md:511`), and root §8 M4b's exit reads "A `kind:'flat'` request is added **rather than** widening `PatternResult`" (`:441`). This design does both halves: it adds the kind *and* adds `contours?: SerializedShape[]` to `PatternResult`. That is not a violation, because the amendment's preference is about **request routing**, not payload shape — the hazard it names in the same sentence is the latest-wins coalescing slot (`patternClient.ts:56`, `:63`), and that hazard is discharged in full by the third client slot (condition 3 row below). The optional `contours` field is the **payload carrier**, not the request mechanism; it is inert unless the request asked for it, which is condition 1. **Root §8 M4b's exit wording at `docs/00-architecture.md:441` carried the matching one-line amendment on 2026-09-04** — it now reads "added **as the request mechanism**" and explicitly permits one optional payload field (`PatternResult.contours?`), citing this section. A reviewer checking that exit no longer sees a forbidden half done.

| Amendment condition | How this design satisfies it |
|---|---|
| **1. Additive only** | Two optional fields — `PatternJob.emitContours?: boolean` (`src/utils/geometry/patternPipeline.ts:51-82`) and `PatternResult.contours?: SerializedShape[]` (`:84-89`). No statement between `:258` and `:298` (the boolean sequence) or inside `:300-355` (the mask split) changes. When `emitContours` is absent, not one extra wasm call runs. |
| **2. Read-only** | The channel calls `Manifold.project()` (`node_modules/manifold-3d/manifold-encapsulated-types.d.ts:1006`) on an already-computed `result`, then `CrossSection.toPolygons()` (`:394`). It introduces **no boolean into the preview path**. The instanced branch does perform 2D unions, but only inside the `emitContours` guard, which is never on the preview path. |
| **3. Opt-in, off the preview queue** | A third worker kind `'flat'` with its **own client slot**, so it can never overwrite a pending preview job in the coalescing latest-wins slot (`src/utils/geometry/patternClient.ts:56`, `:63`, `:75`). |
| **4. Both emission sites, before the mask subtract** | CSG path: capture `result` in the window **after** the max-height cut ends at `:298` and **before** `if (hasMasks)` opens at `:311`; emit it alongside the final mesh built at `:357-366`. Fast path: capture at the instanced early return `:224-228`. |
| **5. Wasm hygiene** | Everything created goes through `ops.track` (`src/utils/geometry/manifoldOps.ts:62`) and is released by the existing `finally { ops.flush() }` (`:369-371`). Nothing produced in a per-instance loop is cached — the use-after-free that `src/utils/geometry/patternPipeline.test.ts:162-182` regression-tests. |

**Why capture before the mask subtract.** `if (hasMasks)` ends with `result = track(result.subtract(allM))` at `:354`, carving the masked regions out of the main pattern and shipping them as separate coloured meshes. The masked regions are still *material* — they are a colour change, not a hole. Capturing after `:354` would silently emit a footprint full of holes wherever a recolour inlay sits. This is condition 4's exact hazard and it has a dedicated acceptance criterion (§6.4, B4b).

**Why the instanced site matters.** `useCSG = hasClipping || hasExclusions || hasMasks || hasHoles || hasHeightCut` (`:221`), and the fast path returns at `:224-228` before `Manifold.compose`. A user who turns "Clip to Edge" off takes that path; miss it and the export silently returns nothing.

Fast-path construction, since there is no composed solid to project:

```
unit (Manifold, from Manifold.extrude(cs, 1) at :139, or the STL geometry)
  → unit.project()                       -> CS  (one call, once)
  → per position p: cs2d.transform(mat3(p))     instanceMatrix at :205-213 is Z-rotation
                                                + uniform XY scale, so a 2D affine is exact
  → CrossSection.union(all)               (encapsulated-types.d.ts:329, batch form)
  → kerf: .offset(-kerfMm / 2, …)         task 17 — SAME offset as the CSG path
  → .toPolygons()
```

Do **not** compose the 3D instances and project the composite on this path — it does the expensive thing to get the cheap answer.

**Kerf applies on both paths.** The argument for the instanced site under condition 4 — a user who turns "Clip to Edge" off takes it, so miss it and the export silently returns nothing — applies verbatim to blade compensation: miss it and that same user gets a cut file with *no* kerf compensation, silently, and only finds out with calipers. The `kerfMm` offset therefore sits immediately before `toPolygons()` on **both** contour paths, and criterion B11 tests both.

#### `project()` vs `slice(z)` — decided: **`project()`**

Both ship in manifold-3d 3.5.1 and both have **zero call sites in `src/` today** (`slice(height)` at `manifold-encapsulated-types.d.ts:998`, `project()` at `:1006`), so this doc writes the first test for whichever it picks.

| | `project()` | `slice(z)` |
|---|---|---|
| Returns | Union of the whole solid's shadow on XY | The true section at one Z level |
| For a `kind:'shapes'` unit | Identical to `slice(z)` for every z in the tile — the unit is `Manifold.extrude(cs, 1)` (`:139`), a straight prism | Identical to `project()` |
| For an STL unit | Silhouette of a 3D model: the **widest** section, e.g. the base flare of a domed stud | One section, but which one? |
| Parameters | None | Needs a Z, which needs `thickness`, the mask lift `idx * 0.0001`, and the pattern sink `thickness - 0.01` |

**Decision and reasons, in order.**

1. **Cut paths must be conservative.** A footprint that misses part of a tile leaves an unbonded island of grip tape. `project()` is the upper bound of material presence — every `slice(z)` is a subset of it. A slightly generous footprint gets trimmed by the perimeter cut; a deficient one is scrap.
2. **It has no wrong answer to pick.** No Z parameter means no new control, no new persisted field, no cross-tab derived bound.
3. **On the path 06b actually targets it is free.** Once 02/03 land, the unit is a straight prismatic extrude and the two are identical.
4. **`slice(z)` reintroduces exactly the coupling the assembly warning forbids.** It would have to know the base thickness and the interpenetration epsilons of a multi-body assembly that is never unioned (root §7).

**Recorded caveat.** With today's STL unit, `project()` returns the silhouette of a 3D model, not its contact patch. That is one of the two reasons 06b is gated behind M3. If a contact-patch mode is ever wanted, add `PatternJob.sliceZ?: number` as a *further* additive field — explicitly a non-goal now.

#### Why 06b cannot be avoided, and why it is gated on 02/03

Two separate facts, often conflated:

- **A main-thread re-derivation is not available.** It is not merely discouraged (root §4.2 fact 2, "the trap") — in the shipping UI there is no 2D pattern source at all. The uploader is gated to `allowedTypes={["stl"]}` (`src/components/controls/GeometryControls.tsx:163`) and all 14 pattern presets are `.stl` (`src/components/PatternLibraryModal.tsx:19-32`), so `patternShapes[0] instanceof THREE.BufferGeometry` is always true and `buildJob` always takes `kind:'geometry'` (`src/components/ImperativeModel.tsx:829-830`). There is nothing on the main thread to re-run.
- **The projection is only meaningfully cuttable once a 2D generator exists.** See the `project()` caveat above. 06b's plumbing is correct for an STL unit; its *output* is not a cut path anyone wants until M3 lands.

### 4.7 What already exists

*(Placed here, inside §4 Design, so the eight numbered sections root §10 fixes stay in order.)*

Everything in this feature that is already in the codebase, so nobody rebuilds it.

| Piece | Where | State |
|---|---|---|
| SVG **path-data** generator | `src/utils/dxfUtils.ts:469-493` | Ships, unit-tested (`src/utils/dxfUtils.test.ts:223-256`), 3 consumers. Emits a merged `d` string only — 1 of 7 cutter requirements (§6.1). **Build beside it; do not modify.** |
| viewBox + Y-flip convention | `src/components/DXFThumbnail.tsx:42-56` (algebra in the comment at `:48-53`) | Ships. Reused by the SVG writer, minus its padding. |
| Blob → anchor → `revokeObjectURL` download idiom | `src/components/OutputPanel.tsx:125-136` | Ships. Copy its shape into `download.ts`; do not edit it (`:125` carries a pre-existing `tsc` error). |
| Blob/anchor **download test harness** | `src/utils/projectUtils.test.ts:17-23` — spies on `document.createElement`, `document.body.appendChild`/`removeChild`, and stubs `global.URL.createObjectURL` (returning `'blob:mock-url'`) and `global.URL.revokeObjectURL`; the assertions to mirror are at `:49-56` | Ships. jsdom supplies none of this on its own. **Copy it for task 7 and for A7b/A12b** rather than writing a new one. |
| Export button slot | `src/App.tsx:107-113`; `src/components/Controls.tsx:29`, `:302-306` | Ships. An opaque `ReactNode`, no registry — which is exactly why `Controls.tsx` needs no edit. |
| Raw, curve-bearing outline with holes attached | `BaseSettings.cutoutShapes` — `src/types/schemas.ts:14`; consumed at `src/components/ImperativeModel.tsx:449-451` | Ships. 06a's entire source. |
| Mirror / rotation point transform | `src/components/ImperativeModel.tsx:183-202` (outers), `:211-228` (holes) — each is mirror + rotate + ring reversal (`:183-185`/`:211-213`, `:188-196`/`:215-223`, `:200-202`/`:226-228`) | Ships, **duplicated in place**. Task 1 extracts it; task 2 replaces each range **whole** (§4.1 Warning). |
| DXF **reader** (the round-trip oracle) | `parseDxfToShapes` — `src/utils/dxfUtils.ts:46`; `POLYLINE`/`LWPOLYLINE` at `:119`; closed flag `:126`; `$INSUNITS`/`$MEASUREMENT` at `:60-81` | Ships. Makes criterion A5 possible without a new dependency. |
| Nesting / point-in-polygon | `src/utils/dxfUtils.ts:399-427` (module-private, inside `parseDxfToShapes`); `buildPolyIndex`/`pointInIndex` exported at `src/utils/patternUtils.ts:114`, `:181` (**outer ring only**) | Exists but not reusable as-is: the first is not exported, the second ignores holes. |
| 2D contour readback from wasm | `CrossSection.toPolygons()` — `node_modules/manifold-3d/manifold-encapsulated-types.d.ts:394`; exercised at `src/utils/geometry/manifoldCache.test.ts:167`, `:174` | Ships and is test-proven under Vitest/jsdom. |
| `Manifold.project()` / `slice(z)` | `manifold-encapsulated-types.d.ts:1006`, `:998` | Ship in 3.5.1, **zero call sites in `src/`**. 06b writes the first test for `project()`. |
| Polygon offset (kerf) | `src/utils/geometry/manifoldOps.ts:151` | Ships, used only for design margin. Worker-only. |
| Worker request/response plumbing | `src/workers/geometryWorker.ts:21-24`, `:26-50`; `src/utils/geometry/patternClient.ts:60-84`, `:97-101` | Ships. 06b extends the closed union; it does not create a worker. |
| Wire type for contours | `SerializedShape` — `src/utils/geometry/serialize.ts:15-18` | Ships. Reused as the cut model; no new geometry type. |
| Wasm tracking / free discipline | `ManifoldOps.track` `src/utils/geometry/manifoldOps.ts:62`; `finally { ops.flush() }` `src/utils/geometry/patternPipeline.ts:369-371` | Ships. 06b's contour objects go through it unchanged. |
| Alert surface for a refused export | `useAlert` — imported and used at `src/components/OutputPanel.tsx:4`, `:91` | Ships. |
| SVG **document** writer · DXF **writer** · layer/colour model · kerf on the main thread · any flat export button | — | **Nothing exists.** All net-new. `dxf-parser` is read-only (`node_modules/dxf-parser/dist/DxfParser.d.ts`) and `clipper-lib` is dead and deleted in M0. |

## 5. Integration points

| # | Site | Exact change |
|---|---|---|
| **06a-1** | `src/components/OutputPanel.tsx:9-13` (`OutputPanelProps`) | Add `cutoutShapes?: THREE.Shape[] \| null`, `baseOutlineMirror?: boolean`, `baseOutlineRotation?: number`. Names match the schema fields (`src/types/schemas.ts:14`, `:16`, `:15`) so the wiring is greppable. Destructure at `:15`. |
| **06a-2** | `src/components/OutputPanel.tsx`, insert after `:248` (`</button>` of Export Merged STL, opened at `:241`) | Two gray secondary buttons — "Cut Paths (SVG)", "Cut Paths (DXF)" — inside the existing `grid grid-cols-1 gap-2` opened at `:231`. Do **not** touch `:125` or its `Blob` line; that is the site of the one real pre-existing `tsc` error (`docs/_source/baseline-verification.md`). |
| **06a-3** | `src/App.tsx:108-113` | Three attributes on the existing `<OutputPanel>`: `cutoutShapes={baseSettings.cutoutShapes}`, `baseOutlineMirror={baseSettings.baseOutlineMirror}`, `baseOutlineRotation={baseSettings.baseOutlineRotation}`. `baseSettings` is already in scope (`src/App.tsx:15`). |
| **06a-4** | `src/components/ImperativeModel.tsx:183-202` (outers) and `:211-228` (holes) | Replace both inline mirror/rotate/reverse blocks — **whole, mirror step included** — with `transformOutlinePoints(pts, { mirror: baseOutlineMirror, rotationDeg: baseOutlineRotation })`. These are the only two ranges that are balanced and complete; anything starting at `:189`, `:212` or `:216` opens mid-`if` and leaves the original mirror in place, which is the double negation §4.1's Warning describes. Behaviour-identical; the `useMemo` dependency array at `:237` is unchanged. |
| **06b-1** | `src/utils/geometry/patternPipeline.ts:51-82` | `emitContours?: boolean` on `PatternJob`. Destructure alongside `:108-112`. |
| **06b-2** | `src/utils/geometry/patternPipeline.ts:84-89` | `contours?: SerializedShape[]` on `PatternResult`. `patternResultTransferables` (`:92-100`) needs **no change** — `number[]` is not transferable. |
| **06b-3** | `src/utils/geometry/patternPipeline.ts`, between `:298` and `:311` | `if (job.emitContours) { capturedFootprint = track(result.project()); }`. Nothing else in that window. |
| **06b-4** | `src/utils/geometry/patternPipeline.ts:224-228` | Inside the instanced early return, build contours from `unit.project()` + per-position 2D transform + `CrossSection.union`, then the **`kerfMm` offset (task 17)**, then `toPolygons()`, and attach to the object returned at `:228`. |
| **06b-5** | `src/utils/geometry/patternPipeline.ts:368` (the `return` statement; the final mesh it sits beside is built at `:357-366`) | Apply the **`kerfMm` offset (task 17)** to `capturedFootprint`, then serialise `capturedFootprint.toPolygons()` into `contours` on the returned `PatternResult`. |
| **06b-6** | `src/workers/geometryWorker.ts:21-24` | Widen the union with `\| { kind: 'flat'; job: PatternJob }`. |
| **06b-7** | `src/workers/geometryWorker.ts:36-42` | Route `'flat'` to `generatePattern` and post back with `kind: req.kind`. **`'flat'` stays *below* `await getManifold()` at `:35`** — rule 5's "handle a polygon-only kind above the await" does **not** apply, because this kind runs the full CSG. Say so in a comment or someone will move it. **Accepted cost, stated so nobody discovers it in a profiler:** routing to `generatePattern` means a flat job runs the *whole* pipeline, including `serializeMesh` over the composed solid (`src/utils/geometry/patternPipeline.ts:361`) and therefore `computeSharpNormals` (`src/utils/geometry/manifoldOps.ts:217`) — which the evidence base names as the pipeline's dominant CPU cost (`docs/_source/00-recon-report.md:35`; root §7 Performance, `docs/00-architecture.md:330`) — plus the transfer of every mesh buffer, all of it discarded because only `contours` is wanted. The flat path pays for the preview twice. This is accepted for M4b: it keeps the edit additive (condition 1), it is user-initiated and off the preview queue, and it is one job, not a per-keystroke loop. **§8 Q5 must time it and record the number.** If Q5 shows it unacceptable, the fix is a `job.emitContours` branch around the mesh emission at `:357-366` — which is **not additive** under amendment condition 1 and therefore requires B1 to be extended to assert preview output is byte-identical when `emitContours` is absent. Do not take that branch without amending the doc. |
| **06b-8** | `src/workers/geometryWorker.ts:44-48` | Extend the catch ternary. It currently reads `req.kind === 'pattern' ? PatternResult : InlayResult`; unextended, a failed flat job posts back an `InlayResult` shape. This is the highest-value line in the five-site edit. |
| **06b-9** | `src/utils/geometry/patternClient.ts:17`, `:31-32`, `:63` | `type Kind = 'pattern' \| 'inlay' \| 'flat'`; a third `slots` entry; pump priority `this.slots.flat ?? this.slots.pattern ?? this.slots.inlay`. |
| **06b-10** | `src/utils/geometry/patternClient.ts`, after `:101` | `submitFlat(job, cb)`, mirroring `submitPattern` (`:97-101`) including its transferables branch. The callback must verify `result.jobId` itself: `onMessage` never compares `msg.kind` to `done.kind` (`:52-58`), and a third kind widens that mis-delivery window. |

## 6. Edge cases, testing, acceptance criteria

### 6.1 What cutters actually need, and what `generateSVGPath` gives them

`generateSVGPath` — `src/utils/dxfUtils.ts:469-493`. **Build beside it; do not modify it.** It has three production consumers (`src/components/ShapeUploader.tsx:51`, `src/components/DXFThumbnail.tsx:32`, `src/components/SVGPaintModal.tsx:850`) and a pinned test (`src/utils/dxfUtils.test.ts:223-256`).

| Cutter requirement | Satisfied by `generateSVGPath`? | Evidence |
|---|---|---|
| **Closed paths** | **Yes** — the one requirement it meets | `Z` after the outer ring (`:477`; the outer `M` is at `:475`) and after every hole (`:487`) |
| **Millimetres, declared in the file** | **No** | Returns a bare `d` string: no `<svg>`, no `width`/`height`, no `viewBox`, no unit (`:469`, `:493`) |
| **Correct Y axis for the target format** | **No** | Raw three.js coordinates; every consumer compensates itself (`src/components/DXFThumbnail.tsx:48-55`) |
| **Holes as separate closed loops** | **Partly** | Holes are reversed subpaths inside **one** `d` (`:481-489`), meaningful only under SVG `evenodd`. Correct for a filled preview; DXF has no fill rule |
| **One path per region** | **No** | Every shape is concatenated into a single `d` (`:471`, `:492`) |
| **No self-intersection** | **No** | Passes through whatever `parseDxfToShapes` produced; nothing unions or validates |
| **Layer / colour convention** | **No** | No layer concept exists |

**One of seven.** That is the gap this doc fills.

Self-intersection, specifically: 06a does **not** union the outline. It cannot — the only 2D engine is Clipper2 inside the manifold wasm, worker-only (root rule 2), and 06a is explicitly a no-worker workstream. What 06a does instead is **detect and report**, through one named helper: `hasSelfIntersection(ring: number[]): boolean` **(new — does not exist yet)** in `src/utils/export/cutPaths.ts` (§4.2 helper table). It is a **pure exported predicate**, so `outlineToCutPaths` keeps its two-argument signature and stays free of UI concerns: the button handler runs `hasSelfIntersection` over the rings of the returned `CutPathSet` and, if any returns true, raises one `useAlert` warning (`src/components/OutputPanel.tsx:4`, `:91`) **and writes the file anyway** — a bad outline is a visible warning, not a refusal, so the rider can decide. Pinned by criteria A12a (unit) and A12b (UI). There is no prior art to reuse: `grep -rniE "selfintersect|self-intersect|self_intersect" src/` returns zero hits. 06b, running inside the worker, gets non-self-intersecting contours for free — `toPolygons()` on a Clipper2 result is already resolved.

### 6.2 Layer and colour conventions

**External conventions, not code-verified.** These describe third-party software behaviour and are the one part of this doc with no `file:line`. §8 Q1/Q2 record how to settle them.

- **LightBurn** assigns a cut layer per distinct **stroke colour** on SVG import, and per **DXF LAYER name** on DXF import.
- **Silhouette Studio** cuts anything with a visible outline and has no layer concept in its free tier, so **line colour must not be load-bearing** — the file must be correct if every colour is ignored. Its free (Basic) edition opens DXF; SVG import is a paid upgrade, which is why DXF is the required output and SVG the convenience one.

The design consequence is a single rule: **give every role both a distinct layer name and a distinct colour, and make the geometry correct without either.** Nesting is carried by `SerializedShape.holes`, not by colour, so a reader that ignores all of it still gets the right part.

| Role | SVG `<g id>` + `stroke` | DXF `LAYER` | DXF colour (code 62, standard ACI) |
|---|---|---|---|
| Pad perimeter | `OUTLINE`, `#000000` | `OUTLINE` | `7` |
| Bolt holes / islands | `HOLES`, `#0000FF` | `HOLES` | `5` |
| Pattern footprint (06b) | `PATTERN`, `#FF0000` | `PATTERN` | `1` |

Holes get their own layer so an operator can order the cut inside-first — on vinyl, cutting the perimeter before the interior lets the piece shift.

### 6.3 Edge cases

| Case | Behaviour |
|---|---|
| `cutoutShapes` is `null` or `[]` | `outlineToCutPaths` returns `null`; the button alerts and downloads nothing. **Never** emit the synthesised square (`src/components/ImperativeModel.tsx:163-174`) and never gate on `size === 300` (`src/types/schemas.ts:11` is user-editable). |
| A ring has fewer than 3 vertices | Dropped **with a report**, not silently. The pipeline's precedent (`src/utils/geometry/manifoldOps.ts:86`, `:93`, `:132`) drops with no error and no `empty` signal a consumer reads — do not inherit that. |
| A DXF-sourced ring carries an explicit duplicate terminal vertex | Always the case: `build()` runs with `force = true` for open chains too (`src/utils/dxfUtils.ts:384`, `:387-388`). `dropTerminalDuplicate` handles it. |
| Mirror is on | Rings are reversed (`transformOutlinePoints`). Do not inherit the un-reversed-winding bug of the mesh path (`src/components/ImperativeModel.tsx:472-473`). |
| Rotation is non-zero and was leaked from a previous pad | Known upstream defect — neither `handleOutlineLoaded` nor `onClear` resets rotation/mirror, and the controls hide once `cutoutShapes` is empty (`src/components/controls/BaseControls.tsx:118`). 06a exports what the preview shows; the fix is doc 01 / M1. Do not paper over it here. |
| A hole ring is not actually inside its outer ring | Possible: `parseDxfToShapes` promotes a ring whose parent is itself a hole to top level (`src/utils/dxfUtils.ts:423-426`). Export it as a top-level region on `OUTLINE`, not as a hole. |
| Self-intersecting outline | `hasSelfIntersection` returns true for at least one ring → the button raises one `useAlert` warning, and the `CutPathSet` is still returned and written (see §6.1). Pinned by A12a/A12b. |
| 06b: worker returns `empty: true` | `PatternResult.empty` is set at four sites and **read by nobody** (`src/utils/geometry/applyPatternResult.ts` never inspects it). The flat path must read it and alert — do not let an export silently produce a blank file. |
| 06b: a non-cloneable value in the flat job | Wedges **all** geometry generation for the session, silently, spinner stuck on (`src/utils/geometry/patternClient.ts:65-67`). Guarded by criterion B4. |
| 06b: user edits while an export is in flight | The flat slot is separate, so the export is not coalesced away and the preview job is not dropped. The exported file reflects the job as submitted. |

### 6.4 Acceptance criteria

Baseline to regress against: **20 files / 155 tests** after P0 deletes `offsetUtils.test.ts` (−1 file, −7 tests from `docs/_source/baseline-verification.md`). New suites live under `src/utils/export/` and `src/utils/geometry/`, both inside the coverage allowlist (`vite.config.ts:30-35`) — no config edit **for those**. The task-8 UI wiring in `src/components/OutputPanel.tsx` is *outside* that allowlist and reports 0 % silently; see §4.1, where that is stated and accepted. Criterion A7b covers it behaviourally.

**Do not add a typecheck gate.** `npx tsc -p tsconfig.app.json --noEmit` reports **18 pre-existing errors** (root §4.1; `docs/_source/baseline-verification.md`'s "19" is stale), one of them on the export download path at `src/components/OutputPanel.tsx:125` (`DataView<ArrayBufferLike>` not assignable to `BlobPart`). A green typecheck is not available and must not become an implicit criterion.

#### 06a — M4a

| # | Criterion |
|---|---|
| **A0** | `pnpm test` passes with **0 failures** and a test count **> 155** (after deleting the 7 tests in `offsetUtils.test.ts`). |
| **A1** | `git diff --stat` shows `src/components/Controls.tsx` **untouched**. |
| **A2** | `git diff src/utils/dxfUtils.ts` is **empty**, and `src/utils/dxfUtils.test.ts` still passes — `generateSVGPath` is byte-identical and its three consumers are unaffected. |
| **A3** | `writeCutSvg` output, parsed with `DOMParser` under jsdom: the root `<svg>` has `width` and `height` ending in `mm`; `viewBox` width equals the numeric mm width to `1e-6`; `querySelectorAll('path').length` equals outer rings + hole rings; every `d` ends in `Z`; every `<g>` has `fill="none"` and a `stroke` from the §6.2 palette; **`querySelectorAll('[transform]').length === 0`**. |
| **A4** | Axis asymmetry pinned — **by parsing, not by substring**. Source shape with a vertex at `(0, 10)`. **SVG:** `DOMParser` the output, read the `OUTLINE` group's `d`, and assert that vertex is exactly `0 -10`. **DXF:** assert the `VERTEX` whose group-code `10` value is `0` carries group-code `20` value `10` — or `parseDxfToShapes(writeCutDxf(set))` and assert a point at `(0, 10)` to `1e-6` *after* accounting for the parser's bbox re-centring (see A5). A substring test is not acceptable here: `-10` also matches `-100`, `-10.5` and `-105`, and bare `10` is the DXF group code for an X ordinate, so it appears on every `VERTEX` record in any file (`node_modules/dxf-parser/dist/entities/polyline.js`). |
| **A5** | Round trip by **shape, not coordinates**: `parseDxfToShapes(writeCutDxf(set))` (`src/utils/dxfUtils.ts:46`) returns the same number of top-level shapes; for each, `Math.abs(THREE.ShapeUtils.area(s.getPoints()))` is within **0.5 %** of the source ring area, the bounding-box **extent (width and height, not position)** within **0.01 mm** per axis, and `s.holes.length` matches. *(Loose, and position-blind, because the parser: applies a 0.1 mm dedup, a 1.0 mm stitch and an `EPSILON = 0.15` area filter — `src/utils/dxfUtils.ts:213-248`, `:361-371`, `:411`; **drops any ring with `\|area\| <= 1.0` mm²** at `:385`, a harder filter than `EPSILON` that can eat small bolt-hole rings; and **re-centres the whole drawing** on a bbox midpoint computed over segment endpoints, `:203-211`, subtracted from every emitted point at `:379-382`. Round-tripping a rotated outline therefore shifts the drawing, because rotating an origin-centred shape about (0,0) does not leave its bbox centred at (0,0) — assert extent, never position.)* |
| **A6** | Terminal duplicate dropped. `writeCutDxf` for a square built from **5** points (explicit closing point) emits exactly **4** `VERTEX` records and one `70`/`1` closed flag on the `POLYLINE`. |
| **A7a** | Refusal, at the unit level (**task 4**). `outlineToCutPaths(null, t) === null` and `outlineToCutPaths([], t) === null`. |
| **A7b** | Refusal, at the UI level (**task 8** — the buttons do not exist before it). In a component test, clicking either button with `cutoutShapes` null calls `showAlert` exactly once and `URL.createObjectURL` **zero** times. Repeat with `size = 250` to prove the criterion does not depend on 300. Stub `URL.createObjectURL`/`revokeObjectURL` and the anchor as `src/utils/projectUtils.test.ts:17-23` already does. |
| **A8** | Single transform helper — **only the two point transforms are collapsed**. `grep -c "baseOutlineRotation \* (Math.PI / 180)" src/components/ImperativeModel.tsx` returns **exactly 2**, and both surviving hits are `mesh.rotation.z = baseOutlineRotation * (Math.PI / 180);` — sites 3 (`:474`) and 4 (`:499`) in §4.3's disposition table, both explicitly out of scope. It returns 4 today. **A count of 0 is not achievable without doing work this doc forbids.** Pin the point-transform form as well: `grep -c "pts.map(p => new THREE.Vector2(" src/components/ImperativeModel.tsx` returns **0**, and the same grep over `src/utils/geometry/outlineTransform.ts` returns **≥ 1**. *(The green-overlay copy at `src/components/ModelViewer.tsx:526` is in a different file and out of scope; it is not counted by either grep.)* |
| **A9** | Mirror does not invert (**task 4** — a pure `outlineToCutPaths` unit assertion, no UI). `sign(area(outer(outlineToCutPaths(s, {mirror:true, rotationDeg:0}))))` equals the same for `{mirror:false}` — i.e. rings are reversed on mirror, and 06a does not reproduce the mesh-path facet bug. |
| **A10** | Tolerance is real, **and survives a live transform**. (i) A `THREE.Shape` built with `absarc(0,0,50,0,2π,false)` put through `outlineToCutPaths([shape], {mirror:false, rotationDeg:0})` exports with **more than 24** vertices, every chord midpoint within `FLAT_TOLERANCE_MM` of R = 50. (ii) The same shape through `outlineToCutPaths([shape], { mirror: true, rotationDeg: 37 })` **still** exports > 24 vertices with every chord midpoint within `FLAT_TOLERANCE_MM` of R = 50. Part (ii) is the one that matters: it fails if the implementation transforms shape-first (rebuilding `THREE.Shape` from sampled points collapses every curve to a `LineCurve`, whose `getPoints(n)` resolution is 1 regardless of `n` — `node_modules/three/src/extras/core/CurvePath.js:207-210`) and the export silently drops back to 12 divisions. *(Direct contrast with `getPoints()`'s 24-gon, 0.428 mm sag.)* |
| **A11** | Winding convention. Every exported outer ring has positive signed area; every hole ring negative. |
| **A12a** | Self-intersection is detected, not repaired and not refused (**task 4**). `hasSelfIntersection([0,0, 10,10, 10,0, 0,10])` (a figure-eight) is `true`; `hasSelfIntersection` of a convex ring is `false`. A `THREE.Shape` built from that figure-eight through `outlineToCutPaths` returns a **non-null** `CutPathSet` whose region count is unchanged — the check reports, it does not drop or repair. |
| **A12b** | Self-intersection is surfaced (**task 8**). In the component test, clicking either button with a self-intersecting outline calls `showAlert` **exactly once** and `URL.createObjectURL` **exactly once** — warned *and* written. With a convex outline, `showAlert` is called **zero** times and `URL.createObjectURL` once. |

#### 06b — M4b

**Client-test scaffolding is net-new.** There is **no `src/utils/geometry/patternClient.test.ts`** in the repo (`ls src/utils/geometry/*.test.ts`), and `ensureWorker` constructs a real `new Worker(new URL('../../workers/geometryWorker.ts', import.meta.url), { type: 'module' })` (`src/utils/geometry/patternClient.ts:37`), which jsdom does not provide. B3 and B8 therefore require a new suite that stubs `Worker` — `vi.stubGlobal('Worker', …)` with a class exposing `postMessage`/`onmessage`/`onerror`/`terminate`, capturing posted messages and driving `onmessage` by hand. Budget for it; it is not free and nothing existing can be copied.

| # | Criterion |
|---|---|
| **B0** | The root §10 amendment is satisfied, defined as the explicit conjunction **B1 ∧ B2 ∧ B3 ∧ B4b ∧ B5 ∧ B6**. Nothing is run for B0 itself; it is the label for that conjunction, one criterion per amendment condition. |
| **B1** | *(Condition 1, additive.)* `src/utils/geometry/patternPipeline.test.ts` passes **unchanged**. A new test asserts `generatePattern(job).parts[0].geometry.position` is `toEqual` to `generatePattern({...job, emitContours: true}).parts[0].geometry.position` — preview output is byte-identical either way. |
| **B2** | *(Condition 2, read-only.)* `git diff -U0 src/utils/geometry/patternPipeline.ts` adds **no line** in the range `:258-:298` (the boolean sequence) or `:311-:354` (the mask split). The only new call on `result` is `result.project()`. |
| **B3** | *(Condition 3, opt-in and off the queue.)* **First half:** `generatePattern(job)` with `emitContours` absent returns `result.contours === undefined`. **Second half, written so it can actually pass:** submit **two** pattern jobs, then `submitFlat`. The first pattern job goes in flight and the second sits pending, so a genuine pending slot exists; assert the pending pattern slot is the *same object* after `submitFlat` and that `inFlight.kind === 'pattern'` and `slots.flat` is set. **Do not** write "enqueue one pattern job, call `submitFlat`, assert `slots.pattern` is still set" — `enqueue` sets `this.slots[kind] = slot` and immediately calls `this.pump()` (`src/utils/geometry/patternClient.ts:75-77`), and with nothing in flight `pump()` does `this.slots[next.kind] = null; this.inFlight = next` (`:65-66`), so `slots.pattern` is already `null` before `submitFlat` is reached. That test goes red and the tempting "fix" is to change the pump — the opposite of what this criterion is protecting. `slots` and `inFlight` are private; read them through a cast, do not widen their visibility. |
| **B4** | *(Rule 5, the wedge hazard.)* `structuredClone(flatJob)` succeeds in a test. |
| **B4b** | *(Condition 4, before the mask subtract — the hazard the amendment exists for.)* Total contour area for a job with non-empty `maskShapes` equals total contour area for the same job with `maskShapes: []`, within `1e-6` relative. |
| **B5** | *(Condition 4, both sites.)* Two tests return `contours.length > 0`: one with `clipToOutline: true` (CSG path, `:269`), one with `clipToOutline: false` and no exclusions, masks, holes or height cut (instanced fast path, `:221-228`). |
| **B6** | *(Condition 5, hygiene.)* The use-after-free regression at `src/utils/geometry/patternPipeline.test.ts:162-182` still passes; `cachedCutterSolid` (`src/utils/geometry/manifoldOps.ts:128`) is unmodified. |
| **B7** | No main-thread Manifold: `grep -rn "getManifold" src/components src/App.tsx` returns nothing. |
| **B8** | Five-site edit complete: `grep -n "'flat'" src/workers/geometryWorker.ts src/utils/geometry/patternClient.ts` hits the union (`:21-24`), the dispatch (`:36-42`), the **catch ternary** (`:44-48`), `Kind` (`:17`), `slots` (`:31-32`), the pump priority (`:63`), and `submitFlat`. |
| **B9** | `project()` semantics pinned **on the instanced fast path** — so pin the fields that decide the branch. A `kind:'shapes'` unit that is a 10 mm square, `isTiled: false`, `patternScale: 1`, **and** `clipToOutline: false`, `filledCutoutShapes: []`, `holeShapes: []`, `exclusionShapes: []`, `maskShapes: []`, `patternMaxHeight: undefined` yields a single contour whose area is within **1 %** of 100 mm². All six extra fields are load-bearing: `useCSG` is `hasClipping \|\| hasExclusions \|\| hasMasks \|\| hasHoles \|\| hasHeightCut` (`src/utils/geometry/patternPipeline.ts:216-221`), `clipToOutline` defaults to **`true`** (`src/types/schemas.ts:78`) and `hasClipping = clipToOutline && job.filledCutoutShapes.length > 0` (`:218`) — leave either at its default with a non-empty outline and the job silently takes the CSG path, where `patternMargin` (default **3**, `src/types/schemas.ts:75`) erodes the cutter at `patternPipeline.ts:260` and the 1 % assertion fails for a reason that has nothing to do with `project()`. |
| **B9b** | *(Only if CSG-path `project()` semantics need pinning too.)* The same 10 mm square with `clipToOutline: true` and a `filledCutoutShapes` outline strictly larger than the tile, `patternMargin: 0`, yields a single contour within **1 %** of 100 mm². Stated separately because it exercises a different branch and a different set of defaults. |
| **B10** | Empty is reported, not silent: a job producing `empty: true` causes the flat path to call `showAlert` and write **no** file. |
| **B11** | *(Kerf, task 17 — **both** paths.)* A `kerfMm` of 0.2 shrinks total contour area on a `clipToOutline: true` job **and** on a `clipToOutline: false` job (fast path, fields pinned as in B9). A `kerfMm` of 0 produces contours byte-identical to the same job with `kerfMm` absent, **on both paths**. Testing only one path leaves the other user — the one who turned "Clip to Edge" off — with a cut file carrying no blade compensation and no error (§4.6). |

## 7. Task order

Dependency-ordered; each task is one commit. Recon is done — these start from the report's §5 "06 — flat export" table.

**06a — M4a. No core change, no worker, shippable in parallel with M2/M3.**

| # | Task | Done when |
|---|---|---|
| 1 | `src/utils/geometry/outlineTransform.ts` + tests. `OutlineTransform`, `transformOutlinePoints`, `transformOutlineShapes`. Semantics copied from `ImperativeModel.tsx:183-202` (outers) and `:211-228` (holes) — **the whole block each time, mirror step included**. **No call-site change.** | Unit tests cover mirror, rotation, mirror+rotation, and ring reversal on mirror. |
| 2 | Repoint `ImperativeModel.tsx:183-202` (outers) and `:211-228` (holes) at `transformOutlinePoints`. Pure substitution — **replace each range whole**. Any narrower range (`:189-201`, `:212-228`, `:216-228`, `:183-201`) opens or closes mid-`if` and leaves the original mirror in place to be applied twice: see §4.1's Warning. Nothing in the suite covers `baseOutlineMirror` through this `useMemo` (`grep -rln baseOutlineMirror src/ \| grep test` → only `src/utils/schemaDefaults.test.ts`), so `pnpm test` stays green while the preview is wrong. | A8; `pnpm test` unchanged; the mirror-through-`useMemo` gap is closed by task 1's ring-reversal test. |
| 3 | `src/utils/export/cutPaths.ts` + tests. `CutLayerName`, `CutRegion`, `CutPathSet`, `dropTerminalDuplicate`, `enforceWinding`, `isDegenerate`, `hasSelfIntersection`, `boundsOf`. | A11, A12a's predicate half, and the ring-hygiene half of A6. |
| 4 | `src/utils/export/outlineContours.ts` + tests. `FLAT_TOLERANCE_MM`, `divisionsForTolerance`, `outlineToCutPaths` including the empty refusal. **Sample at tolerance first, then `transformOutlinePoints`** (§4.3) — never `transformOutlineShapes`. | A7a, A9, A10, A12a. *(A7b and A12b need the buttons; they belong to task 8.)* |
| 5 | `src/utils/export/svgWriter.ts` + tests. | A3, and the SVG half of A4. |
| 6 | `src/utils/export/dxfWriter.ts` + tests, including the `parseDxfToShapes` round trip. | A5, A6, and the DXF half of A4. |
| 7 | `src/utils/export/download.ts`. `downloadText(filename, mime, text)` — the Blob → anchor → `revokeObjectURL` idiom, lifted in shape from `src/components/OutputPanel.tsx:125-136` but **not** by editing it. jsdom implements neither `URL.createObjectURL` nor a real anchor download; **copy the stub harness at `src/utils/projectUtils.test.ts:17-23`** (see §4.7). | A test asserts `document.createElement('a')` was called, `link.download` is the passed filename, `link.href` is the stubbed blob URL, `link.click()` fired, and `URL.revokeObjectURL` was called with that URL — mirroring `src/utils/projectUtils.test.ts:49-56`. |
| 8 | Wire the UI: `OutputPanel.tsx:9-13` props, two buttons after `:248`, `App.tsx:108-113` attributes, and the `hasSelfIntersection` warning in the handler. | A0, A1, A2, A7b, A12b. **M4a complete.** |
| 9 | *(Optional, deferred, shared-file, behaviour-changing.)* Import-side flattening tolerance: `centerShapes` re-sampling (`src/utils/patternUtils.ts:961-985`), the negative-area arc discard (`src/utils/dxfUtils.ts:395`), and the `getPoints()` default at `src/utils/geometry/serialize.ts:36`. **Coordinate with docs 01 and 07 before starting** — it changes what every consumer sees, not just the exporter. | An SVG-sourced outline exports at `FLAT_TOLERANCE_MM`, and `pnpm test` is still green. |

**06b — M4b. Requires the root §10 amendment (adopted) and M3 (a 2D pattern unit).**

| # | Task | Done when |
|---|---|---|
| 10 | Pre-flight pin. A test that captures `parts[].geometry.position` for two fixed jobs, so condition 1 is checkable **before** any pipeline edit. | The test passes against unmodified `patternPipeline.ts`. |
| 11 | `PatternJob.emitContours?` (`:51-82`) and `PatternResult.contours?` (`:84-89`). No behaviour yet. | B1, B3 (first half). `patternResultTransferables` unchanged. |
| 12 | CSG-path capture in the `:298`–`:311` window; serialise into the `PatternResult` returned at `:368` (beside the final mesh built at `:357-366`). | B2, B4b, and the CSG half of B5. |
| 13 | Fast-path capture at `:224-228` — `unit.project()` once, per-position 2D transform, `CrossSection.union`, `toPolygons()`. | The instanced half of B5, and **B9** — whose job fixture must pin `clipToOutline: false` and the four empty shape arrays, or the test silently runs on the CSG path instead. B9b optional. |
| 14 | Worker `kind:'flat'`: union `:21-24`, dispatch `:36-42`, **catch ternary `:44-48`**. Comment why it sits below `await getManifold()`, and comment the accepted duplicated-mesh cost (§5, 06b-7). | B8. |
| 15 | Client: third slot, pump priority, `submitFlat` with a `jobId` guard in the callback. **New suite** — there is no `patternClient.test.ts` and `Worker` must be stubbed (§6.4, 06b preamble). | B3 (second half), B4. |
| 16 | `src/utils/export/patternContours.ts` — `patternContoursToCutPaths(contours)` onto the `PATTERN` layer, and a merge with 06a's outline set into one `CutPathSet`. | `writeCutSvg(merged)` parsed with `DOMParser` gives `querySelectorAll('g#PATTERN path').length > 0` **and** `querySelectorAll('g#OUTLINE path').length > 0`; `writeCutDxf(merged)` contains `LAYER` table records named `OUTLINE`, `HOLES` and `PATTERN`; `parseDxfToShapes(writeCutDxf(merged))` returns **≥ (outline regions + pattern regions)** top-level shapes. |
| 17 | Kerf: a `kerfMm` field on the flat job, applied as `CrossSection.offset(-kerfMm / 2, …)` (`src/utils/geometry/manifoldOps.ts:151` is the existing worked example) **before** `toPolygons()`, on **both** contour paths — the CSG capture (06b-5) and the instanced fast path (06b-4). Default 0. | B11. |
| 18 | UI: one "Export cut paths" button that submits the flat job, reuses the existing spinner, reads `empty`, and writes both files. | B7, B10. **M4b complete.** |

## 8. Open questions

| # | Question | What would settle it |
|---|---|---|
| **Q1** | **R12 entity choice *and* the post-R12 header variables — one experiment, because they turn on the same rule** ("emit what the target readers accept, and declare the lowest version that carries it", §4.5). Root §8 M4a's exit says "closed LWPOLYLINE", but `LWPOLYLINE` is an AC1014 (R14) entity and this writer declares `$ACADVER = AC1009`; meanwhile the header block writes `$INSUNITS` and `$MEASUREMENT`, also post-R12, because our own parser reads exactly them (`src/utils/dxfUtils.ts:60-71`, `:76-81`) and A5's round trip depends on it. Which combination imports most cleanly is not knowable from this repo. | Write four variants of the same pad — {`POLYLINE`, `LWPOLYLINE`} × {with, without `$INSUNITS`/`$MEASUREMENT`} — and import each into LightBurn and into Silhouette Studio. Record which parses, whether units survive, and whether closure is honoured. **Then amend whichever doc loses.** `docs/00-architecture.md:433` was amended on 2026-09-04 and now reads "before writing a **closed polyline** — entity choice (`POLYLINE` vs `LWPOLYLINE`) is doc 06 §4.5 / Q1's call", so the doc set no longer contradicts itself and an implementer reading the root milestone is sent here. If the experiment overturns §4.5 and `LWPOLYLINE` wins, amend §4.5 — the root line already defers to it either way. **Verified in advance that §4.5's design does round-trip:** `parseDxfToShapes` accepts `POLYLINE` at `src/utils/dxfUtils.ts:119` and reads closure from `poly.shape \|\| poly.closed` at `:126`, and `dxf-parser`'s polyline handler parses `VERTEX`/`SEQEND` and sets `shape` from bit 1 of group code 70 (`node_modules/dxf-parser/dist/entities/polyline.js`). |
| **Q2** | **Does Silhouette Studio's free tier still open DXF?** The whole reason DXF is the *required* output rather than a convenience rests on this. | Import a written `.dxf` into a current Silhouette Studio Basic install. If it does not, DXF and SVG swap priority and the palette in §6.2 needs revisiting. |
| **Q3** | **One file or two?** A pad has an outline and (with 06b) a pattern footprint. One file on two layers preserves registration between them; two files suit two machines or two materials. | @liamstar's own cut workflow. Not answerable from the code — it is a product decision, like root §11 Q1. |
| **Q4** | **Is a single `kerfMm` enough?** A drag-knife's kerf and a laser's kerf differ in magnitude and arguably in sign handling, and a pad may want a different allowance on the perimeter than on interior holes. If it needs to be per-layer *and* persisted, §3's "nothing enters `ProjectSchemaV1`" has to be revisited. | One test cut per machine, measured with calipers against the nominal contour. |
| **Q5** | **What does a flat job actually cost?** Two terms, and `project()` is the smaller one. **(a)** `Manifold.project()` has **zero call sites in `src/`** today, so its cost on a several-thousand-tile composed solid is unmeasured; if it is slow, the fast-path construction in §4.6 (project the unit once, union in 2D) becomes the design for *both* paths. **(b)** The larger term: routing `'flat'` to `generatePattern` (§5, 06b-7) re-runs `serializeMesh` over the whole composed solid (`src/utils/geometry/patternPipeline.ts:361`) and therefore `computeSharpNormals` (`src/utils/geometry/manifoldOps.ts:217`) — the pipeline's dominant CPU cost (`docs/_source/00-recon-report.md:35`; `docs/00-architecture.md:330`) — and transfers every mesh buffer, all discarded. The flat path pays for the preview twice. That is accepted for M4b, but **the number must be recorded here, not assumed.** | Time both terms on a 2000-tile composed solid inside the existing Vitest harness — Manifold wasm already runs under jsdom (`docs/_source/baseline-verification.md`), so no browser harness is needed. Report `project()` ms, `serializeMesh`+`computeSharpNormals` ms, and total flat-job ms. Budget against the pipeline's stated "well under 200 ms for a dense grip" (`src/components/DebouncedInput.tsx:12-14`) — with the allowance that a flat job is user-initiated and off the preview queue, so a second or two is tolerable where 200 ms is not. If the total is unacceptable, the remedy is a `job.emitContours` branch around the mesh emission at `:357-366`, which is **not additive** under amendment condition 1: it requires extending B1 to assert preview output is byte-identical when `emitContours` is absent, and amending §4.6 condition 1 to say so. |
