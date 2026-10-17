import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';

async function main() {
  const refDir = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/lipa_Tilia';

  const images = [
    { name: 'sercowata', file: `${refDir}/zdjecia/lipa_drobnolistna_sercowata_korona_01-15m.jpg` },
    { name: 'kulista', file: `${refDir}/zdjecia/lipa_drobnolistna_kulista_korona_01-15m.jpg` },
    { name: 'wektor_gesta', file: `${refDir}/ilustracje/lipa_gesta_korona_wektor_01-15m.jpg` },
  ];

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  for (const img of images) {
    const page = await browser.newPage();
    const dataUrl = `data:image/jpeg;base64,${fs.readFileSync(img.file).toString('base64')}`;

    const metrics = await page.evaluate(async (src) => {
      return new Promise<any>((resolve) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
          const w = image.naturalWidth;
          const h = image.naturalHeight;
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(image, 0, 0);

          const idata = ctx.getImageData(0, 0, w, h);
          const data = idata.data;

          let minX = w, maxX = 0, minY = h, maxY = 0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              const a = data[idx + 3];

              // Check if not background (assuming light background or transparent)
              const isBg = (a < 30) || (r > 240 && g > 240 && b > 240);
              if (!isBg) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }

          const treeH = maxY - minY + 1;
          const treeW = maxX - minX + 1;
          const whRatio = treeW / treeH;

          // Find trunk base and crown start
          // Sample horizontal slices from bottom up
          let trunkBaseY = maxY;
          let firstBranchY = maxY;
          let trunkBaseWidth = 0;

          // Find trunk base width (lowest 5% of height)
          const sliceY = maxY - Math.round(treeH * 0.03);
          let sliceMinX = w, sliceMaxX = 0;
          for (let x = minX; x <= maxX; x++) {
            const idx = (sliceY * w + x) * 4;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
            if (!(a < 30 || (r > 240 && g > 240 && b > 240))) {
              if (x < sliceMinX) sliceMinX = x;
              if (x > sliceMaxX) sliceMaxX = x;
            }
          }
          trunkBaseWidth = sliceMaxX >= sliceMinX ? sliceMaxX - sliceMinX + 1 : 0;

          // Detect where width exceeds 3x trunk width
          for (let y = maxY; y >= minY; y -= 2) {
            let sMin = w, sMax = 0;
            for (let x = minX; x <= maxX; x++) {
              const idx = (y * w + x) * 4;
              const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
              if (!(a < 30 || (r > 240 && g > 240 && b > 240))) {
                if (x < sMin) sMin = x;
                if (x > sMax) sMax = x;
              }
            }
            const curW = sMax >= sMin ? sMax - sMin + 1 : 0;
            if (curW > Math.max(trunkBaseWidth * 2.2, treeW * 0.22)) {
              firstBranchY = y;
              break;
            }
          }

          const trunkH = maxY - firstBranchY;
          const trunkRatio = trunkH / treeH;

          resolve({
            w, h,
            treeW, treeH,
            whRatio,
            trunkBaseWidth,
            trunkBaseRatio: trunkBaseWidth / treeH,
            trunkRatio,
          });
        };
        image.src = src;
      });
    }, dataUrl);

    console.log(`[Pattern: ${img.name}]`, metrics);
    await page.close();
  }

  await browser.close();
}

main().catch(console.error);
