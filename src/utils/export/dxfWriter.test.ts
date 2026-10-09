import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import DxfParser from 'dxf-parser';
import type { IPolylineEntity } from 'dxf-parser/dist/entities/polyline';
import { parseDxfToShapes } from '../dxfUtils';
import { boundsOf } from './cutPaths';
import type { CutRegion } from './cutPaths';
import { outlineToCutPaths } from './outlineContours';
import { writeCutDxf } from './dxfWriter';

const regions: CutRegion[] = [{ layer: 'OUTLINE', shape: { points: [0, 10, 20, 10, 20, 30, 0, 30, 0, 10], holes: [] } }];
const square = () => writeCutDxf({ regions, bounds: boundsOf(regions) });

describe('writeCutDxf', () => {
  it('declares R12, metric units, bounds and all three colored layers', () => {
    const dxf = new DxfParser().parseSync(square())!;
    expect(dxf.header).toMatchObject({
      $ACADVER: 'AC1009', $INSUNITS: 4, $MEASUREMENT: 1,
      $EXTMIN: { x: 0, y: 10, z: 0 }, $EXTMAX: { x: 20, y: 30, z: 0 },
    });
    expect(dxf.tables.layer.layers).toMatchObject({
      OUTLINE: { colorIndex: 7 }, HOLES: { colorIndex: 5 }, PATTERN: { colorIndex: 1 },
    });
    expect(dxf.entities.map(entity => entity.type)).toEqual(['POLYLINE']);
  });

  it('preserves +Y and emits four VERTEX records with a closed POLYLINE (A4, A6)', () => {
    const text = square();
    const polyline = new DxfParser().parseSync(text)!.entities[0] as IPolylineEntity;
    expect(polyline.shape).toBe(true);
    expect(polyline.vertices.map(({ x, y }) => [x, y])).toEqual([[0, 10], [20, 10], [20, 30], [0, 30]]);
    const lines = text.trim().split('\n');
    const pairs = Array.from({ length: lines.length / 2 }, (_, i) => [Number(lines[i * 2]), lines[i * 2 + 1]]);
    expect(pairs.filter(([code, value]) => code === 0 && value === 'VERTEX')).toHaveLength(4);
    expect(pairs.filter(([code, value]) => code === 0 && value === 'SEQEND')).toHaveLength(1);
    const start = pairs.findIndex(([code, value]) => code === 0 && value === 'POLYLINE');
    const end = pairs.findIndex(([code, value]) => code === 0 && value === 'VERTEX');
    expect(pairs.slice(start, end).filter(([code]) => code === 70)).toEqual([[70, '1']]);
  });

  it.each([0, 37])('round-trips area, bbox extent and holes after %s degree rotation (A5)', rotationDeg => {
    const shape = new THREE.Shape([new THREE.Vector2(10, 20), new THREE.Vector2(50, 20), new THREE.Vector2(40, 50), new THREE.Vector2(10, 40)]);
    shape.holes = [new THREE.Path([new THREE.Vector2(20, 25), new THREE.Vector2(20, 30), new THREE.Vector2(25, 30), new THREE.Vector2(25, 25)])];
    const second = new THREE.Shape([new THREE.Vector2(80, 20), new THREE.Vector2(100, 20), new THREE.Vector2(80, 30)]);
    const set = outlineToCutPaths([shape, second], { mirror: true, rotationDeg })!;
    const text = writeCutDxf(set);
    const parsed = new DxfParser().parseSync(text)!;
    expect(parsed.entities.map(entity => entity.layer)).toEqual(['OUTLINE', 'HOLES', 'OUTLINE']);
    const result = parseDxfToShapes(text).sort((a, b) => Math.abs(THREE.ShapeUtils.area(b.getPoints())) - Math.abs(THREE.ShapeUtils.area(a.getPoints())));
    expect(result).toHaveLength(set.regions.length);
    set.regions.forEach(({ shape: source }, i) => {
      const points = Array.from({ length: source.points.length / 2 }, (_, j) => new THREE.Vector2(source.points[j * 2], source.points[j * 2 + 1]));
      const area = Math.abs(THREE.ShapeUtils.area(points));
      expect(Math.abs(Math.abs(THREE.ShapeUtils.area(result[i].getPoints())) - area) / area).toBeLessThan(0.005);
      const extent = new THREE.Box2().setFromPoints(points).getSize(new THREE.Vector2());
      const actual = new THREE.Box2().setFromPoints(result[i].getPoints()).getSize(new THREE.Vector2());
      expect(Math.abs(actual.x - extent.x)).toBeLessThan(0.01);
      expect(Math.abs(actual.y - extent.y)).toBeLessThan(0.01);
      expect(result[i].holes).toHaveLength(source.holes.length);
    });
  });
});
