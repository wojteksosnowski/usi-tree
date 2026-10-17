/**
 * Built-in botanical species profiles and structural presets (Weber & Penn model).
 */
import type {
  BranchLevelParams,
  CrownShape,
  SpeciesProfile,
  TreeSpecies,
  TreeStroke,
} from './types.js';

/**
 * Kreska ilustracji (wzorzec SA_Artboard2), mnożniki skalibrowane pomiarem wzorca:
 * mediany grubości / wysokość drzewa — pień ~3,8% przy odziomku i ~3,2% na 15% wysokości, konary ~2,7%, gałęzie ~0,8%.
 */
export const ILLUSTRATION_STROKE: TreeStroke = {
  levelScale: [1.0, 1.65, 2.9, 1],
  smooth: true,
  flareRise: 0.03,
};

/**
 * Uporządkowana struktura korony: bez kikutów na obwiedni, gałęzie na zewnątrz, spokojniejsze witki.
 * Na ziarnach spoza dopasowania sylwetka bliżej alfabetu drzew w 9 z 11 wzorców, wskaźnik granatu ~2× niższy.
 */
export const TIDY_STRUCTURE: Pick<SpeciesProfile, 'prune' | 'outwardBias' | 'phyllotaxis' | 'twigGnarl' | 'kinkScale'> = {
  prune: true,
  outwardBias: 0.5,
  phyllotaxis: 'golden',
  twigGnarl: 0.3,
  kinkScale: 0.4,
};

export const lvl = (
  p: Partial<BranchLevelParams> & Pick<BranchLevelParams, 'count' | 'downAngle' | 'lengthRatio'>
): BranchLevelParams => ({
  downAngleV: 10,
  lengthV: 0.2,
  curve: 0,
  curveV: 8,
  curveRes: 3,
  tropism: 0,
  fork: 0,
  ...p,
});

/**
 * Profile morfologiczne gatunków (model Webera–Penna) strojone pod ryciny
 * w reference/design/drzewa/: cienki pień, gęsta drobna koronka witek, czytelna obwiednia.
 * Wszystkie z uporządkowaną strukturą korony (TIDY_STRUCTURE).
 */
export const SPECIES_PROFILES: Record<TreeSpecies, SpeciesProfile> = {
  OAK: {
    trunkHeightRatio: 0.24, trunkBaseRadiusRatio: 0.013, trunkLengthRatio: 0.85, trunkCurveV: 4,
    crownSpreadRatio: 0.42, crownShape: 'SPHERICAL', ratioPower: 1.25,
    levels: [
      lvl({ count: 11, downAngle: 45, downAngleSlope: 35, downAngleV: 10, lengthRatio: 1, curve: 30, curveV: 8, curveRes: 6, fork: 24 }),
      lvl({ count: 7, downAngle: 40, downAngleV: 15, lengthRatio: 0.6, curve: 10, curveV: 9, curveRes: 3, fork: 24 }),
      lvl({ count: 7, downAngle: 38, downAngleV: 15, lengthRatio: 0.55, curveV: 18, curveRes: 2 }),
    ],
    jitterStrength: 0.10, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.017,
    ...TIDY_STRUCTURE,
  },
  BIRCH: {
    trunkHeightRatio: 0.28, trunkBaseRadiusRatio: 0.009, trunkLengthRatio: 0.98, trunkCurveV: 3,
    crownSpreadRatio: 0.30, crownShape: 'TEND_FLAME', ratioPower: 1.3,
    levels: [
      lvl({ count: 26, downAngle: 42, downAngleSlope: 25, downAngleV: 10, lengthRatio: 1, curve: 15, curveV: 8, curveRes: 5 }),
      lvl({ count: 8, downAngle: 40, lengthRatio: 0.6, curveV: 10, curveRes: 3, tropism: -0.25 }),
      lvl({ count: 6, downAngle: 30, lengthRatio: 0.5, curveV: 10, curveRes: 2, tropism: -0.9 }),
    ],
    jitterStrength: 0.06, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.012, leafAspect: 0.7,
    ...TIDY_STRUCTURE,
  },
  PINE: {
    trunkHeightRatio: 0.60, trunkBaseRadiusRatio: 0.011, trunkLengthRatio: 0.97, trunkCurveV: 3,
    crownSpreadRatio: 0.34, crownShape: 'UMBRELLA', ratioPower: 1.2,
    levels: [
      lvl({ count: 14, downAngle: 72, downAngleV: 12, lengthRatio: 1, curve: 35, curveV: 12, kink: 10, curveRes: 5 }),
      lvl({ count: 8, downAngle: 50, lengthRatio: 0.45, curve: 15, curveV: 12, kink: 10, curveRes: 3, tropism: 0.2 }),
      lvl({ count: 5, downAngle: 40, lengthRatio: 0.4, curveV: 12, kink: 10, curveRes: 2, tropism: 0.3 }),
    ],
    jitterStrength: 0.08, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.014, leafAspect: 0.18, leafClump: 9, trunkKink: 0, tipSpurs: false,
    ...TIDY_STRUCTURE,
  },
  SPRUCE: {
    trunkHeightRatio: 0.06, trunkBaseRadiusRatio: 0.012, trunkLengthRatio: 1.0, trunkCurveV: 1.5,
    crownSpreadRatio: 0.24, crownShape: 'CONICAL', ratioPower: 1.0,
    levels: [
      lvl({ count: 64, downAngle: 82, downAngleV: 6, lengthRatio: 1, lengthV: 0.1, curve: 8, curveV: 3, kink: 4, curveRes: 4, tropism: -0.15 }),
      lvl({ count: 9, downAngle: 55, downAngleV: 8, lengthRatio: 0.32, curveV: 4, kink: 4, curveRes: 2, tropism: -0.4 }),
    ],
    jitterStrength: 0.04, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.012, leafAspect: 0.18, leafClump: 7, trunkKink: 0, tipSpurs: false,
    ...TIDY_STRUCTURE,
  },
  POPLAR: {
    trunkHeightRatio: 0.10, trunkBaseRadiusRatio: 0.01, trunkLengthRatio: 1.0, trunkCurveV: 1.5,
    crownSpreadRatio: 0.16, crownShape: 'CYLINDRICAL', ratioPower: 1.2,
    levels: [
      lvl({ count: 32, downAngle: 26, downAngleV: 8, lengthRatio: 1, curve: 10, curveV: 4, kink: 5, curveRes: 4, tropism: 0.4 }),
      lvl({ count: 7, downAngle: 25, lengthRatio: 0.45, curveV: 6, kink: 5, curveRes: 2, tropism: 0.4 }),
      lvl({ count: 4, downAngle: 25, lengthRatio: 0.45, curveV: 8, kink: 5, curveRes: 2, tropism: 0.3 }),
    ],
    jitterStrength: 0.05, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.012, leafAspect: 0.7, leafDensity: 50, trunkKink: 0, tipSpurs: false,
    ...TIDY_STRUCTURE,
  },
  WILLOW: {
    trunkHeightRatio: 0.24, trunkBaseRadiusRatio: 0.015, trunkLengthRatio: 0.55, trunkCurveV: 7,
    crownSpreadRatio: 0.36, crownShape: 'HEMISPHERICAL', ratioPower: 1.2,
    levels: [
      lvl({ count: 7, downAngle: 40, downAngleSlope: 20, downAngleV: 12, lengthRatio: 1, curve: 15, curveV: 7, curveRes: 5, fork: 25 }),
      lvl({ count: 5, downAngle: 40, lengthRatio: 0.55, curveV: 10, curveRes: 4, tropism: -0.7 }),
      lvl({ count: 3, downAngle: 25, lengthRatio: 1.1, lengthV: 0.15, curveV: 3, curveRes: 4, tropism: -3.0 }),
    ],
    jitterStrength: 0.10, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.013, leafAspect: 0.25, leafClump: 6, leafDensity: 70,
    ...TIDY_STRUCTURE,
  },
  ASH: {
    trunkHeightRatio: 0.26, trunkBaseRadiusRatio: 0.011, trunkLengthRatio: 0.9, trunkCurveV: 3,
    crownSpreadRatio: 0.34, crownShape: 'TEND_FLAME', ratioPower: 1.25,
    levels: [
      lvl({ count: 12, downAngle: 38, downAngleSlope: 22, downAngleV: 10, lengthRatio: 1, curve: 25, curveV: 8, curveRes: 6, fork: 22 }),
      lvl({ count: 6, downAngle: 55, lengthRatio: 0.5, curve: 15, curveV: 8, curveRes: 3, tropism: 0.15 }),
      lvl({ count: 4, downAngle: 45, lengthRatio: 0.5, curveV: 8, curveRes: 2, tropism: 0.2 }),
    ],
    jitterStrength: 0.06, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.016,
    ...TIDY_STRUCTURE,
  },
  ASPEN: {
    trunkHeightRatio: 0.50, trunkBaseRadiusRatio: 0.008, trunkLengthRatio: 1.0, trunkCurveV: 2,
    crownSpreadRatio: 0.22, crownShape: 'TEND_FLAME', ratioPower: 1.3,
    levels: [
      lvl({ count: 30, downAngle: 55, downAngleV: 12, lengthRatio: 1, curve: 25, curveV: 6, curveRes: 4, tropism: 0.2 }),
      lvl({ count: 7, downAngle: 32, lengthRatio: 0.55, curveV: 6, curveRes: 2, tropism: 0.25 }),
    ],
    jitterStrength: 0.04, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.013, leafAspect: 0.85, trunkKink: 1,
    ...TIDY_STRUCTURE,
  },
  BUSH: {
    trunkHeightRatio: 0.02, trunkBaseRadiusRatio: 0.014, trunkLengthRatio: 0.12, trunkCurveV: 2,
    crownSpreadRatio: 0.75, crownShape: 'HEMISPHERICAL', ratioPower: 1.1,
    levels: [
      lvl({ count: 14, downAngle: 26, downAngleV: 12, lengthRatio: 1, curve: -15, curveV: 7, curveRes: 5, fork: 26 }),
      lvl({ count: 5, downAngle: 50, lengthRatio: 0.45, curveV: 9, curveRes: 3 }),
      lvl({ count: 3, downAngle: 45, lengthRatio: 0.5, curveV: 10, curveRes: 2 }),
    ],
    jitterStrength: 0.05, flareFactor: 1.12, radialSegments: 3, leafSizeRatio: 0.036,
    ...TIDY_STRUCTURE,
  },
};

/** Względna wysokość w koronie, na której kształt obwiedni jest najszerszy (dla `crownPeak`) */
export const CROWN_SHAPE_PEAK: Record<CrownShape, number> = {
  CONICAL: 0,
  SPHERICAL: 0.5,
  HEMISPHERICAL: 0,
  TEND_FLAME: 0.35,
  CYLINDRICAL: 1 / 2.2,
  OVOID_COLUMN: 0.6,
  UMBRELLA: 0.35 / 0.85,
};

import type { EzTreeOptions } from './types.js';

/**
 * Profil siatki dla szkieletu ez-tree: liczba rzędów (szczegółowość LOW pomija najdrobniejszy), przekrój tub,
 * odziomek i liście w naszej stylizacji. Parametry wzrostu naszego modelu nie są używane.
 */
export function ezMeshProfile(ez: EzTreeOptions): SpeciesProfile {
  const evergreen = ez.type === 'evergreen';
  return {
    trunkHeightRatio: 0.2,
    trunkBaseRadiusRatio: 0.012,
    trunkLengthRatio: 1,
    trunkCurveV: 0,
    crownSpreadRatio: 0.4,
    crownShape: 'SPHERICAL',
    ratioPower: 1.2,
    levels: Array.from({ length: ez.branch.levels }, () =>
      lvl({ count: 0, downAngle: 0, lengthRatio: 1 })
    ),
    jitterStrength: 0.06,
    flareFactor: 1.12,
    radialSegments: 4,
    leafSizeRatio: evergreen ? 0.014 : 0.016,
    leafAspect: evergreen ? 0.18 : 0.55,
    leafClump: evergreen ? 9 : 4,
  };
}

