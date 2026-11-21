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
import { defaultBranchParam, defaultSpeciesParam, paramRange } from './paramSpec.js';
import type { BranchLevelParams, SpeciesProfile } from './types.js';

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
    return defaultBranchParam(lvl, key);
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

/**
 * Krzywa trendu z krawędziami: poniżej najniższego węzła liniowa kontynuacja stycznej w h0
 * y(h0) − y'(h0)·(h0 − h) (ciągła wartość i nachylenie, zakres i tak przycina paramSpec),
 * powyżej najwyższego kontynuacja logarytmiczna y(hN) + y'(hN)·hN·ln(h/hN) — ciągła wartość i nachylenie,
 * wolniejszy wzrost niż liniowy/wykładniczy (brak wybuchów i zmian znaku przy dużych wysokościach).
 */
function evalBraked(f: (h: number) => number, h0: number, hN: number, h: number): number {
  const eps = Math.max(1e-3, hN * 1e-4);
  if (h < h0) {
    const slope0 = (f(h0 + eps) - f(h0)) / eps;
    return f(h0) - slope0 * (h0 - h);
  }
  if (h <= hN) return f(h);
  const slope = (f(hN) - f(hN - eps)) / eps;
  return f(hN) + slope * hN * Math.log(h / hN);
}

function evalAtNodes(nodes: unknown[], hs: number[], h: number, nearIdx: number, key: string): unknown {
  if (nodes.every((v) => typeof v === 'number')) {
    const pts = (nodes as number[]).map((y, i) => ({ h: hs[i], y }));
    const { min, max, integer } = paramRange(key);
    let v = Math.min(max, Math.max(min, evalBraked(fitParameterCurve(pts).eval, hs[0], hs[hs.length - 1], h)));
    if (integer) v = Math.max(Math.max(0, min), Math.round(v));
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
            : (defaultBranchParam(o as Partial<BranchLevelParams>, k) ??
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
  if (sorted.length === 1) return structuredClone(sorted[0].profile);
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
