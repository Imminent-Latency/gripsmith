# GripSmith

Fork of `techfoundrynz/grippysheet-studio` on branch `gripsmith`: turns a manual grip-tape editor into a procedural
grip design studio — seeded 2D pattern synthesis, plus a flat vinyl/laser cut-path export beside the existing 3D print
export. New here? Read `HANDOFF.md`, then `docs/00-architecture.md`. `CLAUDE.md` is this file's mirror for Claude Code — keep the two in sync.

## Commands

Homebrew must be on `PATH` for `pnpm`/`node`/`npx` (`git` is Apple Git at `/usr/bin/git` and needs nothing):
`export PATH="/opt/homebrew/bin:$PATH"`, run from `/Users/ldev/workspaces/imminentlatency/gripsmith`.

| Task | Command | Today |
|---|---|---|
| Test | `pnpm test` | 21 files / 162 tests green (**20 / 155** once P0 deletes `offsetUtils.test.ts`) |
| Build | `pnpm build` | exit 0. **Does not typecheck.** |
| Typecheck | `npx tsc -p tsconfig.app.json --noEmit` | **18 pre-existing errors.** No `typecheck` script exists. |
| Lint | `pnpm lint` | exit 0 with 42 warnings, 0 errors — no rule at `eslint.config.js:20-38` is `'error'` and two are `'off'` (`no-explicit-any` `:26`, `no-empty` `:38`), so it is silent on `any` and empty blocks. **But it CAN fail:** `:10` extends `js.configs.recommended` (61 error rules) and `:21` spreads react-hooks, setting `rules-of-hooks: 'error'`. A **non-zero exit is real** |
| Dev | `pnpm dev` | Vite dev server |

**Gate after every commit:** tests green, build exit 0, **lint exit 0**, and the `tsc` error list **diffed** against a
`/tmp/tsc-before-$PHASE.txt` captured once per phase
(`… --noEmit 2>&1 | grep 'error TS' | sed -E 's/\(([0-9]+),([0-9]+)\)//' | sort`). **Gate on the diff, never the count** —
it is the only gate that catches a param declared and never bound. **Strip `(line,col)`** or any commit inserting a line
above a pre-existing error false-fails; **suffix the temp file with the phase** because wave 1 runs four agents at once.

## The specification is binding

- `docs/` is the specification, not notes. **`docs/00-architecture.md` is the root and wins any conflict** until amended;
  its §5.1 five contracts and §5.2 six rules bind every feature doc.
- `docs/01`…`docs/08` are the feature docs. `docs/IMPLEMENTATION-PLAN.md` is the **execution order** — 126 commits in 12
  phases, each with files, verify command and commit message; it is not a spec.
  **Precedence:** decisions of record → `00-architecture.md` → the feature doc → the plan.
- `docs/_source/` is the verified evidence base. **Never hand-edit it.** Read the errata block atop `00-recon-report.md`;
  never cite `_source/00-architecture.original.md` — most of it was wrong.
- **Read the doc section a task cites before implementing it.** Plan rows are pointers, not substitutes. Do not batch
  tasks; do not run ahead. If a doc is wrong, say so with evidence and stop — never silently deviate.
- Citations are against upstream `master` @ `cf698036f28f86e4d70c00b24a2283b5ab7d3f49`. **Line numbers drift the moment
  upstream moves — re-grep after any merge.** Prefer symbol greps over line numbers in new verify commands.

## Geometry conventions

- **Millimetres**, three.js scene units at 1 unit = 1 mm. Only DXF import normalises units (`src/utils/dxfUtils.ts:59-81`);
  a source with its own unit system converts itself.
- **Rings are implicitly closed** — never append a duplicate first point. **Minimum 3 vertices per ring:** `points.length
  < 6` is silently dropped at `src/utils/geometry/manifoldOps.ts:86` (also `:93`, `:132`), with no error and no signal any consumer reads.
- **Centering is a bounding-box midpoint, never a centroid.** Nothing computes a centroid; the only hit is the wrong
  comment at `src/components/ImperativeModel.tsx:478`. Four separate bbox implementations exist.
- **Curves flatten at `getPoints()`'s default 12 divisions** (`src/utils/geometry/serialize.ts:29-32`, `:36`) — emit polylines at the
  resolution you want. **Six live geometry representations** exist (root §5 table): know your layer, convert only at the
  existing seams (`serializeShapes` / `deserializeShapes`), and do not add a seventh.

## Pipeline

**extrude → compose → clip, inside the Web Worker** — `Manifold.extrude` (`src/utils/geometry/patternPipeline.ts:139`), `Manifold.compose`
(`:236`), `intersect`/`subtract` (`:269`, `:286`), clip gated on `clipToOutline` (`:218`). Nothing forks in 2D anywhere.
Main-thread geometry exceptions — **four, not one** (root §7, `docs/00-architecture.md:329`): the Base plate
(`ImperativeModel.tsx:447-451`, never booleaned), inlay **placeholder** extrusion (`:639`), inlay **tile placement** at 4
call sites (`:254`, reached from `:292`, `:368`, `:596`, `:697`), and per-job `serializeShapes` over the full outline
(`:836`, `:850-856`). P1 commit 13 and all of P11 operate on that main-thread geometry.

## Hard traps — every one fails silently

Full set of 20 in `docs/IMPLEMENTATION-PLAN.md` §"Cross-cutting rules". These bite first:
1. **Add every new geometry setting to the hand-maintained dep array** (`ImperativeModel.tsx:897-903`), and walk all seven
   hops to reach it: schema → `App` → `Controls` → `ModelViewer` destructure (`:48-54`) → **`ModelViewer` JSX attribute
   (`:460-501`, the step most often missed)** → `ImperativeModelProps` (`:15-54`, `:60-96`) → `buildJob` (`:825-861`) →
   `PatternJob`. Copy `rotationClamp` hop for hop.
2. **`.default()` on every new schema field.** `getDefaults` is `schema.parse({})` (`src/utils/schemaDefaults.ts:7`) in three
   top-level consts (`:10-12`) — a missing default is a module-load-time throw that kills app and suite together. Assert
   on `getDefaults(...)` **directly**, never "tests pass".
3. **zod 4.2.0 does not validate inside `.default([…])`.** A field required on `InlayItemSchema` but missing from the
   `items` literal (`src/types/schemas.ts:51-63`) is `undefined` at runtime with no type error. Edit the literal in the
   same commit. **Green is what this failure looks like.**
4. **Never put a non-cloneable value in a worker job.** `pump()` sets `inFlight` (`src/utils/geometry/patternClient.ts:66`) before
   `postMessage` (`:67`) with no try/catch; a `DataCloneError` **wedges all geometry generation for the session** at the
   `:61` guard — spinner stuck, no console error. No `THREE.Shape`, class instance, function or `Date`. Assert
   `structuredClone(job)` in a test.
5. **Worker failure is silent** — the catch posts an empty result that clears the spinner (`src/workers/geometryWorker.ts:34-50`) and
   `PatternResult.empty` is read by nobody. Surface failure through `AlertContext` (`src/context/AlertContext.tsx:20`).
6. **Track and flush every wasm object** (`manifoldOps.ts:49-72`; `finally { ops.flush() }` at `patternPipeline.ts:369-371`).
   Never cache one made in an unbounded per-shape loop — eviction `delete()`s it.
7. **`kind:'shapes'` has never run in production.** The pattern slot is STL-only (`src/components/controls/GeometryControls.tsx:163`), so
   `buildJob` always takes `kind:'geometry'` (`ImperativeModel.tsx:829-830`). Treat `:832-836` as new code under test.
8. **`patternScale` is auto-overwritten on load** by `calculateAutoPatternScale` (`GeometryControls.tsx:67-112`, written
   at `:132-136`) — mm-correct generated geometry gets silently rescaled.
9. **Rollup resolves dynamic `import()` at build time.** Every module path inside an `import()` must exist as of that same
   commit or `pnpm build` fails. `src/` has zero dynamic imports today.
10. **Append tiler parameters, never insert.** `generateTilePositions` has 13 positional params
    (`src/utils/patternUtils.ts:285-299`) across **15 call sites**; inserting silently rebinds arguments.
11. **`clipper-lib` is dead** (`src/utils/offsetUtils.ts:2`; that module is imported only by its own test) and is
    deleted by P0 commit 3 (M0); the live 2D engine is manifold-3d `CrossSection`. **Never gate on a bare
    `grep -rni clipper`** — two correct Clipper2 references survive (`patternPipeline.ts:11`,
    `src/utils/geometry/manifoldCache.test.ts:164`). Gate on
    `grep -rn "clipper-lib\|ClipperLib\|ClipperOffset" src/ package.json`.
12. **Coverage is allowlisted** to `src/utils/**`, `src/context/**` and two components (`vite.config.ts:30-35`). Put new
    geometry logic under `src/utils/**`; never widen the list to hide a 0%.
13. **Winding is inconsistent by source and load-bearing at two import boundaries.** DXF outers are CCW
    (`dxfUtils.ts:392-397`); SVG outers are CW; **holes are never rewound**. Irrelevant at the CSG boundary
    (all `'EvenOdd'`) and re-derived by `ExtrudeGeometry` — but `ShapePath.toShapes(isCCW)` for every text glyph
    (`src/components/SVGPaintModal.tsx:48`, `:59`) and `SVGLoader.createShapes` under its default `nonzero` rule both infer hole nesting
    from it, so a ring emitted with the wrong winding **silently becomes a solid instead of a hole**. Root §7
    (`00-architecture.md:324`). Doc 06a's `enforceWinding` (P3 commit 27) is the only place this is normalised.

## Commits

**One task = one commit**, and every commit leaves the tree shippable. Use the commit message written in the plan's row
(`type(scope): summary`, e.g. `feat(tiler): add seeded PRNG as the 14th parameter`). Run the gate first.
`git config user.name` / `user.email` are set **locally** in this repo (`Liam Thompson <liamstar@gmail.com>`; worktrees
inherit it, the global config is still unset) — **confirm with `git var GIT_AUTHOR_IDENT` before the first commit in any
tree.** With them unset git does not fail: it invents `<user>@<hostname>.local`, and no gate catches it. **Stage
explicitly (`git add <the row's paths>`) — never `git add -A`**: `CLAUDE.md`, `AGENTS.md`, `HANDOFF.md` and `docs/` are
tracked (`484c623`…`4b1d978`), and stray untracked files such as `.cursor/` must never ride along. There is no `origin`
remote yet — only `upstream` (`techfoundrynz/grippysheet-studio.git`), which must not be reused as `origin`; the user
adds it (P0 commit 4 asks). End every commit message with: `Co-Authored-By: Codex <noreply@openai.com>`

## Upstream mergeability

A real merge-base exists and pieces go back upstream as PRs, so **keep diffs small and reviewable**.
- **Never reformat.** No Prettier, no EditorConfig; indentation is mixed across files and within
  `patternPipeline.ts`; a reformat destroys the diff.
- Prefer new files and folders. Where a shared file must change (root §5.2 rule 6 lists them), budget a **single-line
  insertion**, not a refactor. The React Compiler is on (`vite.config.ts:8-14`) — obey the rules of React strictly or it
  bails out silently.
- Do not change the boolean semantics of the clip/extrude core (`patternPipeline.ts`, `manifoldOps.ts`,
  `geometryWorker.ts`). Root §10's read-only-contour-channel amendment is the one carve-out, with five conditions.

## Look it up, do not guess

What the code actually does → `docs/_source/00-recon-report.md` §2 (verdict table) and §3; grep it. Contracts → root §5.1.
Rules and their carve-outs → root §5.2. Your next commit and what verifies it → `docs/IMPLEMENTATION-PLAN.md` phase tables.
Why something was decided → that file's §"The decisions of record" (D1–D4 are @liamstar's; **D5 is editorial**, and is
`docs/README.md`'s row 4 — which is *not* D4); what is deliberately unbuilt → its §"Deferred and out of scope"; what
still needs a human → `HANDOFF.md`.

**Never invent a type or function name.** Every identifier in the docs not marked **(new — does not exist yet)** exists in
`src/` today and can be grepped. If you cannot grep it, it is new — say so.
