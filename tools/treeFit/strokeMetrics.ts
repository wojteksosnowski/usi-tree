/**
 * Miary kreski drzewa (styl B): grubość pnia, konarów i gałęzi jako ułamek wysokości drzewa.
 * Wspólne dla wzorca stylu (rysunek, np. SA_Artboard2) i generatora — oba mierzone z mapy pokrycia korą
 * (0..1 na piksel) w tej samej rozdzielczości, więc antyaliasing i grubość 1 px działają tak samo.
 *
 * Grubość = suma pokrycia w poziomym przekroju ciągłego odcinka kory (kreska 1 px rozmyta na 3 px daje ~1 px).
 * Ukośne konary wychodzą w przekroju poziomym nieco grubsze (1/cos) — tak samo we wzorcu i u nas.
 */
import { TreeGenerator, type SpeciesProfile, type TreeSpecies, type TreeStroke, type TrunkForm } from '../../src/index.js';

export interface StrokeMetrics {
  h: number;          // wysokość drzewa w px
  stems: number;      // liczba pni przy odziomku
  trunkBase: number;  // suma przekrojów pni na 3–7% wysokości / wysokość
  trunk15: number;    // pień śledzony od podstawy, 13–17% wysokości (mediana wierszy) / wysokość
  trunk25: number;    // pień śledzony od podstawy, 23–27% wysokości (mediana wierszy) / wysokość
  limb: number;       // 90. percentyl grubości przekrojów kory w koronie (35–95% wysokości) — konary
  branch: number;     // mediana grubości przekrojów kory w koronie — gałęzie
}

export const STROKE_KEYS = ['trunkBase', 'trunk15', 'trunk25', 'limb', 'branch'] as const;

/** Miary jednego drzewa z mapy pokrycia `A` (W kolumn) w ramce x0..x1, od wierzchołka `top` do podstawy `base` */
export function strokeMetrics(A: Float32Array, W: number, x0: number, x1: number, top: number, base: number): StrokeMetrics {
  const h = base - top + 1;
  // Przekroje kory w wierszu: grubość (suma pokrycia) i środek
  const sections = (y: number) => {
    const out: { w: number; c: number }[] = [];
    let s = 0, m = 0, on = false;
    for (let x = x0; x <= x1 + 1; x++) {
      const a = x <= x1 ? A[y * W + x] : 0;
      if (a > 0.15) { s += a; m += a * x; on = true; } else if (on) { if (s > 0.35) out.push({ w: s, c: m / s }); s = 0; m = 0; on = false; }
    }
    return out;
  };
  const runs = (y: number) => sections(y).map((r) => r.w);
  // Pień śledzony od podstawy: w każdym wierszu przekrój najbliższy poprzedniemu środkowi (konar odchodzący
  // w bok nie podmienia pnia); w wierszu wynik = grubość tego przekroju
  const trunkW = new Map<number, number>();
  {
    const first = sections(base).sort((a, b) => b.w - a.w)[0];
    let c = first ? first.c : (x0 + x1) / 2;
    for (let y = base; y >= base - Math.round(0.3 * h); y--) {
      const sec = sections(y);
      if (!sec.length) { trunkW.set(y, 0); continue; }
      const near = sec.reduce((p, r) => (Math.abs(r.c - c) < Math.abs(p.c - c) ? r : p));
      if (Math.abs(near.c - c) > Math.max(3, near.w)) { trunkW.set(y, 0); continue; }
      c = near.c;
      trunkW.set(y, near.w);
    }
  }
  const trunkAt = (f0: number, f1: number) => { const out: number[] = []; for (let f = f0; f <= f1 + 1e-9; f += 1 / h) out.push(trunkW.get(base - Math.round(f * h)) ?? 0); return out; };
  const rowsAt = (f0: number, f1: number) => { const out: number[][] = []; for (let f = f0; f <= f1 + 1e-9; f += 1 / h) out.push(runs(base - Math.round(f * h))); return out; };
  const mean = (a: number[]) => (a.length ? a.reduce((p, c) => p + c, 0) / a.length : 0);
  const med = (a: number[]) => q(a, 0.5);
  const q = (a: number[], f: number) => { if (!a.length) return 0; const b = [...a].sort((p, r) => p - r); return b[Math.min(b.length - 1, Math.floor(b.length * f))]; };
  const low = rowsAt(0.03, 0.07);
  const crown = rowsAt(0.35, 0.95).flat();
  return {
    h,
    stems: Math.round(mean(low.map((r) => r.length))),
    trunkBase: mean(low.map((r) => r.reduce((p, c) => p + c, 0))) / h,
    // mediana wierszy śledzonego pnia: pojedynczy konar w przekroju nie zawyża pnia
    trunk15: med(trunkAt(0.13, 0.17)) / h,
    trunk25: med(trunkAt(0.23, 0.27)) / h,
    limb: q(crown, 0.9) / h,
    branch: q(crown, 0.5) / h,
  };
}

/**
 * Drzewa na planszy rysunków (rzędy i kolumny rozdzielone pustymi pasami): pokrycie korą z barwy
 * (kora: czerwony wyraźnie ponad zielonym i niebieskim; obwiednie zielone/niebieskie dają 0), wysokość
 * od podstawy kory do wierzchołka rysunku (obwiednia korony).
 */
export function measureBoard(
  rgb: Uint8Array, W: number, H: number,
  opts: { bg: [number, number, number]; bark: [number, number, number]; inkThreshold?: number; gap?: number }
): StrokeMetrics[] {
  const { bg, bark } = opts;
  const cl = (v: number) => Math.max(0, Math.min(1, v));
  const rb0 = bg[0] - bg[2], rb1 = bark[0] - bark[2], rg0 = bg[0] - bg[1], rg1 = bark[0] - bark[1];
  const A = new Float32Array(W * H), ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    A[i] = Math.min(cl((r - b - rb0) / (rb1 - rb0)), cl((r - g - rg0) / (rg1 - rg0)));
    // Rysunek: wyraźnie różny od tła (jasny znak wodny planszy poniżej progu)
    ink[i] = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > (opts.inkThreshold ?? 120) ? 1 : 0;
  }
  const gap = opts.gap ?? 4;
  const bands = (proj: boolean[]) => {
    const out: [number, number][] = [];
    let s = -1, g = 0;
    for (let i = 0; i < proj.length; i++) {
      if (proj[i]) { if (s < 0) s = i; g = 0; } else if (s >= 0 && ++g >= gap) { out.push([s, i - g]); s = -1; g = 0; }
    }
    if (s >= 0) out.push([s, proj.length - 1]);
    return out;
  };
  const rowP = Array.from({ length: H }, (_, y) => { let c = 0; for (let x = 0; x < W; x++) c += ink[y * W + x]; return c > 1; });
  const out: StrokeMetrics[] = [];
  for (const [y0, y1] of bands(rowP)) {
    if (y1 - y0 < 30) continue;
    const colP = Array.from({ length: W }, (_, x) => { let c = 0; for (let y = y0; y <= y1; y++) c += ink[y * W + x]; return c > 1; });
    for (const [x0, x1] of bands(colP)) {
      if (x1 - x0 < 15) continue;
      let base = -1, top = -1;
      for (let y = y1; y >= y0 && base < 0; y--) { let s = 0; for (let x = x0; x <= x1; x++) s += A[y * W + x]; if (s > 0.8) base = y; }
      for (let y = y0; y <= y1 && top < 0; y++) for (let x = x0; x <= x1; x++) if (ink[y * W + x]) { top = y; break; }
      if (base > top && top >= 0) out.push(strokeMetrics(A, W, x0, x1, top, base));
    }
  }
  return out;
}

/**
 * Nasze drzewo: elewacja szkieletu (rzut na XY) z kreską `stroke` jako mapa pokrycia korą w wysokości `resH` px.
 * Wysokość drzewa = wierzchołek korony (`crownTopRatio` × wierzchołek szkieletu; we wzorcu wysokość sięga obwiedni korony).
 */
export function measureGenerated(
  profile: SpeciesProfile, species: TreeSpecies, seed: number, form: TrunkForm, stroke: TreeStroke | undefined, resH = 165, crownTopRatio = 1.04
): StrokeMetrics {
  const sk = TreeGenerator.buildSkeleton({ species, height: 10, seed, profile, form });
  const s = sk.scale;
  const trunkBaseR = TreeGenerator.trunkBaseRadius(sk.stems);
  const stems = stroke ? sk.stems.map((st) => TreeGenerator.strokeStem(st, stroke, sk.height / s, trunkBaseR)) : sk.stems;
  let minX = Infinity, maxX = -Infinity, maxY = 0;
  for (const st of stems) for (let i = 0; i < st.px.length; i++) { minX = Math.min(minX, st.px[i] * s); maxX = Math.max(maxX, st.px[i] * s); maxY = Math.max(maxY, st.py[i] * s); }
  const SS = 4, pad = 6;
  const k = (resH - 1) / (maxY * crownTopRatio);
  const W = Math.ceil((maxX - minX) * k) + 2 * pad, H = resH + pad;
  const HW = W * SS, HH = H * SS, kk = k * SS;
  const hi = new Uint8Array(HW * HH);
  const baseY = (H - pad) * SS;
  const plot = (x: number, y: number, r: number) => {
    const cx = ((x - minX) * k + pad) * SS, cy = baseY - y * kk, rr = Math.max(0.3, r * kk);
    for (let yy = Math.floor(cy - rr); yy <= Math.ceil(cy + rr); yy++) for (let xx = Math.floor(cx - rr); xx <= Math.ceil(cx + rr); xx++) {
      if (xx < 0 || yy < 0 || xx >= HW || yy >= HH) continue;
      if ((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 <= rr * rr) hi[yy * HW + xx] = 1;
    }
  };
  for (const st of stems) for (let i = 0; i + 1 < st.px.length; i++) {
    const x0 = st.px[i] * s, y0 = st.py[i] * s, x1 = st.px[i + 1] * s, y1 = st.py[i + 1] * s;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * kk / 0.5));
    for (let j = 0; j <= n; j++) { const t = j / n; plot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, (st.r[i] + (st.r[i + 1] - st.r[i]) * t) * s); }
  }
  const A = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = 0;
    for (let a = 0; a < SS; a++) for (let b = 0; b < SS; b++) c += hi[(y * SS + a) * HW + x * SS + b];
    A[y * W + x] = c / (SS * SS);
  }
  const base = H - pad - 1;
  return strokeMetrics(A, W, 0, W - 1, base - resH + 1, base);
}
