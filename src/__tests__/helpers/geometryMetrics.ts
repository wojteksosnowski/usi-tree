/**
 * Metryki geometrii i klasyfikacja skuteczności parametrów (testy + raport).
 * Wyłącznie profile bazowe SPECIES_PROFILES (nigdy fittedProfiles.json). Nie jest plikiem testowym.
 */
import { TreeGenerator, SPECIES_PROFILES } from '../../core/TreeGenerator.js';
import type { SpeciesProfile, Stem, TreeSkeleton, TreeSpecies, BranchLevelParams } from '../../core/TreeGenerator.js';

export const SEEDS = [11, 23, 42, 57, 101, 202, 303, 404];
export const HEIGHT = 12;
export const T_SAMPLES = [0, 0.25, 0.5, 0.75, 1];

export type Profile = SpeciesProfile;

export function baseProfile(species: TreeSpecies): Profile {
  return SPECIES_PROFILES[species];
}

export function withLevel(p: Profile, idx: number, patch: Partial<BranchLevelParams>): Profile {
  return { ...p, levels: p.levels.map((l, i) => (i === idx ? { ...l, ...patch } : l)) };
}

export function skeleton(species: TreeSpecies, profile: Profile, seed: number, height = HEIGHT): TreeSkeleton {
  return TreeGenerator.buildSkeleton({ species, height, seed, profile });
}

// ---------- długości ----------
export function measuredLength(s: Stem): number {
  let L = 0;
  for (let i = 1; i < s.px.length; i++) {
    L += Math.hypot(s.px[i] - s.px[i - 1], s.py[i] - s.py[i - 1], s.pz[i] - s.pz[i - 1]);
  }
  return L;
}
export function segLengths(s: Stem): number[] {
  const out: number[] = [];
  for (let i = 1; i < s.px.length; i++) {
    out.push(Math.hypot(s.px[i] - s.px[i - 1], s.py[i] - s.py[i - 1], s.pz[i] - s.pz[i - 1]));
  }
  return out;
}
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const median = (a: number[]) => {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
};
export const std = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};

export function trunk(sk: TreeSkeleton): Stem {
  return sk.stems.find((s) => s.level === 0)!;
}
export function levelStems(sk: TreeSkeleton, level: number): Stem[] {
  return sk.stems.filter((s) => s.level === level);
}
export function trunkLength(sk: TreeSkeleton): number {
  return measuredLength(trunk(sk));
}
/** Wysokość (y) pierwszego punktu przyczepienia pędu L1 do pnia (nasada korony) */
export function crownBaseY(sk: TreeSkeleton): number {
  const l1 = levelStems(sk, 1);
  return l1.length ? Math.min(...l1.map((s) => s.py[0])) : NaN;
}
export function medianLevelLength(sk: TreeSkeleton, level: number): number {
  return median(levelStems(sk, level).map(measuredLength));
}
export function lengthSpreadLevel(sk: TreeSkeleton, level: number): number {
  return std(levelStems(sk, level).map(measuredLength));
}
export function totalLevelLength(sk: TreeSkeleton, level: number): number {
  return levelStems(sk, level).reduce((a, s) => a + measuredLength(s), 0);
}
export function stemCount(sk: TreeSkeleton, level: number): number {
  return levelStems(sk, level).length;
}
export function meanPointsPerStem(sk: TreeSkeleton, level: number): number {
  return mean(levelStems(sk, level).map((s) => s.px.length));
}
export function meanSegLength(sk: TreeSkeleton, level: number): number {
  return mean(levelStems(sk, level).flatMap(segLengths));
}
/** Średni względny punkt przyczepienia dzieci (t na rodzicu) = położenie y nasady względem pnia (L1) */
export function meanAttachHeight(sk: TreeSkeleton, level: number): number {
  return mean(levelStems(sk, level).map((s) => s.py[0]));
}
export function attachHeightRange(sk: TreeSkeleton, level: number): number {
  const ys = levelStems(sk, level).map((s) => s.py[0]);
  return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
}

// ---------- tempo zmian ----------
export function ratioSeries(a: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length - 1; i++) if (a[i] > 0) out.push(a[i + 1] / a[i]);
  return out;
}
export function minMedMax(a: number[]) {
  return a.length ? { min: Math.min(...a), med: median(a), max: Math.max(...a) } : { min: NaN, med: NaN, max: NaN };
}

// ---------- taper ----------
/** r(t) pędu próbkowany po ułamku długości łuku (interpolacja liniowa) */
export function radiusAtArc(s: Stem, t: number): number {
  const seg = segLengths(s);
  const total = seg.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  for (let i = 0; i < seg.length; i++) {
    const next = acc + seg[i];
    if (t <= next / total || i === seg.length - 1) {
      const u = seg[i] > 0 ? Math.min(1, Math.max(0, (t * total - acc) / seg[i])) : 0;
      return s.r[i] + (s.r[i + 1] - s.r[i]) * u;
    }
    acc = next;
  }
  return s.r[s.r.length - 1];
}
export function radiusProfile(s: Stem): number[] {
  return T_SAMPLES.map((t) => radiusAtArc(s, t));
}
export function tipOverBase(s: Stem): number {
  return s.r[s.r.length - 1] / s.r[0];
}
/** Wzór z growthEngine.ts (radiusAt) */
export function expectedRadiusRatio(t: number, tipRatio: number, shape: number): number {
  return (1 - shape) * (1 - t * (1 - tipRatio)) + shape * Math.pow(tipRatio, t);
}
/** Błąd kształtu: RMS odchylenia r(t)/r0 od oczekiwanego */
export function taperShapeError(s: Stem, tipRatio: number, shape: number): number {
  const e = T_SAMPLES.map((t) => radiusAtArc(s, t) / s.r[0] - expectedRadiusRatio(t, tipRatio, shape));
  return Math.sqrt(mean(e.map((x) => x * x)));
}
/** Pędy nieucięte obwiednią, z >= 3 punktami */
export function unclipped(stems: Stem[]): Stem[] {
  return stems.filter((s) => !s.clipped && s.r.length >= 3);
}
export function medianTip(stems: Stem[]): number {
  return median(unclipped(stems).map(tipOverBase));
}
export function medianMid(stems: Stem[]): number {
  return median(unclipped(stems).map((s) => radiusAtArc(s, 0.5) / s.r[0]));
}
/** Stosunek r dzieci L(i+1) do r rodzica w punkcie przyczepienia (przybliżenie: r rodzica o najbliższym y punkcie) */
export function childOverParentRadius(sk: TreeSkeleton, level: number): number {
  const parents = levelStems(sk, level - 1);
  const kids = levelStems(sk, level);
  const out: number[] = [];
  for (const k of kids) {
    let best = Infinity;
    let rp = NaN;
    for (const p of parents) {
      for (let i = 0; i < p.px.length; i++) {
        const d = Math.hypot(p.px[i] - k.px[0], p.py[i] - k.py[0], p.pz[i] - k.pz[0]);
        if (d < best) {
          best = d;
          rp = p.r[i];
        }
      }
    }
    if (rp > 0) out.push(k.r[0] / rp);
  }
  return median(out);
}
/** Średni r pnia dla t < 0.1 względem r(0.5) pnia */
export function trunkBaseFlare(sk: TreeSkeleton): number {
  const t = trunk(sk);
  return mean([radiusAtArc(t, 0), radiusAtArc(t, 0.05)]) / radiusAtArc(t, 0.5);
}
export function trunkTipRadius(sk: TreeSkeleton): number {
  const t = trunk(sk);
  return t.r[t.r.length - 1];
}

// ---------- siatka ----------
export interface MeshStats {
  vertices: number;
  triangles: number;
  size: [number, number, number];
  wOverH: number;
  signature: number;
}
export function meshStats(
  species: TreeSpecies,
  profile: Profile,
  seed: number,
  opts: { foliage?: boolean; height?: number } = {}
): MeshStats {
  const height = opts.height ?? HEIGHT;
  const { mesh } = TreeGenerator.generateRaw({
    species,
    height,
    seed,
    profile,
    withFoliageAccents: !!opts.foliage,
  });
  const bb = mesh.boundingBox;
  const size: [number, number, number] = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
  let sig = 0;
  const pos = mesh.positions;
  for (let i = 0; i < pos.length; i++) sig += pos[i] * ((i % 7) + 1);
  return {
    vertices: pos.length / 3,
    triangles: mesh.indices.length / 3,
    size,
    wOverH: Math.max(size[0], size[2]) / (size[1] || 1),
    signature: sig,
  };
}
/** Sygnatura szkieletu (punkty + promienie) — wykrywa jakąkolwiek zmianę geometrii */
export function skeletonSignature(sk: TreeSkeleton): number {
  let s = sk.stems.length * 1000;
  for (const st of sk.stems) {
    for (let i = 0; i < st.px.length; i++) {
      s += st.px[i] * 1.3 + st.py[i] * 2.7 + st.pz[i] * 3.1 + st.r[i] * 5.9;
    }
  }
  return s;
}

// ---------- klasyfikacja ----------
export type EfficacyClass = 'martwy' | 'iluzoryczny' | 'nasycony' | 'skuteczny';
export interface Classification {
  cls: EfficacyClass;
  /** |średnia (ostatnia - pierwsza)| / max(|średnia pierwszej|, eps) */
  sensitivity: number;
  effect: number;
  seedSpread: number;
  consistent: number; // liczba ziaren o kierunku zgodnym z oczekiwanym
  note: string;
}
export type Direction = 'up' | 'down' | 'any';

/**
 * @param data data[v][s] = metryka dla wartości v i ziarna s
 * @param baseIdx indeks wartości domyślnej (do rozrzutu między ziarnami)
 */
export function classify(data: number[][], dir: Direction, baseIdx = 0): Classification {
  const nV = data.length;
  const nS = data[0].length;
  const maxAbsDiff = Math.max(
    ...data.flatMap((row, v) => row.map((x, s) => Math.abs(x - data[0][s]) * (v === 0 ? 0 : 1)))
  );
  const first = data[0];
  const last = data[nV - 1];
  const meanFirst = mean(first);
  const meanLast = mean(last);
  const effect = Math.abs(meanLast - meanFirst);
  const spread = std(data[Math.min(baseIdx, nV - 1)]);
  const sensitivity = effect / Math.max(Math.abs(meanFirst), 1e-9);
  const sign = dir === 'down' ? -1 : 1;
  let consistent = 0;
  for (let s = 0; s < nS; s++) {
    const d = last[s] - first[s];
    if (dir === 'any' ? d !== 0 : d * sign > 1e-12) consistent++;
  }
  if (maxAbsDiff < 1e-9) return { cls: 'martwy', sensitivity: 0, effect: 0, seedSpread: spread, consistent: 0, note: 'metryka identyczna dla wszystkich wartości' };
  // nasycenie: wartości po pewnym punkcie nic nie zmieniają (średnia po ziarnach)
  const means = data.map(mean);
  let plateauFrom = -1;
  for (let v = nV - 2; v >= 0; v--) {
    if (Math.abs(means[v + 1] - means[v]) < 1e-9) plateauFrom = v;
    else break;
  }
  if (plateauFrom >= 0) {
    return {
      cls: 'nasycony',
      sensitivity,
      effect,
      seedSpread: spread,
      consistent,
      note: `efekt znika od wartości #${plateauFrom + 1} z ${nV}`,
    };
  }
  const minConsistent = Math.ceil(nS * 0.875);
  if (consistent < minConsistent) return { cls: 'iluzoryczny', sensitivity, effect, seedSpread: spread, consistent, note: `kierunek zgodny tylko w ${consistent}/${nS} ziaren` };
  if (effect <= spread) return { cls: 'iluzoryczny', sensitivity, effect, seedSpread: spread, consistent, note: 'efekt <= rozrzut między ziarnami' };
  return { cls: 'skuteczny', sensitivity, effect, seedSpread: spread, consistent, note: '' };
}

/** Uruchamia metrykę po wartościach × ziarnach */
export function sweep(values: number[], seeds: number[], run: (value: number, seed: number) => number): number[][] {
  return values.map((v) => seeds.map((s) => run(v, s)));
}

// ---------- zdefiniowane sweepy (współdzielone przez test i raport) ----------
export interface SweepDef {
  id: string;
  param: string;
  metric: string;
  species: TreeSpecies;
  values: number[];
  dir: Direction;
  build: (p: Profile, v: number) => Profile;
  measure: (species: TreeSpecies, profile: Profile, seed: number) => number;
}
const L1 = (sp: TreeSpecies, p: Profile, seed: number) => levelStems(skeleton(sp, p, seed), 1);
const sk = skeleton;

export const TARGETED_SWEEPS: SweepDef[] = [
  { id: 'trunkLengthRatio', param: 'trunkLengthRatio', metric: 'długość pnia', species: 'OAK', values: [0.5, 0.7, 0.9, 1.1], dir: 'up',
    build: (p, v) => ({ ...p, trunkLengthRatio: v }), measure: (s, p, seed) => trunkLength(sk(s, p, seed)) },
  { id: 'trunkHeightRatio', param: 'trunkHeightRatio', metric: 'y nasady korony', species: 'OAK', values: [0.15, 0.25, 0.35, 0.5], dir: 'up',
    build: (p, v) => ({ ...p, trunkHeightRatio: v }), measure: (s, p, seed) => crownBaseY(sk(s, p, seed)) },
  { id: 'L1.lengthRatio', param: 'levels[0].lengthRatio', metric: 'mediana długości L1', species: 'OAK', values: [0.4, 0.7, 1, 1.4], dir: 'up',
    build: (p, v) => withLevel(p, 0, { lengthRatio: v }), measure: (s, p, seed) => medianLevelLength(sk(s, p, seed), 1) },
  { id: 'L1.lengthV', param: 'levels[0].lengthV', metric: 'rozrzut długości L1', species: 'OAK', values: [0, 0.2, 0.5, 1], dir: 'up',
    build: (p, v) => withLevel(p, 0, { lengthV: v }), measure: (s, p, seed) => lengthSpreadLevel(sk(s, p, seed), 1) },
  { id: 'L1.count', param: 'levels[0].count', metric: 'liczba pędów L1', species: 'OAK', values: [4, 8, 16, 32], dir: 'up',
    build: (p, v) => withLevel(p, 0, { count: v }), measure: (s, p, seed) => stemCount(sk(s, p, seed), 1) },
  { id: 'L2.count', param: 'levels[1].count', metric: 'liczba pędów L2', species: 'OAK', values: [2, 5, 10, 20], dir: 'up',
    build: (p, v) => withLevel(p, 1, { count: v }), measure: (s, p, seed) => stemCount(sk(s, p, seed), 2) },
  { id: 'L2.baseSize', param: 'levels[1].baseSize', metric: 'średnie y nasady L2', species: 'OAK', values: [0, 0.1, 0.3, 0.5], dir: 'any',
    build: (p, v) => withLevel(p, 1, { baseSize: v }), measure: (s, p, seed) => meanAttachHeight(sk(s, p, seed), 2) },
  { id: 'L1.curveRes', param: 'levels[0].curveRes', metric: 'punkty na pęd L1 (z dziećmi L2)', species: 'OAK', values: [1, 3, 6, 12, 24], dir: 'up',
    build: (p, v) => withLevel(p, 0, { curveRes: v }), measure: (s, p, seed) => meanPointsPerStem(sk(s, p, seed), 1) },
  { id: 'L1.curveRes.iso', param: 'levels[0].curveRes (pęd bez dzieci)', metric: 'punkty na pęd L1', species: 'OAK', values: [1, 3, 6, 12, 24], dir: 'up',
    build: (p, v) => withLevel({ ...p, levels: [p.levels[0]] }, 0, { curveRes: v }), measure: (s, p, seed) => meanPointsPerStem(sk(s, p, seed), 1) },
  { id: 'radialSegments', param: 'radialSegments', metric: 'trójkąty siatki', species: 'OAK', values: [3, 4, 5, 6, 7, 8, 9, 10, 12, 16], dir: 'up',
    build: (p, v) => ({ ...p, radialSegments: v }), measure: (s, p, seed) => meshStats(s, p, seed).triangles },
  { id: 'trunkTipRatio', param: 'trunkTipRatio', metric: 'r_tip/r0 pnia', species: 'OAK', values: [0.05, 0.1, 0.3, 0.6], dir: 'up',
    build: (p, v) => ({ ...p, trunkTipRatio: v, flareFactor: 1 }), measure: (s, p, seed) => tipOverBase(trunk(sk(s, p, seed))) },
  { id: 'L1.tipRatio', param: 'levels[0].tipRatio', metric: 'mediana r_tip/r0 L1', species: 'OAK', values: [0.05, 0.1, 0.3, 0.6], dir: 'up',
    build: (p, v) => withLevel(p, 0, { tipRatio: v }), measure: (s, p, seed) => medianTip(L1(s, p, seed)) },
  { id: 'taperShape', param: 'taperShape', metric: 'r(0.5)/r0 pnia', species: 'OAK', values: [0, 0.5, 1], dir: 'down',
    build: (p, v) => ({ ...p, taperShape: v, trunkTipRatio: 0.1, flareFactor: 1 }), measure: (s, p, seed) => { const t = trunk(sk(s, p, seed)); return radiusAtArc(t, 0.5) / t.r[0]; } },
  { id: 'ratioPower', param: 'ratioPower', metric: 'r0 dzieci L1 / r rodzica', species: 'OAK', values: [0.5, 1, 1.25, 2, 3], dir: 'down',
    build: (p, v) => ({ ...p, ratioPower: v }), measure: (s, p, seed) => childOverParentRadius(sk(s, p, seed), 1) },
  { id: 'flareFactor', param: 'flareFactor', metric: 'r nasady / r(0.5) pnia', species: 'OAK', values: [1, 1.12, 1.5, 2.5], dir: 'up',
    build: (p, v) => ({ ...p, flareFactor: v }), measure: (s, p, seed) => trunkBaseFlare(sk(s, p, seed)) },
  { id: 'flareFactor.tip', param: 'flareFactor', metric: 'r czubka pnia (bez zmian)', species: 'OAK', values: [1, 1.12, 1.5, 2.5], dir: 'any',
    build: (p, v) => ({ ...p, flareFactor: v }), measure: (s, p, seed) => trunkTipRadius(sk(s, p, seed)) },
];

export function runSweep(def: SweepDef, seeds = SEEDS): number[][] {
  const base = baseProfile(def.species);
  return sweep(def.values, seeds, (v, seed) => def.measure(def.species, def.build(base, v), seed));
}

/**
 * Klasyfikacja sparowana (do metryk o dużym stałym offsecie, np. sygnatur): różnice względem wartości #0
 * liczone osobno dla każdego ziarna; efekt = |średnia różnic|, rozrzut = std różnic, zgodność = ziarna o znaku większości.
 */
export function classifyPaired(data: number[][]): Classification {
  const nV = data.length;
  const nS = data[0].length;
  const maxAbsDiff = Math.max(...data.flatMap((row) => row.map((x, s) => Math.abs(x - data[0][s]))));
  if (maxAbsDiff < 1e-9) return { cls: 'martwy', sensitivity: 0, effect: 0, seedSpread: 0, consistent: 0, note: 'metryka identyczna dla wszystkich wartości' };
  const dx = data[nV - 1].map((x, s) => x - data[0][s]);
  const pos = dx.filter((d) => d > 0).length;
  const neg = dx.filter((d) => d < 0).length;
  const consistent = Math.max(pos, neg);
  const effect = Math.abs(mean(dx));
  const spread = std(dx);
  const sensitivity = effect / Math.max(Math.abs(mean(data[0])), 1e-9);
  const minC = Math.ceil(nS * 0.875);
  if (consistent < minC) return { cls: 'iluzoryczny', sensitivity, effect, seedSpread: spread, consistent, note: `znak zmiany zgodny tylko w ${consistent}/${nS} ziaren` };
  if (effect <= spread) return { cls: 'iluzoryczny', sensitivity, effect, seedSpread: spread, consistent, note: 'efekt <= rozrzut zmiany między ziarnami' };
  return { cls: 'skuteczny', sensitivity, effect, seedSpread: spread, consistent, note: '' };
}
