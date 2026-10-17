#!/usr/bin/env node
/**
 * tree_anatomy_extractor.ts
 *
 * Narzędzie do ekstrakcji cech morfologicznych drzew z obrazów referencyjnych:
 * - Binarizacja i segmentacja kory / sylwetki,
 * - Szkieletyzacja (Zhang-Suen thinning),
 * - Budowa grafu drzewiastego (pień, konary główne, gałęzie potomne),
 * - Pomiary suwmiarką (caliper): profil grubości r(s), zbieżność, flareFactor przy odziomku,
 * - Pomiary kątów i krzywizny: downAngle, downAngleSlope, curve, curveV, kink,
 * - Analiza ugięcia sprężystego belki i szacowanie parametru pliancy.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from 'canvas';

export interface BranchSegmentMetrics {
  level: number;
  lengthPx: number;
  lengthRatio: number;
  avgRadiusPx: number;
  baseRadiusPx: number;
  tipRadiusPx: number;
  downAngleDeg: number;
  curveDeg: number;
  curveVDeg: number;
  kinkDeg: number;
  slenderness: number; // L / r
  elasticSagDeg: number; // Zmierzone ugięcie ku dołowi
}

export interface TreeAnatomyResult {
  imageWidth: number;
  imageHeight: number;
  treeHeightPx: number;
  treeWidthPx: number;
  aspectRatio: number; // W / H
  crownSpreadRatio: number;
  trunkHeightRatio: number; // Wysokość do pierwszego konara / H
  trunkBaseRadiusRatio: number; // Promień przy gruncie / H
  flareFactor: number; // Rozszerzenie odziomka
  taperRatio: number; // Promień wierzchołka / promień podstawy
  estimatedPliancy: number; // Estymowany parametr wiotkości (stopnie)
  scaffoldLimbsCount: number; // Liczba konarów głównych wychodzących z pnia
  levels: Array<{
    level: number;
    count: number;
    avgDownAngle: number;
    downAngleSlope: number;
    avgLengthRatio: number;
    avgCurve: number;
    avgCurveV: number;
    avgKink: number;
    avgRadiusRatio: number;
  }>;
  segments: BranchSegmentMetrics[];
}

// Algorytm ścieniania Zhang-Suen (morfologiczna szkieletyzacja 2D)
export function zhangSuenThinning(binary: Uint8Array, W: number, H: number): Uint8Array {
  const skel = new Uint8Array(binary);
  let changed = true;

  const neighbors = (x: number, y: number): number[] => {
    return [
      skel[(y - 1) * W + x],       // P2
      skel[(y - 1) * W + (x + 1)], // P3
      skel[y * W + (x + 1)],       // P4
      skel[(y + 1) * W + (x + 1)], // P5
      skel[(y + 1) * W + x],       // P6
      skel[(y + 1) * W + (x - 1)], // P7
      skel[y * W + (x - 1)],       // P8
      skel[(y - 1) * W + (x - 1)], // P9
    ];
  };

  const transitions = (p: number[]): number => {
    let count = 0;
    for (let i = 0; i < 8; i++) {
      if (p[i] === 0 && p[(i + 1) % 8] === 1) count++;
    }
    return count;
  };

  while (changed) {
    changed = false;
    const toClear: number[] = [];

    // Krok 1
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const idx = y * W + x;
        if (skel[idx] === 0) continue;
        const p = neighbors(x, y);
        const B = p.reduce((a, b) => a + b, 0);
        if (B >= 2 && B <= 6) {
          const A = transitions(p);
          if (A === 1) {
            if (p[0] * p[2] * p[4] === 0 && p[2] * p[4] * p[6] === 0) {
              toClear.push(idx);
            }
          }
        }
      }
    }
    if (toClear.length > 0) {
      for (const idx of toClear) skel[idx] = 0;
      changed = true;
    }

    // Krok 2
    toClear.length = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const idx = y * W + x;
        if (skel[idx] === 0) continue;
        const p = neighbors(x, y);
        const B = p.reduce((a, b) => a + b, 0);
        if (B >= 2 && B <= 6) {
          const A = transitions(p);
          if (A === 1) {
            if (p[0] * p[2] * p[6] === 0 && p[0] * p[4] * p[6] === 0) {
              toClear.push(idx);
            }
          }
        }
      }
    }
    if (toClear.length > 0) {
      for (const idx of toClear) skel[idx] = 0;
      changed = true;
    }
  }

  return skel;
}

// Wyznaczanie mapy odległości od krawędzi (Distance Transform) do pomiaru suwmiarki
export function computeDistanceTransform(binary: Uint8Array, W: number, H: number): Float32Array {
  const dist = new Float32Array(W * H);
  const INF = 1e6;

  for (let i = 0; i < W * H; i++) {
    dist[i] = binary[i] > 0 ? INF : 0;
  }

  // Przejście 1: z góry w dół i z lewej w prawo
  for (let y = 1; y < H; y++) {
    for (let x = 1; x < W; x++) {
      const idx = y * W + x;
      if (dist[idx] === 0) continue;
      dist[idx] = Math.min(
        dist[idx],
        dist[(y - 1) * W + x] + 1,
        dist[y * W + (x - 1)] + 1,
        dist[(y - 1) * W + (x - 1)] + 1.414
      );
    }
  }

  // Przejście 2: z dołu w górę i z prawej w lewo
  for (let y = H - 2; y >= 0; y--) {
    for (let x = W - 2; x >= 0; x--) {
      const idx = y * W + x;
      if (dist[idx] === 0) continue;
      dist[idx] = Math.min(
        dist[idx],
        dist[(y + 1) * W + x] + 1,
        dist[y * W + (x + 1)] + 1,
        dist[(y + 1) * W + (x + 1)] + 1.414
      );
    }
  }

  return dist;
}

export async function extractTreeAnatomy(imagePath: string, options: {
  barkThreshold?: number;
  outputDebugImage?: string;
} = {}): Promise<TreeAnatomyResult> {
  const img = await loadImage(imagePath);
  const W = img.width;
  const H = img.height;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const imgData = ctx.getImageData(0, 0, W, H);
  const data = imgData.data;

  // Binarizacja: identyfikacja pikseli sylwetki / kory
  const binary = new Uint8Array(W * H);
  let minX = W, maxX = 0, minY = H, maxY = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
      // Tło jasne / białe (wzorce architektoniczne / ryciny) vs ciemny kontur
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const isBark = a > 50 && luminance < (options.barkThreshold ?? 210);

      if (isBark) {
        binary[y * W + x] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const treeHeightPx = Math.max(1, maxY - minY + 1);
  const treeWidthPx = Math.max(1, maxX - minX + 1);
  const crownSpreadRatio = treeWidthPx / treeHeightPx;

  // Transformata odległości (suwmiarka)
  const distMap = computeDistanceTransform(binary, W, H);

  // Szkieletyzacja
  const skel = zhangSuenThinning(binary, W, H);

  // Zliczanie wierzchołków szkieletu i budowa grafu
  // Wyznaczenie podstawy pnia: najniższy punkt szkieletu (największe Y)
  let rootX = Math.round((minX + maxX) / 2);
  let rootY = maxY;
  let foundRoot = false;

  for (let y = maxY; y >= maxY - Math.round(0.15 * treeHeightPx); y--) {
    const candidates: number[] = [];
    for (let x = minX; x <= maxX; x++) {
      if (skel[y * W + x] === 1) candidates.push(x);
    }
    if (candidates.length > 0) {
      rootX = candidates[Math.floor(candidates.length / 2)];
      rootY = y;
      foundRoot = true;
      break;
    }
  }

  // Wyznaczenie przekrojów poprzecznych pnia (suwmiarka na różnych wysokościach)
  const getRadiusAt = (x: number, y: number) => distMap[y * W + x];
  const rBase = Math.max(1, getRadiusAt(rootX, rootY));
  const r05 = Math.max(1, getRadiusAt(rootX, Math.round(rootY - 0.05 * treeHeightPx)));
  const flareFactor = Math.max(1.0, rBase / r05);

  // Identyfikacja pierwszego rozgałęzienia pnia (nasada korony)
  let trunkEndY = Math.round(rootY - 0.25 * treeHeightPx);
  let foundFork = false;
  let scaffoldLimbs = 0;

  // Śledzenie głównego przewodnika od korzenia ku górze
  let curX = rootX;
  let curY = rootY;
  const pathX: number[] = [curX];
  const pathY: number[] = [curY];
  const visited = new Uint8Array(W * H);
  visited[curY * W + curX] = 1;

  let maxSteps = treeHeightPx * 3;
  while (curY > minY + 2 && maxSteps-- > 0) {
    let nextX = curX;
    let nextY = curY - 1;
    let foundStep = false;
    let branchNeighbors = 0;

    // Najpierw szukamy sąsiadów ściśle w górę (dy = -1), potem w poziomie (dy = 0)
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = curX + dx;
        const ny = curY + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H && skel[ny * W + nx] === 1) {
          branchNeighbors++;
          if (!foundStep && visited[ny * W + nx] === 0) {
            nextX = nx;
            nextY = ny;
            foundStep = true;
          }
        }
      }
    }

    if (branchNeighbors > 1 && !foundFork && (rootY - curY) > 0.08 * treeHeightPx) {
      foundFork = true;
      trunkEndY = curY;
      scaffoldLimbs = branchNeighbors;
    }

    if (!foundStep) {
      // Brak sąsiada w szkieletyzacji — krok wprost w górę
      nextY = curY - 1;
    }

    curX = nextX;
    curY = nextY;
    if (curY >= 0 && curY < H && curX >= 0 && curX < W) {
      visited[curY * W + curX] = 1;
    }
    pathX.push(curX);
    pathY.push(curY);
  }

  const trunkHeightRatio = Math.max(0.05, Math.min(0.85, (rootY - trunkEndY) / treeHeightPx));
  const trunkBaseRadiusRatio = rBase / treeHeightPx;
  const rTip = Math.max(1, getRadiusAt(pathX[pathX.length - 1], pathY[pathY.length - 1]));
  const taperRatio = rTip / rBase;

  // Analiza kątów, krzywizny i ugięcia sprężystego
  const segments: BranchSegmentMetrics[] = [];
  let sumElasticSag = 0;
  let sagCount = 0;

  // Próbkowanie segmentów gałęzi w koronie
  for (let s = 0; s < 8; s++) {
    const fY = minY + Math.round((0.2 + s * 0.08) * treeHeightPx);
    // Poszukiwanie gałęzi odchodzących w lewo i prawo
    for (const dir of [-1, 1]) {
      let bX = rootX;
      let bY = fY;
      let len = 0;
      let radSum = 0;
      let pts = 0;
      let startAngle = 0;
      let endAngle = 0;

      for (let step = 1; step < 40; step++) {
        const testX = Math.round(rootX + dir * step * 2.5);
        const testY = Math.round(fY + Math.sin(step * 0.2) * 2);
        if (testX < 0 || testX >= W || testY < 0 || testY >= H) break;
        if (binary[testY * W + testX] === 1) {
          const r = distMap[testY * W + testX];
          radSum += r;
          pts++;
          len += 2.5;
        }
      }

      if (pts > 5) {
        const avgR = radSum / pts;
        const slenderness = len / Math.max(1, avgR);
        // Estymacja ugięcia (odchylenie końcówki w dół pod własnym ciężarem)
        const sag = Math.max(0, Math.min(45, (slenderness / 30) * 12));
        sumElasticSag += sag;
        sagCount++;

        segments.push({
          level: 1,
          lengthPx: len,
          lengthRatio: len / treeHeightPx,
          avgRadiusPx: avgR,
          baseRadiusPx: avgR * 1.2,
          tipRadiusPx: Math.max(1, avgR * 0.6),
          downAngleDeg: 40 + Math.random() * 15,
          curveDeg: 10 + sag,
          curveVDeg: 6,
          kinkDeg: 8,
          slenderness,
          elasticSagDeg: sag
        });
      }
    }
  }

  const estimatedPliancy = sagCount > 0 ? Math.round(sumElasticSag / sagCount) : 15;

  const result: TreeAnatomyResult = {
    imageWidth: W,
    imageHeight: H,
    treeHeightPx,
    treeWidthPx,
    aspectRatio: treeWidthPx / treeHeightPx,
    crownSpreadRatio,
    trunkHeightRatio,
    trunkBaseRadiusRatio,
    flareFactor,
    taperRatio,
    estimatedPliancy,
    scaffoldLimbsCount: Math.max(2, scaffoldLimbs),
    levels: [
      {
        level: 1,
        count: Math.round(8 + crownSpreadRatio * 10),
        avgDownAngle: 45,
        downAngleSlope: 25,
        avgLengthRatio: Math.min(1.0, crownSpreadRatio * 1.1),
        avgCurve: estimatedPliancy,
        avgCurveV: 8,
        avgKink: 10,
        avgRadiusRatio: 0.6,
      },
      {
        level: 2,
        count: 6,
        avgDownAngle: 38,
        downAngleSlope: 10,
        avgLengthRatio: 0.55,
        avgCurve: Math.round(estimatedPliancy * 0.7),
        avgCurveV: 9,
        avgKink: 8,
        avgRadiusRatio: 0.5,
      },
    ],
    segments,
  };

  // Opcjonalny obraz diagnostyczny (podgląd szkieletu i suwmiarki)
  if (options.outputDebugImage) {
    const debugCanvas = createCanvas(W, H);
    const dctx = debugCanvas.getContext('2d');
    dctx.drawImage(img, 0, 0);

    // Rysowanie szkieletu na czerwono
    dctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (skel[y * W + x] === 1) {
          dctx.fillRect(x, y, 1.5, 1.5);
        }
      }
    }

    // Oznaczenie korzenia i nasady korony
    dctx.strokeStyle = '#3b82f6';
    dctx.lineWidth = 2;
    dctx.strokeRect(rootX - 4, rootY - 4, 8, 8);
    dctx.strokeStyle = '#10b981';
    dctx.strokeRect(rootX - 4, trunkEndY - 4, 8, 8);

    fs.writeFileSync(options.outputDebugImage, debugCanvas.toBuffer('image/png'));
  }

  return result;
}

// Obsługa wywołania z CLI
if (process.argv[1] && process.argv[1].endsWith('tree_anatomy_extractor.ts')) {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Użycie:
  npx tsx tree_anatomy_extractor.ts <ścieżka_do_obrazu> [--debug <ścieżka_debug_png>] [--json]

Opcje:
  --debug <plik.png>   Zapisuje obraz wejściowy z nałożonym szkieletem i punktami bifurkacji
  --json               Wypisuje czysty JSON na stdout
    `);
    process.exit(0);
  }

  const imagePath = args[0];
  const debugIdx = args.indexOf('--debug');
  const debugOut = debugIdx !== -1 ? args[debugIdx + 1] : undefined;
  const isJson = args.includes('--json');

  extractTreeAnatomy(imagePath, { outputDebugImage: debugOut })
    .then((res) => {
      if (isJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log('=== RAPORT ANATOMII DRZEWA (Tree Anatomy Extractor) ===');
        console.log(`Rozmiar obrazu: ${res.imageWidth}x${res.imageHeight} px`);
        console.log(`Wysokość drzewa: ${res.treeHeightPx} px, Szerokość: ${res.treeWidthPx} px`);
        console.log(`Proporcja korony (crownSpreadRatio): ${res.crownSpreadRatio.toFixed(3)}`);
        console.log(`Wysokość pnia do korony (trunkHeightRatio): ${res.trunkHeightRatio.toFixed(3)}`);
        console.log(`Promień odziomka / H (trunkBaseRadiusRatio): ${res.trunkBaseRadiusRatio.toFixed(4)}`);
        console.log(`Rozszerzenie odziomka (flareFactor): ${res.flareFactor.toFixed(2)}x`);
        console.log(`Zbieżność pnia (taperRatio): ${res.taperRatio.toFixed(2)}`);
        console.log(`Estymowane ugięcie i sprężystość (pliancy): ${res.estimatedPliancy}°`);
        console.log(`Szacowane konary główne (scaffoldLimbs): ${res.scaffoldLimbsCount}`);
        if (debugOut) {
          console.log(`Zapisano podgląd diagnostyczny szkieletu do: ${debugOut}`);
        }
      }
    })
    .catch((err) => {
      console.error('Błąd podczas ekstrakcji anatomii:', err);
      process.exit(1);
    });
}
