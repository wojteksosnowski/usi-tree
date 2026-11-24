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
import { SPECIES_PROFILES as BASE_PROFILES } from '../src/core/speciesProfiles';
import { normalizeTaper } from '../src/core/growthEngine';
import { treeKindParams as baseKindParams } from '../src/core/treeSpeciesRegistry';
import { listAssertionSummaries, readAssertionModel, writeAssertionModel } from './assertionStore';

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
} from '${path.resolve('src/three/index').replace(/\\/g, '/')}';
import {
  FITTED_PROFILES,
} from '${path.resolve('src/profiles/index').replace(/\\/g, '/')}';
import {
  treeKindParams,
  describeTreeKindModelSource,
  type TreeKind,
} from '${path.resolve('src/core/treeSpeciesRegistry').replace(/\\/g, '/')}';
import {
  evalParameterCurve,
  fitParameterCurve,
  profileAtHeight,
  resolveNumericParam,
  scaleProfileByHeight,
} from '${path.resolve('src/core/heightProfile').replace(/\\/g, '/')}';
import { paramRange } from '${path.resolve('src/core/paramSpec').replace(/\\/g, '/')}';
import { CrownEnvelope, crownRatio } from '${path.resolve('src/core/crownEnvelope').replace(/\\/g, '/')}';
import { countMeshTriangles, TREE_LOD_PRESETS } from '${path.resolve('src/core/treeLod').replace(/\\/g, '/')}';
import type { SpeciesProfile, TrunkForm, TreeDetail, TreeMeshLod, CrownShape } from '${path.resolve('src/core/types').replace(/\\/g, '/')}';

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
let currentLod = '';
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
  lod?: TreeMeshLod;
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
  const anchors = heights.map((ah) => ({ h: ah, profile: map.get(ah)! }));
  return { profile: profileAtHeight(anchors, h), isExactAnchor: exact !== undefined, nearestAnchor: nearest };
}

// Three.js setup
const canvas = document.getElementById('gl-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0.0);

const barkMat = new THREE.MeshBasicMaterial({ color: 0xb88d66, side: THREE.DoubleSide });
const branchMat = new THREE.MeshBasicMaterial({ color: 0x7c5838, side: THREE.DoubleSide });
const leafMats = [
  new THREE.MeshBasicMaterial({ color: 0xa8a66e, side: THREE.DoubleSide }),
  new THREE.MeshBasicMaterial({ color: 0x7a7a42, side: THREE.DoubleSide }),
  new THREE.MeshBasicMaterial({ color: 0x4f4b26, side: THREE.DoubleSide }),
];

const scene = new THREE.Scene();
const treeGroup = new THREE.Group();
scene.add(treeGroup);
let currentMesh: THREE.Mesh | null = null;

const BARK_COLORS = [
  { label: 'Biały (brzoza)', hex: 0xe8e4dc },
  { label: 'Szary (buk)', hex: 0x8e9296 },
  { label: 'Jasny brąz', hex: 0xb88d66 },
  { label: 'Średni brąz', hex: 0x7c5838 },
  { label: 'Ciemny brąz', hex: 0x4a3423 },
];

function getDefaultBarkIndices(kind: string): { trunk: number; branch: number } {
  const k = kind.toUpperCase();
  if (k.includes('BIRCH')) return { trunk: 0, branch: 4 };
  if (k.includes('BEECH')) return { trunk: 1, branch: 1 };
  if (k.includes('PINE')) return { trunk: 2, branch: 2 };
  if (k.includes('OAK') || k.includes('SPRUCE') || k.includes('FIR')) return { trunk: 4, branch: 3 };
  return { trunk: 3, branch: 3 };
}

function lerpHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function sampleRamp(stops: [number, number, number][], t01: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, t01));
  const scaled = t * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  return [
    lerpHex(stops[idx][0], stops[idx + 1][0], frac),
    lerpHex(stops[idx][1], stops[idx + 1][1], frac),
    lerpHex(stops[idx][2], stops[idx + 1][2], frac),
  ];
}

function getSeasonFoliagePalette(season: Season, conifer: boolean, t01: number): [number, number, number] {
  if (conifer) {
    if (season === 'WINTER') {
      return sampleRamp([
        [0x6b846e, 0x4c6652, 0x2f4335],
        [0x5a7048, 0x3f5432, 0x26351d],
        [0x3c5848, 0x284034, 0x172820],
      ], t01);
    }
    if (season === 'SPRING') {
      return sampleRamp([
        [0x9cc458, 0x769e38, 0x4e6e22],
        [0x76a244, 0x547d2d, 0x34541a],
        [0x4f7c3c, 0x365c28, 0x203a16],
      ], t01);
    }
    return sampleRamp([
      [0x7a9a4a, 0x587630, 0x38501c],
      [0x587c3c, 0x3e5c28, 0x263c16],
      [0x385a38, 0x264228, 0x162818],
    ], t01);
  }
  if (season === 'SPRING') {
    return sampleRamp([
      [0xd2e472, 0xa8c448, 0x789428],
      [0xb4d468, 0x8cb842, 0x5c8426],
      [0x84bc58, 0x5c9436, 0x3a6420],
    ], t01);
  }
  if (season === 'AUTUMN') {
    // Od jasno żółtego (brzozy) przez pomarańcz, czerwień do brązu (dęby)
    return sampleRamp([
      [0xf6e068, 0xdcb834, 0xa6821c],
      [0xe59838, 0xc86420, 0x8a3a14],
      [0xd64a28, 0xa82a18, 0x6e180c],
      [0x9a5c32, 0x724020, 0x4a2812],
    ], t01);
  }
  if (season === 'WINTER') {
    return sampleRamp([
      [0x8a7a64, 0x6a5c4a, 0x4a3e30],
      [0x706454, 0x52483c, 0x383026],
    ], t01);
  }
  return sampleRamp([
    [0xc4c868, 0x989e40, 0x6a7026],
    [0xa8a66e, 0x7a7a42, 0x4f4b26],
    [0x6e9444, 0x4c6e2c, 0x2e4818],
  ], t01);
}

const SPECIES_COLOR_STORAGE_KEY = 'usi-tree-studio-colors';
type SpeciesColorPrefs = {
  foliageRangeBySeason?: Partial<Record<Season, [number, number]>>;
  trunkColorIndex?: number;
  branchColorIndex?: number;
};
const speciesColorPrefs: Record<string, SpeciesColorPrefs> = (() => {
  try { return JSON.parse(localStorage.getItem(SPECIES_COLOR_STORAGE_KEY) || '{}'); } catch { return {}; }
})();

function saveSpeciesColorPrefs() {
  try { localStorage.setItem(SPECIES_COLOR_STORAGE_KEY, JSON.stringify(speciesColorPrefs)); } catch { /* ignore */ }
}

function seedToUnit(seed: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

function getFoliageRange01(kind: string, season: Season): [number, number] {
  const r = speciesColorPrefs[kind]?.foliageRangeBySeason?.[season];
  if (Array.isArray(r) && r.length === 2) {
    const a = Math.max(0, Math.min(1, r[0]));
    const b = Math.max(0, Math.min(1, r[1]));
    return [Math.min(a, b), Math.max(a, b)];
  }
  return [0.15, 0.85];
}

function setFoliageRange01(kind: string, season: Season, min01: number, max01: number) {
  if (!speciesColorPrefs[kind]) speciesColorPrefs[kind] = {};
  if (!speciesColorPrefs[kind].foliageRangeBySeason) speciesColorPrefs[kind].foliageRangeBySeason = {};
  const a = Math.max(0, Math.min(1, min01));
  const b = Math.max(0, Math.min(1, max01));
  speciesColorPrefs[kind].foliageRangeBySeason![season] = [Math.min(a, b), Math.max(a, b)];
  saveSpeciesColorPrefs();
}

function getFoliageSlider01(kind: string, season: Season): number {
  const [min01, max01] = getFoliageRange01(kind, season);
  return min01 + seedToUnit(currentSeed) * (max01 - min01);
}

function getBarkColorIndices(kind: string): { trunk: number; branch: number } {
  const def = getDefaultBarkIndices(kind);
  const prefs = speciesColorPrefs[kind];
  return {
    trunk: typeof prefs?.trunkColorIndex === 'number' ? prefs.trunkColorIndex : def.trunk,
    branch: typeof prefs?.branchColorIndex === 'number' ? prefs.branchColorIndex : def.branch,
  };
}

function setBarkColorIndex(kind: string, target: 'trunk' | 'branch', idx: number) {
  if (!speciesColorPrefs[kind]) speciesColorPrefs[kind] = {};
  if (target === 'trunk') speciesColorPrefs[kind].trunkColorIndex = idx;
  else speciesColorPrefs[kind].branchColorIndex = idx;
  saveSpeciesColorPrefs();
}

function applyTreeColors() {
  const kindInfo = treeKindParams(currentKind, currentHeight);
  const conifer = isConifer(kindInfo.species);
  const [min01, max01] = getFoliageRange01(currentKind, currentSeason);
  const t01 = getFoliageSlider01(currentKind, currentSeason);
  const palette = getSeasonFoliagePalette(currentSeason, conifer, t01);
  for (let i = 0; i < 3; i++) leafMats[i].color.setHex(palette[i]);
  const barkIdx = getBarkColorIndices(currentKind);
  barkMat.color.setHex((BARK_COLORS[barkIdx.trunk] ?? BARK_COLORS[3]).hex);
  branchMat.color.setHex((BARK_COLORS[barkIdx.branch] ?? BARK_COLORS[3]).hex);

  const minEl = document.getElementById('foliage-range-min') as HTMLInputElement | null;
  const maxEl = document.getElementById('foliage-range-max') as HTMLInputElement | null;
  const gradEl = document.getElementById('foliage-color-gradient') as HTMLElement | null;
  const swatchEl = document.getElementById('foliage-color-swatch') as HTMLElement | null;
  const seasonLabelEl = document.getElementById('foliage-color-season') as HTMLElement | null;
  if (minEl) minEl.value = String(Math.round(min01 * 100));
  if (maxEl) maxEl.value = String(Math.round(max01 * 100));
  if (gradEl) {
    const stops = [0, 0.33, 0.66, 1].map((s) => '#' + getSeasonFoliagePalette(currentSeason, conifer, s)[1].toString(16).padStart(6, '0'));
    gradEl.style.background = 'linear-gradient(to right, ' + stops.join(', ') + ')';
  }
  if (swatchEl) swatchEl.style.background = '#' + palette[1].toString(16).padStart(6, '0');
  if (seasonLabelEl) {
    const names: Record<Season, string> = { SPRING: 'Wiosna', SUMMER: 'Lato', AUTUMN: 'Jesień', WINTER: 'Zima' };
    seasonLabelEl.textContent = names[currentSeason] + (conifer ? ' (iglaste)' : ' (liściaste)');
  }
  document.querySelectorAll('#trunk-color-swatches .bark-swatch').forEach((b, i) => b.classList.toggle('active', i === barkIdx.trunk));
  document.querySelectorAll('#branch-color-swatches .bark-swatch').forEach((b, i) => b.classList.toggle('active', i === barkIdx.branch));
}

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

  const palette = getSeasonFoliagePalette(currentSeason, conifer, getFoliageSlider01(currentKind, currentSeason));
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

function setParamValue(p: SpeciesProfile, sectionTitle: string, label: string, v: number): boolean {
  const m = sectionTitle.match(/L(\\d+)/);
  if (m) {
    const lvl = p.levels?.[parseInt(m[1], 10) - 1];
    if (!lvl) return false;
    (lvl as any)[label] = v;
  } else {
    (p as any)[label] = v;
  }
  return true;
}

/** Punkt wolno przeciągać tylko, gdy zapis i odczyt dają tę samą wartość (parametry proste, nie wyliczane). */
function isChartParamDraggable(sectionTitle: string, label: string): boolean {
  const map = getAnchorMap(currentKind);
  const first = [...map.entries()].sort((a, b) => a[0] - b[0])[0];
  if (!first) return false;
  const probe = structuredClone(first[1]);
  const cur = getParamValue(probe, sectionTitle, label, first[0]);
  if (cur === undefined) return false;
  const test = cur + 0.5;
  if (!setParamValue(probe, sectionTitle, label, test)) return false;
  return getParamValue(probe, sectionTitle, label, first[0]) === test;
}

function getParamValue(p: SpeciesProfile, sectionTitle: string, label: string, heightM = currentHeight): number | undefined {
  const m = sectionTitle.match(/L(\\d+)/);
  const levelIdx = m ? parseInt(m[1], 10) - 1 : null;
  return resolveNumericParam(p, levelIdx, label, heightM);
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
  taperShape: 'Kształt zwężania: 0 = liniowo, 1 = wykładniczo do tego samego czubka (czubek zadaje tipRatio / trunkTipRatio). Poziom bez własnej wartości dziedziczy wartość gatunku.',
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

type ChartGeom = { W: number; H: number; P: { l: number; r: number; t: number; b: number }; minY: number; maxY: number; sectionTitle: string; label: string; draggable: boolean };
let lastChartGeom: ChartGeom | null = null;

function renderChartInto(
  svgEl: HTMLElement,
  titleEl: HTMLElement,
  sectionTitle: string,
  label: string,
  W: number,
  H: number,
  opts?: { override?: { h: number; y: number }; frozen?: { minY: number; maxY: number } }
) {
  const map = getAnchorMap(currentKind);
  const heights = [...map.keys()].sort((a, b) => a - b);
  const pts: { h: number; y: number }[] = [];
  for (const h of heights) {
    const prof = map.get(h)!;
    const y = getParamValue(prof, sectionTitle, label, h);
    if (y !== undefined) pts.push({ h, y: opts?.override && opts.override.h === h ? opts.override.y : y });
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
  const pr = paramRange(label);
  for (let i = 0; i <= 60; i++) {
    const h = minH + ((maxH - minH) * i) / 60;
    samples.push({ h, y: Math.min(pr.max, Math.max(pr.min, fit.eval(h))) });
  }
  const effProf = getEffectiveProfile(currentKind, currentHeight).profile;
  const curY = getParamValue(effProf, sectionTitle, label) ?? evalParameterCurve(fit, currentHeight, label);
  const allY = [...pts.map((p) => p.y), ...samples.map((s) => s.y), curY];
  let minY = Math.min(...allY);
  let maxY = Math.max(...allY);
  if (opts?.frozen) {
    minY = opts.frozen.minY;
    maxY = opts.frozen.maxY;
  } else if (Math.abs(maxY - minY) < 1e-9) {
    const c = (minY + maxY) / 2;
    const rs = pr.max - pr.min;
    const span = Math.max(Math.abs(c) * 0.5, Number.isFinite(rs) ? rs * 0.1 : 0, 1e-3);
    minY = c - span / 2;
    maxY = c + span / 2;
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
  const draggable = isChartParamDraggable(sectionTitle, label);
  lastChartGeom = { W, H, P, minY, maxY, sectionTitle, label, draggable };
  const fmtV = (y: number) => (Number.isInteger(y) ? String(y) : y.toPrecision(4));
  const ptsSvg = pts
    .map((p) => {
      const cx = sx(p.h).toFixed(1);
      const cy = sy(p.y).toFixed(1);
      const tip = '<title>' + p.h + ' m: ' + fmtV(p.y) + '</title>';
      const hit = draggable ? '<circle cx="' + cx + '" cy="' + cy + '" r="9" fill="transparent" />' : '';
      return '<g data-h="' + p.h + '"' + (draggable ? ' style="cursor:ns-resize"' : '') + '>' + tip + hit +
        '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="#dc2626" stroke="#fff" stroke-width="1.5" /></g>';
    })
    .join('');
  const dragLabel = opts?.override
    ? '<text x="' + Math.min(W - P.r, sx(opts.override.h) + 8).toFixed(1) + '" y="' + Math.max(P.t + 8, sy(opts.override.y) - 8).toFixed(1) +
      '" font-size="11" font-weight="700" fill="#b91c1c">' + opts.override.h + ' m: ' + fmtV(opts.override.y) + '</text>'
    : '';
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
    ptsSvg + dragLabel;
  return true;
}

let chartDragWired = false;
function wireChartDrag(svgEl: HTMLElement, notify: (msg: string, isError?: boolean) => void) {
  if (chartDragWired) return;
  chartDragWired = true;
  let drag: { h: number; pointerId: number; section: string; label: string; frozen: { minY: number; maxY: number }; value: number; moved: boolean } | null = null;

  const valueFromEvent = (e: PointerEvent, g: ChartGeom): number => {
    const rect = svgEl.getBoundingClientRect();
    const yPx = ((e.clientY - rect.top) / rect.height) * g.H;
    const frac = (g.H - g.P.b - yPx) / Math.max(1e-6, g.H - g.P.t - g.P.b);
    let v = g.minY + frac * (g.maxY - g.minY);
    const r = paramRange(g.label);
    v = Math.min(r.max, Math.max(r.min, v));
    return r.integer ? Math.round(v) : v;
  };
  const redraw = (override?: { h: number; y: number }) => {
    if (!drag) return;
    const titleEl = document.getElementById('inline-chart-title');
    if (titleEl) renderChartInto(svgEl, titleEl, drag.section, drag.label, 310, 180, { override, frozen: drag.frozen });
  };
  const finish = () => {
    document.removeEventListener('keydown', onKey, true);
    if (drag) { try { svgEl.releasePointerCapture(drag.pointerId); } catch { /* już zwolniony */ } }
    drag = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !drag) return;
    const d = drag;
    finish();
    updateInlineChart(d.section, d.label);
    notify('Anulowano przeciąganie');
  };
  const commit = (h: number, section: string, label: string, v: number) => {
    const ap = getAnchorMap(currentKind).get(h);
    if (!ap || !setParamValue(ap, section, label, v)) { notify('Nie można zapisać wartości', true); return; }
    renderTree();
    buildParamInputs();
    updateInlineChart(section, label);
  };

  let lastDown: { h: number; t: number; x: number; y: number } | null = null;
  const resetAnchor = (h: number, g: ChartGeom) => {
    const fitted = FITTED_PROFILES.find((x) => x.ref === currentKind);
    const baseProf = fitted?.heightAnchors?.find((a) => Math.abs(a.h - h) < 1e-6)?.profile ?? fitted?.profile ?? treeKindParams(currentKind, h).profile!;
    const baseVal = getParamValue(baseProf, g.sectionTitle, g.label, h);
    if (baseVal === undefined) return;
    commit(h, g.sectionTitle, g.label, baseVal);
    notify(h + ' m: przywrócono wartość bazową');
  };
  svgEl.addEventListener('pointerdown', (e: PointerEvent) => {
    const g = lastChartGeom;
    const node = (e.target as Element).closest?.('[data-h]');
    if (!g || !node || e.button !== 0) return;
    if (!g.draggable) { notify('Ten parametr jest wyliczany, nie można go przeciągać', true); return; }
    const h = parseFloat(node.getAttribute('data-h')!);
    const now = performance.now();
    if (lastDown && lastDown.h === h && now - lastDown.t < 400 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 6) {
      lastDown = null;
      e.preventDefault();
      resetAnchor(h, g);
      return;
    }
    lastDown = { h, t: now, x: e.clientX, y: e.clientY };
    const cur = getParamValue(getAnchorMap(currentKind).get(h)!, g.sectionTitle, g.label, h);
    if (cur === undefined) return;
    drag = { h, pointerId: e.pointerId, section: g.sectionTitle, label: g.label, frozen: { minY: g.minY, maxY: g.maxY }, value: cur, moved: false };
    svgEl.setPointerCapture(e.pointerId);
    document.addEventListener('keydown', onKey, true);
    e.preventDefault();
  });
  svgEl.addEventListener('pointermove', (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId || !lastChartGeom) return;
    drag.value = valueFromEvent(e, lastChartGeom);
    drag.moved = true;
    redraw({ h: drag.h, y: drag.value });
  });
  svgEl.addEventListener('pointerup', (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    finish();
    if (d.moved) commit(d.h, d.section, d.label, d.value);
    else updateInlineChart(d.section, d.label);
  });
  svgEl.addEventListener('pointercancel', () => {
    if (!drag) return;
    const d = drag;
    finish();
    updateInlineChart(d.section, d.label);
  });
}

function updateInlineChart(sectionTitle = lastChartTarget.sectionTitle, label = lastChartTarget.label) {
  lastChartTarget = { sectionTitle, label };
  const svg = document.getElementById('inline-chart-svg');
  const titleEl = document.getElementById('inline-chart-title');
  const descEl = document.getElementById('inline-chart-desc');
  if (svg && titleEl) {
    renderChartInto(svg, titleEl, sectionTitle, label, 310, 180);
    wireChartDrag(svg, (msg, isErr) => (window as any).__studioToast?.(msg, isErr));
  }
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
  currentMesh = new THREE.Mesh(toThreeBufferGeometry(rawRes.mesh), [barkMat, ...leafMats, branchMat]);
  treeGroup.add(currentMesh);
  lastRawMesh = rawRes.mesh;
  syncEdges();
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

interface BgTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  visible: boolean;
}
interface BgTierEntry extends BgTransform {
  fileName: string;
  dataUrl: string;
}
interface BgStoragePayload {
  byTier: Record<string, BgTierEntry>;
  byFile: Record<string, BgTransform>;
}

const BG_STORAGE_KEY = 'usi-tree-studio-bg-v1';
let bgStorage: BgStoragePayload = { byTier: {}, byFile: {} };
const bgImageCache = new Map<string, HTMLImageElement>();
let bgPersistTimer: number | null = null;
let lastViewMetrics = { w: 1, hPx: 1, cx: 0, cy: 0, frustumW: 1, frustumH: 1 };

function getCurrentTierH(): number {
  return getEffectiveProfile(currentKind, currentHeight).nearestAnchor;
}

function getBgTierKey(): string {
  return \`\${currentKind}:\${getCurrentTierH()}\`;
}

function saveBgToLocalStorage() {
  try {
    localStorage.setItem(BG_STORAGE_KEY, JSON.stringify(bgStorage));
  } catch {}
}

function scheduleBgServerSave() {
  if (bgPersistTimer !== null) clearTimeout(bgPersistTimer);
  bgPersistTimer = window.setTimeout(() => {
    fetch('/api/studio-bg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bgStorage),
    }).catch(() => {});
  }, 250);
}

function updateBgEntryAndPersist(entry: BgTierEntry) {
  bgStorage.byTier[getBgTierKey()] = entry;
  bgStorage.byFile[entry.fileName] = {
    scale: entry.scale,
    offsetX: entry.offsetX,
    offsetY: entry.offsetY,
    opacity: entry.opacity,
    visible: entry.visible,
  };
  saveBgToLocalStorage();
  scheduleBgServerSave();
}

async function loadBgStorage() {
  try {
    const raw = localStorage.getItem(BG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        bgStorage = { byTier: parsed.byTier || {}, byFile: parsed.byFile || {} };
      }
    }
  } catch {}
  try {
    const res = await fetch('/api/studio-bg');
    if (res.ok) {
      const srv = await res.json();
      if (srv && typeof srv === 'object') {
        bgStorage = {
          byTier: { ...(bgStorage.byTier || {}), ...(srv.byTier || {}) },
          byFile: { ...(bgStorage.byFile || {}), ...(srv.byFile || {}) },
        };
        saveBgToLocalStorage();
      }
    }
  } catch {}
  drawBackgroundCanvas();
  syncBgControls();
}

function drawBackgroundCanvas() {
  const bg = document.getElementById('bg-canvas') as HTMLCanvasElement | null;
  if (!bg) return;
  const wrap = document.getElementById('canvas-wrap');
  const w = wrap ? wrap.clientWidth : lastViewMetrics.w;
  const hPx = wrap ? wrap.clientHeight : lastViewMetrics.hPx;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (bg.width !== Math.round(w * dpr) || bg.height !== Math.round(hPx * dpr)) {
    bg.width = Math.round(w * dpr);
    bg.height = Math.round(hPx * dpr);
  }
  const ctx = bg.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, hPx);

  const entry = bgStorage.byTier[getBgTierKey()];
  if (!entry || !entry.visible || !entry.dataUrl) {
    ctx.restore();
    return;
  }

  let img = bgImageCache.get(entry.dataUrl);
  if (!img) {
    img = new Image();
    img.onload = () => drawBackgroundCanvas();
    img.src = entry.dataUrl;
    bgImageCache.set(entry.dataUrl, img);
  }
  if (!img.complete || img.naturalWidth === 0) {
    ctx.restore();
    return;
  }

  const { cx, cy, frustumW, frustumH } = lastViewMetrics;
  const worldToX = (wx: number) => ((wx - cx) / frustumW + 0.5) * w;
  const worldToY = (wy: number) => (0.5 - (wy - cy) / frustumH) * hPx;
  const tierH = getCurrentTierH();
  const drawH = tierH * (hPx / Math.max(1e-6, frustumH)) * entry.scale;
  const drawW = drawH * (img.naturalWidth / Math.max(1, img.naturalHeight));
  const drawX = worldToX(entry.offsetX) - drawW * 0.5;
  const drawY = worldToY(entry.offsetY) - drawH;

  ctx.globalAlpha = Math.max(0, Math.min(1, entry.opacity));
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();
}

function syncBgControls() {
  const tierEl = document.getElementById('bg-tier-label');
  if (tierEl) tierEl.textContent = \`\${getCurrentTierH()} m\`;
  const entry = bgStorage.byTier[getBgTierKey()];
  const fileEl = document.getElementById('bg-file-name');
  if (fileEl) fileEl.textContent = entry ? entry.fileName : 'Brak pliku';
  const visEl = document.getElementById('bg-visible') as HTMLInputElement | null;
  if (visEl) visEl.checked = entry ? entry.visible : true;
  const setPair = (idBase: string, val: number) => {
    const r = document.getElementById(\`bg-\${idBase}-range\`) as HTMLInputElement | null;
    const n = document.getElementById(\`bg-\${idBase}-num\`) as HTMLInputElement | null;
    if (r) r.value = String(val);
    if (n) n.value = String(Number(val.toFixed(3)));
  };
  setPair('scale', entry ? entry.scale : 1);
  setPair('ox', entry ? entry.offsetX : 0);
  setPair('oy', entry ? entry.offsetY : 0);
  setPair('op', entry ? entry.opacity : 0.55);
}

function initBgControls() {
  const fileInput = document.getElementById('bg-file-input') as HTMLInputElement | null;
  if (fileInput) {
    fileInput.onchange = () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        const prev = bgStorage.byFile[file.name];
        const entry: BgTierEntry = prev
          ? { ...prev, visible: true, fileName: file.name, dataUrl }
          : { scale: 1, offsetX: 0, offsetY: 0, opacity: 0.55, visible: true, fileName: file.name, dataUrl };
        updateBgEntryAndPersist(entry);
        drawBackgroundCanvas();
        syncBgControls();
      };
      reader.readAsDataURL(file);
    };
  }
  const clearBtn = document.getElementById('bg-clear-btn');
  if (clearBtn) {
    clearBtn.onclick = () => {
      delete bgStorage.byTier[getBgTierKey()];
      saveBgToLocalStorage();
      scheduleBgServerSave();
      drawBackgroundCanvas();
      syncBgControls();
    };
  }
  const visEl = document.getElementById('bg-visible') as HTMLInputElement | null;
  if (visEl) {
    visEl.onchange = () => {
      const entry = bgStorage.byTier[getBgTierKey()];
      if (!entry) return;
      entry.visible = visEl.checked;
      updateBgEntryAndPersist(entry);
      drawBackgroundCanvas();
    };
  }
  const bindPair = (idBase: string, field: keyof BgTransform) => {
    const r = document.getElementById(\`bg-\${idBase}-range\`) as HTMLInputElement | null;
    const n = document.getElementById(\`bg-\${idBase}-num\`) as HTMLInputElement | null;
    const apply = (raw: string) => {
      const v = parseFloat(raw);
      if (!Number.isFinite(v)) return;
      const entry = bgStorage.byTier[getBgTierKey()];
      if (!entry) return;
      (entry[field] as number) = v;
      updateBgEntryAndPersist(entry);
      drawBackgroundCanvas();
      syncBgControls();
    };
    if (r) r.oninput = () => apply(r.value);
    if (n) n.oninput = () => apply(n.value);
  };
  bindPair('scale', 'scale');
  bindPair('ox', 'offsetX');
  bindPair('oy', 'offsetY');
  bindPair('op', 'opacity');
  const resetBtn = document.getElementById('bg-reset-btn');
  if (resetBtn) {
    resetBtn.onclick = () => {
      const entry = bgStorage.byTier[getBgTierKey()];
      if (!entry) return;
      entry.scale = 1;
      entry.offsetX = 0;
      entry.offsetY = 0;
      updateBgEntryAndPersist(entry);
      drawBackgroundCanvas();
      syncBgControls();
    };
  }
}

// Krawędzie face'ów i statystyki pierścieni
const EDGE_STORAGE_KEY = 'usi-tree-studio-edges';
let edgesBark = false;
let edgesLeaves = false;
try {
  const e = JSON.parse(localStorage.getItem(EDGE_STORAGE_KEY) || '{}');
  edgesBark = !!e.bark;
  edgesLeaves = !!e.leaves;
} catch { /* brak localStorage */ }
let edgeLines: THREE.LineSegments[] = [];
let lastRawMesh: { positions: Float32Array; indices: Uint16Array | Uint32Array; groups: { start: number; count: number; materialIndex: number }[] } | null = null;
const barkEdgeMat = new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.85 });
const leafEdgeMat = new THREE.LineBasicMaterial({ color: 0x14532d, transparent: true, opacity: 0.6 });
barkMat.polygonOffset = true; barkMat.polygonOffsetFactor = 1; barkMat.polygonOffsetUnits = 1;
for (const m of leafMats) { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 1; }

function clearEdges() {
  for (const l of edgeLines) { treeGroup.remove(l); l.geometry.dispose(); }
  edgeLines = [];
}
function buildEdges(positions: Float32Array, idx: ArrayLike<number>, mat: THREE.LineBasicMaterial) {
  if (idx.length === 0) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx as ArrayLike<number>), 1));
  const wf = new THREE.WireframeGeometry(g);
  g.dispose();
  const l = new THREE.LineSegments(wf, mat);
  treeGroup.add(l);
  edgeLines.push(l);
}
function syncEdges() {
  clearEdges();
  const m = lastRawMesh;
  if (!m || (!edgesBark && !edgesLeaves)) return;
  if (edgesBark || edgesLeaves) {
    const barkIdx: number[] = [];
    const leafIdx: number[] = [];
    for (const g of m.groups) {
      const slice = m.indices.subarray(g.start, g.start + g.count);
      if (g.materialIndex === 0 || g.materialIndex === 4) {
        if (edgesBark) for (let i = 0; i < slice.length; i++) barkIdx.push(slice[i]);
      } else if (edgesLeaves) {
        for (let i = 0; i < slice.length; i++) leafIdx.push(slice[i]);
      }
    }
    if (edgesBark && barkIdx.length) buildEdges(m.positions, new Uint32Array(barkIdx), barkEdgeMat);
    if (edgesLeaves && leafIdx.length) buildEdges(m.positions, new Uint32Array(leafIdx), leafEdgeMat);
  }
}

type RingStat = { level: number; sides: number; rings: number; ribbon: boolean };
function renderRingInfo(stems: RingStat[], vertices: number, tris: { bark: number; foliage: number; total: number }, nCfgLevels: number) {
  const el = document.getElementById('ring-info');
  if (!el) return;
  const byLevel = new Map<number, { n: number; rings: number; max: number; sides: Set<number>; ribbon: boolean; tris: number }>();
  for (const s of stems) {
    const e = byLevel.get(s.level) ?? { n: 0, rings: 0, max: 0, sides: new Set<number>(), ribbon: false, tris: 0 };
    e.n++; e.rings += s.rings; e.max = Math.max(e.max, s.rings); e.sides.add(s.sides); e.ribbon = e.ribbon || s.ribbon;
    // kora: tuba = 2*boki trójkątów na pasmo; wstęga = 2 na pasmo
    e.tris += s.ribbon ? 2 * Math.max(0, s.rings - 1) : 2 * s.sides * Math.max(0, s.rings - 1);
    byLevel.set(s.level, e);
  }
  const rows = Array.from(byLevel.keys()).sort((a, b) => a - b).map((lv) => {
    const e = byLevel.get(lv)!;
    const sides = Array.from(e.sides).sort((a, b) => a - b).join('/') + (e.ribbon ? ' (wstęga)' : '');
    return '<tr><td>L' + lv + (lv > nCfgLevels ? ' (witki auto)' : '') + '</td><td>' + e.n + '</td><td>' + e.rings + '</td><td>' + (e.rings / e.n).toFixed(1) + '/' + e.max + '</td><td>' + sides + '</td><td>~' + e.tris.toLocaleString() + '</td></tr>';
  }).join('');
  el.innerHTML =
    '<table><thead><tr><th>poz.</th><th>pędy</th><th>pierśc.</th><th>śr./maks</th><th>boki</th><th>tri kory</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div>Razem: kora ' + tris.bark.toLocaleString() + ' tri, liście ' + tris.foliage.toLocaleString() + ' tri, wierzchołki ' + vertices.toLocaleString() + '</div>';
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
  const palette = getSeasonFoliagePalette(currentSeason, conifer, getFoliageSlider01(currentKind, currentSeason));
  const { trunk, branch } = getBarkColorIndices(currentKind);
  barkMat.color.setHex((BARK_COLORS[trunk] ?? BARK_COLORS[3]).hex);
  branchMat.color.setHex((BARK_COLORS[branch] ?? BARK_COLORS[3]).hex);
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
    detail: 'HIGH',
    lod: currentLod ? { ...TREE_LOD_PRESETS[currentLod as keyof typeof TREE_LOD_PRESETS] } : undefined,
    stroke: ILLUSTRATION_STROKE,
  };
  const wind = windEnabled && windStrength > 0
    ? { strength: windStrength, time: windMode === 'SWAY' ? performance.now() * 0.001 : undefined }
    : undefined;
  const ringStats: RingStat[] = [];
  const rawRes = TreeGenerator.meshSkeletonRaw(currentSkeleton, {
    ...currentRenderOpts,
    wind,
    onStem: (info) => ringStats.push(info),
  });

  if (currentMesh) {
    currentMesh.geometry.dispose();
    treeGroup.remove(currentMesh);
  }

  const geom = toThreeBufferGeometry(rawRes.mesh);
  currentMesh = new THREE.Mesh(geom, [barkMat, ...leafMats, branchMat]);
  treeGroup.add(currentMesh);
  lastRawMesh = rawRes.mesh;
  syncEdges();
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
  renderRingInfo(ringStats, rawRes.mesh.positions.length / 3, tris, profile.levels.length);
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

  lastViewMetrics = { w, hPx, cx, cy, frustumW, frustumH };
  drawOverlayGuides(w, hPx, cx, cy, frustumW, frustumH, profile);
  drawBackgroundCanvas();
  syncBgControls();
  schedulePixelFillChart();
}

const PIXEL_FILL_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const PIXEL_FILL_LODS: Array<{ key: keyof typeof TREE_LOD_PRESETS; label: string; color: string }> = [
  { key: 'near', label: 'near', color: '#16a34a' },
  { key: 'mid', label: 'mid', color: '#2563eb' },
  { key: 'far', label: 'far', color: '#d97706' },
  { key: 'shell', label: 'shell', color: '#dc2626' },
];
let pixelFillRes = 128;
let pixelFillTimer: number | null = null;
let pixelFillRt: THREE.WebGLRenderTarget | null = null;
let pixelFillBuf: Uint8Array | null = null;
const offscreenScene = new THREE.Scene();

function schedulePixelFillChart() {
  if (windEnabled && windStrength > 0 && windMode === 'SWAY') return;
  if (pixelFillTimer !== null) window.clearTimeout(pixelFillTimer);
  pixelFillTimer = window.setTimeout(() => {
    pixelFillTimer = null;
    updatePixelFillChart();
  }, 120);
}

function measureLodPixelFill(): Record<string, number[]> | null {
  if (!currentSkeleton || !currentCamera || !currentRenderOpts) return null;
  const rect = canvas.parentElement!.getBoundingClientRect();
  const w = Math.max(320, Math.floor(rect.width));
  const hPx = Math.max(320, Math.floor(rect.height));
  const aspect = w / hPx;
  const rtH = pixelFillRes;
  const rtW = Math.max(64, Math.round(rtH * aspect));

  if (!pixelFillRt || pixelFillRt.width !== rtW || pixelFillRt.height !== rtH) {
    pixelFillRt?.dispose();
    pixelFillRt = new THREE.WebGLRenderTarget(rtW, rtH, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
    });
    pixelFillBuf = new Uint8Array(rtW * rtH * 4);
  }
  const buf = pixelFillBuf!;
  const totalPixels = rtW * rtH;

  const wind = windEnabled && windStrength > 0
    ? { strength: windStrength, time: windMode === 'SWAY' ? performance.now() * 0.001 : undefined }
    : undefined;

  const results: Record<string, number[]> = {};
  renderer.setRenderTarget(pixelFillRt);
  renderer.setClearColor(0x000000, 0.0);

  for (const lodDef of PIXEL_FILL_LODS) {
    const rawRes = TreeGenerator.meshSkeletonRaw(currentSkeleton, {
      ...currentRenderOpts,
      lod: { ...TREE_LOD_PRESETS[lodDef.key] },
      wind,
    });
    const geom = toThreeBufferGeometry(rawRes.mesh);
    const mesh = new THREE.Mesh(geom, [barkMat, ...leafMats, branchMat]);
    offscreenScene.add(mesh);

    const series: number[] = [];
    for (const deg of PIXEL_FILL_ANGLES) {
      mesh.rotation.y = (deg * Math.PI) / 180;
      renderer.clear();
      renderer.render(offscreenScene, currentCamera);
      renderer.readRenderTargetPixels(pixelFillRt, 0, 0, rtW, rtH, buf);
      let filled = 0;
      for (let i = 3; i < buf.length; i += 4) {
        if (buf[i] > 0) filled++;
      }
      series.push((filled / totalPixels) * 100);
    }

    offscreenScene.remove(mesh);
    geom.dispose();
    results[lodDef.key] = series;
  }

  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 0.0);
  return results;
}

function updatePixelFillChart() {
  const svg = document.getElementById('pixel-fill-chart-svg');
  const legendEl = document.getElementById('pixel-fill-legend');
  if (!svg) return;

  const data = measureLodPixelFill();
  if (!data) {
    svg.innerHTML = '';
    return;
  }

  const W = 310;
  const H = 180;
  const padL = 36;
  const padR = 10;
  const padT = 12;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let maxPct = 5;
  for (const lodDef of PIXEL_FILL_LODS) {
    for (const v of data[lodDef.key]) {
      if (v > maxPct) maxPct = v;
    }
  }
  const yMax = Math.min(100, Math.ceil(maxPct / 5) * 5 || 10);

  const xFor = (idx: number) => padL + (idx / (PIXEL_FILL_ANGLES.length - 1)) * plotW;
  const yFor = (pct: number) => padT + plotH - (pct / yMax) * plotH;

  let gridHtml = '';
  for (let i = 0; i <= 4; i++) {
    const val = (yMax * i) / 4;
    const y = yFor(val);
    gridHtml += \`<line x1="\${padL}" y1="\${y.toFixed(1)}" x2="\${W - padR}" y2="\${y.toFixed(1)}" stroke="#e4e2dc" stroke-width="1" />\`;
    gridHtml += \`<text x="\${padL - 4}" y="\${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#71717a">\${val.toFixed(0)}%</text>\`;
  }

  let xLabelsHtml = '';
  PIXEL_FILL_ANGLES.forEach((deg, idx) => {
    const x = xFor(idx);
    gridHtml += \`<line x1="\${x.toFixed(1)}" y1="\${padT}" x2="\${x.toFixed(1)}" y2="\${padT + plotH}" stroke="#f1efe9" stroke-width="1" />\`;
    xLabelsHtml += \`<text x="\${x.toFixed(1)}" y="\${H - 6}" text-anchor="middle" font-size="9" fill="#71717a">\${deg}°</text>\`;
  });

  let linesHtml = '';
  for (const lodDef of PIXEL_FILL_LODS) {
    const vals = data[lodDef.key];
    const pts = vals.map((v, idx) => \`\${xFor(idx).toFixed(1)},\${yFor(v).toFixed(1)}\`).join(' ');
    linesHtml += \`<polyline fill="none" stroke="\${lodDef.color}" stroke-width="1.8" points="\${pts}" />\`;
    vals.forEach((v, idx) => {
      linesHtml += \`<circle cx="\${xFor(idx).toFixed(1)}" cy="\${yFor(v).toFixed(1)}" r="2.3" fill="\${lodDef.color}"><title>\${lodDef.label} @ \${PIXEL_FILL_ANGLES[idx]}°: \${v.toFixed(1)}%</title></circle>\`;
    });
  }

  svg.innerHTML = gridHtml + xLabelsHtml + linesHtml;
  if (legendEl) {
    legendEl.innerHTML = PIXEL_FILL_LODS.map((l) => {
      const avg = data[l.key].reduce((a, b) => a + b, 0) / data[l.key].length;
      return \`<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:10px;height:3px;background:\${l.color};display:inline-block;"></span>\${l.label} (\${avg.toFixed(1)}%)</span>\`;
    }).join('');
  }
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
        const wr = env.spread * env.ratioAt(t) * currentHeight * sign;
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
        const handleNumberChange = () => {
          const n = parseFloat(inp.value);
          if (!Number.isNaN(n)) {
            lastChartTarget = { sectionTitle: title, label: f.label };
            f.onChange(n);
            syncDirty(n);
            updateInlineChart(title, f.label);
          }
        };
        inp.oninput = handleNumberChange;
        inp.onchange = handleNumberChange;
        resetBtn.onclick = (e) => {
          e.preventDefault();
          if (baseVal !== undefined) {
            inp.value = String(baseVal);
            lastChartTarget = { sectionTitle: title, label: f.label };
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
    { label: 'crownShape', type: 'select', value: profile.crownShape, options: CROWN_SHAPES, onChange: (v) => updateField((p, x) => { p.crownShape = x; delete p.crownShapeB; delete p.crownShapeBlend; }, v) },
    { label: 'envelopeClipProbability', type: 'number', step: 0.05, min: 0, max: 1, value: profile.envelopeClipProbability ?? 0.72, onChange: (v) => updateField((p, x) => (p.envelopeClipProbability = x), v) },
    { label: 'crownSpreadRatio', type: 'number', step: 0.01, min: 0.05, max: 1.5, value: profile.crownSpreadRatio, onChange: (v) => updateField((p, x) => (p.crownSpreadRatio = x), v) },
    { label: 'crownPeak', type: 'number', step: 0.05, min: 0.05, max: 0.95, value: resolveNumericParam(profile, null, 'crownPeak') ?? 0.4, onChange: (v) => updateField((p, x) => (p.crownPeak = x), v) },
    { label: 'trunkHeightRatio', type: 'number', step: 0.01, min: 0.02, max: 0.9, value: profile.trunkHeightRatio, onChange: (v) => updateField((p, x) => (p.trunkHeightRatio = x), v) },
    { label: 'trunkBaseRadiusRatio', type: 'number', step: 0.001, min: 0.002, max: 0.05, value: profile.trunkBaseRadiusRatio, onChange: (v) => updateField((p, x) => (p.trunkBaseRadiusRatio = x), v) },
    { label: 'trunkLengthRatio', type: 'number', step: 0.02, min: 0.2, max: 1.0, value: profile.trunkLengthRatio, onChange: (v) => updateField((p, x) => (p.trunkLengthRatio = x), v) },
    { label: 'trunkTipRatio', type: 'number', step: 0.01, min: 0.01, max: 0.5, value: resolveNumericParam(profile, null, 'trunkTipRatio') ?? 0.3, onChange: (v) => updateField((p, x) => (p.trunkTipRatio = x), v) },
    { label: 'taperShape', type: 'number', step: 0.05, min: 0, max: 1, value: profile.taperShape ?? 0, onChange: (v) => updateField((p, x) => { if (x > 0) p.taperShape = x; else delete p.taperShape; }, v) },
    { label: 'trunkSegmentDecay', type: 'number', step: 0.01, min: 0.5, max: 1, value: profile.trunkSegmentDecay ?? 1, onChange: (v) => updateField((p, x) => { if (x < 1) p.trunkSegmentDecay = x; else delete p.trunkSegmentDecay; }, v) },
    { label: 'trunkMinSegmentRatio', type: 'number', step: 0.001, min: 0, max: 0.5, value: profile.trunkMinSegmentRatio ?? 0, onChange: (v) => updateField((p, x) => { if (x >= 1e-4) p.trunkMinSegmentRatio = Math.min(0.5, x); else delete p.trunkMinSegmentRatio; }, v) },
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
      { label: 'taperShape', type: 'number', step: 0.05, min: 0, max: 1, value: lvl.taperShape ?? profile.taperShape ?? 0, onChange: (v) => updateField((p, x) => { if (p.levels[idx]) p.levels[idx].taperShape = x; }, v) },
      { label: 'segmentDecay', type: 'number', step: 0.01, min: 0.5, max: 1, value: lvl.segmentDecay ?? 1, onChange: (v) => updateField((p, x) => { if (!p.levels[idx]) return; if (x < 1) p.levels[idx].segmentDecay = x; else delete p.levels[idx].segmentDecay; }, v) },
      { label: 'minSegmentRatio', type: 'number', step: 0.001, min: 0, max: 0.5, value: lvl.minSegmentRatio ?? 0, onChange: (v) => updateField((p, x) => { if (!p.levels[idx]) return; if (x >= 1e-4) p.levels[idx].minSegmentRatio = Math.min(0.5, x); else delete p.levels[idx].minSegmentRatio; }, v) },
      { label: 'tipRatio', type: 'number', step: 0.02, min: 0.05, max: 1, value: resolveNumericParam(profile, idx, 'tipRatio') ?? 0.22, onChange: (v) => updateField((p, x) => { if (p.levels[idx]) p.levels[idx].tipRatio = x; }, v) },
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
  (document.getElementById('lod-select') as HTMLSelectElement).onchange = (e) => {
    currentLod = (e.target as HTMLSelectElement).value;
    renderTree();
  };
  (document.getElementById('pixel-fill-res') as HTMLSelectElement).onchange = (e) => {
    pixelFillRes = Number((e.target as HTMLSelectElement).value) || 128;
    updatePixelFillChart();
  };
  (document.getElementById('foliage-check') as HTMLInputElement).onchange = (e) => {
    showFoliage = (e.target as HTMLInputElement).checked;
    renderTree();
  };
  document.querySelectorAll('.season-btn').forEach((btn) => {
    (btn as HTMLButtonElement).onclick = () => {
      currentSeason = ((btn as HTMLElement).dataset.season || 'SUMMER') as Season;
      document.querySelectorAll('.season-btn').forEach((b) => b.classList.toggle('active', b === btn));
      applyTreeColors();
      renderTree();
    };
  });

  const minRange = document.getElementById('foliage-range-min') as HTMLInputElement | null;
  const maxRange = document.getElementById('foliage-range-max') as HTMLInputElement | null;
  const onRangeInput = (changed: 'min' | 'max') => {
    if (!minRange || !maxRange) return;
    let a = Number(minRange.value);
    let b = Number(maxRange.value);
    if (a > b) {
      if (changed === 'min') { a = b; minRange.value = String(a); }
      else { b = a; maxRange.value = String(b); }
    }
    setFoliageRange01(currentKind, currentSeason, a / 100, b / 100);
    applyTreeColors();
    const { profile } = getEffectiveProfile(currentKind, currentHeight);
    updateLeafPreview(profile, treeKindParams(currentKind, currentHeight).species);
  };
  if (minRange) minRange.addEventListener('input', () => onRangeInput('min'));
  if (maxRange) maxRange.addEventListener('input', () => onRangeInput('max'));

  (['trunk', 'branch'] as const).forEach((target) => {
    const container = document.getElementById(target === 'trunk' ? 'trunk-color-swatches' : 'branch-color-swatches');
    if (!container) return;
    BARK_COLORS.forEach((c, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bark-swatch';
      btn.title = c.label;
      btn.style.background = '#' + c.hex.toString(16).padStart(6, '0');
      btn.addEventListener('click', () => {
        setBarkColorIndex(currentKind, target, idx);
        applyTreeColors();
      });
      container.appendChild(btn);
    });
  });
  applyTreeColors();

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

  const edgesBarkEl = document.getElementById('edges-bark') as HTMLInputElement;
  const edgesLeavesEl = document.getElementById('edges-leaves') as HTMLInputElement;
  edgesBarkEl.checked = edgesBark;
  edgesLeavesEl.checked = edgesLeaves;
  const onEdgesChange = () => {
    edgesBark = edgesBarkEl.checked;
    edgesLeaves = edgesLeavesEl.checked;
    try { localStorage.setItem(EDGE_STORAGE_KEY, JSON.stringify({ bark: edgesBark, leaves: edgesLeaves })); } catch { /* ignore */ }
    syncEdges();
    if (currentCamera) renderer.render(scene, currentCamera);
  };
  edgesBarkEl.onchange = onEdgesChange;
  edgesLeavesEl.onchange = onEdgesChange;

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

  // Drag canvas to rotate Y or pan background
  let dragging = false;
  let draggingBg = false;
  let lastX = 0;
  let lastY = 0;
  canvas.onmousedown = (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    const bgDragEl = document.getElementById('bg-drag-mode') as HTMLInputElement | null;
    draggingBg = Boolean((bgDragEl && bgDragEl.checked) || e.shiftKey);
  };
  window.onmouseup = () => { dragging = false; draggingBg = false; };
  window.onmousemove = (e) => {
    if (!dragging || !currentCamera) return;
    if (draggingBg) {
      const entry = bgStorage.byTier[getBgTierKey()];
      if (entry) {
        const rect = canvas.getBoundingClientRect();
        const frustumH = currentCamera.top - currentCamera.bottom;
        const mPerPx = frustumH / Math.max(1, rect.height);
        entry.offsetX += (e.clientX - lastX) * mPerPx;
        entry.offsetY -= (e.clientY - lastY) * mPerPx;
        updateBgEntryAndPersist(entry);
        drawBackgroundCanvas();
        syncBgControls();
      }
      lastX = e.clientX;
      lastY = e.clientY;
      return;
    }
    yawDeg = (yawDeg + (e.clientX - lastX) * 0.6) % 360;
    lastX = e.clientX;
    lastY = e.clientY;
    treeGroup.rotation.y = (yawDeg * Math.PI) / 180;
    renderer.render(scene, currentCamera);
  };
  canvas.addEventListener('wheel', (e) => {
    const bgDragEl = document.getElementById('bg-drag-mode') as HTMLInputElement | null;
    if (!((bgDragEl && bgDragEl.checked) || e.shiftKey)) return;
    const entry = bgStorage.byTier[getBgTierKey()];
    if (!entry) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
    entry.scale = Math.max(0.05, Math.min(20, entry.scale * factor));
    updateBgEntryAndPersist(entry);
    drawBackgroundCanvas();
    syncBgControls();
  }, { passive: false });

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
  (window as any).__studioToast = showToast;

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
      const savedAnchors = anchors.map((a) => ({ h: a.h, profile: structuredClone(a.profile) }));
      if (fitted) {
        fitted.heightAnchors = savedAnchors;
      } else {
        // Nowy wpis gatunku bazowego (serwer utworzył go w fittedProfiles.json)
        const ref10 = [...savedAnchors].sort((a, b) => Math.abs(a.h - 10) - Math.abs(b.h - 10))[0];
        (FITTED_PROFILES as any[]).push({
          ref: currentKind,
          startSpecies: currentKind,
          form: currentForm,
          profile: structuredClone(ref10.profile),
          heightAnchors: savedAnchors,
        });
      }
      updateInlineChart();
      showToast('Zapisano drzewo ' + currentKind + ' (' + anchors.length + ' węzłów)');
    } else {
      showToast('Błąd: ' + data.error, true);
    }
  };

  initBgControls();
  loadBgStorage();
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
    #canvas-wrap { flex: 1; position: relative; overflow: hidden; background: #fcfbf9; }
    #bg-canvas, #gl-canvas, #overlay-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    #bg-canvas, #overlay-canvas { pointer-events: none; }
    #edge-panel { position: absolute; top: 8px; left: 8px; z-index: 5; background: rgba(255,255,255,0.88); border: 1px solid #d4d0c7; border-radius: 6px; padding: 6px 8px; font: 11px ui-monospace, monospace; max-width: 340px; }
    #edge-panel label { display: block; cursor: pointer; }
    #ring-info table { border-collapse: collapse; margin-top: 4px; }
    #ring-info th, #ring-info td { padding: 1px 6px; text-align: right; border-bottom: 1px solid #e5e2da; }
    #ring-info div { margin-top: 4px; }
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
    .bark-swatch { width: 20px; height: 20px; border-radius: 4px; border: 2px solid #d4d4d8; cursor: pointer; padding: 0; transition: transform 0.1s; }
    .bark-swatch:hover { transform: scale(1.08); }
    .bark-swatch.active { border-color: #16a34a; box-shadow: 0 0 0 2px #bbf7d0; }
    .dual-range { position: relative; height: 22px; display: flex; align-items: center; }
    .dual-range-track { position: absolute; left: 0; right: 0; height: 8px; border-radius: 4px; border: 1px solid #d4d4d8; }
    .dual-range input[type="range"] { position: absolute; left: 0; width: 100%; margin: 0; background: transparent; pointer-events: none; -webkit-appearance: none; appearance: none; height: 22px; }
    .dual-range input[type="range"]::-webkit-slider-thumb { pointer-events: auto; -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 2px solid #18181b; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    .dual-range input[type="range"]::-moz-range-thumb { pointer-events: auto; width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 2px solid #18181b; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    #leaf-preview-svg { display: block; margin: 4px auto 8px auto; background: #fff; border: 1px solid #e4e2dc; border-radius: 6px; }
    .rp-meta { font-size: 11px; color: #52525b; text-align: center; line-height: 1.4; }
  </style>
</head>
<body>
  <div id="viewport">
    <div id="canvas-wrap">
      <canvas id="bg-canvas"></canvas>
      <canvas id="gl-canvas"></canvas>
      <canvas id="overlay-canvas"></canvas>
    </div>
    <div id="edge-panel">
      <label><input type="checkbox" id="edges-bark"> Krawędzie face'ów (kora)</label>
      <label><input type="checkbox" id="edges-leaves"> Krawędzie liści</label>
      <div id="ring-info"></div>
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
        <label class="ctrl">LOD
          <select id="lod-select">
            <option value="">pełna (bez LOD)</option>
            <option value="near">near</option>
            <option value="mid">mid</option>
            <option value="far">far</option>
            <option value="shell">shell</option>
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
      <h2>Tło referencyjne (<span id="bg-tier-label">15 m</span>)</h2>
      <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;">
        <input id="bg-file-input" type="file" accept="image/*" style="font-size:11px;" />
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <span id="bg-file-name" style="color:#52525b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Brak pliku</span>
          <button id="bg-clear-btn" type="button" style="padding:2px 6px;font-size:10px;">Usuń</button>
        </div>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input id="bg-visible" type="checkbox" checked /> Pokaż tło
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input id="bg-drag-mode" type="checkbox" /> Przesuwaj/skaluj tło myszką (lub Shift)
        </label>
        <div style="display:grid;grid-template-columns:62px 1fr 54px;gap:4px;align-items:center;">
          <span>Skala</span>
          <input id="bg-scale-range" type="range" min="0.1" max="5" step="0.01" value="1" />
          <input id="bg-scale-num" type="number" min="0.05" max="20" step="0.01" value="1" style="padding:2px 4px;font-size:11px;" />
          <span>Poz. X (m)</span>
          <input id="bg-ox-range" type="range" min="-20" max="20" step="0.05" value="0" />
          <input id="bg-ox-num" type="number" step="0.05" value="0" style="padding:2px 4px;font-size:11px;" />
          <span>Poz. Y (m)</span>
          <input id="bg-oy-range" type="range" min="-20" max="20" step="0.05" value="0" />
          <input id="bg-oy-num" type="number" step="0.05" value="0" style="padding:2px 4px;font-size:11px;" />
          <span>Krycie</span>
          <input id="bg-op-range" type="range" min="0" max="1" step="0.01" value="0.55" />
          <input id="bg-op-num" type="number" min="0" max="1" step="0.01" value="0.55" style="padding:2px 4px;font-size:11px;" />
        </div>
        <button id="bg-reset-btn" type="button" style="padding:3px 8px;font-size:11px;">Resetuj pozycję tła</button>
      </div>
    </div>
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
      <h2>Barwy</h2>
      <div style="display:flex;flex-direction:column;gap:8px;font-size:11px;">
        <div style="display:flex;flex-direction:column;gap:3px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;color:#52525b;">Listowie <span id="foliage-color-season" style="font-weight:400;color:#71717a;"></span></span>
            <span id="foliage-color-swatch" style="width:14px;height:14px;border-radius:3px;border:1px solid #a1a1aa;display:inline-block;"></span>
          </div>
          <div class="dual-range">
            <div id="foliage-color-gradient" class="dual-range-track"></div>
            <input id="foliage-range-min" type="range" min="0" max="100" step="1" value="15" />
            <input id="foliage-range-max" type="range" min="0" max="100" step="1" value="85" />
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="font-weight:600;color:#52525b;">Pień</span>
          <div id="trunk-color-swatches" style="display:flex;gap:5px;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <span style="font-weight:600;color:#52525b;">Gałęzie</span>
          <div id="branch-color-swatches" style="display:flex;gap:5px;"></div>
        </div>
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
    <div class="rp-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h2 style="margin:0;">Wypełnienie widoku (piksele %)</h2>
        <select id="pixel-fill-res" style="font-size:10px;padding:1px 4px;border:1px solid #d4d4d8;border-radius:4px;background:#fff;">
          <option value="128" selected>128 px</option>
          <option value="256">256 px</option>
          <option value="512">512 px</option>
          <option value="1024">1024 px</option>
        </select>
      </div>
      <svg id="pixel-fill-chart-svg" viewBox="0 0 310 180" width="100%" height="180"></svg>
      <div id="pixel-fill-legend" class="rp-meta" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:4px;"></div>
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
    if (req.url === '/api/studio-bg' && req.method === 'GET') {
      const bgPath = path.resolve('tmp/studio-backgrounds.json');
      let data = { byTier: {}, byFile: {} };
      if (fs.existsSync(bgPath)) {
        try { data = JSON.parse(fs.readFileSync(bgPath, 'utf-8')); } catch {}
      }
      resHttp.writeHead(200, { 'Content-Type': 'application/json' });
      resHttp.end(JSON.stringify(data));
      return;
    }
    if (req.url === '/api/studio-bg' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const bgPath = path.resolve('tmp/studio-backgrounds.json');
          fs.mkdirSync(path.dirname(bgPath), { recursive: true });
          let existing: { byTier: Record<string, unknown>; byFile: Record<string, unknown> } = { byTier: {}, byFile: {} };
          if (fs.existsSync(bgPath)) {
            try { existing = JSON.parse(fs.readFileSync(bgPath, 'utf-8')); } catch {}
          }
          const merged = {
            byTier: { ...(existing.byTier || {}), ...(parsed.byTier || {}) },
            byFile: { ...(existing.byFile || {}), ...(parsed.byFile || {}) },
          };
          fs.writeFileSync(bgPath, JSON.stringify(merged, null, 2));
          resHttp.writeHead(200, { 'Content-Type': 'application/json' });
          resHttp.end(JSON.stringify({ ok: true }));
        } catch (err) {
          resHttp.writeHead(400, { 'Content-Type': 'application/json' });
          resHttp.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      return;
    }
    if (req.url?.startsWith('/api/assertion-model') && req.method === 'GET') {
      const u = new URL(req.url, 'http://x');
      try {
        if (u.pathname === '/api/assertion-models') {
          resHttp.writeHead(200, { 'Content-Type': 'application/json' });
          resHttp.end(JSON.stringify(listAssertionSummaries()));
        } else {
          const kind = u.searchParams.get('kind');
          if (!kind) throw new Error('Brak parametru kind');
          resHttp.writeHead(200, { 'Content-Type': 'application/json' });
          resHttp.end(JSON.stringify(readAssertionModel(kind)));
        }
      } catch (err: any) {
        resHttp.writeHead(400, { 'Content-Type': 'application/json' });
        resHttp.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }
    if (req.url === '/api/save-profile' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const { kind, height, startSpecies } = parsed;
          // Stare klucze (taper/trunkTaper) są normalizowane przed zapisem
          const norm = (p: any) => (p && typeof p === 'object' && Array.isArray(p.levels) ? normalizeTaper(p) : p);
          const profile = norm(parsed.profile);
          const anchors = Array.isArray(parsed.anchors)
            ? parsed.anchors.map((a: any) => (a ? { ...a, profile: norm(a.profile) } : a))
            : parsed.anchors;
          // Bez walidacji JSON.stringify zapisze węzeł `{}` (h i profile undefined) i zepsuje heightAnchors
          const checkAnchor = (h: unknown, p: any) => {
            if (typeof h !== 'number' || !Number.isFinite(h)) throw new Error('Brak poprawnej wysokości węzła (height)');
            if (!p || typeof p !== 'object' || !Array.isArray(p.levels)) throw new Error(`Brak poprawnego profilu (profile.levels) dla h=${h}`);
          };
          const fitted = JSON.parse(fs.readFileSync(FITTED_PATH, 'utf-8'));
          let entry = fitted.find((f: any) => f.ref === kind);
          if (!entry) {
            // Gatunek bazowy bez wpisu (np. POPLAR): tworzymy wpis jak dla BIRCH/PINE
            // Nowy rodzaj spoza bazy wymaga jawnego `startSpecies` (gatunek bazowy)
            const baseSpecies = typeof kind === 'string' && kind in BASE_PROFILES ? kind : startSpecies;
            if (typeof kind !== 'string' || typeof baseSpecies !== 'string' || !(baseSpecies in BASE_PROFILES)) {
              throw new Error(`Gatunek "${kind}" nie ma wpisu w fittedProfiles.json ani w gatunkach bazowych`);
            }
            const saved: { h: number; profile: any }[] = Array.isArray(anchors)
              ? anchors.map((a: any) => ({ h: a?.h, profile: a?.profile }))
              : [{ h: height, profile }];
            const ref10 = saved
              .filter((a) => typeof a.h === 'number' && a.profile)
              .sort((a, b) => Math.abs(a.h - 10) - Math.abs(b.h - 10))[0];
            if (!ref10) throw new Error('Brak poprawnej wysokości węzła (height)');
            entry = {
              ref: kind,
              startSpecies: baseSpecies,
              form: baseKindParams(baseSpecies as any).form,
              profile: structuredClone(ref10.profile),
              heightAnchors: [],
            };
            fitted.push(entry);
          }
          if (Array.isArray(anchors)) {
            // Format Studio: pełny zestaw węzłów zastępuje heightAnchors gatunku
            if (anchors.length === 0) throw new Error('Brak węzłów wysokości do zapisania (anchors)');
            for (const a of anchors) checkAnchor(a?.h, a?.profile);
            entry.heightAnchors = anchors.map((a: any) => ({ h: a.h, profile: a.profile }));
          } else {
            // Format pojedynczego węzła: { height, profile }
            checkAnchor(height, profile);
            if (!entry.heightAnchors) entry.heightAnchors = [];
            const idx = entry.heightAnchors.findIndex((a: any) => a.h === height);
            if (idx >= 0) entry.heightAnchors[idx].profile = profile;
            else entry.heightAnchors.push({ h: height, profile });
          }
          entry.heightAnchors.sort((a: any, b: any) => a.h - b.h);
          fs.writeFileSync(FITTED_PATH, JSON.stringify(fitted, null, 2) + '\n');
          // Model asercyjny (12 m, ziarno 1111) odnawiany przy każdym zapisie definicji
          const assertion = writeAssertionModel(kind, fitted);
          resHttp.writeHead(200, { 'Content-Type': 'application/json' });
          resHttp.end(JSON.stringify({ ok: true, assertion }));
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
