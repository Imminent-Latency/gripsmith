import type { BaseSettings } from '../../types/schemas';

export const outlineUpdate = (
    shapes: unknown[],
    ref: BaseSettings['outlineRef'],
): Partial<BaseSettings> => ({
    cutoutShapes: shapes as BaseSettings['cutoutShapes'],
    outlineRef: ref,
    baseOutlineRotation: 0,
    baseOutlineMirror: false,
});

export const outlineCleared = (): Partial<BaseSettings> =>
    outlineUpdate([], null);
