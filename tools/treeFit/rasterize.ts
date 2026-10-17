import { TreeGenerator, type SpeciesProfile, type TreeSpecies, type TrunkForm } from '../../src/index.js';

const RES_H = 170; // wysokość rastra ~ jak drzewa w alfabecie
const SS = 3;      // nadpróbkowanie: kreski cieńsze niż piksel zostawiają częściowe pokrycie, jak w skanie rysunku

/**
 * Elewacja szkieletu (rzut na XY) jako maska binarna w rozdzielczości wzorca.
 * Rysowanie w SS× rozdzielczości, uśrednienie do pikseli docelowych i próg pokrycia 0,41
 * (odpowiada progowi jasności 150/255 użytemu przy wyodrębnianiu wzorca).
 */
export function rasterize(profile: SpeciesProfile, species: TreeSpecies, seed: number, form: TrunkForm, resH = RES_H): { mask: Uint8Array; W: number; H: number } {
  const sk = TreeGenerator.buildSkeleton({ species, height: 10, seed, profile, form });
  const s = sk.scale;
  let minX = Infinity, maxX = -Infinity, maxY = 0;
  for (const st of sk.stems) for (let i = 0; i < st.px.length; i++) { minX = Math.min(minX, st.px[i] * s); maxX = Math.max(maxX, st.px[i] * s); maxY = Math.max(maxY, st.py[i] * s); }
  const H = resH, k = (H - 4) / maxY;
  const W = Math.ceil((maxX - minX) * k) + 8;
  const HW = W * SS, HH = H * SS, kk = k * SS;
  const hi = new Uint8Array(HW * HH);
  const plot = (x: number, y: number, r: number) => {
    const cx = ((x - minX) * k + 4) * SS, cy = (H - 2) * SS - y * kk, rr = Math.max(0.5, r * kk);
    for (let yy = Math.floor(cy - rr); yy <= Math.ceil(cy + rr); yy++) for (let xx = Math.floor(cx - rr); xx <= Math.ceil(cx + rr); xx++) {
      if (xx < 0 || yy < 0 || xx >= HW || yy >= HH) continue;
      if ((xx + 0.5 - cx) ** 2 + (yy + 0.5 - cy) ** 2 <= rr * rr + 0.25) hi[yy * HW + xx] = 1;
    }
  };
  for (const st of sk.stems) for (let i = 0; i + 1 < st.px.length; i++) {
    const x0 = st.px[i] * s, y0 = st.py[i] * s, x1 = st.px[i + 1] * s, y1 = st.py[i + 1] * s;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * kk / 0.7));
    for (let j = 0; j <= n; j++) { const t = j / n; plot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, (st.r[i] + (st.r[i + 1] - st.r[i]) * t) * s); }
  }
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let c = 0;
    for (let a = 0; a < SS; a++) for (let b = 0; b < SS; b++) c += hi[(y * SS + a) * HW + x * SS + b];
    mask[y * W + x] = c / (SS * SS) > 0.41 ? 1 : 0;
  }
  return { mask, W, H };
}
