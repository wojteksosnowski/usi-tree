import { describe, it, expect } from 'vitest';
import { TreeGenerator, SPECIES_PROFILES, type TreeSpecies, type TrunkForm, type TreeSkeleton } from '../index.js';

/**
 * Ciągłość szkieletu (opcjonalnie z segmentDecay 0.8) dla wszystkich profili bazowych.
 * Wyłącznie SPECIES_PROFILES (nigdy fittedProfiles.json). Reguły jak w branchContinuity (H1–H3).
 */
const SPECIES = Object.keys(SPECIES_PROFILES) as TreeSpecies[];
const SEEDS = [1, 42];
const FORMS: TrunkForm[] = ['SINGLE', 'FORKED', 'MULTI'];
const VARIANTS: Array<{ name: string; decay?: number }> = [{ name: 'target' }, { name: 'target + segmentDecay 0.8', decay: 0.8 }];

function build(sp: TreeSpecies, seed: number, form: TrunkForm, decay?: number): TreeSkeleton {
  const b = SPECIES_PROFILES[sp];
  const profile = {
    ...b,
    ...(decay ? { trunkSegmentDecay: decay } : {}),
    levels: b.levels.map((l) => ({ ...l, ...(decay ? { segmentDecay: decay } : {}) })),
  };
  return TreeGenerator.buildSkeleton({ species: sp, height: 12, seed, form, profile });
}

function check(sk: TreeSkeleton, form: TrunkForm): string[] {
  const bad: string[] = [];
  if (!sk.stems.length) bad.push('brak pędów');
  sk.stems.forEach((s, si) => {
    for (let i = 0; i < s.r.length - 1; i++) {
      const ratio = s.r[i + 1] / s.r[i];
      if (!(s.r[i + 1] <= s.r[i] + 1e-9)) bad.push(`#${si} L${s.level} ring ${i}: rozszerzenie ${s.r[i]}->${s.r[i + 1]}`);
      if (!(ratio >= 0.78 - 1e-6)) bad.push(`#${si} L${s.level} ring ${i}: ratio=${ratio.toFixed(3)}`);
    }
    if (s.level === 0) return;
    let best = Infinity, parentR = Infinity;
    for (const p of sk.stems) {
      if (p.level !== s.level - 1) continue;
      for (let j = 0; j < p.px.length; j++) {
        const d = Math.hypot(p.px[j] - s.px[0], p.py[j] - s.py[0], p.pz[j] - s.pz[0]);
        if (d < best) { best = d; parentR = p.r[j]; }
      }
    }
    if (!(best < 1e-5)) bad.push(`#${si} L${s.level}: brak rodzica w punkcie odgałęzienia (d=${best})`);
    else if (!(s.r[0] <= parentR * 0.9 + 1e-6)) bad.push(`#${si} L${s.level}: r0=${s.r[0]} > 0.9*${parentR}`);
  });
  if (form === 'FORKED') {
    const l0 = sk.stems.filter((s) => s.level === 0);
    if (l0.length !== 3) bad.push(`FORKED: oczekiwano 3 pędów L0, jest ${l0.length}`);
    else {
      const [lower, main, side] = l0;
      const top = lower.r[lower.r.length - 1];
      if (lower.r.length - 1 < 6) bad.push(`FORKED: dolny pień ma ${lower.r.length - 1} segmentów (<6)`);
      // Dolnej granicy 0.65*top nie wymuszamy: prune zmniejsza lidera także w legacy (SPRUCE/POPLAR/ASPEN, identycznie)
      if (!(main.r[0] <= top + 1e-6)) bad.push(`FORKED: rMain=${main.r[0]} vs rTopFork=${top}`);
      if (!(side.r[0] <= top + 1e-6)) bad.push(`FORKED: rSide=${side.r[0]} > ${top}`);
    }
  }
  return bad;
}

describe('Ciągłość szkieletu (wszystkie gatunki bazowe)', () => {
  for (const v of VARIANTS) {
    for (const sp of SPECIES) {
      it(`${sp} [${v.name}]: monotoniczność, ratio>=0.78, r0 dziecka<=0.9 rodzica, FORKED`, () => {
        const bad: string[] = [];
        for (const seed of SEEDS) for (const form of FORMS) {
          for (const m of check(build(sp, seed, form, v.decay), form)) bad.push(`seed ${seed} ${form}: ${m}`);
        }
        expect(bad.slice(0, 10)).toEqual([]);
      }, 60000);
    }
  }
});
