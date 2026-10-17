#!/usr/bin/env node
/**
 * sapling_to_profile.ts
 *
 * Konwersja presetu Blender Sapling Tree Gen (model Webera–Penna) na `SpeciesProfile` USI Light —
 * punkt startowy dla `fit_tree_graph.ts --start`. Tablice per poziom: [L0 pień, L1 konary, L2 gałęzie, L3 witki].
 *
 * Przełożenie (jednostki i znaki różnią się od Sapling!):
 * - Curvature / Back Curvature: Sapling „+” = w dół, u nas „+” = w górę → znak odwrócony; z backCurve ≠ 0
 *   `curve` = pierwsza połowa pędu, `curveBack` = druga (jak w Weber–Penn).
 * - Curvature Variation: Sapling dzieli przez curveRes na segment, u nas kąt na segment → curveV / curveRes.
 * - Down Angle Variation ujemne (gradient wzdłuż rodzica, dolne bardziej rozłożyste):
 *   kąt u nasady = downAngle + |v|, u szczytu = downAngle − |v| → downAngle − |v| + downAngleSlope 2|v|.
 * - Length[1] = skala konarów względem wysokości → crownSpreadRatio; Length[i ≥ 2] → lengthRatio rzędu.
 * - Base Size → trunkHeightRatio; Secondary Base Size (lub baseSize[i]) → levels[].baseSize.
 * - Rotate / Rotate Variation → levels[].rotate / rotateV.
 * - Taper, Radius, Bevel, Curve Resolution > 6: pominięte — grubość i gładkość należą do kreski (ILLUSTRATION_STROKE).
 * - Split Height / Split Angle: brak odpowiednika w połowie pnia (tylko `form: 'FORKED'` / `fork`) — raportowane jako pominięte.
 *
 * CLI: npx tsx sapling_to_profile.ts <preset_sapling.json> [--base BIRCH] [--out profil.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { SPECIES_PROFILES, TIDY_STRUCTURE, type BranchLevelParams, type CrownShape, type SpeciesProfile, type TreeSpecies } from '../../../../src/index.js';

export interface SaplingPreset {
  name?: string;
  shape?: string;                // 'Conical' | 'Spherical' | 'Hemispherical' | 'Cylindrical' | 'Tapered Cylindrical' | 'Flame' | 'Inverse Conical' | 'Tend Flame'
  baseSize: number;              // Trunk Height (Base Size)
  secondaryBaseSize?: number;
  splitHeight?: number;
  splitAngle?: number;
  length: number[];
  lengthV: number[];
  branches: number[];
  curveRes: number[];
  downAngle: number[];
  downAngleV: number[];
  rotate?: number[];
  rotateV?: number[];
  curve: number[];
  curveV: number[];
  curveBack?: number[];
  baseSizeLevels?: number[];     // opcjonalnie start odgałęzień per poziom (ułamek rodzica), nadpisuje secondaryBaseSize
}

const SHAPES: Record<string, CrownShape> = {
  conical: 'CONICAL', spherical: 'SPHERICAL', hemispherical: 'HEMISPHERICAL', cylindrical: 'CYLINDRICAL',
  'tapered cylindrical': 'CYLINDRICAL', flame: 'TEND_FLAME', 'tend flame': 'TEND_FLAME', 'inverse conical': 'UMBRELLA',
};

export function saplingToProfile(s: SaplingPreset, baseSpecies: TreeSpecies): { profile: SpeciesProfile; skipped: string[] } {
  const base = structuredClone({ ...SPECIES_PROFILES[baseSpecies], ...TIDY_STRUCTURE }) as SpeciesProfile;
  const skipped: string[] = [];
  const nLevels = Math.min(3, s.branches.length - 1);
  const levels: BranchLevelParams[] = [];
  for (let i = 1; i <= nLevels; i++) {
    const prev = base.levels[i - 1] ?? base.levels[base.levels.length - 1];
    const res = Math.max(2, Math.min(6, s.curveRes[i] ?? prev.curveRes));
    const v = s.downAngleV[i] ?? 0;
    const back = s.curveBack?.[i] ?? 0;
    const lvl: BranchLevelParams = {
      ...prev,
      count: s.branches[i],
      downAngle: v < 0 ? s.downAngle[i] + v : s.downAngle[i],
      downAngleV: v < 0 ? prev.downAngleV : v,
      downAngleSlope: v < 0 ? -2 * v : prev.downAngleSlope,
      lengthRatio: i === 1 ? 1 : s.length[i],
      lengthV: s.lengthV[i] ?? prev.lengthV,
      curve: -(s.curve[i] ?? 0),
      curveV: Math.round(((s.curveV[i] ?? 0) / (s.curveRes[i] || res)) * 10) / 10,
      curveRes: res,
      tropism: 0,
    };
    if (back !== 0) lvl.curveBack = -back;
    if (s.rotate?.[i] !== undefined) lvl.rotate = s.rotate[i];
    if (s.rotateV?.[i] !== undefined) lvl.rotateV = s.rotateV[i];
    const bs = s.baseSizeLevels?.[i] ?? (i >= 2 ? s.secondaryBaseSize : undefined);
    if (bs !== undefined) lvl.baseSize = bs;
    levels.push(lvl);
  }
  const shape = s.shape ? SHAPES[s.shape.toLowerCase()] : undefined;
  if (s.shape && !shape) skipped.push(`shape „${s.shape}” (zostaje ${base.crownShape})`);
  if (s.splitHeight !== undefined) skipped.push(`splitHeight ${s.splitHeight} / splitAngle ${s.splitAngle ?? '?'} (brak rozwidleń w połowie pnia)`);
  skipped.push('taper, radius, bevel, curveRes > 6 (kreska ILLUSTRATION_STROKE)');
  return {
    profile: {
      ...base,
      crownShape: shape ?? base.crownShape,
      trunkHeightRatio: s.baseSize,
      trunkCurveV: Math.round(((s.curveV[0] ?? 0) / (s.curveRes[0] || 10)) * 10) / 10 || base.trunkCurveV,
      crownSpreadRatio: s.length[1],
      levels,
      // Wiotkość i tropizm przejmują krzywizna i curveBack z presetu — dopasowanie grafu może je przywrócić
      pliancy: 0,
    },
    skipped,
  };
}

if (process.argv[1] && process.argv[1].endsWith('sapling_to_profile.ts')) {
  const args = process.argv.slice(2);
  const get = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };
  if (!args[0] || args.includes('--help')) {
    console.log('Użycie: npx tsx sapling_to_profile.ts <preset_sapling.json> [--base BIRCH] [--out profil.json]');
    process.exit(0);
  }
  const preset = JSON.parse(fs.readFileSync(args[0], 'utf-8')) as SaplingPreset;
  const baseSpecies = (get('--base') ?? 'BIRCH') as TreeSpecies;
  const { profile, skipped } = saplingToProfile(preset, baseSpecies);
  const out = get('--out') ?? `tmp/tree-renders/sapling_${path.parse(args[0]).name}.json`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(profile, null, 2));
  console.log(`Profil (baza ${baseSpecies}) → ${out}`);
  console.log('Pominięte:\n  - ' + skipped.join('\n  - '));
}
