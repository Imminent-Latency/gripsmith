# Parametric controls and design sharing

**Doc ID:** `04-parametric-controls`
**Status:** Design — ready to implement
**Owner:** @liamstar
**Parent:** [`./00-architecture.md`](./00-architecture.md) — its §5 contracts and §10 derivation rules bind this doc. Where they conflict, the parent wins until amended.
**Evidence base:** [`./_source/00-recon-report.md`](./_source/00-recon-report.md) (§5 "04 — parametric controls", §6 M5, §7 Q2). Recon is **complete**; nothing below starts with "do recon".

| | |
|---|---|
| **Milestone served** | **M5** (parent §8) — "Controls, sharing and breadth". Partially unblocks §7's *cache by design hash* directive by removing live `THREE` objects from persisted state. |
| **Blocked by — half A (param UI)** | **Nothing.** Startable today. Doc 02 only supplies *contents* for the 4th tab; the renderer, the primitives and the a11y baseline need no other doc. |
| **Blocked by — half B (serialization + share)** | **M1** (`PatternPreset.id` → `outlineRef`) and **M2** (`seed`). A share link without both reproduces nothing. `ProjectSchemaV2` itself is blocked on neither and can land first. |
| **Blocks** | Nothing hard. Doc 03's generator params get a renderer for free; doc 02's registry supplies `ParamDescriptor` values. |
| **Units** | Millimetres throughout; three.js scene units at 1 unit = 1 mm (parent §4.1). Angles in degrees at the UI, as `baseOutlineRotation` already is (`src/types/schemas.ts:15`). |
| **Toolchain** | pnpm 10.20.0, Vite 5.4.21, Vitest 2.1.9 + jsdom, Tailwind 3.4.19, zod 4.2.0, React 19 with the React Compiler on (`vite.config.ts:8-14`). |

---

## 1. Summary

**This doc is two features with different blockers. They must ship independently and in this order.**

**Half A — the parametric control layer. Unblocked, start any time.**
Parent §11 Q2 asked "`leva` for speed vs. native Tailwind for polish". **The premise inverts.** `leva` is in neither `package.json:17-66` nor `pnpm-lock.yaml` (verified: zero matches in both). The native layer is already written and already assembles all three tabs — **28** `<ControlField>` call sites[^cf], **17** `<DebouncedInput>`, `SegmentedControl`, `ToggleButton`, a 21-swatch colour grid.

`leva` would be **slower**, not faster: every param commits through three prop-drilled `useState` objects (`src/App.tsx:15`, `:18`, `:21`; 15 props into `Controls` at `:92-114`), so a `leva` store needs a bridge back into `updateBase`/`updateGeom`/`updateInlay` (`src/components/Controls.tsx:64-66`) that does not exist; `tailwind.config.js:4-7` is `theme:{extend:{}}` / `plugins:[]`, so there is no token layer to theme a third-party panel against; and the UI is three `hidden`-toggled panels in one scroll column (`src/components/Controls.tsx:370-406`), not a floating overlay.

[^cf]: Parent §8 M5 and recon §5 both say **27**. The verified static count of `<ControlField …>` JSX sites is **28** — 4 in `BaseControls.tsx` (`:97`, `:107`, `:121`, `:131`), 12 in `GeometryControls.tsx` (`:253`, `:307`, `:328`, `:344`, `:367`, `:387`, `:417`, `:442`, `:466`, `:490`, `:507`, `:523`), 11 in `InlayControls.tsx` (`:383`, `:456`, `:477`, `:530`, `:543`, `:571`, `:583`, `:599`, `:631`, `:652`, `:668`) and 1 in `ShapeUploader.tsx` (`:178`). `grep -rn '<ControlField' src/` returns 29 hits, the 29th being the definition at `src/components/ui/ControlField.tsx:14`. **The parent was amended 2026-09-04** — `docs/00-architecture.md` §8 M5 and §11 Q2 now both read 28. Recon §5's "27" is left as-is; the evidence base is not edited by hand.

So half A is **not** "choose a control library". It is: **make the layer that already exists data-driven, and give it the accessibility baseline it has never had.** `src/` today contains **zero** `aria-*` attributes, **zero** `role=`, **zero** `tabIndex`, and exactly **one** `htmlFor` (`src/components/ShapeUploader.tsx:181`). The only `Escape` handler in the tree clears a paint-tool selection and does not close anything (`src/components/SVGPaintModal.tsx:231`). There is no pattern to copy — this doc writes the first one.

**Half B — serialization and sharing. Blocked, and starting it early wastes the work.**
Save/load already ships as a JSZip bundle with real buttons (`src/utils/projectUtils.ts:29-87`, `:105-199`; `src/components/Controls.tsx:281-298`). Three things are broken underneath it:

1. **Geometry is not JSON-round-trippable.** Export nulls `cutoutShapes` (`src/utils/projectUtils.ts:46`) and `patternShapes` (`:53`) but spreads `inlay` **untouched** (`:48-50`), so live `THREE.Shape` objects are stringified into `project.json`. The import path calls the result **"garbage"** in a code comment and re-parses the zip asset instead (`src/components/Controls.tsx:222`); where no asset matches, the item keeps inert plain objects and the first `shape.getPoints()` throws.
2. **The version-migration path is dead code.** `versionMismatch` is computed at `src/utils/projectUtils.ts:179-181`, then `ProjectSchema.safeParse` against `version: z.literal(1)` (`src/types/schemas.ts:88`) rejects any other version and throws at `:187` — so the "Continue Anyway" dialog at `src/components/Controls.tsx:241-249` **can never render**. Bumping the literal today orphans every existing bundle with no migration and no working warning.
3. **`ProjectSchemaV1` is a plain non-strict `z.object`** (`src/types/schemas.ts:87-93`), so unknown keys are silently stripped. A field forgotten in a schema disappears from a saved design with no error.

Half B therefore designs `ProjectSchemaV2` **(new — does not exist yet)** with a *working* discriminator and a migrate step, moves geometry onto the already-proven `SerializedShape` wire form (`src/utils/geometry/serialize.ts:15-18`), and adds a URL share that carries **references and scalars only — never geometry**.

**One hazard spans both halves.** The regeneration dependency array at `src/components/ImperativeModel.tsx:897-903` is **hand-maintained**. A new setting omitted from it **never triggers regeneration** — already demonstrably broken for the three `debugShow*Cutter` props, which `buildJob` reads at `:857-859` and the array omits. Half A makes adding a param cheap, which is exactly when this gets forgotten. §6 ships a guard test for it.

## 2. Goals / Non-Goals

**Goals**

| # | Goal | Done when |
|---|---|---|
| G1 | Params render from descriptors, not hand-written JSX, over the **existing** primitives | A `GeometrySettings` field with `.default()` is added to a descriptor table and **renders and commits** with no new JSX. This is the rendering half only: reaching regeneration still requires the whole of parent rule 6 — T7 stays red until `src/components/ImperativeModel.tsx:897-903` names the identifier, and the model does not regenerate until `src/components/ModelViewer.tsx:48-54` destructures it and `:460-501` forwards it as a JSX attribute. |
| G2 | Descriptors support **derived** bounds — a bound expressed as a function of other state, not a literal | The cross-tab `maxDepth` case (`src/components/controls/InlayControls.tsx:56`, `:76-85`, `:659`, `:662`) is expressed as a descriptor with no local `useEffect` clamp |
| G3 | A `Slider` primitive exists in the controls tree | `src/components/ui/Slider.tsx` exists; the three divergent inline copies stop being the template |
| G4 | A keyboard- and screen-reader-usable control layer | T5's two assertions hold — every `ControlField` label resolves to a control, and every label group outside `ControlField` carries `role="group"` + an accessible name; all **three** pickers (outlines, patterns, inlays — one component, `src/components/controls/BaseControls.tsx:65`, `GeometryControls.tsx:177`, `InlayControls.tsx:270`) are reachable, Escape-dismissable and focus-restoring |
| G5 | One active-state visual convention, chosen and applied | Five treatments collapse to one token set (§4.2.5) |
| G6 | `ProjectSchemaV2` with a **reachable** version branch and a migrate step | A v1 bundle and a v2 bundle both import; a v99 bundle is refused with a real message instead of a generic throw |
| G7 | A design's geometry survives `JSON.stringify` → `JSON.parse` | No `THREE` object is ever stringified into `project.json` |
| G8 | A design is shareable as a URL carrying references + scalars + seed | A link restores a library-outline design bit-for-bit given M1 + M2 |

**Non-Goals**

- **No `leva`, and no other control library.** Settled — parent §11 Q2, evidence in §1.
- **No undo/redo.** The only history in the app is a 50-entry ref stack inside the paint modal (`src/components/SVGPaintModal.tsx:102`, `:155-182`), wiped on every open. App-level undo is listed under doc 05 in the recon's §5 table; it is not this doc.
- **No geometry in the URL.** No inline point encoding, no compression scheme, no link shortener, no backend (parent §3 Non-Goals). A design that cannot be described by references + scalars is refused with a named reason and told to use the `.zip`.
- **No autosave and no `localStorage` design persistence.** The app's only storage key is `welcome_modal_dismissed` (`src/App.tsx:30-33`); this doc does not add a second.
- **No restyling of view-only controls.** The three viewer sliders (`src/components/ModelViewer.tsx:327`, `:341`, `:355`) are view state under parent rule 3 and stay local and out of scope.
- **No fixing the 18 pre-existing `tsc` errors** (parent §4.1; `docs/_source/baseline-verification.md`'s "19" is stale). A green typecheck is not an acceptance criterion here.
- **No change to `PatternResult`, `patternPipeline.ts` or `geometryWorker.ts`.** This doc touches shape sources, controls and export only, per §10.
- **No new geometry representation.** There are already six (parent §5); this doc adds none.

## 3. Contract mapping (parent §5)

| Contract | This doc | Real type / attachment |
|---|---|---|
| **`Polygon`** | **Consumes. Adds nothing.** Persistence reuses the existing wire form rather than inventing a persisted one. | `SerializedShape { points: number[]; holes: number[][] }` — `src/utils/geometry/serialize.ts:15-18`. Convert only with `serializeShapes` / `deserializeShapes` (`:47-50`, `:69-72`). The coloured variant is structurally `InlayJobShape { shape: SerializedShape; color: string }` (`src/utils/geometry/inlayPipeline.ts:15-18`) — V2 reuses that shape, it does not coin a rival. **`SerializedGeometry` (`serialize.ts:21-25`) is NOT JSON-safe** — its fields are `Float32Array`/`Uint32Array`, which `JSON.stringify` turns into index-keyed objects. The STL pattern slot therefore stays a zip asset (§4.3.2). |
| **`Outline`** | **Consumes.** Also consumes `outlineRef` **(new — does not exist yet)**, which doc 01 / M1 adds to `BaseSettingsSchema`. | `BaseSettings.cutoutShapes` — `ThreeShapeSchema.nullable().optional().default(null)` at `src/types/schemas.ts:14`, where the schema asserts only `Array.isArray` (`:7`). The encode side reads `outlineRef` to fill the payload's `outline` union (§4.3.3) and never reads `cutoutShapes`; the payload's `base` block then **omits `outlineRef` as well**, so the reference is carried exactly once and in one shape. |
| **`ShapeSource`** | **Neither produces nor consumes.** Owned by docs 02 and 07. Named here only so nobody expects it. | — |
| **`Generator<P>`** | **Consumes.** This doc defines the **rendering** contract; doc 02 defines the generator contract and supplies the values. | `ParamDescriptor<S>` **(new — does not exist yet)**, §4.2.1. Generator params attach to `GeometrySettingsSchema` (`src/types/schemas.ts:66-85`) and **every new field needs `.default()`**, because `getDefaults` is `schema.parse({})` (`src/utils/schemaDefaults.ts:6-8`). Do **not** model a new schema on `InlayItemSchema` (`:19-46`) — it has no defaults and throws under `getDefaults`. |
| **`DesignState`** | **Produces.** Extends the existing type; the name `DesignState` stays retired. | `ProjectSchemaV1` → `ProjectData` (`src/types/schemas.ts:87-96`) is extended by **`ProjectSchemaV2`** and **`AnyProjectSchema`** **(both new — do not exist yet)**, §4.3.1. The URL payload is **`SharePayloadV1`** **(new — does not exist yet)**, §4.3.3 — a *different* type with a *different* version line, deliberately. |

**New names coined by this doc.** Every one is marked **(new)** at first use and appears nowhere in `src/` today (verified: `grep -rn` for each returns 0 hits):
`ParamDescriptor`, `ParamKind`, `ParamBase`, `NumberParam`, `OptionParam`, `ToggleParam`, `ColorParam`, `Derivable`, `ParamContext`, `ParamContextValue`, `ParamProvider`, `ParamField`, `resolveDerivable`, `clampToDescriptor`, `Slider`, `SwatchGrid`, `useModalDismiss`, `ProjectSchemaV2`, `ProjectV2`, `AnyProjectSchema`, `SerializedShapeSchema`, `PersistedShapeSchema`, `migrateProject`, `PROJECT_MIGRATIONS`, `CURRENT_PROJECT_VERSION`, `MigrateResult`, `VersionProbe`, `SharePayloadV1`, `SharePayloadV1Schema`, `encodeShareLink`, `decodeShareLink`, `ShareRefusal`.

---

## 4. Design

### 4.1 Split of work

| | Half A — param UI | Half B — serialization + share |
|---|---|---|
| Blocked by | nothing | V2/migrate: nothing · URL share: **M1 + M2** |
| Touches | `src/components/ui/**`, `src/components/params/**` (new), `src/utils/params/**` (new), three shared components | `src/types/schemas.ts`, `src/utils/projectUtils.ts`, `src/components/Controls.tsx`, `src/utils/project/**` (new), `src/utils/share/**` (new) |
| Risk | low — additive rendering over shipped primitives | medium — edits the only persistence path in the app |
| Ships alone? | **yes** | V2 + migrate: **yes**. URL share: no |

Tasks in §7 are ordered so half A lands first and half B's migrate step lands before its share codec.

### 4.2 Half A — the descriptor-driven control layer

#### 4.2.1 `ParamDescriptor` (new)

A descriptor is **metadata about a schema field**, never a second copy of it. The field itself lives in one of the three zod schemas (`src/types/schemas.ts:10-17`, `:19-46`, `:66-85`) per parent rule 3; the descriptor says how to render it. Keys are typed against the settings type, so a renamed schema field breaks compilation.

```ts
// src/utils/params/types.ts   (new)

/** A value that may be a literal or derived from current design state. */
export type Derivable<T> = T | ((ctx: ParamContextValue) => T);

/** Read-only view of design state used to resolve derived bounds. */
export interface ParamContextValue {          // (new)
  base: BaseSettings;
  inlay: InlaySettings;
  geometry: GeometrySettings;
  /**
   * The item the Inlay tab is editing, or null.
   * NOT a mirror of any existing state slot: App.tsx:24 holds `selectedInlayId:
   * string | null`, and the item is derived from it at InlayControls.tsx:87
   * (`items?.find(i => i.id === selectedInlayId)`). `Controls` already receives
   * both halves — `inlaySettings` (Controls.tsx:66) and `selectedInlayId` — so
   * the provider derives it there with the same expression. See I1.
   */
  selectedInlayItem: InlayItem | null;
}

export type ParamKind =                        // (new)
  | 'number' | 'slider' | 'select' | 'segmented' | 'toggle' | 'color';

interface ParamBase<S> {                       // (new)
  key: keyof S & string;         // must name a real schema field
  kind: ParamKind;
  label: string;
  tooltip?: string;
  helperText?: string;
  /** Hide without unmounting siblings. Mirrors the existing `{isTiled && …}` gates. */
  visible?: (ctx: ParamContextValue) => boolean;
  /** false = material/view-only, no CSG re-run. See §4.2.6. */
  regenerates: boolean;
}

export interface NumberParam<S> extends ParamBase<S> {   // (new)
  kind: 'number' | 'slider';
  min?: Derivable<number>;
  max?: Derivable<number>;
  step?: Derivable<number>;
  unit?: 'mm' | 'deg' | '×';
  /** Clamp to [min,max] on commit and echo the clamped value back. §4.2.4. */
  clamp?: boolean;
  /**
   * Placeholder shown when the field is unset. This is a *rename of shipped
   * behaviour*, not new work — `placeholder="Auto"` already ships at
   * GeometryControls.tsx:319 and :356.
   */
  emptyMeans?: string;           // e.g. 'Auto'
  /**
   * The sentinel the onChange commits when the field is cleared. It is NOT
   * uniform across the fields that need it: `patternScaleZ` writes `''`
   * (GeometryControls.tsx:316) and `patternMaxHeight` writes `undefined`
   * (:353). Carry it per-descriptor and never normalise the two — doing so
   * changes the persisted meaning of every existing bundle. §6.1 E1.
   * TypeScript cannot force this to accompany `emptyMeans` (`?:` already
   * admits `undefined`); the descriptor table must state it explicitly.
   */
  emptyValue?: '' | undefined;
}

export interface OptionParam<S> extends ParamBase<S> {   // (new)
  kind: 'select' | 'segmented';
  options: Derivable<Array<{ value: string; label: string; icon?: React.ReactNode }>>;
}

export interface ToggleParam<S> extends ParamBase<S> { kind: 'toggle'; }  // (new)
export interface ColorParam<S>  extends ParamBase<S> { kind: 'color'; }   // (new)

export type ParamDescriptor<S> =               // (new)
  NumberParam<S> | OptionParam<S> | ToggleParam<S> | ColorParam<S>;
```

`resolveDerivable` **(new)** is one pure function — `(d, ctx) => typeof d === 'function' ? d(ctx) : d` — and lives in `src/utils/params/resolve.ts` **(new)** so it falls inside the Vitest coverage allowlist (`vite.config.ts:30-35` includes `src/utils/**` and excludes almost all of `src/components/**`).

**Worked example — the derived bound that motivates all of this.** Today `maxDepth` is computed inline in the Inlay panel (`src/components/controls/InlayControls.tsx:56`), re-clamped by a `useEffect` on `baseThickness` (`:76-85`), applied again inside the `onChange` (`:659`) and passed as an HTML `max` (`:662`) that is inert because `DebouncedInput` never validates and nothing calls `checkValidity` (`src/components/DebouncedInput.tsx:43-47`). As a descriptor it is one expression:

```ts
{
  key: 'depth', kind: 'number', label: 'Inlay Depth (mm)', unit: 'mm',
  min: 0.1,
  max: (ctx) => Math.max(0.1, parseFloat((ctx.base.thickness - 0.1).toFixed(2))),
  step: 0.1, clamp: true, regenerates: true,
  tooltip: 'How deep this inlay cuts into the base',
}
```

The `useEffect` at `:76-85` still has a job the descriptor cannot do — retro-clamping items already stored above the new maximum when `thickness` drops — so **leave it**. The descriptor replaces `:659` and `:662`, not `:76-85`.

#### 4.2.2 `ParamContext` (new) — read-only, deliberately

Derived bounds need cross-tab state: `maxDepth` lives on the Inlay tab and derives from `baseSettings.thickness` on the Base tab. Today that crosses as an explicit prop (`src/components/Controls.tsx:388`). Prop-drilling one more level per bound does not scale.

`ParamProvider` **(new)**, in `src/context/ParamContext.tsx` **(new)**, wraps the three `<Freeze>` blocks in `Controls.tsx` (insertion point: `src/components/Controls.tsx:368`, immediately inside the scroll container). It is the second context in the app; `src/context/` holds only `AlertContext` today (`src/context/AlertContext.tsx:20`).

**It exposes reads only.** Writes continue to go through the existing `updateBase` / `updateGeom` / `updateInlay` closures (`src/components/Controls.tsx:64-66`). This is not negotiable: the app already has one out-of-band state channel — the untyped `eventBus` singleton whose single production event bypasses React during a drag (`src/utils/eventBus.ts`, emitted `src/components/interaction/InlayInteractionHandles.tsx:274`, consumed `src/components/ImperativeModel.tsx:799`) — and a writable design context would be a second.

Note `react-freeze` (`package.json:34`): a panel does not mount until its tab is first visited (`src/components/Controls.tsx:370-406`). A frozen consumer re-reads context on unfreeze, so bounds are correct on first paint — but **no `ParamField` mount effect may be load-bearing for restoring a shared link**, because the panel may never have mounted. §4.3.4 restores into state, not into fields.

#### 4.2.3 `ParamField` (new) — the renderer

`src/components/params/ParamField.tsx` **(new)**. It renders **through** the existing primitives; it does not replace them.

| `kind` | Renders | Existing primitive reused |
|---|---|---|
| `number` | numeric input inside a labelled field | `ControlField` (`src/components/ui/ControlField.tsx:14-50`) + `DebouncedInput` (`src/components/DebouncedInput.tsx:20-49`) |
| `slider` | range input + live value readout | `ControlField` + `Slider` **(new)**, §4.2.7 |
| `select` | styled `<select>` with the chevron overlay | the existing markup at `src/components/controls/GeometryControls.tsx:388-410`, extracted verbatim |
| `segmented` | option row | `SegmentedControl` (`src/components/ui/SegmentedControl.tsx:16-43`) — already renders from an `options` array; **this is the precedent the whole descriptor idea extends** |
| `toggle` | on/off button | `ToggleButton` (`src/components/ui/ToggleButton.tsx:12-33`) |
| `color` | 21-swatch grid | `SwatchGrid` **(new)** over `COLORS` (`src/constants/colors.ts:1-23`) |

**Colour convention — decided.** Parent §4.1 requires this doc to state which convention a colour param follows. **The in-panel 21-swatch grid wins.** It is what both control files already do, duplicated verbatim (`src/components/controls/BaseControls.tsx:143-156`; `src/components/controls/GeometryControls.tsx:549-566`); `react-colorful` is imported once and rendered once, inside the paint modal behind a toggle (`src/components/SVGPaintModal.tsx:2`, `:1143`). `SwatchGrid` extracts the duplicated grid; the two call sites then use it. The schema stays `z.string()` (`src/types/schemas.ts:13`), so an arbitrary hex arriving from an imported bundle still round-trips even though the picker offers 21.

Descriptor tables live beside the renderer: `src/components/params/descriptors/{base,geometry,inlay}.ts` **(new)**. They are in `src/components/` rather than `src/utils/` because option entries may carry `icon?: React.ReactNode` (`SegmentedControlOption` already does — `src/components/ui/SegmentedControl.tsx:6`). All *pure* logic — `resolveDerivable`, `clampToDescriptor` **(new — does not exist yet)**, share/migrate code — lives under `src/utils/**` so it is inside the coverage allowlist. `clampToDescriptor(value, descriptor, ctx) => number` resolves the descriptor's `min`/`max`/`step` through `resolveDerivable` and returns the value clamped inclusively to that range; it is the helper §4.2.4's `clamp: true` calls and the one T1 pins.

**Migration is incremental.** `ParamField` is additive: a panel can render three descriptors and twenty hand-written fields at once. Do not rewrite all three panels in one commit.

#### 4.2.4 The clamp-echo defect, and the one shared-file change that fixes it

`DebouncedInput` holds a local copy of its value (`src/components/DebouncedInput.tsx:26`), syncs it from the prop in an effect keyed on `initialValue` (`:28-30`), and fires `onChange` after the debounce only when local ≠ prop (`:32-40`).

**Failure, reachable today.** `maxDepth` is 0.5 and `depth` is already 0.5. The user types `9`. After 150 ms, `onChange('9')` fires; the parent clamps to `Math.min(maxDepth, …)` (`src/components/controls/InlayControls.tsx:659`) and writes 0.5 — the value it already held. The parent **does** re-render (`updateItem` builds a new `items` array and a new item object at `src/components/controls/InlayControls.tsx:90-95`, and `updateInlay` spreads into a fresh `InlaySettings` at `src/components/Controls.tsx:66` — React never bails here). The defect is narrower and entirely in the dependency list: `initialValue` is the same **primitive** (0.5), so the dep array `[initialValue]` at `:28-30` is unchanged, the sync effect never re-runs, **and the input keeps displaying `9` while the model is 0.5.** Worse, because each call site passes a fresh inline arrow as `onChange`, the timer effect's dependency list (`:40`) changes on every parent render, re-arming the timer and re-firing the rejected value. The numeric path of this component has **no test** — the existing suite covers a text value only (`src/components/DebouncedInput.test.tsx:17-38`).

**Fix — one additive prop, default-inert:**

```ts
// src/components/DebouncedInput.tsx
interface DebouncedInputProps … { revision?: number }      // (new prop)
useEffect(() => { setValue(initialValue); }, [initialValue, revision]);   // :28-30
```

`ParamField` increments a local `revision` counter whenever its clamp actually changed the committed value, forcing the echo. With `revision` omitted the component's behaviour is byte-identical, so the other 17 call sites are unaffected and the diff stays upstream-mergeable (parent rule 6).

Rejected alternatives: remounting via `key` (loses focus mid-typing, and clamping fires on every debounced keystroke — typing `0.05` transits `0`, `0.`, `0.0`); moving clamping into `DebouncedInput` (changes semantics for 17 call sites and re-introduces the inert-`max` problem).

#### 4.2.5 Accessibility baseline — net-new, and the single biggest chunk of half A

Nothing here is inherited. Verified counts across all of `src/`: `aria-*` **0**, `role=` **0**, `tabIndex` **0**, `htmlFor` **1** (`src/components/ShapeUploader.tsx:181`).

| # | Deliverable | Where | Note |
|---|---|---|---|
| A1 | **Label association.** `ControlField` generates an id with `React.useId()` and renders `<label htmlFor={id}>`. Its `children` prop (`src/components/ui/ControlField.tsx:9`) additionally accepts `(p: {id: string; describedBy?: string}) => ReactNode`; `ParamField` always uses that form. For the plain-`ReactNode` form, a guarded `cloneElement` injects `id` when the single child is a form control. | `src/components/ui/ControlField.tsx:14-50` | Both forms compile at all 28 existing call sites unchanged. Where the child is a wrapper `<div>` around a `<select>` (`src/components/controls/GeometryControls.tsx:388-410`), injection is a no-op — those fields associate only once migrated to `ParamField`, which is why A1 and the descriptor migration ship together. |
| A2 | **Tooltip is keyboard-reachable and announced.** The `Info` trigger becomes `<button type="button">`; the portal body gets `id` + `role="tooltip"`; the trigger gets `aria-describedby`; `focus`/`blur` join `mouseenter`/`mouseleave`. | `src/components/ui/Tooltip.tsx:38-56`, `:58-72` | Today the trigger is a `<div>` with mouse handlers only and the body is `pointer-events-none` (`:60`). |
| A3 | **Dropzone is focusable in both states.** Two separate defects, both required: (a) `className="hidden"` → `sr-only` on the file input; (b) **render the input unconditionally** — drop the `{!hasContent && …}` gate so it exists in the loaded state as well, keeping the `hasContent` branch only for the visible content at `:207-225`. Add a `focus-within` ring on the label. | `src/components/ShapeUploader.tsx:227` (both), `:174` (`hasContent`) | `hidden` is `display:none`, so the input cannot take focus and the one existing `htmlFor` (`:181`) buys nothing. The gate is the worse half: with an outline loaded — the normal state after any use — there is **no input in the DOM at all**, so `sr-only` alone fixes nothing and `getByLabelText` finds nothing. |
| A4 | **Picker tiles are buttons.** `<div onClick>` → `<button type="button">` with `aria-pressed` for the current selection. | `src/components/PatternLibraryModal.tsx:160-166` | This is **all three** pickers — outlines, inlays and patterns use the same modal, filtered by `category` (`src/components/controls/BaseControls.tsx:65` `category="outlines"` at `:68`; `GeometryControls.tsx:177`, which passes none and takes the `'patterns'` default at `PatternLibraryModal.tsx:75`; `InlayControls.tsx:270` `category="inlays"` at `:273`). |
| A5 | **Modal dismissal + focus management.** `useModalDismiss(ref, onClose)` **(new)** in `src/hooks/useModalDismiss.ts` **(new folder)**: Escape closes, focus is trapped inside while open, focus returns to the trigger on close, `role="dialog"` + `aria-modal="true"` + `aria-labelledby` on the shell. | applied to `src/components/PatternLibraryModal.tsx` | **There is no existing pattern to copy.** The only `Escape` handler in `src/` clears a paint selection (`src/components/SVGPaintModal.tsx:231`); `AlertModal`'s only key handler is Enter-to-confirm on its optional text input (`src/components/AlertModal.tsx:96-101`). `AlertModal` and `SVGPaintModal` are explicit follow-ups, not this doc. |
| A6 | **Visible focus, one colour.** `ui/Button.tsx:22` already sets `focus-visible:ring-2 focus-visible:ring-offset-2` but **no ring colour**, so Tailwind 3's default blue-500 applies while every input uses `focus:ring-purple-500`. Add `focus-visible:ring-purple-500` there, and add the same to `ToggleButton`, `SegmentedControl` and the swatch buttons. | `src/components/ui/Button.tsx:22`; `ui/ToggleButton.tsx:24-28`; `ui/SegmentedControl.tsx:30-34`; `SwatchGrid` | `tailwind.config.js:4-7` has no theme extension, so there is no `ringColor` default to change centrally. |
| A7 | **Label groups that have no single target.** Four `<label>` elements sit outside `ControlField` and can never take an `htmlFor`, because each labels a *set* of controls: the two colour grids (a label over 21 `<button>`s) and the two "Layout Mode" labels (a label over a `SegmentedControl`, which is a `<div>` of buttons — `ui/SegmentedControl.tsx:23-41`). Each wrapper gets `role="group"` plus `aria-labelledby` pointing at the existing `<label>`'s `id` (or `aria-label` where the text is not worth an id). `SwatchGrid` (§4.2.3) carries this for the two colour cases, so A7's colour half lands with A-8. | `src/components/controls/BaseControls.tsx:143-156` (label `:144`) · `GeometryControls.tsx:549-566` (label `:550`) · `GeometryControls.tsx:219-222` (label `:220`) · `InlayControls.tsx:438-441` (label `:439`) | These four are why T5 is stated as **two** assertions, not one. A bare `<label>` with no `htmlFor` is not a defect to be fixed by giving it one — there is no element to point at. The `ShapeUploader` dropzone is a fifth non-`ControlField` case but is **not** here: it has a real `htmlFor`/input pair (`:180-181`, `:227`) and is A3's job; its `ControlField` child is a wrapper `<div>` (`:179`), so A1's injection is a no-op there and it will never become a `ParamField` (a file dropzone is not one of the six `ParamKind`s). |

**Active-state convention — decided (parent §7 requires this doc to pick one).** Five treatments exist: `ToggleButton` purple/10 (`src/components/ui/ToggleButton.tsx:24-28`), the inlay row purple/20 (`src/components/controls/InlayControls.tsx:220-223`), `SegmentedControl` **gray + white ring** (`src/components/ui/SegmentedControl.tsx:30-34`), swatches `ring-2 ring-white` (`src/components/controls/BaseControls.tsx:150`), and the viewer toggles in indigo and pink (`src/components/ModelViewer.tsx:313`, `:369`).

**The canonical active token set is `ToggleButton`'s:** `bg-purple-500/10 text-purple-400 border-purple-500`. Purple is already the focus colour on every text input and the brand gradient's left stop (`src/components/Controls.tsx:328`). `SegmentedControl` is the outlier and gets aligned in its own commit, because it also styles the top-level tab bar (`src/components/Controls.tsx:355-363`) and that is a visible change worth isolating. Swatches keep `ring-2 ring-white` — a purple tint over a purple swatch is unreadable — but gain the purple focus ring from A6. `src/components/ui/Badge.tsx` is dead code (zero importers): either use it for the active-source label or delete it, but do not leave it as a third convention.

#### 4.2.6 The regeneration hazard, and the guard

`buildJob` reads settings and posts a `PatternJob`; the effect that calls it re-runs only when something in the hand-maintained array at `src/components/ImperativeModel.tsx:897-903` changes. **All schema fields `buildJob` reads are currently listed; the three `debugShow*Cutter` props it reads at `:857-859` are not** — a shipped, silent bug and the proof the array drifts.

Every descriptor carries `regenerates: boolean`. A guard test (§6.2 T7) reads two files as text and asserts **three** things for every geometry descriptor with `regenerates: true`:

1. the identifier appears in the dependency-array literal in `ImperativeModel.tsx`, located by its anchor comment (`:894-896`, **not** by line number — line numbers drift on every upstream merge);
2. the identifier is declared in `ImperativeModelProps` (`src/components/ImperativeModel.tsx:15-54`);
3. the identifier is forwarded as a JSX attribute on `<ImperativeModel>` in `src/components/ModelViewer.tsx:460-501`, and destructured off `geometrySettings` at `:48-54`.

Checks 2 and 3 exist because check 1 alone cannot see parent rule 6's *"step most often missed"*: a prop `ModelViewer` never forwards. That failure **compiles** — the props are declared optional (`ImperativeModel.tsx:49-51` declares the three `debugShow*Cutter` props as `?: boolean`) — and there is no typecheck gate to catch it either, because there is **no `typecheck` script** and 19 `tsc` errors already stand (`docs/_source/baseline-verification.md`; §2 Non-Goals). All three checks are text checks against the same anchor style, so the cost of 2 and 3 is a few lines each.

The guard is **green today** for check 1 (all schema fields `buildJob` reads are listed) and fails the first time a param is added to a descriptor table without walking the seven-step chain in parent rule 6.

#### 4.2.7 `Slider` (new)

There is **zero** `type="range"` in the controls tree. Three divergent inline copies exist elsewhere: `src/components/ImageConversionModal.tsx:133-143` (label + right-aligned value readout — the best-formed template), `src/components/ModelViewer.tsx:327`, `:341`, `:355` (view-only), and `src/components/SVGPaintModal.tsx:1065`, `:1104`, `:1120`.

`src/components/ui/Slider.tsx` **(new)** generalises the `ImageConversionModal` template: `accent-purple-500`, `h-2` track, a value readout, `aria-valuetext` carrying the unit, `min`/`max`/`step` resolved from the descriptor, and — unlike the raw inputs — commit through the same debounce path as `DebouncedInput` so a drag does not fire one CSG job per pixel (the worker client coalesces at `src/utils/geometry/patternClient.ts:56`, `:63`, but the 150 ms debounce is what keeps the queue shallow — `src/components/DebouncedInput.tsx:9-18`).

#### 4.2.8 The 4th tab

The Generate tab shell is this doc's; its **contents** are doc 02's descriptor table. Ordering: parent §6 phases 04 after 02, so the table exists by the time the tab does. Widen the union in **both** places or it will not compile: `src/components/Controls.tsx:30-31` and `src/App.tsx:36`. Add the option at `src/components/Controls.tsx:358-361` and a fourth `<Freeze>` block at `:397-406`. If no generator is registered, the panel renders an explicit empty state — never a blank tab.

### 4.3 Half B — serialization and sharing

#### 4.3.1 `ProjectSchemaV2` (new) and a discriminator that actually works

> **D3 resolution — adopted by @liamstar, 2026-09-04.** Doc 07 §4.5's synthetic `<name>.shapes.json` zip asset is the sole mechanism for source-less geometry and edits to an existing source; edited geometry supersedes that source asset.
>
> | Doc | Mechanism | Where the bytes live |
> |---|---|---|
> | **04** (this §4.3.1/§4.3.2) | **STRUCK (D3):** all three `ProjectSchemaV2.shapes` keys — `cutoutShapes`, `patternShapes`, `inlayShapes` | no inline geometry in `project.json` |
> | **05** §4.3 | **STRUCK (D3):** `InlayItemSchema.editedShapes` | replaced by doc 07 §4.5 |
> | **07** §4.5 | **ADOPTED (D3):** `serializeShapeAsset` → a synthetic `<name>.shapes.json` zip entry | a zip asset, superseding any original source for that inlay id |
>
> **Declare `SerializedShapeSchema` exactly once**, here in `src/types/schemas.ts` (task B-1); docs 05 and 07 import it. **Keep `PersistedShapeSchema`:** its consumer moves from the struck `shapes.inlayShapes` block to P9 commit 102's shape-asset element; doc 07 imports it rather than redeclaring `{ shape, color? }`. `ProjectSchemaV2`'s remaining keys, the discriminator, migration and live-shape leak fix still ship.

```ts
// src/types/schemas.ts — appended after ProjectSchemaV1 (:87-93). V1 is NOT modified.

/** Geometry, as it already crosses the worker boundary. serialize.ts:15-18. */
export const SerializedShapeSchema = z.object({          // (new)
  points: z.array(z.number()),
  holes:  z.array(z.array(z.number())).default([]),
});

/**
 * Mirrors InlayJobShape (inlayPipeline.ts:15-18) with `color` RELAXED to
 * optional. Not structurally identical: InlayJobShape.color is a required
 * string. The relaxation is deliberate — `item.shapes` is z.array(z.any())
 * (schemas.ts:22) and may hold bare THREE.Shape entries with no colour
 * wrapper; shapeLoader.ts:53 produces the wrapper form only for coloured SVG.
 */
export const PersistedShapeSchema = z.object({           // (new)
  shape: SerializedShapeSchema,
  color: z.string().optional(),
});

export const ProjectSchemaV2 = z.object({                // (new)
  version: z.literal(2),
  timestamp: z.number(),
  base:     BaseSettingsSchema,
  inlay:    InlaySettingsSchema,
  geometry: GeometrySettingsSchema,
  // STRUCK (D3): all three inline-geometry keys; doc 07 §4.5 owns their zip assets.
  // shapes: z.object({
  //   cutoutShapes:  z.array(SerializedShapeSchema).nullable().default(null),
  //   patternShapes: z.array(SerializedShapeSchema).nullable().default(null),
  //   inlayShapes:   z.record(z.string(), z.array(PersistedShapeSchema)).default({}),
  // }).default({ cutoutShapes: null, patternShapes: null, inlayShapes: {} }),
});

export type ProjectV2 = z.infer<typeof ProjectSchemaV2>;  // (new)

export const AnyProjectSchema =                          // (new)
  z.discriminatedUnion('version', [ProjectSchemaV1, ProjectSchemaV2]);

export const CURRENT_PROJECT_VERSION = 2;                // (new)
```

`ProjectV2` is the V2 counterpart of the existing `ProjectData` alias (`src/types/schemas.ts:96`); `ProjectData` itself is **not** repointed, so V1 call sites keep compiling.

`z.discriminatedUnion` is available in the pinned zod 4.2.0 (`node_modules/zod/v4/classic/schemas.d.cts:490`; `package.json:40`).

**Why `shapes` is a sibling block rather than fixing `cutoutShapes` / `patternShapes` in place.** Those fields hold **live `THREE.Shape` objects in React state** and are typed `z.custom(Array.isArray)` (`src/types/schemas.ts:7`, `:14`, `:67`). Re-typing them would make the in-memory settings objects fail their own schema and would force a conversion at every read site. Keeping the runtime fields exactly as they are and adding a **parallel JSON-only block written at export and consumed at import** is the smallest change that makes `project.json` pure JSON — and it adds no seventh geometry representation, because `SerializedShape` is representation #4 already (parent §5).

**Version-bump policy — state it and hold to it.** An **additive** field carrying `.default()` does **not** bump the version; zod fills it for older files. Only a field whose meaning changes, or which is removed, bumps. This keeps the migration registry small and means M2's `seed` and M1's `outlineRef` can land after V2 without forcing a V3.

**The silent-stripping hazard.** `ProjectSchemaV1` is non-strict (`src/types/schemas.ts:87-93`), so unknown keys vanish without warning — the central hazard for any V2 plan. V2 stays non-strict (strictness would reject forward-compatible files we want to at least partially read), and the mitigation is explicit instead: `migrateProject` diffs the raw JSON's key set against the parsed result and returns `unknownKeys: string[]`, which `Controls` surfaces through `AlertContext` (`src/context/AlertContext.tsx:16-20`) rather than dropping on the floor.

#### 4.3.2 `migrateProject` (new)

`src/utils/project/migrate.ts` **(new)** — under `src/utils/**`, therefore inside the coverage allowlist.

```ts
export type MigrateResult =                              // (new)
  | { ok: true;  data: ProjectV2; migratedFrom: number; unknownKeys: string[] }
  | { ok: false; reason: 'not-a-project' | 'newer-version' | 'unsupported-version'
                        | 'invalid'; foundVersion?: number; issues?: string[] };

const VersionProbe = z.object({ version: z.number() });  // (new) — strips everything else; that is fine

export const PROJECT_MIGRATIONS: Record<number, (d: any) => any> = {  // (new)
  1: (v1) => ({ ...v1, version: 2,
                /* STRUCK (D3): shapes defaults; geometry remains in zip assets. */ }),
};

export function migrateProject(raw: unknown): MigrateResult { /* … */ }   // (new)
```

Order of operations, and why each step exists:

1. `VersionProbe.safeParse(raw)` → no numeric `version` ⇒ `not-a-project`. **This step is why the current dialog is dead.** Today the mismatch flag is computed at `src/utils/projectUtils.ts:178-181`, then `ProjectSchema.safeParse` at `:183` fails against the V1 literal (`src/types/schemas.ts:88`) — `safeParse` does not throw, that is the point of it — and the explicit `throw` at `:187` discards the flag before `src/components/Controls.tsx:241-249` can ever render it. Probing the version *before* parsing is what makes the flag survive.
2. `version > CURRENT_PROJECT_VERSION` ⇒ `newer-version`. **This is the branch that makes the "Continue Anyway" dialog reachable for the first time.**
3. no entry in `PROJECT_MIGRATIONS` and not current ⇒ `unsupported-version`.
4. parse against the matching union member; on failure return `invalid` with `issues` from the zod error (do not throw — the current path throws a single opaque string at `src/utils/projectUtils.ts:187`).
5. apply migrations in ascending order to reach `CURRENT_PROJECT_VERSION`.
6. diff key sets, return `unknownKeys`.

**Export side.** `exportProjectBundle` (`src/utils/projectUtils.ts:29-87`) changes at **three** lines, plus **one new block**. Two rows below are marked *unchanged* and one *keep* — they are listed because they are the lines an implementer will expect to edit and must not:

| Line today | Change |
|---|---|
| `:41` `version: 1` | `version: 2` |
| **new sibling key after `:53`** | **STRUCK (D3):** no `shapes` block is written; doc 07 §4.5 owns the zip assets |
| `:46` `cutoutShapes: null` | unchanged — **STRUCK (D3):** inline `shapes.cutoutShapes`; retain the raw outline zip asset |
| `:48-50` `inlay: { ...inlay }` | **the bug.** Spreads live `THREE.Shape`s into JSON. Becomes `inlay: { items: items.map(i => ({ ...i, shapes: [] })) }`. **STRUCK (D3):** `shapes.inlayShapes[item.id]`; real geometry travels through doc 07 §4.5's zip asset using `PersistedShapeSchema` |
| `:53` `patternShapes: null` | unchanged — **STRUCK (D3):** inline `shapes.patternShapes`; generated shapes use doc 07 §4.5a's zip asset, and the existing STL zip asset remains the source for `THREE.BufferGeometry` |
| `:42` `timestamp: Date.now()` | keep in the bundle; **exclude from the share payload** — it makes any design hash unstable (parent §7) |

**Import side.** `importProjectBundle` (`:105-199`) routes through `migrateProject` and returns `MigrateResult` instead of throwing. `Controls.handleImportClick` (`src/components/Controls.tsx:160-262`) then re-hydrates in a **defined precedence**:

> **zip asset (byte-exact re-parse) → `shapes.*` block → empty.**

Assets keep priority because re-parsing the original file is the only path that preserves curves and units; the serialized block is already flattened at `getPoints()`'s 12 divisions (`src/utils/geometry/serialize.ts:29-32`). The block's job is the case that has **no** asset — a painted or traced inlay — which recon names as doc 07's real blocker (`src/components/controls/InlayControls.tsx:131`, `:152`). That the fix falls out of V2 is a bonus; doc 07 still owns the UX. The **14-line** comment block at `src/components/Controls.tsx:211-224` — the run of full-line comments inside the inlay re-hydration branch, containing "JSON shapes are garbage" at `:222` — is deleted, because it stops being true.

#### 4.3.3 `SharePayloadV1` (new) — references and scalars, never geometry

A **separate** type with its **own** version line, so a project-schema bump does not silently invalidate every link in the wild.

```ts
// src/utils/share/shareSchema.ts   (new)
export const SharePayloadV1Schema = z.object({           // (new)
  v: z.literal(1),                       // payload format version
  p: z.number(),                         // ProjectSchema version the settings conform to
  seed: z.number().int(),                // doc 08 / M2
  outline: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('preset'), id: z.string() }),   // needs PatternPreset.id — M1
    z.object({ kind: z.literal('none') }),
  ]),
  pattern: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('preset'),    id: z.string() }),
    z.object({ kind: z.literal('generator'), id: z.string(),
               params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])) }),
    z.object({ kind: z.literal('none') }),
  ]),
  // outlineRef is omitted too: the `outline` union above is the single carrier
  // of the outline reference. Omitting only cutoutShapes would put the same
  // reference in the payload twice, in two shapes, with no stated precedence.
  // The second key lands with M1, which is when outlineRef starts existing.
  base:     BaseSettingsSchema.omit({ cutoutShapes: true, outlineRef: true }),
  geometry: GeometrySettingsSchema.omit({ patternShapes: true }),
  inlay:    z.object({ items: z.array(InlayItemSchema.omit({ shapes: true })
                                        .extend({ ref: z.object({ kind: z.literal('preset'),
                                                                  id: z.string() }) })) }),
});
```

**Transport.** `location.hash`, not the query string, and written with `history.replaceState` on an explicit **Share** click — never on every param change (that would spam history and serialize on every keystroke). The hash is chosen because it never reaches the server: GitHub Pages is static, and a fragment stays out of request logs and the `Referer` header. There is no router in the app to fight (`package.json:17-41` has no routing dependency).

**Encoding.** `base64url(JSON.stringify(payload))`, field names as written — readable and debuggable in a bug report. **No compression in v1.** A scalar-only payload of ~45 fields plus a handful of inlay items is a few hundred bytes of JSON; §6.3 pins a hard **2000-character** budget on the whole URL and refuses above it. If the budget is ever exceeded, the escape hatch is `JSZip`'s DEFLATE → base64 (`package.json:26`, already a direct dependency); `pako` is only a transitive dependency of JSZip and must not be imported directly.

**Decoding is untrusted input.** Decode → `safeParse` → and only then touch state. The payload has no geometry fields at all, so a malicious link cannot inject shapes; §6.3 asserts that property directly.

**Refusals — and which function raises them.** Both codec functions return `ShareRefusal` **(new)** with a named reason rather than a partial design. **They do not share a reason set.** Four of the six reasons are properties of the *live design being encoded* and are unobservable from an inbound hash; putting those checks in `decodeShareLink` would put them in a function that can never evaluate them.

```ts
// src/utils/share/shareSchema.ts   (new), continued
export type SharePayloadV1 = z.infer<typeof SharePayloadV1Schema>;   // (new)

export type ShareRefusal = {                         // (new)
  ok: false;
  reason: 'custom-outline' | 'custom-pattern' | 'unreferenceable-inlay'
        | 'too-long' | 'unsupported-payload' | 'invalid-payload';
  /** User-facing text. Every message names the .zip bundle. §6.3. */
  message: string;
};

// src/utils/share/shareCodec.ts   (new)
export function encodeShareLink(state: ParamContextValue):
  | { ok: true; url: string }
  | ShareRefusal;                                    // (new)

export function decodeShareLink(hash: string):
  | { ok: true; payload: SharePayloadV1 }
  | ShareRefusal;                                    // (new)
```

| Reason | Raised by | Trigger |
|---|---|---|
| `custom-outline` | `encodeShareLink` | outline came from an upload, so there is no `outlineRef` **to record** (`src/components/controls/BaseControls.tsx:31-38`) |
| `custom-pattern` | `encodeShareLink` | pattern slot holds an uploaded STL (`src/components/controls/GeometryControls.tsx:163`) |
| `unreferenceable-inlay` | `encodeShareLink` | an inlay item's shapes have no preset id — painted, traced, or uploaded |
| `too-long` | `encodeShareLink` | the URL it just built is > 2000 characters |
| `unsupported-payload` | `decodeShareLink` | `v` parses but is not 1 |
| `invalid-payload` | `decodeShareLink` | the hash is absent, is not valid base64url, is not JSON, or fails `SharePayloadV1Schema.safeParse` — the hostile-or-truncated case (E11) |

Every refusal message names the `.zip` bundle as the working alternative. This is exactly parent §8's M5 boundary: *"a share link reproduces a design using a library outline plus scalars plus a seed; custom uploads are explicitly out of scope absent an inline geometry encoding."*

#### 4.3.4 Applying a link on load

Read `location.hash` **once**, in `src/App.tsx` (beside the existing warm-up effect at `:42-44`), and apply through the same three setters the import path uses (`:15`, `:18`, `:21`). Three consequences the existing import path already gets wrong and a link restore hits harder, because a link is the *first* thing a session sees:

1. **`selectedInlayId` is never reconciled.** Import sets only the three settings (`src/components/Controls.tsx:236-238`), and the auto-select effect's dependency list is `[items && items.length]` (`src/components/controls/InlayControls.tsx:73`) — so restoring a design with the same item count but different uuids leaves the Selected Layer panel silently blank. A link restore must set `selectedInlayId` explicitly (`src/App.tsx:24`).
2. **`projectAssets` is component-local** (`src/components/Controls.tsx:81`), is not lifted to `App`, and is not cleared by Reset (`src/App.tsx:58-63`). A link restore must clear it, or the next **Export Project** bundles the *previous* design's asset files. Recon's §5 table already lists "lift `projectAssets` out of `Controls`" as an S-sized 04 task; do it here.
   **Reconciling with parent rule 3.** Rule 3 names `projectAssets` (`src/components/Controls.tsx:81`) in its list of view-only state that "stays local and is explicitly out of scope". Lifting it does **not** breach that: rule 3 governs *schema membership* — what must live in one of the three settings schemas and round-trip through `ProjectSchemaV1` — not which component owns a `useState`. After the lift `projectAssets` is still plain React state, still in no schema, still never persisted as design state. Read literally, rule 3's "stays local" forbids the lift; that phrasing is worth an amendment against the parent, but the work stands.
3. **Panels may never have mounted.** `react-freeze` means a tab's contents do not exist until first visited (`src/components/Controls.tsx:370-406`), so restoration must land in state, never in a field's mount effect.

### 4.4 File layout

```
NEW — no shared file touched
  src/utils/params/types.ts               ParamDescriptor, Derivable, ParamContextValue
  src/utils/params/resolve.ts             resolveDerivable, clampToDescriptor
  src/utils/params/resolve.test.ts
  src/utils/project/migrate.ts            migrateProject, PROJECT_MIGRATIONS, MigrateResult
  src/utils/project/migrate.test.ts
  src/utils/share/shareSchema.ts          SharePayloadV1Schema, ShareRefusal
  src/utils/share/shareCodec.ts           encodeShareLink, decodeShareLink
  src/utils/share/shareCodec.test.ts
  src/components/params/ParamField.tsx
  src/components/params/ParamField.test.tsx
  src/components/params/descriptors/{base,geometry,inlay}.ts
  src/components/ui/Slider.tsx
  src/components/ui/SwatchGrid.tsx
  src/context/ParamContext.tsx            ParamProvider — READ-ONLY
  src/hooks/useModalDismiss.ts            (new folder: src/hooks/)
```

### 4.5 Shared files touched — and why isolation is impossible for each

Parent rule 6: *accept that folder isolation is not achievable and budget single-line insertions.* Never reformat — there is no Prettier and no EditorConfig, and indentation is mixed.

| File : line | Change | Why a new file cannot do it |
|---|---|---|
| `src/components/ui/ControlField.tsx:9`, `:14-50` | `useId` + `htmlFor`; `children` also accepts a render function | It is the single wrapper all 28 fields already use. A parallel wrapper forks the panel layout and leaves the other 28 fields unlabelled forever. |
| `src/components/DebouncedInput.tsx:28-30` | add `revision?: number` to the sync-effect deps | The clamp-echo defect *is* this effect, and 17 call sites depend on the component. Default-inert (§4.2.4). |
| `src/components/ui/Tooltip.tsx:38-56`, `:58-72` | button trigger, `role="tooltip"`, `aria-describedby` | Rendered by `ControlField:30`; a rival tooltip would be a second convention. |
| `src/components/ui/Button.tsx:22` · `ui/ToggleButton.tsx:24-28` · `ui/SegmentedControl.tsx:30-34` | `focus-visible:ring-purple-500`; align the active state | `tailwind.config.js:4-7` extends nothing, so there is no central token to change. |
| `src/components/ShapeUploader.tsx:227` | `hidden` → `sr-only` **and** drop the `{!hasContent && …}` gate so the input exists in the loaded state too | The input is inside the component; nothing else can reach it. Both halves are required — §4.2.5 A3. |
| `src/components/PatternLibraryModal.tsx:160-166` | tiles → `<button>`; dialog semantics via `useModalDismiss` | All three pickers are this one component, filtered by `category`. |
| `src/components/Controls.tsx:131-141` | suppress the per-inlay missing-asset warning when `shapes.inlayShapes[item.id]` will be written | The check is the `inlaySettings.items.forEach` loop inside `handleExportClick` (`:117-158`) that pushes `` `Inlay: ${name}` `` into `missingAssets` at `:137` when `item.shapes.length > 0 && !projectAssets.inlays[item.id]`. `:143-155` is only the `showAlert` that consumes the list — editing the import path alone leaves the warning firing on export (E10, B-5). |
| `src/components/controls/{Base,Geometry,Inlay}Controls.tsx` (label wrappers) | `role="group"` + `aria-labelledby` on the four non-`ControlField` label groups: `BaseControls.tsx:143-156`, `GeometryControls.tsx:219-222`, `:549-566`, `InlayControls.tsx:438-441` | Each labels a *set* of controls; there is no single element for an `htmlFor` to name (§4.2.5 A7). |
| `src/components/Controls.tsx:30-31`, `:358-361`, `:368`, `:397-406` | tab union · tab option · `ParamProvider` mount · 4th `<Freeze>` block | The tab list and the panel container live here and nowhere else. |
| `src/components/Controls.tsx:81`, `:160-262` | lift `projectAssets`; consume `MigrateResult`; delete the "garbage" comment block `:211-224` | The import handler is here; `Controls` owns `projectAssets`. |
| `src/App.tsx:24`, `:36`, `:42-44`, `:58-63` | `activeTab` union · hash-restore effect · `projectAssets` after the lift · reset clears it | The three state slots live here (`:15`, `:18`, `:21`). |
| `src/types/schemas.ts:87-96` | append V2 + `AnyProjectSchema`; **V1 untouched** | One schema module; a rival module forks `ProjectData`. |
| `src/utils/projectUtils.ts:40-58`, `:105-199`, `:179-188` | write v2 + the `shapes` block; route parse through `migrateProject` | The only persistence path in the app. |
| `src/components/controls/{Base,Geometry,Inlay}Controls.tsx` | field-by-field migration to `ParamField`; `SwatchGrid` replaces the duplicated grids at `BaseControls.tsx:143-156` and `GeometryControls.tsx:549-566` | Incremental — a panel may mix descriptors and hand-written JSX. |
| `vite.config.ts:30-35` | add `src/components/params/**` and `src/hooks/**` to the coverage allowlist | The allowlist is an allowlist; new component code reports 0% silently otherwise. |

**Not touched, deliberately:** `src/utils/geometry/patternPipeline.ts`, `src/utils/geometry/manifoldOps.ts`, `src/workers/geometryWorker.ts`, `src/utils/geometry/patternClient.ts`, `src/components/OutputPanel.tsx`, `src/utils/patternUtils.ts`.

---

## 5. Integration points

| # | Existing call site | What attaches | Contract |
|---|---|---|---|
| I1 | `src/components/Controls.tsx:368` (inside the scroll container, above the three `<Freeze>` blocks at `:370-406`) | `<ParamProvider value={{base, inlay, geometry, selectedInlayItem}}>` | Read-only. Writes stay on `updateBase`/`updateGeom`/`updateInlay` (`:64-66`). **`selectedInlayItem` has to be derived here** — `Controls` holds `inlaySettings` and receives `selectedInlayId` (`src/App.tsx:24`), and the item is `items?.find(i => i.id === selectedInlayId)`, the same expression `InlayControls.tsx:87` runs today. No existing state slot holds it. |
| I2 | `src/components/controls/InlayControls.tsx:652-665` | first `ParamField` — the depth field, the derived-bound proof | Replaces the inline clamp `:659` and the inert `max` `:662`. The retro-clamp effect `:76-85` **stays**. |
| I3 | `src/components/controls/GeometryControls.tsx:283-300`, `:388-410` | `ParamField` kinds `number` and `select` | Preserves the auto-scale action adornment via `ControlField`'s `action` slot (`ui/ControlField.tsx:11`, `:32-36`). The adornment is the whole `action={…}` prop at `GeometryControls.tsx:255-281` (the `<button>` opens at `:258`); `:270-279` is only its `className`/`title`/icon tail and preserving that fragment alone loses the `patternShapes && patternShapes.length > 0` guard and the `onClick`. |
| I4 | `src/components/controls/BaseControls.tsx:143-156` · `GeometryControls.tsx:549-566` | `SwatchGrid` | Same markup, one copy. Schema stays `z.string()` (`src/types/schemas.ts:13`). |
| I5 | `src/components/Controls.tsx:30-31` + `src/App.tsx:36` + `Controls.tsx:358-361`, `:397-406` | 4th tab: union widened in **both** places, option added, `<Freeze>` block added | Contents come from doc 02's descriptor table. |
| I6 | `src/utils/projectUtils.ts:40-55` | `version: 2` + the `shapes` block; `inlay` stops spreading live shapes (`:48-50`) | `serializeShapes` (`src/utils/geometry/serialize.ts:47-50`). |
| I7 | `src/components/Controls.tsx:131-141` (the per-inlay loop inside `handleExportClick`, `:117-158`) | the "Missing Asset Files" check stops counting an inlay as missing once its geometry is written to `shapes.inlayShapes[item.id]` | The push at `:137` is guarded by `item.shapes.length > 0 && !projectAssets.inlays[item.id]`; `:143-155` is only the `showAlert`. **Nothing on the import path can reach this** — E10 and B-5's done-when are unsatisfiable without editing here. |
| I8 | `src/utils/projectUtils.ts:179-188` | `migrateProject(rawData)`; returns `MigrateResult`, never throws | Makes `src/components/Controls.tsx:241-249` reachable for the first time. |
| I9 | `src/components/Controls.tsx:177-234` | re-hydrate precedence: **asset → `shapes` block → empty**; surface `unknownKeys` via `useAlert` (`:53`) | `deserializeShapes` (`serialize.ts:69-72`). Delete the comment block `:211-224`. |
| I10 | `src/components/Controls.tsx:281-298` | a third button, **Share Link**, beside Import/Export | Existing `Button` primitive; grid becomes 3-up or wraps. |
| I11 | `src/App.tsx:42-44` (beside the warm-up effect) | one-shot `location.hash` restore → the three setters + `setSelectedInlayId` (`:24`) + clear lifted `projectAssets` | Never geometry. §4.3.4. |
| I12 | `src/components/ImperativeModel.tsx:897-903` (dep array) · `:15-54` (`ImperativeModelProps`) · `src/components/ModelViewer.tsx:48-54`, `:460-501` | **read-only** — T7 parses all four, it edits none | Adding a param means editing all four by hand. The guard proves you did — including the `ModelViewer` forward, which is the step parent rule 6 calls "most often missed" and which compiles silently when skipped (`ImperativeModel.tsx:49-51`: the props are `?: boolean`). |

---

## 6. Edge cases, testing, acceptance criteria

### 6.1 Edge cases

| # | Case | Required behaviour |
|---|---|---|
| E1 | `patternScaleZ` (`src/types/schemas.ts:71`) and `patternMaxHeight` (`:72`) are both `z.union([z.number(), z.string()])`, so `''`, `0` and `undefined` are **three distinct persisted states** — **and the two fields do not use the same unset sentinel.** The UI writes `patternScaleZ: ''` (`src/components/controls/GeometryControls.tsx:316`) but `patternMaxHeight: undefined` (`:353`); the schema agrees, `:71` carrying `.default("")` and `:72` being `.optional()` with no default. (`patternHeight` at `:69` is *not* in this list — see E3.) | Two descriptor keys, not one. `emptyMeans: 'Auto'` is the placeholder and is **a rename of shipped behaviour** — `placeholder="Auto"` already ships at `GeometryControls.tsx:319` and `:356`. `emptyValue` carries the sentinel **per descriptor**: `''` for `patternScaleZ`, `undefined` for `patternMaxHeight`. A shared `emptyMeans` implementation that assumes `''` would silently change what `patternMaxHeight` persists — the exact hazard this row exists to prevent. **Do not "fix" either to `null`.** |
| E2 | `InlayItemSchema` has **no** `.default()` anywhere (`:19-46`), so `getDefaults(InlayItemSchema)` throws | Inlay descriptors carry their own fallbacks, matching the existing convention `selectedItem.depth \|\| 0.4` (`src/components/controls/InlayControls.tsx:658`). Never call `getDefaults` on it. |
| E3 | `GeometrySettings.patternHeight` (`src/types/schemas.ts:69`) has **no consumer** — `grep -rn 'patternHeight' src/` returns the schema line, one defaults assertion (`src/utils/schemaDefaults.test.ts:49`), and `src/utils/patternUtils.ts:819-837`, which is an unrelated local variable of the same name. `InlayItem.valid` is written `false` once and never read (`:23`). | Neither gets a descriptor — a descriptor renders a control, and there is nothing for either to control. Both stay in V2 so round-trip is lossless. This row governs; `patternHeight` is deliberately absent from E1's list. |
| E4 | A frozen panel has never mounted (`src/components/Controls.tsx:370-406`) | No `ParamField` mount effect may be load-bearing. A link restore writes state, not fields. |
| E5 | Clamp rejects a value the parent already holds | The input must display the clamped value, not the rejected one (§4.2.4). |
| E6 | A v1 bundle is imported after V2 ships | Migrates silently; every v1 field survives; no dialog. |
| E7 | A v99 bundle is imported | `newer-version` refusal with the real version in the message — the first time `src/components/Controls.tsx:241-249` renders in the app's life. Not a generic throw. |
| E8 | `project.json` carries a key no schema knows | Reported in `unknownKeys` and surfaced via `AlertContext`, not silently stripped (`src/types/schemas.ts:87-93` is non-strict). |
| E9 | The pattern slot holds a `THREE.BufferGeometry` (the shipping STL path — `src/components/ImperativeModel.tsx:829-830`) | `shapes.patternShapes` stays `null`; the zip asset is the source of truth. `SerializedGeometry`'s typed arrays (`src/utils/geometry/serialize.ts:21-25`) never enter JSON. |
| E10 | An inlay has no source file (painted / traced) | The `shapes` block round-trips it; the "Missing Asset Files" warning must stop firing for that item. **The edit is on the export path, not the import path** — the per-inlay check is the loop at `src/components/Controls.tsx:131-141` inside `handleExportClick` (`:117-158`), which pushes at `:137`; `:143-155` is only the `showAlert` that consumes the list. See I7. |
| E11 | A share link is decoded from a hostile or truncated hash | `safeParse` first; a failure returns `decodeShareLink`'s `invalid-payload` refusal (§4.3.3), never a partial apply and never a throw. The payload type has no geometry fields, so shapes cannot be injected. |
| E12 | A share link is generated for a custom-uploaded outline | `custom-outline` refusal naming the `.zip` as the alternative. Raised by **`encodeShareLink`** — it is a property of the design being encoded, not of any inbound hash (§4.3.3). |
| E13 | A share link restores a design with the same inlay count but different uuids | `selectedInlayId` set explicitly; otherwise the Selected Layer panel is silently blank (`src/components/controls/InlayControls.tsx:73`). |
| E14 | A share link is applied, then the user clicks Export Project | The bundle must not contain the previous design's assets — `projectAssets` (`src/components/Controls.tsx:81`) is cleared on restore. |
| E15 | `timestamp: Date.now()` (`src/utils/projectUtils.ts:42`) | Kept in the bundle, **excluded** from the share payload; otherwise two identical designs never compare equal (parent §7's design-hash directive). |
| E16 | A colour arrives that is not one of the 21 swatches (`src/constants/colors.ts:1-23`) | Round-trips unchanged; `SwatchGrid` shows no active swatch rather than snapping the value. |
| E17 | A descriptor names a schema field that does not exist | Compile error — `key: keyof S & string`. Not a runtime check. |

### 6.2 Tests (Vitest 2.1.9, jsdom, `@testing-library/react` at `package.json:44`)

Fake timers are already set up for this component family (`src/components/DebouncedInput.test.tsx:6-9`); a zip fixture harness already exists (`src/utils/projectUtils.test.ts:66-80`).

| # | File | Asserts |
|---|---|---|
| T1 | `src/utils/params/resolve.test.ts` | `resolveDerivable(0.5, ctx) === 0.5`; `resolveDerivable(ctx => ctx.base.thickness - 0.1, {thickness: 0.6}) === 0.5`; `clampToDescriptor` is inclusive at both ends. |
| T2 | `src/components/params/ParamField.test.tsx` | **One assertion per `ParamKind`, each landing with the task that adds that kind** — `number`, `select`, `toggle`, `segmented` with A-4; `slider` with A-7; `color` with A-8. No single task owes all six. Plus: `number` commits after 150 ms; `select` commits synchronously (matching today's behaviour). |
| T3 | `src/components/params/ParamField.test.tsx` | **Clamp echo (E5).** `max = 0.5`, value already 0.5; type `9`; advance timers 150 ms; the input's `value` reads `0.5`. **Must fail before the `revision` change and pass after.** |
| T4 | `src/components/DebouncedInput.test.tsx` (extend) | With `revision` omitted, all three existing assertions still pass byte-for-byte; incrementing `revision` re-syncs the display from an unchanged prop. |
| T5 | `src/components/params/labels.test.tsx` | Render `BaseControls`, `GeometryControls`, `InlayControls` and assert **two** things, separately named so a task can satisfy one without claiming the other. **T5a:** every `<label>` rendered *by `ControlField`* (`src/components/ui/ControlField.tsx:27`) has an `htmlFor` resolving to an element in the same document, and the count of resolved labels ≥ the count of `ControlField`s rendered. **T5b:** every `<label>` **not** rendered by `ControlField` sits inside an element carrying `role="group"` and an accessible name — the four groups of §4.2.5 A7 (`BaseControls.tsx:144`, `GeometryControls.tsx:220`, `:550`, `InlayControls.tsx:439`). A single unconditional "every `<label>` has a resolving `htmlFor`" is **unachievable by design**: those four label a *set* of controls, and `ShapeUploader.tsx:180` already has its `htmlFor` while its `ControlField` child is a wrapper `<div>` (`:179`) that A1's injection cannot reach. |
| T6 | `src/hooks/useModalDismiss.test.tsx` | Escape calls `onClose`; Tab from the last focusable wraps to the first; on close, `document.activeElement` is the trigger again. |
| T7 | `src/utils/params/regenerationGuard.test.ts` | Reads `src/components/ImperativeModel.tsx` and `src/components/ModelViewer.tsx` as text and asserts, for every geometry descriptor with `regenerates: true`, **all three** links of §4.2.6: (a) the identifier is inside the dependency array, located by its anchor comment (`ImperativeModel.tsx:894-896`); (b) it is declared in `ImperativeModelProps` (`:15-54`); (c) it is destructured off `geometrySettings` at `ModelViewer.tsx:48-54` **and** forwarded as a JSX attribute at `:460-501`. (a) alone is not enough: a missing forward compiles (`ImperativeModel.tsx:49-51`) and passes (a) while never regenerating. **Green today** and fails on the first un-wired param. |
| T8 | `src/utils/project/migrate.test.ts` | v1 fixture → `ok:true`, `migratedFrom:1`, every v1 field present; v2 fixture → `ok:true`, `migratedFrom:2`; `{version:99}` → `ok:false, reason:'newer-version', foundVersion:99`; `{}` → `not-a-project`; a fixture with an extra key reports it in `unknownKeys`; **no call throws.** |
| T9 | `src/utils/projectUtils.test.ts` (extend) | Export a design whose inlay item holds a real `THREE.Shape` with a hole: `JSON.stringify(project)` contains no `"curves"` and no `"isShape"`; `JSON.parse(JSON.stringify(project))` reaches `shapes.inlayShapes`; `deserializeShapes` on it reproduces the point list within 1e-9; the hole survives. |
| T10 | `src/utils/share/shareCodec.test.ts` | encode → decode is identity for a preset-outline design; the encoded URL is ≤ 2000 characters; a truncated string returns a refusal and does not throw; the decoded object has no `cutoutShapes`, no `patternShapes` and no `shapes` key; **each of the six refusal reasons is produced by its trigger, through the function that raises it** — `custom-outline`, `custom-pattern`, `unreferenceable-inlay` and `too-long` from `encodeShareLink`, `unsupported-payload` and `invalid-payload` from `decodeShareLink` (§4.3.3). Assert the four encode-side reasons by calling `encodeShareLink`; asserting them against `decodeShareLink` is not possible and its absence is the point. |
| T11 | `src/utils/projectUtils.test.ts` (extend) | An inlay item with `shapes` and **no** matching asset survives export → import via the `shapes` block (E10). |

Coverage: `src/utils/params/**`, `src/utils/project/**` and `src/utils/share/**` fall inside the existing allowlist (`vite.config.ts:31`); `src/components/params/**` and `src/hooks/**` must be added at `vite.config.ts:30-35` or they report 0% silently.

### 6.3 Acceptance criteria

**Half A**

- `pnpm test` passes. Baseline to regress against is **20 files / 155 tests** after P0 deletes `offsetUtils.test.ts` (−1 file, −7 tests from `docs/_source/baseline-verification.md`); the count only grows.
- `grep -rn "leva" package.json pnpm-lock.yaml` returns nothing (the choice stays made).
- `pnpm build` exits 0 and prints no new chunk over budget beyond the existing single-chunk warning.
- T3 fails against `DebouncedInput` as shipped and passes after the `revision` change — demonstrate both, in that order, in the PR description.
- `grep -c "htmlFor" src/components/ui/ControlField.tsx` ≥ 1, and **both** T5a and T5b pass for all three panels.
- `grep -rn "aria-\|role=" src/components/ui/ src/components/params/ src/hooks/` returns a non-empty list (baseline for all of `src/` is **0** `aria-*`, **0** `role=`).
- `grep -rn 'type="range"' src/components/ui/Slider.tsx` matches, and `src/components/controls/` still contains none directly.
- Keyboard-only walkthrough, recorded as a checklist in the PR: Tab reaches every control in the Geometry panel including the file dropzone **in both its states — with a shape loaded and without** (A3 has two halves; the loaded state is the normal one after any use); Enter opens the picker; arrows/Tab move between tiles; Enter selects; Escape closes; focus lands back on the button that opened it. Repeat for **all three** pickers — outlines (`BaseControls.tsx:65`), patterns (`GeometryControls.tsx:177`), inlays (`InlayControls.tsx:270`).
- `grep -rn "bg-purple-500/10 text-purple-400 border-purple-500" src/components/ui/` matches at least `ToggleButton.tsx` and `SegmentedControl.tsx` (one active convention).
- T7 is green before any param is added and red in a scratch commit that adds a `regenerates: true` descriptor without editing `src/components/ImperativeModel.tsx:897-903` — demonstrate the red.
- A new `GeometrySettings` field with `.default()` **renders and commits** by editing only `src/types/schemas.ts` and one descriptor table — no new JSX. This bounds the claim to the rendering half. Wiring it to *regeneration* still requires the full parent rule-6 chain, and T7 fails until the dependency array at `src/components/ImperativeModel.tsx:897-903` names it, `ImperativeModelProps` (`:15-54`) declares it, and `src/components/ModelViewer.tsx:48-54`/`:460-501` destructure and forward it. Demonstrate the criterion by showing the field editable in the panel **and** T7 red before the chain is walked.

**Half B**

- `node -e` / a test asserts `JSON.stringify(exportedProject)` contains neither `"curves"` nor `"isShape"` for a design carrying inlay geometry (T9).
- A v1 `.zip` produced **before** this change imports successfully and its settings compare deep-equal to the pre-change import result, field by field (T8 + a fixture committed under `src/utils/project/__fixtures__/`).
- Importing `{version: 99, …}` renders the "Version Mismatch" dialog at `src/components/Controls.tsx:241-249` — the first time that code path executes. Verify by screenshot or by asserting `showAlert` was called with `title: "Version Mismatch"`.
- `grep -n "JSON shapes are garbage" src/components/Controls.tsx` returns nothing (the comment block `:211-224` is gone).
- **No commit in half B leaves export and import on different versions.** A bundle exported by the build at the tip of each of B-3 and B-4 imports into that same build — assert it in a test that round-trips through `exportProjectBundle` → `importProjectBundle` at both commits.
- A share link generated from a design using a **library** outline + built-in pattern + non-default scalars + a seed, pasted into a clean browser profile, reproduces the same preview. Checkable proxy in CI: `decodeShareLink(encodeShareLink(state))` deep-equals `state` minus the omitted geometry keys, and the URL is ≤ 2000 characters (T10).
- Every refusal path produces a message naming the `.zip` bundle; assert on the message text, not just the reason code.
- `pnpm test` green; `src/utils/geometry/**` and `src/workers/**` show **zero** diff (`git diff --stat` names neither).

---

## 7. Task order

Dependency-ordered; each item is one commit, **and every commit must leave the app shippable.** That second constraint is what fixes half B's order: the import side lands before the export side, because `importProjectBundle` runs `ProjectSchema.safeParse` against `version: z.literal(1)` (`src/types/schemas.ts:88`, `:95`) and throws at `src/utils/projectUtils.ts:187`. Landing "export writes v2" first would leave a whole commit in which the app cannot import the bundle it just exported — a regression of the only persistence path in the app. Import-through-`migrateProject` first is safe in both directions, because `migrateProject` already handles v1 and v2. **Recon is done — this list starts from the report's findings, not from investigation.**

**Half A — startable today**

| # | Task | Depends on | Done when |
|---|---|---|---|
| A-1 | `src/utils/params/types.ts` + `resolve.ts` + T1. No UI. | — | T1 green; nothing imports it yet |
| A-2 | `ControlField` label association (`useId`, `htmlFor`, render-function children, guarded `cloneElement`) | — | all 28 existing call sites compile untouched; **T5a** green (every `<label>` rendered by `ControlField` whose child is a real control resolves). T5b is A-13's, not this commit's. |
| A-3 | `DebouncedInput.revision` (`:28-30`) + T4 | — | the three existing assertions unchanged; new one green |
| A-4 | `src/components/params/ParamField.tsx` for `number`, `select`, `toggle` and `segmented`, over `ControlField`/`DebouncedInput`/the existing select markup/`ToggleButton.tsx:12-33`/`SegmentedControl.tsx:16-43` + T2, T3. The last two kinds reuse primitives that already ship and need no new code. | A-1..A-3 | T3 red-then-green demonstrated; T2's `number`, `select`, `toggle` and `segmented` assertions green. `slider` and `color` are A-7's and A-8's. |
| A-5 | Migrate the Inlay depth field (`InlayControls.tsx:652-665`) to a descriptor with a derived `max`. **Interim `ctx`:** `InlayControls` builds the `ParamContextValue` locally from the `baseThickness` prop it already receives (`src/components/Controls.tsx:388`) — A-6 deletes that shim. This is why A-5 precedes A-6 even though the derived `max` reads `ctx`. | A-4 | typing above the max echoes the clamped value; the retro-clamp effect `:76-85` still present |
| A-6 | `ParamProvider` (read-only) mounted at `Controls.tsx:368`, deriving `selectedInlayItem` per I1; **the A-5 shim in `InlayControls` is deleted** | A-5 | derived bounds resolve from the provider with no locally-constructed `ParamContextValue` and no new props; the shim is gone from `InlayControls` |
| A-7 | `ui/Slider.tsx` + `ParamField` kind `slider` | A-4 | first slider ships in the Geometry panel; commits on the same 150 ms debounce; T2's `slider` assertion green |
| A-8 | `ui/SwatchGrid.tsx` + `ParamField` kind `color` wired to it; both duplicated grids replaced; `SwatchGrid` carries `role="group"` + accessible name (§4.2.5 A7) | A-4 | `BaseControls.tsx:143-156` and `GeometryControls.tsx:549-566` both call it; T2's `color` assertion green |
| A-9 | Migrate the remaining Geometry-panel fields to descriptors | A-4..A-8 | **T5a** green for the whole panel — same wording as A-2, not a stronger claim |
| A-10 | `Tooltip` a11y (`ui/Tooltip.tsx:38-72`) | A-2 | keyboard-focusable, `role="tooltip"`, `aria-describedby` wired |
| A-11 | `useModalDismiss` + picker tiles → buttons (`PatternLibraryModal.tsx:160-166`) + T6 | — | keyboard walkthrough passes for **all three** pickers (`BaseControls.tsx:65`, `GeometryControls.tsx:177`, `InlayControls.tsx:270` — one component, three `category` values) |
| A-12 | Dropzone focusable (`ShapeUploader.tsx:227`): `hidden` → `sr-only` **and** the input rendered unconditionally, keeping the `hasContent` branch for the visible content at `:207-225` only | A-2 | `getByLabelText` finds the file input **with and without `shapes` set** — the second case is impossible without dropping the gate |
| A-13 | Bare label groups (§4.2.5 A7): `role="group"` + `aria-labelledby` on the four non-`ControlField` label wrappers (`BaseControls.tsx:143-156`, `GeometryControls.tsx:219-222`, `:549-566`, `InlayControls.tsx:438-441`); the two colour cases come free from `SwatchGrid` | A-8 | **T5b** green |
| A-14 | One active-state + focus-ring convention across `Button`/`ToggleButton`/`SegmentedControl`/swatches | A-8 | grep criterion in §6.3; isolated commit because it changes the tab bar |
| A-15 | `regenerationGuard` test T7 — all three checks of §4.2.6 | A-9 | green today; red in a scratch commit that skips the dep array, **and** red in a second scratch commit that names the dep array but skips the `ModelViewer` forward |
| A-16 | 4th tab: unions at `Controls.tsx:30-31` + `App.tsx:36`, option `:358-361`, `<Freeze>` `:397-406` | doc 02's descriptor table | tab renders doc 02's params, or an explicit empty state |
| A-17 | `vite.config.ts:30-35` — add `src/components/params/**`, `src/hooks/**` | A-4 | `pnpm test:coverage` reports non-zero for the new components |

**Half B — V2 first, share after M1 + M2**

| # | Task | Depends on | Done when |
|---|---|---|---|
| B-1 | `SerializedShapeSchema`, `PersistedShapeSchema`, `ProjectSchemaV2`, `AnyProjectSchema`, `CURRENT_PROJECT_VERSION` appended to `src/types/schemas.ts`. V1 untouched. | — | `getDefaults` on all three settings schemas still succeeds; `src/utils/schemaDefaults.test.ts` green |
| B-2 | `src/utils/project/migrate.ts` + T8 | B-1 | all five `MigrateResult` branches covered; nothing throws |
| B-3 | **Import first.** Route import through `migrateProject` (`projectUtils.ts:179-188`); `Controls.tsx:160-262` consumes `MigrateResult`; delete the comment block `:211-224`. Export still writes v1 at this commit. | B-2 | v1 fixture imports; v99 renders the dialog; **a bundle exported by this build imports into this build** |
| B-4 | Export writes v2 + the `shapes` block; `inlay` stops spreading live shapes (`projectUtils.ts:48-50`) + T9 | B-1, **B-3** | no `THREE` object survives `JSON.stringify`; **a bundle exported by this build imports into this build** |
| B-5 | Re-hydration precedence **asset → `shapes` → empty**; surface `unknownKeys` via `AlertContext`; **relax the export-side missing-asset check at `Controls.tsx:131-141`** (I7) + T11 | B-4 | a painted inlay survives export→import **and** stops triggering "Missing Asset Files" — the second half is an edit to `handleExportClick` (`:117-158`), not to the import path |
| B-6 | Lift `projectAssets` out of `Controls.tsx:81` into `App.tsx`; clear on Reset (`App.tsx:58-63`) | B-4 | Reset then Export produces a bundle with no assets |
| B-7 | `src/utils/share/shareSchema.ts` + `shareCodec.ts` + T10 | B-1, **M1**, **M2** | encode/decode identity; ≤ 2000 chars; **six** refusals, each raised by the function §4.3.3 assigns it (four encode-side, two decode-side) |
| B-8 | **Share Link** button at `Controls.tsx:281-298`; `history.replaceState` on click only | B-7 | one click copies a working link; no history spam while dragging a slider |
| B-9 | Hash restore in `App.tsx:42-44`, incl. `selectedInlayId` and clearing `projectAssets` | B-6, B-7 | E13 and E14 hold |

Parallelism: A-1…A-17 and B-1…B-6 are independent and can run concurrently. B-7 is the only item gated on another milestone.

---

## What already exists — do not rebuild

Everything below ships today. Scope it as extension or hardening, never as new work.

| Piece of this feature | Where | Reuse as |
|---|---|---|
| Native Tailwind control layer, **28** call sites across all three tabs (see §1's footnote — parent §8 M5 and recon §5 both say 27) | `src/components/ui/ControlField.tsx:14-50` | the wrapper `ParamField` renders through — **extend it, do not replace it** |
| Data-driven option rendering from an `options` array | the option type `SegmentedControlOption<T>` at `src/components/ui/SegmentedControl.tsx:3-7`; the render loop `options.map(…)` at `:24-40` (whole component `:16-43`) | **the precedent for the whole descriptor idea** |
| Boolean toggle primitive | `src/components/ui/ToggleButton.tsx:12-33` | `kind: 'toggle'`; its active style is the canonical one (§4.2.5) |
| Debounced numeric commit at 150 ms, **17** call sites | `src/components/DebouncedInput.tsx:9-18`, `:20-49` | `kind: 'number'`; one additive `revision` prop, nothing more |
| Styled `<select>` with chevron overlay | `src/components/controls/GeometryControls.tsx:388-410` | `kind: 'select'` — extract the markup verbatim |
| Tooltip with portal positioning | `src/components/ui/Tooltip.tsx:9-75` | keep; add keyboard + `role="tooltip"` (mouse-only today) |
| 21-colour swatch grid, duplicated verbatim in two panels | `src/constants/colors.ts:1-23`; `src/components/controls/BaseControls.tsx:143-156`; `src/components/controls/GeometryControls.tsx:549-566` | `SwatchGrid` — de-duplicate, do not redesign |
| Range-slider markup (3 divergent copies, **none** in the controls tree) | `src/components/ImageConversionModal.tsx:133-143` (best template); `ModelViewer.tsx:327`, `:341`, `:355`; `SVGPaintModal.tsx:1065`, `:1104`, `:1120` | template for `ui/Slider.tsx` |
| Derived-bound precedent (cross-tab `maxDepth`) | `src/components/controls/InlayControls.tsx:56`, `:76-85`, `:659`, `:662` | the case `Derivable<T>` must satisfy; the retro-clamp effect stays |
| Tab shell + `react-freeze` mount semantics | `src/components/Controls.tsx:355-363`, `:370-406` | add a 4th `<Freeze>` block; do not invent a tab system |
| zod defaults reflection | `src/utils/schemaDefaults.ts:6-8`, `:10-12` | the defaults mechanism V2 inherits unchanged |
| Save/load as a JSZip bundle, with buttons | `src/utils/projectUtils.ts:29-87`, `:105-199`; `src/components/Controls.tsx:281-298` | extend to v2; **sharing by file already works** |
| Asset re-hydration on import (byte-exact re-parse) | `src/components/Controls.tsx:177-234` | keep as **first** precedence; the `shapes` block is the fallback |
| JSON-safe shape round trip, worker-proven and hole-aware | `src/utils/geometry/serialize.ts:34-45`, `:47-50`, `:61-67`, `:69-72` | the persisted geometry form — **do not write a second one** |
| Coloured-shape wrapper type | `src/utils/geometry/inlayPipeline.ts:15-18` | the structure `PersistedShapeSchema` mirrors |
| A `version` field, a mismatch flag and a "Continue Anyway" dialog | `src/types/schemas.ts:88`; `src/utils/projectUtils.ts:179-181`; `src/components/Controls.tsx:241-249` | **all three exist and the path is unreachable dead code** — B-2 makes it reachable rather than building it |
| Fake-timer test harness for the debounce family | `src/components/DebouncedInput.test.tsx:6-9`, `:17-38` | extend for T3/T4 |
| Zip fixture harness for bundles | `src/utils/projectUtils.test.ts:66-80` | extend for T8/T9/T11 |
| Alert/confirm surface | `src/context/AlertContext.tsx:16-20`; used at `src/components/Controls.tsx:53` | how refusals and `unknownKeys` reach the user |
| **Accessibility** | — | **Nothing exists.** 0 `aria-*`, 0 `role=`, 0 `tabIndex`, 1 `htmlFor` (`src/components/ShapeUploader.tsx:181`); the only `Escape` handler clears a paint selection (`src/components/SVGPaintModal.tsx:231`). All of §4.2.5 is net-new. |
| **URL state** | — | **Nothing exists.** Zero URL-state APIs; the only storage key in the app is `welcome_modal_dismissed` (`src/App.tsx:30-33`). All of §4.3.3 is net-new. |
| **`leva`** | — | **Not installed.** Absent from `package.json:17-66` and `pnpm-lock.yaml`. Do not add it. |
| `src/components/ui/Badge.tsx` | `:9-26` | **dead code, zero importers** — use it for the active-source label or delete it; do not leave a third convention |

---

## 8. Open questions

Genuine unknowns only. Each names what would settle it.

| # | Question | Why it is open | What settles it |
|---|---|---|---|
| Q1 | **Does the React Compiler memoize `DebouncedInput`'s inline `onChange` callbacks?** | `babel-plugin-react-compiler` is enabled with `target: "19"` (`vite.config.ts:8-14`) and its output cannot be read statically. It decides whether the timer effect at `src/components/DebouncedInput.tsx:32-40` re-arms on every parent render — which is the difference between the clamp defect being a stale display (§4.2.4) and being a re-fire loop. `revision` fixes the display either way; the loop, if real, is a second bug. | Add a render-count assertion to `src/components/DebouncedInput.test.tsx`, **or** build and inspect the emitted component. Carried over from the recon report's §8. |
| Q2 | **Does `ParamProvider` cost a re-render storm?** | The provider value changes on every keystroke (three settings objects), and every `ParamField` consumes it. `react-freeze` hides the two inactive panels, so the blast radius is one panel — but the React Compiler's memoization of the provider value is the same unknown as Q1. | Land A-6, then profile a slider drag with the React DevTools profiler and count committed `ParamField` renders per frame. If it is bad, narrow the context to a bounds-only selector. |
| Q3 | **How much of a design can a link actually carry before `too-long` fires?** | The 2000-character budget is a chosen policy, not a measurement. The variable is inlay item count: each item is ~15 scalars plus a ref. The break-even count is unknown. | T10 with a parameterised fixture: encode designs with 1, 4, 8 and 16 inlay items and record the lengths in the test name. If 8 items overflow, adopt the JSZip DEFLATE escape hatch (`package.json:26`) in B-7 rather than after. |
| Q4 | **Should `patternType` become a real discriminator, or stay unread?** | `patternType` is persisted (`src/types/schemas.ts:68`) and set on import (`src/components/Controls.tsx:196`), but recon establishes **the pipeline never reads it** and parent §5 calls widening it "optional". The share payload's `pattern` union does the same job better. Two overlapping discriminators is a smell. | A product call for **@liamstar**, after doc 02 lands: either doc 02 widens `patternType` and the share payload defers to it, or `patternType` is documented as legacy-persisted-only. Do not decide it inside doc 04. |
| Q5 | **Does a v1 bundle exist in anyone's hands that we are obliged to keep readable?** | The repo has no release, no `LICENSE` and no public deploy under our control (parent §7); every v1 bundle we know of is one @liamstar produced locally. If none exists in the wild, the v1 migration is cheap insurance rather than a compatibility obligation — which changes how much fixture coverage T8 deserves. | @liamstar checks whether any bundle was ever shared. The migration ships either way (it is ~10 lines); the answer only sizes the fixture set. |

*Deliberately not listed as open:* the `leva`-vs-native choice (settled, parent §11 Q2), whether the pattern slot is single-source (settled, parent §11 Q1 — single, and the share payload's `pattern` union assumes it), and whether to pre-parse the outline library (settled, parent §11 Q3 — runtime parse stays).
