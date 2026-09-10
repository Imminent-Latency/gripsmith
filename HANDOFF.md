# GripSmith — Handoff

*Written 2026-09-04 against branch `gripsmith` @ `cf698036f28f86e4d70c00b24a2283b5ab7d3f49`; revised 2026-09-10 against
`4b1d978`, four docs-only commits ahead of that upstream tip. `CLAUDE.md` (Claude Code) and `AGENTS.md` (Codex) at the
repo root are the same operating guide — keep them in sync.*

## What this project is

GripSmith is a fork of [`techfoundrynz/grippysheet-studio`](https://github.com/techfoundrynz/grippysheet-studio)
@ `master` (`cf698036f28f86e4d70c00b24a2283b5ab7d3f49`), on branch **`gripsmith`**. Upstream is a
client-side browser studio for onewheel/EUC grip pads: import a pad outline as DXF, extrude it, stamp an
uploaded STL "pattern unit" across it with a 13-parameter boundary-aware placement engine
(`src/utils/patternUtils.ts:285-299`), clip the result with 3D booleans inside a Web Worker, preview in
three.js, export STL and 3MF. It is React 19 + Vite + Tailwind + manifold-3d wasm, deployed to GitHub Pages.

The fork turns that manual editor into a **procedural grip design studio**. It adds three things on top of
the existing pipeline, and rewrites none of it: **shape synthesis** (Voronoi, noise-contour, truchet/Wang and
L-system generators that emit 2D polygons into the pattern slot instead of an uploaded mesh),
**reproducibility** (a real PRNG and a persisted seed — today there are three bare `Math.random()` calls
behind two already-persisted enum values, so a saved design already re-renders differently on every load),
and a **second physical output**. The two physical outputs are: a 3D-printable mesh (STL/3MF — already
shipping, untouched) and **flat closed cut paths as an SVG document plus an R12 DXF**, for riders who cut
vinyl or laser grip tape instead of printing it. Everything stays client-side.

## Where things stand right now

**No implementation has started.** `src/` is untouched — `git diff upstream/master -- src/` is empty, byte
for byte, and **tracked** (`git ls-files src/` → 86 files; **167** tracked in total: upstream's 150 plus this
project's 17 guide and doc files). **No code of this plan is committed**, but the upstream history is fully
present: branch `gripsmith` is at `4b1d978`, four docs-only commits (`484c623`…`4b1d978`) ahead of
`upstream/master` (`cf698036f28f86e4d70c00b24a2283b5ab7d3f49`), and `git rev-list --count HEAD` is **82**.
The fork's first divergence is therefore the docs commit `484c623`; P0 commit 1 is its first *plan* commit.
`git status --short` is clean apart from an untracked `.cursor/` (editor state — never stage it).

**The design phase is complete and verified.** Concretely, "verified" means:

- **A 13-dimension audit of `src/`** (12,208 non-test lines / 21 test files, per `_source/00-recon-report.md:4`;
  a plain `.ts`+`.tsx` re-count today gives 12,177 — the difference is counting method, not drift):
  geometry-contract, pipeline-seam,
  outline-path, existing-generative, state-and-serialization, determinism-seeding, export-3d, export-flat-gap,
  text-image-sources, workers-performance, ui-controls, direct-editing, build-test-deploy-license. Each read
  the code first-hand (`docs/_source/00-recon-report.md:5`).
- **Adversarial re-verification.** Every dimension was re-run by an independent second pass that overturned or
  sharpened claims; a cross-dimension consistency pass resolved the **12** places where dimensions contradicted
  each other; four targeted follow-ups closed the gaps the first sweep left.
- **Every claim carries `file:line`.** Across `docs/*.md` — the nine design docs plus `README.md` and
  `IMPLEMENTATION-PLAN.md` — **1,489 citation occurrences, 578 distinct `file:line` pairs, across 72 distinct
  source files** (re-counted 2026-09-10; the drift from the original 1,482 / 580 is in the plan and README, not
  the design docs). Restricted to the nine design docs alone (`docs/0*.md`): 1,383 / 568 / 72. Re-derive with:
  `grep -ohE '\b(src|public|node_modules)/[A-Za-z0-9_./-]+\.(ts|tsx|js|json|dxf|svg|wasm)(\.d\.ts)?:[0-9]+' docs/*.md | sort -u | wc -l`   # 578 distinct pairs
  `… | sed 's/:[0-9]*$//' | sort -u | wc -l`   # 72 distinct files
- **The audit corrected the design doc, not the reverse.** Revision 1 of the architecture doc named the dead
  dependency `clipper-lib` as the join point for all shape sources four times, had the pipeline stage order
  backwards, omitted the worker boundary entirely, and scoped three already-solved problems as new work.
  Revision 2 was rewritten against the code; revision 1 is preserved at
  `docs/_source/00-architecture.original.md` and must not be cited.
- **The baseline was measured, not assumed** (`docs/_source/baseline-verification.md`).
- **The evidence base has known errata**, corrected at the top of `docs/_source/00-recon-report.md` — three
  superseded figures plus one citation slip. **Read that errata block before trusting anything in that file.**
- **The plan itself was written after the review, not before it.** The sequencing agent that was to order
  these tasks exceeded its output limit and returned nothing; the three reviewers who ran next were reviewing
  **that empty output**, not a plan (`docs/IMPLEMENTATION-PLAN.md` appendix, first row: *"All three reviewers
  were reviewing an absent plan and correctly declined to fabricate one. This document is the missing
  artefact."*). The plan on disk was written afterwards by an agent reading the docs directly. Its
  §"Appendix: review findings not applied" records how those reviewers' **pre-plan** hazards were re-verified
  against the tree and folded in — it is **not** evidence that anyone read the sequence.
  A later pass **did** review the plan against the code and its findings are applied; it corrected several
  Verify cells that could not go green, two missing dependency edges, one false one, a file declared "new"
  twice, and the concurrency claims. **Treat each commit row as checked once, not proven: read the doc
  section it cites before implementing it, and confirm its Verify cell actually runs.**

**Verified baseline — do not re-derive, do not contradict:**

| Gate | Command | Result |
|---|---|---|
| Tests | `pnpm test` | **21 files / 162 tests, all passing**, ~4.5 s. Manifold wasm **runs** under Vitest/jsdom. |
| Build | `pnpm build` | **exit 0.** 1,850.77 kB JS / 531.65 kB gzip in **one unsplit chunk**; `manifold-*.wasm` 541.47 kB; `geometryWorker-*.js` 130.66 kB; `index-*.css` 38.12 kB. |
| Lint | `pnpm lint` | exit 0 with **42 warnings, 0 errors**. No rule written *literally* in `eslint.config.js:20-38` is `'error'`, and **two are `'off'`, not `'warn'`** — `@typescript-eslint/no-explicit-any` (`:26`) and `no-empty` (`:38`), so `any` and empty blocks produce no signal at all. **But lint CAN fail:** `:10` extends `js.configs.recommended` (61 error-severity rules) and `:21` spreads `reactHooks.configs.recommended.rules`, which sets `react-hooks/rules-of-hooks: 'error'`. Treat the warning count as drift; treat a **non-zero exit** as real. |
| Typecheck | `npx tsc -p tsconfig.app.json --noEmit` | **18 pre-existing errors** (12 × TS6133, 1 × TS6192, 4 × TS2304, 1 × TS2322). There is **no** `typecheck` script and `"build": "vite build"` (`package.json:9`) does **not** typecheck. |

Phase P0 deletes `src/utils/offsetUtils.test.ts` (7 tests), so from P0 commit 3 onward the suite is
**20 files / 155 tests**. That is the expected drop, not a regression.

## Repo state

- **Branch:** `gripsmith` (checked out). Also `master` locally, at the same commit, and `remotes/upstream/master`.
- **Remotes:** `upstream` → `https://github.com/techfoundrynz/grippysheet-studio.git` (fetch + push).
  **There is no `origin`.** The user will add it. `pnpm deploy:gh` (`package.json:12` → `gh-pages -d dist`)
  fails until one exists — P0 commit 4 owns adding it.
- **`git status --short`** → clean apart from `?? .cursor/` (editor state — never stage it). 167 tracked files:
  upstream's 150 plus `CLAUDE.md`, `AGENTS.md`, `HANDOFF.md` and `docs/`, committed in `484c623`…`4b1d978`
  (the plan's row for P0 commit 1 predates those commits; it does not need to take them). **Stage explicitly —
  never `git add -A`.**
- **Working tree = upstream `master` exactly for everything under `src/`, `public/` and the tool config, plus
  the committed guides and docs.** `dist/` and `node_modules/` exist locally and are gitignored.
- **Git identity is configured locally** (2026-09-08): `git config user.name` / `user.email` in this repo
  resolve `git var GIT_AUTHOR_IDENT` → `Liam Thompson <liamstar@gmail.com>`. Worktrees inherit it; the
  **global** config is still unset, so any other clone needs its own. Confirm with `git var GIT_AUTHOR_IDENT`
  before the first commit in any tree. With it unset **git will NOT refuse: it silently guesses**
  `<user>@<hostname>.local`, **no gate in the plan inspects authorship**, and the only fix afterwards is a
  history rewrite.
- Upstream history **is** present and `git` works. The recon report's standing caveat that "git itself is
  unavailable in the audit environment" describes the audit environment, not this one; it is stale here.

## The document set

Read in this order. Everything lives under `/Users/ldev/workspaces/imminentlatency/gripsmith/docs/`.

| # | Doc | One line | Status / milestone |
|---|---|---|---|
| — | [`README.md`](docs/README.md) | Index plus the blocking graph (mermaid). Start of the map. | — |
| **00** | [`00-architecture.md`](docs/00-architecture.md) | **The root, and the only binding doc.** Five contracts (§5.1), six rules (§5.2), the real pipeline (§4.2), cross-cutting concerns (§7), milestones M0–M5 (§8), the §10 doc-derivation rules and their adopted read-only-contour-channel amendment, project-level open questions (§11). | Living / source-of-truth (rev 2). **Wins any conflict until amended.** |
| 01 | [`01-pad-outline-library.md`](docs/01-pad-outline-library.md) | Hardening for the **already-shipping** 17-preset outline picker: stable `PatternPreset.id`, persisted `outlineRef`, provenance + `NOTICE`, `import.meta.env.BASE_URL` safety, zero-shape-DXF failure surfacing, thumbnail parse cache. | Ready · **M1** · off the critical path |
| 02 | [`02-generator-engine.md`](docs/02-generator-engine.md) | Creates `ShapeSource` and `Generator<P>` + a lazy registry writing `THREE.Shape[]` into `patternShapes` — the first production caller of `buildJob`'s `kind:'shapes'` branch. Reuses the existing worker; adds no job kind. | **Unblocked by D1.** Its on-disk status line still reads "Draft — blocked" until P0 commit 2 rewrites it. · **M3** |
| 03 | [`03-generators.md`](docs/03-generators.md) | The four synthesis families — Voronoi, noise-contour, truchet/Wang, L-system — plus the vertex budget, the min-feature floor, and the tiler's missing cap. | Ready; **task 2 ungated by D2** · **M3** (Voronoi) + **M5** (rest) |
| 04 | [`04-parametric-controls.md`](docs/04-parametric-controls.md) | **Half A:** descriptor-driven `ParamField` + `Slider` over the existing native Tailwind layer, and the first accessibility baseline. **Half B:** `ProjectSchemaV2` with a *working* migration, JSON-clean geometry, and a URL share carrying references + scalars + seed. | Ready · **M5**. §4.3.1's inline `shapes.inlayShapes` block is **STRUCK by D3**; the rest ships. |
| 05 | [`05-direct-editing.md`](docs/05-direct-editing.md) | **05a:** inlay region addressing, 3D pick, durable region edits, three lossy paint-modal defects. **05b:** pattern node/region editing. | 05a buildable · **M5**. **05b deferred — recommend dropping.** §4.3 + tasks T5–T8 **STRUCK by D3**. |
| 06 | [`06-flat-export.md`](docs/06-flat-export.md) | The fork's second physical output. **06a** exports the pad outline (SVG + R12 DXF) **on the main thread — no worker, no core change** (`docs/06-flat-export.md:12`, `:423`, `:508`); **06b** exports the pattern footprint through a read-only worker contour channel. | 06a ready · **M4a**. 06b gated on M3 · **M4b**. Its §10 amendment is **adopted**. |
| 07 | [`07-text-image-sources.md`](docs/07-text-image-sources.md) | Wrap `traceImage` as a `ShapeSource`, extract the opentype producer out of the paint modal into `src/utils/text/`, self-host the 9 preset fonts, route both producers into the pattern lane, and close the persistence hole for shapes with no source file. | Draft · **M5**. Its §4.5 zip-asset mechanism is **the winner of D3**. |
| 08 | [`08-determinism-and-seeding.md`](docs/08-determinism-and-seeding.md) | The mulberry32 PRNG, `seed` on `GeometrySettingsSchema` + `InlayItemSchema` + `PatternJob`, and the tiler's 14th parameter. Removes the last three `Math.random()` calls. | Ready · **M2** · blocked by nothing |
| — | [`IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md) | **The execution order of record.** 126 commits across 12 phases (P0–P11), each with its files, its verify command and its commit message; the decisions of record (D1–D4 plus editorial D5); **20 cross-cutting rules**; the merge order and its twelve shared-file collision points (the table has 12 rows; the plan's prose says "ten" at `:375` and "eleven" at `:839`); risks; deferred work. Not a specification — a sequence. | Written 2026-09-04 |
| — | [`_source/00-recon-report.md`](docs/_source/00-recon-report.md) | **The verified evidence base.** §1 is the 12 findings that changed the plan; §2 is the exhaustive verdict table (the thing to grep); §3 is what the code actually does. **Read the errata block at the top.** | Ground truth. **Do not hand-edit.** |
| — | [`_source/baseline-verification.md`](docs/_source/baseline-verification.md) | Upstream's install / test / typecheck / build state as received, plus three config findings (`base` unset, React Compiler on, coverage allowlist). | Do not hand-edit. |
| — | [`_source/00-architecture.original.md`](docs/_source/00-architecture.original.md) | Revision 1, preserved. Its §1 Vision and §3 Goals survive; **most of its technical assertions were wrong. Do not cite it.** | Historical only. |

**Precedence, highest first:** the decisions of record (in `IMPLEMENTATION-PLAN.md`) → `00-architecture.md`
→ the feature doc → `IMPLEMENTATION-PLAN.md`. In other words: where the plan and a design doc disagree, the
design doc wins; where two design docs disagree, doc 00 wins; where doc 00 and a decision of record disagree,
the decision wins — it *is* the amendment, and P0 writes it into the doc.

## Start here

Do these three things, in this order, before anything else.

**1. Read the root doc.**

`$EDITOR` and `$VISUAL` are **unset** on this machine, so `$EDITOR <file>` expands to the bare filename and tries
to execute it (exit 126 "Permission denied" for a slash path, 127 "command not found" for a bare name). Read, don't edit:

```sh
export PATH="/opt/homebrew/bin:$PATH"
cd /Users/ldev/workspaces/imminentlatency/gripsmith
sed -n '1,571p'  docs/00-architecture.md          # whole file; then re-read §5 — sed -n '225,300p'
sed -n '1,60p'   docs/_source/00-recon-report.md  # at minimum the errata block and §1
```

**2. Read the plan.**

```sh
sed -n '1,394p'   docs/IMPLEMENTATION-PLAN.md     # decisions of record, 20 rules, critical path, merge order (:372)
sed -n '395,882p' docs/IMPLEMENTATION-PLAN.md     # the phases (from :395), risks, deferred, appendix — 882 lines total
```

Read, in this order: "The decisions of record", the **20 cross-cutting rules**, "Critical path and
parallel tracks", then the phase you are assigned. Every one of the 20 rules describes a failure that is
**silent** — that is why they are collected there instead of in a doc appendix.

**3. Make the first commit — P0, milestone M0. Nothing else may start first.**

```sh
CI=true pnpm install --frozen-lockfile  # CI=true is required in a non-TTY (agents, CI); ~1m40s to green in a fresh worktree
git var GIT_AUTHOR_IDENT               # must echo Liam Thompson <liamstar@gmail.com> (set locally 2026-09-08). In any
                                       # other clone set user.name/user.email FIRST — unset, git invents <user>@<host>.local
export PHASE=p0                        # per phase, per agent — wave 1 runs four agents concurrently
npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep 'error TS' \
  | sed -E 's/\(([0-9]+),([0-9]+)\)//' | sort > /tmp/tsc-before-$PHASE.txt    # 18 lines
```

P0 is four serial commits (`IMPLEMENTATION-PLAN.md` §P0): write D1's and D2's carve-outs into root §5.2,
amend root §5.1 for D5, and correct the M0 exit counts across the whole doc set; record D3 and strike the
**ten** blocking markers plus the two losing persistence mechanisms; delete the dead `clipper-lib` tree and
the PubRemote leftovers; delete `public/CNAME` and add an `origin` remote.

**P0 is strictly first and strictly serial.** The docs on disk still carry blocking markers that D1/D2/D3/D5
resolve — `docs/02-generator-engine.md:4`, `:55`, `:132`, `:255`, `:480`; `docs/03-generators.md:54`, `:175`,
`:621`, `:640`, `:672`; `docs/04-parametric-controls.md:296`; and `docs/05-direct-editing.md` §8 question 6.
**All ten are real — each was opened and confirmed.** Verify P0 commit 2 by re-reading each of the ten, not
by counting. An agent that starts P4 or P5 before P0 lands will read one of those and correctly halt. P0
exists to close that gap.

After P0, four phases run concurrently: **P1** (doc 08, seeding), **P2** (doc 01), **P3** (doc 06a, flat
export) and **P7** (doc 04 half A, **minus commit 81** — A-16 needs P4 commit 38 and must be held).
**They are near-independent, but they DO share files** — eight of them; see the plan's merge-order collision
table (`docs/IMPLEMENTATION-PLAN.md` §"Merge order"). Two pairs bite hardest: **P1 commit 9 and P2 commit 21
both append to `src/types/schemas.ts`** (merge P1 first — only P1 touches the `items` default literal), and
**P1 commit 12 and P3 commit 26 both edit `src/components/ImperativeModel.tsx`** — P1's insertions at
`:15-54` and `:60-96` sit *above* P3's `:183-202`/`:211-228` targets, so after P1 merges those ranges no
longer bound the `if (baseOutlineMirror)` blocks (four hits today — `:183`, `:200`, `:211`, `:226` — two inside
each cited range); **re-locate them by grep, never by line number.**
`vite.config.ts:30-35` is worse still — P2 commit 15 and P7 commit 82 append to the *same six lines*.
**Each agent works on its own branch off the P0 tip (`git checkout -b phase/P1 <P0-tip>`) or its own
`git worktree add` — never two agents in one working tree**, because every `git diff`-based Verify cell in
the plan assumes a tree holding only the current commit's changes. Merge by phase id ascending and re-run
the gate after each merge.

## What you must know before touching code

Ten traps. Every one of them fails **silently** — green tests and a green build are what most of these look
like. The full set of 20 is in `IMPLEMENTATION-PLAN.md` §"Cross-cutting rules".

1. **The dependency array is hand-maintained.** `src/components/ImperativeModel.tsx:897-903`. A new geometry
   setting omitted from it **never triggers regeneration**. This is already demonstrably broken upstream for
   the three `debugShow*Cutter` props, which `buildJob` reads at `:857-859` and the array omits. The setting
   reaches the array only after a **seven-hop chain**: schema → `App.tsx` → `Controls.tsx` → `ModelViewer`
   destructure (`:48-54`) → **`ModelViewer` JSX attribute (`:460-501`)** → `ImperativeModelProps` (`:15-54`
   + body `:60-96`) → `buildJob` (`:825-861`) → `PatternJob` (`patternPipeline.ts:51-82`) → the array. The
   JSX attribute is the step most often missed. Copy `rotationClamp` hop for hop.

2. **Every new field on the three settings schemas needs `.default()`.** `getDefaults` is `schema.parse({})`
   (`src/utils/schemaDefaults.ts:7`), called in three **top-level consts** (`:10-12`) that `src/App.tsx:9`
   imports. A field without a default is a **module-load-time throw** — the app and the test suite die
   together. Assert on `getDefaults(...)` directly; "tests pass" is not the criterion.
   **And the paired hole:** zod 4.2.0 does **not** validate inside a `.default([…])` array. A field required
   on `InlayItemSchema` but absent from the `items` default literal (`src/types/schemas.ts:51-63`) is
   `undefined` at runtime while the inferred type says it is present — no type error, no failing test.
   **Green is what that failure looks like.** Edit the literal in the same commit.

3. **The `DataCloneError` wedge — the highest-severity failure mode in the app.** `pump()` assigns
   `this.inFlight = next` (`src/utils/geometry/patternClient.ts:66`) **before** `postMessage` (`:67`), with no
   try/catch, after nulling the pending slot on the line above (`:65`). A non-cloneable value in a job throws
   out of the effect, and **every later submission returns at the `if (this.inFlight) return` guard (`:61`) —
   all geometry generation is permanently wedged for the session.** No timeout, no `terminate()`. The spinner
   sticks on (`src/components/ImperativeModel.tsx:811`, cleared only at `:880`/`:890`) with no console error,
   until reload. Never put a `THREE.Shape`, a class instance, a function or a `Date` in a job. Assert
   `structuredClone(job)` in a test for every commit that adds a job field.

4. **The pattern slot is STL-only today, so `kind:'shapes'` has never run in production.** The pattern
   uploader is gated `allowedTypes={["stl"]}` (`src/components/controls/GeometryControls.tsx:163`) and all 14
   pattern presets are `.stl`, so `buildJob` always takes the `kind:'geometry'` branch
   (`src/components/ImperativeModel.tsx:829-830`). The `kind:'shapes'` branch at `:832-836` and
   `patternPipeline.ts:47-49`, `:138-139` is implemented and unit-tested but has **no UI path**. A generator
   is its first production caller — treat that branch as new code under test, not as a proven path.

5. **Never reformat.** There is no Prettier and no EditorConfig; indentation is mixed across files and *within*
   `src/utils/geometry/patternPipeline.ts`. Reformatting destroys the upstream-mergeable diff that rule 6
   exists to protect.

6. **18 pre-existing `tsc` errors, and neither gate catches a type regression.** `vite build` strips types with
   esbuild and never runs `tsc`; there is no `typecheck` script. **Gate on a `diff` against a captured error
   list, never on a count** — the count is 18 today and `baseline-verification.md` originally said 19. Capture
   `/tmp/tsc-before-$PHASE.txt` once per phase (per agent — wave 1 runs four) and diff after every commit,
   **with `(line,col)` stripped from both sides**, or a commit that inserts a line above a pre-existing
   error false-fails.

7. **The pipeline is extrude → compose → clip, and the clip is conditional.**
   `Manifold.extrude(cs, 1)` at `src/utils/geometry/patternPipeline.ts:139`, `Manifold.compose(instances)` at
   `:236`, `result.intersect(cutter)` at `:269`, `result.subtract(holeM)` at `:286`, gated on `clipToOutline`
   at `:218`. **Nothing forks in 2D anywhere.** Revision 1's diagram had this backwards; do not design against
   a 2D clip stage that does not exist.

8. **Centering is a bounding-box midpoint, not a centroid.** Nothing in the repo computes a centroid — the
   only repo-wide hit is the *incorrect comment* at `src/components/ImperativeModel.tsx:478`. There are four
   separate bbox-midpoint implementations (`src/utils/dxfUtils.ts:203-211` subtracted at `:379-382`;
   `centerShapes` at `src/utils/patternUtils.ts:942-952`; the Manifold recentre at `patternPipeline.ts:143-149`;
   `geometry.center()` at `src/utils/shapeLoader.ts:34-35`), and the DXF one measures only segment start/end
   points, so a `CIRCLE` contributes one point twice. **The origin cannot be re-derived downstream.** A doc
   needing a stable origin must define one, not inherit one.

9. **`clipper-lib` is dead code and gets deleted in M0.** Imported at exactly one site,
   `src/utils/offsetUtils.ts:2`; that module's two exports are imported only by its own test. The live 2D
   engine is manifold-3d's `CrossSection` — Clipper2 compiled into the wasm — entered at
   `src/utils/geometry/manifoldOps.ts:85`, `:91`, with the codebase's only polygon offset at `:151`.
   **Never gate on a bare `grep -rni clipper`: it cannot go green.** Two *correct* Clipper2 references survive
   (`patternPipeline.ts:11`, `manifoldCache.test.ts:164`). The gate is
   `grep -rn "clipper-lib\|ClipperLib\|ClipperOffset" src/ package.json`. Also do not confuse it with the
   unrelated local `offsetShapesFor` at `src/components/controls/InlayControls.tsx:30`.

10. **Winding is inconsistent by source and load-bearing at two import boundaries.** DXF outers are CCW
    (`src/utils/dxfUtils.ts:392-397`); SVG outers are CW; **holes are never rewound.** It is irrelevant at the
    CSG boundary (everything is `'EvenOdd'`) and re-derived by `ExtrudeGeometry` — but
    `ShapePath.toShapes(isCCW)` for every text glyph (`src/components/SVGPaintModal.tsx:48`, `:59`) and
    `SVGLoader.createShapes` under its default `nonzero` rule both infer hole nesting from it, so a ring
    emitted with the wrong winding **silently becomes a solid instead of a hole**. Root §7
    (`docs/00-architecture.md:324`). Doc 06a's `enforceWinding` (P3 commit 27) is the **only** place this is
    normalised — do not assume any other lane has. It bites P3 and P9 hardest, both early phases.

## Decisions already made

D1–D4 resolved **2026-09-04** by @liamstar. The full rationale for each is in
`docs/IMPLEMENTATION-PLAN.md` §"The decisions of record". The docs themselves still carry them as open
questions until **P0 commits 1 and 2** land.

**`docs/README.md`'s four "Decisions outstanding" are NOT the same four.** Its rows 1–3 are D1, D2 and D3;
its **row 4** (`docs/README.md:107`) is *"Two smaller doc-02 divergences from root §5.1: where `ShapeSource`
lives, and whether 'generalise `generateTilePositions`' is the right wording"*, gated "wording only; no code
is blocked" — and **D4 (doc 08 stays separate) appears nowhere in README.** The plan resolves README row 4
as **D5, an editorial amendment of root §5.1, explicitly not attributed to @liamstar**; see the open-questions
list below. **P0 commit 2 must not date row 4 to him.**

- **D1 — root §5.2 rule 5, main-thread generation carve-out: ADOPTED.** Generation runs on the main thread in
  doc 02 §4.1's null-rendering `GeneratorRunner`. **No fourth worker message kind, no second worker.**
  Reversible per-generator if any `generate()` exceeds **50 ms** at its documented maximum complexity.
  Unblocks doc 02 task 1, therefore all of M3.
- **D2 — root §5.2 rule 2, narrow `insetConvex` carve-out: ADOPTED.** A convex-only, generator-internal inward
  offset, used **solely** to open gaps between Voronoi cells, confined to `src/utils/generators/poly.ts`.
  Not a general-purpose offset/clip utility, never exported, never applied to non-convex input, never applied
  to pipeline output. Unblocks doc 03 task 2.
- **D3 — persistence for source-less geometry: doc 07 §4.5's synthetic `<name>.shapes.json` zip asset SHIPS.**
  Doc 04 §4.3.1's `shapes.inlayShapes` block and doc 05 §4.3's `InlayItemSchema.editedShapes` are **struck**.
  `SerializedShapeSchema` is declared **exactly once**, in `src/types/schemas.ts` (doc 04 task B-1 owns it);
  docs 05 and 07 import it. `ProjectSchemaV2` still ships — only its inline-geometry block is struck.
  **Hard prerequisite:** doc 07 E12's `fileTypeSniffer` fix must land **before** doc 07 tasks 14, 15 and 19 —
  `detectAssetType` is typed `'stl' | 'dxf' | 'svg'` (`src/utils/fileTypeSniffer.ts:3`) and a `.json` entry
  matches no branch, so it falls to the unconditional `return 'dxf'` at `:39` and is silently handed to the
  DXF parser. Consequence adopted with it: because `ProjectAssets.inlays` is `Record<string, Asset>` — one
  slot per inlay id (`src/utils/projectUtils.ts:22`, `:69-73`, `:165`) — **edited geometry supersedes the
  source asset**, and the original file is intentionally not retained across a round trip.
- **D4 — doc 08 stays a separate doc.** No merge into 02 or 00. It owns the PRNG, both schema `seed` fields,
  `PatternJob.seed` and the tiler's 14th parameter. Nothing else declares a seed.

## Open questions that still need the human

Short and honest. None of these blocks P0–P5.

**Already resolved, listed so you do not reopen them:** doc 06b's root **§10 read-only contour channel
amendment is ADOPTED** (2026-09-03) and is already written into `docs/00-architecture.md` §10 with all five
conditions. 06b remains *sequenced* behind M3 — it needs a 2D pattern unit worth projecting — but it is not
waiting on a person.

**Before any deploy — mechanical, owned by P0 commit 4:** `public/CNAME` contains `studio.grippysheet.com`,
the upstream author's domain, and `gh-pages -d dist` copies `public/` into the published branch — **delete
it**. And **add an `origin` remote**; only `upstream` exists today, so `pnpm deploy:gh` fails — the fork URL
is not derivable from the tree, so P0 commit 4 has to ask for it. Do **not** set
`base` in `vite.config.ts` (commented out at **`vite.config.ts:16-17`**, with a stale `'/PubRemote/'` value
from another project) until P2's `src/utils/assetUrl.ts` lands — flipping it early 404s all 8 root-absolute
`public/` fetches. **P2 commit 18 both lands the helper and sets `base`; no other commit does.**
(Root `00-architecture.md:366` still cites the stale range `:15-16`; P0 commit 1 corrects it.)

**Genuinely open, needing @liamstar:**

- **Where `ShapeSource` lives — root §5.1 vs doc 02 §4.2** (and the paired `generateTilePositions` wording).
  Root `00-architecture.md:251` says *"Define it beside `src/utils/shapeLoader.ts:12`."*;
  `docs/02-generator-engine.md:132` places it in `src/utils/generators/types.ts` and ends *"Root §5.1 wins
  until amended — amend it or overrule this, at @liamstar's call."* The second divergence is at
  `docs/02-generator-engine.md:55`. This is **`docs/README.md`'s decision 4** and it is **NOT** the plan's D4.
  README gates it "wording only; no code is blocked", and the plan agrees — but the plan has already
  committed to doc 02's placement (P4 commit 33 creates `src/utils/generators/types.ts` and all of P5 assumes
  it), so it resolves the divergence **editorially as D5**: amend root §5.1 to match, in P0 commit 1.
  `src/utils/generators/` stays inside the coverage allowlist (`vite.config.ts:30-35`) and keeps the framework
  in one new folder per rule 6. **If you want it beside `shapeLoader.ts` instead, say so before P4 starts** —
  only the path in commit 33 and its importers change.
- **Licensing / redistribution.** The repo has **no** `LICENSE`, `COPYING`, `NOTICE`, `README` or `AUTHORS`;
  `package.json:3` carries only `"private": true`, which grants nothing. `public/` ships 13 inlay SVGs and 17
  outline DXFs with **zero** rights metadata. Personal use is fine; **before any public deploy or
  redistribution, get a license from the author (techfoundrynz) or ask permission.**
- **Doc 01 §8 Q1 — attribution for 8 of the 17 outlines.** They carry no `infoUrl`. Same conversation as the
  license question. Until then they ship marked `provenance: 'unverified'`.
- **Root §11 Q1 — does the pattern slot stay single-source?** A product call, not a missing capability: the
  app already ships both models on different tabs. Engineering recommendation is **yes, start single** — it
  matches the pipeline exactly and costs nothing.
- **Doc 01 §8 Q2 — should there be a default pad?** A fresh session starts on a synthesised `size`-square
  (300 mm default) rather than a real pad. One line either way; not blocking.
- **Doc 03 §8 Q1 — `MIN_CUT_FEATURE_MM = 1.0` is a placeholder, derived from nothing.** Settling it (doc 03
  task 15) means physically cutting a Voronoi coupon on vinyl at gap 0.8 / 1.0 / 1.5 mm and weeding it.
  **Human-blocked; no agent can do it**, and it is deliberately not scheduled.
- **Doc 03 §8 Q2 — expose the truchet shortcut as a one-click preset?** Product call, after seeing both
  rendered. Only safe after doc 03 task 9 (a `tileSpacing` preset that drives `fullWidth` to 0 hangs the worker).
- **The export readiness gate has no owner.** `OutputPanel` reads `meshRef` directly
  (`src/components/OutputPanel.tsx:78-80`) with **no readiness token**, so a 3MF exported while dragging emits
  a *different number of filament slots* (`mergeByColor` keys on `material.color.getHexString()` at `:153`).
  Root §7 calls it "a cross-cutting requirement, owned by no single doc." It is a real correctness bug and
  should become **doc 09**, not be smuggled into a phase.
- **The shared flattening tolerance** (doc 06 task 9 / doc 05 §8 Q4) is deferred pending a decision on the
  value, because it changes what *every* consumer sees. Until then P11 hardcodes one named constant in
  `shapeEdit.ts`. **Do not invent a second tolerance.**

## Environment

macOS (darwin 25.6.0, arm64). **node v26.5.0 · pnpm 10.20.0 · git 2.50.1 (Apple Git-155).**
Toolchain: Vite 5.4.21 · Vitest 2.1.9 · Tailwind 3.4.19 · zod 4.2.0 · React 19.2 **with the React Compiler on**
(`vite.config.ts:8-14`, `target: "19"` — obey the rules of React strictly or it bails out silently).
Units are millimetres in three.js scene units at 1 unit = 1 mm.

**Every command needs Homebrew on `PATH` — required for `pnpm`, `node` and `npx`** (`git` is Apple Git at
`/usr/bin/git` and resolves without it; there is no `/opt/homebrew/bin/git`)**:**

```sh
export PATH="/opt/homebrew/bin:$PATH"
cd /Users/ldev/workspaces/imminentlatency/gripsmith
```

```sh
pnpm install                                    # clean, exit 0 (non-TTY: CI=true pnpm install --frozen-lockfile)
pnpm dev                                        # vite dev server
pnpm test                                       # vitest run — 21 files / 162 tests today
pnpm build                                      # vite build — exit 0; does NOT typecheck
pnpm lint                                       # eslint . — exit 0, 42 warnings; a NON-ZERO exit is real
npx tsc -p tsconfig.app.json --noEmit           # 18 pre-existing errors; there is no `typecheck` script
```

The standard gate after every commit (`IMPLEMENTATION-PLAN.md` §"The standard gate — `GATE`"): `pnpm test`
green, `pnpm build` exit 0, `pnpm lint` exit 0, and the `tsc` error list **diffed** against
`/tmp/tsc-before-$PHASE.txt` captured once per phase. Gate on the diff, never on a count — and **strip
`(line,col)` from both sides** (`sed -E 's/\(([0-9]+),([0-9]+)\)//'`), or any commit inserting a line above a
pre-existing error false-fails. The `$PHASE` suffix matters: wave 1 runs four concurrent agents that would
otherwise clobber one shared `/tmp` file.

**Xcode license.** `git` on this machine is Apple Git and would not run until the Xcode license was accepted
(`sudo xcodebuild -license accept`). That has been done — `git --version` works — but if git suddenly starts
refusing every command after an OS or Xcode update, that is why.
