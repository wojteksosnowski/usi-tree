/**
 * Analiza wektorowa przebiegu pnia, konarów i gałęzi: zdjęcie wzorca vs szkielet modelu.
 *
 *   NODE_NO_WARNINGS=1 npx tsx scripts/treeFit/branchVectors.ts <gatunek> [h]
 *
 * Zdjęcie: maska kory (brąz / rudy, bez zieleni igieł i liści) → orientacja lokalna z tensora struktury
 * (gradient maski rozmytej), ważona siłą krawędzi. Model: odcinki szkieletu w rzucie z boku (x, y),
 * ważone długością × promieniem. Wynik: rozkład kąta od pionu (0° = pion, 90° = poziom) w pasach wysokości
 * oraz oś pnia (środek najdłuższego odcinka kory w wierszu) — przechył i załamania.
 */
import { TreeGenerator } from '../../src/index.js';
import { modelProfile } from './renderSpeciesBoard';
import { SPECIES, photoSilhouette, speciesPhotos } from './speciesRefs';

const BINS = [0, 15, 30, 45, 60, 75, 90];
const BANDS = 3; // pasy wysokości korony: dół / środek / góra

function isBark(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 40 || max - min < 18) return max < 70 && max > 20; // ciemna, szara kora
  // odcień rudy / brązowy: czerwony dominuje nad zielonym
  return r > g + 6 && r > b + 18;
}

type Hist = number[][]; // [pas][kosz]

const emptyHist = (): Hist => Array.from({ length: BANDS }, () => new Array(BINS.length - 1).fill(0));
function addAngle(h: Hist, band: number, deg: number, w: number) {
  for (let i = 0; i < BINS.length - 1; i++) if (deg >= BINS[i] && deg <= BINS[i + 1]) { h[Math.min(BANDS - 1, Math.max(0, band))][i] += w; return; }
}
function norm(h: Hist): Hist {
  return h.map((row) => { const s = row.reduce((a, b) => a + b, 0) || 1; return row.map((v) => v / s); });
}
const meanAngle = (row: number[]) => row.reduce((a, v, i) => a + v * (BINS[i] + BINS[i + 1]) / 2, 0);

async function photoVectors(p: string) {
  const { mask, data: d, W, H, crop } = await photoSilhouette(p);
  const [cx, cy, cw, ch] = crop;
  const m = new Float32Array(W * H);
  for (let y = cy; y < cy + ch; y++) for (let x = cx; x < cx + cw; x++) {
    const i = (y * W + x) * 4;
    if (mask[y * W + x] && isBark(d[i], d[i + 1], d[i + 2])) m[y * W + x] = 1;
  }
  return analyse(m, W, H, crop);
}

/** Rozmycie pudełkowe 3 próbek wzdłuż osi (`step` = 1 poziomo, W pionowo) w obrysie z marginesem */
function box3(a: Float32Array, W: number, x0: number, y0: number, x1: number, y1: number, step: number): Float32Array {
  const o = new Float32Array(a.length);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const k = y * W + x;
    o[k] = (a[k - step] + a[k] + a[k + step]) / 3;
  }
  return o;
}

/** Tablica sum prefiksowych (W+1)×(H+1) — suma prostokąta w O(1) */
function integral(v: Float32Array, W: number, H: number): Float64Array {
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += v[y * W + x];
      S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row;
    }
  }
  return S;
}
const rectSum = (S: Float64Array, W: number, x0: number, y0: number, x1: number, y1: number) =>
  S[(y1 + 1) * (W + 1) + x1 + 1] - S[y0 * (W + 1) + x1 + 1] - S[(y1 + 1) * (W + 1) + x0] + S[y0 * (W + 1) + x0];

/** Tensor struktury na masce kory → kąty od pionu w pasach; oś pnia z wierszy */
function analyse(m: Float32Array, W: number, H: number, crop: [number, number, number, number]) {
  const [cx, cy, cw, ch] = crop;
  // rozmycie 3×3 dwukrotnie (rozdzielnie x, y) — tylko obrys z marginesem na okno tensora
  const M = 8;
  const x0 = Math.max(1, cx - M), y0 = Math.max(1, cy - M), x1 = Math.min(W - 1, cx + cw + M), y1 = Math.min(H - 1, cy + ch + M);
  let a = m;
  for (let pass = 0; pass < 2; pass++) a = box3(box3(a, W, x0, y0, x1, y1, 1), W, x0, y0, x1, y1, W);
  // iloczyny gradientu raz na piksel, sumy okna z tablic prefiksowych
  const gxx = new Float32Array(W * H), gyy = new Float32Array(W * H), gxy = new Float32Array(W * H);
  for (let y = y0 + 1; y < y1 - 1; y++) for (let x = x0 + 1; x < x1 - 1; x++) {
    const k = y * W + x;
    const gx = a[k + 1] - a[k - 1], gy = a[k + W] - a[k - W];
    gxx[k] = gx * gx; gyy[k] = gy * gy; gxy[k] = gx * gy;
  }
  const Sxx = integral(gxx, W, H), Syy = integral(gyy, W, H), Sxy = integral(gxy, W, H);
  const hist = emptyHist();
  const R = 3; // okno tensora
  for (let y = cy + R + 1; y < cy + ch - R - 1; y += 2) for (let x = cx + R + 1; x < cx + cw - R - 1; x += 2) {
    if (m[y * W + x] < 0.5) continue;
    const jxx = rectSum(Sxx, W, x - R, y - R, x + R, y + R);
    const jyy = rectSum(Syy, W, x - R, y - R, x + R, y + R);
    const jxy = rectSum(Sxy, W, x - R, y - R, x + R, y + R);
    const tr = jxx + jyy;
    if (tr < 1e-4) continue;
    const coh = Math.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy) / tr;
    if (coh < 0.5) continue;
    // kierunek krawędzi (prostopadły do gradientu dominującego)
    const gAng = 0.5 * Math.atan2(2 * jxy, jxx - jyy);
    const edge = gAng + Math.PI / 2;
    // kąt krawędzi od osi x (0–180°) → kąt od pionu (0° = pion)
    const edgeDeg = ((((edge * 180) / Math.PI) % 180) + 180) % 180;
    const deg = Math.abs(90 - edgeDeg);
    const hRel = 1 - (y - cy) / ch;
    addAngle(hist, Math.floor(hRel * BANDS), Math.min(90, Math.max(0, deg)), coh);
  }
  // oś pnia: w każdym 5% wysokości środek najdłuższego odcinka kory
  const axis: number[] = [];
  for (let k = 0; k < 20; k++) {
    const y = Math.round(cy + ch * (1 - (k + 0.5) / 20));
    let best = 0, bestMid = NaN, run = 0;
    for (let x = cx; x <= cx + cw; x++) {
      if (x < cx + cw && m[y * W + x] > 0.5) run++;
      else { if (run > best) { best = run; bestMid = x - run / 2; } run = 0; }
    }
    axis.push(best > 2 ? (bestMid - (cx + cw / 2)) / ch : NaN);
  }
  return { hist: norm(hist), axis };
}

function modelVectors(stems: { level: number; px: number[]; py: number[]; r: number[] }[]) {
  const hist = emptyHist();
  let maxY = 0;
  for (const s of stems) for (const y of s.py) maxY = Math.max(maxY, y);
  const axis: number[] = new Array(20).fill(NaN);
  for (const s of stems) for (let i = 1; i < s.px.length; i++) {
    const dx = s.px[i] - s.px[i - 1], dy = s.py[i] - s.py[i - 1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const deg = (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
    const hRel = (s.py[i] + s.py[i - 1]) / 2 / maxY;
    addAngle(hist, Math.floor(hRel * BANDS), deg, len * (s.r[i] + s.r[i - 1]));
    if (s.level === 0) axis[Math.min(19, Math.floor(hRel * 20))] = ((s.px[i] + s.px[i - 1]) / 2) / maxY;
  }
  return { hist: norm(hist), axis };
}

const fmtRow = (row: number[]) => row.map((v) => `${Math.round(v * 100)}`.padStart(3)).join(' ');

async function main() {
  const [key, hArg] = process.argv.slice(2);
  const sp = SPECIES.find((s) => s.key === key)!;
  const photos = speciesPhotos(sp).filter((p) => !hArg || p.height === Number(hArg));
  const heights = [...new Set(photos.map((p) => p.height))];
  console.log(`kąt od pionu, kosze ${BINS.join('/')}°, udział %; pasy: góra / środek / dół korony`);
  for (const h of heights) {
    const m = modelProfile(sp, h);
    const sk = TreeGenerator.buildSkeleton({ species: m.species, profile: m.profile, form: m.form, height: h, seed: 108 } as never);
    const mv = modelVectors(sk.stems);
    for (const ph of photos.filter((p) => p.height === h)) {
      const pv = await photoVectors(ph.path);
      console.log(`\n${ph.file.slice(0, 50)} (${h} m)`);
      for (let b = BANDS - 1; b >= 0; b--) {
        console.log(`  pas ${b}: zdj ${fmtRow(pv.hist[b])} | śr ${meanAngle(pv.hist[b]).toFixed(0).padStart(2)}°   model ${fmtRow(mv.hist[b])} | śr ${meanAngle(mv.hist[b]).toFixed(0).padStart(2)}°`);
      }
      const ax = (v: number[]) => v.map((x) => (Number.isNaN(x) ? '  .' : `${Math.round(x * 100)}`.padStart(3))).join('');
      console.log(`  oś pnia (odchylenie % H, od dołu): zdj ${ax(pv.axis)}`);
      console.log(`                                  model ${ax(mv.axis)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
