import { describe, it, expect } from 'vitest';
import { applyPipeRadii, growEzTree } from '../core/ezTree.js';
import { EZ_TREE_PRESETS, type EzTreePresetName } from '../core/ezTreePresets.js';
import { TreeGenerator, ILLUSTRATION_STROKE } from '../three/index.js';

const TRIAL: EzTreePresetName[] = ['Oak Medium', 'Ash Medium', 'Aspen Medium', 'Pine Medium', 'Bush 1'];

describe('ez-tree (wzrost)', () => {
  it('jest deterministyczny i daje różne drzewa dla różnych ziaren', () => {
    const a = growEzTree(EZ_TREE_PRESETS['Oak Medium'], 7);
    const b = growEzTree(EZ_TREE_PRESETS['Oak Medium'], 7);
    const c = growEzTree(EZ_TREE_PRESETS['Oak Medium'], 8);
    expect(a).toEqual(b);
    expect(c.stems[3].px).not.toEqual(a.stems[3].px);
  });

  it('liczba pędów na poziom wynika z presetu (przedłużenie końcowe + dzieci)', () => {
    // Dąb Medium: pień, 6 konarów + przedłużenie, każdy z 4 dziećmi + przedłużeniem, …
    const { stems, leafSites } = growEzTree(EZ_TREE_PRESETS['Oak Medium'], 1);
    const perLevel = [0, 1, 2, 3].map((l) => stems.filter((s) => s.level === l).length);
    expect(perLevel).toEqual([1, 7, 35, 140]);
    // Na każdym pędzie ostatniego rzędu: count liści + liść końcowy
    expect(leafSites.length / 7).toBe(140 * (EZ_TREE_PRESETS['Oak Medium'].leaves.count + 1));
    expect(stems.every((s) => !s.clipped)).toBe(true);
  });

  it('gałęzie zbiegają się ku końcowi (bez kikutów)', () => {
    for (const name of TRIAL) {
      const { stems } = growEzTree(EZ_TREE_PRESETS[name], 3);
      for (const s of stems) {
        if (s.level === 0) continue;
        // ez-tree kończy najdrobniejszy rząd stałym promieniem 0,001 (może przewyższać bardzo cienką nasadę)
        expect(s.r[s.r.length - 1]).toBeLessThanOrEqual(Math.max(s.r[0], 0.001) + 1e-9);
      }
    }
  });

  it('pokroje B2: rozdwojony ma 2 przewodniki nad krótkim pniem, wielopniowy 3–5 od gruntu', () => {
    const forked = growEzTree(EZ_TREE_PRESETS['Ash Medium'], 5, 'FORKED').stems.filter((s) => s.level === 0);
    expect(forked).toHaveLength(3);
    const multi = growEzTree(EZ_TREE_PRESETS['Ash Medium'], 5, 'MULTI').stems.filter((s) => s.level === 0);
    expect(multi.length).toBeGreaterThanOrEqual(3);
    expect(multi.length).toBeLessThanOrEqual(5);
    for (const s of multi) expect(s.py[0]).toBe(0);
  });

  it('w TreeGenerator: wysokość, liście w trzech tonach i brak NaN', () => {
    for (const name of TRIAL) {
      const res = TreeGenerator.generate({ species: 'OAK', height: 12, seed: 4, ez: EZ_TREE_PRESETS[name], withFoliageAccents: true, detail: 'LOW', stroke: ILLUSTRATION_STROKE });
      expect(Math.abs(res.bounds.height - 12)).toBeLessThan(0.8);
      const groups = new Set(res.geometry.groups.map((g) => g.materialIndex));
      expect(groups.has(0)).toBe(true);
      expect([1, 2, 3].some((m) => groups.has(m))).toBe(true);
      const pos = res.geometry.getAttribute('position').array as Float32Array;
      for (let i = 0; i < pos.length; i++) expect(Number.isNaN(pos[i])).toBe(false);
    }
  }, 30000);

  it('model rur: promień nie rośnie ku końcowi pędu, przedłużenie zaczyna się promieniem końca rodzica', () => {
    const sk = growEzTree(EZ_TREE_PRESETS['Ash Medium'], 9);
    applyPipeRadii(sk, 2.5, 1);
    for (let i = 0; i < sk.stems.length; i++) {
      const s = sk.stems[i];
      for (let k = 1; k < s.r.length; k++) expect(s.r[k]).toBeLessThanOrEqual(s.r[k - 1] + 1e-9);
      const p = sk.parents[i];
      if (p >= 0 && sk.attach[i] >= sk.stems[p].r.length - 1 - 1e-9) {
        // Przedłużenie końcowe: koniec rodzica ≥ nasada dziecka (ciągła grubość, bez uskoku w górę)
        expect(sk.stems[p].r[sk.stems[p].r.length - 1]).toBeGreaterThanOrEqual(s.r[0] - 1e-9);
      }
      expect(s.r[s.r.length - 1]).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });
});
