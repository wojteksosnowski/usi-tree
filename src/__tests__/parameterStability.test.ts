import { describe, expect, it } from 'vitest';
import { TreeGenerator, SPECIES_PROFILES } from '../core/TreeGenerator.js';

describe('Parameter Stability & Tree-Path PRNG Isolation', () => {
  it('changing pliancy smoothly bends branches downward without reshuffling trunk or L1 topology', () => {
    const baseProfile = SPECIES_PROFILES.BIRCH;
    const skel0 = TreeGenerator.buildSkeleton({
      species: 'BIRCH',
      height: 12,
      seed: 42,
      profile: { ...baseProfile, pliancy: 0 },
    });
    const skel15 = TreeGenerator.buildSkeleton({
      species: 'BIRCH',
      height: 12,
      seed: 42,
      profile: { ...baseProfile, pliancy: 15 },
    });
    const skel30 = TreeGenerator.buildSkeleton({
      species: 'BIRCH',
      height: 12,
      seed: 42,
      profile: { ...baseProfile, pliancy: 30 },
    });

    // Trunk (level 0) should be 100% identical across pliancy values
    const trunk0 = skel0.stems.find((s) => s.level === 0)!;
    const trunk15 = skel15.stems.find((s) => s.level === 0)!;
    const trunk30 = skel30.stems.find((s) => s.level === 0)!;
    expect(trunk15.px).toEqual(trunk0.px);
    expect(trunk15.py).toEqual(trunk0.py);
    expect(trunk15.pz).toEqual(trunk0.pz);
    expect(trunk30.px).toEqual(trunk0.px);

    // Level 1 branches should have identical count, base radii, and attachment origins on the trunk
    const l1_0 = skel0.stems.filter((s) => s.level === 1);
    const l1_15 = skel15.stems.filter((s) => s.level === 1);
    const l1_30 = skel30.stems.filter((s) => s.level === 1);
    expect(l1_15.length).toBe(l1_0.length);
    expect(l1_30.length).toBe(l1_0.length);

    let sumTipY0 = 0;
    let sumTipY15 = 0;
    let sumTipY30 = 0;

    for (let i = 0; i < l1_0.length; i++) {
      const a = l1_0[i];
      const b = l1_15[i];
      const c = l1_30[i];

      // Same attachment point and initial radius (decoupled from prune sag)
      expect(b.px[0]).toBeCloseTo(a.px[0], 6);
      expect(b.py[0]).toBeCloseTo(a.py[0], 6);
      expect(b.pz[0]).toBeCloseTo(a.pz[0], 6);
      expect(b.r[0]).toBeCloseTo(a.r[0], 6);
      expect(c.px[0]).toBeCloseTo(a.px[0], 6);
      expect(c.py[0]).toBeCloseTo(a.py[0], 6);
      expect(c.pz[0]).toBeCloseTo(a.pz[0], 6);
      expect(c.r[0]).toBeCloseTo(a.r[0], 6);

      // Same horizontal azimuth direction (no random lateral jumping, correlation > 0.98)
      const azA = Math.atan2(a.pz[1] - a.pz[0], a.px[1] - a.px[0]);
      const azB = Math.atan2(b.pz[1] - b.pz[0], b.px[1] - b.px[0]);
      const azC = Math.atan2(c.pz[1] - c.pz[0], c.px[1] - c.px[0]);
      expect(Math.cos(azA - azB)).toBeGreaterThan(0.99);
      expect(Math.cos(azA - azC)).toBeGreaterThan(0.98);

      sumTipY0 += a.py[a.py.length - 1];
      sumTipY15 += b.py[b.py.length - 1];
      sumTipY30 += c.py[c.py.length - 1];
    }

    // Higher pliancy must monotonically increase downward sag (lower tip Y)
    expect(sumTipY15).toBeLessThan(sumTipY0);
    expect(sumTipY30).toBeLessThan(sumTipY15);
  });

  it('isolates parent and sibling branches when deep level parameters or envelopeScale change', () => {
    const baseProfile = SPECIES_PROFILES.OAK;
    const skelA = TreeGenerator.buildSkeleton({
      species: 'OAK',
      height: 15,
      seed: 101,
      profile: baseProfile,
    });
    // Change L3 twig wobble/tropism; L0 and L1 must remain completely untouched
    const modifiedLevels = baseProfile.levels.map((l, idx) =>
      idx === 2 ? { ...l, curveV: l.curveV * 2, tropism: -1.2 } : l
    );
    const skelB = TreeGenerator.buildSkeleton({
      species: 'OAK',
      height: 15,
      seed: 101,
      profile: { ...baseProfile, levels: modifiedLevels },
    });

    const l1A = skelA.stems.filter((s) => s.level <= 1);
    const l1B = skelB.stems.filter((s) => s.level <= 1);
    expect(l1B.length).toBe(l1A.length);
    for (let i = 0; i < l1A.length; i++) {
      expect(l1B[i].px).toEqual(l1A[i].px);
      expect(l1B[i].py).toEqual(l1A[i].py);
      expect(l1B[i].pz).toEqual(l1A[i].pz);
    }
  });
});
