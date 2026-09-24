import * as THREE from 'three';
import { generateSVGPath } from '../dxfUtils';
import { parseShapeFile } from '../shapeLoader';

export interface CachedOutline {
    text: string;
    shapes: THREE.Shape[];
    pathData: string;
    viewBox: string;
}

// The bundled catalog has 17 fixed URLs; successful entries live for the session.
const outlines = new Map<string, Promise<CachedOutline>>();

export const loadOutline = (url: string): Promise<CachedOutline> => {
    const cached = outlines.get(url);
    if (cached) return cached;

    const pending = (async (): Promise<CachedOutline> => {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch DXF');
        const text = await response.text();
        const result = parseShapeFile(text, 'dxf');
        if (!result.success) throw new Error(result.error);
        const shapes: THREE.Shape[] = result.shapes;
        const path = generateSVGPath(shapes);

        // Calculate bounds for ViewBox
        const bounds = new THREE.Box2();
        shapes.forEach(s => {
            s.getPoints().forEach((p: THREE.Vector2) => {
                bounds.expandByPoint(p);
            });
        });

        if (bounds.isEmpty()) throw new Error('DXF has empty bounds');
        const min = bounds.min;
        const max = bounds.max;
        const width = max.x - min.x;
        const height = max.y - min.y;
        const padding = Math.max(width, height) * 0.1;
        // generateSVGPath outputs raw coordinates. SVG usually +Y down. ThreeJS +Y up.
        // To render correctly upright, we typically scale(1, -1).
        // If we scale(1, -1), y becomes -y.
        // Bounds: min.y ... max.y.  Scaled: -max.y ... -min.y.
        // So viewBox top-left y should be -max.y.
        const viewBox = `${min.x - padding} ${-max.y - padding} ${width + padding * 2} ${height + padding * 2}`;
        return { text, shapes, pathData: path, viewBox };
    })().catch(error => {
        if (outlines.get(url) === pending) outlines.delete(url);
        throw error;
    });
    outlines.set(url, pending);
    return pending;
};

export const clearOutlineCache = (): void => {
    outlines.clear();
};
