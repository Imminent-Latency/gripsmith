import { readFileSync } from 'node:fs';
import { Box2 } from 'three';
import { describe, expect, it } from 'vitest';
import { parseDxfToShapes } from '../dxfUtils';

// Parsed millimetre extents, sampled with getPoints() as specified in doc 01 §4.0.
const checkOutline = (file: string, width: number, height: number, holes: number) => {
    const shapes = parseDxfToShapes(readFileSync(`public/outlines/${file}`, 'utf8'));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].holes).toHaveLength(holes);
    const bounds = new Box2();
    shapes.forEach(shape => shape.getPoints().forEach(point => bounds.expandByPoint(point)));
    expect(Math.abs(bounds.max.x - bounds.min.x - width)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(bounds.max.y - bounds.min.y - height)).toBeLessThanOrEqual(0.1);
};

describe('outline catalog physical extents', () => {
    it.each([
        ['pint.dxf', 206.1, 173.4, 0],
        ['floatwheelatom.dxf', 227.0, 190.6, 0],
        ['gtstock.dxf', 229.3, 203.4, 0],
        ['xrcobraviper.dxf', 229.3, 211.5, 0],
        ['xrmushiesv2.dxf', 230.8, 216.5, 0],
        ['gosmilox7.dxf', 231.7, 222.5, 0],
        ['xrstompies.dxf', 231.9, 201.0, 0],
        ['floatwheeladv.dxf', 233.0, 200.6, 0],
        ['xrpubpad.dxf', 233.6, 220.0, 32],
        ['gtfst.dxf', 239.0, 216.7, 1],
        ['pintmatix.dxf', 241.4, 194.9, 2],
        ['gtmushies.dxf', 246.5, 226.1, 0],
        ['xrkushwide.dxf', 251.5, 218.0, 2],
        ['xrviperbitewide.dxf', 254.7, 236.7, 0],
        ['gtkushwide.dxf', 255.3, 233.9, 0],
    ] as const)('%s retains its extent and holes', checkOutline);

    it('gtlowboyflared.dxf retains imperial fallback dimensions', () => {
        checkOutline('gtlowboyflared.dxf', 255.8, 215.2, 0);
    });

    it('xrstock.dxf retains negative-Z extrusion dimensions', () => {
        checkOutline('xrstock.dxf', 232.9, 219.7, 0);
    });
});
