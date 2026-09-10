# Direct editing — inlay regions now, pattern editing deferred

**Doc ID:** `05-direct-editing`
**Status:** Draft. **05a scoped and buildable. 05b deferred — not scheduled, recommend dropping.**
**Owner:** @liamstar
**Parent:** [`./00-architecture.md`](./00-architecture.md) — its §5 contracts and §5.2 rules bind this doc; its §10 governs the shape of this document.
**Evidence base:** `docs/_source/00-recon-report.md` (§5 "05 — direct editing", §6 M5, §8). The §9 recon is **DONE**; every task below starts from a finding, not from a survey.

| | |
|---|---|
| **Milestones served** | **M5** (root §8) — 05a is the last item in the `04 → 07 → rest of 03 → 05a` chain. Root §8 M5 already carries one 05a exit criterion: *"Paint-modal move and duplicate carry `shape.holes`."* **05b serves no milestone and is deliberately absent from the roadmap.** |
| **Blocked by** | **§4.4 (the lossy-edit fixes): nothing technical.** It depends on no part of M2 (seeding), M3 (generators) or M4 (flat export); its ordering is a priority call. **§4.3 (persistence): blocked on a design decision, not on code** — three docs propose three mechanisms for the same hole (doc 04 §4.3.1, this §4.3, doc 07 §4.5) and only one ships. Doc 04 §4.3.1 carries the comparison; §8 Q6 records the decision. Root §6 assigns persistence-for-source-less-shapes to doc 07 by name (*"the real blocker is persistence for shapes with no source file"*, `src/components/controls/InlayControls.tsx:131`, `:152`) and root §6 phasing puts 07 ahead of 05a, so **doc 07 is the presumptive owner** unless overruled. |
| **Blocks** | Nothing. 05a is a leaf. |
| **05b blocked by** | *"A polygon representation for the pattern, which does not exist"* (root §8, blocked-by chain). Preconditions enumerated in §4.7. |

---

## 1. Summary

Revision 1 of this workstream scoped direct editing around "post-generation node/region edits reusing `clipper-lib` utils". **`clipper-lib` is dead** — imported at exactly one site, `src/utils/offsetUtils.ts:2`, whose two exports are consumed only by their own test (`src/utils/offsetUtils.test.ts:3`), with zero hits in either shipped bundle, and slated for deletion in M0 (root §4.1). There are no clipper utils to reuse. That scope is void; this doc replaces it wholesale and splits it.

**05a — inlay region editing.** Every inlay region already exists as an individually named `THREE.Mesh` in the scene: `Inlay_<itemId>_<tileIdx>_<shapeIdx>`, emitted identically by the worker (`src/utils/geometry/inlayPipeline.ts:116`) and by the main-thread placeholder path (`src/components/ImperativeModel.tsx:670`), and re-addressed by prefix at four live sites (`applyInlayResult.ts:30`; `ImperativeModel.tsx:528`, `:763`, `:962`). The picking, naming and swap machinery is built. What is missing is (a) an *address type* for a region, (b) a way to select one from the 3D view, (c) a *durable* edit — today every paint-modal edit is silently discarded on export → import — and (d) three lossy-edit bugs in the paint modal. That is an **M**, and most of it lands in new files under `src/utils/inlay/`.

**05b — pattern node/region editing.** Not buildable, and not close. In every path the shipping UI can reach the pattern slot holds a `THREE.BufferGeometry`, not polygons (`src/components/controls/GeometryControls.tsx:163`; `src/components/ImperativeModel.tsx:829-830`). Even on the unreachable `kind:'shapes'` branch the polygons are consumed into one `CrossSection`, extruded to one solid, and `Manifold.compose(instances)` fuses every tile into a **single opaque mesh** (`src/utils/geometry/patternPipeline.ts:138-139`, `:236`, `:358-360`); every `CrossSection` is freed at `finally { ops.flush() }` (`:369-371`) and `PatternResult` carries only mesh buffers (`:84-100`). There is no region to name and no polygon to drag. §4.7 states the five preconditions and recommends **deferral**.

## 2. Goals / Non-Goals

**Goals (05a)**

1. A region is addressable: one type, one formatter, one parser, one source of truth for `Inlay_<id>_<tile>_<shape>`.
2. A region is selectable by clicking it in the 3D viewport.
3. A region-level edit (recolour, delete) applies, previews, and **survives export → import**.
4. Existing paint-modal edits stop losing data: holes, curve resolution, and layer origin.
5. No change to the boolean semantics of the core (root §10). `src/utils/geometry/patternPipeline.ts`, `manifoldOps.ts` and `src/workers/geometryWorker.ts` are untouched by this doc.

**Non-Goals**

- **Vertex / node editing of anything.** 100% greenfield: the gizmo vocabulary is move/scale/rotate on an item bounding box (`src/components/interaction/InlayInteractionHandles.tsx:456-461`, `:473-480`); there is no vertex handle, no 3D marquee, no snap. Out of scope for 05a and blocked for 05b.
- **App-level undo.** The only history in the app is a 50-entry ref stack inside the paint modal (`src/components/SVGPaintModal.tsx:144-145`, `:155-182`), wiped on every open (`:187-188`), and the one global mutation warns "This action cannot be undone" (`src/components/Controls.tsx:71`). Root §6 sizes it M and assigns it no doc. This doc does **not** build it, and every 05a edit must therefore be individually reversible by re-editing.
- **Main-thread 2D booleans.** Would mean a second Manifold realm and a second 541,470-byte wasm compile (`src/utils/geometry/manifoldModule.ts:15`, `:17-27`; root §5.2 rule 5). Region delete is a list operation, not a boolean.
- **Editing the pattern.** See §4.7.
- **Accessibility of the new picker beyond parity.** `src/` has zero `aria-*`, zero `role=`, zero `tabIndex` (root §7). Doc 04 owns the baseline; do not invent a second convention here.

## 3. Contract mapping (root §5.1)

| §5 contract | This doc | Real names, with evidence |
|---|---|---|
| **`Polygon`** | **Consumes. Adds no new form.** | Main thread: `THREE.Shape` (`src/types/schemas.ts:14`, `:22`) and the `{ shape, color }` wrapper (`src/utils/shapeLoader.ts:53`). Wire: `SerializedShape { points: number[]; holes: number[][] }` (`src/utils/geometry/serialize.ts:15-18`). Convert only with `serializeShape` / `deserializeShape` (`:34-45`, `:61-67`). The persisted override in §4.3 is the **zod mirror of `SerializedShape`**, not a seventh representation. |
| **`Outline`** | **Consumes, read-only.** | `BaseSettings.cutoutShapes` (`src/types/schemas.ts:14`) → split at `src/components/ImperativeModel.tsx:158-237` → reaches the inlay worker as `InlayJob.filledCutoutShapes` / `holeShapes` (`src/utils/geometry/inlayPipeline.ts:39-40`, applied `:111-112`). Unchanged by this doc. |
| **`ShapeSource`** | **Neither produces nor consumes.** | 05a edits an existing `InlayItem.shapes`; it adds no producer. `SVGPaintModal.onSave` (`src/components/SVGPaintModal.tsx:76`, fired at `:693`) is one of the three de-facto producers root §5.1 names, and if doc 07 lands the abstraction first the save path in §4.3 should route through it rather than duplicate it. |
| **`Generator<P>`** | **Not touched by 05a.** | 05b would consume it — precondition P1 in §4.7. |
| **`DesignState`** | **EXTENDS `ProjectSchemaV1` → `ProjectData`** (`src/types/schemas.ts:87-96`). | Two new names, both marked below: `SerializedShapeSchema` **(new — does not exist yet)** and `InlayItemSchema.editedShapes` **(new — does not exist yet)**. Plus behaviour changes at the two persistence sites: `exportProjectBundle` (`src/utils/projectUtils.ts:48-50`) and the import rehydrate (`src/components/Controls.tsx:206-231`). Note `ProjectSchemaV1` is a plain non-strict `z.object` — an *undeclared* key is stripped silently, so the field must be declared, not smuggled. **STRUCK (D3)** — `editedShapes` persistence is superseded by doc 07 §4.5's `<name>.shapes.json` asset (P9 commit 102). |

**Names this doc coins.** Every one is marked **(new — does not exist yet)** at first use and appears nowhere in `src/` today (verified by grep):

```
InlayRegionRef          type    { itemId: string; tileIdx: number; shapeIdx: number }
formatInlayMeshName     fn      (ref: InlayRegionRef) => string          // Inlay_<id>_<tile>_<shape>
inlayMeshPrefix         fn      (itemId: string) => string               // Inlay_<id>_
parseInlayMeshName      fn      (name: string) => InlayRegionRef | null
buildInlayJobShapes     fn      (shapes: unknown[]) => InlayJobShape[]   // index-preserving; T2
translateShape          fn      (shape: THREE.Shape, dx: number, dy: number, divisions?: number) => THREE.Shape
translateShapes         fn      (shapes: THREE.Shape[], dx: number, dy: number) => THREE.Shape[]
worldToItemLocal        fn      (p: THREE.Vector2, item: InlayItem, tile: {x,y,rot}) => THREE.Vector2
pointInShapeWithHoles   fn      (px: number, py: number, idx: PolyIndex, holeIdx: PolyIndex[]) => boolean
SerializedShapeSchema   zod     mirror of SerializedShape (serialize.ts:15-18)
EditedInlayShapeSchema  zod     { shape: SerializedShapeSchema; color; opacity; strokeWidth; strokeColor }
InlayItemSchema.editedShapes  zod field  EditedInlayShape[], nullable, default null
InlayRegionPicker       component  R3F sibling of InlayInteractionHandles
```

`InlayJobShape` in the `buildInlayJobShapes` signature is **not** new — it is the existing worker-side type at `src/utils/geometry/inlayPipeline.ts:15-18`.

## 4. Design

### 4.1 What a "region" is

A region is one `(item, tile, shape)` triple. It is already the atomic unit of the inlay pipeline in three independent places:

| Fact | Evidence |
|---|---|
| The worker emits one `InlayPart` per region, named `Inlay_<id>_<tileIdx>_<shapeIdx>` | `src/utils/geometry/inlayPipeline.ts:90-126`, name at `:116` |
| The main-thread placeholder loop emits meshes under the **same** name format | `src/components/ImperativeModel.tsx:601-679`, name at `:670` |
| `applyInlayResult` swaps by removing every mesh whose name starts with `Inlay_<id>_` | `src/utils/geometry/applyInlayResult.ts:30-31` |
| The drag path re-addresses the same prefix and writes a delta matrix per mesh | `src/components/ImperativeModel.tsx:762-796`, prefix test at `:763` |
| The orphan-mesh safety cleanup removes anything named `Inlay_*` from the group | `src/components/ImperativeModel.tsx:525-529`, prefix test at `:528` |
| The material-only effect traverses `Inlay_*` to recolour/re-opacity without a rebuild | `src/components/ImperativeModel.tsx:961-975`, prefix test at `:962` |

Region identity is therefore **already load-bearing**. What does not exist is a type for it, a parser, or a single formatter — the full-name template literal is written out twice (`inlayPipeline.ts:116`, `ImperativeModel.tsx:670`) and the name is read **four** more times as a string prefix: twice with the item id interpolated (`applyInlayResult.ts:30`, `ImperativeModel.tsx:763`) and twice as the bare literal `'Inlay_'` (`ImperativeModel.tsx:528`, `:962`).

> **Verified defect the recon report does not state.** `shapeIdx` in the mesh name **does not reliably index `item.shapes`.** The placeholder loop indexes the *unfiltered* array and skips transparent shapes inside the body (`ImperativeModel.tsx:606`, `:612`), while the job is built from a **pre-filtered** array (`:698-700`, `.filter((s) => s.color !== 'transparent')`) which the worker then indexes (`inlayPipeline.ts:92`). A transparent shape at index 0 makes the placeholder name the second shape `Inlay_x_0_1` and the worker name it `Inlay_x_0_0`. The existing code knows and works around it — `applyInlayResult`'s docblock names the exact hazard, *"a name that drifts (e.g. a 'transparent' shape shifting the shape index)"* (`applyInlayResult.ts:12-14`), and removes by item prefix rather than by name to avoid it. For a *selection* feature the workaround is not enough: a parsed `shapeIdx` must index `item.shapes`. **Fix: delete the `.filter(...)` at `ImperativeModel.tsx:700`.** The worker already skips transparent shapes itself (`inlayPipeline.ts:93`), so this is a one-line removal that aligns both paths, and it is task T2.

### 4.2 New modules (new folder — isolation achievable here)

```
src/utils/inlay/                       NEW FOLDER — inside the coverage allowlist
                                       (vite.config.ts:30-35 already includes src/utils/**;
                                        NO vite.config.ts edit is required)
  regionRef.ts        InlayRegionRef, formatInlayMeshName, inlayMeshPrefix, parseInlayMeshName
  regionRef.test.ts
  jobShapes.ts        buildInlayJobShapes  (index-preserving job mapping lifted out of
                                            ImperativeModel.tsx:698-700 — the T2 defect site,
                                            extracted so it is testable at all)
  jobShapes.test.ts
  shapeEdit.ts        translateShape, translateShapes   (hole-carrying; the fix for §4.4 bugs 1 and 3)
  shapeEdit.test.ts
  hitTest.ts          worldToItemLocal, pointInShapeWithHoles
  hitTest.test.ts

src/components/interaction/
  InlayRegionPicker.tsx   NEW FILE beside the existing InlayInteractionHandles.tsx
```

### 4.3 Persistence — `editedShapes` — **STRUCK (D3)**

> **STRUCK (D3), adopted by @liamstar, 2026-09-04.** The mechanism below is retained only as a rejected proposal; do not implement it or tasks T5–T8. Doc 07 §4.5's `.shapes.json` zip asset owns both source-less geometry and geometry edited after a source was loaded. Edited geometry supersedes the source asset, which is not retained across a round trip. Doc 04 §4.3.1 declares `SerializedShapeSchema` once; this doc and doc 07 import it. §4.4's lossy-edit fixes and recentre compensation are unaffected.

**The problem, verified end to end.** A paint-modal edit is discarded on round-trip:

1. `SVGPaintModal` saves through `onSave(localShapes)` (`src/components/SVGPaintModal.tsx:693`) into `InlayControls`'s handler (`src/components/controls/InlayControls.tsx:322-331`), which calls `handleShapeUpload(finalShapes, name)` at `:330` — **with no `type` and no `content`.**
2. `handleShapeUpload` therefore fails the guard `if (onInlayAssetChanged && name && content && type)` at `:131`, so the stored source asset is **not** updated. The bundle still carries the original `.svg`/`.dxf`.
3. Export spreads `inlay` untouched (`src/utils/projectUtils.ts:48-50`), so live `THREE.Shape` objects are stringified into `project.json` — the import path calls the result *"garbage"* in a code comment (`src/components/Controls.tsx:222`).
4. Import re-parses the original asset and **replaces** the item's shapes: `return { ...item, shapes: res.shapes }` (`src/components/Controls.tsx:226`).

Net: **every edit reverts to the un-edited source file.** Where there is no asset at all, the item instead keeps the plain JSON objects and the first `shape.getPoints()` throws.

**The field.** Add to `src/types/schemas.ts`, beside `InlayItemSchema` (`:19-46`):

```ts
// Zod mirror of SerializedShape (src/utils/geometry/serialize.ts:15-18).
// NOT a new geometry representation — representation #4 of root §5, declared to zod.
// Import SerializedShapeSchema from src/types/schemas.ts, declared once by doc 04 task B-1.

export const EditedInlayShapeSchema = z.object({         // (new — does not exist yet)
  shape: SerializedShapeSchema,
  color: z.string().default('#ffffff'),
  opacity: z.number().default(1),
  // Paint-modal stroke decoration. It is 2D-modal-only (nothing in the 3D path reads it),
  // but a live item.shapes entry carries it — SVGPaintModal writes both on open
  // (SVGPaintModal.tsx:194-195, type ShapeEntry at :64-70) and InlayControls preserves
  // them through save (:326-329) — so omitting them here silently drops a user's stroke
  // settings on the first export → import. One field each is cheaper than that loss.
  strokeWidth: z.number().default(0),
  strokeColor: z.string().optional(),
});

// inside InlayItemSchema:
//   null  = never edited; rehydrate from the source asset as today
//   []    = edited to empty (every region deleted) — NOT the same as null
  editedShapes: z.array(EditedInlayShapeSchema).nullable().default(null),  // (new)
```

`.default(null)` is mandatory: `getDefaults` is `schema.parse({})` (`src/utils/schemaDefaults.ts:6-12`) and root §5.2 rule 3 requires a default on every new field. (`InlayItemSchema` has no defaults today and would throw under `getDefaults` regardless — root §5.1 — so this field does not make that worse, and it must not be modelled on the rest of the schema.)

**Precedence rule, applied at exactly one place.** In `src/components/Controls.tsx:206-231`:

```
if (item.editedShapes !== null)  →  item.shapes = item.editedShapes.map(e => ({
                                       shape: deserializeShape(e.shape),   // serialize.ts:61
                                       color: e.color, opacity: e.opacity,
                                       strokeWidth: e.strokeWidth, strokeColor: e.strokeColor }))
else if (asset exists)           →  today's behaviour: parseShapeFile(asset.content, ...)  (:210, :226)
else                             →  item.shapes = []      (renders nothing; today it throws)
```

**Export.** `src/utils/projectUtils.ts:48-50` currently reads `inlay: { ...inlay }`. Map the items: set `shapes: []` (matching how `base.cutoutShapes` is nulled at `:46` and `geometry.patternShapes` at `:53`) and keep `editedShapes` as-is — it is already plain JSON and structured-cloneable. This removes the stringified curve blobs from every bundle.

**Missing-asset warning.** `src/components/Controls.tsx:132-141` warns for any item with `shapes.length > 0` and no asset. An item with a non-null `editedShapes` is fully described by the bundle; skip it. This is also root §8 M5's *"the 'Missing Asset Files' warning no longer fires for it"* criterion.

### 4.4 The three lossy-edit defects, their single fix, and one constraint

| # | Defect | Evidence | Fix |
|---|---|---|---|
| 1 | **Drag-move drops `shape.holes`.** The committed shape is rebuilt from `getPoints(32)` with `moveTo`/`lineTo` and the holes are never copied. | `src/components/SVGPaintModal.tsx:459-472` (rebuild at `:462-468`). The same file's text tool does it **correctly** at `:531-548` — it copies `s.holes` at `:538-546`. | Route both through `translateShape` **(new)**. |
| 2 | **Duplicate drops `shape.holes`.** Same rebuild, same omission. | `src/components/SVGPaintModal.tsx:252-270`, rebuild at `:257-264`. | Same helper. |
| 3 | **Every save re-centres the whole layer and flattens every curve.** `onSave` calls `centerShapes(rawShapes, false)` unconditionally (`InlayControls.tsx:325`), which rebuilds each shape with `moveTo`/`lineTo` from `getPoints()` at the **default 12 divisions** and translates the set onto its combined bbox midpoint. Curves survive only if the set is already centred within `lengthSq() < 0.001` (`patternUtils.ts:955`). So a first save flattens an untouched curved layer, and any edit that shifts the bbox translates the whole layer — the inlay visibly jumps relative to `item.x`/`item.y`. | `src/components/controls/InlayControls.tsx:325`; `src/utils/patternUtils.ts:939-992` (bbox `:942-952`, early return `:955`, rebuild `:961-973`, holes `:976-988`). Curve flattening mechanism: `getPoints()` defaults to 12 divisions (`node_modules/three/src/extras/core/CurvePath.js:199-212`); root §7. | Keep the recentre — the gizmo box depends on it (§4.6) — but **compensate the applied delta into `item.x` / `item.y`** so the layer does not move, and route it through `translateShapes` **(new)** so holes and sampling are handled in one place. |

**The constraint: do not modify `centerShapes` (`patternUtils.ts:939`).** It has **three** production call sites — `src/utils/shapeLoader.ts:62`, `:65` (both SVG import branches) and `src/components/controls/InlayControls.tsx:325` (paint-modal save) — plus three assertions that pin its behaviour at `src/utils/patternUtils.test.ts:172`, `:178`, `:186`. Two of the three call sites are on the shared import path, so any change to it is a behaviour change to upstream SVG loading. Add a sibling in `src/utils/inlay/shapeEdit.ts` instead and leave `patternUtils.ts:939` alone. *(Root §7's "five call sites" figure is a count across all **four** bbox-midpoint centring implementations, not across `centerShapes` alone — do not carry that number here.)*

`translateShape` must state its sampling explicitly. A `THREE.Shape` cannot be translated without re-deriving its points, so an edited shape becomes a polyline permanently. Name the constant once, in `shapeEdit.ts`, and use it for outer rings and holes alike (the modal currently uses 32 for outers and 16 for text holes — `SVGPaintModal.tsx:258`, `:462`, `:532`, `:539`). Root §5.2 rule 1 applies: leave rings **implicitly closed** — do not append a duplicate first point — and keep every ring at ≥ 3 vertices, because `points.length < 6` is silently dropped at `src/utils/geometry/manifoldOps.ts:86`.

### 4.5 Hit-testing: what exists, and whether it can serve region selection

Three exported helpers look like the answer. Read carefully, only one of them is, and not for the 3D view.

| Helper | Where | Production call sites | Verdict for region selection |
|---|---|---|---|
| `isPointInShape(p, shape)` | `src/utils/patternUtils.ts:70` | **ZERO.** Its own docblock declares it *"Reference scalar implementation. Kept as the correctness oracle for `pointInIndex`."* (`:69`). Its only consumer is `src/utils/patternUtils.test.ts:74`. | **Do not build on it.** It re-materialises `shape.getPoints()` on every query and is O(n) per point. It is a test oracle, and it should stay one. |
| `buildPolyIndex(shape)` → `PolyIndex` | `src/utils/patternUtils.ts:114`, type at `:102-113` | Called only inside `generateTilePositions`, via the per-run cache `indexFor` (`:164-167`; the cache `Map` is created at `:307` and populated at `:312`, `:316`, `:320`, `:324`) | **Usable in 2D, with one correction.** Y-bucketed edge index over flat typed arrays; bit-identical to the scalar form by construction (`:99-101` docblock). Rebuild cost is one pass over the contour. |
| `pointInIndex(px, py, idx)` | `src/utils/patternUtils.ts:181` | `:359`, `:385`, `:394`, `:417` — all inside `generateTilePositions` | Same. |

**The correction: neither reads holes.** `buildPolyIndex` walks `shape.getPoints()` only (`:115`) and never touches `shape.holes`. A point inside a counter — the hole of an "O", the middle of an "A" — tests **inside**. For pad tiling that is deliberate and harmless (tiles are placed over outline holes and removed later by the 3D subtract; recon §3.8). For picking an inlay region it is wrong on exactly the shapes users draw. Hence `pointInShapeWithHoles` **(new)**: build one `PolyIndex` for the outer ring plus one per hole, and return `outer && !holes.some(h => pointInIndex(px, py, h))`.

**And they are shape-local.** A click in the viewport is world mm. The region's transform chain is baked, in this order, in both paths — translate-Z, scale XY, rotate Z, translate XY (`src/utils/geometry/inlayPipeline.ts:104-109`; mirrored on the main thread at `src/components/ImperativeModel.tsx:648-660`), with mirror applied as an X negation plus winding reversal (`inlayPipeline.ts:94` via `csFromShape(sh.shape, item.mirror)`; `ImperativeModel.tsx:624-637`). No inverse helper exists — `InlayInteractionHandles` never needs one because its pick plane is a *child* of a transformed group (`InlayInteractionHandles.tsx:466-480`). Hence `worldToItemLocal` **(new)**.

**Decision: raycast the meshes for the 3D pick. Use `pointInIndex` only in the paint modal.**

Every region is already an individual `THREE.Mesh` with a unique name inside `InlayGroup` (`applyInlayResult.ts:50-51`; `ImperativeModel.tsx:669-670`; group created at `:562-569`). `raycaster.intersectObjects(inlayGroup.children)` therefore returns the region **directly**, and it returns the *right* one: the mesh geometry is the post-CSG result, so holes, the outline clip, the hole subtract and the coplanar depth-bias z-order are all already correct — none of which a 2D parity test on `item.shapes` can reproduce.

**How the picker gets `inlayGroup`.** It is not passed. `InlayRegionPicker` mounts as a *sibling* of `ImperativeModel` under the same gate (`ModelViewer.tsx:503-515`) and receives no group ref, and `InlayGroup` is created — and re-created or cleared — imperatively inside `ImperativeModel`'s effect (`ImperativeModel.tsx:562-569`). So resolve it on each pick with `useThree(({ scene }) => scene).getObjectByName('InlayGroup')` and **do not cache the reference across renders**. This is the same route the existing gizmo takes: `InlayInteractionHandles` reads R3F state through `useThree` rather than taking a passed object (`InlayInteractionHandles.tsx:108`, consumed at `:159-176`).

`worldToItemLocal` / `pointInShapeWithHoles` are still needed, but for a *second* job, not for the pick itself: mapping the hit point back into shape-local space so an edit knows *where* in the shape the user clicked (T11), and the paint-modal upgrade below (T13). There is **no** 2D fallback path during a drag — selection is suppressed while `isDragging` (§6, edge case 3) — so T10 does not depend on them.

In the paint modal, `pointInIndex` is a **strict upgrade** over what ships: single-shape click uses SVG DOM hit-testing (`SVGPaintModal.tsx:878` → `handleShapeClick`, `:295`), but drag-move detection and marquee selection both use axis-aligned bounding boxes (`:366-367`, `:484`), so clicking the empty middle of a "C" grabs it. That is a cheap, well-tested win — but it is not on 05a's critical path and is listed as optional task T13.

**One obstacle, stated plainly.** `OrbitControls` binds `LEFT: THREE.MOUSE.ROTATE` (`src/components/ModelViewer.tsx:450-454`), so a left-drag orbits the camera. Click-to-select must be distinguished from an orbit by pointer travel between `pointerdown` and `pointerup`. The paint modal already uses this exact shape of guard for marquee-vs-click (`SVGPaintModal.tsx:474`, `marqueeRect.w > 2 || marqueeRect.h > 2`). Do not change the OrbitControls bindings — they are upstream and shared.

### 4.6 The gizmo's pick surface is offset (fix opportunistically, not required)

The existing move handle is an invisible `planeGeometry` sized from `getShapesBounds(shapes)` and placed at local `(0,0)` (`InlayInteractionHandles.tsx:450-461`, `:473-480`). `bounds.center` is computed (`patternUtils.ts:27`) and **discarded**, so the pick plane sits off the visible geometry by exactly `bounds.center` on any layer whose **shape-set bbox is not at the item origin**.

Which layers those are is narrower than it looks — most import paths do centre:

| Source | Set bbox at origin? | Evidence |
|---|---|---|
| SVG | **Yes.** `parseShapeFile` centres explicitly, on both branches | `src/utils/shapeLoader.ts:62` (`centerShapes(rawShapes, true)`), `:65` |
| DXF | **Yes, internally.** `parseShapeFile` skips `centerShapes` (`shapeLoader.ts:71`) but `parseDxfToShapes` subtracts its own bbox midpoint at build time | midpoint at `src/utils/dxfUtils.ts:203-211`, subtracted at `:379` and `:382` |
| Traced image | **No.** `traceImage` centres on the *image frame*, not on the traced content — an off-centre subject stays off-centre in the layer | `src/utils/image/traceImage.ts:184-189` |
| Painted (paint modal) | **Yes**, on every save — and §4.4 keeps that recentre | `src/components/controls/InlayControls.tsx:325` |

So the symptom belongs to **traced-image inlays**, which exhibit it in full, and to DXF only as a small residual: the DXF centring box measures segment start/end points only, so arc and circle bulges are invisible to it (`dxfUtils.ts:169-170`, `:203-211`). Neither SVG nor painted layers show it. T12 is still worth doing — it is one line, offset the plane by `bounds.center` — but it fixes the image-trace case, not "every DXF inlay".

### 4.7 05b — pattern node/region editing: **BLOCKED. Recommend dropping.**

Do not scope it. Here is why, and what would have to become true first.

**Why there is nothing to edit.**

| Fact | Evidence |
|---|---|
| The pattern slot holds a `THREE.BufferGeometry` in every path the shipping UI can reach. The uploader is gated `allowedTypes={["stl"]}` and all 14 pattern presets are `.stl`, so `buildJob` always takes `kind:'geometry'`. | `src/components/controls/GeometryControls.tsx:163`; `src/components/PatternLibraryModal.tsx:19-32`; `src/components/ImperativeModel.tsx:829-830` |
| The `kind:'shapes'` branch exists and is test-covered but **has never had a production caller.** | `src/utils/geometry/patternPipeline.ts:47-49`, `:138-139`; root §8 M3 exit ("the first production use of that branch") |
| Even on that branch, polygons live for two statements: one `CrossSection`, then `Manifold.extrude(cs, 1)`. Nothing keeps the ring list. | `src/utils/geometry/patternPipeline.ts:138-139` |
| `Manifold.compose(instances)` fuses every tile into **one** solid. | `:236` (`instances.forEach(i => i.delete())` at `:237`) |
| The CSG path emits exactly **one** mesh, named `Pattern`, plus per-mask parts `Pattern_Masked_<idx>_<color>`. No per-tile, per-cell or per-node name exists. | `:358-360`, `:345`; applied at `src/utils/geometry/applyPatternResult.ts:90-129` |
| The instanced fast path emits one `THREE.InstancedMesh` named `Pattern`, so a raycast against it exposes three.js's `intersection.instanceId` — a **three.js API name, not a repo name**: `grep -rn '\binstanceId\b' src/` returns **zero**, the worker emits only `{ unit, matrices, count }`, and `applyPatternResult` writes `setMatrixAt` without any id. It addresses a *placement*, never a node, and the path is taken only when `useCSG === false` — clipping, exclusions, masks, holes and the height cut all off. | `patternPipeline.ts:221` (`useCSG`), `:223-229` (emit); `applyPatternResult.ts:71-86`, `InstancedMesh` + `setMatrixAt` at `:75-85` |
| No 2D value escapes the worker. Every `CrossSection` is freed in `finally { ops.flush() }`; `PatternResult` carries only mesh buffers. | `patternPipeline.ts:369-371`, `:84-100`; root §4.2 fact 2 |

**Preconditions for 05b to become buildable, in order.** Each is owned by another doc and none is small.

| # | Precondition | Owner / status |
|---|---|---|
| **P1** | A generator writes `THREE.Shape[]` into `patternShapes`, so the pattern has polygons at all. | doc 02 + doc 03; root §8 **M3**. Not started. |
| **P2** | The *placed field* (positions × unit) is reconstructible on the main thread. It exists nowhere outside the worker today and is not re-derivable without a seed — `generateTilePositions` uses bare `Math.random()` at `src/utils/patternUtils.ts:464`, `:504`, `:505`. | doc 08; root §8 **M2**. Not started. |
| **P3** | A stable per-region identity survives `compose` — meaning either compose is abandoned for the edited path, or N parts are emitted instead of 1. **The second option has a hard performance objection:** `computeSharpNormals` runs on *every emitted mesh* via `serializeMesh` (`src/utils/geometry/normals.ts:26`; `src/utils/geometry/manifoldOps.ts:217`), is never cached, and its own docblock records the ~5800 ms case it exists to avoid (`normals.ts:12-16`) — against a whole-pipeline budget of "well under 200 ms for a dense grip" (`src/components/DebouncedInput.tsx:12-14`). Multiplying it by the tile count is not a tuning problem. | Nobody. Would need a §10 amendment of its own. |
| **P4** | Contours come back out of the worker. This is exactly doc **06b**'s read-only contour channel and its §10 amendment (root §10, adopted 2026-09-03; root §8 **M4b**). | doc 06b. Gated. |
| **P5** | App-level undo, because node editing without undo is unusable. None exists (§2 Non-Goals). | Nobody; root §6 sizes it M. |

**Recommendation.** Defer 05b indefinitely and remove it from the roadmap rather than carrying a phantom XL. Its user value — "change this bit of the pattern" — is better served, sooner and more cheaply, by making the **generator's parameters** the editing surface (docs 02 and 04), which is where the roadmap already invests. If a direct-manipulation affordance on the pattern is wanted before P1–P5 land, the only cheap adjacent thing is per-*tile* delete/nudge keyed on three.js's `intersection.instanceId` over the instanced path — and that path is only taken with `useCSG === false` (`patternPipeline.ts:221`), i.e. clipping, exclusions, masks, holes and height cut all switched off, which makes it a demo, not a feature. **It is explicitly not part of this doc.**

An honest "not yet, here is the precondition" is the output. Reopen 05b only when P1 and P4 have both shipped, and re-cost it then.

## 5. Integration points

Files this doc **creates** are listed in §4.2. Files it must **touch**, with the reason isolation is impossible:

| File | Line(s) | Change | Why it cannot be isolated |
|---|---|---|---|
| `src/utils/geometry/inlayPipeline.ts` | `:116` | Use `formatInlayMeshName` **(new)** | The name is produced here. *(Not "the core" — root §12 glossary defines the core as `patternPipeline.ts` + `manifoldOps.ts` + `geometryWorker.ts`.)* |
| `src/components/ImperativeModel.tsx` | `:670` | Same formatter | Second producer of the same string |
| `src/components/ImperativeModel.tsx` | `:698-700` | Replace the inline map+filter with `buildInlayJobShapes` **(new)**, which **drops** the `.filter((s) => s.color !== 'transparent')` | Index alignment — §4.1. The worker already skips at `inlayPipeline.ts:93`. Extracted rather than edited in place because `src/components/**` is outside the coverage allowlist (`vite.config.ts:30-35`) and the defect is otherwise untestable |
| `src/utils/geometry/applyInlayResult.ts` | `:30` | Build the prefix with `inlayMeshPrefix` **(new)** instead of the inline `` `Inlay_${id}_` `` | Third interpolated construction of the same string; leaving it out makes acceptance criterion 3 unreachable |
| `src/components/ImperativeModel.tsx` | `:762-796` | Build the prefix with `inlayMeshPrefix` **(new)** at `:763`; decode any full name with `parseInlayMeshName` | Fourth interpolated construction. *(The two **bare**-literal readers, `:528` and `:962`, take no item id and are out of scope — they do not match criterion 3's grep.)* |
| `src/components/ModelViewer.tsx` | `:503-515` | Mount `InlayRegionPicker` **(new)** as a sibling under the same `activeTab === 'inlay'` gate | The gate and the R3F tree live here; there is no other mount point |
| `src/components/SVGPaintModal.tsx` | `:252-270`, `:459-472` | Call `translateShape` **(new)** | The buggy rebuilds are inline in the handlers; no seam exists |
| `src/components/controls/InlayControls.tsx` | `:322-331` | Compensate the recentre into `item.x`/`item.y`; write `editedShapes` | The only `onSave` handler **STRUCK (D3)** — `editedShapes` persistence is superseded by doc 07 §4.5's `<name>.shapes.json` asset (P9 commit 102). |
| `src/components/controls/InlayControls.tsx` | `:118-156` | `handleShapeUpload` must clear `editedShapes` when a **new file** replaces the layer | Loading a new asset must not resurrect stale edits **STRUCK (D3)** — `editedShapes` persistence is superseded by doc 07 §4.5's `<name>.shapes.json` asset (P9 commit 102). |
| `src/types/schemas.ts` | `:19-46` | `SerializedShapeSchema`, `EditedInlayShapeSchema`, `editedShapes` — all **(new)** | One schema file; root §5.2 rule 6 budgets exactly this **STRUCK (D3)** — `editedShapes` persistence is superseded by doc 07 §4.5's `<name>.shapes.json` asset (P9 commit 102). |
| `src/utils/projectUtils.ts` | `:48-50` | Strip live `shapes`, keep `editedShapes` | The only bundle writer **STRUCK (D3)** — `editedShapes` persistence is superseded by doc 07 §4.5's `<name>.shapes.json` asset (P9 commit 102). |
| `src/components/Controls.tsx` | `:206-231` | Precedence rule of §4.3 | The only rehydration site |
| `src/components/Controls.tsx` | `:132-141` | Skip the missing-asset warning for edited items | The only warning site |
| `src/components/interaction/InlayInteractionHandles.tsx` | `:450-461`, `:473-480` | Offset the pick plane by `bounds.center` (T12, optional) | The handle geometry is inline |

**No edit required to:** `src/utils/geometry/patternPipeline.ts`, `manifoldOps.ts`, `src/workers/geometryWorker.ts` (root §10 core), `src/utils/geometry/patternClient.ts`, `src/utils/patternUtils.ts` (`centerShapes` is left alone — see §4.4's constraint note), `src/App.tsx`, and `vite.config.ts` (`src/utils/**` is already in the coverage allowlist at `:30-35`).

**Two constraints that bite here.** (1) The React Compiler is on with `target: "19"` (`vite.config.ts:8-14`), so `InlayRegionPicker` must not mutate props or state and must not call hooks conditionally. (2) Job payloads must stay structured-cloneable — a `DataCloneError` at `src/utils/geometry/patternClient.ts:66-67` **permanently wedges all geometry generation for the session** (root §5.2 rule 5). ~~`editedShapes` is plain JSON and safe~~ **STRUCK (D3)** — superseded by doc 07 §4.5's `<name>.shapes.json` asset (P9 commit 102); never let a `THREE.Shape` reach a job.

## 6. Edge cases, testing, acceptance criteria

### Edge cases

1. **A region can clip to nothing.** `generateInlay` pushes a part only when `solid.numTri() > 0` (`inlayPipeline.ts:114`), so a region that moves outside the outline simply stops existing. A stored `InlayRegionRef` must be revalidated against `InlayGroup` on every result, and drop silently — never throw, never leave a selection outline floating.
2. **`shapeIdx` is per-item, not per-tile.** Every tile of a tiled item shares one `item.shapes`, and the placeholder/worker loops iterate `positions × shapes` (`ImperativeModel.tsx:601-606`; `inlayPipeline.ts:91-92`). **A region edit applies to that shape in *every* tile.** The UI must say so; silently applying it per-tile would be a lie.
3. **During a drag the selected item is unclipped.** The preview item is excluded from the job (`ImperativeModel.tsx:696`) and merged into the render list wholesale (`:579-581`), so its regions are main-thread placeholders. A pick during a drag hits a *different* mesh than a pick after release. Suppress region selection while `isDragging` (the flag already exists — `ModelViewer.tsx:499` → `ImperativeModel` dep array `:742`).
4. **Mirror.** `item.mirror` negates X and reverses winding in both paths (`ImperativeModel.tsx:624-637`; `inlayPipeline.ts:94`). `worldToItemLocal` must apply the negation, or every pick on a mirrored layer lands on the wrong side.
5. **Transparent shapes.** After T2 they remain in the array and are skipped at render (`ImperativeModel.tsx:612`) and in the worker (`inlayPipeline.ts:93`). A transparent region is un-pickable in 3D by construction; that is correct, and recolouring it must go through the layer list, not the viewport.
6. **`positionPreset`.** Scale and rotate recompute `x`/`y` from `calculateInlayOffset` when the preset is not `'manual'` (`InlayInteractionHandles.tsx:218-233`, `:249-264`). ~~An `editedShapes` write changes the shape bounds, so it changes the preset offset. Recompute or pin — do not leave it stale.~~ **STRUCK (D3)** — superseded by doc 07 §4.5's `<name>.shapes.json` asset (P9 commit 102).
7. **Ring hygiene.** After `deserializeShape` (`serialize.ts:61-67`) do not append a duplicate first point; keep every ring ≥ 3 vertices or it is silently dropped at `manifoldOps.ts:86` with no error and no `empty` signal any consumer reads (root §5.2 rule 5, "failure is silent").
8. **Version discriminator.** ~~`ProjectSchemaV1` is non-strict, so an old bundle simply lacks `editedShapes` and gets `null` from the default — the desired behaviour, and the reason **not** to bump the version literal.~~ **STRUCK (D3)** — superseded by doc 07 §4.5's `<name>.shapes.json` asset (P9 commit 102). The existing `versionMismatch` branch is unreachable dead code (`projectUtils.ts:179-188` vs. `Controls.tsx:241-249`); do not touch it here. Doc 04 owns V2.

### Testing (Vitest — `pnpm test`)

Everything new lands in `src/utils/inlay/**`, inside the coverage allowlist (`vite.config.ts:30-35`). Component behaviour is tested through extracted pure functions, because `src/components/**` reports zero coverage silently and `SVGPaintModal.tsx` is not mountable cheaply.

| File | Asserts |
|---|---|
| `src/utils/inlay/regionRef.test.ts` | `parseInlayMeshName(formatInlayMeshName(r))` deep-equals `r` for ids containing digits and hyphens; returns `null` for `'Pattern'`, `'Pattern_Masked_0_#ff0000'`, `'InlayGroup'`, `''` |
| `src/utils/inlay/shapeEdit.test.ts` | `translateShape` on a shape with 2 holes yields a shape with 2 holes, each translated by exactly `(dx,dy)`; ring lengths unchanged; no duplicate terminal vertex appended |
| `src/utils/inlay/hitTest.test.ts` | `pointInShapeWithHoles` is `false` at the centre of an annulus where bare `pointInIndex` is `true`; agrees with `isPointInShape` (`patternUtils.ts:70`) on the outer ring across a grid sweep — the oracle pattern already used at `src/utils/patternUtils.test.ts:62-80` |
| `src/utils/inlay/hitTest.test.ts` | `worldToItemLocal` round-trips: forward-transform a local point by the same order the pipeline bakes (`inlayPipeline.ts:104-109`), invert it, recover the original within 1e-9, for scale ≠ 1, rotation ≠ 0, mirror on and off |
| `src/utils/inlay/jobShapes.test.ts` | `buildInlayJobShapes([{color:'transparent'},{color:'white'}])` returns **two** entries in input order, so a parsed `shapeIdx` indexes `item.shapes`. **A `generateInlay` assertion here would be vacuous:** `generateInlay` already iterates the *unfiltered* `item.shapes` and skips transparent inside the loop body (`inlayPipeline.ts:92-93`), so it emits `Inlay_a_0_1` for that input on **unmodified upstream** — it would pass before and after T2 and detect neither the fix nor its regression. The defect is entirely in the caller (`ImperativeModel.tsx:700`), and `src/components/**` is outside the coverage allowlist (`vite.config.ts:30-35`); extracting the mapping is what makes it assertable |
| `src/utils/projectUtils.test.ts` *(extend)* | An item with `editedShapes` survives `exportProjectBundle` → `importProjectBundle`; the exported `project.json` contains **no** `"curves"` key (proof the THREE blob is gone) **STRUCK (D3)** — `editedShapes` persistence is superseded by doc 07 §4.5's `<name>.shapes.json` asset (P9 commit 102). |
| `src/utils/inlay/shapeEdit.test.ts` | `structuredClone(editedShapesArray)` succeeds — the rule-5 guard **STRUCK (D3)** — `editedShapes` persistence is superseded by doc 07 §4.5's `<name>.shapes.json` asset (P9 commit 102). |

### Acceptance criteria

Every one is a command, an assertion, or an observable outcome.

1. `pnpm test` passes, with **no fewer** than the 20 files / 155 tests remaining after P0 deletes `offsetUtils.test.ts` (−1 file, −7 tests from `docs/_source/baseline-verification.md`), plus the new files above.
2. `pnpm build` exits 0.
3. `grep -rn 'Inlay_\${' src/ --include='*.ts' --include='*.tsx'` returns **exactly zero** hits. It matches **four** sites on upstream today, and all four must be routed: the two full-name literals (`inlayPipeline.ts:116`, `ImperativeModel.tsx:670`) call `formatInlayMeshName`, and the two prefix constructions (`applyInlayResult.ts:30`, `ImperativeModel.tsx:763`) call `inlayMeshPrefix`. *(The two bare-literal readers `ImperativeModel.tsx:528` and `:962` interpolate nothing, do not match this grep, and are out of scope.)*
4. A new test asserts `buildInlayJobShapes` **(new)** maps `[{ color: 'transparent' }, { color: 'white' }]` to two job shapes at indices 0 and 1, preserving input order; and `grep -n "s.color !== 'transparent'" src/components/ImperativeModel.tsx` returns nothing. **Do not substitute a `generateInlay` assertion** — see the testing table: it already passes on unmodified upstream (`inlayPipeline.ts:92-93`), so it gates nothing.
5. A new test asserts `translateShape(s, 1, 2)` where `s.holes.length === 2` returns a shape with `holes.length === 2` and every hole point offset by exactly `(1, 2)`.
6. A new test asserts `pointInShapeWithHoles` returns `false` for the centre of a 10 mm square with a 6 mm square hole, while `pointInIndex(px, py, buildPolyIndex(shape))` returns `true` for the same point — pinning the difference, not hiding it.
7. **Round trip, observable:** open a layer in the paint modal, drag one shape, save, export the bundle, re-import it. The dragged position is preserved. *(Today it reverts to the source file — `Controls.tsx:226`.)* Backed by a `projectUtils.test.ts` assertion on `editedShapes`. **STRUCK (D3)** — `editedShapes` persistence is superseded by doc 07 §4.5's `<name>.shapes.json` asset (P9 commit 102).
8a. **No jump — uncentred layer.** Precondition: a layer whose shape-set bbox is **not** at the item origin (a traced-image inlay — `traceImage.ts:184-189` centres the frame, not the content). Save it from the paint modal without editing. Every rendered region's world position is unchanged to within 1e-6, and `item.x` / `item.y` change by **exactly the negated recentre delta** — the two go together by construction, since §4.4 defect 3's fix compensates the applied delta into `x`/`y`. Assert it against the extracted `translateShapes` helper plus the offset arithmetic, not against the component. *(Today the layer visibly jumps — `centerShapes` at `InlayControls.tsx:325` translates it and nothing compensates.)*
8b. **No jump — already-centred layer.** Precondition: any SVG, DXF or previously-painted layer (§4.6 table). `centerShapes` early-returns at `patternUtils.ts:955` (`center.lengthSq() < 0.001 && !flipY`), so `item.x`, `item.y` and every region position are bit-identical. This half already holds on unmodified upstream; it is a regression guard, not a fix.
9. Clicking a region in the viewport with the Inlay tab active selects it — a visible outline appears on that region only. Orbiting the camera with a left-drag over the same region selects **nothing**.
10. Deleting a selected region removes **every** mesh whose parsed `shapeIdx` matches, across all tiles: `InlayGroup.children.length` decreases by exactly the tile count for that item (1 for `mode:'single'`), and no mesh belonging to another `shapeIdx` is removed. A shape index fans out across tiles — edge case 2.
11. `git diff --stat` shows **no changes** to `src/utils/geometry/patternPipeline.ts`, `src/utils/geometry/manifoldOps.ts`, `src/workers/geometryWorker.ts`, `src/utils/geometry/patternClient.ts`, `src/utils/patternUtils.ts` or `vite.config.ts`.
12. `grep -rn 'getManifold' src/` shows no new main-thread call site (root §8 M4b's rule, applied here too).
13. An exported `project.json` for a project with one edited inlay contains no `"curves"` key and no `"type":"Shape"` — the stringified THREE blob is gone.
14. Importing a **v1 bundle produced before this change** still loads: items rehydrate from their assets exactly as today, and `editedShapes` reads `null`. **STRUCK (D3)** — `editedShapes` persistence is superseded by doc 07 §4.5's `<name>.shapes.json` asset (P9 commit 102).

## 7. Task order

The recon is done (root §9). Each task is one commit, in dependency order. T1–T4 are independently shippable and fix live data loss; stop there and the doc has already paid for itself.

| # | Task | Files | Depends on |
|---|---|---|---|
| **T1** | Create `src/utils/inlay/regionRef.ts` — `InlayRegionRef`, `formatInlayMeshName`, `inlayMeshPrefix`, `parseInlayMeshName` **(all new)**. Route all four interpolated sites: the two full names (`inlayPipeline.ts:116`, `ImperativeModel.tsx:670`) and the two prefixes (`applyInlayResult.ts:30`, `ImperativeModel.tsx:763`). No behaviour change. | new; `inlayPipeline.ts:116`; `ImperativeModel.tsx:670`, `:763`; `applyInlayResult.ts:30` | — |
| **T2** | Align region indices: extract `ImperativeModel.tsx:698-700` into `src/utils/inlay/jobShapes.ts` as `buildInlayJobShapes` **(new)**, **without** the `.filter((s) => s.color !== 'transparent')`. Add `jobShapes.test.ts`. Independent of T1 — the two edits share no symbol. | `ImperativeModel.tsx:698-700`; new `src/utils/inlay/jobShapes.ts` + test | — |
| **T3** | Create `src/utils/inlay/shapeEdit.ts` — `translateShape`, `translateShapes` **(new)**, hole-carrying, one named sampling constant. Rewire paint-modal move (`:459-472`) and duplicate (`:252-270`). **Closes root §8 M5's holes criterion.** | new; `SVGPaintModal.tsx` | — |
| **T4** | Stop the save-time layer jump: compute the recentre delta in `InlayControls.tsx:322-331`, apply it through `translateShapes`, and compensate it into `item.x`/`item.y`. Leave `centerShapes` (`patternUtils.ts:939`) untouched. | `InlayControls.tsx:322-331` | T3 |
| **T5** | **STRUCK (D3).** ~~Add `SerializedShapeSchema`, `EditedInlayShapeSchema`, `InlayItemSchema.editedShapes` **(all new)**, each with `.default()`. Extend `schemaDefaults.test.ts`.~~ Replaced by doc 07 §4.5. | `schemas.ts:19-46` | — |
| **T6** | **STRUCK (D3).** ~~Export: strip live `shapes`, keep `editedShapes`.~~ Replaced by doc 07 §4.5. | `projectUtils.ts:48-50` | T5 |
| **T7** | **STRUCK (D3).** ~~Import: apply §4.3's precedence rule; relax the missing-asset warning.~~ Replaced by doc 07 §4.5. | `Controls.tsx:206-231`, `:132-141` | T5, T6 |
| **T8** | **STRUCK (D3).** ~~Write `editedShapes` on paint-modal save; clear it when a new file replaces the layer. Round-trip test.~~ Replaced by doc 07 §4.5. | `InlayControls.tsx:322-331`, `:118-156` | T4, T7 |
| **T9** | Create `src/utils/inlay/hitTest.ts` — `worldToItemLocal`, `pointInShapeWithHoles` **(new)**, built on `buildPolyIndex`/`pointInIndex` (`patternUtils.ts:114`, `:181`). Pure, fully unit-tested, no component involved. **Not** on T10's path: the 3D pick is a mesh raycast and there is no 2D drag fallback (§4.5). | new | — |
| **T10** | Create `src/components/interaction/InlayRegionPicker.tsx` **(new)**: resolve the group with `useThree(({ scene }) => scene).getObjectByName('InlayGroup')` per pick (never cached — §4.5), raycast its `children`, decode with `parseInlayMeshName`, click-vs-orbit travel guard, suppressed while `isDragging`. Mount at `ModelViewer.tsx:503-515`. Selection outline only — no mutation yet. | new; `ModelViewer.tsx:503-515` | T1, T2 |
| **T11** | Region actions — recolour and delete — registering doc 07 §4.5's `.shapes.json` asset, with the tile-fan-out disclosure of edge case 2. Uses `worldToItemLocal` / `pointInShapeWithHoles` for the *where in the shape* half. | `InlayRegionPicker.tsx`; `InlayControls.tsx` | doc 07 task 15, T9, T10 |
| **T12** | Selection revalidation after every `InlayResult`; drop a stale ref silently. Opportunistically offset the gizmo pick plane by `bounds.center` (§4.6). | `InlayRegionPicker.tsx`; `InlayInteractionHandles.tsx:450-461`, `:473-480` | T11 |
| **T13** | *Optional.* Replace the paint modal's bbox drag/marquee tests (`SVGPaintModal.tsx:366-367`, `:484`) with `pointInShapeWithHoles`. | `SVGPaintModal.tsx` | T9 |

**05b: no tasks.** Do not open a branch for it. See §4.7.

## What already exists — do not rebuild it

| Capability | Where it already is | Status for 05a |
|---|---|---|
| Per-region mesh naming `Inlay_<id>_<tile>_<shape>` | `src/utils/geometry/inlayPipeline.ts:116`; `src/components/ImperativeModel.tsx:670` | **Ships.** Extract the formatter (T1); do not invent a scheme. |
| By-name / by-prefix region re-addressing | `src/utils/geometry/applyInlayResult.ts:30-31`; `src/components/ImperativeModel.tsx:528` (orphan cleanup), `:763` (drag), `:962` (material effect) | **Ships**, four sites — two interpolate the item id, two use the bare `'Inlay_'` literal. |
| Live drag preview without React re-render — per-mesh delta matrix over an event bus | `src/components/interaction/InlayInteractionHandles.tsx:274` (emit) → `src/components/ImperativeModel.tsx:746-801` (consume, matrix at `:770-794`); bus at `src/utils/eventBus.ts:1-25` | **Ships.** The precedent for any live region edit. Note it is a second state channel that bypasses React during a drag. |
| Placeholder-then-refine: instant unclipped inline mesh, worker-clipped swap on return | `src/components/ImperativeModel.tsx:639`, `:683-733`; `applyInlayResult.ts:23-60` | **Ships.** |
| Move / scale / rotate gizmo with constant-pixel handles and custom cursors | `src/components/interaction/InlayInteractionHandles.tsx:24-95`, `:97-533` | **Ships.** Region editing mounts beside it, not instead of it. |
| Screen → world hit point (both native and R3F events), against a Z-plane | `src/components/interaction/InlayInteractionHandles.tsx:159-176` | **Ships.** Reuse; a plane raycast is *not* a geometry raycast (§4.5). |
| Screen → SVG-user-space converter | `src/components/SVGPaintModal.tsx:281-292` | **Ships** (2D modal only). |
| Point-in-polygon: scalar oracle + Y-bucketed indexed form + clearance query | `src/utils/patternUtils.ts:70` (`isPointInShape`, **zero production callers**), `:114` (`buildPolyIndex`), `:181` (`pointInIndex`), `:208` (`isClearOfIndex`); equivalence tests `src/utils/patternUtils.test.ts:62-97` | **Ships, outer ring only.** Wrap for holes (§4.5); do not rewrite. |
| Bounding-box helpers | `src/utils/patternUtils.ts:12-30` (`getShapesBounds`), `:32-64` (`getGeometryBounds`) | **Ships.** `center` is returned and currently discarded by the gizmo (§4.6). |
| A 2D shape editor with select, marquee, drag-move, duplicate, delete, recolour, eyedropper, 50-entry undo/redo, pan/zoom | `src/components/SVGPaintModal.tsx` — history `:144-145`, `:155-182`; selection `:129`, `:295-338`; marquee `:474-490`; duplicate `:252-270`; move commit `:450-473` | **Ships.** 05a **fixes** it (§4.4); it does not rebuild it. |
| Drag-reorderable layer list, per-item select/delete | `src/components/controls/InlayControls.tsx:166-197`, `:199-268`, `:219` | **Ships**, and reorder is load-bearing — item index drives depth bias (`src/utils/geometry/inlayLayering.ts:41-43`) **and**, separately, mask precedence in the pattern pipeline's suffix-union loop (`src/utils/geometry/patternPipeline.ts:318-324`); root §2, §8 M5. |
| Coplanar decal layering (draw order + depth bias) so an edited region does not z-fight | `src/utils/geometry/inlayLayering.ts`; applied at `applyInlayResult.ts:53` and `ImperativeModel.tsx:674` | **Ships.** |
| Material-only fast path — recolour / opacity / wireframe with no geometry rebuild | `src/components/ImperativeModel.tsx:905-975`, inlay traverse at `:961-975`; `userData.baseColored` set at `applyInlayResult.ts:56` and `ImperativeModel.tsx:672` | **Ships.** A region **recolour** should ride this, not trigger a worker job. |
| Shape ↔ wire conversion, hole-aware, worker-proven | `src/utils/geometry/serialize.ts:34-45`, `:61-67` | **Ships.** The persistence format in §4.3 is its zod mirror. |
| Project bundle write/read with per-inlay assets keyed by item id | `src/utils/projectUtils.ts:29-87`, `:105-199` | **Ships**, and is **wrong** for edits (§4.3). |
| Anything at all for **pattern** region or node editing | — | **NOTHING EXISTS.** Not a name, not a polygon, not a handle. §4.7. |

## 8. Open questions

Genuine unknowns only. Each names what would settle it.

1. **Does an edited region need its own colour, or does it inherit the layer's?**
   Today colour is per-shape inside `item.shapes` (`{ shape, color }` — `src/utils/shapeLoader.ts:53`), with `'base'` as a live-tracking sentinel resolved at `applyInlayResult.ts:56` / `ImperativeModel.tsx:672`, and there is **no per-shape colour UI anywhere** in the inlay panel — only the paint modal's own swatches. Making recolour a viewport action introduces a second place to set the same value.
   *Settles it:* @liamstar's product call on whether the viewport is an editor or a preview. If it is a preview, drop the recolour half of T11 and keep delete only.

2. **Should edited geometry supersede the source asset, or diff against it? — Resolved: supersede (D3, @liamstar, 2026-09-04).**
   `ProjectAssets.inlays` has one asset slot per id. Registering doc 07 §4.5's `.shapes.json` asset replaces the original SVG/DXF/STL; the original file is intentionally not retained across a round trip. A pristine source must be re-uploaded. "Revert to source" would require widening that asset model and is out of scope.

3. **Is a per-region edit meaningful in tile mode at all?**
   Every tile shares one `item.shapes` (edge case 2), so "delete this region" deletes it from all tiles. The alternative — per-tile overrides — means `editedShapes` becomes `Map<tileIdx, ...>`, and tile indices are **not stable**: they are positional output of `generateTilePositions`, which is unseeded today (`src/utils/patternUtils.ts:464`, `:504-505`) and re-derived on every job (`ImperativeModel.tsx:596`, `:697`).
   *Settles it:* M2. If seeding lands, tile indices become reproducible for a fixed seed and per-tile overrides become expressible; until then, per-tile editing is unimplementable and T11 must say "applies to all tiles" in the UI.

4. **How much resolution should an edit be allowed to destroy?**
   `translateShape` must pick a sampling; the modal currently mixes 32 (`SVGPaintModal.tsx:258`, `:462`, `:532`) and 16 (`:539`), and `centerShapes` re-derives at 12 (`patternUtils.ts:961`, `:979`). Root §7 requires an explicit flattening tolerance and says it must land **at import as well as at export** — but assigns it to doc 06.
   *Settles it:* doc 06's tolerance decision. Until it exists, T3 hardcodes one named constant in `shapeEdit.ts` and 06 replaces it with the shared value; do not invent a second tolerance.

5. **Does R3F's pointer event ordering give a usable click-vs-orbit discriminator, or is a manual travel guard required?**
   `OrbitControls` binds `LEFT: THREE.MOUSE.ROTATE` (`ModelViewer.tsx:450-454`) and `makeDefault` is set (`:445`). Whether an R3F `onClick` on a mesh already suppresses after an orbit drag cannot be determined by reading — it depends on the installed `@react-three/fiber` and `@react-three/drei` behaviour under the React Compiler (`vite.config.ts:8-14`), which root §11 also lists as an unread build artefact.
   *Settles it:* build it and try it. If `onClick` fires after an orbit, add the explicit pointer-travel guard modelled on `SVGPaintModal.tsx:474`. Budget T10 for the guard either way.

6. **Which of the three persistence mechanisms ships? — Resolved (D3, @liamstar, 2026-09-04).**
   Doc 07 §4.5's synthetic `<name>.shapes.json` zip asset is adopted. This §4.3 and tasks T5–T8, plus all three keys in doc 04's `ProjectSchemaV2.shapes` block, are STRUCK (D3). Doc 04 owns the single `SerializedShapeSchema` declaration; docs 05 and 07 import it. Doc 07 owns both the inlay and pattern lanes, including edits that supersede an existing source. §4.4's lossy-edit fixes remain required.
