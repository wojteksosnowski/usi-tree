import { describe, it, expect } from 'vitest';
import { TreeGenerator, treeKindParams, type TreeKind, type TrunkForm } from '../index.js';

const PRIMARY_CASES: Array<{ kind: TreeKind; height: number }> = [
  { kind: 'Plane', height: 6 },
  { kind: 'ASH', height: 24 },
  { kind: 'Horsechestnut', height: 15 },
  { kind: 'Black Poplar', height: 28 },
];

const FORMS: TrunkForm[] = ['FORKED', 'SINGLE', 'MULTI'];

describe('Branch & Trunk Continuity (H1, H2, H3)', () => {
  describe('H1: FORKED trunk split continuity (no step/shelf at split or trunkHeightRatio)', () => {
    for (const { kind, height } of PRIMARY_CASES) {
      it(`${kind} (FORKED, ${height} m, seed 42) has continuous transition from lower trunk to main leader`, () => {
        const params = treeKindParams(kind, height);
        const skel = TreeGenerator.buildSkeleton({
          ...params,
          height,
          seed: 42,
          form: 'FORKED',
        });

        const l0 = skel.stems.filter((s) => s.level === 0);
        expect(l0.length).toBe(3);

        const lowerTrunk = l0[0];
        const mainLeader = l0[1];
        const sideLeader = l0[2];

        const rTrunkTop = lowerTrunk.r[lowerTrunk.r.length - 1];
        const rMainBase = mainLeader.r[0];
        const rSideBase = sideLeader.r[0];

        // Main leader base radius matches lower trunk top radius (unless pruned slightly smaller, never wider)
        expect(rMainBase).toBeLessThanOrEqual(rTrunkTop + 1e-6);
        expect(rMainBase).toBeGreaterThanOrEqual(rTrunkTop * 0.65);

        // Side leader base radius never exceeds lower trunk top radius
        expect(rSideBase).toBeLessThanOrEqual(rTrunkTop + 1e-6);

        // Neither leader has any upward step or sudden drop (>22%) along its entire length
        for (const stem of l0) {
          for (let i = 0; i < stem.r.length - 1; i++) {
            expect(stem.r[i + 1]).toBeLessThanOrEqual(stem.r[i] + 1e-9);
            expect(stem.r[i + 1] / stem.r[i]).toBeGreaterThanOrEqual(0.78);
          }
        }
      });
    }
  });

  describe('H2: Ring-to-ring radius continuity along every stem (s.r[i+1] / s.r[i] >= 0.78)', () => {
    for (const { kind, height } of PRIMARY_CASES) {
      for (const form of FORMS) {
        it(`${kind} (${form}, ${height} m, seed 42) has no sudden radius step along any stem`, () => {
          const params = treeKindParams(kind, height);
          const skel = TreeGenerator.buildSkeleton({
            ...params,
            height,
            seed: 42,
            form,
          });

          expect(skel.stems.length).toBeGreaterThan(0);
          for (let si = 0; si < skel.stems.length; si++) {
            const s = skel.stems[si];
            for (let i = 0; i < s.r.length - 1; i++) {
              const ratio = s.r[i + 1] / s.r[i];
              expect(
                ratio,
                `Stem #${si} (L${s.level}) ring ${i}->${i + 1} dropped abruptly: ratio=${ratio.toFixed(3)}`
              ).toBeGreaterThanOrEqual(0.78 - 1e-6);
              expect(
                s.r[i + 1],
                `Stem #${si} (L${s.level}) ring ${i}->${i + 1} widened instead of tapering`
              ).toBeLessThanOrEqual(s.r[i] + 1e-9);
            }
          }
        }, 30000);
      }
    }
  });

  describe('H3: Parent-child attachment radius hierarchy (s.r[0] <= r_parent_at_attach * 0.9)', () => {
    for (const { kind, height } of PRIMARY_CASES) {
      for (const form of FORMS) {
        it(`${kind} (${form}, ${height} m, seed 42) has every child branch base <= 0.9 * parent radius at attachment`, () => {
          const params = treeKindParams(kind, height);
          const skel = TreeGenerator.buildSkeleton({
            ...params,
            height,
            seed: 42,
            form,
          });

          for (let si = 0; si < skel.stems.length; si++) {
            const child = skel.stems[si];
            if (child.level === 0) continue;

            const ox = child.px[0];
            const oy = child.py[0];
            const oz = child.pz[0];

            let bestDist = Infinity;
            let parentR = Infinity;
            let parentIdx = -1;

            for (let pi = 0; pi < skel.stems.length; pi++) {
              const p = skel.stems[pi];
              if (p.level !== child.level - 1) continue;
              for (let j = 0; j < p.px.length; j++) {
                const d = Math.hypot(p.px[j] - ox, p.py[j] - oy, p.pz[j] - oz);
                if (d < bestDist) {
                  bestDist = d;
                  parentR = p.r[j];
                  parentIdx = pi;
                }
              }
            }

            expect(parentIdx).toBeGreaterThanOrEqual(0);
            expect(bestDist).toBeLessThan(1e-5);
            expect(
              child.r[0],
              `Child #${si} (L${child.level}, r0=${child.r[0]}) exceeds 0.9 * parent #${parentIdx} radius (${parentR}) at attach`
            ).toBeLessThanOrEqual(parentR * 0.9 + 1e-6);
          }
        }, 30000);
      }
    }
  });
});

describe('trunkTaper: zwężanie wykładnicze po długości pnia, niezależne od liczby konarów', () => {
  const radiusAtHalf = (s: { px: number[]; py: number[]; pz: number[]; r: number[] }) => {
    const d = [0];
    for (let i = 1; i < s.px.length; i++) {
      d.push(d[i - 1] + Math.hypot(s.px[i] - s.px[i - 1], s.py[i] - s.py[i - 1], s.pz[i] - s.pz[i - 1]));
    }
    const half = d[d.length - 1] / 2;
    const i = d.findIndex((x) => x >= half);
    const f = (half - d[i - 1]) / (d[i] - d[i - 1] || 1);
    return s.r[i - 1] + (s.r[i] - s.r[i - 1]) * f;
  };

  for (const kind of ['PINE', 'OAK'] as TreeKind[]) {
    it(`${kind}: trunkTaper 0.5 (ubytek całkowity) daje r(½) ≈ r0·0.5^0.5 przy 1 i pełnej liczbie poziomów gałęzi`, () => {
      const params = treeKindParams(kind, 15);
      const results: number[] = [];
      for (const levels of [params.profile!.levels.slice(0, 1), params.profile!.levels]) {
        const skel = TreeGenerator.buildSkeleton({
          ...params,
          profile: { ...params.profile!, trunkTaper: 0.5, levels },
          height: 15,
          seed: 42,
          form: 'SINGLE',
        });
        const trunk = skel.stems.find((s) => s.level === 0)!;
        for (let i = 0; i < trunk.r.length - 1; i++) {
          expect(trunk.r[i + 1]).toBeLessThanOrEqual(trunk.r[i] + 1e-9);
          expect(trunk.r[i + 1] / trunk.r[i]).toBeGreaterThanOrEqual(0.78);
        }
        const ratio = radiusAtHalf(trunk) / trunk.r[0];
        results.push(ratio);
        expect(ratio).toBeGreaterThan(Math.pow(0.5, 0.5) * 0.8);
        expect(ratio).toBeLessThan(Math.pow(0.5, 0.5) * 1.2);
      }
      expect(Math.abs(results[0] - results[1])).toBeLessThan(0.08);
    }, 30000);
  }
});

describe('taperShape: jedna wielkość grubości końca + ortogonalny kształt', () => {
  const build = (mut: (p: any) => any, curveRes?: number) => {
    const params = treeKindParams('BIRCH' as TreeKind, 12);
    let profile: any = { ...params.profile!, levels: params.profile!.levels.map((l: any) => ({ ...l })) };
    if (curveRes) profile.levels.forEach((l: any) => (l.curveRes = curveRes));
    profile = mut(profile);
    return TreeGenerator.buildSkeleton({ ...params, profile, height: 12, seed: 7 });
  };
  const radii = (sk: any) => sk.stems.map((s: any) => s.r);

  it('taper: 0 / trunkTaper: 0 ≡ brak pola', () => {
    const a = radii(build((p) => p));
    const b = radii(build((p) => ({ ...p, trunkTaper: 0, levels: p.levels.map((l: any) => ({ ...l, taper: 0 })) })));
    expect(b).toEqual(a);
  });

  it('trunkTaper x ≡ trunkTipRatio 1−x + taperShape 1 (identyczne promienie)', () => {
    const a = radii(build((p) => ({ ...p, trunkTaper: 0.4 })));
    const b = radii(build((p) => ({ ...p, trunkTipRatio: 0.6, taperShape: 1, levels: p.levels.map((l: any) => ({ ...l, taperShape: 0 })) })));
    expect(b).toEqual(a);
  });

  it('czubek pnia niezależny od taperShape', () => {
    const tip = (s: number) => {
      const t = build((p) => ({ ...p, taperShape: s })).stems.find((x) => x.level === 0)!;
      return t.r[t.r.length - 1] / t.r[0];
    };
    // Per-krokowy limiter 0.82 przy grubych sekcjach może nieznacznie podnieść/obniżyć ostatni pierścień
    expect(Math.abs(tip(1) - tip(0))).toBeLessThan(0.02);
  });

  it('czubek gałęzi niezależny od curveRes przy taper → tipRatio', () => {
    const tipOf = (cr: number) => {
      const sk = build((p) => ({ ...p, levels: p.levels.map((l: any, i: number) => (i === 0 ? { ...l, taperShape: 1 } : l)) }), cr);
      const st = sk.stems.filter((x) => x.level === 1)[0];
      return st.r[st.r.length - 1] / st.r[0];
    };
    expect(Math.abs(tipOf(3) - tipOf(8))).toBeLessThan(0.05);
  });
});
