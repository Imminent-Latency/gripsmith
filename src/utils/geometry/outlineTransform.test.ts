import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { transformOutlinePoints, transformOutlineShapes } from './outlineTransform';

const points = () => [new THREE.Vector2(1, 2), new THREE.Vector2(5, 2), new THREE.Vector2(1, 4)];

function expectPoints(actual: THREE.Vector2[], expected: number[][]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((p, i) => {
    expect(p.x).toBeCloseTo(expected[i][0], 12);
    expect(p.y).toBeCloseTo(expected[i][1], 12);
  });
}

describe('outline transforms', () => {
  it('preserves coordinates without a transform', () => {
    expectPoints(transformOutlinePoints(points(), { mirror: false, rotationDeg: 0 }), [[1, 2], [5, 2], [1, 4]]);
  });

  it('mirrors x and reverses the ring without mutating the input', () => {
    const input = points();
    const result = transformOutlinePoints(input, { mirror: true, rotationDeg: 0 });
    expectPoints(result, [[-1, 4], [-5, 2], [-1, 2]]);
    expect(THREE.ShapeUtils.area(result)).toBe(THREE.ShapeUtils.area(input));
    expectPoints(input, [[1, 2], [5, 2], [1, 4]]);
  });

  it('rotates about the origin in degrees', () => {
    expectPoints(transformOutlinePoints(points(), { mirror: false, rotationDeg: 90 }), [[-2, 1], [-2, 5], [-4, 1]]);
  });

  it('mirrors before rotating and preserves winding', () => {
    const input = points();
    const result = transformOutlinePoints(input, { mirror: true, rotationDeg: 90 });
    expectPoints(result, [[-4, -1], [-2, -5], [-2, -1]]);
    expect(THREE.ShapeUtils.area(result)).toBeCloseTo(THREE.ShapeUtils.area(input), 12);
  });

  it('transforms outer rings and holes while retaining nesting', () => {
    const shape = new THREE.Shape(points());
    shape.holes = [new THREE.Path([new THREE.Vector2(2, 2.5), new THREE.Vector2(2, 3), new THREE.Vector2(3, 2.5)])];
    const [result] = transformOutlineShapes([shape], { mirror: true, rotationDeg: 90 });
    expectPoints(result.getPoints(), [[-4, -1], [-2, -5], [-2, -1]]);
    expect(result.holes).toHaveLength(1);
    expectPoints(result.holes[0].getPoints(), [[-2.5, -3], [-3, -2], [-2.5, -2]]);
    expect(Math.sign(THREE.ShapeUtils.area(result.holes[0].getPoints())))
      .toBe(Math.sign(THREE.ShapeUtils.area(shape.holes[0].getPoints())));
    expectPoints(shape.getPoints(), [[1, 2], [5, 2], [1, 4]]);
  });
});
