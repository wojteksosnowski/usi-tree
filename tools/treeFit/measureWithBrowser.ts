import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';

async function main() {
  const dir = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/lipa_Tilia';

  const images = [
    { name: 'Model 3D (ilustracja)', file: `${dir}/ilustracje/lipa_europejska_model3d_pokroj_01-6m.jpg` },
    { name: 'Szpaler (foto)', file: `${dir}/zdjecia/lipa_drobnolistna_mlode_drzewo_szpaler_01-6m.jpg` },
    { name: 'Ażur wiosenny (foto)', file: `${dir}/zdjecia/lipa_drobnolistna_azur_wiosenny_01-6m.webp` },
  ];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  for (const img of images) {
    const ext = path.extname(img.file).slice(1);
    const mime = ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const b64 = fs.readFileSync(img.file).toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;

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

          // Ignoruj dolne 5% jeśli to pasek alamy (r,g,b = 0 lub czarny pasek)
          const scanMaxY = Math.floor(image.height * 0.94);

          for (let y = 10; y < scanMaxY; y++) {
            for (let x = 10; x < image.width - 10; x++) {
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
            if (rowW > treeW * 0.20) {
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

    console.log(`=== ${img.name} ===`);
    console.log(`Tree H: ${res.treeH}px, Tree W: ${res.treeW}px, W/H = ${(res.treeW / res.treeH).toFixed(3)}`);
    console.log(`Trunk Height: ${res.trunkH}px (${(res.trunkH / res.treeH * 100).toFixed(1)}% of H)`);
    console.log(`Dla skali 6m: Szerokość W = ${(6.0 * res.treeW / res.treeH).toFixed(2)}m, Pień H = ${(6.0 * res.trunkH / res.treeH).toFixed(2)}m\n`);
  }

  await browser.close();
}

main();
