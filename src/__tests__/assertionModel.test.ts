import { describe, it, expect } from 'vitest';
import {
  ASSERTION_HEIGHT,
  ASSERTION_SEED,
  buildAssertionModel,
  summarizeAssertionModel,
  encodeFloat32Base64,
  decodeFloat32Base64,
} from '../core/assertionModel';
import { SPECIES_PROFILES } from '../core/speciesProfiles';
import { scaleProfileByHeight } from '../core/heightProfile';

// Profile bazowe (nie fittedProfiles.json) — test silnika nie zależy od żywych profili
const params = { species: 'OAK' as const, form: 'SINGLE' as const, profile: scaleProfileByHeight(SPECIES_PROFILES.OAK, 12, 10) };

describe('assertionModel', () => {
  it('is deterministic and well-formed', () => {
    const a = buildAssertionModel('OAK', { params, generatedAt: 'a' });
    const b = buildAssertionModel('OAK', { params, generatedAt: 'b' });
    expect(a.hash).toBe(b.hash);
    expect(a.height).toBe(ASSERTION_HEIGHT);
    expect(a.seed).toBe(ASSERTION_SEED);
    expect(a.vertices.length).toBe(3 * a.counts.vertices);
    expect(a.vertices.every((v) => Number.isFinite(v))).toBe(true);
    expect(a.counts.barkTriangles).toBeGreaterThan(0);
    expect(a.counts.stemsPerLevel[0]).toBeGreaterThan(0);
    const s = summarizeAssertionModel(a) as any;
    expect(s.vertices).toBeUndefined();
    expect(s.hash).toBe(a.hash);
  }, 30000);

  it('float32 base64 roundtrip', () => {
    const v = [0, 1.5, -2.25, 1e-3];
    const back = decodeFloat32Base64(encodeFloat32Base64(v));
    back.forEach((x, i) => expect(x).toBeCloseTo(v[i], 6));
  });
});
