import { describe, expect, it } from 'vitest';
import { boundsOf } from './cutPaths';
import type { CutRegion } from './cutPaths';
import { writeCutSvg } from './svgWriter';

const regions: CutRegion[] = [
  { layer: 'OUTLINE', shape: { points: [0, 10, 20, 10, 20, 30, 0, 30, 0, 10], holes: [[2, 12, 2, 16, 6, 16, 6, 12]] } },
  { layer: 'OUTLINE', shape: { points: [30, 10, 40, 10, 30, 20], holes: [] } },
];
const parse = (input = regions) => new DOMParser().parseFromString(writeCutSvg({ regions: input, bounds: boundsOf(input) }), 'image/svg+xml');

describe('writeCutSvg', () => {
  it('writes millimetre dimensions, matching viewBox extents, and one closed path per ring (A3)', () => {
    const doc = parse();
    const root = doc.documentElement;
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(root.getAttribute('width')).toBe('40mm');
    expect(root.getAttribute('height')).toBe('20mm');
    const viewBox = root.getAttribute('viewBox')!.split(' ').map(Number);
    expect(viewBox).toEqual([0, -30, 40, 20]);
    expect(viewBox[2]).toBeCloseTo(parseFloat(root.getAttribute('width')!), 6);
    expect(viewBox[3]).toBeCloseTo(parseFloat(root.getAttribute('height')!), 6);
    expect(doc.querySelectorAll('path')).toHaveLength(3);
    expect(doc.querySelectorAll('g')).toHaveLength(2);
    expect(doc.querySelectorAll('#OUTLINE path')).toHaveLength(2);
    expect(doc.querySelectorAll('#HOLES path')).toHaveLength(1);
    for (const group of doc.querySelectorAll('g')) {
      expect(group.getAttribute('fill')).toBe('none');
      expect(group.getAttribute('stroke')).toBe(group.id === 'OUTLINE' ? '#000000' : '#0000FF');
      expect(group.getAttribute('stroke-width')).toBe('0.1');
    }
    for (const path of doc.querySelectorAll('path')) expect(path.getAttribute('d')).toMatch(/Z$/);
    expect(doc.querySelectorAll('[transform]')).toHaveLength(0);
  });

  it('negates Y in parsed coordinates and omits the duplicate closing vertex (A4)', () => {
    const d = parse().querySelector('#OUTLINE path')!.getAttribute('d')!;
    const vertices = [...d.matchAll(/[ML] ([^ ]+) ([^ ]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
    expect(vertices).toEqual([[0, -10], [20, -10], [20, -30], [0, -30]]);
  });

  it('formats coordinates to four decimal places without trailing zeros', () => {
    const input: CutRegion[] = [{ layer: 'PATTERN', shape: { points: [0.123456, 0.000001, 10.5, 0, 0, 10.123456], holes: [] } }];
    const doc = parse(input);
    expect(doc.querySelector('#PATTERN')!.getAttribute('stroke')).toBe('#FF0000');
    expect(doc.querySelector('path')!.getAttribute('d')).toBe('M 0.1235 0 L 10.5 0 L 0 -10.1235 Z');
    expect(doc.documentElement.getAttribute('height')).toBe('10.1235mm');
    expect(writeCutSvg({ regions: input, bounds: boundsOf(input) })).toBe(writeCutSvg({ regions: input, bounds: boundsOf(input) }));
  });
});
