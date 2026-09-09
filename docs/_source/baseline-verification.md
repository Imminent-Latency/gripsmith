# Baseline verification — upstream as received

Snapshot: `techfoundrynz/grippysheet-studio` @ `master`, pushed 2026-08-24, obtained as a
GitHub tarball (no git history in the working copy). Verified 2026-09-02 on
node v26.5.0 / pnpm 10.20.0 / darwin arm64.

This file records what upstream does **before any GripSmith change**, so "the upstream flow
still works" (00-architecture §7) is a checkable statement rather than an assumption.

## Install

`pnpm install` — clean, exit 0. 40 top-level packages in `node_modules`.

## Test suite — GREEN

`pnpm test` (`vitest run`): **21 files, 162 tests, all passing**, 4.54s.

| Suite | Tests |
|---|---|
| `src/utils/patternUtils.test.ts` | 33 |
| `src/utils/geometry/patternPipeline.test.ts` | 15 |
| `src/utils/geometry/normals.test.ts` | 8 |
| `src/utils/colorUtils.test.ts` | 8 |
| `src/utils/geometry/inlayLayering.test.ts` | 7 |
| `src/utils/fileTypeSniffer.test.ts` | 6 |
| `src/utils/eventBus.test.ts` | 6 |
| `src/utils/projectUtils.test.ts` | 5 |
| `src/utils/geometry/inlayPipeline.test.ts` | 5 |
| `src/utils/schemaDefaults.test.ts` | 4 |
| `src/utils/cn.test.ts` | 4 |
| `src/context/AlertContext.test.tsx` | 4 |
| `src/components/DebouncedInput.test.tsx` | 3 |
| `src/utils/geometry/applyPatternResult.test.ts` | 3 |
| `src/components/Spinner.test.tsx` | 2 |
| `src/utils/delay.test.ts` | 1 |
| (+ `exportMerge`, `manifoldCache`, `offsetUtils`, `dxfUtils`, `geometry/*` remainder) | — |

Notable: `patternPipeline.test.ts` and `inlayPipeline.test.ts` pass, so **Manifold wasm runs
under the Vitest/jsdom environment**. A determinism regression test for seeded generation is
therefore feasible without a browser harness.

## Typecheck — 18 PRE-EXISTING ERRORS

There is **no `typecheck` script**, and `build` is `vite build` with no `tsc` step
(`package.json:9`), so these never surface in the project's own workflow.

`npx tsc -p tsconfig.app.json --noEmit` reports 18 errors (12 × TS6133, 1 × TS6192, 4 × TS2304, 1 × TS2322 — re-counted 2026-09-04; an earlier revision of this file said 19, which was a miscount):

- **13 × TS6133/TS6192 unused locals/imports** — `tsconfig.app.json` sets `noUnusedLocals`
  and `noUnusedParameters`. Files: `Controls.tsx:10,11`, `DXFThumbnail.tsx:1,12`,
  `InlayInteractionHandles.tsx:104,279`, `ModelViewer.tsx:14,89`, `ScreenshotModal.tsx:2`,
  `STLThumbnail.tsx:1`, plus `React` unused in three test files.
- **4 × test-config errors** — `tsconfig.app.json` `include: ["src"]` pulls in `*.test.ts`
  without vitest globals: `Cannot find name 'vi'` (`patternUtils.test.ts:130`),
  `Cannot find name 'global'` (`projectUtils.test.ts:22,23,56`).
- **1 × real type error in the export path** — `OutputPanel.tsx:125`:
  `DataView<ArrayBufferLike>` not assignable to `BlobPart` (`SharedArrayBuffer` not
  assignable to `ArrayBuffer`). This is on the 3MF/STL download path.

**Implication for GripSmith:** adding a `typecheck` gate inherits 18 failures on day one.
Either fix them in a separate upstream-offerable commit first, or scope the gate to new
directories only. Do not let a green typecheck become an implicit acceptance criterion
before this is resolved.

## Build

See `pnpm build` result appended below.

`pnpm build` (`vite build` v5.4.21) — **exit 0**, 5611 modules, 5.07s.

| Output | Size | Gzip |
|---|---|---|
| `dist/assets/index-*.js` | 1,850.77 kB | 531.65 kB |
| `dist/assets/manifold-*.wasm` | 541.47 kB | — |
| `dist/assets/geometryWorker-*.js` | 130.66 kB | — |
| `dist/assets/index-*.css` | 38.12 kB | 7.12 kB |

Warnings: main chunk exceeds the 500 kB budget (no `manualChunks` configured);
`manifold-3d` externalizes `node:module` for the browser (benign, builds fine).

**Bundle-budget implication:** the app already ships 531 kB gzipped of JS before we add
anything. `d3-delaunay`, `simplex-noise`, `d3-contour` and (if chosen) `leva` all land in
this same unsplit chunk. Generator code should be dynamically imported per generator.

## Two config findings that affect our plan

### 1. The GitHub Pages `base` path is not configured — and its comment is from another project

`vite.config.ts:15-16`:

```js
// Only needed if hosted without custom domain
// base: '/PubRemote/',
```

`base` is **commented out**, so the build emits absolute `/assets/...` URLs. But
`package.json:4` sets `"homepage": "https://techfoundrynz.github.io/grippysheet-studio"`,
a project page served from the `/grippysheet-studio/` subpath — and Vite does not read
`homepage`. As built, a `gh-pages` deploy resolves assets at the domain root and 404s,
unless upstream serves it from a custom domain.

The stale value `'/PubRemote/'` is a leftover from techfoundrynz's PubRemote project — the
same origin as the ESP32 firmware types sitting in `src/types.ts`. This repo was scaffolded
from that one.

**Implication:** GripSmith's own deploy must set `base` correctly, and any runtime `fetch()`
of a bundled pad outline from `public/` must go through Vite's `BASE_URL`, never a
root-absolute path. This is a hard requirement on the pad-outline library (doc 01), not a
detail — getting it wrong makes built-in pads work in `dev` and 404 in production.

### 2. The React Compiler is on

`vite.config.ts:8-12` enables `babel-plugin-react-compiler` with `target: "19"`. New
component code must obey the rules of React strictly — no mutating props/state, no
conditional hooks — or the compiler will bail out or misbehave silently.

### 3. Vitest config and coverage scope

Vitest is configured inside `vite.config.ts:24-38`: `globals: true`, `environment: 'jsdom'`.
Coverage `include` is limited to `src/utils/**`, `src/context/**`, and exactly two
components (`DebouncedInput`, `Spinner`) — components are deliberately outside the coverage
scope. New geometry/generator code belongs under `src/utils/**` to be counted.

`define.__BUILD_TIMESTAMP__` is stamped with `Date.now()` at build time — a (harmless)
build-level nondeterminism, but worth knowing when reasoning about reproducibility.
