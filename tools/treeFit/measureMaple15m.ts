import fs from 'node:fs';
import { createCanvas, loadImage } from 'canvas';

async function measureImage() {
  const imgPath = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/klon-jawor_Acer/zdjecia/klon_zwyczajny_jesienny_korona_01-15m.jpg';
  const img = await loadImage(imgPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  let minX = img.width, maxX = 0, minY = img.height, maxY = 0;

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const idx = (y * img.width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      // Tło jest białe (r > 245, g > 245, b > 245)
      if (r < 240 || g < 240 || b < 240) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const hPx = maxY - minY;
  const wPx = maxX - minX;
  const ratio = wPx / hPx;

  // Szukamy wysokości początku korony (gdzie korona zaczyna się znacznie rozszerzać)
  let trunkTopY = maxY;
  for (let y = maxY; y >= minY; y--) {
    let rowMinX = img.width, rowMaxX = 0;
    for (let x = 0; x < img.width; x++) {
      const idx = (y * img.width + x) * 4;
      if (data[idx] < 240 || data[idx + 1] < 240 || data[idx + 2] < 240) {
        if (x < rowMinX) rowMinX = x;
        if (x > rowMaxX) rowMaxX = x;
      }
    }
    const rowW = rowMaxX - rowMinX;
    if (rowW > wPx * 0.25) {
      trunkTopY = y;
      break;
    }
  }

  const trunkHPx = maxY - trunkTopY;
  const trunkRatio = trunkHPx / hPx;

  console.log(`Image metrics for klon 15m:`);
  console.log(`BBox: X [${minX}, ${maxX}] (${wPx} px), Y [${minY}, ${maxY}] (${hPx} px)`);
  console.log(`Total Width / Height ratio: ${ratio.toFixed(3)}`);
  console.log(`Trunk height ratio: ~${trunkRatio.toFixed(3)} (approx ${trunkHPx} / ${hPx} px)`);
  console.log(`At 15m height: Width W = ${(15.0 * ratio).toFixed(2)} m, Trunk H = ${(15.0 * trunkRatio).toFixed(2)} m`);
}

measureImage().catch(console.error);
