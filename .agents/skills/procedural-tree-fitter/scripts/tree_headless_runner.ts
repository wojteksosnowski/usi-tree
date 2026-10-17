#!/usr/bin/env node
/**
 * tree_headless_runner.ts
 *
 * Narzędzie headless Playwright + Three.js do renderowania drzew z silnika USI Light:
 * - Renderuje drzewo w rzucie elewacyjnym (front) lub izometrycznym (3D),
 * - Wspiera wstrzykiwanie własnego profilu JSON (`SpeciesProfile`),
 * - Obsługuje styl architektoniczny B/B2 oraz tryb czystego szkieletu (bark_only),
 * - Zapisuje zrzut ekranu wysokiej rozdzielczości (PNG) do porównań wizualnych.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';

export interface HeadlessRenderOptions {
  species?: string;
  height?: number;
  seed?: number;
  view?: 'elevation' | 'isometric';
  mode?: 'style_b2' | 'style_fitted_b' | 'bark_only';
  profile?: any;
  stroke?: any;
  width?: number;
  heightPx?: number;
  outPath: string;
}

export async function renderTreeHeadless(options: HeadlessRenderOptions): Promise<string> {
  const {
    species = 'OAK',
    height = 12,
    seed = 42,
    view = 'elevation',
    mode = 'style_fitted_b',
    profile = null,
    stroke = null,
    width = 1200,
    heightPx = 1000,
    outPath,
  } = options;

  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });

  const clientCode = `
    import * as THREE from 'three';
    import { TreeGenerator, SPECIES_PROFILES, ILLUSTRATION_STROKE } from '${path.resolve('src/three/index').replace(/\\/g, '/')}';

    window.THREE = THREE;
    window.TreeGenerator = TreeGenerator;
    window.SPECIES_PROFILES = SPECIES_PROFILES;
    window.ILLUSTRATION_STROKE = ILLUSTRATION_STROKE;

    const canvas = document.getElementById('webgl-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(${width}, ${heightPx});
    renderer.setClearColor(0xfcfbf9, 1.0);

    window.renderTree = function(config) {
      const scene = new THREE.Scene();
      const frustum = config.view === 'isometric' ? 36 : 28;
      const aspect = ${width} / ${heightPx};

      const camera = new THREE.OrthographicCamera(
        -frustum * aspect * 0.5, frustum * aspect * 0.5,
        frustum * 0.75, -frustum * 0.25,
        1, 500
      );

      if (config.view === 'isometric') {
        camera.position.set(40, 35, 40);
        camera.lookAt(0, config.height * 0.45, 0);
      } else {
        camera.position.set(0, config.height * 0.45, 80);
        camera.lookAt(0, config.height * 0.45, 0);
      }

      const activeProfile = config.profile || SPECIES_PROFILES[config.species] || SPECIES_PROFILES.OAK;
      const activeStroke = config.stroke || ILLUSTRATION_STROKE;

      const genParams = {
        species: config.species,
        height: config.height,
        seed: config.seed,
        profile: activeProfile,
        stroke: activeStroke,
        withFoliageAccents: config.mode !== 'bark_only',
        detail: 'HIGH',
      };

      const result = TreeGenerator.generate(genParams);
      const isBarkOnly = config.mode === 'bark_only';

      // Materiał kory zgodny ze stylem ilustracji
      const barkMat = new THREE.MeshBasicMaterial({
        color: isBarkOnly ? 0x18181b : 0xb88d66,
        side: THREE.DoubleSide
      });

      const leafMats = [
        new THREE.MeshBasicMaterial({ color: 0xa8a66e, side: THREE.DoubleSide }),
        new THREE.MeshBasicMaterial({ color: 0x7a7a42, side: THREE.DoubleSide }),
        new THREE.MeshBasicMaterial({ color: 0x4f4b26, side: THREE.DoubleSide }),
      ];

      const mesh = new THREE.Mesh(result.geometry, [barkMat, ...leafMats]);
      scene.add(mesh);

      renderer.render(scene, camera);
      return true;
    };
  `;

  const esbuildResult = await esbuild.build({
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

  const bundleJs = esbuildResult.outputFiles[0].text;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body, html { margin: 0; padding: 0; overflow: hidden; background: #fcfbf9; }
          #webgl-canvas { width: ${width}px; height: ${heightPx}px; display: block; }
        </style>
      </head>
      <body>
        <canvas id="webgl-canvas" width="${width}" height="${heightPx}"></canvas>
        <script>${bundleJs}</script>
      </body>
    </html>
  `;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: heightPx } });
    await page.goto(`http://127.0.0.1:${port}`);

    await page.evaluate((cfg) => {
      return (window as any).renderTree(cfg);
    }, {
      species,
      height,
      seed,
      view,
      mode,
      profile,
      stroke,
    });

    await page.waitForTimeout(150);
    const canvasHandle = await page.$('#webgl-canvas');
    if (!canvasHandle) throw new Error('Canvas element not found in headless page');

    await canvasHandle.screenshot({ path: outPath });
  } finally {
    await browser.close();
    server.close();
  }

  return outPath;
}

// Obsługa CLI
if (process.argv[1] && process.argv[1].endsWith('tree_headless_runner.ts')) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Użycie:
  npx tsx tree_headless_runner.ts --out <plik.png> [opcje]

Opcje:
  --species <OAK|BIRCH|PINE|SPRUCE|POPLAR|WILLOW|ASH|ASPEN|BUSH>  (domyślnie OAK)
  --height <metry>                                                (domyślnie 12)
  --seed <liczba>                                                 (domyślnie 42)
  --view <elevation|isometric>                                    (domyślnie elevation)
  --mode <style_b2|style_fitted_b|bark_only>                      (domyślnie style_fitted_b)
  --profile <plik.json>                                           (wstrzykiwany SpeciesProfile)
  --out <ścieżka.png>                                             (ścieżka do pliku wyjściowego)
    `);
    process.exit(0);
  }

  const getArg = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const out = getArg('--out') || 'tmp/tree-render.png';
  const species = getArg('--species') || 'OAK';
  const height = parseFloat(getArg('--height') || '12');
  const seed = parseInt(getArg('--seed') || '42', 10);
  const view = (getArg('--view') || 'elevation') as any;
  const mode = (getArg('--mode') || 'style_fitted_b') as any;
  const profileFile = getArg('--profile');

  let profileData = null;
  if (profileFile && fs.existsSync(profileFile)) {
    profileData = JSON.parse(fs.readFileSync(profileFile, 'utf-8'));
  }

  renderTreeHeadless({
    species,
    height,
    seed,
    view,
    mode,
    profile: profileData,
    outPath: out,
  })
    .then((saved) => {
      console.log(`Pomyślnie wyrenderowano drzewo headless do: ${saved}`);
    })
    .catch((err) => {
      console.error('Błąd podczas renderowania headless:', err);
      process.exit(1);
    });
}
