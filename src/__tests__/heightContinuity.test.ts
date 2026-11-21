import { describe, expect, it } from 'vitest';
import fitted from '../core/fittedProfiles.json';
import { profileAtHeight, type HeightAnchor } from '../core/heightProfile';
import { paramRange } from '../core/paramSpec';

type Flat = Record<string, number>;
const flatten = (o: unknown, pre = '', out: Flat = {}): Flat => {
  if (Array.isArray(o)) o.forEach((v, i) => flatten(v, `${pre}${i}.`, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) flatten(v, `${pre}${k}.`, out);
  else if (typeof o === 'number') out[pre.slice(0, -1)] = o;
  return out;
};
const leafKey = (path: string) => path.split('.').filter((s) => !/^\d+$/.test(s)).pop()!;

const entries = (fitted as unknown as { ref: string; heightAnchors?: HeightAnchor[] }[]).filter(
  (e) => (e.heightAnchors?.length ?? 0) >= 2
);

describe('profil wysokości: ciągła krzywa bez skoków w węzłach i z ograniczoną ekstrapolacją', () => {
  for (const e of entries) {
    it(`${e.ref}: parametry niecałkowite zmieniają się płynnie w 3–40 m i mieszczą w zakresie`, () => {
      const A = e.heightAnchors!;
      const samples: Flat[] = [];
      for (let h = 3; h <= 40 + 1e-9; h += 0.05) samples.push(flatten(profileAtHeight(A, h)));
      const keys = Object.keys(samples[0]);
      for (const k of keys) {
        const { min, max, integer } = paramRange(leafKey(k));
        const vals = samples.map((s) => s[k]).filter((v) => typeof v === 'number');
        for (const v of vals) {
          expect(v, k).toBeGreaterThanOrEqual(min);
          expect(v, k).toBeLessThanOrEqual(max);
        }
        if (integer) continue;
        const span = Math.max(1e-6, Math.max(...vals) - Math.min(...vals));
        for (let i = 1; i < vals.length; i++) {
          expect(Math.abs(vals[i] - vals[i - 1]) / span, `${k} @ ${(3 + i * 0.05).toFixed(2)} m`).toBeLessThan(0.03);
        }
      }
    }, 30000);
  }
});
