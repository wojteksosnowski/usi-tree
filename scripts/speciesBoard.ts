/**
 * Plansza wszystkich rodzajów drzew z rejestru, każdy o zadanej wysokości (domyślnie 12 m), w jednej skali px/m.
 * Uruchomienie: `npx tsx scripts/speciesBoard.ts <outDir> [--lod near|mid|far|all] [--height 12]`
 * Wyjście: board_near.png (zawsze) oraz board_lod.png (oryginał, near, mid, far, shell) dla --lod all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from 'canvas';
import { TreeGenerator, ILLUSTRATION_STROKE, DEFAULT_LEAF_DENSITY } from '../src/core/TreeGenerator.js';
import { treeKindParams, type TreeKind } from '../src/core/treeSpeciesRegistry.js';
import { SPECIES_PROFILES } from '../src/core/speciesProfiles.js';
import FITTED from '../src/core/fittedProfiles.json' with { type: 'json' };
import { TREE_LOD_PRESETS, type TreeLodName } from '../src/core/treeLod.js';
import type { RawTreeMesh, SpeciesProfile } from '../src/core/types.js';
import { drawMeshSide } from './lib/meshRaster.js';

const args = process.argv.slice(2);
const opt = (n: string, d: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const outDir = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!outDir) { console.error('użycie: speciesBoard.ts <outDir> [--lod near|mid|far|all] [--height 12]'); process.exit(1); }
const lodOpt = opt('--lod', 'all');
const H = Number(opt('--height', '12'));
const P = { withFoliageAccents: true, stroke: ILLUSTRATION_STROKE } as const;
const NAMES: TreeLodName[] = ['near', 'mid', 'far', 'shell'];

const PL: Record<string, string> = {
  OAK: 'Dąb (bazowy)', BIRCH: 'Brzoza', PINE: 'Sosna', SPRUCE: 'Świerk', POPLAR: 'Topola włoska', WILLOW: 'Wierzba',
  ASH: 'Jesion', ASPEN: 'Osika (bazowa)', BUSH: 'Krzew', Beech: 'Buk', Elm: 'Wiąz', Horsechestnut: 'Kasztanowiec',
  Linden: 'Lipa', Sycamore: 'Klon jawor', Oak: 'Dąb', 'Quaking Aspen': 'Osika', 'Weeping Willow': 'Wierzba płacząca',
  Viburnum: 'Kalina', Dogwood: 'Dereń', Apple: 'Jabłoń', Plane: 'Platan', 'Black Poplar': 'Topola czarna',
};

function city(b: SpeciesProfile): SpeciesProfile {
  return { ...b, leafDensity: (b.leafDensity ?? DEFAULT_LEAF_DENSITY) * 0.3, leafSizeRatio: b.leafSizeRatio * 3.2, leafClump: Math.max(1, Math.round((b.leafClump ?? 4) * 0.4)) };
}

interface Built { kind: string; orig: RawTreeMesh; lods: RawTreeMesh[]; h: number; w: number; target: number }
const extent = (m: RawTreeMesh) => ({
  h: m.boundingBox.max[1] - Math.min(0, m.boundingBox.min[1]),
  w: Math.max(m.boundingBox.max[0] - m.boundingBox.min[0], m.boundingBox.max[2] - m.boundingBox.min[2]),
});

function build(kind: TreeKind): Built {
  const seed = 11;
  let target = H, best: Built | null = null;
  for (let it = 0; it < 4; it++) {
    const p = treeKindParams(kind, target);
    const sk0 = TreeGenerator.buildSkeleton({ species: p.species, height: target, seed, form: p.form, profile: p.profile });
    const sk = { ...sk0, profile: city(sk0.profile) };
    const orig = TreeGenerator.meshSkeletonRaw(sk, { ...P, detail: 'LOW', radialSegments: 4 }).mesh;
    const lods = TreeGenerator.meshSkeletonLodsRaw(sk, NAMES.map((n) => TREE_LOD_PRESETS[n]), P).map((l) => l.mesh);
    const e = extent(lods[0]);
    best = { kind, orig, lods, h: e.h, w: e.w, target };
    if (Math.abs(e.h - H) < 0.15) break;
    target = target * H / e.h;
  }
  return best!;
}

const kinds: string[] = [...new Set<string>([...Object.keys(SPECIES_PROFILES), ...(FITTED as unknown as { ref: string }[]).map((f) => f.ref)])];
const built = kinds.map((k) => build(k as TreeKind));
for (const b of built) {
  const note = Math.abs(b.h - H) > 0.5 ? '  <-- NIE OSIĄGA' : '';
  console.log(`${b.kind.padEnd(16)} ${PL[b.kind] ?? b.kind}`.padEnd(40), `h=${b.h.toFixed(1)} m  w=${b.w.toFixed(1)} m  (param ${b.target.toFixed(1)})${note}`);
}

const wMax = Math.max(...built.map((b) => b.w));
const K = 22; // px/m, wspólne dla wszystkich
const colW = Math.ceil(Math.max(wMax, 6) * K) + 30;
const rowH = Math.ceil(Math.max(H, ...built.map((b) => b.h)) * K) + 70;
const scaleBar = (g: any, x: number, ground: number) => {
  g.strokeStyle = '#333'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, ground); g.lineTo(x, ground - H * K);
  g.moveTo(x - 4, ground); g.lineTo(x + 4, ground); g.moveTo(x - 4, ground - H * K); g.lineTo(x + 4, ground - H * K); g.stroke();
  g.fillStyle = '#333'; g.font = '12px sans-serif'; g.fillText(`${H} m`, x + 6, ground - H * K / 2);
};
const label = (g: any, b: Built, cx: number, ground: number, w = colW) => {
  g.fillStyle = '#111'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center';
  g.fillText(PL[b.kind] ?? b.kind, cx, ground + 18, w - 4);
  const short = b.h < H - 0.5;
  g.font = '12px sans-serif'; g.fillStyle = short ? '#b00020' : '#444';
  g.fillText(`${short ? 'max ' : ''}${b.h.toFixed(1)} m × ${b.w.toFixed(1)} m`, cx, ground + 34, w - 4); g.textAlign = 'left';
};
const ground = (g: any, x0: number, x1: number, y: number) => { g.strokeStyle = '#8a7a5a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); };

fs.mkdirSync(outDir, { recursive: true });
const margin = 50;
if (lodOpt === 'near' || lodOpt === 'all' || NAMES.includes(lodOpt as TreeLodName)) {
  const li = Math.max(0, NAMES.indexOf((lodOpt === 'all' ? 'near' : lodOpt) as TreeLodName));
  const cols = 6, rows = Math.ceil(built.length / cols);
  const cv = createCanvas(margin + cols * colW, rows * rowH + 10);
  const g = cv.getContext('2d'); g.fillStyle = '#fcfbf9'; g.fillRect(0, 0, cv.width, cv.height);
  built.forEach((b, i) => {
    const r = Math.floor(i / cols), c = i % cols, gy = r * rowH + 10 + Math.max(H, ...built.map((x) => x.h)) * K + 6;
    const cx = margin + c * colW + colW / 2;
    if (c === 0) { scaleBar(g, 28, gy); }
    ground(g, margin + c * colW + 4, margin + (c + 1) * colW - 4, gy);
    drawMeshSide(g, b.lods[li], cx, gy, K); label(g, b, cx, gy);
  });
  fs.writeFileSync(path.join(outDir, `board_${NAMES[li]}.png`), cv.toBuffer('image/png'));
}
if (lodOpt === 'all') {
  const per = 8, cols = 5;
  for (let part = 0; part * per < built.length; part++) {
    const slice = built.slice(part * per, part * per + per);
    const cv = createCanvas(margin + cols * colW, slice.length * rowH + 10);
    const g = cv.getContext('2d'); g.fillStyle = '#fcfbf9'; g.fillRect(0, 0, cv.width, cv.height);
    slice.forEach((b, r) => {
      const gy = r * rowH + 10 + Math.max(H, ...built.map((x) => x.h)) * K + 6;
      scaleBar(g, 28, gy);
      [b.orig, ...b.lods].forEach((m, c) => {
        const cx = margin + c * colW + colW / 2;
        ground(g, margin + c * colW + 4, margin + (c + 1) * colW - 4, gy);
        drawMeshSide(g, m, cx, gy, K);
        g.fillStyle = '#666'; g.font = '11px sans-serif'; g.fillText(['oryginał', ...NAMES][c], margin + c * colW + 6, gy - rowH + 90);
      });
      label(g, b, margin + colW / 2, gy);
    });
    fs.writeFileSync(path.join(outDir, `board_lod${built.length > per ? `_${part + 1}` : ''}.png`), cv.toBuffer('image/png'));
  }
}
