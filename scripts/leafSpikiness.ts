/**
 * Spiczastość liści: oryginał (bez LOD) vs poziomy LOD, dla kilku gatunków (profil widoku bliskiego aplikacji),
 * plus rzut boczny PNG (rasteryzacja programowa, bez WebGL).
 * Uruchomienie: `npx tsx scripts/leafSpikiness.ts [katalog-PNG]`
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from 'canvas';
import { TreeGenerator, ILLUSTRATION_STROKE, DEFAULT_LEAF_DENSITY } from '../src/core/TreeGenerator.js';
import { treeKindParams, type TreeKind } from '../src/core/treeSpeciesRegistry.js';
import { TREE_LOD_PRESETS, type TreeLodName } from '../src/core/treeLod.js';
import { leafSpikiness } from '../src/fitter/lodFidelity.js';
import { drawMeshSide } from './lib/meshRaster.js';
import type { RawTreeMesh, SpeciesProfile } from '../src/core/types.js';

const outDir = process.argv[2];
const kinds = ['Oak', 'Plane', 'Black Poplar', 'Linden'] as TreeKind[];
const seeds = [11, 22, 33];
const names: TreeLodName[] = ['near', 'mid', 'far', 'shell'];
const P = { withFoliageAccents: true, stroke: ILLUSTRATION_STROKE } as const;

function city(b: SpeciesProfile): SpeciesProfile {
  return {
    ...b,
    leafDensity: (b.leafDensity ?? DEFAULT_LEAF_DENSITY) * 0.3,
    leafSizeRatio: b.leafSizeRatio * 3.2,
    leafClump: Math.max(1, Math.round((b.leafClump ?? 4) * 0.4)),
  };
}

function render(meshes: RawTreeMesh[], file: string) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const m of meshes) {
    minX = Math.min(minX, m.boundingBox.min[0]); maxX = Math.max(maxX, m.boundingBox.max[0]);
    minY = Math.min(minY, m.boundingBox.min[1]); maxY = Math.max(maxY, m.boundingBox.max[1]);
  }
  const cell = 520, k = (cell - 40) / Math.max(maxX - minX, maxY - minY);
  const cv = createCanvas(cell * meshes.length, cell);
  const g = cv.getContext('2d');
  g.fillStyle = '#fcfbf9'; g.fillRect(0, 0, cv.width, cv.height);
  meshes.forEach((m, mi) => {
    const ox = mi * cell + 20 + (cell - 40 - (maxX - minX) * k) / 2;
    drawMeshSide(g, m, ox - minX * k, cell - 20 + minY * k, k);
  });
  fs.writeFileSync(file, cv.toBuffer('image/png'));
}

const f = (v: number) => v.toFixed(2);
for (const kind of kinds) {
  const acc: Record<string, { asp: number; prot: number }> = {};
  for (const seed of seeds) {
    const p = treeKindParams(kind, 10);
    const sk0 = TreeGenerator.buildSkeleton({ species: p.species, height: 10, seed, form: p.form, profile: p.profile });
    const sk = { ...sk0, profile: city(sk0.profile) };
    const orig = TreeGenerator.meshSkeletonRaw(sk, { ...P, detail: 'LOW', radialSegments: 4 }).mesh;
    const lods = TreeGenerator.meshSkeletonLodsRaw(sk, names.map((n) => TREE_LOD_PRESETS[n]), P).map((l) => l.mesh);
    const rows: [string, RawTreeMesh, number][] = [['orig', orig, 6], ['near', lods[0], 6], ['mid', lods[1], 6], ['far', lods[2], 5]];
    for (const [n, m, c] of rows) {
      const s = leafSpikiness(m, c, orig);
      const a = (acc[n] ??= { asp: 0, prot: 0 });
      a.asp += s.p90Aspect / seeds.length; a.prot += s.protrudeShare / seeds.length;
    }
    if (outDir && seed === seeds[0]) {
      fs.mkdirSync(outDir, { recursive: true });
      render([orig, ...lods], path.join(outDir, `${kind.replace(/ /g, '_')}.png`));
    }
  }
  console.log(kind.padEnd(13), Object.entries(acc).map(([n, a]) => `${n} p90=${f(a.asp)} wyst=${f(a.prot)}`).join(' | '));
}
