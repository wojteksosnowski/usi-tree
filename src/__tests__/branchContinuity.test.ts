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
        });
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
        });
      }
    }
  });
});
