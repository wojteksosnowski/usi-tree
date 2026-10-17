import fs from 'node:fs';
import { TreeGenerator, ILLUSTRATION_STROKE } from '../../src/index.js';

const p15 = JSON.parse(fs.readFileSync('/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/klon-jawor_Acer/klon_15m_korona.json', 'utf8'));
p15.crownSpreadRatio = 0.38;

console.log('Testing klon 15m seeds against target W/H = 0.815 (W = 12.23m, H = 15.0m):');

for (const seed of [42, 101, 107, 2024, 13, 777, 55]) {
  const res = TreeGenerator.generate({
    species: 'OAK', height: 15.0, seed, profile: p15,
    stroke: ILLUSTRATION_STROKE, withFoliageAccents: true, detail: 'HIGH',
  });
  res.geometry.computeBoundingBox();
  const bb = res.geometry.boundingBox!;
  const wFront = bb.max.x - bb.min.x;
  const h = bb.max.y - bb.min.y;
  const ratio = wFront / h;
  const diff = Math.abs(ratio - 0.815) / 0.815 * 100;
  console.log(`Seed ${seed.toString().padStart(4)}: H = ${h.toFixed(2)} m, W = ${wFront.toFixed(2)} m, W/H = ${ratio.toFixed(3)} (error: ${diff.toFixed(1)}%)`);
}
