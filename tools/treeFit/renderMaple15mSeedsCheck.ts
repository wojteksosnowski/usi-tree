import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';

async function main() {
  const refDir = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/klon-jawor_Acer';
  const outDir = '/Users/ws/.gemini/antigravity-cli/brain/edf8e0b7-9a5d-469e-8ece-91be40f78015/tree-renders';
  const profile = JSON.parse(fs.readFileSync(`${refDir}/klon_15m_korona.json`, 'utf8'));

  profile.levels[0].count = 18;
  profile.levels[0].curve = 10;
  profile.levels[0].downAngleSlope = 12;
  profile.levels[0].tropism = 0.08;
  profile.leafDensity = 85;

  const seeds = [101, 13, 2024, 777];
  const width = 1600;
  const heightPx = 900;

  const clientCode = `
    import * as THREE from 'three';
    import { TreeGenerator, ILLUSTRATION_STROKE } from '${path.resolve(__dirname, '../../src/index.ts').replace(/\\/g, '/')}';

    const canvas = document.getElementById('webgl-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(2);
    renderer.setSize(${width}, ${heightPx});
    renderer.setClearColor(0xfcfbf9, 1.0);

    const scene = new THREE.Scene();

    const frustumH = 22.0;
    const aspect = ${width} / ${heightPx};
    const frustumW = frustumH * aspect;
    const centerY = 8.0;

    const camera = new THREE.OrthographicCamera(
      -frustumW * 0.5, frustumW * 0.5,
      frustumH * 0.5, -frustumH * 0.5,
      1, 500
    );
    camera.position.set(0, centerY, 100);
    camera.lookAt(0, centerY, 0);

    const barkMat = new THREE.MeshBasicMaterial({ color: 0x3a3028, side: THREE.DoubleSide });
    const leafMats = [
      new THREE.MeshBasicMaterial({ color: 0xdf9b3a, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x8a8738, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0xbf672b, side: THREE.DoubleSide }),
    ];

    const H = 15.0;
    const seeds = ${JSON.stringify(seeds)};
    const xs = [-14.0, -4.5, 4.5, 14.0];

    seeds.forEach((seed, idx) => {
      const resFull = TreeGenerator.generate({
        species: 'OAK', height: H, seed,
        profile: ${JSON.stringify(profile)},
        stroke: ILLUSTRATION_STROKE, withFoliageAccents: true, detail: 'HIGH',
      });
      const mFull = new THREE.Mesh(resFull.geometry, [barkMat, ...leafMats]);
      mFull.position.set(xs[idx], 0.5, 0);
      scene.add(mFull);
    });

    renderer.render(scene, camera);

    // Overlay 2D
    const overlay = document.getElementById('overlay-canvas');
    overlay.width = ${width} * 2;
    overlay.height = ${heightPx} * 2;
    overlay.style.width = '${width}px';
    overlay.style.height = '${heightPx}px';
    const ctx = overlay.getContext('2d');
    ctx.scale(2, 2);

    function worldToScreen(wx, wy) {
      const v = new THREE.Vector3(wx, wy, 0);
      v.project(camera);
      const px = (v.x * 0.5 + 0.5) * ${width};
      const py = (-v.y * 0.5 + 0.5) * ${heightPx};
      return { px, py };
    }

    ctx.fillStyle = '#18181b';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('KLON 15m — PORÓWNANIE KORONY DLA ZIAREN (seed 101, 13, 2024, 777)', 40, 45);

    seeds.forEach((seed, idx) => {
      const pG = worldToScreen(xs[idx], 0.5);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#18181b';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText('seed: ' + seed, pG.px, pG.py + 30);
    });

    window.__RENDER_DONE = true;
  `;

  const esbuildResult = await esbuild.build({
    stdin: { contents: clientCode, resolveDir: path.resolve('scripts'), loader: 'ts' },
    bundle: true, write: false, format: 'iife', target: 'es2022',
  });

  const bundledJs = esbuildResult.outputFiles[0].text;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body, html { margin: 0; padding: 0; background: #fcfbf9; overflow: hidden; width: ${width}px; height: ${heightPx}px; }
        #container { position: relative; width: ${width}px; height: ${heightPx}px; }
        canvas { position: absolute; left: 0; top: 0; width: ${width}px; height: ${heightPx}px; }
      </style>
    </head>
    <body>
      <div id="container">
        <canvas id="webgl-canvas"></canvas>
        <canvas id="overlay-canvas"></canvas>
      </div>
      <script>${bundledJs}</script>
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
  const page = await browser.newPage({ viewport: { width, height: heightPx }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => (window as any).__RENDER_DONE === true, { timeout: 20000 });

  const outPath = `${outDir}/klon_15m_seeds_check.png`;
  await page.screenshot({ path: outPath });
  console.log('Saved:', outPath);

  await browser.close();
  server.close();
}

main();
