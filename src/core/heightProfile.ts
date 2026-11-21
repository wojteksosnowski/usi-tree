/**
 * Profil gatunku zależny od wysokości (wieku) drzewa: węzły dopasowane do wzorców (np. 6 / 9 / 15 / 24 m)
 * oraz ciągłe dopasowanie krzywej trendu dla każdego zmiennego parametru liczbowego:
 * - 2 węzły: dopasowanie liniowe (y = a*h + b),
 * - ≥ 3 węzły: wybór najlepszego dopasowania (najmniejszy SSE) spośród liniowego, logarytmicznego i wykładniczego,
 * - poniżej najniższego węzła: profil najniższego węzła,
 * - powyżej najwyższego węzła (również > 24 m): kontynuacja wyznaczoną krzywą trendu,
 * - liczby całkowite (`count`, `curveRes`, `leafClump`) zaokrąglane, pola nieliczbowe z najbliższego węzła.
 *
 * Bez three: moduł wolno importować poza leniwym widokiem 3D.
 */
import { CROWN_SHAPE_PEAK } from './speciesProfiles.js';
import type { BranchLevelParams, CrownShape, SpeciesProfile } from './types.js';

export interface HeightAnchor {
  h: number;
  profile: SpeciesProfile;
}

/** Zachowane dla wstecznej zgodności eksportów */
export const MAX_EXTRAPOLATION_M = 24;

export type CurveFitKind = 'const' | 'linear' | 'log' | 'exp';

export interface CurveFitResult {
  kind: CurveFitKind;
  points: { h: number; y: number }[];
  eval: (h: number) => number;
}

const INTEGER_KEYS = new Set<string>(['count', 'curveRes', 'leafClump']);
const POSITIVE_RATIO_KEYS = new Set<string>([
  'trunkBaseRadiusRatio',
  'trunkTipRatio',
  'leafSizeRatio',
  'lengthRatio',
  'trunkLengthRatio',
  'crownSpreadRatio',
  'trunkHeightRatio',
]);

function defaultBranchLevelParam(lvl: Partial<BranchLevelParams>, key: string): number | undefined {
  switch (key) {
    case 'count':
      return 1;
    case 'downAngle':
      return 45;
    case 'downAngleV':
      return 10;
    case 'lengthRatio':
      return 0.5;
    case 'lengthV':
      return 0.2;
    case 'curve':
      return 0;
    case 'curveV':
      return 8;
    case 'curveRes':
      return 3;
    case 'tropism':
      return 0;
    case 'downAngleSlope':
      return 0;
    case 'kink':
      return 15;
    case 'fork':
      return 0;
    case 'tipRatio':
      return (typeof lvl.fork === 'number' ? lvl.fork : 0) > 0 ? 0.35 : 0.22;
    case 'taper':
      return 0;
    case 'curveBack':
      return typeof lvl.curve === 'number' ? lvl.curve : 0;
    case 'baseSize':
      return 0.1;
    case 'rotate':
      return 180 * (3 - Math.sqrt(5));
    case 'rotateV':
      return (0.25 * 180) / Math.PI;
    default:
      return undefined;
  }
}

function defaultSpeciesParam(profile: Partial<SpeciesProfile>, key: string, heightM = 10): number | undefined {
  switch (key) {
    case 'trunkHeightRatio':
      return 0.24;
    case 'trunkBaseRadiusRatio':
      return 0.012;
    case 'trunkLengthRatio':
      return 0.9;
    case 'trunkTipRatio':
      return 0.3;
    case 'trunkTaper':
      return 0;
    case 'trunkCurveV':
      return 3;
    case 'crownSpreadRatio':
      return 0.35;
    case 'twigStroke':
      return 1;
    case 'crownPeak':
      return (profile.crownShape ? CROWN_SHAPE_PEAK[profile.crownShape as CrownShape] : undefined) ?? 0.4;
    case 'ratioPower':
      return 1.2;
    case 'jitterStrength':
      return 0.06;
    case 'flareFactor':
      return 1.12;
    case 'radialSegments':
      return 4;
    case 'leafSizeRatio':
      return 0.015;
    case 'leafSizeCm':
      return typeof profile.leafSizeRatio === 'number'
        ? Number((profile.leafSizeRatio * Math.max(0.5, heightM) * 100).toFixed(2))
        : 15;
    case 'leafAspect':
      return 0.55;
    case 'petioleLengthRatio':
      return 0.15;
    case 'petiolePliancy':
      return 0;
    case 'leafFlatness':
      return 0;
    case 'leafClump':
      return 4;
    case 'leafDensity':
      return 38;
    case 'envelopeScale':
      return 1.0;
    case 'envelopeClipProbability':
      return 0.72;
    case 'trunkKink':
      return 3;
    case 'scaffoldLimbs':
      return 0;
    case 'trunkForkAngle':
      return 20;
    case 'trunkForkCount':
      return 2;
    case 'trunkForkAsymmetry':
      return 0;
    case 'trunkForkHeightRatio':
      return typeof profile.trunkHeightRatio === 'number' ? Math.min(profile.trunkHeightRatio * 0.9, 0.265) : 0.24;
    case 'trunkForkSideLength':
      return 1;
    case 'trunkForkSideRadius':
      return 1;
    case 'trunkForkMainAngleScale':
      return 1;
    case 'trunkLeanScale':
      return 1;
    case 'crownAsymmetry':
      return 0;
    case 'trunkForkTropism':
      return 2.2;
    case 'limbBreakProbability':
      return 0;
    case 'outwardBias':
      return 0.5;
    case 'twigGnarl':
      return 1;
    case 'kinkScale':
      return 1;
    case 'pliancy':
      return 0;
    default:
      return undefined;
  }
}

/**
 * Zwraca jawną wartość liczbową parametru z profilu (lub rzędu gałęzi `levelIdx`),
 * a gdy pole jest pominięte (`undefined`) — kanoniczną wartość domyślną silnika.
 */
export function resolveNumericParam(
  profile: SpeciesProfile,
  levelIdx: number | null,
  key: string,
  heightM = 10
): number | undefined {
  if (levelIdx !== null) {
    const lvl = profile.levels?.[levelIdx];
    if (!lvl) return undefined;
    const raw = (lvl as unknown as Record<string, unknown>)[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    return defaultBranchLevelParam(lvl, key);
  }
  const raw = (profile as unknown as Record<string, unknown>)[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return defaultSpeciesParam(profile, key, heightM);
}

function ols(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    den += dx * dx;
  }
  if (den < 1e-12) return { a: 0, b: my };
  const a = num / den;
  return { a, b: my - a * mx };
}

function sse(points: readonly { h: number; y: number }[], fn: (h: number) => number): number {
  let err = 0;
  for (const p of points) {
    const d = fn(p.h) - p.y;
    err += d * d;
  }
  return err;
}

/**
 * Dopasowuje krzywą trendu do punktów (h, y):
 * - 2 punkty: prosta liniowa y = a*h + b
 * - >= 3 punkty: najlepsza z {liniowa, logarytmiczna, wykładnicza} wg SSE
 */
export function fitParameterCurve(rawPoints: readonly { h: number; y: number }[]): CurveFitResult {
  const points = [...rawPoints].sort((a, b) => a.h - b.h);
  if (points.length === 0) return { kind: 'const', points, eval: () => 0 };
  const firstY = points[0].y;
  if (points.length === 1 || points.every((p) => Math.abs(p.y - firstY) < 1e-12)) {
    return { kind: 'const', points, eval: () => firstY };
  }

  const hs = points.map((p) => p.h);
  const ys = points.map((p) => p.y);
  const lin = ols(hs, ys);
  const evalLin = (h: number) => lin.a * h + lin.b;

  if (points.length === 2) {
    return { kind: 'linear', points, eval: evalLin };
  }

  let bestKind: CurveFitKind = 'linear';
  let bestEval = evalLin;
  let bestErr = sse(points, evalLin);

  if (hs.every((h) => h > 0)) {
    const logHs = hs.map((h) => Math.log(h));
    const logFit = ols(logHs, ys);
    const evalLog = (h: number) => logFit.a * Math.log(Math.max(1e-3, h)) + logFit.b;
    const logErr = sse(points, evalLog);
    if (logErr < bestErr) {
      bestErr = logErr;
      bestKind = 'log';
      bestEval = evalLog;
    }
  }

  if (ys.every((y) => y > 0)) {
    const logYs = ys.map((y) => Math.log(y));
    const expFit = ols(hs, logYs);
    const c = Math.exp(expFit.b);
    const evalExp = (h: number) => c * Math.exp(expFit.a * h);
    const expErr = sse(points, evalExp);
    if (Number.isFinite(expErr) && expErr < bestErr) {
      bestKind = 'exp';
      bestEval = evalExp;
    }
  }

  return { kind: bestKind, points, eval: bestEval };
}

function nearestIndex(sorted: readonly HeightAnchor[], h: number): number {
  let bestIdx = 0;
  let bestDist = Math.abs(sorted[0].h - h);
  for (let i = 1; i < sorted.length; i++) {
    const d = Math.abs(sorted[i].h - h);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function evalAtNodes(nodes: unknown[], hs: number[], h: number, nearIdx: number, key: string): unknown {
  if (nodes.every((v) => typeof v === 'number')) {
    const pts = (nodes as number[]).map((y, i) => ({ h: hs[i], y }));
    let v = fitParameterCurve(pts).eval(h);
    if (key === 'leafSizeRatio') v = Math.max(0.003, v);
    else if (key === 'trunkHeightRatio') v = Math.min(0.72, Math.max(1e-4, v));
    else if (key === 'crownPeak') v = Math.min(0.95, Math.max(0.05, v));
    else if (key === 'envelopeClipProbability') v = Math.min(1, Math.max(0, v));
    else if (POSITIVE_RATIO_KEYS.has(key)) v = Math.max(1e-4, v);
    else if (key === 'taper' || key === 'trunkTaper') v = Math.max(0, v);
    if (INTEGER_KEYS.has(key)) {
      const minInt = key === 'leafClump' ? 0 : 1;
      return Math.max(minInt, Math.round(v));
    }
    return v;
  }
  if (nodes.every((v) => Array.isArray(v))) {
    const arrays = nodes as unknown[][];
    const maxLen = Math.max(...arrays.map((a) => a.length));
    const out: unknown[] = [];
    for (let i = 0; i < maxLen; i++) {
      if (arrays.every((a) => i < a.length)) {
        out.push(evalAtNodes(arrays.map((a) => a[i]), hs, h, nearIdx, key));
      } else if (i < arrays[nearIdx].length) {
        out.push(structuredClone(arrays[nearIdx][i]));
      }
    }
    return out;
  }
  if (nodes.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v))) {
    const objs = nodes as Record<string, unknown>[];
    const allKeys = new Set<string>();
    for (const o of objs) for (const k of Object.keys(o)) allKeys.add(k);
    const out: Record<string, unknown> = {};
    for (const k of allKeys) {
      if (objs.every((o) => k in o && o[k] !== undefined)) {
        out[k] = evalAtNodes(objs.map((o) => o[k]), hs, h, nearIdx, k);
      } else if (objs.some((o) => typeof o[k] === 'number')) {
        const filled = objs.map((o, idx) =>
          typeof o[k] === 'number'
            ? (o[k] as number)
            : (defaultBranchLevelParam(o as Partial<BranchLevelParams>, k) ??
               defaultSpeciesParam(o as Partial<SpeciesProfile>, k, hs[idx]))
        );
        if (filled.every((v): v is number => typeof v === 'number')) {
          out[k] = evalAtNodes(filled, hs, h, nearIdx, k);
        } else if (k in objs[nearIdx] && objs[nearIdx][k] !== undefined) {
          out[k] = structuredClone(objs[nearIdx][k]);
        }
      } else if (k in objs[nearIdx] && objs[nearIdx][k] !== undefined) {
        out[k] = structuredClone(objs[nearIdx][k]);
      }
    }
    return out;
  }
  return structuredClone(nodes[nearIdx]);
}

/** Profil dla wysokości `h` z węzłów (dowolna kolejność, ≥ 1 węzeł) */
export function profileAtHeight(anchors: readonly HeightAnchor[], h: number): SpeciesProfile {
  const sorted = anchors.filter((a) => typeof a?.h === 'number' && a?.profile).sort((x, y) => x.h - y.h);
  if (sorted.length === 1 || h <= sorted[0].h) return structuredClone(sorted[0].profile);
  const exact = sorted.find((a) => a.h === h);
  if (exact) return structuredClone(exact.profile);
  const hs = sorted.map((a) => a.h);
  const nearIdx = nearestIndex(sorted, h);
  return evalAtNodes(sorted.map((a) => a.profile), hs, h, nearIdx, '') as SpeciesProfile;
}

/** Najniższy węzeł wzorców; poniżej profil się nie zmienia */
const MIN_ANCHOR_M = 6;

/**
 * Skaluje allometrycznie profil jednowysokościowy względem wysokości referencyjnej `refHeightM`
 * (ontogeneza Opcja A dla gatunków bez `heightAnchors`).
 */
export function scaleProfileByHeight(profile: SpeciesProfile, heightM: number, refHeightM = 10): SpeciesProfile {
  const cloned = structuredClone(profile);
  if (Math.abs(heightM - refHeightM) < 1e-3) return cloned;

  const oct = Math.max(-2, Math.min(2, Math.log2(Math.max(1, heightM) / refHeightM)));
  if (cloned.levels[0]) {
    cloned.levels[0].count = Math.max(3, Math.round(cloned.levels[0].count * Math.pow(2, oct * 0.35)));
  }
  if (cloned.levels[1]) {
    cloned.levels[1].count = Math.max(2, Math.round(cloned.levels[1].count * Math.pow(2, oct * 0.25)));
  }
  cloned.leafSizeRatio = Number((profile.leafSizeRatio * Math.pow(2, -oct * 0.45)).toFixed(4));
  if (profile.leafDensity !== undefined) {
    cloned.leafDensity = Math.max(10, Math.round(profile.leafDensity * Math.pow(2, oct * 0.25)));
  }
  cloned.trunkBaseRadiusRatio = Number((profile.trunkBaseRadiusRatio * Math.pow(2, oct * 0.12)).toFixed(5));
  cloned.crownSpreadRatio = Number((profile.crownSpreadRatio * Math.pow(2, oct * 0.08)).toFixed(4));
  cloned.trunkHeightRatio = Number(Math.min(0.7, Math.max(0.05, profile.trunkHeightRatio * Math.pow(2, oct * 0.08))).toFixed(4));
  return cloned;
}

/**
 * Klasa wysokości wariantu w widoku 3D: wysokość zaokrąglona do pół oktawy w zakresie 6–24 m
 * (6, 8,5, 12, 17, 24 m). Proporcje zmieniają się wolno, więc pięć klas wystarcza, a liczba
 * generowanych wariantów rośnie najwyżej pięciokrotnie.
 */
export function heightClassM(h: number): number {
  const steps = Math.round(2 * Math.log2(Math.max(h, MIN_ANCHOR_M) / MIN_ANCHOR_M));
  return Math.round(MIN_ANCHOR_M * 2 ** (steps / 2) * 10) / 10;
}
