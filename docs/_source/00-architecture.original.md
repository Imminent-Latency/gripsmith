# GrippySheet Studio (Fork) — Architecture & Design Overview

**Doc ID:** 00-architecture
**Status:** Living / source-of-truth
**Owner:** @you
**Purpose:** The root design doc. Every feature doc (pad library, generator engine, controls, exports, etc.) is *derived* from this one and must conform to the contracts in §5. If a feature doc conflicts with this doc, this doc wins until amended.

---

## 1. Vision

Turn the forked `grippysheet-studio` from a manual grip editor into a **procedural grip design studio**: a rider picks (or uploads) their pad outline, generates a pattern — random, fractal, cellular, or hand-tuned — with live, reproducible parameters, and exports it either as a 3D-printable mesh or as flat cut paths for vinyl/laser grip tape.

The fork adds *shape sources* and *controls* on top of the existing pipeline. It does not rewrite the pipeline.

## 2. Problem Statement

Upstream already imports an outline, clips 2D shapes to it, extrudes to a printable solid, and previews in 3D. What's missing for our users:
1. No easy way to choose a pad — every session starts with a DXF upload.
2. No generative pattern source — shapes come only from traced images, text, or manual work.
3. No parametric/reproducible design model — a design can't be re-derived, tweaked by number, or shared.
4. No flat (2D) export path for riders who cut vinyl instead of printing.

## 3. Goals / Non-Goals

**Goals**
- Preserve the upstream pipeline and stay mergeable with it.
- Introduce a single, uniform **shape-source** abstraction (built-in pads, uploads, generators, text, images all flow through it).
- Make every design **reproducible and shareable** as data (`seed + params + outline`).
- Support **two physical outputs** from one design: 3D-printed grip and flat cut grip tape.
- Keep the whole thing client-side and deployable to GitHub Pages, like upstream.

**Non-Goals**
- No backend, accounts, or remote catalog.
- No new 3D slicing/printer control (export STL/3MF and stop there).
- No AI image generation in-app.
- No breaking changes to upstream export formats.

## 4. System Overview

### 4.1 Confirmed stack (do not change casually)
React 19 + TypeScript + Vite + Tailwind; pnpm; Vitest; deploy via `gh-pages`.
Key deps and their role:
- `dxf-parser` — import outline (board boundary).
- `clipper-lib` — 2D polygon clip + offset. **The universal join point for all shape sources.**
- `manifold-3d` — CSG → watertight printable solid.
- `three` / `@react-three/fiber` / `three-stdlib` / `three-3mf-exporter` — 3D preview + STL/3MF export.
- `imagetracerjs` — raster → vector shapes.
- `opentype.js` — text → vector outlines.
- `zod` — schema validation (use for all persisted design data).
- `jszip`, `lodash`, `react-colorful`, `lucide-react` — plumbing/UI.

Source layout: `src/{components,constants,context,types,utils,workers}` + `src/types.ts`.

### 4.2 The pipeline (existing, unchanged)

```
Outline (bounds)  ──►  Shape Source(s)  ──►  clipper-lib  ──►  ┬─► manifold-3d ─► 3D preview ─► STL/3MF
                                            (clip + offset)    └─► [NEW] flat SVG ─► SVG→DXF ─► cutter
```

Our work adds new **shape sources** on the left, new **controls** above them, and a **flat export branch** on the right. The middle (clipper → extrude) is inherited.

## 5. Core Contracts (authoritative — all child docs conform)

> Names below are provisional. Step 0 of every feature is **recon**: find the real equivalents in `src/types.ts` / `src/context` / `src/utils` and map to them. Never introduce a parallel geometry representation.

- **`Polygon` / path type** — the exact ring/path structure `clipper-lib` is fed today. All geometry in the app is expressed in this type, in **millimeters**, rings closed.
- **`Outline` (a.k.a. bounds)** — the active board boundary. Produced today by DXF upload; the pad library produces the *same* type. This is the clip boundary and the design bounds.
- **`ShapeSource`** — the uniform producer abstraction all inputs implement:
  ```ts
  interface ShapeSource {
    id: string;
    produce(ctx: { outline: Outline; seed: number }): Polygon[]; // mm, closed rings
  }
  ```
  Built-in pads set the `Outline`; generators/text/images are `ShapeSource`s whose output enters the existing clip stage.
- **`Generator<P>`** — a parametric `ShapeSource` with typed params and defaults (see generator doc). `produce` = `generate(params, seed, outline)`.
- **`DesignState`** — the single serializable description of a design; the unit of save/share/undo:
  ```ts
  interface DesignState {
    outlineRef: { kind: 'library' | 'custom'; id?: string };
    sources: Array<{ type: string; params: unknown; seed: number }>;
    // validated with zod; serializable to URL/JSON
  }
  ```

**Rules for all features**
1. Emit geometry only in the shared `Polygon` type, in mm, closed.
2. Feed the existing `clipper-lib` stage — never re-implement clipping/extrusion.
3. Anything a user can tune must live in `DesignState` and validate with `zod`.
4. Randomness is always seeded; same `DesignState` → identical output.
5. Heavy compute goes in `src/workers`.
6. Keep diffs upstream-mergeable; isolate new code in new folders where possible.

## 6. Derived Feature Docs (workstreams)

Each becomes its own doc, derived from this one:

1. **`01-pad-outline-library`** — built-in selectable pad outlines + keep upload. *Supplies `Outline`.* (Drafted.)
2. **`02-generator-engine`** — the `Generator<P>` framework, registry, and worker execution. *Supplies `ShapeSource`s.*
3. **`03-generators-*`** — concrete generators: Voronoi (`d3-delaunay`), noise-contour (`simplex-noise` + `d3-contour`), truchet/Wang tiles, L-system/fractal. One doc or one section each.
4. **`04-parametric-controls`** — param UI (`leva` or native Tailwind), seed control, `DesignState` serialization (URL/JSON share).
5. **`05-direct-editing`** — post-generation node/region edits reusing `clipper-lib` utils.
6. **`06-flat-export`** — 2D branch: `Polygon[]` → SVG → SVG→DXF for Silhouette/Cricut/laser (LightBurn).
7. **`07-text-image-sources`** — wrap existing `imagetracerjs` + `opentype.js` as `ShapeSource`s in the new model.

Suggested phasing: 01 → 02 → one generator in 03 (prove the seam end-to-end) → 04 → 06 → remaining 03 → 05 → 07.

## 7. Cross-Cutting Concerns

- **Geometry conventions:** mm everywhere; closed rings; centered on outline centroid (match the upload path exactly — verify in recon).
- **Performance:** generation + boolean ops off the main thread via `src/workers`; debounce param changes; cache by `DesignState` hash.
- **Physical accuracy:** never fabricate pad dimensions or stud specs. Source outlines from verified community files (KHAOS DXF outlines on Printables; pubparts.xyz) with attribution. Keep min-feature-size clamps so output stays printable/cuttable.
- **Testing:** Vitest. Every feature ships schema tests, a produce/round-trip test, and a regression test proving the upstream flow still works.
- **Upstream & licensing:** the repo currently has **no explicit license** (`"private": true` only blocks npm publish). Personal use is fine; before any public deploy/redistribution, get a license added by the author (techfoundrynz) or ask permission. Prefer small, isolated diffs so useful pieces can be offered back as PRs.
- **Accessibility/UX:** keyboard-navigable pickers; visible active-outline + active-source labels.

## 8. Milestones

- **M1 – Foundations:** shared types confirmed (recon), `ShapeSource`/`DesignState` in place, pad library (01) shipping one verified pad, upload still works.
- **M2 – First generative loop:** generator engine (02) + Voronoi (03) → clip → extrude → export, with seed + basic params.
- **M3 – Controls & sharing:** parametric UI + `DesignState` serialization (04).
- **M4 – Flat output:** SVG→DXF export branch (06).
- **M5 – Breadth:** more generators, direct editing, text/image sources (03/05/07).

## 9. Recon Checklist (Step 0 for every feature)

Before writing code, document and link to real code:
- [ ] The concrete `Polygon`/path type fed to `clipper-lib`.
- [ ] The `Outline`/bounds type and the context setter used after a DXF upload.
- [ ] The DXF normalization util (units, closing, centering).
- [ ] The current shape-input entry points (traced image, text) — to model `ShapeSource` after them.
- [ ] The clip → extrude → export call sites (to confirm they need no changes).

## 10. How to Derive a Feature Doc from This

Each child doc MUST include, in order:
1. **Header:** Doc ID (`NN-name`), status, owner, and a link back to `00-architecture`.
2. **Summary / Goals / Non-Goals** scoped to the feature.
3. **Contract mapping:** which §5 contracts it produces or consumes, using the *real* type names found in recon.
4. **Design:** data model, modules, file paths (new folders preferred).
5. **Integration point(s):** the single place it touches existing code.
6. **Edge cases, testing (Vitest), acceptance criteria.**
7. **Task order for Claude Code**, starting with the §9 recon.
8. **Open questions.**

A feature doc is complete when its acceptance criteria are self-contained, it names no invented geometry type, and it changes only shape sources / controls / export — never the clip/extrude core.

## 11. Open Questions (project-level)

1. Multiple simultaneous shape sources (layered), or one at a time to start?
2. `leva` for speed vs. native Tailwind controls for polish — which for M3?
3. Built-in pads as pre-parsed JSON vs. runtime DXF parse (repo size vs. reuse)?
4. Front/rear pads as separate outlines or one full-board outline per model?

## 12. Glossary

- **Outline / bounds** — the pad boundary used to clip designs and define extents.
- **Shape source** — anything that produces 2D polygons to be clipped (pad-agnostic).
- **Generator** — a parametric, seeded shape source.
- **DesignState** — the serializable description that fully reproduces a design.
