import fs from 'node:fs';
import { TreeGenerator } from '../../src/index.js';

const p9 = JSON.parse(fs.readFileSync('/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/klon-jawor_Acer/klon_9m_zloty.json', 'utf8'));
const p15 = JSON.parse(fs.readFileSync('/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/klon-jawor_Acer/klon_15m_korona.json', 'utf8'));

function analyzeTree(name: string, profile: any, seed: number, height: number) {
  const sk = TreeGenerator.buildSkeleton({ species: 'MAPLE', profile, seed, height, withFoliageAccents: true });
  const geom = TreeGenerator.meshSkeleton(sk, { withFoliageAccents: true });

  const trunk = sk.stems.find(s => s.level === 0)!;
  const trunkTopY = trunk.py[trunk.py.length - 1] * sk.scale;
  const trunkBaseY = trunk.py[0] * sk.scale;

  // Znajdź pierwszą gałąź wyrastającą z pnia
  let firstBranchY = Infinity;
  for (const s of sk.stems) {
    if (s.level === 1) {
      if (s.py[0] * sk.scale < firstBranchY) firstBranchY = s.py[0] * sk.scale;
    }
  }

  // Policz gałęzie i punkty w górnych 15% korony
  const thresholdY = height * 0.85;
  let apexStems = 0;
  let apexPoints = 0;
  for (const s of sk.stems) {
    let inApex = false;
    for (const y of s.py) {
      if (y * sk.scale >= thresholdY) {
        apexPoints++;
        inApex = true;
      }
    }
    if (inApex) apexStems++;
  }

  console.log(`=== ${name} (H=${height}m) ===`);
  console.log(`Trunk Base Y: ${trunkBaseY.toFixed(2)}m, Trunk Top Y: ${trunkTopY.toFixed(2)}m (${(trunkTopY/height*100).toFixed(1)}% of H)`);
  console.log(`First Branch Y: ${firstBranchY.toFixed(2)}m (${(firstBranchY/height*100).toFixed(1)}% of H)`);
  console.log(`Apex (top 15% >= ${thresholdY.toFixed(2)}m): ${apexStems} stems, ${apexPoints} stem points`);
  console.log(`Bounds Height: ${geom.bounds.height.toFixed(2)}m, Crown Radius: ${geom.bounds.crownRadius.toFixed(2)}m`);
}

analyzeTree('Klon 9m', p9, 101, 9.0);
analyzeTree('Klon 15m', p15, 2024, 15.0);
