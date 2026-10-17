// Plansza porównawcza: wycinek wzorca z alfabetu | nasza sylwetka (dopasowany profil), 3 ziarna.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { rasterize } from './rasterize';
import { SEEDS } from './evaluate';

const [, , alphabetPath, outPath] = process.argv;
const fitted = JSON.parse(fs.readFileSync('../../src/core/fittedProfiles.json', 'utf8'));
const ref = JSON.parse(fs.readFileSync('scripts/treeFit/referenceMetrics.json', 'utf8'));

async function main() {
  const cells = fitted.map((f: any) => {
    const box = ref.find((r: any) => r.name === f.ref).box;
    const ours = SEEDS.map((seed) => { const r = rasterize(f.profile, f.startSpecies, seed, f.form, box[3] - box[1] + 1); return { W: r.W, H: r.H, mask: Array.from(r.mask) }; });
    return { pl: f.pl, ref: f.ref, box, ours, dist: f.distFitted, before: f.distExisting, near: f.nearestExisting, form: f.form, shape: f.profile.crownShape };
  });
  const b64 = fs.readFileSync(alphabetPath).toString('base64');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true });
  const page = await browser.newPage();
  const png = await page.evaluate(async ({ src, cells }) => {
    const img = new Image(); img.src = src; await img.decode();
    const COLS = 3, CW = 900, CH = 470;
    const rows = Math.ceil(cells.length / COLS);
    const c = document.createElement('canvas'); c.width = COLS * CW; c.height = rows * CH;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    cells.forEach((cell: any, i: number) => {
      const ox = (i % COLS) * CW, oy = Math.floor(i / COLS) * CH;
      const [x0, y0, x1, y1] = cell.box; const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const base = oy + 400;
      ctx.drawImage(img, x0, y0, w, h, ox + 20, base - h * 2, w * 2, h * 2);
      let x = ox + 40 + w * 2;
      for (const o of cell.ours) {
        const id = ctx.createImageData(o.W, o.H);
        for (let p = 0; p < o.W * o.H; p++) { const v = o.mask[p] ? 20 : 255; id.data[p * 4] = id.data[p * 4 + 1] = id.data[p * 4 + 2] = v; id.data[p * 4 + 3] = o.mask[p] ? 255 : 0; }
        const tmp = document.createElement('canvas'); tmp.width = o.W; tmp.height = o.H; tmp.getContext('2d')!.putImageData(id, 0, 0);
        ctx.imageSmoothingEnabled = false;
        const sc = Math.min(2, (CW - (x - ox) - 10) / o.W / (cell.ours.length - cell.ours.indexOf(o)));
        ctx.drawImage(tmp, x, base - o.H * sc, o.W * sc, o.H * sc);
        x += o.W * sc + 12;
      }
      ctx.fillStyle = '#222'; ctx.font = '600 22px sans-serif';
      ctx.fillText(`${cell.pl} (${cell.ref})`, ox + 20, base + 34);
      ctx.font = '18px sans-serif'; ctx.fillStyle = '#666';
      ctx.fillText(`wzorzec | nasze ×3 ziarna · ${cell.form}, ${cell.shape} · odległość ${cell.before} → ${cell.dist}`, ox + 20, base + 58);
    });
    return c.toDataURL('image/png');
  }, { src: 'data:image/jpeg;base64,' + b64, cells });
  fs.writeFileSync(outPath, Buffer.from(png.split(',')[1], 'base64'));
  await browser.close();
}
main();
