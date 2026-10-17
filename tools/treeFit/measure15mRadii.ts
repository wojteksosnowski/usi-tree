/**
 * Promienie pnia, konarów i gałęzi jesionu po kresce (`TreeGenerator.strokeStem` — ten sam limit grubości
 * co w renderze), dla profilu strojonego `jesion_<h>m_fraxinus.json`.
 *
 *   NODE_NO_WARNINGS=1 npx tsx scripts/treeFit/measure15mRadii.ts [wysokość=15]
 */
import fs from 'node:fs';
import { TreeGenerator, ILLUSTRATION_STROKE, type Stem } from '../../src/index.js';

const REF_DIR = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/jesion_Fraxinus';
const h = Number(process.argv[2] ?? 15);
const profile = JSON.parse(fs.readFileSync(`${REF_DIR}/jesion_${h}m_fraxinus.json`, 'utf8'));

const sk = TreeGenerator.buildSkeleton({ species: 'OAK', height: h, seed: 108, profile, form: profile.form ?? 'SINGLE', detail: 'HIGH' });
const trunkBaseR = TreeGenerator.trunkBaseRadius(sk.stems);
const stems = sk.stems.map((s) => TreeGenerator.strokeStem(s, ILLUSTRATION_STROKE, sk.height / sk.scale, trunkBaseR));
const cm = (r: number) => `${(r * sk.scale * 200).toFixed(1)} cm`;

function report(label: string, group: Stem[]) {
  if (!group.length) return;
  const base = group.map((s) => s.r[0]);
  const avg = base.reduce((a, b) => a + b, 0) / base.length;
  console.log(`${label} (${group.length}): średnica nasady max ${cm(Math.max(...base))}, średnio ${cm(avg)}`);
}

const trunk = stems.find((s) => s.level === 0)!;
console.log(`Jesion ${h} m — średnice po kresce`);
console.log(`Pień: nasada ${cm(trunk.r[0])}, środek ${cm(trunk.r[trunk.r.length >> 1])}, szczyt ${cm(trunk.r[trunk.r.length - 1])}`);
report('Przewodniki (rząd 0)', stems.filter((s) => s.level === 0));
report('Konary (rząd 1)', stems.filter((s) => s.level === 1));
report('Gałęzie (rząd 2)', stems.filter((s) => s.level === 2));
