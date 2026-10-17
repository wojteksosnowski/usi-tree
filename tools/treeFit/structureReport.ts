// Porównanie struktury (wskaźnik granatu) i odległości sylwetki: profil bez zmian → z TIDY_STRUCTURE (albo nadpisaniami).
// Uruchomienie: npx tsx scripts/treeFit/structureReport.ts [wzorzec|GATUNEK] [pole=wartość …]
//   bez nadpisań porównuje z TIDY_STRUCTURE; z nadpisaniami — z TIDY_STRUCTURE + nadpisania (np. outwardBias=0.7)
import fs from 'node:fs';
import { TreeGenerator, SPECIES_PROFILES, TIDY_STRUCTURE, type SpeciesProfile, type TreeSpecies, type TrunkForm } from '../../src/index.js';
import { structureMetrics, type StructureMetrics } from './structureMetrics';
import { SEEDS, evalProfile } from './evaluate';

const fitted = JSON.parse(fs.readFileSync('../../src/core/fittedProfiles.json', 'utf8'));
const ref = JSON.parse(fs.readFileSync('scripts/treeFit/referenceMetrics.json', 'utf8'));
const args = process.argv.slice(2);
const only = args.find((a) => !a.includes('='));
const overrides = Object.fromEntries(args.filter((a) => a.includes('=')).map((a) => { const [k, v] = a.split('='); return [k, JSON.parse(v)]; }));

function structure(profile: SpeciesProfile, species: TreeSpecies, form: TrunkForm): StructureMetrics {
  const acc = { clipped: 0, stubs: 0, inward: 0, turn: 0, grenade: 0 };
  for (const seed of SEEDS) {
    const m = structureMetrics(TreeGenerator.buildSkeleton({ species, height: 10, seed, profile, form }));
    for (const k of Object.keys(acc) as (keyof StructureMetrics)[]) acc[k] += m[k] / SEEDS.length;
  }
  return acc;
}
const fmt = (m: StructureMetrics) => `granat ${m.grenade.toFixed(2)} (cięte ${(m.clipped * 100).toFixed(0)}% kikuty ${(m.stubs * 100).toFixed(0)}% do środka ${(m.inward * 100).toFixed(0)}% zwrot ${m.turn.toFixed(1)}°)`;

const rows: { name: string; species: TreeSpecies; form: TrunkForm; profile: SpeciesProfile; target?: any; h?: number }[] = [
  ...fitted.map((f: any) => {
    const box = ref.find((r: any) => r.name === f.ref).box;
    return { name: f.ref, species: f.startSpecies, form: f.form, profile: f.profile, target: f.target, h: box[3] - box[1] + 1 };
  }),
  ...(Object.keys(SPECIES_PROFILES) as TreeSpecies[]).map((sp) => ({ name: sp, species: sp, form: 'SINGLE' as TrunkForm, profile: SPECIES_PROFILES[sp] })),
];
for (const r of rows) {
  if (only && r.name !== only) continue;
  const tidy = { ...r.profile, ...TIDY_STRUCTURE, ...overrides };
  const a = structure(r.profile, r.species, r.form), b = structure(tidy, r.species, r.form);
  const dist = r.target ? `  sylwetka ${evalProfile(r.profile, r.species, r.target, r.form, r.h!).toFixed(3)} → ${evalProfile(tidy, r.species, r.target, r.form, r.h!).toFixed(3)}` : '';
  console.log(`${r.name.padEnd(15)} ${fmt(a)}\n${''.padEnd(15)} ${fmt(b)}${dist}`);
}
