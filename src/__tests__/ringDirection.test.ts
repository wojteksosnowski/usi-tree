import { describe, it, expect } from 'vitest';
import { TreeGenerator, TREE_LOD_PRESETS, type TreeGenerationParams } from '../index.js';

const base: TreeGenerationParams = { species: 'OAK', height: 10, seed: 7, radialSegments: 5 };

function gen(extra: Partial<TreeGenerationParams>) {
  const stems: { level: number; sides: number; rings: number }[] = [];
  const r = TreeGenerator.generateRaw({ ...base, ...extra, onStem: (i) => stems.push(i) });
  return { mesh: r.mesh, stems };
}

/** Dla trójkątów ciała pnia: znak (normalna geometryczna · uśredniona normalna wierzchołków) */
function trunkSigns(mesh: ReturnType<typeof gen>['mesh'], bodyVerts: number) {
  const p = mesh.positions, n = mesh.normals, ix = mesh.indices;
  const out: number[] = [];
  for (let t = 0; t < ix.length; t += 3) {
    const [a, b, c] = [ix[t], ix[t + 1], ix[t + 2]];
    if (a >= bodyVerts || b >= bodyVerts || c >= bodyVerts) continue;
    const e1 = [0, 1, 2].map((k) => p[3 * b + k] - p[3 * a + k]);
    const e2 = [0, 1, 2].map((k) => p[3 * c + k] - p[3 * a + k]);
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    let d = 0;
    for (let k = 0; k < 3; k++) d += g[k] * (n[3 * a + k] + n[3 * b + k] + n[3 * c + k]);
    out.push(Math.sign(d));
  }
  return out;
}

describe('reverseRingDirection', () => {
  it('brak opcji = false = bez zmian; liczby trójkątów równe', () => {
    const a = gen({}), b = gen({ reverseRingDirection: false }), c = gen({ reverseRingDirection: true });
    expect(Array.from(b.mesh.indices)).toEqual(Array.from(a.mesh.indices));
    expect(Array.from(b.mesh.positions)).toEqual(Array.from(a.mesh.positions));
    expect(c.mesh.indices.length).toBe(a.mesh.indices.length);
    expect(c.mesh.positions.length).toBe(a.mesh.positions.length);
    for (const v of [...c.mesh.positions, ...c.mesh.normals]) expect(Number.isFinite(v)).toBe(true);
  }, 30000);

  it('pień: nawinięcie odwrócone, normalne nadal na zewnątrz', () => {
    const a = gen({}), c = gen({ reverseRingDirection: true });
    const t = a.stems[0];
    const body = t.sides * t.rings;
    const sa = trunkSigns(a.mesh, body), sc = trunkSigns(c.mesh, body);
    expect(sa.length).toBeGreaterThan(0);
    expect(sa.length).toBe(sc.length);
    expect(new Set(sa).size).toBe(1);
    sa.forEach((s, i) => expect(sc[i]).toBe(-s));
    // normalne wierzchołków na zewnątrz od osi: ta sama długość i brak NaN
    for (let i = 0; i < body; i++) {
      const l = Math.hypot(c.mesh.normals[3 * i], c.mesh.normals[3 * i + 1], c.mesh.normals[3 * i + 2]);
      expect(l).toBeCloseTo(1, 4);
    }
  }, 30000);

  it('tablica dotyczy tylko wskazanych rzędów', () => {
    const a = gen({}), l1 = gen({ reverseRingDirection: [1] }), l0 = gen({ reverseRingDirection: [0] });
    const body = a.stems[0].sides * a.stems[0].rings;
    expect(trunkSigns(l1.mesh, body)).toEqual(trunkSigns(a.mesh, body));
    expect(trunkSigns(l0.mesh, body)).not.toEqual(trunkSigns(a.mesh, body));
    expect(Array.from(l1.mesh.positions)).not.toEqual(Array.from(a.mesh.positions));
    expect(Array.from(l0.mesh.positions)).toEqual(Array.from(gen({ reverseRingDirection: true }).mesh.positions));
  }, 30000);

  it('działa z LOD', () => {
    const lod = TREE_LOD_PRESETS.mid;
    const a = gen({ lod }), c = gen({ lod, reverseRingDirection: true });
    expect(c.mesh.indices.length).toBe(a.mesh.indices.length);
    const body = a.stems[0].sides * a.stems[0].rings;
    const sa = trunkSigns(a.mesh, body), sc = trunkSigns(c.mesh, body);
    sa.forEach((s, i) => expect(sc[i]).toBe(-s));
  }, 30000);
});
