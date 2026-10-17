import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';

async function main() {
  const refDir = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/klon-jawor_Acer';
  const outDir = '/Users/ws/.gemini/antigravity-cli/brain/edf8e0b7-9a5d-469e-8ece-91be40f78015/tree-renders';

  const p6 = JSON.parse(fs.readFileSync(`${refDir}/klon_6m_cukrowy.json`, 'utf8'));
  const p9 = JSON.parse(fs.readFileSync(`${refDir}/klon_9m_zloty.json`, 'utf8'));
  const p15 = JSON.parse(fs.readFileSync(`${refDir}/klon_15m_korona.json`, 'utf8'));

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

    const barkMat = new THREE.MeshBasicMaterial({ color: 0x4a3b32, side: THREE.DoubleSide });
    const barkSkeletonMat = new THREE.MeshBasicMaterial({ color: 0x1f1a17, side: THREE.DoubleSide });

    // Liście klonu 6m (czerwony/cukrowy)
    const leafMats6m = [
      new THREE.MeshBasicMaterial({ color: 0xc49174, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0xb35a38, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x732918, side: THREE.DoubleSide }),
    ];

    // Liście klonu 9m (złoty/zwyczajny)
    const leafMats9m = [
      new THREE.MeshBasicMaterial({ color: 0xfda460, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0xb06744, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x553c1d, side: THREE.DoubleSide }),
    ];

    // Liście klonu 15m (złocisto-oliwkowy/dojrzały)
    const leafMats15m = [
      new THREE.MeshBasicMaterial({ color: 0xdf9b3a, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x8a8738, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0xbf672b, side: THREE.DoubleSide }),
    ];

    const groundY = 1.0;

    // Drzewo 6m (pozycja x = -11.5)
    const res6m = TreeGenerator.generate({
      species: 'OAK', height: 6.0, seed: 42,
      profile: ${JSON.stringify(p6)},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: true, detail: 'HIGH',
    });
    const m6Full = new THREE.Mesh(res6m.geometry, [barkMat, ...leafMats6m]);
    m6Full.position.set(-11.5, groundY, 0);
    scene.add(m6Full);

    const res6mBark = TreeGenerator.generate({
      species: 'OAK', height: 6.0, seed: 42,
      profile: ${JSON.stringify(p6)},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: false, detail: 'HIGH',
    });
    const m6Bark = new THREE.Mesh(res6mBark.geometry, [barkSkeletonMat, ...leafMats6m]);
    m6Bark.position.set(-11.5, groundY, 0);
    m6Bark.visible = false;
    scene.add(m6Bark);

    // Drzewo 9m (pozycja x = -4.0)
    const res9m = TreeGenerator.generate({
      species: 'OAK', height: 9.0, seed: 101,
      profile: ${JSON.stringify(p9)},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: true, detail: 'HIGH',
    });
    const m9Full = new THREE.Mesh(res9m.geometry, [barkMat, ...leafMats9m]);
    m9Full.position.set(-4.0, groundY, 0);
    scene.add(m9Full);

    const res9mBark = TreeGenerator.generate({
      species: 'OAK', height: 9.0, seed: 101,
      profile: ${JSON.stringify(p9)},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: false, detail: 'HIGH',
    });
    const m9Bark = new THREE.Mesh(res9mBark.geometry, [barkSkeletonMat, ...leafMats9m]);
    m9Bark.position.set(-4.0, groundY, 0);
    m9Bark.visible = false;
    scene.add(m9Bark);

    // Drzewo 15m (pozycja x = 7.5)
    const res15m = TreeGenerator.generate({
      species: 'OAK', height: 15.0, seed: 2024,
      profile: ${JSON.stringify(p15)},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: true, detail: 'HIGH',
    });
    const m15Full = new THREE.Mesh(res15m.geometry, [barkMat, ...leafMats15m]);
    m15Full.position.set(7.5, groundY, 0);
    scene.add(m15Full);

    const res15mBark = TreeGenerator.generate({
      species: 'OAK', height: 15.0, seed: 2024,
      profile: ${JSON.stringify(p15)},
      stroke: ILLUSTRATION_STROKE, withFoliageAccents: false, detail: 'HIGH',
    });
    const m15Bark = new THREE.Mesh(res15mBark.geometry, [barkSkeletonMat, ...leafMats15m]);
    m15Bark.position.set(7.5, groundY, 0);
    m15Bark.visible = false;
    scene.add(m15Bark);

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

    window.__SET_MODE = (mode) => {
      if (mode === 'full') {
        m6Full.visible = true; m6Bark.visible = false;
        m9Full.visible = true; m9Bark.visible = false;
        m15Full.visible = true; m15Bark.visible = false;
      } else {
        m6Full.visible = false; m6Bark.visible = true;
        m9Full.visible = false; m9Bark.visible = true;
        m15Full.visible = false; m15Bark.visible = true;
      }
      renderer.render(scene, camera);

      ctx.clearRect(0, 0, ${width}, ${heightPx});

      // Linia gruntu na y = 1.0
      const pG = worldToScreen(0, groundY);
      ctx.strokeStyle = '#d4d4d8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(40, pG.py);
      ctx.lineTo(${width} - 40, pG.py);
      ctx.stroke();

      // Podziałka wysokości
      for (let y = 0; y <= 16; y++) {
        const pt = worldToScreen(-16.0, groundY + y);
        ctx.strokeStyle = y % 5 === 0 ? '#71717a' : '#a1a1aa';
        ctx.lineWidth = y % 5 === 0 ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(pt.px, pt.py);
        ctx.lineTo(pt.px + (y % 5 === 0 ? 16 : 8), pt.py);
        ctx.stroke();
        ctx.fillStyle = '#71717a';
        ctx.font = '11px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(y + 'm', pt.px - 6, pt.py + 4);
      }

      // Nagłówek
      ctx.textAlign = 'left';
      ctx.fillStyle = '#18181b';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('ZESTAWIENIE SYLWETEK W SKALI — KLON (Acer)', 60, 50);

      ctx.fillStyle = '#71717a';
      ctx.font = '14px sans-serif';
      ctx.fillText('Wspólny poziom gruntu (0.0 m)  |  Styl architektoniczny B/B2  |  ' + (mode === 'full' ? 'Pełne ulistnienie jesienne' : 'Szkielet kory i konarów'), 60, 76);

      ctx.textAlign = 'center';

      // Klon 6m
      const box6 = res6m.geometry.boundingBox!;
      const w6 = box6.max.x - box6.min.x;
      const h6 = box6.max.y - box6.min.y;
      const p6S = worldToScreen(-11.5, groundY);
      ctx.fillStyle = '#18181b'; ctx.font = 'bold 15px sans-serif';
      ctx.fillText('KLON 6m (cukrowy)', p6S.px, pG.py + 45);
      ctx.fillStyle = '#71717a'; ctx.font = '13px sans-serif';
      ctx.fillText('H = ' + h6.toFixed(2) + ' m | W = ' + w6.toFixed(2) + ' m', p6S.px, pG.py + 65);
      ctx.fillText('W/H = ' + (w6 / h6).toFixed(3) + ' | smukły owalny', p6S.px, pG.py + 83);

      // Klon 9m
      const box9 = res9m.geometry.boundingBox!;
      const w9 = box9.max.x - box9.min.x;
      const h9 = box9.max.y - box9.min.y;
      const p9S = worldToScreen(-4.0, groundY);
      ctx.fillStyle = '#18181b'; ctx.font = 'bold 15px sans-serif';
      ctx.fillText('KLON 9m (złocisty)', p9S.px, pG.py + 45);
      ctx.fillStyle = '#71717a'; ctx.font = '13px sans-serif';
      ctx.fillText('H = ' + h9.toFixed(2) + ' m | W = ' + w9.toFixed(2) + ' m', p9S.px, pG.py + 65);
      ctx.fillText('W/H = ' + (w9 / h9).toFixed(3) + ' | kopulasty', p9S.px, pG.py + 83);

      // Klon 15m
      const box15 = res15m.geometry.boundingBox!;
      const w15 = box15.max.x - box15.min.x;
      const h15 = box15.max.y - box15.min.y;
      const p15S = worldToScreen(7.5, groundY);
      ctx.fillStyle = '#18181b'; ctx.font = 'bold 15px sans-serif';
      ctx.fillText('KLON 15m (zwyczajny)', p15S.px, pG.py + 45);
      ctx.fillStyle = '#71717a'; ctx.font = '13px sans-serif';
      ctx.fillText('H = ' + h15.toFixed(2) + ' m | W = ' + w15.toFixed(2) + ' m', p15S.px, pG.py + 65);
      ctx.fillText('W/H = ' + (w15 / h15).toFixed(3) + ' | rozłożysta korona', p15S.px, pG.py + 83);
    };

    window.__READY = true;
  `;

  const bundle = await esbuild.build({
    stdin: { contents: clientCode, resolveDir: path.resolve('scripts'), loader: 'ts' },
    bundle: true, write: false, format: 'iife', target: 'es2022',
  });

  const bundledJs = bundle.outputFiles[0].text;

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
  await page.waitForFunction(() => (window as any).__READY === true, { timeout: 20000 });

  fs.mkdirSync(outDir, { recursive: true });

  // 1. Full Lineup (6m, 9m, 15m)
  await page.evaluate(() => (window as any).__SET_MODE('full'));
  const fullPath15 = `${outDir}/klon_lineup_6m_9m_15m.png`;
  await page.screenshot({ path: fullPath15 });
  fs.copyFileSync(fullPath15, `${refDir}/klon_lineup_6m_9m_15m.png`);
  fs.copyFileSync(fullPath15, `${outDir}/klon_lineup_6m_9m.png`);
  fs.copyFileSync(fullPath15, `${refDir}/klon_lineup_6m_9m.png`);
  console.log('Saved: klon_lineup_6m_9m_15m.png');

  // 2. Bark Lineup (6m, 9m, 15m)
  await page.evaluate(() => (window as any).__SET_MODE('bark'));
  const barkPath15 = `${outDir}/klon_lineup_6m_9m_15m_bark.png`;
  await page.screenshot({ path: barkPath15 });
  fs.copyFileSync(barkPath15, `${refDir}/klon_lineup_6m_9m_15m_bark.png`);
  fs.copyFileSync(barkPath15, `${outDir}/klon_lineup_6m_9m_bark.png`);
  fs.copyFileSync(barkPath15, `${refDir}/klon_lineup_6m_9m_bark.png`);
  console.log('Saved: klon_lineup_6m_9m_15m_bark.png');

  await browser.close();
  server.close();
}

main();
