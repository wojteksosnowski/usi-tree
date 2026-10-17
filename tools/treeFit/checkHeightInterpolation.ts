/**
 * Test hipotezy skalowania z wysokością: profil 9 m interpolowany po log2(h) z węzłów 6 i 15 m
 * porównany (graf gałęzi, rzędy 0–2) z ręcznie strojonym profilem 9 m. Skala: odległość sąsiednich
 * węzłów (6 m i 15 m) od profilu 9 m. Do tego ekstrapolacja 24 m (stan skrajny parametrów, kikuty).
 *
 * npx tsx scripts/treeFit/checkHeightInterpolation.ts
 */
import fs from 'node:fs';
import { TreeGenerator, type SpeciesProfile, type TreeSpecies } from '../../src/index.js';
import { profileAtHeight } from '../../src/index.js';
import { skeletonToBranchGraph, describeBranchGraph, compareBranchGraphs } from '../../.agents/skills/procedural-tree-fitter/scripts/tree_branch_graph';

const DIR = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa';
const SETS: Record<string, { species: TreeSpecies; files: [string, string, string] }> = {
  brzoza: { species: 'BIRCH', files: ['brzoza_Betula/brzoza_mala_6m.json', 'brzoza_Betula/brzoza_9m_zwisajaca.json', 'brzoza_Betula/brzoza_15m_pokroj.json'] },
  klon: { species: 'OAK', files: ['klon-jawor_Acer/klon_6m_cukrowy.json', 'klon-jawor_Acer/klon_9m_zloty.json', 'klon-jawor_Acer/klon_15m_korona.json'] },
  wiaz: { species: 'OAK', files: ['wiaz_Ulmus/wiaz_6m_ulmus.json', 'wiaz_Ulmus/wiaz_9m_ulmus.json', 'wiaz_Ulmus/wiaz_15m_ulmus.json'] },
  lipa: { species: 'OAK', files: ['lipa_Tilia/lipa_6m_drobnolistna.json', 'lipa_Tilia/lipa_9m_drobnolistna.json', 'lipa_Tilia/lipa_15m_drobnolistna.json'] },
};
const SEEDS = [42, 107, 314];
const load = (f: string) => JSON.parse(fs.readFileSync(`${DIR}/${f}`, 'utf-8')) as SpeciesProfile;
const forFit = (p: SpeciesProfile): SpeciesProfile => ({ ...p, levels: p.levels.slice(0, 2) });
const desc = (species: TreeSpecies, p: SpeciesProfile, seed: number, height = 12) =>
  describeBranchGraph(skeletonToBranchGraph(TreeGenerator.buildSkeleton({ species, height, seed, profile: forFit(p) })));
const dist = (species: TreeSpecies, ref: SpeciesProfile, cand: SpeciesProfile) =>
  SEEDS.reduce((s, seed) => s + compareBranchGraphs(desc(species, ref, seed), desc(species, cand, seed)).total, 0) / SEEDS.length;
const noise = (species: TreeSpecies, p: SpeciesProfile) =>
  SEEDS.reduce((s, seed, i) => s + compareBranchGraphs(desc(species, p, seed), desc(species, p, SEEDS[(i + 1) % SEEDS.length])).total, 0) / SEEDS.length;
const clipped = (species: TreeSpecies, p: SpeciesProfile, h: number) => {
  const sk = TreeGenerator.buildSkeleton({ species, height: h, seed: 42, profile: p });
  return sk.stems.filter((s) => s.clipped).length / Math.max(1, sk.stems.length);
};

const only = process.argv[2];
for (const [name, { species, files }] of Object.entries(SETS)) {
  if (only && name !== only) continue;
  const [p6, p9, p15] = files.map(load);
  const interp = profileAtHeight([{ h: 6, profile: p6 }, { h: 15, profile: p15 }], 9);
  const p24 = profileAtHeight([{ h: 6, profile: p6 }, { h: 9, profile: p9 }, { h: 15, profile: p15 }], 24);
  const r = {
    'szum ziaren 9m': noise(species, p9),
    'interp9 ↔ 9m': dist(species, p9, interp),
    '6m ↔ 9m': dist(species, p9, p6),
    '15m ↔ 9m': dist(species, p9, p15),
    'kikuty 24m': clipped(species, p24, 24),
  };
  console.log(`=== ${name}`);
  for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(16)} ${v.toFixed(3)}`);
  fs.mkdirSync('tmp/tree-renders', { recursive: true });
  fs.writeFileSync(`tmp/tree-renders/height_${name}_9interp.json`, JSON.stringify(interp, null, 2));
  fs.writeFileSync(`tmp/tree-renders/height_${name}_24.json`, JSON.stringify(p24, null, 2));
}
