/**
 * Szereg wysokości 6 / 8,5 / 12 / 17 / 24 m dla rodzajów z węzłami wysokości (profil z `treeKindParams`).
 * npx tsx scripts/treeFit/renderHeightScale.ts
 */
import fs from 'node:fs';
import { treeKindParams } from '../../src/index.js';
import { renderSingleTree } from './renderSingleTree';

const OUT = 'tmp/tree-renders/height-scale';
fs.mkdirSync(OUT, { recursive: true });
for (const [kind, name] of [['Linden', 'lipa'], ['Sycamore', 'klon'], ['BIRCH', 'brzoza'], ['Elm', 'wiaz']] as const) {
  for (const h of [6, 8.5, 12, 17, 24]) {
    const { species, profile } = treeKindParams(kind, h);
    const pp = `${OUT}/${name}_${h}m.json`;
    fs.writeFileSync(pp, JSON.stringify(profile));
    await renderSingleTree({ profilePath: pp, height: h, outPrefix: `${OUT}/${name}_${h}m`, species: species as 'OAK' | 'BIRCH' });
  }
}
