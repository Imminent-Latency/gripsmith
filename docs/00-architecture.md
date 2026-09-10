# GripSmith — Architecture & Design Overview

**Doc ID:** 00-architecture
**Status:** Living / source-of-truth
**Owner:** @liamstar
**Purpose:** The root design doc. Every feature doc (pad library, generator engine, controls, exports, etc.) is *derived* from this one and must conform to the contracts in §5. If a feature doc conflicts with this doc, this doc wins until amended.

**Upstream:** fork of [`techfoundrynz/grippysheet-studio`](https://github.com/techfoundrynz/grippysheet-studio) @ `master` (`cf698036f28f86e4d70c00b24a2283b5ab7d3f49`), on branch `gripsmith`.

---

## Document status

**Revision 2 — 2026-09-03.** This revision was produced from a verified audit, not from memory.

| Source | Path | What it is |
|---|---|---|
| Recon report | `docs/_source/00-recon-report.md` | 13 subsystem audits of `src/` (12,208 non-test lines), each adversarially re-verified by an independent pass, then cross-checked for contradictions. Every factual claim carries `file:line` evidence. **Ground truth.** |
| Baseline | `docs/_source/baseline-verification.md` | Verified install / test / typecheck / build state of upstream as received. |
| Revision 1 | `docs/_source/00-architecture.original.md` | The original doc, preserved. Its §1 Vision and §3 Goals survive. Most of its technical assertions were wrong; do not cite it. |

Revision 1 named `clipper-lib` as the join point for all shape sources four times. It is a dead dependency. Revision 1's pipeline diagram had the stage order backwards and omitted the Web Worker boundary entirely. Revision 1 scoped three solved problems as new work. Every factual section below has been rewritten against the code.

**Convention for this doc:** a bare `file:line` reference means the claim was read there. Any name marked **(new — does not exist yet)** is a name this doc is coining; every other identifier exists in `src/` today and can be grepped.

---

## 1. Vision

Turn the forked `grippysheet-studio` from a manual grip editor into a **procedural grip design studio**: a rider picks (or uploads) their pad outline, generates a pattern — random, fractal, cellular, or hand-tuned — with live, reproducible parameters, and exports it either as a 3D-printable mesh or as flat cut paths for vinyl/laser grip tape.

The fork adds *shape synthesis*, *reproducibility* and a *second physical output* on top of the existing pipeline. It does not rewrite the pipeline.

One sharpening from recon: the "manual editor" framing is only half right. The manual editing surfaces — the 3D transform gizmo (`src/components/interaction/InlayInteractionHandles.tsx:97-533`), the paint modal (`src/components/SVGPaintModal.tsx`), the drag-reorderable layer list (`src/components/controls/InlayControls.tsx:177-192`) — are **inlay-only**; the gizmo mounts only when `activeTab === 'inlay'` (`src/components/ModelViewer.tsx:503-515`). The **pattern** panel is already parametric. What its parameters lack is a shape to be parametric *about*: the pattern unit is an opaque uploaded 3D mesh (`src/components/controls/GeometryControls.tsx:163`).

## 2. Problem Statement

Upstream imports an outline, extrudes it, procedurally places a repeated unit across it, clips the result with 3D booleans, and previews and exports in 3D. Three of revision 1's four problems were wrong or overstated. The real gaps:

1. **No shape synthesis.** *(Revision 1 claimed "no generative pattern source". Half wrong.)* A full procedural **placement** engine ships and is substantial: `generateTilePositions` (`src/utils/patternUtils.ts:285-299`) is a 13-parameter, boundary-aware, exclusion/mask/avoid-aware placer offering 8 distributions × 4 orientations (`src/types/schemas.ts:79`, `:81`), accelerated by a Y-bucketed spatial index (`src/utils/patternUtils.ts:102-161`). What is missing is the **unit** it places. The pattern uploader is gated to `allowedTypes={["stl"]}` (`src/components/controls/GeometryControls.tsx:163`) and all 14 pattern presets are `.stl` (`src/components/PatternLibraryModal.tsx:19-32`), so every shipping path takes the `kind:'geometry'` branch at `src/components/ImperativeModel.tsx:829-830`. There is **zero** noise/Delaunay/contour code or dependency in the repo. The gap is: *synthesise the tile, or synthesise the whole field, as 2D polygons.*

2. **A design is not reproducible, not URL-shareable, and its persisted geometry is broken.** *(Revision 1 claimed "no parametric/reproducible design model". Overstated in two directions.)* Split three ways:
   - **Tweaked by number: already true.** The schemas are flat scalars (`src/types/schemas.ts:10-85`) and 17 numeric fields route through `DebouncedInput` (`src/components/DebouncedInput.tsx:18`).
   - **Saved and loaded: already true, but lossy.** `exportProjectBundle`/`importProjectBundle` write and read a JSZip of `project.json` plus raw source assets, with real buttons (`src/utils/projectUtils.ts:29-87`, `:105-199`; `src/components/Controls.tsx:281-298`). But export nulls `cutoutShapes` (`:46`) and `patternShapes` (`:53`) while spreading `inlay` **untouched** (`:48-50`) — so live `THREE.Shape` objects are stringified into the JSON. The import path calls the result "garbage" in a code comment and re-parses the zip asset instead (`src/components/Controls.tsx:222`, in the comment block `:219-224`); where no asset matches, the first `shape.getPoints()` throws.
   - **Re-derived: false, and this is the real gap.** There is no seed and no PRNG anywhere. Bare `Math.random()` appears at exactly three sites, all inside `generateTilePositions` (`src/utils/patternUtils.ts:464`, `:504`, `:505`), behind two **already-persisted** enum values (`tilingDistribution: 'random'`, `tilingOrientation: 'random'` — `src/types/schemas.ts:79`, `:81`). **A saved bundle already re-renders differently on every load.**
   - **Shared by link: false.** Zero URL-state APIs. The only `localStorage` key in the app is `welcome_modal_dismissed` (`src/App.tsx:30-33`); there is no cross-reload persistence of a design at all.

3. **No flat (2D) export path for riders who cut vinyl instead of printing.** *(Revision 1's one surviving problem.)* Exactly four download sites exist and none is vector: binary STL (`src/components/OutputPanel.tsx:125-136`), 3MF (`:206-216`), a watermarked PNG screenshot (`src/components/ScreenshotManager.tsx:110-114`), and the project `.zip` (`src/utils/projectUtils.ts:79-86`). Nuance in our favour: an SVG *path-data* generator already exists, is unit-tested and drives three thumbnail previews (`src/utils/dxfUtils.ts:469-493`; `src/utils/dxfUtils.test.ts:223-256`) — but it returns only a `d` string, with no `<svg>` wrapper, no `viewBox`, no units and no per-shape split.

4. **No default pad, and no provenance on the one you pick.** *(Revision 1 claimed "no easy way to choose a pad — every session starts with a DXF upload". This is SOLVED.)* The Outline Library ships: **17 outline presets** (`src/components/PatternLibraryModal.tsx:49-65`) with 17 matching `.dxf` files in `public/outlines/`, live DXF-rendered thumbnails, opened from a `BookOpen` adornment on the uploader (`src/components/controls/BaseControls.tsx:55-68`), and loaded through the *same* handler as an upload (`:31-38`). The residual grains of truth are small and belong to doc 01 as hardening: a fresh session starts on a synthesised `size`-square — default 300 mm (`src/types/schemas.ts:11`), user-editable on the Base tab, built at `src/components/ImperativeModel.tsx:166-173` — rather than a real pad; presets have no stable `id`, so a design cannot record which outline it used (`src/components/PatternLibraryModal.tsx:8-15`); 8 of the 17 carry no `infoUrl`; and a DXF that parses to zero shapes reports `success: true` and silently reverts to the square (`src/utils/shapeLoader.ts:79`).

## 3. Goals / Non-Goals

**Goals**
- Preserve the upstream pipeline and stay mergeable with it. (A real `upstream` remote and merge-base exist — `.git/config`.)
- Introduce a single, uniform **shape-source** abstraction (built-in pads, uploads, generators, text, images all flow through it).
- Make every design **reproducible and shareable** as data (`seed + params + outline`).
- Support **two physical outputs** from one design: 3D-printed grip and flat cut grip tape.
- Keep the whole thing client-side and deployable to GitHub Pages, like upstream.

*Amendment to goal 3, from recon:* the decomposition `seed + params + outline` is right in structure but wrong in cost distribution. `params` is real and already persisted (`src/types/schemas.ts:10-85`). `seed` is cheap and net-new (§8 M2). `outline` is the expensive third — it is explicitly nulled on export (`src/utils/projectUtils.ts:46`) and reproduction depends on the exact source bytes travelling in the zip. A link-shareable design therefore requires either a library `outlineRef` **(new — does not exist yet)** or an inline geometry encoding. See §8's blocked-by chain.

**Non-Goals**
- No backend, accounts, or remote catalog.
- No new 3D slicing/printer control.
- No AI image generation in-app.
- No breaking changes to upstream export formats.

*Amendment to non-goal 2:* "export STL/3MF and stop there" is not what ships. `exportTo3MF(merged, {})` passes an empty config (`src/components/OutputPanel.tsx:204`), so the library's Bambu Lab A1 defaults apply and are written into the file — `printer_name: "Bambu Lab A1"`, `"Bambu PLA Basic @BBL A1"`, a 256×256×256 bed and a 0.4 nozzle profile (`node_modules/three-3mf-exporter/dist/index.mjs:5-19`, merged in by `Object.assign({}, defaultPrintConfig, printJobConfig)` at `:24`, which is exactly why `{}` yields the defaults); 0.2 mm layers, 2 wall loops, 15% infill and a `filament_colour` array padded to at least 2 (`:283-310`); build item re-centred on the bed and dropped to z=0 (`:144-157`). The button already reads "Export 3MF (Bambu/Orca)". We inherit a slicer-profile opinion; the non-goal means *do not extend it*.

*Amendment to non-goal 4:* unenforceable as stated, and the real exclusion rule is not what it looks like. `prepareForExport` filters on a `Debug_` name prefix **and** on `Object3D` type and ends in `return null` (`src/components/OutputPanel.tsx:40-75`, `:52-54`, `:74`) — any `Line`, `Points` or `Sprite` added under the export group is silently dropped, any `Mesh` ships, and `object.visible` is never checked. This needs an added invariant (§7, *export readiness*), not a rewrite.

## 4. System Overview

### 4.1 Confirmed stack (do not change casually)

React 19 + TypeScript + **Vite 5** + **Tailwind 3**; **pnpm** (Corepack-pinned `pnpm@10.20.0`, `package.json:67`); **Vitest 2**; deploy via `gh-pages`. Resolved majors, read from `node_modules` and pinned in `pnpm-lock.yaml`: vite 5.4.21, vitest 2.1.9, tailwindcss 3.4.19 (classic `tailwind.config.js` + plain postcss plugin), typescript 5.9.3, react 19.2.3, gh-pages 6.3.0, jsdom 29.1.1, zod 4.2.0, three 0.182.0, manifold-3d 3.5.1.

Geometry is **millimetre-based** and expressed in **three.js scene units** at 1 unit = 1 mm; nothing scales between them (`src/components/OutputPanel.tsx:117-120` applies no transform on export, and 3MF writes `@_unit: "millimeter"` — `node_modules/three-3mf-exporter/dist/index.mjs:168`, `:236`). §7 records exactly where that convention holds and where it does not.

**The middle of the pipeline is `manifold-3d`, not `clipper-lib`.**

| Dep | Manifest | Role — verified |
|---|---|---|
| `manifold-3d` | `package.json:29` `^3.5.1` | **The entire geometry middle.** All 2D work (CrossSection construction, 2D union, 2D subtract, primitives, decimation, the codebase's only polygon offset at `src/utils/geometry/manifoldOps.ts:151`) *plus* all extrusion and all 3D CSG. Its 2D kernel is Clipper2 compiled into the wasm (`node_modules/manifold-3d/manifold-encapsulated-types.d.ts:96-98`). Entered exclusively through `ManifoldOps` (`src/utils/geometry/manifoldOps.ts:49-219`). |
| `clipper-lib` | `package.json:22` `^6.4.2` | **DEAD — slated for deletion (§8 M0).** Imported at exactly one site, `src/utils/offsetUtils.ts:2`. That module's two exports `offsetShape` (`:7`) and `unionShapes` (`:155`) are imported only by their own test (`src/utils/offsetUtils.test.ts:3`). `ClipperOffset`/`ClipperLib` return **0 hits** in both shipped bundles (`dist/assets/index-*.js`, `dist/assets/geometryWorker-*.js`). Its coordinate form is `{X,Y}` integers at `SCALE = 1000` — micrometres, not mm (`src/utils/offsetUtils.ts:5`, `:11-35`). Delete the module, its test, and `src/types/clipper-lib.d.ts`. |
| `three` / `@react-three/fiber` / `@react-three/drei` / `three-stdlib` | `:36`, `:20`, `:19`, `:38` | 3D preview, scene graph, loaders (`SVGLoader`, `STLLoader`), `ExtrudeGeometry` for the base plate and inlay placeholders. |
| `three-3mf-exporter` | `:37` `^45.0.0` | 3MF export with an embedded Bambu/Orca profile (see §3). |
| `dxf-parser` | `:24` | Outline import. **Read-only — there is no writer.** The package's entire exported surface is the `DxfParser` class plus its type interfaces (`node_modules/dxf-parser/dist/index.d.ts`), and that class exposes only `parseSync` and `parseStream` (`node_modules/dxf-parser/dist/DxfParser.d.ts:103`, `:108-109`) — verified by absence of any write API. Doc 06a must author its own R12 writer. |
| `zod` | `:40` `^4.2.0` | Schema validation for persisted design data. Executes at exactly **two** runtime points: `schema.parse({})` for defaults (`src/utils/schemaDefaults.ts:6-12`) and `safeParse` on import (`src/utils/projectUtils.ts:183`). Export is never validated. Every geometry field is an escape hatch asserting only `Array.isArray` (`src/types/schemas.ts:7-8`). `ProjectSchemaV1` is a plain non-strict `z.object`, so unknown keys are silently stripped — the central hazard for any V2 plan. |
| `imagetracerjs` | `:25` | Raster → vector. Wrapped by `traceImage` (`src/utils/image/traceImage.ts:179`), a standalone module importing only three/imagetracerjs/colorShift — the best existing `ShapeSource` template. **Inlay-only today.** |
| `opentype.js` | `:30` | Text → vector outlines. All 11 references are inside `src/components/SVGPaintModal.tsx`; the producer is module-private and welded to modal state. Fonts are fetched from jsDelivr **at runtime**. `.woff2` is in the picker's accept string and is unparseable. **Inlay-only today.** |
| `jszip` | `:26` | The project bundle format. |
| `react-freeze` | `:34` | Tab semantics — panels do not mount until first visited (`src/components/Controls.tsx:370-406`). Affects mount-effect timing for any new tab. |
| `clsx` + `tailwind-merge` | `:23`, `:35` | The `cn` helper (`src/utils/cn.ts:1-6`). Omitted by revision 1. |
| `uuid` | `:39` | Inlay instance ids (`src/components/controls/InlayControls.tsx:100`). Omitted by revision 1. |
| `react-colorful` | `:32` | Imported **once**, rendered once, inside the paint modal behind a toggle. The in-panel colour convention is instead a hardcoded 21-swatch grid duplicated verbatim in two files (`src/constants/colors.ts:1-26`; `src/components/controls/BaseControls.tsx:143-156`; `src/components/controls/GeometryControls.tsx:549-566`). Doc 04 must state which convention a colour param follows. |
| `lucide-react`, `@icons-pack/react-simple-icons` | `:28`, `:18` | Icons. |
| `lodash` | `:27` | **ZERO import sites.** Dead — delete with `@types/lodash` (`:45`). |
| `@types/uuid` | `:21` | Dead type package, and it sits in `dependencies`, not `devDependencies`. `uuid` v13 ships its own types. |
| `leva` | — | **Absent** from both `package.json` and `pnpm-lock.yaml`. See §11 Q2. |

**Source layout.** `src/{components,constants,context,types,utils,workers}`. Revision 1 also named `src/types.ts` — **that file is dead code from an ESP32 firmware flasher.** 38 lines declaring `FirmwareVariant`, `DeviceInfoData`, `FlashProgress`, `ReleaseType`, `FirmwareVersion`, `FirmwareFiles` (`src/types.ts:1-38`), with **zero importers**. It is populated with plausible TypeScript, which is exactly what makes it expensive: a reader opens it looking for the geometry types this doc promises, finds none among real-looking code, and invents the parallel representation §5 forbids. Do not open it. The real homes are:

```
src/types/schemas.ts              zod schemas + inferred settings/project types
src/utils/geometry/serialize.ts   SerializedShape / SerializedGeometry (the worker wire)
src/utils/geometry/manifoldOps.ts ManifoldOps — the only entry to the CSG kernel
src/utils/geometry/patternPipeline.ts  PatternJob / PatternResult / PatternUnit
src/utils/geometry/inlayPipeline.ts    InlayJob / InlayJobShape
src/context/                      AlertContext only — there is no design context
```

`src/types.ts` and `src/utils/offsetUtils.ts` are both deleted in M0.

**Four build facts from `docs/_source/baseline-verification.md` that constrain every feature:**

- **The React Compiler is on.** `vite.config.ts:8-12` enables `babel-plugin-react-compiler` with `target: "19"`. New component code must obey the rules of React strictly — no mutating props or state, no conditional hooks — or the compiler bails out or misbehaves silently.
- **The bundle is already over budget.** `pnpm build` emits a single 1,850.77 kB / **531.65 kB gzipped** JS chunk and warns; there is no `manualChunks` config. `d3-delaunay`, `simplex-noise` and `d3-contour` are not yet installed (§6 doc 03); when added they will land in that same unsplit chunk unless dynamically imported. **Generator code must be dynamically imported per generator** (`vite.config.ts:6-23`).
- **There is no `typecheck` script, and `npx tsc -p tsconfig.app.json --noEmit` reports 18 pre-existing errors** (13 unused-locals/imports, 4 missing test globals, 1 real — `DataView<ArrayBufferLike>` not assignable to `BlobPart` at `src/components/OutputPanel.tsx:125`, on the download path). Adding a typecheck gate inherits all 18. *(`docs/_source/baseline-verification.md` says "19" and enumerates 20; its count is stale. Re-measured on the branch tip 2026-09-04 — see doc 08 §6.3 **A14**. The evidence file is not edited by hand; re-measure before pinning a number.)* Do not let a green typecheck become an implicit acceptance criterion before those are fixed or the gate is scoped to new directories.
- **Vitest coverage `include` is an allowlist:** `src/utils/**`, `src/context/**` and exactly two components (`vite.config.ts:24-37`). New geometry and generator code belongs under `src/utils/**` or it reports zero silently.

### 4.2 The pipeline (existing — as it actually runs)

Revision 1's diagram was wrong in three independent ways: it invented a `clipper-lib` stage, it put clipping before extrusion, and it omitted the Web Worker boundary — which is the single most important structural fact for anyone adding a shape source. Replace it with this. `‖` is the worker boundary; everything crossing it must be **structured-cloneable**.

```
MAIN THREAD                                                ‖  WORKER   src/workers/geometryWorker.ts:26-50
═══════════════════════════════════════════════════════════‖════════════════════════════════════════════════
 SHAPE SOURCES  (every one is file-derived today)          ‖
   parseShapeFile          src/utils/shapeLoader.ts:12     ‖
     ├ .dxf → parseDxfToShapes   NO centering        :71   ‖
     ├ .svg → SVGLoader + centerShapes(flipY=true)   :62   ‖
     └ .stl → STLLoader + geometry.center()       :31-36   ‖   ← returns BufferGeometry, not Shapes
   traceImage            src/utils/image/traceImage.ts:179 ‖
   SVGPaintModal.onSave  src/components/SVGPaintModal.tsx:76
        │                                                  ‖
        │  ★ A GENERATOR / NEW SHAPE SOURCE ATTACHES HERE  ‖
        │    write THREE.Shape[] into patternShapes.       ‖
        │    Precedent: handlePatternLoaded                ‖
        │    src/components/controls/GeometryControls.tsx:114-141
        │    — and bypass the auto-scale overwrite at :132-136
        ▼                                                  ‖
   THREE useState objects        src/App.tsx:15 :18 :21    ‖
     baseSettings.cutoutShapes                             ‖
     geometrySettings.patternShapes                        ‖
     inlaySettings.items[].shapes                          ‖
        │                                                  ‖
   ┌────┴─────────────────────┐                            ‖
   ▼                          ▼                            ‖
 useMemo: split outline     buildJob()                     ‖
 ImperativeModel.tsx        ImperativeModel.tsx:825-861    ‖
 :158-237                    ├ patternShapes[0] is         ‖
  • mirror + rotation BAKED  │   BufferGeometry?           ‖
    into point lists         │   → kind:'geometry' :829-830 ◄ THE SHIPPING PATH
    :183-228                 │ else → kind:'shapes'        ‖
  • filledCutoutShapes       │   filtered on               ‖
    (outer rings, holes=[])  │   instanceof THREE.Shape    ‖
  • holeShapes (promoted)    │   :832-836                  ‖
  • synthesises a `size`     └ serializeShapes  :836 :850-856
    square when no outline                │                ‖
    :163-174                              ▼                ‖
   │                          ┌─── SERIALISATION SEAM ───┐ ‖
   │                          │ SerializedShape          │ ‖
   │                          │  { points: number[];     │ ‖  flat [x0,y0,x1,y1,…]
   │                          │    holes: number[][] }   │ ‖  serialize.ts:14-18
   │                          └──────────┬───────────────┘ ‖
   │                 submitPattern  patternClient.ts:97-101‖
   │                   → pump :60-68 → postMessage :67     ‖
   │                   1 in flight + 1 pending per kind,   ‖
   │                   latest-wins :56 :75;                ‖
   │                   priority pattern ?? inlay :63       ‖
   │                                     └────────────────►  generatePattern  patternPipeline.ts:102
   │                                                       ‖    │
   │                                                       ‖    ├ csFromShapes → CrossSection('EvenOdd') :138
   │                                                       ‖    ├ Manifold.extrude(cs, 1)     :139  ◄── EXTRUDE
   │                                                       ‖    ├ recentre unit on bbox midpoint  :143-149
   │                                                       ‖    ├ generateTilePositions — plain JS,
   │                                                       ‖    │   UNSEEDED Math.random()      :183-191
   │                                                       ‖    ├ per-instance scale/rot/z matrix :205-213
   │                                                       ‖    ├ [fast path] no CSG → unit + matrices :223-229
   │                                                       ‖    ├ Manifold.compose(instances)  :236  ◄── COMPOSE
   │                                                       ‖    ├ subtract exclusions          :253
   │                                                       ‖    ├ intersect(cachedCutterSolid) :269  ◄── CLIP
   │                                                       ‖    ├ subtract hole solid          :286
   │                                                       ‖    ├ subtract max-height box      :297
   │                                                       ‖    ├ mask split → per-colour parts :300-355
   │                                                       ‖    ├ serializeMesh + computeSharpNormals(60°)
   │                                                       ‖    │   manifoldOps.ts:198-218 :217
   │                                                       ‖    └ finally { ops.flush() }      :369-371
   │                                                       ‖        every CrossSection freed here
   ▼                                                       ‖        ►►► NO 2D VALUE ESCAPES THE WORKER ◄◄◄
 THREE.ExtrudeGeometry — main thread, NEVER booleaned      ‖              │
  • Base plate                ImperativeModel.tsx:447-459  ‖              │ SerializedGeometry,
  • inlay placeholders, UNCLIPPED               :639       ‖              │ buffers TRANSFERRED :92-100
   │                                                       ‖              ▼
   └────────────┬──────────────────────────────────────────‖── applyPatternResult.ts:67-130
                ▼                                          ‖   applyInlayResult.ts:29-59
        THREE.Group  meshRef   App.tsx:38 → :77 → :109      ‖
                │
      ┌─────────┴──────────┐
      ▼                    ▼
 handleExport(mode)   handleExport3MF()
 OutputPanel.tsx      OutputPanel.tsx:181-226
 :77-137               + mergeByColor :144-179
  STLExporter.parse    exportTo3MF(merged, {}) :204
  :122-123
```

Three structural facts this diagram makes visible that revision 1 hid:

1. **The order is EXTRUDE → COMPOSE → CLIP**, and all three are 3D Manifold booleans (`patternPipeline.ts:139`, `:236`, `:269`). Nothing clips in 2D. The clip is itself conditional on the user-facing `clipToOutline` toggle (`:218`, default `true` at `src/types/schemas.ts:78`); with it off, the pipeline takes an instanced fast path that skips CSG entirely (`:221`, `:223-229`).
2. **There is no 2D fork point anywhere.** Every `CrossSection` is tracked and freed in `finally { ops.flush() }` (`patternPipeline.ts:369-371`; tracking at `manifoldOps.ts:62-65`), and `PatternResult` carries only mesh buffers (`:84-100`). The 2D *inputs* are reachable on the main thread, which is the trap: a main-thread re-derivation of the placement is easy to write and will silently disagree with the preview until seeding lands (§8 M2).
3. **The Base plate never enters the worker at all.** It is `THREE.ExtrudeGeometry` over raw `cutoutShapes` with holes attached, on the main thread, never booleaned (`ImperativeModel.tsx:447-451`). Mirror and rotation are applied as a *mesh transform*, not baked geometry (`:472-474`).

**Where the flat-export branch must cut in.** Because there is no 2D tee, doc 06 splits along fact 3:

| Branch | Cut point | Touches the core? |
|---|---|---|
| **06a — outline flat export** | Main thread, off the same raw `cutoutShapes` the base plate already extrudes (`ImperativeModel.tsx:449-451`), with mirror/rotation re-applied from a shared extracted helper. `OutputPanel` is constructed in `App.tsx:107-113`, the same component that owns that state; `Controls` only forwards an opaque `ReactNode` (`src/components/Controls.tsx:29`, `:302-306`), so **`Controls.tsx` needs no edit**. | **No.** One prop. |
| **06b — pattern footprint** | Inside the worker, at **two** sites. On the CSG path: capture `result` **as it stands before the mask subtract at `patternPipeline.ts:354`** — i.e. after the max-height cut ends at `:298` and before the `if (hasMasks)` block opens at `:311` — and emit it alongside the final pattern mesh built at `:358`. Also at the instanced early return `:223-229`, otherwise the fast path (clipping off) yields nothing. Readback: `CrossSection.toPolygons()` is exercised at `src/utils/geometry/manifoldCache.test.ts:167`, `:174`. `Manifold.project()` (`node_modules/manifold-3d/manifold-encapsulated-types.d.ts:1006`) and `Manifold.slice()` (`:998`) ship in 3.5.1 but have **zero** call sites in `src/` — doc 06b must write the first test for whichever it picks. | **Yes.** Requires the §10 amendment. |

Do **not** re-derive the pattern footprint on the main thread to avoid 06b. It will disagree with the preview.

## 5. Core Contracts (authoritative — all child docs conform)

> **Preamble.** These are the five contracts every child doc maps onto. Two exist and must be *pinned*, not invented. Two must be created, and their exact attachment points are given. One exists under a different name and must be *extended*. Revision 1's instruction to "find the real equivalents in `src/types.ts` / `src/context`" is void — `src/types.ts` is dead ESP32 code (§4.1) and `src/context/` holds only `AlertContext` (`src/context/AlertContext.tsx:20`). Design state is three prop-drilled `useState` objects (`src/App.tsx:15`, `:18`, `:21`).
>
> Revision 1 also said "never introduce a parallel geometry representation". **There are already six** (table below). The workable instruction is *convert at the existing seam* — not "never introduce". The one un-named wrapper, `{ shape, color }`, is precisely why `InlayItemSchema.shapes` degraded to `z.array(z.any())` (`src/types/schemas.ts:22`).

**The six live geometry representations.** Know which layer you are in before you emit anything.

| # | Representation | Layer | Definition |
|---|---|---|---|
| 1 | `THREE.Shape` (holes as `.holes: THREE.Path[]`) | React state | `src/types/schemas.ts:14`, `:22`, `:67` |
| 2 | `{ shape: THREE.Shape; color: string }` | inlays, coloured SVG | `src/utils/shapeLoader.ts:53`; mirrored as `InlayJobShape` at `src/utils/geometry/inlayPipeline.ts:15-18` |
| 3 | `THREE.BufferGeometry` | **what the pattern slot actually holds today** | `src/utils/shapeLoader.ts:31-36`; branched at `src/components/ImperativeModel.tsx:829-830` |
| 4 | `SerializedShape { points: number[]; holes: number[][] }` | worker wire, flat `[x0,y0,x1,y1,…]` | `src/utils/geometry/serialize.ts:14-18` |
| 5 | `SerializedGeometry { position; normal?; index? }` | worker wire, transferable | `src/utils/geometry/serialize.ts:20-25` |
| 6 | `Vec2[][]` → `new CrossSection(contours, 'EvenOdd')` | inside wasm | `src/utils/geometry/manifoldOps.ts:74-88` |
| — | `ClipperLib.Paths` of `{X,Y}` ints at `SCALE = 1000` | **dead — deleted in M0** | `src/utils/offsetUtils.ts:5`, `:11-35` |

Conversions: `serializeShape`/`serializeShapes` (`serialize.ts:34-50`) flatten via `getPoints()`; `deserializeShape` (`:61-67`) rebuilds a `THREE.Shape`; `contoursOf` (`manifoldOps.ts:74-82`) re-pairs the flat array. `serialize.ts:3-12` documents why `THREE.Shape` cannot cross the worker boundary.

### 5.1 The five contracts

| Contract | Status | Real type / attachment point |
|---|---|---|
| **`Polygon`** | **Pin it — do not create it.** There is no single `Polygon` type and adding one would be a seventh representation. | Main thread: `THREE.Shape` (`src/types/schemas.ts:14`), plus the `{shape,color}` wrapper and `THREE.BufferGeometry` for the pattern slot. Wire: **`SerializedShape`** — `src/utils/geometry/serialize.ts:15-18`. CSG: `Vec2[][]`. Convert only with `serializeShapes`/`deserializeShapes` (`serialize.ts:34-50`, `:61-72`). **Do not add a fourth main-thread form.** |
| **`Outline`** | **Exists, under another name.** | `BaseSettings.cutoutShapes` — `ThreeShapeSchema.nullable().optional().default(null)` at `src/types/schemas.ts:14`, where the schema asserts only `Array.isArray` (`:7`). Set via `handleOutlineLoaded` (`src/components/controls/BaseControls.tsx:31-38`), which is shared by upload *and* library, so revision 1's "the pad library produces the same type" is **already true**. Three caveats: it is split into `filledCutoutShapes` + `holeShapes` before the clip (`src/components/ImperativeModel.tsx:158-237`); the clip is gated on the `clipToOutline` toggle (`src/utils/geometry/patternPipeline.ts:218`); and **inlay tiling ignores the outline entirely** — it tiles a `size`-square with `boundaryShapes = null` (`src/components/ImperativeModel.tsx:247-252`, `:259`; `src/utils/geometry/inlayPipeline.ts:111-112`). |
| **`ShapeSource`** | **Must be created.** | No producer abstraction exists; three de-facto producers share an informal contract and are duck-typed as `s.shape \|\| s` at 13 sites: `parseShapeFile` (`src/utils/shapeLoader.ts:12`), `traceImage` (`src/utils/image/traceImage.ts:179`), `SVGPaintModal.onSave` (`src/components/SVGPaintModal.tsx:76`). Truthful signature — **async, no seed, no outline** (outline-fit is a separate commit step): `produce(): Promise<Array<THREE.Shape \| { shape: THREE.Shape; color: string }>>`. Output lands in `geometrySettings.patternShapes` (precedent: `handlePatternLoaded`, `src/components/controls/GeometryControls.tsx:114-141`) or `InlayItem.shapes` (`src/components/controls/InlayControls.tsx:118-133`). Define it in `src/utils/generators/types.ts` (doc 02 §4.2); still inside the `src/utils/**` coverage allowlist. |
| **`Generator<P>`** | **Must be created.** | No framework, registry or typed-param object exists; `PatternJob` params are a flat destructure (`src/utils/geometry/patternPipeline.ts:106-112`). A `Generator` synthesises the unit; the existing `generateTilePositions` (`src/utils/patternUtils.ts:285-299`) places it and is not generalised by doc 02. Zod `.default()` on a flat schema is a working defaults mechanism that fits the persistence path unchanged. Params attach to `GeometrySettingsSchema` (`src/types/schemas.ts:66-85`); **every new field needs `.default()`**, because `getDefaults` is `schema.parse({})` (`src/utils/schemaDefaults.ts:6-12`) and would throw otherwise. Note `InlayItemSchema` (`:19-46`) has no defaults today and would throw under `getDefaults` — do not model a new schema on it. Widening `patternType` is **optional**: the pipeline never reads it. |
| **`DesignState`** | **Exists as `ProjectSchemaV1` → `ProjectData`. Extend it; retire the name `DesignState`.** | `src/types/schemas.ts:87-96` — three fixed, differently-shaped slots (`base`, `inlay`, `geometry`), **not** a uniform `sources` array. Persisted as a JSZip bundle (`src/utils/projectUtils.ts:29-87`). It is **not** a URL, and it is **not** the unit of undo: the only history in the app is a 50-entry ref stack inside `SVGPaintModal` (`:155-182`), wiped on every open, and the one global mutation warns "This action cannot be undone" (`src/components/Controls.tsx:71`). Its geometry is broken (§2 problem 2). `outlineRef` **(new — does not exist yet)** is blocked on `PatternPreset` having no `id` (`src/components/PatternLibraryModal.tsx:8-15`). A V2 needs a **working** discriminator — the existing `versionMismatch` branch is unreachable dead code, because `safeParse` against `version: z.literal(1)` throws first (`src/utils/projectUtils.ts:179-188`), so the "Continue Anyway" dialog can never render (`src/components/Controls.tsx:241-249`). |

### 5.2 Rules for all features

These six replace revision 1's six. They are long because they carry hard constraints; **do not compress them in a child doc.**

**Rule 1 — geometry emission.**
Emit geometry in the representation belonging to your layer and convert only at the existing seams. For a new pattern source that means `THREE.Shape[]` into `geometrySettings.patternShapes`; the pipeline serialises for you at `src/components/ImperativeModel.tsx:836`. Emit **millimetres** — only DXF import normalises units today (`src/utils/dxfUtils.ts:59-81` is the sole worked example), so a source with its own unit system must convert itself. Leave rings **implicitly closed**: do not append a duplicate first point. Keep every ring to **at least 3 vertices** — `points.length < 6` is silently dropped at `src/utils/geometry/manifoldOps.ts:86` (also `:93`, `:132`), with no error and no `empty` signal a consumer reads. **Curves are flattened at `getPoints()`'s default 12 divisions when serialized** (`src/utils/geometry/serialize.ts:29-32`, `:36`; `node_modules/three/src/extras/core/CurvePath.js:199-212`) — emit polylines at the resolution you want; do not rely on curve fidelity surviving the seam. See §7. Packaging: `csFromShapes` builds one `CrossSection` per `SerializedShape` and unions them (`:91-98`), so **overlapping cells passed as separate shapes union correctly, while a single shape whose own rings overlap will XOR-cancel** under `'EvenOdd'`.

**Rule 2 — do not re-implement the core.**
Never re-implement clipping, offsetting or extrusion. **There is no directly callable 2D clip stage to feed**: a shape source joins by becoming `SerializedShape[]` inside a job, and `generatePattern`/`generateInlay` do the booleans. The engine is manifold-3d `CrossSection` — Clipper2 in wasm (`node_modules/manifold-3d/manifold-encapsulated-types.d.ts:96-98`) — entered at `csFromShape`/`csFromShapes` (`src/utils/geometry/manifoldOps.ts:85`, `:91`), `simplifiedCs` (`:108`), `cachedCutterSolid` (`:128`), with the only polygon offset at `:151`. The order is **extrude → compose → clip** (`src/utils/geometry/patternPipeline.ts:139`, `:236`, `:269`), not the reverse, and the clip is conditional (`:218`). The Base plate is the one exception — main-thread `THREE.ExtrudeGeometry`, never booleaned (`src/components/ImperativeModel.tsx:447-451`). **`clipper-lib` is dead**: do not target it, and do not be fooled by the similarly-named local `offsetShapesFor` at `src/components/controls/InlayControls.tsx:30`, which is unrelated.

**Amendment — convex inset (D2, adopted 2026-09-04).** `insetConvex` may implement a generator-internal inward offset solely to open gaps between Voronoi cells, subject to all four conditions from doc 03 §8 Q6: convex-only input, asserting convexity and throwing in dev / dropping the ring in prod; exact edge-line shift and consecutive-line intersection, never approximation; collapse (an edge reversing direction or `THREE.ShapeUtils.area` ≤ 0) dropped and counted in `GeneratorOutput.clamps`; never applied to pipeline output, never exposed outside `src/utils/generators/poly.ts`, and never implemented under `src/utils/geometry/`. No general-purpose offset or clip utility is permitted.

**Rule 3 — tunables.**
Anything a user can tune **that changes the geometry** must live in one of the three settings schemas (`src/types/schemas.ts:10-17`, `:50-64`, `:66-85`) and therefore in `ProjectSchemaV1`. **View-only state stays local and is explicitly out of scope** — camera, opacity, wireframe, display mode, debug overlays; there are 19 such `useState` between `src/components/ModelViewer.tsx:56` and `:90`, plus `projectAssets` (`src/components/Controls.tsx:81`), `fileName` (`src/components/controls/BaseControls.tsx:27`), `libraryPatternName` (`src/components/controls/GeometryControls.tsx:56-58`) and five App-level flags (`src/App.tsx:24-36`). Revision 1's rule silently demanded a `ModelViewer` refactor; this one draws the boundary instead. The boundary is already inconsistent — `debugMode` is persisted at `src/types/schemas.ts:84` yet reachable only via a Ctrl+Shift+D handler — and **must not be widened silently**. Note that "validates with zod" means "round-trips", not "is checked when set": zod executes at exactly two runtime points (`src/utils/schemaDefaults.ts:6-12`; `src/utils/projectUtils.ts:183`). Give every new field a `.default()`.

**Rule 4 — determinism.**
Randomness must be seeded. **This is new work that changes existing behaviour, not a property to preserve.** `Math.random()` appears at exactly three sites, all in `generateTilePositions` (`src/utils/patternUtils.ts:464`, `:504`, `:505`), behind two **already-persisted** enum values (`src/types/schemas.ts:79`, `:81`, `:41`) — so saved designs already re-render differently on every load. A seed must reach **two** placement sites: the worker path, via a new `PatternJob.seed` field (`src/utils/geometry/patternPipeline.ts:51-82`, consumed at `:184`), and the **main-thread inlay path** (`src/components/ImperativeModel.tsx:254`, reached from `:292`, `:368`, `:596`, `:697`). The inlay *worker* needs no seed — it consumes pre-resolved `{x,y,rot}` coordinates (`src/utils/geometry/inlayPipeline.ts:30`, consumed `:91`), so `InlayJob` must stay unchanged. Do not mistake `rotationClamp` (`patternPipeline.ts:193-195`) for a seeding mechanism. **Seeding alone does not make a design reproducible from its saved form:** export nulls the geometry (`src/utils/projectUtils.ts:46`, `:53`) and reproduction still depends on the exact binary assets travelling in the zip. Owner: doc 08.

**Rule 5 — heavy compute.**
Heavy geometry goes in the **existing** worker; do not create a second one without a stated reason — `getManifold` memoizes per realm (`src/utils/geometry/manifoldModule.ts:15`, `:17-27`), so a second realm means a second 541,470-byte wasm compile. `src/workers/` holds **one** file with a **closed** union `'pattern' | 'inlay' | 'warmup'` (`src/workers/geometryWorker.ts:21-24`), reached by exactly one `new Worker` (`src/utils/geometry/patternClient.ts:37`). Adding a third kind means five edits (`patternClient.ts:17`, `:31-32`, `:63`, `:97-105`, plus the worker dispatch), and **a polygon-only kind must be handled *above* `await getManifold()` at `geometryWorker.ts:35`** or it pays the wasm compile for nothing — `warmup` at `:30-33` is the worked example.

**Amendment — main-thread polygon synthesis (D1, adopted 2026-09-04).** Polygon synthesis that needs no wasm may run on the main thread, provided the doc states a per-generator time budget and a documented revisit trigger. Revisit placement per generator if its `generate()` exceeds **50 ms** at its documented maximum complexity, measured with `performance.now()` around step 4 of `runGenerator` (doc 02 §4.5).

- **Hard constraint — structured-cloneable payloads.** `pump()` assigns `this.inFlight = next` *before* `postMessage`, with no try/catch (`src/utils/geometry/patternClient.ts:66-67`), and the pending slot was nulled on the line above (`:65`). A `DataCloneError` therefore throws out of the effect and **every later submission returns at the `if (this.inFlight) return` guard (`:61`) — all geometry generation is permanently wedged for the session.** There is no timeout and no `terminate()` anywhere. The spinner sticks on (`src/components/ImperativeModel.tsx:811`, cleared only at `:880`/`:890`). Never put a `THREE.Shape`, a class instance, a function or a `Date` in a job.
- **Hard constraint — wasm object tracking.** Every Manifold and CrossSection object must be tracked and freed: `ManifoldOps.track` (`src/utils/geometry/manifoldOps.ts:49-72`) with `finally { ops.flush() }` at `src/utils/geometry/patternPipeline.ts:369-371`. **Objects produced inside an unbounded per-shape loop must never be cached**: `WasmCache` eviction calls `delete()` on the victim (`src/utils/geometry/manifoldCache.ts:94-105`, `:125-131`), which caused a real use-after-free and has a dedicated regression test (`src/utils/geometry/patternPipeline.test.ts:162-182`).
- **Failure is silent.** The worker's catch posts back an *empty result*, which resolves the callback and clears the spinner (`geometryWorker.ts:34-50`). `PatternResult.empty` is set at four sites and **read by nobody** — `applyPatternResult` never inspects it, so the pattern just vanishes. `worker.onerror` logs, clears `inFlight` and pumps the next job into a dead worker (`patternClient.ts:42-47`). `onMessage` never compares `msg.kind` to `done.kind` (`:52-58`). Any new kind must surface failure through `AlertContext`.

**Rule 6 — mergeability.**
Keep diffs upstream-mergeable. A real merge-base exists (`upstream` remote, branch `gripsmith`). **Accept that folder isolation is not achievable for any planned feature** and budget single-line insertions into these shared files.

**A new geometry setting field touches seven places, ending at the hand-maintained dependency array** (recon §3.5). Design state is prop-drilled — 15 props into `Controls`, 10 into `ModelViewer`, and **36 declared props / 37 JSX attributes** into `ImperativeModel` (`src/components/ModelViewer.tsx:460-501`) — so a param added to the schema and the controls **still never reaches `buildJob` unless `ModelViewer` destructures it and forwards it as its own attribute.** Walk the whole chain in the order below; skipping the middle three is the standard failure.

| Shared file | What you will touch | Failure if you skip it |
|---|---|---|
| `src/types/schemas.ts` (+ `src/utils/schemaDefaults.ts:10-12`) | new persisted params | `getDefaults` throws without `.default()` |
| `src/App.tsx:15-21`, `:36` | new state slot / tab flag | — |
| `src/components/Controls.tsx:30-31`, `:358-361`, `:370-406` | a 4th tab | — |
| `src/components/ModelViewer.tsx:48-54` | destructure the field off `geometrySettings` | it is never read out of state |
| `src/components/ModelViewer.tsx:460-501` | add a 38th JSX attribute on `<ImperativeModel>` | the field never crosses into `ImperativeModel` — **the step most often missed** |
| `src/components/ImperativeModel.tsx:15-54` (+ the body destructure `:60-96`) | `ImperativeModelProps` — a flat prop list, not a settings object | it does not typecheck as a prop, or is declared and never bound |
| `src/components/ImperativeModel.tsx:825-861` | `buildJob` — put the field on the returned `PatternJob` | the worker never sees it |
| `src/utils/geometry/patternPipeline.ts:51-82` | `PatternJob` (destructured at `:108-112`) | the pipeline cannot read it |
| `src/workers/geometryWorker.ts:21-24` + `patternClient.ts:17`, `:31-32`, `:63`, `:97-105` | a new job kind | five-site edit; miss one and the pump mis-routes |
| `src/utils/patternUtils.ts:285` | the shared tiler | **rules 5 and 6 collide here** — it runs in *both* threads |
| `src/components/ImperativeModel.tsx:897-903` | the **hand-maintained dependency array** | a new setting omitted here **never triggers regeneration** — already demonstrably broken for the three `debugShow*Cutter` props, which `buildJob` reads at `:857-859` and the array omits |
| `vite.config.ts:30-35` | coverage allowlist | new code reports 0% silently |

**Persistence note.** `ProjectAssets.inlays` is one asset slot per id (`Record<string, Asset>`): export at `src/utils/projectUtils.ts:69-73`, import at `:154-166`, and registration at `src/components/Controls.tsx:105-115`.

**Never reformat.** There is no Prettier and no EditorConfig; indentation is mixed across files and *within* `src/utils/geometry/patternPipeline.ts`.

## 6. Derived Feature Docs (workstreams)

Each becomes its own doc, derived from this one. Scopes below are **revised against recon** — several of revision 1's items were scoped against solved problems. Effort: S ≈ a day, M ≈ a few days, L ≈ a week+, XL ≈ reconsider.

| Doc | Revised one-line scope | Effort |
|---|---|---|
| **`01-pad-outline-library`** | **The picker ships (17 presets).** Scope is hardening: add `PatternPreset.id` **(new)**, persist outline provenance, surface zero-shape DXF failures, attribute the 8 outlines lacking `infoUrl`, reset rotation/mirror on pad swap, cache the 17 synchronous thumbnail re-parses per modal open. | M |
| **`02-generator-engine`** | A `Generator<P>` framework, registry and typed params — **reusing the existing worker, not re-creating it.** Binding constraint revision 1 omitted: `patternUnit` is assembled on the main thread out of React state (`ImperativeModel.tsx:825-861`), so **generator output must land in `patternShapes` before a job exists**. Scope to "produce `THREE.Shape[]` into `patternShapes`". | M |
| **`03-generators`** | Concrete generators: Voronoi (`d3-delaunay`), noise-contour (`simplex-noise` + `d3-contour`), truchet/Wang, L-system. **Confirmed absent** — a repo-wide grep for `voronoi\|delaunay\|simplex\|perlin\|truchet\|l-system\|fractal\|poisson\|marching` over `src/` and `package.json` returns zero. Each must be dynamically imported (§4.1 bundle budget), and must ship a tile cap: an uncapped lattice with `fullWidth → 0` gives `cols/rows = ceil(span/0) = Infinity` inside the worker and hangs it silently (`src/utils/patternUtils.ts:478-479`, `:684-696`). | L |
| **`04-parametric-controls`** | A descriptor-driven `ParamField` **(new)** extending the existing native Tailwind layer (`src/components/ui/ControlField.tsx:14-50`) — **not `leva`** (§11 Q2); a `Slider` primitive **(new)** (there is zero `type="range"` in the controls tree); `ProjectSchemaV2` **(new — does not exist yet)** with a *working* migration; URL/JSON share; an accessibility baseline (`src/` currently has **zero** `aria-*`, zero `role=`, zero `tabIndex`, one `htmlFor`). The descriptor must support **derived** bounds, not literals — see the cross-tab `maxDepth` case at `src/components/controls/InlayControls.tsx:56`, `:76-85`, `:656-664`. | M (renderer) / L–XL (URL share) |
| **`05-direct-editing`** | **Split, and moved last.** **05a** — fix the lossy paint-modal edits (move/duplicate drop `shape.holes` at `src/components/SVGPaintModal.tsx:459-472`, `:257-264`, while the same file's text tool does it correctly at `:531-548`), add a non-destructive edit representation, add 3D pick against real geometry. **05b** — node/region editing of the *pattern*, which is blocked: `Manifold.compose` fuses all tiles into one solid (`patternPipeline.ts:236`), the pattern has **no polygon representation at all** in the default path, and there is no clipper util to reuse. Consider dropping 05b. | 05a M · 05b XL |
| **`06-flat-export`** | **Split; two halves with different blockers.** **06a — outline flat export:** needs **no core change** and is one prop away (see §4.2 table). Requires an SVG *document* writer and an R12 DXF writer, both new — `generateSVGPath` (`src/utils/dxfUtils.ts:469-493`) emits only a `d` string and has 3 consumers plus a pinned test, so build on it, do not modify it; `dxf-parser` has no writer. **06b — pattern footprint:** the only workstream that must edit the worker result contract, and is therefore **gated on the §10 amendment**. | 06a S–M · 06b M |
| **`07-text-image-sources`** | **Asymmetric, not one job.** `traceImage`/`traceLayers` are a standalone module importing only three/imagetracerjs/colorShift — genuinely wrappable as a `ShapeSource` (`src/utils/image/traceImage.ts:1-3`, `:179-207`). `generateTextShapesFromOpentype` is module-private and welded to modal state — two ref caches, `activeFontKey`/`fontSize`, a click point, a `showAlert` prompt — so **there is nothing to wrap today**; it must be extracted into `src/utils/text/` first. Also: self-host the 9 preset fonts (currently fetched from jsDelivr at runtime), drop `.woff2` from the accept string, and route both producers into the *pattern* lane past the STL gate at `src/components/controls/GeometryControls.tsx:163`. **The real blocker is persistence for shapes with no source file** (`src/components/controls/InlayControls.tsx:131`, `:152`). | M–L |
| **`08-determinism-and-seeding`** | **NEW DOC — owns the seeding work that blocks every reproducibility claim and belongs to no existing doc.** A PRNG module **(new)**; a 14th `seed` parameter on `generateTilePositions`; `seed` on `GeometrySettingsSchema` and `InlayItemSchema`; `seed` on `PatternJob` + `buildJob` + the dependency array; thread it through the main-thread inlay call; the first reproducibility assertions. Blocks: rule 4, §3 goal 3, §7's cache directive, doc 04's seed control, and any flat export that re-derives placement. **Not additive** — two persisted enum values already violate rule 4. | S–M |

**Revised phasing:** 08 (seeding) → 02 + one generator from 03, in parallel with 06a → 06b (if the §10 amendment is taken) → 04 → 07 → rest of 03 → 05a. 01 leaves the critical path entirely; only `PatternPreset.id` is a downstream dependency. See §8 for the milestone form of this.

## 7. Cross-Cutting Concerns

### Geometry conventions

- **Millimetres — but only partly enforced.** mm is the intended unit and holds end-to-end for the *cut-critical* geometry: the base outline is DXF-only, `parseDxfToShapes` reads a real `$INSUNITS` table with a `$MEASUREMENT === 0 → 25.4` inch fallback (`src/utils/dxfUtils.ts:59-81`), and **16 of the 17** shipped outlines declare `$INSUNITS=4`; `gtlowboyflared.dxf` alone declares none and resolves through the `$MEASUREMENT === 0 → 25.4` branch, so **both tiers of the unit code are exercised by the shipped catalog** (verified per file — doc 01 §4.0; consistent with §11 Q4 below). **Every other importer is unnormalised:** SVG applies no unit scale at all — `SVGLoader` keeps its `px`/90 defaults and never reads `viewBox` (`src/utils/shapeLoader.ts:43`; `node_modules/three-stdlib/loaders/SVGLoader.js:7-8`), so `100mm` becomes 354.33 units; STL is raw; image trace is hardcoded to 50 mm (`src/utils/image/traceImage.ts:180-189`). Rule 1 therefore says *a source with its own unit system must convert itself*. On the export side mm is clean: 3MF writes `@_unit: "millimeter"` and `handleExport` applies no transform (`src/components/OutputPanel.tsx:117-120`).
- **Rings are implicitly closed.** Do **not** append a duplicate first point. DXF rings always *carry* an explicit duplicate, because `build()` is called with `force=true` for open chains too (`src/utils/dxfUtils.ts:384`, `:387-388`); shapes from `new THREE.Shape(points)` do not (`autoClose` stays false). Consumers strip or wrap either way — three's own module-private `removeDupEndPts` before Earcut (`node_modules/three/src/extras/ShapeUtils.js:56`, `:63`, `:91`; **not project code — it has zero hits in `src/`**), parity loops modulo n, `CrossSection` implicit. Minimum 3 vertices (rule 1).
- **Centering is a BOUNDING-BOX MIDPOINT, not a centroid.** Revision 1 said "centered on outline centroid (match the upload path exactly)". **Nothing in the repo computes a centroid** — a repo-wide grep returns one hit, the *incorrect comment* at `src/components/ImperativeModel.tsx:478`. There are **four separate bbox-midpoint implementations**: the DXF inline one (`src/utils/dxfUtils.ts:203-211`, subtracted at `:379-382`), `centerShapes` (`src/utils/patternUtils.ts:942-952`), the Manifold unit recentre (`src/utils/geometry/patternPipeline.ts:143-149`), and `geometry.center()` for STL (`src/utils/shapeLoader.ts:34-35`). Worse, "match the upload path exactly" is **unfollowable**: the DXF path never calls `centerShapes`, and its box measures only segment *start/end* points, so a `CIRCLE` contributes `(cx+r, cy)` twice (`src/utils/dxfUtils.ts:169-170`) and arc bulges are invisible — **the origin cannot be re-derived downstream by any means.** Any doc needing a stable origin must define one, not inherit one.
- **Winding is inconsistent by source and load-bearing at two import boundaries.** Irrelevant at the CSG boundary (everything is `'EvenOdd'`) and re-derived by `ExtrudeGeometry` — but `ShapePath.toShapes(isCCW)` for every text glyph (`src/components/SVGPaintModal.tsx:48`, `:59`) and `SVGLoader.createShapes` under its default `nonzero` rule (`node_modules/three-stdlib/loaders/SVGLoader.js:1245-1298`) both infer nesting from winding. DXF outers are CCW (`src/utils/dxfUtils.ts:392-397`); SVG outers are CW. Holes are never rewound.
- **Curves are flattened at 12 divisions and never recover.** `getPoints()` defaults to 12 divisions (`node_modules/three/src/extras/core/CurvePath.js:199-212`), so a DXF `CIRCLE` becomes a 24-gon at any radius — 0.428 mm sag at R=50, **400× the 0.001 mm cutter tolerance**. `ExtrudeGeometry` independently defaults `curveSegments` to 12 (`node_modules/three/src/geometries/ExtrudeGeometry.js:87`, `:140`), so the base mesh and the clip contour sample *identically* — the in-code comment claiming the base "preserves curves" (`src/components/ImperativeModel.tsx:449`) is misleading. `centerShapes` re-samples at 12, permanently flattening text and SVG art at import. Doc 06 must set an explicit flattening tolerance, and it must land **at import as well as at export**.

### Performance

- **Off-thread is true for every boolean, false as a blanket.** All CSG runs in `src/workers/geometryWorker.ts:26-50`. But the Base plate and inlay placeholders are extruded on the **main thread** with `THREE.ExtrudeGeometry` (`src/components/ImperativeModel.tsx:451`, `:639`), inlay tile placement runs on the main thread at 4 call sites (`:254`, reached from `:292`, `:368`, `:596`, `:697`), and per-job `serializeShapes` over the full outline is main-thread (`:836`, `:850-856`).
- **Vertex-normal computation is the pipeline's dominant CPU cost, and revision 1 did not mention it.** `computeSharpNormals` (`src/utils/geometry/normals.ts:26`) runs on every emitted mesh via `serializeMesh` (`src/utils/geometry/manifoldOps.ts:217`), including once over the whole composed solid (`src/utils/geometry/patternPipeline.ts:361`), plus once per mask part and once per inlay part. **Nothing caches it.** Its own docblock records why it exists: the Manifold alternative it replaced took ~5800 ms for 48k sharp triangles versus ~10 ms for 128k smooth ones, and a grip pattern is nearly all sharp edges (`src/utils/geometry/normals.ts:12-16`). `SHARP_ANGLE = 60` is hardcoded with a single call site (`src/utils/geometry/manifoldOps.ts:22`) and should be documented as fixed. Budgeting ratio, measured in-repo: **≈3.9 triangles per contour point raw, ≈2.9 after `simplify(CUTTER_TOLERANCE)`** — 18464/4761 and 1584/541, from the measurement recorded at `src/utils/geometry/manifoldOps.ts:36-38`. Budget against the raw figure for un-simplified geometry (the pattern unit and inlay shapes, `:44-45`).
- **The worker-wedge hazard.** A single non-cloneable value in a job permanently disables all geometry generation for the session, silently, with the spinner stuck on — see rule 5's first hard constraint. This is the highest-severity failure mode in the app and every new job field is exposed to it.
- **Debounce and coalescing already exist.** `DEFAULT_DEBOUNCE_MS = 150` (lowered from 300 because generation is "well under 200ms for a dense grip") across all 17 numeric fields (`src/components/DebouncedInput.tsx:9-18`); selects commit synchronously. Above that sits the worker client's pending slot — 1 in flight + 1 pending per kind, latest-wins (`src/utils/geometry/patternClient.ts:56`, `:63`, `:75`). **06b must not ride the preview job**: the pattern queue coalesces and would silently drop an export.
- **Cache by design hash — directive stands, precondition missing.** `WasmCache` (`src/utils/geometry/manifoldCache.ts:88-133`; `max = 48` at `:105`, `getOrCreate` at `:113`) is a 48-entry LRU of *wasm handles* keyed by a content hash of individual inputs, with two `getOrCreate` call sites. **No result is memoized and nothing hashes a design.** The hash is 32-bit FNV-1a in base36 (`Hasher`, `src/utils/geometry/manifoldCache.ts:20-53`) — fine for a handle cache, inadequate as a correctness key. The blocker is that the state holds live `THREE` objects and a `Date.now()` timestamp (`src/types/schemas.ts:14`; `src/utils/projectUtils.ts:42`), so a design hash is blocked behind doc 08 and doc 04.
- **Decimation is asymmetric on purpose.** Cutter contours are simplified to `CUTTER_TOLERANCE = 0.001` mm (`manifoldOps.ts:47`, applied `:111`, `:150`) — measured 4761 → 541 points, 18464 → 1584 triangles, roughly halving pipeline time. The pattern unit and inlay shapes are deliberately **not** simplified (`:44-45`), so a dense generated field pays full point cost. **The fix is JS-side, at the source, not in the core:** doc 02 §5.2 ships `decimateShapes` (Ramer–Douglas–Peucker over each ring, in `src/utils/generators/normalize.ts`) applied before shapes reach state, and doc 03 §4.4 enforces a vertex budget by construction. An opt-in decimation hook at `patternPipeline.ts:138` is therefore **deferred, not scheduled** — it is a §10 core edit and both child docs decline it with reasons (doc 02 §5.2, doc 03 §3 Non-Goals). Reopen only if doc 03 §8 Q3's measurement shows the JS budget insufficient.
- **`patternScale` is auto-overwritten on load** by `calculateAutoPatternScale` (`src/components/controls/GeometryControls.tsx:67-112`, written at `:132-136`), targeting a hardcoded 10 mm unit width in tiled mode. **A generator emitting mm-correct geometry is silently rescaled** — doc 02 must bypass or gate this.

### Correctness

- **Export is an ungated scrape of live, mutable scene objects.** `OutputPanel` reads `meshRef` directly (`src/components/OutputPanel.tsx:78-80`) and contains **no readiness token**. Consequences, all reachable in normal use: masked pattern parts are flattened to the plain pattern colour while dragging *and* on every pattern-effect re-run (`src/utils/geometry/applyPatternResult.ts:99-107`; `src/components/ImperativeModel.tsx:813-821`, `:937`), and `mergeByColor` keys on `material.color.getHexString()` (`src/components/OutputPanel.tsx:153`) — **so a 3MF exported in that window emits a different number of filament slots.** Inlays exported before the worker returns are unclipped placeholders (`ImperativeModel.tsx:639`). Extruder numbering is not even stable across edit sequences, because effects remove and re-append their children and `exportTo3MF` assigns extruders in first-encounter depth-first order. **An export readiness gate is a cross-cutting requirement, owned by no single doc.**
- **The exported model is a multi-body assembly, not a solid.** Base, Pattern and Inlays interpenetrate with documented epsilons (pattern sink `thickness - 0.01`, mask lift `idx * 0.0001`, inlay stagger, per-item depth epsilon) and **no boolean union is ever performed between them.** Watertightness holds per part, never for the assembly. A flat branch that tries to slice the assembly will be wrong — 06a takes the outline, 06b takes the pattern footprint, and they are combined downstream, not upstream.
- **The mirrored base exports with inverted facet orientation.** Mirror is a negative mesh scale (`src/components/ImperativeModel.tsx:472-473`) and `BufferGeometry.applyMatrix4` never reverses the index; neither exporter reads the `normal` attribute (`STLExporter` recomputes from world winding, the 3MF writer emits only vertices and triangles). The same author explicitly compensates for this on the *clip contours* (`:200-202`, `:226-228`, commented "Mirror flips winding") but not on the base mesh. Doc 06a must not inherit the bug.
- **Min-feature clamps do not exist.** Revision 1 said "Keep min-feature-size clamps so output stays printable/cuttable" — "Keep" falsely asserts inheritance. There is **no output-side clamp in either dimension on either path**: `src/types/schemas.ts:10-85` has zero `.min()`/`.max()`, and the `min=` HTML attributes are inert because `DebouncedInput` never validates and nothing calls `checkValidity` (`src/components/DebouncedInput.tsx:44-47`). The only enforced physical limits are three Z-axis UI floors. This is net-new work at `patternPipeline.ts:138-139`.

### Physical accuracy

Never fabricate pad dimensions or stud specs. Source outlines from verified community files (KHAOS DXF outlines on Printables; pubparts.xyz) **with attribution**. Attribution is currently half done: 9 of the 17 outlines carry an `infoUrl` and all nine point at the same Printables model; 8 have none (`src/components/PatternLibraryModal.tsx:49-65`, render path at `:199-210`). **Zero** of the 17 DXFs and **zero** of the 13 inlay SVGs carry embedded rights metadata. Add min-feature-size clamps so output stays printable and cuttable — as new work, per the bullet above. Measured extents of the shipped catalog, for sanity checks — these are **raw DXF vertex boxes with arc/circle bulges excluded**, not parsed extents: 206.1×173.4 mm (pint) to 255.3×233.9 mm (gtkushwide), plus `gtlowboyflared` at 10.1×8.3 in = 256×211 mm. **Doc 01 §4.0 tabulates the *parsed*, arc-flattened extent of all 17 through `parseDxfToShapes` — a different and larger number for arc-heavy files (`gtlowboyflared` is 255.8 × 215.2 mm parsed). Any test asserting extents must use doc 01 §4.0's table and say which method it uses.**

### Testing

Vitest. Every feature ships schema tests, a produce/round-trip test, and a regression test proving the upstream flow still works. Two facts bound that:

- **Coverage is allowlisted** to `src/utils/**`, `src/context/**` and two components (`vite.config.ts:24-37`), so `src/workers/**`, `src/types/**` and every other component are outside the number. New geometry code belongs under `src/utils/**`.
- **The closest thing to an upstream-flow guard does not exercise the real code.** `src/utils/geometry/exportMerge.test.ts:10-16` never imports `OutputPanel` — it hand-rebuilds the merge (`:91-131`). Treat it as a specification test, not a regression guard.
- **The baseline to regress against is recorded**: 20 files / 155 tests after P0 deletes `offsetUtils.test.ts` (−1 file, −7 tests from `docs/_source/baseline-verification.md`). `patternPipeline.test.ts` and `inlayPipeline.test.ts` pass, which means **Manifold wasm runs under Vitest/jsdom** — a determinism regression test for seeded generation is feasible with no browser harness.

### Upstream & licensing

The repo has **no explicit license** — no `LICENSE`, `COPYING`, `NOTICE`, `README` or `AUTHORS` anywhere, and `package.json:3` carries only `"private": true`, which blocks npm publish and grants nothing. Personal use is fine; **before any public deploy or redistribution, get a license added by the author (techfoundrynz) or ask permission.** Prefer small, isolated diffs so useful pieces can be offered back as PRs.

The binding constraint is `public/`, which ships third-party marks — 13 inlay SVGs with **zero rights metadata** (`public/inlays/`, `src/components/PatternLibraryModal.tsx:35-46`) — and 17 outline DXFs likewise. That is a redistribution question independent of the code license.

### Deploy safety — two hard blockers before any fork deploy

- **`public/CNAME` names the upstream author's domain.** It contains `studio.grippysheet.com`. `gh-pages -d dist` copies `public/` into the published branch, so deploying as-is would attempt to claim someone else's custom domain. **Delete `public/CNAME` in M0.**
- **`gh-pages` defaults to an `origin` remote that does not exist.** `git remote -v` lists only `upstream`. `pnpm deploy:gh` (`package.json:12`) will fail until an `origin` is added.
- **The Vite `base` path is unset and its comment is from another project.** `vite.config.ts:16-17` reads `// base: '/PubRemote/',` — a leftover from techfoundrynz's PubRemote project, the same origin as the ESP32 types in `src/types.ts`; this repo was scaffolded from that one. `base` being commented out means the build emits root-absolute `/assets/...` URLs, which works on a custom apex domain and **404s on a project subpath**. Meanwhile `package.json:4` sets a stale `homepage` pointing at a subpath, and Vite does not read `homepage`. GripSmith's own deploy must set `base` correctly, and **every runtime `fetch()` of a bundled asset from `public/` must go through `import.meta.env.BASE_URL`** — there are 8 root-absolute asset URLs today and zero uses of `BASE_URL`. Getting this wrong makes built-in pads work in `dev` and 404 in production, which is a hard requirement on doc 01, not a detail.

### Accessibility / UX

Keyboard-navigable pickers; visible active-outline and active-source labels. **Both are net-new, not inherited.** `src/` contains **zero** `aria-*` attributes, **zero** `role=`, **zero** `tabIndex`, and exactly one `htmlFor`. Both pickers are `<div onClick>` with no focus trap and no Escape handler, and there is no Escape-to-close pattern anywhere to copy. The file input is `className="hidden"`, so the dropzone is keyboard-unreachable in both states (`src/components/ShapeUploader.tsx:180-182`, `:227`). The loaded-source signal *is* consistent (green dashed border + green filename pill); **active-state styling is not** — five different treatments exist (`ToggleButton` purple/10, inlay row purple/20, `SegmentedControl` **gray** with a white ring, swatches `ring-2 ring-white`, viewer toggles indigo and pink). Doc 04 must pick one. `src/components/ui/Badge.tsx` is dead code.

## 8. Milestones

Revised from recon. Two orderings changed materially: **seeding moved to the front** (it is not additive — two persisted enums already violate rule 4, and retrofitting a seed into a shipped generator is worse than designing with one), and **outline flat export moved early** (it needs no generator and no core change).

### M0 — Contract correction and deploy safety

Doc edits plus deletions. Rewrite §4.1/§4.2/§5/§7/§9 to name `ManifoldOps` and show extrude→compose→clip *(this document)*. Delete `src/utils/offsetUtils.ts`, `src/utils/offsetUtils.test.ts`, `src/types/clipper-lib.d.ts`, `src/types.ts`; drop `clipper-lib`, `lodash`, `@types/lodash`, `@types/uuid` from `package.json`. Delete `public/CNAME`; add an `origin` remote.

**Exit:**
- No doc section describes `clipper-lib` as live; §4.2 shows extrude before clip; §9 names `SerializedShape` and `csFromShapes`.
- `grep -rn "clipper-lib\|ClipperLib\|ClipperOffset" src/ package.json` returns nothing. **Do not use a bare `grep -rni clipper` as the gate — it cannot go green.** Two *correct* references to **Clipper2** (the live 2D kernel inside the manifold wasm, §4.1) survive the deletions and must not be touched: `src/utils/geometry/patternPipeline.ts:11` and `src/utils/geometry/manifoldCache.test.ts:164`.
- `grep -rn "FirmwareVariant\|DeviceInfoData" src/` returns nothing.
- `git remote` lists an `origin`.
- `test -e public/CNAME` is false.
- `pnpm test` is 20 files / 155 tests (−1 file, −7 tests: the deleted `offsetUtils.test.ts`) green; `pnpm build` still exits 0.

*Rationale:* eight child docs are told to conform to §5. Leaving it wrong multiplies the error eightfold, and the fix is a doc edit plus four deletions.

### M1 — Identity and provenance (doc 01 hardening; parallelisable, off the critical path)

`PatternPreset.id`; `outlineRef` on `BaseSettingsSchema` with a `.default()`; zero-shape DXF error surfacing; the 8 missing `infoUrl`s plus a `NOTICE`; rotation/mirror reset on pad swap and clear; thumbnail parse cache.

**Exit:**
- All 43 presets carry an `id`; `getDefaults(BaseSettingsSchema)` still succeeds and `src/utils/schemaDefaults.test.ts` passes.
- Select a library pad → export → import restores the preset name instead of "Custom Drawing".
- `src/utils/shapeLoader.ts:79` returns `success: false` on zero shapes, and the other **seven** `parseShapeFile` callers still behave. *(There are **eight** call sites outside `shapeLoader` itself — enumerated with their before/after behaviour in doc 01 §4.3. `grep -rn 'parseShapeFile(' src/ | grep -v utils/shapeLoader` is the gate.)*
- Load pad A, rotate it, pick pad B → rotation reads 0.
- Opening the library modal twice parses each DXF exactly once (assert with a spy on `parseDxfToShapes`).

### M2 — Determinism (doc 08) — **blocks every reproducibility claim**

PRNG module **(new)**; a 14th `seed` parameter on `generateTilePositions`; `seed` on `GeometrySettingsSchema` and `InlayItemSchema`; `seed` on `PatternJob` + `buildJob` + the dependency array; thread it through the main-thread inlay call.

**Exit:**
- `grep -rn 'Math\.random' src --include='*.ts' --include='*.tsx' | grep -v '\.test\.'` is empty.
- All 15 existing `generateTilePositions` call sites still compile.
- `InlayJob` is **unchanged** (it consumes pre-resolved coordinates).
- A new test calls `generateTilePositions` twice with the same seed and **deep-equals** the returned `TileInstance[]` — replacing today's `length > 0` assertion (`src/utils/patternUtils.test.ts:332-345`).
- A second test runs two identical `PatternJob`s through `generatePattern` and compares the instanced matrices **with a tolerance**, not byte-exactly. *(Manifold's own run-to-run determinism is unverified — see §11 residual risk.)*
- `pnpm test` green.

### M3 — First generator through the real seam (doc 02 + one from doc 03)

**Exit:**
- A generator writes `THREE.Shape[]` into `patternShapes` and `buildJob` takes the `kind:'shapes'` branch (`src/components/ImperativeModel.tsx:832-836`) — **the first production use of that branch.**
- Every new param appears in the dependency array at `ImperativeModel.tsx:897-903`, verified by changing each one and observing a regeneration.
- The auto-scale overwrite at `src/components/controls/GeometryControls.tsx:135` is bypassed or gated, and a test asserts a generated 10 mm cell stays 10 mm.
- Clip, holes, height-cut and masks all work with **zero edits** to `src/utils/geometry/patternPipeline.ts:258-366`.
- STL and 3MF export with **zero edits** to `src/components/OutputPanel.tsx`.
- If a worker kind was added: it is handled **above** `await getManifold()` at `src/workers/geometryWorker.ts:35`, and all four `patternClient.ts` sites are updated.
- Every job value is structured-cloneable — assert with `structuredClone(job)` in a test.
- The generator module is dynamically imported and does not enter the main chunk (`pnpm build` chunk list).

### M4a — Outline flat export (doc 06a; shippable early, parallel with M2/M3)

**Exit:**
- `OutputPanelProps` takes `cutoutShapes` + mirror + rotation, passed at `src/App.tsx:108-113`; **`src/components/Controls.tsx` is unchanged** (`git diff --stat` shows it untouched).
- A flat-export button renders beside Merged STL.
- `generateSVGPath` is byte-identical; its three consumers and `src/utils/dxfUtils.test.ts:223-256` still pass.
- The exporter **refuses** whenever `cutoutShapes` is empty, **regardless of `size`**, rather than emitting the synthesised `size`-square (`src/components/ImperativeModel.tsx:166-173`; `size` defaults to 300 mm at `src/types/schemas.ts:11` but is user-editable, so do not assert on 300).
- Mirror and rotation are re-applied by the exporter from a **single extracted helper** — not a fourth copy of the transform, and not the un-reversed-winding bug.
- Terminal duplicate vertices are dropped before writing a **closed polyline** — entity choice (`POLYLINE` vs `LWPOLYLINE`) is doc 06 §4.5 / Q1's call, not this doc's; doc 06 §4.5 currently selects `POLYLINE`, because `LWPOLYLINE` is an AC1014 entity while the writer declares `$ACADVER = AC1009`.
- A round-trip test compares **shape**, not absolute coordinates.

### M4b — Pattern footprint (doc 06b) — **requires the §10 amendment**

**Exit:**
- §10 is amended (see §10 below) to carve out an additive, read-only result channel.
- Contours are produced at **both** emission sites: the CSG path captures `result` **before** the mask subtract at `src/utils/geometry/patternPipeline.ts:354` (after `:298`, before `:311`) and emits it alongside the final mesh at `:358`; the instanced early return `:223-229` emits its own.
- A `kind:'flat'` request is added **as the request mechanism** rather than routing an export through the pattern kind — **preferred**, because the pattern queue coalesces (`patternClient.ts:56`, `:63`) and would silently drop an export riding the preview job. *The result type may still gain one **optional payload field** (`PatternResult.contours?`) to carry the contours back; that is the payload carrier, not the request mechanism, and it is inert unless the job asked for it (§10 amendment condition 1). See doc 06 §4.6, which reconciles conditions 1 and 3.*
- The chosen `project()` vs `slice(z)` semantics are documented in doc 06b, with the difference stated.
- **No main-thread Manifold instantiation** — `grep -rn 'getManifold' src/` shows no new main-thread call site.
- Preview output is unchanged: `pnpm test` green with no edits to the existing `patternPipeline.test.ts` expectations.

### M5 — Controls, sharing and breadth (04 → 07 → rest of 03 → 05a)

**Exit:**
- `ParamField` renders from a descriptor and supports a bound expressed as a **function of state**, verified against the cross-tab `maxDepth` case (`src/components/controls/InlayControls.tsx:56`, `:76-85`, `:656-664`).
- A Generate tab exists with the union widened in both places (`src/components/Controls.tsx:30-31`, `src/App.tsx:36`), and its mount-effect timing is understood — `react-freeze` means panels do not mount until first visited.
- `ControlField` associates labels for all **28** `<ControlField>` call sites (`htmlFor` count goes from 1 to ≥28). *(Verified static count — doc 04 §1 footnote enumerates all 28; `grep -rn '<ControlField' src/` returns 29, the 29th being the definition at `src/components/ui/ControlField.tsx:14`.)*
- A v2 bundle imports **and** a v1 bundle still loads via a working migrate step — with a test for each, since the current version branch is unreachable dead code (`src/utils/projectUtils.ts:179-188`).
- A share link reproduces a design using a **library** outline plus scalars plus a seed. Custom uploads are explicitly out of scope absent an inline geometry encoding.
- `src/utils/text/` exists and fonts load from `public/`, not jsDelivr.
- A painted or traced inlay survives export → import, and the "Missing Asset Files" warning no longer fires for it.
- Paint-modal move and duplicate carry `shape.holes` (regression test against `src/components/SVGPaintModal.tsx:459-472`).

### Blocked-by chain

| Blocked | On |
|---|---|
| `outlineRef` | `PatternPreset.id` (M1) |
| Generator reproducibility | seed (M2) |
| Design-state hash / result cache | seed (M2) + JSON-clean geometry (M5) |
| URL share | `outlineRef` + an inline geometry encoding |
| doc 06b | the §10 amendment |
| doc 05b | a polygon representation for the pattern, which does not exist |
| A typecheck gate | fixing the 18 pre-existing `tsc` errors (§4.1) |

## 9. Recon — DONE

**The §9 recon checklist is complete. Its output is `docs/_source/00-recon-report.md`.** Do not re-run it. Every task list in a child doc starts from that report's findings, never with "first, do recon". This section number is retained because child docs reference it.

Method, for calibration: 13 independent dimensions read `src/` first-hand; each was then adversarially re-verified by a second pass that overturned or sharpened claims; a cross-dimension consistency pass resolved 12 places where dimensions disagreed; four targeted follow-ups closed remaining gaps. All citations are against upstream `master` @ `cf698036f28f86e4d70c00b24a2283b5ab7d3f49`. **Line numbers drift the moment upstream moves** — re-grep before trusting a citation after a merge.

**What recon established** (each maps to a revision-1 checklist item):

| Revision 1 asked for | What recon found |
|---|---|
| "The concrete `Polygon`/path type fed to `clipper-lib`." | The stage does not exist. The wire type is `SerializedShape` (`src/utils/geometry/serialize.ts:15-18`), entered at `csFromShapes` (`src/utils/geometry/manifoldOps.ts:91-98`). There are **six** live representations (§5), and the `THREE.BufferGeometry` case is the load-bearing one. |
| "The `Outline`/bounds type and the context setter used after a DXF upload." | **There is no React context for the outline** — `createContext` is called at exactly one site in `src/`, for alerts (`src/context/AlertContext.tsx:20`). The real chain is `ShapeUploader.onUpload` → `BaseControls.handleOutlineLoaded` (`:31-38`) → `updateSettings` **and** `onOutlineLoaded` → `Controls.updateBase` → `setBaseSettings`. Both land on the same functional setter, so the double-write is harmless. |
| "The DXF normalization util (units, closing, centering)." | **Confirmed to exist and do all three:** `parseDxfToShapes` (`src/utils/dxfUtils.ts:46`). Three caveats a spec must carry: the centering bbox excludes arc/circle bulges; closing is unconditional (`force=true` for open chains too); and the winding pass rebuilds negative-area shapes with `moveTo`/`lineTo`, **discarding their arcs**. DXF-only — there is no SVG equivalent. |
| "The current shape-input entry points (traced image, text)." | **Eight** UI entry points funnel into **three** handlers — and **text is not one of them**: it is a tool *inside* the paint modal whose output leaves only via whole-canvas `onSave` (`src/components/SVGPaintModal.tsx:504`, `:692-695`). `ModelViewer` has no drop handler, so the enumeration is exhaustive. |
| "The clip → extrude → export call sites (to confirm they need no changes)." | Presumes one chain; there are **three** extrude sites and **two** export sites, and the order is extrude→compose→clip. Correct about the export tail, wrong about everything upstream. "No changes" also assumed the flat branch adds a sibling button — `exportControls` is a single opaque `ReactNode` with no registry (`src/components/Controls.tsx:29`, `:302-306`). |

Twelve findings changed the plan; they are ranked in the report's §1. The five that most often catch an implementer: `clipper-lib` is dead; the pipeline order is inverted; the pattern slot holds a **mesh**, not polygons, in every shipping path; randomness is unseeded *in already-persisted settings*; and a non-cloneable job value wedges the app permanently.

## 10. How to Derive a Feature Doc from This

Each child doc MUST include, in order:

1. **Header:** Doc ID (`NN-name`), status, owner, and a link back to `00-architecture`.
2. **Summary / Goals / Non-Goals** scoped to the feature.
3. **Contract mapping:** which §5 contracts it produces or consumes, **using the real type names in §5.1**. If a name does not exist yet, mark it **(new — does not exist yet)** at first use.
4. **Design:** data model, modules, file paths. *(New folders are preferred but frequently impossible — see rule 6's shared-file table. Say which shared files you will touch, and where.)*
5. **Integration point(s):** the specific place(s) it touches existing code, with `file:line`.
6. **Edge cases, testing (Vitest), acceptance criteria.** Acceptance criteria must be **checkable** — a command, an assertion, or an observable outcome. "Works correctly" is not one.
7. **Task order**, starting from the recon report's findings — **never with "first, do recon"** (§9).
8. **Open questions.**

**Completion constraint (amended).** A feature doc is complete when its acceptance criteria are self-contained, it names no invented geometry type, and it changes only shape sources, controls and export.

> **Amendment — read-only contour channel (adopted 2026-09-03).**
>
> As originally written, the final clause — "never the clip/extrude core" — forbids touching `src/utils/geometry/patternPipeline.ts` at all, which makes **doc 06b literally unbuildable**: the pattern footprint exists only inside the worker, every `CrossSection` is freed at `finally { ops.flush() }` (`patternPipeline.ts:369-371`), and `PatternResult` carries only mesh buffers (`:84-100`). There is no legitimate main-thread alternative (§4.2, fact 2).
>
> **A read-only contour channel out of the worker is therefore permitted**, subject to all five conditions:
>
> 1. **Additive only.** No existing statement in `generatePattern` changes semantics. The boolean sequence at `patternPipeline.ts:258-298`, the mask split at `:300-355`, and the emitted `SerializedGeometry` must be byte-identical for an unchanged job — assert this before and after.
> 2. **Read-only.** The channel may call `CrossSection.toPolygons()`, `Manifold.project()` or `Manifold.slice()` on an *already-computed* object. It may not introduce a new boolean into the preview path, and it may not alter what is tracked or freed.
> 3. **Opt-in and off the preview queue.** Contour readback must be requested explicitly — prefer a `kind:'flat'` request over widening `PatternResult`, because the pattern slot coalesces latest-wins (`patternClient.ts:56`, `:63`) and would silently drop an export riding the preview job. When not requested, the pipeline must do no extra work.
> 4. **Both emission sites, before the mask subtract.** On the CSG path the captured value must be `result` **as it stands before the mask subtract at `patternPipeline.ts:354`** — after the max-height cut ends at `:298` and before the `if (hasMasks)` block opens at `:311` — even though it is emitted alongside the final mesh built at `:358`. Contours must **also** be produced at the instanced early return `:223-229`. Miss the first and masked designs silently yield the wrong footprint; miss the second and the fast path (clipping off) silently yields nothing.
> 5. **Wasm hygiene preserved.** Every object created for the channel is tracked and freed under the same `finally { ops.flush() }`, and nothing produced in an unbounded loop is cached (rule 5).
>
> The clause otherwise stands: **no feature may change the boolean semantics of the clip/extrude core.** Adding a seed parameter is likewise permitted — seeded values reach only `instanceMatrix` and `compose`, never a cache key — but note it collides with rule 6, because `generateTilePositions` is shared inherited code called from both threads.

## 11. Open Questions (project-level)

Three of revision 1's four are now **answered from evidence**. Their answers are recorded here rather than deleted, so a child doc that asked the question gets the answer.

### Q1 — Multiple simultaneous shape sources (layered), or one at a time to start? — **OPEN**

**What the code settles:** the app ships **both** models, on different tabs, so this is not a missing capability — it is a choice about which existing model the generator adopts.

- The **Inlay** tab is a full instance manager: `items: InlayItem[]` (`src/types/schemas.ts:50-64`) with per-item transform, tiling mode and a `cut`/`mask`/`avoid` modifier (`:32`), a drag-reorderable list with select and delete (`src/components/controls/InlayControls.tsx:199-268`), `updateItem(id, partial)` (`:90-95`), selection lifted to `src/App.tsx:24`. Reorder is **load-bearing**, not cosmetic: item index drives depth bias and mask precedence (`src/utils/geometry/inlayLayering.ts:41-43`).
- The **Pattern** slot — the one a `Generator` plugs into — is **strictly single-source**: one `patternShapes` array plus one `patternType` (`src/types/schemas.ts:67-68`), one uploader (`src/components/controls/GeometryControls.tsx:145-175`), replaced wholesale on load (`:132-136`). It is single all the way down: `PatternJob` carries exactly one `patternUnit` (`src/utils/geometry/patternPipeline.ts:73`) stamped at every position (`:232-236`), and the instanced path returns one unit geometry plus a matrix array (`:40-45` → `src/utils/geometry/applyPatternResult.ts:71-87`).

**What remains a product call for @liamstar:** how ambitious the generator model should be. The engineering recommendation is **start one-at-a-time for the pattern slot** — it matches the pipeline exactly and costs nothing — and clone the inlay instance-manager pattern when layering is genuinely wanted. Widening to N units means changing `patternUnit`, `InstancedPart` and `applyPatternResult`, or forcing `useCSG` on. *(Recon confidence in the code facts: HIGH. The product decision is unmade.)*

### Q2 — `leva` for speed vs. native Tailwind for polish? — **ANSWERED: native. The premise was inverted.**

`leva` is in **neither** `package.json:17-66` nor `pnpm-lock.yaml`, while the native layer is already written and assembles all three tabs — **28** `<ControlField>` call sites (doc 04 §1 footnote), 17 `DebouncedInput`, 3 `ToggleButton`, 2 `SegmentedControl`. leva would be **slower**, for three structural reasons: every param commits through three prop-drilled `useState` objects (`src/App.tsx:15-21`, 15 props into `Controls` at `:92-114`), so a leva store needs a bridge back into those setters; `tailwind.config.js:4-7` is `theme:{extend:{}}` with `plugins:[]`, so there is no token layer to theme a third-party panel against; and the UI is three `hidden`-toggled panels in one scroll column (`src/components/Controls.tsx:370-406`), not a floating overlay.

**Reframe as: how much of the existing native layer becomes data-driven?** `src/components/ui/SegmentedControl.tsx:16-43` already renders from an `options` array and is the precedent to extend. The descriptor must support **derived** bounds (`src/components/controls/InlayControls.tsx:56`, `:76-85`, `:656-664`). *(Confidence: HIGH. No human call needed.)*

### Q3 — Built-in pads as pre-parsed JSON vs. runtime DXF parse? — **ANSWERED: runtime parse, already shipped. Keep it.**

`BaseControls.tsx:72-79` → `src/utils/shapeLoader.ts:71`. **Both stated tradeoffs are inverted:**

- **Repo size argues *against* JSON.** A typical grip outline is 4761 flattened contour points (`src/utils/geometry/manifoldOps.ts:27-38`); `xrstock.dxf` is 21.7 KB on disk, so the same outline as a flat point list is several times larger as JSON.
- **Fidelity is not a tradeoff at all.** `extrudeSettings = { depth, bevelEnabled: false }` (`src/components/ImperativeModel.tsx:447`) sets no `curveSegments`, so `ExtrudeGeometry` defaults to 12 and calls `shape.extractPoints(12)` — the identical sampling used for the clip contour. A pre-parsed library sampled at `getPoints(12)` produces a **byte-identical** base mesh.

The one real cost is main-thread parse, currently paid badly: the modal returns null when closed and the thumbnail cache is gated to `category === 'patterns'`, so **all 17 thumbnails re-parse synchronously on every open.** Fix that with a module-level cache (M1), not by pre-parsing. *(Confidence: HIGH. No human call needed.)*

### Q4 — Front/rear pads as separate outlines, or one full-board outline? — **ANSWERED: separate, as shipped.**

All 17 presets are single-pad footprints. Raw vertex extents were measured for every file (excluding ARC/CIRCLE/ELLIPSE centre points, which skew the box): 206.1×173.4 mm (pint) to 255.3×233.9 mm (gtkushwide), plus `gtlowboyflared` at 10.1×8.3 in = 256×211 mm — that file alone has no `$INSUNITS` and takes the `$MEASUREMENT === 0` inch branch, so **both tiers of the unit code are exercised by the shipped catalog**. A Onewheel deck is ~640–700 mm; none of these is a full-board span.

The pipeline is agnostic: `parseDxfToShapes` returns disjoint regions as separate top-level shapes with nested regions auto-attached as holes (`src/utils/dxfUtils.ts:410-427`), and `ExtrudeGeometry` accepts the array. Two caveats argue for keeping pads separate: **the green outline overlay renders only `cutoutShapes[0]`, and only its outer ring** (`src/components/ModelViewer.tsx:517-533`), and camera and screenshot framing come from `BaseSettings.size` (default 300 mm) rather than the outline, so the view is over-framed by 21–42% for every shipped pad (`src/components/CameraRig.tsx:39`; `src/components/ScreenshotManager.tsx:36`). *(Confidence: HIGH. No human call needed.)*

### Residual risk — things recon could not settle

These are unknowns, not open design questions. Full list in the report's §8; the three that gate acceptance criteria:

| Unknown | Why it matters | What settles it |
|---|---|---|
| **Is manifold-3d deterministic across runs?** | Rule 4's whole chain depends on it. The claim rests on a string scan of `manifold.wasm`, which has no name section, so a compiled LCG would emit no matching string. | Run the same `PatternJob` twice in Node and compare output buffers byte-for-byte; repeat across two manifold-3d patch versions. **Until then, M2's second assertion uses a tolerance, not byte-equality.** |
| **Does the React Compiler memoize `DebouncedInput`'s inline `onChange` callbacks?** | Determines whether the 150 ms timer restarts, or a clamped value settles into a stale display or a re-fire loop. | Build and inspect the emitted component, or add a render-count assertion to `src/components/DebouncedInput.test.tsx`. |
| **Whether `computeSharpNormals` degrades on high-valence generated meshes.** | It is the pipeline's dominant cost, and its own perf test builds an *unwelded* mesh (identity index, valence 1), so the union-find that scales with valence is never exercised — and the 2000 ms bound is ~40× looser than the linear claim needs. | Re-run `src/utils/geometry/normals.test.ts:200-233` with `weld()` applied, at 4000 boxes. |

Also unpinned: the manifest range for manifold-3d is a **caret** (`package.json:29`) while the lockfile pins 3.5.1 — a lockfile refresh can move it, and a triangulation change moves exported STL bytes for an unchanged design. Consider pinning exactly before any reproducibility guarantee is made to a user.

## 12. Glossary

- **Outline / bounds** — the pad boundary used to clip designs and define extents. Lives as `BaseSettings.cutoutShapes` (`src/types/schemas.ts:14`). Not a type named `Outline`.
- **Shape source** — anything that produces 2D polygons for the pipeline to consume (pad-agnostic). Three de-facto producers exist; the abstraction does not (§5.1).
- **Generator** — a parametric, seeded shape source. **Placement** is already parametric (`generateTilePositions`); **synthesis** is the gap.
- **Pattern unit** — the thing that gets stamped at every tile position. Today always a `THREE.BufferGeometry` from an STL, carried as `PatternJob.patternUnit` (`src/utils/geometry/patternPipeline.ts:73`).
- **The core** — `src/utils/geometry/patternPipeline.ts` + `manifoldOps.ts` + `src/workers/geometryWorker.ts`: the extrude → compose → clip chain behind the worker boundary. Protected by §10.
- **The serialisation seam** — `SerializedShape` / `SerializedGeometry` (`src/utils/geometry/serialize.ts:14-25`), the only representation that crosses into the worker. Payloads must be structured-cloneable (rule 5).
- **Design state** — the serializable description of a design. Exists as `ProjectSchemaV1` → `ProjectData` (`src/types/schemas.ts:87-96`), not as a type named `DesignState`. Extend it; do not replace it.
