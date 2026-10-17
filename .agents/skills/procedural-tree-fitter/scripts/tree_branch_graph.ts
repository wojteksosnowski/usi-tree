#!/usr/bin/env node
/**
 * tree_branch_graph.ts
 *
 * Wspólna reprezentacja drzewa jako GRAFU GAŁĘZI (w rzucie elewacyjnym XY, znormalizowanym do wysokości = 1):
 * - `imageToBranchGraph` — obraz wzorcowy → szkielet → graf pikselowy → gałęzie z rzędami (jednorazowo),
 * - `skeletonToBranchGraph` — `TreeSkeleton` z generatora → ten sam format (bez renderu, bez analizy obrazu),
 * - `describeBranchGraph` / `compareBranchGraphs` — deskryptor i odległość używane w pętli dopasowania.
 *
 * CLI: npx tsx tree_branch_graph.ts <obraz.png> [--out graf.json] [--png podglad.png] [--threshold 210] [--minRadius 1]
 */

import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from 'canvas';
import { zhangSuenThinning, computeDistanceTransform } from './tree_anatomy_extractor';
import type { TreeSkeleton } from '../../../../src/index.js';

/** Gałąź: łamana od nasady (pts[0]) do końcówki; współrzędne: x względem podstawy pnia, y w górę, wysokość drzewa = 1 */
export interface GraphBranch {
  id: number;
  order: number;          // 0 = pień/przewodnik, 1 = konary, 2 = gałęzie…
  parent: number;         // id rodzica (-1 dla pnia)
  attachT: number;        // położenie nasady na rodzicu (0..1 długości rodzica)
  pts: [number, number][];
  r: number[];            // promień w punktach (znormalizowany do wysokości)
  length: number;
}

export interface BranchGraph {
  source: string;
  branches: GraphBranch[];
}

const DEG = 180 / Math.PI;

function polyLength(pts: [number, number][]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** Kierunek łamanej na odcinku [t0, t1] długości (wektor jednostkowy) */
function dirOver(pts: [number, number][], t0: number, t1: number): [number, number] {
  const L = polyLength(pts);
  const at = (t: number): [number, number] => {
    const target = t * L;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc + d >= target && d > 0) {
        const u = (target - acc) / d;
        return [pts[i - 1][0] + u * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + u * (pts[i][1] - pts[i - 1][1])];
      }
      acc += d;
    }
    return pts[pts.length - 1];
  };
  const a = at(t0), b = at(t1);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const n = Math.hypot(dx, dy) || 1;
  return [dx / n, dy / n];
}

/** Indeks punktu na łamanej najbliższego p oraz jego położenie 0..1 wzdłuż długości */
function nearestOnPoly(pts: [number, number][], p: [number, number]): { dist: number; t: number; idx: number } {
  const L = polyLength(pts) || 1;
  let best = { dist: Infinity, t: 0, idx: 0 };
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const d = Math.hypot(pts[i][0] - p[0], pts[i][1] - p[1]);
    if (d < best.dist) best = { dist: d, t: acc / L, idx: i };
  }
  return best;
}

// ───────────────────────────── Obraz → graf ─────────────────────────────

/**
 * mode 'lum' — piksel drzewa = ciemniejszy niż `threshold` (ryciny, rendery na jasnym tle),
 * mode 'bg'  — piksel drzewa = różni się od koloru tła (mediana narożników) o > `tolerance` (zdjęcia: biała kora brzozy na białym tle).
 */
export async function imageToBranchGraph(imagePath: string, opts: { threshold?: number; minRadius?: number; mode?: 'lum' | 'bg'; tolerance?: number } = {}): Promise<BranchGraph> {
  const img = await loadImage(imagePath);
  const W = img.width, H = img.height;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;
  const thr = opts.threshold ?? 210;
  const tol = opts.tolerance ?? 18;
  const bg = [0, 1, 2].map((c) => {
    const vs: number[] = [];
    for (const [x0, y0] of [[0, 0], [W - 8, 0], [0, H - 8], [W - 8, H - 8]]) for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) vs.push(data[(y * W + x) * 4 + c]);
    return vs.sort((a, b) => a - b)[vs.length >> 1];
  });
  const isTree = opts.mode === 'bg'
    ? (r: number, g: number, b: number) => Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2])) > tol
    : (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b < thr;

  const bin = new Uint8Array(W * H);
  let minY = H, maxY = 0;
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    if (a > 50 && isTree(r, g, b)) {
      bin[i] = 1;
      const y = (i / W) | 0;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const treeH = Math.max(1, maxY - minY + 1);
  const dist = computeDistanceTransform(bin, W, H);
  const skel = zhangSuenThinning(bin, W, H);
  const minR = opts.minRadius ?? 0;
  if (minR > 0) for (let i = 0; i < W * H; i++) if (skel[i] && dist[i] < minR) skel[i] = 0;

  const nbrs = (i: number): number[] => {
    const x = i % W, y = (i / W) | 0, out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H && skel[ny * W + nx]) out.push(ny * W + nx);
    }
    return out;
  };

  // Węzły: końcówki (1 sąsiad) i skrzyżowania (≥ 3); sąsiadujące piksele skrzyżowań scalane w jeden węzeł
  const nodeOf = new Int32Array(W * H).fill(-1);
  const nodePix: number[][] = [];
  for (let i = 0; i < W * H; i++) {
    if (!skel[i] || nodeOf[i] !== -1) continue;
    const deg = nbrs(i).length;
    if (deg === 2) continue;
    const id = nodePix.length;
    const pix: number[] = [];
    const stack = [i];
    nodeOf[i] = id;
    while (stack.length) {
      const p = stack.pop()!;
      pix.push(p);
      if (nbrs(p).length < 3) continue;
      for (const q of nbrs(p)) if (nodeOf[q] === -1 && nbrs(q).length >= 3) { nodeOf[q] = id; stack.push(q); }
    }
    nodePix.push(pix);
  }

  // Krawędzie: łańcuchy pikseli między węzłami
  interface Edge { a: number; b: number; pix: number[] }
  const edges: Edge[] = [];
  const used = new Uint8Array(W * H);
  for (let n = 0; n < nodePix.length; n++) {
    for (const p of nodePix[n]) {
      for (const q0 of nbrs(p)) {
        if (nodeOf[q0] === n || used[q0]) continue;
        const chain = [p];
        let prev = p, cur = q0;
        while (nodeOf[cur] === -1) {
          used[cur] = 1;
          chain.push(cur);
          const nx = nbrs(cur).find((q) => q !== prev && !used[q] && (nodeOf[q] === -1 || nodeOf[q] !== nodeOf[p] || chain.length > 2));
          if (nx === undefined) break;
          prev = cur; cur = nx;
        }
        if (nodeOf[cur] !== -1) chain.push(cur);
        const b = nodeOf[cur] !== -1 ? nodeOf[cur] : -1;
        if (b === -1 || chain.length < 2) continue;
        if (b === n && chain.length < 4) continue;
        edges.push({ a: n, b, pix: chain });
      }
    }
  }

  // Usuwanie ostróg: krótkie krawędzie zakończone liściem (szum szkieletyzacji, liście)
  const degree = () => {
    const d = new Array(nodePix.length).fill(0);
    for (const e of edges) { d[e.a]++; d[e.b]++; }
    return d;
  };
  for (let pass = 0; pass < 3; pass++) {
    const d = degree();
    for (let k = edges.length - 1; k >= 0; k--) {
      const e = edges[k];
      const leafEnd = d[e.a] === 1 ? e.a : d[e.b] === 1 ? e.b : -1;
      if (leafEnd === -1 || (d[e.a] === 1 && d[e.b] === 1)) continue;
      const hub = leafEnd === e.a ? e.b : e.a;
      const rHub = Math.max(...nodePix[hub].map((p) => dist[p]));
      if (e.pix.length < Math.max(4, 2.0 * rHub, 0.015 * treeH)) edges.splice(k, 1);
    }
  }

  // Korzeń: najniższy węzeł grafu
  const d = degree();
  let root = -1, rootY = -1;
  for (let n = 0; n < nodePix.length; n++) {
    if (!d[n]) continue;
    const y = Math.max(...nodePix[n].map((p) => (p / W) | 0));
    if (y > rootY) { rootY = y; root = n; }
  }
  if (root === -1) return { source: imagePath, branches: [] };
  const rootX = nodePix[root][0] % W;

  const toPt = (p: number): [number, number] => [((p % W) - rootX) / treeH, (rootY - ((p / W) | 0)) / treeH];
  const adj = new Map<number, Edge[]>();
  for (const e of edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push(e); adj.get(e.b)!.push(e);
  }

  // Drzewo rozpinające BFS od korzenia (cykle z zarośniętych pikseli rozcinane), waga poddrzewa = długość szkieletu powyżej
  const orient = (e: Edge, from: number): number[] => (e.a === from ? e.pix : [...e.pix].reverse());
  const parentEdge = new Map<number, Edge | null>([[root, null]]);
  const children = new Map<number, { edge: Edge; to: number }[]>();
  const bfs = [root];
  for (let qi = 0; qi < bfs.length; qi++) {
    const n = bfs[qi];
    for (const e of adj.get(n) ?? []) {
      const to = e.a === n ? e.b : e.a;
      if (parentEdge.has(to)) continue;
      parentEdge.set(to, e);
      if (!children.has(n)) children.set(n, []);
      children.get(n)!.push({ edge: e, to });
      bfs.push(to);
    }
  }
  const weight = new Map<number, number>();
  for (let qi = bfs.length - 1; qi >= 0; qi--) {
    const n = bfs[qi];
    let w = 0;
    for (const c of children.get(n) ?? []) w += c.edge.pix.length + (weight.get(c.to) ?? 0);
    weight.set(n, w);
  }

  // Składanie krawędzi w gałęzie: kontynuacja = dziecko o największym poddrzewie (reguła rur), o ile nie zawraca
  const branches: GraphBranch[] = [];
  const grow = (startNode: number, first: { edge: Edge; to: number }, order: number, parent: number, attachT: number) => {
    const pix: number[] = [];
    const side: { node: number; c: { edge: Edge; to: number } }[] = [];
    let node = startNode, cur: { edge: Edge; to: number } | null = first;
    while (cur) {
      const seq = orient(cur.edge, node);
      pix.push(...(pix.length ? seq.slice(1) : seq));
      node = cur.to;
      const cs = children.get(node) ?? [];
      if (!cs.length) break;
      const din = dirOver(pix.slice(-Math.max(3, Math.min(20, pix.length >> 1))).map(toPt), 0, 1);
      let best: typeof cur | null = null, bestScore = -Infinity;
      for (const c of cs) {
        const dc = dirOver(orient(c.edge, node).slice(0, 20).map(toPt), 0, 1);
        const align = din[0] * dc[0] + din[1] * dc[1];
        if (align < -0.2) continue;
        const score = Math.log(1 + c.edge.pix.length + (weight.get(c.to) ?? 0)) + 0.8 * align;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      for (const c of cs) if (c !== best) side.push({ node, c });
      cur = best;
    }
    const pts = pix.map(toPt);
    const id = branches.length;
    branches.push({ id, order, parent, attachT, pts, r: pix.map((p) => dist[p] / treeH), length: polyLength(pts) });
    for (const s of side) grow(s.node, s.c, order + 1, id, nearestOnPoly(pts, toPt(nodePix[s.node][0])).t);
  };
  const rootKids = children.get(root) ?? [];
  if (rootKids.length) {
    const trunk = rootKids.reduce((a, b) => ((weight.get(a.to) ?? 0) + a.edge.pix.length >= (weight.get(b.to) ?? 0) + b.edge.pix.length ? a : b));
    grow(root, trunk, 0, -1, 0);
  }
  return { source: imagePath, branches: branches.map(resampleBranch) };
}

const RESAMPLE_STEP = 0.01; // krok łamanej (ułamek wysokości) — usuwa schodki pikseli i ujednolica obie strony porównania

function resampleBranch(b: GraphBranch): GraphBranch {
  if (b.length <= RESAMPLE_STEP || b.pts.length < 3) return b;
  const n = Math.max(2, Math.round(b.length / RESAMPLE_STEP) + 1);
  const pts: [number, number][] = [], r: number[] = [];
  // wygładzenie średnią ruchomą przed próbkowaniem (szkielet pikselowy)
  const k = 4;
  const sm = b.pts.map((_, i) => {
    let sx = 0, sy = 0, c = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(b.pts.length - 1, i + k); j++) { sx += b.pts[j][0]; sy += b.pts[j][1]; c++; }
    return [sx / c, sy / c] as [number, number];
  });
  sm[0] = b.pts[0]; sm[sm.length - 1] = b.pts[b.pts.length - 1];
  const cum = [0];
  for (let i = 1; i < sm.length; i++) cum.push(cum[i - 1] + Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]));
  const L = cum[cum.length - 1];
  let j = 1;
  for (let s = 0; s < n; s++) {
    const target = (s / (n - 1)) * L;
    while (j < cum.length - 1 && cum[j] < target) j++;
    const u = (target - cum[j - 1]) / Math.max(1e-12, cum[j] - cum[j - 1]);
    pts.push([sm[j - 1][0] + u * (sm[j][0] - sm[j - 1][0]), sm[j - 1][1] + u * (sm[j][1] - sm[j - 1][1])]);
    r.push(b.r[j - 1] + u * (b.r[j] - b.r[j - 1]));
  }
  return { ...b, pts, r, length: polyLength(pts) };
}

// ───────────────────────────── Szkielet generatora → graf ─────────────────────────────

/** Rzut elewacyjny (x, y) szkieletu generatora; rodzic = najbliższy pęd rzędu niższego w punkcie nasady */
export function skeletonToBranchGraph(skel: TreeSkeleton, source = 'generator'): BranchGraph {
  let maxY = 0;
  for (const s of skel.stems) for (const y of s.py) if (y > maxY) maxY = y;
  const H = maxY || 1;
  const x0 = skel.stems[0]?.px[0] ?? 0, y0 = skel.stems[0]?.py[0] ?? 0;
  const branches: GraphBranch[] = skel.stems.map((s, id) => {
    const pts = s.px.map((x, i) => [(x - x0) / H, (s.py[i] - y0) / H] as [number, number]);
    return { id, order: s.level, parent: -1, attachT: 0, pts, r: s.r.map((r) => r / H), length: polyLength(pts) };
  });
  for (const b of branches) {
    if (b.order === 0) continue;
    let best = { id: -1, dist: Infinity, t: 0 };
    for (const p of branches) {
      if (p.order !== b.order - 1) continue;
      const n = nearestOnPoly(p.pts, b.pts[0]);
      if (n.dist < best.dist) best = { id: p.id, dist: n.dist, t: n.t };
    }
    b.parent = best.id; b.attachT = best.t;
  }
  return { source, branches: branches.map(resampleBranch) };
}

// ───────────────────────────── Deskryptor i odległość ─────────────────────────────

export interface LevelStats {
  count: number;          // liczba gałęzi rzędu (po filtrze długości)
  perParent: number;      // średnio na rodzica
  angle: number;          // kąt odejścia od rodzica (°) w rzucie
  angleStd: number;
  angleSlope: number;     // kąt u nasady rodzica − kąt przy końcu rodzica (° — dodatnie: dolne rozłożyste)
  lengthRatio: number;    // długość / długość rodzica
  bend: number;           // zmiana elewacji kierunku nasada→koniec (°, + ku górze, − zwis)
  wiggle: number;         // falowanie: średni |zwrot| między cięciwami ~8% wysokości (°)
  droop: number;          // ułamek końcówek skierowanych poniżej poziomu
  attachMean: number;     // średnie położenie nasady na rodzicu (0..1)
  radiusRatio: number;    // r nasady / r rodzica w punkcie nasady
}

export interface GraphDescriptor {
  spread: number;         // szerokość / wysokość
  crownBase: number;      // wysokość najniższego konara / wysokość
  trunkLength: number;    // długość przewodnika / wysokość
  trunkLean: number;      // odchylenie końca przewodnika od pionu (°)
  widthProfile: number[]; // W(y) w 10 pasach wysokości (szerokość / wysokość)
  levels: LevelStats[];   // rzędy 1..2
}

const MIN_LEN = 0.03;     // gałęzie krótsze niż 3% wysokości pomijane po obu stronach (szum obrazu / witki)
const MAX_ORDER = 2;

export function describeBranchGraph(g: BranchGraph): GraphDescriptor {
  const all = g.branches;
  const byId = new Map(all.map((b) => [b.id, b]));
  const kept = all.filter((b) => b.order === 0 || (b.order <= MAX_ORDER && b.length >= MIN_LEN));
  let minX = 0, maxX = 0, maxY = 0;
  const widthLo = new Array(10).fill(0), widthHi = new Array(10).fill(0);
  for (const b of all) for (const [x, y] of b.pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  const Hn = maxY || 1;
  for (const b of all) for (const [x, y] of b.pts) {
    const k = Math.min(9, Math.max(0, Math.floor((y / Hn) * 10)));
    if (x < widthLo[k]) widthLo[k] = x; if (x > widthHi[k]) widthHi[k] = x;
  }
  const trunk = all.find((b) => b.order === 0);
  const l1 = kept.filter((b) => b.order === 1);
  const crownBase = l1.length ? Math.min(...l1.map((b) => b.pts[0][1])) / Hn : 1;
  let trunkLean = 0;
  if (trunk && trunk.pts.length > 1) {
    const dTop = dirOver(trunk.pts, 0.5, 1);
    trunkLean = Math.acos(Math.max(-1, Math.min(1, dTop[1]))) * DEG;
  }

  const levels: LevelStats[] = [];
  for (let order = 1; order <= MAX_ORDER; order++) {
    const bs = kept.filter((b) => b.order === order && byId.has(b.parent));
    const parents = new Set(bs.map((b) => b.parent));
    const angles: number[] = [], lowA: number[] = [], highA: number[] = [];
    let lr = 0, bend = 0, wig = 0, droop = 0, att = 0, rr = 0;
    for (const b of bs) {
      const p = byId.get(b.parent)!;
      const dp = dirOver(p.pts, Math.max(0, b.attachT - 0.08), Math.min(1, b.attachT + 0.08));
      const d0 = dirOver(b.pts, 0, 0.2);
      const a = Math.acos(Math.max(-1, Math.min(1, dp[0] * d0[0] + dp[1] * d0[1]))) * DEG;
      angles.push(a);
      (b.attachT < 0.5 ? lowA : highA).push(a);
      lr += b.length / Math.max(1e-6, p.length);
      const d1 = dirOver(b.pts, 0.8, 1);
      bend += (Math.asin(Math.max(-1, Math.min(1, d1[1]))) - Math.asin(Math.max(-1, Math.min(1, d0[1])))) * DEG;
      // falowanie: średni |zwrot| między cięciwami co ~8% wysokości (niezależne od gęstości punktów)
      const k = Math.max(3, Math.round(b.length / 0.08));
      let turns = 0;
      for (let i = 1; i < k; i++) {
        const u = dirOver(b.pts, (i - 1) / k, i / k), v = dirOver(b.pts, i / k, (i + 1) / k);
        turns += Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]));
      }
      wig += (turns / (k - 1)) * DEG;
      if (d1[1] < 0) droop++;
      att += b.attachT;
      const pr = p.r[nearestOnPoly(p.pts, b.pts[0]).idx] || 1e-6;
      rr += (b.r[0] ?? 0) / pr;
    }
    const n = Math.max(1, bs.length);
    const mean = angles.reduce((s, x) => s + x, 0) / n;
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : mean);
    levels.push({
      count: bs.length,
      perParent: bs.length / Math.max(1, parents.size),
      angle: mean,
      angleStd: Math.sqrt(angles.reduce((s, x) => s + (x - mean) ** 2, 0) / n),
      angleSlope: avg(lowA) - avg(highA),
      lengthRatio: lr / n,
      bend: bend / n,
      wiggle: wig / n,
      droop: droop / n,
      attachMean: att / n,
      radiusRatio: rr / n,
    });
  }

  return {
    spread: (maxX - minX) / Hn,
    crownBase,
    trunkLength: trunk ? trunk.length / Hn : 0,
    trunkLean,
    widthProfile: widthLo.map((lo, k) => (widthHi[k] - lo) / Hn),
    levels,
  };
}

/** Składniki odległości (każdy unormowany tak, by ~1 = wyraźnie inne drzewo) */
export function compareBranchGraphs(ref: GraphDescriptor, cand: GraphDescriptor, wiggleWeight = 0.25): { total: number; terms: Record<string, number> } {
  const t: Record<string, number> = {};
  t.spread = Math.abs(cand.spread - ref.spread) / Math.max(0.1, ref.spread);
  t.crownBase = Math.abs(cand.crownBase - ref.crownBase) / 0.1;
  t.trunkLength = Math.abs(cand.trunkLength - ref.trunkLength) / 0.3;
  t.trunkLean = Math.abs(cand.trunkLean - ref.trunkLean) / 20;
  t.widthProfile = ref.widthProfile.reduce((s, w, k) => s + Math.abs(w - cand.widthProfile[k]), 0) / (10 * Math.max(0.1, ref.spread)) * 3;
  ref.levels.forEach((r, i) => {
    const c = cand.levels[i];
    if (!c || r.count === 0) return;
    const w = i === 0 ? 1 : 0.5; // konary ważniejsze od gałęzi
    const L = `L${i + 1}`;
    t[`${L}.perParent`] = w * Math.abs(Math.log((c.perParent + 0.5) / (r.perParent + 0.5)));
    t[`${L}.angle`] = (w * Math.abs(c.angle - r.angle)) / 15;
    t[`${L}.angleStd`] = (w * Math.abs(c.angleStd - r.angleStd)) / 20;
    t[`${L}.angleSlope`] = (w * Math.abs(c.angleSlope - r.angleSlope)) / 20;
    t[`${L}.lengthRatio`] = (w * Math.abs(Math.log((c.lengthRatio + 0.05) / (r.lengthRatio + 0.05))));
    t[`${L}.bend`] = (w * Math.abs(c.bend - r.bend)) / 20;
    // falowanie z obrazu z liśćmi jest zawyżone (kępki zaginają szkielet) — niska waga; pełna tylko dla wzorców bez liści
    t[`${L}.wiggle`] = (w * wiggleWeight * Math.abs(c.wiggle - r.wiggle)) / 8;
    t[`${L}.droop`] = (w * Math.abs(c.droop - r.droop)) / 0.25;
    t[`${L}.attachMean`] = (w * Math.abs(c.attachMean - r.attachMean)) / 0.2;
  });
  const total = Object.values(t).reduce((s, x) => s + x, 0);
  return { total, terms: t };
}

/** Podgląd SVG grafów (wzorzec szary, kandydat kolorami rzędów) — jedyny „obraz” w pętli, do końcowej kontroli */
export function branchGraphsToSvg(graphs: { g: BranchGraph; color?: string }[], size = 800): string {
  const pal = ['#5b4636', '#c2410c', '#2563eb', '#16a34a', '#9333ea'];
  const s = size * 0.9, ox = size / 2, oy = size * 0.95;
  const lines: string[] = [];
  for (const { g, color } of graphs) {
    for (const b of g.branches) {
      const d = b.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(ox + x * s).toFixed(1)},${(oy - y * s).toFixed(1)}`).join('');
      const w = Math.max(0.5, (b.r[0] ?? 0.002) * s * 1.5);
      lines.push(`<path d="${d}" fill="none" stroke="${color ?? pal[Math.min(b.order, pal.length - 1)]}" stroke-width="${w.toFixed(2)}" stroke-linecap="round" opacity="${color ? 0.45 : 0.9}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/>${lines.join('')}</svg>`;
}

/** PNG z grafów (rasteryzacja SVG) */
export async function writeBranchGraphsPng(file: string, graphs: { g: BranchGraph; color?: string }[], size = 800): Promise<void> {
  const img = await loadImage(Buffer.from(branchGraphsToSvg(graphs, size)));
  const c = createCanvas(size, size);
  c.getContext('2d').drawImage(img, 0, 0);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, c.toBuffer('image/png'));
}

// ───────────────────────────── CLI ─────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('tree_branch_graph.ts')) {
  const args = process.argv.slice(2);
  const get = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };
  if (!args[0] || args.includes('--help')) {
    console.log('Użycie: npx tsx tree_branch_graph.ts <obraz.png> [--out graf.json] [--png podglad.png] [--mode lum|bg] [--threshold 210] [--tolerance 18] [--minRadius 1]');
    process.exit(0);
  }
  imageToBranchGraph(args[0], { threshold: Number(get('--threshold') ?? 210), minRadius: Number(get('--minRadius') ?? 0), mode: get('--mode') === 'bg' ? 'bg' : 'lum', tolerance: Number(get('--tolerance') ?? 18) }).then(async (g) => {
    const out = get('--out') ?? `tmp/tree-renders/graph_${path.parse(args[0]).name}.json`;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(g));
    const png = get('--png');
    if (png) await writeBranchGraphsPng(png, [{ g }]);
    const byOrder: Record<number, number> = {};
    for (const b of g.branches) byOrder[b.order] = (byOrder[b.order] ?? 0) + 1;
    console.log(`Graf: ${g.branches.length} gałęzi, rzędy ${JSON.stringify(byOrder)} → ${out}`);
    console.log(JSON.stringify(describeBranchGraph(g), null, 2));
  });
}
