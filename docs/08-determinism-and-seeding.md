# Determinism and Seeding

**Doc ID:** `08-determinism-and-seeding`
**Status:** Ready to implement
**Owner:** @liamstar
**Parent:** [`./00-architecture.md`](./00-architecture.md) — this doc owns §5.2 **rule 4** and milestone **M2** (§8).
**Evidence base:** `docs/_source/00-recon-report.md` §1 finding 5, §2 (§5 rule 4 row), §3.6, §3.8, §4.2 rule 4, §6 M2. Recon is **DONE** (§9); every task below starts from those findings.

| | |
|---|---|
| **Milestone** | **M2 — Determinism.** First on the revised critical path (arch §6 "Revised phasing", §8). |
| **Blocked by** | **Nothing in code.** M0 (`00-architecture.md` §8, line 378) is doc edits plus **four** deletions — `src/utils/offsetUtils.ts`, `src/utils/offsetUtils.test.ts`, `src/types/clipper-lib.d.ts`, `src/types.ts` — plus the `package.json` drops of `clipper-lib`, `lodash`, `@types/lodash`, `@types/uuid`. It touches no file this doc edits. M2 can start today. |
| **Blocks** | §5.2 rule 4 · §3 goal 3 (reproducible + shareable) · §7's "cache by design hash" directive · doc 02/03 generator reproducibility · doc 04's seed control and URL share · any flat export that re-derives placement (arch §4.2 fact 2). |
| **Effort** | S–M. Ten commits, no new dependency, ~30 lines of new runtime code. |

**Numbering note — deliberate divergence.** Docs 01–07 run `1 Summary / 2 Goals-Non-Goals / 3 Contract mapping / 4 Design / …`. This doc merges Summary + Goals + Non-Goals into **§1** and inserts **§3 "The defect, precisely"** ahead of Design, so its numbers do not line up with its siblings. All eight elements required by `00-architecture.md` §10 (lines 490-497) are present, in order. **Cite sections of this doc by number *and* title** — "doc 08 §3" alone is ambiguous against "doc 01 §3".

> ### Read this before anything else
>
> **This is new work that changes shipped behaviour. It is not a property to preserve.**
>
> Two **already-persisted** enum values reach bare `Math.random()`. `GeometrySettingsSchema.tilingDistribution` admits `'random'` (`src/types/schemas.ts:79`) and `tilingOrientation` admits `'random'` (`:81`); `InlayItemSchema.tilingDistribution` admits `'random'` too (`:41`). All three are user-selectable today (`src/components/controls/GeometryControls.tsx:405`, `:456`; `src/components/controls/InlayControls.tsx:554`) and all three round-trip through `ProjectSchemaV1` (`src/types/schemas.ts:87-93`).
>
> **A saved bundle therefore already re-renders differently on every load.** Fixing that changes what existing users see. Revision 1 of the architecture doc scoped rule 4 as "preserve determinism"; there is no determinism to preserve.

---

## 1. Summary, Goals, Non-Goals

### Summary

Replace the three bare `Math.random()` calls in `generateTilePositions` with a seeded PRNG, persist the seed in the two schemas that own tiling, and thread it to the **two** placement sites — the worker path (via a new `PatternJob` field) and the main-thread inlay path. Ship the first reproducibility assertions in Vitest, using the Manifold-under-jsdom harness that already passes.

The parametric placement engine itself is not new work and must not be rewritten. `generateTilePositions` (`src/utils/patternUtils.ts:285-299`) is a 13-parameter, boundary/exclusion/mask/avoid-aware placer with 8 distributions × 4 orientations and a Y-bucketed spatial index (`:102-161`). This doc adds **one trailing parameter** to it.

### Goals

| # | Goal | Checkable as |
|---|---|---|
| G1 | No unseeded randomness in any geometry path | `grep -rn 'Math\.random' src --include='*.ts' --include='*.tsx' \| grep -v '\.test\.'` prints nothing |
| G2 | The same `(seed, params, input geometry)` triple produces the same `TileInstance[]`, in both threads | Vitest deep-equality on the tiler; tolerance comparison on `PatternResult.instanced.matrices` |
| G3 | Every existing call site keeps compiling with zero edits | The 14th parameter is trailing and defaulted, so **no** call site *has* to change. 12 of the 15 are in `patternUtils.test.ts`; §6.2 rewrites exactly one of them (`:332-345`) by choice, and `tileShapes` (`:834`) is not touched at all. **A3a** / **A3b** |
| G4 | Bundles saved before seeding still import, unmodified, with no version bump | `ProjectSchema.safeParse(oldProjectJson).success === true` and `.data.geometry.seed === 1` |
| G5 | `InlayJob` is unchanged | `git diff src/utils/geometry/inlayPipeline.ts` is empty |
| G6 | A fresh session and an imported project have the *same* seed values | `getDefaults(InlaySettingsSchema).items[0].seed === 1` (see §4.4 — this fails unless a specific literal is edited) |

### Non-Goals

- **No seed UI.** A "Seed" field and a "Randomize" button belong to doc 04 (`04-parametric-controls`; arch §6). Until then the seed is changeable only by hand-editing `project.json` inside a bundle. This is deliberate: shipping the plumbing and the control in one milestone couples an S-sized invariant to an L-sized renderer.
- **No version bump and no `ProjectSchemaV2`** **(new — does not exist yet, owned by doc 04)**. Verified absent: `grep -rn 'ProjectSchemaV2' src` returns nothing; root §6 marks it new at `docs/00-architecture.md:309`. See §4.5.
- **No design hash and no result cache.** Arch §7 records the directive and its missing precondition; the state still holds live `THREE` objects and a `Date.now()` timestamp (`src/types/schemas.ts:14`; `src/utils/projectUtils.ts:42`). This doc removes one blocker, not all of them.
- **No tile cap.** The uncapped-lattice hang (`src/utils/patternUtils.ts:478-479`, `:684-696`) is doc 03's, per arch §6. Seeding does not fix it — see §6, edge case 6.
- **No change to boolean semantics.** Arch §10's amendment permits a seed explicitly ("seeded values reach only `instanceMatrix` and `compose`, never a cache key"); §5 below verifies that in code.
- **No inlay-worker change.** `InlayJob` stays byte-identical; see §5.3.

---

## 2. Contract mapping (arch §5)

| §5 contract | This doc | Real name and location |
|---|---|---|
| **`Polygon`** | Neither produces nor consumes. The seed changes *where* geometry is placed, never its representation. `TileInstance` carries `{ position: THREE.Vector2; rotation: number; scale: number }` (`src/utils/patternUtils.ts:3-7`) and is not one of the six geometry representations. | — |
| **`Outline`** | **Consumes, read-only.** `generateTilePositions` receives `boundaryShapes` as already-split `filledTHREE` (`src/utils/geometry/patternPipeline.ts:186`). The inlay path passes `null` and tiles a `size`-square instead (`src/components/ImperativeModel.tsx:249-252`, `:259`) — unchanged by this doc. | `BaseSettings.cutoutShapes` — `src/types/schemas.ts:14` |
| **`ShapeSource`** | Neither. Seeding is downstream of every producer. Note the truthful signature has **no seed** (arch §5.1) — a generator that wants one reads it from `GeometrySettings`, it is not handed to `produce()`. | to be created by doc 02 |
| **`Generator<P>`** | **Produces a precondition.** `seed` becomes the first field on `GeometrySettingsSchema` that exists purely for reproducibility. Every generator param doc 02 adds follows the same `.default()` discipline and the same seven-hop chain (§5.2). | `GeometrySettingsSchema` — `src/types/schemas.ts:66-85` |
| **`DesignState`** | **Extends it.** Two new persisted fields on the real type, `ProjectSchemaV1` → `ProjectData` (`src/types/schemas.ts:87-96`). No new slot, no uniform `sources` array, no URL. | `ProjectSchemaV1` — `src/types/schemas.ts:87-93` |

### New names coined by this doc

Every name below is marked **(new — does not exist yet)** at first use. Verified absent: `grep -rniE "\b(seed|prng|mulberry|sfc32|xoshiro|splitmix|rng)\b" src --include='*.ts' --include='*.tsx'` returns **zero hits**.

```ts
// src/utils/random/prng.ts   (new — does not exist yet)

/** A 0..1 uniform draw. (new — does not exist yet) */
export type Rng = () => number;

/** mulberry32. Accepts any number; NaN and floats are coerced. (new — does not exist yet) */
export function makeRng(seed: number): Rng;

/** FNV-1a-style mixer so one persisted seed yields many independent streams. (new — does not exist yet) */
export function hashLabel(seed: number, label: string): number;

/** makeRng(hashLabel(seed, label)). (new — does not exist yet) */
export function rngFor(seed: number, label: string): Rng;

/** 1. (new — does not exist yet) */
export const DEFAULT_SEED: number;
```

Two new schema fields, both named `seed`, both **(new — does not exist yet)**: on `GeometrySettingsSchema` and on `InlayItemSchema`. One new job field, `PatternJob.seed` **(new — does not exist yet)**. One new prop, `ImperativeModelProps.seed` **(new — does not exist yet)**. **No other exported name.**

Two function-local names appear in §4.3 — `posRng` and `rotRng` **(new — do not exist yet)**. They are `const`s inside `generateTilePositions`, not exports; they are named here only so the §5.1 edit list can refer to them. One new fixture file, `src/utils/geometry/__fixtures__/grid-matrices.json` **(new — does not exist yet)**, is introduced by §6.2's additive-only guard.

---

## 3. The defect, precisely

### 3.1 The three `Math.random()` sites

All three are inside `generateTilePositions`. There are no others in `src/` — verified by `grep -rn "Math\.random" src/`.

| # | Site | Enclosing construct | Reached when | Consumed by |
|---|---|---|---|---|
| 1 | `src/utils/patternUtils.ts:464` | `getRotation` (`:463-475`) | `orientation === 'random'` | every distribution branch — `getRotation` is the shared rotation helper |
| 2 | `src/utils/patternUtils.ts:504` | dart-throw loop (`:502-535`) | `distribution === 'random'` | candidate X |
| 3 | `src/utils/patternUtils.ts:505` | dart-throw loop (`:502-535`) | `distribution === 'random'` | candidate Y |

### 3.2 Which thread reaches which site

| Path | Call site | `distribution` | `orientation` | Sites reachable |
|---|---|---|---|---|
| Pattern — **inside the worker** | `src/utils/geometry/patternPipeline.ts:184-190` | `job.tilingDistribution` | `job.tilingOrientation` | **1, 2, 3** |
| Inlay — **main thread** | `src/components/ImperativeModel.tsx:254-267` | `item.tilingDistribution \|\| 'grid'` (`:262`) | hardcoded `'none'` (`:263`) | **2, 3 only** |

Site 1 is unreachable from the inlay path because the argument is a literal. Do not "fix" that by widening the inlay UI — that is doc 04's call, and it is out of scope here.

### 3.3 Beyond reproducibility: a live, user-visible defect

`calculateItemPositions` (`src/components/ImperativeModel.tsx:240-275`) is a plain function with no memo, called **two to three times per item per effect run** — not per render. The two effects are the inlay effect (`src/components/ImperativeModel.tsx:504-742`, dependency array at `:742`) and the pattern effect (`:805-903`, dependency array at `:897-903`); each re-runs only when its own array changes.

| Call site | Purpose | Effect |
|---|---|---|
| `src/components/ImperativeModel.tsx:596` | positions for the inline **placeholder** meshes | inlay effect (`:504-742`) |
| `src/components/ImperativeModel.tsx:697` | `InlayJobItem.positions` sent to the **worker** | same effect, after the `needsCSG` gate at `:687-688` |
| `src/components/ImperativeModel.tsx:292` or `:368` | exclusion / mask shapes for the **pattern** job | pattern effect (`:805-903`), via `buildJob` — at most one of the two per item, because `InlayItemSchema.modifier` is a mutually exclusive enum (`src/types/schemas.ts:32`) |

With `mode: 'tile'` and `tilingDistribution: 'random'`, each call returns a **different scatter and a possibly different tile count** — the dart-throw loop's accept count depends on the whole draw sequence (`src/utils/patternUtils.ts:489-490`, `:502-535`). Observable consequences today, all reachable in normal use:

- The placeholder inlays **visibly re-scatter** when the worker result lands: `applyInlayResult` removes every mesh whose name starts with `Inlay_<id>_` and adds the worker's parts in their place (`src/utils/geometry/applyInlayResult.ts:29-38`, `:41-59`).
- A `modifier: 'cut'` tiled-random inlay carves the pattern at a **third** set of positions, matching neither the placeholder nor the final mesh.
- Where the worker's accept count is lower, some placeholders have no replacement and the layer silently loses tiles.

Seeding fixes all three as a side effect, because all calls then read the same `item.seed`. This defect is an amplification of recon §3 ("`calculateItemPositions` runs at most three times per item across two effects"); the report states the call count but not this consequence.

---

## 4. Design

### 4.1 PRNG choice — mulberry32

| Candidate | State | Seeding | Verdict |
|---|---|---|---|
| `Math.random()` | — | none | The defect. |
| **mulberry32** | 32-bit | one `uint32` | **Chosen.** |
| sfc32 | 128-bit | four `uint32`, needs an expander (splitmix32 / xmur3) | Rejected for now; documented upgrade path. |
| a library (`seedrandom`, `pure-rand`) | — | — | Rejected. |

Reasons, in order of weight:

1. **One number, one field.** mulberry32 takes a single `uint32`, which maps 1:1 onto a single persisted `z.number()`. sfc32 needs four words, so it needs a seed-expander, so the persisted artefact and the generator state stop being the same thing. That is two concepts where the design needs one — and doc 04 has to put this value in a URL.
2. **No dependency.** `pnpm build` already emits a single **1,850.77 kB / 531.65 kB gzipped** chunk and warns, with no `manualChunks` (arch §4.1, from `docs/_source/baseline-verification.md`). Five lines of arithmetic is the right trade against any package.
3. **The draw budget is tiny.** The dart-throw loop is bounded by `maxAttempts = maxTiles * 50` where `maxTiles = Math.floor(area / tileArea) * 2` (`src/utils/patternUtils.ts:489-490`) — thousands of draws for a dense grip, not billions. mulberry32's 2³² period is not a constraint at this scale.
4. **Zero-seed safe.** mulberry32 advances its state with `t += 0x6D2B79F5` *before* mixing, so `seed = 0` is a perfectly good stream. xorshift-family generators degenerate on a zero seed and would need a guard the schema cannot enforce (see §4.3 on why `.int()` is refused).
5. **Upgrade path is free.** If doc 03 lands a generator needing high-dimensional sampling (Poisson-disk, gradient noise) where a 32-bit state could show structure, swap the body of `makeRng` for sfc32 behind the same signature. That is exactly why this is a module with a factory, not an inline closure.

### 4.2 Module layout — a genuinely new folder

Rule 6 prefers new folders and warns that isolation is usually impossible. Here it is possible for the PRNG itself:

```
src/utils/random/
  prng.ts        makeRng · hashLabel · rngFor · DEFAULT_SEED   (new — does not exist yet)
  prng.test.ts                                                  (new — does not exist yet)
```

`src/utils/**` is inside the Vitest coverage allowlist (`vite.config.ts:30-35`), so this reports rather than silently scoring zero.

Reference implementation — 5 + 6 lines, no dependency:

```ts
// src/utils/random/prng.ts   (new — does not exist yet)
export type Rng = () => number;
export const DEFAULT_SEED = 1;

/** mulberry32. Any number in; NaN/float coerced via trunc + >>> 0 (NaN >>> 0 === 0). */
export function makeRng(seed: number): Rng {
  let a = Math.trunc(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the label, mixed with the seed. Same family as the existing Hasher
 *  (src/utils/geometry/manifoldCache.ts:20-53) — reuse the idea, not the class:
 *  that one is a wasm-handle cache key and returns base36. */
export function hashLabel(seed: number, label: string): number {
  let h = (2166136261 ^ (Math.trunc(seed) >>> 0)) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = (h ^ label.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export const rngFor = (seed: number, label: string): Rng => makeRng(hashLabel(seed, label));
```

### 4.3 Two streams, not one

`generateTilePositions` creates **two** streams from the one seed, immediately after the `if (!bounds) return []` guard at `src/utils/patternUtils.ts:301-302`:

```ts
const posRng = rngFor(seed, 'pos');   // consumed at :504, :505
const rotRng = rngFor(seed, 'rot');   // consumed at :464, inside getRotation
```

**Why two.** The dart-throw loop is rejection sampling: a candidate that collides (`:507-522`) or fails `checkPosition` (`:525`) consumes two position draws and no rotation draw, while an accepted one also draws a rotation at `:531`. On a shared stream, every rotation value would depend on how many collisions happened to occur — technically deterministic, but it means any future tweak to the collision test silently reshuffles rotations, and changing `tilingOrientation` alone reshuffles positions. Independent streams make each knob independent. Both derive from one persisted `number`, so nothing about the schema or a future URL param changes.

**`rotRng` must be created once at the top**, not inside `getRotation` — `getRotation` is called per placed tile from every distribution branch, and re-seeding per call would return the same rotation for every tile.

### 4.4 Schema additions

| Schema | Field | Definition | Why exactly this |
|---|---|---|---|
| `GeometrySettingsSchema` (`src/types/schemas.ts:66-85`) | `seed` | `z.number().default(1)` | `getDefaults` is `schema.parse({})` (`src/utils/schemaDefaults.ts:6-8`) and is called on this schema at `:12`. Without `.default()` it throws. Rule 3. |
| `InlayItemSchema` (`src/types/schemas.ts:19-46`) | `seed` | `z.number().default(1)` | Per item, because two items can both be `mode:'tile'` + `'random'` and must not share a stream. `getDefaults` is never applied to this schema (`schemaDefaults.ts:10-12` covers only Base/Inlay-settings/Geometry), but rule 3 is unconditional: give every new field a `.default()`. |
| `InlaySettingsSchema.items` default **literal** (`src/types/schemas.ts:51-63`) | `seed: 1` | added to the literal object | **Required. See below.** |

**Do NOT use `.int()`.** A `safeParse` failure on import throws a hard `"Invalid project file format or version mismatch."` at `src/utils/projectUtils.ts:186-188`, and the "Continue Anyway" recovery dialog is unreachable dead code (`:179-188` → `src/components/Controls.tsx:241-249`). A hand-edited float or a `2.0`-typed value would brick the whole bundle for the sake of a constraint `makeRng` already enforces with `Math.trunc(seed) >>> 0`.

**Boundary with doc 04.** The ban is on `GeometrySettingsSchema.seed` and `InlayItemSchema.seed` — the *persisted project* fields this doc owns. Doc 04's `SharePayloadV1Schema` declares `seed: z.number().int()` (`docs/04-parametric-controls.md:351`) and may constrain more tightly, because a URL payload is minted by code rather than hand-edited. It must then **coerce** (`Math.trunc`) rather than reject: a project whose `seed` is a hand-edited float parses fine under `ProjectSchemaV1` but would fail share-link encoding, making an otherwise valid design unshareable. See **Q2**.

**The default-literal trap — verified in this repo, stated nowhere else.** zod 4.2.0 (`package.json:40`; resolved 4.2.0) does **not** re-parse a `.default()` value through the inner schema. Run against this repo's own `node_modules`:

```
z.object({ items: z.array(Item).default([{ id: 'default-layer' }]) }).parse({})
  → { items: [ { id: 'default-layer' } ] }          // seed NOT filled
  .parse({ items: [{ id: 'a' }] })
  → { items: [ { id: 'a', seed: 1 } ] }             // seed filled
```

So adding `seed: z.number().default(1)` to `InlayItemSchema` **alone** produces exactly the divergence this doc exists to remove: a fresh session's default inlay layer (`defaultInlaySettings`, `src/utils/schemaDefaults.ts:11`) would carry `seed: undefined`, while every *imported* item carries `seed: 1`. Neither `docs/_source/00-recon-report.md` nor `00-architecture.md` states this; G6 and acceptance criterion **A7** exist to catch it.

**There are three `InlayItem` literal-construction sites, not one, and zod runs at none of them.** zod executes at exactly two runtime points in the app — `getDefaults` (`src/utils/schemaDefaults.ts:6-8`, applied at `:10-12`) and the import `safeParse` (`src/utils/projectUtils.ts:183`). Every literal built outside those two paths carries `seed: undefined` unless the literal itself is edited:

| # | Literal site | Reached when | Fix |
|---|---|---|---|
| 1 | `src/types/schemas.ts:51-63` — the `InlaySettingsSchema.items` default | fresh session, via `getDefaults` | add `seed: 1` (edit-list row 8) |
| 2 | `src/components/controls/InlayControls.tsx:99-111` — `handleAddLayer` | user clicks "add layer" | add `seed: DEFAULT_SEED` (row 8a) |
| 3 | `src/components/controls/InlayControls.tsx:137-149` — `handleShapeUpload` fallback | user uploads a shape with no layer selected | add `seed: DEFAULT_SEED` (row 8b) |

Sites 2 and 3 are **behaviourally covered** today by the `item.seed ?? DEFAULT_SEED` fallback at the tiler call site (row 17), so placement is deterministic either way. They must still be edited, for two reasons: a UI-created layer would otherwise persist with **no `seed` key**, so exporting and re-importing it silently changes which value the fallback reads from (`undefined` → `1` — same number today, not guaranteed once Q3 lands "mint once"), and doc 04's per-item seed control needs a real value to bind its input to. Acceptance criterion **A15** pins it.

### 4.5 Migration — no version bump, and why

Projects saved before seeding existed simply have no `seed` key. They import cleanly:

- `ProjectSchemaV1` is a plain **non-strict** `z.object` (`src/types/schemas.ts:87-93`), and `geometry` is always present in a v1 `project.json` (`src/utils/projectUtils.ts:40-55`), so the `.default(1)` applies on `safeParse` at `:183`. Verified above.
- Inlay items are likewise present and explicit, so each gets `seed: 1`.

**Do not bump `version: z.literal(1)` (`src/types/schemas.ts:88`).** `versionMismatch` is computed at `src/utils/projectUtils.ts:179-181` and then `safeParse` rejects and throws at `:186-188`, so the mismatch branch can never render its dialog. Bumping orphans every existing bundle with no migration and no working warning. A working discriminator is `ProjectSchemaV2`'s problem, owned by doc 04 (arch §6).

**What existing users actually see change.**

| Before M2 | After M2 |
|---|---|
| A `'random'` design re-scatters on every load, every param tweak, and every worker refine. | It scatters **once**, at the upgrade, then never again. |
| Variety across users came free from the bug. | Every user gets `seed = 1`, so every `'random'` design is now the *same* scatter until a seed control exists. |

Both are intended. The second is a real product consequence and is the strongest argument for doc 04's "Randomize" button landing early; it is also open question **Q3**. Record the one-time visual change wherever release notes land — the repo has no `README`, `CHANGELOG` or `LICENSE` today (recon §2, licensing row).

### 4.6 What seeding does **not** buy

**A seeded design is not a design reproducible from its saved form.** Export nulls `cutoutShapes` (`src/utils/projectUtils.ts:46`) and `patternShapes` (`:53`) and spreads `inlay` untouched (`:48-50`), so reproduction still depends on the exact binary assets travelling in the `.zip` (`:61-73`). After M2, `(seed, params)` fixes *placement*; it does not fix *what is placed* or *what it is clipped against*.

| Also required for "same bundle → same output" | Status | Owner |
|---|---|---|
| Outline geometry recoverable — either the exact source bytes under `assets/base/…` (`src/utils/projectUtils.ts:61-73`) or a stable `outlineRef` **(new)**, blocked on `PatternPreset` having no `id` (`src/components/PatternLibraryModal.tsx:8-15`) | asset bytes work today; `outlineRef` does not exist | doc 01 (`PatternPreset.id`, M1) → doc 04 (`outlineRef`, URL share) |
| Pattern unit recoverable — today it is an STL `THREE.BufferGeometry` (`src/components/ImperativeModel.tsx:829-830`) whose bytes live only in `assets/pattern/…`. A **generated** unit is re-derivable from params + seed, which is precisely what makes M3 the first genuinely reproducible design. | file-dependent today | doc 02 / doc 03 |
| Inlay geometry recoverable with **no** source file (painted and traced shapes have none) | broken — the import path calls the persisted JSON "garbage" (`src/components/Controls.tsx:219-224`) | doc 07 |
| Curve flattening stable at the seam — `getPoints()` at 12 divisions (`src/utils/geometry/serialize.ts:29-32`, `:36`) is deterministic, but an explicit tolerance is still owed | deterministic, unspecified | doc 06 |
| Manifold's own run-to-run and cross-patch determinism | **unverified** — `package.json:29` is a caret range | open question **Q1** |
| A design hash / result cache | blocked on this doc **and** JSON-clean geometry | doc 04 (arch §7) |
| Identical *bundle bytes* build-to-build — the `define` block stamps `__BUILD_TIMESTAMP__` with `Date.now()` at build time (`vite.config.ts:21-23`), so two builds of one commit differ | **never identical, by construction** | nobody. Irrelevant to placement; relevant to any claim about identical artefacts, and to A11's byte-size comparison |

State it this way in any user-facing copy: **a seeded design reproduces across reloads of the same bundle with the same assets. It does not yet reproduce from a link, and it does not reproduce from the JSON alone.**

---

## 5. Integration points

### 5.1 The full edit list

Ordered by dependency. Every row is an existing file (rule 6: folder isolation is not achievable past step 1).

| # | File:line | Change | Skip it and… |
|---|---|---|---|
| 1 | `src/utils/random/prng.ts` **(new folder)** | the PRNG module | — |
| 2 | `src/utils/patternUtils.ts:285-299` | 14th parameter `seed: number = DEFAULT_SEED`, **trailing and defaulted** | the other 14 call sites stop compiling |
| 3 | `src/utils/patternUtils.ts:301-302` | create `posRng` / `rotRng` after the `if (!bounds) return []` guard | streams re-seed per call |
| 4 | `src/utils/patternUtils.ts:464` | `rotRng()` replaces `Math.random()` | `tilingOrientation: 'random'` stays unseeded |
| 5 | `src/utils/patternUtils.ts:504-505` | `posRng()` replaces both `Math.random()` calls | `tilingDistribution: 'random'` stays unseeded |
| 6 | `src/types/schemas.ts:66-85` | `seed: z.number().default(1)` on `GeometrySettingsSchema` | `getDefaults` at `src/utils/schemaDefaults.ts:12` yields no seed |
| 7 | `src/types/schemas.ts:19-46` | `seed: z.number().default(1)` on `InlayItemSchema` | per-item seeds impossible |
| 8 | `src/types/schemas.ts:51-63` | add `seed: 1` to the default `items` literal | **zod does not fill it** (§4.4) — fresh session diverges from imported |
| 8a | `src/components/controls/InlayControls.tsx:99-111` | add `seed: DEFAULT_SEED` to the `handleAddLayer` literal (import it from `src/utils/random/prng.ts`) | a UI-created layer persists with no `seed` key (§4.4) |
| 8b | `src/components/controls/InlayControls.tsx:137-149` | add `seed: DEFAULT_SEED` to the `handleShapeUpload` fallback literal | same |
| 9 | `src/utils/geometry/patternPipeline.ts:51-82` | **`seed?: number;`** on `PatternJob` — **optional, exactly like `rotationClamp` at `:66`** | the pipeline cannot read it |
| 10 | `src/utils/geometry/patternPipeline.ts:108-112` | destructure `seed` off `job`, **defaulting it**: `seed = DEFAULT_SEED` | — |
| 11 | `src/utils/geometry/patternPipeline.ts:184-190` | pass `seed` as argument 14 | worker placement stays unseeded |
| 12 | `src/components/ModelViewer.tsx:48-54` | destructure `seed` off `geometrySettings` | never read out of state |
| 13 | `src/components/ModelViewer.tsx:460-501` | add a JSX attribute on `<ImperativeModel>` | **the step most often missed** — the field never crosses into `ImperativeModel` |
| 14 | `src/components/ImperativeModel.tsx:15-54` + body destructure `:60-96` | `seed?: number` on `ImperativeModelProps`, defaulted in the destructure | does not typecheck, or is declared and never bound |
| 15 | `src/components/ImperativeModel.tsx:843-849` | put `seed` on the returned `PatternJob` | the worker never sees it |
| 16 | `src/components/ImperativeModel.tsx:897-903` | add `seed` to the **hand-maintained dependency array** | changing the seed never regenerates — already demonstrably broken for the three `debugShow*Cutter` props, read at `:857-859` and absent from the array |
| 17 | `src/components/ImperativeModel.tsx:254-267` | **this call passes only 12 arguments today.** Insert `null` for `avoidShapes` (argument 13), *then* `item.seed ?? DEFAULT_SEED` (argument 14). See the trap below. | main-thread inlay placement stays unseeded |
| — | `vite.config.ts:30-35` | **no edit** — `src/utils/**` is already allowlisted | — |

> **Row 9 is optional on purpose — this is a decision, not an oversight.** `PatternJob.seed` is declared `seed?: number` and defaulted in the destructure (row 10), matching `rotationClamp?: number` (`src/utils/geometry/patternPipeline.ts:66`) and this doc's own `ImperativeModelProps.seed?: number` (row 14). A **required** `seed: number` would leave the tree un-typecheckable between task 6 and task 7: `buildJob` returns a `PatternJob` object literal (`src/components/ImperativeModel.tsx:843-860`) that does not gain the field until task 7. Nothing in the repo would surface that — neither `pnpm test` (`vitest run`, `package.json:13`, esbuild transform) nor `pnpm build` (`vite build`, `package.json:9`) runs `tsc` — but §7's "each task leaves the suite green" must be true under **A14** as well, and optional is what makes it true.

> **Row 17 is the one silent failure in this milestone.** The inlay call site supplies `containerBounds, tW, tH, item.tileSpacing || 10, null, 0, true, item.tilingDistribution || 'grid', 'none', 'horizontal', null, null` — **twelve** expressions (`src/components/ImperativeModel.tsx:254-267`). It omits `avoidShapes`, which is parameter **13** (`src/utils/patternUtils.ts:296-298`). Appending the seed to that list therefore binds a `number` to `avoidShapes: THREE.Shape[] | null`. Nothing in the repo catches it: `pnpm build` is `vite build` with no `tsc` (`package.json:9`), and at runtime the guard `if (avoidShapes && avoidShapes.length > 0)` (`src/utils/patternUtils.ts:311`) is false for a number, so the mistake no-ops — the inlay path stays unseeded while **A1** still passes and **A4** still shows an empty `inlayPipeline.ts` diff. The worker call, by contrast, already passes all 13 (`src/utils/geometry/patternPipeline.ts:184-190`) and needs only one appended argument. **A13** pins the correct 14-argument shape as an executable test to copy from; **A14** is the only gate that catches the miscount itself.

**Copy `rotationClamp` exactly.** It is the same seven-hop chain, already wired, and every hop is greppable: `src/types/schemas.ts:83` → `src/components/ModelViewer.tsx:52` (destructure), `:480` (JSX attribute) → `src/components/ImperativeModel.tsx:33` (prop type), `:80` (body destructure), `:848` (`buildJob`), `:900` (dependency array) → `src/utils/geometry/patternPipeline.ts:66` (`PatternJob` field — **`:66`, not `:73`; `:73` is `patternUnit`**), `:111` (destructure), `:193-195` (use). Do not invent a different shape — including its optionality: `rotationClamp?: number` is optional, and so is row 9's `seed?: number`.

### 5.2 The tiler signature

Trailing and defaulted, so all 15 existing call sites compile untouched:

```ts
// src/utils/patternUtils.ts:285-299
export const generateTilePositions = (
    bounds: THREE.Box2,
    tileWidth: number,
    tileHeight: number,
    spacing: number,
    boundaryShapes: THREE.Shape[] | null,
    margin: number = 0,
    allowPartial: boolean = false,
    distribution: 'grid' | 'offset' | 'hex' | 'radial' | 'random' | 'wave' | 'zigzag' | 'warped-grid' = 'grid',
    orientation: 'none' | 'alternate' | 'random' | 'aligned' = 'none',
    direction: 'horizontal' | 'vertical' = 'horizontal',
    exclusionShapes: THREE.Shape[] | null = null,
    inclusionShapes: THREE.Shape[] | null = null,
    avoidShapes: THREE.Shape[] | null = null,
    seed: number = DEFAULT_SEED,                 // 14th — new
): TileInstance[] => { … }
```

`src/utils/patternUtils.ts:285` is the exact file where **rules 5 and 6 collide** (arch §5.2 rule 6 table): it is shared inherited code executed in *both* threads. A trailing defaulted parameter is the smallest possible diff there and stays trivially mergeable against upstream.

`tileShapes` (`src/utils/patternUtils.ts:800-933`, calling the tiler at `:834`) is **dead code** — called only by its own test (recon §3.6). The default keeps it compiling. Do not add a seed parameter to it; do not delete it in this milestone.

### 5.3 `InlayJob` must not change

`InlayJobItem.positions` carries already-resolved `{ x, y, rot }` (`src/utils/geometry/inlayPipeline.ts:30`), consumed at `:91`. **The inlay worker never tiles.** Putting a seed on `InlayJob` would create a second, competing placement authority and reintroduce exactly the divergence described in §3.3. `git diff src/utils/geometry/inlayPipeline.ts` must be empty at the end of M2 (criterion **A4**).

**No dependency-array edit is needed for the inlay seed.** `inlayItems` is already a dependency of the inlay effect (`src/components/ImperativeModel.tsx:742`) and of the pattern effect (`:899`), so a seed change on an item flows through the existing object identity.

### 5.4 Two safety properties, verified

**Structured-clone safety.** `seed` is a `number`. It cannot trigger the `DataCloneError` in `pump()` (`src/utils/geometry/patternClient.ts:66-67`) that permanently wedges all geometry generation for the session (arch §5.2 rule 5, hard constraint 1). No other job field is added.

**No core boolean semantics change.** Arch §10's amendment permits a seed on the grounds that "seeded values reach only `instanceMatrix` and `compose`, never a cache key". Confirmed in code: seeded values land in `TileInstance.position` / `.rotation` (`src/utils/patternUtils.ts:3-7`), which are read only by `instanceMatrix` (`src/utils/geometry/patternPipeline.ts:205-213`) and then by either the instanced fast path (`:223-229`) or `Manifold.compose` (`:236`). `WasmCache` keys are content hashes of *input contours* — `cachedCutterSolid` (`src/utils/geometry/manifoldOps.ts:128-161`) hashes shapes, not placements. **No cache key changes.**

---

## 6. Edge cases, testing, acceptance criteria

### 6.1 Edge cases

| # | Case | Required behaviour |
|---|---|---|
| E1 | `seed = 0` | Valid mulberry32 stream, not a degenerate one. `makeRng(0)` must be reproducible and must differ from `makeRng(1)`. |
| E2 | `seed = NaN`, a float, or a negative, from a hand-edited bundle | Accepted by the schema (no `.int()`, §4.4) and coerced by `Math.trunc(seed) >>> 0`. `NaN >>> 0 === 0`, so a NaN seed degrades to stream 0, never to `NaN` coordinates. |
| E3 | Two tiled-random inlay items with the same seed **and** identical bounds and tile size | They get identical scatters. **This is correct** — same inputs, same output. The user changes one item's seed for variety. |
| E4 | The tempting wrong fix: mixing `item.id` into the stream | **Forbidden.** `InlayItem.id` is a `uuid` minted per layer (`src/components/controls/InlayControls.tsx:100`). It is persisted (`src/types/schemas.ts:20`) so it *is* stable across reload for an existing item — but a newly created or duplicated layer gets a fresh uuid, so two people building the same design by hand get different geometry. **The seed must be the only entropy input.** |
| E5 | `rotationClamp` set | It quantizes rotations *after* placement (`src/utils/geometry/patternPipeline.ts:193-195`) and is **not** a seeding mechanism (arch rule 4). With a clamp set, seeded and unseeded rotations can collapse to the same quantized value for many tiles — never use a clamped job as a determinism fixture. |
| E6 | `fullWidth === 0` (from `patternScale` or `tileSpacing` driving it to zero) | Still hangs. In the lattice branches `cols/rows = ceil(span/0) = Infinity` (`src/utils/patternUtils.ts:478-479`, `:684-696`); in the random branch `maxTiles = Math.floor(area / 0) * 2 = Infinity` and `maxAttempts` with it (`:489-490`), so `while (attempts < maxAttempts && count < maxTiles)` at `:502` never terminates — inside the worker, so the pump never drains and the app silently stops regenerating. **Seeding does not fix this. Doc 03 owns the cap** (arch §6). Do not let M2's exit imply otherwise. |
| E7 | A seed change alters the tile **count**, not just positions | The accept count in the dart-throw loop depends on the whole draw sequence. Any test asserting a fixed count must pin the seed. |
| E8 | A bundle saved before seeding | Imports unchanged; `geometry.seed` and every `inlay.items[].seed` become `1`. No version bump (§4.5). |
| E9 | The React Compiler is on (`vite.config.ts:8-14`, `target: "19"`) | `posRng` / `rotRng` are locals inside a plain function, not hooks. Nothing here is compiler-sensitive. `calculateItemPositions` stays un-memoized — memoizing it is a separate change and out of scope. |

### 6.2 Testing (Vitest)

All new tests live under `src/utils/**`, inside the coverage allowlist (`vite.config.ts:30-35`).

**`src/utils/random/prng.test.ts` (new)**

| Assertion |
|---|
| `makeRng(1)` twice → the first 100 draws are deep-equal |
| `makeRng(1)` vs `makeRng(2)` → the first 100 draws are **not** equal |
| every draw ∈ `[0, 1)` over 10 000 draws |
| `makeRng(0)` is reproducible and not constant (E1) |
| `makeRng(NaN)` produces the same sequence as `makeRng(0)` (E2) |
| `rngFor(1, 'pos')` and `rngFor(1, 'rot')` produce different sequences (§4.3) |

**`src/utils/patternUtils.test.ts` (extend; the `length > 0` assertion at `:332-345` is **replaced**)**

Compare mapped tuples rather than `TileInstance[]` directly, so the criterion does not depend on how Vitest structurally compares a `THREE.Vector2`:

```ts
const tuple = (ps: TileInstance[]) =>
  ps.map(p => [p.position.x, p.position.y, p.rotation, p.scale]);
```

| Assertion |
|---|
| `distribution:'random'`, seed 1, called twice → `tuple(a)` deep-equals `tuple(b)` |
| `distribution:'random'`, seed 1 vs seed 2 → `tuple(a)` **not** equal to `tuple(b)` — *this is the assertion that catches a seed accepted and then ignored, which "twice with the same seed" alone cannot* |
| `distribution:'grid'`, `orientation:'random'`, seed 1 twice → rotations deep-equal; seed 2 differs |
| a 13-argument call (no 14th) still compiles and returns `length > 0` — pins the trailing-default contract that keeps the other 14 call sites untouched |
| **The inlay path's exact call shape** (**A13**): call the tiler with the 14 arguments row 17 produces — a centred `THREE.Box2`, tile width/height, spacing, `boundaryShapes: null`, `margin: 0`, `allowPartial: true`, `distribution: 'random'`, `orientation: 'none'`, `direction: 'horizontal'`, `exclusionShapes: null`, `inclusionShapes: null`, **`avoidShapes: null`**, `seed`. Twice with seed 1 → `tuple(a)` deep-equals `tuple(b)`; seed 1 vs seed 2 → not equal; and `a.length > 0`. This is the only assertion that exercises the main-thread inlay signature, and the only thing that fails if the seed is appended into `avoidShapes`. |

**`src/utils/geometry/patternPipeline.test.ts` (extend)**

This is the payoff, and it needs **no browser harness**: `patternPipeline.test.ts` and `inlayPipeline.test.ts` both pass in the recorded baseline (`docs/_source/baseline-verification.md`), which means **Manifold wasm runs under Vitest/jsdom**. The harness already exists — `beforeAll` + `getManifold()` and the `baseJob(overrides)` factory at `src/utils/geometry/patternPipeline.test.ts:26-55`.

| Assertion |
|---|
| Two identical jobs, `tilingDistribution:'random'`, `clipToOutline:false` (instanced fast path, `patternPipeline.ts:223-229`), `seed:1` → `instanced.count` equal **and `> 0`**, and every element of `instanced.matrices` equal **to 4 decimal places** (`toBeCloseTo`), not byte-exactly |
| Same job, seed 1 vs seed 2 → `instanced.matrices` differ (or `count` differs) |
| **Additive-only guard:** a `tilingDistribution:'grid'`, `tilingOrientation:'none'`, `clipToOutline:false` job produces `instanced.matrices` **exactly equal to the committed fixture** `src/utils/geometry/__fixtures__/grid-matrices.json` **(new — does not exist yet)** — no seeded path may perturb a deterministic distribution |

*Where the "before" values come from.* The additive-only guard is not a procedure, it is a committed artefact, and it must be captured **before the tiler is touched**. That is task **1b**: on the unmodified tree, run `baseJob({ clipToOutline: false })` through `generatePattern` — the same call the existing fast-path test already makes (`src/utils/geometry/patternPipeline.test.ts:87-95`), whose `count > 0` is already asserted at `:91`, and whose factory defaults are already `tilingDistribution: 'grid'` and `tilingOrientation: 'none'` (`:36`, `:38`) — then write `Array.from(res.instanced!.matrices)` and `res.instanced!.count` to `src/utils/geometry/__fixtures__/grid-matrices.json`. Commit that file on its own, before task 2 touches the tiler. **A10** then asserts the post-change run equals it exactly.

*On the tolerance:* the matrices are computed in plain JS from `TileInstance[]` and never pass through Manifold, so byte-equality would in fact hold. A tolerance is used anyway because it is the architecture doc's binding M2 exit criterion and because Manifold's own run-to-run determinism is unverified (Q1). Compare `instanced.matrices` and `count` only — leave `instanced.unit` (which *is* Manifold output, via `ops.serializeMesh`) out of the comparison.

**`src/utils/schemaDefaults.test.ts` (extend)**

| Assertion |
|---|
| `getDefaults(GeometrySettingsSchema).seed === 1` |
| `getDefaults(InlaySettingsSchema).items[0].seed === 1` — **fails unless `src/types/schemas.ts:51-63` is edited** (§4.4) |

**`src/utils/projectUtils.test.ts` (extend)**

| Assertion |
|---|
| A fixture `project.json` with `version: 1` and **no `seed` key anywhere** satisfies `ProjectSchema.safeParse(fixture).success === true`, and the parsed result has `geometry.seed === 1` and `inlay.items[0].seed === 1` |

### 6.3 Acceptance criteria

Each is a command, an assertion, or a diff.

| # | Criterion |
|---|---|
| **A1** | `grep -rn 'Math\.random' src --include='*.ts' --include='*.tsx' \| grep -v '\.test\.'` prints **nothing**. |
| **A2** | `pnpm test` is green. |
| **A3a** | Only two **production** call sites change: `git diff -U0 -- src/utils/geometry src/components \| grep -E '^\+\+\+\|generateTilePositions\('` names exactly two files, `src/utils/geometry/patternPipeline.ts` (the call at `:184`) and `src/components/ImperativeModel.tsx` (the call at `:254`), and no other. |
| **A3b** | The existing test calls are left alone: `git diff -- src/utils/patternUtils.test.ts` deletes **exactly one** `generateTilePositions(` call — the one at `:334`, inside the `it('generates tile positions in random mode')` block at `:332-345` that §6.2 replaces. The other **11** pre-existing calls (`:280`, `:304`, `:319`, `:352`, `:355`, `:358`, `:361`, `:364`, `:367`, `:373`, `:376`) appear on no `-` line and gain no 14th argument. Everything else §6.2 adds is an addition. *(A bare `grep -c` is **not** the criterion — the file's total call count necessarily rises the moment the determinism tests land.)* |
| **A4** | `git diff src/utils/geometry/inlayPipeline.ts` is **empty**. |
| **A5** | The tiler determinism pair passes: same seed → mapped tuples deep-equal; seed 1 vs 2 → not equal (replacing `src/utils/patternUtils.test.ts:332-345`). |
| **A6** | `generatePattern` run twice on identical `seed:1`, `clipToOutline:false`, `tilingDistribution:'random'` jobs yields equal `instanced.count` **and `instanced.count > 0`** and `instanced.matrices` equal to 4 dp. *(Without the `> 0` clause, two empty runs satisfy the equality. `generatePattern` returns `empty()` — which carries no `instanced` key at all (`src/utils/geometry/patternPipeline.ts:126-129`) — when `positions.length === 0` at `:197`, so an empty run would in practice throw rather than pass; pin the property anyway.)* |
| **A7** | `getDefaults(GeometrySettingsSchema).seed === 1` **and** `getDefaults(InlaySettingsSchema).items[0].seed === 1`. |
| **A8** | A pre-seed `project.json` fixture parses: `.success === true`, `geometry.seed === 1`, `inlay.items[0].seed === 1`. No change to `version: z.literal(1)` — `git diff src/types/schemas.ts \| grep -c 'z.literal'` is `0`. |
| **A9** | The dependency array carries the seed: `sed -n '897,904p' src/components/ImperativeModel.tsx \| grep -c '\bseed\b'` is `1`. *(A runtime regeneration test is not available until doc 04 ships a seed control; this pins the wiring in the meantime.)* |
| **A10** | The grid-distribution `instanced.matrices` produced after the change are **exactly equal** to the committed fixture `src/utils/geometry/__fixtures__/grid-matrices.json`, captured in task **1b** on the unmodified tree (additive-only guard, §6.2). |
| **A11** | `pnpm build` succeeds and **both** bundled chunks stay within budget against `docs/_source/baseline-verification.md`: `dist/assets/index-*.js` **< 1,852.77 kB** (baseline 1,850.77) and `dist/assets/geometryWorker-*.js` **< 132.66 kB** (baseline 130.66). The worker chunk is measured because `src/utils/random/prng.ts` is imported by `src/utils/patternUtils.ts`, which the worker pipeline pulls in (`src/utils/geometry/patternPipeline.ts:3`) — so both chunks grow. |
| **A12** | `pnpm lint` (`eslint .`, `package.json:10`) exits **0**, **and** the task-9 rule can actually fail: adding a `Math.random()` call to any file under `src/utils/` makes `eslint src/utils` exit **non-zero**. Both halves are required — every rule in `eslint.config.js:20-38` is severity `'warn'` today and `pnpm lint` already exits 0 with **42 warnings**, so a `'warn'`-severity guard would satisfy the first half while enforcing nothing. |
| **A13** | The inlay path's own 14-argument call shape is exercised and deterministic (§6.2, `patternUtils.test.ts`): `boundaryShapes: null`, `allowPartial: true`, `orientation: 'none'`, **`avoidShapes: null`**, `seed` — twice with seed 1 → mapped tuples deep-equal; seed 1 vs 2 → not equal; length `> 0`. It makes the correct 14-argument shape **executable**, so row 17 is a copy rather than a recount; **A14** is what fails if the recount is done wrong anyway. Without both, the row-17 trap is invisible — A1, A3a and A4 all pass with the inlay path unseeded. |
| **A14** | Typecheck introduces **no new error**: `npx tsc -p tsconfig.app.json --noEmit 2>&1 \| grep -c 'error TS'` returns the same count after M2 as before it. Measured on the branch tip while writing this doc: **18** — 13 × TS6133/TS6192 unused locals/imports (`Controls.tsx:10,11`, `DebouncedInput.test.tsx:1`, `DXFThumbnail.tsx:1,12`, `InlayInteractionHandles.tsx:104,279`, `ModelViewer.tsx:14,89`, `ScreenshotModal.tsx:2`, `Spinner.test.tsx:1`, `STLThumbnail.tsx:1`, `AlertContext.test.tsx:1`), 4 × missing vitest globals because `tsconfig.app.json` has `include: ["src"]` (`patternUtils.test.ts:130`, `projectUtils.test.ts:22,23,56`), 1 × TS2322 on the export path (`OutputPanel.tsx:125`). **`docs/_source/baseline-verification.md` says "19" but enumerates 15 + 4 + 1 = 20 — its count is unreliable; re-measure on the tip before task 2 and pin *that* number.** This is the **only** gate in the milestone that can fail on a type error: `pnpm build` is `vite build` (`package.json:9`) and `pnpm test` is `vitest run` (`:13`), and neither runs `tsc`. It is what catches edit-list rows 2, 14 and 17. |
| **A15** | Every `InlayItem` literal in the app carries a seed: `grep -c 'seed: DEFAULT_SEED' src/components/controls/InlayControls.tsx` is **2** (`:99-111` and `:137-149`), and `grep -c 'seed: 1' src/types/schemas.ts` is **1** (`:51-63`). Together with A7 this closes the §4.4 fresh-session/imported divergence at all three literal sites. |

---

## 7. Task order

The recon is **DONE** (arch §9). These start from its findings. Each is one commit, and each leaves `pnpm test` green **and A14 at its measured baseline count** — "green suite" alone is not enough here, because neither `pnpm test` nor `pnpm build` type-checks (`package.json:9`, `:13`). Task **1b** must precede task 2; task **8** is the first task at which **A3a** can be evaluated at all.

| # | Task | Touches | Done when |
|---|---|---|---|
| **1** | Add `src/utils/random/prng.ts` and `prng.test.ts`. No consumers yet. | new folder only | `pnpm test` green; every §6.2 PRNG assertion passes |
| **1b** | **Capture the additive-only baseline, on the unmodified tiler.** Run `baseJob({ clipToOutline: false })` through `generatePattern` and commit `Array.from(res.instanced!.matrices)` + `res.instanced!.count` as a fixture. Nothing else in this commit. **This must land before task 2** — once the tiler changes there is no "before" to record. | `src/utils/geometry/__fixtures__/grid-matrices.json` **(new)** | the fixture file exists and is committed; `pnpm test` green |
| **2** | Add the trailing `seed = DEFAULT_SEED` parameter to `generateTilePositions` and create `posRng` / `rotRng` after the `:301-302` guard. Route `:464` through `rotRng` and `:504-505` through `posRng`. | `src/utils/patternUtils.ts:285-299`, `:301-302`, `:464`, `:504-505` | **A1**, **A14** — all 15 call sites still compile unedited |
| **3** | Replace `src/utils/patternUtils.test.ts:332-345` with the determinism pair; add the orientation-random pair, the 13-argument compile pin, and the **A13** inlay-shape pair. | `src/utils/patternUtils.test.ts` | **A5**, **A13**, **A3b**. *(Not **A3a** — it names call sites in `patternPipeline.ts` and `ImperativeModel.tsx`, which tasks 6 and 8 have not touched yet.)* Local gate: `git diff -- src/utils/patternUtils.test.ts` is the only change in the commit, and `pnpm test` is green. |
| **4** | Schema: `seed` on `GeometrySettingsSchema` and `InlayItemSchema`, **`seed: 1` in the `items` default literal at `:51-63`**, and `seed: DEFAULT_SEED` in both `InlayControls` literals. | `src/types/schemas.ts:19-46`, `:51-63`, `:66-85`; `src/utils/schemaDefaults.test.ts`; `src/components/controls/InlayControls.tsx:99-111`, `:137-149` | **A7**, **A15** |
| **5** | Add the pre-seed `project.json` fixture test. | `src/utils/projectUtils.test.ts` | **A8** |
| **6** | Thread the seed into the worker: **`seed?: number`** on `PatternJob` (`:51-82`) — optional, mirroring `rotationClamp?` at `:66` — destructured with a default `seed = DEFAULT_SEED` (`:108-112`), passed as argument 14 (`:184-190`). Add the `patternPipeline.test.ts` determinism pair and the grid additive-only guard against the task-1b fixture. | `src/utils/geometry/patternPipeline.ts`, its test | **A6**, **A10**, **A14** |
| **7** | Thread the seed through React, copying `rotationClamp` hop for hop: `ModelViewer` destructure + JSX attribute; `ImperativeModelProps` + body destructure; `buildJob`; **dependency array**. | `src/components/ModelViewer.tsx:48-54`, `:460-501`; `src/components/ImperativeModel.tsx:15-54`, `:60-96`, `:843-849`, `:897-903` | **A9**, **A14**. *(Not `pnpm build` — `vite build` strips types with esbuild and never runs `tsc` (`package.json:9`), so it cannot detect either failure mode this task risks: row 2's "the other 14 call sites stop compiling" and row 14's "declared and never bound".)* |
| **8** | Thread the seed through the main-thread inlay call. **Read the row-17 note in §5.1 first: the call passes 12 arguments today.** Insert `null` for `avoidShapes` (argument 13), then `item.seed ?? DEFAULT_SEED` (argument 14) — copy the shape from the A13 test. Verify `InlayJob` is untouched. | `src/components/ImperativeModel.tsx:254-267` | **A3a** (first point at which both production call sites have been edited), **A4**, **A14**; the §3.3 placeholder/worker divergence no longer reproduces |
| **9** | Guard the invariant: an ESLint `no-restricted-syntax` (or `no-restricted-properties`) rule forbidding `Math.random` under `src/utils/**` and in `src/components/ImperativeModel.tsx`, so doc 04's Randomize button cannot silently regress it. **Severity must be `'error'`.** Every existing project rule is `'warn'` (`eslint.config.js:20-38`) and `pnpm lint` (`eslint .`, `package.json:10`) already exits 0 with 42 warnings, so a `'warn'` guard enforces nothing. | `eslint.config.js` | **A12** — both halves: `pnpm lint` exits 0, **and** a scratch `Math.random()` under `src/utils/` makes `eslint src/utils` exit non-zero |

**Note on A1 and the future Randomize button.** The M2 exit criterion "no `Math.random` in `src`" is achievable exactly because no seed control exists yet. When doc 04 adds one, the *legitimate* place to mint a fresh seed is a UI event handler — `Math.floor(Math.random() * 2 ** 32)`. Task 9 narrows the invariant to what actually matters ("no `Math.random()` in any geometry path") **before** that day arrives, rather than letting the criterion quietly rot. Doc 04 must relax the rule for its own control file explicitly, in one line, with a comment.

---

## What already exists

Every piece of this feature that is already in the codebase. Do not rebuild these.

| Piece | Exists? | Evidence |
|---|---|---|
| Any PRNG, seed, or RNG identifier | **No — zero hits.** `grep -rniE "\b(seed\|prng\|mulberry\|sfc32\|xoshiro\|splitmix\|rng)\b" src --include='*.ts' --include='*.tsx'` returns nothing. | verified in this repo |
| A `seed` field on any schema | **No.** | `src/types/schemas.ts:10-96` |
| A `seed` field on any worker job | **No.** | `PatternJob` `src/utils/geometry/patternPipeline.ts:51-82`; `InlayJob` `src/utils/geometry/inlayPipeline.ts:34-42` |
| A determinism assertion anywhere in the suite | **No.** The nearest is `expect(positions.length).toBeGreaterThan(0)` on the random distribution — it passes whether or not the output is stable. | `src/utils/patternUtils.test.ts:332-345` |
| A seed UI control | **No** — owned by doc 04. | arch §6 |
| **The parametric placement engine the seed feeds** | **Yes, and it is substantial.** 13 parameters, 8 distributions × 4 orientations, boundary/exclusion/mask/avoid aware, with a Y-bucketed spatial index and an oracle-equivalence test. **Add one trailing parameter; do not rewrite it.** | `src/utils/patternUtils.ts:285-299`; index `:102-161`; oracle test `src/utils/patternUtils.test.ts:62-95` |
| Structured-clone-safe job plumbing to carry the seed into the worker | **Yes.** `PatternJob` is the worked example; `submitPattern` at `src/utils/geometry/patternClient.ts:97-101`. Adding a `number` needs no client change. | — |
| A zod defaults mechanism that survives the persistence path unchanged | **Yes.** `.default()` + `getDefaults` = `schema.parse({})`, applied to all three settings schemas. | `src/utils/schemaDefaults.ts:6-12` |
| A hash/mixer of the right family to copy the *idea* from | **Yes** — 32-bit FNV-1a in `Hasher`. Reuse the idea, **not the class**: it is a wasm-handle cache key and returns base36, and arch §7 records it as "inadequate as a correctness key". | `src/utils/geometry/manifoldCache.ts:20-53` |
| **A Vitest harness that runs Manifold wasm under jsdom** | **Yes — this is the payoff for testing.** Both pipeline suites pass in the recorded baseline, `beforeAll` + `getManifold()` is wired, and a `baseJob(overrides)` factory already exists. A real determinism regression test needs **no browser harness**. | `src/utils/geometry/patternPipeline.test.ts:1-55` (factory at `:26-55`); `src/utils/geometry/inlayPipeline.test.ts:1-38`; `docs/_source/baseline-verification.md` |
| A worked example of the seven-hop param chain | **Yes — `rotationClamp`.** Copy it hop for hop, **including its optionality** (`rotationClamp?: number`). | `src/types/schemas.ts:83` → `src/components/ModelViewer.tsx:52`, `:480` → `src/components/ImperativeModel.tsx:33`, `:80`, `:848`, `:900` → `src/utils/geometry/patternPipeline.ts:66` (**not `:73` — that is `patternUnit`**), `:111`, `:193-195` |
| Coverage instrumentation for the new module | **Yes, automatically.** `src/utils/**` is in the allowlist; no `vite.config.ts` edit needed. | `vite.config.ts:30-35` |

---

## 8. Open questions

Three. Each is a genuine unknown with a stated way to settle it.

### Q1 — Is `manifold-3d` deterministic run-to-run, and across patch versions?

Recon §8 lists this as unsettled: the claim rests on a string scan of `manifold.wasm`, which has no name section, so a compiled LCG or Mersenne twister would emit no matching string. `package.json:29` is a **caret** range (`^3.5.1`), so a lockfile refresh can move the resolved version and a triangulation change moves exported STL bytes for an unchanged design.

This does **not** block M2 — the seeded placement is pure JS and criterion **A6** compares with a tolerance, deliberately. It does bound what "reproducible" may be claimed for exported *mesh bytes*.

**Settles by:** run one `PatternJob` twice in Node and compare the output buffers byte-for-byte; repeat across two `manifold-3d` patch versions. If it fails, pin `manifold-3d` to an exact version in `package.json` and say so in the reproducibility copy.

### Q2 — One seed per design, or one per surface?

This doc ships **N + 1** seeds: `GeometrySettingsSchema.seed` for the pattern, plus one on each `InlayItem`. The alternative is a **single** design-level seed with derived labels — `rngFor(designSeed, 'inlay:' + itemIndex)` — using the same `rngFor` factory.

N + 1 is more controllable (re-roll one inlay without disturbing the pattern). One is more shareable, and a short URL param is what doc 04's share link wants.

**Settles by:** doc 04's URL-share design — whichever encoding fits a short link wins. Deliberately deferred: `rngFor(seed, label)` reaches either answer without changing the tiler signature or `PatternJob`, so this can be revisited without re-doing M2.

Whichever wins, the **`.int()` boundary in §4.4 binds**: the persisted `seed` fields stay unconstrained, and doc 04's `SharePayloadV1Schema` (`docs/04-parametric-controls.md:351`) must coerce a float rather than reject it.

### Q3 — Should the default seed be `1` for everyone, or minted once per project and persisted?

A fixed `1` makes every user's `'random'` design the *same* scatter (§4.5). Before this change, variety came free from the bug. Minting a seed at project creation preserves variety while staying reproducible — but **there is no "project created" event today**: `App.tsx` initialises from `getDefaults` (`src/utils/schemaDefaults.ts:10-12`) on every mount, and the only `localStorage` key in the app is `welcome_modal_dismissed` (`src/App.tsx:30-33`). Minting at mount **without** persistence would reintroduce precisely the non-determinism this doc removes.

**Settles by:** a product call from @liamstar. If "mint once" wins, it depends on doc 04's persistence work and must not land before it. Until then, `1`.
