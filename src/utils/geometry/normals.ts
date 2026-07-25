import { SerializedGeometry } from './serialize';

/**
 * Sharp-angle vertex normals, computed in linear time.
 *
 * Semantics match what the pipeline has always asked for: a vertex is smooth-shaded
 * across an edge whose dihedral angle is below `sharpAngleDeg`, and split into separate
 * normals across edges at or beyond it. Curved surfaces (a dome pattern) stay smooth;
 * faceted ones (a pyramid or stud pattern) keep crisp facets.
 *
 * Why this exists rather than Manifold's `calculateNormals`:
 *  - Manifold's sharp-edge splitting is quadratic. Holding component count fixed, 4000
 *    smooth spheres (128k triangles) take ~10ms while 4000 sharp cubes (48k triangles)
 *    take ~5800ms. A grip pattern is nearly all sharp edges and is tiled hundreds of
 *    times, so it lands squarely in the worst case — this was the single largest cost in
 *    the whole generation pipeline.
 *  - Its property-channel argument was also being mis-passed (channel index vs. float
 *    offset), so the normals it returned were being read out of zero-padding and every
 *    mesh shipped with all-zero normals.
 *
 * Cost here is O(V + F): a CSR vertex->face adjacency, then per-vertex union-find over
 * that vertex's own incident faces (bounded by its valence). Normals are area-weighted,
 * matching THREE.BufferGeometry.computeVertexNormals, so smooth regions shade identically
 * to the rest of the app.
 */
export function computeSharpNormals(
  position: Float32Array,
  index: Uint32Array,
  sharpAngleDeg: number,
): SerializedGeometry {
  const nVert = position.length / 3;
  const nFace = index.length / 3;
  if (nFace === 0) {
    return { position, normal: new Float32Array(position.length), index };
  }

  // --- 1. Face normals (unnormalised = area-weighted, plus a normalised copy for angles).
  const fnx = new Float64Array(nFace);
  const fny = new Float64Array(nFace);
  const fnz = new Float64Array(nFace);
  const unx = new Float64Array(nFace);
  const uny = new Float64Array(nFace);
  const unz = new Float64Array(nFace);
  for (let f = 0; f < nFace; f++) {
    const a = index[f * 3] * 3, b = index[f * 3 + 1] * 3, c = index[f * 3 + 2] * 3;
    const ux = position[b] - position[a];
    const uy = position[b + 1] - position[a + 1];
    const uz = position[b + 2] - position[a + 2];
    const vx = position[c] - position[a];
    const vy = position[c + 1] - position[a + 1];
    const vz = position[c + 2] - position[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    fnx[f] = nx; fny[f] = ny; fnz[f] = nz; // area-weighted
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) { unx[f] = nx / len; uny[f] = ny / len; unz[f] = nz / len; }
    // A degenerate face keeps a zero normal: it contributes nothing and never welds
    // two real faces together.
  }

  // --- 2. CSR vertex -> incident faces.
  const counts = new Uint32Array(nVert + 1);
  for (let i = 0; i < index.length; i++) counts[index[i] + 1]++;
  for (let v = 0; v < nVert; v++) counts[v + 1] += counts[v];
  const rowStart = counts;
  const adjFace = new Uint32Array(index.length);
  const cursor = new Uint32Array(nVert);
  /** corner (f*3+k) -> its slot in the CSR row, so the remap below is O(1). */
  const cornerSlot = new Uint32Array(index.length);
  for (let f = 0; f < nFace; f++) {
    for (let k = 0; k < 3; k++) {
      const v = index[f * 3 + k];
      const slot = rowStart[v] + cursor[v]++;
      adjFace[slot] = f;
      cornerSlot[f * 3 + k] = slot;
    }
  }

  const cosLimit = Math.cos((sharpAngleDeg * Math.PI) / 180);

  // --- 3. Per-vertex grouping. Scratch buffers are sized to the max valence once.
  let maxValence = 0;
  for (let v = 0; v < nVert; v++) {
    const d = rowStart[v + 1] - rowStart[v];
    if (d > maxValence) maxValence = d;
  }
  const parent = new Int32Array(maxValence);
  const localOf = new Map<number, number>(); // face id -> local slot
  // Edge fan: other-endpoint -> up to two local face slots.
  const fanA = new Map<number, number>();
  const fanB = new Map<number, number>();
  const groupId = new Int32Array(maxValence);

  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx; }
    return r;
  };

  // Pass 1 sizes the output; pass 2 writes it. Splitting keeps allocation exact.
  const vertGroupCount = new Uint32Array(nVert);
  // Per (vertex, local face slot) -> group ordinal within that vertex.
  const slotGroup = new Uint32Array(index.length);

  for (let v = 0; v < nVert; v++) {
    const s = rowStart[v];
    const e = rowStart[v + 1];
    const deg = e - s;
    if (deg === 0) { vertGroupCount[v] = 1; continue; } // isolated vertex still needs a slot

    localOf.clear();
    for (let i = 0; i < deg; i++) {
      parent[i] = i;
      localOf.set(adjFace[s + i], i);
    }

    // Weld across every smooth edge incident to v.
    fanA.clear();
    fanB.clear();
    for (let i = 0; i < deg; i++) {
      const f = adjFace[s + i];
      // The two edges of f that touch v.
      const i0 = index[f * 3], i1 = index[f * 3 + 1], i2 = index[f * 3 + 2];
      let w1: number, w2: number;
      if (i0 === v) { w1 = i1; w2 = i2; }
      else if (i1 === v) { w1 = i2; w2 = i0; }
      else { w1 = i0; w2 = i1; }
      // Unrolled rather than iterating a temporary [w1, w2] — this runs once per
      // face-corner in the whole mesh.
      if (!fanA.has(w1)) fanA.set(w1, i);
      else if (!fanB.has(w1)) fanB.set(w1, i);
      else fanB.set(w1, -1); // non-manifold edge (3+ faces): never weld
      if (!fanA.has(w2)) fanA.set(w2, i);
      else if (!fanB.has(w2)) fanB.set(w2, i);
      else fanB.set(w2, -1);
    }
    for (const [w, bSlot] of fanB) {
      if (bSlot < 0) continue;
      const aSlot = fanA.get(w)!;
      const fa = adjFace[s + aSlot];
      const fb = adjFace[s + bSlot];
      const dot = unx[fa] * unx[fb] + uny[fa] * uny[fb] + unz[fa] * unz[fb];
      if (dot >= cosLimit) {
        const ra = find(aSlot), rb = find(bSlot);
        if (ra !== rb) parent[ra] = rb;
      }
    }

    // Number the groups 0..k-1 in slot order for a stable, reproducible output.
    let next = 0;
    for (let i = 0; i < deg; i++) groupId[i] = -1;
    for (let i = 0; i < deg; i++) {
      const r = find(i);
      if (groupId[r] === -1) groupId[r] = next++;
      slotGroup[s + i] = groupId[r];
    }
    vertGroupCount[v] = next;
  }

  // --- 4. Allocate output and emit.
  const vertBase = new Uint32Array(nVert + 1);
  for (let v = 0; v < nVert; v++) vertBase[v + 1] = vertBase[v] + vertGroupCount[v];
  const outCount = vertBase[nVert];

  const outPos = new Float32Array(outCount * 3);
  const outNrm = new Float32Array(outCount * 3);
  const accX = new Float64Array(outCount);
  const accY = new Float64Array(outCount);
  const accZ = new Float64Array(outCount);

  for (let v = 0; v < nVert; v++) {
    const base = vertBase[v] * 3;
    const px = position[v * 3], py = position[v * 3 + 1], pz = position[v * 3 + 2];
    for (let g = 0; g < vertGroupCount[v]; g++) {
      outPos[base + g * 3] = px;
      outPos[base + g * 3 + 1] = py;
      outPos[base + g * 3 + 2] = pz;
    }
    const s = rowStart[v], e = rowStart[v + 1];
    for (let i = s; i < e; i++) {
      const f = adjFace[i];
      const out = vertBase[v] + slotGroup[i];
      accX[out] += fnx[f];
      accY[out] += fny[f];
      accZ[out] += fnz[f];
    }
  }

  for (let o = 0; o < outCount; o++) {
    const x = accX[o], y = accY[o], z = accZ[o];
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 0) {
      outNrm[o * 3] = x / len;
      outNrm[o * 3 + 1] = y / len;
      outNrm[o * 3 + 2] = z / len;
    } else {
      // Fully degenerate neighbourhood — pick a stable axis rather than emit NaN.
      outNrm[o * 3 + 2] = 1;
    }
  }

  const outIdx = new Uint32Array(index.length);
  for (let c = 0; c < index.length; c++) {
    outIdx[c] = vertBase[index[c]] + slotGroup[cornerSlot[c]];
  }

  return { position: outPos, normal: outNrm, index: outIdx };
}
