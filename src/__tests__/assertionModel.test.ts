import { describe, it, expect } from 'vitest';
import {
  ASSERTION_HEIGHT,
  ASSERTION_SEED,
  buildAssertionModel,
  summarizeAssertionModel,
  encodeFloat32Base64,
  decodeFloat32Base64,
  QUANT_STEP_M,
  encodeQuantizedVertices,
  decodeQuantizedVertices,
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

  it('quantized vertices roundtrip within step/2', () => {
    const a = buildAssertionModel('OAK', { params });
    const bytes = encodeQuantizedVertices(a.vertices, QUANT_STEP_M);
    const back = decodeQuantizedVertices(bytes, QUANT_STEP_M, a.vertices.length);
    expect(back.length).toBe(a.vertices.length);
    let max = 0;
    a.vertices.forEach((v, i) => (max = Math.max(max, Math.abs(back[i] - v))));
    expect(max).toBeLessThanOrEqual(QUANT_STEP_M / 2 + 1e-9);
    expect(bytes.length).toBeLessThan(a.vertices.length * 4);
  }, 30000);

  it('quantized codec handles negatives and large jumps', () => {
    const v = [-1.2345, 0, 3.3333, 500.5, -750.25, 1e5, -1e5, 0.0002, -0.0002, 12, -12, 0];
    const back = decodeQuantizedVertices(encodeQuantizedVertices(v, QUANT_STEP_M), QUANT_STEP_M, v.length);
    expect(back.length).toBe(v.length);
    v.forEach((x, i) => expect(Math.abs(back[i] - x)).toBeLessThanOrEqual(QUANT_STEP_M / 2 + 1e-9));
  });
});
