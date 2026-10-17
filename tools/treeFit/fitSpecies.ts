// Ocena i dopasowanie profili gatunków do sylwetek z alfabetu drzew (scripts/treeFit/referenceMetrics.json).
// Uruchomienie: npx tsx scripts/treeFit/fitSpecies.ts [iteracje=500] [wzorzec,…]  (z listą wzorców — dopasowuje tylko je, resztę wyników zostawia)
// Zmienne: FIT_TIDY=1, FIT_STRUCTURE_WEIGHT=w, FIT_STEM_BUDGET=plik, FIT_OUT=plik, TREEFIT_SEEDS=… (opis przy stałych poniżej i w evaluate.ts)
import fs from 'node:fs';
import { TreeGenerator, SPECIES_PROFILES, TIDY_STRUCTURE, FastPrng, type SpeciesProfile, type TreeSpecies, type CrownShape, type TrunkForm } from '../../src/index.js';
import { silhouetteMetrics, type SilhouetteMetrics } from './silhouetteMetrics';
import { SEEDS, evalProfile as evalAt } from './evaluate';
import { rasterize } from './rasterize';
import { structureMetrics } from './structureMetrics';

/**
 * FIT_STRUCTURE_WEIGHT=w: koszt = odległość sylwetki + w · wskaźnik granatu (structureMetrics) — sama sylwetka
 * nagradza chaos we wnętrzu korony. FIT_TIDY=1: start od dotychczasowego wyniku z TIDY_STRUCTURE.
 */
const STRUCTURE_WEIGHT = Number(process.env.FIT_STRUCTURE_WEIGHT ?? 0);
const FIT_TIDY = process.env.FIT_TIDY === '1';
const grenade = (p: SpeciesProfile, sp: TreeSpecies, f: TrunkForm) =>
  SEEDS.reduce((a, seed) => a + structureMetrics(TreeGenerator.buildSkeleton({ species: sp, height: 10, seed, profile: p, form: f })).grenade, 0) / SEEDS.length;
/**
 * FIT_STEM_BUDGET=plik z profilami (np. sprzed zmiany): kara za liczbę pędów ponad budżet ×1,05 z tego pliku —
 * pędy (i liście na nich) to trójkąty w widoku 3D, więc dopasowanie nie może kupować sylwetki gęstością.
 */
const STEM_BUDGET_FILE = process.env.FIT_STEM_BUDGET;
let stemBudget = Infinity;
const stemCount = (p: SpeciesProfile, sp: TreeSpecies, f: TrunkForm) =>
  SEEDS.reduce((a, seed) => a + TreeGenerator.buildSkeleton({ species: sp, height: 10, seed, profile: p, form: f }).stems.length, 0) / SEEDS.length;
const evalProfile = (p: SpeciesProfile, sp: TreeSpecies, t: SilhouetteMetrics, f: TrunkForm) =>
  evalAt(p, sp, t, f, TARGET_H) + (STRUCTURE_WEIGHT > 0 ? STRUCTURE_WEIGHT * grenade(p, sp, f) : 0)
  + (stemBudget < Infinity ? 3 * Math.max(0, stemCount(p, sp, f) / stemBudget - 1) : 0);
const REF: { name: string; metrics: SilhouetteMetrics }[] = JSON.parse(fs.readFileSync('scripts/treeFit/referenceMetrics.json', 'utf8'));
let TARGET_H = 170;

/** FIT_KEEP_SCAFFOLD=1: wyżarzanie nie wyłącza konarów głównych (sprawdzenie, ile kosztuje mechanizm wymagany stylem) */
const KEEP_SCAFFOLD = process.env.FIT_KEEP_SCAFFOLD === '1';

const SHAPES: CrownShape[] = ['CONICAL', 'SPHERICAL', 'HEMISPHERICAL', 'TEND_FLAME', 'CYLINDRICAL', 'UMBRELLA'];
const clone = (p: SpeciesProfile): SpeciesProfile => JSON.parse(JSON.stringify(p));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Losowa modyfikacja jednego parametru (krok proporcjonalny do temperatury) */
function mutate(p: SpeciesProfile, form: TrunkForm, rng: FastPrng, temp: number): [SpeciesProfile, TrunkForm] {
  const q = clone(p); const l1 = q.levels[0]; const l2 = q.levels[1];
  const k = Math.floor(rng.next() * (q.prune ? 17 : 15));
  const j = (v: number, span: number) => v + rng.signedRange(span * temp);
  switch (k) {
    case 0: q.crownSpreadRatio = clamp(j(q.crownSpreadRatio, 0.2), 0.08, 0.95); break;
    case 1: q.trunkHeightRatio = clamp(j(q.trunkHeightRatio, 0.15), 0.02, 0.65); break;
    case 2: q.trunkLengthRatio = clamp(j(q.trunkLengthRatio, 0.2), 0.2, 1.0); break;
    case 3: q.crownShape = SHAPES[Math.floor(rng.next() * SHAPES.length)]; break;
    case 4: l1.downAngle = clamp(j(l1.downAngle, 25), 10, 95); break;
    case 5: l1.downAngleSlope = clamp(j(l1.downAngleSlope ?? 0, 25), 0, 60); break;
    case 6: l1.curve = clamp(j(l1.curve, 25), -40, 50); break;
    case 7: l1.count = Math.round(clamp(j(l1.count, 8), 4, 40)); break;
    case 8: q.trunkBaseRadiusRatio = clamp(j(q.trunkBaseRadiusRatio, 0.012), 0.005, 0.06); break;
    case 9: if (l2) l2.lengthRatio = clamp(j(l2.lengthRatio, 0.2), 0.25, 0.95); break;
    case 10: l1.tropism = clamp(j(l1.tropism, 0.6), -2.5, 1.0); break;
    case 11: if (q.levels[2]) q.levels[2].count = Math.round(clamp(j(q.levels[2].count, 4), 2, 12)); break;
    case 12: q.ratioPower = clamp(j(q.ratioPower, 0.3), 0.9, 1.6); break;
    case 13: q.limbsReachEnvelope = !q.limbsReachEnvelope; break;
    case 15: q.outwardBias = clamp(j(q.outwardBias ?? 0.5, 0.4), 0, 1); break;
    case 16: q.twigGnarl = clamp(j(q.twigGnarl ?? 0.3, 0.4), 0, 1); break;
    case 14: q.scaffoldLimbs = q.scaffoldLimbs ? (rng.next() < 0.3 && !KEEP_SCAFFOLD ? undefined : Math.round(clamp(j(q.scaffoldLimbs, 2), 2, 7))) : 3 + Math.floor(rng.next() * 3); break;
  }
  return [q, form];
}

function fit(start: SpeciesProfile, species: TreeSpecies, target: SilhouetteMetrics, iters: number, startForm: TrunkForm) {
  const rng = new FastPrng(4242);
  let cur = clone(start), curForm = startForm, curD = evalProfile(cur, species, target, curForm);
  let best = cur, bestForm = curForm, bestD = curD;
  for (let i = 0; i < iters; i++) {
    const temp = 1 - i / iters;
    const [cand, cf] = mutate(cur, curForm, rng, 0.25 + 0.75 * temp);
    const d = evalProfile(cand, species, target, cf);
    if (d < curD || rng.next() < Math.exp(-(d - curD) / (0.05 * temp + 1e-4))) { cur = cand; curForm = cf; curD = d; }
    if (d < bestD) { best = cand; bestForm = cf; bestD = d; }
  }
  return { best, bestForm, bestD };
}

// Wzorce europejskie / sadzone w Polsce → gatunek startowy
// [wzorzec, gatunek startowy (nieużywany — start od najbliższego), nazwa PL, pokrój ustalony]
const TARGETS: [string, TreeSpecies, string, TrunkForm][] = [
  ['Beech', 'OAK', 'buk', 'SINGLE'], ['Elm', 'ASH', 'wiąz', 'SINGLE'], ['Horsechestnut', 'OAK', 'kasztanowiec', 'SINGLE'], ['Linden', 'OAK', 'lipa', 'SINGLE'],
  ['Sycamore', 'OAK', 'jawor', 'SINGLE'], ['Oak', 'ASH', 'dąb (młody)', 'SINGLE'], ['Quaking Aspen', 'ASPEN', 'osika', 'SINGLE'],
  ['Weeping Willow', 'WILLOW', 'wierzba płacząca', 'SINGLE'], ['Viburnum', 'BUSH', 'kalina', 'MULTI'], ['Dogwood', 'ASH', 'dereń', 'MULTI'],
  ['Apple', 'OAK', 'jabłoń', 'SINGLE'],
];

// Nadpisania punktu startowego dla dopasowania częściowego (nowe mechanizmy generatora, których wyżarzanie samo nie włączy)
const START_PATCH: Record<string, Partial<SpeciesProfile>> = {
  Elm: { scaffoldLimbs: 4 },
};

const iters = Number(process.argv[2] ?? 500);
const onlyRefs = process.argv[3]?.split(',');
const FITTED = '../../src/core/fittedProfiles.json';
const results: any[] = onlyRefs && fs.existsSync(FITTED) ? JSON.parse(fs.readFileSync(FITTED, 'utf8')) : [];
const ALL = Object.keys(SPECIES_PROFILES) as TreeSpecies[];
for (const [refName, startSp, pl, form] of TARGETS) {
  if (onlyRefs && !onlyRefs.includes(refName)) continue;
  const refRow = REF.find((r) => r.name === refName)! as any;
  const target = refRow.metrics;
  TARGET_H = refRow.box[3] - refRow.box[1] + 1;
  // Ocena obecnej biblioteki: najlepszy istniejący gatunek bez zmian parametrów
  let nearest = { sp: '', d: Infinity };
  for (const sp of ALL) { const d = evalProfile(SPECIES_PROFILES[sp], sp, target, form); if (d < nearest.d) nearest = { sp, d }; }
  if (STEM_BUDGET_FILE) {
    const b = JSON.parse(fs.readFileSync(STEM_BUDGET_FILE, 'utf8')).find((x: any) => x.ref === refName);
    stemBudget = b ? 1.05 * stemCount(b.profile, b.startSpecies, b.form) : Infinity;
  }
  const t0 = Date.now();
  const baseSp = startSp;
  // Dopasowanie częściowe startuje od dotychczasowego wyniku (pętla iteracyjna), pełne — od biblioteki
  const prev = onlyRefs ? results.find((x) => x.ref === refName) : undefined;
  const start: SpeciesProfile = { ...(prev ? { ...prev.profile, ...START_PATCH[refName] } : SPECIES_PROFILES[baseSp]), ...(FIT_TIDY ? TIDY_STRUCTURE : {}) };
  const { best, bestForm, bestD } = fit(start, baseSp, target, iters, form);
  const r = rasterize(best, baseSp, SEEDS[0], bestForm);
  const m = silhouetteMetrics(r.mask, r.W, r.H)!;
  const row = {ref: refName, pl, startSpecies: baseSp, nearestExisting: nearest.sp, distExisting: +nearest.d.toFixed(3), distFitted: +evalAt(best, baseSp, target, bestForm, TARGET_H).toFixed(3), form: bestForm, profile: best, target, fitted: m };
  const at = results.findIndex((x) => x.ref === refName);
  if (at >= 0) results[at] = row; else results.push(row);
  console.log(`${pl.padEnd(18)} istniejący ${nearest.sp.padEnd(7)} ${nearest.d.toFixed(2)} → dopasowany ${bestD.toFixed(2)}  [${bestForm}, ${best.crownShape}]  W/H ${target.aspect.toFixed(2)}/${m.aspect.toFixed(2)} base ${target.crownBase.toFixed(2)}/${m.crownBase.toFixed(2)} pień ${target.trunk.toFixed(3)}/${m.trunk.toFixed(3)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
// FIT_OUT=plik: zapis gdzie indziej (równoległe dopasowania różnych wzorców; scalenie ręczne)
fs.writeFileSync(process.env.FIT_OUT ?? FITTED, JSON.stringify(process.env.FIT_OUT ? results.filter((x) => onlyRefs?.includes(x.ref)) : results, null, 1));
