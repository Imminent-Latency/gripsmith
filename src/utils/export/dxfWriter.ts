import { dropTerminalDuplicate } from './cutPaths';
import type { CutLayerName, CutPathSet } from './cutPaths';

export function writeCutDxf(set: CutPathSet): string {
  const lines: string[] = [];
  const pair = (code: number, value: string | number) => { lines.push(String(code), String(value)); };
  const { minX, minY, maxX, maxY } = set.bounds;
  pair(0, 'SECTION'); pair(2, 'HEADER');
  pair(9, '$ACADVER'); pair(1, 'AC1009');
  // These post-R12 unit hints are intentional: our reader uses them to preserve mm.
  pair(9, '$INSUNITS'); pair(70, 4);
  pair(9, '$MEASUREMENT'); pair(70, 1);
  pair(9, '$EXTMIN'); pair(10, minX); pair(20, minY); pair(30, 0);
  pair(9, '$EXTMAX'); pair(10, maxX); pair(20, maxY); pair(30, 0);
  pair(0, 'ENDSEC');
  pair(0, 'SECTION'); pair(2, 'TABLES');
  pair(0, 'TABLE'); pair(2, 'LAYER'); pair(70, 3);
  const colors: Record<CutLayerName, number> = { OUTLINE: 7, HOLES: 5, PATTERN: 1 };
  for (const layer of Object.keys(colors) as CutLayerName[]) {
    pair(0, 'LAYER'); pair(2, layer); pair(70, 0); pair(62, colors[layer]); pair(6, 'CONTINUOUS');
  }
  pair(0, 'ENDTAB'); pair(0, 'ENDSEC');
  pair(0, 'SECTION'); pair(2, 'ENTITIES');
  const addRing = (ring: number[], layer: CutLayerName) => {
    const points = dropTerminalDuplicate(ring);
    pair(0, 'POLYLINE'); pair(8, layer); pair(66, 1); pair(70, 1);
    pair(10, 0); pair(20, 0); pair(30, 0);
    for (let i = 0; i < points.length; i += 2) {
      pair(0, 'VERTEX'); pair(8, layer);
      pair(10, points[i]); pair(20, points[i + 1]); pair(30, 0);
    }
    pair(0, 'SEQEND'); pair(8, layer);
  };
  for (const { layer, shape } of set.regions) {
    addRing(shape.points, layer);
    shape.holes.forEach(hole => addRing(hole, 'HOLES'));
  }
  pair(0, 'ENDSEC'); pair(0, 'EOF');
  return lines.join('\n') + '\n';
}
