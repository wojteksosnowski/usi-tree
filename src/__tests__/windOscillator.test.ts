import { describe, it, expect } from 'vitest';
import { TreeGenerator, SPECIES_PROFILES } from '../index.js';
import {
  prepareWindRig,
  evaluateWindRig,
  deformVertices,
  computeWindStemS,
  skeletonWithWindRig,
} from '../core/windOscillator.js';

const wind = (strength: number) => ({ strength, dirX: 1, dirZ: 0.3 });
const sk = (species: 'OAK' | 'BIRCH' | 'SPRUCE', height = 12, seed = 7) =>
  TreeGenerator.buildSkeleton({ species, height, seed, profile: SPECIES_PROFILES[species] });

describe('windOscillator (referencja CPU)', () => {
  it('strength=0: pozycje identyczne (szkielet i wierzchołki)', () => {
    const skeleton = sk('OAK');
    const rig = prepareWindRig(skeleton, wind(0));
    const moved = skeletonWithWindRig(skeleton, rig, 1.7);
    skeleton.stems.forEach((s, i) => {
      s.px.forEach((x, k) => {
        expect(moved.stems[i].px[k]).toBeCloseTo(x, 9);
        expect(moved.stems[i].py[k]).toBeCloseTo(s.py[k], 9);
        expect(moved.stems[i].pz[k]).toBeCloseTo(s.pz[k], 9);
      });
    });
    const mesh = TreeGenerator.meshSkeletonRaw(skeleton, { windSkin: true, withFoliageAccents: true }).mesh;
    const sAl = computeWindStemS(rig, mesh.positions, mesh.windStem!);
    const out = new Float32Array(mesh.positions.length);
    deformVertices(rig, evaluateWindRig(rig, 1.7), mesh.positions, mesh.windStem!, sAl, out);
    for (let i = 0; i < out.length; i++) expect(Math.abs(out[i] - mesh.positions[i])).toBeLessThan(1e-5);
  }, 30000);

  it('windSkin nie zmienia siatki i oznacza wierzchołki pędami', () => {
    const skeleton = sk('BIRCH');
    const plain = TreeGenerator.meshSkeletonRaw(skeleton, { withFoliageAccents: true }).mesh;
    const tagged = TreeGenerator.meshSkeletonRaw(skeleton, { withFoliageAccents: true, windSkin: true }).mesh;
    expect(plain.windStem).toBeUndefined();
    expect(Array.from(tagged.positions)).toEqual(Array.from(plain.positions));
    expect(Array.from(tagged.indices)).toEqual(Array.from(plain.indices));
    expect(tagged.windStem!.length).toBe(tagged.positions.length / 3);
    expect(Math.max(...Array.from(tagged.windStem!))).toBeLessThan(skeleton.stems.length);
  }, 30000);

  it('zachowuje długości segmentów, nasada dziecka leży na rodzicu, brak NaN', () => {
    for (const species of ['OAK', 'SPRUCE'] as const) {
      const skeleton = sk(species);
      const rig = prepareWindRig(skeleton, wind(1.5));
      for (const t of [0, 0.9, 3.3]) {
        const moved = skeletonWithWindRig(skeleton, rig, t);
        const h = skeleton.height / skeleton.scale; // wysokość w jednostkach szkieletu
        moved.stems.forEach((s, i) => {
          const o = skeleton.stems[i];
          for (let k = 0; k < s.px.length; k++) {
            expect(Number.isFinite(s.px[k] + s.py[k] + s.pz[k])).toBe(true);
            if (k === 0) continue;
            const l0 = Math.hypot(o.px[k] - o.px[k - 1], o.py[k] - o.py[k - 1], o.pz[k] - o.pz[k - 1]);
            const l1 = Math.hypot(s.px[k] - s.px[k - 1], s.py[k] - s.py[k - 1], s.pz[k] - s.pz[k - 1]);
            if (l0 > 1e-9) expect(Math.abs(l1 - l0) / l0).toBeLessThan(1e-6);
          }
          const pr = skeleton.windParents![i];
          if (pr) {
            const dist = (stems: typeof moved.stems) => {
              const P = stems[pr.pIdx], ax = P.px[pr.seg], ay = P.py[pr.seg], az = P.pz[pr.seg];
              const dx = P.px[pr.seg + 1] - ax, dy = P.py[pr.seg + 1] - ay, dz = P.pz[pr.seg + 1] - az;
              return Math.hypot(stems[i].px[0] - (ax + dx * pr.u), stems[i].py[0] - (ay + dy * pr.u), stems[i].pz[0] - (az + dz * pr.u));
            };
            expect(Math.abs(dist(moved.stems) - dist(skeleton.stems))).toBeLessThan(1e-4 * h);
          }
        });
      }
      const mesh = TreeGenerator.meshSkeletonRaw(skeleton, { windSkin: true, withFoliageAccents: true }).mesh;
      const sAl = computeWindStemS(rig, mesh.positions, mesh.windStem!);
      const out = new Float32Array(mesh.positions.length);
      deformVertices(rig, evaluateWindRig(rig, 2.1), mesh.positions, mesh.windStem!, sAl, out);
      for (let i = 0; i < out.length; i++) expect(Number.isFinite(out[i])).toBe(true);
    }
  }, 60000);

  it('grubsze/krótsze pędy mają niższe ω niż gałązki, pień najniższe', () => {
    const skeleton = sk('OAK', 12);
    const rig = prepareWindRig(skeleton, wind(1));
    const byLevel = new Map<number, number[]>();
    skeleton.stems.forEach((s, i) => {
      const a = byLevel.get(s.level) ?? [];
      a.push(rig.freqHz[i]);
      byLevel.set(s.level, a);
    });
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const levels = [...byLevel.keys()].sort();
    for (let k = 1; k < levels.length; k++) expect(med(byLevel.get(levels[k])!)).toBeGreaterThanOrEqual(med(byLevel.get(levels[k - 1])!));
    expect(med(byLevel.get(levels[levels.length - 1])!)).toBeGreaterThan(med(byLevel.get(levels[0])!));
    expect(rig.freqHz[0]).toBeGreaterThanOrEqual(0.3);
    expect(rig.freqHz[0]).toBeLessThanOrEqual(0.6);
    for (let i = 1; i < rig.stemCount; i++) expect(rig.freqHz[0]).toBeLessThanOrEqual(rig.freqHz[i]);
    // r/L²: większe r/L² => wyższe ω (monotoniczność)
    const idx = [...Array(rig.stemCount).keys()];
    const w = (i: number) => rig.radius[i] / rig.length[i] ** 2;
    idx.sort((a, b) => w(a) - w(b));
    for (let k = 1; k < idx.length; k++) expect(rig.freqHz[idx[k]]).toBeGreaterThanOrEqual(rig.freqHz[idx[k - 1]] - 0.0011);
  }, 30000);

  it('deterministyczne i re-entrantne (dwa rigi na przemian)', () => {
    const a = sk('OAK', 12, 3), b = sk('BIRCH', 8, 5);
    const ra = prepareWindRig(a, wind(1)), rb = prepareWindRig(b, wind(2));
    const ref = (r: typeof ra, t: number) => Array.from(evaluateWindRig(prepareWindRig(r === ra ? a : b, r === ra ? wind(1) : wind(2)), t));
    const ts = [0.2, 1.1, 2.5];
    const expA = ts.map((t) => ref(ra, t)), expB = ts.map((t) => ref(rb, t));
    ts.forEach((t, k) => {
      expect(Array.from(evaluateWindRig(ra, t))).toEqual(expA[k]);
      expect(Array.from(evaluateWindRig(rb, t))).toEqual(expB[k]);
      expect(Array.from(evaluateWindRig(ra, t))).toEqual(expA[k]);
    });
  }, 30000);
});
