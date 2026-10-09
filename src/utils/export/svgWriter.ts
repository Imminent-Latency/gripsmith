import { generateSVGPath } from '../dxfUtils';
import { deserializeShape } from '../geometry/serialize';
import { dropTerminalDuplicate } from './cutPaths';
import type { CutLayerName, CutPathSet } from './cutPaths';

const format = (value: number): string => String(Number(value.toFixed(4)));

export function writeCutSvg(set: CutPathSet): string {
  const layers: Record<CutLayerName, string[]> = { OUTLINE: [], HOLES: [], PATTERN: [] };
  const colors: Record<CutLayerName, string> = { OUTLINE: '#000000', HOLES: '#0000FF', PATTERN: '#FF0000' };
  const addRing = (ring: number[], layer: CutLayerName) => {
    const points = dropTerminalDuplicate(ring).map((value, i) => i % 2 === 0 ? value : -value);
    const path = generateSVGPath([deserializeShape({ points, holes: [] })]).trim()
      .replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi, value => format(Number(value)));
    layers[layer].push(`    <path d="${path}"/>`);
  };
  for (const { layer, shape } of set.regions) {
    addRing(shape.points, layer);
    shape.holes.forEach(hole => addRing(hole, 'HOLES'));
  }
  const { minX, minY, maxX, maxY } = set.bounds;
  const width = format(maxX - minX), height = format(maxY - minY);
  const groups = (Object.keys(layers) as CutLayerName[]).filter(layer => layers[layer].length > 0)
    .map(layer => `  <g id="${layer}" fill="none" stroke="${colors[layer]}" stroke-width="0.1">\n${layers[layer].join('\n')}\n  </g>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}mm" height="${height}mm" viewBox="${format(minX)} ${format(-maxY)} ${width} ${height}">\n${groups.join('\n')}\n</svg>\n`;
}
