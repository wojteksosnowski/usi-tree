import * as THREE from 'three';
import {
  TreeGenerator as CoreTreeGenerator,
  type RawTreeMesh,
  type TreeGenerationParams,
  type TreeSkeleton,
  type Stem,
  type TreeStroke,
} from '../core/TreeGenerator.js';
import type { TreeMeshLod, TreeMeshTriangles } from '../core/types.js';

export * from '../index.js';

export interface TreeGeometryResult {
  geometry: THREE.BufferGeometry;
  bounds: {
    height: number;
    crownRadius: number;
  };
}

export interface TreeLodGeometryResult extends TreeGeometryResult {
  triangles: TreeMeshTriangles;
}

/**
 * Converts a renderer-agnostic RawTreeMesh into a THREE.BufferGeometry with precomputed O(1) bounds.
 */
export function toThreeBufferGeometry(raw: RawTreeMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(raw.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(raw.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(raw.indices, 1));

  for (const g of raw.groups) {
    geometry.addGroup(g.start, g.count, g.materialIndex);
  }

  const [minX, minY, minZ] = raw.boundingBox.min;
  const [maxX, maxY, maxZ] = raw.boundingBox.max;
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(minX, minY, minZ),
    new THREE.Vector3(maxX, maxY, maxZ)
  );

  const [cX, cY, cZ] = raw.boundingSphere.center;
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(cX, cY, cZ),
    raw.boundingSphere.radius
  );

  return geometry;
}

/**
 * Three.js-enabled TreeGenerator (drop-in replacement for USI Light 3D views).
 * Provides .generate() and .meshSkeleton() returning THREE.BufferGeometry,
 * while preserving all core skeleton & raw mesh methods.
 */
export class TreeGenerator extends CoreTreeGenerator {
  static generate(params: TreeGenerationParams): TreeGeometryResult {
    const rawRes = CoreTreeGenerator.generateRaw(params);
    return {
      geometry: toThreeBufferGeometry(rawRes.mesh),
      bounds: rawRes.bounds,
    };
  }

  static meshSkeleton(
    skeleton: TreeSkeleton,
    params: Pick<TreeGenerationParams, 'radialSegments' | 'withFoliageAccents' | 'detail' | 'stroke' | 'lod'>
  ): TreeGeometryResult {
    const rawRes = CoreTreeGenerator.meshSkeletonRaw(skeleton, params);
    return {
      geometry: toThreeBufferGeometry(rawRes.mesh),
      bounds: rawRes.bounds,
    };
  }

  /** Jeden szkielet w kilku poziomach LOD (np. `TREE_LOD_PRESETS`): geometrie w kolejności `lods` z liczbą trójkątów */
  static meshSkeletonLods(
    skeleton: TreeSkeleton,
    lods: readonly TreeMeshLod[],
    params: Pick<TreeGenerationParams, 'radialSegments' | 'withFoliageAccents' | 'stroke'> = {}
  ): TreeLodGeometryResult[] {
    return CoreTreeGenerator.meshSkeletonLodsRaw(skeleton, lods, params).map((res) => ({
      geometry: toThreeBufferGeometry(res.mesh),
      bounds: res.bounds,
      triangles: res.triangles,
    }));
  }

  static override buildSkeleton(params: TreeGenerationParams): TreeSkeleton {
    return CoreTreeGenerator.buildSkeleton(params);
  }

  static override strokeStem(stem: Stem, stroke: TreeStroke, nominalHeight: number, trunkBaseR = Infinity): Stem {
    return CoreTreeGenerator.strokeStem(stem, stroke, nominalHeight, trunkBaseR);
  }
}
