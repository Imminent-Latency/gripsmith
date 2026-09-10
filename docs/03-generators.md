# Concrete generators — Voronoi, noise-contour, truchet, L-system

**Doc ID:** `03-generators`
**Status:** Draft — ready to implement
**Owner:** @liamstar
**Parent:** [`./00-architecture.md`](./00-architecture.md) — its §5 contracts and §10 derivation rules bind this doc. Where this doc conflicts with it, the parent wins until amended.

**Milestones served**

| Milestone | This doc's part |
|---|---|
| **M3** — first generator through the real seam | **Voronoi only.** It is the proof-of-seam generator: it is the first thing that ever writes `THREE.Shape[]` into `patternShapes` and drives `buildJob`'s `kind:'shapes'` branch (`src/components/ImperativeModel.tsx:832-836`) in production. |
| **M5** — breadth ("rest of 03") | noise-contour, truchet, L-system. |

**Blocked by**

| On | Why |
|---|---|
| **M2 / doc 08 (seeding)** | Every generator here is stochastic. There is no PRNG in the repo — `Math.random()` appears at exactly three sites, all in `generateTilePositions` (`src/utils/patternUtils.ts:464`, `:504`, `:505`). A generator written against `Math.random()` cannot be retrofitted without changing its output, so 08 lands first. **Doc 08 must export a seeded factory.** Every determinism test here (§6.2 T1) assumes the shape `makeRng(seed: number): () => number` **(new — does not exist yet)**; doc 08 owns the final name, and if it differs, T1 and the `rng` injection in §4.2 change with it. |
| **Doc 02 (generator engine)** | 02 owns the registry, the param channel into `GeometrySettingsSchema`, the non-file write into `patternShapes`, and bypassing the auto-scale overwrite at `src/components/controls/GeometryControls.tsx:135`. This doc owns only the four synthesis functions, their params, and the clamps. |

**Blocks**

| What | Why |
|---|---|
| Doc 06b (pattern-footprint flat export) | A generated field is the only interesting subject for a footprint export; today the pattern is an STL mesh with no polygon form at all. Not a hard block — 06b can ship against an STL — but the acceptance case is here. |
| Doc 04's generator param UI | 04 renders from descriptors; the descriptors are defined here (§4.6). |

---

## 1. Summary

Four synthesis families, all **confirmed absent**: a repo-wide grep for `voronoi|delaunay|simplex|perlin|truchet|lsystem|marching|poisson` over `src/` returns **0 hits**, and none of `d3-delaunay`, `simplex-noise`, `d3-contour` or `delaunator` is in `package.json:17-66` or `node_modules/`. Nothing here is a rebuild.

Each generator is a **pure function on the main thread** that returns `THREE.Shape[]` in millimetres. It does no clipping, no offsetting and no extrusion — the existing pipeline does all three, in the worker, in the order extrude → compose → clip (`src/utils/geometry/patternPipeline.ts:139`, `:236`, `:269`). The generator's entire job is to hand `csFromShapes` (`src/utils/geometry/manifoldOps.ts:91-98`) a well-formed, budgeted list of rings.

Three facts drive every design decision below:

1. **The generated field is never decimated.** `CUTTER_TOLERANCE = 0.001` mm simplification is applied to cutter contours only (`src/utils/geometry/manifoldOps.ts:47`, applied at `:111` and `:150`); the docblock at `:44-45` states it is *"Deliberately NOT applied to the pattern unit or inlay shapes"*, and `patternPipeline.ts:138` calls `csFromShapes`, not `simplifiedCs`. **Whatever vertex count a generator emits is paid in full, all the way to `computeSharpNormals`.** The budget must therefore be met in JS, before emission (§4.4).
2. **Rings are implicitly closed and need ≥3 vertices.** `points.length < 6` is silently dropped with no error and no `empty` signal any consumer reads (`src/utils/geometry/manifoldOps.ts:86`, also `:93`, `:132`).
3. **Overlapping cells must be separate `THREE.Shape`s.** `csFromShapes` builds one `CrossSection` per shape and unions them (`:91-98`), but a single shape whose own rings overlap XOR-cancels under `'EvenOdd'` (`:85-88`).

## 2. Goals

- Four generator modules under `src/utils/generators/`, each pure, seeded, and unit-testable without a browser.
- A **vertex budget** and **min-feature clamps** enforced by construction, so output is printable on a 0.4 mm nozzle and cuttable on a drag knife.
- **A tile cap in the shared tiler**, so no parameter combination can hang the worker. Required of this doc by name in `00-architecture.md` §6 (`03-generators` row) and by the recon's 03 gap table (`core: yes`, effort S). Task 9.
- **Per-generator dynamic import**, so none of the three vendor packages enters the 531.65 kB-gzipped main chunk (`docs/_source/baseline-verification.md`).
- Voronoi documented and tested end to end, from parameter to `Pattern` mesh part, as M3's proof of seam.

## 3. Non-Goals

- **No new worker kind.** Generators are plain JS with no wasm. Rule 5 costs five edits for a new kind (`src/workers/geometryWorker.ts:21-24`; `src/utils/geometry/patternClient.ts:17`, `:31-32`, `:63`, `:97-105`). Not paid until §8 Q3's measurement says otherwise.
- **No clipping, offsetting or extrusion re-implementation** (rule 2), except `insetConvex` (§4.3) under the root §5.2 D2 amendment — adopted 2026-09-04 with all four §8 Q6 conditions.
- **No registry, no param plumbing, no UI.** Doc 02 and doc 04.
- **No PRNG.** Doc 08. Generators take an injected `rng: () => number`.
- **No opt-in decimation at `patternPipeline.ts:138`.** The recon's 03 gap table lists it (`core: yes`, effort S). Deferred: the JS-side budget makes it unnecessary, and it is a core edit under §10. Doc 02 §5.2 reaches the same conclusion independently and ships the JS-side alternative, `decimateShapes` in `src/utils/generators/normalize.ts`; root §7 *Performance* is amended to record the deferral. Reopen only if §8 Q3's measurement says the JS budget is insufficient.
- **No per-cell height variation.** `PatternJob` carries exactly one `patternUnit` (`src/utils/geometry/patternPipeline.ts:73`) with a scalar Z (`:199-201`, `:206`). Listed in the recon as a separate M–L gap; not here.

---

## 4. Contract mapping and design

*(§10 items 3 and 4. §4.0–§4.2 discharge item 3 — contract mapping; §4.3–§4.7 discharge item 4 — design, modules, file paths; §5.1 names the shared files touched.)*

### 4.0 What already exists

Read this before writing anything. Everything in the codebase that touches this feature, so nobody rebuilds it.

| Piece | Where | Use it for |
|---|---|---|
| **Procedural placement engine** — 8 distributions × 4 orientations, boundary/exclusion/mask/avoid aware, Y-bucketed spatial index | `src/utils/patternUtils.ts:285-299` (index at `:102-161`) | Everything except synthesis. Do not write a placer. |
| **Rotation quantisation** — snaps every placed rotation to a multiple of N degrees | `src/utils/geometry/patternPipeline.ts:193-196` | This *is* the truchet orientation mechanism (§4.6.3). |
| **Whole-field (non-tiled) path** — collapses placement to one identity instance | `src/utils/geometry/patternPipeline.ts:191` | Every field generator runs through this. |
| **2D union of many separate shapes** — one `CrossSection` per shape, then `CrossSection.union` | `src/utils/geometry/manifoldOps.ts:91-98` | Why overlapping cells must be separate shapes. |
| **Polygon offset** (worker-only) | `src/utils/geometry/manifoldOps.ts:151` | Unreachable from the main thread; why `insetConvex` exists (§4.3). |
| **Signed polygon area** — `THREE.ShapeUtils.area(points)`, ships with the `three` dependency | used in production at `src/utils/patternUtils.ts:964`, `src/utils/dxfUtils.ts:385`, `:394`; in tests at `src/utils/dxfUtils.test.ts:66`, `:85`, `:127`, `:151`. *(`src/utils/offsetUtils.ts:94`, `:201` also call it, but that module is the dead clipper-lib wrapper — zero production importers, deleted in M0 (root §4.1). Do not cite it as evidence.)* | Lloyd centroids and the `insetConvex` collapse test (§4.3). **Do not reimplement.** |
| **Point-in-polygon** — exported, spatially indexed, and pinned by an oracle-equivalence test | `buildPolyIndex` `src/utils/patternUtils.ts:114`, `pointInIndex` `:181`; oracle `isPointInShape` `:70`; test `src/utils/patternUtils.test.ts:62-80`. A second, module-private copy exists at `src/utils/dxfUtils.ts:399` | T8's nesting check (§6.2). Use the exported pair; do not add a third copy. |
| **Contour decimation** (worker-only, cutters only) | `simplifiedCs` `src/utils/geometry/manifoldOps.ts:108-112`; `CUTTER_TOLERANCE` `:47`; explicitly **not** applied to the pattern unit, `:44-45` | Why the vertex budget must be met in JS. |
| **Serialisation seam** — `THREE.Shape[]` → `SerializedShape[]`, holes carried | `src/utils/geometry/serialize.ts:34-50`; called at `src/components/ImperativeModel.tsx:836` | The only conversion a generator needs. Do not write another. |
| **The `kind:'shapes'` branch** — implemented, test-covered, zero production callers | `src/utils/geometry/patternPipeline.ts:47-48`, `:138-139`; branched at `src/components/ImperativeModel.tsx:829-836` | The seam. M3's first production use. |
| **Bounds helper** | `getShapesBounds` `src/utils/patternUtils.ts:12-30` | Deriving `ctx.region` from `cutoutShapes`. |
| **Outline-into-a-control-panel precedent** | `<InlayControls cutoutShapes={baseSettings.cutoutShapes}` `src/components/Controls.tsx:386` | Copy for `<GeometryControls>`, whose element spans `src/components/Controls.tsx:399-404`. |
| **Manifold-under-Vitest harness** | `src/utils/geometry/patternPipeline.test.ts:79-84` — `describe('generatePattern (Manifold)')` at `:79`, `beforeAll(async () => { wasm = await getManifold(); })` at `:83-84`. Flat-array `SerializedShape` fixtures `squareShape`/`xyBounds` at `:8-24`; the `baseJob` factory at `:26-55` | T11. Copy it; do not modify the file. |
| **Debounce + coalescing** — 150 ms per field, plus 1-in-flight/1-pending latest-wins | `src/components/DebouncedInput.tsx:9-18`; `src/utils/geometry/patternClient.ts:56`, `:63`, `:75` | Regeneration throttling is solved. |
| **Auto-scale on pattern load** — a hazard, not an asset | `calculateAutoPatternScale` `src/components/controls/GeometryControls.tsx:67-112`, written at `:135` | Must be bypassed (E7, AC-6). |
| **`centerShapes`** | `src/utils/patternUtils.ts:939-990` | **Do not use.** It re-samples through `getPoints()` at `:961`, force-reverses to CCW at `:964`, and negates Y at `:970` — the negation is conditional on its `flipY` argument, which defaults to `false` (`:939`). Generated fields are already origin-relative and the pipeline recentres at `patternPipeline.ts:143-149`. |
| **Coverage allowlist already covers us** | `vite.config.ts:30-35` includes `src/utils/**` | No config edit needed. |

**Confirmed absent — all of this is genuinely net-new:**

| Absent | Evidence |
|---|---|
| Any Voronoi / Delaunay / simplex / Perlin / truchet / L-system / marching-squares / Poisson code | `grep -rniE "voronoi\|delaunay\|simplex\|perlin\|truchet\|lsystem\|marching\|poisson" src` → **0 hits** |
| `d3-delaunay`, `simplex-noise`, `d3-contour`, `delaunator` | absent from `package.json:17-66` and from `node_modules/` |
| Any dynamic `import()` anywhere in `src/` | `grep -rn "import(" src --include='*.ts' --include='*.tsx'` → **0 hits** |
| Any `manualChunks` config | `vite.config.ts:6-23` |
| Any `.min()` / `.max()` in the settings schemas | `grep -c "\.min(\|\.max(" src/types/schemas.ts` → **0** |
| Any min-feature clamp on either output path | `00-architecture.md` §7 *Correctness*; the `min=` HTML attributes are inert (`src/components/DebouncedInput.tsx:44-47`) |
| Any seeded PRNG | three bare `Math.random()` at `src/utils/patternUtils.ts:464`, `:504`, `:505` |
| Any cap on the tiler lattice | `src/utils/patternUtils.ts:684-685` computes `cols`/`rows` with no upper bound; the only guard in the function is `if (!bounds) return []` at `:301`. Task 9 ships the cap. |

### 4.1 Contracts consumed and produced

| §5 contract | Direction | Real type / attachment point |
|---|---|---|
| **`Polygon`** | produces | `THREE.Shape[]` on the main thread — representation 1 (`src/types/schemas.ts:14`). Converted for us by `serializeShapes` (`src/utils/geometry/serialize.ts:47-50`) at `src/components/ImperativeModel.tsx:836`, arriving in the worker as `SerializedShape { points: number[]; holes: number[][] }` (`serialize.ts:15-18`). Generators **never** emit the `{ shape, color }` wrapper (representation 2) and **never** emit `THREE.BufferGeometry` (representation 3) — see §5.1 for what breaks if they do. |
| **`Outline`** | consumes (read-only) | `BaseSettings.cutoutShapes` (`src/types/schemas.ts:14`), used only to derive the generation region's bounding box via `getShapesBounds` (`src/utils/patternUtils.ts:12-30`). **Doc 02 passes `getShapesBounds(cutoutShapes)` raw and unpadded as `ctx.region`; padding is generator-side** (§4.2, §4.6.1 step 1). Generators never clip to it — the 3D intersect at `src/utils/geometry/patternPipeline.ts:269` does, gated on `clipToOutline` (default `true`, `src/types/schemas.ts:78`) and eroded by `patternMargin` (default 3 mm, `:75`; applied at `patternPipeline.ts:260`, `:263`). |
| **`ShapeSource`** | conforms to | The truthful signature is `produce(): Promise<Array<THREE.Shape \| { shape; color }>>`, with no seed and no outline (§5.1). Generators are the first producers that genuinely need both, so §4.2 defines a narrower synchronous form and 02's adapter widens it. |
| **`Generator<P>`** | consumes | **Must be created — doc 02 owns it.** This doc supplies the four `P` types and their zod schemas (§4.6) and assumes only that 02 can call a `GeneratorFn` and persist a params object. |
| **`DesignState`** | consumes indirectly | Params must round-trip through `ProjectSchemaV1` (`src/types/schemas.ts:87-96`). Rule 3: every new field carries `.default()`, because `getDefaults` is `schema.parse({})` (`src/utils/schemaDefaults.ts:6-8`). |

### 4.2 The generator contract (new — does not exist yet)

`src/utils/generators/types.ts` — **new**. Doc 02's `Generator<P>` is the registry-facing wrapper; this is the callee.

```ts
import * as THREE from 'three';

/** Everything a generator is allowed to know about the world. */
export interface GeneratorContext {           // (new — does not exist yet)
  /** Region to fill, in mm, in outline-space. This is the RAW outline bounding box —
   *  getShapesBounds(cutoutShapes), unpadded. The caller never pads. Each generator
   *  applies its own padding from its own params (Voronoi: regionPadding, §4.6.1
   *  step 1; L-system: fitMargin, §4.6.4 step 3). */
  region: THREE.Box2;
  /** Seeded PRNG from doc 08. Uniform [0,1). Generators MUST NOT call Math.random(). */
  rng: () => number;
}

export interface GeneratorOutput {            // (new — does not exist yet)
  /** mm, implicitly closed, >= 3 vertices per ring, no THREE curve segments. */
  shapes: THREE.Shape[];
  /** Sum of all ring vertices across shapes and their holes. */
  vertexCount: number;
  /** Cells / blobs / tiles / segments actually emitted, for the UI readout. */
  featureCount: number;
  /** Human-readable notes for clamps that fired, surfaced through AlertContext. */
  clamps: string[];
}

export type GeneratorFn<P> = (params: P, ctx: GeneratorContext) => GeneratorOutput;  // (new)
```

Synchronous by design: all four are pure computation, and an `async` signature would tempt a caller into an unawaited write into `patternShapes`. The `await import()` that loads the module is the only asynchrony, and it lives in the registry (§4.7), not in the generator.

### 4.3 Module and file layout

New folder — isolation **is** achievable for the synthesis code itself. `src/utils/**` is already inside the Vitest coverage allowlist (`vite.config.ts:30-35`), so **no `vite.config.ts` edit is needed** and new code is counted automatically.

```
src/utils/generators/
  index.ts                   registry of lazy loaders — THE ONLY statically-imported file
  types.ts                   GeneratorContext / GeneratorOutput / GeneratorFn        (new)
  budget.ts                  VERTEX_BUDGET_*, MIN_FEATURE_MM, MIN_CUT_FEATURE_MM,
                             MIN_FEATURE_FLOOR_MM, countVertices, fitBudget          (new)
  poly.ts                    pure polyline helpers (new):
                               ringToShape(pts)         Vector2[] -> THREE.Shape, polyline only
                               stripClosingDuplicate()  drop a repeated first vertex
                               insetConvex(ring, d)     exact inward offset of a CONVEX ring
                               simplifyRDP(ring, tol)   Douglas-Peucker
                               ribbonQuad(a, b, w)      one segment -> 4-vertex rectangle
                               disc(c, r, segments)     regular n-gon
                             NO polygonArea — see below
  poly.test.ts

  voronoi/voronoi.ts         + voronoi.params.ts + voronoi.test.ts
  noiseContour/noiseContour.ts + .params.ts + .test.ts
  truchet/truchet.ts         + .params.ts + .test.ts
  lsystem/lsystem.ts         + .params.ts + lsystem.presets.ts + .test.ts
```

**No `polygonArea` — signed area already ships.** `THREE.ShapeUtils.area(points: THREE.Vector2[])` comes with the `three` dependency and is already used in production at `src/utils/patternUtils.ts:964`, `src/utils/dxfUtils.ts:385`, `:394`, and in tests at `src/utils/dxfUtils.test.ts:66`, `:85`, `:127`, `:151`. *(It is also called at `src/utils/offsetUtils.ts:94`, `:201` — but that module is dead clipper-lib code with zero production importers and is deleted in M0 (root §4.1); it is not evidence of anything.)* `poly.ts` already imports `* as THREE`. Use it directly for Lloyd centroid weighting (§4.6.1 step 3) and for the `insetConvex` collapse test. If a call site holds a flat `[x0,y0,…]` ring rather than `Vector2[]`, write a one-line adapter that maps to `Vector2` and calls `THREE.ShapeUtils.area` — do not write a second area implementation.

**`insetConvex` is permitted by root §5.2 rule 2's D2 amendment, adopted 2026-09-04 — see §8 Q6.** The technical justification, which Q6's request carries as its conditions: the only polygon offset in the codebase is `CrossSection.offset` at `src/utils/geometry/manifoldOps.ts:151` — worker-only, and reaching it from the main thread would instantiate a second wasm realm (`getManifold` memoizes per realm, `src/utils/geometry/manifoldModule.ts:15`, `:17-27`, so a second realm means a second 541,470-byte compile). `insetConvex` is the *convex* case only: shift each edge's supporting line inward by `d` and intersect consecutive shifted lines. For a convex ring this is exact and cannot self-intersect; the only failure mode is collapse, which is detected (an edge reverses direction, or `THREE.ShapeUtils.area` of the result is ≤ 0) and handled by dropping the ring and counting it in `clamps`. Every Voronoi cell is convex by construction. **`insetConvex` must reject any non-convex input rather than produce garbage** — assert convexity and throw in dev, drop the ring in prod.

### 4.4 Vertex budget

Derived, not guessed. The chain of measurements is in-repo:

| Step | Value | Source |
|---|---|---|
| Worst-case shipped pad area | 255.3 × 233.9 mm ≈ **59,700 mm²** | `00-architecture.md` §7 *Physical accuracy*, measured over `public/outlines/` |
| Contour points → triangles, un-simplified | **≈3.9 tri/point** (18464 / 4761) | `src/utils/geometry/manifoldOps.ts:36-38` |
| Whole-pipeline time budget | "well under 200 ms for a dense grip", inside a 150 ms debounce | `src/components/DebouncedInput.tsx:9-18` |
| Documented pain threshold | ~5800 ms for 48k sharp triangles under the *replaced* normals path | `src/utils/geometry/normals.ts:12-16` — **provisional, see §8 Q5** |

```
VERTEX_BUDGET_NOMINAL  =  6_000   ->  ~23,400 triangles
VERTEX_BUDGET_CEILING  = 12_000   ->  ~46,800 triangles
```

The ceiling lands deliberately just under the 48k figure the normals docblock records as the pathological case. **That anchor is provisional and §8 Q5 settles it:** the 5800 ms measurement is for Manifold's `calculateNormals`, which `computeSharpNormals` replaced, and the replacement's own perf test builds an *unwelded* mesh, so the union-find that scales with vertex valence is never exercised (`src/utils/geometry/normals.test.ts:200-217`, whose `mergePositions` helper at `:220-233` writes an identity index, `index[off + i] = off + i`; `00-architecture.md` §11 residual-risk table). A generated Voronoi field is exactly the welded, high-valence case the anchor does not cover. This reproduces the recon's independently-derived complexity budget (≈20k nominal / 48k ceiling triangles, ≈950 / ≈2300 Voronoi cells — report §8) almost exactly: at a mean Voronoi cell degree of 6, 6,000 vertices is 1,000 cells and 12,000 is 2,000.

**Enforcement is three-layered and every layer is mandatory:**

| Layer | Mechanism |
|---|---|
| **A — predict and clamp** | Where feature count is analytically known from params (Voronoi, truchet, L-system), estimate vertices *before* generating and raise the coarseness parameter until the estimate fits **`VERTEX_BUDGET_NOMINAL`** — not the ceiling. Record the clamp in `GeneratorOutput.clamps`. Every worked solve in §4.6 uses `NOMINAL`; a solve that lands on `CEILING` is a bug. |
| **B — decimate** | Where it is not (noise-contour), run `simplifyRDP` at the requested tolerance; if still over `NOMINAL`, double the tolerance and retry, at most 4 times. Deterministic. |
| **C — refuse** | If `vertexCount > VERTEX_BUDGET_CEILING` after A and B, **throw**. The caller surfaces it through `AlertContext` (`src/context/AlertContext.tsx:20`). Silently emitting an over-budget field is the failure mode rule 5 warns about: the worker's catch posts back an empty result and `PatternResult.empty` is read by nobody (`src/utils/geometry/applyPatternResult.ts:67`), so the pattern would just vanish. |

### 4.5 Min-feature clamps — printable AND cuttable

**Nothing to inherit.** There is no output-side clamp anywhere: `src/types/schemas.ts:10-85` contains **zero** `.min()` / `.max()` (verified by grep), and the `min=` HTML attributes are inert because `DebouncedInput` never validates and nothing calls `checkValidity` (`src/components/DebouncedInput.tsx:44-47`). The generator param schemas in §4.6 are **the first schemas in this repo with real bounds.**

`src/utils/generators/budget.ts` (new):

```ts
/** FDM floor. The embedded 3MF print profile is a 0.4 mm nozzle with 2 wall loops:
 *  node_modules/three-3mf-exporter/dist/index.mjs:300-305 writes layer_height "0.2",
 *  wall_loops "2", sparse_infill_density "15%", printer_variant "0.4" and
 *  nozzle_diameter ["0.4"] as hard-coded literals, so they ship on every export
 *  regardless of the caller's config. The surrounding printer/filament identity comes
 *  from defaultPrintConfig (index.mjs:5-19), merged at :24 and unmodified here because
 *  exportTo3MF is called with {} at src/components/OutputPanel.tsx:204.
 *  One nozzle width is a single-wall feature and prints badly; two is the floor. */
export const MIN_FEATURE_MM = 0.8;

/** Vinyl / drag-knife floor. NOT derived from anything in-repo — see §8 Q1.
 *  Conservative until a physical cut test settles it (task 15). */
export const MIN_CUT_FEATURE_MM = 1.0;

/** THE floor every schema .min() and every clamp uses. Derived, never a literal,
 *  so the schemas and the clamp table cannot drift apart. 1.0 mm today.
 *  Asserted against the schemas by T14. */
export const MIN_FEATURE_FLOOR_MM = Math.max(MIN_FEATURE_MM, MIN_CUT_FEATURE_MM);

/** Hard, from src/utils/geometry/manifoldOps.ts:86 — points.length < 6 is
 *  silently dropped with no error and no signal. */
export const MIN_RING_VERTICES = 3;
```

**One floor, `MIN_FEATURE_FLOOR_MM`, applied everywhere.** The doc's safety claim is *printable **and** cuttable*, so the schemas must enforce the stricter of the two constants, not the printable one alone. Every `.min()` in §4.6 that governs a solid or a void is `MIN_FEATURE_FLOOR_MM` — the identifier, never the number — and T14 asserts each schema's minimum equals it. **Persistence hazard:** these are the first bounded schemas in the repo and the values persist in `ProjectSchemaV1`. Task 15 *lowering* `MIN_CUT_FEATURE_MM` widens the range and is safe; *raising* it makes previously-saved values fail `Schema.parse` and needs a migration note in doc 04.

Applied uniformly:

| Clamp | Rule | Enforced where |
|---|---|---|
| Solid width | No emitted feature narrower than `MIN_FEATURE_FLOOR_MM` in its narrow direction | Voronoi: post-inset area/inradius test. Truchet/L-system: `strokeWidth` schema `.min()`. Noise-contour: RDP tolerance ≪ width, plus a band-width `.min()`. |
| Void width | Every gap between solids ≥ `MIN_FEATURE_FLOOR_MM` | Voronoi: `gap` `.min()`. Truchet: cell-edge clearance. L-system: not enforceable analytically — see §6.1. |
| Ring vertices | ≥ 3 after all clamping and decimation | `poly.ts` drops shorter rings and increments a counter reported in `clamps`. |
| Degenerate params | No zero, negative, NaN or Infinity coordinate can be produced | Every param schema carries `.min()`/`.max()`; generators call `Schema.parse(params)` on entry. |

### 4.6 The four generators

Common to all four. Ranges are enforced by zod; defaults are what `getDefaults` returns.

- Region is `ctx.region`, in mm, in outline space.
- Output is `THREE.Shape[]` built **only** from `moveTo`/`lineTo` over `THREE.Vector2` — never `absarc`, `bezierCurveTo`, `quadraticCurveTo` or `splineThru`. `serializeShape` flattens curves at `getPoints()`'s default 12 divisions (`src/utils/geometry/serialize.ts:29-32`, `:36`; `node_modules/three/src/extras/core/CurvePath.js:199-212`), which would silently change the vertex count and defeat the budget. This is grep-checkable (§6.3 AC-4).
- No ring carries a duplicate terminal vertex.

---

#### 4.6.1 Voronoi — the M3 proof-of-seam generator

**Library:** `d3-delaunay` (pulls `delaunator`). Pin exactly.

**Algorithm, end to end.**

1. **Region.** `ctx.region` arrives **unpadded** (§4.2). The generator expands it itself, on all sides, by an *effective* padding computed **after** budget layer A has settled `cellSize`:

   ```
   effectivePadding = regionPadding === 0 ? 0 : Math.max(regionPadding, effectiveCellSize)
   ```

   The padding matters: `voronoi.cellPolygon(i)` clips cells to the given rectangle, producing flat-sided partial cells at the boundary. Padding by at least one cell pitch pushes every rectangle-flat edge outside the outline, where the 3D intersect at `patternPipeline.ts:269` removes it. Computing it after layer A is load-bearing — a padding baked at the requested `cellSize` goes stale the moment layer A raises `cellSize`, and the flat edges reappear. `regionPadding: 0` is an explicit opt-out meaning *no padding*: the field then has a visible straight edge just inside the pad, which is a legitimate choice and is what T12 uses to get an exact span.
2. **Sites — jittered grid, not pure random.** Lay a `cols × rows` grid at pitch `cellSize` over the padded region; offset each site within its cell by `jitter * cellSize * (rng() - 0.5)` in each axis. Pure Poisson scatter gives wildly variable cell areas and therefore unpredictable vertex counts and unpredictable min-feature violations; a jittered grid gives an analytically known site count (`cols * rows`) — which is what makes budget layer A possible — and `jitter = 1.0` is already visually indistinguishable from random for grip purposes.
3. **Lloyd relaxation.** `relaxSteps` iterations of: build the diagram, replace each site with the centroid of its cell polygon, rebuild. ~10 lines using `voronoi.cellPolygon(i)` and `THREE.ShapeUtils.area` (§4.3 — do not write a `polygonArea`). Evens out cell sizes and pushes the smallest cells above the min-feature floor before the inset runs. Deterministic — no `rng` calls.
4. **Diagram.** `Delaunay.from(sites)` → `.voronoi([xmin, ymin, xmax, ymax])`.
5. **Per cell `i`:** `voronoi.cellPolygon(i)`. Returns `null` for degenerate cells — skip. Returns a **closed** ring (first vertex repeated as the last); `stripClosingDuplicate` removes it. **Task 3 asserts this** rather than trusting it: if a future `d3-delaunay` changes the convention, the test fails loudly instead of the app silently emitting a duplicate vertex per cell.
6. **Inset by `gap / 2`** with `insetConvex`. This is what turns the tessellation into separated studs with `gap` mm of channel between them. Cells that collapse are dropped.
7. **Clamp.** Drop any cell whose post-inset area < `minCellArea`, or whose sampled inradius < `MIN_FEATURE_FLOOR_MM / 2`.
8. **Corner rounding**, if `cornerRadius > 0`: replace each corner with `cornerSegments` chord points on a circular fillet. Costs `cornerSegments - 1` extra vertices per corner — budget layer A must account for it.
9. **Emit** one `THREE.Shape` per surviving cell. **Separate shapes, never one shape with many rings** (`manifoldOps.ts:85-88`, `:91-98`).

**Parameters.**

| Param | Type | Range | Default | Notes |
|---|---|---|---|---|
| `cellSize` | mm | 3 – 40 | **8** | Site pitch. Drives everything. Raised by budget layer A. |
| `jitter` | ratio | 0 – 1 | **0.65** | 0 = square grid, 1 = each site anywhere in its cell. |
| `relaxSteps` | int | 0 – 4 | **1** | Lloyd iterations. |
| `gap` | mm | 1.0 – 6 | **1.2** | Channel width between studs. `.min()` is `MIN_FEATURE_FLOOR_MM` — reference the identifier, never the literal (§4.5). |
| `cornerRadius` | mm | 0 – 3 | **0** | 0 = sharp corners, the cheap default. |
| `cornerSegments` | int | 2 – 8 | **3** | Ignored when `cornerRadius === 0`. |
| `minCellArea` | mm² | 1 – 200 | **4** | Post-inset drop threshold. |
| `regionPadding` | mm | 0 – 40 | **8** | Literal `.default(8)`, matching `cellSize`'s default — a zod `.default()` cannot read a sibling field (`getDefaults` is `schema.parse({})`, `src/utils/schemaDefaults.ts:6-8`), so `= cellSize` is not expressible. `0` opts out of padding; any positive value is raised to `max(regionPadding, effectiveCellSize)` after layer A (step 1). |

**Cost table** — 59,700 mm² pad, `cornerRadius = 0`, mean cell degree 6, cells = `floor(area / cellSize²)`:

| `cellSize` | cells | vertices | ≈ triangles | verdict |
|---|---|---|---|---|
| 12 | 414 | 2,484 | 9,700 | comfortable |
| 8 (default) | 932 | 5,592 | 21,800 | **at nominal — the largest default that is not clamped** |
| 6 | 1,658 | 9,948 | 38,800 | over nominal — **clamped up to 7.8 mm** |
| 5 | 2,388 | 14,328 | 55,900 | over nominal *and* over ceiling — **clamped up to 7.8 mm** |

**Budget layer A targets `NOMINAL`, per §4.4 layer A.** It solves

```
cellSize >= sqrt(area * 6 / VERTEX_BUDGET_NOMINAL)
         =  sqrt(59700 * 6 / 6000)  =  7.727 mm  ->  raised to 7.8
```

and raises `cellSize` to that value, recording the clamp. Consequences to hold in mind while implementing: **every** requested `cellSize` below 7.73 mm on a worst-case pad is raised to 7.73, so on that pad there is no "over nominal, under ceiling" band for Voronoi at all — the band exists only on smaller outlines, where `area` is smaller and the solve lands lower. `VERTEX_BUDGET_CEILING` is *not* layer A's target; it is the threshold layer C refuses at (§4.4), which for Voronoi should therefore be unreachable — if C ever fires here, layer A has a bug. `cornerRadius > 0` adds `cornerSegments - 1` vertices per corner (step 8) and must be folded into the estimate *before* the solve, which raises the clamped `cellSize` further.

**What the pipeline does with it, exactly** (zero edits required to any of this):

| Stage | Site | Effect on a Voronoi field |
|---|---|---|
| `buildJob` branch | `src/components/ImperativeModel.tsx:829-836` | `patternShapes[0]` is a `THREE.Shape`, not a `BufferGeometry`, so the `kind:'shapes'` branch is taken and `serializeShapes` runs at `:836`. **First production use of this branch.** |
| Union + extrude | `src/utils/geometry/patternPipeline.ts:138-139` | `csFromShapes(shapes, 'EvenOdd')` unions ~930 cells into one `CrossSection`; `Manifold.extrude(cs, 1)` makes it **exactly 1 unit tall**. |
| Recentre | `:143-149` | The whole field is translated so its bbox midpoint is the origin. Harmless *provided* the field is generated about the outline bbox; the outline is itself roughly origin-centred by the DXF import (`src/utils/dxfUtils.ts:203-211`, `:379-382`). If the field is generated elsewhere it will slide relative to the clip cutter. |
| Placement | `:183-191` | `isTiled` **must be `false`** for a whole-field generator. That collapses `positions` to a single identity instance at `:191`. With `isTiled: true` the tiler would stamp the entire field at every grid position. |
| Scale | `:199-201`, `:206` | XY by `patternScale`, Z by `patternScaleZ` falling back to `patternScale`. **`patternScale` must be 1** or the mm-correct field is silently rescaled. |
| Clip | `:218`, `:258-272` | `clipToOutline` defaults `true` (`src/types/schemas.ts:78`); the cutter is eroded by `patternMargin` (default **3 mm**, `:75`), so the field is trimmed 3 mm inside the outline by default. Expected, but surprising the first time. |
| Emit | `:358-366` | One `Pattern` part, normals via `computeSharpNormals(60°)` (`manifoldOps.ts:217`, `:22`). |

**Two numeric traps to state in the UI copy:**

- `patternScaleZ` defaults to the empty string (`src/types/schemas.ts:71`). `patternPipeline.ts:199` tests `patternScaleZ !== undefined && patternScaleZ > 0`; `"" > 0` is false, so it falls back to `patternScale`. With `patternScale` forced to 1, **a generated field extrudes to exactly 1.0 mm of stud height.** Set `patternScaleZ` to the stud height you want, in mm.
- `calculateAutoPatternScale` (`src/components/controls/GeometryControls.tsx:67-112`) overwrites `patternScale` at `:135` on every load. In non-tiled ("place") mode it targets 50 % of `baseSize - 2*margin` (`:100-110`), which for a 250 mm field on a 300 mm base yields ≈0.59 — a **41 % silent shrink**. Doc 02 bypasses or gates this; §6.3 AC-6 asserts it.

---

#### 4.6.2 Noise-contour

**Libraries:** `simplex-noise` (zero dependencies) + `d3-contour` (pulls `d3-array`, which pulls `internmap`).

**Algorithm.**

1. Sample fractal simplex noise on a regular grid over `region` at `gridStep` mm, summing `octaves` at `persistence`/`lacunarity`. Optional domain warp: offset each sample point by a second noise field scaled to `warp` mm.
2. `d3.contours().size([cols, rows]).thresholds([t])(values)` → **an array of GeoJSON `MultiPolygon` objects, one entry per threshold**, not a single MultiPolygon. With `.thresholds([t])` that is a `MultiPolygon[]` of length 1, so the object you want is `[0]`:

   ```ts
   const bands = d3.contours().size([cols, rows]).thresholds([t])(values); // MultiPolygon[]
   const multi = bands[0];            // { type: 'MultiPolygon', coordinates, value }
   ```

   Coordinates are in **grid index space**, so multiply by `gridStep` and translate by `region.min`. Task 11 pins this shape in a committed spike.
3. **Nesting comes from the GeoJSON structure, not from winding.** Each entry of `multi.coordinates` is one polygon, `[outerRing, ...holeRings]`. Attach the hole rings as `THREE.Path` on `shape.holes`, which `serializeShape` carries across the seam (`src/utils/geometry/serialize.ts:39-43`). Do **not** infer nesting from ring orientation: winding is inconsistent by source throughout this codebase (`00-architecture.md` §7) and d3-contour's handedness is not something to bet on.
4. **Bands without a boolean.** For a band between thresholds `t` and `t + bandWidth`, ask for both at once — `thresholds([t, t + bandWidth])(values)` returns two entries, `[0]` for `t` and `[1]` for `t + bandWidth`. Contours are strictly nested (`contours(t + bandWidth) ⊂ contours(t)`), so the band is `[0]`'s outer ring with `[1]`'s rings attached as **holes**. Under `'EvenOdd'` (`manifoldOps.ts:85-88`) that is exactly a band. No 2D boolean, no rule-2 violation. **The nesting is the whole reason to pay d3-contour's bundle cost (§8 Q4), so task 11's spike asserts it rather than assuming it.**
5. `stripClosingDuplicate` on every ring — d3-contour emits closed rings.
6. `simplifyRDP` at `simplifyTolerance`, escalating per budget layer B.

**Parameters.**

| Param | Type | Range | Default | Notes |
|---|---|---|---|---|
| `featureSize` | mm | 5 – 200 | **40** | Noise wavelength. Small values explode the contour length. |
| `octaves` | int | 1 – 5 | **3** | |
| `persistence` | ratio | 0.2 – 0.8 | **0.5** | |
| `lacunarity` | ratio | 1.5 – 3 | **2.0** | |
| `gridStep` | mm | 0.5 – 5 | **1.5** | Sample pitch. Sets the *maximum* contour vertex density. |
| `threshold` | ratio | −1 – 1 | **0.0** | Noise value the contour is taken at. |
| `bandWidth` | ratio | 0, or 0.05 – 0.6 | **0** | 0 = solid blobs; > 0 = bands with holes. Expressed in zod as a union of `z.literal(0)` and `z.number().min(0.05).max(0.6)`, so the gap between 0 and 0.05 is genuinely closed. |
| `warp` | mm | 0 – 30 | **0** | Domain warp amount. |
| `simplifyTolerance` | mm | 0 – 0.5 | **0.08** | RDP; escalates automatically under budget layer B. |

**Cost.** 255 × 234 mm at `gridStep` 1.5 → 170 × 156 = 26,520 samples × 3 octaves ≈ 80k noise evaluations — a few milliseconds. The cost centre is contour *length*: vertices ≈ total contour perimeter / `gridStep`, and perimeter is not predictable from params. Hence budget layer B, and hence RDP is **mandatory** on this generator rather than optional.

**Correctness note.** `bandWidth > 0` produces a shape whose holes are *inside* it — legal. `bandWidth = 0` with a threshold that makes two blobs merge produces separate polygons in `multi.coordinates` — each becomes its own `THREE.Shape`, which unions correctly at `csFromShapes`.

---

#### 4.6.3 Truchet / Wang

**Library:** none. Everything is analytic.

**The degenerate case already ships — read this before writing code.** A single-tile truchet field is reachable *today* with no new code at all, once seeding lands:

```
patternType    : (a generated single tile in patternShapes)
isTiled        : true
tilingDistribution : 'grid'          src/types/schemas.ts:79
tilingOrientation  : 'random'        src/types/schemas.ts:81
rotationClamp      : 90              quantises to 0/90/180/270 at
                                     src/utils/geometry/patternPipeline.ts:193-196
tileSpacing        : tileSize - unitW
```

`getRotation` returns `Math.random() * 2π` for `'random'` (`src/utils/patternUtils.ts:464`) — continuous, not quarter-turns — but `rotationClamp` snaps every placed rotation to a multiple of `rotationClamp` degrees (`patternPipeline.ts:193-196`). That *is* the truchet orientation mechanism, already built.

**Why the dedicated field generator is still worth building:** the tiler places at `fullWidth = tileWidth + spacing` where `tileWidth = unitW * patternScale` (`src/utils/patternUtils.ts:478`; `patternPipeline.ts:173`), and `unitW` is the *unit's bounding box*, not the cell. A truchet arc ribbon does not reach the cell corners, so `unitW < tileSize` and the tiles gap or overlap unless `tileSpacing` is set to exactly `tileSize - unitW` — a value the user cannot compute. Wang edge-matching is impossible through the tiler at any setting, because per-cell variant selection needs per-cell state and `PatternJob` carries exactly one `patternUnit` (`patternPipeline.ts:73`).

**Algorithm (field mode).**

1. Grid of `cols × rows` cells at `tileSize` over `region`.
2. **Plain truchet:** each cell draws its variant with a rotation of `floor(rng() * 4) * 90°`.
   **Wang mode:** generate a horizontal-edge label array `(cols+1) × rows` and a vertical-edge label array `cols × (rows+1)` from `rng` over `edgeColors` labels; each cell's tile is fully determined by its four edge labels, so curves run continuously across cell boundaries. O(cells), deterministic.
3. Variants:
   - `'arcs'` — two quarter-circle ribbons joining adjacent edge midpoints. A ribbon is the region between two **concentric** arcs of radius `tileSize/2 ± strokeWidth/2`, closed with straight end caps: analytic, needs no offsetting.
   - `'diagonals'` — one straight ribbon corner to corner: a rotated rectangle, 4 vertices.
   - `'triangles'` — half the cell, filled: 3 vertices.
4. **Extend every ribbon end by `overlapEps` (default 0.05 mm) along its tangent.** Without it, adjacent cells' ribbons meet exactly at an edge midpoint: a zero-width junction, which is both a CSG hazard and unprintable. The overlap is absorbed by the union at `csFromShapes`.
5. Emit one `THREE.Shape` per ribbon (two per cell in `'arcs'`), never one shape per cell.

**Parameters.**

| Param | Type | Range | Default | Notes |
|---|---|---|---|---|
| `tileSize` | mm | 4 – 40 | **12** | Raised by budget layer A. |
| `variant` | enum | `'arcs' \| 'diagonals' \| 'triangles'` | **`'arcs'`** | |
| `strokeWidth` | mm | 1.0 – 8 | **3.0** | `.min()` is `MIN_FEATURE_FLOOR_MM` — the identifier, not the literal (§4.5). |
| `arcSegments` | int | 4 – 24 | **10** | Per quarter-arc. Lowered by budget layer A before `tileSize` is raised. |
| `wang` | boolean | | **false** | |
| `edgeColors` | int | 2 – 4 | **2** | Wang only. |
| `overlapEps` | mm | 0.01 – 0.2 | **0.05** | |

**Cost** — 59,700 mm², `'arcs'`, ribbon = `2 * arcSegments + 2` vertices, 2 ribbons per cell, cells = `floor(area / tileSize²)`:

| `tileSize` | `arcSegments` | cells | vertices | verdict |
|---|---|---|---|---|
| 12 | 10 | 414 | 18,216 | over ceiling — clamped to `arcSegments` 4 **and** `tileSize` 14.2 |
| 12 | 4 | 414 | 8,280 | over nominal — clamped to `tileSize` 14.2 |
| 20 | 10 | 149 | 6,556 | just over nominal — clamped to `arcSegments` 9 (5,960) |
| 24 | 10 | 103 | 4,532 | comfortable — no clamp |

Truchet is the generator where the budget bites hardest and most visibly. Layer A drops `arcSegments` toward its floor of 4 first (it degrades appearance least), then raises `tileSize`. Like Voronoi, it targets `VERTEX_BUDGET_NOMINAL`: with `arcSegments` already at 4 the `tileSize` solve is `tileSize >= sqrt(area * 2 * (2*4+2) / VERTEX_BUDGET_NOMINAL)` = `sqrt(59700 * 20 / 6000)` = 14.11 mm → 14.2.

---

#### 4.6.4 L-system

**Library:** none.

**Algorithm.**

1. Expand `axiom` by `rules` for `iterations`, **stopping before any iteration whose result would exceed the effective segment cap**

   ```
   effectiveMaxSegments = min(maxSegments, floor(VERTEX_BUDGET_NOMINAL / (4 + jointSegments)))
   ```

   — layer A targets `NOMINAL` here as everywhere (§4.4), so the schema's `maxSegments` is the *user's* additional cap, not the budget's. At the defaults that is `min(1200, floor(6000 / 10))` = **600**. Aborting between whole iterations (never mid-string) keeps the output a valid L-system word and keeps it deterministic. Report both the achieved depth and which of the two caps bound it in `clamps`.
2. Turtle-walk the word (`F` forward, `+`/`−` turn by `angleDeg`, `[`/`]` push/pop) into a list of segments and branch points. `angleJitterDeg` and `stepJitter` perturb each step from `rng`.
3. **Fit to region first, ribbonise second.** Compute the skeleton's bbox, then uniformly scale and translate it into `region` inset by `fitMargin`. Doing this *before* applying `strokeWidth` is load-bearing: fit-then-stroke keeps the stroke mm-correct, stroke-then-fit scales the stroke too and makes `MIN_FEATURE_FLOOR_MM` meaningless.
4. **Ribbonise as separate convex pieces:** one `ribbonQuad` per segment, one `disc(vertex, strokeWidth/2, jointSegments)` per joint. This is the only self-intersection-safe construction. A single ribbon polygon following a self-intersecting curve (dragon, and any branching plant) overlaps itself, and overlapping rings **inside one shape XOR-cancel** under `'EvenOdd'` (`manifoldOps.ts:85-88`) — the overlaps would punch holes in the design. As separate shapes they union correctly (`:91-98`).

**Parameters.**

| Param | Type | Range | Default | Notes |
|---|---|---|---|---|
| `preset` | enum | `'koch' \| 'dragon' \| 'plant' \| 'sierpinski' \| 'custom'` | **`'plant'`** | Presets fill `axiom`/`rules`/`angleDeg`. |
| `axiom` | string | ≤ 32 chars | per preset | |
| `rules` | `Record<string,string>` | ≤ 8 rules, ≤ 64 chars each | per preset | |
| `iterations` | int | 1 – 7 | **4** | Capped further by the effective segment cap of step 1, which is `min(maxSegments, VERTEX_BUDGET_NOMINAL / (4 + jointSegments))`. |
| `angleDeg` | deg | 5 – 120 | **25** | |
| `stepMm` | mm | 0.5 – 20 | **4** | Pre-fit; the fit rescales it. |
| `strokeWidth` | mm | 1.0 – 6 | **1.6** | Post-fit. `.min()` is `MIN_FEATURE_FLOOR_MM` — the identifier, not the literal (§4.5). |
| `jointSegments` | int | 3 – 12 | **6** | |
| `angleJitterDeg` | deg | 0 – 15 | **0** | Seeded. |
| `stepJitter` | ratio | 0 – 0.4 | **0** | Seeded. |
| `fitMargin` | mm | 0 – 30 | **5** | Inset applied on **all** sides, so the fit box is `region - 2 * fitMargin` in each axis (step 3). T10 sets it to 0. |
| `maxSegments` | int | 100 – 1200 | **1200** | Hard cap, derived below. `.max()` is `VERTEX_BUDGET_CEILING / (4 + jointSegments)` at the default `jointSegments`; the `.min()` of 100 keeps §4.5's "every param schema carries `.min()`/`.max()`" true and stops a 1-segment degenerate field. |

**Cost.** Vertices ≈ `S * (4 + jointSegments)`. At `jointSegments = 6` that is `10S`, so `VERTEX_BUDGET_NOMINAL / 10` = **600** segments is what layer A stops at, and `VERTEX_BUDGET_CEILING / 10` = **1200** is the schema's `.max()` on `maxSegments` and the point at which layer C refuses. §8 Q3's measurement is taken at the ceiling, 1,200 segments, because that is the worst case a user can request.

**The one measurable risk in this doc.** Every segment and every joint is its own shape, so the worker builds `2 * S` separate `CrossSection` objects, each tracked (`manifoldOps.ts:62-65`), then unions them in one `CrossSection.union(sections)` call (`:97`). With layer A capping at `NOMINAL`, `S` lands at **600** at the default `jointSegments` (**1,200 CrossSections**) and at most **857** at `jointSegments` 3 (**1,714**). The layer-C ceiling is `S` = 1,200, i.e. **2,400** — reachable only if layer A is bypassed or its estimate is wrong. Even the floor of that range is an order of magnitude past anything the repo exercises: the largest documented multi-shape case is "~100 sub-shapes" (`manifoldOps.ts:105`). Task 14 measures 600 / 1200 / 2400 shapes so the headroom is known as well as the expected case. See §8 Q3.

### 4.7 Dynamic import strategy

**There are zero dynamic imports in the codebase today** — `grep -rn "import(" src --include='*.ts' --include='*.tsx'` returns 0. There is no precedent to copy, and there is no `manualChunks` in `vite.config.ts:6-23`, so today everything lands in one 1,850.77 kB / **531.65 kB gzipped** chunk that already exceeds Vite's 500 kB warning limit (`docs/_source/baseline-verification.md`).

`src/utils/generators/index.ts` — the **only** file in this folder that anything statically imports:

**The registry grows one line per generator; it is never written ahead of the modules.** Rollup cannot resolve a dynamic `import()` whose static string literal points at a file that does not exist, and `tsc` errors on it too — so a registry naming all four thunks would break `pnpm build` from task 6 until task 13 lands. Task 6 therefore ships **voronoi only**, and tasks 10, 12 and 13 each *extend* it with their own line as part of their own commit.

At task 6 (M3):

```ts
// A literal object of thunks. Rollup can only code-split an import() whose
// specifier is a static string literal — do NOT build the path from a variable,
// and do NOT add a thunk before the module it points at exists.
export const GENERATORS = {
  voronoi: () => import('./voronoi/voronoi'),
} as const;

export type GeneratorId = keyof typeof GENERATORS;   // (new — does not exist yet)
```

After task 13 (M5 complete) — each line added by the task that creates its module:

```ts
export const GENERATORS = {
  voronoi:         () => import('./voronoi/voronoi'),          // task 6
  truchet:         () => import('./truchet/truchet'),          // task 10
  'noise-contour': () => import('./noiseContour/noiseContour'),// task 12
  lsystem:         () => import('./lsystem/lsystem'),          // task 13
} as const;
```

Hard rules:

1. **The vendor packages are imported only inside the generator module that needs them.** `d3-delaunay` appears in `voronoi/voronoi.ts` and nowhere else; `simplex-noise` and `d3-contour` in `noiseContour/noiseContour.ts` and nowhere else. One stray top-level import in `index.ts`, `types.ts`, `budget.ts` or `poly.ts` hoists the whole library into the main chunk.
2. **`index.ts` and the param schemas must stay vendor-free.** Param schemas are needed eagerly (the UI renders bounds before the generator loads), so they live in `*.params.ts` files which import only `zod` — never the generator module.
3. Generators run on the **main thread** and therefore never reach `dist/assets/geometryWorker-*.js`. That chunk must be byte-unaffected.
4. `vite.config.ts:18-20`'s `optimizeDeps.exclude` is not touched.

**Bundle cost.** These packages are not installed, so **these figures are published estimates, not measurements** — AC-3 in §6.3 is the measurement.

| Package | Pin | Transitive | Est. gzip | vs 531.65 kB baseline |
|---|---|---|---|---|
| `d3-delaunay` | 6.0.4 | `delaunator` | ≈ 10 kB | ≈ 1.9 % — **must not enter the main chunk** |
| `simplex-noise` | 4.0.3 | none | ≈ 2 kB | ≈ 0.4 % |
| `d3-contour` | 4.0.2 | `d3-array` → `internmap` | ≈ 12 kB | ≈ 2.3 % |

The absolute sizes are small. That is not the point: the main chunk is already over budget and warns on every build, so the split is a hard requirement regardless of size. If the measurement shows `d3-contour` + `d3-array` costs materially more than estimated, the fallback is a ~120-line marching-squares implementation in `poly.ts` — the reason to prefer the library is its ring **nesting** (§4.6.2 step 3), not its marching squares.

---

## 5. Integration points

Existing call sites this attaches to. Doc 02 owns the plumbing; these are the exact lines it plumbs.

| # | Site | What happens | Owner |
|---|---|---|---|
| 1 | `src/App.tsx`, on the `<GeneratorRunner>` mount (doc 02 §4.1, §4.6 row 2) | The generator region needs the outline bbox. **This does *not* go through `src/components/Controls.tsx`.** Doc 02 runs generation in a null-rendering `GeneratorRunner` mounted directly under `<AlertProvider>` in `App.tsx`, and doc 02 acceptance criterion 8 requires `git diff --stat` to show `src/components/Controls.tsx` **unchanged**. `baseSettings` is already in scope at `src/App.tsx:15`, so the region is one more attribute on the same one-line mount: `baseSettings={baseSettings}` (or a pre-computed `region`), and `useGeneratedPattern` calls `getShapesBounds(cutoutShapes)`. *(An earlier draft of this row routed the prop through `<GeometryControls>` at `src/components/Controls.tsx:399-404`, precedent `<InlayControls cutoutShapes=…>` at `:386`. That route is void under doc 02's design — it would break doc 02 criterion 8.)* | 02 |
| 2 | `src/components/controls/GeometryControls.tsx:114-141` | `handlePatternLoaded(shapes, type, name, content)` — the existing writer into `patternShapes`. All three of today's writers are file-derived; a generator is the first that is not. Two hazards, both at this site. (a) It calls `calculateAutoPatternScale` and overwrites `patternScale` at `:135`. (b) `calculateAutoPatternScale` branches on `type === "stl"` at `:79`; a `THREE.Shape` has **no** `boundingBox` property (it extends `Path` → `CurvePath` → `Curve`), so `geometry.boundingBox === null` at `:81` is **false** — `undefined !== null` — `computeBoundingBox()` is skipped, `bounds` is `undefined` at `:82`, and `bounds.max.x` at `:83` throws a **`TypeError` inside `handlePatternLoaded`**. It is a loud throw, not a silent `NaN`. **A generator must never pass `'stl'`.** | 02 |
| 3 | `src/components/controls/GeometryControls.tsx:86` | `getShapesBounds(shapes)` in the non-STL branch calls `shape.getPoints()` (`src/utils/patternUtils.ts:17`) with **no `s.shape \|\| s` unwrap.** A `{ shape, color }` wrapper throws here. This is why §4.1 forbids generators emitting the wrapper. | 03 (constraint). **Two different docs act on `:86`, and neither is redundant:** doc 02 §5.1 makes it *unreachable while a generator is active*, via the `if (settings.generatorId) return null;` early return at `:74` — it does **not** add the unwrap. Doc 07 §4.6 adds the actual `s.shape \|\| s` unwrap at `:86`, because a routed traced-image source *does* emit the wrapper. |
| 4 | `src/components/ImperativeModel.tsx:829-836` | `buildJob` takes `kind:'geometry'` when `patternShapes[0] instanceof THREE.BufferGeometry`, else filters `s.shape \|\| s` on `instanceof THREE.Shape` and takes `kind:'shapes'` at `:836`. Bare `THREE.Shape[]` lands in the right branch with **zero edits**. M3's headline. | — |
| 5 | `src/components/ImperativeModel.tsx:897-903` — **no edit needed under doc 02's design** | The **hand-maintained dependency array** is the classic trap: any param not listed here never triggers regeneration (already demonstrably broken for the three `debugShow*Cutter` props, which `buildJob` reads at `:857-859` and the array omits). **Doc 02 §4.6 retires this row for generators:** under main-thread generation the params never reach `buildJob`. The only thing that crosses into `ImperativeModel` is `patternShapes`, which is **already** a dependency at `:901`, and a new array identity from `updateGeom` (`src/components/Controls.tsx:65`, a spread) re-runs the heavy effect for free. Doc 02 criterion 8 requires `ImperativeModel.tsx` to be **unchanged**. Re-read this row only if @liamstar overrules doc 02 §4.5 and generation moves into the worker. | 02 |
| 6 | `src/types/schemas.ts:66-85` | `GeometrySettingsSchema`. Every new field needs `.default()` or `getDefaults` throws (`src/utils/schemaDefaults.ts:6-8`). Do not model on `InlayItemSchema` (`:19-46`) — it has no defaults and would throw. | 02 (channel) / 03 (the four schemas) |
| 7 | `src/utils/geometry/patternPipeline.ts:138-139` | `csFromShapes` + `extrude(cs, 1)`. **Zero edits.** This is the join point rule 2 describes. | — |
| 8 | `src/utils/geometry/manifoldOps.ts:91-98` | The union that makes separate overlapping shapes work. **Zero edits.** | — |
| 9 | `src/context/AlertContext.tsx:20` | Where a budget refusal (§4.4 layer C) and a clamp report surface. Already used for load failures at `src/components/controls/BaseControls.tsx:86-90`. | 02 |

### 5.1 Shared files this doc itself touches

New-folder isolation holds for everything except these three. All three are unavoidable.

| File | Line | Why isolation is impossible |
|---|---|---|
| `package.json:17-41` | `dependencies` | Three new packages. There is nowhere else to declare them. |
| `src/types/schemas.ts:66-85` | `GeometrySettingsSchema` | Rule 3 requires geometry tunables to persist, and `ProjectSchemaV1` (`:87-96`) has exactly three fixed slots. There is no fourth slot and adding one is a `ProjectSchemaV2` question owned by doc 04. |
| `src/utils/patternUtils.ts:621-622`, `:684-685` | the two lattice sizings inside `generateTilePositions` (`:285`) | The tile cap (task 9), required of this doc by name in `00-architecture.md` §6. The hazard is inside the shared tiler; there is nowhere else to put the guard. **Rules 5 and 6 collide here** — `generateTilePositions` runs in both threads (`00-architecture.md` §5.2, rule 6 table) — so the change must be a pure additive guard with no behaviour change for finite inputs, and `src/utils/patternUtils.test.ts` (33 tests) must stay green unmodified. |

**Not touched:** `vite.config.ts` (the coverage allowlist already includes `src/utils/**` at `:30-35`); `src/workers/geometryWorker.ts`; `src/utils/geometry/patternClient.ts`; `src/utils/geometry/patternPipeline.ts`; `src/utils/geometry/manifoldOps.ts`; `src/components/OutputPanel.tsx`. **Never reformat** — there is no Prettier and no EditorConfig, and indentation is mixed across files.

---

## 6. Edge cases, testing, acceptance criteria

### 6.1 Edge cases

| # | Case | Behaviour required |
|---|---|---|
| E1 | Ring with < 3 vertices after inset/decimation | Dropped in `poly.ts` and counted. If it reaches the worker it is dropped silently at `src/utils/geometry/manifoldOps.ts:86` with no error and no readable signal — that silence is the thing to prevent. |
| E2 | A single shape whose rings overlap | Forbidden. XOR-cancels under `'EvenOdd'` (`manifoldOps.ts:85-88`). Overlapping features are separate shapes (`:91-98`). |
| E3 | `cellSize`/`tileSize`/`gridStep` = 0 | Impossible: schema `.min()`. Belt and braces: generators call `Schema.parse(params)` on entry. |
| E4 | Over-budget field | §4.4 layers A → B → C. C throws; the caller alerts. Never emit silently. |
| E5 | Empty output (all cells clamped away) | `buildJob` returns `null` at `src/components/ImperativeModel.tsx:835` → `cleanupPatternObjects` and the spinner clears at `:878-881`. Not a wedge, but silent. Generators must throw with a message instead of returning zero shapes. |
| E6 | Uncapped lattice hang | **The cap is this doc's deliverable — task 9, not a conditional.** `fullWidth = tileWidth + spacing` (`src/utils/patternUtils.ts:478`) → 0 gives `cols = Math.ceil(spanW / fullWidth) + 1 = Infinity` (`:684-685`) and the inclusive `for (r <= rows)` / `for (c <= cols)` loops at `:695-696` never terminate, **inside the worker**, where the only failure surface is a spinner that never clears. The same shape exists in the hex-cluster branch at `:621-622` via `clusterStepX`/`clusterStepY` (`:612-613`). Field generators use `isTiled: false` (`patternPipeline.ts:191`) so they cannot reach it — but the truchet-through-the-existing-tiler shortcut (§4.6.3, §8 Q2) **can**, and task 10 documents that shortcut in the UI copy. Guard both sites: reject non-finite / non-positive pitches, and cap `cols * rows` before the loops. |
| E7 | `patternScale ≠ 1` on a field generator | Silent uniform rescale at `patternPipeline.ts:206`; ≈41 % shrink from `calculateAutoPatternScale`'s place-mode default (`GeometryControls.tsx:100-110`, written `:135`). |
| E8 | Non-cloneable job value | `serializeShape` reads only `points`/`holes` (`serialize.ts:34-45`), so anything stashed on `shape.userData` never crosses. Still assert `structuredClone(job)` — a `DataCloneError` at `patternClient.ts:66-67` permanently wedges all geometry generation for the session, with the spinner stuck on. |
| E9 | THREE curve segments in a generated shape | Re-sampled at 12 divisions by `getPoints()` (`serialize.ts:29-32`, `:36`), silently changing the vertex count and defeating the budget. Forbidden; grep-checked. |
| E10 | L-system stroke overlap between distant branches | Not analytically preventable. Two branches passing within `strokeWidth` of each other merge into one solid — visually fine, and the union handles it. It **can** create a void narrower than `MIN_FEATURE_FLOOR_MM` between them. Accepted limitation; documented in the UI copy, not solved. |
| E11 | Voronoi boundary cells | `cellPolygon` clips to the rectangle, giving flat-sided partial cells. `regionPadding = cellSize` pushes them outside the outline where the 3D clip removes them (`patternPipeline.ts:269`). |
| E12 | `relaxSteps` on a near-degenerate site set | Lloyd on a cell with zero area produces `NaN` centroids. Guard: skip sites whose `cellPolygon` is `null` or whose area is ≤ 0, keeping the previous site position. |

### 6.2 Vitest plan

Files colocate as `*.test.ts` beside the source (repo convention). `globals: true`, `environment: 'jsdom'` (`vite.config.ts:24-26`). `src/utils/**` is inside the coverage allowlist (`:30-35`).

`src/utils/geometry/patternPipeline.test.ts` proves **Manifold wasm runs under Vitest/jsdom** and gives the exact harness to copy. Three ranges matter, and only these three:

| Range | What is there |
|---|---|
| `:79-84` | The wasm harness — `describe('generatePattern (Manifold)')` at `:79`, `let wasm: ManifoldToplevel` at `:80`, the `run` helper at `:81`, and `beforeAll(async () => { wasm = await getManifold(); })` at `:83-84`. **This is the part to copy.** |
| `:26-55` | The `baseJob` factory — a full `PatternJob` with every field defaulted and a `...overrides` spread. |
| `:8-24` | The flat-array `SerializedShape` fixture helpers `squareShape` and `xyBounds`. |

The Voronoi end-to-end test builds on that file's pattern **without modifying it** (AC-1).

| Test | Assertion |
|---|---|
| **T1 determinism** (×4 generators) | `gen(p, {region, rng: makeRng(1)})` `toEqual` a second call with a fresh `makeRng(1)`; and `not.toEqual` a call with `makeRng(2)`. `makeRng` **(new — does not exist yet)** is doc 08's seeded factory, assumed here as `makeRng(seed: number): () => number`; doc 08 owns the final name (see **Blocked by**). |
| **T2 closure** (×4) | For every emitted ring and hole, `first !== last` within 1e-9. |
| **T3 min vertices** (×4) | For every shape, `serializeShape(s).points.length >= 6`, and every entry of `.holes` likewise. |
| **T4 budget** (×4) | With the coarsest-permitted params, `out.vertexCount <= VERTEX_BUDGET_NOMINAL` and `out.clamps` is empty. With the **finest**-permitted params: for the three layer-A generators (Voronoi, truchet, L-system) `out.vertexCount <= VERTEX_BUDGET_NOMINAL` — layer A clamps *to* nominal, so landing between nominal and ceiling is a layer-A bug; for noise-contour, whose layer B escalates RDP at most 4 times and may stop short, `out.vertexCount <= VERTEX_BUDGET_CEILING`. In every case `out.clamps.length > 0`. |
| **T5 refusal** | A generator handed params that survive layers A and B still over-budget **throws**, and the message names the parameter to change. (Force with a stubbed budget constant.) |
| **T6 min feature — Voronoi** | Every emitted cell's sampled inradius ≥ `MIN_FEATURE_FLOOR_MM / 2`. Proxy, not a proof: sample the inradius as the minimum distance from the cell centroid to each edge. Stated as a proxy in the test's docblock. |
| **T7 gap — Voronoi** | For every adjacent cell pair (adjacency from the Delaunay edge list), the minimum inter-ring distance ≥ `gap - 1e-6`. |
| **T8 nesting — noise-contour** | With `bandWidth > 0`, at least one emitted shape has `shape.holes.length > 0`, and every hole ring is strictly inside its outer ring. Do the point-in-polygon with the **already-shipped, oracle-tested** pair: `buildPolyIndex(outerAsShape)` (`src/utils/patternUtils.ts:114`) then `pointInIndex(hx, hy, idx)` (`:181`) on the hole's first vertex. Both are exported and pinned against the scalar oracle `isPointInShape` (`:70`, docblock at `:69`) by `src/utils/patternUtils.test.ts:62-80`. Do not hand-roll a third copy — a module-private one already exists at `src/utils/dxfUtils.ts:399`. |
| **T9 continuity — truchet Wang** | With `wang: true`, every shared cell edge has ribbon endpoints from both sides within `overlapEps` of each other. |
| **T10 fit order — L-system** | **Set `fitMargin: 0`.** Then doubling `region` size leaves the emitted `strokeWidth` unchanged (measure the narrow dimension of a segment quad) while the skeleton bbox doubles exactly. With the default `fitMargin` 5 the skeleton grows by `(2R − 2m)/(R − 2m)` — 190/90 = **2.111** at `R` = 100, not 2 — because step 3 insets `region` on all sides before fitting, so the literal `2` assertion fails on a correct implementation. If a non-zero margin is wanted, assert that computed ratio, never the literal. The `strokeWidth`-unchanged half is the real fit-then-stroke invariant and holds at any `fitMargin`. |
| **T11 pipeline round trip — Voronoi (M3)** | `generateVoronoi` **(new — does not exist yet;** the default export of `voronoi/voronoi.ts`, task 5**)** → `serializeShapes` → `generatePattern(job, wasm)` with `isTiled: false`, `patternScale: 1`, `clipToOutline: true` and a square outline. Assert exactly one part named `'Pattern'`, `position.length > 0`, and the XY bounds fall inside the outline. Copy the wasm harness from `patternPipeline.test.ts:79-84` and the job factory from `:26-55`. |
| **T12 mm-correctness (M3)** | Generate with `regionPadding: 0`, `cornerRadius: 0`, default `gap` (1.2) and `ctx.region` = a 100 × 100 mm `THREE.Box2`. Assert `getShapesBounds(out.shapes).size.x` equals **`region width − gap` = 98.8 mm** within 1e-6, and likewise for `.size.y`. The value is not 100: step 6 insets every cell by `gap / 2`, including the flat rectangle-clip edges of the boundary cells, so the field span is exactly one `gap` narrower than the region it was generated over. Repeat at `region` 200 × 200 and assert `200 − gap`. **The tolerance is derived from `gap` and `regionPadding`, never a fixed ±0.5 mm** — a fixed tolerance either fails on a correct implementation or hides a real scale error. |
| **T13 clone safety** | `expect(() => structuredClone(job)).not.toThrow()`, where `job` is built by the `baseJob` factory copied from `patternPipeline.test.ts:26-55` with `patternUnit: { kind: 'shapes', shapes: serializeShapes(voronoiShapes) }`. |
| **T14 floor drift** (×3 schemas) | The schema minimum equals the constant the §4.5 clamp table names: `VoronoiParamsSchema.shape.gap.removeDefault().minValue`, `TruchetParamsSchema.shape.strokeWidth.removeDefault().minValue` and `LsystemParamsSchema.shape.strokeWidth.removeDefault().minValue` each `toBe(MIN_FEATURE_FLOOR_MM)` — all three schema names **(new — do not exist yet)**. `removeDefault()` is required: on zod 4.2.0 (`package.json:40`) a `ZodDefault` wrapper returns `undefined` for `.minValue`, and only the unwrapped `ZodNumber` carries it — verified in this repo's installed zod. This is the test that stops §4.5 and §4.6 drifting apart again. |
| **T15 tiler cap** | Calling `generateTilePositions` with `tileWidth: 10, tileHeight: 10, spacing: -10` (so `fullWidth === 0`) returns within 100 ms with a bounded array, instead of hanging. Same for `spacing: NaN` and for the `'hex'` distribution (the `:621-622` branch). A control case at `spacing: 2` returns the identical array it returns today, asserted against a snapshot taken before the change. |

### 6.3 Acceptance criteria

Each is a command, an assertion, or an observable outcome.

| ID | Criterion |
|---|---|
| **AC-1** | `pnpm test` is green and reports **≥ 31 test files** and **≥ 202 tests**, against the post-M0 baseline of 20 files / 155 tests (after deleting `offsetUtils.test.ts`, −1 file and −7 tests from `docs/_source/baseline-verification.md:16`). The 10 new files are the ones named in §7: `generators/poly.test.ts`, `generators/index.test.ts`, `generators/voronoi/delaunay.spike.test.ts`, `generators/voronoi/voronoi.test.ts`, `generators/voronoi/voronoi.pipeline.test.ts`, `generators/truchet/truchet.test.ts`, `generators/noiseContour/contour.spike.test.ts`, `generators/noiseContour/noiseContour.test.ts`, `generators/lsystem/lsystem.test.ts`, and `src/utils/patternUtils.tileCap.test.ts`. The ≥ 40 new tests are T1–T4 ×4 generators (16), T5–T13 (9), T14 ×3 (3), T15 ×3 (3), `poly.test.ts` ≥ 8, the two spikes ≥ 5. **No existing test file is modified** — `git diff --stat -- '*.test.ts' '*.test.tsx'` lists only new files. |
| **AC-2** | `grep -rn "Math\.random" src/utils/generators` returns nothing. |
| **AC-3** | `pnpm build` exits 0 and its printed asset table shows: (a) `dist/assets/index-*.js` gzip **≤ 535 kB** against the 531.65 kB baseline; (b) **at least four additional chunks — one per generator — plus at most one shared helper chunk** carrying `poly`/`budget`/`types`, and none of them is the main `index-*.js`. Five chunks is the expected outcome, not a failure: `poly.ts`, `budget.ts` and `types.ts` are imported by all four dynamic modules and by nothing static, so Rollup emits them as a shared chunk. (c) `grep -ci "delaunay\|delaunator\|createNoise2D\|contours" dist/assets/index-*.js` returns **0** — case-**insensitive**, and matching identifiers that survive minification (`Delaunay`, `Delaunay.from`, `createNoise2D`, `contours`) rather than package names, which do not. This is a **proxy**: minification can rename anything, so (b)'s chunk count is the primary evidence and (c) is the cheap tripwire. (d) `dist/assets/geometryWorker-*.js` is the same size as the baseline's 130.66 kB. |
| **AC-4** | `grep -rn "absarc\|bezierCurveTo\|quadraticCurveTo\|splineThru\|ellipse(" src/utils/generators` returns nothing — generators emit polylines only (E9). |
| **AC-5** | `getDefaults(VoronoiParamsSchema)` **(new — does not exist yet)**, and the other three param schemas, returns without throwing, and every returned value is inside that field's own `.min()`/`.max()`. This requires **every** persisted field to carry a literal `.default()` — `getDefaults` is `schema.parse({})` (`src/utils/schemaDefaults.ts:6-8`) and a zod `.default()` cannot read a sibling field, which is why `regionPadding` is `.default(8)` and not `= cellSize` (§4.6.1). Asserted in a test, not by eye. |
| **AC-6** | A Voronoi field generated at `cellSize: 10` lands in `patternShapes` with `patternScale === 1` — i.e. `calculateAutoPatternScale`'s write at `src/components/controls/GeometryControls.tsx:135` did not fire. Asserted by spying on `updateSettings` and checking `patternScale` is absent from the update payload. *(This is doc 02's fix; this doc's criterion is the assertion.)* |
| **AC-7** | T11 passes: a real `generatePattern` run over generated shapes yields a `'Pattern'` part with triangles. This is the M3 proof of seam. |
| **AC-8** | `src/utils/geometry/patternPipeline.ts`, `src/utils/geometry/manifoldOps.ts`, `src/workers/geometryWorker.ts`, `src/utils/geometry/patternClient.ts` and `src/components/OutputPanel.tsx` are **untouched** — `git diff --stat` lists none of them. `src/utils/patternUtils.ts` **is** touched, by task 9 only, and only additively (§5.1). |
| **AC-9** | Coverage: `pnpm test:coverage` reports non-zero line coverage for every file under `src/utils/generators/` (proves they are inside the allowlist and no `vite.config.ts` edit was needed). `index.ts` needs a test of its own to reach non-zero — its only content is an object of thunks no unit test calls — so `generators/index.test.ts` imports it and asserts `Object.keys(GENERATORS)` deep-equals `['voronoi', 'truchet', 'noise-contour', 'lsystem']`, pinning the registry as well as covering the file. That assertion is written with one id at task 6 and extended by tasks 10, 12 and 13. |
| **AC-10** | With the finest legal params on each generator, one full regeneration completes in **under 200 ms** measured from `buildJob` to `applyPatternResult`, matching the budget `src/components/DebouncedInput.tsx:12-14` assumes. Measured with `performance.now()` in a dev build; recorded in this doc's §8 Q3, not asserted in CI. |
| **AC-11** | **Tile cap (task 9).** T15 passes: `generateTilePositions` with `fullWidth === 0` (`tileWidth: 10, spacing: -10`), with `spacing: NaN`, and in the `'hex'` branch each return a bounded array in under 100 ms instead of hanging. The full existing `src/utils/patternUtils.test.ts` (33 tests) stays green **unmodified**, and a snapshot of `generateTilePositions` output for a normal job taken before the change deep-equals the output after it — the guard changes nothing for finite, positive pitches. Discharges the `must ship a tile cap` line in `00-architecture.md` §6. |

---

## 7. Task order

Dependency-ordered; each is one commit. The recon is **done** — every task starts from a finding in `docs/_source/00-recon-report.md`, never with "do recon".

| # | Task | Depends on | Done when |
|---|---|---|---|
| 1 | Add `d3-delaunay`, `simplex-noise`, `d3-contour` to `package.json:17-41` at **exact** pins (no caret — the manifold caret at `:29` is already a noted reproducibility hazard). Nothing imports them yet. | — | `pnpm install` clean; `pnpm build` gzip unchanged, proving a declared-but-unimported package costs nothing. |
| 2 | `src/utils/generators/{types,budget,poly}.ts` + `poly.test.ts`. Pure helpers only, zero vendor imports. No `polygonArea` — use `THREE.ShapeUtils.area` (§4.3). | doc 08's PRNG for the `rng` type; §8 Q6 amendment adopted 2026-09-04 (D2) | `poly.test.ts` covers `insetConvex` (square, triangle, collapse case, non-convex rejection), `simplifyRDP`, `stripClosingDuplicate`, `ribbonQuad`, `disc` — ≥ 8 tests. |
| 3 | **d3-delaunay spike, committed as `voronoi/delaunay.spike.test.ts`.** Assert that `voronoi.cellPolygon(0)` returns a ring whose last vertex equals its first, and that a cell clipped to the bounds rectangle is convex. | 1 | The test passes and pins both assumptions §4.6.1 rests on. A version bump that changes either convention now fails loudly. |
| 4 | `voronoi/voronoi.params.ts` — the zod schema with real `.min()`/`.max()`, every field carrying a **literal** `.default()`. **The first bounded schema in the repo** (`src/types/schemas.ts:10-85` has zero). | 2 | AC-5 for Voronoi; T14 for `gap`. |
| 5 | `voronoi/voronoi.ts` — sites, Lloyd, diagram, inset, clamp, emit. Budget layer A solves against `VERTEX_BUDGET_NOMINAL` (§4.6.1). | 2, 3, 4 | T1, T2, T3, T4, T6, T7, T12. |
| 6 | `src/utils/generators/index.ts` + `index.test.ts` — the lazy registry, **shipping the `voronoi` thunk only** (§4.7). Tasks 10, 12 and 13 each add their own line; a registry naming a module that does not exist yet fails both `tsc` and Rollup. | 5 | `pnpm build` shows a separate `voronoi` chunk; AC-3(c) holds for `Delaunay`; `index.test.ts` asserts `Object.keys(GENERATORS)` deep-equals `['voronoi']` (AC-9). |
| 7 | **M3 seam test:** `voronoi/voronoi.pipeline.test.ts` — generated shapes through `generatePattern`. Copy the wasm harness from `src/utils/geometry/patternPipeline.test.ts:79-84` and the job factory from `:26-55`; do not modify that file. | 5 | T11, T13 → AC-7. |
| 8 | Hand off to doc 02: region on the `<GeneratorRunner>` mount in `src/App.tsx` (§5 row 1 — **not** through `Controls.tsx`, which doc 02 criterion 8 requires unchanged), param channel, auto-scale bypass (`src/components/controls/GeometryControls.tsx:74` early return, covering the write at `:135`). **No dependency-array edit** — §5 row 5. | 7 | AC-6. **M3 exit.** |
| 9 | **Tile cap.** Guard both lattice sizings in `generateTilePositions` (`src/utils/patternUtils.ts:285`): reject non-finite or non-positive pitch (`fullWidth`/`fullHeight` at `:478-479`, `clusterStepX`/`clusterStepY` at `:612-613`) by returning `[]`, and clamp `cols * rows` to a `MAX_TILE_POSITIONS` ceiling **(new — does not exist yet)** before the loops at `:684-685` and `:621-622`. Purely additive: no behaviour change for finite, positive pitches. New file `src/utils/patternUtils.tileCap.test.ts`. | — (independent; do it before 10 exposes the shortcut) | T15 → **AC-11**. `src/utils/patternUtils.test.ts` green and unmodified. Discharges `00-architecture.md` §6's `must ship a tile cap`. |
| 10 | `truchet/*` — params, field generator, tests; **add the `truchet` line to `GENERATORS` and to `index.test.ts`.** Cheapest of the remaining three (analytic, no vendor dep). Document the existing-tiler shortcut (§4.6.3) in the UI copy — safe to document only because task 9 shipped the cap. | 2, 6, 9 | T1–T4, T9, T14 for `strokeWidth`. |
| 11 | **d3-contour spike, committed as `noiseContour/contour.spike.test.ts`** — the mirror of task 3, for the library §8 Q4 says is worth its bundle cost *only* for its ring nesting. On a known analytic field assert: `contours().size([c,r]).thresholds([t, t+bandWidth])(values)` returns an array of **length 2**; each entry is `{ type: 'MultiPolygon', coordinates }`; each polygon in `coordinates` is `[outer, ...holes]`; and every ring of entry `[1]` is contained in a ring of entry `[0]`. | 1 | The test passes and pins every structural assumption §4.6.2 steps 2–4 rest on. |
| 12 | `noiseContour/*` — params, generator, tests; **add the `noise-contour` line to `GENERATORS` and to `index.test.ts`.** Includes budget layer B (RDP escalation) and the band-as-holes construction. | 2, 6, 11 | T1–T4, T8; AC-3(c) for `createNoise2D`/`contours`. |
| 13 | `lsystem/lsystem.presets.ts` + `lsystem/*` — params, expansion with the `maxSegments` cap, turtle, fit-then-stroke, per-segment ribbonisation; **add the `lsystem` line to `GENERATORS` and to `index.test.ts`.** | 2, 6 | T1–T4, T10, T14 for `strokeWidth`. |
| 14 | Measure §8 Q3 **and §8 Q5** in one pass: time `csFromShapes` + `extrude` for an L-system field at 600 / 1200 / 2400 shapes, and re-run `src/utils/geometry/normals.test.ts:200-217` with `weld()` applied at 4000 boxes to see whether `computeSharpNormals` stays linear on a welded, high-valence mesh. Record both numbers in §8. | 13 | AC-10 for all four; the L-system cap is either confirmed or lowered on evidence; the §4.4 ceiling's anchor is either confirmed or re-derived. |
| 15 | Measure §8 Q1: cut a Voronoi test coupon on vinyl at `gap` = 0.8 / 1.0 / 1.5 mm and set `MIN_CUT_FEATURE_MM` from the result. **This needs a vector file, and the app has none** — recon §2 confirms exactly four download sites, all raster or mesh (STL, 3MF, watermarked PNG, project `.zip`). Depends on either doc 06a's flat cut path landing first, or a **throwaway test-only** SVG dump written inside `voronoi.test.ts` (≈15 lines: emit `<path d=…>` per shape, `fs.writeFileSync` behind an env flag). The dump is a coupon jig, **not** the doc-06 writer — do not let it become one. | 5 **and** (doc 06a, or the throwaway dump) | The constant in `budget.ts` carries a measured justification instead of "conservative", and §8 Q1 records the three cut results. |

---

## 8. Open questions

Six. Each has a stated way to settle it. **Q6 is resolved — adopted 2026-09-04 (D2).**

### Q1 — What is the real minimum cuttable feature on vinyl grip tape?

`MIN_FEATURE_MM = 0.8` is derivable from the 0.4 mm nozzle and 2 wall loops in the embedded 3MF print profile: `node_modules/three-3mf-exporter/dist/index.mjs:300-305` writes `layer_height: "0.2"`, `wall_loops: "2"`, `sparse_infill_density: "15%"`, `printer_variant: "0.4"` and `nozzle_diameter: ["0.4"]` as hard-coded literals on every export. (`defaultPrintConfig` at `index.mjs:5-19` carries only printer/bed/filament identity, no `wall_loops`; it merges at `:24` unmodified because `exportTo3MF` is called with `{}` at `src/components/OutputPanel.tsx:204`.) `MIN_CUT_FEATURE_MM = 1.0` is **not derived from anything** — it is a placeholder, and because `MIN_FEATURE_FLOOR_MM` is `max()` of the two, it is the value every schema `.min()` in §4.6 currently enforces. A drag knife's turning radius, the blade kerf, and whether the weeded channel survives transfer tape are all physical properties nothing in this repo knows.

*Settles it:* task 15 — cut a Voronoi coupon at `gap` = 0.8 / 1.0 / 1.5 mm and weed it. **That task has an undeclared dependency and cannot run today:** there is no vector output anywhere in the app to feed a cutter (recon §2 — exactly four download sites, none vector), and the flat-export path is doc 06, which this doc's **Blocks** table places downstream. Task 15 therefore waits on doc 06a, or on the throwaway test-only SVG dump named in its row. Until then the constant carries a comment saying it is unmeasured.

### Q2 — Whole-field or per-cell unit for truchet?

§4.6.3 shows the degenerate case already works through the existing tiler (`distribution: 'grid'` + `orientation: 'random'` + `rotationClamp: 90`), and shows why it is unusable for Wang tiles and awkward for plain truchet (`tileSpacing` must equal `tileSize - unitW`, a value the user cannot compute). The field generator is planned. What is genuinely open is whether the shortcut should *also* be exposed as a one-click preset — it costs nothing, works today, and its output is instanced rather than composed, so it is dramatically cheaper. **Exposing it is only safe after task 9**: a `tileSpacing` preset that can drive `fullWidth` to 0 is the exact input that hangs the worker (E6).

*Settles it:* @liamstar's product call after seeing both rendered. Recon §7 Q1's related recommendation — start one-at-a-time for the pattern slot — stands either way.

### Q3 — Does `csFromShapes` scale to 1,200–2,400 CrossSections?

The L-system emits one shape per segment plus one per joint (§4.6.4). With budget layer A capping at `VERTEX_BUDGET_NOMINAL` the expected worst case is 600 segments → **1,200** `CrossSection` objects at the default `jointSegments`, rising to ~1,714 at `jointSegments` 3; the layer-C ceiling of `maxSegments = 1200` is **2,400**, which layer A should make unreachable. Either way they are unioned in one call (`src/utils/geometry/manifoldOps.ts:91-98`). Nothing in the repo exercises anything close: the largest documented multi-shape case is "~100 sub-shapes" for a traced recolour inlay (`src/utils/geometry/manifoldOps.ts:105`). If this is slow, the answers in order of preference are: lower `maxSegments`; merge non-self-intersecting runs into single ribbons; move L-system behind a new worker kind (five edits, rule 5, handled **above** `await getManifold()` at `src/workers/geometryWorker.ts:35`).

*Settles it:* task 14 — time `csFromShapes` + `Manifold.extrude` at 600 / 1200 / 2400 shapes inside the existing Vitest harness and record the numbers in this section.

### Q4 — Is `d3-contour` + `d3-array` worth its bundle cost versus ~120 lines of marching squares?

The estimate in §4.7 is ≈12 kB gzipped, unmeasured. The reason to pay it is not the marching squares — that is easy — but the ring **nesting** (each polygon in a `MultiPolygon`'s `coordinates` is `[outer, ...holes]`, and successive thresholds are strictly nested), which §4.6.2 relies on and which is exactly the thing this codebase gets wrong elsewhere: winding is inconsistent by source (`00-architecture.md` §7) and hand-rolled nesting inference is how `parseDxfToShapes` ended up with a promoted-island bug (`src/utils/dxfUtils.ts:423-426`). **Task 11's spike pins that nesting**, so the property the bundle cost is being paid for is asserted rather than assumed.

*Settles it:* task 12 — install it, build, read the actual chunk size. If the delta is materially above 12 kB gzipped, write the marching squares and keep the GeoJSON-shaped nesting output — and keep task 11's spike, repointed at the replacement.

### Q5 — Does `computeSharpNormals` stay linear on a welded, high-valence generated field?

The §4.4 vertex ceiling is anchored to the ~5800 ms / 48k-triangle figure in `src/utils/geometry/normals.ts:12-16`. That measurement is for Manifold's `calculateNormals`, which `computeSharpNormals` **replaced**, so it bounds the *old* path, not the one a generated field will run through. The live path is unmeasured for this shape: its own perf test builds an **unwelded** mesh — `mergePositions` at `src/utils/geometry/normals.test.ts:220-233` writes an identity index, `index[off + i] = off + i`, giving every vertex valence 1 — so the union-find that scales with valence is never exercised, and the `expect(dt).toBeLessThan(2000)` bound at `:216` is roughly 40× looser than the linear claim needs. A Voronoi field is the opposite case: welded, high-valence, and — per the recon's §8 residual-risk row *"The 60° `SHARP_ANGLE` boundary case"* — its near-hexagonal cells sit exactly on the threshold where `dot >= cosLimit` decides whether vertices weld at all. Flagged as residual risk in both `00-architecture.md` §11 and recon §8; not previously an open question in this doc.

*Settles it:* task 14 — re-run `src/utils/geometry/normals.test.ts:200-217` with `weld()` applied, at 4000 boxes, per `00-architecture.md` §11. If it is not linear, `VERTEX_BUDGET_CEILING` is re-derived from the new measurement and §4.4 updated; the `NOMINAL` figure, which layer A actually targets, moves with it.

### Q6 — `insetConvex` amendment — **resolved — adopted 2026-09-04 (D2)**

**Resolved by @liamstar, 2026-09-04.** P0 commit 1 amends root §5.2 rule 2 to permit `insetConvex` under all four conditions below.

The adopted amendment:

> **Amendment — main-thread convex inset (D2, adopted 2026-09-04).**
>
> A pure, convex-only inward polygon offset on the main thread is permitted, subject to all four conditions:
>
> 1. **Convex only.** The function asserts convexity of its input and throws in dev / drops the ring in prod. Every Voronoi cell is convex by construction (§4.6.1 step 5).
> 2. **Exact, not approximate.** Shift each edge's supporting line inward by `d` and intersect consecutive shifted lines. For a convex ring this is exact and cannot self-intersect.
> 3. **Collapse handled, never emitted.** The one failure mode is collapse — an edge reversing direction, or `THREE.ShapeUtils.area` going ≤ 0 — and a collapsed ring is dropped and counted in `GeneratorOutput.clamps`.
> 4. **Never on pipeline output.** It runs only on generator-internal rings before emission. It is not a general offset, is not exposed outside `src/utils/generators/poly.ts`, and does not touch `src/utils/geometry/`.

The engineering case for it: the only polygon offset in the codebase is `CrossSection.offset` at `src/utils/geometry/manifoldOps.ts:151`, which is worker-only, and reaching it from the main thread instantiates a second wasm realm — `getManifold` memoizes per realm (`src/utils/geometry/manifoldModule.ts:15`, `:17-27`), so a second realm is a second 541,470-byte compile. The alternative, routing the inset through the existing worker, means a new job kind: five edits under rule 5, which §3 already declares a Non-Goal.

*Resolution:* @liamstar adopted the amendment on 2026-09-04; P0 commit 1 records it in root §5.2 rule 2. Task 2 may implement `insetConvex` subject to the four conditions above.

---

*Every `file:line` in this document was read against upstream `master` @ `cf698036f28f86e4d70c00b24a2283b5ab7d3f49`. Line numbers drift the moment upstream moves — re-grep after any merge.*
