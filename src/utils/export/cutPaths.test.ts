import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { boundsOf, dropTerminalDuplicate, enforceWinding, hasSelfIntersection, isDegenerate } from './cutPaths';

const square = [0, 0, 10, 0, 10, 10, 0, 10];
const area = (ring: number[]) => THREE.ShapeUtils.area(Array.from({ length: ring.length / 2 }, (_, i) => new THREE.Vector2(ring[2 * i], ring[2 * i + 1])));

describe('cut path ring hygiene', () => {
  it('drops a terminal duplicate without adding closure or changing the input', () => {
    const input = [...square, 0, 0];
    expect(dropTerminalDuplicate(input)).toEqual(square);
    expect(input).toHaveLength(10);
    expect(dropTerminalDuplicate(square)).toEqual(square);
  });

  it('uses a 1e-9 distance threshold for terminal duplicates', () => {
    expect(dropTerminalDuplicate([...square, 5e-10, 0])).toEqual(square);
    expect(dropTerminalDuplicate([...square, 2e-9, 0])).toHaveLength(10);
  });

  it('enforces CCW outers and CW holes for either non-zero source winding', () => {
    for (const ring of [square, [0, 10, 10, 10, 10, 0, 0, 0]]) {
      const input = { points: ring, holes: [ring] };
      const before = structuredClone(input);
      const result = enforceWinding(input);
      expect(area(result.points)).toBe(100);
      expect(area(result.holes[0])).toBe(-100);
      expect(input).toEqual(before);
      expect(enforceWinding(result)).toEqual(result);
    }
  });

  it('passes zero-area outer and hole rings through byte-identical', () => {
    for (const ring of [[], [0, 0, 1, 1], [0, 0, 1, 1, 2, 2], [0, 0, 10, 10, 10, 0, 0, 10]]) {
      expect(area(ring)).toBe(0);
      const result = enforceWinding({ points: ring, holes: [ring] });
      for (const output of [result.points, result.holes[0]]) {
        expect(new Uint8Array(new Float64Array(output).buffer))
          .toEqual(new Uint8Array(new Float64Array(ring).buffer));
      }
    }
  });

  it('reports only fewer than three vertices as degenerate', () => {
    expect(isDegenerate([])).toBe(true);
    expect(isDegenerate([0, 0, 1, 1])).toBe(true);
    expect(isDegenerate([0, 0, 1, 1, 2, 2])).toBe(false);
    expect(isDegenerate([0, 0, 10, 10, 10, 0, 0, 10])).toBe(false);
  });

  it('detects a figure-eight without repairing it', () => {
    const ring = [0, 0, 10, 10, 10, 0, 0, 10];
    expect(hasSelfIntersection(ring)).toBe(true);
    expect(ring).toEqual([0, 0, 10, 10, 10, 0, 0, 10]);
  });

  it('ignores adjacent shared endpoints and an explicit closing vertex', () => {
    expect(hasSelfIntersection(square)).toBe(false);
    expect(hasSelfIntersection([...square, 0, 0])).toBe(false);
    expect(hasSelfIntersection([0, 0, 10, 0, 5, 5])).toBe(false);
    expect(hasSelfIntersection([])).toBe(false);
  });

  it('detects non-adjacent contact and collinear overlap', () => {
    expect(hasSelfIntersection([0, 0, 10, 0, 10, 10, 5, 0, 0, 10])).toBe(true);
    expect(hasSelfIntersection([0, 0, 10, 0, 5, 0, 15, 0, 15, 10, 0, 10])).toBe(true);
  });

  it('accepts a concave ring with no crossings', () => {
    expect(hasSelfIntersection([0, 0, 10, 0, 10, 10, 5, 5, 0, 10])).toBe(false);
  });

  it('bounds all regions and hole rings', () => {
    expect(boundsOf([{ layer: 'OUTLINE', shape: { points: square, holes: [[-2, -3, 12, -3, 12, 11]] } }]))
      .toEqual({ minX: -2, minY: -3, maxX: 12, maxY: 11 });
    expect(boundsOf([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});
