import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';

async function main() {
  const refDir = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/lipa_Tilia';
  const outDir = '/Users/ws/.gemini/antigravity-cli/brain/edf8e0b7-9a5d-469e-8ece-91be40f78015/tree-renders';

  const p6 = JSON.parse(fs.readFileSync(`${refDir}/lipa_6m_drobnolistna.json`, 'utf8'));
  const p9 = JSON.parse(fs.readFileSync(`${refDir}/lipa_9m_drobnolistna.json`, 'utf8'));
  const p15 = JSON.parse(fs.readFileSync(`${refDir}/lipa_15m_drobnolistna.json`, 'utf8'));

  const width = 1800;
  const heightPx = 1100;

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
    const centerY = 8.5;

    const camera = new THREE.OrthographicCamera(
      -frustumW * 0.5, frustumW * 0.5,
      frustumH * 0.5, -frustumH * 0.5,
      1, 500
    );
    camera.position.set(0, centerY, 100);
    camera.lookAt(0, centerY, 0);

    const barkMat = new THREE.MeshBasicMaterial({ color: 0x3d3530, side: THREE.DoubleSide });
    const barkSkeletonMat = new THREE.MeshBasicMaterial({ color: 0x1f1b18, side: THREE.DoubleSide });

    // Liście lipy 6m (świeża wiosenna zieleń)
    const leafMats6m = [
      new THREE.MeshBasicMaterial({ color: 0x98b83a, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x6e962b, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x47691d, side: THREE.DoubleSide }),
    ];

    // Liście lipy 9m (letnia soczysta zieleń)
    const leafMats9m = [
      new THREE.MeshBasicMaterial({ color: 0x8cb034, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x5e8523, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x3d5c17, side: THREE.DoubleSide }),
    ];

    // Liście lipy 15m (dojrzała, głęboka zieleń lipowa)
    const leafMats15m = [
      new THREE.MeshBasicMaterial({ color: 0x7a9e2d, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x4d731b, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x2e4a10, side: THREE.DoubleSide }),
    ];

    const groundY = 0.0;

    // Drzewo 6m (x = -11.5)
    const res6m = TreeGenerator.generate({
      species: 'OAK', height: 6.0, seed: 105,
      profile: ${JSON.stringify(p6)},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: true, detail: 'HIGH',
    });
    const m6Full = new THREE.Mesh(res6m.geometry, [barkMat, ...leafMats6m]);
    m6Full.position.set(-11.5, groundY, 0);
    scene.add(m6Full);

    const res6mBark = TreeGenerator.generate({
      species: 'OAK', height: 6.0, seed: 105,
      profile: ${JSON.stringify(p6)},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: false, detail: 'HIGH',
    });
    const m6Bark = new THREE.Mesh(res6mBark.geometry, [barkSkeletonMat, ...leafMats6m]);
    m6Bark.position.set(-11.5, groundY, 0);
    m6Bark.visible = false;
    scene.add(m6Bark);

    // Drzewo 9m (x = -4.0)
    const res9m = TreeGenerator.generate({
      species: 'OAK', height: 9.0, seed: 108,
      profile: ${JSON.stringify(p9)},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: true, detail: 'HIGH',
    });
    const m9Full = new THREE.Mesh(res9m.geometry, [barkMat, ...leafMats9m]);
    m9Full.position.set(-4.0, groundY, 0);
    scene.add(m9Full);

    const res9mBark = TreeGenerator.generate({
      species: 'OAK', height: 9.0, seed: 108,
      profile: ${JSON.stringify(p9)},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: false, detail: 'HIGH',
    });
    const m9Bark = new THREE.Mesh(res9mBark.geometry, [barkSkeletonMat, ...leafMats9m]);
    m9Bark.position.set(-4.0, groundY, 0);
    m9Bark.visible = false;
    scene.add(m9Bark);

    // Drzewo 15m (x = 7.5)
    const res15m = TreeGenerator.generate({
      species: 'OAK', height: 15.0, seed: 105,
      profile: ${JSON.stringify(p15)},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: true, detail: 'HIGH',
    });
    const m15Full = new THREE.Mesh(res15m.geometry, [barkMat, ...leafMats15m]);
    m15Full.position.set(7.5, groundY, 0);
    scene.add(m15Full);

    const res15mBark = TreeGenerator.generate({
      species: 'OAK', height: 15.0, seed: 105,
      profile: ${JSON.stringify(p15)},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: false, detail: 'HIGH',
    });
    const m15Bark = new THREE.Mesh(res15mBark.geometry, [barkSkeletonMat, ...leafMats15m]);
    m15Bark.position.set(7.5, groundY, 0);
    m15Bark.visible = false;
    scene.add(m15Bark);

    renderer.render(scene, camera);

    window.__SHOW_BARK__ = () => {
      m6Full.visible = false; m6Bark.visible = true;
      m9Full.visible = false; m9Bark.visible = true;
      m15Full.visible = false; m15Bark.visible = true;
      renderer.render(scene, camera);
    };

    window.__SHOW_FOLIAGE__ = () => {
      m6Full.visible = true; m6Bark.visible = false;
      m9Full.visible = true; m9Bark.visible = false;
      m15Full.visible = true; m15Bark.visible = false;
      renderer.render(scene, camera);
    };

    window.__READY__ = true;
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
    platform: 'browser',
    target: 'es2022',
  });

  const bundledJs = bundle.outputFiles[0].text;

  const html = `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body { margin: 0; padding: 0; background: #fcfbf9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
      #container { position: relative; width: ${width}px; height: ${heightPx}px; }
      #webgl-canvas { position: absolute; left: 0; top: 0; width: ${width}px; height: ${heightPx}px; z-index: 1; }
      #overlay { position: absolute; left: 0; top: 0; width: ${width}px; height: ${heightPx}px; z-index: 2; pointer-events: none; }
      .header {
        position: absolute;
        top: 24px;
        left: 36px;
        font-size: 20px;
        font-weight: 700;
        color: #1a252f;
        letter-spacing: -0.02em;
      }
      .label-col {
        position: absolute;
        bottom: 24px;
        text-align: center;
        background: rgba(255, 255, 255, 0.94);
        border: 1px solid rgba(0,0,0,0.08);
        border-radius: 8px;
        padding: 10px 16px;
        font-size: 13px;
        color: #2c3e50;
        box-shadow: 0 4px 12px rgba(0,0,0,0.04);
      }
      .label-title {
        font-weight: 700;
        font-size: 14px;
        color: #1a252f;
        margin-bottom: 4px;
      }
      .badge {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        background: #e8f5e9;
        color: #2e7d32;
        margin-top: 4px;
      }
    </style>
  </head>
  <body>
    <div id="container">
      <canvas id="webgl-canvas"></canvas>
      <div id="overlay">
        <div class="header" id="main-header">
          Lipa drobnolistna (Tilia cordata) — Skale 6m, 9m, 15m (Lineup Gatunku)
          <span style="font-size: 13px; font-weight: 400; color: #7f8c8d; margin-left: 16px;">
            Styl architektoniczny B/B2 | Proporcjonalny wzrost korony i pnia
          </span>
        </div>

        <!-- 6m -->
        <div class="label-col" style="left: 120px; width: 230px;">
          <div class="label-title">Lipa 6m (Młode drzewo)</div>
          Wysokość: 6.1m | Szerokość: 3.75m<br/>
          Pień: 24% H | W/H: 0.61<br/>
          <span class="badge">Ażur wiosenny</span>
        </div>

        <!-- 9m -->
        <div class="label-col" style="left: 540px; width: 250px;">
          <div class="label-title">Lipa 9m (Podrost miejski)</div>
          Wysokość: 9.0m | Szerokość: 5.55m<br/>
          Pień: 24.5% H | W/H: 0.61<br/>
          <span class="badge">Asymetria i gęste pędy</span>
        </div>

        <!-- 15m -->
        <div class="label-col" style="left: 1170px; width: 330px;">
          <div class="label-title">Lipa 15m (Dojrzały okaz parkowy)</div>
          Wysokość: 15.0m | Szerokość: 11.5m<br/>
          Pień: 23% H (odziomek 1.25) | W/H: 0.77<br/>
          <span class="badge">Sercowato-kulista korona</span>
        </div>
      </div>
    </div>
    <script>${bundledJs}</script>
  </body>
  </html>`;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err));
  await page.setViewportSize({ width, height: heightPx });
  await page.goto(`http://localhost:${port}`);

  await page.waitForFunction(() => (window as any).__READY__ === true, { timeout: 15000 });

  // 1. Lineup Foliage
  const outPathFoliage = `${outDir}/lipa_lineup_6m_9m_15m.png`;
  await page.screenshot({ path: outPathFoliage });
  console.log('Saved:', outPathFoliage);
  fs.copyFileSync(outPathFoliage, `${refDir}/lipa_lineup_6m_9m_15m.png`);

  // 2. Lineup Bark
  await page.evaluate(() => {
    (window as any).__SHOW_BARK__();
    const hdr = document.getElementById('main-header');
    if (hdr) {
      hdr.innerHTML = `Lipa drobnolistna (Tilia cordata) — Skale 6m, 9m, 15m (Architektura Pni i Konarów)
      <span style="font-size: 13px; font-weight: 400; color: #7f8c8d; margin-left: 16px;">
        Anatomia szkieletu bez ulistnienia | Odziomki i rozwidlenia konarów
      </span>`;
    }
  });

  const outPathBark = `${outDir}/lipa_lineup_6m_9m_15m_bark.png`;
  await page.screenshot({ path: outPathBark });
  console.log('Saved:', outPathBark);
  fs.copyFileSync(outPathBark, `${refDir}/lipa_lineup_6m_9m_15m_bark.png`);

  await browser.close();
  server.close();
}

main().catch(console.error);
