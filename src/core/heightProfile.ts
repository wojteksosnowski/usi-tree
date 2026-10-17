/**
 * Profil gatunku zależny od wysokości (wieku) drzewa: węzły dopasowane do wzorców (np. 6 / 9 / 15 m)
 * i interpolacja kawałkami liniowa po log2(h) — wysokości wzorców rosną wykładniczo (6, 9, 15, 24 m),
 * więc w skali logarytmicznej węzły leżą w równych odstępach.
 *
 * - w węzłach profil jest dokładnie strojonym profilem,
 * - poniżej najniższego węzła: profil najniższego węzła,
 * - powyżej najwyższego: ekstrapolacja ostatnim odcinkiem do `MAX_EXTRAPOLATION_M`, z ograniczeniem
 *   do zakresów `PARAM_LIMITS` (zakresy strojenia skilla procedural-tree-fitter),
 * - liczby całkowite (`count`, `curveRes`) zaokrąglane, pola nieliczbowe z najbliższego węzła.
 *
 * Bez three: moduł wolno importować poza leniwym widokiem 3D.
 */
import type { BranchLevelParams, SpeciesProfile } from './types.js';

export interface HeightAnchor {
  h: number;
  profile: SpeciesProfile;
}

/** Ekstrapolacja ponad najwyższy węzeł kończy się na kolejnym kroku ciągu 6 → 9 → 15 → 24 m */
export const MAX_EXTRAPOLATION_M = 24;

/** Liczbowe pola profilu i poziomu gałęzi — nazwy sprawdzane przez tsc */
type NumericKey<T> = { [K in keyof T]-?: NonNullable<T[K]> extends number ? K : never }[keyof T];
type ProfileNumericKey = NumericKey<SpeciesProfile> | NumericKey<BranchLevelParams>;

const INTEGER_KEYS = new Set<string>(['count', 'curveRes', 'leafClump'] satisfies ProfileNumericKey[]);

/** Zakresy parametrów przy ekstrapolacji (klucz bez indeksu poziomu) */
const PARAM_LIMITS: Partial<Record<ProfileNumericKey, [number, number]>> = {
  crownSpreadRatio: [0.15, 1.2],
  crownPeak: [0.1, 0.9],
  twigStroke: [0.2, 1.5],
  limbBreakProbability: [0, 0.5],
  trunkForkTropism: [0.5, 12],
  trunkForkSideLength: [0.4, 1.4],
  trunkForkSideRadius: [0.3, 1.3],
  trunkForkMainAngleScale: [0, 2],
  trunkLeanScale: [0, 2],
  crownAsymmetry: [0, 0.9],
  trunkHeightRatio: [0.05, 0.7],
  trunkLengthRatio: [0.3, 1.0],
  trunkCurveV: [0, 20],
  trunkBaseRadiusRatio: [0.003, 0.03],
  trunkTipRatio: [0.02, 0.4],
  pliancy: [0, 45],
  ratioPower: [0.8, 2],
  flareFactor: [1, 1.4],
  leafSizeRatio: [0.004, 0.05],
  leafDensity: [10, 100],
  envelopeClipProbability: [0, 1],
  downAngle: [15, 90],
  downAngleV: [0, 30],
  downAngleSlope: [-20, 50],
  curve: [-60, 60],
  curveV: [0, 30],
  curveBack: [-120, 40],
  count: [2, 30],
  lengthRatio: [0.2, 1.5],
  lengthV: [0, 0.5],
  tropism: [-3, 0.4],
  fork: [0, 40],
  tipRatio: [0.05, 0.5],
  baseSize: [0, 0.6],
};

function blend(a: unknown, b: unknown, t: number, key: string, extrapolated: boolean): unknown {
  if (typeof a === 'number' && typeof b === 'number') {
    let v = a + (b - a) * t;
    const lim = PARAM_LIMITS[key as ProfileNumericKey];
    if (extrapolated && lim) v = Math.min(lim[1], Math.max(lim[0], v));
    return INTEGER_KEYS.has(key) ? Math.round(v) : v;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) {
      // Poziom obecny tylko w jednym węźle: przyjmuje go bez zmian
      if (i >= a.length) out.push(b[i]);
      else if (i >= b.length) out.push(a[i]);
      else out.push(blend(a[i], b[i], t, key, extrapolated));
    }
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out: Record<string, unknown> = {};
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      // Pole obecne tylko w jednym węźle: decyduje najbliższy węzeł (może je pominąć)
      if (!(k in ra) || !(k in rb)) {
        const v = t < 0.5 ? ra[k] : rb[k];
        if (v !== undefined) out[k] = v;
      } else out[k] = blend(ra[k], rb[k], t, k, extrapolated);
    }
    return out;
  }
  // Pola nieliczbowe (kształt korony, flagi): wartość najbliższego węzła
  return t < 0.5 ? a : b;
}

/** Profil dla wysokości `h` z węzłów (dowolna kolejność, ≥ 1 węzeł) */
export function profileAtHeight(anchors: readonly HeightAnchor[], h: number): SpeciesProfile {
  const sorted = [...anchors].sort((x, y) => x.h - y.h);
  if (sorted.length === 1 || h <= sorted[0].h) return structuredClone(sorted[0].profile);
  const x = Math.log2(Math.min(h, MAX_EXTRAPOLATION_M));
  let i = sorted.findIndex((a) => a.h >= h) - 1;
  const extrapolated = i < 0;
  if (extrapolated) i = sorted.length - 2;
  const a = sorted[i];
  const b = sorted[i + 1];
  const t = (x - Math.log2(a.h)) / (Math.log2(b.h) - Math.log2(a.h));
  return blend(a.profile, b.profile, t, '', extrapolated) as SpeciesProfile;
}

/** Najniższy węzeł wzorców; poniżej profil się nie zmienia */
const MIN_ANCHOR_M = 6;

/**
 * Klasa wysokości wariantu w widoku 3D: wysokość zaokrąglona do pół oktawy w zakresie 6–24 m
 * (6, 8,5, 12, 17, 24 m). Proporcje zmieniają się wolno, więc pięć klas wystarcza, a liczba
 * generowanych wariantów rośnie najwyżej pięciokrotnie.
 */
export function heightClassM(h: number): number {
  const steps = Math.round(2 * Math.log2(Math.max(h, MIN_ANCHOR_M) / MIN_ANCHOR_M));
  return Math.round(MIN_ANCHOR_M * 2 ** (Math.min(4, steps) / 2) * 10) / 10;
}
