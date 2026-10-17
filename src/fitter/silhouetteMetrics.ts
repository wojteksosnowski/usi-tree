/**
 * Miary sylwetki drzewa w elewacji (wspólne dla wzorca i generatora).
 * Wejście: maska binarna W×H (1 = rysunek drzewa), y = 0 u góry, podstawa pnia w ostatnim wierszu z pikselem.
 */
export interface SilhouetteMetrics {
  aspect: number;      // szerokość / wysokość
  crownBase: number;   // wysokość nasady korony / wysokość (najniższy wiersz o szerokości > 3,5× pień)
  trunk: number;       // grubość pnia (5–10% wysokości) / wysokość
  profile: number[];   // szerokość w 10 pasach od dołu do góry / wysokość
  widestAt: number;    // wysokość najszerszego pasa / wysokość
  ink: number;         // udział zaczernionych pikseli w obrysie korony (gęstość kreski)
  dirs: number[];      // udział kierunków kreski w koronie: pion, poziom, skos /, skos \\
}

export function silhouetteMetrics(mask: Uint8Array, W: number, H: number): SilhouetteMetrics | null {
  let top = -1, bottom = -1;
  const rowMin = new Int32Array(H).fill(W), rowMax = new Int32Array(H).fill(-1), rowCount = new Int32Array(H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    if (top < 0) top = y;
    bottom = y;
    if (x < rowMin[y]) rowMin[y] = x;
    if (x > rowMax[y]) rowMax[y] = x;
    rowCount[y]++;
  }
  if (top < 0) return null;
  const h = bottom - top + 1;
  let minX = W, maxX = -1;
  for (let y = top; y <= bottom; y++) if (rowMax[y] >= 0) { minX = Math.min(minX, rowMin[y]); maxX = Math.max(maxX, rowMax[y]); }
  // Pień: najwęższy wiersz w pasie 2–8% wysokości od dołu (odporne na nisko schodzące gałęzie)
  let trunkPx = Infinity;
  for (let y = bottom - Math.round(h * 0.08); y <= bottom - Math.round(h * 0.02); y++) if (rowCount[y] > 0) trunkPx = Math.min(trunkPx, rowCount[y]);
  if (!isFinite(trunkPx)) trunkPx = 1;
  // Nasada korony: najniższy wiersz (licząc od dołu), w którym rozpiętość > 3,5× pień
  let crownBaseY = top;
  for (let y = bottom; y >= top; y--) {
    if (rowMax[y] >= 0 && rowMax[y] - rowMin[y] + 1 > Math.max(3.5 * trunkPx, h * 0.04)) { crownBaseY = y; break; }
  }
  const profile: number[] = [];
  let widest = 0, widestAt = 0;
  for (let b = 0; b < 10; b++) {
    const y0 = bottom - Math.round(h * (b + 1) / 10) + 1, y1 = bottom - Math.round(h * b / 10);
    let mn = W, mx = -1;
    for (let y = Math.max(top, y0); y <= y1; y++) if (rowMax[y] >= 0) { mn = Math.min(mn, rowMin[y]); mx = Math.max(mx, rowMax[y]); }
    const w = mx >= mn ? (mx - mn + 1) / h : 0;
    profile.push(w);
    if (w > widest) { widest = w; widestAt = (b + 0.5) / 10; }
  }
  // Gęstość kreski i kierunki — tylko w koronie (powyżej nasady)
  let inkN = 0, area = 0;
  const dirs = [0, 0, 0, 0];
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  for (let y = top; y <= crownBaseY; y++) {
    if (rowMax[y] < 0) continue;
    area += rowMax[y] - rowMin[y] + 1;
    for (let x = rowMin[y]; x <= rowMax[y]; x++) {
      if (!mask[y * W + x]) continue;
      inkN++;
      // Kierunek: najdłuższy ciąg pikseli (±3) w czterech kierunkach
      const run = (dx: number, dy: number) => { let n = 0; for (let k = 1; k <= 3; k++) { if (at(x + dx * k, y + dy * k)) n++; if (at(x - dx * k, y - dy * k)) n++; } return n; };
      const r = [run(0, 1), run(1, 0), run(1, -1), run(1, 1)];
      const mx = Math.max(...r);
      if (mx >= 2 && r.filter((v) => v === mx).length === 1) dirs[r.indexOf(mx)]++;
    }
  }
  const dn = dirs.reduce((a, b) => a + b, 0) || 1;
  return { aspect: (maxX - minX + 1) / h, crownBase: (bottom - crownBaseY) / h, trunk: trunkPx / h, profile, widestAt,
    ink: area ? inkN / area : 0, dirs: dirs.map((v) => v / dn) };
}

/** Odległość dwóch sylwetek (ważona suma różnic) */
export function metricsDistance(a: SilhouetteMetrics, b: SilhouetteMetrics): number {
  let d = 2.0 * Math.abs(a.aspect - b.aspect) + 1.5 * Math.abs(a.crownBase - b.crownBase) + 25 * Math.abs(a.trunk - b.trunk)
    + 0.6 * Math.abs(a.widestAt - b.widestAt);
  for (let i = 0; i < 10; i++) d += 0.35 * Math.abs(a.profile[i] - b.profile[i]);
  d += 4.0 * Math.abs(a.ink - b.ink);
  for (let i = 0; i < 4; i++) d += 1.5 * Math.abs(a.dirs[i] - b.dirs[i]);
  return d;
}
