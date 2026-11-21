import { FastPrng } from './prng.js';
import { MeshBufferBuilder } from './meshBuilder.js';
import { growBotanicalTree } from './growthEngine.js';
import {
  extrudeStem,
  extrudeRibbonStem,
  addLeaves,
  addLeavesLod,
  isFullLeafLod,
  addCrownShell,
  collectLeafSites,
  selectStemRings,
  strokeStem as strokeStemImpl,
  trunkBaseRadius as trunkBaseRadiusImpl,
  DEFAULT_LEAF_DENSITY,
} from './meshExtruder.js';
import {
  SPECIES_PROFILES,
  TIDY_STRUCTURE,
  ILLUSTRATION_STROKE,
} from './speciesProfiles.js';
import { countMeshTriangles } from './treeLod.js';
import type {
  TreeMeshLod,
  TreeLodRawResult,
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
  SPECIES_PROFILES,
  TIDY_STRUCTURE,
  ILLUSTRATION_STROKE,
  DEFAULT_LEAF_DENSITY,
  FastPrng,
};

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
    const rawProfile = params.profile ?? SPECIES_PROFILES[species];
    const profile = rawProfile.leafSizeCm !== undefined
      ? { ...rawProfile, leafSizeRatio: (rawProfile.leafSizeCm / 100) / Math.max(0.5, height) }
      : rawProfile;
    const seed = params.seed ?? (Math.floor(height * 100) + species.charCodeAt(0) * 31);

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

  /** Siatka szkieletu w zadanej szczegółowości (nie zmienia kształtu) */
  static applyWindToSkeleton(
    skeleton: TreeSkeleton,
    wind: NonNullable<TreeGenerationParams['wind']>
  ): TreeSkeleton {
    const strength = Math.max(0, wind.strength);
    if (strength <= 0) return skeleton;
    const dl = Math.hypot(wind.dirX ?? 1, wind.dirZ ?? 0) || 1;
    const wx = (wind.dirX ?? 1) / dl;
    const wz = (wind.dirZ ?? 0) / dl;
    const pliancyScale = 1.0 + Math.min(45, Math.max(0, skeleton.profile.pliancy ?? 15)) / 20;
    const time = wind.time;

    const stems: Stem[] = skeleton.stems.map((s) => ({
      ...s,
      px: [...s.px],
      py: [...s.py],
      pz: [...s.pz],
      r: [...s.r],
    }));

    let parentRef = skeleton.windParents;
    if (!parentRef) {
      parentRef = new Array(stems.length).fill(null);
      for (let i = 1; i < stems.length; i++) {
        const ox = stems[i].px[0], oy = stems[i].py[0], oz = stems[i].pz[0];
        let bestD = Infinity, bestP = 0, bestSeg = 0, bestU = 0;
        for (let p = 0; p < i; p++) {
          if (stems[p].level > stems[i].level) continue;
          const ps = stems[p];
          for (let k = 0; k < ps.px.length - 1; k++) {
            const ax = ps.px[k], ay = ps.py[k], az = ps.pz[k];
            const dx = ps.px[k + 1] - ax, dy = ps.py[k + 1] - ay, dz = ps.pz[k + 1] - az;
            const dd = dx * dx + dy * dy + dz * dz;
            const u = dd > 1e-12 ? Math.max(0, Math.min(1, ((ox - ax) * dx + (oy - ay) * dy + (oz - az) * dz) / dd)) : 0;
            const d = Math.hypot(ox - (ax + dx * u), oy - (ay + dy * u), oz - (az + dz * u));
            if (d < bestD) { bestD = d; bestP = p; bestSeg = k; bestU = u; }
          }
        }
        if (bestD < 0.05) parentRef[i] = { pIdx: bestP, seg: bestSeg, u: bestU };
      }
      skeleton.windParents = parentRef;
    }

    for (let i = 0; i < stems.length; i++) {
      const s = stems[i];
      const pr = parentRef[i];
      if (pr) {
        const ps = stems[pr.pIdx];
        const nx0 = ps.px[pr.seg] + (ps.px[pr.seg + 1] - ps.px[pr.seg]) * pr.u;
        const ny0 = ps.py[pr.seg] + (ps.py[pr.seg + 1] - ps.py[pr.seg]) * pr.u;
        const nz0 = ps.pz[pr.seg] + (ps.pz[pr.seg + 1] - ps.pz[pr.seg]) * pr.u;
        const dx0 = nx0 - s.px[0], dy0 = ny0 - s.py[0], dz0 = nz0 - s.pz[0];
        for (let k = 0; k < s.px.length; k++) {
          s.px[k] += dx0; s.py[k] += dy0; s.pz[k] += dz0;
        }
      }
      const nSeg = s.px.length - 1;
      if (nSeg < 1) continue;
      const origX = [...s.px];
      const origY = [...s.py];
      const origZ = [...s.pz];
      const sway = time !== undefined
        ? 0.65 + 0.42 * Math.sin(time * (1.8 + strength * 1.4) + i * 0.25) + 0.24 * Math.sin(time * (3.7 + strength * 2.2) + i * 0.6)
        : 1.0;
      const levelBoost = 0.35 + s.level * 0.55;
      for (let k = 0; k < nSeg; k++) {
        const segX = origX[k + 1] - origX[k];
        const segY = origY[k + 1] - origY[k];
        const segZ = origZ[k + 1] - origZ[k];
        const segLen = Math.hypot(segX, segY, segZ) || 1e-6;
        const rMid = Math.max(0.001, (s.r[k] + s.r[k + 1]) * 0.5);
        const stiffnessInv = Math.min(6.0, 0.032 / Math.pow(rMid + 0.003, 0.85));
        const bendAmt = strength * pliancyScale * levelBoost * stiffnessInv * sway * ((k + 1) / nSeg) * 0.65;
        const bx = segX / segLen + wx * bendAmt;
        const by = segY / segLen - Math.abs(bendAmt) * 0.14;
        const bz = segZ / segLen + wz * bendAmt;
        const bl = Math.hypot(bx, by, bz) || 1;
        s.px[k + 1] = s.px[k] + (bx / bl) * segLen;
        s.py[k + 1] = s.py[k] + (by / bl) * segLen;
        s.pz[k + 1] = s.pz[k] + (bz / bl) * segLen;
      }
    }
    return { ...skeleton, stems };
  }

  static meshSkeletonRaw(
    skeleton: TreeSkeleton,
    params: Pick<
      TreeGenerationParams,
      'radialSegments' | 'withFoliageAccents' | 'detail' | 'stroke' | 'lod' | 'doubleSidedTwigs' | 'wind' | 'windAttributes'
    >
  ): TreeRawGeometryResult {
    const activeSkeleton = params.wind && params.wind.strength > 0
      ? TreeGenerator.applyWindToSkeleton(skeleton, params.wind)
      : skeleton;
    if (params.lod) return TreeGenerator.meshSkeletonLod(activeSkeleton, params, params.lod);
    const { profile, stems, scale, height } = activeSkeleton;
    const barkPrng = new FastPrng(skeleton.seed ^ 0x9e3779b9);
    const radialSegs = Math.max(
      3,
      Math.min(8, params.radialSegments ?? profile.radialSegments ?? 4)
    );
    const withFoliage = params.withFoliageAccents ?? false;
    const detail = params.detail ?? 'HIGH';
    const deepest = profile.levels.length;
    const maxLevel =
      detail === 'HIGH' ? deepest + 1 : detail === 'MEDIUM' ? deepest : Math.max(1, deepest - 1);
    const unit = height / scale;
    const tolL1 = detail === 'HIGH' ? 0.0015 : detail === 'MEDIUM' ? 0.003 : 0.005;
    const tolL2 = detail === 'HIGH' ? 0.004 : detail === 'MEDIUM' ? 0.008 : 0.010;
    const tolL3 = detail === 'HIGH' ? 0.008 : 0.016;
    const doubleFace = params.doubleSidedTwigs ?? false;

    // Progresywna redukcja: L0 pełna tuba, L1-L2 decymacja cięciwą + szpic, L3+ skręcana wstęga 2-wierzchołkowa
    const builder = new MeshBufferBuilder();
    const windTags = params.windAttributes ?? false;
    if (windTags) builder.enableWind();
    const stroke = params.stroke;
    const trunkR = stroke ? TreeGenerator.trunkBaseRadius(stems) : Infinity;

    for (let stemIdx = 0; stemIdx < stems.length; stemIdx++) {
      const s = stems[stemIdx];
      if (s.level > maxLevel) continue;
      if (windTags) tagWindStem(builder, s, stemIdx, scale, profile);
      const jitter = s.level === 0 ? profile.jitterStrength : profile.jitterStrength * 0.5;
      const finalStem =
        stroke && !skeleton.uniformStroke ? TreeGenerator.strokeStem(s, stroke, height, trunkR, profile.twigStroke) : s;

      if (s.level === 0) {
        extrudeStem(finalStem, scale, radialSegs, jitter, 1, barkPrng, builder, undefined, 'cone');
      } else if (s.level === 1) {
        extrudeStem(
          finalStem,
          scale,
          radialSegs,
          jitter,
          1,
          barkPrng,
          builder,
          selectStemRings(finalStem, tolL1 * unit),
          'spike'
        );
      } else if (s.level === 2) {
        const rings = selectStemRings(finalStem, tolL2 * unit);
        if (deepest === 2 && detail === 'MEDIUM') {
          extrudeRibbonStem(finalStem, scale, jitter, barkPrng, builder, rings, stemIdx, doubleFace);
        } else {
          extrudeStem(
            finalStem,
            scale,
            Math.max(3, radialSegs - 1),
            jitter,
            1,
            barkPrng,
            builder,
            rings,
            'spike'
          );
        }
      } else {
        extrudeRibbonStem(
          finalStem,
          scale,
          jitter,
          barkPrng,
          builder,
          selectStemRings(finalStem, tolL3 * unit),
          stemIdx,
          doubleFace
        );
      }
    }
    builder.addGroup(0, builder.indices.length, 0);

    if (withFoliage) {
      if (windTags) builder.setWindFoliage(windFoliageWeight(profile));
      const leafPrng = new FastPrng(skeleton.seed ^ 0x9e3779b9);
      leafPrng.skip(TreeGenerator.originalBarkDraws(stems, profile, radialSegs));
      addLeaves(
        stems,
        scale,
        profile,
        leafPrng,
        builder,
        builder.indices.length,
        skeleton.leafSites,
        params.wind
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

  /**
   * Liczba losowań strumienia kory w ścieżce bez LOD (`detail: 'LOW'`, krok pierścieni 2): po tylu losowaniach
   * zaczyna się strumień liści oryginału. Pozwala poziomowi bliskiemu mieć dokładnie te same liście bez budowania kory dwa razy.
   */
  private static originalBarkDraws(stems: readonly Stem[], profile: SpeciesProfile, radialSegs: number): number {
    const maxLevel = Math.max(1, profile.levels.length - 1);
    let draws = 0;
    for (const s of stems) {
      if (s.level > maxLevel) continue;
      const jitter = s.level === 0 ? profile.jitterStrength : profile.jitterStrength * 0.5;
      if (!(jitter > 0)) continue;
      const sides = s.level === 0 ? radialSegs : Math.max(3, radialSegs - 1);
      draws += (Math.ceil((s.px.length - 1) / 2) + 1) * sides;
    }
    return draws;
  }

  /**
   * Siatka poziomu LOD. Kora: pędy poniżej progu promienia i ponad pułap liczby albo budżet trójkątów odpadają, pierścienie wybiera
   * tolerancja cięciwy, cienkie pędy to pręt trójkątny bez denka (kora jest jednostronna — wstęga znikałaby od tyłu).
   * Listowie: miejsca liści z własnego strumienia losowego, wspólne dla poziomów (`collectLeafSites`).
   */
  private static meshSkeletonLod(
    skeleton: TreeSkeleton,
    params: Pick<TreeGenerationParams, 'radialSegments' | 'withFoliageAccents' | 'stroke' | 'windAttributes'>,
    lod: TreeMeshLod
  ): TreeRawGeometryResult {
    const { profile, stems, scale, height } = skeleton;
    const prng = new FastPrng(skeleton.seed ^ 0x9e3779b9);
    const clampSides = (n: number) => Math.max(3, Math.min(8, Math.round(n)));
    const radialSegs = clampSides(params.radialSegments ?? profile.radialSegments ?? 4);
    const trunkSides = clampSides(lod.trunkSides ?? radialSegs);
    const rod = lod.branchSides !== undefined && lod.branchSides < 3;
    const branchSides = clampSides(lod.branchSides ?? Math.max(3, radialSegs - 1));
    const maxLevel = Math.max(1, profile.levels.length - Math.max(0, lod.dropDeepestLevels ?? 0));
    // Progi w ułamku wysokości drzewa → jednostki szkieletu
    const unit = height / scale;
    const minRadius = (lod.minStemRadiusRatio ?? 0) * unit;
    const tolerance = (lod.ringTolerance ?? 0) * unit;

    const stroke = params.stroke;
    const trunkR = stroke ? TreeGenerator.trunkBaseRadius(stems) : Infinity;
    const drawn: Stem[] = [];
    for (const s of stems) {
      if (s.level > maxLevel) continue;
      const finalStem =
        stroke && !skeleton.uniformStroke ? TreeGenerator.strokeStem(s, stroke, height, trunkR, profile.twigStroke) : s;
      if (s.level > 0 && finalStem.r[0] < minRadius) continue;
      drawn.push(finalStem);
    }
    const ringsOf = new Map<Stem, number[]>();
    const sidesOf = (s: Stem) => (s.level === 0 ? trunkSides : branchSides);
    // Pręt: konar (rząd 1) zostaje otwartą tubą o pełnej grubości końca, cieńsze pędy zbiegają się w szpic; !rod: gałęzie zbiegają się w szpic
    const tipOf = (s: Stem) => (s.level === 0 ? 'cone' : !rod ? 'spike' : s.level === 1 ? 'open' : 'spike');
    const tolOf = (s: Stem) =>
      !rod && tolerance > 0
        ? tolerance * (s.level >= 2 ? 5 : s.level === 1 ? 2.5 : 1)
        : tolerance;
    // Trójkąty tuby: dwa na bok między pierścieniami plus zamknięcie czubka
    const cost = (s: Stem) => {
      const rings = selectStemRings(s, tolOf(s));
      ringsOf.set(s, rings);
      if (!rod && s.level >= 3) {
        return rings.length < 2 ? 0 : 2 * (rings.length - 2) + 1;
      }
      const tip = tipOf(s);
      const bands = rings.length - (tip === 'spike' ? 2 : 1);
      return 2 * sidesOf(s) * bands + (tip === 'open' ? 0 : sidesOf(s));
    };
    let kept: Set<Stem> | null = null;
    if (lod.maxBranches !== undefined || lod.maxBarkTriangles !== undefined) {
      const maxBranches = Math.max(0, Math.floor(lod.maxBranches ?? Infinity));
      let budget = lod.maxBarkTriangles ?? Infinity;
      for (const s of drawn) if (s.level === 0) budget -= cost(s);
      const branches = drawn
        .map((s, i) => ({ s, i, weight: s.length * s.r[0] }))
        .filter((b) => b.s.level > 0)
        .sort((a, b) => a.s.level - b.s.level || b.weight - a.weight || a.i - b.i);
      kept = new Set();
      for (const b of branches) {
        if (kept.size >= maxBranches) break;
        budget -= cost(b.s);
        if (budget < 0) break;
        kept.add(b.s);
      }
    }

    const builder = new MeshBufferBuilder();
    const windTags = params.windAttributes ?? false;
    if (windTags) builder.enableWind();
    for (let stemIdx = 0; stemIdx < drawn.length; stemIdx++) {
      const s = drawn[stemIdx];
      const trunk = s.level === 0;
      if (!trunk && kept && !kept.has(s)) continue;
      if (windTags) tagWindStem(builder, s, stemIdx, scale, profile);
      const jitter = trunk ? profile.jitterStrength : profile.jitterStrength * 0.5;
      const rings = ringsOf.get(s) ?? selectStemRings(s, tolOf(s));
      if (!rod && s.level >= 3) {
        extrudeRibbonStem(s, scale, jitter, prng, builder, rings, stemIdx, false);
      } else {
        extrudeStem(
          s,
          scale,
          sidesOf(s),
          jitter,
          1,
          prng,
          builder,
          rings,
          tipOf(s)
        );
      }
    }
    builder.addGroup(0, builder.indices.length, 0);

    if (params.withFoliageAccents ?? false) {
      if (windTags) builder.setWindFoliage(windFoliageWeight(profile));
      const field = collectLeafSites(stems, profile, skeleton.seed, skeleton.leafSites);
      if (lod.crownShell) {
        addCrownShell(
          field,
          scale,
          profile,
          skeleton.seed,
          builder,
          builder.indices.length,
          lod.crownShell,
          lod
        );
      } else if (isFullLeafLod(lod)) {
        // Poziom bliski = liście oryginału: ta sama ścieżka `addLeaves` (własny strumień losowy z ziarna drzewa)
        const leafPrng = new FastPrng(skeleton.seed ^ 0x9e3779b9);
        leafPrng.skip(TreeGenerator.originalBarkDraws(stems, profile, radialSegs));
        addLeaves(stems, scale, profile, leafPrng, builder, builder.indices.length, skeleton.leafSites);
      } else {
        addLeavesLod(field, scale, profile, skeleton.seed, builder, builder.indices.length, lod);
      }
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

  /**
   * Jeden szkielet w kilku poziomach LOD (np. `TREE_LOD_PRESETS`): siatki w kolejności `lods`
   * z liczbą trójkątów kory i listowia. Sylwetka i miejsca liści są wspólne dla wszystkich poziomów.
   */
  static meshSkeletonLodsRaw(
    skeleton: TreeSkeleton,
    lods: readonly TreeMeshLod[],
    params: Pick<TreeGenerationParams, 'radialSegments' | 'withFoliageAccents' | 'stroke' | 'windAttributes'> = {}
  ): TreeLodRawResult[] {
    return lods.map((lod) => {
      const res = TreeGenerator.meshSkeletonRaw(skeleton, { ...params, lod });
      return { ...res, triangles: countMeshTriangles(res.mesh) };
    });
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
    trunkBaseR: number,
    twigStroke = 1
  ): Stem {
    return strokeStemImpl(stem, stroke, nominalHeight, trunkBaseR, twigStroke);
  }
}

/** Mnożnik wiotkości gatunku dla wiatru GPU (ta sama skala co `applyWindToSkeleton`, 1 dla pliancy = 15) */
function windPliancyScale(profile: SpeciesProfile): number {
  return (1.0 + Math.min(45, Math.max(0, profile.pliancy ?? 15)) / 20) / 1.75;
}

/** Ugięcie u nasady i przyrost na długości pędu wg rzędu: konar 0 → 1, gałąź 0.5 → 1.5, gałązki 1 → 2 */
const WIND_LEVEL_BASE = [0, 0, 0.5, 1];

function windFoliageWeight(profile: SpeciesProfile): number {
  return 2 * windPliancyScale(profile);
}

function tagWindStem(builder: MeshBufferBuilder, s: Stem, stemIdx: number, scale: number, profile: SpeciesProfile) {
  let len = 0;
  for (let k = 1; k < s.px.length; k++) {
    len += Math.hypot(s.px[k] - s.px[k - 1], s.py[k] - s.py[k - 1], s.pz[k] - s.pz[k - 1]);
  }
  const k = windPliancyScale(profile);
  const w0 = s.level === 0 ? 0 : WIND_LEVEL_BASE[Math.min(s.level, WIND_LEVEL_BASE.length - 1)] * k;
  const span = s.level === 0 ? 0 : k;
  // Złoty podział rozkłada fazy kolejnych pędów równomiernie
  const phase = ((stemIdx * 0.618034) % 1) * Math.PI * 2;
  builder.setWindStem(s.px[0] * scale, s.py[0] * scale, s.pz[0] * scale, len * scale, w0, span, phase);
}
