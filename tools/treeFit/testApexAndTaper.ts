import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';

async function main() {
  const refDir = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/klon-jawor_Acer';
  const outDir = '/Users/ws/.gemini/antigravity-cli/brain/edf8e0b7-9a5d-469e-8ece-91be40f78015/tree-renders';

  const width = 1600;
  const heightPx = 1000;

  // Wczytaj obecne profile
  const p9 = JSON.parse(fs.readFileSync(`${refDir}/klon_9m_zloty.json`, 'utf8'));
  const p15 = JSON.parse(fs.readFileSync(`${refDir}/klon_15m_korona.json`, 'utf8'));

  // Utwórz wersje korygowane:
  // 1. Pierwsza gałąź niżej o ~15-18%:
  //    15m: trunkHeightRatio 0.27 -> 0.225
  //    9m: trunkHeightRatio 0.34 -> 0.28
  // 2. Gałęzie główne szybciej tracą grubość:
  //    levels[0].tipRatio = 0.28 (wcześniej sztywne 0.50)
  // 3. Wypełnienie czubka na końcu przewodnika:
  //    trunkLengthRatio: 15m z 0.70 -> 0.76; 9m z 0.72 -> 0.77
  //    trunkFork: true, trunkForkAngle: 20
  const p9_mod = {
    ...p9,
    trunkHeightRatio: 0.28,
    trunkLengthRatio: 0.77,
    trunkFork: true,
    trunkForkAngle: 20,
    levels: [
      { ...p9.levels[0], tipRatio: 0.28 },
      p9.levels[1],
      p9.levels[2],
    ],
  };

  const p15_mod = {
    ...p15,
    trunkHeightRatio: 0.225,
    trunkLengthRatio: 0.76,
    trunkFork: true,
    trunkForkAngle: 22,
    levels: [
      { ...p15.levels[0], tipRatio: 0.28 },
      p15.levels[1],
      p15.levels[2],
    ],
  };

  const clientCode = `
    import * as THREE from 'three';
    import { TreeGenerator, ILLUSTRATION_STROKE } from '${path.resolve(__dirname, '../../src/index.ts').replace(/\\/g, '/')}';

    const canvas = document.getElementById('webgl-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
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

    const barkMat = new THREE.MeshBasicMaterial({ color: 0x4a3b32, side: THREE.DoubleSide });
    const leafMats9m = [
      new THREE.MeshBasicMaterial({ color: 0xfda460, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0xb06744, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x553c1d, side: THREE.DoubleSide }),
    ];
    const leafMats15m = [
      new THREE.MeshBasicMaterial({ color: 0xdf9b3a, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x8a8738, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0xbf672b, side: THREE.DoubleSide }),
    ];

    const p9Orig = ${JSON.stringify(p9)};
    const p9Mod = ${JSON.stringify(p9_mod)};
    const p15Orig = ${JSON.stringify(p15)};
    const p15Mod = ${JSON.stringify(p15_mod)};

    function createTree(profile, seed, height, posX, leafMats) {
      const group = new THREE.Group();
      group.position.x = posX;

      const sk = TreeGenerator.buildSkeleton({ species: 'MAPLE', profile, seed, height, withFoliageAccents: true });
      const geomWithFoliage = TreeGenerator.meshSkeleton(sk, {
        stroke: ILLUSTRATION_STROKE,
        withFoliageAccents: true,
        radialSegments: profile.radialSegments ?? 4,
      });

      const trunkGeom = geomWithFoliage.geometry.clone();
      const groups = trunkGeom.groups;
      if (groups.length > 0) trunkGeom.clearGroups();
      trunkGeom.addGroup(0, groups[0].count, 0);
      const trunkMesh = new THREE.Mesh(trunkGeom, barkMat);
      trunkMesh.name = 'trunk';
      group.add(trunkMesh);

      const leafGroup = new THREE.Group();
      leafGroup.name = 'foliage';
      for (let g = 1; g < groups.length; g++) {
        const subGeom = geomWithFoliage.geometry.clone();
        subGeom.clearGroups();
        subGeom.addGroup(groups[g].start, groups[g].count, 0);
        const mat = leafMats[(g - 1) % leafMats.length];
        leafGroup.add(new THREE.Mesh(subGeom, mat));
      }
      group.add(leafGroup);
      return { group, bounds: geomWithFoliage.bounds, actualH: geomWithFoliage.bounds.height };
    }

    const t9Orig = createTree(p9Orig, 101, 9.0, -10.0, leafMats9m);
    const t9Mod = createTree(p9Mod, 101, 9.0, -4.0, leafMats9m);
    const t15Orig = createTree(p15Orig, 2024, 15.0, 3.5, leafMats15m);
    const t15Mod = createTree(p15Mod, 2024, 15.0, 11.5, leafMats15m);

    scene.add(t9Orig.group);
    scene.add(t9Mod.group);
    scene.add(t15Orig.group);
    scene.add(t15Mod.group);

    renderer.render(scene, camera);

    // Overlay 2D
    const overlay = document.getElementById('overlay-canvas');
    overlay.width = ${width} * 2;
    overlay.height = ${heightPx} * 2;
    const ctx = overlay.getContext('2d');
    ctx.scale(2, 2);

    function worldToScreen(wx, wy) {
      const v = new THREE.Vector3(wx, wy, 0);
      v.project(camera);
      return {
        x: (v.x * 0.5 + 0.5) * ${width},
        y: (-v.y * 0.5 + 0.5) * ${heightPx},
      };
    }

    function drawGrid() {
      ctx.clearRect(0, 0, ${width}, ${heightPx});
      ctx.strokeStyle = 'rgba(74, 59, 50, 0.15)';
      ctx.lineWidth = 1;

      for (let h = 0; h <= 18; h += 2) {
        const pL = worldToScreen(-frustumW * 0.5, h);
        const pR = worldToScreen(frustumW * 0.5, h);
        ctx.beginPath();
        ctx.moveTo(0, pL.y);
        ctx.lineTo(${width}, pR.y);
        ctx.stroke();

        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(74, 59, 50, 0.55)';
        ctx.fillText(h + 'm', 16, pL.y - 4);
      }

      // Linia gruntu
      const ground = worldToScreen(0, 0);
      ctx.strokeStyle = '#4a3b32';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, ground.y);
      ctx.lineTo(${width}, ground.y);
      ctx.stroke();

      // Podpisy
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillStyle = '#2b231d';

      const s9o = worldToScreen(-10.0, 0);
      ctx.fillText('9m PRZED (seed 101)', s9o.x - 70, ground.y + 24);
      const s9m = worldToScreen(-4.0, 0);
      ctx.fillText('9m PO KOREKCIE', s9m.x - 60, ground.y + 24);

      const s15o = worldToScreen(3.5, 0);
      ctx.fillText('15m PRZED (seed 2024)', s15o.x - 75, ground.y + 24);
      const s15m = worldToScreen(11.5, 0);
      ctx.fillText('15m PO KOREKCIE', s15m.x - 60, ground.y + 24);
    }

    drawGrid();

    window.__SET_MODE = (mode) => {
      [t9Orig, t9Mod, t15Orig, t15Mod].forEach(t => {
        const fol = t.group.getObjectByName('foliage');
        if (fol) fol.visible = (mode === 'full');
      });
      renderer.render(scene, camera);
      drawGrid();
    };

    window.__READY = true;
  `;

  // Najpierw upewnijmy się, że TreeGenerator ma wsparcie dla tipRatio i trunkFork!
  console.log('Ready to bundle and render comparison test.');

  const buildResult = await esbuild.build({
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
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  const bundledJs = buildResult.outputFiles[0].text;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { margin: 0; background: #fcfbf9; overflow: hidden; }
          #container { position: relative; width: ${width}px; height: ${heightPx}px; }
          canvas { position: absolute; left: 0; top: 0; }
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

  await page.evaluate(() => (window as any).__SET_MODE('full'));
  const testImg = `${outDir}/klon_test_apex_and_taper.png`;
  await page.screenshot({ path: testImg });
  console.log('Saved:', testImg);

  await page.evaluate(() => (window as any).__SET_MODE('bark'));
  const testBarkImg = `${outDir}/klon_test_apex_and_taper_bark.png`;
  await page.screenshot({ path: testBarkImg });
  console.log('Saved:', testBarkImg);

  await browser.close();
  server.close();
}

main();
