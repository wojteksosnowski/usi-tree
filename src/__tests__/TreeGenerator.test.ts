import { describe, it, expect } from 'vitest';
import { TreeGenerator, TreeSpecies, SPECIES_PROFILES, TIDY_STRUCTURE, type TreeSkeleton, type BranchLevelParams } from '../three/index.js';

describe('TreeGenerator', () => {
  const ALL_SPECIES: TreeSpecies[] = ['OAK', 'BIRCH', 'PINE', 'SPRUCE', 'POPLAR', 'WILLOW', 'ASH', 'ASPEN', 'BUSH'];

  it('generates valid geometry for all species', () => {
    for (const species of ALL_SPECIES) {
      const result = TreeGenerator.generate({
        species,
        height: 12.0,
        seed: 42,
      });

      expect(result).toBeDefined();
      expect(result.geometry).toBeDefined();

      const posAttr = result.geometry.getAttribute('position');
      const normAttr = result.geometry.getAttribute('normal');
      const indexAttr = result.geometry.getIndex();

      expect(posAttr).toBeDefined();
      expect(normAttr).toBeDefined();
      expect(indexAttr).toBeDefined();

      expect(posAttr.count).toBeGreaterThan(20);
      expect(indexAttr!.count).toBeGreaterThan(20);

      // Verify no NaNs
      for (let i = 0; i < posAttr.array.length; i++) {
        expect(Number.isNaN(posAttr.array[i])).toBe(false);
      }
      for (let i = 0; i < normAttr.array.length; i++) {
        expect(Number.isNaN(normAttr.array[i])).toBe(false);
      }

      // Verify bounds
      expect(result.bounds.height).toBeGreaterThan(5.0);
      expect(result.bounds.crownRadius).toBeGreaterThan(0.5);
    }
  }, 30000);

  it('is 100% deterministic given the same seed', () => {
    const res1 = TreeGenerator.generate({ species: 'OAK', height: 15.0, seed: 12345 });
    const res2 = TreeGenerator.generate({ species: 'OAK', height: 15.0, seed: 12345 });

    const pos1 = res1.geometry.getAttribute('position').array as Float32Array;
    const pos2 = res2.geometry.getAttribute('position').array as Float32Array;
    expect(pos1.length).toBe(pos2.length);

    for (let i = 0; i < pos1.length; i++) {
      expect(pos1[i]).toBe(pos2[i]);
    }

    const idx1 = res1.geometry.getIndex()!.array;
    const idx2 = res2.geometry.getIndex()!.array;
    expect(idx1.length).toBe(idx2.length);
    for (let i = 0; i < idx1.length; i++) {
      expect(idx1[i]).toBe(idx2[i]);
    }

    expect(res1.bounds.height).toBe(res2.bounds.height);
    expect(res1.bounds.crownRadius).toBe(res2.bounds.crownRadius);
  });

  it('produces different variants for different seeds', () => {
    const res1 = TreeGenerator.generate({ species: 'OAK', height: 15.0, seed: 111 });
    const res2 = TreeGenerator.generate({ species: 'OAK', height: 15.0, seed: 222 });

    const pos1 = res1.geometry.getAttribute('position').array as Float32Array;
    const pos2 = res2.geometry.getAttribute('position').array as Float32Array;

    let hasDifference = false;
    for (let i = 0; i < Math.min(pos1.length, pos2.length); i++) {
      if (Math.abs(pos1[i] - pos2[i]) > 1e-4) {
        hasDifference = true;
        break;
      }
    }
    expect(hasDifference).toBe(true);
  });

  it('respects radialSegments parameter (e.g. 3 for triangle tubes, 5 for pentagonal)', () => {
    const res3 = TreeGenerator.generate({ species: 'PINE', height: 10.0, seed: 1, radialSegments: 3 });
    const res4 = TreeGenerator.generate({ species: 'PINE', height: 10.0, seed: 1, radialSegments: 4 });
    const res5 = TreeGenerator.generate({ species: 'PINE', height: 10.0, seed: 1, radialSegments: 5 });

    expect(res3.geometry.getAttribute('position').count).toBeLessThan(
      res4.geometry.getAttribute('position').count
    );
    expect(res4.geometry.getAttribute('position').count).toBeLessThan(
      res5.geometry.getAttribute('position').count
    );
  });

  it('generates additional foliage accents when withFoliageAccents is true', () => {
    const resBare = TreeGenerator.generate({ species: 'BIRCH', height: 12.0, seed: 99, withFoliageAccents: false });
    const resFoliage = TreeGenerator.generate({ species: 'BIRCH', height: 12.0, seed: 99, withFoliageAccents: true });

    expect(resFoliage.geometry.getAttribute('position').count).toBeGreaterThan(
      resBare.geometry.getAttribute('position').count
    );
  });

  it('handles extreme heights without errors', () => {
    const small = TreeGenerator.generate({ species: 'WILLOW', height: 0.5 });
    expect(small.bounds.height).toBeGreaterThan(0.3);

    const huge = TreeGenerator.generate({ species: 'SPRUCE', height: 80.0 });
    expect(huge.bounds.height).toBeGreaterThan(50.0);
  });

  it('profiles define all required parameters', () => {
    for (const species of ALL_SPECIES) {
      const p = SPECIES_PROFILES[species];
      expect(p.trunkHeightRatio).toBeGreaterThan(0);
      expect(p.trunkBaseRadiusRatio).toBeGreaterThan(0);
      expect(p.crownSpreadRatio).toBeGreaterThan(0);
    }
  });

  it('scales the tree to the requested height for every species', () => {
    for (const species of ALL_SPECIES) {
      const res = TreeGenerator.generate({ species, height: 9.0, seed: 3 });
      expect(Math.abs(res.bounds.height - 9.0)).toBeLessThan(0.5);
    }
  });

  it('LOD meshes one skeleton with decreasing triangle counts and the same height', () => {
    const skel = TreeGenerator.buildSkeleton({ species: 'OAK', height: 12.0, seed: 42 });
    const tris = (['HIGH', 'MEDIUM', 'LOW'] as const).map((detail) => {
      const res = TreeGenerator.meshSkeleton(skel, { detail });
      expect(Math.abs(res.bounds.height - 12.0)).toBeLessThan(0.6);
      return res.geometry.getIndex()!.count / 3;
    });
    expect(tris[1]).toBeLessThan(tris[0]);
    expect(tris[2]).toBeLessThan(tris[1]);

    // generate() = buildSkeleton() + meshSkeleton() (HIGH)
    const direct = TreeGenerator.generate({ species: 'OAK', height: 12.0, seed: 42 });
    expect(direct.geometry.getIndex()!.count / 3).toBe(tris[0]);
  });

  it('scaffoldLimbs: trunk ends at crown base and splits into main limbs', () => {
    const profile = { ...SPECIES_PROFILES.OAK, scaffoldLimbs: 4 };
    const sk = TreeGenerator.buildSkeleton({ species: 'OAK', height: 10, seed: 7, profile });
    const trunks = sk.stems.filter((s) => s.level === 0);
    const base = trunks.find((s) => s.py[0] === 0)!;
    expect(base.py[base.py.length - 1]).toBeCloseTo(profile.trunkHeightRatio, 6);
    const limbs = trunks.filter((s) => s !== base);
    expect(limbs.length).toBeGreaterThanOrEqual(4);
    expect(limbs.length).toBeLessThanOrEqual(5);
    for (const l of limbs) expect(l.py[0]).toBeCloseTo(profile.trunkHeightRatio, 6);
    // Bez pola profilu — jeden przewodnik od gruntu (dotychczasowy pokrój)
    const plain = TreeGenerator.buildSkeleton({ species: 'OAK', height: 10, seed: 7 });
    expect(plain.stems.filter((s) => s.level === 0)).toHaveLength(1);
  });
  describe('TIDY_STRUCTURE (porządek korony)', () => {
    const BRANCHY: TreeSpecies[] = ['OAK', 'BIRCH', 'ASH', 'PINE', 'POPLAR'];
    /** Profil bez porządku struktury (dotychczasowe zachowanie generatora) */
    const legacy = (species: TreeSpecies) => ({ ...SPECIES_PROFILES[species], prune: undefined, outwardBias: undefined, phyllotaxis: undefined, twigGnarl: undefined, kinkScale: undefined });
    const branches = (sk: TreeSkeleton) => sk.stems.filter((s) => s.level > 0);
    /** Gałęzie rzędu ≥ 2 skierowane do osi drzewa (rzut poziomy) */
    const inwardShare = (sk: TreeSkeleton) => {
      let n = 0, inward = 0;
      for (const s of sk.stems) {
        if (s.level < 2) continue;
        const rh = Math.hypot(s.px[0], s.pz[0]), dx = s.px[1] - s.px[0], dz = s.pz[1] - s.pz[0], hl = Math.hypot(dx, dz);
        if (rh < 1e-3 || hl < 1e-6) continue;
        n++;
        if ((dx * s.px[0] + dz * s.pz[0]) / (rh * hl) < -0.3) inward++;
      }
      return n ? inward / n : 0;
    };

    it('profile bazowe mają uporządkowaną strukturę', () => {
      for (const species of BRANCHY) expect(SPECIES_PROFILES[species]).toMatchObject(TIDY_STRUCTURE);
    });

    it('przycinanie zamiast cięcia: prawie żadna gałąź nie urywa się na obwiedni', () => {
      for (const species of BRANCHY) {
        for (const seed of [1, 2, 3]) {
          const plain = TreeGenerator.buildSkeleton({ species, height: 10, seed, profile: legacy(species) });
          const tidy = TreeGenerator.buildSkeleton({ species, height: 10, seed });
          const share = (sk: TreeSkeleton) => branches(sk).filter((s) => s.clipped).length / branches(sk).length;
          expect(share(tidy)).toBeLessThan(0.08);
          expect(share(tidy)).toBeLessThanOrEqual(share(plain));
        }
      }
    });

    it('gałęzie rzędu ≥ 2 rosną na zewnątrz korony', () => {
      for (const species of BRANCHY) {
        const tidy = TreeGenerator.buildSkeleton({ species, height: 10, seed: 5 });
        expect(inwardShare(tidy)).toBeLessThan(0.06);
      }
    });

    it('jest deterministyczne, trzyma wysokość, a bez tych pól daje dotychczasowy szkielet', () => {
      const a = TreeGenerator.generate({ species: 'OAK', height: 12, seed: 9 });
      const b = TreeGenerator.generate({ species: 'OAK', height: 12, seed: 9 });
      expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(Array.from(b.geometry.getAttribute('position').array));
      expect(Math.abs(a.bounds.height - 12)).toBeLessThan(0.6);
      const plain = TreeGenerator.buildSkeleton({ species: 'OAK', height: 12, seed: 9, profile: legacy('OAK') });
      const tidy = TreeGenerator.buildSkeleton({ species: 'OAK', height: 12, seed: 9 });
      expect(tidy.stems.length).not.toBe(plain.stems.length);
    });
  });
  describe('rozszerzenia Sapling (curveBack, baseSize, rotate)', () => {
    const tipElevationChange = (sk: TreeSkeleton, level: number): number => {
      let sum = 0, n = 0;
      for (const s of sk.stems) {
        if (s.level !== level || s.px.length < 4) continue;
        const k = s.px.length - 1;
        const el = (i: number) => Math.atan2(s.py[i + 1] - s.py[i], Math.hypot(s.px[i + 1] - s.px[i], s.pz[i + 1] - s.pz[i]));
        sum += el(k - 1) - el(0); n++;
      }
      return n ? sum / n : 0;
    };
    const birchWith = (level: number, patch: Partial<BranchLevelParams>) => {
      const p = structuredClone(SPECIES_PROFILES.BIRCH);
      Object.assign(p.levels[level], patch);
      return p;
    };

    it('bez nowych pól szkielet jest identyczny', () => {
      const a = TreeGenerator.buildSkeleton({ species: 'BIRCH', height: 12, seed: 5 });
      const b = TreeGenerator.buildSkeleton({ species: 'BIRCH', height: 12, seed: 5, profile: structuredClone(SPECIES_PROFILES.BIRCH) });
      expect(b.stems.map((s) => s.px.join())).toEqual(a.stems.map((s) => s.px.join()));
    });

    it('curveBack ujemne opuszcza końcówki konarów względem samego curve', () => {
      const up = TreeGenerator.buildSkeleton({ species: 'BIRCH', height: 12, seed: 5, profile: birchWith(0, { curve: 30, curveBack: 30, curveV: 0 }) });
      const sCurve = TreeGenerator.buildSkeleton({ species: 'BIRCH', height: 12, seed: 5, profile: birchWith(0, { curve: 30, curveBack: -60, curveV: 0 }) });
      expect(tipElevationChange(sCurve, 1)).toBeLessThan(tipElevationChange(up, 1) - 0.2);
    });

    it('baseSize przesuwa odgałęzienia ku końcowi rodzica', () => {
      const meanStart = (baseSize: number) => {
        const sk = TreeGenerator.buildSkeleton({ species: 'BIRCH', height: 12, seed: 5, profile: birchWith(1, { baseSize }) });
        const l2 = sk.stems.filter((s) => s.level === 2);
        return l2.reduce((acc, s) => acc + s.py[0], 0) / Math.max(1, l2.length);
      };
      expect(meanStart(0.6)).toBeGreaterThan(meanStart(0.0));
    });

    it('rotate zastępuje złoty kąt i jest deterministyczny', () => {
      const p = birchWith(0, { rotate: 90, rotateV: 0 });
      const a = TreeGenerator.buildSkeleton({ species: 'BIRCH', height: 12, seed: 5, profile: p });
      const b = TreeGenerator.buildSkeleton({ species: 'BIRCH', height: 12, seed: 5, profile: structuredClone(p) });
      const base = TreeGenerator.buildSkeleton({ species: 'BIRCH', height: 12, seed: 5 });
      expect(a.stems.map((s) => s.pz.join())).toEqual(b.stems.map((s) => s.pz.join()));
      expect(a.stems.map((s) => s.pz.join())).not.toEqual(base.stems.map((s) => s.pz.join()));
    });
  });
});
