import { describe, it, expect } from 'vitest';
import {
  SPECIES_PROFILES,
  FITTED_PROFILES,
  toUsiTreeSpec,
  validateUsiTreeSpec,
  resolveSpecProfileAtHeight,
  TreeGenerator,
  type TreeKind,
} from '../index.js';

describe('USI Tree Standard v1.0 (UsiTreeSpecV1)', () => {
  it('exports valid UsiTreeSpecV1 documents for all base and fitted species', () => {
    const allKinds: TreeKind[] = [
      ...(Object.keys(SPECIES_PROFILES) as TreeKind[]),
      ...FITTED_PROFILES.map((f) => f.ref as TreeKind),
    ];
    for (const kind of allKinds) {
      const spec = toUsiTreeSpec(kind);
      const validation = validateUsiTreeSpec(spec);
      expect(validation.valid, `${kind}: ${JSON.stringify(validation.issues)}`).toBe(true);
      expect(spec.version).toBe('1.0');
      expect(spec.taxonomy.genus.length).toBeGreaterThan(1);
    }
  });

  it('interpolates ontogenetic profiles across height anchors via resolveSpecProfileAtHeight', () => {
    const ashSpec = toUsiTreeSpec('ASH');
    const p6 = resolveSpecProfileAtHeight(ashSpec, 6);
    const p15 = resolveSpecProfileAtHeight(ashSpec, 15);
    expect(p6.trunkBaseRadiusRatio).toBeGreaterThan(0);
    expect(p15.trunkBaseRadiusRatio).toBeGreaterThan(0);
  });

  it('generates raw Float32Array meshes in core without Three.js', () => {
    const res = TreeGenerator.generateRaw({
      species: 'OAK',
      height: 12,
      seed: 42,
      withFoliageAccents: true,
    });
    expect(res.mesh.positions).toBeInstanceOf(Float32Array);
    expect(res.mesh.normals).toBeInstanceOf(Float32Array);
    expect(res.mesh.positions.length).toBeGreaterThan(30);
    expect(res.bounds.height).toBeCloseTo(12, 0);
  });
});
