import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from 'canvas';

async function measure(imgPath: string, name: string) {
  if (!fs.existsSync(imgPath)) {
    console.log(`File not found: ${imgPath}`);
    return;
  }
  const img = await loadImage(imgPath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  let minX = img.width, maxX = 0, minY = img.height, maxY = 0;

  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      // Watermark text is at x < 70
      if (x < 70) continue;
      const idx = (y * img.width + x) * 4;
      const a = data[idx + 3];
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const isContent = a > 40 && (r < 240 || g < 240 || b < 240);
      if (isContent) {
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

  let trunkTopY = maxY;
  for (let y = maxY; y >= minY; y--) {
    let rowMinX = img.width, rowMaxX = 0;
    for (let x = minX; x <= maxX; x++) {
      const idx = (y * img.width + x) * 4;
      const a = data[idx + 3];
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (a > 40 && (r < 240 || g < 240 || b < 240)) {
        if (x < rowMinX) rowMinX = x;
        if (x > rowMaxX) rowMaxX = x;
      }
    }
    const rowW = rowMaxX >= rowMinX ? rowMaxX - rowMinX : 0;
    // When width exceeds 80px, crown starts
    if (rowW > 80) {
      trunkTopY = y;
      break;
    }
  }

  const trunkHPx = maxY - trunkTopY;
  const trunkRatio = trunkHPx / hPx;

  console.log(`=== ${name} ===`);
  console.log(`Total H: ${hPx}px, Total W: ${wPx}px, W/H: ${ratio.toFixed(3)}`);
  console.log(`Trunk Height: ${trunkHPx}px (~${(trunkRatio * 100).toFixed(1)}% of H)`);
  console.log(`At 6.0m: W = ${(6.0 * ratio).toFixed(2)}m, Trunk = ${(6.0 * trunkRatio).toFixed(2)}m\n`);
}

async function main() {
  const dir = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/jesion_Fraxinus';
  await measure(`${dir}/zdjecia/jesion_smukly_pierzaste_liscie_01-6m.jpg`, 'Jesion 6m Smukły Pierzaste Liście');
}

main().catch(console.error);
