import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  TreeGenerator as ThreeTreeGenerator,
  toThreeBufferGeometry,
} from '../three/index.js';
import { TreeGenerator as CoreTreeGenerator } from '../index.js';

describe('three adapter (usi-tree/three)', () => {
  it('converts RawTreeMesh to THREE.BufferGeometry with correct attributes and bounds', () => {
    const raw = CoreTreeGenerator.generateRaw({
      species: 'OAK',
      height: 10.0,
      seed: 42,
    });

    const geom = toThreeBufferGeometry(raw.mesh);
    expect(geom).toBeInstanceOf(THREE.BufferGeometry);

    const pos = geom.getAttribute('position');
    const norm = geom.getAttribute('normal');
    const idx = geom.getIndex();

    expect(pos).toBeDefined();
    expect(norm).toBeDefined();
    expect(idx).toBeDefined();
    expect(pos.count).toBe(raw.mesh.positions.length / 3);
    expect(idx!.count).toBe(raw.mesh.indices.length);

    // Precomputed bounds verification
    expect(geom.boundingBox).toBeDefined();
    expect(geom.boundingSphere).toBeDefined();
    expect(geom.boundingBox!.min.y).toBeCloseTo(raw.mesh.boundingBox.min[1], 4);
    expect(geom.boundingBox!.max.y).toBeCloseTo(raw.mesh.boundingBox.max[1], 4);
    expect(geom.boundingSphere!.radius).toBeCloseTo(raw.mesh.boundingSphere.radius, 4);

    // Materials groups
    expect(geom.groups.length).toBe(raw.mesh.groups.length);
  });

  it('generates Three geometry directly using ThreeTreeGenerator.generate', () => {
    const res = ThreeTreeGenerator.generate({
      species: 'BIRCH',
      height: 14.0,
      seed: 99,
      withFoliageAccents: true,
    });

    expect(res.geometry).toBeInstanceOf(THREE.BufferGeometry);
    expect(res.bounds.height).toBeGreaterThan(10);
    expect(res.bounds.crownRadius).toBeGreaterThan(1);
    expect(res.geometry.groups.length).toBeGreaterThanOrEqual(1);
  });

  it('meshes existing skeleton via ThreeTreeGenerator.meshSkeleton', () => {
    const skel = ThreeTreeGenerator.buildSkeleton({
      species: 'PINE',
      height: 16.0,
      seed: 123,
    });

    const res = ThreeTreeGenerator.meshSkeleton(skel, {
      detail: 'MEDIUM',
      withFoliageAccents: false,
    });

    expect(res.geometry).toBeInstanceOf(THREE.BufferGeometry);
    expect(res.geometry.getAttribute('position').count).toBeGreaterThan(20);
  });
});
