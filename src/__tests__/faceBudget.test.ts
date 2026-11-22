import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import {
  TreeGenerator,
  SPECIES_PROFILES,
  ILLUSTRATION_STROKE,
  TREE_LOD_PRESETS,
  countMeshTriangles,
  type TreeSpecies,
  type TreeLodName,
} from '../index.js';

/**
 * Bezpiecznik budżetu ścian: baza = SPECIES_PROFILES (nigdy fittedProfiles.json).
 * Aktualizacja migawki: UPDATE_FACE_BUDGET=1 npx vitest run src/__tests__/faceBudget.test.ts
 */
const FIXTURE_PATH = decodeURIComponent(new URL('./fixtures/faceBudget.json', import.meta.url).pathname);
const HEIGHTS = [4, 12, 24];
const SEEDS = [1, 42];
const LODS = ['full', ...Object.keys(TREE_LOD_PRESETS)] as (TreeLodName | 'full')[];
const SPECIES = Object.keys(SPECIES_PROFILES) as TreeSpecies[];
const WARN = 0.05;
const FAIL = 0.25;

interface Cell {
  bark: number;
  leaf: number;
  vertices: number;
  stems: Record<string, number>;
}
/** Warianty: '' = domyślny (klucze bez prefiksu); pozostałe mają prefiks `${nazwa}|`. */
const VARIANTS: Array<{ name: string; patch?: { decay?: number } }> = [
  { name: '' },
  { name: 'decay085', patch: { decay: 0.85 } },
];
const key = (sp: string, h: number, lod: string, seed: number, variant = '') =>
  `${variant ? variant + '|' : ''}${sp}/${h}/${lod}/${seed}`;
function variantProfile(sp: TreeSpecies, patch: NonNullable<(typeof VARIANTS)[number]['patch']>) {
  const b = SPECIES_PROFILES[sp];
  return {
    ...b,
    ...(patch.decay ? { trunkSegmentDecay: patch.decay } : {}),
    levels: b.levels.map((l) => ({
      ...l,
      ...(patch.decay ? { segmentDecay: patch.decay } : {}),
    })),
  };
}

const cells = new Map<string, Cell>();
let nanCells: string[] = [];

function compute(): void {
  for (const v of VARIANTS) for (const sp of SPECIES) {
    for (const h of HEIGHTS) {
      for (const seed of SEEDS) {
        const params = {
          species: sp, height: h, seed, withFoliageAccents: true, stroke: ILLUSTRATION_STROKE,
          ...(v.patch ? { profile: variantProfile(sp, v.patch) } : {}),
        } as const;
        const sk = TreeGenerator.buildSkeleton(params);
        const stems: Record<string, number> = {};
        for (const s of sk.stems) stems[s.level] = (stems[s.level] ?? 0) + 1;
        for (const lod of LODS) {
          const res = TreeGenerator.meshSkeletonRaw(sk, lod === 'full' ? params : { ...params, lod: TREE_LOD_PRESETS[lod] });
          const t = countMeshTriangles(res.mesh);
          const k = key(sp, h, lod, seed, v.name);
          if (res.mesh.positions.some((v) => !Number.isFinite(v))) nanCells.push(k);
          cells.set(k, { bark: t.bark, leaf: t.foliage, vertices: res.mesh.positions.length / 3, stems });
        }
      }
    }
  }
}

describe('faceBudget', () => {
  it('buduje macierz i porównuje z migawką', () => {
    compute();
    const update = (globalThis as any).process.env.UPDATE_FACE_BUDGET === '1';
    if (update || !existsSync(FIXTURE_PATH)) {
      if (!update) throw new Error('Brak fixtures/faceBudget.json — uruchom: UPDATE_FACE_BUDGET=1 npx vitest run src/__tests__/faceBudget.test.ts');
      writeFileSync(FIXTURE_PATH, JSON.stringify(Object.fromEntries(cells), null, 1) + '\n');
      return;
    }
    const fx = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, Cell>;
    const missing: string[] = [];
    const warns: string[] = [];
    const fails: string[] = [];
    for (const [k, now] of cells) {
      const old = fx[k];
      if (!old) { missing.push(k); continue; }
      for (const f of ['bark', 'leaf'] as const) {
        const before = old[f], after = now[f];
        const d = before === 0 ? (after === 0 ? 0 : Infinity) : (after - before) / before;
        const line = `${k} [${f}]: ${before} → ${after} (${Number.isFinite(d) ? (d * 100).toFixed(1) : '∞'}%)`;
        const ratio = before === 0 ? (after === 0 ? 1 : Infinity) : after / before;
        if (Math.abs(d) > FAIL || ratio > 2 || (before > 0 && ratio < 0.5)) fails.push(line);
        else if (Math.abs(d) > WARN) warns.push(line);
      }
    }
    if (warns.length) console.warn(`faceBudget: zmiany 5–25% (${warns.length}):\n${warns.join('\n')}`);
    if (missing.length) throw new Error(`Brak komórek w fixture (${missing.length}), uruchom UPDATE_FACE_BUDGET=1: ${missing.slice(0, 5).join(', ')}`);
    expect(fails, `Budżet ścian przekroczony:\n${fails.join('\n')}`).toEqual([]);
  }, 600000);

  it('brak NaN w pozycjach', () => {
    if (!cells.size) compute();
    expect(nanCells).toEqual([]);
  }, 600000);

  it('trójkąty nie maleją: shell ≤ far ≤ mid ≤ near (full pominięty: near ma liście quad, a pełna siatka hex, więc bywa > full)', () => {
    if (!cells.size) compute();
    const order = ['shell', 'far', 'mid', 'near'];
    const bad: string[] = [];
    for (const v of VARIANTS) for (const sp of SPECIES) for (const h of HEIGHTS) for (const seed of SEEDS) {
      const tri = order.map((l) => { const c = cells.get(key(sp, h, l, seed, v.name))!; return c.bark + c.leaf; });
      for (let i = 1; i < tri.length; i++) if (tri[i] < tri[i - 1]) bad.push(`${v.name}|${sp}/${h}/${seed}: ${order[i - 1]}=${tri[i - 1]} > ${order[i]}=${tri[i]}`);
    }
    expect(bad).toEqual([]);
  }, 600000);

  it('trójkąty kory nie maleją z wysokością', () => {
    if (!cells.size) compute();
    const bad: string[] = [];
    for (const v of VARIANTS) for (const sp of SPECIES) for (const lod of LODS) for (const seed of SEEDS) {
      const b = HEIGHTS.map((h) => cells.get(key(sp, h, lod, seed, v.name))!.bark);
      for (let i = 1; i < b.length; i++) if (b[i] < b[i - 1]) bad.push(`${v.name}|${sp}/${lod}/${seed}: h${HEIGHTS[i - 1]}=${b[i - 1]} > h${HEIGHTS[i]}=${b[i]}`);
    }
    expect(bad).toEqual([]);
  }, 600000);
});
