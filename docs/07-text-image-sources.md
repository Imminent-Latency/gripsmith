# Text and image shape sources

**Doc ID:** `07-text-image-sources`
**Status:** Draft — derived from [`./00-architecture.md`](./00-architecture.md) revision 2
**Owner:** @liamstar
**Parent:** [`./00-architecture.md`](./00-architecture.md). Its §5 contracts and §10 rules bind this doc. Where this doc conflicts with it, the root doc wins until amended.

| | |
|---|---|
| **Milestone** | **M5** — "Controls, sharing and breadth" (root §8, phasing `04 → 07 → rest of 03 → 05a`). **Two** of M5's exit bullets belong to this doc, three clauses between them, quoted verbatim: "`src/utils/text/` exists and fonts load from `public/`, not jsDelivr." and "A painted or traced inlay survives export → import, and the \"Missing Asset Files\" warning no longer fires for it." |
| **Blocked by** | **M0** (contract correction and deletions) — hard, this doc cites the corrected §5. **doc 02** for the `ShapeSource` **(new — does not exist yet)** interface this doc implements twice; if 02 has not landed, ship §4.1/§4.2 as plain exported functions that already satisfy the truthful signature and adapt later. **doc 08 / M2** *only* for §4.4 — a text or image source routed into the pattern lane is placed by `generateTilePositions` (`src/utils/patternUtils.ts:285-299`), which is unseeded; the producers themselves are deterministic and need no seed. |
| **Blocks** | **doc 05a's persistence half (§4.3 there), not the whole doc.** The paint modal's lossy move/duplicate edits (`src/components/SVGPaintModal.tsx:459-472`, `:257-264`) sit on top of the same persistence hole §4.5 closes, and doc 05 §4.3 proposes a *rival* mechanism for it — see §4.5's overlap notice; only one ships. Doc 05 §4.4's edit fixes themselves are independent and unblocked. Recon §6 moved 07's extraction half ahead of 05 for exactly this reason, and root §6 phasing (`04 → 07 → rest of 03 → 05a`) agrees. |
| **Effort** | M–L (root §6). §4.1 is S, §4.2–4.3 are M, §4.5 is the L. |

---

## 1. Summary

This is not "wrap two libraries". Recon collapsed the original doc's §6 item 7 — *"wrap existing `imagetracerjs` + `opentype.js` as `ShapeSource`s"* — into three unequal jobs, and the asymmetry is the whole plan:

1. **Image — extract nothing; the module already exists.** `traceImage` (`src/utils/image/traceImage.ts:179`) is already a standalone importable module. It imports exactly three things — `three`, `imagetracerjs`, `../geometry/colorShift` (`:1-3`) — touches no React state, no DOM and no context, and already has a clean **two-stage produce**: `traceLayers` (`:137`) returns raw per-band paths for the live preview, and `traceImage` (`:179`) turns the same layers into `TraceResult { shapes: TracedBandShape[]; palette: string[] }` (`:25-28`; `TracedBandShape` at `:19-23`) for commit. It is the **best existing template for the `ShapeSource` contract root §5.1 defines** and should be read before that contract is written. The work here is an adapter and a first test, not an extraction.
2. **Text — larger than assumed, because the module does not exist.** Root §4.1 records `opentype.js` as "text → vector outlines", which is true as a *capability* and false as an *architecture*. Verified: `opentype.js` is imported at **exactly one site in the whole repo** — `src/components/SVGPaintModal.tsx:3` — and all 11 of its references live in that one 1,261-line component file. The producer, `generateTextShapesFromOpentype` (`:32-62`), is **module-private and never exported**. Around it: a hardcoded CDN font table (`:19-29`), two `useRef` font caches (`:116`, `:119`), `activeFontKey`/`fontSize` component state (`:114-115`), a click point, and a `showAlert` text prompt (`:507-514`). **There is nothing to wrap today.** A real `src/utils/text/textToShapes.ts` **(new — does not exist yet)** must be extracted first, and the 9 preset fonts must stop being fetched from jsDelivr at runtime.
3. **Persistence — the actual blocker, and it is already broken in shipped code.** Neither producer registers a project asset, because both asset gates require a source file: `if (onInlayAssetChanged && name && content && type)` at `src/components/controls/InlayControls.tsx:131` and again at `:152`. The paint modal calls `handleShapeUpload(finalShapes, name)` with no `content` and no `type` (`:330`, from `:322-331`); the image modal does the same (`:339`). So a painted or traced inlay is **never** written into the zip, `Controls.tsx:135-138` then flags it as a missing asset, and `exportProjectBundle` spreads `inlay` untouched (`src/utils/projectUtils.ts:48-50`) — stringifying live `THREE.Shape` objects that the import path calls "garbage" in its own comment (`src/components/Controls.tsx:222`) and discards. **A painted or traced inlay does not survive save/load today.**

**And both producers are inlay-only.** `SVGPaintModal` and `ImageConversionModal` are mounted at exactly one place each — `src/components/controls/InlayControls.tsx:317` and `:334`. Neither appears in `GeometryControls.tsx` or `BaseControls.tsx` (verified by grep). The pattern uploader is gated `allowedTypes={["stl"]}` (`src/components/controls/GeometryControls.tsx:163`), and `ShapeUploader` rejects an image with a raw `alert()` when `'image'` is absent from that list (`src/components/ShapeUploader.tsx:78`). The original doc's §2 problem 2 said "shapes come only from traced images, text, or manual work" — that mis-framed the app in both directions: the *pattern* unit is always an STL file, and text/image reach only the *inlay* lane.

## 2. Goals / Non-Goals

**Goals**

- G1 — Make text-to-outline a real, tested, importable module under `src/utils/text/`, with no React dependency.
- G2 — Self-host the 9 preset fonts so the text tool works offline and on a GitHub Pages subpath, with licence provenance recorded.
- G3 — Expose both producers under the `ShapeSource` contract (doc 02) so a third producer costs the same as a second.
- G4 — Route both producers into the **pattern** lane past the STL gate, without breaking the auto-scale path they will hit.
- G5 — Close the asset-registration hole so a generated (source-less) inlay round-trips through export → import.

**Non-Goals**

- N1 — No new tracing or rasterising engine. `imagetracerjs` stays; quality tuning stays as-is (`src/utils/image/traceImage.ts:64-75`).
- N2 — No text *layout* engine. Single-line, left-to-right, advance-width kerning only, exactly as `:42-44` does today. No bidi, no shaping, no OpenType feature selection, no multi-line.
- N3 — No worker route for tracing in this doc. Recon lists it as available (`loadDownsampledImage` already copies into a standalone transferable buffer for exactly this — `src/utils/imageUtils.ts:23-24`), but it costs five edits to a closed union (root rule 5) for a producer that is not the measured bottleneck. Deferred; see §8 Q4.
- N4 — No fix to the paint modal's lossy move/duplicate (`SVGPaintModal.tsx:459-472`). That is doc 05a.
- N5 — No change to the boolean semantics of the clip/extrude core. Nothing in this doc touches `src/utils/geometry/patternPipeline.ts` or `src/workers/geometryWorker.ts`. The §10 amendment is not needed here.
- N6 — No `ProjectSchemaV2`. §4.5 widens a **union member** on an existing interface and adds an asset kind; it does not bump `version: z.literal(1)` (`src/types/schemas.ts:88`), whose migration branch is unreachable dead code (`src/utils/projectUtils.ts:179-188`). Version work belongs to doc 04. The one zod change this doc does make is `GeometrySettingsSchema.patternType` (`src/types/schemas.ts:68`) — see §4.4; it is an enum widening inside V1, not a version bump.
- N7 — **No unit conversion to millimetres for text.** The extracted module keeps today's em-relative `fontSize`. This is a **declared exception to root §5.2 rule 1** ("Emit millimetres — a source with its own unit system must convert itself"), not an oversight: the number is rescued downstream by `calculateInlayScale` (`src/utils/patternUtils.ts:999-1021`), and changing its meaning silently resizes every existing user's text. Recorded at §6.1 E1; settled by §8 Q6.
- N8 — **No SVG or DXF upload into the pattern lane.** §4.4 widens `allowedTypes` to `["stl", "image"]` only. Text reaches the pattern lane through a modal, not the uploader, so neither producer needs `svg`/`dxf` there. `ShapeUploader`'s prop type already admits them (`src/components/ShapeUploader.tsx:15`), so a later widening is one array literal — but it is a product change with its own round-trip surface and it is not in this doc.

## 3. Contract mapping

Against root §5.1. Names marked **(new)** do not exist in `src/` today.

| §5 contract | This doc | Real name and location |
|---|---|---|
| **`Polygon`** | **Produces** (both producers), **consumes** (persistence) | Producer output is main-thread form 1 or 2: `THREE.Shape` (`src/types/schemas.ts:14`) and the `{ shape, color }` wrapper (`src/utils/shapeLoader.ts:53`), whose two named spellings are `TracedBandShape` (`src/utils/image/traceImage.ts:19-23`, extra `band: number`) and `InlayJobShape` (`src/utils/geometry/inlayPipeline.ts:15-18`). Persistence uses the **wire** form `SerializedShape { points: number[]; holes: number[][] }` (`src/utils/geometry/serialize.ts:15-18`) via `serializeShape`/`deserializeShape` (`:34-45`, `:61-67`). **No new main-thread representation is added** — §4.5's asset is the existing wire form written to a zip entry, not a seventh live form. |
| **`Outline`** | **Consumes, read-only** | `BaseSettings.cutoutShapes` (`src/types/schemas.ts:14`). Reached only indirectly: `calculateInlayScale(shapes, cutoutShapes, baseSize)` at `src/components/controls/InlayControls.tsx:127`, defined `src/utils/patternUtils.ts:999-1030`. Neither producer reads the outline itself — outline-fit is a separate commit step, exactly as root §5.1 states. |
| **`ShapeSource`** | **Produces two implementations** | `ShapeSource` **(new — does not exist yet)**; doc 02 owns the interface, root §5.1 fixes its truthful signature as `produce(): Promise<Array<THREE.Shape \| { shape: THREE.Shape; color: string }>>` — async, no seed, no outline. This doc supplies `imageSource` and `textSource` **(new)**. See §8 Q3 on where per-source params live. |
| **`Generator<P>`** | **Not used** | Neither producer is parametric over a seed. If doc 02's registry wants them listed, they register as sources, not generators. |
| **`DesignState`** | **Extends** | `ProjectSchemaV1` → `ProjectData` (`src/types/schemas.ts:87-96`). Concretely this doc widens `Asset['type']` (`src/utils/projectUtils.ts:16`), `detectAssetType`'s return union (`src/utils/fileTypeSniffer.ts:3`) and `parseShapeFile`'s type union (`src/utils/shapeLoader.ts:14`). Optionally lifts modal-local params into `InlayItemSchema` (`src/types/schemas.ts:19-46`) — **note that schema has no `.default()` on any field and would throw under `getDefaults` (`src/utils/schemaDefaults.ts:6-12`); do not model a new schema on it** (root §5.1). |

## 4. Design

### 4.1 Image lane — an adapter, not an extraction

`src/utils/image/traceImage.ts` needs **no structural change**. What is missing around it:

| Missing | Where it lives today | Fix |
|---|---|---|
| A test — the file has zero coverage | no `traceImage.test.ts` exists (`src/utils/image/` contains one file) | new `src/utils/image/traceImage.test.ts`; see §6.2 for the `ImageData` obstacle |
| Params are component state | `colors`, `hueShift`, `quality` as three `useState` at `src/components/ImageConversionModal.tsx:54-56` | a typed options object in the adapter; `TraceOpts` (`src/utils/image/traceImage.ts:44-51`) already models two of the three |
| `widthMM` is a magic literal at the call site | `traceImage(full, colors, { hueShift, quality, widthMM: 50 })` — `src/components/ImageConversionModal.tsx:98`; the default is also 50 at `src/utils/image/traceImage.ts:180` | promote to a named constant in the adapter and expose it. This is the app's **only** hardcoded unit assumption for images (root §7: "image trace is hardcoded to 50 mm") |
| Resolution ladder is component-local | `PREVIEW_TRACE = 700`, `COMMIT_TRACE = 1400` at `src/components/ImageConversionModal.tsx:20-22` | move into the adapter beside the two-stage produce it describes |

New file, no shared-file edit:

```ts
// src/utils/image/imageSource.ts        (new — does not exist yet)
import { traceImage, traceLayers, TraceOpts, TracedBandShape, RGBAImage } from './traceImage';
import { loadDownsampledImage } from '../imageUtils';

export const PREVIEW_TRACE_PX = 700;    // (new) — moved from ImageConversionModal.tsx:21
export const COMMIT_TRACE_PX  = 1400;   // (new) — moved from ImageConversionModal.tsx:22
export const DEFAULT_WIDTH_MM = 50;     // (new) — was a literal at ImageConversionModal.tsx:98

export interface ImageSourceParams {    // (new)
  colors: number;      // 1..12, clamped at traceImage.ts:139 against MAX_COLORS=12
  hueShift: number;    // degrees
  quality: number;     // 1..10, clamped at traceImage.ts:65
  widthMM: number;
}

/** Stage 1 — raw layers for the live preview. Pure; no DOM. */
export function previewLayers(img: RGBAImage, p: ImageSourceParams): ReturnType<typeof traceLayers>;

/** Stage 2 — committed shapes. Satisfies ShapeSource.produce (doc 02). */
export function imageSource(dataUrl: string, p: ImageSourceParams): Promise<TracedBandShape[]>;
```

`ImageConversionModal` keeps its canvas rendering (`renderLayers`, `:25-51`) and its three sliders; it stops owning the numbers.

### 4.2 Text lane — extract a real module

Move the producer out of the component with its **body verbatim**, then add what the component could not have. This is a *signature-adapted* port, not a literal one: the third parameter changes from `fontSize: number` (`src/components/SVGPaintModal.tsx:32-36`) to an options object. Nothing inside the function body changes in that commit.

```
src/utils/text/                        (new folder)
  textToShapes.ts        the producer  — from SVGPaintModal.tsx:32-62
  textToShapes.test.ts   (new)
  fonts.ts               preset table + loader — from SVGPaintModal.tsx:17-29, :644-664
  fonts.test.ts          (new)
  textSource.ts          ShapeSource adapter (doc 02)
```

```ts
// src/utils/text/textToShapes.ts       (new — does not exist yet)
import type { Font } from 'opentype.js';   // type-only: erased at build, keeps the dynamic import in fonts.ts effective
import * as THREE from 'three';

export interface TextToShapesOptions {     // (new)
  /**
   * em-relative units (1 em == `fontSize`), NOT millimetres.
   * `glyph.getPath(x, 0, fontSize)` (SVGPaintModal.tsx:43) emits in a space scaled by
   * `fontSize / font.unitsPerEm` (`:37`), so `fontSize` *is* the em box, not a mm figure.
   * See §6.1 E1, §2 N7 and §8 Q6.
   */
  fontSize: number;
}

/**
 * Signature-adapted port of generateTextShapesFromOpentype (SVGPaintModal.tsx:32-62).
 * Body verbatim; only the third parameter changes shape (`:35` `fontSize: number` → `opts`).
 */
export function textToShapes(font: Font, text: string, opts: TextToShapesOptions): THREE.Shape[];
```

**`letterSpacing` is not in this commit.** It would alter the per-glyph advance at `SVGPaintModal.tsx:44` — precisely the behaviour T5 exists to pin, and a layout feature N2 rules out. If it is wanted later it is a separate commit landed *after* T4–T7 are green, adding an optional `letterSpacing?: number` in the same em-relative units, defaulting to 0.

Three properties of the existing implementation that must be preserved exactly, because they are load-bearing:

- **The Y negation on every command** (`SVGPaintModal.tsx:52-55`). opentype's Y grows downward; three's grows up. Drop it and every glyph is upside down.
- **`shapePath.toShapes(true)`** (`:59`). This is one of only **two** live import boundaries in the app that infer hole nesting from **winding** (root §7; the other is `SVGLoader.createShapes`). The `true` is `isCCW`. Counters (`o`, `a`, `8`) lose their holes if it changes.
- **`Z` is deliberately a no-op** (`:56`) — sub-path closing is `toShapes`' job. Root rule 1: rings are implicitly closed; do not append a duplicate first point.

**Do not carry over the re-sampling at `SVGPaintModal.tsx:531-548`.** That block rebuilds every glyph as a polyline via `getPoints(32)` for outers and `getPoints(16)` for holes, purely to apply a translation. It is a modal concern (place the text block at the click point), it permanently flattens curves at import (root §7), and it is inconsistent with the outer/hole ratio used everywhere else. The extracted module returns curve-bearing `THREE.Shape`s; whoever needs a translation applies one to the shape, and the pipeline flattens once at the serialisation seam (`src/utils/geometry/serialize.ts:29-32`, `:36`), as root rule 1 prescribes.

```ts
// src/utils/text/fonts.ts              (new — does not exist yet)
export interface PresetFont { name: string; label: string; url: string; }  // moved from SVGPaintModal.tsx:17
export const PRESET_FONTS: PresetFont[];                                    // moved from SVGPaintModal.tsx:19-29 (9 entries)

/** Parse an arbitrary font buffer. Dynamic-imports opentype.js — see §4.3. */
export function parseFontBuffer(buf: ArrayBuffer): Promise<Font>;           // (new)

/** Module-level cached loader. Replaces the two useRef caches at SVGPaintModal.tsx:116, :119. */
export function loadFont(key: string): Promise<Font | null>;                // (new as a module export)
export function registerCustomFont(key: string, buf: ArrayBuffer): Promise<Font>;  // (new)
```

Two caches become one module-level `Map`. Today the modal keeps `fontCacheRef` and `customFontCacheRef` (`:116`, `:119`) and `loadFont` consults both in a fixed order (`:646-648`); a module map with namespaced keys (`custom:<filename>` is already the convention at `:679`) collapses that and survives the modal unmounting.

**Bundle win, and it is already measured.** `opentype.js` is *statically* imported at `SVGPaintModal.tsx:3`, `SVGPaintModal` is statically imported by `InlayControls.tsx:22`, `InlayControls` by `Controls.tsx:15`, and there is **zero** `React.lazy` anywhere in `src/` — so opentype ships in the single unsplit chunk. Direct proof: `grep -c unitsPerEm dist/assets/index-D_t2sfAg.js` returns **2**. `node_modules/opentype.js/dist/opentype.min.js` is 171,001 bytes on disk, against a baseline chunk of 1,850.77 kB / 531.65 kB gzipped (`docs/_source/baseline-verification.md`) that already exceeds Vite's 500 kB warning with no `manualChunks` configured (root §4.1). Making `parseFontBuffer` use `await import('opentype.js')` and keeping the `Font` type import type-only splits it out. Same reasoning root §6 applies to generators, applied to a dependency that is already installed.

### 4.3 Font self-hosting

Today all 9 presets are fetched at runtime from `https://cdn.jsdelivr.net/npm/@fontsource/...` (`SVGPaintModal.tsx:18-29`). Three problems, all verified:

| Problem | Evidence |
|---|---|
| **The text tool fails offline.** The author already hit this — the failure message reads "No font loaded. Check your internet connection." | `SVGPaintModal.tsx:520` |
| **`.woff2` is offered and cannot be parsed.** The custom-font picker accepts `.ttf,.otf,.woff,.woff2` while the file's own comment — 656 lines above it — states opentype.js supports "TTF/OTF/WOFF, **NOT** WOFF2". The user gets "Could not load this font file." | accept string `SVGPaintModal.tsx:672`; comment `:16`; error `:686` |
| **Third-party bytes with no rights record.** Root §7 records the binding constraint: `public/` already ships 13 inlay SVGs and 17 outline DXFs with **zero** rights metadata, and the repo has no `LICENSE` at all. Adding 9 more third-party binaries without provenance makes that worse, not neutral. | root §7 "Upstream & licensing"; `package.json:3` `"private": true` |

Design:

```
public/fonts/                    (new)
  roboto-latin-400-normal.woff        ×9, byte-identical to the current jsDelivr URLs
  LICENSE-<family>.txt                one per distinct family licence
  NOTICE.md                           family → upstream package → licence → source URL
```

- `PRESET_FONTS[].url` becomes `` `${import.meta.env.BASE_URL}fonts/<file>` ``. **This is mandatory, not stylistic.** Root §7 (Deploy safety) records that `src/` contains **zero** uses of `import.meta.env.BASE_URL` and 8 root-absolute asset URLs; a hardcoded `/fonts/...` works in `dev` and 404s on a GitHub Pages project subpath. Today's absolute jsDelivr URLs accidentally dodge that — self-hosting removes the accident, so the fix must land in the same commit.
- Fonts live in `public/`, so they are **copied, not bundled**: no impact on the chunk budget, and they are fetched on demand exactly as now.
- **Do not assert a licence you have not read** — and note there is nothing local to read from today. **Verified: `node_modules/@fontsource` does not exist** (`ls node_modules/@fontsource` → *No such file or directory*); no `@fontsource` package is installed, and the repo contains no font file of any kind (`find . -path ./node_modules -prune -o -name '*.woff*' -print` → no hits). So the acquisition step is real work, and it must be named:

  **Do this, in task 9:** `pnpm add -D @fontsource/roboto @fontsource/lato @fontsource/oswald @fontsource/bebas-neue @fontsource/montserrat @fontsource/playfair-display @fontsource/jetbrains-mono`, then copy the `.woff` files out of `node_modules/@fontsource/<family>/files/` and each `LICENSE` out of `node_modules/@fontsource/<family>/`. Verify the copied bytes match the URLs the app fetches today (`shasum` the vendored file against a `curl` of the corresponding `SVGPaintModal.tsx:19-29` URL) — that is what "byte-identical to the current jsDelivr URLs" above means, and it is now a check rather than an aspiration. Drop the dev dependencies again once the files are vendored, or keep them pinned as the provenance record; either is fine, but say which in `NOTICE.md`.

  The families are Roboto (400/700), Lato (400/700), Oswald, Bebas Neue, Montserrat, Playfair Display, JetBrains Mono. Expect SIL OFL 1.1 or Apache-2.0 — both permit redistribution *with the licence text* — but verify per family; that verification is the deliverable, not the assumption. See §8 Q1.

Self-hosting has a second payoff: a font file on disk can be read with `fs.readFileSync` in Vitest, and a jsDelivr URL cannot be without a network fetch in a test.

**But the tests must not depend on it.** Group B (§4.2) has to be shippable even if Q1 defers §4.3 indefinitely, so the text tests get their own committed fixture, vendored in task 4:

```
src/utils/text/__fixtures__/            (new)
  roboto-400.woff                       one small permissively-licensed face
  LICENSE.txt                           its licence text, verbatim
```

There is nothing to point at otherwise — verified, the only font anywhere under `node_modules` is `three/examples/fonts/ttf/kenpixel.ttf`, reachable only through an unstable `node_modules/.pnpm/three@0.182.0/…` store path, and T4's "1 shape, 1 hole for `'o'`" assertion has not been checked against it. T4–T7 read the fixture, never `public/fonts/`. The fixture is a **separate and much smaller** licensing question than shipping 9 binaries in `public/` — one face, unshipped to users, inside the source tree — but it is still a redistribution, so its `LICENSE.txt` is part of the same commit (§8 Q1).

### 4.4 Routing both producers into the pattern lane

The pipeline already accepts 2D shapes — `buildJob`'s `kind:'shapes'` branch (`src/components/ImperativeModel.tsx:832-836` → `src/utils/geometry/patternPipeline.ts:47-49`, `:138-139`) is implemented and test-covered, and it already unwraps colour wrappers with `.map((s: any) => s.shape || s)` at `:833`. The blockers are all in the controls layer:

| Blocker | Site | Fix |
|---|---|---|
| The uploader rejects everything but STL | `allowedTypes={["stl"]}` — `src/components/controls/GeometryControls.tsx:163`; enforced at `src/components/ShapeUploader.tsx:78`, `:95-103` | widen to `["stl", "image"]` — **not** `svg`/`dxf`; see N8. `'image'` is what routes a raster file to `onImageUpload` (`ShapeUploader.tsx:76-84`), which is the only reason to touch this array. Wire `onImageUpload` as `InlayControls.tsx:357` does |
| Neither modal is mounted in the pattern tab | `SVGPaintModal` and `ImageConversionModal` appear only at `src/components/controls/InlayControls.tsx:317`, `:334` | mount both in `GeometryControls` |
| **Auto-scale breaks on colour wrappers — latent, not live** | `calculateAutoPatternScale` calls `getShapesBounds(shapes)` at `src/components/controls/GeometryControls.tsx:86` with the raw array; `getShapesBounds` calls `shape.getPoints()` directly (`src/utils/patternUtils.ts:12-21`). A `{shape,color}` element has no `getPoints`. | add the `s.shape \|\| s` unwrap that `calculateInlayScale` already has at `src/utils/patternUtils.ts:1006`. **Unreachable today**, so it cannot be fixed "first": the uploader is `allowedTypes={["stl"]}` (`:163`), all 14 pattern presets are `.stl` (recon §1 item 3), the preset path calls `parseShapeFile(text, preset.type as 'dxf' \| 'svg')` with no `extractColors` (`:197`) and the import path likewise (`src/components/Controls.tsx:190`) — and `extractColors` is what produces the wrapper (`src/utils/shapeLoader.ts:52-53`). `patternShapes` therefore cannot hold a `{shape,color}` element until the row above lands. It becomes live the moment it does. |
| ...and there are **three** reachable call sites, not one | `:116` (on load), `:227` (the Tile/Place `SegmentedControl`), `:260` (the manual auto-scale button) | one fix at `:86` covers all three |
| **Auto-scale silently rescales mm-correct geometry** | tiled mode targets a hardcoded `targetWidth = 10` mm (`:93-98`); the result is written into `patternScale` on every load, guarded only by `newScale !== null` at `:135` (block `:132-136`) — a null check, not a user-intent check, so any non-null return overwrites the user's scale | root §7 already requires doc 02 to bypass or gate this. Doc 07 inherits it identically: a 50 mm traced logo lands at `patternScale ≈ 0.2`. Use whichever gate doc 02 lands; do not build a second one. |
| `patternType` has a closed 3-member enum — **write** direction | `z.enum(['dxf','svg','stl'])` — `src/types/schemas.ts:68` | **Widening is optional for the write path.** Verified: the value is written at `GeometryControls.tsx:134`, `:158`, read for UI at `:229`, `:262`, declared as a prop at `ImperativeModel.tsx:22` — and **never read in `ImperativeModel`'s body**. The only other reader is `tileShapes` (`src/utils/patternUtils.ts:807`, `:822`, `:853`, `:863`), which is dead code called solely by its own test (`src/utils/patternUtils.test.ts:386`, `:412`). Passing `null` from `handlePatternLoaded` is safe. |
| **`patternType` on the *import* direction is not safe, and this doc makes it fire** | `src/components/Controls.tsx:196` writes `patternType: importedAssets.pattern.type as any` — whatever `detectAssetType` returned. Once §4.5a's pattern-lane asset lands, that value is `'shapes'`, and the `as any` waves it straight into state past the enum at `src/types/schemas.ts:68`. The **next** export then produces a `project.json` whose `ProjectSchema.safeParse` fails at `src/utils/projectUtils.ts:183` and the import throws "Invalid project file format or version mismatch." (`:187`) | **Pick one, in the same commit as §4.5a (task 19).** (a) Coerce at `Controls.tsx:196`: `patternType: importedAssets.pattern.type === 'shapes' ? null : importedAssets.pattern.type`. (b) Widen `patternType` to `z.enum(['dxf','svg','stl','shapes'])` at `src/types/schemas.ts:68`. **(a) is preferred** — it needs no schema change, and the write-direction row above already establishes that `null` is safe. (b) is a `GeometrySettingsSchema` change inside V1 and therefore a doc-04 version concern; take it only if a reader needs to know a pattern was generated. Criterion 26 checks whichever you pick. |
| **The pattern lane has the same source-less-asset hole as the inlay lane, and none of its sites are the inlay's** | `onPatternAssetChanged` is declared with the narrow `type: 'dxf' \| 'svg' \| 'stl'` at `src/components/controls/GeometryControls.tsx:27`; `handlePatternLoaded`'s `type` param is `"dxf" \| "svg" \| "stl"` at `:114`; the asset gate is `if (onPatternAssetChanged && name && content && type)` at `:138-139`; the handler is `src/components/Controls.tsx:101`; the missing-asset check that fires is `src/components/Controls.tsx:127-129` (pushes **"Grip Pattern"**); the zip entry is `src/utils/projectUtils.ts:66` | routing a producer here **reintroduces exactly the failure G5 closes**, in the lane G4 opens. §4.5a mirrors the six-site round trip onto these sites. Not optional: without it, a text- or image-generated pattern trips "Missing Asset Files: Grip Pattern" on export and does not survive export → import. |

**The pattern lane is single-colour.** `buildJob` keeps the shape and drops the wrapper's colour (`ImperativeModel.tsx:833`); the pattern renders in `patternColor` (`src/types/schemas.ts:77`). A 4-band traced image routed here collapses to one colour. That is a product decision, not a bug — §8 Q2.

### 4.5 Persistence for shapes with no source file

> **Overlap notice — this is one of three competing mechanisms for the same hole.** Doc 04 §4.3.1 proposes `ProjectSchemaV2.shapes.inlayShapes` (inline in `project.json`, keyed by item id); doc 05 §4.3 proposes `InlayItemSchema.editedShapes` (inline, on the item); this section proposes a synthetic `<name>.shapes.json` zip asset. All three edit the same rehydration block at `src/components/Controls.tsx:206-231`, and docs 04 and 05 both declare a `SerializedShapeSchema` **(new)** in `src/types/schemas.ts`. **Only one ships.** Doc 04 §4.3.1 carries the comparison table and owns the single declaration of `SerializedShapeSchema`. Root §6 names this doc's row as the owner of *"persistence for shapes with no source file"* and root §6 phasing puts 07 ahead of 05a, so this section is the **presumptive winner** — but it is a decision @liamstar has not made, and doc 05 §8 Q5 / doc 04 §4.3.1 record it as open. One argument specific to this mechanism, worth weighing: it is the only one that also covers the **pattern** lane (§4.5a); the two inline-JSON mechanisms are inlay-only as drafted.

This is the L. The failure is exact and reproducible today: paint an inlay → Export Project → the "Missing Asset Files" dialog lists it (`src/components/Controls.tsx:135-138`, `:143-155`) → export anyway → import → the layer's shapes are the stringified `THREE.Shape.toJSON()` blob that `exportProjectBundle` spread through untouched (`src/utils/projectUtils.ts:48-50`), no zip asset matches its uuid at `src/components/Controls.tsx:208`, and the item is returned unchanged at `:229`. The first `shape.getPoints()` downstream throws.

**Design: give a source-less inlay a synthetic source file.** The zip already is the transport for source bytes; a generated inlay simply needs bytes to put there. Use the wire form that already exists.

```ts
// src/utils/sources/shapeAsset.ts       (new — does not exist yet)
import type { SerializedShape } from '../geometry/serialize';   // serialize.ts:15-18 — existing type

export interface SerializedShapeAsset {   // (new)
  kind: 'shapes';
  version: 1;
  shapes: Array<{ shape: SerializedShape; color?: string }>;
}

export function serializeShapeAsset(shapes: Array<THREE.Shape | { shape: THREE.Shape; color: string }>): string;
export function parseShapeAsset(json: string): Array<{ shape: THREE.Shape; color: string }> | null;
```

This adds **no new live geometry representation** (root rule 1 / §5 preamble). `SerializedShape` is the existing worker-wire form; `serializeShape`/`deserializeShape` (`src/utils/geometry/serialize.ts:34-45`, `:61-67`) do the conversion. The asset is that form written to a zip entry.

Round-trip, with every shared-file edit named:

| Step | File:line | Change |
|---|---|---|
| Register the asset | `src/components/controls/InlayControls.tsx:131` **and** `:152` (two gates, same condition) | the gates stay as-is; the **callers** start supplying `content`/`type`. Paint modal `onSave` at `:322-331` and image modal `onConfirm` at `:339` pass `serializeShapeAsset(finalShapes)` and `'shapes'` |
| Widen the asset type | `src/utils/projectUtils.ts:16` | `type: 'dxf' \| 'svg' \| 'stl' \| 'shapes'` — also widen the two handler signatures at `src/components/Controls.tsx:101` (pattern) and `:105` (inlay), the prop at `src/components/controls/InlayControls.tsx:41`, **and `handleShapeUpload`'s own `type?` parameter at `src/components/controls/InlayControls.tsx:118`**, which sits between the modal callers and the gates at `:131`/`:152`. Widen `parseShapeFile`'s parameter union at `src/utils/shapeLoader.ts:14` in the *same* commit or the three call sites at `Controls.tsx:180`, `:190`, `:210` go un-assignable — see §7 task 12 |
| Name the zip entry | `src/utils/projectUtils.ts:71` (`assets/inlays/<id>/<name>`) | generated assets get `<name>.shapes.json`. Note library outlines are already zipped with **no extension** and round-trip only because `detectAssetType` falls back on a leading `0` → dxf, deliberately and test-pinned (`src/utils/fileTypeSniffer.test.ts:28-48`) — do not disturb that fallback |
| Detect it on import | `src/utils/fileTypeSniffer.ts:3` (return union), `:5-8` (extension trust), `:22-24` (content sniff) | add `.json` → `'shapes'` and a content probe for a leading `{`. **Required, not cosmetic:** today a `.json` entry passes every branch and lands on the `return 'dxf'` fallback at `:39` |
| Decode it as text | `src/utils/projectUtils.ts:127` | `if (type === 'svg' \|\| type === 'dxf')` decodes UTF-8; without `'shapes'` here the JSON arrives as an `ArrayBuffer` |
| Rehydrate it | `src/utils/shapeLoader.ts:12` (signature `:14`), new branch before the `else` at `:75` | add a `'shapes'` branch calling `parseShapeAsset`. Put it in `parseShapeFile` rather than in `Controls.tsx` because that function is the single funnel all import call sites already use (`src/components/Controls.tsx:180`, `:190`, `:210`) |

**Why isolation is impossible here.** Every one of those six sites is upstream code on the persistence path; there is no seam to add a file behind. Root rule 6 budgets exactly this. All six changes are additive union members or one new branch — no existing statement changes semantics, which keeps the diff mergeable.

#### 4.5a The same round trip, on the pattern lane

The six sites above are **inlay-only**. §4.4 routes both producers into the pattern lane, which has its own copy of the identical hole on entirely different lines. Fixing the inlay lane does nothing for it. These land in §7 task 19, immediately behind §4.4's routing (task 17) and before any routed pattern is ever exported:

| Step | File:line | Change |
|---|---|---|
| Widen the callback type | `src/components/controls/GeometryControls.tsx:27` | `type: 'dxf' \| 'svg' \| 'stl'` → `\| 'shapes'`. Mirrors `InlayControls.tsx:41` |
| Widen the producer entry point | `src/components/controls/GeometryControls.tsx:114` | `handlePatternLoaded(shapes, type?: "dxf" \| "svg" \| "stl", name?, content?)` → the `type` union gains `'shapes'`. The gate at `:138-139` is unchanged; it just starts firing |
| Supply the payload | the two new modal mounts in `GeometryControls` (§4.4 row 2) | each passes `serializeShapeAsset(shapes)` as `content` and `'shapes'` as `type`, exactly as `InlayControls.tsx:322-331`/`:339` will. Without a `name` **and** `content` **and** `type`, `:138` short-circuits and the asset is never registered — the same three-way `&&` as `InlayControls.tsx:131` |
| Widen the handler | `src/components/Controls.tsx:101` | already in §4.6's list for `Asset['type']`; this is the same edit, and it is what makes `projectAssets.pattern` exist for a generated pattern |
| Name the zip entry | `src/utils/projectUtils.ts:66` (`assets/pattern/<name>`) | generated patterns get `<name>.shapes.json`, same convention as `:71`. **This line, not `:71`** — `:71` is the inlay loop |
| Fix the import-side enum | `src/components/Controls.tsx:196` | coerce `'shapes'` → `null` (or widen `src/types/schemas.ts:68`); see §4.4's last-but-one row. Skipping this makes the *second* export unimportable |

**What breaks if this is skipped.** `src/components/Controls.tsx:127-129` pushes **"Grip Pattern"** onto `missingAssets` whenever `geometrySettings.patternShapes.length > 0 && !projectAssets.pattern`. A routed text or image pattern satisfies both halves, so the dialog at `:143-155` fires on every export — and on import, `importedAssets.pattern` is absent, so `Controls.tsx:202` logs "Pattern shapes present in settings but missing from assets bundle" and the layer comes back as the same stringified `THREE.Shape` garbage §4.5 exists to eliminate. Nothing in §6.3's criteria 14–19 catches it, because every one of them exercises an inlay.

**Scope guard.** This closes the hole for *generated* shapes only. Uploaded shapes keep their raw source file, which is the better asset (recon §7 Q3 measured a real outline at 4761 flattened contour points against a 21.7 KB source DXF — the point list is several times larger as JSON). See §8 Q5.

### 4.6 Shared files touched — the complete list

New folders (`src/utils/text/`, `src/utils/sources/`, `public/fonts/`) carry everything they can. These are the unavoidable shared-file edits, per root rule 6:

| Shared file | Lines | Why isolation is impossible |
|---|---|---|
| `src/components/SVGPaintModal.tsx` | `:3`, `:16-29`, `:31-62`, `:114-119`, `:643-690`, `:672`, `:1063` | the producer, the font table and the loader are *inside* the component; extraction is by definition an edit here. Net deletion — ~60 lines out, ~4 imports in |
| `src/components/ImageConversionModal.tsx` | `:20-22`, `:54-56`, `:98` | constants and params move to the adapter |
| `src/components/controls/GeometryControls.tsx` | `:27`, `:86`, `:114`, `:163`, and two new modal mounts | the callback type, the auto-scale unwrap, the producer entry point, the STL gate; §4.4 and §4.5a. The gate at `:138-139` is *not* edited — it starts firing once `:114`'s callers supply `content`/`type` |
| `src/components/controls/InlayControls.tsx` | `:41`, `:118`, `:322-331`, `:339` | the prop type, `handleShapeUpload`'s own `type?: 'dxf'\|'svg'\|'stl'` parameter, and the asset payload at the two producer call sites; §4.5. **`:118` is not optional** — the gates at `:131` and `:152` are both inside `handleShapeUpload`, so `'shapes'` cannot reach them without widening the signature it arrives through |
| `src/components/Controls.tsx` | `:101`, `:105`, `:196` | asset handler signatures widen with `Asset['type']` (`:101` is the **pattern** handler, `:105` the inlay one); `:196` coerces or widens `patternType` on import, §4.4 |
| `src/utils/projectUtils.ts` | `:16`, `:66`, `:71`, `:127` | `Asset['type']`; entry naming on **both** asset paths — `:66` is `assets/pattern/`, `:71` is `assets/inlays/<id>/`, and §4.5a needs `:66`; text decode |
| `src/utils/fileTypeSniffer.ts` | `:3`, `:5-8`, `:22-24` | new asset kind must sniff |
| `src/utils/shapeLoader.ts` | `:12`, `:14`, before `:75` | the single import funnel |
| `src/types/schemas.ts` | `:19-46` (`InlayItemSchema`), `:68` (`patternType`) | `:19-46` **only if** §8 Q3 lands params in the schema — that schema has no `.default()` on any field. `:68` **only if** §4.4 takes option (b) on `patternType`; option (a) (coerce at `Controls.tsx:196`) leaves this file untouched and is preferred |

**Not touched, and deliberately so:** `src/utils/geometry/patternPipeline.ts`, `src/workers/geometryWorker.ts`, `src/utils/geometry/patternClient.ts`, `src/utils/geometry/manifoldOps.ts`, `src/components/OutputPanel.tsx`, `src/components/ImperativeModel.tsx`. **`vite.config.ts` needs no edit either** — the coverage allowlist already includes `src/utils/**` (`vite.config.ts:30-35`), which covers `src/utils/text/**`, `src/utils/image/**` and `src/utils/sources/**`. Everything new in this doc lands inside the measured surface by construction.

**Never reformat.** No Prettier, no EditorConfig; `SVGPaintModal.tsx` is 4-space-indented while `GeometryControls.tsx` and `InlayControls.tsx` are 2-space. Match the file you are in.

## 5. Integration points

Every existing call site this attaches to.

| # | Site | `file:line` | What attaches |
|---|---|---|---|
| 1 | `generateTextShapesFromOpentype` — the producer to extract | `src/components/SVGPaintModal.tsx:32-62` | becomes `textToShapes` in `src/utils/text/textToShapes.ts`; the single caller at `:523` imports it |
| 2 | `PRESET_FONTS` / `PresetFont` | `src/components/SVGPaintModal.tsx:17`, `:19-29` | moves to `src/utils/text/fonts.ts`; URLs repoint to `import.meta.env.BASE_URL` |
| 3 | `loadFont` + the two ref caches | `src/components/SVGPaintModal.tsx:644-664`, `:116`, `:119`, preload at `:667` | becomes a module-level cached loader |
| 4 | Custom-font upload | `src/components/SVGPaintModal.tsx:669-690`, accept string `:672` | uses `registerCustomFont`; `.woff2` removed from accept |
| 5 | `opentype.parse` — the only two parse sites in `src/` | `src/components/SVGPaintModal.tsx:655`, `:678` | both route through `parseFontBuffer`, which owns the dynamic import |
| 6 | `traceImage` / `traceLayers` — the only two call sites | `src/components/ImageConversionModal.tsx:98`, `:82` | go through `imageSource` / `previewLayers` |
| 7 | `loadDownsampledImage` | `src/utils/imageUtils.ts:8`, called `src/components/ImageConversionModal.tsx:68`, `:96` | unchanged; the adapter calls it |
| 8 | Paint modal commit | `src/components/controls/InlayControls.tsx:322-331` (`onSave` → `centerShapes(raw, false)` → `handleShapeUpload`) | gains `content`/`type` so the asset gate at `:131`/`:152` fires |
| 9 | Image modal commit | `src/components/controls/InlayControls.tsx:339` | same |
| 10 | Pattern uploader STL gate | `src/components/controls/GeometryControls.tsx:163` | widened to `["stl", "image"]` only (N8); `ShapeUploader` enforcement at `src/components/ShapeUploader.tsx:78`, `:95-103`, image branch `:76-84`, accept string built at `:171` |
| 11 | Pattern auto-scale | `src/components/controls/GeometryControls.tsx:67-112`, unwrap bug at `:86`; called at `:116`, `:227`, `:260` | wrapper unwrap; auto-overwrite gate shared with doc 02 |
| 12 | `handlePatternLoaded` — the precedent root §5.1 names for writing `patternShapes` | `src/components/controls/GeometryControls.tsx:114-141`; `type` param `:114`; asset gate `:138-139` | both routed producers land here; the `type` union at `:114` and the callback type at `:27` widen to `'shapes'` so the gate fires (§4.5a) |
| 13 | Asset registration handlers | `src/components/Controls.tsx:101-103` (pattern), `:105-115` (inlays) | signatures widen with `Asset['type']` — `:101` is what makes `projectAssets.pattern` exist for a generated pattern |
| 14 | Missing-asset gate | `src/components/Controls.tsx:117-158`; **pattern** check `:127-129`, inlay check `:135-138`, dialog `:143-155` | stops firing for generated inlays once #8/#9 land, and for generated **patterns** once §4.5a lands |
| 15 | Import rehydration | `src/components/Controls.tsx:176-231`; `patternType` write-back `:196`; `importProjectBundle` `src/utils/projectUtils.ts:105-199`, `processEntry` `:121-132` | `'shapes'` assets decode and parse; `:196` must not stamp `'shapes'` into a 3-member enum (§4.4) |

## 6. Edge cases, testing, acceptance criteria

### 6.1 Edge cases

| # | Case and required behaviour |
|---|---|
| E1 | **`fontSize` is not millimetres, despite the UI.** The slider renders `{fontSize}mm` at `SVGPaintModal.tsx:1063` and feeds `glyph.getPath(x, 0, fontSize)` (`:43`), which emits in **em-relative units — 1 em == `fontSize`**, the space set up by `const scale = fontSize / font.unitsPerEm` at `:37`. (Not "font design units": those are `unitsPerEm`-relative and are what the scale factor divides out.) Those land in the modal's viewBox space, which is fit to existing layer content (`:204-211`) or defaults to 500×500 when empty (`:213`), and are then rescaled to 80% of the outline by `calculateInlayScale` (`src/utils/patternUtils.ts:999-1021`) on commit. **The mm is nominal.** The extracted module must document its unit in a docblock and must not claim mm. Root §5.2 rule 1 says a source with its own unit system converts itself; this doc **declines to**, as a declared exception recorded at N7 and settled by §8 Q6. |
| E2 | **Empty or whitespace text.** `stringToGlyphs('')` yields no glyphs; `textToShapes` returns `[]`. `handleShapeUpload([])` then sets `shapes: []`, `calculateInlayScale` returns via the `width > 0 && height > 0` guard (`patternUtils.ts:1011`), and the layer silently reads as empty. Return `[]` and let the caller decide; never throw. |
| E3 | **A glyph with no contours** (space, most control chars). `path.commands` is empty; `:46` already `continue`s while still advancing `x` at `:44`. Preserve that order — moving the `continue` above the advance collapses spaces. |
| E4 | **Rings under 3 vertices are dropped silently.** `points.length < 6` is discarded at `src/utils/geometry/manifoldOps.ts:86` (also `:93`, `:132`) with no error and no `empty` signal any consumer reads. A 1-px trace speck or a degenerate glyph contour vanishes with no diagnostic. Filter in the producer, where a count can be reported. |
| E5 | **`.woff2` is accepted and unparseable.** `SVGPaintModal.tsx:672` vs the comment at `:16`. Remove it from the accept string and keep the specific error (`:686`), rather than letting the parse fail generically. |
| E6 | **Font fetch failure is a dead end.** `loadFont` returns `null` (`:660`), the caller falls back to `PRESET_FONTS[0]` then to any custom font (`:516-518`), and finally shows "Check your internet connection" (`:520`). Self-hosting turns a network error into a 404 — which on a subpath deploy is exactly the `BASE_URL` bug (§4.3). Keep the alert; change its text. |
| E7 | **Custom fonts are session-only and unpersisted.** `customFontCacheRef` (`:119`) dies with the modal, and no font bytes enter the project zip. A design using a custom font does not reproduce. Out of scope here; state it in the UI rather than pretending otherwise. |
| E8 | **A traced image carries up to 12 colours into a single-colour lane.** `MAX_COLORS = 12` (`src/utils/image/traceImage.ts:53`); the pattern lane renders one `patternColor`. §8 Q2. |
| E9 | **`centerShapes` short-circuits, and the threshold is a *squared* length.** `centerShapes(shapes, false)` returns the *input array unchanged* when the bbox centre is within **~0.0316** of origin — the test is `if (center.lengthSq() < 0.001 && !flipY) return shapes;` (`src/utils/patternUtils.ts:955`), and `√0.001 ≈ 0.0316`. So a producer whose centre is 0.002 off **does** short-circuit and keeps its curve-bearing shapes; one that is 0.05 off gets everything re-sampled to polylines at 12 divisions (`:961`, `:968-973`) and permanently flattened. Do not depend on either outcome, and do not reason about this bound as a distance without squaring it. |
| E10 | **Overlapping rings XOR-cancel.** `csFromShapes` builds one `CrossSection` per `SerializedShape` under `'EvenOdd'` and unions them (`src/utils/geometry/manifoldOps.ts:91-98`). Overlapping glyphs or bands passed as **separate shapes** union correctly; a **single** shape whose own rings overlap cancels. Emit one shape per glyph, as `:59` already does. |
| E11 | **Winding is not normalised on import.** DXF outers are CCW, SVG outers CW, holes are never rewound (root §7). Text relies on `toShapes(true)` to derive nesting; image traces rely on imagetracer's `isholepath`/`holechildren` (`src/utils/image/traceImage.ts:196-201`). Neither may be "fixed" by a blanket rewind. |
| E12 | **A `'shapes'` asset must not be mistaken for a DXF.** Today a `.json` zip entry falls through every branch of `detectAssetType` to `return 'dxf'` (`src/utils/fileTypeSniffer.ts:39`) and is then fed to `parseDxfToShapes`. The existing leading-`0` → dxf fallback is deliberate and test-pinned (`src/utils/fileTypeSniffer.test.ts:28-48`) and must keep passing. |
| E13 | **A structured-clone hazard is *not* present here** — but stays one command away. Neither producer's output enters a job directly; `buildJob` serialises (`ImperativeModel.tsx:836`, `:850-856`). If a later change ever puts an `opentype.Font`, an `ImageData` or a `THREE.Shape` into a `PatternJob`, `pump()` throws a `DataCloneError` at `src/utils/geometry/patternClient.ts:66-67` after nulling the pending slot at `:65`, and **all geometry generation is permanently wedged for the session** with the spinner stuck on (`ImperativeModel.tsx:811`). Root rule 5. |

### 6.2 Testing (Vitest)

Baseline to regress against: **21 files, 162 tests, all passing, 4.54s** (`docs/_source/baseline-verification.md`). Environment is `jsdom` (`vite.config.ts:26`); coverage `include` already covers everything this doc adds (`:30-35`).

> **Blocking harness fact, not in the recon report.** `ImageData` is **undefined** in both the Node runtime (verified: `node -e "typeof ImageData"` → `undefined` on v26.5.0) and the configured jsdom environment (verified: `new JSDOM('').window.ImageData` → `undefined`; the `canvas` package is not installed). `traceLayers` constructs `new ImageData(quant, W, H)` inside `buildQuant` at `src/utils/image/traceImage.ts:130`, so **any test of `traceLayers` or `traceImage` throws `ImageData is not defined` today.** This is why the module has no test. Install a 5-line global shim in the test file — `imagetracerjs` duck-types the argument, reading only `.data`, `.width` and `.height` (`node_modules/imagetracerjs/imagetracer_v1.2.6.js:154-155`, `:245`, `:248`) and reassigning `.data` when it is RGB rather than RGBA (`:256`) — so a plain writable class suffices; do **not** add the `canvas` dependency.

| Test | File | Asserts |
|---|---|---|
| T1 | `src/utils/image/traceImage.test.ts` (new) | with the `ImageData` shim, a synthetic 32×32 two-tone RGBA buffer traced at `colors: 2` yields ≥1 `TracedBandShape` per band, every `shape.getPoints().length >= 3`, and `palette.length === 2` |
| T2 | same | `widthMM: 50` on a 2:1 image puts the bbox at 50 × 25 mm ±0.5, exercising the pixel→mm mapper at `traceImage.ts:184-189` |
| T3 | same | determinism — `traceImage(img, 4, opts)` twice deep-equals itself (there is no PRNG in this path; this pins that fact for doc 08) |
| T4 | `src/utils/text/textToShapes.test.ts` (new) | reads the committed fixture `src/utils/text/__fixtures__/roboto-400.woff` off disk with `fs.readFileSync`, parses it, and asserts `textToShapes(font, 'o', {fontSize: 100})` returns exactly 1 shape with exactly 1 hole — the counter proves `toShapes(true)` nesting survived the move. **The fixture, never `public/fonts/`** (§4.3): Group B must stay green whether or not Q1 ever lets Group C ship |
| T5 | same | `textToShapes(font, 'AB', …)` returns 2 shapes and the second's min-x exceeds the first's — advance-width accumulation (`SVGPaintModal.tsx:44`) survived |
| T6 | same | every emitted point has finite `x`/`y`, and at least one `y > 0` for a cap-height glyph — pins the Y negation at `:52-55` |
| T7 | same | `textToShapes(font, '', …)` returns `[]` and `textToShapes(font, ' ', …)` returns `[]` (E2, E3) |
| T8 | `src/utils/text/fonts.test.ts` (new) | `PRESET_FONTS` has 9 entries, and **no entry contains the substring `jsdelivr`**. These are the only two properties that survive at runtime — see the note below; the `BASE_URL` requirement is checked as source text by criterion 11, not here |
| T9 | `src/utils/sources/shapeAsset.test.ts` (new) | `parseShapeAsset(serializeShapeAsset(shapes))` returns the same count, the same per-shape point counts, the same hole counts and the same colours, within 1e-6 on coordinates |
| T10 | same | `parseShapeAsset('not json')` and `parseShapeAsset('{}')` both return `null` without throwing |
| T11 | `src/utils/fileTypeSniffer.test.ts` (extend) | a `.shapes.json` name and a `{"kind":"shapes"` body both detect as `'shapes'`; **all existing cases at `:28-48` still pass unchanged** |
| T12 | `src/utils/shapeLoader.test.ts` (extend) | `parseShapeFile(json, 'shapes', true)` returns `success: true` with `{shape,color}` wrappers; the existing content-override cases at `:119-130` still pass |
| T13 | `src/utils/projectUtils.test.ts` (extend) | export → import of an inlay whose only asset is a `'shapes'` asset restores shapes with `getPoints().length > 0` — the failing-today round trip |

> **`import.meta.env.BASE_URL` cannot be asserted at runtime, and a runtime assertion would pass on the bug.** `base` is commented out in `vite.config.ts:17`, so `BASE_URL` resolves to `'/'` in dev, in test and in the current build. `` `${import.meta.env.BASE_URL}fonts/roboto-latin-400-normal.woff` `` therefore evaluates to the *string* `/fonts/roboto-latin-400-normal.woff` — indistinguishable at runtime from the hardcoded `'/fonts/…'` that §4.3 exists to prevent. "Every `url` starts with `import.meta.env.BASE_URL`" is vacuously true for the bug, and "no url begins with a bare `/`" is *false for the correct implementation*. The property is about the **source text**, so check it there (criterion 11) and keep T8 to what the values actually carry.

### 6.3 Acceptance criteria

Each is a command, an assertion, or a specific observable outcome.

**Regression floor (applies to every task)**

1. `pnpm test` passes with **no fewer than 162 tests** and no previously-passing test modified. New tests only add.
2. `pnpm build` exits 0.
3. `grep -rn "generateTextShapesFromOpentype" src/components/` returns **zero** hits. (The name may survive in `src/utils/text/textToShapes.ts`'s docblock; that is not checked either way.)

**Text extraction**

4. `grep -rn "opentype" src/components/` returns **zero** hits. Every reference lives under `src/utils/text/`.
5. Two greps, both run from the repo root:
   - `grep -rn "import \* as opentype" src/` returns **zero** hits — the namespace import at `src/components/SVGPaintModal.tsx:3` is gone.
   - `grep -rln "opentype.js" src/` returns **exactly one** path, `src/utils/text/fonts.ts`, and within it `grep -c "opentype.js" src/utils/text/fonts.ts` is **2** — one `import type { Font } from 'opentype.js'` (erased at build) and one `await import('opentype.js')`.

   These are separate assertions on purpose. A single `grep "from 'opentype.js'"` cannot both return zero and leave the type-only import in place: `import type { Font } from 'opentype.js'` contains that substring verbatim, and `Font` is a real named export (`node_modules/@types/opentype.js/index.d.ts:9`), so the line will exist and will match.
6. T4–T7 pass.
7. After the dynamic import lands, `pnpm build` emits a chunk other than `index-*.js` that contains the string `unitsPerEm`, and `index-*.js` is **smaller than the 1,850.77 kB baseline** recorded in `docs/_source/baseline-verification.md`. Check with `grep -l unitsPerEm dist/assets/*.js` and `ls -l dist/assets/index-*.js`.
8. Opening the paint modal, typing text with the text tool and saving produces the same shape count as before the extraction, for the same font, size and string.

**Fonts**

9. `grep -rn "jsdelivr" src/` returns **zero** hits.
10. `ls public/fonts/*.woff | wc -l` is **9**; `public/fonts/NOTICE.md` names all 9 files, their upstream `@fontsource` package and their licence, and one licence text file exists per distinct licence.
11. **Source-text check, not a runtime one** (see the note at the end of §6.2 — `BASE_URL` is `'/'` here, so a runtime check passes on the bug and fails on the fix). Both must hold:
    - `grep -c 'import.meta.env.BASE_URL' src/utils/text/fonts.ts` is **1**.
    - `grep -n 'url: `/' src/utils/text/fonts.ts` returns **zero** hits — no template literal starts with a bare `/`.
12. With the network disabled in devtools, the text tool renders text on first use. (Manual; it is the point of the change.)
13. `grep -n "woff2" src/components/SVGPaintModal.tsx` returns **zero** hits.

**Persistence — the blocker**

14. Paint an inlay → Export Project → **the "Missing Asset Files" dialog does not appear** (it currently does; `src/components/Controls.tsx:143-155`).
15. `unzip -l` on that bundle lists `assets/inlays/<uuid>/<name>.shapes.json`.
16. Import that bundle → the layer renders identically → `pnpm test`'s T13 asserts the same programmatically.
17. Repeat 14–16 for a traced-image inlay with `colors: 4`; the restored layer has **4 distinct colours**, matching the pre-export palette.
18. T9–T12 pass, and `src/utils/fileTypeSniffer.test.ts`'s existing cases at `:28-48` pass **unmodified**.
19. A v1 bundle exported *before* this change still imports without error — `version: z.literal(1)` (`src/types/schemas.ts:88`) is untouched and `grep -n "z.literal(1)" src/types/schemas.ts` still matches.

**Pattern lane**

20. The Pattern tab accepts a PNG, opens the conversion dialog and commits shapes into `patternShapes`, and the preview renders a **traced silhouette rather than an STL stud** — that is the observable, and it is only reachable through the `kind:'shapes'` branch at `src/components/ImperativeModel.tsx:832-836`. Pinned in code by a Vitest assertion over a `buildJob`-shaped fixture: given a `patternShapes` array of `THREE.Shape`, the assembled `patternUnit.kind` is `'shapes'` and `patternUnit` carries no `position` buffer. No `console.log` and no breakpoint — an instrumentation step is not a property of the shipped build.
21. Switching Tile ↔ Place with a colour-wrapper pattern loaded **does not throw**. Pre-fix this raises `shape.getPoints is not a function` from `src/utils/patternUtils.ts:17` via `src/components/controls/GeometryControls.tsx:86`, reached from `:227`. **This criterion is not exercisable until task 17 lands** — see §4.4's "latent, not live" row; it belongs to task 18, and running it earlier proves nothing because `patternShapes` cannot hold a wrapper.
22. `pnpm test` still green with **zero edits** to `src/utils/geometry/patternPipeline.ts` — `git diff --stat src/utils/geometry/ src/workers/` is empty for the whole doc.
23. A 50 mm traced logo committed to the pattern lane does **not** silently land at `patternScale ≈ 0.2`; whichever gate doc 02 lands on `calculateAutoPatternScale` (`src/components/controls/GeometryControls.tsx:132-136`) is honoured, verified by reading `patternScale` after commit.

**Pattern-lane persistence** — mirrors 14–16 onto the lane §4.5a covers. None of criteria 14–19 touch it; all of them exercise an inlay.

24. Trace an image into the **Pattern** tab → Export Project → **the "Missing Asset Files" dialog does not appear**. Without §4.5a it lists "Grip Pattern" (`src/components/Controls.tsx:127-129`, dialog `:143-155`).
25. `unzip -l` on that bundle lists `assets/pattern/<name>.shapes.json` (written at `src/utils/projectUtils.ts:66`). Import it → the pattern preview renders the same silhouette → no "Pattern shapes present in settings but missing from assets bundle" warning at `src/components/Controls.tsx:202`.
26. **Export → import → export → import of a routed pattern completes twice**, with no "Invalid project file format or version mismatch." The second import is the one that fails without §4.4's `patternType` fix: the first import writes `patternType: 'shapes'` past the `as any` at `src/components/Controls.tsx:196`, and the second export's `ProjectSchema.safeParse` (`src/utils/projectUtils.ts:183`) then rejects it against `z.enum(['dxf','svg','stl'])` (`src/types/schemas.ts:68`) and throws at `:187`. Check the shipped state directly: after the first import, `geometrySettings.patternType` is `null` (option a) or `'shapes'` with the enum widened (option b) — never `'shapes'` against an un-widened enum.

## 7. Task order

The recon is **complete** (root §9); this starts from its findings. Each task is one commit.

**Group A — image lane (smallest; unblocks the test harness)**

1. Add `src/utils/image/traceImage.test.ts` with the `ImageData` shim; land T1–T3. *No production code changes.* → criteria 1, 2, and the §6.2 harness fact.
2. Add `src/utils/image/imageSource.ts` with `PREVIEW_TRACE_PX`, `COMMIT_TRACE_PX`, `DEFAULT_WIDTH_MM` and `ImageSourceParams`, moved from `ImageConversionModal.tsx:20-22`, `:54-56`, `:98`.
3. Rewire `ImageConversionModal` to the adapter (`:68`, `:82`, `:96`, `:98`). Behaviour-identical; the modal keeps `renderLayers` and its sliders.

**Group B — text extraction (body-verbatim first, improvements after)**

4. Create `src/utils/text/textToShapes.ts` by moving `SVGPaintModal.tsx:32-62` with its **body verbatim**, exported, with `TextToShapesOptions` — the only change is the third parameter (`:35` `fontSize: number` → `opts`). Import it at `:523`. Nothing else changes. No `letterSpacing` (§4.2). Do **not** touch the re-sampling block at `:531-548` in this commit. In the same commit, vendor `src/utils/text/__fixtures__/roboto-400.woff` plus its `LICENSE.txt`, so task 5 has a font to read.
5. Add `src/utils/text/textToShapes.test.ts` (T4–T7), reading the task-4 fixture with `fs.readFileSync`. **It never reads `public/fonts/`,** so Group B does not depend on Group C at all and task 9 rewrites nothing. There is no usable fallback if the fixture is skipped: verified, `node_modules/@fontsource` does not exist, the repo ships no font file, and the only font under `node_modules` is `three/examples/fonts/ttf/kenpixel.ttf` behind an unstable `.pnpm` store path whose glyph coverage T4 has never been checked against.
6. Create `src/utils/text/fonts.ts`: move `PresetFont`/`PRESET_FONTS` (`:17`, `:19-29`) and `loadFont` (`:644-664`, preload `:667`); collapse `fontCacheRef` + `customFontCacheRef` (`:116`, `:119`) into one module map; add `registerCustomFont` for `:669-690`.
7. Route both `opentype.parse` sites (`:655`, `:678`) through `parseFontBuffer`; make it `await import('opentype.js')` and the `Font` import type-only. → criteria 4, 5, 7.
8. Drop the modal's re-sampling at `:531-548` — translate the shapes instead of rebuilding them as polylines. Assert the same glyph count and hole count before and after.

**Group C — font self-hosting**

9. Acquire and vendor the 9 `.woff` files into `public/fonts/`. Acquisition is the `pnpm add -D @fontsource/…` step named in §4.3, not an assumption that the packages are already there — **verified: `node_modules/@fontsource` does not exist today.** Copy each `LICENSE` out of `node_modules/@fontsource/<family>/`, write `public/fonts/NOTICE.md` recording family → package → licence → source URL, and `shasum`-check each vendored file against the jsDelivr URL it replaces. Repoint `PRESET_FONTS[].url` at `` `${import.meta.env.BASE_URL}fonts/...` ``. → criteria 9–11.
10. Remove `.woff2` from the accept string (`:672`) and retarget the offline error text (`:520`). → criterion 13. Add T8.

**Group D — persistence (the blocker)**

11. Add `src/utils/sources/shapeAsset.ts` + tests (T9, T10). New file only; nothing wired yet.
12. Widen `Asset['type']` (`src/utils/projectUtils.ts:16`), the two handler signatures (`src/components/Controls.tsx:101`, `:105`), the prop and the upload signature in `InlayControls` (`:41`, `:118`), **and `parseShapeFile`'s parameter union (`src/utils/shapeLoader.ts:14`) in the same commit** — the widened `Asset['type']` makes `asset.type` un-assignable at all three `parseShapeFile(…)` call sites (`src/components/Controls.tsx:180`, `:190`, `:210`) the moment it lands. The `'shapes'` *branch body* still comes in task 14; this commit only widens the union so the file compiles.

    **Gate — do not use `pnpm build` for this.** `"build": "vite build"` (`package.json:9`) has no `tsc` step, so a type-broken commit builds green; the baseline says so explicitly and warns against exactly this (`docs/_source/baseline-verification.md:44-45`, `:60-63`). The real gate is a **diff against a captured error list**, not a grep for filenames — `src/components/Controls.tsx` already carries 2 pre-existing unused-import errors, so any filename grep is non-zero before you start.

    ```sh
    # once, on the commit before this task
    npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep 'error TS' | sort > /tmp/tsc-before.txt
    # after the widening commit
    npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep 'error TS' | sort > /tmp/tsc-after.txt
    diff /tmp/tsc-before.txt /tmp/tsc-after.txt        # must be empty
    ```

    Capture `tsc-before.txt` yourself rather than trusting a number: the baseline records **19** errors (`docs/_source/baseline-verification.md`, "Typecheck — 19 PRE-EXISTING ERRORS"), the tree as received measures **18**, and neither figure is worth a failed gate. `pnpm build` exiting 0 remains necessary but proves nothing here.
13. Teach `detectAssetType` the `'shapes'` kind (`src/utils/fileTypeSniffer.ts:3`, `:5-8`, `:22-24`) and extend its test (T11) **without editing the existing cases at `:28-48`**.
14. Add the `'shapes'` branch to `parseShapeFile` (`src/utils/shapeLoader.ts:12`, `:14`, before `:75`) + T12; add `'shapes'` to the text-decode condition at `src/utils/projectUtils.ts:127`; name generated entries `<name>.shapes.json` at `:71`.
15. Supply `content`/`type` from the paint modal (`src/components/controls/InlayControls.tsx:322-331`) and the image modal (`:339`) so the gates at `:131`/`:152` fire. Both gates live inside `handleShapeUpload`, so its own signature at `:118` must already admit `'shapes'` — that widening is task 12's; confirm it landed before starting here or the payload cannot reach the gate. → criteria 14, 15.
16. Add T13 and walk criteria 16–19 by hand once.

**Group E — pattern lane**

*Order matters here.* The wrapper-unwrap fix used to be first; it is now second, because its acceptance criterion is not reachable until the lane is open — see §4.4's "latent, not live" row.

17. Widen `allowedTypes` at `src/components/controls/GeometryControls.tsx:163` to `["stl", "image"]` (**not** `svg`/`dxf`; N8) and mount `ImageConversionModal` in `GeometryControls`, wiring `onImageUpload` as `InlayControls.tsx:357` does. → criterion 20.
18. Fix the wrapper unwrap at `src/components/controls/GeometryControls.tsx:86` (`s.shape || s`, mirroring `src/utils/patternUtils.ts:1006`). → criterion 21. Smallest possible commit. **It is a latent bug, not a live one:** until task 17 landed, `patternShapes` could not hold a `{shape,color}` element at all — the uploader was STL-gated (`:163`), every pattern preset is `.stl`, and no pattern-side `parseShapeFile` call passes `extractColors` (`:197`, `src/components/Controls.tsx:190`). Task 17 makes it live, and this task closes it in the same breath; criterion 21 can only be exercised in this order.
19. **Pattern-lane persistence — §4.5a.** Widen `GeometryControls.tsx:27` and `:114` to admit `'shapes'`; have the two new modal mounts pass `serializeShapeAsset(shapes)` as `content` and `'shapes'` as `type` so the gate at `:138-139` fires; confirm `Controls.tsx:101` widened in task 12; name the entry `<name>.shapes.json` at `src/utils/projectUtils.ts:66`; and coerce `'shapes'` → `null` at `Controls.tsx:196` (or widen `src/types/schemas.ts:68`). → criteria 24–26. **Not optional and not deferrable past task 17:** without it a routed pattern trips "Missing Asset Files: Grip Pattern" (`Controls.tsx:127-129`) and does not survive export → import — the exact failure G5 closes, reopened in the lane G4 opens.
20. Mount a text entry point in the pattern lane on top of `src/utils/text/`. Decide whether it reuses `SVGPaintModal` or is a direct text→`patternShapes` control; the latter avoids dragging paint-modal state into the pattern tab. Whichever it is, it registers its asset the same way task 19 does — criteria 24–26 apply to a text-generated pattern too.
21. Honour doc 02's auto-scale gate for both routed sources (`:132-136`). → criterion 23. **Do not build a second gate**; if doc 02 has not landed, stop here and note the dependency.

## What already exists — do not rebuild

Read this before writing a line. Every row is present in the codebase today.

| Piece | Where | State |
|---|---|---|
| **Raster → vector tracing** | `traceImage` `src/utils/image/traceImage.ts:179`; `traceLayers` `:137` | **Complete and standalone.** Imports only `three`, `imagetracerjs`, `../geometry/colorShift` (`:1-3`). Two-stage produce: layers for preview, `TraceResult { shapes; palette }` (`:25-28`) for commit. **The template for `ShapeSource`.** |
| Posterisation into K luminance bands with per-band average colour | `posterize` `src/utils/image/traceImage.ts:78-115` | Complete. Equal-population thresholds, optional hue rotation, alpha threshold 128 (`:54`). |
| Quality → tracer tuning, resolution-normalised | `qualityToTuning` `src/utils/image/traceImage.ts:64-75` | Complete. 1..10 mapped to `ltres`/`qtres`/`pathomit`/`blurradius`. |
| Colour-carrying traced shape type with holes | `TracedBandShape` `src/utils/image/traceImage.ts:19-23`; holes attached at `:198-201` | Complete. |
| Pixel → millimetre mapping, centred, Y-flipped | `src/utils/image/traceImage.ts:183-189` | Complete. `widthMM` defaults to 50 (`:180`). |
| Image load + downsample into a **transferable** buffer | `loadDownsampledImage` `src/utils/imageUtils.ts:8-32`, standalone copy at `:23-24` | Complete — and already worker-ready, which is why a trace worker is cheap later (§8 Q4). |
| Live trace preview with a 180 ms debounce | `src/components/ImageConversionModal.tsx:76-90`; canvas render `:25-51` | Complete. |
| Image conversion UI (colours / quality / hue sliders) | `src/components/ImageConversionModal.tsx:132-163` | Complete. Also the app's best-formed `type="range"` template (recon §5, doc 04). |
| **Glyph → outline conversion with correct hole nesting** | `generateTextShapesFromOpentype` `src/components/SVGPaintModal.tsx:32-62` | **Correct but module-private.** `ShapePath` + `toShapes(true)` (`:49`, `:59`), Y negation (`:52-55`), advance-width accumulation (`:44`). Move it; do not rewrite it. |
| A 9-family preset font table | `PRESET_FONTS` `src/components/SVGPaintModal.tsx:19-29` | Complete as data. URLs point at jsDelivr. |
| Font loading with caching + custom-font upload | `loadFont` `:644-664`; preload `:667`; custom upload `:669-690`; two ref caches `:116`, `:119` | Works. Modal-scoped, dies on unmount. |
| A text tool with click placement and a size slider | `src/components/SVGPaintModal.tsx:504-557`; slider `:1063-1065` | Complete. The `mm` label is wrong (E1). |
| The `kind:'shapes'` pipeline branch a 2D source needs | `src/components/ImperativeModel.tsx:832-836` → `src/utils/geometry/patternPipeline.ts:47-49`, `:138-139` | **Implemented and test-covered, with no UI path.** A routed source is its first production caller. Colour wrappers are already unwrapped at `:833`. |
| `THREE.Shape` ⇄ flat-array conversion | `serializeShape`/`serializeShapes` `src/utils/geometry/serialize.ts:34-50`; `deserializeShape` `:61-67` | Complete. §4.5's asset is built on it — no new format needed. |
| Project zip export/import with per-inlay asset folders | `exportProjectBundle` `src/utils/projectUtils.ts:29-87`; `importProjectBundle` `:105-199`; UI at `src/components/Controls.tsx:281-298` | Works **for file-backed shapes only.** The gap is generated shapes (§4.5), not the bundle. |
| Content-based asset type sniffing, with a test-pinned no-extension fallback | `detectAssetType` `src/utils/fileTypeSniffer.ts:3-39`; pinned at `src/utils/fileTypeSniffer.test.ts:28-48` | Complete for `dxf`/`svg`/`stl`. No image case, no JSON case. |
| A single import funnel for all shape parsing, with deliberate content-over-extension override | `parseShapeFile` `src/utils/shapeLoader.ts:12-85`; override pinned at `src/utils/shapeLoader.test.ts:119-130` | Complete. Add a branch; do not fork it. |
| Outline-fit auto-scaling that already unwraps `{shape,color}` | `calculateInlayScale` `src/utils/patternUtils.ts:999-1030`, unwrap at `:1006` | Complete — and the exact fix the pattern lane's `:86` is missing. |
| Colour extraction from SVG fills into the `{shape,color}` wrapper | `src/utils/shapeLoader.ts:46-58` | Complete. |
| Hue rotation in RGB | `shiftHueRGB` `src/utils/geometry/colorShift.ts` | Complete. |

**Genuinely absent, in full:** any exported text-to-outline module; any font under `public/`; any licence record for a font; any test touching `src/utils/image/**` or text; any asset representation for shapes with no source file; any text or image entry point in the pattern lane; any `ShapeSource` interface.

## 8. Open questions

Genuine unknowns only. Each names what would settle it.

**Q1 — Can the 9 preset fonts be redistributed from this repo at all?**
Root §7 records that the repo has **no `LICENSE`** and that `public/` already ships 13 inlay SVGs and 17 outline DXFs with zero rights metadata. Adding 9 font binaries is a redistribution question layered on an unresolved one.
*Settles it:* install the 7 `@fontsource` packages as dev dependencies (**they are not present — verified, `node_modules/@fontsource` does not exist**), read the `LICENSE` in each, and record it in `public/fonts/NOTICE.md`. That is a concrete acquisition step, not a lookup, and it is task 9's first move — but it still blocks nothing, because it is cheap and reversible. Then a call from @liamstar on whether to ship any third-party binaries before the upstream licensing conversation with techfoundrynz concludes. If the answer is "not yet", ship §4.2 (extraction) and defer §4.3 (self-hosting) — they are independent commits, and **Group B does not depend on Group C at all**: task 5 reads the committed fixture `src/utils/text/__fixtures__/roboto-400.woff`, never `public/fonts/`.

*Two questions, not one.* The test fixture is a **separate and much smaller** licensing decision than shipping 9 binaries in `public/`: one face, in the source tree, never served to a user, needed for T4–T7 to exist at all. Answer it first and independently; a "not yet" on `public/fonts/` should not stall Group B.

**Q2 — Should a multi-colour traced image be routable to the pattern lane at all?**
The pattern lane is single-colour by construction: `buildJob` drops the wrapper colour at `src/components/ImperativeModel.tsx:833` and everything renders as `patternColor` (`src/types/schemas.ts:77`). A 4-band trace collapses. Three options: flatten and say so in the UI; take band 0 only (the darkest, usually the silhouette); or keep image tracing inlay-only and route **text** only.
*Settles it:* a product call from @liamstar. Cheap evidence first — do task 17, trace a logo, and look at it.

**Q3 — Where do per-source params live, and does `ShapeSource` carry them?**
Root §5.1 fixes the truthful signature as `produce(): Promise<Array<THREE.Shape | {shape;color}>>` — **no parameters**. Both producers here need parameters (`colors`/`hueShift`/`quality`/`widthMM`; `font`/`fontSize`/`text`). Either the source is constructed with its params closed over, or `ShapeSource` grows a param slot, or params live in `InlayItemSchema` (`src/types/schemas.ts:19-46`) and the source reads them. The schema route has a known trap: that schema has **no `.default()` on any field** and would throw under `getDefaults` (`src/utils/schemaDefaults.ts:6-12`).
*Settles it:* doc 02 landing. Until then, §4.1/§4.2 ship as plain exported functions with explicit options objects, which adapt to any of the three.

**Q4 — Is a worker route for tracing worth the five-edit cost?**
Recon lists it as available and notes `loadDownsampledImage` already produces a standalone transferable buffer for exactly this (`src/utils/imageUtils.ts:23-24`), so no `OffscreenCanvas` is needed. But root rule 5 prices a third job kind at five edits across a closed union (`src/workers/geometryWorker.ts:21-24`; `src/utils/geometry/patternClient.ts:17`, `:31-32`, `:63`, `:97-105`), and a polygon-only kind must be handled **above** `await getManifold()` at `geometryWorker.ts:35` or it pays the 541,470-byte wasm compile for nothing.
*Settles it:* measure. Time `traceImage` at `COMMIT_TRACE = 1400` on a photographic source at `colors: 12` (the worst case, `MAX_COLORS` at `src/utils/image/traceImage.ts:53`). If it stays under the 150 ms debounce budget the app already assumes (`src/components/DebouncedInput.tsx:9-18`), keep it on the main thread.

**Q5 — Should the `'shapes'` asset replace the raw source file for *uploaded* shapes too?**
It would make the zip self-describing and remove the import-time re-parse, at the cost of size and of losing the original bytes. Recon §7 Q3 measured a real outline at 4761 flattened contour points against a 21.7 KB source DXF — the point list is several times larger as JSON, and that argument applies here.
*Settles it:* zip one real 13-shape SVG inlay both ways and compare bytes. Default to "generated shapes only" unless the measurement surprises.

**Q6 — What unit should the extracted text module use?**
Today's `fontSize` is opentype path units mislabelled `mm` (E1), rescued downstream by `calculateInlayScale`. Root rule 1 says a source with its own unit system must convert itself — which argues for true millimetres and a bypassed auto-scale. But the auto-scale bypass is doc 02's mechanism (`src/components/controls/GeometryControls.tsx:132-136`), and inlays additionally auto-scale to 80% coverage (`src/utils/patternUtils.ts:1003`), so "true mm" is only true until something rescales it.
*Settles it:* doc 02's decision on the auto-scale gate. Until then, keep em-relative units, **fix the `mm` label at `src/components/SVGPaintModal.tsx:1063`**, and document the unit in the module docblock. Changing the number's meaning silently would resize every existing user's text.
