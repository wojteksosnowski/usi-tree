/**
 * Plansza porównawcza gatunku: zdjęcia wzorców danej wysokości obok modelu (ulistnienie B2 + szkielet kory)
 * na wspólnej podziałce metrycznej; opcjonalnie triada `renderSingleTree`.
 *
 *   NODE_NO_WARNINGS=1 npx tsx scripts/treeFit/renderSpeciesBoard.ts jesion 15     # gatunek, wysokość
 *   NODE_NO_WARNINGS=1 npx tsx scripts/treeFit/renderSpeciesBoard.ts wiaz --triad  # wszystkie wysokości + triady
 *   NODE_NO_WARNINGS=1 npx tsx scripts/treeFit/renderSpeciesBoard.ts --all
 *
 * Profil: strojony plik JSON gatunku (źródło strojenia), a bez niego — profil aplikacji (`treeKindParams`).
 * Rozjazd strojonego profilu z aplikacją jest zgłaszany ostrzeżeniem. Obrys drzewa na zdjęciu — automatycznie.
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import { SPECIES_PROFILES } from '../../src/index.js';
import { treeKindParams, type TreeKind } from '../../src/index.js';
import { shiftLeafColor } from './leafTint.js';
import { imageToPngDataUrl } from './imageDataUrl';
import { renderSingleTree } from './renderSingleTree';
import { OUT_DIR, DRZEWA_DIR, SPECIES, photoSilhouette, profilePath, speciesPhotos, type SpeciesRef } from './speciesRefs';

const SEED = 108;
const BARK_COLOR = 0x4a4742;
const LEAF_COLORS = [0x7eae2e, 0x5c8e22, 0x3d6816];
const BOARD_HEIGHT_PX = 1100;

/** Tony listowia planszy przesunięte jak w aplikacji (`leafToneShift` rodzaju, bez oświetlenia sceny) */
function tintedLeafColors(kind: TreeKind): number[] {
  return LEAF_COLORS.map((c) => shiftLeafColor(c, kind).getHex());
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

/** Profil modelu: strojony (z ostrzeżeniem o rozjeździe z aplikacją) albo z aplikacji */
export function modelProfile(sp: SpeciesRef, h: number) {
  const app = treeKindParams(sp.kind, h);
  const appProfile = app.profile ?? SPECIES_PROFILES[app.species];
  const file = profilePath(sp, h);
  if (!file) return { species: app.species, form: app.form, profile: appProfile, source: 'aplikacja' };
  // form — pole wpisu w aplikacji, name — etykieta pliku wzorca: poza profilem
  const { form, name: _name, ...tuned } = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (JSON.stringify(sortKeys(tuned)) !== JSON.stringify(sortKeys(app.profile))) {
    console.warn(`[${sp.key} ${h} m] profil strojony różni się od aplikacji — wdrożenie nieaktualne`);
  }
  return { species: app.species, form: form ?? app.form, profile: tuned, source: path.basename(file) };
}

async function renderBoard(sp: SpeciesRef, h: number) {
  const photos = speciesPhotos(sp).filter((p) => p.height === h);
  const crops = await Promise.all(photos.map(async (p) => (await photoSilhouette(p.path)).crop));
  const model = modelProfile(sp, h);

  // Układ kolumn w metrach: zdjęcia wg proporcji obrysu, modele wg rozpiętości korony z zapasem
  const gap = 0.08 * h;
  const modelW = 2 * model.profile.crownSpreadRatio * h * 1.3;
  const widths = [...crops.map((c) => (h * c[2]) / c[3]), modelW, modelW];
  const centers: number[] = [];
  let x = gap;
  for (const w of widths) {
    centers.push(x + w / 2);
    x += w + gap;
  }
  const worldW = x;
  const bottom = -0.12 * h;
  const top = 1.1 * h;
  const width = Math.round((worldW * BOARD_HEIGHT_PX) / (top - bottom));
  const labels = [...photos.map((p) => p.file.replace(/\.[a-z]+$/i, '').slice(0, 48)), 'Model 3D (ulistnienie B2)', 'Model 3D (szkielet kory)'];
  const photoUrls = photos.map((p) => imageToPngDataUrl(p.path));

  const clientCode = `
    import * as THREE from 'three';
    import { TreeGenerator, ILLUSTRATION_STROKE } from '${path.resolve(__dirname, '../../src/index.ts').replace(/\\/g, '/')}';

    const W = ${width}, H = ${BOARD_HEIGHT_PX}, h = ${h};
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('webgl-canvas'), antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(2);
    renderer.setSize(W, H);
    renderer.setClearColor(0xfcfbf9, 1.0);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, ${worldW}, ${top}, ${bottom}, 1, 500);
    camera.position.set(0, 0, 100);

    const profile = ${JSON.stringify(model.profile)};
    const centers = ${JSON.stringify(centers)};
    const nPhotos = ${photos.length};
    const leafMats = ${JSON.stringify(tintedLeafColors(sp.kind))}.map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    const params = { species: '${model.species}', height: h, seed: ${SEED}, profile, form: '${model.form}', stroke: ILLUSTRATION_STROKE, detail: 'HIGH' };

    const foliage = TreeGenerator.generate({ ...params, withFoliageAccents: true });
    const meshFoliage = new THREE.Mesh(foliage.geometry, [new THREE.MeshBasicMaterial({ color: ${BARK_COLOR}, side: THREE.DoubleSide }), ...leafMats]);
    meshFoliage.position.set(centers[nPhotos], 0, 0);
    scene.add(meshFoliage);

    const bark = TreeGenerator.generate({ ...params, withFoliageAccents: false });
    const meshBark = new THREE.Mesh(bark.geometry, [new THREE.MeshBasicMaterial({ color: 0x1f1d1b, side: THREE.DoubleSide })]);
    meshBark.position.set(centers[nPhotos + 1], 0, 0);
    scene.add(meshBark);
    renderer.render(scene, camera);

    const overlay = document.getElementById('overlay-canvas');
    overlay.width = W * 2;
    overlay.height = H * 2;
    const ctx = overlay.getContext('2d');
    ctx.scale(2, 2);
    const sx = (wx) => (wx / ${worldW}) * W;
    const sy = (wy) => ((${top} - wy) / (${top} - (${bottom}))) * H;

    // Podziałka metryczna i grunt
    ctx.strokeStyle = '#e4e4e7';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#a1a1aa';
    ctx.font = '11px sans-serif';
    const step = h >= 15 ? 2 : 1;
    for (let m = 0; m <= ${top}; m += step) {
      ctx.beginPath(); ctx.moveTo(0, sy(m)); ctx.lineTo(W, sy(m)); ctx.stroke();
      ctx.fillText(m + ' m', 8, sy(m) - 4);
    }
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, sy(0)); ctx.lineTo(W, sy(0)); ctx.stroke();
    ctx.setLineDash([]);

    const crops = ${JSON.stringify(crops)};
    const labels = ${JSON.stringify(labels)};
    const images = ${JSON.stringify(photoUrls)}.map((src) => { const img = new Image(); img.src = src; return img; });
    Promise.all(images.map((img) => img.decode())).then(() => {
      images.forEach((img, i) => {
        const [cx, cy, cw, ch] = crops[i];
        const tw = (h * cw / ch) / ${worldW} * W;
        ctx.drawImage(img, cx, cy, cw, ch, sx(centers[i]) - tw / 2, sy(h), tw, sy(0) - sy(h));
      });
      ctx.textAlign = 'center';
      ctx.fillStyle = '#18181b';
      ctx.font = 'bold 12px sans-serif';
      labels.forEach((label, i) => ctx.fillText(label, sx(centers[i]), sy(0) + 30));
      ctx.fillStyle = '#71717a';
      ctx.font = '11px sans-serif';
      ctx.fillText('H=' + h + ' m | W obwiedni=' + (2 * profile.crownSpreadRatio * h).toFixed(1) + ' m | ' + ${JSON.stringify(`${model.form} | ${model.source}`)}, sx(centers[nPhotos]), sy(0) + 46);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#09090b';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(${JSON.stringify(sp.label)} + ' ' + h + ' m — plansza porównawcza', 40, 32);
      window.__READY = true;
    });
  `;

  const bundle = await esbuild.build({
    stdin: { contents: clientCode, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
  });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
    body { margin: 0; background: #fcfbf9; overflow: hidden; font-family: -apple-system, sans-serif; }
    canvas { position: absolute; left: 0; top: 0; width: ${width}px; height: ${BOARD_HEIGHT_PX}px; }
  </style></head><body><canvas id="webgl-canvas"></canvas><canvas id="overlay-canvas"></canvas>
  <script>${bundle.outputFiles[0].text}</script></body></html>`;

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: BOARD_HEIGHT_PX }, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => (window as unknown as { __READY?: boolean }).__READY === true, { timeout: 30000 });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const name = `${sp.key}_${h}m_comparison_board.png`;
    await page.screenshot({ path: `${OUT_DIR}/${name}` });
    fs.copyFileSync(`${OUT_DIR}/${name}`, path.join(DRZEWA_DIR, sp.dir, name));
    console.log(`Saved comparison board: ${OUT_DIR}/${name}`);
  } finally {
    await browser.close();
    server.close();
  }
}

async function renderTriad(sp: SpeciesRef, h: number) {
  const model = modelProfile(sp, h);
  const outPrefix = `${OUT_DIR}/${sp.key}_${h}m`;
  await renderSingleTree({
    profile: { ...model.profile, form: model.form },
    species: model.species,
    height: h,
    outPrefix,
    seed: SEED,
    barkColor: BARK_COLOR,
    leafColors: LEAF_COLORS,
  });
  for (const suffix of ['.png', '_bark.png', '_iso.png']) {
    if (fs.existsSync(`${outPrefix}${suffix}`)) fs.copyFileSync(`${outPrefix}${suffix}`, path.join(DRZEWA_DIR, sp.dir, `${sp.key}_${h}m${suffix}`));
  }
}

/** Wysokości z wzorcami (zdjęcia) dla gatunku */
export const photoHeightsOf = (sp: SpeciesRef) => [...new Set(speciesPhotos(sp).map((p) => p.height))].sort((a, b) => a - b);

async function main() {
  const args = process.argv.slice(2);
  const withTriad = args.includes('--triad');
  const plain = args.filter((a) => !a.startsWith('--'));
  const species = args.includes('--all') ? SPECIES : SPECIES.filter((s) => s.key === plain[0]);
  if (!species.length) throw new Error(`Podaj gatunek (${SPECIES.map((s) => s.key).join(', ')}) albo --all`);
  const heights = plain.slice(1).map(Number);
  for (const sp of species) {
    for (const h of heights.length ? heights : photoHeightsOf(sp)) {
      await renderBoard(sp, h);
      if (withTriad) await renderTriad(sp, h);
    }
  }
}

if (process.argv[1]?.endsWith('renderSpeciesBoard.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
