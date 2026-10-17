import { describe, expect, it } from 'vitest';
import FITTED from '../core/fittedProfiles.json' with { type: 'json' };
import { TreeGenerator, type SpeciesProfile, type TreeSpecies } from '../core/TreeGenerator.js';
import { heightClassM, profileAtHeight, type HeightAnchor } from '../core/heightProfile.js';
import { treeKindParams } from '../core/treeSpeciesRegistry.js';

const entries = (FITTED as unknown as { ref: string; startSpecies: TreeSpecies; heightAnchors?: HeightAnchor[] }[]).filter((f) => f.heightAnchors);

describe('profil zależny od wysokości', () => {
  it('klon, brzoza, lipa, wiąz i jesion mają węzły wysokości', () => {
    expect(entries.map((e) => e.ref).sort()).toEqual(['ASH', 'BIRCH', 'Elm', 'Linden', 'Sycamore']);
  });

  it('węzły jednego rodzaju mają ten sam zestaw pól (pole w części węzłów przeskakuje skokowo w połowie odstępu)', () => {
    for (const e of entries) {
      const keys = e.heightAnchors!.map((a) => Object.keys(a.profile).sort().join(','));
      expect(new Set(keys).size, e.ref).toBe(1);
    }
  });

  it('w węzłach zwraca dokładnie strojony profil, poniżej najniższego — najniższy', () => {
    for (const e of entries) {
      for (const a of e.heightAnchors!) expect(profileAtHeight(e.heightAnchors!, a.h)).toEqual(a.profile);
      expect(profileAtHeight(e.heightAnchors!, 3)).toEqual(e.heightAnchors![0].profile);
    }
  });

  it('między węzłami wartość leży między wartościami węzłów (po log2 h)', () => {
    const lo = { trunkHeightRatio: 0.2, levels: [{ count: 10, downAngle: 40 }] } as unknown as SpeciesProfile;
    const hi = { trunkHeightRatio: 0.3, levels: [{ count: 20, downAngle: 60 }] } as unknown as SpeciesProfile;
    const mid = profileAtHeight([{ h: 6, profile: lo }, { h: 24, profile: hi }], 12);
    expect(mid.trunkHeightRatio).toBeCloseTo(0.25);
    expect(mid.levels[0].count).toBe(15);
    expect(mid.levels[0].downAngle).toBeCloseTo(50);
  });

  it('ekstrapolacja do 24 m zostaje w zakresach i daje drzewo bez kikutów', () => {
    for (const e of entries) {
      for (const h of [6, 8.5, 12, 17, 24, 30]) {
        const { species, profile } = treeKindParams(e.ref as never, h);
        expect(profile!.trunkHeightRatio).toBeGreaterThanOrEqual(0.05);
        expect(profile!.crownSpreadRatio).toBeLessThanOrEqual(1.2);
        const sk = TreeGenerator.buildSkeleton({ species, height: h, seed: 42, profile });
        expect(sk.stems.length).toBeGreaterThan(10);
        expect(sk.stems.filter((s) => s.clipped).length / sk.stems.length).toBeLessThanOrEqual(0.4);
      }
    }
  });

  it('klasy wysokości co pół oktawy w zakresie 6–24 m', () => {
    expect([2, 6, 8, 10, 12, 15, 17, 20, 24, 40].map(heightClassM)).toEqual([6, 6, 8.5, 8.5, 12, 17, 17, 17, 24, 24]);
  });
});
