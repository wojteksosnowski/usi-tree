import { describe, it, expect } from 'vitest';
import {
  silhouetteMetrics,
  metricsDistance,
  structureMetrics,
} from '../fitter/index.js';
import { TreeGenerator } from '../index.js';

describe('fitter module', () => {
  describe('silhouetteMetrics & metricsDistance', () => {
    it('returns null on empty mask', () => {
      const W = 32, H = 32;
      const mask = new Uint8Array(W * H);
      expect(silhouetteMetrics(mask, W, H)).toBeNull();
    });

    it('computes valid metrics for synthetic tree silhouette mask', () => {
      const W = 64, H = 64;
      const mask = new Uint8Array(W * H);
      // Draw a vertical trunk: x in [30, 33], y in [40, 60]
      for (let y = 40; y <= 60; y++) {
        for (let x = 30; x <= 33; x++) {
          mask[y * W + x] = 1;
        }
      }
      // Draw a circular crown: center (32, 28), radius 16
      for (let y = 12; y <= 44; y++) {
        for (let x = 16; x <= 48; x++) {
          if (Math.hypot(x - 32, y - 28) <= 16) {
            mask[y * W + x] = 1;
          }
        }
      }

      const metrics = silhouetteMetrics(mask, W, H);
      expect(metrics).not.toBeNull();
      if (!metrics) return;

      expect(metrics.aspect).toBeGreaterThan(0.3);
      expect(metrics.aspect).toBeLessThan(1.5);
      expect(metrics.crownBase).toBeGreaterThan(0.1);
      expect(metrics.crownBase).toBeLessThan(0.9);
      expect(metrics.trunk).toBeGreaterThan(0);
      expect(metrics.profile.length).toBe(10);
      expect(metrics.widestAt).toBeGreaterThan(0);
      expect(metrics.dirs.length).toBe(4);

      // Distance to self should be 0
      expect(metricsDistance(metrics, metrics)).toBeCloseTo(0, 5);
    });

    it('computes non-zero distance between distinct silhouettes', () => {
      const W = 32, H = 32;
      const maskA = new Uint8Array(W * H).fill(0);
      const maskB = new Uint8Array(W * H).fill(0);

      // Mask A: vertical bar
      for (let y = 4; y < 28; y++) maskA[y * W + 16] = 1;

      // Mask B: filled box
      for (let y = 4; y < 28; y++) {
        for (let x = 8; x < 24; x++) maskB[y * W + x] = 1;
      }

      const mA = silhouetteMetrics(maskA, W, H);
      const mB = silhouetteMetrics(maskB, W, H);
      expect(mA).not.toBeNull();
      expect(mB).not.toBeNull();
      if (!mA || !mB) return;

      const dist = metricsDistance(mA, mB);
      expect(dist).toBeGreaterThan(0.5);
    });
  });

  describe('structureMetrics', () => {
    it('computes valid structure metrics on realistic TreeSkeleton', () => {
      const sk = TreeGenerator.buildSkeleton({
        species: 'OAK',
        height: 12.0,
        seed: 42,
      });

      const sm = structureMetrics(sk);
      expect(sm).toBeDefined();
      expect(sm.clipped).toBeGreaterThanOrEqual(0);
      expect(sm.clipped).toBeLessThanOrEqual(1);
      expect(sm.stubs).toBeGreaterThanOrEqual(0);
      expect(sm.inward).toBeGreaterThanOrEqual(0);
      expect(sm.turn).toBeGreaterThanOrEqual(0);
      expect(sm.grenade).toBeGreaterThanOrEqual(0);
    });
  });
});
