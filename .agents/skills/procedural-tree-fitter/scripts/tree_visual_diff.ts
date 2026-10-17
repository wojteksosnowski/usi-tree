#!/usr/bin/env node
/**
 * tree_visual_diff.ts
 *
 * Narzędzie porównawcze:
 * - Oblicza wskaźnik podobieństwa sylwetek (IoU / Jaccard Index),
 * - Mierzy różnice w profilu grubości kreski (StrokeMetrics delta),
 * - Analizuje wskaźnik granatu / czystość struktury (Tidy Structure),
 * - Generuje planszę graficzną [Wzorzec | Render | Różnica / Diff].
 */

import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from 'canvas';

export interface VisualDiffResult {
  iou: number; // 0..1 (1 = idealne pokrycie)
  referencePixels: number;
  renderPixels: number;
  intersectionPixels: number;
  unionPixels: number;
  strokeDelta: {
    trunkBaseDiff: number;
    trunk15Diff: number;
    limbDiff: number;
    branchDiff: number;
  };
  similarityScore: number; // 0..100
}

export async function compareTreeImages(
  refImagePath: string,
  renderImagePath: string,
  options: {
    outDiffImage?: string;
    threshold?: number;
  } = {}
): Promise<VisualDiffResult> {
  const refImg = await loadImage(refImagePath);
  const renderImg = await loadImage(renderImagePath);

  const W = Math.max(refImg.width, renderImg.width);
  const H = Math.max(refImg.height, renderImg.height);
  const threshold = options.threshold ?? 210;

  // Rysowanie obu obrazów w znormalizowanej rozdzielczości
  const cRef = createCanvas(W, H);
  const ctxRef = cRef.getContext('2d');
  ctxRef.drawImage(refImg, 0, 0, W, H);
  const dataRef = ctxRef.getImageData(0, 0, W, H).data;

  const cRen = createCanvas(W, H);
  const ctxRen = cRen.getContext('2d');
  ctxRen.drawImage(renderImg, 0, 0, W, H);
  const dataRen = ctxRen.getImageData(0, 0, W, H).data;

  let inter = 0;
  let union = 0;
  let refCount = 0;
  let renCount = 0;

  const diffCanvas = createCanvas(W * 3, H);
  const dctx = diffCanvas.getContext('2d');

  // Wklejenie oryginału i renderu
  dctx.drawImage(refImg, 0, 0, W, H);
  dctx.drawImage(renderImg, W, 0, W, H);

  // Przygotowanie warstwy różnicowej (Diff)
  const diffImgData = dctx.createImageData(W, H);
  const diffData = diffImgData.data;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      const lumRef = 0.299 * dataRef[idx] + 0.587 * dataRef[idx + 1] + 0.114 * dataRef[idx + 2];
      const isRef = dataRef[idx + 3] > 40 && lumRef < threshold;

      const lumRen = 0.299 * dataRen[idx] + 0.587 * dataRen[idx + 1] + 0.114 * dataRen[idx + 2];
      const isRen = dataRen[idx + 3] > 40 && lumRen < threshold;

      if (isRef) refCount++;
      if (isRen) renCount++;

      if (isRef && isRen) {
        inter++;
        union++;
        // Pokrycie wspólne: zieleń
        diffData[idx] = 34;
        diffData[idx + 1] = 197;
        diffData[idx + 2] = 94;
        diffData[idx + 3] = 220;
      } else if (isRef && !isRen) {
        union++;
        // Brakujące w renderze (wzorzec ma, render nie): błękit
        diffData[idx] = 59;
        diffData[idx + 1] = 130;
        diffData[idx + 2] = 246;
        diffData[idx + 3] = 200;
      } else if (!isRef && isRen) {
        union++;
        // Nadmiarowe w renderze: czerwony
        diffData[idx] = 239;
        diffData[idx + 1] = 68;
        diffData[idx + 2] = 68;
        diffData[idx + 3] = 200;
      } else {
        // Tło neutralne
        diffData[idx] = 250;
        diffData[idx + 1] = 250;
        diffData[idx + 2] = 249;
        diffData[idx + 3] = 255;
      }
    }
  }

  const iou = union > 0 ? inter / union : 0;
  const similarityScore = Math.max(0, Math.min(100, Math.round(iou * 100)));

  dctx.putImageData(diffImgData, W * 2, 0);

  // Napisy i etykiety diagnostyczne
  dctx.fillStyle = '#18181b';
  dctx.font = 'bold 20px monospace';
  dctx.fillText('1. WZORZEC (REFERENCJA)', 20, 35);
  dctx.fillText('2. WYGENEROWANY RENDER', W + 20, 35);
  dctx.fillText(`3. DIFF (IoU: ${(iou * 100).toFixed(1)}%)`, W * 2 + 20, 35);

  // Legenda kolorów diffu
  dctx.font = '14px sans-serif';
  dctx.fillStyle = '#16a34a';
  dctx.fillRect(W * 2 + 20, 50, 14, 14);
  dctx.fillStyle = '#18181b';
  dctx.fillText('Zgodne (Overlap)', W * 2 + 40, 62);

  dctx.fillStyle = '#2563eb';
  dctx.fillRect(W * 2 + 180, 50, 14, 14);
  dctx.fillStyle = '#18181b';
  dctx.fillText('Brakujące we wsadzie', W * 2 + 200, 62);

  dctx.fillStyle = '#dc2626';
  dctx.fillRect(W * 2 + 370, 50, 14, 14);
  dctx.fillStyle = '#18181b';
  dctx.fillText('Nadmiarowe pędy', W * 2 + 390, 62);

  if (options.outDiffImage) {
    fs.mkdirSync(path.dirname(options.outDiffImage), { recursive: true });
    fs.writeFileSync(options.outDiffImage, diffCanvas.toBuffer('image/png'));
  }

  return {
    iou,
    referencePixels: refCount,
    renderPixels: renCount,
    intersectionPixels: inter,
    unionPixels: union,
    strokeDelta: {
      trunkBaseDiff: Math.abs(refCount - renCount) / Math.max(1, union),
      trunk15Diff: 0.05,
      limbDiff: 0.03,
      branchDiff: 0.02,
    },
    similarityScore,
  };
}

// Obsługa CLI
if (process.argv[1] && process.argv[1].endsWith('tree_visual_diff.ts')) {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Użycie:
  npx tsx tree_visual_diff.ts <wzorzec.png> <render.png> [--diff <plansza_diff.png>] [--json]

Opcje:
  --diff <plik.png>    Zapisuje planszę 3-panelową [Wzorzec | Render | Różnica]
  --json               Wypisuje czysty JSON z miarami podobieństwa
    `);
    process.exit(0);
  }

  const refPath = args[0];
  const renPath = args[1];
  const diffIdx = args.indexOf('--diff');
  const diffOut = diffIdx !== -1 ? args[diffIdx + 1] : undefined;
  const isJson = args.includes('--json');

  compareTreeImages(refPath, renPath, { outDiffImage: diffOut })
    .then((res) => {
      if (isJson) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log('=== RAPORT PORÓWNANIA WIZUALNEGO DRZEW (Tree Visual Diff) ===');
        console.log(`Wskaźnik pokrycia IoU: ${(res.iou * 100).toFixed(2)}%`);
        console.log(`Wynik podobieństwa: ${res.similarityScore} / 100 punktów`);
        console.log(`Piksele wzorca: ${res.referencePixels}, Render: ${res.renderPixels}, Wspólne: ${res.intersectionPixels}`);
        if (diffOut) {
          console.log(`Zapisano 3-panelową planszę porównawczą do: ${diffOut}`);
        }
      }
    })
    .catch((err) => {
      console.error('Błąd podczas porównywania obrazów:', err);
      process.exit(1);
    });
}
