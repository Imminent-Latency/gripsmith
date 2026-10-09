import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as THREE from 'three';
import DxfParser from 'dxf-parser';
import type { IPolylineEntity } from 'dxf-parser/dist/entities/polyline';
import OutputPanel from './OutputPanel';
import { defaultBaseSettings } from '../utils/schemaDefaults';
import { outlineToCutPaths } from '../utils/export/outlineContours';
import { writeCutSvg } from '../utils/export/svgWriter';
import { writeCutDxf } from '../utils/export/dxfWriter';

const { showAlert } = vi.hoisted(() => ({ showAlert: vi.fn() }));
vi.mock('../context/AlertContext', () => ({ useAlert: () => ({ showAlert }) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  showAlert.mockClear();
  cleanup();
});

// Install after render, matching projectUtils.test.ts's anchor/URL harness.
function stubDownload() {
  const link = { href: '', download: '', style: { display: '' }, click: vi.fn() } as unknown as HTMLAnchorElement;
  vi.spyOn(document, 'createElement').mockReturnValue(link);
  vi.spyOn(document.body, 'appendChild').mockImplementation(() => link);
  vi.spyOn(document.body, 'removeChild').mockImplementation(() => link);
  const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  return { link, createObjectURL, revokeObjectURL };
}

const shapeFrom = (points: number[][]) => new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
const convex = () => shapeFrom([[0, 10], [20, 10], [20, 30], [0, 30]]);
const crossed = () => shapeFrom([[0, 0], [10, 10], [10, 0], [0, 10]]);

describe.each(['svg', 'dxf'] as const)('OutputPanel %s cut export', format => {
  const buttonName = `Cut Paths (${format.toUpperCase()})`;

  it.each([
    { size: 300, cutoutShapes: null }, { size: 250, cutoutShapes: null },
    { size: 300, cutoutShapes: [] }, { size: 250, cutoutShapes: [] },
  ])('refuses an empty outline with settings %j (A7b)', settings => {
    render(<OutputPanel meshRef={{ current: null }} {...defaultBaseSettings} {...settings} />);
    const button = screen.getByRole('button', { name: buttonName });
    const { createObjectURL, link } = stubDownload();
    fireEvent.click(button);
    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ message: 'Load a pad outline before exporting cut paths.' }));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(link.click).not.toHaveBeenCalled();
  });

  it.each(['convex', 'crossed outer', 'crossed holes'])('warns once only for intersections and still downloads: %s (A12b)', kind => {
    const outline = kind === 'crossed outer' ? crossed() : convex();
    if (kind === 'crossed holes') {
      const hole = new THREE.Path([new THREE.Vector2(2, 12), new THREE.Vector2(8, 18), new THREE.Vector2(8, 12), new THREE.Vector2(2, 18)]);
      outline.holes = [hole, hole.clone()];
    }
    render(<OutputPanel meshRef={{ current: null }} cutoutShapes={[outline]} />);
    const button = screen.getByRole('button', { name: buttonName });
    const { createObjectURL, revokeObjectURL, link } = stubDownload();
    fireEvent.click(button);
    expect(showAlert).toHaveBeenCalledTimes(kind === 'convex' ? 0 : 1);
    if (kind !== 'convex') expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(link.download).toBe(`gripsmith-outline.${format}`);
    expect(link.href).toBe('blob:mock-url');
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it.each(['empty shape', 'degenerate outer and hole'])('refuses a loaded outline with no exportable regions: %s', kind => {
    const outline = kind === 'empty shape' ? new THREE.Shape() : shapeFrom([[0, 0], [1, 1]]);
    if (kind === 'degenerate outer and hole') outline.holes = [new THREE.Path([new THREE.Vector2(2, 2), new THREE.Vector2(3, 3)])];
    render(<OutputPanel meshRef={{ current: null }} cutoutShapes={[outline]} />);
    const button = screen.getByRole('button', { name: buttonName });
    const { createObjectURL, revokeObjectURL, link } = stubDownload();
    fireEvent.click(button);
    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      message: expect.stringContaining('The loaded outline has no exportable regions.'),
    }));
    const message = showAlert.mock.calls[0][0].message;
    expect(message).toContain('Dropped 1 outline ring');
    expect(message).toContain(`${kind === 'empty shape' ? 0 : 1} hole ring`);
    expect(message).toContain('fewer than 3 vertices');
    expect(message).toContain('No file was downloaded.');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(link.click).not.toHaveBeenCalled();
  });

  it.each([false, true])('alerts for mixed valid and dropped rings and downloads the same valid bytes (intersections: %s)', async intersecting => {
    const valid = intersecting ? crossed() : convex();
    if (!intersecting) valid.holes = [new THREE.Path([new THREE.Vector2(2, 12), new THREE.Vector2(8, 12), new THREE.Vector2(2, 18)])];
    const expected = outlineToCutPaths([valid], { mirror: true, rotationDeg: 37 })!;
    const expectedText = format === 'svg' ? writeCutSvg(expected) : writeCutDxf(expected);
    const mixed = valid.clone();
    mixed.holes.push(new THREE.Path([new THREE.Vector2(2, 12), new THREE.Vector2(3, 13)]));
    render(<OutputPanel meshRef={{ current: null }} cutoutShapes={[mixed, shapeFrom([[0, 0], [1, 1]])]} baseOutlineMirror baseOutlineRotation={37} />);
    const button = screen.getByRole('button', { name: buttonName });
    const { createObjectURL, revokeObjectURL, link } = stubDownload();
    fireEvent.click(button);
    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    const message = showAlert.mock.calls[0][0].message;
    expect(message).toContain('Dropped 1 outline ring');
    expect(message).toContain('1 hole ring');
    expect(message).toContain('fewer than 3 vertices');
    expect(message.includes('self-intersecting')).toBe(intersecting);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(link.download).toBe(`gripsmith-outline.${format}`);
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(createObjectURL.mock.calls[0][0] as Blob);
    });
    expect(text).toBe(expectedText);
  });

  it('warns and downloads a promoted valid hole even when its outer ring is dropped', () => {
    const outline = shapeFrom([[0, 0], [1, 1]]);
    outline.holes = [new THREE.Path([new THREE.Vector2(2, 2), new THREE.Vector2(5, 2), new THREE.Vector2(2, 5)])];
    render(<OutputPanel meshRef={{ current: null }} cutoutShapes={[outline]} />);
    const button = screen.getByRole('button', { name: buttonName });
    const { createObjectURL, link } = stubDownload();
    fireEvent.click(button);
    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(showAlert).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Dropped 1 outline ring') }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(link.click).toHaveBeenCalledTimes(1);
  });

  it('applies the passed mirror and rotation to the actual downloaded coordinates', async () => {
    render(<OutputPanel meshRef={{ current: null }} cutoutShapes={[convex()]} baseOutlineMirror baseOutlineRotation={90} />);
    const button = screen.getByRole('button', { name: buttonName });
    const { createObjectURL } = stubDownload();
    fireEvent.click(button);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const text = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob);
    });
    let points: number[][];
    if (format === 'svg') {
      expect(blob.type).toBe('image/svg+xml');
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const d = doc.querySelector('#OUTLINE path')!.getAttribute('d')!;
      points = [...d.matchAll(/[ML] ([^ ]+) ([^ ]+)/g)].map(match => [Number(match[1]), -Number(match[2])]);
    } else {
      expect(blob.type).toBe('application/dxf');
      const polyline = new DxfParser().parseSync(text)!.entities[0] as IPolylineEntity;
      points = polyline.vertices.map(({ x, y }) => [x, y]);
    }
    expect(points).toHaveLength(4);
    const expected = [[-30, 0], [-30, -20], [-10, -20], [-10, 0]];
    points.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(expected[i][0], 6);
      expect(y).toBeCloseTo(expected[i][1], 6);
    });
  });
});
