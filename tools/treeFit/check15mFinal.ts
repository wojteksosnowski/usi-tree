import fs from 'node:fs';
import { TreeGenerator, ILLUSTRATION_STROKE } from '../../src/index.js';

const p15 = JSON.parse(fs.readFileSync('/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/klon-jawor_Acer/klon_15m_korona.json', 'utf8'));

p15.levels[0].count = 18;
p15.levels[0].curve = 10;
p15.levels[0].downAngleSlope = 12;
p15.levels[0].tropism = 0.08;
p15.leafDensity = 85;
p15.crownSpreadRatio = 0.36;

for (const seed of [13, 2024]) {
  const res = TreeGenerator.generate({
    species: 'OAK', height: 15.0, seed, profile: p15,
    stroke: ILLUSTRATION_STROKE, withFoliageAccents: true, detail: 'HIGH',
  });
  res.geometry.computeBoundingBox();
  const bb = res.geometry.boundingBox!;
  const wFront = bb.max.x - bb.min.x;
  const h = bb.max.y - bb.min.y;
  const ratio = wFront / h;
  console.log(`Seed ${seed}: H = ${h.toFixed(2)} m, W = ${wFront.toFixed(2)} m, W/H = ${ratio.toFixed(3)}`);
}
