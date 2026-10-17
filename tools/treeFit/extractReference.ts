// Wyodrębnia sylwetki 26 drzew z alfabetu (reference/design/drzewa/tree-alphabet.jpeg) i liczy ich miary.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { silhouetteMetrics } from './silhouetteMetrics';

const SRC = process.argv[2];
const OUT = process.argv[3];
const NAMES = ['Apple', 'Beech', 'Cedar', 'Dogwood', 'Elm', 'Fir', 'Ginkgo', 'Horsechestnut', 'Ilex', 'Juniper', 'Kentucky Coffeetree', 'Linden',
  'Mulberry', 'Nannyberg', 'Oak', 'Pine', 'Quaking Aspen', 'Redwood', 'Sycamore', 'Tree of Heaven', 'Umbrella Tree', 'Viburnum', 'Weeping Willow', 'Xanthoxylum', 'Yellowwood', 'Zelkova'];

async function main() {
  const b64 = fs.readFileSync(SRC).toString('base64');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true });
  const page = await browser.newPage();
  const res = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const W = img.width, H = img.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const dark = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) dark[p] = (d[p * 4] + d[p * 4 + 1] + d[p * 4 + 2]) / 3 < 150 ? 1 : 0;
    // Dylatacja 4 px, żeby rozproszone gałązki łączyły się w jedną składową
    const dil = new Uint8Array(W * H);
    const R = 4;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dark[y * W + x])
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) dil[yy * W + xx] = 1; }
    const lab = new Int32Array(W * H);
    const boxes: number[][] = [];
    let n = 0;
    for (let p = 0; p < W * H; p++) {
      if (!dil[p] || lab[p]) continue;
      n++; const st = [p]; lab[p] = n; let x0 = W, y0 = H, x1 = 0, y1 = 0;
      while (st.length) { const q = st.pop()!; const x = q % W, y = (q - x) / W; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (const r of [q - 1, q + 1, q - W, q + W]) if (r >= 0 && r < W * H && dil[r] && !lab[r] && Math.abs((r % W) - x) <= 1) { lab[r] = n; st.push(r); } }
      boxes.push([n, x0, y0, x1, y1]);
    }
    let trees = boxes.filter((b) => b[4] - b[2] > 50);
    // Scal składowe nachodzące na siebie (drzewa rozbite na części)
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < trees.length; i++) for (let j = i + 1; j < trees.length; j++) {
        const a = trees[i], b = trees[j];
        if (a[1] <= b[3] + 6 && b[1] <= a[3] + 6 && a[2] <= b[4] + 6 && b[2] <= a[4] + 6) {
          trees[i] = [a[0], Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4])];
          trees.splice(j, 1); merged = true; break outer;
        }
      }
    }
    // Kolejność czytania: wiersze wg podstawy pnia, potem x
    trees.sort((a, b) => a[4] - b[4]);
    const rows: number[][][] = [];
    for (const t of trees) { const r = rows.find((rw) => Math.abs(rw[0][4] - t[4]) < 60); if (r) r.push(t); else rows.push([t]); }
    const ordered = rows.flatMap((r) => r.sort((a, b) => a[1] - b[1]));
    return ordered.map((t) => {
      const [, x0, y0, x1, y1] = t; const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const m: number[] = new Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = dark[(y0 + y) * W + x0 + x];
      return { box: [x0, y0, x1, y1], w, h, mask: m };
    });
  }, 'data:image/jpeg;base64,' + b64);
  await browser.close();
  console.log('drzew:', res.length);
  const out = res.map((t, i) => ({ name: NAMES[i] ?? '?' + i, box: t.box, metrics: silhouetteMetrics(Uint8Array.from(t.mask), t.w, t.h) }));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  for (const t of out) console.log(t.name.padEnd(20), 'box', t.box.join(','), 'W/H', t.metrics!.aspect.toFixed(2), 'base', t.metrics!.crownBase.toFixed(2), 'trunk', t.metrics!.trunk.toFixed(3));
}
main();
