#!/usr/bin/env node
/**
 * fit_tree_graph.ts
 *
 * Dopasowanie parametrów generatora do GRAFU GAŁĘZI wzorca (bez renderu i bez analizy obrazu w pętli):
 *   1. wzorzec → graf (raz: `imageToBranchGraph` albo gotowy graph_*.json),
 *   2. kandydat → `TreeGenerator.buildSkeleton` → `skeletonToBranchGraph` (czysta geometria, ~ms),
 *   3. koszt = `compareBranchGraphs` uśredniony po kilku ziarnach + kara za kikuty (wskaźnik granatu),
 *   4. przeszukiwanie współrzędnościowe z malejącym krokiem (deterministyczne, raport składników kosztu).
 *
 * CLI:
 *   npx tsx fit_tree_graph.ts <wzorzec.png|graph.json> --species OAK [--iterations 6] [--seeds 42,107,314]
 *        [--out tmp/tree-renders/fitted_graph_<species>.json] [--png tmp/tree-renders/fit_graph_<species>.png] [--apply]
 */

import fs from 'node:fs';
import path from 'node:path';
import { TreeGenerator, SPECIES_PROFILES, TIDY_STRUCTURE, type SpeciesProfile, type TreeSpecies } from '../../../../src/index.js';
import {
  imageToBranchGraph, skeletonToBranchGraph, describeBranchGraph, compareBranchGraphs, writeBranchGraphsPng,
  type BranchGraph, type GraphDescriptor,
} from './tree_branch_graph';

/** Parametr strojony: odczyt/zapis w profilu + zakres + krok początkowy */
interface Knob { name: string; get: (p: SpeciesProfile) => number | undefined; set: (p: SpeciesProfile, v: number) => void; min: number; max: number; step: number; int?: boolean }

const lvl = (i: number, key: 'downAngle' | 'downAngleSlope' | 'curve' | 'curveV' | 'count' | 'lengthRatio' | 'tropism' | 'fork' | 'curveBack' | 'baseSize',
  min: number, max: number, step: number, int = false): Knob => ({
  name: `levels[${i}].${key}`,
  get: (p) => p.levels[i]?.[key],
  set: (p, v) => { if (p.levels[i]) (p.levels[i] as unknown as Record<string, number>)[key] = v; },
  min, max, step, int,
});

const KNOBS: Knob[] = [
  { name: 'crownSpreadRatio', get: (p) => p.crownSpreadRatio, set: (p, v) => { p.crownSpreadRatio = v; }, min: 0.15, max: 1.2, step: 0.08 },
  { name: 'trunkHeightRatio', get: (p) => p.trunkHeightRatio, set: (p, v) => { p.trunkHeightRatio = v; }, min: 0.05, max: 0.7, step: 0.06 },
  { name: 'trunkLengthRatio', get: (p) => p.trunkLengthRatio, set: (p, v) => { p.trunkLengthRatio = v; }, min: 0.3, max: 1.0, step: 0.1 },
  { name: 'trunkCurveV', get: (p) => p.trunkCurveV, set: (p, v) => { p.trunkCurveV = v; }, min: 0, max: 20, step: 3 },
  { name: 'pliancy', get: (p) => p.pliancy ?? 0, set: (p, v) => { p.pliancy = v; }, min: 0, max: 45, step: 6 },
  lvl(0, 'downAngle', 15, 90, 8), lvl(0, 'downAngleSlope', -20, 50, 8), lvl(0, 'curve', -40, 50, 8),
  lvl(0, 'curveV', 0, 30, 4), lvl(0, 'count', 3, 30, 3, true), lvl(0, 'lengthRatio', 0.3, 1.5, 0.12),
  lvl(0, 'tropism', -0.8, 0.4, 0.1),
  lvl(1, 'downAngle', 15, 90, 8), lvl(1, 'curve', -40, 50, 8), lvl(1, 'curveV', 0, 30, 4),
  lvl(1, 'count', 2, 20, 2, true), lvl(1, 'lengthRatio', 0.2, 1.0, 0.08),
  lvl(1, 'tropism', -1.2, 0.2, 0.15),
  lvl(2, 'downAngle', 15, 90, 8), lvl(2, 'curve', -40, 50, 8),
  lvl(2, 'count', 2, 15, 2, true), lvl(2, 'lengthRatio', 0.2, 1.0, 0.08),
  lvl(2, 'tropism', -1.5, 0.0, 0.2),
  // Rozszerzenia Sapling — strojone tylko, gdy profil startowy je ma (np. z sapling_to_profile.ts)
  lvl(0, 'curveBack', -60, 40, 8), lvl(1, 'curveBack', -80, 40, 10), lvl(2, 'curveBack', -120, 40, 15),
  lvl(1, 'baseSize', 0, 0.6, 0.06), lvl(2, 'baseSize', 0, 0.6, 0.06),
];

export interface FitGraphResult { profile: SpeciesProfile; initial: number; final: number; terms: Record<string, number>; ref: GraphDescriptor; best: GraphDescriptor }

export async function fitTreeGraph(opts: { reference: string; species: TreeSpecies; iterations?: number; seeds?: number[]; threshold?: number; startProfile?: SpeciesProfile }): Promise<FitGraphResult & { refGraph: BranchGraph; bestGraph: BranchGraph }> {
  const refGraph: BranchGraph = opts.reference.endsWith('.json')
    ? JSON.parse(fs.readFileSync(opts.reference, 'utf-8'))
    : await imageToBranchGraph(opts.reference, { threshold: opts.threshold });
  const ref = describeBranchGraph(refGraph);
  const seeds = opts.seeds ?? [42, 107, 314];
  const species = opts.species;

  // Deskryptor mierzy tylko rzędy 0–2 — w pętli rosną bez witek (rząd 3), co skraca ewaluację kilkukrotnie
  const forFit = (p: SpeciesProfile): SpeciesProfile => ({ ...p, levels: p.levels.slice(0, 2) });
  const graphOf = (p: SpeciesProfile, seed: number) => skeletonToBranchGraph(TreeGenerator.buildSkeleton({ species, height: 12, seed, profile: p }));
  const cost = (p: SpeciesProfile): { total: number; terms: Record<string, number> } => {
    const acc: Record<string, number> = {};
    let total = 0;
    for (const seed of seeds) {
      try {
        const skel = TreeGenerator.buildSkeleton({ species, height: 12, seed, profile: forFit(p) });
        const c = compareBranchGraphs(ref, describeBranchGraph(skeletonToBranchGraph(skel)));
        const clipped = skel.stems.filter((s) => s.clipped).length / Math.max(1, skel.stems.length);
        c.terms.clipped = clipped * 2;
        for (const [k, v] of Object.entries(c.terms)) acc[k] = (acc[k] ?? 0) + v / seeds.length;
        total += (c.total + c.terms.clipped) / seeds.length;
      } catch {
        total += 100;
      }
    }
    return { total, terms: acc };
  };

  let best: SpeciesProfile = structuredClone(opts.startProfile ?? { ...SPECIES_PROFILES[species], ...TIDY_STRUCTURE });
  let bestCost = cost(best);
  const initial = bestCost.total;
  const steps = new Map(KNOBS.map((k) => [k.name, k.step]));
  const iterations = opts.iterations ?? 8;

  for (let it = 0; it < iterations; it++) {
    const prevCost = bestCost.total;
    let improved = 0;
    for (const k of KNOBS) {
      const v0 = k.get(best);
      if (v0 === undefined) continue;
      const step = steps.get(k.name)!;
      let moved = false;
      for (const dir of [1, -1]) {
        let v = Math.min(k.max, Math.max(k.min, v0 + dir * step));
        if (k.int) v = Math.round(v);
        if (v === v0) continue;
        const cand = structuredClone(best);
        k.set(cand, v);
        const c = cost(cand);
        if (c.total < bestCost.total - 1e-4) { best = cand; bestCost = c; moved = true; improved++; break; }
      }
      if (!moved) steps.set(k.name, k.int ? Math.max(1, Math.round(step / 2)) : step / 2);
    }
    const delta = prevCost - bestCost.total;
    console.log(`[graf] runda ${it + 1}/${iterations}: koszt ${bestCost.total.toFixed(3)} (zmian: ${improved}, spadek: ${delta.toFixed(3)})`);
    if (it >= 2 && delta < 0.05) {
      console.log(`[graf] Poprawa stała się zaniedbywalna (${delta.toFixed(3)} < 0.05). Zatrzymanie pętli.`);
      break;
    }
    if (!improved && it > 1) break;
  }

  const bestGraph = graphOf(best, seeds[0]);
  return { profile: best, initial, final: bestCost.total, terms: bestCost.terms, ref, best: describeBranchGraph(bestGraph), refGraph, bestGraph };
}

if (process.argv[1] && process.argv[1].endsWith('fit_tree_graph.ts')) {
  const args = process.argv.slice(2);
  const get = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };
  if (!args[0] || args.includes('--help')) {
    console.log('Użycie: npx tsx fit_tree_graph.ts <wzorzec.png|graph.json> --species OAK [--iterations 6] [--seeds 42,107,314] [--start profil.json] [--out profil.json] [--png podglad.png] [--apply]');
    process.exit(0);
  }
  const species = (get('--species') ?? 'OAK') as TreeSpecies;
  const start = get('--start');
  fitTreeGraph({
    reference: args[0],
    species,
    iterations: Number(get('--iterations') ?? 6),
    seeds: get('--seeds')?.split(',').map(Number),
    threshold: get('--threshold') ? Number(get('--threshold')) : undefined,
    startProfile: start ? JSON.parse(fs.readFileSync(start, 'utf-8')) : undefined,
  }).then(async (r) => {
    const out = get('--out') ?? `tmp/tree-renders/fitted_graph_${species.toLowerCase()}.json`;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(r.profile, null, 2));
    const png = get('--png') ?? `tmp/tree-renders/fit_graph_${species.toLowerCase()}.png`;
    await writeBranchGraphsPng(png, [{ g: r.refGraph, color: '#9ca3af' }, { g: r.bestGraph }]);
    if (args.includes('--apply')) {
      const fp = path.resolve('src/core/fittedProfiles.json');
      const list = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      const item = list.find((f: { startSpecies?: string; id?: string }) => f.startSpecies === species || f.id === species);
      if (item) { item.profile = r.profile; fs.writeFileSync(fp, JSON.stringify(list, null, 2)); console.log(`Zaktualizowano ${fp}`); }
    }
    const top = Object.entries(r.terms).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`\nKoszt: ${r.initial.toFixed(3)} → ${r.final.toFixed(3)}\nProfil: ${out}\nPodgląd (szary = wzorzec, kolor = kandydat): ${png}`);
    console.log('Największe składniki pozostałej różnicy:');
    for (const [k, v] of top) console.log(`  ${k.padEnd(18)} ${v.toFixed(3)}`);
    const row = (n: string, a: number, b: number) => console.log(`  ${n.padEnd(18)} wzorzec ${a.toFixed(3).padStart(8)}  kandydat ${b.toFixed(3).padStart(8)}`);
    console.log('Cechy grafu:');
    row('spread', r.ref.spread, r.best.spread);
    row('crownBase', r.ref.crownBase, r.best.crownBase);
    r.ref.levels.forEach((l, i) => {
      const c = r.best.levels[i];
      if (!c) return;
      for (const key of ['perParent', 'angle', 'angleSlope', 'lengthRatio', 'bend', 'wiggle', 'droop'] as const) row(`L${i + 1}.${key}`, l[key], c[key]);
    });
  });
}
