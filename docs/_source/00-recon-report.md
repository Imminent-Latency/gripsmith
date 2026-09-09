# GripSmith Recon Report — grippysheet-studio @ master

**Status:** evidence base. Not a design doc.
**Audited:** `docs/00-architecture.md` (163 lines) against `src/` (12,208 non-test lines, 21 test files / 2,613 lines).
**Method:** 13 independent dimensions — geometry-contract, pipeline-seam, outline-path, existing-generative, state-and-serialization, determinism-seeding, export-3d, export-flat-gap, text-image-sources, workers-performance, ui-controls, direct-editing, build-test-deploy-license — each read the code first-hand, then each was adversarially re-verified by a second pass that overturned or sharpened claims, then a cross-dimension consistency pass resolved the 12 places where dimensions disagreed with each other. Four targeted follow-up investigations closed gaps the first sweep left.

**Standing caveat.** Every citation is against the tarball snapshot of upstream `master` at commit `cf698036f28f86e4d70c00b24a2283b5ab7d3f49` (`.git/refs/remotes/upstream/master`), checked out on branch `gripsmith` (`.git/HEAD`). Line numbers drift the moment upstream moves. `git` itself is unavailable in the audit environment; the repository state above was read directly from `.git` plumbing files, and its mtimes are recent enough that the baseline may have been created mid-audit — re-check it before relying on merge-base claims.

**Reading order.** §1 is the change list. §2 is the exhaustive verdict table — the thing to grep. §3 is what the code actually does. §4 is the corrected §5 of the doc, ready to paste. §5–§6 are the plan. §7–§8 are what remains open.

---

> **Errata — added 2026-09-04, after the doc set was authored against this report.**
> Three figures below were superseded by re-measurement during the authoring pass. The published
> docs carry the corrected values with their re-measurement cited; this file is left otherwise
> intact because it is the evidence base of record.
>
> | Claim in this report | Corrected value | How |
> |---|---|---|
> | §2: "all 17 shipped outlines declare `$INSUNITS=4`" | **16 of 17.** `gtlowboyflared.dxf` has no `$INSUNITS` header var at all — its only `INSUNITS` string is an object-dictionary entry (group code 3), not the header variable. It declares `$MEASUREMENT = 0`, so it takes the Imperial fallback at `src/utils/dxfUtils.ts:73-78` and is scaled by 25.4. It is the **only** outline whose units come from the fallback path rather than `$INSUNITS`. | read the header block of all 17 files |
> | §5: "27 `<ControlField>` call sites" | **28** (Base 4, Geometry 12, Inlay 11, ShapeUploader 1) | `grep -rn '<ControlField' src/` → 29 hits; the 29th is `ControlField.tsx:14`, a false positive from the generic `React.FC<ControlFieldProps>` |
> | `baseline-verification.md`: "19 pre-existing `tsc` errors" | **18** (12×TS6133, 1×TS6192, 4×TS2304, 1×TS2322) | re-ran `npx tsc -p tsconfig.app.json --noEmit`; baseline file has been corrected |
>
> One citation slip is also known: the "JSON shapes are garbage" comment is at
> `src/components/Controls.tsx:222`, not `:224`.

## 1. Executive summary

The 12 findings that change the plan, ranked by consequence.

1. **`clipper-lib` is dead code, and the doc names it as the join point four times.** It is imported at exactly one site, `src/utils/offsetUtils.ts:2`; that module's two exports `offsetShape` (`src/utils/offsetUtils.ts:7`) and `unionShapes` (`:155`) are imported only by their own test (`src/utils/offsetUtils.test.ts:3`). The live 2D clip/offset engine is manifold-3d's `CrossSection` — Clipper2 compiled into the wasm (`node_modules/manifold-3d/manifold-encapsulated-types.d.ts:96-98`), reached through `ManifoldOps.csFromShapes` (`src/utils/geometry/manifoldOps.ts:91-98`) with the codebase's only polygon offset at `:151`.

2. **The pipeline order in §4.2 is inverted: extrusion happens first, clipping second, and both are 3D booleans behind a Web Worker boundary.** `Manifold.extrude(cs, 1)` at `src/utils/geometry/patternPipeline.ts:139`, `Manifold.compose(instances)` at `:236`, then `result.intersect(cutter)` at `:269` and `result.subtract(holeM)` at `:286`. Nothing forks in 2D anywhere, so §4.2's flat-export branch has no origin.

3. **The pattern slot holds a 3D mesh, not polygons, in every path the shipping UI can reach.** The pattern uploader is gated to `allowedTypes={["stl"]}` (`src/components/controls/GeometryControls.tsx:163`) and all 14 pattern presets are `.stl` (`src/components/PatternLibraryModal.tsx:19-32`), so `buildJob` always takes the `kind:'geometry'` branch at `src/components/ImperativeModel.tsx:829-830`. The `kind:'shapes'` branch (`src/utils/geometry/patternPipeline.ts:47-49`, `:138-139`) is implemented and test-covered but has no UI path — a generator will be its first production caller.

4. **Feature 01 already ships.** 17 outline presets (`src/components/PatternLibraryModal.tsx:49-65`) with matching `.dxf` files in `public/outlines/`, opened from a BookOpen adornment (`src/components/controls/BaseControls.tsx:55-68`) and loaded through the same handler as an upload (`:31-38`). §2 problem 1, §6 item 1 "(Drafted.)", §8 M1 and §11 Q3 are all scoped against solved problems.

5. **Randomness is unseeded today, in already-persisted settings.** Bare `Math.random()` at exactly three sites, all in `generateTilePositions`: `src/utils/patternUtils.ts:464`, `:504`, `:505`. `tilingDistribution`/`tilingOrientation` both admit `'random'` and are persisted (`src/types/schemas.ts:79`, `:81`, `:41`), so a saved bundle already re-renders differently on every load. §5 rule 4 is a change to shipped behaviour, not a property to preserve.

6. **"Centered on outline centroid" is wrong, and the origin is not reproducible.** Nothing computes a centroid — a repo-wide grep returns one hit, the incorrect comment at `src/components/ImperativeModel.tsx:478`. All four centering implementations use a bounding-box midpoint, and the DXF one measures only segment start/end points, so a `CIRCLE` contributes one point twice (`src/utils/dxfUtils.ts:169-170`, box at `:203-211`, subtracted at `:379-382`). §7's "match the upload path exactly" is unfollowable as written.

7. **`DesignState` has no home, and the persisted geometry that does exist is known-broken.** `ProjectSchemaV1` (`src/types/schemas.ts:87-96`) is three fixed slots, not a uniform `sources` array. Export nulls `cutoutShapes` (`src/utils/projectUtils.ts:46`) and `patternShapes` (`:53`) but passes `inlay` through untouched (`:48-50`), so live `THREE.Shape` objects are stringified — the import path calls them "garbage" (`src/components/Controls.tsx:224`) and re-parses the zip asset instead. `outlineRef` is unimplementable because `PatternPreset` has no `id` (`src/components/PatternLibraryModal.tsx:8-15`).

8. **`src/types.ts` — named in §4.1, §5 and §9 — is dead code from an ESP32 firmware flasher.** 39 lines declaring `FirmwareVariant`, `DeviceInfoData`, `FlashProgress`, `ReleaseType`, `FirmwareVersion`, `FirmwareFiles` (`src/types.ts:1-39`), imported by nothing. It is *populated* with plausible TypeScript, which is what makes it expensive: a reader opens it, finds no geometry types among real code, and invents the parallel representation §5 forbids. The real home is `src/types/schemas.ts` and `src/utils/geometry/serialize.ts:14-25`.

9. **Outline flat export needs no core change and is one prop away.** The base solid is extruded straight from raw `baseSettings.cutoutShapes` with holes attached (`src/components/ImperativeModel.tsx:449-451`), mirror/rotation applied as a mesh transform rather than baked geometry (`:472-474`), and `OutputPanel` is constructed in the same component that owns that state (`src/App.tsx:15`, `:107-113`) — `Controls` only forwards an opaque `ReactNode` (`src/components/Controls.tsx:29`, `:302-306`). Pattern-footprint export is the expensive half and requires editing the worker result contract §10 forbids touching.

10. **Vertex-normal computation is the pipeline's dominant cost and the doc does not mention it.** `computeSharpNormals` (`src/utils/geometry/normals.ts:26`) runs on every emitted mesh via `serializeMesh` (`src/utils/geometry/manifoldOps.ts:217`), including once over the whole composed solid (`src/utils/geometry/patternPipeline.ts:361`). Its own docblock records that the alternative it replaced took ~5800 ms for 48k sharp triangles versus ~10 ms for 128k smooth ones (`src/utils/geometry/normals.ts:12-16`). Nothing caches it; `SHARP_ANGLE = 60` is hardcoded with one call site (`src/utils/geometry/manifoldOps.ts:22`).

11. **A non-cloneable value in a job permanently wedges all geometry generation.** `pump()` assigns `this.inFlight = next` before `postMessage` with no try/catch (`src/utils/geometry/patternClient.ts:66-67`) and the pending slot was nulled on the line above (`:61`), so a `DataCloneError` throws out of the effect and every later submission returns at the `if (this.inFlight) return` guard. No timeout, no `terminate()`. The spinner sticks on (`src/components/ImperativeModel.tsx:811`, cleared only at `:880`/`:890`).

12. **Export is an ungated scrape of live mutable scene objects, so transient UI state lands in the file.** `OutputPanel` contains no readiness token; masked pattern parts are flattened to the plain pattern colour while dragging *and* on every pattern-effect re-run (`src/utils/geometry/applyPatternResult.ts:99-107`, `src/components/ImperativeModel.tsx:813-821`, `:937`), and `mergeByColor` keys on `material.color.getHexString()` (`src/components/OutputPanel.tsx:153`). A 3MF exported in that window emits a *different number* of filament slots. Inlays exported before the worker returns are unclipped placeholders (`src/components/ImperativeModel.tsx:639`).

---

## 2. Verdict on every doc claim

Deduplicated by doc claim (many claims were examined by several dimensions independently; where those dimensions disagreed the row carries the resolution). Sorted BLOCKING → HIGH → MEDIUM → LOW.

### BLOCKING

| Doc ref | Claim | Verdict | Correction | Evidence |
|---|---|---|---|---|
| §4.1 | "`clipper-lib` — 2D polygon clip + offset. **The universal join point for all shape sources.**" | CONTRADICTED | Dead dependency. The 2D engine is manifold-3d `CrossSection` (Clipper2 in wasm). Both halves of the bullet are false. Also absent from the shipped build: `ClipperOffset`/`ClipperLib` return 0 hits in both `dist/assets/index-D_t2sfAg.js` and `dist/assets/geometryWorker-DRM0ndV9.js`. | `package.json:22`; `src/utils/offsetUtils.ts:2`, `:7`, `:155`; `src/utils/offsetUtils.test.ts:3`; `src/types/clipper-lib.d.ts:1`; `node_modules/manifold-3d/manifold-encapsulated-types.d.ts:96-98`; `src/utils/geometry/manifoldOps.ts:91-98`, `:151` |
| §4.2 | Pipeline diagram `Outline → Shape Source(s) → clipper-lib (clip+offset) → manifold-3d → 3D preview → STL/3MF` | CONTRADICTED | Wrong in three independent ways: no clipper stage; order inverted (extrude → compose → clip); no worker boundary shown, which is the single most important structural fact for a new source. See §3's diagram. | `src/utils/geometry/patternPipeline.ts:139`, `:236`, `:269`, `:286`; `src/components/ImperativeModel.tsx:836`, `:850-856`; `src/utils/geometry/patternClient.ts:97-101`, `:67`; `src/workers/geometryWorker.ts:36-38` |
| §5 rule 2 | "Feed the existing `clipper-lib` stage — never re-implement clipping/extrusion." | CONTRADICTED | Intent correct, target does not exist. Real instruction: emit `SerializedShape[]` into `PatternJob`/`InlayJob` and let `generatePattern`/`generateInlay` do the booleans. Note the clip is itself conditional on the `clipToOutline` toggle. | `src/utils/geometry/patternPipeline.ts:263`, `:269`, `:286`, `:218`; `src/utils/geometry/manifoldOps.ts:128-161`; `src/utils/geometry/inlayPipeline.ts:111-112`; `src/types/schemas.ts:78` |
| §5 contract 1 | "`Polygon` / path type — the exact ring/path structure `clipper-lib` is fed today. All geometry in the app is expressed in this type, in **millimeters**, rings closed." | CONTRADICTED | Every clause false. Six live representations (§3.1). mm holds only for DXF. Closure is implicit, inconsistent by source, and never required. The dead clipper form is `{X,Y}` integers at SCALE=1000 — micrometres, not mm. | `src/utils/geometry/serialize.ts:14-25`; `src/utils/geometry/manifoldOps.ts:74-88`; `src/utils/shapeLoader.ts:31-36`, `:43`; `src/utils/dxfUtils.ts:59-81`, `:384`, `:387-388`; `src/utils/offsetUtils.ts:5`, `:11-35`; `src/types/schemas.ts:7-8`, `:22`, `:67` |
| §5 contract 5 | `DesignState { outlineRef; sources: Array<{type,params,seed}> }`, "the unit of save/share/undo … validated with zod; serializable to URL/JSON" | CONTRADICTED | No such identifier exists. Real type is `ProjectSchemaV1`→`ProjectData`: three fixed differently-shaped slots, a JSZip bundle, no URL path, no undo, and JSON geometry the authors themselves call garbage. `outlineRef` blocked on a missing preset `id`. | `src/types/schemas.ts:87-96`; `src/utils/projectUtils.ts:46`, `:48-50`, `:53`; `src/components/Controls.tsx:224`; `src/components/PatternLibraryModal.tsx:8-15`; `src/components/SVGPaintModal.tsx:155-182`, `:186-188`; `src/App.tsx:15`, `:18`, `:21` |
| §5 rule 4 | "Randomness is always seeded; same `DesignState` → identical output." | CONTRADICTED | No seed and no PRNG anywhere. Three `Math.random()` sites behind two persisted enum values. A seed must reach two placement sites, one crossing the worker boundary. Even seeded, a design does not reproduce from its serialized form without the binary assets. | `src/utils/patternUtils.ts:464`, `:504-505`; `src/types/schemas.ts:41`, `:79`, `:81`; `src/utils/geometry/patternPipeline.ts:51-82`, `:184`; `src/components/ImperativeModel.tsx:254`, `:262`; `src/utils/geometry/inlayPipeline.ts:30` |
| §5 contract 3 | `ShapeSource { id; produce(ctx:{outline;seed}): Polygon[] }` | CONTRADICTED | No producer abstraction. Real signature is async, returns a three-member union, takes no seed and no outline (outline-fit is a separate commit step). Real seams are a structured-clone job struct and a pre-resolved coordinate list. | `src/utils/shapeLoader.ts:6-10`, `:12`, `:31-36`; `src/utils/image/traceImage.ts:179`; `src/components/SVGPaintModal.tsx:76`, `:692-695`; `src/components/controls/InlayControls.tsx:127`; `src/utils/geometry/patternPipeline.ts:51-82`; `src/utils/geometry/inlayPipeline.ts:20-31`, `:91` |
| §5 rule 3 | "Anything a user can tune must live in `DesignState` and validate with `zod`." | CONTRADICTED | Silently demands a `ModelViewer` refactor: 19 `useState` between `:56` and `:90` are user-tunable and in no schema, plus `projectAssets`, `fileName`, `libraryPatternName` and five App-level flags. zod executes at exactly two runtime points. Needs an explicit design-vs-view boundary. | `src/components/ModelViewer.tsx:56-90`; `src/components/Controls.tsx:81`; `src/components/controls/BaseControls.tsx:27`; `src/components/controls/GeometryControls.tsx:56-58`; `src/App.tsx:24-36`; `src/utils/schemaDefaults.ts:6-12`; `src/utils/projectUtils.ts:183` |
| §5 preamble | "find the real equivalents in `src/types.ts` / `src/context` / `src/utils`" | CONTRADICTED | `src/types.ts` is ESP32 firmware-flasher leftovers with zero importers; `src/context/` holds only `AlertContext`. Real homes: `src/types/schemas.ts`, `src/utils/geometry/serialize.ts`. Design state is three prop-drilled `useState`. | `src/types.ts:1-39`; `src/context/AlertContext.tsx:20`; `src/App.tsx:15`, `:18`, `:21`; `src/components/Controls.tsx:64`; `src/components/controls/BaseControls.tsx:31-38` |
| §9 item 1 | "[ ] The concrete `Polygon`/path type fed to `clipper-lib`." | CONTRADICTED | Points at a stage that does not exist; following it yields nothing. Replace with the three real types plus the BufferGeometry case. | `src/utils/geometry/serialize.ts:15-18`; `src/utils/geometry/manifoldOps.ts:74-88`; `src/types/schemas.ts:7`, `:22`; `src/utils/shapeLoader.ts:31-36` |
| §2 item 1 | "No easy way to choose a pad — every session starts with a DXF upload." | CONTRADICTED | Outline Library ships: 17 presets, 17 matching DXFs, live thumbnails, same state field as upload. Grain of truth: no *default* pad — a fresh session starts on a 300 mm square and selection takes a deliberate click. | `src/components/controls/BaseControls.tsx:55-68`, `:72-79`; `src/components/PatternLibraryModal.tsx:49-65`, `:87-88`; `src/components/ImperativeModel.tsx:161-174`, `:450-459` |
| §2 item 2 | "No generative pattern source — shapes come only from traced images, text, or manual work." | CONTRADICTED | Placement is a shipping parametric engine (8 distributions × 4 orientations); *synthesis* is the gap. The enumerated sources are wrong: the pattern unit is always a file (14 STL presets or an STL upload); traced images and text are inlay-only. | `src/utils/patternUtils.ts:285-299`, `:463-475`, `:481-791`; `src/types/schemas.ts:79-81`; `src/components/controls/GeometryControls.tsx:163`; `src/components/PatternLibraryModal.tsx:19-32`; `src/components/controls/InlayControls.tsx:317`, `:334` |
| §7 | "centered on outline centroid (match the upload path exactly — verify in recon)" | CONTRADICTED | Bounding-box midpoint, four implementations, five call sites, zero centroids. DXF path never calls `centerShapes` and its box excludes arc/circle bulges, so the origin is not re-derivable downstream. | `src/components/ImperativeModel.tsx:478`; `src/utils/dxfUtils.ts:169-170`, `:203-211`, `:379-382`; `src/utils/patternUtils.ts:942-952`; `src/utils/geometry/patternPipeline.ts:143-149`; `src/utils/shapeLoader.ts:34-35`, `:62`, `:65`, `:71`; `src/components/controls/GeometryControls.tsx:189`; `src/components/controls/InlayControls.tsx:325` |
| §4.2 | "└─► [NEW] flat SVG ─► SVG→DXF ─► cutter" branching off the clip stage | CONTRADICTED | No 2D tee point exists in any of the three geometry paths. Every `CrossSection` is tracked and freed in `finally { ops.flush() }`; `PatternResult` carries only mesh buffers. The *inputs* are reachable on the main thread, which is the trap: a main-thread re-derivation is easy to write and will silently disagree with the preview until seeding lands. | `src/utils/geometry/patternPipeline.ts:84-89`, `:92-100`, `:138-139`, `:369-371`; `src/utils/geometry/manifoldOps.ts:62-65`, `:149-159`; `src/utils/geometry/inlayPipeline.ts:94-98`; `src/components/ImperativeModel.tsx:450-451` |
| §6 item 6 | "2D branch: `Polygon[]` → SVG → SVG→DXF" | CONTRADICTED | The arrow's *origin* does not exist — the post-clip `Polygon[]` is never materialised. Three real 2D forms exist and doc 06 must name them. Do not round-trip SVG→DXF; emit both from one contour list. `dxf-parser` is read-only (no writer in `dist/`). | `src/utils/geometry/patternPipeline.ts:138-139`; `src/types/schemas.ts:7`, `:14`; `src/utils/geometry/serialize.ts:15-18`; `node_modules/manifold-3d/manifold-global-types.d.ts:80-81`; `node_modules/dxf-parser/package.json:5` |
| §6 item 5 | "post-generation node/region edits reusing `clipper-lib` utils" | CONTRADICTED | No clipper utils to reuse; the only 2D kernel is `ManifoldOps`, worker-only. Also: the pattern has no polygon representation at all in the default path, and node editing is 100% greenfield (gizmo vocabulary is move/scale/rotate). | `src/utils/offsetUtils.ts:7`, `:155`; `src/utils/geometry/manifoldOps.ts:85-112`, `:128-161`; `src/utils/geometry/manifoldModule.ts:15`, `:17-27`; `src/workers/geometryWorker.ts:14`; `src/components/interaction/InlayInteractionHandles.tsx:138-145`; `src/types/schemas.ts:19-46` |
| §7 | "mm everywhere" | PARTLY_TRUE | Intended unit, enforced only by DXF. SVG applies no unit scale (`SVGLoader` defaults px/90 and never reads `viewBox`; `100mm` → 354.33 units). STL raw. Image trace hardcoded 50 mm. Narrowing: the base outline is DXF-only and all 17 shipped outlines declare `$INSUNITS=4`, so the cut-critical geometry *is* mm. | `src/utils/dxfUtils.ts:59-81`; `src/utils/shapeLoader.ts:31-36`, `:43`; `node_modules/three-stdlib/loaders/SVGLoader.js:7-8`, `:779-847`; `src/utils/image/traceImage.ts:180-189`; `src/components/ImageConversionModal.tsx:98`; `src/components/controls/BaseControls.tsx:53` |
| §5 preamble | "Never introduce a parallel geometry representation." | PARTLY_TRUE | Already six. Workable instruction is "convert at the existing seam", not "never introduce". The `{shape,color}` wrapper is precisely why `InlayItemSchema.shapes` degraded to `z.array(z.any())`. | `src/types/schemas.ts:7`, `:22`, `:67`; `src/utils/shapeLoader.ts:31-36`, `:53`; `src/utils/geometry/serialize.ts:15-25`; `src/utils/geometry/inlayPipeline.ts:15-18`; `src/utils/geometry/manifoldOps.ts:74-82`; `src/utils/offsetUtils.ts:5` |

### HIGH

| Doc ref | Claim | Verdict | Correction | Evidence |
|---|---|---|---|---|
| §5 contract 2 | "`Outline` — the active board boundary … the pad library produces the *same* type. This is the clip boundary and the design bounds." | PARTLY_TRUE | "Same type" already true. But no type named `Outline`; it is split into `filledCutoutShapes`+`holeShapes` before the clip; the clip is gated on a user toggle; and inlay tiling ignores it entirely (`size`-square, `boundaryShapes = null`). | `src/types/schemas.ts:7`, `:14`, `:78`; `src/components/controls/BaseControls.tsx:31-38`, `:47`, `:53`, `:69-92`; `src/components/ImperativeModel.tsx:158-237`, `:247-252`, `:259`, `:850-851`; `src/utils/geometry/patternPipeline.ts:164-171`, `:218`; `src/utils/geometry/inlayPipeline.ts:71`, `:111-112` |
| §5 contract 4 | "`Generator<P>` — a parametric `ShapeSource` … `produce` = `generate(params, seed, outline)`" | CONTRADICTED | No framework, registry or typed-param object; params are a flat destructure of `PatternJob`. In the doc's favour: zod `.default()` is a working defaults mechanism that fits the persistence path unchanged — but `InlayItemSchema`, the per-instance template, has no defaults and would throw under `getDefaults`. | `src/utils/geometry/patternPipeline.ts:106-112`; `src/types/schemas.ts:19-46`, `:51-63`, `:66-85`; `src/utils/schemaDefaults.ts:6-12`; `src/components/controls/InlayControls.tsx:99-111` |
| §9 item 2 | "[ ] The `Outline`/bounds type and the context setter used after a DXF upload." | CONTRADICTED | No React context for the outline. `createContext` appears once in src, for alerts. Real chain: `ShapeUploader.onUpload` → `BaseControls.handleOutlineLoaded` → `updateSettings` **and** `onOutlineLoaded` → `Controls.updateBase` → `setBaseSettings`. Both land on the same functional setter, so the double-write is harmless. | `src/context/AlertContext.tsx:16-18`, `:20`; `src/main.tsx:6-10`; `src/App.tsx:15`, `:96`; `src/components/Controls.tsx:64`, `:84-95`; `src/components/controls/BaseControls.tsx:31-38`; `src/components/ShapeUploader.tsx:109-111`, `:128-141` |
| §5 | design state is "the unit of save/share/undo" | CONTRADICTED | Save/share is real (the .zip). Undo is not: the only history in the app is a 50-entry ref stack inside `SVGPaintModal`, wiped on every open. The single global mutation warns "This action cannot be undone". | `src/components/SVGPaintModal.tsx:102`, `:144-145`, `:155-182`, `:186-188`, `:226-227`; `src/App.tsx:58-63`; `src/components/Controls.tsx:71` |
| §5 `DesignState` | "`outlineRef: { kind; id? }`" — a design records which outline it uses | CONTRADICTED | `BaseSettingsSchema` has only `cutoutShapes`; `PatternPreset` has no `id`; the preset name lives in component-local `fileName` never restored on import, so a re-imported design reads "Custom Drawing". Scoping the corpus missed: `InlayItemSchema.name` **is** persisted and written from filename/preset, so inlay display names do round-trip. | `src/types/schemas.ts:10-17`, `:21`; `src/components/PatternLibraryModal.tsx:8-15`, `:162`; `src/components/controls/BaseControls.tsx:27`, `:79`; `src/components/Controls.tsx:236-238`; `src/components/ShapeUploader.tsx:175`; `src/components/controls/InlayControls.tsx:130`, `:139` |
| §5 `DesignState` | "validated with zod; serializable to URL/JSON" | PARTLY_TRUE | zod is real but every geometry field is an escape hatch asserting only `Array.isArray`. Two of three geometry fields are nulled on export; the third is written and comes back inert — the first `shape.getPoints()` throws. `ProjectSchemaV1` is non-strict so unknown keys are silently stripped, and export is never validated at all. | `src/types/schemas.ts:7-8`, `:14`, `:22`, `:67`, `:87-93`; `src/utils/projectUtils.ts:40-58`, `:46`, `:53`, `:183`; `src/components/Controls.tsx:205-231`, `:224`; `src/utils/geometry/serialize.ts:36`; `src/utils/patternUtils.ts:17` |
| §2 item 3 | "No parametric/reproducible design model — a design can't be re-derived, tweaked by number, or shared." | PARTLY_TRUE | Three-way split. "Tweaked by number": FALSE — schemas are scalar and 17 numeric fields route through `DebouncedInput`. "Shared": MOSTLY FALSE — a working .zip export/import exists with real buttons; what is absent is URL sharing and any cross-reload persistence (only storage key is `welcome_modal_dismissed`). "Re-derived": TRUE. Say "no generative model and no URL/link sharing". | `src/types/schemas.ts:10-85`; `src/components/DebouncedInput.tsx:18`; `src/utils/projectUtils.ts:29-87`, `:105-199`; `src/components/Controls.tsx:177-234`, `:281-298`; `src/App.tsx:30-33` |
| §4.1 | "`zod` — schema validation (use for all persisted design data)" | PARTLY_TRUE | zod 4.2.0 is real and gates import, but validates nothing about geometry. `ProjectSchemaV1` is a plain `z.object` — unknown keys are stripped without warning, which is the central hazard for a V2 forward-compat plan. Export is unvalidated. | `package.json:40`; `src/types/schemas.ts:7-8`, `:22`, `:87-93`; `src/utils/projectUtils.ts:40-58`, `:183-188` |
| §4.1 | "`manifold-3d` — CSG → watertight printable solid" | PARTLY_TRUE | Materially understates it. Manifold owns 100% of the 2D work the doc assigns to clipper: CrossSection construction, 2D union, 2D subtract, primitives, decimation and the only polygon offset — plus all extrusion and all 3D CSG. It is the entire middle, not the tail. | `src/utils/geometry/manifoldOps.ts:87`, `:94`, `:97`, `:111`, `:150-152`; `src/utils/geometry/patternPipeline.ts:246`, `:295`, `:324`, `:340` |
| §7 | "generation + boolean ops off the main thread via `src/workers`" | PARTLY_TRUE | TRUE for every boolean. FALSE as a blanket: the Base plate and inlay placeholders are extruded on the main thread with `THREE.ExtrudeGeometry`, inlay tile placement runs on the main thread (4 call sites), and per-job `serializeShapes` over the full outline is main-thread. Omits the true dominant cost, `computeSharpNormals`. | `src/workers/geometryWorker.ts:26-50`; `src/components/ImperativeModel.tsx:240-267`, `:292`, `:368`, `:451`, `:459`, `:596`, `:639`, `:697`, `:850-856`; `src/utils/geometry/normals.ts:12-16`; `src/utils/geometry/manifoldOps.ts:217`; `src/utils/geometry/patternPipeline.ts:361` |
| §7 | "cache by `DesignState` hash" | PARTLY_TRUE | Does not exist. `WasmCache` is a 48-entry LRU of wasm handles keyed by content hash of individual inputs, with only two `getOrCreate` call sites. No result is memoized and nothing hashes a design. The directive stands; its precondition is missing, since the state holds live THREE objects and a `Date.now()` timestamp. | `src/utils/geometry/manifoldCache.ts:20-53`, `:88-145`, `:151`; `src/utils/geometry/manifoldOps.ts:139`, `:141`, `:169`; `src/types/schemas.ts:14`; `src/utils/projectUtils.ts:42` |
| §5 rule 5 | "Heavy compute goes in `src/workers`." | PARTLY_TRUE | One worker file, one `new Worker`, closed 3-kind union. Real inventory of main-thread work in §3.6. Also in direct tension with rule 6: the only worker is a shared upstream file. Adding a kind means five edits, including a hardcoded pump priority. | `src/workers/geometryWorker.ts:21-24`, `:26-42`; `src/utils/geometry/patternClient.ts:17`, `:31-32`, `:37`, `:63`, `:97-105`; `src/components/ImperativeModel.tsx:240-267`, `:451`, `:639`; `src/components/OutputPanel.tsx:122-123`, `:204` |
| §5 rule 6 | "Keep diffs upstream-mergeable; isolate new code in new folders where possible." | PARTLY_TRUE | Mergeability is achievable — a real `upstream` remote and merge-base exist, overturning the recon's assumption. Folder isolation is not achievable for any planned feature; see the anchor list in §4. Never reformat: no Prettier/EditorConfig and `patternPipeline.ts` is internally mixed-indent. | `.git/config:8-10`; `.git/HEAD:1`; `src/App.tsx:15-21`, `:36`; `src/components/Controls.tsx:30-31`, `:355-361`, `:370-406`; `src/workers/geometryWorker.ts:21-24`; `src/utils/geometry/patternClient.ts:17`; `src/utils/schemaDefaults.ts:10-12` |
| §6 item 2 | "`02-generator-engine` — the `Generator<P>` framework, registry, and **worker execution**" | PARTLY_TRUE | Worker execution exists and must be reused, not re-created. Binding constraint the doc omits: `patternUnit` is assembled on the main thread out of React state, so generator output must land in state before a job exists. Scope to "produce THREE.Shape[] into patternShapes". | `src/utils/geometry/patternClient.ts:28-108`; `src/workers/geometryWorker.ts:21-51`; `src/components/ImperativeModel.tsx:825-861`, `:887-892` |
| §6 item 4 | doc 04's param UI is an open choice between `leva` and native Tailwind | PARTLY_TRUE | leva is absent from both `package.json` and `pnpm-lock.yaml`; the native layer is written and already assembles all three tabs (~30 `ControlField` on screen, 17 `DebouncedInput`, 3 `ToggleButton`, 2 `SegmentedControl`). Read as "native Tailwind, extending `src/components/ui/ControlField.tsx`". | `package.json:17-41`; `src/components/ui/ControlField.tsx:14-50`; `src/components/ui/SegmentedControl.tsx:16-43`; `src/components/DebouncedInput.tsx:20-49`; `src/components/ShapeUploader.tsx:178`; `src/components/Controls.tsx:355` |
| §6 item 7 | "wrap existing `imagetracerjs` + `opentype.js` as `ShapeSource`s" | PARTLY_TRUE | Asymmetric. `traceImage`/`traceLayers` are a standalone module importing only three/imagetracerjs/colorShift — genuinely wrappable. `generateTextShapesFromOpentype` is module-private and welded to modal state (two ref caches, `activeFontKey`/`fontSize`, click point, `showAlert` prompt). Nothing to wrap today. | `src/utils/image/traceImage.ts:1-3`, `:137-152`, `:179-207`; `src/components/SVGPaintModal.tsx:32`, `:113-119`, `:504-557`, `:644-667` |
| §8 M2 | "generator engine (02) + Voronoi (03) → clip → extrude → export, with seed + basic params" | PARTLY_TRUE | clip/extrude/export are reached by supplying one field, `PatternJob.patternUnit`. Export is not even part of the pipeline — `OutputPanel` walks the shared group. M2's real work is synthesis + PRNG + writing `patternShapes`. `seed` is genuinely new. | `src/utils/geometry/patternPipeline.ts:47-49`, `:73`, `:138-139`, `:258-298`, `:357-366`; `src/components/OutputPanel.tsx:3`, `:122`, `:212`; `src/App.tsx:38`, `:77`, `:109`; `src/types/schemas.ts:66-85` |
| §9 item 5 | "[ ] The clip → extrude → export call sites (to confirm they need no changes)." | CONTRADICTED | Presumes one chain; there are three extrude sites and two export sites, and the order is extrude→compose→clip. Correct about the export tail, wrong about everything upstream. "No changes" also assumes the flat branch adds a sibling button — `exportControls` is a single opaque `ReactNode`, no registry. | `src/utils/geometry/patternPipeline.ts:102`, `:139`, `:236`, `:258-272`; `src/utils/geometry/inlayPipeline.ts:65`; `src/components/ImperativeModel.tsx:447-451`, `:639`; `src/components/OutputPanel.tsx:77`, `:122-123`, `:181`, `:204`; `src/components/Controls.tsx:29`, `:302-306`; `src/App.tsx:107-113` |
| §9 item 4 | "[ ] The current shape-input entry points (traced image, text) — to model `ShapeSource` after them." | CONTRADICTED | Eight UI entry points funnel into three handlers; text is not one of them — it is a tool inside the paint modal whose output leaves only via whole-canvas `onSave`. `ModelViewer` has no drop handler, so the enumeration is exhaustive. | `src/components/controls/BaseControls.tsx:31`, `:43`, `:65`; `src/components/controls/GeometryControls.tsx:114`, `:145`, `:177`; `src/components/controls/InlayControls.tsx:118`, `:270`, `:317`, `:334`, `:350`; `src/components/SVGPaintModal.tsx:504`, `:692-695` |
| §3 Non-Goals | "No breaking changes to upstream export formats" | PARTLY_TRUE | Not false, but unenforceable — and the real exclusion rule is not what it appears. `prepareForExport` ends in `return null`, so Lines/Points/Sprites are silently dropped while any Mesh added under the group ships. Worse, transient UI state (drag colour flattening, unclipped placeholders) is captured, and 3MF slot *count* changes with it. Needs an added invariant, not a rewrite. | `src/components/OutputPanel.tsx:40-75`, `:52-54`, `:74`, `:149-167`; `src/utils/geometry/applyPatternResult.ts:99-107`; `src/components/ImperativeModel.tsx:639`, `:813-821`, `:937`; `src/components/ModelViewer.tsx:503-515`, `:517-545` |
| §7 Testing | "Every feature ships schema tests, a produce/round-trip test, and a regression test proving the upstream flow still works." | PARTLY_TRUE | A forward-looking requirement, correct and worth keeping — but two facts limit it. Coverage `include` is allowlisted to `src/utils/**`, `src/context/**` and two components, so `src/workers/**`, `src/types/**` and every other component are outside the number. And the closest thing to an upstream-flow guard, `exportMerge.test.ts`, never imports `OutputPanel` — it hand-rebuilds the merge. | `vite.config.ts:24-37`, `:30-35`; `src/utils/geometry/exportMerge.test.ts:10-16`, `:91-131`; `src/components/OutputPanel.tsx:144-179`; `src/utils/patternUtils.test.ts:332-345` |
| §4.1 / §3 | "Source layout … + `src/types.ts`"; "deployable to GitHub Pages, like upstream" | PARTLY_TRUE | The layout sentence is literally correct and should not change; only the `src/types.ts` pointer is wrong. GitHub Pages deployment works today at a custom apex domain (`public/CNAME`, `base` commented out). A *subpath* deploy would break — eight root-absolute asset URLs and no `import.meta.env.BASE_URL` anywhere — and `package.json:4`'s `homepage` is stale. | `src/types.ts:1-39`; `src/types/schemas.ts:98-100`; `package.json:4`, `:12`, `:57`; `public/CNAME`; `vite.config.ts:16-17`; `dist/index.html:13`; `src/components/controls/BaseControls.tsx:72`; `src/components/ThumbnailGenerator.tsx:29`; `src/components/PatternLibraryModal.tsx:215`, `:223`, `:229`; `src/components/controls/GeometryControls.tsx:184`, `:194`; `src/components/controls/InlayControls.tsx:277` |
| §7 | "Source outlines from verified community files … with attribution" | PARTLY_TRUE | Attribution is half done: 9 of 17 outlines carry an `infoUrl` and all nine point at the same Printables model; 8 have none. Zero of the 17 DXFs and zero of the 13 inlay SVGs carry embedded rights metadata. The render path exists (`ExternalLink` for non-pattern categories). | `src/components/PatternLibraryModal.tsx:14`, `:49-65`, `:199-210`; `public/outlines/`; `public/inlays/` |
| §7 | "keyboard-navigable pickers; visible active-outline + active-source labels" | CONTRADICTED | Zero `aria-*`, zero `role=`, zero `tabIndex` in all of `src/`; exactly one `htmlFor`. Both pickers are `<div onClick>` with no focus trap and no Escape. The file input is `className="hidden"` so the dropzone is keyboard-unreachable in both states. There is no Escape-to-close pattern anywhere to copy. | `src/components/PatternLibraryModal.tsx:161-166`; `src/components/controls/InlayControls.tsx:212-233`; `src/components/ui/ControlField.tsx:27-41`; `src/components/ShapeUploader.tsx:180-182`, `:227`; `src/components/AlertModal.tsx:96-101`; `src/components/SVGPaintModal.tsx:223-241` |
| §7 | "visible active-outline + active-source labels" as a convention to inherit | PARTLY_TRUE | The loaded-source signal is consistent (green dashed border + green filename pill). Active-state styling is not: five different treatments — `ToggleButton` purple/10, inlay row purple/20, `SegmentedControl` **gray** with a white ring, swatches `ring-2 ring-white`, viewer toggles indigo and pink. Doc 04 must pick one. `Badge` is dead code. | `src/components/ui/ToggleButton.tsx:24-28`; `src/components/controls/InlayControls.tsx:220-223`; `src/components/ui/SegmentedControl.tsx:30-34`; `src/components/controls/BaseControls.tsx:150`; `src/components/ModelViewer.tsx:313`, `:369`; `src/components/ShapeUploader.tsx:182`, `:207-211`; `src/components/ui/Badge.tsx:9-26` |
| §1 / §2 | fork turns the app "from a manual grip editor" into a procedural studio | PARTLY_TRUE | Strengthened: the manual editor and gizmo are inlay-only (gizmo mounts only when `activeTab === 'inlay'`). The pattern panel is parametric already and its unit is an opaque uploaded 3D mesh. Doc 05 aimed at "the generated design" targets the half with neither direct-manipulation machinery nor polygons. | `src/components/controls/InlayControls.tsx:365-371`; `src/components/ModelViewer.tsx:503-515`; `src/components/controls/GeometryControls.tsx:145-175`, `:163`, `:192-203` |
| §7 | "Keep min-feature-size clamps so output stays printable/cuttable" | CONTRADICTED | Purely aspirational, and "Keep" falsely asserts inheritance. No output-side clamp exists in either dimension on either path. `src/types/schemas.ts` has zero `.min()`/`.max()`, and the `min=` attributes are inert because `DebouncedInput` never validates and nothing calls `checkValidity`. The only enforced physical limits are three Z-axis UI floors. | `src/types/schemas.ts:10-85`; `src/components/DebouncedInput.tsx:44-47`; `src/components/controls/BaseControls.tsx:111`; `src/components/controls/InlayControls.tsx:56`, `:76-85`, `:659`; `src/utils/dxfUtils.ts:385`, `:411`; `src/utils/geometry/manifoldOps.ts:34-47` |
| §11 Q1 | "Multiple simultaneous shape sources (layered), or one at a time to start?" | PARTLY_TRUE | Not settled by code — the app ships **both** models on different tabs. Inlays are a full instance manager with per-item modifiers; the pattern slot, which is where a Generator plugs in, is strictly single-source and replaces wholesale on load. See §7.1. | `src/types/schemas.ts:32`, `:50-64`, `:67-68`; `src/components/controls/InlayControls.tsx:90-95`, `:199-268`; `src/components/controls/GeometryControls.tsx:132-136`, `:145-175`; `src/utils/geometry/patternPipeline.ts:73`, `:232-236`; `src/utils/geometry/applyPatternResult.ts:71-87` |
| §11 Q2 | "`leva` for speed vs. native Tailwind for polish" | CONTRADICTED | Premise inverted — see §6 item 4 row. Reframe as "how much of the existing native layer becomes data-driven". | `src/components/ui/ControlField.tsx:14-50`; `tailwind.config.js:4-7`; `src/App.tsx:15-21`, `:92-114`; `src/components/Controls.tsx:64-66`, `:370-406` |
| §10 / §4.2 | new work "changes only shape sources / controls / export — never the clip/extrude core" | PARTLY_TRUE | Survives literally for a seed: seeded values reach only `instanceMatrix` and `compose`, never a cache key. What breaks is rule 6, because `generateTilePositions` is shared inherited code called from both threads. And it fails outright for pattern-footprint flat export, which must edit `PatternResult`, `patternResultTransferables` and `generatePattern`. | `src/utils/patternUtils.ts:285-299`, `:464`, `:504-505`; `src/utils/geometry/patternPipeline.ts:84-100`, `:205-236`, `:358`, `:223-229`; `src/utils/geometry/manifoldOps.ts:49-219` |
| §9 item 3 | "[ ] The DXF normalization util (units, closing, centering)." | CONFIRMED | The util exists and does all three — `parseDxfToShapes` exported at `dxfUtils.ts:46`. Three caveats a spec must carry: the centering bbox excludes arc/circle bulges; closing is unconditional (`force=true` for open chains too); and the winding pass rebuilds negative-area shapes with `moveTo`/`lineTo`, discarding their arcs. DXF-only — no SVG equivalent. | `src/utils/dxfUtils.ts:46`, `:59-81`, `:203-211`, `:379-382`, `:384`, `:387-388`, `:392-397` |

### MEDIUM / LOW

| Doc ref | Claim | Verdict | Correction | Evidence |
|---|---|---|---|---|
| §7 | "debounce param changes" | CONFIRMED | `DEFAULT_DEBOUNCE_MS = 150` (was 300; lowered because generation is "well under 200ms for a dense grip"), applied to all 17 numeric fields. Selects commit synchronously. A second 180 ms debounce exists on the image-trace preview. The larger coalescing layer the doc omits is the worker client's pending slot. | `src/components/DebouncedInput.tsx:9-18`, `:32-40`; `src/components/controls/GeometryControls.tsx:283`, `:389-395`; `src/components/ImageConversionModal.tsx:76-90`; `src/utils/geometry/patternClient.ts:75` |
| §4.1 | "`three` / `@react-three/fiber` / `three-stdlib` / `three-3mf-exporter` — 3D preview + STL/3MF export" | CONFIRMED | Exact. | `src/components/OutputPanel.tsx:3`, `:5`, `:122-123`, `:204`; `src/components/ModelViewer.tsx:436`; `package.json:36-38` |
| §4.1 | "`opentype.js` — text → vector outlines" | CONFIRMED | Real and used; `package.json:30` (not `:26`). All 11 references are in `SVGPaintModal.tsx`. Fonts are fetched from jsDelivr at runtime, and `.woff2` is in the picker's accept string but unparseable. | `package.json:30`; `src/components/SVGPaintModal.tsx:3`, `:16-29`, `:32-62`, `:653`, `:672` |
| §4.1 | the eleven "key deps and their role" bullets | PARTLY_TRUE | `lodash` has **zero** import sites. `clipper-lib` has one (dead). Omitted deps that matter: `react-freeze` (tab semantics), `clsx`+`tailwind-merge` (`cn`), `uuid` (instance ids). Two more dead type packages: `@types/lodash`, and `@types/uuid` sitting in `dependencies`. | `package.json:17-66`, `:21`, `:27`, `:45`; `src/utils/cn.ts:1-6`; `src/components/Controls.tsx:2`, `:370-400`; `src/components/controls/InlayControls.tsx:27`, `:100` |
| §4.1 | "`react-colorful` … plumbing/UI" | PARTLY_TRUE | Imported once, rendered once, inside the paint modal behind a toggle. The in-panel convention is a hardcoded 21-swatch grid duplicated verbatim in two control files. Doc 04 must say which convention a colour param follows. | `src/components/SVGPaintModal.tsx:2`, `:1141-1147`; `src/constants/colors.ts:1-26`; `src/components/controls/BaseControls.tsx:143-156`; `src/components/controls/GeometryControls.tsx:549-566` |
| §3 Goals | "Make every design reproducible and shareable as data (`seed + params + outline`)" | PARTLY_TRUE | A goals bullet, not a factual claim — the doc's own §2.3 already says the model is missing. The implied decomposition is what is wrong: `params` is real and persisted, `seed` is cheap, `outline` is the expensive third — explicitly nulled and shipped as a raw file. | `src/utils/projectUtils.ts:29-87`, `:46`, `:61-73`; `src/types/schemas.ts:87-96`; `src/App.tsx:15-21` |
| §3 Non-Goals | "No new 3D slicing/printer control (export STL/3MF and stop there)" | PARTLY_TRUE | Goal clause intact; the parenthetical is false. `exportTo3MF(merged, {})` passes an empty config, so the library defaults apply: Bambu Lab A1, 256³ bed, "Bambu PLA Basic @BBL A1", layer_height 0.2, wall_loops 2, 15% infill, 0.4 nozzle, and the build item is re-centred and dropped to z=0. Button reads "Export 3MF (Bambu/Orca)". | `src/components/OutputPanel.tsx:204`, `:238`; `node_modules/three-3mf-exporter/dist/index.mjs:5-19`, `:24`, `:144-157`, `:253-261`, `:283-310` |
| §2 item 4 / §6 item 6 | "No flat (2D) export path" | CONFIRMED | Exactly four download sites, none vector: STL, 3MF, watermarked PNG, project .zip. Nuance: an SVG *path-data* generator already exists, is unit-tested and drives three previews — it returns only a `d` string with no `<svg>`, no viewBox, no units, no per-shape split. | `src/components/OutputPanel.tsx:125-136`, `:206-216`; `src/components/ScreenshotManager.tsx:110-114`; `src/utils/projectUtils.ts:79-86`; `src/utils/dxfUtils.ts:469-493`; `src/utils/dxfUtils.test.ts:223-256`; `src/components/DXFThumbnail.tsx:32`; `src/components/ShapeUploader.tsx:51`; `src/components/SVGPaintModal.tsx:850` |
| §6 item 3 | Voronoi (`d3-delaunay`), noise-contour (`simplex-noise`+`d3-contour`), truchet/Wang, L-system are generators to be ADDED | CONFIRMED | Confirmed absent. A repo-wide grep for `voronoi\|delaunay\|simplex\|perlin\|truchet\|l-system\|fractal\|poisson\|marching` over `src/` and `package.json` returns zero. `leva` also absent. | `package.json:17-41`, `:42-66` |
| §11 Q3 | "Built-in pads as pre-parsed JSON vs. runtime DXF parse?" | CONTRADICTED | Already decided and shipped: runtime fetch + parse. Both stated tradeoffs are inverted — see §7.3. | `src/components/controls/BaseControls.tsx:72-79`; `src/utils/shapeLoader.ts:71`; `src/utils/geometry/manifoldOps.ts:27-38`; `src/components/ImperativeModel.tsx:447`, `:449-451`; `node_modules/three/src/geometries/ExtrudeGeometry.js:87`, `:140` |
| §11 Q4 | "Front/rear pads as separate outlines or one full-board outline?" | PARTLY_TRUE | The catalog answers it: all 17 are single-pad footprints, measured 206.1×173.4 mm to 255.3×233.9 mm (plus one imperial file at 256×211 mm). None is a full-board span. The pipeline is agnostic. Caveat: the green overlay renders only `cutoutShapes[0]` and only its outer ring. | `public/outlines/`; `src/components/PatternLibraryModal.tsx:49-65`; `src/utils/dxfUtils.ts:410-427`; `src/components/ImperativeModel.tsx:451`; `src/components/ModelViewer.tsx:517-533` |
| §7 | "the repo currently has **no explicit license**" | PARTLY_TRUE | Code-verifiable half confirmed: no LICENSE/COPYING/NOTICE/README/AUTHORS anywhere, and `package.json` has only `"private": true`. The binding constraint is `public/`, which ships third-party marks with zero rights metadata in any of the 13 inlay SVGs. The ToS/default-copyright reasoning is legal advice, not a file-backed finding. | `package.json:1-16`, `:3`; `public/inlays/`; `src/components/PatternLibraryModal.tsx:35-46` |
| §8 M5 | "more generators, direct editing, text/image sources" — direct editing as a late addition | PARTLY_TRUE | Three direct-manipulation surfaces already exist: the 3D gizmo, the paint modal, and drag-reorder of the inlay layer list — which is not cosmetic, since item index drives depth bias and mask precedence. | `src/components/interaction/InlayInteractionHandles.tsx:97-533`; `src/components/SVGPaintModal.tsx:102`, `:155-182`; `src/components/controls/InlayControls.tsx:177-192`, `:214-218`, `:365-371`; `src/utils/geometry/inlayLayering.ts:41-43`; `src/utils/geometry/patternPipeline.ts:318-324` |
| §4.1 | "React 19 + TypeScript + Vite + Tailwind; pnpm; Vitest; deploy via `gh-pages`" | CONFIRMED | Resolved versions read from `node_modules`: vite 5.4.21, vitest 2.1.9, tailwindcss 3.4.19 (classic config + plain postcss plugin), typescript 5.9.3, react 19.2.3, gh-pages 6.3.0, jsdom 29.1.1, zod 4.2.0, three 0.182.0, manifold-3d 3.5.1, clipper-lib 6.4.2. Corepack pin `pnpm@10.20.0`. | `package.json:31-33`, `:36`, `:57`, `:61-65`, `:67`; `tailwind.config.js:1-8`; `postcss.config.js:1-6` |
| §4.1 | "`manifold-3d` … stable dependency of the reproducibility story" | CONFIRMED | 3.5.1 installed, pinned in the lockfile, but the manifest range is a caret — a lockfile refresh can move it, and a triangulation change moves exported STL bytes for an unchanged design. | `node_modules/manifold-3d/package.json:3`; `package.json:29`; `pnpm-lock.yaml:1831`; `src/utils/geometry/manifoldModule.ts:17-27` |
| §7 | "mm everywhere" (export side) | CONFIRMED | 3MF writes `@_unit: "millimeter"` on both model documents; STL is unitless by format and `handleExport` applies no transform ("we don't need to rotate"). Scene units pass through unchanged. | `node_modules/three-3mf-exporter/dist/index.mjs:168`, `:236`; `src/components/OutputPanel.tsx:117-120`, `:157`; `src/utils/geometry/manifoldOps.ts:25`, `:47` |

---

## 3. Ground truth: how the code actually works

### 3.1 Geometry types and conversions

Six live representations coexist. §5's "never introduce a parallel geometry representation" describes an ideal, not the code.

| # | Representation | Where | Definition |
|---|---|---|---|
| 1 | `THREE.Shape` (holes as `.holes: THREE.Path[]`) | React state | `src/types/schemas.ts:14`, `:67`, `:22` |
| 2 | `{ shape: THREE.Shape; color: string }` | inlays, coloured SVG | `src/utils/shapeLoader.ts:53`; mirrored as `InlayJobShape` at `src/utils/geometry/inlayPipeline.ts:15-18` |
| 3 | `THREE.BufferGeometry` | STL branch — **what the pattern slot actually holds** | `src/utils/shapeLoader.ts:31-36`; branched at `src/components/ImperativeModel.tsx:829-830` |
| 4 | `SerializedShape { points: number[]; holes: number[][] }` | worker wire, flat `[x0,y0,x1,y1,…]` | `src/utils/geometry/serialize.ts:14-18` |
| 5 | `SerializedGeometry { position; normal?; index? }` | worker wire, transferable | `src/utils/geometry/serialize.ts:20-25` |
| 6 | `Vec2[][]` → `new CrossSection(contours, 'EvenOdd')` | inside wasm | `src/utils/geometry/manifoldOps.ts:74-88` |
| — | `ClipperLib.Paths` of `{X,Y}` ints at SCALE=1000 | **dead** | `src/utils/offsetUtils.ts:5`, `:11-35` |

Conversions: `serializeShape`/`serializeShapes` (`serialize.ts:34-50`) flatten via `getPoints()`; `deserializeShape` (`:61-67`) rebuilds a `THREE.Shape`; `contoursOf` (`manifoldOps.ts:74-82`) re-pairs the flat array. The file comment at `serialize.ts:3-12` states why `THREE.Shape` cannot cross the boundary.

**Curve sampling.** `getPoints()` defaults to 12 *divisions*, resolved per curve type — LineCurve 1, EllipseCurve `divisions*2` = 24, SplineCurve `divisions × points.length` (`node_modules/three/src/extras/core/CurvePath.js:199-212`). So a DXF `CIRCLE` (built with `absarc`, `src/utils/dxfUtils.ts:171-172`) becomes a 24-gon at any radius — sag 0.428 mm at R=50, 400× the 0.001 mm cutter tolerance. `ExtrudeGeometry` independently defaults `curveSegments` to 12 and calls `shape.extractPoints(12)` (`node_modules/three/src/geometries/ExtrudeGeometry.js:87`, `:140`), so **the base mesh and the clip contour are sampled identically** — the in-code comment claiming the base "preserves curves" (`src/components/ImperativeModel.tsx:449`) is misleading. `SVGPaintModal` threads explicit divisions (8/16/32/50+) and `centerShapes` re-samples at 12, so text and SVG art are permanently flattened at import.

**Closure.** Implicitly closed; do not append a duplicate. DXF rings always carry an explicit duplicate because `build()` is called with `force=true` for closed *and* open chains (`src/utils/dxfUtils.ts:384`, `:387-388`); shapes from `new THREE.Shape(points)` do not (`autoClose` stays false). Consumers strip or wrap: `removeDupEndPts` before Earcut, parity/index loops modulo n, `CrossSection` implicit. Minimum 3 vertices — `points.length < 6` is silently dropped (`src/utils/geometry/manifoldOps.ts:86`, `:93`, `:132`).

**Winding.** Irrelevant at the CSG boundary (everything is `'EvenOdd'`) and re-derived by `ExtrudeGeometry`. But **load-bearing at two live import boundaries that infer nesting from winding**: `ShapePath.toShapes(isCCW)` for every text glyph (`src/components/SVGPaintModal.tsx:48`, `:59`) and `SVGLoader.createShapes` under its default `nonzero` fill rule (`node_modules/three-stdlib/loaders/SVGLoader.js:1245-1246`, `:1283-1298`). Actual winding is inconsistent by source: DXF outers CCW (`src/utils/dxfUtils.ts:392-397`), SVG outers **CW** — `centerShapes` enforces CCW at `src/utils/patternUtils.ts:964-966` and then negates Y at `:970`, a determinant −1 reflection that flips the sign straight back. Holes are never rewound.

**Centering.** Four bbox-midpoint implementations, no centroid: DXF inline (`dxfUtils.ts:203-211`, `:379-382`), `centerShapes` (`patternUtils.ts:942-952`), the Manifold unit recentre (`patternPipeline.ts:143-149`), and `geometry.center()` for STL. The DXF box uses segment start/end only, so a `CIRCLE` contributes `(cx+r, cy)` twice (`dxfUtils.ts:169-170`) and arc bulges are invisible — the origin cannot be re-derived downstream by any means.

**Units.** DXF: real `$INSUNITS` table with a `$MEASUREMENT===0 → 25.4` fallback (`dxfUtils.ts:59-81`); every unlisted code falls through to 1.0. SVG: none — `shapeLoader.ts:43` leaves `SVGLoader`'s `px`/90 defaults, `viewBox` is never read (grep: zero hits in the loader), so `100mm` becomes `(1/25.4)*90 = 354.33` units. STL: raw. Image trace: hardcoded 50 mm.

**Import-side destruction (all before scaling, so none can express a printed mm):** `|area| <= 1.0` mm² dropped (`dxfUtils.ts:385`); `EPSILON = 0.15` area filter at `:411`; 0.1 mm directional dedup and O(N²) bridge removal (`:213-248`); two-pass stitching at 0.1 then **1.0 mm** with force-close (`:361-371`, `:384-388`) — a genuine 0.8 mm gap becomes one closed ring; an elliptical arc sweeping under 0.15 rad is expanded to a full ellipse (`:184-186`); negative-area rings rebuilt as polylines, destroying their arcs (`:395`).

### 3.2 The real end-to-end data flow

Replaces §4.2's diagram. `‖` marks the Web Worker boundary.

```
MAIN THREAD                                            ‖   WORKER  src/workers/geometryWorker.ts:26-50
──────────────────────────────────────────────────────‖──────────────────────────────────────────────
 file / preset / paint modal / image trace             ‖
   parseShapeFile  shapeLoader.ts:12  ──┐              ‖
     ├ .svg  → SVGLoader, centerShapes(flipY=true) :62 ‖
     ├ .dxf  → parseDxfToShapes, NO centering     :71  ‖
     └ .stl  → STLLoader, geometry.center()    :31-36  ‖   (returns THREE.BufferGeometry, not Shapes)
                                       │              ‖
                                       ▼              ‖
        App.tsx useState × 3   :15 :18 :21            ‖
          baseSettings.cutoutShapes                   ‖
          geometrySettings.patternShapes              ‖
          inlaySettings.items[].shapes                ‖
                        │                             ‖
          ┌─────────────┴──────────────┐              ‖
          ▼                            ▼              ‖
  useMemo split outline           buildJob()          ‖
  ImperativeModel.tsx:158-237     :825-861            ‖
   • mirror + rotate BAKED into    • kind:'geometry'  ‖
     point lists  :183-228           if [0] is a      ‖
   • filledCutoutShapes             BufferGeometry    ‖
     (outer rings, holes=[])        :829-830  ◄─ THE  ‖
   • holeShapes (each promoted)     SHIPPING PATH     ‖
   • synthesises a `size` square    • else kind:'shapes' filtered on instanceof THREE.Shape :832-836
     when no outline  :163-174      • serializeShapes :836 :850-856
          │                            │              ‖
          │                     SerializedShape[]     ‖
          │                            │              ‖
          │      submitPattern  patternClient.ts      ‖
          │      :97-101 → pump :60-68 → postMessage :67
          │      (1 in flight + 1 pending per kind,   ‖
          │       latest-wins :56 :75;                ‖
          │       priority pattern ?? inlay :63)      ‖
          │                            └──────────────►  generatePattern  patternPipeline.ts:102
          │                                           ‖    │
          │                                           ‖    ├─ csFromShapes → CrossSection('EvenOdd')  :138
          │                                           ‖    ├─ Manifold.extrude(cs, 1)      :139  ◄─ EXTRUDE
          │                                           ‖    ├─ recentre unit on bbox midpoint  :143-149
          │                                           ‖    ├─ generateTilePositions (plain JS,
          │                                           ‖    │    UNSEEDED Math.random)        :183-191
          │                                           ‖    ├─ per-instance scale/rot/z matrix :205-213
          │                                           ‖    ├─ [fast path] no CSG → return unit+matrices :223-229
          │                                           ‖    ├─ Manifold.compose(instances)     :236
          │                                           ‖    ├─ subtract exclusions             :253
          │                                           ‖    ├─ intersect(cachedCutterSolid)    :269  ◄─ CLIP
          │                                           ‖    ├─ subtract hole solid             :286
          │                                           ‖    ├─ subtract max-height box         :297
          │                                           ‖    ├─ mask split → per-colour parts   :300-355
          │                                           ‖    ├─ serializeMesh + computeSharpNormals(60°)
          │                                           ‖    │    manifoldOps.ts:198-218 :217
          │                                           ‖    └─ finally { ops.flush() }  ◄─ every CrossSection
          │                                           ‖         freed here  :369-371  → NO 2D ESCAPES
          ▼                                           ‖              │
  THREE.ExtrudeGeometry (main thread, never booleaned)‖              │ SerializedGeometry, buffers
   • Base plate  :447-459                             ‖              │ TRANSFERRED  :92-100
   • inlay placeholders, UNCLIPPED  :639              ‖              ▼
          └────────────┬──────────────────────────────‖──  applyPatternResult.ts:67-130
                       ▼                              ‖    applyInlayResult.ts:29-59 (replace by mesh name)
              THREE.Group   meshRef   App.tsx:38 → :77 → :109
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
  handleExport(mode)            handleExport3MF()
  OutputPanel.tsx:77-137        OutputPanel.tsx:181-226
   prepareForExport :40-75       + mergeByColor :144-179
   (name-prefix Debug_ filter,     (one mesh per material hex,
    type filter, return null)       matrixWorld baked)
   STLExporter.parse :122-123     exportTo3MF :204
```

Three facts the diagram makes visible that §4.2 hides: the worker boundary and its structured-clone requirement; that extrusion precedes clipping; and that the Base plate never enters the worker at all.

### 3.3 The clip + extrude path

`hasClipping = clipToOutline && job.filledCutoutShapes.length > 0` (`patternPipeline.ts:218`). Because `filledCutoutShapes` is never empty — a default square is synthesised at `ImperativeModel.tsx:163-174` — this reduces to `clipToOutline` alone, default `true` (`schemas.ts:78`) and exposed as a "Clip to Edge" toggle. `useCSG = hasClipping || hasExclusions || hasMasks || hasHoles || hasHeightCut` (`:221`). **The CSG path is the default; the instanced fast path requires the user to switch clipping off.**

`clipToOutline` is overloaded: it also becomes the `allowPartial` argument of the 2D tile placer (argument 7 at `:184-190`), flipping the survival test from all-5-probe-points to any-probe-point (`patternUtils.ts:434-437`) and the bbox test from containment to overlap (`:451-455`).

Heights: a 2D unit is extruded to **exactly 1**, so `unitZ === 1` and tile height is entirely `patternScaleZ` falling back to `patternScale` (`:199-201`). An STL unit uses its own Z extent (`:157-160`). The through-cutter trick: `spanHeight = thickness + max(patternMaxHeight||0, maxInlayExtend, 100) + 100` (`:115`, `:117`), spanning roughly ±200 mm for exclusions, masks and base holes; the outline clip deliberately uses a finite depth so the intersect trims the top too. Beware two near-identical names 60 lines apart: `patternMaxHeight` (job field, cut plane) vs `maxPatternHeight` (derived `unitZ × actualScaleZ`).

Decimation: cutter contours are simplified to `CUTTER_TOLERANCE = 0.001` mm (`manifoldOps.ts:47`, applied `:111`, `:150`); the pattern unit and inlay shapes are deliberately **not** (`:44-45`), so a dense generated field pays full point cost. The measured effect on a real pad: 4761 contour points → 541, 18464 triangles → 1584, roughly halving pipeline time (`:24-46`).

Packaging rule for a generator: `csFromShapes` builds one `CrossSection` per `SerializedShape` with `'EvenOdd'` fill, then unions them (`:91-98`). **Overlapping cells passed as separate shapes union correctly; a single shape whose own rings overlap will XOR-cancel.**

Dead code inside the pipeline: `getTransformedShapes('include')` can never match, because the modifier enum is `['none','cut','mask','avoid']` and the filter maps them to exclude/mask/avoid only — so `inclusionShapes` is always empty and the carve-out at `:244-247` is unreachable.

### 3.4 The outline path

`ShapeUploader.handleFileChange` → `processFile` → `FileReader.readAsText` → `parseShapeFile(text,'dxf')` → `onUpload` → `BaseControls.handleOutlineLoaded` (`:31-38`), which sets `cutoutShapes`, local `fileName`, and registers raw bytes for zip export. The library path is identical from `parseShapeFile` onward (`:72-79`). Both funnel to one handler, so §5's "the pad library produces the same type" is already true.

`ShapeUploader` gates by file **extension** (`:91-106`) while `parseShapeFile` re-detects by **content** (`shapeLoader.ts:20-29`). That override is deliberate and test-pinned in both directions (`src/utils/shapeLoader.test.ts:119-130`) — do not "fix" it. Two real defects in it, though: `trimmed.startsWith('  0')` at `shapeLoader.ts:26` is dead after `.trim()`, and `trimmed.includes('<svg')` matches anywhere in the file.

Silent failures: a DXF parsing to zero shapes returns `success: true` (`shapeLoader.ts:79`), the success branch runs, and the app reverts to the 300 mm square with `fileName` and `projectAssets.baseOutline` set. `ShapeUploader` discards `result.success === false` entirely and uses raw `alert()` for disallowed types. (Library presets are partly mitigated: `DXFThumbnail` renders a visible "Failed" tile.)

`baseOutlineRotation`/`baseOutlineMirror` are applied in **three** independent places with three mechanisms — baked point map for the clip (`ImperativeModel.tsx:183-228`), mesh transform for the base (`:472-474`), and inline again for the green overlay (`ModelViewer.tsx:521-533`). They agree today. Neither `handleOutlineLoaded` nor `onClear` resets them, and the controls are hidden once `cutoutShapes` is empty (`BaseControls.tsx:118`) — so a rotation leaks across pad swaps and becomes invisible and unresettable after Clear.

`BaseSettings.size` (default 300 mm, a full side length) is presented as "Unused when outline is uploaded" (`BaseControls.tsx:96-105`). It is not: it still drives camera fit-zoom (`CameraRig.tsx:39`), the screenshot ortho frustum (`ScreenshotManager.tsx:36`), and the inlay tiling container (`ImperativeModel.tsx:247-252`, with `boundaryShapes = null` at `:259`). Every shipped outline measures smaller than 300 in both axes (206.1×173.4 to 255.3×233.9 mm), so the view is permanently over-framed by 21–42%.

Nesting is inferred geometrically: sort by descending area, 3-point ray-cast containment, outer rings forced CCW (`dxfUtils.ts:392-427`). A ring whose parent is itself a hole is promoted to top level (`:423-426`) — that island then survives the base extrude but is **erased by the CSG hole subtract**, because it lies inside the subtracted region.

One shipped outline relies on the DXF Arbitrary Axis transform: `xrstock.dxf` has exactly 2 ARC entities with extrusion Z = −1 (an X mirror). The basis is derived for every entity (`dxfUtils.ts:85-86`) but ignored by SPLINE and ELLIPSE, which is spec-correct — an implementer told "every entity applies it" will write wrong preprocessing.

### 3.5 State and persistence

Design state is exactly three `useState` objects in `App.tsx` (`:15`, `:18`, `:21`), prop-drilled — 15 props into `Controls`, 10 into `ModelViewer`, and **36 declared props / 37 JSX attributes** into `ImperativeModel` (`ModelViewer.tsx:460-501`). Max depth for design state is 3 hops; the cost is fan-out, not depth. Adding one field touches seven places, ending at the hand-maintained dependency array (`ImperativeModel.tsx:897-903`) — already demonstrably broken for the three `debugShow*Cutter` props, which `buildJob` reads at `:857-859` and the array omits.

There is **no design context**. `createContext` appears once in `src/`, for alerts. `projectAssets` — the only copy of the source bytes and the thing that makes a design round-trippable — is component-local `useState` inside `Controls` (`:81`), not even lifted to App, and is not cleared by Reset.

38 of 41 schema fields are already plain JSON; exactly 3 hold THREE objects. Two fields are dead: `GeometrySettings.patternHeight` (no consumer) and `InlayItem.valid` (written `false` once, never read). Three numeric fields are `z.union([z.number(), z.string()])` with `""` as the unset sentinel — so `''`, `0` and `undefined` are three distinct persisted states.

Persistence: `exportProjectBundle` (`projectUtils.ts:29-87`) writes a JSZip of `project.json` plus raw asset files. It nulls `cutoutShapes` (`:46`) and `patternShapes` (`:53`) but spreads `inlay` untouched (`:48-50`), so `THREE.Shape.toJSON()` blobs are stringified — `JSON.stringify` does not throw, it silently emits a large curve blob per shape. Import re-hydrates from zip assets matched on the item uuid (`Controls.tsx:206-231`); when no asset matches, the item keeps plain objects and the first `shape.getPoints()` throws (38 unguarded call sites; only `ShapeUploader.tsx:45` checks). Nothing calls `fromJSON` or `ObjectLoader`.

The version-mismatch branch is unreachable dead code: `versionMismatch` is computed at `projectUtils.ts:179-181`, then `safeParse` against `version: z.literal(1)` rejects anything else and throws at `:187`, so the "Continue Anyway" dialog (`Controls.tsx:241-249`) can never render. Bumping the literal orphans every existing bundle with no migration and no working warning.

Also unreconciled on import: `selectedInlayId` is never reset (`Controls.tsx:236-238` sets only the three settings), and the auto-select effect's dep array is `[items && items.length]` — so importing a project with the same layer count but different uuids leaves the Selected Layer panel silently blank.

Library outlines are zipped under their display name with **no extension** (`assets/base/XR Stock`, from `BaseControls.tsx:79` → `projectUtils.ts:62`). The round trip still works because `detectAssetType` falls back on a leading `0` → dxf — deliberate and test-pinned (`fileTypeSniffer.test.ts:28-48`), not luck.

`eventBus` is a 25-line untyped singleton with exactly one production event, `INLAY_TRANSFORM`, emitted at `InlayInteractionHandles.tsx:274` and consumed at `ImperativeModel.tsx:799` — a live second state channel that bypasses React during a drag.

### 3.6 The worker protocol

One file, one `self.onmessage`, one `new Worker` in the entire tree (`patternClient.ts:37`). Request union is closed: `'pattern' | 'inlay' | 'warmup'` (`geometryWorker.ts:21-24`); warmup deliberately posts nothing so it never occupies the pump. Everything below `await getManifold()` at `:35` pays the 541,470-byte wasm compile.

`GeometryWorkerClient` keeps at most one job in flight plus one pending per kind, overwriting the pending slot (coalescing, latest-wins at `:56`), with a hardcoded priority `this.slots.pattern ?? this.slots.inlay` (`:63`). `cancel()` only drops a pending slot or marks in-flight cancelled — a running Manifold job cannot be interrupted and there is no `terminate()` anywhere.

Three failure modes, all silent:
- **Degenerate/empty:** `empty: boolean` is set at four sites and read by **nobody** — `applyPatternResult` never inspects it, so the pattern just vanishes.
- **wasm throw:** caught inside the worker's try (`:34-50`), posted back as an empty result, which resolves the callback and clears the spinner.
- **Worker module load failure** (the GitHub-Pages-subpath case): `worker.onerror` logs, clears `inFlight` and pumps the next job into a dead worker (`patternClient.ts:42-47`), so the pump wedges and the spinner stays on forever.
- **Non-cloneable payload:** wedges everything permanently — see §1 finding 11.

`onMessage` never compares `msg.kind` to `done.kind` (`:52-58`), so a message arriving out of strict one-in/one-out order is delivered to whatever slot is in flight.

Cost centres, in order: (1) Manifold booleans on the composed solid — the default path; (2) `computeSharpNormals`, O(V+F), run once over the whole composed solid plus once per mask part plus once per inlay part, never cached, guarding against a documented ~5800 ms quadratic alternative; (3) cutter contour density. Whole-pipeline budget is "well under 200ms for a dense grip" per `DebouncedInput.tsx:12-14`, inside a 150 ms debounce. Measured conversion rate for budgeting: **≈3.5 triangles per contour point** (`manifoldOps.ts:37`), matching the 4n−4 prism identity.

`WasmCache` is a 48-entry LRU of wasm handles with a documented safety invariant: eviction calls `delete()` on the victim, so objects produced inside an unbounded per-shape loop must never be cached — doing so caused a use-after-free, and there is a dedicated regression test (`manifoldCache.ts:94-105`, `:125-131`; `patternPipeline.test.ts:162-182`). Hash is 32-bit FNV-1a rendered base36 — fine for a wasm handle cache, inadequate as a correctness key.

`generateTilePositions` runs in **both** threads: worker-side for patterns (`patternPipeline.ts:184`), main-thread for inlays via `calculateItemPositions` (`ImperativeModel.tsx:254`, reached from `:292`, `:368`, `:596`, `:697`). The inlay worker never tiles — `InlayJobItem.positions` carries already-resolved `{x,y,rot}` (`inlayPipeline.ts:30`, consumed `:91`). Two traps for a grep-based recon: `tileShapes` (`patternUtils.ts:800`) is dead, called only by its own test, and `ModelViewer.tsx:14` imports `generateTilePositions` without ever calling it.

### 3.7 Export

Export is a scrape of one live `THREE.Group`, not a re-run of the pipeline: `meshRef` is created in `App.tsx:38`, forwarded through `ModelViewer.tsx:460-461` to `ImperativeModel`'s `useImperativeHandle` over `<group ref={localGroupRef}>` (`:97`, `:100`, `:1016`), and read directly by `OutputPanel.tsx:78-80`.

Two call sites diverge after `prepareForExport`:
- **STL** (`:77-137`): hierarchy straight to `STLExporter.parse(obj, {binary:true})` (`:122-123`), no merge. No try/catch, no empty check — an empty scene yields a valid 84-byte STL.
- **3MF** (`:181-226`): `mergeByColor` (`:144-179`) first, collapsing to one non-indexed mesh per unique material hex named `Color_<hex>`, then `exportTo3MF(merged, {})` (`:204`).

`prepareForExport` (`:40-75`) filters on the `Debug_` name prefix (`:52-54`) **and** on Object3D type, ending in `return null` (`:74`) — so a Line, Points or Sprite added under the group is silently dropped while any Mesh ships. It never checks `object.visible`. The `InstancedMesh` branch runs *before* the `Debug_` test, so a debug instanced mesh would export (latent only — every debug part is a plain Mesh).

Neither exporter reads the `normal` attribute: `STLExporter` recomputes the facet normal from world-space winding (`:110-114`) and the 3MF writer emits only `<vertex>`/`<triangle>`. Consequence: **the mirrored base exports with inverted facet orientation**, because mirror is a negative mesh scale (`ImperativeModel.tsx:472-473`) and `BufferGeometry.applyMatrix4` never reverses the index. The same author explicitly compensates for this on the *clip* contours (`:200-202`, `:226-228`, commented "Mirror flips winding") but not on the base mesh.

`mergeGeometries` cannot return null inside `mergeByColor`: every candidate is normalised to a fresh non-indexed `{position, normal}` geometry first (`:156-162`), so the silent-drop guard at `:171-173` is unreachable — contrary to what `exportMerge.test.ts`'s docblock implies.

The exported model is a deliberate multi-body assembly of interpenetrating solids with documented epsilons — pattern sink `thickness - 0.01`, mask lift `idx * 0.0001`, inlay per-shape stagger `min(shapeIdx,20) * 0.002`, per-item depth epsilon `(i+1)*0.001`. **No boolean union is ever performed between Base, Pattern and Inlays.** Watertightness holds per part, never for the assembly — a flat branch that tries to slice the assembly will be wrong.

3MF materials: `exportTo3MF` dedups by exact linear RGB and assigns `extruder = materials.length + 1` in first-encounter depth-first order, writing `filament_colour` padded to at least two. Because effects remove and re-append their children (`Base` at `:435-444`/`:483`, `InlayGroup` at `:508-522`/`:566`, pattern meshes in `applyPatternResult`), **child order is itself transient and extruder numbering is not stable across edit sequences.**

### 3.8 The existing tiling engine

`generateTilePositions` (`patternUtils.ts:285-299`) is a 13-parameter, boundary-aware, exclusion/inclusion/avoid-aware procedural placement engine — the repo's closest existing analogue to `Generator<P>`, and the doc does not know it exists.

- **8 distributions** (`schemas.ts:79`): grid/offset (`:669-791`), hex 6-tile clusters on a ring of R = max(tw,th)+spacing at i·60°+30° (`:588-667`), radial rings with even-ring half-step offset (`:536-586`), random dart-throwing (`:481-535`), wave (freq 0.6, amp 0.35), zigzag (period 8, amp 0.3), warped-grid (dual sine 0.5/0.4).
- **4 orientations** via `getRotation` (`:463-475`): none, alternate (checkerboard), random, aligned (tangential to bounds centre). The `(c,r)` fed in is distribution-dependent and inconsistent — random passes `(count,0)`, radial `(i,ringIndex)`, hex cluster indices.
- **`direction`** is read only by wave and zigzag.
- **Acceleration:** a Y-bucketed `PolyIndex` (`:102-161`) rebuilt per job, 5 probe points per candidate (`:333-343`), O(tiles × avoidVertices) avoid test, with an oracle-equivalence test at `patternUtils.test.ts:62-95`.
- **Containment never sees holes** — `getShapesBounds` and `buildPolyIndex` walk only `shape.getPoints()` (the outer contour), and the job receives `filledTHREE` whose holes were already stripped. Tiles *are* placed over outline holes and removed later by the 3D subtract.
- **No cap on lattice tile count**, and with `patternScale` or `tileSpacing` driving `fullWidth` to 0, `cols/rows = ceil(span/0) = Infinity` and the inclusive loops never terminate — inside the worker, so the pump never drains and the app silently stops regenerating.
- **`patternScale` is auto-overwritten on load** by `calculateAutoPatternScale` (`GeometryControls.tsx:67-112`, written at `:132-136`): tiled mode targets a hardcoded 10 mm unit width, placed mode 50% of `baseSize − 2·margin`. A generator emitting mm-correct geometry is silently rescaled.

---

## 4. The real contracts

### 4.1 The five §5 contracts, mapped

| §5 name | Reality | Where it attaches |
|---|---|---|
| `Polygon` | **Must be pinned, not created.** Main thread: `THREE.Shape` (+ `{shape,color}` wrapper, + `THREE.BufferGeometry` for the pattern slot). Wire: `SerializedShape { points: number[]; holes: number[][] }` — `src/utils/geometry/serialize.ts:15-18`. CSG: `Vec2[][]`. | Convert with `serializeShapes`/`deserializeShapes` (`serialize.ts:34-50`, `:61-72`). Do not add a fourth main-thread form. |
| `Outline` | **Exists as `BaseSettings.cutoutShapes`** — `ThreeShapeSchema.nullable().optional().default(null)`, `src/types/schemas.ts:14`, where the schema asserts only `Array.isArray` (`:7`). | Set via `handleOutlineLoaded` (`src/components/controls/BaseControls.tsx:31-38`). Reaches the clip only after the split at `src/components/ImperativeModel.tsx:158-237`. |
| `ShapeSource` | **Must be created**, named after the three de-facto producers that already share an informal contract: `parseShapeFile` (`src/utils/shapeLoader.ts:12`), `traceImage` (`src/utils/image/traceImage.ts:179`), `SVGPaintModal.onSave` (`src/components/SVGPaintModal.tsx:76`). Truthful shape: `produce(): Promise<Array<THREE.Shape \| {shape;color}>>`, no seed, no outline. | Output lands in `geometrySettings.patternShapes` (precedent `handlePatternLoaded`, `src/components/controls/GeometryControls.tsx:114-141`) or `InlayItem.shapes` (`src/components/controls/InlayControls.tsx:118-133`). |
| `Generator<P>` | **Must be created.** No framework, registry or typed params. But `generateTilePositions` (`src/utils/patternUtils.ts:285-299`) is the existing parametric engine to generalise, and zod `.default()` on a flat schema is a working defaults mechanism that fits the persistence path unchanged. | Params attach to `GeometrySettingsSchema` (`src/types/schemas.ts:66-85`); every field needs `.default()` because `getDefaults` is `schema.parse({})`. |
| `DesignState` | **Exists as `ProjectSchemaV1` → `ProjectData`** (`src/types/schemas.ts:87-96`) over three sibling `useState` objects (`src/App.tsx:15`, `:18`, `:21`). Not a uniform `sources` array; not a URL; not the unit of undo. | Extend it. `outlineRef` needs `PatternPreset.id` first (`src/components/PatternLibraryModal.tsx:8-15`). A V2 needs a working discriminator — the existing one is dead code (`src/utils/projectUtils.ts:179-188`). |

### 4.2 Corrected §5 rules

**Rule 1 — geometry emission.**
> Emit geometry in the representation belonging to your layer and convert only at the existing seams. For a new pattern source that means `THREE.Shape[]` into `geometrySettings.patternShapes`; the pipeline serialises for you at `src/components/ImperativeModel.tsx:836`. Emit millimetres — only DXF import normalises units today (`src/utils/dxfUtils.ts:59-81` is the sole worked example), so a source with its own unit system must convert itself. Leave rings **implicitly closed**: do not append a duplicate first point. Keep every ring to at least 3 vertices; below that it is silently dropped at `src/utils/geometry/manifoldOps.ts:86`.

**Rule 2 — do not re-implement the core.**
> Never re-implement clipping, offsetting or extrusion. There is no directly callable 2D clip stage to feed: a shape source joins by becoming `SerializedShape[]` inside a job. The engine is manifold-3d `CrossSection` (Clipper2 in wasm — `node_modules/manifold-3d/manifold-encapsulated-types.d.ts:96-98`), entered at `csFromShape`/`csFromShapes` (`src/utils/geometry/manifoldOps.ts:85`, `:91`), `simplifiedCs` (`:108`), `cachedCutterSolid` (`:128`), with the only polygon offset at `:151`. The order is **extrude → compose → clip** (`src/utils/geometry/patternPipeline.ts:139`, `:236`, `:269`), not the reverse. The Base plate is the exception — main-thread `THREE.ExtrudeGeometry`, never booleaned (`src/components/ImperativeModel.tsx:447-451`). `clipper-lib` is dead; do not target it, and do not be fooled by the same-named local `offsetShapesFor` at `src/components/controls/InlayControls.tsx:30`.

**Rule 3 — tunables.**
> Anything a user can tune **that changes the geometry** must live in one of the three settings schemas (`src/types/schemas.ts:10-17`, `:50-64`, `:66-85`) and therefore in `ProjectSchemaV1`. View-only state — camera, opacity, wireframe, display mode, debug overlays — stays local and is explicitly out of scope; the boundary is already inconsistent (`debugMode` is persisted at `:84` yet reachable only by a Ctrl+Shift+D handler) and must not be widened silently. Note zod executes at exactly two runtime points — `schema.parse({})` for defaults (`src/utils/schemaDefaults.ts:6-12`) and `safeParse` on import (`src/utils/projectUtils.ts:183`) — so "validates with zod" means "round-trips", not "is checked when set". Give every new field a `.default()`.

**Rule 4 — determinism.**
> Randomness must be seeded. **This is new work that changes existing behaviour, not a property to preserve.** `Math.random()` appears at exactly three sites, all in `generateTilePositions` (`src/utils/patternUtils.ts:464`, `:504-505`), behind two already-persisted enum values (`src/types/schemas.ts:79`, `:81`, `:41`) — so saved designs already re-render differently on every load. A seed must reach **two** placement sites: the worker path via a new `PatternJob.seed` field (`src/utils/geometry/patternPipeline.ts:51-82`, consumed `:184`) and the main-thread inlay path (`src/components/ImperativeModel.tsx:254`). The inlay worker needs none — it consumes pre-resolved coordinates (`src/utils/geometry/inlayPipeline.ts:30`). Do not mistake `rotationClamp` (`patternPipeline.ts:193-195`) for a seeding mechanism. Seeding alone does not make a design reproducible *from its saved form*: export nulls the geometry and reproduction depends on the exact binary assets travelling in the zip.

**Rule 5 — heavy compute.**
> Heavy geometry goes in the existing worker; do not create a second one without a stated reason (`getManifold` memoizes per realm — `src/utils/geometry/manifoldModule.ts:15` — so a second realm means a second 541 KB wasm compile). `src/workers/` holds one file with a **closed** union `'pattern' | 'inlay' | 'warmup'` (`src/workers/geometryWorker.ts:21-24`); a third kind means five edits (`patternClient.ts:17`, `:31-32`, `:63`, `:97-105` plus the worker dispatch), and a polygon-only kind must be handled *above* `await getManifold()` at `:35` or it pays the wasm compile for nothing. **Hard constraint:** job payloads must be structured-cloneable — a `DataCloneError` at `patternClient.ts:66-67` permanently wedges all generation for the session. **Hard constraint:** every wasm object must be tracked and freed (`manifoldOps.ts:49-72`, `finally { ops.flush() }` at `patternPipeline.ts:369-371`), and objects produced in an unbounded loop must never be cached (`manifoldCache.ts:94-104`). Failure is silent — the worker's catch posts an empty result and no consumer reads the `empty` flag.

**Rule 6 — mergeability.**
> Keep diffs upstream-mergeable. A merge-base exists (`.git/config:8-10`, `.git/HEAD:1`). Accept that folder isolation is **not** achievable for the planned features and budget single-line insertions into these shared files: `src/types/schemas.ts` (+ `src/utils/schemaDefaults.ts:10-12`); `src/App.tsx:15-21` and `:36`; `src/components/Controls.tsx:30-31`, `:358-361`, `:370-406`; `src/workers/geometryWorker.ts:21-24` and `src/utils/geometry/patternClient.ts:17`/`:31-32`/`:63`; `src/utils/patternUtils.ts:285` (shared by both threads — rule 5 and rule 6 collide here); `src/components/ImperativeModel.tsx:897-903` (a new setting omitted here never triggers regeneration); `vite.config.ts:30-35` (coverage allowlist, or new code reports zero silently). **Never reformat** — no Prettier or EditorConfig exists, indentation is mixed across files and *within* `src/utils/geometry/patternPipeline.ts`. Before deploying a fork: add an `origin` remote (`gh-pages` defaults to `remote: 'origin'` and only `upstream` exists) and delete `public/CNAME`, which names the upstream author's domain.

---

## 5. Gaps to fill

Deduped, grouped by target doc. "Core" = the clip/extrude worker pipeline §10 protects.

### 01 — pad outline library (hardening; the picker ships)

| Gap | Build on | Integration point | Core? | Effort |
|---|---|---|---|---|
| Stable `id` on `PatternPreset` — blocks `outlineRef` everywhere | `preset.file` is already a unique de-facto key (`PatternLibraryModal.tsx:162`) | `src/components/PatternLibraryModal.tsx:8-15`, then all 43 rows at `:19-65` | no | S |
| Persisted outline provenance | `InlayItemSchema.name` is the working precedent (`schemas.ts:21`) | `src/types/schemas.ts:14-17` — **must carry `.default()`** | no | M |
| Error surfacing for a zero-shape DXF | `useAlert` already imported and used (`BaseControls.tsx:86-90`) | `src/utils/shapeLoader.ts:79`; check 5 other `parseShapeFile` callers | no | S |
| Attribution for the 8 outlines lacking `infoUrl` | render path exists (`PatternLibraryModal.tsx:199-210`) | `:53`, `:54`, `:55`, `:57`, `:61`, `:62`, `:64`, `:65` | no | S |
| Reset rotation/mirror on outline swap and clear | — | `src/components/controls/BaseControls.tsx:31-38`, `:48-52` | no | S |
| Cache the DXF thumbnail parse (17 synchronous re-parses per modal open) | worker exists but needs a new kind; a module-level Map is the cheap half | `src/components/DXFThumbnail.tsx:30`; gate at `PatternLibraryModal.tsx:92`, `:243` | no | S→M |
| Decouple camera/screenshot framing and inlay tiling from `size` | `patternPipeline.ts:164-171` already models the right behaviour | `src/components/ImperativeModel.tsx:248`, `:259`; `src/components/ModelViewer.tsx:441-442` | inlay geom | M |
| Outline-quality diagnostics (the data is already `console.log`ged) | `dxfUtils.ts:248`, `:362`, `:368`, `:390` | add a **sibling export** beside `src/utils/dxfUtils.ts:428`; do not change the 2 existing callers | no | M |

### 02 — generator engine

| Gap | Build on | Integration point | Core? | Effort |
|---|---|---|---|---|
| A non-file entry point into `patternShapes` (all 3 writers are file-derived) | `handlePatternLoaded` is already file-agnostic; the adornment slot hosts the library button | `src/components/controls/GeometryControls.tsx:114`, `:164-174` — and bypass the auto-scale overwrite at `:132-136` | no | S |
| Generator params + registry (schema is flat; no params object, no discriminator) | zod `.default()` + `getDefaults` round-trips unchanged | `src/types/schemas.ts:66-85`. `patternType` widening is **optional** — the pipeline never reads it | no | M |
| Regeneration trigger for new params | — | `src/components/ImperativeModel.tsx:897-903` (already broken for 3 debug props) | yes | S |
| Worker-side generation (closed 3-kind union; a new kind below `:35` pays the wasm compile) | generic pump at `patternClient.ts:60-84`; warmup shows the above-the-await pattern at `geometryWorker.ts:30-33` | `src/workers/geometryWorker.ts:21-24` + 4 client sites | yes | M |
| Structured-clone-safe param contract | `PatternJob` is the worked example (`patternPipeline.ts:51-82`) | `src/types/schemas.ts:66` | yes | S |
| Failure surfacing (`empty` flag exists and is read by nobody; onerror wedges the spinner) | `AlertContext` already used for load failures | `src/utils/geometry/patternClient.ts:42`; `src/utils/geometry/applyPatternResult.ts:67` | yes | S |
| A shape-source abstraction (duck-typed `s.shape \|\| s` at 13 sites) | 3 existing producers already share an informal contract | `src/utils/shapeLoader.ts:12` | no | M |

### 03 — concrete generators

| Gap | Build on | Integration point | Core? | Effort |
|---|---|---|---|---|
| Synthesis primitives (zero noise/Delaunay/contour deps or code) | placement engine already exists | `src/components/controls/GeometryControls.tsx:114` → `patternPipeline.ts:47-48` | no | L |
| Decimation for a generated unit (deliberately excluded today) | `simplifiedCs` (`manifoldOps.ts:108-112`), `CUTTER_TOLERANCE` | `src/utils/geometry/patternPipeline.ts:138` — must be opt-in per unit kind | yes | S |
| Whole-field (non-tiled) output: unit is recentred, XY-rescaled by `patternScale`, and Z-lifted | `isTiled:false` already collapses placement to one identity instance | `src/utils/geometry/patternPipeline.ts:143-149`, `:206`, `:208-209` | yes | M |
| Per-cell variant / per-polygon height (single `patternUnit`, scalar Z only) | `TileInstance` already carries per-instance rotation; per-position height is the cheap design | `patternPipeline.ts:73`, `:40-45`; `src/utils/geometry/applyPatternResult.ts:71-87` | yes | M–L |
| Complexity ceiling + tiler cap (uncapped lattice can hang the worker) | measured ratio ≈3.5 tri/point; 48k-triangle worst case documented | `src/utils/patternUtils.ts:478-479`, `:684-696`; budget from `manifoldOps.ts:24-46` | yes | S |
| Bundle splitting (one 1,852,436-byte chunk, no `manualChunks`) | — | `vite.config.ts:6-23` | no | S |

### 04 — parametric controls

| Gap | Build on | Integration point | Core? | Effort |
|---|---|---|---|---|
| `<ParamField descriptor>` renderer | `SegmentedControl.tsx:16-43` already renders from an `options` array — the precedent | new `src/components/ui/ParamField.tsx` beside `ControlField.tsx:14` | no | M |
| Param metadata channel — **must support derived bounds**, not literals | `getDefaults` is the only existing reflection | new file; must handle `InlayControls.tsx:56`/`:76-85`/`:656-664` (maxDepth from another tab) | no | M |
| Slider primitive (zero `type="range"` in the controls tree; 3 divergent styles in modals) | best-formed template `ImageConversionModal.tsx:133-142` | new `src/components/ui/Slider.tsx` | no | S |
| 4th tab | `<Freeze>` pattern | `src/components/Controls.tsx:397`; widen `:30-31` + `src/App.tsx:36`; extend `:358-361` | shared | S |
| Numeric commit contract (clamped values never echo back) | `DebouncedInput.test.tsx:6-48` has fake timers set up | `src/components/DebouncedInput.tsx:28-40` (17 call sites — needs a regression test; the numeric path is currently untested) | shared | S |
| ProjectSchemaV2 + working migration (current branch is unreachable) | `ProjectSchemaV1`, `safeParse` | `src/utils/projectUtils.ts:179-188` | no | M |
| URL/JSON share (zero URL-state APIs; only storage key is the welcome flag) | `ProjectSchema.safeParse` reusable as the gate | `src/utils/projectUtils.ts:87`; button slot `src/components/Controls.tsx:280-299` | no | L–XL |
| Accessibility baseline (net-new: no aria, no roles, no Escape pattern to copy) | `ControlField` fixes all 27 fields at once | `src/components/ui/ControlField.tsx:24-41`, then the two pickers | shared | L |
| Lift `projectAssets` out of `Controls` | — | `src/components/Controls.tsx:81` (3 handlers + import assignment) | no | S |
| Extend `PatternLibraryModal` rather than adding a picker | category filter + thumbnails + attribution all exist | `src/components/PatternLibraryModal.tsx:12`, `:72`, `:17-66` | shared | S |

### 05 — direct editing (split)

| Gap | Build on | Integration point | Core? | Effort |
|---|---|---|---|---|
| **05a** Fix lossy paint-modal edits (move/duplicate drop `shape.holes`) | the file's own text tool does it correctly at `SVGPaintModal.tsx:531-548` | `src/components/SVGPaintModal.tsx:459-472`, `:257-264` | no | S |
| **05a** Non-destructive edit representation + persistence | `serialize.ts:14-72` is the worker-proven, hole-aware round trip | `src/types/schemas.ts:22`; `src/utils/projectUtils.ts:48-50` ↔ `src/components/Controls.tsx:206-231` | no | M |
| **05a** 3D pick / hit-test against real geometry | `buildPolyIndex`/`pointInIndex` (`patternUtils.ts:114-200`) — note it tests the outer ring only | `src/components/ModelViewer.tsx:503` (sibling mount). OrbitControls owns every mouse button (`:450-454`) | no | M |
| **05b** Region identity on the pattern (compose fuses all tiles) | inlays already have stable `Inlay_<id>_<tile>_<shape>` naming + by-name re-addressing | `src/utils/geometry/patternPipeline.ts:236` | yes | XL |
| **05b** Node/vertex editing (100% greenfield) | constant-pixel handle at `InlayInteractionHandles.tsx:24-95`; screen→SVG converter at `SVGPaintModal.tsx:281-292` | `src/components/SVGPaintModal.tsx:341-381` | no | L |
| App-level undo | `SVGPaintModal.tsx:155-182` (ref-based; needs converting to state) | `src/App.tsx:15-21` | no | M |
| Main-thread 2D booleans | `offsetUtils` is complete-but-dead; `getManifold` on main thread = second wasm instance | `src/utils/offsetUtils.ts:7` or `manifoldModule.ts:17-27` | no | M |

### 06 — flat export (split)

| Gap | Build on | Integration point | Core? | Effort |
|---|---|---|---|---|
| **06a** Outline flat export | raw `cutoutShapes` (holes + curves intact) is already extruded at `ImperativeModel.tsx:449-451`; `OutputPanel` is built in `App.tsx` | `src/App.tsx:107-113` + `src/components/OutputPanel.tsx:9-13`; button at `:241` | **no** | S |
| **06a** SVG *document* writer (existing helper emits only `d`, merges all shapes into one path) | `generateSVGPath` (`dxfUtils.ts:469-493`) — build on, do not modify (3 consumers + a pinned test) | new module; viewBox convention at `DXFThumbnail.tsx:55` | no | M |
| **06a** DXF R12 writer (`dxf-parser` is read-only) | contours are already closed polylines | new module. Dedupe the terminal duplicate vertex | no | M |
| **06a** Orientation/nesting normalization | neither point-in-polygon helper is exported; the nesting algorithm is buried in `parseDxfToShapes` | extract from `src/utils/dxfUtils.ts:399-427` | no | M |
| **06a** Refuse to export the 300 mm fallback square | — | `src/components/ImperativeModel.tsx:163-174` | no | S |
| **06b** Post-clip contour readback at **two** sites | `CrossSection.toPolygons()`, `Manifold.project()`, `Manifold.slice()` all ship in 3.5.1 and are exercised by `manifoldCache.test.ts:167` | `src/utils/geometry/patternPipeline.ts:358` **and** the instanced early return `:223-229`; before the mask subtract at `:354` | **yes** | M |
| **06b** Widened result protocol or a `kind:'flat'` request | `PatternResult`/`patternResultTransferables` | `patternPipeline.ts:84-100` or `geometryWorker.ts:21-24` + `patternClient.ts:97-105` | **yes** | S |
| **06b** Choose `project()` vs `slice(z)` semantics (different files) | — | doc decision | yes | S |
| Kerf / blade-offset compensation | `CrossSection.offset` exists but is used only for design margin | new module, applied before `toPolygons()` | no | S |
| Explicit flattening tolerance — **must also land at import**, since SVG curves are destroyed by `centerShapes` and CW DXF rings by the winding rebuild | `serialize.ts:29-32` documents the default | `serialize.ts:36`; `patternUtils.ts:961-985`; `dxfUtils.ts:395` | yes | M |

### 07 — text / image sources

| Gap | Build on | Integration point | Core? | Effort |
|---|---|---|---|---|
| Extract text-to-outline into a real module | glyph→ShapePath→toShapes at `SVGPaintModal.tsx:32-62` is correct; do **not** carry over the 32/16-division re-sampling at `:531-548` | `src/components/SVGPaintModal.tsx:32`, `:644-667` → new `src/utils/text/` | no | M |
| Self-host the 9 preset fonts (runtime jsDelivr fetch); drop `.woff2` from the accept string | preset table is plain data | `src/components/SVGPaintModal.tsx:18-29`, `:672`; `Asset['type']` needs widening at `src/utils/projectUtils.ts:16` | no | M |
| Persistence for shapes with no source file (**the real blocker**) | `serializeShape`/`deserializeShape`; the app already warns with unfollowable advice | `src/components/controls/InlayControls.tsx:131` **and** `:152` (two gates); `src/utils/fileTypeSniffer.ts:3` has no image case | yes | L |
| Route both producers into the pattern lane | pipeline already accepts 2D shapes | `src/components/controls/GeometryControls.tsx:163` (STL gate) and `:86` (missing `s.shape \|\| s` unwrap — throws on wrappers) | no | M |
| A named colour-carrying shape type (3-member union, 13 unwrap sites, 4 spellings) | `InlayJobShape`, `TracedBandShape` | `src/utils/shapeLoader.ts:6-10`; `src/types/schemas.ts:22`, `:8` | yes | M |
| Lift modal-local source params into the schema | `InlayItemSchema` | `src/types/schemas.ts:19-46`; params at `ImageConversionModal.tsx:54-56`, `SVGPaintModal.tsx:114-115`, `:512-514` | yes | M |
| Worker route for tracing | `loadDownsampledImage` **already** produces a standalone transferable buffer for exactly this (`imageUtils.ts:23-24`); no OffscreenCanvas needed | `src/workers/geometryWorker.ts:21-24`; `patternClient.ts:99` needs a matching arm | yes | M |

### Cross-cutting (no single doc owns these)

Seeded PRNG (§4.2 rule 4) · export readiness gate · min-feature clamp at `patternPipeline.ts:138-139` · `SHARP_ANGLE` documented as fixed · deterministic `mergeByColor` ordering · typecheck/lint gates (19 pre-existing tsc errors recorded in `docs/_source/baseline-verification.md`) · base-aware asset URLs (8 sites) · delete `offsetUtils` + `clipper-lib` + `lodash`.

---

## 6. Revised roadmap

### M0 — Contract correction and deploy safety (doc edits + deletions)

Rewrite §4.1/§4.2/§5 rule 2/§9 item 1 to name `ManifoldOps` and show extrude→compose→clip. Repoint §5 preamble and §9 away from `src/types.ts` and `src/context`. Pin `Polygon` to `SerializedShape`, restate closure and scope mm. Restate §7's centroid claim. Delete `src/utils/offsetUtils.ts`, its test, `src/types/clipper-lib.d.ts`; drop `clipper-lib`, `lodash`, `@types/lodash` from `package.json`. Delete `public/CNAME`; add an `origin` remote.

**Exit:** no doc section describes clipper-lib as live; §4.2 shows extrude before clip; §9 item 1 names `SerializedShape` and `csFromShapes`; `grep -rni clipper src/ package.json` is empty; `git remote` lists an `origin`; the 21-file suite is still green.

*Rationale:* seven child docs are told to conform to §5. Leaving it wrong multiplies the error sevenfold, and the fix is a doc edit plus three deletions.

### M1 — Identity and provenance (01 hardening; parallel)

`PatternPreset.id`; `outlineRef` on `BaseSettingsSchema` with a `.default()`; zero-shape DXF error; the 8 missing `infoUrl`s + a NOTICE; rotation/mirror reset; thumbnail parse cache.

**Exit:** all 43 presets carry an `id`; `getDefaults(BaseSettingsSchema)` still succeeds and `schemaDefaults.test.ts` passes; select-library → export → import restores the preset name instead of "Custom Drawing"; `shapeLoader.ts:79` returns `success:false` on zero shapes and the other five callers still behave; loading pad A rotated then picking pad B leaves rotation 0; opening the library twice parses each DXF once.

### M2 — Determinism (**blocks every reproducibility claim**)

PRNG module; 14th `seed` parameter on `generateTilePositions`; `seed` on `GeometrySettingsSchema` and `InlayItemSchema`; `seed` on `PatternJob` + `buildJob` + the dep array; thread it through the main-thread inlay call; first reproducibility assertions.

**Exit:** `grep -rn 'Math\.random' src` (excluding tests) is empty; all 15 existing `generateTilePositions` call sites still compile; `InlayJob` is **unchanged**; a test calls the tiler twice with the same seed and deep-equals the `TileInstance[]` (replacing today's `length > 0`); a second test compares two identical `PatternJob`s' instanced matrices **with a tolerance**, not byte-exactly.

*Ordering change:* moves ahead of 02/03. It is not additive — two persisted enum values already violate rule 4 — and retrofitting a seed into a shipped generator is worse than designing with one.

### M3 — First generator through the real seam (02 + one from 03)

**Exit:** a generator writes `THREE.Shape[]` into `patternShapes` and `buildJob` takes the `kind:'shapes'` branch — the first production use of it; every new param is in the dep array (verified by changing each and observing regeneration); the auto-scale overwrite at `GeometryControls.tsx:135` is bypassed or gated; clip/holes/height-cut/masks work with zero edits to `patternPipeline.ts:258-366`; STL and 3MF work with zero edits to `OutputPanel.tsx`; if a worker kind is added it is handled above `await getManifold()` and all four client sites are updated; every job value is structured-cloneable.

### M4a — Outline flat export (shippable early; parallel with M2/M3)

**Exit:** `OutputPanelProps` takes `cutoutShapes` + mirror + rotation, passed at `App.tsx:108-113`; **`Controls.tsx` is unchanged**; a flat button renders beside Merged STL; `generateSVGPath` is byte-identical and its three consumers plus `dxfUtils.test.ts:223-256` still pass; the exporter refuses when `cutoutShapes` is empty rather than emitting the 300 mm square; mirror/rotation are re-applied by the exporter from a single extracted helper (not a fourth copy); terminal duplicate vertices are dropped before a closed LWPOLYLINE; a round-trip test compares shape, not absolute coordinates.

*Ordering change:* moves from position 5 to early. It needs no generator and no core change, and delivers §3's second physical output.

### M4b — Pattern footprint (**requires a §10 amendment**)

**Exit:** §10 is amended to carve out an additive read-only result channel; contours are produced at **both** `patternPipeline.ts:358` and the instanced early return `:223-229`, before the mask subtract at `:354`; either the result type is widened or a `kind:'flat'` request is added (prefer the latter — the pattern queue coalesces and would silently drop an export riding the preview job); the chosen `project()` vs `slice(z)` semantics are documented; no main-thread Manifold instantiation.

### M5 — Controls, sharing and breadth (04 → 07 → rest of 03 → 05a)

**Exit:** `ParamField` renders from a descriptor and supports a bound expressed as a function of state (verified against the cross-tab `maxDepth` case); a Generate tab exists with the union widened in both places, and its mount-effect timing is understood (panels do not mount until first visited); `ControlField` associates labels for all 27 fields; a v2 bundle imports **and** a v1 bundle still loads via a migrate step; a share link reproduces a design using a *library* outline plus scalars plus a seed (custom uploads explicitly out of scope absent an inline geometry encoding); `src/utils/text/` exists and fonts load from `public/`; a painted or traced inlay survives export→import and the "Missing Asset Files" warning no longer fires for it; paint-modal move/duplicate carry `shape.holes`.

### Ordering changes and why

| Change | Reason |
|---|---|
| 01 leaves the critical path | The picker ships; only `PatternPreset.id` is a downstream dependency. |
| M0 inserted before all build work | §5 is wrong and seven docs conform to it. Cost: a doc edit. |
| Seeding moves to the front | Blocks rule 4, §3's reproducibility goal, §7's cache directive, 04's seed control, and any flat export that re-derives placement. Not additive. |
| 06 splits; 06a moves early | Outline export needs no core change and is one prop away. |
| 06b moves last, gated on a §10 amendment | The only workstream that must edit the worker pipeline. |
| 07's extraction half moves ahead of 05 | `traceImage` is the best existing ShapeSource template, and its persistence hole is the same one 05's edits fall into. |
| 05 moves last and splits | 05a is M-sized and partly built; 05b is blocked on the pattern having no polygon representation. Consider dropping 05b. |
| 04's param UI decouples from its serialization | The renderer needs nothing; serialization is blocked on JSON geometry and a dead migration path. |

**Blocked-by:** `outlineRef` ← `PatternPreset.id` (M1). Generator reproducibility ← seed (M2). DesignState hash ← seed (M2). URL share ← `outlineRef` + an inline geometry encoding. 06b ← §10 amendment. 05b ← a polygon representation for the pattern that does not exist. Typecheck gate ← fixing 19 pre-existing errors.

---

## 7. Answers to the open questions

### Q1 — Multiple simultaneous shape sources, or one at a time?

**Not settled by the code — it ships both models, on different tabs.** The Inlay tab is a full instance manager: `items: InlayItem[]` (`src/types/schemas.ts:50-64`) with per-item transform, tiling mode and a cut/mask/avoid modifier (`:32`), a drag-reorderable list with select and delete (`src/components/controls/InlayControls.tsx:199-268`), `updateItem(id, partial)` (`:90-95`), selection lifted to `src/App.tsx:24`. Reorder is load-bearing — index drives depth bias and mask precedence.

But the slot a Generator feeds is the **pattern** slot, and that is strictly single-source: one `patternShapes` array plus one `patternType` (`:67-68`), one uploader (`src/components/controls/GeometryControls.tsx:145-175`), replaced wholesale on load (`:132-136`). Downstream it is single all the way: `PatternJob` carries exactly one `patternUnit` (`src/utils/geometry/patternPipeline.ts:73`) stamped at every position (`:232-236`), and the instanced path returns one unit geometry plus a matrix array (`:40-45` → `src/utils/geometry/applyPatternResult.ts:71-87`).

**Recommendation:** start one-at-a-time for the pattern slot — it matches the pipeline and costs nothing. Clone the inlay instance-manager when layering is wanted. Widening to N units requires changing `patternUnit`, `InstancedPart` and `applyPatternResult`, or forcing `useCSG`.
**Confidence: HIGH. Human call still needed** — how ambitious the generator model should be is a product decision.

### Q2 — `leva` vs native Tailwind?

**Native — the premise is inverted.** leva is in neither `package.json:17-66` nor `pnpm-lock.yaml`, while the native layer is written and already assembles all three tabs. leva would be *slower*: every param commits through three prop-drilled `useState` objects (`src/App.tsx:15-21`, 15 props into `Controls` at `:92-114`) so a leva store needs a bridge back into those setters; `tailwind.config.js:4-7` is `theme:{extend:{}}` with `plugins:[]` so there is no token layer to theme a third-party panel against; and the UI is three `hidden`-toggled panels in one scroll column (`src/components/Controls.tsx:370-406`), not a floating overlay.

Reframe as: *how much of the existing native layer becomes data-driven?* `SegmentedControl.tsx:16-43` already renders from an `options` array and is the precedent to extend — but the descriptor must support **derived** bounds (`src/components/controls/InlayControls.tsx:56`, `:76-85`, `:656-664`).
**Confidence: HIGH. No human call needed.**

### Q3 — Pre-parsed JSON vs runtime DXF parse?

**Already decided and shipped: runtime fetch + parse** (`src/components/controls/BaseControls.tsx:72-79` → `src/utils/shapeLoader.ts:71`). Keep it. Both stated tradeoffs are inverted:

- **Repo size argues against JSON.** The codebase records a typical grip outline at 4761 flattened contour points (`src/utils/geometry/manifoldOps.ts:27-38`); `xrstock.dxf` is 21.7 KB on disk, so the same outline as a flat point list is several times larger as JSON.
- **Fidelity is not a tradeoff at all.** `extrudeSettings = { depth, bevelEnabled: false }` (`src/components/ImperativeModel.tsx:447`) sets no `curveSegments`, so `ExtrudeGeometry` defaults to 12 and calls `shape.extractPoints(12)` — the identical sampling used for the clip contour at `:180`. A pre-parsed library sampled at `getPoints(12)` produces a byte-identical base mesh.

The one real cost is main-thread parse, currently paid badly: the modal returns null when closed and the thumbnail cache is gated to `category === 'patterns'`, so all 17 thumbnails re-parse synchronously on every open. Fix that with a module-level cache, not by pre-parsing.
**Confidence: HIGH. No human call needed.**

### Q4 — Separate pads or one full-board outline?

**Separate — one pad footprint per preset, as shipped.** Raw vertex extents were measured for all 17 files (excluding ARC/CIRCLE/ELLIPSE centre points, which skew the box badly): 206.1×173.4 mm (pint) to 255.3×233.9 mm (gtkushwide), plus `gtlowboyflared` at 10.1×8.3 inches = 256×211 mm — that file alone has no `$INSUNITS` and takes the `$MEASUREMENT===0` inch branch, so both tiers of the unit code are exercised by the shipped catalog. A Onewheel deck is ~640–700 mm; none of these is a full-board span.

The pipeline is agnostic: `parseDxfToShapes` returns disjoint regions as separate top-level shapes with nested regions auto-attached as holes (`src/utils/dxfUtils.ts:410-427`), and `ExtrudeGeometry` accepts the array. Two caveats argue for keeping pads separate: the green overlay renders only `cutoutShapes[0]` and only its outer ring (`src/components/ModelViewer.tsx:517-533`), and camera/screenshot framing comes from `size` rather than the outline, so the view is already over-framed for every shipped pad.
**Confidence: HIGH. No human call needed.**

---

## 8. Unknowns and residual risk

| Unknown | Why it could not be settled | What would settle it |
|---|---|---|
| **Is manifold-3d deterministic across runs?** Rule 4's chain depends on it. | The claim rests on a string scan of `manifold.wasm`, which has no name section — a compiled LCG or mt19937 emits no matching string. `manifold.js` is only Emscripten glue. | Run the same `PatternJob` twice in Node and compare output buffers byte-for-byte; repeat across two manifold-3d patch versions. |
| **Does the React Compiler memoize `DebouncedInput`'s inline `onChange` callbacks?** Determines whether the 150 ms timer restarts or whether a clamped value settles into a stale display or a re-fire loop. | Requires building; `babel-plugin-react-compiler` is configured (`vite.config.ts:8-14`) but its output cannot be read statically. | Build and inspect the emitted component, or add a render-count assertion to `DebouncedInput.test.tsx`. |
| **Exact count and nature of the pre-existing `tsc` errors.** Sizes the "add a typecheck gate" task. | Sourced from `docs/_source/baseline-verification.md` (19 errors: 15 unused, 4 missing globals, 1 real — `OutputPanel.tsx:125`, DataView→BlobPart). Individual sites verified statically; the count is second-hand. | `npx tsc -p tsconfig.app.json --noEmit`. |
| **Whether the git baseline predates the audit.** Affects whether "mergeable with upstream" is a fact or a moving target. | `.git` mtimes are ~1 hour before the audit; `git` was unavailable so only plumbing files were read. | `git log --oneline -5`, `git merge-base HEAD upstream/master`. |
| **Actual DXF→triangle cost for a real generated field.** The complexity budget (≈20k nominal / 48k ceiling triangles, ≈950/2300 Voronoi cells) is derived from in-repo measurements, not from running a generator. | Nothing could be executed. | Instrument `generatePattern` and time a 500/1000/2000-cell field end to end. |
| **Whether `computeSharpNormals` degrades on high-valence generated meshes.** Its perf test builds an *unwelded* mesh (identity index, valence 1), so the union-find that scales with valence is never exercised, and the 2000 ms bound is ~40× looser than the linear claim needs. | Static reading of `normals.test.ts:200-233` against `normals.ts:107-160`. | Re-run that test with `weld()` applied, at 4000 boxes. |
| **The 60° `SHARP_ANGLE` boundary case.** `dot >= cosLimit` welds *at* the threshold, contradicting the module's own docblock, and hexagonal cells sit exactly on it. No test pins it. | Float rounding decides; unresolvable by reading. | A test at exactly 60°, plus a rendered hex-stud pattern. |
| **`~100 lines` for an R12 DXF writer** and **`~5800 ms`-class costs for specific generator outputs.** | Both are estimates, not measurements. The first was flagged as such by its own verifier; the second is measured only for the shape the normals docblock describes. | Write the writer; benchmark the generator. |
| **Whether a `pointercancel`-stranded drag actually persists.** If it does, the app exports a wrong material count indefinitely. | No `pointercancel`/`lostpointercapture` handler exists anywhere in `src`, and `isDragging`/`previewInlay` are only cleared in `handleWindowUp`. Reasoning is sound but untested. | Interrupt a drag (alt-tab, touch cancel) and export a 3MF. |

**Where dimensions disagreed, and the resolution.** Twelve conflicts were adjudicated; the six that matter for the rewrite: (1) the base mesh does *not* preserve curves — both the mesh and the clip contour sample at 12 divisions — but raw `cutoutShapes` is still the only re-samplable form and the right flat-export source; (2) the paint modal's "mm" font-size slider is **not** mm, because the viewBox is fit to existing layer content and only defaults to 500×500 when empty; (3) `calculateItemPositions` runs at most **three** times per item across two effects, never four, because two call sites are behind mutually exclusive modifier gates — which also proves `inclusionShapes` is permanently empty; (4) there are **six** live geometry representations, not three or four, and the `THREE.BufferGeometry` case is the load-bearing one; (5) the instanced fast path requires the user to switch clipping **off**, not merely to omit an outline; (6) `mergeGeometries` cannot return null inside `mergeByColor`, so the silent colour-drop guard is dead — the real export exclusion is type-based.
