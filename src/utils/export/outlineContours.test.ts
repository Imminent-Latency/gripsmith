import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FLAT_TOLERANCE_MM, outlineToCutPaths } from './outlineContours';
import { hasSelfIntersection } from './cutPaths';
import { writeCutSvg } from './svgWriter';
import { writeCutDxf } from './dxfWriter';

const identity = { mirror: false, rotationDeg: 0 };
const shapeFrom = (xy: number[][]) => new THREE.Shape(xy.map(([x, y]) => new THREE.Vector2(x, y)));
const area = (ring: number[]) => THREE.ShapeUtils.area(Array.from({ length: ring.length / 2 }, (_, i) => new THREE.Vector2(ring[i * 2], ring[i * 2 + 1])));

describe('outline contours', () => {
  it('refuses absent and empty outlines', () => {
    expect(outlineToCutPaths(null, identity)).toBeNull();
    expect(outlineToCutPaths(undefined, identity)).toBeNull();
    expect(outlineToCutPaths([], identity)).toBeNull();
  });

  it.each([identity, { mirror: true, rotationDeg: 37 }])('samples a live R50 circle within tolerance with %j', transform => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, 50, 0, Math.PI * 2, false);
    const result = outlineToCutPaths([shape], transform)!;
    const ring = result.regions[0].shape.points;
    expect(ring.length / 2).toBeGreaterThan(24);
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length;
      const radius = Math.hypot((ring[i] + ring[j]) / 2, (ring[i + 1] + ring[j + 1]) / 2);
      expect(Math.abs(50 - radius)).toBeLessThanOrEqual(FLAT_TOLERANCE_MM);
    }
    expect(shape.curves[0].type).toBe('EllipseCurve');
  });

  it('preserves outer and hole winding under mirror and rotation', () => {
    const shape = shapeFrom([[0, 0], [20, 0], [20, 20], [0, 20]]);
    shape.holes = [new THREE.Path([new THREE.Vector2(2, 2), new THREE.Vector2(5, 2), new THREE.Vector2(2, 5)])];
    const original = outlineToCutPaths([shape], identity)!;
    const mirrored = outlineToCutPaths([shape], { mirror: true, rotationDeg: 90 })!;
    expect(area(original.regions[0].shape.points)).toBe(400);
    expect(area(mirrored.regions[0].shape.points)).toBeCloseTo(400);
    expect(area(mirrored.regions[0].shape.holes[0])).toBeCloseTo(-4.5);
    expect(mirrored.bounds.minX).toBeCloseTo(-20);
    expect(mirrored.bounds.minY).toBeCloseTo(-20);
  });

  it('retains the figure-eight without refusing, repairing, or changing its vertices', () => {
    const shape = shapeFrom([[0, 0], [10, 10], [10, 0], [0, 10]]);
    const result = outlineToCutPaths([shape], identity)!;
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].shape.points).toEqual([0, 0, 10, 10, 10, 0, 0, 10]);
    expect(hasSelfIntersection(result.regions[0].shape.points)).toBe(true);
  });

  it('drops explicit terminal duplicates while preserving millimetres and position', () => {
    const shape = shapeFrom([[10, 20], [30, 20], [30, 40], [10, 40], [10, 20]]);
    const result = outlineToCutPaths([shape], identity)!;
    expect(result.regions[0].shape.points).toHaveLength(8);
    expect(result.bounds).toEqual({ minX: 10, minY: 20, maxX: 30, maxY: 40 });
  });

  it('reports dropped degenerate outer and hole rings', () => {
    const report = vi.fn();
    const shape = shapeFrom([[0, 0], [10, 0], [10, 10], [0, 10]]);
    shape.holes = [
      new THREE.Path([new THREE.Vector2(2, 2), new THREE.Vector2(3, 3)]),
      new THREE.Path([new THREE.Vector2(2, 2), new THREE.Vector2(5, 2), new THREE.Vector2(2, 5)]),
    ];
    const shapes = [shape, shapeFrom([[0, 0], [1, 1]])];
    const before = shapes.map(raw => raw.toJSON());
    const result = outlineToCutPaths(shapes, identity, report)!;
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({ droppedOuterRings: 1, droppedHoleRings: 1 });
    const expected = {
      regions: [{ layer: 'OUTLINE' as const, shape: { points: [0, 0, 10, 0, 10, 10, 0, 10], holes: [[2, 5, 5, 2, 2, 2]] } }],
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    };
    expect(result).toEqual(expected);
    expect(outlineToCutPaths(shapes, identity)).toEqual(expected);
    expect(writeCutSvg(result)).toBe(writeCutSvg(expected));
    expect(writeCutDxf(result)).toBe(writeCutDxf(expected));
    expect(shapes.map(raw => raw.toJSON())).toEqual(before);
  });

  it('reports every dropped ring when a loaded outline has no exportable regions', () => {
    const report = vi.fn();
    const shape = shapeFrom([[0, 0], [1, 1]]);
    shape.holes = [new THREE.Path(), new THREE.Path([new THREE.Vector2(2, 2), new THREE.Vector2(3, 3)])];
    const result = outlineToCutPaths([new THREE.Shape(), shape], identity, report)!;
    expect(result).toEqual({ regions: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } });
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({ droppedOuterRings: 2, droppedHoleRings: 2 });
  });

  it('does not report drops for absent or valid outlines and preserves valid writer bytes', () => {
    const report = vi.fn();
    for (const absent of [null, undefined, []]) expect(outlineToCutPaths(absent, identity, report)).toBeNull();
    const shapes = [shapeFrom([[0, 10], [20, 10], [20, 30], [0, 30]])];
    const legacy = outlineToCutPaths(shapes, identity)!;
    const result = outlineToCutPaths(shapes, identity, report)!;
    expect(result).toEqual({
      regions: [{ layer: 'OUTLINE', shape: { points: [0, 10, 20, 10, 20, 30, 0, 30], holes: [] } }],
      bounds: { minX: 0, minY: 10, maxX: 20, maxY: 30 },
    });
    expect(writeCutSvg(result)).toBe(writeCutSvg(legacy));
    expect(writeCutDxf(result)).toBe(writeCutDxf(legacy));
    expect(report).not.toHaveBeenCalled();
  });

  it('retains a valid hole as an outline region when its degenerate outer is dropped', () => {
    const report = vi.fn();
    const shape = shapeFrom([[0, 0], [1, 1]]);
    shape.holes = [new THREE.Path([new THREE.Vector2(2, 2), new THREE.Vector2(5, 2), new THREE.Vector2(2, 5)])];
    const result = outlineToCutPaths([shape], identity, report)!;
    expect(result.regions).toEqual([{ layer: 'OUTLINE', shape: { points: [2, 2, 5, 2, 2, 5], holes: [] } }]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({ droppedOuterRings: 1, droppedHoleRings: 0 });
  });

  it('promotes a detached hole to an OUTLINE region', () => {
    const shape = shapeFrom([[0, 0], [10, 0], [10, 10], [0, 10]]);
    shape.holes = [new THREE.Path([new THREE.Vector2(20, 20), new THREE.Vector2(25, 20), new THREE.Vector2(20, 25)])];
    const result = outlineToCutPaths([shape], identity)!;
    expect(result.regions).toHaveLength(2);
    expect(result.regions.every(region => region.layer === 'OUTLINE' && region.shape.holes.length === 0)).toBe(true);
  });
});
