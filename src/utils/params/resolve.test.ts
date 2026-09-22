import { describe, expect, it } from 'vitest';
import { BaseSettingsSchema, GeometrySettingsSchema, InlaySettingsSchema } from '../../types/schemas';
import type { InlayItem } from '../../types/schemas';
import { getDefaults } from '../schemaDefaults';
import { clampToDescriptor, resolveDerivable } from './resolve';
import type { NumberParam, ParamContextValue } from './types';

const ctx: ParamContextValue = {
    base: getDefaults(BaseSettingsSchema),
    inlay: getDefaults(InlaySettingsSchema),
    geometry: getDefaults(GeometrySettingsSchema),
    selectedInlayItem: null,
};
const depth: NumberParam<InlayItem> = {
    key: 'depth', kind: 'number', label: 'Inlay Depth (mm)', regenerates: true,
    min: 0.1, max: current => current.base.thickness - 0.1, step: 0.1, clamp: true,
};

describe('resolveDerivable', () => {
    it('returns a literal unchanged', () => {
        expect(resolveDerivable(0.5, ctx)).toBe(0.5);
    });

    it('resolves a bound from current base thickness', () => {
        expect(ctx.base.thickness).toBe(0.6);
        expect(resolveDerivable(current => current.base.thickness - 0.1, ctx)).toBe(0.5);
    });
});

describe('clampToDescriptor', () => {
    it.each([[0, 0.1], [0.1, 0.1], [0.3, 0.3], [0.5, 0.5], [9, 0.5]])(
        'clamps %s inclusively to %s', (value, expected) => {
            expect(clampToDescriptor(value, depth, ctx)).toBe(expected);
        },
    );

    it('leaves a value unchanged when neither bound is defined', () => {
        const unbounded: NumberParam<InlayItem> = {
            key: 'depth', kind: 'number', label: 'Depth', regenerates: true,
        };
        expect(clampToDescriptor(-100, unbounded, ctx)).toBe(-100);
        expect(clampToDescriptor(100, unbounded, ctx)).toBe(100);
    });
});
