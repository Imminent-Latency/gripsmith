# Generator engine — the `ShapeSource` and `Generator` framework

**Doc ID:** `02-generator-engine`
**Status:** Draft — **blocked on one root-doc decision before task 1.** §3 rule 5 and §4.5 deviate from root §5.2 rule 5, and root §5 is authoritative (`docs/00-architecture.md:225`). @liamstar either amends root §5.2 with the carve-out quoted in §3's rule-5 row or overrules §4.5 and this doc is re-scoped to a fourth worker kind. Everything else is ready to implement.
**Owner:** @liamstar
**Parent:** [`./00-architecture.md`](./00-architecture.md) — its §5 contracts and §10 derivation rules bind this doc. Where this doc and the root doc conflict, the root doc wins until amended.
**Evidence base:** `docs/_source/00-recon-report.md` (§1 finding 3, §2 §5-contract-3 / §5-contract-4 / §6-item-2 rows, §3.6, §3.8, §5 "02 — generator engine", §6 M3). Recon is **complete** (root §9); every task below starts from a report finding.

| | |
|---|---|
| **Milestone served** | **M3 — First generator through the real seam** (root §8). This doc is the framework half; doc 03 supplies the first concrete generator that proves it. |
| **Blocked by** | **M2 / doc 08** for the `seed` field — this doc *consumes* `GeometrySettingsSchema.seed` **(new — does not exist yet, owned by doc 08)** and must not define a second seed. Also **M0** for the deletions that make `clipper-lib` stop appearing in greps. |
| **Blocks** | Doc 03 (every concrete generator implements `Generator<P>`), doc 04 (a Generate tab and `ParamField` descriptors read this doc's schema), doc 07 (routing `traceImage` into the pattern lane reuses `ShapeSource`). |
| **Units** | Millimetres, in three.js scene units at 1 unit = 1 mm (root §4.1). A generator that thinks in any other unit converts itself — only DXF import normalises units today (`src/utils/dxfUtils.ts:59-81`). |
| **Toolchain** | pnpm 10.20.0 · Vitest 2.1.9 · Vite 5.4.21 · Tailwind 3.4.19 · zod 4.2.0 · React 19 with the React Compiler **on** (`vite.config.ts:8-14`). |

---

## 1. Summary

**Everything downstream of `geometrySettings.patternShapes` already ships.** Worker execution, wasm bootstrap and warm-up, job coalescing, the `kind:'shapes'` pipeline branch, extrude → compose → clip, mask splitting, and STL/3MF export are all inherited and require **zero** edits from this doc. See [What already exists](#what-already-exists-do-not-rebuild) before writing a line.

What is missing is a **producer**: a typed, parameterised, dynamically-imported thing that writes `THREE.Shape[]` into `geometrySettings.patternShapes`. Two of today's three producers are file-derived (`parseShapeFile` at `src/utils/shapeLoader.ts:12`, `traceImage` at `src/utils/image/traceImage.ts:179`). The third — `SVGPaintModal.onSave` (declared `src/components/SVGPaintModal.tsx:76`, emitted at `:692-695`) — **already synthesises shapes with no file behind them**: its draw, rectangle, circle, triangle and text tools (`ActiveTool`, `:80`) build `THREE.Shape` objects from scratch. It is not reusable as a pattern producer, for three reasons: it is inlay-only, it is modal-bound, and it is unparameterised — `generateTextShapesFromOpentype` is module-private and welded to modal state, and the whole canvas leaves through one `onSave(localShapes)` (recon §2, §6-item-7 and §9-item-4: text "is a tool inside the paint modal whose output leaves only via whole-canvas `onSave`"). So the gap is not synthesis as such; it is a **parameterised, addressable, persistable** producer. None of the three is an abstraction — they are duck-typed as `s.shape || s` at **13 sites** (verified: `grep -rn "\.shape || " src/ | grep -v test` returns 14 hits, one of which — `src/utils/dxfUtils.ts:126` — is the unrelated `poly.shape || poly.closed`).

**The binding constraint that revision 1 of the root doc missed entirely.** `patternUnit` is assembled on the **main thread** inside `buildJob` out of React state (`src/components/ImperativeModel.tsx:825-861`), so generator output must land in state *before a job exists*. And the pattern uploader is gated to `allowedTypes={["stl"]}` (`src/components/controls/GeometryControls.tsx:163`) while all 14 pattern presets are `.stl` (`src/components/PatternLibraryModal.tsx:19-32`), so `patternShapes[0]` is always a `THREE.BufferGeometry` and `buildJob` always takes the `kind:'geometry'` branch at `:829-830`. **The `kind:'shapes'` branch at `src/components/ImperativeModel.tsx:832-836` → `src/utils/geometry/patternPipeline.ts:47-49`, `:138-139` has no reachable production path today.** It is constructed in production at exactly one site (`ImperativeModel.tsx:836`) and exercised only by tests (`src/utils/geometry/patternPipeline.test.ts:46`, `:149`; `src/utils/geometry/exportMerge.test.ts:33`). **A generator will be its first production caller**, and §5 of this doc documents the two traps waiting there.

**The decision this doc makes:** generation runs on the **main thread**, in a null-rendering `GeneratorRunner` component mounted inside `AlertProvider` in `App.tsx`. **No fourth worker message kind is added.** §4.5 justifies this against the wasm-compile cost of a second realm and the five edits a third kind requires.

## 2. Goals / Non-Goals

**Goals**

1. Define `ShapeSource` and `Generator<P>` as real, greppable types in a new folder, modelled on the informal contract the three existing producers already share.
2. Make a generated pattern reach `patternShapes` through the **existing** seam, so the whole downstream pipeline works with zero core edits.
3. Persist a generated design as `generatorId + generatorParams + seed`, and **regenerate it on import** — the first geometry in the app that is genuinely re-derivable from its saved form (root §2 problem 2, "Re-derived: false, and this is the real gap").
4. Neutralise the two traps on the `kind:'shapes'` path (§5) before doc 03 hits them.
5. Keep every generator behind a dynamic `import()` so it stays out of the 531.65 kB gzipped main chunk (`docs/_source/baseline-verification.md`).

**Non-Goals**

- **No concrete generators.** Voronoi, noise-contour, truchet and L-system are doc 03. This doc ships one ~40-line deterministic *fixture* generator whose only job is to prove the framework and the seam; it is not a product feature.
- **No parametric UI.** `ParamField` **(new — does not exist yet)**, `Slider` **(new — does not exist yet)** and the Generate tab are doc 04. This doc's minimum viable surface is a generator picker in the existing Geometry panel (task 9, §4.6 row 7).
- **No seed or PRNG.** Doc 08 owns both. This doc consumes `seed` and asserts it flows through.
- **No worker changes.** `src/workers/geometryWorker.ts`, `src/utils/geometry/patternClient.ts` and `src/utils/geometry/patternPipeline.ts` are untouched — §4.5.
- **No decimation change inside the pipeline.** The `patternPipeline.ts:138` decimation hook is doc 03's, and is deliberately avoided here in favour of a main-thread alternative (§5.2).
- **No layering.** The pattern slot is strictly single-source and stays that way (root §11 Q1); the recommendation there — start one-at-a-time — is adopted.

## 3. Contract mapping (root §5)

| Root §5 contract | This doc | Real type / attachment, with `file:line` |
|---|---|---|
| **`Polygon`** | **Consumes. Pins, does not extend.** | Emits representation 1, `THREE.Shape` with holes as `.holes: THREE.Path[]` (`src/types/schemas.ts:14`, `:22`, `:67`), optionally wrapped as representation 2, `{ shape: THREE.Shape; color: string }` (`src/utils/shapeLoader.ts:53`). Conversion to the wire form is done **for us** by `serializeShapes` (`src/utils/geometry/serialize.ts:47-50`) at `src/components/ImperativeModel.tsx:836`. **No seventh representation is introduced.** |
| **`Outline`** | **Reads only, and only outside `produce()`.** | `BaseSettings.cutoutShapes` (`src/types/schemas.ts:14`). It is **not** a parameter of `produce()` — see §4.2. Outline fitting is already a separate step performed downstream by the tiler and the clip (`src/utils/geometry/patternPipeline.ts:168-171`, `:218`, `:269`). |
| **`ShapeSource`** | **Produces — this doc creates it.** | `ShapeSource` **(new — does not exist yet)** in `src/utils/generators/types.ts` **(new)**. Modelled on `parseShapeFile` (`src/utils/shapeLoader.ts:12`), `traceImage` (`src/utils/image/traceImage.ts:179`) and `SVGPaintModal.onSave` (`src/components/SVGPaintModal.tsx:76`). Output lands in `geometrySettings.patternShapes`, precedent `handlePatternLoaded` (`src/components/controls/GeometryControls.tsx:114-141`). |
| **`Generator<P>`** | **Produces — this doc creates it.** | `Generator<P>` **(new — does not exist yet)**, `GeneratorEntry` **(new)**, `GeneratorRegistry` **(new)** in `src/utils/generators/` — all three are declared in §4.3, and `GeneratorRegistry` is the alias `readonly GeneratorEntry[]` that annotates the `GENERATOR_REGISTRY` const. Params persist as two new fields on `GeometrySettingsSchema` (`src/types/schemas.ts:66-85`), **each carrying `.default()`** because `getDefaults` is `schema.parse({})` (`src/utils/schemaDefaults.ts:6-8`) and throws otherwise. **Declared divergence — `generateTilePositions`.** Root §5.1's `Generator<P>` row (`docs/00-architecture.md:252`) says `generateTilePositions` (`src/utils/patternUtils.ts:285-299`) "**is** the existing parametric engine to generalise". This doc leaves it untouched: a `Generator` synthesises the **unit** and the existing tiler places it, which is what root §6's doc-02 scope (`docs/00-architecture.md:307` — "produce `THREE.Shape[]` into `patternShapes`") and recon §5's 02 table both call for. Generalising the placer is doc 08's seed work and doc 03's per-generator tile caps, not this doc. Amend root §5.1's wording or overrule this — @liamstar's call. |
| **`DesignState`** | **Extends `ProjectSchemaV1`, additively.** | `ProjectSchemaV1` → `ProjectData` (`src/types/schemas.ts:87-96`). The two new `GeometrySettingsSchema` fields ride the existing bundle path (`src/utils/projectUtils.ts:29-87`) with no export/import edit, **because they are plain JSON**. This is the specific respect in which a generated design beats every other geometry in the app: `patternShapes` is nulled on export (`src/utils/projectUtils.ts:53`), so a generated pattern is the only pattern that comes back **without a source file in the zip**. An STL pattern does come back — but only because its bytes ride the zip as an asset and are re-parsed with `parseShapeFile` on import (`src/components/Controls.tsx:187-197`, recon §3.5 "Import re-hydrates from zip assets"). See §4.7. |

**Rules honoured.**

| Root §5.2 rule | Status |
|---|---|
| **1** — emit `THREE.Shape[]` in mm, rings implicitly closed, ≥3 vertices, polylines not curves | Honoured, and enforced mechanically by `validateShapeSourceOutput` **(new — does not exist yet)** — §4.4. |
| **2** — do not re-implement clip / offset / extrude | Honoured. Nothing here does. |
| **3** — a persisted tunable lives in a settings schema with `.default()` | Honoured. Both new fields carry `.default()`. |
| **4** — one seed, persisted | Honoured by deferral. The seed comes from doc 08 / M2; this doc defines none. |
| **5** — heavy geometry goes in the **existing** worker; no second worker without a stated reason | **Deviated from — and until @liamstar rules, this is a doc-set blocker, not a design note.** Rule 5's default placement is the existing worker; generation runs on the **main thread** instead (§4.5). Rule 5's two *hard* constraints — structured-clone-safe payloads and wasm-realm tracking — are untouched, because no second worker and no fourth job kind are added; what is deviated from is the default placement. Root §5 is authoritative over child docs (`docs/00-architecture.md:225`), so exactly one of two things must happen **before task 1**. **(a)** Root §5.2 rule 5 gains this carve-out, verbatim: *"Polygon synthesis that needs no wasm may run on the main thread, provided the doc states a per-generator time budget and a documented revisit trigger."* §4.5 already satisfies both conditions (50 ms measured around step 4 of `runGenerator`), so this row then reads "Honoured under that amendment" and §4 stands as written. **(b)** The carve-out is refused — then §4.5 is void, along with §4.6 row 2, §6.3 criteria 8–10 and §7 task 7, and this doc is re-scoped to a fourth worker kind at the five-edit cost §4.5 tables. Do not start task 1 under "root wins until amended": that reading makes §4.1, §4.4, §4.5 and §4.6 unimplementable as written. |
| **6** — folder isolation; enumerate every shared-file edit | Honoured. The shared-file budget is enumerated in §4.6 and is **eight insertions in four files**. |

## 4. Design

### 4.1 Where generation runs, and who owns the effect

A generator is a React-side side effect keyed on `(generatorId, generatorParams, seed)` that writes `patternShapes`. Three candidate homes, one of which is a trap:

| Candidate | Verdict |
|---|---|
| Inside `GeometryControls` | **Broken.** The Geometry panel is wrapped in `<Freeze freeze={activeTab !== 'geometry'}>` (`src/components/Controls.tsx:397`) and the default tab is `'base'` (`src/App.tsx:36`), so the panel **does not mount until the user first clicks Geometry**, and freezes again when they leave. An imported project would not regenerate; a param change made before the tab is opened would be lost. |
| Inside `App`'s function body | **Broken for error reporting.** `AlertProvider` is rendered *inside* `App`'s JSX (`src/App.tsx:66`; provider defined at `src/context/AlertContext.tsx:22`), so a hook in `App`'s body is above the provider and cannot call `useAlert`. Rule 5's "failure must not be silent" then has nowhere to go. |
| **A null-rendering child inside `AlertProvider`** | **Chosen.** One JSX line in `App.tsx`, always mounted, inside the provider, owns no state of its own. |

```
src/components/GeneratorRunner.tsx      (new)  — returns null; useAlert() + useGeneratedPattern()
```

Mounted in `src/App.tsx` immediately after `<AlertProvider>` opens at `:66`:

```tsx
<AlertProvider>
  <GeneratorRunner settings={geometrySettings} setSettings={setGeometrySettings} />
  <div className="h-[100dvh] ...">
```

`App` already owns `geometrySettings`/`setGeometrySettings` (`src/App.tsx:18`), so nothing is prop-drilled further and `Controls.tsx` is not touched at all.

**`GeneratorRunner.tsx` is outside the Vitest coverage allowlist by design.** The allowlist is `src/utils/**`, `src/context/**` and exactly two named components (`vite.config.ts:30-35`), so this file reports 0% silently. That is acceptable only because it holds **no logic** — every line of behaviour lives in `useGeneratedPattern.ts` under `src/utils/**`. Do not "fix" it by widening `vite.config.ts`: that file is on the not-touched list (§4.6, criterion 8).

**React Compiler note.** The compiler is on with `target: "19"` (`vite.config.ts:8-14`) and `main.tsx:7` wraps the tree in `StrictMode`, so the effect double-invokes in development. The effect must therefore be **idempotent and abortable**: capture a `let cancelled = false` and ignore a late resolution, exactly as the existing heavy effect does at `src/components/ImperativeModel.tsx:886-892`. Do not mutate `settings` in place.

**How the effect commits — the functional updater is mandatory, not stylistic.** The effect resolves asynchronously, so the `settings` it captured is stale by the time it writes. It must commit as

```ts
setSettings(prev => ({ ...prev, patternShapes: out }));
```

matching `updateGeom` (`src/components/Controls.tsx:65`), which uses `prev => ({ ...prev, ...updates })` for exactly this reason. Spreading the captured `settings` — `setSettings({ ...settings, patternShapes: out })` — clobbers every control edit that landed while the generator was running.

### 4.2 The `ShapeSource` contract

```ts
// src/utils/generators/types.ts   (new — does not exist yet)
import type * as THREE from 'three';

/**
 * Representation 1 or representation 2 of root §5's geometry table.
 * The `{shape,color}` member exists because three of the app's producers already emit it
 * (src/utils/shapeLoader.ts:53; src/utils/image/traceImage.ts:202; SVGPaintModal's
 * ShapeEntry, declared at src/components/SVGPaintModal.tsx:64, built at :189-196 and
 * emitted through onSave at :693) and buildJob already unwraps it
 * (src/components/ImperativeModel.tsx:833).
 */
export type ShapeSourceOutput = Array<THREE.Shape | { shape: THREE.Shape; color: string }>;

export interface ShapeSource {
  /** Stable, greppable id. Also the persisted discriminator. */
  readonly id: string;
  /** Human label for the picker. */
  readonly label: string;
  produce(): Promise<ShapeSourceOutput>;
}
```

**Declared divergence — where `ShapeSource` lives.** Root §5.1's `ShapeSource` row ends *"Define it beside `src/utils/shapeLoader.ts:12`."* This doc places it one level down, in `src/utils/generators/types.ts`. It is still inside the Vitest coverage allowlist `src/utils/**` (`vite.config.ts:30-35`), so nothing is lost on coverage; the gain is that the whole framework is a new folder with no shared file among its modules, which is rule 6's isolation preference. Root §5.1 wins until amended — amend it or overrule this, at @liamstar's call.

Three properties, each forced by the code rather than chosen:

- **Asynchronous.** Note precisely *why*, because the report's phrasing ("Real signature is async") is about the call path, not the functions: `parseShapeFile` (`src/utils/shapeLoader.ts:12`) returns `LoadedShapeResult` **synchronously** and `traceImage` (`src/utils/image/traceImage.ts:179`) returns `TraceResult` **synchronously**. What is async is every path that reaches them — `FileReader` in the uploader, `await fetch(...)` in the library preset handler (`src/components/controls/GeometryControls.tsx:180-199`), image decode for the trace path. Independently and decisively: root §4.1 requires every generator to be **dynamically imported** to stay out of the 531.65 kB main chunk, and `import()` is a promise. A synchronous signature would have to be widened on day one.
- **Heterogeneous return union.** Not a cosmetic convenience — it is the *existing* contract. `buildJob` unwraps with `.map((s: any) => s.shape || s)` at `src/components/ImperativeModel.tsx:833` and `ShapeUploader`'s preview does the same at `src/components/ShapeUploader.tsx:44`, so a colour-carrying generator works end-to-end with no new code. §5.1 records the one place that does **not** unwrap.
- **No `seed`, no `outline` in the signature.** A generator's seed is part of its params `P` and comes from the persisted `GeometrySettingsSchema.seed` **(new — doc 08)**; putting it in the signature would give a stochastic generator two seeds. The outline is absent because outline-fit is already a separate downstream step: the tiler receives the outline as `boundaryShapes` (`src/utils/geometry/patternPipeline.ts:184-190`) and the clip is a conditional 3D boolean (`:218`, `:269`). A generator that took the outline would be re-deriving a boundary the pipeline already applies, and would silently disagree with the preview — the same trap root §4.2 fact 2 flags for flat export.

### 4.3 `Generator<P>` and the registry

```ts
// src/utils/generators/types.ts   (new)
import type { z } from 'zod';

/**
 * A parametric ShapeSource. `schema` is the single source of truth for the params:
 * it supplies defaults (schema.parse({})), validation, and — for doc 04 — the descriptor
 * the UI renders from.
 *
 * EVERY field in `schema` MUST carry .default(), because getDefaults is schema.parse({})
 * (src/utils/schemaDefaults.ts:6-8). Do NOT model a params schema on InlayItemSchema
 * (src/types/schemas.ts:19-46) — it has no defaults and would throw.
 */
export interface Generator<P> {
  readonly id: string;
  readonly label: string;
  readonly schema: z.ZodType<P>;
  generate(params: P): Promise<ShapeSourceOutput>;
}

/** A registry row. The loader is a dynamic import so the generator stays out of the main chunk. */
export interface GeneratorEntry {
  readonly id: string;
  readonly label: string;
  readonly load: () => Promise<Generator<Record<string, GeneratorParamValue>>>;
}

export type GeneratorParamValue = number | string | boolean;

/** The registry's own type. Declared so §3's contract row names something real. */
export type GeneratorRegistry = readonly GeneratorEntry[];
```

```ts
// src/utils/generators/registry.ts   (new)
export const GENERATOR_REGISTRY: GeneratorRegistry = [
  { id: 'fixture-grid', label: 'Grid (fixture)', load: () => import('./fixtureGrid').then(m => m.default) },
  // doc 03 appends here — one line per generator, always a dynamic import
];
export function findGenerator(id: string | null): GeneratorEntry | null { /* … */ }
```

**Why a flat `Record<string, number|string|boolean>` and not a zod discriminated union in `src/types/schemas.ts`.** A union would require statically importing every generator's schema into the shared schema file, which defeats the dynamic import and grows the main chunk by every generator ever added. It would also put doc 03's churn inside a rule-6 shared file. The cost of the flat bag is that `ProjectSchemaV1` cannot validate a generator's params on import; `runGenerator` does it instead, at the only moment it matters (§4.4). Restricting values to JSON scalars keeps export clean — unlike `patternShapes`, which is nulled on export precisely because it holds live objects (`src/utils/projectUtils.ts:53`).

**Schema additions** — two fields, both with `.default()`, inserted in `GeometrySettingsSchema` (`src/types/schemas.ts:66-85`):

```ts
export const GeneratorParamsSchema = z.record(
  z.string(),
  z.union([z.number(), z.string(), z.boolean()]),
);                                                   // (new — does not exist yet)

// inside GeometrySettingsSchema:
generatorId: z.string().nullable().default(null),        // (new)
generatorParams: GeneratorParamsSchema.default({}),      // (new)
// seed: owned by doc 08 / M2 — do NOT add a second one here.
```

`patternShapes` itself needs **no** schema change: it is `ThreeObjectsSchema` — `z.custom<any[]>((val) => Array.isArray(val))` (`src/types/schemas.ts:8`, `:67`) — and already accepts `THREE.Shape[]`.

**`patternType` must be set to `null` explicitly, by the picker.** Nothing clears it on its own: `patternType` is written at exactly three sites — `handlePatternLoaded` (`src/components/controls/GeometryControls.tsx:134`), `onClear` (`:158`) and the import path (`src/components/Controls.tsx:196`) — and **none of them fires when a generator becomes active**. A user who loads an STL preset (`patternType: 'stl'`) and then picks a generator would otherwise hold `generatorId` set *and* a stale `patternType: 'stl'`. That combination is one deleted guard away from a crash: `calculateAutoPatternScale`'s `type === 'stl'` branch (`:79-84`) calls `geometry.computeBoundingBox()` on what is now a `THREE.Shape`, and only §5.1's early return keeps it unreachable. So the picker's `updateSettings` call carries `patternType: null` alongside `generatorId` (§4.6 row 7, criterion 19).

With that written, `patternType` is `null` for a generated unit and nothing downstream reads it. The pipeline never does; the only non-test readers are `src/utils/patternUtils.ts:822`/`:853`/`:863`, all inside the dead `tileShapes` at `:800`, and the two auto-scale call sites at `src/components/controls/GeometryControls.tsx:227` and `:260` (the `patternType` argument itself is passed at `:229` and `:262`), both of which §5.1 gates. It is declared as an `ImperativeModel` prop at `src/components/ImperativeModel.tsx:22` and passed at `src/components/ModelViewer.tsx:470` but **never read in the body**. Widening the enum is optional and is left as §8 Q1.

### 4.4 Modules and the run path

New folder, no shared file among them. `src/utils/**` is inside the Vitest coverage allowlist (`vite.config.ts:30-35`), which is why the hook lives here too rather than in a new `src/hooks/` that would report 0% silently.

```
src/utils/generators/                  (new folder)
├── types.ts              ShapeSource, ShapeSourceOutput, Generator<P>, GeneratorEntry,
│                         GeneratorParamValue, GeneratorRegistry.  Types only — no runtime
│                         import of three.
├── registry.ts           GENERATOR_REGISTRY: GeneratorRegistry, findGenerator(id).
│                         Dynamic imports only.
├── normalize.ts          validateShapeSourceOutput(), decimateShapes().  Pure JS over point
│                         lists: never mutates its input, constructs THREE.Shape/THREE.Path
│                         only to return decimated output, and decimates shape.holes
│                         alongside the outer ring (serializeShape reads shape.holes at
│                         src/utils/geometry/serialize.ts:39-43 — dropping them loses holes).
├── runGenerator.ts       The one entry point: id + params -> Promise<ShapeSourceOutput>.
├── fixtureGrid.ts        ~40-line deterministic fixture generator. Not a product feature.
└── useGeneratedPattern.ts  The effect. Thin: all logic lives in runGenerator/normalize.

src/components/GeneratorRunner.tsx      (new)  null-rendering mount point (§4.1)
```

`runGenerator(id, rawParams)` does exactly five things, in order:

1. `findGenerator(id)` — unknown id is an error, not a silent no-op.
2. `await entry.load()` — the dynamic import.
3. `gen.schema.parse(rawParams)` — fills every missing field from `.default()` and rejects a bad value. This is the moment the flat bag becomes typed.
4. `await gen.generate(params)`.
5. `validateShapeSourceOutput(out)` → `decimateShapes(out, tolerance)` → return. **Both halves of step 5 are built by task 5**, with `tolerance` defaulting to `GENERATOR_TOLERANCE_DEFAULT = 0` **(new — does not exist yet)** (§5.2) so decimation is a no-op until a generator opts in. **Task 13 does not re-wire this** — the call already exists after task 5; task 13 only adds the criterion-14 and criterion-15 tests against it and records the numbers in §8 Q3 (§7).

`validateShapeSourceOutput` mechanises rule 1 and root §7 so a generator author cannot silently violate them. It returns `{ shapes, diagnostics }`, never throws, and drops nothing without reporting it:

| Check | Why, with citation |
|---|---|
| Every ring has ≥3 vertices | `points.length < 6` is silently dropped at `src/utils/geometry/manifoldOps.ts:86`, and again at `:93`, `:132`, with no error and no `empty` signal a consumer reads. |
| Ring is **not** explicitly closed (last point ≠ first point) | Rings are implicitly closed (root §7). DXF rings carry a duplicate because `build()` is called with `force=true` even for open chains (`src/utils/dxfUtils.ts:384`, `:387-388`); shapes from `new THREE.Shape(points)` do not. A generator appending a duplicate adds a zero-length segment for no benefit. |
| Coordinates are finite and within a sane mm envelope | The 17 shipped outlines span 206.1×173.4 mm to 255.3×233.9 mm (root §7). A generator emitting SVG user units would be ~3.5× oversize and silently clipped away. |
| **Combined XY bounding box has width and height > `MIN_UNIT_EXTENT_MM = 0.01`** **(new — does not exist yet)** | Not a point-count check — a *degenerate-extent* check, and the only thing on the generator's side that stops the §6.1 "unbounded output" hang (a user-set `patternScale: 0` reaches it by another route this doc does not own). The hazard is a **non-zero but sub-threshold** extent (say 1e-6 mm), not an exactly-zero one. `patternPipeline.ts:173-174` feeds `unitW`/`unitH` straight into `pWidth`/`pHeight`, which become the tiler's `tileWidth`/`tileHeight` (`:184-190`); a 1e-6 mm unit with `tileSpacing = 0` gives `fullWidth = tileWidth + spacing` near zero (`src/utils/patternUtils.ts:478`), so `cols = Math.ceil(spanW / fullWidth) + 1` (`:684`) lands in the hundreds of millions and the inclusive `for (let c = 0; c <= cols; c++)` at `:696` runs effectively forever **inside the worker** — finite, but indistinguishable from a hang. An *exactly* zero-area unit does not reach that code: it yields a zero-area `CrossSection`, a zero-triangle extrude, and an early `return empty()` at `patternPipeline.ts:141`, before `unitW`/`unitH` are read at `:158-159` — so it vanishes silently with no error, which is the other half of why this check is needed. **Compute the box over the *unwrapped* shapes.** `getShapesBounds` (`src/utils/patternUtils.ts:12-30`) already does exactly this arithmetic, but its body is a bare `shape.getPoints()` per array member (`:16-21`) and so throws on a `{shape,color}` wrapper — either `.map(s => s.shape \|\| s)` first, or inline the bbox loop in `normalize.ts` to keep the folder dependency-free. |
| Holes live on `shape.holes`, not as sibling shapes | `serializeShape` reads `shape.holes` (`src/utils/geometry/serialize.ts:39-43`); a sibling ring becomes a solid island. |
| **Overlapping cells are separate array members, never rings of one shape** | `csFromShapes` builds one `CrossSection` per `SerializedShape` and unions them (`src/utils/geometry/manifoldOps.ts:91-98`), so separate shapes union correctly — but a single shape whose own rings overlap **XOR-cancels** under `'EvenOdd'` (root §5.2 rule 1). This is the single easiest way for a Voronoi or noise generator to produce holes it never asked for. |
| Total point count against a stated ceiling | §5.2. |

Curves need no check because they cannot survive: `serializeShape` flattens through `getPoints()` at its default 12 divisions (`src/utils/geometry/serialize.ts:29-32`, `:36`). Generators emit polylines at the resolution they want.

### 4.5 Deviation from rule 5 — main-thread generation, no fourth worker kind

**Decision: generate on the main thread. Do not add a `kind:'generate'` message, and do not create a second worker.**

**This is a declared deviation, not a compliance claim, and it gates task 1.** Root §5.2 rule 5's default placement for geometry work is the *existing* worker; running generation on the main thread satisfies neither that default nor its "second worker with a stated reason" escape hatch. It does keep both of rule 5's hard constraints intact — no new structured-clone payload shape, no second wasm realm to track. The justification is below and the revisit trigger is concrete (50 ms). §3's rule-5 row states the exact carve-out this section needs added to root §5.2 and what becomes void if @liamstar refuses it. **Settle that before task 1**; do not implement §4 while "root wins until amended" still stands, because under that reading §4.1, §4.4, §4.5 and §4.6 are not implementable as written.

The alternatives and why they lose:

**A second, generator-only worker — rejected outright.** A second worker realm that **calls** `getManifold()` compiles the 541.47 kB `manifold.wasm` a second time (`docs/_source/baseline-verification.md`), because the module promise is memoized *per realm inside the function*: `modulePromise` is a module-level `let` initialised to `null` (`src/utils/geometry/manifoldModule.ts:15`) and assigned only within `getManifold()` itself (`:18-26`). Note precisely what this does **not** mean: merely *importing* `manifoldModule.ts` — or `serialize.ts`, `patternUtils.ts`, or any other `src/utils/geometry/` module that never calls it — compiles nothing. The compile is triggered by a call, which is why the app can deliberately pay that cost once, up front, via `warmUp()` at `src/utils/geometry/patternClient.ts:93-95` called from `src/App.tsx:42-44`. The conclusion stands anyway: root rule 5 forbids a second worker without a stated reason, and synthesis of 2D polygons is not one, because **a generator needs no wasm at all** — Voronoi, noise, truchet and L-system are plain JS. So a generator-only worker would either duplicate the compile (if it touched Manifold) or buy nothing over the main thread (if it did not), while adding a realm to track.

**A third kind on the existing worker — rejected on cost/benefit, not on feasibility.** It is buildable. It costs **five edits**, all in shared files, and one of them is a behavioural decision, not a mechanical insert:

| # | Site | Edit |
|---|---|---|
| 1 | `src/workers/geometryWorker.ts:21-24` | widen the closed union `'pattern' \| 'inlay' \| 'warmup'` and add a dispatch arm — which must sit **above** `await getManifold()` at `:35`, or a polygon-only job pays the wasm compile for nothing. `warmup` at `:30-33` is the worked example. |
| 2 | `src/utils/geometry/patternClient.ts:17` | widen `type Kind = 'pattern' \| 'inlay'`. |
| 3 | `src/utils/geometry/patternClient.ts:31-32` | add the kind to both `latest` and `slots` records. |
| 4 | `src/utils/geometry/patternClient.ts:63` | the pump priority is hardcoded `this.slots.pattern ?? this.slots.inlay`. A third term needs an ordering decision: a generate job must run *before* the pattern job that consumes it, which inverts the existing "pattern first" bias. |
| 5 | `src/utils/geometry/patternClient.ts:97-105` | a `submitGenerate` method with its own transferables list. |

And the architecture defeats it anyway. Because `patternUnit` is assembled on the main thread in `buildJob` (`src/components/ImperativeModel.tsx:825-861`), worker-side generation is **two** round trips with a redundant conversion in the middle: main → worker (generate) → main (`deserializeShape` at `src/utils/geometry/serialize.ts:61` to rebuild `THREE.Shape` for React state) → `setState` → worker (`serializeShapes` again at `ImperativeModel.tsx:836`). The polygons cross the structured-clone seam twice and are serialised twice, to move work that is not the bottleneck. The measured cost centres are Manifold booleans and `computeSharpNormals` (`src/utils/geometry/normals.ts:26` via `src/utils/geometry/manifoldOps.ts:217`), not polygon arithmetic, and the whole-pipeline budget is "well under 200 ms for a dense grip" inside a 150 ms debounce (`src/components/DebouncedInput.tsx:9-18`).

Finally, the highest-severity failure mode in the app is exposure-proportional: a single non-cloneable value in a job assigns `this.inFlight = next` before `postMessage` with no try/catch (`src/utils/geometry/patternClient.ts:66-67`) after the pending slot was nulled at `:65`, so a `DataCloneError` **permanently wedges all geometry generation for the session** with the spinner stuck on (`src/components/ImperativeModel.tsx:811`, cleared only at `:880`/`:890`). There is no timeout and no `terminate()`. Not adding a job kind is not adding exposure.

**What keeps the door open.** `produce()` is a promise. A specific generator measured over budget can be moved behind a worker later by changing only its own module — the contract, the registry and the effect are unchanged. **The trigger to revisit:** a generator whose `generate()` exceeds **50 ms** at its documented maximum complexity, measured with `performance.now()` around step 4 of `runGenerator`. 50 ms is a third of the 150 ms debounce and leaves the existing pipeline its own budget.

### 4.6 Shared files touched — the complete list

Folder isolation is achievable for every *new* module here; **eight insertions in four shared files** are unavoidable. This table is the complete list — an implementer who works from it alone must ship a correct feature, so the two `ShapeUploader`-facing edits from §5.3, task 9's picker and the `schemaDefaults.test.ts` extension are rows here, not prose. Root rule 6's failure table applies, and **the two rows most often missed do not apply to this design** — see the note below.

| # | Shared file | Exact edit | Why isolation is impossible |
|---|---|---|---|
| 1 | `src/types/schemas.ts:66-85` | 2 fields on `GeometrySettingsSchema`, both `.default()`; `GeneratorParamsSchema` above it | Rule 3: a persisted tunable must live in one of the three settings schemas, and `getDefaults` is `schema.parse({})` (`src/utils/schemaDefaults.ts:6-8`). There is no other schema home. |
| 2 | `src/App.tsx` (one line after `:66`) | mount `<GeneratorRunner settings={geometrySettings} setSettings={setGeometrySettings} />` | §4.1 — the only always-mounted node inside `AlertProvider` that can see `geometrySettings` (`:18`). |
| 3 | `src/components/controls/GeometryControls.tsx:132-136` | add `generatorId: null` to `handlePatternLoaded`'s `updateSettings` call | An STL upload or library pick must clear the generator, or the App-level effect immediately regenerates over the uploaded unit. The write is inside a local function in a shared file; there is nowhere else. |
| 4 | `src/components/controls/GeometryControls.tsx:74` | insert `if (settings.generatorId) return null;` as the **first statement** of `calculateAutoPatternScale` | §5.1. One edit, **not** a `generatorActive` parameter: the function is declared inside the component body (`:30-35`, `:67`) so `settings` is already in scope, and a single early return covers all three call sites (`:116`, `:227`, `:260`) plus any fourth added later. A parameter would have to be `!!settings.generatorId` at `:227`/`:260` anyway — a literal `true` there would kill auto-scale for uploaded STLs and all 14 library presets. It has one accepted consequence at `:116`; see §5.1's ordering note. |
| 5 | `src/components/controls/GeometryControls.tsx:155-162` | add `generatorId: null` to `onClear`'s `updateSettings` call | Without it the App effect regenerates the instant the user clicks the uploader's X and the button appears broken (§5.3). `ShapeUploader` owns the button; only this callback can clear the generator. |
| 6 | `src/components/controls/GeometryControls.tsx` (a new effect beside `:60-64`) | a `useEffect` keyed on `settings.generatorId` that sets `libraryPatternName` to the active generator's label and to `null` when it clears | Setting the label is **not** a one-liner, and there is no single line at which a setter can be called: `libraryPatternName` is component-local `useState` (`:56-58`) written from exactly three places — the uploader's `onUpload` (`:153`), the library preset handler (`:205`), `onClear` (`:160`) — and the only existing effect on it (`:60-64`) *resets it to null* when `patternShapes` empties. A generated pattern goes through none of those paths, so it needs its own effect. It matters because `libraryPatternName` is the `fileName` prop passed to `ShapeUploader` at `:150`, and left null the pill reads `"Custom Drawing"` (`src/components/ShapeUploader.tsx:175`). |
| 7 | `src/components/controls/GeometryControls.tsx` (a new block in the Geometry panel) | a generator `SegmentedControl` built on `src/components/ui/SegmentedControl.tsx:16-43`, whose `onChange` calls `updateSettings({ generatorId: id, patternType: null })` | Task 9's minimum viable picker. §2 puts the picker in scope; doc 04 replaces it. `patternType: null` is part of the **same** insertion and is not optional — `patternType` is written at only three sites (`:134`, `:158`, `src/components/Controls.tsx:196`), none of which fires when a generator becomes active, so a stale `'stl'` from a previous upload otherwise survives (§4.3, criterion 19). |
| 8 | `src/utils/schemaDefaults.test.ts` | append two assertions to the existing describe block: `getDefaults(GeometrySettingsSchema)` yields `generatorId === null` and `generatorParams` deep-equals `{}` | The **only** baseline test file this workstream edits, so rule 6 requires it enumerated here. Additive only: no existing assertion is changed or removed (criterion 1). |

**Not touched, and each is an acceptance criterion:** `src/utils/geometry/patternPipeline.ts`, `src/workers/geometryWorker.ts`, `src/utils/geometry/patternClient.ts`, `src/components/OutputPanel.tsx`, `src/components/Controls.tsx`, `src/components/ModelViewer.tsx`, `src/components/ImperativeModel.tsx`, `vite.config.ts`.

> **Two root-rule-6 rows that this design retires.**
>
> The recon report's §5 "02 — generator engine" table lists *"Regeneration trigger for new params → `src/components/ImperativeModel.tsx:897-903`, Core? yes"*, and rule 6's table warns that the **38th JSX attribute on `<ImperativeModel>`** (`src/components/ModelViewer.tsx:460-501`) is the step most often missed. Both assume generator params reach `buildJob`. Under main-thread generation **they never do** — the only thing that crosses into `ImperativeModel` is `patternShapes`, which is **already** a dependency at `src/components/ImperativeModel.tsx:901`. A new array identity from `updateGeom` (`src/components/Controls.tsx:65`, a spread) re-runs the heavy effect for free. Neither the prop chain nor the hand-maintained dependency array needs an edit. This is a deliberate divergence from the report's task list, justified by §4.5's decision — not a correction of a report fact.

### 4.7 Persistence and re-derivation

`generatorId` and `generatorParams` are plain JSON, so they ride `exportProjectBundle`/`importProjectBundle` (`src/utils/projectUtils.ts:29-87`, `:105-199`) **with no edit to either**. `patternShapes` is nulled on export at `src/utils/projectUtils.ts:53`, and `ProjectSchemaV1` is a non-strict `z.object` that silently strips unknown keys (root §4.1) — but these are declared fields, so they survive.

On import, `Controls.tsx:236-238` sets all three settings objects. The App-level effect sees a non-null `generatorId` with a null `patternShapes` and regenerates. **`src/components/Controls.tsx` needs no edit** — the import path is a plain state write and the effect is keyed on state.

**The effect must guard on emptiness, not only on key change** — otherwise the headline promise fails for the most common import. `patternShapes` is nulled on export (`src/utils/projectUtils.ts:53`), but `generatorId` and `generatorParams` come back **byte-identical** whenever the user re-imports the design they are already viewing, or imports two copies of the same design. The effect's dependency key is then unchanged, React skips the effect, and the pad renders with no pattern and no error. So the effect runs when **either** condition holds:

```ts
const needsRun =
  settings.generatorId !== null &&
  (keyChanged || !settings.patternShapes || settings.patternShapes.length === 0);
```

and it **no-ops entirely** when `generatorId === null` — it must never write `patternShapes: []`, which is `onClear`'s signal (§5.3). Criterion 16 asserts the identical-re-import case specifically; §6.1 carries both rows.

This makes a generated design the only geometry in the app that survives a round trip without its source bytes. The traced-image and painted-inlay cases cannot do this (`src/components/controls/InlayControls.tsx:131`, `:152` — doc 07's "real blocker"), because a raster trace is not re-derivable from scalars. A generator is.

**Effect key.** `generatorParams` is an object; keying the effect on its identity would re-run the generator on every unrelated `setGeometrySettings`. Key on a **canonical serialisation with sorted keys** — `JSON.stringify(Object.keys(p).sort().map(k => [k, p[k]]))` — because key insertion order differs between `schema.parse({})` and an imported bundle, and `JSON.stringify` preserves insertion order.

## 5. Integration points, and the two traps

### 5.1 Trap 1 — `calculateAutoPatternScale` silently rescales, and throws on a `{shape,color}` wrapper

`calculateAutoPatternScale` is a local function in `src/components/controls/GeometryControls.tsx:67-112`. Two independent defects on the shapes path:

**(a) It has no `s.shape || s` unwrap.** The non-STL branch at `:85-89` calls `getShapesBounds(shapes)` (`src/utils/patternUtils.ts:12`), whose body is `shapes.forEach(shape => shape.getPoints().forEach(...))` at `:16-21` — a bare `.getPoints()` on the array member. A generator emitting representation 2, `{ shape, color }` — which `buildJob` accepts (`src/components/ImperativeModel.tsx:833`) and `ShapeUploader` previews correctly (`src/components/ShapeUploader.tsx:44-45`) — throws `shape.getPoints is not a function` here. This is the same missing unwrap the recon report flags for doc 07 at `GeometryControls.tsx:86`.

**(b) It overwrites `patternScale`, from three call sites, not one.** The root doc names the write at `:132-136`; there are in fact **three** callers, and the two the root doc does not mention fire long after load:

| Call site | Trigger |
|---|---|
| `src/components/controls/GeometryControls.tsx:116-122` | inside `handlePatternLoaded` — on every upload or library pick |
| `src/components/controls/GeometryControls.tsx:227-233` | the Tile/Place `SegmentedControl` `onChange` (`:225-239`) — **fires on a generated field too** |
| `src/components/controls/GeometryControls.tsx:260-266` | the "Auto Scale" action button on the Scale X/Y `ControlField` (`onClick` at `:259-270`) |

In tiled mode it returns `10 / width` against a hardcoded `targetWidth = 10` (`:94-98`); in placed mode, 50% of `baseSize − 2·margin` (`:100-109`). **A generator emitting mm-correct geometry is silently rescaled.** A 10 mm cell survives by coincidence (10/10 = 1); nothing else does.

**Fix (this doc).** An early return at the top of `calculateAutoPatternScale`, so all three call sites are covered by one edit and a fourth added later cannot escape it:

```ts
// src/components/controls/GeometryControls.tsx, at the top of calculateAutoPatternScale (:74)
// A generator emits millimetre-correct geometry; auto-scale would silently rescale it.
if (settings.generatorId) return null;
```

Returning `null` is the existing "no change" signal, and all three call sites already honour it — but **not with the same construct**, so do not go looking for a third ternary. Two of them spread `...(newScale !== null ? { patternScale: newScale } : {})` into `updateSettings` (`:135`, `:237`); the Auto Scale button instead wraps the write in a statement guard, `if (newScale !== null) { updateSettings({ patternScale: newScale }); }` (`:267-269`). All three write nothing on `null`.

**Ordering note — the one accepted consequence, at `:116`.** `handlePatternLoaded` calls `calculateAutoPatternScale` at `:116` *before* it commits `generatorId: null` in the same `updateSettings` call at `:132-136`, and React state is not written synchronously. So when a user uploads an STL **while a generator is active**, the guard reads the still-set `generatorId`, returns `null`, and that upload lands at whatever `patternScale` was already in force instead of being auto-scaled. This is accepted rather than engineered around: the generator is cleared by the same call, so the very next auto-scale — the Auto Scale button at `:260`, or a Tile/Place toggle at `:227` — computes correctly, one click away. Passing an explicit override into `:116` would mean widening the signature and re-deciding two other call sites; a `generatorActive` parameter passed literal `true` at `:227`/`:260` would be strictly worse, because it disables auto-scale for uploaded STLs and all 14 library presets (`src/components/PatternLibraryModal.tsx:19-32`) — the exact behaviour this fix is preserving for non-generated units.

### 5.2 Trap 2 — the shapes-kind unit is neither decimated nor cached

Every **cutter** in the pipeline is decimated to `CUTTER_TOLERANCE = 0.001` mm before it is used: `simplifiedCs` (`src/utils/geometry/manifoldOps.ts:108-112`) for exclusions, inclusions and masks; `cachedCutterSolid` (`:128-161`, simplify at `:150`) for the base outline and holes. The measured effect on a real pad is 4761 contour points → 541 and 18464 triangles → 1584, roughly halving pipeline time (`:36-38`).

The pattern unit is **deliberately excluded** — the docblock at `src/utils/geometry/manifoldOps.ts:44-45` says so explicitly, on the reasoning that the unit is "the geometry the user is actually looking at, cheap to process, and bit-exact". That reasoning holds for a 10 mm STL stud. It does not hold for a generated field: `src/utils/geometry/patternPipeline.ts:138` calls `ops.csFromShapes(job.patternUnit.shapes, 'EvenOdd')` — **`csFromShapes` (`manifoldOps.ts:91-98`) contains no `.simplify()`** — and a whole-pad Voronoi is 4000 points, not 40.

A second asymmetry compounds it. The geometry branch is **cached**: `cachedManifoldFromGeometry` (`patternPipeline.ts:136` → `manifoldOps.ts:168-176`) keys on a content hash so the same STL is not re-welded across every settings change. The shapes branch at `:138-139` has **no cache** — it rebuilds the `CrossSection` and re-extrudes on **every** debounced param change. Budget with the in-repo ratio: **≈3.9 triangles per contour point raw, ≈2.9 after simplify** (`manifoldOps.ts:36-38`).

**Fix (this doc), and why it is not the obvious one.** The obvious fix is to change `patternPipeline.ts:138` to use `simplifiedCs`. **Do not.** That is a semantic change to the clip/extrude core, so it falls under root §10 and its amendment conditions, and the recon report assigns it to doc 03 ("must be opt-in per unit kind"). Main-thread `simplify()` is not an alternative either: it is a `CrossSection` method inside the wasm, and instantiating Manifold on the main thread creates a second realm (§4.5).

Instead, decimate **at the source, in plain JS, before the shapes reach state**:

```ts
// src/utils/generators/normalize.ts   (new)
/** Ramer–Douglas–Peucker over each ring. Pure JS: no wasm, no worker, no core edit. */
export function decimateShapes(out: ShapeSourceOutput, toleranceMm: number): ShapeSourceOutput;

/** Off by default. Doc 03 sets a value per generator. */
export const GENERATOR_TOLERANCE_DEFAULT = 0;   // (new — does not exist yet)
```

This repairs the asymmetry without touching the core, and it also shrinks the un-cached per-edit rebuild. It applies to a generator's own output only — an uploaded STL is untouched, and `CUTTER_TOLERANCE` keeps its meaning.

### 5.3 The rest of the seam — all inherited, no edits

| Step | Site | Status |
|---|---|---|
| Shapes land in state | `updateGeom` (`src/components/Controls.tsx:65`) → `geometrySettings.patternShapes` (`src/App.tsx:18`) | inherited |
| Regeneration triggers | `patternShapes` is already in the dependency array — `src/components/ImperativeModel.tsx:901` | inherited |
| `kind:'shapes'` branch taken | `src/components/ImperativeModel.tsx:832-836`, with the `s.shape \|\| s` unwrap at `:833` and the `instanceof THREE.Shape` filter at `:834` | inherited; **first production caller** |
| Serialisation | `serializeShapes` at `src/components/ImperativeModel.tsx:836` → `SerializedShape` (`src/utils/geometry/serialize.ts:15-18`) | inherited |
| Job submission, coalescing, latest-wins | `submitPattern` (`src/utils/geometry/patternClient.ts:97-101`) → `pump` (`:60-68`) | inherited |
| Extrude → compose → clip | `src/utils/geometry/patternPipeline.ts:139`, `:236`, `:269` | inherited |
| Holes / height cut / masks | `:286`, `:297`, `:300-355` | inherited |
| Preview | `applyPatternResult` (`src/utils/geometry/applyPatternResult.ts:67-130`) | inherited |
| STL / 3MF export | `src/components/OutputPanel.tsx:122-123`, `:204` | inherited |
| Uploader preview of generated shapes | `src/components/ShapeUploader.tsx:44-45`, `:51` — already unwraps wrappers and guards on `typeof s.getPoints === 'function'` | inherited, works for free |

One inherited UI behaviour to handle deliberately: once `patternShapes` is non-empty, `hasContent` flips (`src/components/ShapeUploader.tsx:174`) and `ShapeUploader` renders its green loaded state — the green dashed border at `:182` and the filename pill with an **X clear button** at `:207-218` — whose `onClear` sets `patternShapes: []` (`src/components/controls/GeometryControls.tsx:155-162`). That `onClear` must also set `generatorId: null`, or the App effect regenerates immediately and the X appears broken. The label falls back to `"Custom Drawing"` when `fileName` is null (`ShapeUploader.tsx:175`); set `libraryPatternName` (declared `GeometryControls.tsx:56-58`, passed as `fileName` at `:150`) to the generator's `label` so the pill reads correctly — §4.6 row 6.

## 6. Edge cases, testing and acceptance criteria

### 6.1 Edge cases

| Case | Required behaviour |
|---|---|
| Generator throws | `AlertContext.showAlert` (declared `src/context/AlertContext.tsx:17`, implemented `:26-29`, consumed via `useAlert`; usage precedent `src/components/controls/BaseControls.tsx:86-90`). **Leave `patternShapes` unchanged** — do not write `[]`, which reads as "user cleared the pattern". |
| Generator returns `[]` | Distinct state from a throw. Alert with a different message; leave `patternShapes` unchanged. |
| Generator returns rings under 3 vertices | `validateShapeSourceOutput` drops them **and reports**. Silent loss is the existing failure mode at `src/utils/geometry/manifoldOps.ts:86` and must not be inherited. |
| Import of a bundle whose `generatorId` **and** `generatorParams` already match state | **Regenerate anyway.** The effect key is unchanged, so keying alone skips the effect and the pad renders empty with no error. The guard must also fire on empty `patternShapes` (§4.7) — export nulls it (`src/utils/projectUtils.ts:53`) and `src/components/Controls.tsx:236-238` writes the settings without moving the key. This is the ordinary case of re-importing the design you are looking at. |
| `generatorId === null` | The effect **no-ops**. It must never write `patternShapes: []` — that is `onClear`'s signal (`src/components/controls/GeometryControls.tsx:155-162`) and would wipe an uploaded STL. |
| Unknown `generatorId` on import (a bundle from a later build) | Alert naming the id; leave `patternShapes` null; **do not** clear `generatorId`, so re-opening on a newer build recovers the design. |
| `generatorParams` fails `schema.parse` | Report the zod issue path; fall back to `schema.parse({})` defaults and regenerate, so the user sees geometry rather than an empty pad. |
| StrictMode / React Compiler double-invoke | The effect is abortable (`let cancelled`), pattern per `src/components/ImperativeModel.tsx:886-892`. Two invocations must produce one state write. |
| Generator active, then user uploads an STL | `handlePatternLoaded` sets `generatorId: null` (§4.6) — the upload wins. |
| User clicks X on the uploader | `onClear` sets `generatorId: null` alongside `patternShapes: []` (§5.3). |
| Tile/Place toggled on a generated field | `calculateAutoPatternScale` returns `null` (§5.1); `patternScale` is preserved. |
| Unbounded output | The tiler has **no cap**: with `patternScale` or `tileSpacing` driving `fullWidth` to 0, `cols/rows = ceil(span/0) = Infinity` and the inclusive loops never terminate **inside the worker**, so the pump never drains and the app silently stops regenerating (`src/utils/patternUtils.ts:478-479`, `:684-696`). `validateShapeSourceOutput` enforces a framework-level point ceiling; doc 03 owns per-generator tile caps. |
| Deploy on a subpath | A generator must not `fetch()` an asset from `public/` with a root-absolute URL — there are 8 such sites today and zero uses of `import.meta.env.BASE_URL` (root §7). Prefer generators with no assets at all. |

### 6.2 Vitest

All the new *logic* sits under `src/utils/generators/**`, inside the coverage allowlist `src/utils/**` (`vite.config.ts:30-35`). The two exceptions are deliberate and report 0%: `src/components/GeneratorRunner.tsx` (§4.1) and the `GeometryControls` render test's subject, both outside the allowlist, which criterion 8 forbids widening. Baseline to regress against: **21 files, 162 tests, 4.54 s** (`docs/_source/baseline-verification.md`). `patternPipeline.test.ts` passes today, which means **Manifold wasm runs under Vitest/jsdom** — an end-to-end shapes-kind test needs no browser harness. Model the job fixture on `src/utils/geometry/patternPipeline.test.ts:26-46`.

Six new files plus one additive extension of a baseline file — the split criterion 1 counts on.

| Test file | Asserts |
|---|---|
| `src/utils/generators/normalize.test.ts` | ≥3-vertex drop is reported not silent; an explicitly-closed ring is flagged; overlapping rings on one shape are flagged; `decimateShapes(pts, 0)` is identity; `decimateShapes` never opens a ring. |
| `src/utils/generators/registry.test.ts` | every `GENERATOR_REGISTRY` id is unique; `findGenerator('nope')` returns null; each `load()` resolves to an object satisfying `Generator`. |
| `src/utils/generators/runGenerator.test.ts` | `runGenerator('fixture-grid', {})` fills all params from `.default()`; a bad param value rejects with a zod issue; an unknown id rejects. |
| `src/utils/generators/fixtureGrid.test.ts` | `generate(p)` twice with identical `p` deep-equals — the framework-level determinism assertion. |
| `src/utils/geometry/patternPipeline.shapesUnit.test.ts` | the end-to-end criteria 6 and 7 in §6.3. |
| `src/components/controls/GeometryControls.test.tsx` | criteria 11, 12 and 13's UI half. `@testing-library/react` is already a dev dependency (`package.json:44`) and two component render tests already ship (`src/components/DebouncedInput.test.tsx`, `src/components/Spinner.test.tsx`), so this needs no new harness. It renders `<GeometryControls>` with `generatorId` set in `settings` and a spy `updateSettings` — no picker required, since `settings` is a prop. **Note it reports no coverage**: `src/components/controls/**` is outside the allowlist (`vite.config.ts:30-35`) and `vite.config.ts` must not be edited (criterion 8). |
| extend `src/utils/schemaDefaults.test.ts` — the **only** baseline file edited | `getDefaults(GeometrySettingsSchema)` still succeeds and yields `generatorId === null`, `generatorParams` deep-equals `{}`. Additive only (§4.6 row 8). |

### 6.3 Acceptance criteria

Each is a command, an assertion, or a stated observation.

**Framework**

1. `pnpm test` is green with **at least 27 files** — the 21 baseline files (`docs/_source/baseline-verification.md`) plus the **6 new** files in §6.2's table. The seventh §6.2 row is an *extension* of an existing file and adds no count. The constraint on baseline tests is not "none edited": **the only baseline test file modified is `src/utils/schemaDefaults.test.ts`, and no existing assertion in it is changed or removed** (`git diff src/utils/schemaDefaults.test.ts` shows additions only).
2. `pnpm exec tsc -p tsconfig.app.json --noEmit 2>&1 | grep 'src/utils/generators\|GeneratorRunner'` returns **nothing**. (The gate is scoped to new paths: **18** pre-existing errors — root §4.1; `docs/_source/baseline-verification.md`'s "19" is stale — and they are not this doc's to fix.)
3. `getDefaults(GeometrySettingsSchema)` succeeds and `src/utils/schemaDefaults.test.ts` passes — i.e. both new fields carry `.default()`.
4. `grep -rn "generatorId\|generatorParams" src/types/schemas.ts` shows exactly two field declarations, each with `.default(`.
5. A test asserts `JSON.parse(JSON.stringify(params))` deep-equals `params` for `getDefaults` output of every registered generator's schema — proving the params bag survives the bundle.

**The seam**

6. A new test constructs a `PatternJob` by mirroring `buildJob` **exactly**, runs `generatePattern` under `getManifold()`, and asserts `result.empty === false` and `result.parts.length > 0`. The unwrap is not optional: `runGenerator` returns `ShapeSourceOutput` (§4.2), a union, while `serializeShapes` is typed `(shapes: THREE.Shape[] | null | undefined)` (`src/utils/geometry/serialize.ts:47`) and calls `.getPoints()` on every member (`:36-38`, `:39-43`) — passing the union directly does not typecheck under `tsconfig.app.json` and skips the very seam this criterion exists to prove.
   ```ts
   const out = await runGenerator('fixture-grid', {});
   const shapes = out.map((s: any) => s.shape || s)
                     .filter((s: any) => s instanceof THREE.Shape) as THREE.Shape[];
   const patternUnit = { kind: 'shapes' as const, shapes: serializeShapes(shapes) };
   ```
   Run the same assertion twice: once over the plain-`THREE.Shape` fixture, and once over a fixture that emits representation 2, `{ shape, color }` — §4.2 makes that half of the contract, and only the second case actually exercises the `.map((s: any) => s.shape || s)` at `src/components/ImperativeModel.tsx:833`.
7. The same test run twice with `clipToOutline: true` and a `filledCutoutShapes` square asserts the returned XY bounds are within the square — proving clip works on a generated unit with **zero** edits to `src/utils/geometry/patternPipeline.ts:258-366`.
8. `git diff --stat` after the whole workstream shows **no change** to: `src/utils/geometry/patternPipeline.ts`, `src/workers/geometryWorker.ts`, `src/utils/geometry/patternClient.ts`, `src/components/OutputPanel.tsx`, `src/components/Controls.tsx`, `src/components/ModelViewer.tsx`, `src/components/ImperativeModel.tsx`, `vite.config.ts`.
9. `grep -rn "getManifold" src/ | grep -v "workers/\|geometry/\|\.test\."` returns **nothing** — no main-thread Manifold instantiation.
10. No fourth message kind exists. **Scope: this criterion is checked at M3, on the tree as this workstream leaves it. It is not a standing invariant** — doc 06b (M4b) legitimately adds a `kind:'flat'` under the root §10 amendment (doc 06 §5 rows 06b-6 … 06b-10, which widen `patternClient.ts:17` to `'pattern' | 'inlay' | 'flat'`). Re-run this criterion only against a pre-06b tree. Three commands, each of which discriminates (the worker union is written across three lines, so no single grep matches it as one string):
    - `grep -c "kind: 'generate'" src/workers/geometryWorker.ts src/utils/geometry/patternClient.ts` reports **0** for both files.
    - `grep -n "^  | { kind:" src/workers/geometryWorker.ts` returns **exactly three lines — 22, 23, 24** — carrying `'pattern'`, `'inlay'`, `'warmup'`.
    - `grep -n "^type Kind" src/utils/geometry/patternClient.ts` returns exactly `17:type Kind = 'pattern' | 'inlay';`.
    (Criterion 8's `git diff --exit-code` over both files already implies all three; these are the readable form.)

**Trap 1**

11. A generated field survives the Tile/Place toggle. In `src/components/controls/GeometryControls.test.tsx`: render `<GeometryControls>` with `settings.generatorId = 'fixture-grid'`, `settings.patternShapes` a one-shape array, `settings.patternScale = 0.37`, and a spy `updateSettings`; fire a click on the "Place" button, then "Tile", then "Place" (the `SegmentedControl` renders one `<button>` per option, `src/components/ui/SegmentedControl.tsx:27-38`). Assert every recorded call object has `isTiled` and **no `patternScale` key** (`expect(call).not.toHaveProperty('patternScale')`). Also assert it in the app after task 9: pick a generator, read Scale X/Y, toggle Tile→Place→Tile, read it again.
12. The same render test, with `settings.patternShapes = [{ shape, color: '#fff' }]` (representation 2) and `settings.generatorId` non-null: clicking Tile/Place records an `updateSettings` call with no `patternScale` key **and throws nothing**, proving the missing-unwrap defect at `src/components/controls/GeometryControls.tsx:86` is unreachable while a generator is active. (Testing it through the component, not by calling `calculateAutoPatternScale` directly: that function is a `const` arrow declared inside the component body at `:67` and is not exported — the file's only export is `export default GeometryControls` at `:573` — and this doc does not budget a shared-file edit to hoist it.)
13. A generated 10 mm cell yields a 10 mm preview cell — **root §8 M3's own exit criterion**, so it is asserted against the unit, not against a field value. In `patternPipeline.shapesUnit.test.ts`: build a `PatternJob` from a fixture generator emitting one 10 × 10 mm cell with `isTiled: true`, `tileSpacing: 0`, `patternScale: 1`, `patternMargin: 0`, `clipToOutline: false` and a single tile position; run `generatePattern` and assert the returned part's XY bounds are **10 ± 0.01 mm on each axis**. Do not divide composed bounds by tile count: the composed extent is `cells × cellSize + (cells − 1) × tileSpacing` plus margin effects, and `tileSpacing` defaults to 10 (`src/types/schemas.ts:74`), so the quotient is not the cell size. Do not read `patternScale === 1` either: with the §5.1 fix `calculateAutoPatternScale` returns `null`, so `patternScale` merely *retains* its prior value, which equals 1 only if nothing ever changed it. The UI half of this belongs to criterion 11.

**Trap 2**

14. `decimateShapes(out, 0.05)` on a 4000-point fixture reduces total point count by ≥50% and every ring still has ≥3 vertices.
15. A benchmark test records `performance.now()` around `generatePattern` for a shapes-kind unit at 500 / 2000 / 5000 contour points, and **prints** the numbers. No threshold is asserted (the report's §8 lists this cost as unmeasured); the criterion is that the numbers exist and are recorded in this doc's §8 Q3.

**Reproducibility and bundle**

16. Round trip with no asset. `exportProjectBundle` returns `Promise<void>` — it builds a Blob, clicks a synthetic anchor and revokes the object URL (`src/utils/projectUtils.ts:76-87`) — so the two functions do **not** compose. Capture the Blob by stubbing `URL.createObjectURL`, reusing the harness already written at `src/utils/projectUtils.test.ts:9-29` (`document.createElement` spy plus `global.URL.createObjectURL`), then wrap the captured Blob as a `File` for `importProjectBundle`. Assert: the resulting `geometrySettings` carries the same `generatorId` and a deep-equal `generatorParams`; `patternShapes` is null in `project.json` (`src/utils/projectUtils.ts:53`); the zip carries **no** pattern asset; and the effect regenerates a deep-equal shape list. **Run it twice** — the second time with the pre-import state already holding that exact `generatorId` and `generatorParams`, so the effect key does not move. Regeneration must still happen, which is what the §4.7 emptiness guard buys.
17. `pnpm build` exits 0 and the chunk list shows a **separate chunk** for each generator module; the main `index-*.js` chunk grows by less than 10 kB over the 1,850.77 kB baseline.
18. `pnpm test` still reports the 162 baseline tests passing — no upstream expectation changed.

**Picker and `patternType`**

19. Activating a generator over a loaded STL clears the stale type. In `GeometryControls.test.tsx`: render with `settings.patternType = 'stl'` and `settings.patternShapes = [geometry]`, click a generator option in the picker, and assert the recorded `updateSettings` call contains **both** `generatorId` (the chosen id) and `patternType: null`. Observe it in the app too: load an STL preset from the Pattern Library, pick a generator, and confirm the auto-scale `type === 'stl'` branch (`src/components/controls/GeometryControls.tsx:79-84`) is never entered. (§4.3; this is what §8 Q1 turns on.)

## 7. Task order

Recon is done (root §9). Each task is one commit; each is independently reviewable and leaves the tree green.

**Task 0 is not a task — it is a decision.** The root §5.2 rule-5 carve-out in §3's rule table is settled by @liamstar, or §4.5 is overruled and this table is re-scoped. Nothing below is implementable until then.

The ordering rule below the dependencies: **the picker (task 9) precedes every observational criterion**, because nothing in tasks 1–8 gives a user any way to set `generatorId` from the UI.

| # | Task | Touches a shared file? | Depends on |
|---|---|---|---|
| 1 | `src/utils/generators/types.ts` — `ShapeSourceOutput`, `ShapeSource`, `Generator<P>`, `GeneratorEntry`, `GeneratorParamValue`, `GeneratorRegistry`. Types only, no runtime. | no | — |
| 2 | `src/utils/generators/normalize.ts` + `normalize.test.ts` — `validateShapeSourceOutput` (the §4.4 table) and `decimateShapes`. | no | 1 |
| 3 | `src/utils/generators/fixtureGrid.ts` + `fixtureGrid.test.ts` — the ~40-line deterministic fixture generator. Not a product feature; it exists so tasks 4–10 can be tested before doc 03 lands. | no | 1 |
| 4 | `src/utils/generators/registry.ts` + `registry.test.ts` — `GENERATOR_REGISTRY` with the fixture behind a dynamic `import()`; `findGenerator`. | no | 1, 3 |
| 5 | `src/utils/generators/runGenerator.ts` + `runGenerator.test.ts` — the **whole** five-step run path of §4.4, including the `decimateShapes(out, GENERATOR_TOLERANCE_DEFAULT)` call in step 5. No later task re-wires it. | no | 2, 4 |
| 6 | Schema: `GeneratorParamsSchema`, `generatorId`, `generatorParams` on `GeometrySettingsSchema`; extend `src/utils/schemaDefaults.test.ts` (§4.6 row 8 — additive only). | **`src/types/schemas.ts:66-85`**, **`src/utils/schemaDefaults.test.ts`** | 1 |
| 7 | `src/utils/generators/useGeneratedPattern.ts` + `src/components/GeneratorRunner.tsx`; mount one line in `src/App.tsx` after `:66`. Abortable, StrictMode-safe, sorted-key effect key **plus the §4.7 empty-`patternShapes` guard**. | **`src/App.tsx`** | 5, 6 |
| 8 | Trap 1: early return in `calculateAutoPatternScale` (`src/components/controls/GeometryControls.tsx:74`); `generatorId: null` in `handlePatternLoaded` (`:132-136`) and in `onClear` (`:155-162`); the `libraryPatternName` effect (§4.6 row 6). Ships `src/components/controls/GeometryControls.test.tsx` with criteria 11, 12 and 13's UI half — the render test sets `generatorId` through `settings`, so it needs no picker. | **`src/components/controls/GeometryControls.tsx`** | 6, 7 |
| 9 | **Minimum viable picker** — a generator `SegmentedControl` in the Geometry panel on `src/components/ui/SegmentedControl.tsx:16-43`, whose `onChange` calls `updateSettings({ generatorId, patternType: null })` (§4.6 row 7). Criterion 19. Deliberately thin; doc 04 replaces it with `ParamField`. **Ordered here, not last: every task below is unexercisable in the app without it.** | **`src/components/controls/GeometryControls.tsx`** | 8 |
| 10 | First production `kind:'shapes'` run — `src/utils/geometry/patternPipeline.shapesUnit.test.ts`, criteria 6, 7 and 13. Pure `generatePattern` tests; no UI involved. | no | 3, 4, 5 |
| 11 | Manual pass **in the running app** over clip / holes / height-cut / masks, plus the in-app halves of criteria 11, 13 and 19. | no | 9, 10 |
| 12 | Failure surfacing through `AlertContext` for the §6.1 error cases, with the throw / empty distinction. | no (new file only) | 7 |
| 13 | Trap 2 **measurement only** — `decimateShapes` is already wired by task 5. Add the criterion-14 decimation test and the criterion-15 benchmark, and record the numbers in §8 Q3. | no | 5, 10 |
| 14 | Reproducibility: the criterion-16 round-trip test, both passes (fresh state and identical-key re-import). **Blocked on doc 08's `seed`** for a stochastic generator; landable now for the deterministic fixture. | no | 7, M2 |
| 15 | Bundle check: `pnpm build`, confirm criterion 17, record the chunk list. | no | 4 |

---

## What already exists (do not rebuild)

Every row is inherited from upstream and needs **no change** from this doc.

| Capability | Where | Note |
|---|---|---|
| Web Worker execution | `src/workers/geometryWorker.ts:26-50` | One file, one `self.onmessage`, one `new Worker` in the whole tree (`src/utils/geometry/patternClient.ts:37`). |
| wasm bootstrap, memoized per realm | `src/utils/geometry/manifoldModule.ts:15`, `:17-27` | The reason a second worker is forbidden (§4.5). |
| Warm-up so the first edit does not pay the compile | `src/utils/geometry/patternClient.ts:93-95`; called at `src/App.tsx:42-44` | Deliberately posts nothing back so it never occupies the pump. |
| Job coalescing — 1 in flight + 1 pending per kind, latest-wins, cancellable | `src/utils/geometry/patternClient.ts:56`, `:63`, `:75`, `:79-83` | Sits above the 150 ms input debounce. |
| Input debounce | `src/components/DebouncedInput.tsx:9-18` | `DEFAULT_DEBOUNCE_MS = 150`, applied to all 17 numeric fields. |
| **The `kind:'shapes'` pipeline branch** | `src/utils/geometry/patternPipeline.ts:47-49`, `:138-139` | Implemented and test-covered (`patternPipeline.test.ts:46`, `:149`; `exportMerge.test.ts:33`) — **but with no reachable production path**. |
| `buildJob`'s shapes branch, including the `{shape,color}` unwrap | `src/components/ImperativeModel.tsx:832-836` (unwrap at `:833`) | Constructed in production at exactly this one site. |
| Serialisation seam | `src/utils/geometry/serialize.ts:34-50`, `:61-72` | `serializeShapes` is called for us at `ImperativeModel.tsx:836`. |
| Regeneration trigger on new shapes | `src/components/ImperativeModel.tsx:901` | `patternShapes` is already a dependency — no dep-array edit (§4.6). |
| Parametric placement — 8 distributions × 4 orientations, boundary/exclusion/mask/avoid aware, Y-bucketed spatial index | `src/utils/patternUtils.ts:285-299`, index at `:102-161` | 13 parameters. Doc 08 adds the 14th (`seed`). **Synthesis is the gap; placement is not.** |
| Extrude → compose → clip, holes, height cut, mask split | `src/utils/geometry/patternPipeline.ts:139`, `:236`, `:269`, `:286`, `:297`, `:300-355` | Order is extrude-first; the clip is conditional on `clipToOutline` (`:218`). |
| Instanced fast path when no CSG is needed | `src/utils/geometry/patternPipeline.ts:223-229` | Requires the user to switch clipping **off**. |
| Preview application | `src/utils/geometry/applyPatternResult.ts:67-130` | |
| STL and 3MF export | `src/components/OutputPanel.tsx:122-123`, `:204` | Export is a scrape of the live group, not a pipeline re-run. |
| zod defaults mechanism | `src/utils/schemaDefaults.ts:6-8` | `schema.parse({})` — the reason every new field needs `.default()`. |
| Project bundle export/import | `src/utils/projectUtils.ts:29-87`, `:105-199` | Carries the two new JSON fields with no edit. |
| Uploader preview of `THREE.Shape[]`, wrapper-aware | `src/components/ShapeUploader.tsx:44-45`, `:51` | Works for generated shapes with no change. |
| Error surface | `src/context/AlertContext.tsx:20`; precedent `src/components/controls/BaseControls.tsx:86-90` | |
| Segmented-control primitive that renders from an `options` array | `src/components/ui/SegmentedControl.tsx:16-43` | The picker in task 9; doc 04's descriptor precedent. One `<button>` per option (`:27-38`), which is what criteria 11 and 19 click. |

**What does not exist, at all:** any `ShapeSource`, `Generator`, registry, params object, param descriptor, generator UI, PRNG or seed; and any noise, Delaunay, contour, truchet, L-system, Poisson or marching-squares code or dependency — a repo-wide grep for those terms over `src/` and `package.json` returns **zero** (recon §2, doc-06-item-3 row). Nothing here is a rebuild.

## 8. Open questions

| # | Question | What would settle it |
|---|---|---|
| **Q1** | **Should `patternType` gain a `'generated'` member?** Under §4.3 it is set to `null` **explicitly by the picker** — it is not left `null` on its own, because nothing else clears it (`:134`, `:158`, `src/components/Controls.tsx:196` are the only writes). Once it is `null`, no behaviour depends on it: the pipeline never reads it, and its only live readers are `calculateAutoPatternScale`'s `type === 'stl'` branch (`src/components/controls/GeometryControls.tsx:79-84`, reached from the calls opening at `:116`, `:227` and `:260`) — which §5.1 gates — plus the dead `tileShapes` (`src/utils/patternUtils.ts:800`, `:822`, `:853`, `:863`). Widening the enum (`src/types/schemas.ts:68`) would also touch the import cast at `src/components/Controls.tsx:196` and would make `Asset['type']` (`src/utils/projectUtils.ts:16`) inconsistent, since a generated pattern has no asset. | Land tasks 8 and 9, then run criteria 12 and 19. If `patternType === null` holds after a generator is activated over a loaded STL, and nothing depends on the value, keep `null` and record the decision. If the doc-04 picker needs a discriminator for display, use `generatorId` — it is strictly more informative. |
| **Q2** | **What are the semantics of a whole-field (non-tiled) generator?** With `isTiled: false` the pipeline collapses placement to a single identity instance at the origin (`src/utils/geometry/patternPipeline.ts:191`) — but it still recentres the unit on its bbox midpoint (`:143-149`) and still applies `patternScale` in X/Y and `actualScaleZ` in Z through `instanceMatrix` (`:206`). So a generator that emits a pad-sized field is silently recentred and rescaled. Is `isTiled: false, patternScale: 1` sufficient, or does a whole-field generator need a mode the pipeline does not have? | Run a 200×170 mm generated field through `generatePattern` with `isTiled: false, patternScale: 1, clipToOutline: true` and compare the result's XY bounds against the input's. If they match, the answer is "sufficient" and it becomes a documented convention. If the recentre shifts it, the fix belongs to doc 03's row *"Whole-field (non-tiled) output"* — which is marked **Core? yes** and therefore needs the §10 discipline. |
| **Q3** | **At what contour-point count does an un-cached, un-decimated shapes-kind unit blow the 150 ms debounce?** The report's §8 lists this as unmeasured, and the two figures usually quoted come from different places and different geometry: the ≈3.9 tri/point ratio and the ~18k-triangle nominal cutter are from the in-repo cutter measurement at `src/utils/geometry/manifoldOps.ts:24-46` (4761 contour points → 541, 18464 triangles → 1584), while the 48k-sharp-triangle ceiling is `computeSharpNormals`' own docblock figure — ~5800 ms for 48k sharp triangles against ~10 ms for 128k smooth ones (`src/utils/geometry/normals.ts:12-16`). Neither was measured against a generator. §5.2 shows the shapes branch is both un-decimated and un-cached, so the cost is paid on every debounced param change. | Criterion 15's benchmark: instrument `generatePattern` at 500 / 2000 / 5000 contour points and record the numbers here. The answer sets `GENERATOR_TOLERANCE_DEFAULT` and decides whether doc 03's `patternPipeline.ts:138` decimation row is still needed at all. It is also the trigger threshold in §4.5. |
| **Q4** | **On import, regenerate — or restore a stored shape list?** §4.7 chooses regenerate, which is what makes a generated design the only re-derivable geometry in the app. The risk is version drift: a generator refactored in a later build silently produces a different design from the same `generatorId + params + seed`, with no warning. There is no existing precedent — the app's only version discriminator is unreachable dead code (`src/utils/projectUtils.ts:179-188`). | Pin each generator with a golden-output test (hash of the flattened point list for fixed params) and decide a policy: either a per-generator `version` field in `generatorParams` with a migration hook, or a documented "generators are frozen once shipped" rule. Settle it before doc 03 ships a second generator, not after. |
| **Q5** | **Does the pattern slot stay single-source?** Root §11 Q1 is still **OPEN** and is a product call for @liamstar. This doc adopts the engineering recommendation — one generator at a time — because it matches the pipeline exactly: `PatternJob` carries one `patternUnit` (`src/utils/geometry/patternPipeline.ts:73`) stamped at every position (`:232-236`), and the instanced path returns one unit plus a matrix array (`:40-45`). | A product decision. If layering is wanted, the cost is changing `patternUnit`, `InstancedPart` and `applyPatternResult`, or forcing `useCSG` on — and the model to clone is the inlay instance manager (`src/components/controls/InlayControls.tsx:199-268`). Nothing in this doc's contracts blocks it: `ShapeSource` composes trivially, since N sources concatenate into one `patternShapes` array and `csFromShapes` unions overlapping members correctly (`src/utils/geometry/manifoldOps.ts:91-98`). |
