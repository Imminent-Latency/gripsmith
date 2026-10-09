import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import { parseShapeFile } from './shapeLoader';
import { parseDxfToShapes } from './dxfUtils';
import { SVGLoader } from 'three-stdlib';
import { createElement } from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import * as shapeLoader from './shapeLoader';
import { importProjectBundle } from './projectUtils';
import { defaultBaseSettings, defaultInlaySettings, defaultGeometrySettings } from './schemaDefaults';
import Controls from '../components/Controls';
import ShapeUploader from '../components/ShapeUploader';

vi.mock('../components/controls/BaseControls', () => ({ default: () => null }));
vi.mock('../components/controls/InlayControls', () => ({ default: () => null }));
vi.mock('../components/controls/GeometryControls', () => ({ default: () => null }));
vi.mock('../context/AlertContext', () => ({ useAlert: () => ({ showAlert: vi.fn() }) }));
vi.mock('./projectUtils', () => ({ importProjectBundle: vi.fn(), exportProjectBundle: vi.fn() }));

afterEach(() => {
  cleanup();
});

// Mock three-stdlib SVGLoader and STLLoader
vi.mock('three-stdlib', () => {
  const mockSVGLoader = vi.fn().mockImplementation(() => {
    return {
      parse: vi.fn().mockReturnValue({
        paths: [
          {
            userData: { style: { fill: '#ff0000' } },
            color: { getStyle: () => '#ff0000' },
          }
        ]
      }),
    };
  });
  
  (mockSVGLoader as any).createShapes = vi.fn().mockReturnValue([new THREE.Shape()]);

  const mockSTLLoader = vi.fn().mockImplementation(() => {
    return {
      parse: vi.fn().mockReturnValue({
        center: vi.fn(),
      }),
    };
  });

  return {
    SVGLoader: mockSVGLoader,
    STLLoader: mockSTLLoader,
  };
});

// Mock dxfUtils
vi.mock('./dxfUtils', () => {
  return {
    parseDxfToShapes: vi.fn().mockReturnValue([new THREE.Shape()]),
  };
});

// Mock centerShapes in patternUtils
vi.mock('./patternUtils', () => {
  return {
    centerShapes: vi.fn().mockImplementation((shapes) => shapes),
  };
});

describe('shapeLoader utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails if stl content is not an ArrayBuffer', () => {
    const result = parseShapeFile('string-content', 'stl');
    expect(result.success).toBe(false);
    expect(result.error).toBe('STL content must be ArrayBuffer');
  });

  it('successfully parses stl content from ArrayBuffer', () => {
    const arrayBuffer = new ArrayBuffer(8);
    const result = parseShapeFile(arrayBuffer, 'stl');
    expect(result.success).toBe(true);
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0]).toHaveProperty('center');
  });

  it('fails if svg content is not a string', () => {
    const arrayBuffer = new ArrayBuffer(8);
    const result = parseShapeFile(arrayBuffer, 'svg');
    expect(result.success).toBe(false);
    expect(result.error).toBe('SVG content must be string');
  });

  it('successfully parses svg content and extracts shapes', () => {
    const result = parseShapeFile('<svg></svg>', 'svg', false);
    expect(result.success).toBe(true);
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0]).toBeInstanceOf(THREE.Shape);
  });

  it('successfully parses svg content and extracts shapes with colors', () => {
    const result = parseShapeFile('<svg></svg>', 'svg', true);
    expect(result.success).toBe(true);
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0]).toEqual({
      shape: expect.any(THREE.Shape),
      color: '#ff0000',
    });
  });

  it('fails if dxf content is not a string', () => {
    const arrayBuffer = new ArrayBuffer(8);
    const result = parseShapeFile(arrayBuffer, 'dxf');
    expect(result.success).toBe(false);
    expect(result.error).toBe('DXF content must be string');
  });

  it('successfully parses dxf content', () => {
    const result = parseShapeFile('SECTION\nHEADER', 'dxf', false);
    expect(result.success).toBe(true);
    expect(parseDxfToShapes).toHaveBeenCalledWith('SECTION\nHEADER');
    expect(result.shapes).toHaveLength(1);
  });

  it('successfully parses dxf content with colors', () => {
    const result = parseShapeFile('SECTION\nHEADER', 'dxf', true);
    expect(result.success).toBe(true);
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0]).toEqual({
      shape: expect.any(THREE.Shape),
      color: '#000000',
    });
  });

  it('auto-detects type from string content (SVG)', () => {
    const result = parseShapeFile('<svg xmlns="..."></svg>', 'dxf'); // Passed type is dxf, but content is svg
    expect(result.success).toBe(true);
    // Since it auto-detected as svg, it will use SVGLoader
    expect(result.shapes[0]).toBeInstanceOf(THREE.Shape);
  });

  it('auto-detects type from string content (DXF)', () => {
    const result = parseShapeFile('SECTION\n  0\nHEADER', 'svg'); // Passed type is svg, but content is dxf
    expect(result.success).toBe(true);
    expect(parseDxfToShapes).toHaveBeenCalled();
  });

  it('returns failure on unexpected exceptions', () => {
    // Force SVGLoader to throw an error
    vi.mocked(SVGLoader).mockImplementationOnce(() => {
      throw new Error('Parse error');
    });

    const result = parseShapeFile('<svg></svg>', 'svg');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Parse error');
  });
});


describe('zero-shape failures', () => {
  it('rejects DXF parsing to zero shapes', () => {
    vi.mocked(parseDxfToShapes).mockReturnValueOnce([]);
    expect(parseShapeFile('SECTION\nHEADER', 'dxf')).toEqual({
      shapes: [], success: false, error: 'DXF parsed to zero shapes',
    });
  });

  it('rejects SVG parsing to zero shapes', () => {
    vi.mocked(SVGLoader.createShapes).mockReturnValueOnce([]);
    expect(parseShapeFile('<svg></svg>', 'svg')).toEqual({
      shapes: [], success: false, error: 'SVG parsed to zero shapes',
    });
  });

  it('reports an empty upload without replacing the current outline', async () => {
    vi.mocked(parseDxfToShapes).mockReturnValueOnce([]);
    const onUpload = vi.fn();
    const onError = vi.fn();
    const { container } = render(createElement(ShapeUploader, {
      label: 'Outline', shapes: [], fileName: null, onUpload, onError, onClear: vi.fn(),
    }));
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['SECTION\nHEADER'], 'empty.dxf')] },
    });
    await waitFor(() => expect(onError).toHaveBeenCalledWith('DXF parsed to zero shapes'));
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('clears stale JSON shapes when an imported inlay asset fails parsing', async () => {
    const staleShapes = [{ shape: { curves: [] }, color: '#ff0000' }];
    const item = { ...defaultInlaySettings.items[0], shapes: staleShapes };
    vi.mocked(importProjectBundle).mockResolvedValueOnce({
      data: {
        base: { ...defaultBaseSettings },
        inlay: { items: [item] }, geometry: { ...defaultGeometrySettings },
      },
      versionMismatch: false, importedVersion: 1,
      importedAssets: { inlays: { [item.id]: { name: 'empty.svg', content: '<svg/>', type: 'svg' } } },
    });
    const parse = vi.spyOn(shapeLoader, 'parseShapeFile').mockReturnValueOnce({ shapes: [], success: false });
    const setInlaySettings = vi.fn();
    const { getAllByTitle } = render(createElement(Controls, {
      baseSettings: defaultBaseSettings, setBaseSettings: vi.fn(),
      inlaySettings: defaultInlaySettings, setInlaySettings,
      geometrySettings: defaultGeometrySettings, setGeometrySettings: vi.fn(),
      activeTab: 'base', setActiveTab: vi.fn(), selectedInlayId: null, setSelectedInlayId: vi.fn(),
    }));
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(getAllByTitle('Import Project JSON')[0]);
    const picker = click.mock.contexts[0] as HTMLInputElement;
    expect(picker).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(picker!, { target: { files: [new File(['bundle'], 'design.zip')] } });
    await waitFor(() => expect(setInlaySettings).toHaveBeenCalled());
    expect(parse).toHaveBeenCalledWith('<svg/>', 'svg', true);
    expect(setInlaySettings).toHaveBeenCalledWith({ items: [{ ...item, shapes: [] }] });
    expect(item.shapes).toBe(staleShapes);
    parse.mockRestore();
    click.mockRestore();
  });
});
