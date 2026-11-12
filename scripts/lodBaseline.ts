/**
 * Pomiar poziomów LOD: trójkąty kory i listowia dotychczasowych ustawień near/far aplikacji (usi-light)
 * oraz presetów `TREE_LOD_PRESETS`, z miarą zachowania wyglądu względem `near`.
 * Uruchomienie: `npx tsx scripts/lodBaseline.ts`
 */
import { TreeGenerator, SPECIES_PROFILES, ILLUSTRATION_STROKE, DEFAULT_LEAF_DENSITY } from '../src/core/TreeGenerator.js';
import { FITTED_PROFILES } from '../src/profiles/index.js';
import { treeKindParams, type TreeKind } from '../src/core/treeSpeciesRegistry.js';
import { TREE_LOD_PRESETS, countMeshTriangles } from '../src/core/treeLod.js';
import { lodFidelity } from '../src/fitter/lodFidelity.js';
import type { SpeciesProfile, TreeSkeleton } from '../src/core/types.js';

const kinds = [...new Set([...Object.keys(SPECIES_PROFILES), ...FITTED_PROFILES.map((f) => f.ref)])] as TreeKind[];
const seeds = [11, 22, 33];
const HEIGHT = 10;

/** Profil widoku bliskiego aplikacji (`isoTreeLibrary.ts`, CITY_FOLIAGE): rzadsze, większe liście */
function cityProfile(b: SpeciesProfile, far: boolean): SpeciesProfile {
  return {
    ...b,
    leafDensity: (b.leafDensity ?? DEFAULT_LEAF_DENSITY) * (far ? 0.12 : 0.3),
    leafSizeRatio: b.leafSizeRatio * (far ? 5.5 : 3.2),
    leafClump: Math.max(1, Math.round((b.leafClump ?? 4) * (far ? 0.25 : 0.4))),
  };
}

/** Dotychczasowe wywołanie aplikacji */
function legacy(sk: TreeSkeleton, far: boolean) {
  return TreeGenerator.meshSkeletonRaw(
    { ...sk, profile: cityProfile(sk.profile, far) },
    { withFoliageAccents: true, detail: 'LOW', radialSegments: far ? 3 : 4, stroke: ILLUSTRATION_STROKE }
  ).mesh;
}

const f2 = (v: number) => v.toFixed(2);
const names = ['near', 'mid', 'far', 'shell'] as const;
const worst = names.slice(1).map(() => ({ over: 0, roughLo: 9, roughHi: 0, brLo: 9, brHi: -9, outline: 1 }));
for (const kind of kinds) {
  const tri: number[] = new Array(12).fill(0);
  const fid: number[][] = [[], [], []];
  const maxTotal = [0, 0, 0, 0];
  for (const seed of seeds) {
    const p = treeKindParams(kind, HEIGHT);
    const sk = TreeGenerator.buildSkeleton({ species: p.species, height: HEIGHT, seed, form: p.form, profile: p.profile });
    const olds = [legacy(sk, false), legacy(sk, true)].map(countMeshTriangles);
    const lods = TreeGenerator.meshSkeletonLodsRaw({ ...sk, profile: cityProfile(sk.profile, false) }, names.map((n) => TREE_LOD_PRESETS[n]), {
      withFoliageAccents: true,
      stroke: ILLUSTRATION_STROKE,
    });
    olds.forEach((t, i) => { tri[i * 2] += t.bark; tri[i * 2 + 1] += t.foliage; });
    lods.forEach((l, i) => { tri[4 + i * 2] += l.triangles.bark; tri[5 + i * 2] += l.triangles.foliage; maxTotal[i] = Math.max(maxTotal[i], l.triangles.total); });
    [1, 2, 3].forEach((i) => {
      const f = lodFidelity(lods[0].mesh, lods[i].mesh);
      const row = [f.side.iou, f.side.iouOutline, f.side.iouBark, f.top.iouOutline, f.side.overhang, f.top.overhang, f.side.roughnessRatio, f.side.brightnessDelta, f.top.brightnessDelta, f.toneShareDelta];
      row.forEach((v, k) => { fid[i - 1][k] = (fid[i - 1][k] ?? 0) + v / seeds.length; });
      const w = worst[i - 1];
      w.over = Math.max(w.over, f.side.overhang, f.top.overhang);
      w.roughLo = Math.min(w.roughLo, f.side.roughnessRatio); w.roughHi = Math.max(w.roughHi, f.side.roughnessRatio);
      w.brLo = Math.min(w.brLo, f.side.brightnessDelta); w.brHi = Math.max(w.brHi, f.side.brightnessDelta);
      w.outline = Math.min(w.outline, f.side.iouOutline);
    });
  }
  const t = tri.map((v) => Math.round(v / seeds.length));
  console.log(`${kind.padEnd(15)} baza near ${t[0]}/${t[1]} far ${t[2]}/${t[3]} | near ${t[4]}/${t[5]} mid ${t[6]}/${t[7]} far ${t[8]}/${t[9]} shell ${t[10]}/${t[11]} | max ${maxTotal.join(' ')}`);
  ['mid', 'far', 'shell'].forEach((n, i) => {
    const f = fid[i].map(f2);
    console.log(`   ${n.padEnd(5)} bok ${f[0]} obrys ${f[1]} kora ${f[2]} | góra obrys ${f[3]} | wystawanie bok ${f[4]} góra ${f[5]} | chropowatość ${f[6]} | jasność bok ${f[7]} góra ${f[8]} | tonΔ ${f[9]}`);
  });
}
['mid', 'far', 'shell'].forEach((n, i) => console.log('SKRAJNE', n, JSON.stringify(worst[i], (_, v) => (typeof v === 'number' ? +v.toFixed(3) : v))));
