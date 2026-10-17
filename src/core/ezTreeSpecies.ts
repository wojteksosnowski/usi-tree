/**
 * Własne presety wzrostu ez-tree dla gatunków, których ez-tree nie ma (`ezTree.ts`, jednostki jak w presetach ez-tree).
 * Pokrój z opisów dendrologicznych; strojone na zrzutach (`renderTreeVariantsHeadless.ts`, tryb ez_species).
 */
import type { EzTreeOptions } from './ezTree.js';
import type { SpeciesProfile } from './TreeGenerator.js';

export interface EzSpeciesPreset {
  ez: EzTreeOptions;
  /** Nadpisania profilu siatki (liście w naszej stylizacji) */
  mesh?: Partial<SpeciesProfile>;
}

/**
 * Strojenie presetu ez-tree pod wzorce stylu (SA_Artboard2, SA_AI_Template): gałęzie wznoszące się pod niewielkim
 * kątem do rodzica, małe falowanie i bez skrętu (gałęzie „podążają systemem”, nie sterczą w każdą stronę),
 * pień bez gałęzi do ~1/3 wysokości. Iglaste bez zmian kątów (piętra gałęzi są dla nich właściwe).
 */
export function stabilizeToDesign(ez: EzTreeOptions): EzTreeOptions {
  if (ez.type === 'evergreen') return ez;
  const b = ez.branch;
  const map = (r: Record<number, number>, f: (v: number, k: number) => number) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, f(v, Number(k))])) as Record<number, number>;
  return {
    ...ez,
    branch: {
      ...b,
      angle: map(b.angle, (v, k) => Math.min(v, k === 1 ? 38 : 34)),
      gnarliness: map(b.gnarliness, (v) => Math.sign(v) * Math.min(Math.abs(v) * 0.45, 0.08)),
      twist: map(b.twist, () => 0),
      start: map(b.start, (v, k) => (k === 1 ? Math.max(v, 0.32) : v)),
      // Wzniesienie gałęzi; preset bez siły (krzewy rozłożyste) zostaje bez niej
      force: { ...b.force, strength: b.force.strength > 0 ? Math.max(b.force.strength, 0.015) : b.force.strength },
    },
  };
}

export const EZ_SPECIES_PRESETS: Record<string, EzSpeciesPreset> = {
  /**
   * Wierzba płacząca (Salix × sepulcralis, S. alba 'Tristis'): pień krótki, bez przewodnika, nisko rozwidlony na
   * kilka grubych konarów wznoszących się skośnie (30–50° od pionu) i łukowato rozchodzących się na boki;
   * zwisają długie, cienkie pędy jak kurtyna, konary nie. Siła w dół działa ∝ 1/r: konary prawie sztywne,
   * gałęzie wygięte w łuk, witki zwisają pionowo.
   */
  'Weeping Willow': {
    ez: {
      type: 'deciduous',
      scaffold: { count: 4, height: 0.16, lean: 38, leanV: 8 },
      branch: {
        levels: 3,
        angle: { 1: 42, 2: 38, 3: 25 },
        children: { 0: 7, 1: 5, 2: 6 },
        force: { direction: { x: 0, y: -1, z: 0 }, strength: 0.012 },
        gnarliness: { 0: 0.04, 1: 0.06, 2: 0.05, 3: 0.02 },
        length: { 0: 40, 1: 15, 2: 9, 3: 13 },
        radius: { 0: 2.2, 1: 0.55, 2: 0.55, 3: 0.4 },
        sections: { 0: 12, 1: 9, 2: 7, 3: 8 },
        segments: { 0: 8, 1: 5, 2: 4, 3: 3 },
        start: { 1: 0.3, 2: 0.2, 3: 0.1 },
        taper: { 0: 0.6, 1: 0.7, 2: 0.7, 3: 0.7 },
        twist: { 0: 0.05, 1: 0, 2: 0, 3: 0 },
      },
      leaves: { angle: 25, count: 10, start: 0.1, size: 2, sizeVariance: 0.4 },
    },
    mesh: { leafAspect: 0.25, leafClump: 5, leafSizeRatio: 0.013 },
  },
};
