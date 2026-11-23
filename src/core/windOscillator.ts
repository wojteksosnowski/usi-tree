/**
 * Wiatr jako oscylator na każdy pęd (wspornik: ω ∝ r/L²) z hierarchicznym składaniem deformacji.
 * Czyste funkcje bez zależności i bez stanu statycznego (re-entrancy: tylko `rig.work` jest własnością rigu).
 *
 * Model (etap 1, referencja CPU / wyrocznia dla przyszłego vertex shadera):
 *  - `prepareWindRig` liczy raz na drzewo: punkt zaczepienia, ω, A, φ, oś gięcia, kolejność rodzic → dziecko;
 *  - `evaluateWindRig(rig, t)` daje na pęd 8 liczb: kwaternion bazy (4), przesunięcie bazy (3), kąt gięcia β;
 *  - pęd gnie się przez obrót stycznej o β·s (s = ułamek długości łukowej), więc linia środkowa jest
 *    jak belka utwierdzona (przemieszczenie ~ s²) i długości segmentów są zachowane co do błędu zaokrąglenia;
 *  - dziecko dziedziczy obrót rodzica w punkcie zaczepienia (kwaternion skumulowany) i jego przesunięcie.
 * Domyślna ścieżka (`TreeGenerator.applyWindToSkeleton`) pozostaje bez zmian.
 */
import type { Stem, TreeSkeleton, WindRig } from './types.js';

/** Liczb na pęd w tablicy transformacji: qx qy qz qw tx ty tz beta */
export const WIND_TRANSFORM_STRIDE = 8;

const TRUNK_HZ = 0.45;
const TWIG_HZ_MAX = 4.0;
const FREQ_SPREAD = 25;

export interface WindRigOptions {
  strength: number;
  dirX?: number;
  dirZ?: number;
}

type WindParents = NonNullable<TreeSkeleton['windParents']>;

/** Punkt zaczepienia pędów na rodzicach (ta sama logika co `applyWindToSkeleton`, wspólna pamięć podręczna szkieletu). */
export function computeWindParents(skeleton: TreeSkeleton): WindParents {
  if (skeleton.windParents) return skeleton.windParents;
  const stems = skeleton.stems;
  const parentRef: WindParents = new Array(stems.length).fill(null);
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
  return parentRef;
}

/** Obliczenia jednorazowe na drzewo. */
export function prepareWindRig(skeleton: TreeSkeleton, wind: WindRigOptions): WindRig {
  const stems = skeleton.stems;
  const n = stems.length;
  const scale = skeleton.scale;
  const strength = Math.max(0, wind.strength);
  const dl = Math.hypot(wind.dirX ?? 1, wind.dirZ ?? 0) || 1;
  const wx = (wind.dirX ?? 1) / dl;
  const wz = (wind.dirZ ?? 0) / dl;
  const parents = computeWindParents(skeleton);
  const pliancyScale = 1.0 + Math.min(45, Math.max(0, skeleton.profile.pliancy ?? 15)) / 20;

  const ptStart = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) ptStart[i + 1] = ptStart[i] + stems[i].px.length;
  const total = ptStart[n];
  const pts = new Float64Array(total * 3);
  const arc = new Float64Array(total);
  const parent = new Int32Array(n).fill(-1);
  const attachSeg = new Int32Array(n);
  const attachU = new Float64Array(n);
  const level = new Int32Array(n);
  const length = new Float64Array(n);
  const radius = new Float64Array(n);
  const freqHz = new Float64Array(n);
  const omega = new Float64Array(n);
  const amp = new Float64Array(n);
  const phase = new Float64Array(n);
  const axis = new Float64Array(n * 3);
  const order = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    const s: Stem = stems[i];
    const o = ptStart[i];
    const m = s.px.length;
    level[i] = s.level;
    let len = 0;
    for (let k = 0; k < m; k++) {
      pts[(o + k) * 3] = s.px[k] * scale;
      pts[(o + k) * 3 + 1] = s.py[k] * scale;
      pts[(o + k) * 3 + 2] = s.pz[k] * scale;
      if (k > 0) {
        len += Math.hypot(s.px[k] - s.px[k - 1], s.py[k] - s.py[k - 1], s.pz[k] - s.pz[k - 1]) * scale;
      }
      arc[o + k] = len;
    }
    length[i] = Math.max(1e-6, len);
    for (let k = 0; k < m; k++) arc[o + k] = len > 1e-12 ? arc[o + k] / len : 0;
    radius[i] = Math.max(1e-5, (s.r[0] ?? 0.001) * scale);
    const pr = parents[i];
    if (pr && pr.pIdx < i) {
      parent[i] = pr.pIdx;
      attachSeg[i] = pr.seg;
      attachU[i] = pr.u;
    }
    phase[i] = ((((i * 0.618034 + (skeleton.seed % 997) * 0.00123) % 1) + 1) % 1) * Math.PI * 2;
    // oś gięcia: stemDir × windDir (dodatni kąt odchyla pęd z wiatrem)
    let dx = 0, dy = 0, dz = 0;
    if (m > 1) {
      dx = pts[(o + m - 1) * 3] - pts[o * 3];
      dy = pts[(o + m - 1) * 3 + 1] - pts[o * 3 + 1];
      dz = pts[(o + m - 1) * 3 + 2] - pts[o * 3 + 2];
    }
    // d × w, gdzie w = (wx, 0, wz)
    let ax = dy * wz;
    let ay = dz * wx - dx * wz;
    let az = -dy * wx;
    let al = Math.hypot(ax, ay, az);
    if (al < 1e-9) { ax = -wz; ay = 0; az = wx; al = 1; }
    axis[i * 3] = ax / al;
    axis[i * 3 + 1] = ay / al;
    axis[i * 3 + 2] = az / al;
    order[i] = i; // pIdx < i zawsze, więc kolejność indeksów jest topologiczna
  }

  // Wspornik: ω ∝ r/L², k ∝ r⁴/L³ względem pędu odniesienia (pierwszy pień)
  let ref = 0;
  for (let i = 0; i < n; i++) if (level[i] === 0) { ref = i; break; }
  const wRef = n ? radius[ref] / (length[ref] * length[ref]) : 1;
  const kRef = n ? Math.pow(radius[ref], 4) / Math.pow(length[ref], 3) : 1;
  for (let i = 0; i < n; i++) {
    const ratio = radius[i] / (length[i] * length[i]) / wRef;
    const x = Math.max(ratio, 1);
    let f = TRUNK_HZ + (TWIG_HZ_MAX - TRUNK_HZ) * Math.tanh((x - 1) / FREQ_SPREAD);
    if (i !== ref) f += 1e-3;
    freqHz[i] = f;
    omega[i] = f * Math.PI * 2;
    const kRel = Math.pow(radius[i], 4) / Math.pow(length[i], 3) / kRef;
    const maxAngle = Math.min(0.6, 0.12 + 0.12 * level[i]);
    amp[i] = strength > 0 ? Math.min(maxAngle, (strength * pliancyScale * 0.06) / Math.sqrt(Math.max(1e-6, kRel))) : 0;
  }

  return {
    stemCount: n, scale, height: skeleton.height, strength, windX: wx, windZ: wz,
    order, parent, attachSeg, attachU, level, ptStart, pts, arc, length, radius,
    freqHz, omega, amp, phase, axis, work: new Float64Array(total * 3),
  };
}

// --- kwaterniony (bez alokacji; wynik do tablicy wyjściowej) ---

/** v' = q v (q jednostkowy) */
function rot(qx: number, qy: number, qz: number, qw: number, x: number, y: number, z: number, o: Float64Array) {
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  o[0] = x + qw * tx + (qy * tz - qz * ty);
  o[1] = y + qw * ty + (qz * tx - qx * tz);
  o[2] = z + qw * tz + (qx * ty - qy * tx);
}

function qmul(ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number, o: Float64Array) {
  o[0] = aw * bx + ax * bw + ay * bz - az * by;
  o[1] = aw * by - ax * bz + ay * bw + az * bx;
  o[2] = aw * bz + ax * by - ay * bx + az * bw;
  o[3] = aw * bw - ax * bx - ay * by - az * bz;
}

function qAxis(ax: number, ay: number, az: number, ang: number, o: Float64Array) {
  const h = ang * 0.5, sn = Math.sin(h);
  o[0] = ax * sn; o[1] = ay * sn; o[2] = az * sn; o[3] = Math.cos(h);
}

/** Skumulowany kwaternion pędu i w punkcie s (obrót bazy ∘ obrót gięcia β·s) */
function cumulativeQ(rig: WindRig, tr: ArrayLike<number>, i: number, s: number, o: Float64Array, tmp: Float64Array) {
  const b = i * WIND_TRANSFORM_STRIDE;
  let qx = tr[b], qy = tr[b + 1], qz = tr[b + 2], qw = tr[b + 3];
  const l = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= l; qy /= l; qz /= l; qw /= l;
  qAxis(rig.axis[i * 3], rig.axis[i * 3 + 1], rig.axis[i * 3 + 2], tr[b + 7] * s, tmp);
  qmul(qx, qy, qz, qw, tmp[0], tmp[1], tmp[2], tmp[3], o);
}

/** Linia środkowa pędu i po deformacji → `rig.work` */
function buildCenterline(rig: WindRig, tr: ArrayLike<number>, i: number, tmp: Float64Array, tmp2: Float64Array) {
  const b = i * WIND_TRANSFORM_STRIDE;
  let qx = tr[b], qy = tr[b + 1], qz = tr[b + 2], qw = tr[b + 3];
  const l = Math.hypot(qx, qy, qz, qw) || 1;
  qx /= l; qy /= l; qz /= l; qw /= l;
  const beta = tr[b + 7];
  const ax = rig.axis[i * 3], ay = rig.axis[i * 3 + 1], az = rig.axis[i * 3 + 2];
  const o = rig.ptStart[i], m = rig.ptStart[i + 1] - o;
  const P = rig.pts, W = rig.work;
  W[o * 3] = P[o * 3] + tr[b + 4];
  W[o * 3 + 1] = P[o * 3 + 1] + tr[b + 5];
  W[o * 3 + 2] = P[o * 3 + 2] + tr[b + 6];
  for (let j = 0; j < m - 1; j++) {
    const a = (o + j) * 3, c = a + 3;
    const sMid = 0.5 * (rig.arc[o + j] + rig.arc[o + j + 1]);
    qAxis(ax, ay, az, beta * sMid, tmp);
    rot(tmp[0], tmp[1], tmp[2], tmp[3], P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2], tmp2);
    const x = tmp2[0], y = tmp2[1], z = tmp2[2];
    rot(qx, qy, qz, qw, x, y, z, tmp2);
    W[c] = W[a] + tmp2[0];
    W[c + 1] = W[a + 1] + tmp2[1];
    W[c + 2] = W[a + 2] + tmp2[2];
  }
}

function lerpPts(arr: Float64Array, o: number, seg: number, u: number, out: Float64Array) {
  const a = (o + seg) * 3;
  out[0] = arr[a] + (arr[a + 3] - arr[a]) * u;
  out[1] = arr[a + 1] + (arr[a + 4] - arr[a + 1]) * u;
  out[2] = arr[a + 2] + (arr[a + 5] - arr[a + 2]) * u;
}

/**
 * Transformacje pędów w chwili t [s]: stride 8 (qx qy qz qw, tx ty tz, β). Koszt O(pędy + punkty szkieletu).
 * `out` (opcjonalny) pozwala użyć ponownie bufora.
 */
export function evaluateWindRig(rig: WindRig, t: number, out?: Float32Array): Float32Array {
  const n = rig.stemCount;
  const tr = out && out.length >= n * WIND_TRANSFORM_STRIDE ? out : new Float32Array(n * WIND_TRANSFORM_STRIDE);
  const tmp = new Float64Array(4), tmp2 = new Float64Array(4), qc = new Float64Array(4);
  const pa = new Float64Array(3), pr = new Float64Array(3), rv = new Float64Array(3);
  for (let k = 0; k < n; k++) {
    const i = rig.order[k];
    const b = i * WIND_TRANSFORM_STRIDE;
    const beta = rig.amp[i] * (0.55 + 0.45 * Math.sin(rig.omega[i] * t + rig.phase[i]));
    let qx = 0, qy = 0, qz = 0, qw = 1, tx = 0, ty = 0, tz = 0;
    const p = rig.parent[i];
    if (p >= 0) {
      const seg = rig.attachSeg[i], u = rig.attachU[i];
      const po = rig.ptStart[p];
      const sAtt = rig.arc[po + seg] + (rig.arc[po + seg + 1] - rig.arc[po + seg]) * u;
      cumulativeQ(rig, tr, p, sAtt, qc, tmp);
      qx = qc[0]; qy = qc[1]; qz = qc[2]; qw = qc[3];
      lerpPts(rig.work, po, seg, u, pa);   // zaczep po deformacji
      lerpPts(rig.pts, po, seg, u, pr);    // zaczep w spoczynku
      const bx = rig.pts[rig.ptStart[i] * 3], by = rig.pts[rig.ptStart[i] * 3 + 1], bz = rig.pts[rig.ptStart[i] * 3 + 2];
      rot(qx, qy, qz, qw, bx - pr[0], by - pr[1], bz - pr[2], rv);
      tx = pa[0] + rv[0] - bx; ty = pa[1] + rv[1] - by; tz = pa[2] + rv[2] - bz;
    }
    tr[b] = qx; tr[b + 1] = qy; tr[b + 2] = qz; tr[b + 3] = qw;
    tr[b + 4] = tx; tr[b + 5] = ty; tr[b + 6] = tz; tr[b + 7] = beta;
    buildCenterline(rig, tr, i, tmp, tmp2);
  }
  return tr;
}

/**
 * Jednorazowo: ułamek długości łukowej `s` ∈ [0,1] każdego wierzchołka na linii środkowej jego pędu
 * (rzut na polilinię). Wynik wraz z `windStem` zasila `deformVertices` i atrybuty GPU.
 */
export function computeWindStemS(rig: WindRig, positions: ArrayLike<number>, stemIdx: ArrayLike<number>): Float32Array {
  const nv = stemIdx.length;
  const out = new Float32Array(nv);
  const P = rig.pts;
  for (let v = 0; v < nv; v++) {
    const i = stemIdx[v];
    if (!(i >= 0) || i >= rig.stemCount) continue;
    const o = rig.ptStart[i], m = rig.ptStart[i + 1] - o;
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    let best = Infinity, bs = 0;
    for (let j = 0; j < m - 1; j++) {
      const a = (o + j) * 3;
      const dx = P[a + 3] - P[a], dy = P[a + 4] - P[a + 1], dz = P[a + 5] - P[a + 2];
      const dd = dx * dx + dy * dy + dz * dz;
      const u = dd > 1e-18 ? Math.max(0, Math.min(1, ((x - P[a]) * dx + (y - P[a + 1]) * dy + (z - P[a + 2]) * dz) / dd)) : 0;
      const d = (x - P[a] - dx * u) ** 2 + (y - P[a + 1] - dy * u) ** 2 + (z - P[a + 2] - dz * u) ** 2;
      if (d < best) { best = d; bs = rig.arc[o + j] + (rig.arc[o + j + 1] - rig.arc[o + j]) * u; }
    }
    out[v] = bs;
  }
  return out;
}

/**
 * Referencyjny skinning CPU (wyrocznia dla shadera): wierzchołek v pędu i o parametrze s trafia na
 * C'(s) + Qc(s)·(v − C(s)), gdzie C/C' to linia środkowa przed/po deformacji, Qc skumulowany obrót.
 * Wierzchołki z `stemIdx < 0` (listowie) są kopiowane bez zmian. `out` może być `basePositions` tylko, gdy to ten sam bufor nie jest czytany ponownie (zalecany osobny).
 */
export function deformVertices(
  rig: WindRig,
  transforms: ArrayLike<number>,
  basePositions: ArrayLike<number>,
  stemIdx: ArrayLike<number>,
  sAlong: ArrayLike<number>,
  out: Float32Array | Float64Array
): void {
  const n = rig.stemCount;
  const tmp = new Float64Array(4), tmp2 = new Float64Array(4), qc = new Float64Array(4), rv = new Float64Array(3);
  for (let i = 0; i < n; i++) buildCenterline(rig, transforms, i, tmp, tmp2);
  const c0 = new Float64Array(3), c1 = new Float64Array(3);
  const nv = stemIdx.length;
  for (let v = 0; v < nv; v++) {
    const x = basePositions[v * 3], y = basePositions[v * 3 + 1], z = basePositions[v * 3 + 2];
    const i = stemIdx[v];
    if (!(i >= 0) || i >= n) { out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z; continue; }
    const s = Math.min(1, Math.max(0, sAlong[v]));
    const o = rig.ptStart[i], m = rig.ptStart[i + 1] - o;
    // segment zawierający s (wyszukiwanie binarne po arc)
    let lo = 0, hi = m - 2;
    if (hi < 0) { out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z; continue; }
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rig.arc[o + mid] <= s) lo = mid; else hi = mid - 1;
    }
    const da = rig.arc[o + lo + 1] - rig.arc[o + lo];
    const u = da > 1e-12 ? Math.min(1, Math.max(0, (s - rig.arc[o + lo]) / da)) : 0;
    lerpPts(rig.pts, o, lo, u, c0);
    lerpPts(rig.work, o, lo, u, c1);
    cumulativeQ(rig, transforms, i, s, qc, tmp);
    rot(qc[0], qc[1], qc[2], qc[3], x - c0[0], y - c0[1], z - c0[2], rv);
    out[v * 3] = c1[0] + rv[0];
    out[v * 3 + 1] = c1[1] + rv[1];
    out[v * 3 + 2] = c1[2] + rv[2];
  }
}

/** Szkielet po deformacji tymi samymi transformacjami (do testów niezmienników). Punkty w jednostkach szkieletu. */
export function skeletonWithWindRig(skeleton: TreeSkeleton, rig: WindRig, t: number): TreeSkeleton {
  const tr = evaluateWindRig(rig, t);
  const inv = 1 / rig.scale;
  const stems: Stem[] = skeleton.stems.map((s, i) => {
    const o = rig.ptStart[i], m = rig.ptStart[i + 1] - o;
    const px = new Array<number>(m), py = new Array<number>(m), pz = new Array<number>(m);
    for (let k = 0; k < m; k++) {
      px[k] = rig.work[(o + k) * 3] * inv;
      py[k] = rig.work[(o + k) * 3 + 1] * inv;
      pz[k] = rig.work[(o + k) * 3 + 2] * inv;
    }
    return { ...s, px, py, pz, r: [...s.r] };
  });
  void tr;
  return { ...skeleton, stems };
}
