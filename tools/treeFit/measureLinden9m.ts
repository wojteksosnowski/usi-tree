import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';

async function main() {
  const dir = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/lipa_Tilia';
  const imgFile = `${dir}/zdjecia/lipa_drobnolistna_asymetryczna_korona_01-9m.webp`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const b64 = fs.readFileSync(imgFile).toString('base64');
  const dataUrl = `data:image/webp;base64,${b64}`;

  const res = await page.evaluate((url) => {
    return new Promise<{ w: number; h: number; treeW: number; treeH: number; trunkH: number }>((resolve) => {
      const image = new Image();
      image.onload = () => {
        const cvs = document.createElement('canvas');
        cvs.width = image.width;
        cvs.height = image.height;
        const ctx = cvs.getContext('2d')!;
        ctx.drawImage(image, 0, 0);

        const imgData = ctx.getImageData(0, 0, image.width, image.height).data;
        let minX = image.width, maxX = 0, minY = image.height, maxY = 0;

        for (let y = 0; y < image.height; y++) {
          for (let x = 0; x < image.width; x++) {
            const idx = (y * image.width + x) * 4;
            const a = imgData[idx + 3];
            const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2];
            if (a > 30 && (r < 240 || g < 240 || b < 240)) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        const treeH = maxY - minY;
        const treeW = maxX - minX;

        // Szukamy nasady korony
        let trunkTopY = maxY;
        for (let y = maxY; y >= minY; y--) {
          let rowMinX = image.width, rowMaxX = 0;
          for (let x = minX; x <= maxX; x++) {
            const idx = (y * image.width + x) * 4;
            const a = imgData[idx + 3];
            const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2];
            if (a > 30 && (r < 240 || g < 240 || b < 240)) {
              if (x < rowMinX) rowMinX = x;
              if (x > rowMaxX) rowMaxX = x;
            }
          }
          const rowW = rowMaxX >= rowMinX ? rowMaxX - rowMinX : 0;
          if (rowW > treeW * 0.18) {
            trunkTopY = y;
            break;
          }
        }

        const trunkH = maxY - trunkTopY;
        resolve({ w: image.width, h: image.height, treeW, treeH, trunkH });
      };
      image.src = url;
    });
  }, dataUrl);

  const ratio = res.treeW / res.treeH;
  const trunkRatio = res.trunkH / res.treeH;

  console.log(`=== Lipa 9m Asymetryczna ===`);
  console.log(`Wymiary: ${res.w}x${res.h}px`);
  console.log(`Tree H: ${res.treeH}px, Tree W: ${res.treeW}px, W/H = ${ratio.toFixed(3)}`);
  console.log(`Trunk Height: ${res.trunkH}px (${(trunkRatio * 100).toFixed(1)}% of H)`);
  console.log(`Dla skali 9.0m: Szerokość W = ${(9.0 * ratio).toFixed(2)}m, Pień H = ${(9.0 * trunkRatio).toFixed(2)}m`);

  await browser.close();
}

main();
