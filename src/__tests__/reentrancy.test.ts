import { describe, it, expect } from 'vitest';
import { TreeGenerator, type TreeSpecies } from '../index.js';

describe('TreeGenerator Re-entrancy & Thread-Safety', () => {
  it('produces identical geometry when called concurrently vs sequentially', () => {
    const configs: Array<import('../index.js').TreeGenerationParams> = [
      { species: 'OAK', height: 12.0, seed: 101, withFoliageAccents: true, detail: 'HIGH' },
      { species: 'BIRCH', height: 15.0, seed: 202, withFoliageAccents: true, detail: 'MEDIUM' },
      { species: 'PINE', height: 18.0, seed: 303, withFoliageAccents: false, detail: 'LOW' },
      { species: 'SPRUCE', height: 10.0, seed: 404, withFoliageAccents: true, detail: 'HIGH' },
      { species: 'WILLOW', height: 8.0, seed: 505, withFoliageAccents: true, detail: 'HIGH' },
    ];

    // 1. Generate sequentially
    const sequentialResults = configs.map((cfg) => TreeGenerator.generateRaw(cfg));

    // 2. Interleave generations (simulate interleaved asynchronous ticks or parallel threads)
    // Build skeletons first in reverse order, then mesh them in forward order
    const skeletonsReversed = [...configs].reverse().map((cfg) => TreeGenerator.buildSkeleton(cfg));
    const skeletons = skeletonsReversed.reverse();

    const concurrentResults = skeletons.map((skel, i) =>
      TreeGenerator.meshSkeletonRaw(skel, configs[i])
    );

    // 3. Verify exact byte-level match between sequential and interleaved runs
    for (let i = 0; i < configs.length; i++) {
      const seq = sequentialResults[i];
      const conc = concurrentResults[i];

      expect(conc.bounds.height).toBeCloseTo(seq.bounds.height, 5);
      expect(conc.bounds.crownRadius).toBeCloseTo(seq.bounds.crownRadius, 5);

      const seqPos = seq.mesh.positions;
      const concPos = conc.mesh.positions;
      expect(concPos.length).toBe(seqPos.length);
      for (let j = 0; j < seqPos.length; j++) {
        expect(concPos[j]).toBe(seqPos[j]);
      }

      const seqNorm = seq.mesh.normals;
      const concNorm = conc.mesh.normals;
      expect(concNorm.length).toBe(seqNorm.length);
      for (let j = 0; j < seqNorm.length; j++) {
        expect(concNorm[j]).toBe(seqNorm[j]);
      }

      const seqIdx = seq.mesh.indices;
      const concIdx = conc.mesh.indices;
      expect(concIdx.length).toBe(seqIdx.length);
      for (let j = 0; j < seqIdx.length; j++) {
        expect(concIdx[j]).toBe(seqIdx[j]);
      }
    }
  }, 30000);

  it('does not leak state across exceptions or edge cases', () => {
    // Generate valid baseline
    const base = TreeGenerator.generateRaw({ species: 'ASH', height: 14.0, seed: 777 });

    // Intentionally trigger edge conditions (e.g. height = 0.05, custom broken profile without levels)
    try {
      TreeGenerator.buildSkeleton({
        species: 'ASH',
        height: 0.01,
        seed: 777,
        profile: {
          ...base.mesh as any,
          levels: [],
        },
      });
    } catch {
      // expected or handled
    }

    // Next generation should be completely unaffected
    const after = TreeGenerator.generateRaw({ species: 'ASH', height: 14.0, seed: 777 });
    expect(after.mesh.positions.length).toBe(base.mesh.positions.length);
    for (let i = 0; i < base.mesh.positions.length; i++) {
      expect(after.mesh.positions[i]).toBe(base.mesh.positions[i]);
    }
  });
});
