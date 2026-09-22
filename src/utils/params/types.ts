import type { ReactNode } from 'react';
import type { BaseSettings, InlaySettings, GeometrySettings, InlayItem } from '../../types/schemas';

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
  options: Derivable<Array<{ value: string; label: string; icon?: ReactNode }>>;
}

export interface ToggleParam<S> extends ParamBase<S> { kind: 'toggle'; }  // (new)
export interface ColorParam<S>  extends ParamBase<S> { kind: 'color'; }   // (new)

export type ParamDescriptor<S> =               // (new)
  NumberParam<S> | OptionParam<S> | ToggleParam<S> | ColorParam<S>;
