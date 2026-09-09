# Pad outline library — hardening

**Doc ID:** `01-pad-outline-library`
**Status:** Ready to implement
**Owner:** @liamstar
**Parent:** [`./00-architecture.md`](./00-architecture.md) — its §5 contracts and §5.2 rules bind this doc. Where they conflict, the parent wins. **The two prerequisite parent corrections this doc requested have landed (2026-09-04):** parent §7 *Geometry conventions* (`docs/00-architecture.md:321`) now reads "16 of the 17", matching §4.0 and the parent's own §11 Q4 (`docs/00-architecture.md:547`), and parent §7 *Physical accuracy* (`docs/00-architecture.md:346`) now labels its extents as raw vertex boxes and points at §4.0's parsed table. §4.0 remains the governing source for per-file extents. See the closing note.
**Evidence base:** `docs/_source/00-recon-report.md` §1 item 4, §2 (`§2 item 1`, `§7 attribution`, `§11 Q3`, `§11 Q4`), §3.4, §5 table "01 — pad outline library", §6 M1, §7 Q3/Q4. **Recon is complete — do not re-run it.**

| | |
|---|---|
| **Milestones served** | **M1 — Identity and provenance** (parent §8, in full). Plus the `import.meta.env.BASE_URL` half of **M0 — deploy safety**, which the parent assigns to this doc by name (§7 *Deploy safety*: "this is a hard requirement on doc 01, not a detail"). |
| **Blocked by** | Nothing in code. This doc is off the critical path (parent §6 *Revised phasing*: "01 leaves the critical path entirely"). M0's `public/CNAME` deletion and the missing `origin` remote block *deploying*, not this work; the value of `base` in `vite.config.ts:16-17` is a deploy decision made elsewhere. |
| **Blocks** | Everything that needs `outlineRef`: doc 04's URL share, the design-state hash (parent §7 *Performance*), and any "restore the pad by reference" flow. Parent §8 *Blocked-by chain* records `outlineRef → PatternPreset.id (M1)`. Task 3 below is that unblock. |

---

## 1. Summary

**The picker already ships.** 17 outline presets (`src/components/PatternLibraryModal.tsx:49-65`), 17 matching `.dxf` files in `public/outlines/`, live DXF-rendered thumbnails (`src/components/DXFThumbnail.tsx:18-76`), opened from a `BookOpen` adornment on the uploader (`src/components/controls/BaseControls.tsx:54-62`), and loaded through the *same* handler as an upload (`:31-38`, `:77-79`). Revision 1 of the architecture doc scoped this as new work; it is not. See **What already exists** before §8 and do not rebuild any of it.

What is left is seven pieces of hardening, all small, none touching the clip/extrude core:

| # | Gap | Consequence today |
|---|---|---|
| 1 | `PatternPreset` has no `id` (`src/components/PatternLibraryModal.tsx:8-15`) | `outlineRef` is unimplementable, so no design can record which pad it used, and no URL share is possible |
| 2 | Outline identity is component-local `fileName` (`src/components/controls/BaseControls.tsx:27`), never restored on import | A re-imported design reads "Custom Drawing" (`src/components/ShapeUploader.tsx:175`) |
| 3 | 8 of 17 outlines carry no `infoUrl`; an `ls` of the repo root shows no `NOTICE`, `LICENSE` or `COPYING`, and `package.json:3` carries only `"private": true` | Third-party marks redistributed with zero rights metadata |
| 4 | A DXF that parses to zero shapes returns `success: true` (`src/utils/shapeLoader.ts:79`) | The app silently reverts to the 300 mm square **and** the uploader drops back to the empty "Click to upload" state — `hasContent` is `!!props.imageUrl \|\| !!(shapes && shapes.length > 0)` (`src/components/ShapeUploader.tsx:174`) and gates both the pill (`:207-218`) and the green dashed border (`:182`) — so the failure is indistinguishable from never having picked a pad |
| 5 | Neither `handleOutlineLoaded` (`:31-38`) nor `onClear` (`:48-52`) resets rotation/mirror | A rotation leaks across pad swaps, and after Clear the controls are hidden (`:118`) so it is invisible and unresettable |
| 6 | `DXFThumbnail` re-parses on every mount; the modal returns `null` when closed (`src/components/PatternLibraryModal.tsx:120`) | All 17 DXFs re-parse synchronously on every modal open |
| 7 | 8 asset URLs are root-absolute; `import.meta.env.BASE_URL` has zero uses in `src/` | Works only because `public/CNAME` points at a custom apex domain. Every built-in pad 404s on a project-page deploy — *in production only* |

## 2. Goals / Non-Goals

**Goals**

- Give every preset a **stable identity** that survives renames, so `BaseSettings` can record it and a design can be restored by reference.
- Make outline **provenance** complete and machine-checkable, and never fabricated.
- Make **failure visible**: a zero-shape DXF, a 404, or a parse error must reach the user through `AlertContext`, not `console.error`.
- Make the picker **base-path safe**, so built-in pads work on any deploy target.
- Make repeated opens **cheap** (one parse per outline per session).
- Leave rotation/mirror in a **defined state** after every outline change.

**Non-Goals**

- **No redesign of the picker.** Layout, thumbnails, categories and the modal shell are shipped and stay.
- **No new outlines.** Adding one is specified in §4.6 as a process; executing it is not in this doc.
- **No pre-parsed JSON catalog.** Parent §11 Q3 is answered: runtime fetch + parse, already shipped, keep it. Repo size argues *against* JSON and fidelity is not a tradeoff at all — `ExtrudeGeometry` and the clip contour both sample at `getPoints(12)`. Base mesh: `src/components/ImperativeModel.tsx:447`, `:449-451`. Clip contour: `serializeShape` (`src/utils/geometry/serialize.ts:36`, documented at `:29-32`), as parent §7 *Geometry conventions* already records.
- **No accessibility work.** The pickers are `<div onClick>` with no focus trap and no Escape handler, and `src/` has zero `aria-*`, zero `role=`, zero `tabIndex`. That baseline belongs to doc 04 (parent §7 *Accessibility / UX*). Do not half-do it here.
- **No change to DXF parsing or normalisation.** `src/utils/dxfUtils.ts` is not edited by this doc. Its known caveats are recorded in the parent and are not this doc's to fix: unconditional force-close and the bbox that excludes arc bulges are in parent §7 *Geometry conventions* (`docs/00-architecture.md:322`, `:323`); negative-area rings rebuilt as polylines with their arcs discarded is in parent §9 (`docs/00-architecture.md:482`), not §7.
- **Outline-quality diagnostics are deferred.** Recon §5 lists them under 01; they are cut here to keep M1 small. When taken up: add a **sibling export** beside `src/utils/dxfUtils.ts:428` and do not change either existing caller.
- **Decoupling camera/screenshot framing from `BaseSettings.size` is deferred.** It is real (`src/components/CameraRig.tsx:39`, `src/components/ScreenshotManager.tsx:36`, and the inlay tiling container at `src/components/ImperativeModel.tsx:247-252` with `boundaryShapes = null` at `:259`) but it changes inlay geometry, which puts it outside this doc's "shape sources, controls and export" budget. See §8 Q3.
- **No licence resolution.** A `NOTICE` records what we know; it does not grant rights. Parent §7 *Upstream & licensing* stands: get a licence from the author before any public deploy.

## 3. Contract mapping (parent §5.1)

| Contract | This doc | Real type / attachment point |
|---|---|---|
| **`Polygon`** | **Consumes, unchanged.** Adds **no** representation. | Outlines stay `THREE.Shape[]` in React state (`src/types/schemas.ts:14`, asserting only `Array.isArray` at `:7`). Nothing here reaches the worker wire (`SerializedShape`, `src/utils/geometry/serialize.ts:15-18`) or the CSG layer. |
| **`Outline`** | **Produces, and extends.** | `BaseSettings.cutoutShapes` (`src/types/schemas.ts:14`), written by `handleOutlineLoaded` (`src/components/controls/BaseControls.tsx:31-38`) — the single handler shared by upload *and* library, so "the pad library produces the same type" is already true (recon §3.4). This doc adds a sibling field `outlineRef` **(new — does not exist yet)** carrying identity, not geometry. |
| **`ShapeSource`** | **Coordination only.** Does not create it. | `parseShapeFile` (`src/utils/shapeLoader.ts:12`) is one of the three de-facto producers doc 02 will formalise. This doc **changes its failure contract** (§4.3). Docs 02 and 07 must inherit the change, not re-litigate it. |
| **`Generator<P>`** | Not touched. | — |
| **`DesignState`** | **Produces one field.** | `ProjectSchemaV1` → `ProjectData` (`src/types/schemas.ts:87-96`). `outlineRef` lands on `BaseSettingsSchema` (`:10-17`) with a `.default()` per rule 3. **`version` stays `1`** — see §4.4 for why, and for the silent-strip hazard. |

**Rules that bind hardest here:** rule 3 (every new schema field needs `.default()`, because `getDefaults` is `schema.parse({})` — `src/utils/schemaDefaults.ts:6-12`), and rule 6 (folder isolation is impossible; the shared files touched are enumerated in §5).

## 4. Design

### 4.0 The catalog — what the 17 outlines actually are

All 17 are **single-pad footprints**, not full-board spans. Measured against the app's own parser: every file returns **exactly one top-level `THREE.Shape`**. A Onewheel deck is ~640–700 mm; the largest pad here is 255.8 mm. This is the file-level answer to parent §11 Q4, which is already recorded as ANSWERED.

**Measurement method (reproducible, not asserted).** Run `parseDxfToShapes` (`src/utils/dxfUtils.ts:46`) over each file and take the `THREE.Box2` of each returned shape's `getPoints()`. This is the *parsed, unit-scaled, 12-division-flattened* extent — the same sampling the base mesh and the clip contour use — so it is the number that matters physically, not the raw DXF vertex box. Reproduce with:

```ts
// src/utils/outline/catalog.extents.test.ts  (new — does not exist yet)
import fs from 'fs';
import path from 'path';
import * as THREE from 'three';
import { parseDxfToShapes } from '../dxfUtils';

const dir = path.resolve(process.cwd(), 'public/outlines');
const shapes = parseDxfToShapes(fs.readFileSync(path.join(dir, file), 'utf8'));
const b = new THREE.Box2();
shapes.forEach(s => s.getPoints().forEach(p => b.expandByPoint(p)));
// width = b.max.x - b.min.x, height = b.max.y - b.min.y
```

Measured 2026-09-03 against branch `gripsmith` (upstream `master` @ `cf698036f28f86e4d70c00b24a2283b5ab7d3f49`):

| Preset name (`PatternLibraryModal.tsx`) | File | Extent (mm) | Top-level shapes | Holes | Entities | Note |
|---|---|---|---|---|---|---|
| Pint | `pint.dxf` | 206.1 × 173.4 | 1 | 0 | LINE 7, ARC 2, SPLINE 2 | **smallest in catalog** |
| Floatwheel Atom | `floatwheelatom.dxf` | 227.0 × 190.6 | 1 | 0 | LINE 8, SPLINE 10 | |
| GT Stock | `gtstock.dxf` | 229.3 × 203.4 | 1 | 0 | SPLINE 4 | |
| XR Cobra/Viper | `xrcobraviper.dxf` | 229.3 × 211.5 | 1 | 0 | SPLINE 6, LINE 10 | |
| XR Mushies V2 | `xrmushiesv2.dxf` | 230.8 × 216.5 | 1 | 0 | LWPOLYLINE 1, LINE 1 | only `LWPOLYLINE` file |
| Gosmilo X7 | `gosmilox7.dxf` | 231.7 × 222.5 | 1 | 0 | SPLINE 4 | |
| XR Stompies | `xrstompies.dxf` | 231.9 × 201.0 | 1 | 0 | LINE 1, SPLINE 78 | densest spline file |
| XR Stock | `xrstock.dxf` | 232.9 × 219.7 | 1 | 0 | ARC 8, LINE 9, SPLINE 2 | **only file with negative-Z extrusion** — 2 ARCs; exercises the Arbitrary Axis path (`dxfUtils.ts:24-43`, `:85-86`) |
| Floatwheel ADV | `floatwheeladv.dxf` | 233.0 × 200.6 | 1 | 0 | ARC 5, SPLINE 2, LINE 2 | |
| XR PubPad | `xrpubpad.dxf` | 233.6 × 220.0 | 1 | **32** | LINE 13, SPLINE 10, ELLIPSE 30 | most holes by far |
| GT FST | `gtfst.dxf` | 239.0 × 216.7 | 1 | 1 | LINE 35, SPLINE 2, ARC 28 | |
| Pint Matix | `pintmatix.dxf` | 241.4 × 194.9 | 1 | 2 | LINE 21, CIRCLE 2, SPLINE 2 | |
| GT Mushies | `gtmushies.dxf` | 246.5 × 226.1 | 1 | 0 | SPLINE 14 | |
| XR Kush Wide | `xrkushwide.dxf` | 251.5 × 218.0 | 1 | 2 | CIRCLE 2, SPLINE 2, LINE 1 | |
| XR Viperbite Wide | `xrviperbitewide.dxf` | 254.7 × 236.7 | 1 | 0 | SPLINE 16, LINE 4 | **largest Y in catalog** |
| GT Kush Wide | `gtkushwide.dxf` | 255.3 × 233.9 | 1 | 0 | SPLINE 4 | |
| GT Lowboy Flared | `gtlowboyflared.dxf` | 255.8 × 215.2 | 1 | 0 | LINE 30, ARC 10 | **largest X. The only imperial file** — no `$INSUNITS`, `$MEASUREMENT = 0`, so `scaleFactor = 25.4` (`dxfUtils.ts:76-79`). Raw DXF vertex box, arc bulges excluded: 10.06 × 8.30 in (= 255.6 × 210.8 mm) — that is the recon report's method, not this table's. The 255.8 × 215.2 mm in the Extent column is the parsed, arc-flattened extent (= 10.07 × 8.47 in) |

**Unit headers, verified per file.** 16 of 17 declare `$INSUNITS = 4` (mm → `scaleFactor = 1.0`, `dxfUtils.ts:66`). `gtlowboyflared.dxf` declares **no `$INSUNITS`** and takes the `$MEASUREMENT === 0 → 25.4` fallback (`:76-79`). `xrviperbitewide.dxf` additionally declares `$MEASUREMENT = 1`, which is never read because `$INSUNITS` wins. **Both tiers of the unit code are therefore exercised by the shipped catalog, by exactly one file each.** *(This corrects an internal contradiction in the recon report — see §8 note.)*

**Consequences the implementer must carry.**

- `BaseSettings.size` defaults to 300 mm (`src/types/schemas.ts:11`) and every pad is smaller in both axes, so the fit-zoom and screenshot frustum are permanently over-framed. Deferred (§8 Q3), but do not be surprised by it.
- The green outline overlay renders only `cutoutShapes[0]` and only its outer ring (`src/components/ModelViewer.tsx:517-533`). With one top-level shape per file that is currently lossless — it will stop being lossless the moment a multi-region outline is added. §4.6 makes that a gate.
- `xrpubpad.dxf`'s 32 holes ride the geometric nesting inference at `dxfUtils.ts:410-427`, including the promotion of a ring whose parent is itself a hole (`:423-426`). Such an island survives the base extrude but is erased by the CSG hole subtract. Not fixed here; pinned by test (§6 A6) so a regression is visible.

### 4.1 Stable identity — `PatternPreset.id`

Extend the existing interface. **Do not create a parallel catalog type.**

```ts
// src/constants/presets.ts  (new file — the interface and PRESETS move here verbatim
//                            from src/components/PatternLibraryModal.tsx:8-66)

export type PresetProvenance = 'verified' | 'unverified';   // (new — does not exist yet)

export interface PatternPreset {
    id: string;                        // (new — does not exist yet)
    name: string;
    file: string;
    type: 'svg' | 'dxf' | 'stl';
    category: 'patterns' | 'inlays' | 'outlines';
    keepOriginalColors?: boolean;
    infoUrl?: string;
    credit?: string;                   // (new — does not exist yet)
    license?: string;                  // (new — does not exist yet)
    provenance?: PresetProvenance;     // (new — does not exist yet) absent ⇒ 'unverified'
}
```

**Why a new file.** `src/components/PatternLibraryModal.tsx` transitively pulls in `STLThumbnail` and React Three Fiber, which makes the catalog expensive to import from a unit test. Moving the data to `src/constants/presets.ts` (alongside the existing `src/constants/colors.ts:1-26` convention) and **re-exporting both symbols from the modal** keeps every existing importer unchanged — the only typed importer is `src/components/controls/BaseControls.tsx:9`; `GeometryControls.tsx:17` and `InlayControls.tsx:21` import the default component only.

**Id scheme.** `<category-singular>/<file-stem>`, lowercase, frozen at first commit:

```
outline/pint            outline/xrstock            outline/gtlowboyflared      …  (17)
pattern/pyramid         pattern/grippysheet-v1     …                              (14)
inlay/grippysheet       inlay/trogdor              …                              (12)
```

Rules, all test-enforced (§6 A2): ids match `/^(outline|pattern|inlay)\/[a-z0-9][a-z0-9-]*$/`; ids are unique; there are exactly 43; **an id is never reused and never renamed** — renaming the display `name` or the `file` must not change the `id`, because a saved bundle holds the id. The frozen list of 17 outline ids is inlined as a literal in the test so a rename fails loudly.

### 4.2 Base-path safety — `assetUrl`

Eight sites build root-absolute URLs and there are **zero** uses of `import.meta.env.BASE_URL` in `src/`:

| Site | Form |
|---|---|
| `src/components/controls/BaseControls.tsx:72` | `fetch(\`/${preset.category}/${preset.file}\`)` |
| `src/components/controls/GeometryControls.tsx:184` | `fetch(...)` — STL branch |
| `src/components/controls/GeometryControls.tsx:194` | `fetch(...)` — DXF/SVG branch |
| `src/components/controls/InlayControls.tsx:277` | `fetch(...)` |
| `src/components/PatternLibraryModal.tsx:215` | `url=` → `STLThumbnail` |
| `src/components/PatternLibraryModal.tsx:223` | `url=` → `DXFThumbnail` (which fetches at `src/components/DXFThumbnail.tsx:24`) |
| `src/components/PatternLibraryModal.tsx:229` | `src=` on `<img>` |
| `src/components/ThumbnailGenerator.tsx:29` | `url=` → `ThumbnailScene` |

```ts
// src/utils/assetUrl.ts  (new — does not exist yet)
// Vite normalises an absolute `base` to leading+trailing slashes; a relative
// base ('./' or '') yields './'. Concatenation is correct in both cases because
// each segment is stripped of surrounding slashes.
export const assetUrl = (...segments: string[]): string =>
    import.meta.env.BASE_URL + segments.map(s => s.replace(/^\/+|\/+$/g, '')).join('/');
```

All eight become `assetUrl(preset.category, preset.file)`. Placed under `src/utils/**` so it is inside the coverage allowlist (`vite.config.ts:30-35`).

This is a *production-only* bug class: `base` is commented out (`vite.config.ts:16-17`, with a leftover `// base: '/PubRemote/',` from another project), so dev and a custom-apex deploy both work and a project-page deploy 404s every pad. The fix must land before anyone tries the second.

### 4.3 Failure surfacing

`parseShapeFile` returns `{ shapes: loadedShapes, success: true }` unconditionally at `src/utils/shapeLoader.ts:79`, including when `parseDxfToShapes` returned `[]`. Change: for the `dxf` and `svg` branches, an empty result is a failure.

```ts
// src/utils/shapeLoader.ts — replace the unconditional return at :79
if (detectedType !== 'stl' && loadedShapes.length === 0) {
    return { shapes: [], success: false,
             error: `${detectedType.toUpperCase()} parsed to zero shapes` };
}
return { shapes: loadedShapes, success: true };
```

`LoadedShapeResult` (`:6-10`) is unchanged — `success` and `error` already exist. **Do not** touch the content-sniffing block at `:20-29`; the type override is deliberate and pinned in both directions (`src/utils/shapeLoader.test.ts:119-130`).

Blast radius — **all eight call sites**, checked. `grep -rn 'parseShapeFile(' src/ | grep -v utils/shapeLoader` returns exactly these eight; the parent's M1 exit criterion says "the other five `parseShapeFile` callers still behave" (`docs/00-architecture.md:397`) and **undercounts** — do not use it as the gate.

| Caller | Today on `success: false` | After |
|---|---|---|
| `src/components/controls/BaseControls.tsx:77` | `throw new Error(result.error)` → `showAlert` at `:86-90` | **Now reachable.** Message becomes specific. |
| `src/components/ShapeUploader.tsx:133` (upload) | silently does not emit | needs the new `onError` prop below |
| `src/components/ShapeUploader.tsx:118` (STL) | unaffected — guard excludes `stl` | unchanged |
| `src/components/Controls.tsx:180` (base rehydrate) | `if (res.success)` guard at `:181`, leaves `cutoutShapes` as imported | add a `console.warn`; no user-visible change |
| `src/components/Controls.tsx:190` (pattern rehydrate) | `if (res.success)` guard at `:191`, `console.error` in the `else` at `:199` | unchanged. `patternShapes` stays as imported and the existing `console.error` now fires for a zero-shape asset too |
| `src/components/Controls.tsx:210` (inlay rehydrate) | `if (res.success)` at `:225` → `return { ...item, shapes: res.shapes }`; otherwise falls through to `return item` at `:229`. Today a zero-shape inlay SVG returns `success: true` with `shapes: []`, so the item's shapes are replaced with `[]` | **Changes for the worse unless fixed.** With the guard, `success` is false, the fall-through keeps `item.shapes` — the JSON objects the code itself calls "garbage" (`src/components/Controls.tsx:222`) — and the first `getPoints()` on them throws (`src/components/ImperativeModel.tsx:625`, and the same call at `:327`, `:404`). **Intended behaviour: on `!res.success`, return `{ ...item, shapes: [] }`,** preserving today's outcome explicitly instead of by accident. Task 5 owns this edit |
| `src/components/controls/GeometryControls.tsx:197` | `console.error` | unchanged |
| `src/components/controls/InlayControls.tsx:281` | existing handling | unchanged |

`ShapeUploader` gains one optional prop; every existing caller that omits it keeps today's behaviour:

```ts
// src/components/ShapeUploader.tsx — new optional prop on the existing props type
onError?: (message: string) => void;
```

wired only from `BaseControls`, which already has `useAlert` imported and in use (`src/components/controls/BaseControls.tsx:10`, `:29`, `:86-90`).

**Out of scope but adjacent:** `ShapeUploader` uses raw `alert()` for disallowed extensions (`:96`, `:100`, `:104`). Leave it; converting it touches the pattern and inlay uploaders too.

### 4.4 Identity in design state — `outlineRef`

```ts
// src/types/schemas.ts — inserted immediately above BaseSettingsSchema at :10
export const OutlineRefSchema = z.object({          // (new — does not exist yet)
    kind: z.enum(['preset', 'upload']),
    presetId: z.string().nullable().default(null),  // PatternPreset.id when kind === 'preset'
    name: z.string(),                               // display label; preset name or uploaded filename
});

// added to BaseSettingsSchema, mirroring the cutoutShapes idiom at :14
outlineRef: OutlineRefSchema.nullable().default(null),   // (new — does not exist yet)
```

Four decisions, each load-bearing:

1. **`.default(null)` is mandatory.** `getDefaults` is `schema.parse({})` (`src/utils/schemaDefaults.ts:6-12`); a field without a default throws and takes `defaultBaseSettings` (`:10`) down with it.
2. **`version` stays `1`.** `ProjectSchemaV1` is a plain non-strict `z.object` (`src/types/schemas.ts:87-93`), so an old bundle lacking `outlineRef` parses and receives the default. Bumping to 2 would route through the `versionMismatch` branch, which is **unreachable dead code**: `safeParse` against `version: z.literal(1)` fails first and throws at `src/utils/projectUtils.ts:187`, so the "Continue Anyway" dialog at `src/components/Controls.tsx:241-249` can never render. A working discriminator is doc 04's `ProjectSchemaV2` **(new — does not exist yet)** problem, not this doc's.
3. **Known hazard, accepted:** non-strict means a bundle written by a newer build and read by an older one has `outlineRef` **silently stripped**. The design still loads; only the label is lost. Record it here so doc 04 does not rediscover it.
4. **`outlineRef` carries identity, never geometry.** Export already nulls `cutoutShapes` (`src/utils/projectUtils.ts:46`) and ships the raw bytes as a zip asset (`:61-63`). `outlineRef` does not change that and does not make a design reproducible on its own — parent §3 goal-3 amendment stands.

**This is a deliberate, narrow widening of the design/view boundary.** Parent rule 3 lists `fileName` (`src/components/controls/BaseControls.tsx:27`) as view-only state, and says the boundary "must not be widened silently". Widening it loudly, with the reason: the *identity of the outline source* is design data — it is what a URL share and a design hash must key on — whereas the file input's transient display state is not. `fileName` stays local; `outlineRef.name` is the persisted twin, and the label reads from `outlineRef` first (§4.5).

### 4.5 State transitions on outline change

Extract the transition so it is unit-testable without rendering:

```ts
// src/utils/outline/outlineState.ts  (new — does not exist yet)
import type { BaseSettings } from '../../types/schemas';

export const outlineUpdate = (                       // (new — does not exist yet)
    shapes: unknown[],
    ref: BaseSettings['outlineRef'],
): Partial<BaseSettings> => ({
    cutoutShapes: shapes as BaseSettings['cutoutShapes'],
    outlineRef: ref,
    baseOutlineRotation: 0,      // schema default, src/types/schemas.ts:15
    baseOutlineMirror: false,    // schema default, src/types/schemas.ts:16
});

export const outlineCleared = (): Partial<BaseSettings> =>
    outlineUpdate([], null);
```

`handleOutlineLoaded` (`src/components/controls/BaseControls.tsx:31-38`) and `onClear` (`:48-52`) each become one `updateSettings(...)` call over this helper. `updateSettings` is a `Partial<BaseSettings>` merge, so one call covers all four fields.

Three things this must *not* break:

- **Import must not reset rotation.** Rehydration goes through `setBaseSettings` in `Controls.tsx:236`, never through `handleOutlineLoaded`, so a saved rotation survives import. Verify by inspection; do not "helpfully" route import through the helper.
- **The double write is harmless and stays.** `handleOutlineLoaded` calls both `updateSettings` and `onOutlineLoaded` (`:32`, `:34`), the latter landing in `Controls.handleOutlineLoaded` → `updateBase({ cutoutShapes })` (`src/components/Controls.tsx:84-86`). Both hit the same functional setter (recon §3.4). Leave the second call alone — narrowing it is a separate change.
- **`onOutlineAssetChanged` still fires** (`:35-37` → `src/components/Controls.tsx:98`), or the zip export loses the source bytes and `handleExportClick` starts warning about a missing asset (`:122-125`).

**Display label.** `ShapeUploader` computes `displayLabel = fileName || … "Custom Drawing"` (`src/components/ShapeUploader.tsx:175`). `BaseControls` passes `fileName={fileName}` from local state (`:46`). Change that one prop to `fileName={fileName ?? settings.outlineRef?.name ?? null}`. That single line is what turns "Custom Drawing" back into "Pint" after an import.

### 4.6 Provenance, attribution, and adding an outline

**Never fabricate a pad dimension or a source URL.** 9 of the 17 outlines carry an `infoUrl` and all nine point at the same Printables model; 8 carry none (`src/components/PatternLibraryModal.tsx:53`, `:54`, `:55`, `:57`, `:61`, `:62`, `:64`, `:65`). The correct action for those 8 is **not** to copy the same URL onto them. Each is either traced to a real source and marked `provenance: 'verified'` with `infoUrl` + `credit` + `license`, or left `provenance: 'unverified'` — which is an honest, visible, and actionable state, not a silent gap.

- **UI:** rows already render an `ExternalLink` when `infoUrl` is set and `category !== 'patterns'` (`:199-210`). Add, in the same corner slot, a muted marker for `provenance !== 'verified'` with a `title` of "Source not verified". No new layout.
- **`NOTICE`** (new file, repo root): one line per file under `public/outlines/`, `public/inlays/` and `public/patterns/`, giving file, source URL, author, licence, or the literal string `unverified`. Generated from `PRESETS` plus the filesystem, and pinned by test (§6 A8). It records what is known; it does not grant rights — parent §7 *Upstream & licensing* still gates any public deploy.
- **Two orphaned assets exist**, shipped in `public/` but absent from `PRESETS`: `public/inlays/bitmap2.svg` (13 files, 12 inlay presets) and `public/patterns/cone.stl` (15 files, 14 pattern presets). `public/outlines/` is at exact 17/17 parity. The catalog test freezes that orphan list, so a new orphan fails the build (§6 A3).

**Adding a new outline — the gate.** All six steps, in order; a contributed DXF that fails any of them does not ship:

| # | Step | Check |
|---|---|---|
| 1 | Drop the `.dxf` in `public/outlines/` | — |
| 2 | Add a row to `PRESETS` with a **new, never-reused** `id` | catalog test (§6 A2) |
| 3 | Record `infoUrl` + `credit` + `license` from the actual source, or set `provenance: 'unverified'` | catalog test (§6 A8) |
| 4 | Add the measured extent to the §4.0 table and to the extents fixture | extents test (§6 A6) |
| 5 | Confirm it parses to **exactly one** top-level shape, or accept that the green overlay will show only the first region (`src/components/ModelViewer.tsx:517-533`) | extents test asserts the shape count |
| 6 | Add its line to `NOTICE` | NOTICE test (§6 A8) |

Extents come from step 4's measurement, never from the contributor's claim and never from a product page.

### 4.7 Thumbnail parse cache

Today: `DXFThumbnail` fetches and parses inside a `useEffect` keyed on `url` (`src/components/DXFThumbnail.tsx:18-76`, fetch at `:24`, `parseDxfToShapes` at `:30`). The modal early-returns `null` when closed (`src/components/PatternLibraryModal.tsx:120`) — *after* its hooks, so the modal's own `thumbnails` state at `:82` survives, but every `DXFThumbnail` child unmounts. Reopening remounts all 17 and re-parses all 17 synchronously. The existing STL thumbnail cache does not help: it is gated to `category === 'patterns'` at `:92` and `:243`.

```ts
// src/utils/outline/outlineCache.ts  (new — does not exist yet)
import * as THREE from 'three';

export interface CachedOutline {          // (new — does not exist yet)
    text: string;                          // raw bytes, for the zip asset
    shapes: THREE.Shape[];
    pathData: string;                      // generateSVGPath(shapes), src/utils/dxfUtils.ts:469
    viewBox: string;
}

export const loadOutline = (url: string): Promise<CachedOutline> => { /* … */ };
export const clearOutlineCache = (): void => { /* … */ };   // test hook
```

- Keyed on the resolved `assetUrl(...)` string; stores the **in-flight promise**, so N concurrent mounts of the same url issue one `fetch`.
- **A rejected promise is evicted**, so a transient 404 or network failure can retry on the next open. A resolved entry is permanent — the catalog is 17 fixed URLs, so no eviction policy is needed. Say so rather than adding an LRU.
- Parsing goes through `parseShapeFile(text, 'dxf')` (`src/utils/shapeLoader.ts:12`), **not** `parseDxfToShapes` directly, so the thumbnail and the loaded outline are byte-identical objects and both inherit the content sniffing at `:20-29`. For the DXF branch the two are equivalent anyway (`:71`).
- **A zero-shape parse is a rejection, not a resolved empty entry.** After §4.3's guard, a fetch can succeed while `parseShapeFile` returns `{ success: false }`. `loadOutline` **rejects** with `result.error` in that case, and that rejection is evicted like any other. Do not cache a `CachedOutline` with `shapes: []` — the entry is permanent, so caching it would poison both the thumbnail and the preset load for that URL for the rest of the session, which is exactly the failure gap 4 exists to remove. Pinned by A7.
- The rejection reaches `DXFThumbnail` through its existing `catch` (`src/components/DXFThumbnail.tsx:63-65`), so the "Failed" tile (`:78-84`) still renders for a zero-shape DXF. That is the same outcome as today's `shapes.length > 0` check at `:31`, which the delegation deletes — the check moves into `parseShapeFile`, it does not disappear.
- `viewBox` computation moves verbatim out of `DXFThumbnail.tsx:35-55` — including the `-max.y` flip that pairs with `transform="scale(1, -1)"` at `:97`. Do not "simplify" it.
- Both consumers use it: `DXFThumbnail` (render), and `BaseControls`'s preset `onSelect` (`:69-92`), which then gets a warm-cache instant load and still has `text` for `onOutlineAssetChanged`.
- Placed under `src/utils/**` for the coverage allowlist (`vite.config.ts:30-35`).

Keep `DXFThumbnail`'s `mounted` guard (`:19`, `:28`, `:65`, `:67`) and its "Failed" tile (`:78-84`); the cache changes where the work happens, not the component's contract.

## 5. Integration points

Every shared file touched, with the exact anchor and why isolation fails there. New code lives in `src/utils/outline/`, `src/utils/assetUrl.ts` and `src/constants/presets.ts`; the rest is unavoidable, per parent rule 6.

| File | Line(s) | Change | Why it cannot be isolated |
|---|---|---|---|
| `src/components/PatternLibraryModal.tsx` | `:8-15`, `:17-66` | Move `PatternPreset` + `PRESETS` to `src/constants/presets.ts`; re-export both | The catalog is the thing being given identity |
| `src/components/PatternLibraryModal.tsx` | `:199-210` | Add the unverified-provenance marker in the existing corner slot | The render path for attribution already lives here |
| `src/components/PatternLibraryModal.tsx` | `:215`, `:223`, `:229` | `assetUrl(...)` | URL construction is inline in JSX |
| `src/components/ThumbnailGenerator.tsx` | `:29` | `assetUrl(...)` | same |
| `src/components/controls/GeometryControls.tsx` | `:184`, `:194` | `assetUrl(...)` | same |
| `src/components/controls/InlayControls.tsx` | `:277` | `assetUrl(...)` | same |
| `src/components/controls/BaseControls.tsx` | `:31-38` | `handleOutlineLoaded` → `outlineUpdate(...)`, accepts an `outlineRef` | The one handler shared by upload and library |
| `src/components/controls/BaseControls.tsx` | `:46` | `fileName={fileName ?? settings.outlineRef?.name ?? null}` | Prop is passed here |
| `src/components/controls/BaseControls.tsx` | `:48-52` | `onClear` → `outlineCleared()` | Clear is defined inline |
| `src/components/controls/BaseControls.tsx` | `:69-92` | Three separate sub-changes, in task order: `assetUrl` replaces the root-absolute fetch at `:72` (**task 4**); the fetch+parse goes through `loadOutline` (**task 6**); the handler builds `{ kind:'preset', presetId, name }` (**task 8** — `outlineRef` does not exist until task 7, so do not attempt this row top-to-bottom in one pass) | The select handler is an inline closure |
| `src/components/DXFThumbnail.tsx` | `:18-76` | Effect body delegates to `loadOutline` | The parse is inside the effect |
| `src/components/ShapeUploader.tsx` | props type, `:133` | Optional `onError`, invoked when `!result.success` | The parse result is consumed here |
| `src/utils/shapeLoader.ts` | `:79` | Zero-shape guard before the success return | The single return point for all three types |
| `src/types/schemas.ts` | above `:10`; inside `:10-17` | `OutlineRefSchema`; `outlineRef` field | Rule 3 requires the settings schema |
| `src/components/Controls.tsx` | `:180-183` | `console.warn` when base rehydrate fails | The import path is here |
| `src/components/Controls.tsx` | `:210`, `:225-229` | Inlay rehydrate: add an `else` returning `{ ...item, shapes: [] }` so a zero-shape asset no longer falls through to `return item` and leave unparseable JSON shapes in place (§4.3) | The `.map` over `newInlay.items` is inline |
| `vite.config.ts` | `:30-35` | Add `'src/constants/**'` to the coverage allowlist | Allowlist is a literal array |
| `NOTICE` | — | New file, repo root | — |

**Not touched:** `src/utils/dxfUtils.ts`, `src/utils/geometry/**`, `src/workers/**`, `src/components/ImperativeModel.tsx`, `src/components/ModelViewer.tsx`, `src/components/OutputPanel.tsx`. This doc adds no worker job field, so parent rule 5's structured-clone wedge (`src/utils/geometry/patternClient.ts:66-67`) is not in play. `src/components/ImperativeModel.tsx:897-903` — the hand-maintained dependency array — needs no edit, because `outlineRef` does not affect geometry.

## 6. Edge cases, testing, acceptance criteria

**Baseline to regress against:** 21 test files, 162 tests, all passing, 4.54 s (`docs/_source/baseline-verification.md`). **Do not** add a typecheck gate — `npx tsc -p tsconfig.app.json --noEmit` reports **18** pre-existing errors (parent §4.1; the baseline file's "19" is stale — re-measure before pinning a number) and inheriting them here would block M1 on unrelated work.

### Edge cases

| Case | Expected |
|---|---|
| DXF fetch 404s (project-page deploy before the `assetUrl` fix) | `DXFThumbnail` shows "Failed" (`:78-84`); `BaseControls` catch shows the alert (`:84-91`). After the fix, does not occur. |
| DXF fetches but parses to zero shapes | `parseShapeFile` returns `success: false`; alert fires; `cutoutShapes` unchanged; no green filename pill |
| SVG parses to zero paths | Same failure path (the guard covers `svg` too) |
| Preset chosen while pad A is rotated 30° and mirrored | Rotation 0, mirror off, `outlineRef` = pad B |
| Clear pressed while rotated | Rotation 0, mirror off, `outlineRef` null, and the now-hidden controls (`:118`) hold defaults |
| Import of a pre-`outlineRef` bundle | Parses; `outlineRef === null`; label falls back to "Custom Drawing" |
| Import written by a newer build, read by an older one | Loads; `outlineRef` silently stripped (non-strict `z.object`, `:87-93`); label lost only |
| Two `DXFThumbnail`s mount the same url concurrently | One `fetch`, one parse |
| Cached load rejects, user reopens the modal | Entry evicted; the second open re-fetches |
| Preset renamed in a later commit | `id` unchanged; a saved bundle still resolves |
| `gtlowboyflared.dxf` after any unit-code change | Still 255.8 × 215.2 mm — the only guard on the `$MEASUREMENT` branch |
| `xrstock.dxf` after any OCS change | Still 232.9 × 219.7 mm — the only guard on negative-Z extrusion |

### Acceptance criteria

Every criterion is a command plus an assertion. New test files: `src/utils/outline/catalog.test.ts`, `src/utils/outline/catalog.extents.test.ts`, `src/utils/outline/outlineCache.test.ts`, `src/utils/outline/outlineState.test.ts`, `src/utils/assetUrl.test.ts`.

- **A1 — nothing regressed.** `pnpm test` passes. The suite gains exactly the 5 test files named above and loses none — **assert the delta, not the absolute**, because parent §8 M0 deletes `src/utils/offsetUtils.test.ts` (`docs/00-architecture.md:378`) and M0 may land first (this doc is "Blocked by: nothing in code"), which would move the 21-file baseline to 20. The only pre-existing test file modified is `src/utils/shapeLoader.test.ts`, which **gains** cases and loses none; its **11 existing test cases** still pass unmodified (they mock `parseDxfToShapes` and `SVGLoader.createShapes` to return one shape — `src/utils/shapeLoader.test.ts:41`, `:22` — so the zero-shape guard never fires for them).
- **A2 — identity.** `npx vitest run src/utils/outline/catalog.test.ts` asserts: `PRESETS.length === 43`; every `id` matches `/^(outline|pattern|inlay)\/[a-z0-9][a-z0-9-]*$/`; `new Set(PRESETS.map(p => p.id)).size === 43`; the 17 outline ids **deep-equal a literal array inlined in the test**. *(The provenance-presence assertion is deliberately **not** here — `provenance` does not exist until task 10, so it lives in A8.)*
- **A3 — filesystem parity.** Same file: `readdirSync('public/outlines').filter(f => f.endsWith('.dxf')).sort()` deep-equals the sorted `file` values of the 17 outline presets; and the set of files under `public/outlines/`, `public/inlays/` and `public/patterns/` absent from `PRESETS` deep-equals `['inlays/bitmap2.svg', 'patterns/cone.stl']` exactly. **Scan those three directories only** — `public/` root also holds `CNAME`, `favicon.ico`, `favicon.svg`, `favicon-96x96.png`, `apple-touch-icon.png`, `site.webmanifest`, `web-app-manifest-192x192.png` and `web-app-manifest-512x512.png`, none of which is a preset asset; a `public/**` scan fails on day one and the fix would be to widen the expected array, which destroys the orphan gate. Same scoping as the `NOTICE` in §4.6.
- **A4 — base path.** `npx vitest run src/utils/assetUrl.test.ts` asserts, with `vi.stubEnv('BASE_URL', '/gripsmith/')`, that `assetUrl('outlines', 'pint.dxf') === '/gripsmith/outlines/pint.dxf'` and that no result contains `//` after the scheme. And: `grep -rnE 'fetch\(`/|url=\{`/|src=\{`/' src/` returns **0 matches**.
- **A5 — zero-shape failure.** `npx vitest run src/utils/shapeLoader.test.ts` includes a case where `parseDxfToShapes` is mocked to `[]` and asserts `parseShapeFile('SECTION\nHEADER', 'dxf')` returns `{ success: false }` with `error` containing `'zero shapes'`; and a matching SVG case; and that the `stl` branch is unaffected. Plus a case for the inlay-rehydrate branch (§4.3): with `parseShapeFile` mocked to `{ shapes: [], success: false }`, the `.map` over `newInlay.items` at `src/components/Controls.tsx:210-229` yields an item with `shapes: []`, **not** the item's original JSON `shapes` array.
- **A6 — physical accuracy.** `npx vitest run src/utils/outline/catalog.extents.test.ts` parses all 17 DXFs through `parseDxfToShapes` and asserts, per file, `shapes.length === 1`, the hole count, and width/height within **±0.1 mm** of the §4.0 table. `gtlowboyflared.dxf` and `xrstock.dxf` are named cases with their own `it()` so a failure identifies the branch.
- **A7 — cache.** `npx vitest run src/utils/outline/outlineCache.test.ts`, with `global.fetch` stubbed: two sequential `loadOutline(u)` calls issue **exactly 1** fetch; two concurrent calls issue **exactly 1** fetch and resolve to the same object; a rejecting fetch leaves no entry, so a third call issues a **second** fetch; a fetch that **resolves** with text parsing to zero shapes makes `loadOutline` **reject**, leaves no entry, and the next call issues another fetch (§4.7); `clearOutlineCache()` restores cold behaviour.
- **A8 — provenance.** `NOTICE` exists at repo root; a test asserts every filename under `public/outlines/`, `public/inlays/` and `public/patterns/` appears in it exactly once. Machine-checkable half, in `catalog.test.ts`: every `category === 'outlines'` row has an explicit `provenance`; every row with `provenance: 'verified'` carries `credit`, `license`, and an `infoUrl` **not equal to** `'https://www.printables.com/model/968803'` (all 9 existing `infoUrl` values are that identical string — `src/components/PatternLibraryModal.tsx:49-65` — so this literal is what catches a copy-paste). The judgement half — whether a claimed source is *real* — is not a test; it is §8 Q1, settled by @liamstar.
- **A9 — schema.** `npx vitest run src/utils/schemaDefaults.test.ts` still passes **unmodified**, and a new assertion holds `getDefaults(BaseSettingsSchema).outlineRef === null`. A `projectUtils` round-trip test exports a bundle with `outlineRef: { kind: 'preset', presetId: 'outline/pint', name: 'Pint' }` and reimports it, asserting `data.base.outlineRef` deep-equals the input. A legacy test asserts `ProjectSchemaV1.parse(<v1 object with no outlineRef>).base.outlineRef === null`.
- **A10 — transitions.** `npx vitest run src/utils/outline/outlineState.test.ts` asserts `outlineUpdate(shapes, ref)` returns `baseOutlineRotation: 0` and `baseOutlineMirror: false` for every input, and that `outlineCleared()` additionally returns `cutoutShapes: []` and `outlineRef: null`.
- **A11 — observable, manual.** Three independent observations in `pnpm dev`, each landing in a different task. Do not gate them together.
  - **A11a (task 8).** Pick "Pint", set Rotation to 30, pick "GT Stock" → the Rotation field reads **0**.
  - **A11b (task 9).** Export → Import the bundle → the uploader pill reads **"GT Stock"**, not "Custom Drawing".
  - **A11c (task 6).** Open the Outline Library twice with a `console.count` on `parseShapeFile` → **17** calls total, not 34.

## 7. Task order

Dependency-ordered. Each is one commit. Recon is complete — this list starts from the report's findings, per parent §9.

| # | Task | Depends on | Lands |
|---|---|---|---|
| 1 | Move `PatternPreset` + `PRESETS` verbatim to `src/constants/presets.ts`; re-export both from `src/components/PatternLibraryModal.tsx`; add `'src/constants/**'` to `vite.config.ts:30-35`. **No behaviour change.** | — | A1 |
| 2 | Add `src/utils/outline/catalog.test.ts` and `catalog.extents.test.ts` against the *current* catalog (43 rows, filesystem parity, frozen orphans, the §4.0 extents table). **The regression net goes in before any source change.** | 1 | A3, A6 |
| 3 | Add `id` to all 43 rows using the §4.1 scheme; extend `catalog.test.ts` with the id assertions and the frozen 17-id literal. **This is the `outlineRef` unblock.** | 2 | A2 |
| 4 | Add `src/utils/assetUrl.ts` + test; convert all 8 root-absolute URLs (§4.2 table). No allowlist edit — `src/utils/**` is already in `vite.config.ts:30-35`. | — | A4 |
| 5 | Zero-shape guard at `src/utils/shapeLoader.ts:79`; `onError` prop on `ShapeUploader`; wire it to `showAlert` in `BaseControls`; `console.warn` at `src/components/Controls.tsx:180-183`; **`else { return { ...item, shapes: [] }; }` on the inlay rehydrate at `src/components/Controls.tsx:225-229`** (§4.3 — without it the guard makes import *worse*); extend `shapeLoader.test.ts`. | — | A5 |
| 6 | Add `src/utils/outline/outlineCache.ts` + test; route `DXFThumbnail` and the `BaseControls` preset select through it. | 4, 5 | A7, A11c |
| 7 | Add `OutlineRefSchema` and `BaseSettingsSchema.outlineRef` with `.default(null)`; schema-default and bundle round-trip tests. **Do not bump `version`.** | 3 | A9 |
| 8 | Add `src/utils/outline/outlineState.ts` + test; rewrite `handleOutlineLoaded` (`:31-38`) and `onClear` (`:48-52`) over it; write `outlineRef` from both the upload and the preset paths. | 7 | A10, A11a |
| 9 | `fileName={fileName ?? settings.outlineRef?.name ?? null}` at `src/components/controls/BaseControls.tsx:46`. | 8 | A11b |
| 10 | Provenance: `credit` / `license` / `provenance` fields; verify or mark the 8 rows; the unverified marker in the existing slot at `:199-210`; write `NOTICE`; add the NOTICE parity test **and the provenance assertions moved out of A2**. | 3 | A8 |

Tasks 4, 5 and 10 are independent of the identity chain (3 → 7 → 8 → 9) and can run in parallel; task 4 depends on nothing at all.

## What already exists — do not rebuild

Every piece of this feature already in the tree. Scope your work as extension or hardening of these, never as replacement.

| Shipped today | Where | State |
|---|---|---|
| 17 outline presets, named and categorised | `src/components/PatternLibraryModal.tsx:49-65` | Complete. Needs `id` and provenance fields only. |
| 17 matching DXF files | `public/outlines/` | Complete — exact 17/17 parity with `PRESETS`. |
| The picker modal (grid, thumbnails, filtering, title) | `src/components/PatternLibraryModal.tsx:75-253`; filter `:87`, title `:88` | Complete. No redesign. |
| Live DXF-rendered thumbnails | `src/components/DXFThumbnail.tsx:18-76`, render at `:94-100`; SVG path from `generateSVGPath`, `src/utils/dxfUtils.ts:469-493` | Works. Needs a cache, not a rewrite. |
| Thumbnail failure tile | `src/components/DXFThumbnail.tsx:78-84` | Works. |
| The "open library" affordance | `src/components/controls/BaseControls.tsx:54-62` (`BookOpen` adornment) | Complete. |
| Preset load sharing the upload handler | `src/components/controls/BaseControls.tsx:69-92` → `:31-38` | Complete — this is why "the pad library produces the same type" is already true. |
| Fetch-failure alert on preset load | `src/components/controls/BaseControls.tsx:84-91`, via `useAlert` (`:10`, `:29`) | Works for fetch/throw. Does not fire for a zero-shape parse — that is gap 4. |
| DXF unit normalisation (`$INSUNITS` + `$MEASUREMENT` fallback) | `src/utils/dxfUtils.ts:59-81` | Complete, and both branches are exercised by the shipped catalog. Not edited by this doc. |
| DXF hole nesting inference | `src/utils/dxfUtils.ts:410-427` | Works. Not edited. |
| Attribution render path (`ExternalLink`) | `src/components/PatternLibraryModal.tsx:199-210` | Complete. 9 of 17 rows have data for it. |
| Rotation / mirror controls | `src/components/controls/BaseControls.tsx:118-141`; schema `src/types/schemas.ts:15-16` | Complete. They are just never reset. |
| Raw outline bytes captured for the zip export | `src/components/controls/BaseControls.tsx:35-37` → `src/components/Controls.tsx:98` → `src/utils/projectUtils.ts:61-63` | Complete. Preserve it. |
| Missing-asset warning on export | `src/components/Controls.tsx:122-125`, `:143-156` | Complete. |
| Outline rehydration on import | `src/components/Controls.tsx:180-183` | Works for geometry. Loses the *name* — that is gap 2. |
| STL thumbnail cache + generation queue | `src/components/PatternLibraryModal.tsx:80-118`, `:243-249` | Exists but is gated to `category === 'patterns'` (`:92`, `:243`). Do not extend it to DXF — use the module-level cache in §4.7, which survives unmount. |
| `LoadedShapeResult` with `success` / `error` | `src/utils/shapeLoader.ts:6-10` | Complete. The fields exist; only `:79` fails to use them. |
| Content-type sniffing on parse | `src/utils/shapeLoader.ts:20-29`, pinned at `src/utils/shapeLoader.test.ts:119-130` | Deliberate. Do not "fix" it. |

**Nothing in this doc requires a new picker, a new loader, a new thumbnail renderer, or a new DXF parser.**

## 8. Open questions

Genuine unknowns only. Each names what settles it.

**Q1 — Can the 8 unattributed outlines be attributed at all?**
`xrpubpad`, `xrstompies`, `xrviperbitewide`, `floatwheelatom`, `gtfst`, `gtlowboyflared`, `pintmatix`, `gosmilox7` have no `infoUrl` (`src/components/PatternLibraryModal.tsx:53`, `:54`, `:55`, `:57`, `:61`, `:62`, `:64`, `:65`). If a source cannot be established, the choice is ship-with-`provenance: 'unverified'` or remove the row before any public deploy — and removing a row after ids exist means an id that must never be reused.
*Settled by:* @liamstar asking the upstream author (techfoundrynz) where each file came from. Same conversation as the licence question in parent §7. Until then, task 10 marks them `'unverified'`.

**Q2 — Should there be a default pad?**
A fresh session starts on a synthesised `size`-square built at `src/components/ImperativeModel.tsx:163-174`, not a real pad, and selection takes a deliberate click. Making one preset the default is one line, but it presumes a board the rider may not own, and it changes what an empty design *is* for every downstream doc that hashes design state.
*Settled by:* a product call from @liamstar. Not blocking; the schema field is the same either way.

**Q3 — Where does the `size`-decoupling work belong?**
`BaseSettings.size` (default 300 mm, `src/types/schemas.ts:11`) is labelled "Unused when outline is uploaded" (`src/components/controls/BaseControls.tsx:97`) but still drives camera fit-zoom (`src/components/CameraRig.tsx:39`), the screenshot frustum (`src/components/ScreenshotManager.tsx:36`) and the inlay tiling container (`src/components/ImperativeModel.tsx:247-252`, `:259`). Every shipped pad is smaller than 300 mm in both axes, so the view is over-framed for all 17. Recon §5 files it under 01; it changes inlay geometry, which this doc's budget excludes.
*Settled by:* deciding whether the framing fix (view-only, cheap, `CameraRig` + `ScreenshotManager`) can ship separately from the tiling-container fix (geometry, needs a regression test against `src/utils/geometry/patternPipeline.ts:164-171`, which already models the right behaviour). Split them and the first half is a doc-01 follow-up; keep them together and it belongs with doc 04.

**Q4 — Is `provenance` worth a field, or should it be derived?**
`provenance === 'verified'` could be computed as `!!(infoUrl && credit && license)`. An explicit field is checkable and forces a decision per row; a derived one cannot drift. The tradeoff is one field on 43 rows versus a silent "verified" the moment someone fills in a placeholder licence.
*Settled by:* whichever the first real attribution pass makes obvious. Task 10 implements the explicit field; flipping to derived later is a mechanical change plus a test edit.

---

### Note for the report's maintainer — one contradiction, and two parent corrections that gate this doc

**The contradiction.** Recon report **§2 HIGH, `§7 "mm everywhere"` row (line 67)** states "all 17 shipped outlines declare `$INSUNITS=4`". The report's own **§7 Q4 (line 559)** states that `gtlowboyflared.dxf` "alone has no `$INSUNITS` and takes the `$MEASUREMENT===0` inch branch". These cannot both be true. **§7 Q4 is correct**, verified per file: 16 declare `$INSUNITS = 4`; `gtlowboyflared.dxf` declares none and carries `$MEASUREMENT = 0`. The load-bearing conclusion — that the cut-critical base geometry *is* mm — survives intact, because the `$MEASUREMENT` fallback resolves the seventeenth file to mm correctly.

**Two edits to `docs/00-architecture.md` were hard prerequisites to shipping this doc. Both landed 2026-09-04 in the cross-document consistency pass; the table is kept as the record of what changed and why.** The parent binds child docs (header rule), so until they landed an implementer applying "the parent wins" would have written tests that cannot pass:

| Parent line | Said before | Now says | Why it gated |
|---|---|---|---|
| `docs/00-architecture.md:321` (§7 *Geometry conventions*) | "and all 17 shipped outlines declare `$INSUNITS=4`" | "16 of the 17 shipped outlines declare `$INSUNITS=4`; `gtlowboyflared.dxf` alone has none and resolves through the `$MEASUREMENT === 0 → 25.4` branch, so both tiers of the unit code are exercised by the shipped catalog" | It is self-inconsistent with the parent's own §11 Q4 (`:547`), which already says the file has no `$INSUNITS`. Taken literally it produces a catalog test asserting 17/17, which fails |
| `docs/00-architecture.md:346` (§7 *Physical accuracy*) | "plus `gtlowboyflared` at 10.1×8.3 in = 256×211 mm" | Label it as the **raw vertex box with arc bulges excluded**, and record the parsed extent 255.8 × 215.2 mm alongside it | 211 mm is 4.4 mm off the parsed Y extent, so it contradicts A6's ±0.1 mm assertion against the §4.0 table. Both numbers are right; only the unlabelled mixing is wrong |
