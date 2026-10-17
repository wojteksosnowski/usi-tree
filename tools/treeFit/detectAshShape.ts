/**
 * Miary sylwetki zdjęć wzorców jesionu — te same co w dopasowaniu (`silhouetteMetrics`),
 * z maską fotograficzną: jasne / szaroniebieskie tło odrzucone, dolne 6% pominięte (znaki wodne).
 *
 *   NODE_NO_WARNINGS=1 npx tsx scripts/treeFit/detectAshShape.ts
 */
import fs from 'node:fs';
import { createCanvas, loadImage } from 'canvas';
import { silhouetteMetrics } from './silhouetteMetrics';

const DIR = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/jesion_Fraxinus/zdjecia';
const FILES = [
  'jesion_smukly_pierzaste_liscie_01-6m.jpg',
  'jesion_wyniosly_pierzaste_liscie_01-9m.jpg',
  'jesion_wyniosly_azur_korony_01-9m.jpg',
  'jesion_pokroj_zimowy_bezlisci_01-15m.jpg',
  'jesion_wyniosly_waski_pokroj_01-15m.jpg',
  'ash-isolated-white-transparent-background-tree-green-leaves-close-up-front-view-graphic-design-element-theme-315132889-15m.webp',
  'istockphoto-146755086-1024x1024-24m.jpg',
  'istockphoto-952070864-612x612-24m.jpg',
];
/** Dolny pas zdjęcia pomijany (znaki wodne, napisy agencji) */
const BOTTOM_SKIP = 0.06;
const MARGIN_PX = 10;

function isTreePixel(d: Uint8ClampedArray, i: number): boolean {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  if (d[i + 3] < 30) return false;
  if (r > 235 && g > 235 && b > 235) return false; // białe tło
  return !(r > 220 && g > 220 && b > 220 && Math.abs(r - b) < 25 && Math.abs(g - b) < 25); // szare / niebieskawe niebo
}

async function main() {
  for (const file of FILES) {
    const p = `${DIR}/${file}`;
    if (!fs.existsSync(p)) {
      console.log(`Brak pliku: ${p}`);
      continue;
    }
    const img = await loadImage(p);
    const W = img.width, H = img.height;
    const ctx = createCanvas(W, H).getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    const maxY = Math.floor(H * (1 - BOTTOM_SKIP));
    for (let y = MARGIN_PX; y < maxY; y++) {
      for (let x = MARGIN_PX; x < W - MARGIN_PX; x++) mask[y * W + x] = isTreePixel(data, (y * W + x) * 4) ? 1 : 0;
    }
    const m = silhouetteMetrics(mask, W, H);
    if (!m) {
      console.log(`${file}: brak sylwetki`);
      continue;
    }
    console.log(`\n${file}`);
    console.log(`  W/H ${m.aspect.toFixed(3)} | nasada korony ${(m.crownBase * 100).toFixed(1)}% H | pień ${(m.trunk * 100).toFixed(2)}% H | najszerzej na ${(m.widestAt * 100).toFixed(0)}% H`);
    m.profile.forEach((w, i) => console.log(`  pas ${i} (od dołu) | ${(w * 100).toFixed(1).padStart(5)}% H | ${'#'.repeat(Math.round(w * 40))}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
