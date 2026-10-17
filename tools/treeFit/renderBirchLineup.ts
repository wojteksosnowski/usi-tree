import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';

interface LineupOptions {
  profile6mPath: string;
  profile9mPath: string;
  profile15mPath: string;
  outPath: string;
  mode?: 'full' | 'bark';
  seed?: number;
}

export async function renderBirchLineup(options: LineupOptions) {
  const {
    profile6mPath,
    profile9mPath,
    profile15mPath,
    outPath,
    mode = 'full',
    seed = 42,
  } = options;

  const prof6m = JSON.parse(fs.readFileSync(profile6mPath, 'utf8'));
  const prof9m = JSON.parse(fs.readFileSync(profile9mPath, 'utf8'));
  const prof15m = JSON.parse(fs.readFileSync(profile15mPath, 'utf8'));

  const width = 1800;
  const heightPx = 1000;

  const clientCode = `
    import * as THREE from 'three';
    import { TreeGenerator, ILLUSTRATION_STROKE } from '${path.resolve(__dirname, '../../src/index.ts').replace(/\\/g, '/')}';

    const canvas = document.getElementById('webgl-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(2);
    renderer.setSize(${width}, ${heightPx});
    renderer.setClearColor(0xfcfbf9, 1.0);

    const scene = new THREE.Scene();

    // Kamera ortograficzna z poziomem gruntu y=0
    // Zakres pionowy: od y = -1.0m do y = 17.0m (frustumH = 18m)
    const frustumH = 18.0;
    const aspect = ${width} / ${heightPx};
    const frustumW = frustumH * aspect; // 32.4m

    const centerY = frustumH * 0.5 - 1.0; // 8.0m (y=0 jest na -1.0m od dołu kamery)

    const camera = new THREE.OrthographicCamera(
      -frustumW * 0.5, frustumW * 0.5,
      frustumH * 0.5, -frustumH * 0.5,
      1, 500
    );
    camera.position.set(0, centerY, 100);
    camera.lookAt(0, centerY, 0);

    const isBark = ${mode === 'bark'};
    const barkMat = new THREE.MeshBasicMaterial({
      color: isBark ? 0x18181b : 0xb88d66,
      side: THREE.DoubleSide
    });

    const leafMats = [
      new THREE.MeshBasicMaterial({ color: 0xa8a66e, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x7a7a42, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x4f4b26, side: THREE.DoubleSide }),
    ];

    // Drzewo 1: 6m na pozycji x = -10
    const res6m = TreeGenerator.generate({
      species: 'BIRCH',
      height: 6,
      seed: ${seed},
      profile: ${JSON.stringify(prof6m)},
      stroke: ILLUSTRATION_STROKE,
      withFoliageAccents: !isBark,
      detail: 'HIGH',
    });
    const mesh6m = new THREE.Mesh(res6m.geometry, [barkMat, ...leafMats]);
    mesh6m.position.set(-10, 0, 0);
    scene.add(mesh6m);

    // Drzewo 2: 9m na pozycji x = -1.5
    const res9m = TreeGenerator.generate({
      species: 'BIRCH',
      height: 9,
      seed: ${seed},
      profile: ${JSON.stringify(prof9m)},
      stroke: ILLUSTRATION_STROKE,
      withFoliageAccents: !isBark,
      detail: 'HIGH',
    });
    const mesh9m = new THREE.Mesh(res9m.geometry, [barkMat, ...leafMats]);
    mesh9m.position.set(-1.5, 0, 0);
    scene.add(mesh9m);

    // Drzewo 3: 15m na pozycji x = 8.5
    const res15m = TreeGenerator.generate({
      species: 'BIRCH',
      height: 15,
      seed: ${seed},
      profile: ${JSON.stringify(prof15m)},
      stroke: ILLUSTRATION_STROKE,
      withFoliageAccents: !isBark,
      detail: 'HIGH',
    });
    const mesh15m = new THREE.Mesh(res15m.geometry, [barkMat, ...leafMats]);
    mesh15m.position.set(8.5, 0, 0);
    scene.add(mesh15m);

    renderer.render(scene, camera);

    // Rysowanie podziałki i etykiet na overlay canvas 2D
    const overlay = document.getElementById('overlay-canvas');
    const ctx = overlay.getContext('2d');
    ctx.scale(2, 2); // dopasowanie do devicePixelRatio (canvas jest 3600x2000, współrzędne w logice 1800x1000)

    // Rzutowanie współrzędnych świata (wx, wy) na piksele logiczne (1800 x 1000)
    function worldToScreen(wx, wy) {
      const normX = (wx - (-frustumW * 0.5)) / frustumW;
      const normY = (wy - (-1.0)) / frustumH;
      const px = normX * ${width};
      const py = (1.0 - normY) * ${heightPx};
      return { px, py };
    }

    // Linia gruntu y = 0
    const gLeft = worldToScreen(-frustumW * 0.5, 0);
    const gRight = worldToScreen(frustumW * 0.5, 0);
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(gLeft.px, gLeft.py);
    ctx.lineTo(gRight.px, gRight.py);
    ctx.stroke();

    // Linie poziome podziałki co 1m i akcenty co 5m
    for (let m = 1; m <= 16; m++) {
      const pL = worldToScreen(-frustumW * 0.49, m);
      const pR = worldToScreen(frustumW * 0.49, m);
      const isMajor = m % 5 === 0;

      ctx.strokeStyle = isMajor ? 'rgba(39, 39, 42, 0.45)' : 'rgba(161, 161, 170, 0.20)';
      ctx.lineWidth = isMajor ? 1.0 : 0.6;
      if (isMajor) ctx.setLineDash([5, 4]); else ctx.setLineDash([2, 4]);

      ctx.beginPath();
      ctx.moveTo(pL.px, pL.py);
      ctx.lineTo(pR.px, pR.py);
      ctx.stroke();
      ctx.setLineDash([]);

      // Etykiety wysokości z lewej i prawej strony
      ctx.font = isMajor ? 'bold 13px sans-serif' : '11px sans-serif';
      ctx.fillStyle = isMajor ? '#18181b' : '#71717a';
      ctx.textAlign = 'right';
      ctx.fillText(m + ' m', pL.px - 10, pL.py + 4);
      ctx.textAlign = 'left';
      ctx.fillText(m + ' m', pR.px + 10, pR.py + 4);
    }

    // Etykiety kolumn drzew
    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#18181b';
    ctx.textAlign = 'center';

    const p6m = worldToScreen(-10, -0.6);
    ctx.fillText('BRZOZA 6m (okaz mały)', p6m.px, p6m.py);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#52525b';
    ctx.fillText('H = 6.0 m | W = ' + (res6m.bounds.crownRadius * 2).toFixed(2) + ' m', p6m.px, p6m.py + 20);

    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#18181b';
    const p9m = worldToScreen(-1.5, -0.6);
    ctx.fillText('BRZOZA 9m (zwisająca)', p9m.px, p9m.py);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#52525b';
    ctx.fillText('H = 9.0 m | W = ' + (res9m.bounds.crownRadius * 2).toFixed(2) + ' m', p9m.px, p9m.py + 20);

    ctx.font = 'bold 16px sans-serif';
    ctx.fillStyle = '#18181b';
    const p15m = worldToScreen(8.5, -0.6);
    ctx.fillText('BRZOZA 15m (okaz dorosły)', p15m.px, p15m.py);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#52525b';
    ctx.fillText('H = 15.0 m | W = ' + (res15m.bounds.crownRadius * 2).toFixed(2) + ' m', p15m.px, p15m.py + 20);

    window.__RENDER_DONE = true;
  `;

  const esbuildResult = await esbuild.build({
    stdin: {
      contents: clientCode,
      resolveDir: path.resolve('scripts'),
      sourcefile: 'bundle_lineup.js',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
  });

  const bundledJs = esbuildResult.outputFiles[0].text;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Birch Scale Lineup</title>
        <style>
          body, html { margin: 0; padding: 0; background: #fcfbf9; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          #webgl-canvas { width: ${width}px; height: ${heightPx}px; display: block; position: absolute; top: 0; left: 0; z-index: 1; }
          #overlay-canvas { width: ${width}px; height: ${heightPx}px; display: block; position: absolute; top: 0; left: 0; z-index: 2; pointer-events: none; }
        </style>
      </head>
      <body>
        <canvas id="webgl-canvas" width="${width * 2}" height="${heightPx * 2}"></canvas>
        <canvas id="overlay-canvas" width="${width * 2}" height="${heightPx * 2}"></canvas>
        <script>
          ${bundledJs}
        </script>
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
  await page.waitForFunction(() => (window as any).__RENDER_DONE === true, { timeout: 20000 });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath });

  await browser.close();
  server.close();
  console.log('Lineup rendered successfully to:', outPath);
}

if (process.argv[1]?.endsWith('renderBirchLineup.ts')) {
  const p6 = process.argv[2] ?? '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/brzoza_Betula/brzoza_mala_6m.json';
  const p9 = process.argv[3] ?? '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/brzoza_Betula/brzoza_9m_zwisajaca.json';
  const p15 = process.argv[4] ?? '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/brzoza_Betula/brzoza_15m_pokroj.json';
  const out = process.argv[5] ?? 'tmp/birch_lineup.png';
  const mode = (process.argv[6] as any) ?? 'full';
  renderBirchLineup({ profile6mPath: p6, profile9mPath: p9, profile15mPath: p15, outPath: out, mode });
}
