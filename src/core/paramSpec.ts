/**
 * Rejestr parametrów liczbowych profilu: wartość domyślna silnika (gdy pole pominięte) oraz zakres,
 * do którego przycinana jest krzywa wysokości (`heightProfile.ts`) przy interpolacji i ekstrapolacji.
 * Jedno źródło prawdy dla `resolveNumericParam`, `profileAtHeight` i testu zgodności z silnikiem.
 *
 * `default` jako funkcja: wartość zależna od innych pól profilu/rzędu.
 */
import type { BranchLevelParams, CrownShape, SpeciesProfile } from './types.js';
import { CROWN_SHAPE_PEAK } from './speciesProfiles.js';

export interface ParamSpec<T> {
  default?: number | ((o: Partial<T>, heightM: number) => number | undefined);
  min: number;
  max: number;
  integer?: boolean;
}

const INF = Number.POSITIVE_INFINITY;

export const BRANCH_PARAM_SPEC: Record<string, ParamSpec<BranchLevelParams>> = {
  count: { default: 1, min: 0, max: 400, integer: true },
  downAngle: { default: 45, min: -30, max: 180 },
  downAngleV: { default: 10, min: 0, max: 90 },
  downAngleSlope: { default: 0, min: -90, max: 90 },
  lengthRatio: { default: 0.5, min: 1e-4, max: 3 },
  lengthV: { default: 0.2, min: 0, max: 1 },
  curve: { default: 0, min: -360, max: 360 },
  curveBack: { default: (l) => (typeof l.curve === 'number' ? l.curve : 0), min: -360, max: 360 },
  curveV: { default: 8, min: 0, max: 180 },
  curveRes: { default: 3, min: 1, max: 40, integer: true },
  tropism: { default: 0, min: -10, max: 10 },
  kink: { default: 15, min: 0, max: 90 },
  fork: { default: 0, min: 0, max: 120 },
  segmentDecay: { default: 1, min: 0.5, max: 1 },
  minSegmentRatio: { min: 1e-4, max: 0.5 },
  tipRatio: { default: (l) => ((typeof l.fork === 'number' ? l.fork : 0) > 0 ? 0.35 : 0.22), min: 1e-4, max: 1 },
  taperShape: { default: 0, min: 0, max: 1 },
  baseSize: { default: 0.1, min: 0, max: 1 },
  rotate: { default: 180 * (3 - Math.sqrt(5)), min: -360, max: 360 },
  rotateV: { default: (0.25 * 180) / Math.PI, min: 0, max: 180 },
};

export const SPECIES_PARAM_SPEC: Record<string, ParamSpec<SpeciesProfile>> = {
  trunkHeightRatio: { default: 0.24, min: 1e-4, max: 1 },
  trunkBaseRadiusRatio: { default: 0.012, min: 1e-4, max: 0.2 },
  trunkLengthRatio: { default: 0.9, min: 1e-4, max: 1.5 },
  trunkSegmentDecay: { default: 1, min: 0.5, max: 1 },
  trunkMinSegmentRatio: { min: 1e-4, max: 0.5 },
  trunkTipRatio: { default: 0.3, min: 1e-4, max: 1 },
  taperShape: { default: 0, min: 0, max: 1 },
  trunkCurveV: { default: 3, min: 0, max: 180 },
  crownSpreadRatio: { default: 0.35, min: 1e-4, max: 3 },
  twigStroke: { default: 1, min: 0, max: 10 },
  crownPeak: {
    default: (p) => (p.crownShape ? CROWN_SHAPE_PEAK[p.crownShape as CrownShape] : undefined) ?? 0.4,
    min: 0.001,
    max: 1.5,
  },
  ratioPower: { default: 1.2, min: 0, max: 5 },
  jitterStrength: { default: 0.06, min: 0, max: 1 },
  flareFactor: { default: 1.12, min: 0, max: 5 },
  radialSegments: { default: 4, min: 3, max: 8, integer: true },
  leafSizeRatio: { default: 0.015, min: 1e-4, max: 0.5 },
  leafSizeCm: {
    default: (p, h) =>
      typeof p.leafSizeRatio === 'number' ? Number((p.leafSizeRatio * Math.max(0.5, h) * 100).toFixed(2)) : 15,
    min: 0.1,
    max: 200,
  },
  leafAspect: { default: 0.55, min: 0.01, max: 5 },
  petioleLengthRatio: { default: 0.15, min: 0, max: 3 },
  petiolePliancy: { default: 0, min: 0, max: 1 },
  leafFlatness: { default: 0, min: 0, max: 1 },
  leafClump: { default: 4, min: 0, max: 64, integer: true },
  leafDensity: { default: 38, min: 0, max: 1000 },
  envelopeScale: { default: 1.0, min: 0.05, max: 5 },
  envelopeClipProbability: { default: 0.72, min: 0, max: 1 },
  trunkKink: { default: 3, min: 0, max: 90 },
  scaffoldLimbs: { default: 0, min: 0, max: 12, integer: true },
  trunkForkAngle: { default: 20, min: 0, max: 120 },
  trunkForkCount: { default: 2, min: 1, max: 8, integer: true },
  trunkForkAsymmetry: { default: 0, min: 0, max: 1 },
  trunkForkHeightRatio: {
    default: (p) => (typeof p.trunkHeightRatio === 'number' ? Math.min(p.trunkHeightRatio * 0.9, 0.265) : 0.24),
    min: 0.01,
    max: 0.9,
  },
  trunkForkSideLength: { default: 1, min: 0, max: 3 },
  trunkForkSideRadius: { default: 1, min: 0, max: 3 },
  trunkForkMainAngleScale: { default: 1, min: 0, max: 5 },
  trunkLeanScale: { default: 1, min: 0, max: 10 },
  crownAsymmetry: { default: 0, min: 0, max: 1 },
  trunkForkTropism: { default: 2.2, min: -10, max: 10 },
  limbBreakProbability: { default: 0, min: 0, max: 1 },
  outwardBias: { default: 0, min: 0, max: 1 },
  twigGnarl: { default: 1, min: 0, max: 10 },
  kinkScale: { default: 1, min: 0, max: 10 },
  pliancy: { default: 0, min: 0, max: 90 },
};

function resolveDefault<T>(spec: ParamSpec<T> | undefined, o: Partial<T>, heightM: number): number | undefined {
  const d = spec?.default;
  return typeof d === 'function' ? d(o, heightM) : d;
}

export function defaultBranchParam(lvl: Partial<BranchLevelParams>, key: string): number | undefined {
  return resolveDefault(BRANCH_PARAM_SPEC[key], lvl, 10);
}

export function defaultSpeciesParam(profile: Partial<SpeciesProfile>, key: string, heightM = 10): number | undefined {
  return resolveDefault(SPECIES_PARAM_SPEC[key], profile, heightM);
}

/** Zakres parametru (rząd gałęzi ma pierwszeństwo, gdy klucz występuje w obu); brak = bez ograniczeń */
export function paramRange(key: string): { min: number; max: number; integer: boolean } {
  const s = BRANCH_PARAM_SPEC[key] ?? SPECIES_PARAM_SPEC[key];
  return s ? { min: s.min, max: s.max, integer: !!s.integer } : { min: -INF, max: INF, integer: false };
}
