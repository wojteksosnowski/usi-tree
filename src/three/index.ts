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
  if (raw.windData) geometry.setAttribute('windData', new THREE.BufferAttribute(raw.windData, 3));

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
    params: Pick<TreeGenerationParams, 'radialSegments' | 'withFoliageAccents' | 'detail' | 'stroke' | 'lod' | 'windAttributes'>
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
    params: Pick<TreeGenerationParams, 'radialSegments' | 'withFoliageAccents' | 'stroke' | 'windAttributes'> = {}
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

/** Uniformy wiatru GPU — jeden obiekt można współdzielić między wieloma materiałami (cały las jednym `time`) */
export interface TreeWindUniforms {
  uWindTime: { value: number };
  /** Kierunek wiatru w świecie (XZ, nie musi być znormalizowany) */
  uWindDir: { value: THREE.Vector2 };
  /** Siła 0..~2 (jak `wind.strength` w ścieżce CPU) */
  uWindStrength: { value: number };
  /** Wysokość odniesienia drzewa w jednostkach siatki (zginanie pnia ~ (y / H)²) */
  uWindHeight: { value: number };
}

export function createTreeWindUniforms(
  init: { strength?: number; dirX?: number; dirZ?: number; height?: number } = {}
): TreeWindUniforms {
  return {
    uWindTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(init.dirX ?? 1, init.dirZ ?? 0) },
    uWindStrength: { value: init.strength ?? 0.5 },
    uWindHeight: { value: init.height ?? 15 },
  };
}

const WIND_VERTEX_PARS = /* glsl */ `
attribute vec3 windData;
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindHeight;
`;

const WIND_VERTEX_BEGIN = /* glsl */ `
#include <begin_vertex>
{
  mat4 wModel = modelMatrix;
  #ifdef USE_INSTANCING
    wModel = modelMatrix * instanceMatrix;
  #endif
  // Kierunek świata -> lokalny (obrót + jednolita skala: transpozycja = odwrotność z dokładnością do skali)
  vec3 wDirW = vec3(uWindDir.x, 0.0, uWindDir.y);
  float wDirLen = max(length(wDirW), 1e-5);
  vec3 wLocal = wDirW * mat3(wModel);
  wLocal /= max(length(wLocal), 1e-5);
  // Faza drzewa z jego położenia w świecie: sąsiednie drzewa nie kołyszą się unisono, fala biegnie z wiatrem
  vec3 wOrigin = wModel[3].xyz;
  float wTreePhase = dot(wOrigin.xz, uWindDir / wDirLen) * 0.35 + fract(sin(dot(wOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
  float t = uWindTime;
  float s = uWindStrength;
  float hRel = max(transformed.y, 0.0) / max(uWindHeight, 1e-3);
  // 1) zgięcie całego drzewa: stałe wychylenie + kołysanie, rośnie z kwadratem wysokości
  float sway = 0.65 + 0.35 * sin(t * (0.9 + 0.4 * s) + wTreePhase) + 0.12 * sin(t * 2.1 + wTreePhase * 1.7);
  float mainBend = s * hRel * hRel * sway * uWindHeight * 0.035;
  // 2) gałęzie: własne oscylacje z fazą pędu
  float branch = windData.x * s * (0.25 + 0.75 * s) * (0.5 + 0.5 * sin(t * (1.8 + 1.4 * s) + windData.y + wTreePhase)) * 0.06;
  // 3) trzepot liści wzdłuż normalnej
  float flutter = windData.z * s * 0.03 * sin(t * 9.0 + dot(transformed, vec3(3.1, 2.3, 1.7)) + windData.y);
  transformed += wLocal * (mainBend + branch);
  transformed.y -= (mainBend + branch) * 0.1 * hRel;
  transformed += normal * flutter;
}
`;

/**
 * Wiatr w vertex shaderze: łata materiału Three (Standard/Lambert/Phong/Basic itd.) przez `onBeforeCompile`.
 * Wymaga geometrii z atrybutem `windData` (`windAttributes: true` przy generowaniu); działa z `InstancedMesh`.
 * Animacja: `uniforms.uWindTime.value = clock.getElapsedTime()` raz na klatkę — bez regeneracji siatki.
 * Istniejący `onBeforeCompile` materiału jest zachowany (wywoływany przed łatą).
 */
export function applyTreeWind<M extends THREE.Material>(
  material: M,
  uniforms: TreeWindUniforms = createTreeWindUniforms()
): TreeWindUniforms {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WIND_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', WIND_VERTEX_BEGIN);
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}|usi-tree-wind`;
  material.needsUpdate = true;
  return uniforms;
}
