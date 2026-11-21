import { describe, expect, it } from 'vitest';
import FITTED from '../core/fittedProfiles.json' with { type: 'json' };
import { TreeGenerator, type SpeciesProfile, type TreeSpecies } from '../core/TreeGenerator.js';
import { fitParameterCurve, heightClassM, profileAtHeight, scaleProfileByHeight, type HeightAnchor } from '../core/heightProfile.js';
import { describeTreeKindModelSource, treeKindParams } from '../core/treeSpeciesRegistry.js';
import { SPECIES_PROFILES } from '../core/speciesProfiles.js';

const entries = (FITTED as unknown as { ref: string; startSpecies: TreeSpecies; heightAnchors?: HeightAnchor[] }[]).filter((f) => f.heightAnchors);

describe('profil zależny od wysokości', () => {
  it('wybrane gatunki mają węzły wysokości', () => {
    expect(entries.map((e) => e.ref).sort()).toEqual([
      'ASH',
      'BIRCH',
      'Black Poplar',
      'Elm',
      'Horsechestnut',
      'Linden',
      'PINE',
      'Plane',
      'Quaking Aspen',
      'Sycamore',
    ]);
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

  it('między węzłami: dla 2 punktów dopasowanie liniowe w h, dla >=3 wybór najlepszej krzywej (lin/log/exp)', () => {
    const lo = { trunkHeightRatio: 0.2, levels: [{ count: 10, downAngle: 40 }] } as unknown as SpeciesProfile;
    const hi = { trunkHeightRatio: 0.3, levels: [{ count: 20, downAngle: 60 }] } as unknown as SpeciesProfile;
    const mid = profileAtHeight([{ h: 6, profile: lo }, { h: 24, profile: hi }], 15);
    expect(mid.trunkHeightRatio).toBeCloseTo(0.25);
    expect(mid.levels[0].count).toBe(15);
    expect(mid.levels[0].downAngle).toBeCloseTo(50);

    expect(fitParameterCurve([{ h: 6, y: 10 }, { h: 12, y: 20 }]).kind).toBe('linear');
    const expFit = fitParameterCurve([
      { h: 6, y: 2 * Math.exp(0.1 * 6) },
      { h: 12, y: 2 * Math.exp(0.1 * 12) },
      { h: 24, y: 2 * Math.exp(0.1 * 24) },
    ]);
    expect(expFit.kind).toBe('exp');
    expect(expFit.eval(30)).toBeCloseTo(2 * Math.exp(0.1 * 30), 3);

    const logFit = fitParameterCurve([
      { h: 6, y: 10 + 5 * Math.log(6) },
      { h: 12, y: 10 + 5 * Math.log(12) },
      { h: 24, y: 10 + 5 * Math.log(24) },
    ]);
    expect(logFit.kind).toBe('log');
    expect(logFit.eval(30)).toBeCloseTo(10 + 5 * Math.log(30), 3);
  });

  it('ekstrapolacja do 24 m i powyżej (> 24 m) kontynuuje krzywą i daje drzewo bez kikutów', () => {
    for (const e of entries) {
      for (const h of [6, 8.5, 12, 17, 24, 30]) {
        const { species, profile } = treeKindParams(e.ref as never, h);
        expect(profile!.trunkHeightRatio).toBeGreaterThan(0);
        const sk = TreeGenerator.buildSkeleton({ species, height: h, seed: 42, profile });
        expect(sk.stems.length).toBeGreaterThan(10);
        expect(sk.stems.filter((s) => s.clipped).length / sk.stems.length).toBeLessThanOrEqual(0.4);
      }
    }
  });

  it('klasy wysokości co pół oktawy również powyżej 24 m', () => {
    expect([2, 6, 8, 10, 12, 15, 17, 20, 24, 34].map(heightClassM)).toEqual([6, 6, 8.5, 8.5, 12, 17, 17, 17, 24, 33.9]);
  });

  it('topola czarna: dwa węzły wysokości, rozwidlenie pnia na 1/3–1/2 wysokości z pnącymi liderami', () => {
    const bp = entries.find((e) => e.ref === 'Black Poplar')!;
    expect(bp.heightAnchors!.map((a) => a.h)).toEqual([9, 24]);
    for (const h of [6, 9, 15, 24]) {
      const { species, profile, form } = treeKindParams('Black Poplar' as never, h);
      expect(profile!.trunkForkHeightRatio!, `h=${h}`).toBeGreaterThanOrEqual(1 / 3);
      expect(profile!.trunkForkHeightRatio!, `h=${h}`).toBeLessThanOrEqual(1 / 2);
      expect(profile!.trunkForkAngle!).toBeLessThanOrEqual(45); // liderzy pną się, nie rozchodzą poziomo
      const sk = TreeGenerator.buildSkeleton({ species, height: h, seed: 42, form, profile });
      expect(sk.stems[0].length).toBeCloseTo(profile!.trunkForkHeightRatio!, 1);
    }
  });

  it('scaleProfileByHeight: dla refHeightM zwraca identyczny klon, dla innych wysokości skaluje allometrycznie', () => {
    const base = SPECIES_PROFILES.OAK;
    const same = scaleProfileByHeight(base, 10);
    expect(same).toEqual(base);
    expect(same).not.toBe(base);

    const young = scaleProfileByHeight(base, 6);
    const old = scaleProfileByHeight(base, 24);
    expect(young.levels[0].count).toBeLessThan(base.levels[0].count);
    expect(old.levels[0].count).toBeGreaterThan(base.levels[0].count);
    expect(young.leafSizeRatio).toBeGreaterThan(base.leafSizeRatio);
    expect(old.leafSizeRatio).toBeLessThan(base.leafSizeRatio);
    expect(young.trunkBaseRadiusRatio).toBeLessThan(old.trunkBaseRadiusRatio);
    expect(young.crownSpreadRatio).toBeLessThan(old.crownSpreadRatio);
    expect(young.trunkHeightRatio).toBeLessThanOrEqual(old.trunkHeightRatio);
    expect(young.leafDensity).toBeUndefined();

    const withDensity = scaleProfileByHeight({ ...base, leafDensity: 60 }, 20, 10);
    expect(withDensity.leafDensity).toBe(Math.round(60 * Math.pow(2, 0.25)));
  });

  it('treeKindParams i describeTreeKindModelSource obsługują węzły JSON oraz ontogenezę Opcji A', () => {
    expect(describeTreeKindModelSource('Horsechestnut')).toEqual({
      fitted: true,
      multiHeightJson: true,
      anchorHeights: [6, 9, 15, 24],
      modeLabel: 'Wielowysokościowy JSON (6/9/15/24 m)',
    });
    expect(describeTreeKindModelSource('PINE').anchorHeights).toEqual([6, 9, 15]);
    expect(describeTreeKindModelSource('Quaking Aspen').anchorHeights).toEqual([6, 9, 15]);

    const spruceSrc = describeTreeKindModelSource('SPRUCE');
    expect(spruceSrc.fitted).toBe(true);
    expect(spruceSrc.multiHeightJson).toBe(false);
    expect(spruceSrc.anchorHeights).toEqual([]);
    const spruce6 = treeKindParams('SPRUCE', 6).profile!;
    const spruce24 = treeKindParams('SPRUCE', 24).profile!;
    expect(spruce6.levels[0].count).toBeLessThan(spruce24.levels[0].count);

    const oakSrc = describeTreeKindModelSource('OAK');
    expect(oakSrc.fitted).toBe(false);
    expect(oakSrc.multiHeightJson).toBe(false);
    expect(treeKindParams('OAK').profile).toEqual(SPECIES_PROFILES.OAK);
    expect(treeKindParams('OAK', 10).profile).toEqual(SPECIES_PROFILES.OAK);
    expect(treeKindParams('OAK', 6).profile!.leafSizeRatio).toBeGreaterThan(SPECIES_PROFILES.OAK.leafSizeRatio);

    expect(treeKindParams('BUSH', 3).profile).toEqual(SPECIES_PROFILES.BUSH);
    expect(treeKindParams('BUSH', 6).profile!.levels[0].count).toBeGreaterThan(SPECIES_PROFILES.BUSH.levels[0].count);
  });
});
