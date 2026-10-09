import { describe, expect, it } from 'vitest';
import { Shape } from 'three';
import { outlineUpdate, outlineCleared } from './outlineState';
import type { BaseSettings } from '../../types/schemas';

const references: BaseSettings['outlineRef'][] = [
    { kind: 'preset', presetId: 'outline/pint', name: 'Pint' },
    { kind: 'upload', presetId: null, name: 'pad.dxf' },
    null,
];

describe('outline state transitions', () => {
    it.each(references)('resets rotation and mirror when the reference is %j', ref => {
        const shapes = [new Shape()];
        const update = outlineUpdate(shapes, ref);
        expect(update).toEqual({
            cutoutShapes: shapes, outlineRef: ref, baseOutlineRotation: 0, baseOutlineMirror: false,
        });
        expect(update.cutoutShapes).toBe(shapes);
        expect({ baseOutlineRotation: 30, baseOutlineMirror: true, ...update }).toMatchObject({
            baseOutlineRotation: 0, baseOutlineMirror: false,
        });
    });

    it('clears geometry, identity, rotation, and mirror together', () => {
        expect(outlineCleared()).toEqual({
            cutoutShapes: [], outlineRef: null, baseOutlineRotation: 0, baseOutlineMirror: false,
        });
    });
});
