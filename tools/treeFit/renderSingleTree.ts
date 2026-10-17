import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import type { TreeSpecies } from '../../src/index.js';

interface SingleTreeRenderOptions {
  /** Profil z pliku JSON albo podany wprost (`profile`) */
  profilePath?: string;
  profile?: Record<string, unknown>;
  height: number;
  outPrefix: string; // e.g. /path/to/birch_15m_pokroj
  seed?: number;
  species?: TreeSpecies;
  /** Szerokość kadru w px (domyślnie 1200 — mieści korony o W/H do ~0,94) */
  widthPx?: number;
  /** Bez linii gruntu i podziałki (render do pomiaru sylwetki) */
  bare?: boolean;
  leafColors?: number[];
  barkColor?: number;
}

export async function renderSingleTree(options: SingleTreeRenderOptions) {
  const { profilePath, height, outPrefix, seed = 42, species = 'OAK', leafColors, barkColor } = options;
  const profile = options.profile ?? JSON.parse(fs.readFileSync(profilePath!, 'utf8'));

  const width = options.widthPx ?? 1200;
  const heightPx = 1500;

  const isBirch = species === 'BIRCH';
  const customLeafColors = leafColors ? JSON.stringify(leafColors) : 'null';
  const customBarkColor = barkColor !== undefined ? barkColor : 'null';

  const clientCode = `
    import * as THREE from 'three';
    import { TreeGenerator, ILLUSTRATION_STROKE } from '${path.resolve(__dirname, '../../src/index.ts').replace(/\\/g, '/')}';

    const canvas = document.getElementById('webgl-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(2);
    renderer.setSize(${width}, ${heightPx});
    renderer.setClearColor(0xfcfbf9, 1.0);

    const scene = new THREE.Scene();

    // Materialy
    const isBirch = ${isBirch};
    const cLeaf = ${customLeafColors};
    const cBark = ${customBarkColor};
    const barkMat = new THREE.MeshBasicMaterial({ color: cBark !== null ? cBark : (isBirch ? 0xb88d66 : 0x4a3b32), side: THREE.DoubleSide });
    const barkSkeletonMat = new THREE.MeshBasicMaterial({ color: isBirch ? 0x18181b : 0x1f1a17, side: THREE.DoubleSide });
    const leafMats = cLeaf !== null ? cLeaf.map(c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })) : (isBirch ? [
      new THREE.MeshBasicMaterial({ color: 0xa8a66e, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x7a7a42, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x4f4b26, side: THREE.DoubleSide }),
    ] : [
      new THREE.MeshBasicMaterial({ color: 0xc49174, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0xb35a38, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x732918, side: THREE.DoubleSide }),
    ]);

    const H = ${height};
    const frustumH = H * 1.18;
    const aspect = ${width} / ${heightPx};
    const frustumW = frustumH * aspect;
    const centerY = H * 0.48;

    const orthoCam = new THREE.OrthographicCamera(
      -frustumW * 0.5, frustumW * 0.5,
      frustumH * 0.5, -frustumH * 0.5,
      1, 500
    );
    orthoCam.position.set(0, centerY, 100);
    orthoCam.lookAt(0, centerY, 0);

    // Iso camera
    const isoCam = new THREE.OrthographicCamera(
      -frustumW * 0.55, frustumW * 0.55,
      frustumH * 0.55, -frustumH * 0.55,
      1, 500
    );
    const isoDist = 120;
    const elev = Math.sin(30 * Math.PI / 180);
    const plan = Math.cos(30 * Math.PI / 180);
    isoCam.position.set(isoDist * plan * Math.sin(45 * Math.PI / 180), centerY + isoDist * elev, isoDist * plan * Math.cos(45 * Math.PI / 180));
    isoCam.lookAt(0, centerY, 0);

    // Siatka gruntu
    if (!${!!options.bare}) {
    const gridY = 0;
    const lineMat = new THREE.LineBasicMaterial({ color: 0xd4d4d8, transparent: true, opacity: 0.7 });
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-frustumW * 0.45, gridY, 0),
      new THREE.Vector3(frustumW * 0.45, gridY, 0)
    ]);
    scene.add(new THREE.Line(lineGeo, lineMat));

    // Podziałka wysokości co 1m i 5m
    for (let y = 0; y <= H + 1; y += 1) {
      const isMajor = y % 5 === 0;
      const tickW = isMajor ? 0.6 : 0.3;
      const tGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-frustumW * 0.42, y, 0),
        new THREE.Vector3(-frustumW * 0.42 + tickW, y, 0)
      ]);
      const tMat = new THREE.LineBasicMaterial({ color: isMajor ? 0x71717a : 0xa1a1aa, transparent: true, opacity: 0.8 });
      scene.add(new THREE.Line(tGeo, tMat));
    }
    }

    const resFull = TreeGenerator.generate({
      species: '${species}', height: H, seed: ${seed},
      profile: ${JSON.stringify(profile)}, form: ${JSON.stringify(profile.form ?? "SINGLE")},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: true, detail: 'HIGH',
    });
    const meshFull = new THREE.Mesh(resFull.geometry, [barkMat, ...leafMats]);
    scene.add(meshFull);

    const resBark = TreeGenerator.generate({
      species: '${species}', height: H, seed: ${seed},
      profile: ${JSON.stringify(profile)}, form: ${JSON.stringify(profile.form ?? "SINGLE")},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: false, detail: 'HIGH',
    });
    const meshBark = new THREE.Mesh(resBark.geometry, [barkSkeletonMat, ...leafMats]);
    meshBark.visible = false;
    scene.add(meshBark);

    window.__CAPTURE = async (viewMode) => {
      if (viewMode === 'full') {
        meshFull.visible = true;
        meshBark.visible = false;
        meshFull.rotation.set(0, 0, 0);
        renderer.render(scene, orthoCam);
      } else if (viewMode === 'bark') {
        meshFull.visible = false;
        meshBark.visible = true;
        meshBark.rotation.set(0, 0, 0);
        renderer.render(scene, orthoCam);
      } else if (viewMode === 'iso') {
        meshFull.visible = true;
        meshBark.visible = false;
        renderer.render(scene, isoCam);
      }
      return canvas.toDataURL('image/png');
    };

    window.__READY = true;
  `;

  const bundle = await esbuild.build({
    stdin: {
      contents: clientCode,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
  });

  const jsBundle = bundle.outputFiles[0].text;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body, html { margin: 0; padding: 0; background: #fcfbf9; overflow: hidden; }
        canvas { display: block; width: ${width}px; height: ${heightPx}px; }
      </style>
    </head>
    <body>
      <canvas id="webgl-canvas"></canvas>
      <script>${jsBundle}</script>
    </body>
    </html>
  `;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(htmlContent);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width, height: heightPx },
    deviceScaleFactor: 2,
  });

  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => (window as any).__READY === true, { timeout: 20000 });

  fs.mkdirSync(path.dirname(outPrefix), { recursive: true });

  // 1. Full view
  const fullData = await page.evaluate(async () => await (window as any).__CAPTURE('full'));
  const fullBuf = Buffer.from(fullData.split(',')[1], 'base64');
  const fullPath = `${outPrefix}.png`;
  fs.writeFileSync(fullPath, fullBuf);
  console.log('Saved:', fullPath);

  // 2. Bark view
  const barkData = await page.evaluate(async () => await (window as any).__CAPTURE('bark'));
  const barkBuf = Buffer.from(barkData.split(',')[1], 'base64');
  const barkPath = `${outPrefix}_bark.png`;
  fs.writeFileSync(barkPath, barkBuf);
  console.log('Saved:', barkPath);

  // 3. Iso view
  const isoData = await page.evaluate(async () => await (window as any).__CAPTURE('iso'));
  const isoBuf = Buffer.from(isoData.split(',')[1], 'base64');
  const isoPath = `${outPrefix}_iso.png`;
  fs.writeFileSync(isoPath, isoBuf);
  console.log('Saved:', isoPath);

  await browser.close();
  server.close();
}

if (process.argv[1]?.endsWith('renderSingleTree.ts')) {
  const profile = process.argv[2] ?? '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/brzoza_Betula/brzoza_15m_pokroj.json';
  const h = parseFloat(process.argv[3] ?? '15');
  const out = process.argv[4] ?? '/Users/ws/.gemini/antigravity-cli/brain/edf8e0b7-9a5d-469e-8ece-91be40f78015/tree-renders/birch_15m_pokroj';
  const species = (process.argv[5] as any) ?? (profile.includes('brzoza') ? 'BIRCH' : 'OAK');
  renderSingleTree({ profilePath: profile, height: h, outPrefix: out, species });
}
