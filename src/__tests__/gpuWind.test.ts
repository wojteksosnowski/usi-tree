import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TreeGenerator, TREE_LOD_PRESETS } from '../index.js';
import {
  TreeGenerator as ThreeTreeGenerator,
  applyTreeWind,
  createTreeWindUniforms,
} from '../three/index.js';

describe('wiatr GPU (windAttributes + applyTreeWind)', () => {
  it('atrybut windData nie zmienia siatki i ma sensowne zakresy', () => {
    const base = { species: 'OAK' as const, height: 12, seed: 7, withFoliageAccents: true };
    const plain = TreeGenerator.generateRaw(base).mesh;
    const tagged = TreeGenerator.generateRaw({ ...base, windAttributes: true }).mesh;

    expect(plain.windData).toBeUndefined();
    expect(Array.from(tagged.positions)).toEqual(Array.from(plain.positions));
    expect(Array.from(tagged.indices)).toEqual(Array.from(plain.indices));
    const w = tagged.windData!;
    expect(w.length).toBe(tagged.positions.length);

    const barkTris = tagged.groups.find((g) => g.materialIndex === 0)!.count;
    let maxBarkVert = 0;
    for (let i = 0; i < barkTris; i++) maxBarkVert = Math.max(maxBarkVert, tagged.indices[i]);
    let trunkZero = 0, barkFlutter = 0, leafFlutter = 0;
    for (let v = 0; v < w.length / 3; v++) {
      const [bend, phase, flutter] = [w[v * 3], w[v * 3 + 1], w[v * 3 + 2]];
      expect(bend).toBeGreaterThanOrEqual(0);
      expect(bend).toBeLessThan(5);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(Math.PI * 2);
      if (v <= maxBarkVert) {
        if (bend === 0) trunkZero++;
        barkFlutter += flutter;
      } else leafFlutter += flutter;
    }
    expect(trunkZero).toBeGreaterThan(0); // pień: ugięcie liczy shader z wysokości
    expect(barkFlutter).toBe(0);
    expect(leafFlutter).toBe(w.length / 3 - (maxBarkVert + 1));
  }, 30000);

  it('poziomy LOD też niosą windData', () => {
    const sk = TreeGenerator.buildSkeleton({ species: 'BIRCH', height: 10, seed: 3 });
    for (const r of TreeGenerator.meshSkeletonLodsRaw(sk, Object.values(TREE_LOD_PRESETS), {
      withFoliageAccents: true,
      windAttributes: true,
    })) {
      expect(r.mesh.windData!.length).toBe(r.mesh.positions.length);
    }
  }, 30000);

  it('adapter Three: atrybut w geometrii i łata shadera', () => {
    const { geometry } = ThreeTreeGenerator.generate({ species: 'PINE', height: 8, seed: 1, windAttributes: true });
    expect(geometry.getAttribute('windData').itemSize).toBe(3);

    const mat = new THREE.MeshStandardMaterial();
    const uniforms = applyTreeWind(mat, createTreeWindUniforms({ strength: 1, height: 8 }));
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: '',
    };
    mat.onBeforeCompile(shader as never, {} as never);
    expect(shader.uniforms.uWindTime).toBe(uniforms.uWindTime);
    expect(shader.vertexShader).toContain('attribute vec3 windData');
    expect(shader.vertexShader).toContain('mainBend');
    expect(mat.customProgramCacheKey()).toContain('usi-tree-wind');
  });
});
