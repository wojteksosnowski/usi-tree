import { FastPrng } from './prng.js';
import { applyPipeRadii, growEzTree } from './ezTree.js';
import { MeshBufferBuilder } from './meshBuilder.js';
import { growBotanicalTree } from './growthEngine.js';
import {
  extrudeStem,
  addLeaves,
  strokeStem as strokeStemImpl,
  trunkBaseRadius as trunkBaseRadiusImpl,
  DEFAULT_LEAF_DENSITY,
} from './meshExtruder.js';
import {
  SPECIES_PROFILES,
  TIDY_STRUCTURE,
  ILLUSTRATION_STROKE,
  ezMeshProfile,
} from './speciesProfiles.js';
import type {
  TreeSpecies,
  TreeDetail,
  TrunkForm,
  TreeGenerationParams,
  TreeStroke,
  RawTreeMesh,
  TreeRawGeometryResult,
  CrownShape,
  BranchLevelParams,
  SpeciesProfile,
  Stem,
  TreeSkeleton,
  EzTreeOptions,
} from './types.js';

export {
  type TreeSpecies,
  type TreeDetail,
  type TrunkForm,
  type TreeGenerationParams,
  type TreeStroke,
  type RawTreeMesh,
  type TreeRawGeometryResult,
  type CrownShape,
  type BranchLevelParams,
  type SpeciesProfile,
  type Stem,
  type TreeSkeleton,
  type EzTreeOptions,
  SPECIES_PROFILES,
  TIDY_STRUCTURE,
  ILLUSTRATION_STROKE,
  DEFAULT_LEAF_DENSITY,
  ezMeshProfile,
  FastPrng,
};

const EZ_TRUNK_RADIUS = 0.018;
const EZ_TIP_RADIUS = 0.0011;

/**
 * Proceduralny generator drzew (TreeGenerator) — model rekurencyjny Webera–Penna
 * („Creation and Rendering of Realistic Trees”, SIGGRAPH 1995):
 * obwiednia korony, wygięcie i tropizm pędów, filotaksja (przetasowane sloty albo złoty kąt),
 * promienie wg reguły rur (da Vinci). Stylistyka: rysunek architektoniczny (low-poly tuby).
 *
 * Czysta fasada re-entrantna bez mutowalnego stanu statycznego.
 */
export class TreeGenerator {
  /**
   * Generuje zoptymalizowaną geometrię BufferGeometry dla wskazanego gatunku i wysokości
   */
  static generateRaw(params: TreeGenerationParams): TreeRawGeometryResult {
    return TreeGenerator.meshSkeletonRaw(TreeGenerator.buildSkeleton(params), params);
  }

  /**
   * Szkielet drzewa (cała losowość kształtu). Jak w ez-tree: szkielet nie zależy od LOD,
   * więc jedno drzewo można zsiatkować w kilku szczegółowościach bez zmiany sylwetki.
   */
  static buildSkeleton(params: TreeGenerationParams): TreeSkeleton {
    const species = params.species;
    const height = Math.max(0.1, params.height);
    const profile = params.profile ?? SPECIES_PROFILES[species];
    const seed = params.seed ?? (Math.floor(height * 100) + species.charCodeAt(0) * 31);
    if (params.ez) return TreeGenerator.buildEzSkeleton(params, params.ez, seed, height);

    const flow = params.flow ?? false;
    const asymAz = ((((seed * 0.6180339887) % 1) + 1) % 1) * Math.PI * 2;
    const prng = new FastPrng(seed);
    const stems = growBotanicalTree(profile, prng, params.form ?? 'SINGLE', flow, asymAz);

    let maxY = 0;
    for (const s of stems) {
      for (const y of s.py) {
        if (y > maxY) maxY = y;
      }
    }
    return {
      species,
      profile,
      seed,
      stems,
      scale: height / Math.max(1e-6, maxY),
      height,
    };
  }

  /**
   * Szkielet ze wzrostu ez-tree, przeliczony do skali nominalnej (wysokość = 1), jak szkielety naszego modelu:
   * dalej siatkuje go `meshSkeleton` w naszej stylizacji. Profil (jawny albo `ezMeshProfile`) steruje tylko siatką.
   */
  private static buildEzSkeleton(
    params: TreeGenerationParams,
    ez: EzTreeOptions,
    seed: number,
    height: number
  ): TreeSkeleton {
    const profile = params.profile ?? ezMeshProfile(ez);
    const sk = growEzTree(ez, seed, params.form ?? 'SINGLE', params.flow ?? false);
    const { stems, leafSites } = sk;
    // Model rur z końcówkami o promieniu 1, potem skala: pnie od gruntu razem = EZ_TRUNK_RADIUS (wzorzec SA_Artboard2)
    const p = ez.pipeExponent ?? 2.5;
    applyPipeRadii(sk, p, 1);
    let rootSum = 0;
    for (let i = 0; i < stems.length; i++) {
      if (sk.parents[i] < 0) rootSum += Math.pow(stems[i].r[0], p);
    }
    let maxY = 1e-6;
    for (const s of stems) {
      for (const y of s.py) {
        if (y > maxY) maxY = y;
      }
    }
    const k = 1 / maxY;
    const kr = EZ_TRUNK_RADIUS / Math.pow(Math.max(1e-9, rootSum), 1 / p);
    for (const s of stems) {
      for (let i = 0; i < s.px.length; i++) {
        s.px[i] *= k;
        s.py[i] *= k;
        s.pz[i] *= k;
        s.r[i] = Math.max(EZ_TIP_RADIUS, s.r[i] * kr);
      }
      s.length *= k;
      if (s.level === 0 && s.py[0] < 1e-6) s.r[0] *= profile.flareFactor;
    }
    const sites: number[] = [];
    for (let i = 0; i < leafSites.length; i += 7) {
      sites.push(
        leafSites[i] * k,
        leafSites[i + 1] * k,
        leafSites[i + 2] * k,
        leafSites[i + 3],
        leafSites[i + 4],
        leafSites[i + 5]
      );
    }
    return {
      species: params.species,
      profile,
      seed,
      stems,
      scale: height,
      height,
      leafSites: sites,
      uniformStroke: true,
    };
  }

  /** Siatka szkieletu w zadanej szczegółowości (nie zmienia kształtu) */
  static meshSkeletonRaw(
    skeleton: TreeSkeleton,
    params: Pick<
      TreeGenerationParams,
      'radialSegments' | 'withFoliageAccents' | 'detail' | 'stroke'
    >
  ): TreeRawGeometryResult {
    const { profile, stems, scale, height } = skeleton;
    const prng = new FastPrng(skeleton.seed ^ 0x9e3779b9);
    const radialSegs = Math.max(
      3,
      Math.min(8, params.radialSegments ?? profile.radialSegments ?? 4)
    );
    const withFoliage = params.withFoliageAccents ?? false;
    const detail = params.detail ?? 'HIGH';
    const deepest = profile.levels.length;
    const ringStride = detail === 'HIGH' ? 1 : 2;
    const maxLevel = detail === 'LOW' ? Math.max(1, deepest - 1) : deepest;

    // Ciągłe tuby (pień pełną liczbą boków, drobne pędy trójkątne)
    const builder = new MeshBufferBuilder();
    const stroke = params.stroke;
    const trunkR = stroke ? TreeGenerator.trunkBaseRadius(stems) : Infinity;

    for (const s of stems) {
      if (s.level > maxLevel) continue;
      const sides = s.level === 0 ? radialSegs : Math.max(3, radialSegs - 1);
      const jitter = s.level === 0 ? profile.jitterStrength : profile.jitterStrength * 0.5;
      const finalStem =
        stroke && !skeleton.uniformStroke ? TreeGenerator.strokeStem(s, stroke, height, trunkR) : s;
      extrudeStem(finalStem, scale, sides, jitter, ringStride, prng, builder);
    }
    builder.addGroup(0, builder.indices.length, 0);

    if (withFoliage) {
      addLeaves(
        stems,
        scale,
        profile,
        prng,
        builder,
        builder.indices.length,
        skeleton.leafSites
      );
    }

    const raw = builder.buildRawMesh();
    return {
      mesh: raw,
      bounds: {
        height: raw.boundingBox.max[1] - raw.boundingBox.min[1],
        crownRadius: Math.max(
          Math.abs(raw.boundingBox.min[0]),
          Math.abs(raw.boundingBox.max[0]),
          Math.abs(raw.boundingBox.min[2]),
          Math.abs(raw.boundingBox.max[2])
        ),
      },
    };
  }

  /** Promień nasady pnia (pierwszy pęd rzędu 0) — odniesienie limitów grubości kreski; brak pnia = bez limitu */
  static trunkBaseRadius(stems: readonly Stem[]): number {
    return trunkBaseRadiusImpl(stems);
  }

  /** Pęd z promieniami wg kreski: mnożnik rzędu, wygładzona zbieżność, odziomek rozłożony w górę pnia */
  static strokeStem(
    stem: Stem,
    stroke: TreeStroke,
    nominalHeight: number,
    trunkBaseR: number
  ): Stem {
    return strokeStemImpl(stem, stroke, nominalHeight, trunkBaseR);
  }
}
