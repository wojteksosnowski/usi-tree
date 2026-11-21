#!/usr/bin/env node
/**
 * Tree Studio — lekkie narzędzie deweloperskie z GUI w przeglądarce
 * do podglądu drzew z bazy (widok z boku) i strojenia parametrów na żywo.
 *
 * Uruchomienie: npm run studio (lub ./node_modules/.bin/tsx scripts/tree-studio.ts)
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as esbuild from 'esbuild';

const PORT = Number(process.env.PORT ?? 4173);
const HOST = '127.0.0.1';
const FITTED_PATH = path.resolve('src/core/fittedProfiles.json');

const CLIENT_ENTRY = `
import * as THREE from 'three';
import {
  TreeGenerator,
  SPECIES_PROFILES,
  ILLUSTRATION_STROKE,
  toThreeBufferGeometry,
} from '${path.resolve('src/three/index').replace(/\\\\/g, '/')}';
import {
  FITTED_PROFILES,
} from '${path.resolve('src/profiles/index').replace(/\\\\/g, '/')}';
import {
  treeKindParams,
  describeTreeKindModelSource,
  type TreeKind,
} from '${path.resolve('src/core/treeSpeciesRegistry').replace(/\\\\/g, '/')}';
import {
  fitParameterCurve,
  profileAtHeight,
  scaleProfileByHeight,
} from '${path.resolve('src/core/heightProfile').replace(/\\\\/g, '/')}';
import { CrownEnvelope, crownRatio } from '${path.resolve('src/core/crownEnvelope').replace(/\\\\/g, '/')}';
import { countMeshTriangles } from '${path.resolve('src/core/treeLod').replace(/\\\\/g, '/')}';
import type { SpeciesProfile, TrunkForm, TreeDetail, CrownShape } from '${path.resolve('src/core/types').replace(/\\\\/g, '/')}';

const ANCHOR_HEIGHTS = [6, 9, 15, 24] as const;
const CROWN_SHAPES: CrownShape[] = [
  'SPHERICAL',
  'CONICAL',
  'CYLINDRICAL',
  'UMBRELLA',
  'WEEPING',
  'HEMISPHERICAL',
  'TEND_FLAME',
  'OVOID_COLUMN',
];

const BASE_SPECIES = Object.keys(SPECIES_PROFILES) as TreeKind[];
const FITTED_REFS = FITTED_PROFILES.map((f) => f.ref as TreeKind);
const ALL_KINDS: TreeKind[] = [...new Set([...BASE_SPECIES, ...FITTED_REFS])];

// State
let currentKind: TreeKind = 'BIRCH';
let currentHeight = 15;
let currentSeed = 42;
let currentForm: TrunkForm = 'SINGLE';
let currentDetail: TreeDetail = 'HIGH';
type Season = 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER';
let currentSeason: Season = 'SUMMER';
let showFoliage = true;
let yawDeg = 0;
let windEnabled = false;
let windStrength = 0.4;
let windMode: 'SWAY' | 'STATIC' = 'SWAY';
let currentSkeleton: ReturnType<typeof TreeGenerator.buildSkeleton> | null = null;
let currentRenderOpts: {
  withFoliageAccents: boolean;
  detail: TreeDetail;
  stroke: typeof ILLUSTRATION_STROKE;
} | null = null;
let currentCamera: THREE.OrthographicCamera | null = null;
let windRafId = 0;

// Per-kind working copy of anchors (6, 9, 15, 24) when user edits a key height
const editedAnchors = new Map<string, Map<number, SpeciesProfile>>();

function getAnchorMap(kind: TreeKind): Map<number, SpeciesProfile> {
  let map = editedAnchors.get(kind);
  if (!map) {
    map = new Map<number, SpeciesProfile>();
    const fitted = FITTED_PROFILES.find((f) => f.ref === kind);
    if (fitted?.heightAnchors?.length) {
      for (const a of fitted.heightAnchors) {
        if (typeof a?.h === 'number' && a?.profile) {
          map.set(a.h, structuredClone(a.profile));
        }
      }
    } else {
      for (const h of ANCHOR_HEIGHTS) {
        const base = treeKindParams(kind, h).profile!;
        map.set(h, structuredClone(base));
      }
    }
    editedAnchors.set(kind, map);
  }
  return map;
}

function getEffectiveProfile(kind: TreeKind, h: number): { profile: SpeciesProfile; isExactAnchor: boolean; nearestAnchor: number } {
  const map = getAnchorMap(kind);
  const heights = [...map.keys()].sort((a, b) => a - b);
  const exact = heights.find((a) => Math.abs(a - h) < 0.05);
  let nearest = heights[0] ?? 6;
  let bestD = Infinity;
  for (const ah of heights) {
    const d = Math.abs(ah - h);
    if (d < bestD) { bestD = d; nearest = ah; }
  }
  if (exact !== undefined) {
    return { profile: structuredClone(map.get(exact)!), isExactAnchor: true, nearestAnchor: exact };
  }
  const anchors = heights.map((ah) => ({ h: ah, profile: map.get(ah)! }));
  return { profile: profileAtHeight(anchors, h), isExactAnchor: false, nearestAnchor: nearest };
}

// Three.js setup
const canvas = document.getElementById('gl-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setClearColor(0xfcfbf9, 1.0);

const barkMat = new THREE.MeshBasicMaterial({ color: 0xb88d66, side: THREE.DoubleSide });
const leafMats = [
  new THREE.MeshBasicMaterial({ color: 0xa8a66e, side: THREE.DoubleSide }),
  new THREE.MeshBasicMaterial({ color: 0x7a7a42, side: THREE.DoubleSide }),
  new THREE.MeshBasicMaterial({ color: 0x4f4b26, side: THREE.DoubleSide }),
];

const scene = new THREE.Scene();
const treeGroup = new THREE.Group();
scene.add(treeGroup);
let currentMesh: THREE.Mesh | null = null;

const SEASON_PALETTES: Record<Season, [number, number, number]> = {
  SPRING: [0xb4d468, 0x8cb842, 0x5c8426],
  SUMMER: [0xa8a66e, 0x7a7a42, 0x4f4b26],
  AUTUMN: [0xe59838, 0xc86420, 0x8a3a14],
  WINTER: [0x5a7048, 0x3f5432, 0x26351d],
};

function isConifer(species: string): boolean {
  return species === 'PINE' || species === 'SPRUCE' || species === 'FIR' || species === 'CYPRESS';
}

function seasonFoliageFactors(conifer: boolean): { sizeScale: number; densityScale: number } {
  if (conifer || currentSeason === 'SUMMER') return { sizeScale: 1, densityScale: 1 };
  if (currentSeason === 'SPRING') return { sizeScale: 0.7, densityScale: 0.7 };
  if (currentSeason === 'AUTUMN') return { sizeScale: 1.1, densityScale: 0.5 };
  return { sizeScale: 0, densityScale: 0 };
}

const LEAF_SHAPES_MAP: Record<string, number[]> = {
  tri: [0, 0, 1.0, 1.0, 1.0, -1.0],
  quad: [0, 0, 0.42, 1.25, 1.05, 0, 0.42, -1.25],
  penta: [0, 0, 0.3, 1.03, 0.9, 0.64, 0.9, -0.64, 0.3, -1.03],
  hex: [0, 0, 0.25, 0.9, 0.72, 1.0, 1.0, 0, 0.72, -1.0, 0.25, -0.9],
};

function updateLeafPreview(profile: SpeciesProfile, species: string) {
  const svg = document.getElementById('leaf-preview-svg');
  const dimsEl = document.getElementById('leaf-dims-text');
  const shapeEl = document.getElementById('leaf-shape-text');
  if (!svg || !dimsEl || !shapeEl) return;

  const conifer = isConifer(species);
  const { sizeScale, densityScale } = seasonFoliageFactors(conifer);
  const aspect = Math.max(0.08, Math.min(1.5, profile.leafAspect ?? (conifer ? 0.18 : 0.6)));
  const baseLenCm = profile.leafSizeCm ?? profile.leafSizeRatio * currentHeight * 100;
  const lenCm = baseLenCm * (sizeScale || 1);
  const effRatio = lenCm / (Math.max(0.5, currentHeight) * 100);
  const widCm = lenCm * aspect;
  const shapeKey = profile.leafShape ?? 'hex';
  const outline = profile.leafOutline?.length ? [...profile.leafOutline] : [...(LEAF_SHAPES_MAP[shapeKey] ?? LEAF_SHAPES_MAP.hex)];
  const corners = outline.length / 2;
  const petioleLen = profile.petioleLengthRatio ?? 0.15;
  const petioleCm = lenCm * petioleLen;

  const palette = currentSeason === 'AUTUMN' && conifer ? SEASON_PALETTES.SUMMER : SEASON_PALETTES[currentSeason];
  const hexColor = '#' + palette[1].toString(16).padStart(6, '0');
  const strokeColor = '#' + palette[2].toString(16).padStart(6, '0');
  const bareWinter = currentSeason === 'WINTER' && !conifer;

  const cx = 90;
  const attachY = 164;
  const bladePx = 110 * (sizeScale || 1);
  const petiolePx = bladePx * petioleLen;
  const baseY = attachY - petiolePx;
  const halfW = bladePx * aspect * 0.5;

  const pxPts: [number, number][] = [];
  for (let i = 0; i < corners; i++) {
    pxPts.push([cx + outline[i * 2 + 1] * halfW, baseY - outline[i * 2] * bladePx]);
  }
  const ptsStr = pxPts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const triLines: string[] = [];
  for (let i = 1; i < corners - 1; i++) {
    triLines.push('<line class="leaf-tri-line" x1="' + pxPts[0][0].toFixed(1) + '" y1="' + pxPts[0][1].toFixed(1) + '" x2="' + pxPts[i][0].toFixed(1) + '" y2="' + pxPts[i][1].toFixed(1) + '" stroke="' + strokeColor + '" stroke-opacity="0.35" stroke-width="1" />');
  }
  const handles = pxPts
    .map((p, idx) =>
      outline[idx * 2 + 1] >= -1e-6
        ? '<circle class="leaf-handle" data-vidx="' + idx + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4.5" fill="#fff" stroke="#2563eb" stroke-width="1.8" style="cursor:grab;" />'
        : ''
    )
    .join('');

  svg.innerHTML =
    '<line x1="' + cx + '" y1="' + attachY + '" x2="' + cx + '" y2="' + baseY.toFixed(1) + '" stroke="#92400e" stroke-width="2" stroke-dasharray="3 2" />' +
    '<circle cx="' + cx + '" cy="' + attachY + '" r="3.5" fill="#92400e" />' +
    '<polygon id="leaf-poly" points="' + ptsStr + '" fill="' + (bareWinter ? 'none' : hexColor) + '" fill-opacity="' + (bareWinter ? '0' : '0.85') + '" stroke="' + (bareWinter ? '#cbd5e1' : strokeColor) + '" stroke-width="2" stroke-dasharray="' + (bareWinter ? '4 3' : 'none') + '" />' +
    triLines.join('') +
    handles;

  const refreshSvgGeometry = () => {
    for (let i = 0; i < corners; i++) {
      pxPts[i] = [cx + outline[i * 2 + 1] * halfW, baseY - outline[i * 2] * bladePx];
    }
    const poly = svg.querySelector('#leaf-poly');
    if (poly) poly.setAttribute('points', pxPts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '));
    const lines = svg.querySelectorAll('.leaf-tri-line');
    for (let i = 1; i < corners - 1; i++) {
      const line = lines[i - 1];
      if (line) {
        line.setAttribute('x1', pxPts[0][0].toFixed(1));
        line.setAttribute('y1', pxPts[0][1].toFixed(1));
        line.setAttribute('x2', pxPts[i][0].toFixed(1));
        line.setAttribute('y2', pxPts[i][1].toFixed(1));
      }
    }
    const circles = svg.querySelectorAll('.leaf-handle');
    circles.forEach((c) => {
      const idx = parseInt((c as HTMLElement).dataset.vidx || '-1', 10);
      if (idx >= 0 && idx < corners) {
        c.setAttribute('cx', pxPts[idx][0].toFixed(1));
        c.setAttribute('cy', pxPts[idx][1].toFixed(1));
      }
    });
  };

  let dragIdx = -1;
  (svg as any).onmousedown = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t?.dataset?.vidx !== undefined) {
      dragIdx = parseInt(t.dataset.vidx, 10);
      e.preventDefault();
    }
  };
  (svg as any).onmousemove = (e: MouseEvent) => {
    if (dragIdx < 0) return;
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 180;
    const my = ((e.clientY - rect.top) / rect.height) * 180;
    const along = Number(((baseY - my) / Math.max(1e-3, bladePx)).toFixed(3));
    const mirrorIdx = corners - dragIdx;
    const isAxisVertex = dragIdx === 0 || mirrorIdx === dragIdx;
    const across = isAxisVertex ? 0 : Math.max(0, Number(((mx - cx) / Math.max(1e-3, halfW)).toFixed(3)));
    outline[dragIdx * 2] = along;
    outline[dragIdx * 2 + 1] = across;
    if (!isAxisVertex && mirrorIdx > 0 && mirrorIdx < corners) {
      outline[mirrorIdx * 2] = along;
      outline[mirrorIdx * 2 + 1] = -across;
    }
    refreshSvgGeometry();
  };
  const commitDrag = () => {
    if (dragIdx < 0) return;
    dragIdx = -1;
    const targetMap = getAnchorMap(currentKind);
    for (const [ah, ap] of targetMap.entries()) {
      ap.leafOutline = [...outline];
      targetMap.set(ah, ap);
    }
    renderTree();
  };
  (svg as any).onmouseup = commitDrag;
  (svg as any).onmouseleave = commitDrag;

  const seasonNote = bareWinter
    ? ' · zima (bezlistne)'
    : !conifer && (sizeScale !== 1 || densityScale !== 1)
      ? ' · rozmiar ' + Math.round(sizeScale * 100) + '%, gęstość ' + Math.round(densityScale * 100) + '%'
      : '';
  dimsEl.textContent = lenCm.toFixed(1) + ' × ' + widCm.toFixed(1) + ' cm | szypułka ' + petioleCm.toFixed(1) + ' cm (0 trójkątów)';
  shapeEl.textContent = 'Kształt: ' + (profile.leafOutline?.length ? 'własny' : shapeKey) + ' (' + Math.max(1, corners - 2) + ' trójk.) · aspect ' + aspect.toFixed(2) + seasonNote;
}

let lastChartTarget: { sectionTitle: string; label: string } = { sectionTitle: 'Pień i korona', label: 'trunkHeightRatio' };

function getParamValue(p: SpeciesProfile, sectionTitle: string, label: string): number | undefined {
  const m = sectionTitle.match(/L(\d+)/);
  if (m) {
    const idx = parseInt(m[1], 10) - 1;
    const val = (p.levels?.[idx] as any)?.[label];
    return typeof val === 'number' ? val : undefined;
  }
  const val = (p as any)[label];
  return typeof val === 'number' ? val : undefined;
}

const PARAM_DESCRIPTIONS: Record<string, string> = {
  crownShape: 'Kształt obwiedni korony (np. kulista, stożkowa, płacząca).',
  crownSpreadRatio: 'Stosunek szerokości korony do całkowitej wysokości drzewa.',
  crownPeak: 'Położenie najszerszego miejsca korony (ułamek wysokości korony).',
  envelopeClipProbability: 'Prawdopodobieństwo przycięcia pędu przez obwiednię korony (0 = swobodny wzrost, 1 = ścisłe cięcie).',
  trunkHeightRatio: 'Ułamek wysokości pnia bez gałęzi (od gruntu do pierwszego konara).',
  trunkBaseRadiusRatio: 'Promień pnia u podstawy względem wysokości drzewa.',
  trunkLengthRatio: 'Długość przewodnika (pnia głównego) względem wysokości drzewa.',
  trunkTipRatio: 'Stosunek promienia czubka pnia do promienia u podstawy.',
  trunkTaper: 'Współczynnik zwężania grubości pnia na sekcję (0.0 = brak zwężania, 1.0 = silne zwężanie).',
  taper: 'Współczynnik zwężania grubości gałęzi na sekcję (0.0–1.0).',
  trunkCurveV: 'Losowe wygięcie/krzywizna pnia głównego (stopnie).',
  ratioPower: 'Wykładnik reguły rur: jak szybko zwężają się gałęzie potomne względem rodzica.',
  flareFactor: 'Rozszerzenie (napływ korzeniowy) pnia przy samej ziemi.',
  leafSizeCm: 'Absolutna długość pojedynczego liścia w centymetrach (niezależna od wysokości drzewa).',
  leafSizeRatio: 'Długość liścia jako ułamek wysokości drzewa (używane, gdy nie ustawiono leafSizeCm).',
  leafShape: 'Kształt liścia: tri (1 trójkąt), quad (2 trójkąty/romb), penta (3 trójkąty/pięciobok), hex (4 trójkąty/sześciobok).',
  petioleLengthRatio: 'Długość szypułki względem długości liścia (0 = przy gałązce; szypułka nie generuje trójkątów).',
  petiolePliancy: 'Miękkość szypułki (0.0–1.0): uginanie liścia w dół i mocniejszy ruch na wietrze.',
  leafAspect: 'Stosunek szerokości liścia do jego długości.',
  leafDensity: 'Liczba kępek liści na jednostkę długości witki.',
  leafClump: 'Liczba liści w pojedynczej kępce.',
  jitterStrength: 'Nieregularność przekroju pnia i gałęzi (efekt rysunku).',
  pliancy: 'Podatność gałęzi na ugięcie pod własnym ciężarem (stopnie).',
  count: 'Liczba gałęzi potomnych wyrastających na tym poziomie.',
  downAngle: 'Kąt odejścia gałęzi od rodzica (stopnie od pionu/osi).',
  downAngleSlope: 'Zmiana kąta odejścia wzdłuż długości rodzica.',
  downAngleV: 'Losowa zmienność kąta odejścia gałęzi (stopnie).',
  lengthRatio: 'Długość gałęzi tego poziomu względem długości rodzica.',
  lengthV: 'Losowa zmienność długości gałęzi.',
  curve: 'Stałe wygięcie gałęzi w górę lub w dół (stopnie).',
  curveV: 'Losowa zmienność krzywizny gałęzi (stopnie).',
  curveBack: 'Wygięcie powrotne w drugiej połowie gałęzi (kształt S).',
  curveRes: 'Liczba segmentów podziału gałęzi (gładkość łuku).',
  tropism: 'Kierunek wzrostu względem grawitacji/światła (>0 w górę, <0 zwis w dół).',
  fork: 'Kąt rozwidlenia na końcu gałęzi (stopnie).',
  tipRatio: 'Stosunek grubości końca gałęzi do jej nasady.',
  baseSize: 'Ułamek długości rodzica, od którego zaczynają wyrastać gałęzie tego poziomu.',
};

function renderChartInto(svgEl: HTMLElement, titleEl: HTMLElement, sectionTitle: string, label: string, W: number, H: number) {
  const map = getAnchorMap(currentKind);
  const heights = [...map.keys()].sort((a, b) => a - b);
  const pts: { h: number; y: number }[] = [];
  for (const h of heights) {
    const prof = map.get(h)!;
    const y = getParamValue(prof, sectionTitle, label);
    if (y !== undefined) pts.push({ h, y });
  }
  if (pts.length === 0) {
    titleEl.textContent = label + ' (brak węzłów)';
    svgEl.innerHTML = '';
    return false;
  }

  const fit = fitParameterCurve(pts);
  const minH = Math.min(...pts.map((p) => p.h), currentHeight);
  const maxH = Math.max(...pts.map((p) => p.h), currentHeight, 30);
  const samples: { h: number; y: number }[] = [];
  for (let i = 0; i <= 60; i++) {
    const h = minH + ((maxH - minH) * i) / 60;
    samples.push({ h, y: fit.eval(h) });
  }
  const effProf = getEffectiveProfile(currentKind, currentHeight).profile;
  const curY = getParamValue(effProf, sectionTitle, label) ?? fit.eval(currentHeight);
  const allY = [...pts.map((p) => p.y), ...samples.map((s) => s.y), curY];
  let minY = Math.min(...allY);
  let maxY = Math.max(...allY);
  if (Math.abs(maxY - minY) < 1e-9) {
    minY -= 1;
    maxY += 1;
  } else {
    const pad = (maxY - minY) * 0.12;
    minY -= pad;
    maxY += pad;
  }

  const P = { l: 44, r: 14, t: 14, b: 24 };
  const sx = (h: number) => P.l + ((h - minH) / Math.max(1e-6, maxH - minH)) * (W - P.l - P.r);
  const sy = (y: number) => H - P.b - ((y - minY) / Math.max(1e-9, maxY - minY)) * (H - P.t - P.b);

  const pathD = samples.map((s, i) => (i === 0 ? 'M' : 'L') + sx(s.h).toFixed(1) + ',' + sy(s.y).toFixed(1)).join(' ');
  const kindLabel: Record<string, string> = {
    const: 'stała',
    linear: 'liniowa',
    log: 'logarytmiczna',
    exp: 'wykładnicza',
  };

  titleEl.textContent = label + ' (' + (kindLabel[fit.kind] ?? fit.kind) + ')';
  const cxCur = sx(currentHeight).toFixed(1);
  const cyCur = sy(curY).toFixed(1);
  const ptsSvg = pts
    .map((p) => '<circle cx="' + sx(p.h).toFixed(1) + '" cy="' + sy(p.y).toFixed(1) + '" r="4" fill="#dc2626" stroke="#fff" stroke-width="1.5" />')
    .join('');
  svgEl.innerHTML =
    '<line x1="' + P.l + '" y1="' + (H - P.b) + '" x2="' + (W - P.r) + '" y2="' + (H - P.b) + '" stroke="#cbd5e1" />' +
    '<line x1="' + P.l + '" y1="' + P.t + '" x2="' + P.l + '" y2="' + (H - P.b) + '" stroke="#cbd5e1" />' +
    '<text x="' + (P.l - 6) + '" y="' + (P.t + 8) + '" text-anchor="end" font-size="10" fill="#64748b">' + maxY.toPrecision(3) + '</text>' +
    '<text x="' + (P.l - 6) + '" y="' + (H - P.b) + '" text-anchor="end" font-size="10" fill="#64748b">' + minY.toPrecision(3) + '</text>' +
    '<text x="' + P.l + '" y="' + (H - 6) + '" font-size="10" fill="#64748b">' + minH.toFixed(0) + ' m</text>' +
    '<text x="' + (W - P.r) + '" y="' + (H - 6) + '" text-anchor="end" font-size="10" fill="#64748b">' + maxH.toFixed(0) + ' m</text>' +
    '<path d="' + pathD + '" fill="none" stroke="#16a34a" stroke-width="2" />' +
    '<line x1="' + cxCur + '" y1="' + P.t + '" x2="' + cxCur + '" y2="' + (H - P.b) + '" stroke="#2563eb" stroke-dasharray="3 3" />' +
    '<circle cx="' + cxCur + '" cy="' + cyCur + '" r="4" fill="#2563eb" />' +
    ptsSvg;
  return true;
}

function updateInlineChart(sectionTitle = lastChartTarget.sectionTitle, label = lastChartTarget.label) {
  lastChartTarget = { sectionTitle, label };
  const svg = document.getElementById('inline-chart-svg');
  const titleEl = document.getElementById('inline-chart-title');
  const descEl = document.getElementById('inline-chart-desc');
  if (svg && titleEl) renderChartInto(svg, titleEl, sectionTitle, label, 310, 180);
  if (descEl) descEl.textContent = PARAM_DESCRIPTIONS[label] ?? 'Parametr profilu morfologicznego drzewa.';
}

function applyWindDeformation(timeSec: number) {
  if (!currentSkeleton || !currentRenderOpts || !currentCamera) return;
  const wind = windEnabled && windStrength > 0
    ? { strength: windStrength, time: windMode === 'SWAY' ? timeSec : undefined }
    : undefined;
  const rawRes = TreeGenerator.meshSkeletonRaw(currentSkeleton, {
    ...currentRenderOpts,
    wind,
  });
  if (currentMesh) {
    currentMesh.geometry.dispose();
    treeGroup.remove(currentMesh);
  }
  currentMesh = new THREE.Mesh(toThreeBufferGeometry(rawRes.mesh), [barkMat, ...leafMats]);
  treeGroup.add(currentMesh);
  renderer.render(scene, currentCamera);
}

function startWindLoop() {
  if (windRafId) cancelAnimationFrame(windRafId);
  if (!windEnabled || windMode !== 'SWAY') return;
  const tick = (now: number) => {
    if (!windEnabled || windMode !== 'SWAY') { windRafId = 0; return; }
    applyWindDeformation(now * 0.001);
    windRafId = requestAnimationFrame(tick);
  };
  windRafId = requestAnimationFrame(tick);
}

function renderTree() {
  const rect = canvas.parentElement!.getBoundingClientRect();
  const w = Math.max(320, Math.floor(rect.width));
  const hPx = Math.max(320, Math.floor(rect.height));
  if (canvas.width !== w || canvas.height !== hPx) {
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(w, hPx, false);
  }

  const { profile, isExactAnchor, nearestAnchor } = getEffectiveProfile(currentKind, currentHeight);
  const kindInfo = treeKindParams(currentKind, currentHeight);
  const conifer = isConifer(kindInfo.species);
  const effectiveFoliage = showFoliage && !(currentSeason === 'WINTER' && !conifer);
  const palette = currentSeason === 'AUTUMN' && conifer ? SEASON_PALETTES.SUMMER : SEASON_PALETTES[currentSeason];
  for (let i = 0; i < 3; i++) leafMats[i].color.setHex(palette[i]);
  updateLeafPreview(profile, kindInfo.species);
  if (typeof updateInlineChart === 'function') updateInlineChart();

  const { sizeScale, densityScale } = seasonFoliageFactors(conifer);
  const renderProfile: SpeciesProfile = !conifer && (sizeScale !== 1 || densityScale !== 1)
    ? {
        ...profile,
        leafSizeRatio: profile.leafSizeRatio * sizeScale,
        ...(profile.leafSizeCm !== undefined ? { leafSizeCm: profile.leafSizeCm * sizeScale } : {}),
        leafDensity: (profile.leafDensity ?? 38) * densityScale,
      }
    : profile;

  currentSkeleton = TreeGenerator.buildSkeleton({
    species: kindInfo.species,
    height: currentHeight,
    seed: currentSeed,
    form: currentForm,
    profile: renderProfile,
  });
  currentRenderOpts = {
    withFoliageAccents: effectiveFoliage,
    detail: currentDetail,
    stroke: ILLUSTRATION_STROKE,
  };
  const wind = windEnabled && windStrength > 0
    ? { strength: windStrength, time: windMode === 'SWAY' ? performance.now() * 0.001 : undefined }
    : undefined;
  const rawRes = TreeGenerator.meshSkeletonRaw(currentSkeleton, {
    ...currentRenderOpts,
    wind,
  });

  if (currentMesh) {
    currentMesh.geometry.dispose();
    treeGroup.remove(currentMesh);
  }

  const geom = toThreeBufferGeometry(rawRes.mesh);
  currentMesh = new THREE.Mesh(geom, [barkMat, ...leafMats]);
  treeGroup.add(currentMesh);
  treeGroup.rotation.y = (yawDeg * Math.PI) / 180;

  const [minX, minY] = rawRes.mesh.boundingBox.min;
  const [maxX, maxY] = rawRes.mesh.boundingBox.max;
  const yMin = Math.min(0, minY);
  const yMax = Math.max(currentHeight, maxY, 2);
  const spanY = Math.max(1, yMax - yMin);
  const spanX = Math.max(1, maxX - minX);
  const cx = (minX + maxX) * 0.5;

  const aspect = w / hPx;
  const frustumH = Math.max(spanY / 0.82, spanX / 0.82 / aspect, 4);
  const frustumW = frustumH * aspect;
  const bottomY = yMin - frustumH * 0.09;
  const cy = bottomY + frustumH * 0.5;

  const camera = new THREE.OrthographicCamera(
    -frustumW * 0.5, frustumW * 0.5,
    frustumH * 0.5, -frustumH * 0.5,
    0.1, 1000
  );
  camera.position.set(cx, cy, 200);
  camera.lookAt(cx, cy, 0);
  currentCamera = camera;
  renderer.render(scene, camera);

  // Update stats bar
  const tris = countMeshTriangles(rawRes.mesh);
  const barkPct = tris.total > 0 ? Math.round((tris.bark / tris.total) * 100) : 0;
  const folPct = tris.total > 0 ? 100 - barkPct : 0;
  const actualH = rawRes.bounds.height;
  const actualW = rawRes.bounds.crownRadius * 2;
  const wh = actualW / Math.max(1e-6, actualH);

  document.getElementById('stats-tris')!.textContent =
    \`Trójkąty: \${tris.total.toLocaleString()} | Pień i gałęzie: \${tris.bark.toLocaleString()} (\${barkPct}%) | Liście: \${tris.foliage.toLocaleString()} (\${folPct}%)\`;
  document.getElementById('stats-dims')!.textContent =
    \`Wymiary: \${actualW.toFixed(2)}m × \${actualH.toFixed(2)}m | W/H: \${wh.toFixed(2)}\${wh > 1 ? ' [!]' : ''}\`;

  const modeEl = document.getElementById('height-mode-badge')!;
  modeEl.textContent = isExactAnchor
    ? \`Węzeł kluczowy: \${nearestAnchor} m (edycja bezpośrednia)\`
    : \`Interpolacja pośrednia (log2 h) · edytuj najbliższy węzeł \${nearestAnchor} m\`;
  modeEl.className = isExactAnchor ? 'badge badge-green' : 'badge badge-blue';

  drawOverlayGuides(w, hPx, cx, cy, frustumW, frustumH, profile);
}

function drawOverlayGuides(
  w: number,
  hPx: number,
  cx: number,
  cy: number,
  frustumW: number,
  frustumH: number,
  profile: SpeciesProfile
) {
  const ov = document.getElementById('overlay-canvas') as HTMLCanvasElement;
  if (ov.width !== w || ov.height !== hPx) {
    ov.width = w;
    ov.height = hPx;
  }
  const ctx = ov.getContext('2d')!;
  ctx.clearRect(0, 0, w, hPx);

  const worldToY = (wy: number) => ((cy + frustumH * 0.5 - wy) / frustumH) * hPx;
  const worldToX = (wx: number) => ((wx - (cx - frustumW * 0.5)) / frustumW) * w;
  for (const mh of [0, 6, 9, 15, 24]) {
    const py = worldToY(mh);
    if (py < 12 || py > hPx - 12) continue;
    ctx.strokeStyle = mh === 0 ? 'rgba(24,24,27,0.35)' : 'rgba(24,24,27,0.12)';
    ctx.setLineDash(mh === 0 ? [] : [4, 4]);
    ctx.beginPath();
    ctx.moveTo(12, py);
    ctx.lineTo(w - 12, py);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = mh === 0 ? '#18181b' : '#71717a';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(mh + ' m', 14, py - 4);
  }

  // Kontur bryły docinającej (CrownEnvelope)
  if (!profile.disableEnvelope) {
    const env = new CrownEnvelope(profile);
    const steps = 48;
    const tMax = env.shape === 'CYLINDRICAL' ? 1.0 : 1.02;
    ctx.save();
    ctx.strokeStyle = profile.prune ? 'rgba(37, 99, 235, 0.65)' : 'rgba(161, 161, 170, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * tMax;
        const wy = (env.base + t * (1 - env.base)) * currentHeight;
        const wr = env.spread * crownRatio(env.shape, t, env.peak) * currentHeight * sign;
        const px = worldToX(wr);
        const py = worldToY(wy);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

// UI wiring
function populateSpeciesSelect() {
  const sel = document.getElementById('species-select') as HTMLSelectElement;
  sel.innerHTML = '';
  for (const k of ALL_KINDS) {
    const opt = document.createElement('option');
    opt.value = k;
    const src = describeTreeKindModelSource(k);
    opt.textContent = \`\${k} — \${src.multiHeightJson ? 'wielowys. JSON' : src.fitted ? 'dopasowany (1 wys.)' : 'bazowy'}\`;
    sel.appendChild(opt);
  }
  sel.value = currentKind;
}

function buildParamInputs() {
  const container = document.getElementById('params-container')!;
  container.innerHTML = '';
  const { profile, nearestAnchor } = getEffectiveProfile(currentKind, currentHeight);
  const targetMap = getAnchorMap(currentKind);
  const editProfile = targetMap.get(nearestAnchor) ?? structuredClone(profile);

  const updateField = (setter: (p: SpeciesProfile, v: any) => void, val: any) => {
    setter(editProfile, val);
    targetMap.set(nearestAnchor, editProfile);
    renderTree();
  };

  const updateAllAnchorsField = (setter: (p: SpeciesProfile, v: any) => void, val: any) => {
    for (const [ah, ap] of targetMap.entries()) {
      setter(ap, val);
      targetMap.set(ah, ap);
    }
    setter(editProfile, val);
    renderTree();
  };

  const addSection = (title: string, fields: Array<{ label: string; type: 'number' | 'select' | 'checkbox'; value: any; step?: number; min?: number; max?: number; options?: string[]; onChange: (v: any) => void }>) => {
    const det = document.createElement('details');
    det.open = true;
    const sum = document.createElement('summary');
    sum.textContent = title;
    det.appendChild(sum);
    const grid = document.createElement('div');
    grid.className = 'param-grid';

    for (const f of fields) {
      const row = document.createElement('label');
      row.className = 'param-row';
      const hdr = document.createElement('span');
      hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:4px;';
      const span = document.createElement('span');
      span.textContent = f.label;
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'param-reset';
      resetBtn.textContent = '↺';
      resetBtn.title = 'Przywróć wartość bazową';
      hdr.appendChild(span);
      hdr.appendChild(resetBtn);
      row.appendChild(hdr);

      const fittedEntry = FITTED_PROFILES.find((x) => x.ref === currentKind);
      const baseProf = fittedEntry?.heightAnchors?.find((a) => Math.abs(a.h - currentHeight) < 1e-6)?.profile ?? fittedEntry?.profile ?? profile;
      const baseVal = f.type === 'number' ? getParamValue(baseProf, title, f.label) : (baseProf as any)[f.label];
      const syncDirty = (curVal: any) => {
        const dirty = baseVal !== undefined && (typeof curVal === 'number' && typeof baseVal === 'number' ? Math.abs(curVal - baseVal) > 1e-6 : curVal !== baseVal);
        row.classList.toggle('param-dirty', dirty);
        resetBtn.style.visibility = dirty ? 'visible' : 'hidden';
      };

      if (f.type === 'select') {
        const s = document.createElement('select');
        for (const o of f.options!) {
          const opt = document.createElement('option');
          opt.value = o;
          opt.textContent = o;
          s.appendChild(opt);
        }
        s.value = String(f.value);
        s.onchange = () => { f.onChange(s.value); syncDirty(s.value); };
        resetBtn.onclick = (e) => { e.preventDefault(); if (baseVal !== undefined) { s.value = String(baseVal); f.onChange(baseVal); syncDirty(baseVal); } };
        syncDirty(f.value);
        row.appendChild(s);
      } else if (f.type === 'checkbox') {
        const c = document.createElement('input');
        c.type = 'checkbox';
        c.checked = Boolean(f.value);
        c.onchange = () => { f.onChange(c.checked); syncDirty(c.checked); };
        resetBtn.onclick = (e) => { e.preventDefault(); if (baseVal !== undefined) { c.checked = Boolean(baseVal); f.onChange(Boolean(baseVal)); syncDirty(Boolean(baseVal)); } };
        syncDirty(Boolean(f.value));
        row.appendChild(c);
      } else {
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.value = String(f.value ?? 0);
        if (f.step !== undefined) inp.step = String(f.step);
        if (f.min !== undefined) inp.min = String(f.min);
        if (f.max !== undefined) inp.max = String(f.max);
        inp.onfocus = () => updateInlineChart(title, f.label);
        inp.oninput = () => {
          const n = parseFloat(inp.value);
          if (!Number.isNaN(n)) {
            f.onChange(n);
            syncDirty(n);
            updateInlineChart(title, f.label);
          }
        };
        resetBtn.onclick = (e) => {
          e.preventDefault();
          if (baseVal !== undefined) {
            inp.value = String(baseVal);
            f.onChange(baseVal);
            syncDirty(baseVal);
            updateInlineChart(title, f.label);
          }
        };
        syncDirty(f.value);
        row.appendChild(inp);
      }
      grid.appendChild(row);
    }
    det.appendChild(grid);
    container.appendChild(det);
  };

  addSection('Pień i korona', [
    { label: 'crownShape', type: 'select', value: profile.crownShape, options: CROWN_SHAPES, onChange: (v) => updateField((p, x) => (p.crownShape = x), v) },
    { label: 'envelopeClipProbability', type: 'number', step: 0.05, min: 0, max: 1, value: profile.envelopeClipProbability ?? 0.72, onChange: (v) => updateField((p, x) => (p.envelopeClipProbability = x), v) },
    { label: 'crownSpreadRatio', type: 'number', step: 0.01, min: 0.05, max: 1.5, value: profile.crownSpreadRatio, onChange: (v) => updateField((p, x) => (p.crownSpreadRatio = x), v) },
    { label: 'crownPeak', type: 'number', step: 0.05, min: 0.05, max: 0.95, value: profile.crownPeak ?? 0.4, onChange: (v) => updateField((p, x) => (p.crownPeak = x), v) },
    { label: 'trunkHeightRatio', type: 'number', step: 0.01, min: 0.02, max: 0.9, value: profile.trunkHeightRatio, onChange: (v) => updateField((p, x) => (p.trunkHeightRatio = x), v) },
    { label: 'trunkBaseRadiusRatio', type: 'number', step: 0.001, min: 0.002, max: 0.05, value: profile.trunkBaseRadiusRatio, onChange: (v) => updateField((p, x) => (p.trunkBaseRadiusRatio = x), v) },
    { label: 'trunkLengthRatio', type: 'number', step: 0.02, min: 0.2, max: 1.0, value: profile.trunkLengthRatio, onChange: (v) => updateField((p, x) => (p.trunkLengthRatio = x), v) },
    { label: 'trunkTipRatio', type: 'number', step: 0.01, min: 0.01, max: 0.5, value: profile.trunkTipRatio ?? 0.1, onChange: (v) => updateField((p, x) => (p.trunkTipRatio = x), v) },
    { label: 'trunkTaper', type: 'number', step: 0.05, min: 0, max: 1, value: profile.trunkTaper ?? 0.15, onChange: (v) => updateField((p, x) => (p.trunkTaper = x), v) },
    { label: 'trunkCurveV', type: 'number', step: 0.5, min: 0, max: 30, value: profile.trunkCurveV, onChange: (v) => updateField((p, x) => (p.trunkCurveV = x), v) },
    { label: 'ratioPower', type: 'number', step: 0.05, min: 0.5, max: 2.5, value: profile.ratioPower, onChange: (v) => updateField((p, x) => (p.ratioPower = x), v) },
    { label: 'flareFactor', type: 'number', step: 0.02, min: 1.0, max: 2.0, value: profile.flareFactor, onChange: (v) => updateField((p, x) => (p.flareFactor = x), v) },
  ]);

  addSection('Liście i styl', [
    { label: 'leafSizeCm', type: 'number', step: 0.5, min: 1, max: 60, value: Number((profile.leafSizeCm ?? profile.leafSizeRatio * currentHeight * 100).toFixed(1)), onChange: (v) => updateField((p, x) => { p.leafSizeCm = x; p.leafSizeRatio = (x / 100) / Math.max(0.5, currentHeight); }, v) },
    { label: 'leafSizeRatio', type: 'number', step: 0.001, min: 0.002, max: 0.08, value: profile.leafSizeRatio, onChange: (v) => updateField((p, x) => { delete p.leafSizeCm; p.leafSizeRatio = x; }, v) },
    { label: 'leafAspect', type: 'number', step: 0.05, min: 0.1, max: 1.5, value: profile.leafAspect ?? 0.55, onChange: (v) => updateField((p, x) => (p.leafAspect = x), v) },
    { label: 'leafFlatness', type: 'number', step: 0.05, min: 0, max: 1, value: profile.leafFlatness ?? 0, onChange: (v) => updateField((p, x) => (p.leafFlatness = x), v) },
    { label: 'petioleLengthRatio', type: 'number', step: 0.05, min: 0, max: 0.8, value: profile.petioleLengthRatio ?? 0.15, onChange: (v) => updateField((p, x) => (p.petioleLengthRatio = x), v) },
    { label: 'petiolePliancy', type: 'number', step: 0.05, min: 0, max: 1, value: profile.petiolePliancy ?? 0, onChange: (v) => updateField((p, x) => (p.petiolePliancy = x), v) },
    { label: 'leafDensity', type: 'number', step: 2, min: 0, max: 150, value: profile.leafDensity ?? 38, onChange: (v) => updateField((p, x) => (p.leafDensity = x), v) },
    { label: 'leafClump', type: 'number', step: 1, min: 1, max: 16, value: profile.leafClump ?? 4, onChange: (v) => updateField((p, x) => (p.leafClump = Math.round(x)), v) },
    { label: 'jitterStrength', type: 'number', step: 0.01, min: 0, max: 0.3, value: profile.jitterStrength, onChange: (v) => updateField((p, x) => (p.jitterStrength = x), v) },
    { label: 'pliancy', type: 'number', step: 1, min: 0, max: 45, value: profile.pliancy ?? 0, onChange: (v) => updateField((p, x) => (p.pliancy = x), v) },
    { label: 'prune', type: 'checkbox', value: profile.prune ?? true, onChange: (v) => updateField((p, x) => (p.prune = x), v) },
    { label: 'outwardBias', type: 'number', step: 0.05, min: 0, max: 1, value: profile.outwardBias ?? 0.5, onChange: (v) => updateField((p, x) => (p.outwardBias = x), v) },
  ]);

  const leafTypeEl = document.getElementById('leaf-type-controls');
  if (leafTypeEl) {
    leafTypeEl.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'ctrl-row';
    const lbl = document.createElement('label');
    lbl.textContent = 'leafShape';
    row.appendChild(lbl);
    const sel = document.createElement('select');
    const curShape = profile.leafShape ?? 'hex';
    for (const opt of ['tri', 'quad', 'penta', 'hex']) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === curShape) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => updateAllAnchorsField((p, x) => { p.leafShape = x; delete p.leafOutline; }, sel.value));
    row.appendChild(sel);
    leafTypeEl.appendChild(row);
  }

  profile.levels.forEach((lvl, idx) => {
    addSection(\`Poziom gałęzi L\${idx + 1}\`, [
      { label: 'count', type: 'number', step: 1, min: 1, max: 40, value: lvl.count, onChange: (v) => updateField((p, x) => { if (p.levels[idx]) p.levels[idx].count = Math.round(x); }, v) },
      { label: 'downAngle', type: 'number', step: 1, min: 5, max: 120, value: lvl.downAngle, onChange: (v) => updateField((p, x) => { if (p.levels[idx]) p.levels[idx].downAngle = x; }, v) },
      { label: 'downAngleV', type: 'number', step: 1, min: 0, max: 45, value: lvl.downAngleV, onChange: (v) => updateField((p, x) => { if (p.levels[idx]) p.levels[idx].downAngleV = x; }, v) },
      { label: 'lengthRatio', type: 'number', step: 0.02, min: 0.1, max: 1.5, value: lvl.lengthRatio, onChange: (v) => updateField((p, x) => { if (p.levels[idx]) p.levels[idx].lengthRatio = x; }, v) },
      { label: 'curve', type: 'number', step: 2, min: -90, max: 90, value: lvl.curve, onChange: (v) => updateField((p, x) => { if (p.levels[idx]) p.levels[idx].curve = x; }, v) },
      { label: 'curveV', type: 'number', step: 2, min: 0, max: 45, value: lvl.curveV, onChange: (v) => updateField((p, x) => { if (p.levels[idx]) p.levels[idx].curveV = x; }, v) },
      { label: 'tropism', type: 'number', step: 0.05, min: -3, max: 1, value: lvl.tropism, onChange: (v) => updateField((p, x) => { if (p.levels[idx]) p.levels[idx].tropism = x; }, v) },
      { label: 'fork', type: 'number', step: 1, min: 0, max: 60, value: lvl.fork, onChange: (v) => updateField((p, x) => { if (p.levels[idx]) p.levels[idx].fork = x; }, v) },
      { label: 'taper', type: 'number', step: 0.05, min: 0, max: 1, value: lvl.taper ?? 0.2, onChange: (v) => updateField((p, x) => { if (p.levels[idx]) p.levels[idx].taper = x; }, v) },
      { label: 'tipRatio', type: 'number', step: 0.02, min: 0.05, max: 1, value: lvl.tipRatio ?? 0.25, onChange: (v) => updateField((p, x) => { if (p.levels[idx]) p.levels[idx].tipRatio = x; }, v) },
    ]);
  });
}

function syncAnchorButtons() {
  const jsonHeights = new Set(describeTreeKindModelSource(currentKind).anchorHeights);
  document.querySelectorAll('.anchor-btn').forEach((btn) => {
    const h = Number((btn as HTMLElement).dataset.h);
    const hasJson = jsonHeights.has(h);
    btn.classList.toggle('active', Math.abs(h - currentHeight) < 0.05);
    btn.classList.toggle('has-json', hasJson);
    btn.textContent = hasJson ? \`\${h} m ●\` : \`\${h} m\`;
  });
  (document.getElementById('height-slider') as HTMLInputElement).value = String(currentHeight);
  document.getElementById('height-val')!.textContent = currentHeight.toFixed(1) + ' m';
}

function initEvents() {
  const speciesSel = document.getElementById('species-select') as HTMLSelectElement;
  speciesSel.onchange = () => {
    currentKind = speciesSel.value as TreeKind;
    currentForm = treeKindParams(currentKind, currentHeight).form;
    (document.getElementById('form-select') as HTMLSelectElement).value = currentForm;
    syncAnchorButtons();
    buildParamInputs();
    renderTree();
  };

  (document.getElementById('form-select') as HTMLSelectElement).onchange = (e) => {
    currentForm = (e.target as HTMLSelectElement).value as TrunkForm;
    renderTree();
  };
  (document.getElementById('detail-select') as HTMLSelectElement).onchange = (e) => {
    currentDetail = (e.target as HTMLSelectElement).value as TreeDetail;
    renderTree();
  };
  (document.getElementById('foliage-check') as HTMLInputElement).onchange = (e) => {
    showFoliage = (e.target as HTMLInputElement).checked;
    renderTree();
  };
  document.querySelectorAll('.season-btn').forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => {
      currentSeason = ((btn as HTMLElement).dataset.season || 'SUMMER') as Season;
      document.querySelectorAll('.season-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderTree();
    };
  });

  const windChk = document.getElementById('wind-enable') as HTMLInputElement;
  const windSel = document.getElementById('wind-mode') as HTMLSelectElement;
  const windRng = document.getElementById('wind-strength') as HTMLInputElement;
  const windVal = document.getElementById('wind-val')!;
  const syncWind = () => {
    windEnabled = windChk.checked;
    windMode = windSel.value as 'SWAY' | 'STATIC';
    windStrength = parseFloat(windRng.value);
    windVal.textContent = windStrength.toFixed(2);
    applyWindDeformation(windMode === 'STATIC' ? 1.2 : performance.now() * 0.001);
    startWindLoop();
  };
  windChk.onchange = syncWind;
  windSel.onchange = syncWind;
  windRng.oninput = syncWind;

  const seedInp = document.getElementById('seed-input') as HTMLInputElement;
  seedInp.oninput = () => {
    currentSeed = parseInt(seedInp.value, 10) || 1;
    renderTree();
  };
  document.getElementById('seed-prev')!.onclick = () => { currentSeed = Math.max(1, currentSeed - 1); seedInp.value = String(currentSeed); renderTree(); };
  document.getElementById('seed-next')!.onclick = () => { currentSeed += 1; seedInp.value = String(currentSeed); renderTree(); };
  document.getElementById('seed-rand')!.onclick = () => { currentSeed = Math.floor(Math.random() * 9999) + 1; seedInp.value = String(currentSeed); renderTree(); };

  document.querySelectorAll('.anchor-btn').forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => {
      currentHeight = Number((btn as HTMLElement).dataset.h);
      syncAnchorButtons();
      buildParamInputs();
      renderTree();
    };
  });

  const hSlider = document.getElementById('height-slider') as HTMLInputElement;
  hSlider.oninput = () => {
    currentHeight = parseFloat(hSlider.value);
    syncAnchorButtons();
    buildParamInputs();
    renderTree();
  };

  // Drag canvas to rotate Y
  let dragging = false;
  let lastX = 0;
  canvas.onmousedown = (e) => { dragging = true; lastX = e.clientX; };
  window.onmouseup = () => { dragging = false; };
  window.onmousemove = (e) => {
    if (!dragging || !currentCamera) return;
    yawDeg = (yawDeg + (e.clientX - lastX) * 0.6) % 360;
    lastX = e.clientX;
    treeGroup.rotation.y = (yawDeg * Math.PI) / 180;
    renderer.render(scene, currentCamera);
  };

  document.getElementById('btn-reset')!.onclick = () => {
    editedAnchors.delete(currentKind);
    buildParamInputs();
    renderTree();
  };

  const showToast = (msg: string, isError = false) => {
    let el = document.getElementById('studio-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'studio-toast';
      el.style.cssText = 'position:fixed;bottom:16px;right:16px;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:600;color:#fff;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.18);transition:opacity 0.25s;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = isError ? '#dc2626' : '#16a34a';
    el.style.opacity = '1';
    clearTimeout((el as any)._t);
    (el as any)._t = setTimeout(() => { el!.style.opacity = '0'; }, 2400);
  };

  document.getElementById('btn-copy')!.onclick = async () => {
    const { profile } = getEffectiveProfile(currentKind, currentHeight);
    await navigator.clipboard.writeText(JSON.stringify(profile, null, 2));
    showToast('Skopiowano profil JSON do schowka');
  };

  document.getElementById('btn-save')!.onclick = async () => {
    const map = getAnchorMap(currentKind);
    const anchors = [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([h, profile]) => ({ h, profile }));
    const res = await fetch('/api/save-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: currentKind, anchors }),
    });
    const data = await res.json();
    if (data.ok) {
      const fitted = FITTED_PROFILES.find((f) => f.ref === currentKind);
      if (fitted) {
        fitted.heightAnchors = anchors.map((a) => ({ h: a.h, profile: structuredClone(a.profile) }));
      }
      updateInlineChart();
      showToast('Zapisano drzewo ' + currentKind + ' (' + anchors.length + ' węzłów)');
    } else {
      showToast('Błąd: ' + data.error, true);
    }
  };

  window.onresize = () => renderTree();
}

populateSpeciesSelect();
syncAnchorButtons();
initEvents();
buildParamInputs();
renderTree();
`;

const HTML_PAGE = `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="utf-8" />
  <title>usi-tree · Tree Studio (Dev)</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f3f1ec; color: #18181b; display: flex; height: 100vh; overflow: hidden; }
    #viewport { flex: 1; position: relative; background: #fcfbf9; display: flex; flex-direction: column; }
    #canvas-wrap { flex: 1; position: relative; overflow: hidden; }
    #gl-canvas, #overlay-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    #overlay-canvas { pointer-events: none; }
    #status-bar { padding: 8px 14px; background: #f3f1ec; border-top: 1px solid #d4d0c7; font: 12px ui-monospace, monospace; display: flex; justify-content: space-between; gap: 12px; }
    #sidebar { width: 20vw; min-width: 280px; background: #fff; border-left: 1px solid #d4d0c7; display: flex; flex-direction: column; }
    .hdr { padding: 12px 14px; border-bottom: 1px solid #e4e2dc; background: #f8f6f1; }
    .hdr h1 { margin: 0 0 8px; font-size: 16px; }
    .ctrl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ctrl-full { grid-column: 1 / -1; }
    label.ctrl { display: flex; flex-direction: column; gap: 4px; font-size: 11px; font-weight: 600; color: #52525b; }
    select, input[type="number"] { padding: 5px 8px; border: 1px solid #d4d0c7; border-radius: 4px; font-size: 12px; background: #fff; }
    .seed-row, .anchor-row { display: flex; gap: 4px; align-items: center; }
    .seed-row input { width: 70px; }
    button { padding: 5px 9px; border: 1px solid #d4d0c7; border-radius: 4px; background: #f8f6f1; cursor: pointer; font-size: 12px; font-weight: 600; }
    button:hover { background: #ebe8e0; }
    button.has-json { border-color: #16a34a; color: #166534; background: #f0fdf4; }
    button.active { background: #18181b; color: #fff; border-color: #18181b; }
    button.active.has-json { background: #166534; color: #fff; border-color: #166534; }
    .badge { display: inline-block; padding: 3px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-top: 6px; }
    .badge-green { background: #dcfce7; color: #166534; }
    .badge-blue { background: #dbeafe; color: #1e40af; }
    #params-container { flex: 1; overflow-y: auto; padding: 10px 14px; }
    details { margin-bottom: 10px; border: 1px solid #e4e2dc; border-radius: 6px; padding: 6px 10px; }
    summary { font-weight: 700; font-size: 12px; cursor: pointer; user-select: none; }
    .param-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; margin-top: 8px; }
    .param-row { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #3f3f46; padding: 3px 4px; border-radius: 4px; }
    .param-dirty { background: #fef3c7; color: #92400e; font-weight: 600; }
    .param-dirty input, .param-dirty select { border-color: #d97706; }
    .param-reset { border: 1px solid #d4d4d8; background: #fff; border-radius: 3px; font-size: 10px; line-height: 1; padding: 1px 4px; cursor: pointer; color: #52525b; }
    .param-reset:hover { background: #fde68a; color: #92400e; }
    .param-clickable { cursor: pointer; text-decoration: underline dotted #94a3b8; }
    .param-clickable:hover { color: #16a34a; }
    #param-chart-modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.35); align-items: center; justify-content: center; z-index: 50; }
    #param-chart-box { background: #fff; border-radius: 8px; padding: 14px 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); width: 460px; max-width: 94vw; }
    #param-chart-hdr { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; font-weight: 700; }
    .actions { padding: 10px 14px; border-top: 1px solid #e4e2dc; display: flex; gap: 8px; background: #f8f6f1; }
    .actions button { flex: 1; }
    #right-panel { width: 20vw; min-width: 280px; background: #fff; border-left: 1px solid #e4e2dc; display: flex; flex-direction: column; padding: 12px 14px; gap: 14px; overflow-y: auto; }
    .rp-card { border: 1px solid #e4e2dc; border-radius: 6px; padding: 10px 12px; background: #fcfbf9; }
    .rp-card h2 { margin: 0 0 8px 0; font-size: 12px; font-weight: 700; color: #18181b; }
    .season-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .season-btn { padding: 6px 8px; border: 1px solid #d4d4d8; border-radius: 5px; background: #fff; font-size: 11px; cursor: pointer; font-weight: 600; }
    .season-btn.active { background: #16a34a; color: #fff; border-color: #16a34a; }
    #leaf-preview-svg { display: block; margin: 4px auto 8px auto; background: #fff; border: 1px solid #e4e2dc; border-radius: 6px; }
    .rp-meta { font-size: 11px; color: #52525b; text-align: center; line-height: 1.4; }
  </style>
</head>
<body>
  <div id="viewport">
    <div id="canvas-wrap">
      <canvas id="gl-canvas"></canvas>
      <canvas id="overlay-canvas"></canvas>
    </div>
    <div id="status-bar">
      <span id="stats-tris">Trójkąty: —</span>
      <span id="stats-dims">Wymiary: —</span>
    </div>
  </div>
  <aside id="sidebar">
    <div class="hdr">
      <h1>usi-tree · Tree Studio (Dev)</h1>
      <div class="ctrl-grid">
        <label class="ctrl ctrl-full">Gatunek / Rodzaj z bazy
          <select id="species-select"></select>
        </label>
        <label class="ctrl">Pokrój (TrunkForm)
          <select id="form-select">
            <option value="SINGLE">SINGLE</option>
            <option value="FORKED">FORKED</option>
            <option value="MULTI">MULTI</option>
          </select>
        </label>
        <label class="ctrl">Szczegółowość
          <select id="detail-select">
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
        </label>
        <label class="ctrl">Ziarno (seed)
          <div class="seed-row">
            <button id="seed-prev">-1</button>
            <input id="seed-input" type="number" value="42" min="1" />
            <button id="seed-next">+1</button>
            <button id="seed-rand">Losuj</button>
          </div>
        </label>
        <label class="ctrl">Widok
          <span style="display:flex;align-items:center;gap:6px;margin-top:4px;font-weight:500;color:#18181b;">
            <input id="foliage-check" type="checkbox" checked /> Z liśćmi
          </span>
        </label>
        <div class="ctrl ctrl-full">
          <span>Wysokość: <strong id="height-val">15.0 m</strong></span>
          <div class="anchor-row" style="margin:4px 0;">
            <button class="anchor-btn" data-h="6">6 m</button>
            <button class="anchor-btn" data-h="9">9 m</button>
            <button class="anchor-btn" data-h="15">15 m</button>
            <button class="anchor-btn" data-h="24">24 m</button>
            <input id="height-slider" type="range" min="3" max="28" step="0.5" value="15" style="flex:1;" />
          </div>
          <span id="height-mode-badge" class="badge badge-green">Węzeł kluczowy: 15 m</span>
        </div>
      </div>
    </div>
    <div id="params-container"></div>
    <div class="actions">
      <button id="btn-reset">Resetuj</button>
      <button id="btn-copy">Kopiuj JSON</button>
      <button id="btn-save">Zapisz drzewo</button>
    </div>
  </aside>
  <aside id="right-panel">
    <div class="rp-card">
      <h2>Pora roku</h2>
      <div class="season-grid">
        <button class="season-btn" data-season="SPRING">Wiosna</button>
        <button class="season-btn active" data-season="SUMMER">Lato</button>
        <button class="season-btn" data-season="AUTUMN">Jesień</button>
        <button class="season-btn" data-season="WINTER">Zima</button>
      </div>
    </div>
    <div class="rp-card">
      <h2>Wiatr</h2>
      <label style="display:flex;align-items:center;gap:6px;font-size:11px;margin-bottom:6px;">
        <input id="wind-enable" type="checkbox" /> Włącz wiatr
      </label>
      <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;">
        <select id="wind-mode">
          <option value="SWAY">Kołysanie (oscylator)</option>
          <option value="STATIC">Jedna klatka (statyczne ugięcie)</option>
        </select>
        <div style="display:flex;align-items:center;gap:6px;">
          <span>Siła: <strong id="wind-val">0.40</strong></span>
          <input id="wind-strength" type="range" min="0" max="1" step="0.05" value="0.4" style="flex:1;" />
        </div>
      </div>
    </div>
    <div class="rp-card">
      <h2>Podgląd liścia</h2>
      <svg id="leaf-preview-svg" viewBox="0 0 180 180" width="180" height="180"></svg>
      <div id="leaf-dims-text" class="rp-meta">—</div>
      <div id="leaf-shape-text" class="rp-meta">—</div>
      <div id="leaf-type-controls" style="margin-top:8px;display:flex;flex-direction:column;gap:4px;"></div>
    </div>
    <div class="rp-card">
      <h2 id="inline-chart-title">Wykres parametru</h2>
      <svg id="inline-chart-svg" viewBox="0 0 310 180" width="100%" height="180"></svg>
      <div id="inline-chart-desc" class="rp-meta" style="text-align:left;margin-top:6px;"></div>
    </div>
  </aside>
  <script src="/bundle.js"></script>
</body>
</html>`;

async function main() {
  const res = await esbuild.build({
    stdin: { contents: CLIENT_ENTRY, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
  });
  const bundleJs = res.outputFiles[0].text;

  const server = http.createServer((req, resHttp) => {
    if (req.url === '/bundle.js') {
      esbuild.build({
        stdin: { contents: CLIENT_ENTRY, resolveDir: process.cwd(), loader: 'ts' },
        bundle: true,
        write: false,
        format: 'iife',
        target: 'es2022',
      }).then((r) => {
        resHttp.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
        resHttp.end(r.outputFiles[0].text);
      }).catch((err) => {
        resHttp.writeHead(500);
        resHttp.end(String(err));
      });
      return;
    }
    if (req.url === '/api/save-profile' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const { kind, height, profile } = JSON.parse(body);
          const fitted = JSON.parse(fs.readFileSync(FITTED_PATH, 'utf-8'));
          const entry = fitted.find((f: any) => f.ref === kind);
          if (!entry) throw new Error(`Gatunek "${kind}" nie ma wpisu w fittedProfiles.json`);
          if (!entry.heightAnchors) entry.heightAnchors = [];
          const idx = entry.heightAnchors.findIndex((a: any) => a.h === height);
          if (idx >= 0) entry.heightAnchors[idx].profile = profile;
          else entry.heightAnchors.push({ h: height, profile });
          entry.heightAnchors.sort((a: any, b: any) => a.h - b.h);
          fs.writeFileSync(FITTED_PATH, JSON.stringify(fitted, null, 2) + '\n');
          resHttp.writeHead(200, { 'Content-Type': 'application/json' });
          resHttp.end(JSON.stringify({ ok: true }));
        } catch (err: any) {
          resHttp.writeHead(400, { 'Content-Type': 'application/json' });
          resHttp.end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }
    resHttp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    resHttp.end(HTML_PAGE);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Tree Studio (Dev) uruchomione: http://${HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
