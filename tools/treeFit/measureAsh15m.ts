import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

async function main() {
  const refDir = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/jesion_Fraxinus';
  const img1 = `${refDir}/zdjecia/jesion_pokroj_zimowy_bezlisci_01-15m.jpg`;
  const img2 = `${refDir}/zdjecia/jesion_wyniosly_waski_pokroj_01-15m.jpg`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  async function measure(imgPath: string, name: string) {
    const b64 = fs.readFileSync(imgPath).toString('base64');
    const dataUrl = `data:image/jpeg;base64,${b64}`;

    await page.setContent(`
      <canvas id="c"></canvas>
      <script>
        const img = new Image();
        img.onload = () => {
          const c = document.getElementById('c');
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const id = ctx.getImageData(0, 0, c.width, c.height);
          const data = id.data;
          let minX = c.width, maxX = 0, minY = c.height, maxY = 0;
          for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
              const idx = (y * c.width + x) * 4;
              const r = data[idx], g = data[idx+1], b = data[idx+2];
              // non-white pixel
              if (r < 240 || g < 240 || b < 240) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          window.res = { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY, imgW: img.width, imgH: img.height };
        };
        img.src = "${dataUrl}";
      </script>
    `);

    await page.waitForFunction(() => (window as any).res !== undefined);
    const res: any = await page.evaluate(() => (window as any).res);
    const ratio = res.w / res.h;
    console.log(`=== ${name} ===`);
    console.log(`Bounding box: x=[${res.minX}, ${res.maxX}] (${res.w}px), y=[${res.minY}, ${res.maxY}] (${res.h}px)`);
    console.log(`W/H ratio: ${ratio.toFixed(3)} -> For H=15m, W = ${(ratio * 15).toFixed(2)}m`);
    return { ...res, ratio, width15m: ratio * 15 };
  }

  const m1 = await measure(img1, 'Wzorzec 1: Jesion bezlisci 15m');
  const m2 = await measure(img2, 'Wzorzec 2: Jesion waski pokroj 15m');

  const avgRatio = (m1.ratio + m2.ratio) / 2;
  console.log(`\n=== ŚREDNIA 15m ===`);
  console.log(`Średnie W/H: ${avgRatio.toFixed(3)} -> W = ${(avgRatio * 15).toFixed(2)}m (crownSpreadRatio: ${(avgRatio / 2).toFixed(3)})`);

  await browser.close();
}

main().catch(console.error);
