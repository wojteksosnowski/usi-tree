import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';

async function main() {
  const refDir = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/wiaz_Ulmus';
  const outDir = '/Users/ws/.gemini/antigravity-cli/brain/edf8e0b7-9a5d-469e-8ece-91be40f78015/tree-renders';

  const p6m = JSON.parse(fs.readFileSync(`${refDir}/wiaz_6m_ulmus.json`, 'utf8'));
  const p9m = JSON.parse(fs.readFileSync(`${refDir}/wiaz_9m_ulmus.json`, 'utf8'));
  const p15m = JSON.parse(fs.readFileSync(`${refDir}/wiaz_15m_ulmus.json`, 'utf8'));

  const width = 2400;
  const heightPx = 1200;

  async function renderLineup(withFoliage: boolean, filename: string) {
    const clientCode = `
      import * as THREE from 'three';
      import { TreeGenerator, ILLUSTRATION_STROKE } from '${path.resolve(__dirname, '../../src/index.ts').replace(/\\/g, '/')}';

      const webglCanvas = document.getElementById('webgl-canvas');
      const renderer = new THREE.WebGLRenderer({ canvas: webglCanvas, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(2);
      renderer.setSize(${width}, ${heightPx});
      renderer.setClearColor(0xfcfbf9, 1.0);

      const scene = new THREE.Scene();

      const frustumH = 20.0;
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

      const barkMat = new THREE.MeshBasicMaterial({ color: ${withFoliage ? 0x322d29 : 0x1a1715}, side: THREE.DoubleSide });
      const leafMats = [
        new THREE.MeshBasicMaterial({ color: 0x729c2e, side: THREE.DoubleSide }),
        new THREE.MeshBasicMaterial({ color: 0x4f7524, side: THREE.DoubleSide }),
        new THREE.MeshBasicMaterial({ color: 0x314f17, side: THREE.DoubleSide }),
      ];

      const p6 = ${JSON.stringify(p6m)};
      const p9 = ${JSON.stringify(p9m)};
      const p15 = ${JSON.stringify(p15m)};

      // 6m at x = -13.0
      const res6 = TreeGenerator.generate({
        species: 'OAK', height: 6.0, seed: 108,
        profile: p6, stroke: ILLUSTRATION_STROKE, withFoliageAccents: ${withFoliage}, detail: 'HIGH',
      });
      const m6 = new THREE.Mesh(res6.geometry, [barkMat, ...leafMats]);
      m6.position.set(-13.0, 0, 0);
      scene.add(m6);

      // 9m at x = -5.0
      const res9 = TreeGenerator.generate({
        species: 'OAK', height: 9.0, seed: 108,
        profile: p9, stroke: ILLUSTRATION_STROKE, withFoliageAccents: ${withFoliage}, detail: 'HIGH',
      });
      const m9 = new THREE.Mesh(res9.geometry, [barkMat, ...leafMats]);
      m9.position.set(-5.0, 0, 0);
      scene.add(m9);

      // 15m at x = 7.5
      const res15 = TreeGenerator.generate({
        species: 'OAK', height: 15.0, seed: 108,
        profile: p15, stroke: ILLUSTRATION_STROKE, withFoliageAccents: ${withFoliage}, detail: 'HIGH',
      });
      const m15 = new THREE.Mesh(res15.geometry, [barkMat, ...leafMats]);
      m15.position.set(7.5, 0, 0);
      scene.add(m15);

      renderer.render(scene, camera);

      // Overlay
      const overlay = document.getElementById('overlay-canvas');
      overlay.width = ${width} * 2;
      overlay.height = ${heightPx} * 2;
      const ctx = overlay.getContext('2d');
      ctx.scale(2, 2);

      function worldToScreen(wx, wy) {
        const v = new THREE.Vector3(wx, wy, 0);
        v.project(camera);
        return {
          px: (v.x * 0.5 + 0.5) * ${width},
          py: (-v.y * 0.5 + 0.5) * ${heightPx},
        };
      }

      ctx.clearRect(0, 0, ${width}, ${heightPx});

      // Siatka metryczna
      ctx.strokeStyle = '#e4e4e7';
      ctx.lineWidth = 1;
      for (let h = 0; h <= 18; h += 1) {
        const pL = worldToScreen(-frustumW * 0.5, h);
        const pR = worldToScreen(frustumW * 0.5, h);
        ctx.beginPath();
        ctx.moveTo(0, pL.py);
        ctx.lineTo(${width}, pR.py);
        ctx.stroke();

        ctx.fillStyle = '#a1a1aa';
        ctx.font = '11px sans-serif';
        ctx.fillText(h + ' m', 25, pL.py - 4);
      }

      // Grunt
      const pG = worldToScreen(0, 0);
      ctx.strokeStyle = '#27272a';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, pG.py);
      ctx.lineTo(${width}, pG.py);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#71717a';
      ctx.font = '11px sans-serif';
      ctx.fillText('0.0 m (poziom gruntu)', ${width} - 180, pG.py - 6);

      // Etykiety
      const p6Pos = worldToScreen(-13.0, 0);
      ctx.fillStyle = '#18181b';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Wiąz 6.0m (młody)', p6Pos.px, p6Pos.py + 32);
      ctx.fillStyle = '#71717a';
      ctx.font = '11px sans-serif';
      ctx.fillText('W = 2.76m | W/H = 0.46 | Pień 1.86m (31%)', p6Pos.px, p6Pos.py + 48);

      const p9Pos = worldToScreen(-5.0, 0);
      ctx.fillStyle = '#18181b';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Wiąz 9.0m (dojrzewający)', p9Pos.px, p9Pos.py + 32);
      ctx.fillStyle = '#71717a';
      ctx.font = '11px sans-serif';
      ctx.fillText('W = 6.45m | W/H = 0.71 | Pień 2.34m (26%)', p9Pos.px, p9Pos.py + 48);

      const p15Pos = worldToScreen(7.5, 0);
      ctx.fillStyle = '#18181b';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Wiąz 15.0m (dojrzały soliter)', p15Pos.px, p15Pos.py + 32);
      ctx.fillStyle = '#71717a';
      ctx.font = '11px sans-serif';
      ctx.fillText('W = 10.45m | W/H = 0.70 | Pień 3.15m (21%)', p15Pos.px, p15Pos.py + 48);

      // Tytuł
      ctx.fillStyle = '#09090b';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Wiąz (Ulmus) — Pełna Seria Gatunkowa 6m — 9m — 15m ${withFoliage ? "(Ulistnienie B2)" : "(Szkielet kory)"}', 40, 42);

      window.__READY = true;
    `;

    const buildRes = await esbuild.build({
      stdin: {
        contents: clientCode,
        resolveDir: process.cwd(),
        sourcefile: 'inlineElmLineupAll.ts',
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'ElmLineupAllViewer',
    });

    const bundledJs = buildRes.outputFiles[0].text;

    const html = `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <style>
        body { margin: 0; background: #fcfbf9; overflow: hidden; font-family: -apple-system, sans-serif; }
        #container { position: relative; width: ${width}px; height: ${heightPx}px; }
        #webgl-canvas { position: absolute; left: 0; top: 0; width: ${width}px; height: ${heightPx}px; }
        #overlay-canvas { position: absolute; left: 0; top: 0; width: ${width}px; height: ${heightPx}px; pointer-events: none; }
      </style>
    </head>
    <body>
      <div id="container">
        <canvas id="webgl-canvas"></canvas>
        <canvas id="overlay-canvas"></canvas>
      </div>
      <script>${bundledJs}</script>
    </body>
    </html>`;

    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });

    const port = 8951 + (withFoliage ? 0 : 1);
    await new Promise<void>((resolve) => server.listen(port, resolve));

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width, height: heightPx },
      deviceScaleFactor: 2,
    });

    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => (window as any).__READY === true, { timeout: 30000 });
    await page.waitForTimeout(500);

    const outPath = `${outDir}/${filename}`;
    const refPath = `${refDir}/${filename}`;
    await page.screenshot({ path: outPath });
    fs.copyFileSync(outPath, refPath);

    await browser.close();
    server.close();

    console.log(`Saved lineup: ${outPath}`);
  }

  await renderLineup(true, 'wiaz_lineup_6m_9m_15m.png');
  await renderLineup(false, 'wiaz_lineup_6m_9m_15m_bark.png');
}

main().catch(console.error);
