import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';

async function main() {
  const refDir = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/lipa_Tilia';
  const outDir = '/Users/ws/.gemini/antigravity-cli/brain/edf8e0b7-9a5d-469e-8ece-91be40f78015/tree-renders';

  const p9 = JSON.parse(fs.readFileSync(`${refDir}/lipa_9m_drobnolistna.json`, 'utf8'));

  // Testujemy warianty dla 9m:
  // p9_A: obecny (clipProb: 0.68, count: 22)
  // p9_B: clipProb: 0.60 (więcej swobodnych witek poza obwiednię), count: 24 (+10% gałązek)
  // p9_C: clipProb: 0.55, count: 24

  const p9_B = {
    ...p9,
    envelopeClipProbability: 0.60,
    levels: [
      { ...p9.levels[0], count: 24 },
      { ...p9.levels[1], count: 7 },
      p9.levels[2],
    ],
  };

  const p9_C = {
    ...p9,
    envelopeClipProbability: 0.55,
    levels: [
      { ...p9.levels[0], count: 24 },
      { ...p9.levels[1], count: 7 },
      p9.levels[2],
    ],
  };

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

    const frustumH = 14.0;
    const aspect = ${width} / ${heightPx};
    const frustumW = frustumH * aspect;
    const centerY = 5.2;

    const camera = new THREE.OrthographicCamera(
      -frustumW * 0.5, frustumW * 0.5,
      frustumH * 0.5, -frustumH * 0.5,
      1, 500
    );
    camera.position.set(0, centerY, 100);
    camera.lookAt(0, centerY, 0);

    const barkMat = new THREE.MeshBasicMaterial({ color: 0x3d3530, side: THREE.DoubleSide });
    const leafMats = [
      new THREE.MeshBasicMaterial({ color: 0x8cb034, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x5e8523, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x3d5c17, side: THREE.DoubleSide }),
    ];

    function create(p, x) {
      const res = TreeGenerator.generate({
        species: 'OAK', height: 9.0, seed: 108,
        profile: p, stroke: ILLUSTRATION_STROKE, withFoliageAccents: true, detail: 'HIGH',
      });
      const m = new THREE.Mesh(res.geometry, [barkMat, ...leafMats]);
      m.position.set(x, 0, 0);
      scene.add(m);
      return res;
    }

    create(${JSON.stringify(p9)}, -6.5);
    create(${JSON.stringify(p9_B)}, 0.0);
    create(${JSON.stringify(p9_C)}, 6.5);

    renderer.render(scene, camera);

    const overlay = document.getElementById('overlay-canvas');
    overlay.width = ${width} * 2;
    overlay.height = ${heightPx} * 2;
    const ctx = overlay.getContext('2d');
    ctx.scale(2, 2);

    function worldToScreen(wx, wy) {
      const v = new THREE.Vector3(wx, wy, 0);
      v.project(camera);
      return { px: (v.x * 0.5 + 0.5) * ${width}, py: (-v.y * 0.5 + 0.5) * ${heightPx} };
    }

    const pG = worldToScreen(0, 0);
    ctx.strokeStyle = '#27272a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, pG.py); ctx.lineTo(${width}, pG.py); ctx.stroke();

    ctx.textAlign = 'center'; ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#18181b';
    ctx.fillText('A: Obecny (clip: 0.68, count: 22)', worldToScreen(-6.5, 0).px, pG.py + 35);
    ctx.fillText('B: clip: 0.60, count: 24 (+5-10% gałązek)', worldToScreen(0, 0).px, pG.py + 35);
    ctx.fillText('C: clip: 0.55, count: 24 (luźniejszy)', worldToScreen(6.5, 0).px, pG.py + 35);

    window.__READY = true;
  `;

  const bundle = await esbuild.build({
    stdin: { contents: clientCode, resolveDir: path.resolve('scripts'), loader: 'ts' },
    bundle: true, write: false, format: 'iife', target: 'es2022',
  });

  const bundledJs = bundle.outputFiles[0].text;

  const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body,html{margin:0;padding:0;background:#fcfbf9;overflow:hidden;width:${width}px;height:${heightPx}px;}#container{position:relative;width:${width}px;height:${heightPx}px;}canvas{position:absolute;left:0;top:0;width:${width}px;height:${heightPx}px;}</style></head><body><div id="container"><canvas id="webgl-canvas"></canvas><canvas id="overlay-canvas"></canvas></div><script>${bundledJs}</script></body></html>`;

  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(htmlContent); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height: heightPx }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => (window as any).__READY === true, { timeout: 20000 });

  const outPath = `${outDir}/lipa_9m_clip_test.png`;
  await page.screenshot({ path: outPath });
  console.log('Saved:', outPath);

  await browser.close();
  server.close();
}

main();
