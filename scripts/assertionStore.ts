/**
 * Zapis/odczyt modeli asercyjnych w `assertion-models/<kind>.json` (katalog w repo, nie tmp).
 *
 * Format pliku: pola podsumowania (hash, counts, bbox, params, paramsHash...) + `verticesQ`
 * (płaskie xyz skwantyzowane do siatki `quant.step` = 0,0005 m, delta po osiach wg kolejności wierzchołków,
 * zigzag + varint LEB128, deflate-raw poziom 9, base64) oraz `quant: { step, maxError }`
 * (maxError = faktyczny max |zdekodowane - oryginał| w metrach).
 * Payload jest skwantyzowany (stratny, wizualnie bezstratny); `hash` dotyczy NIESKWANTYZOWANEJ siatki
 * z generatora (float32), więc nie da się go odtworzyć z samego payloadu.
 * Starsze pliki z `verticesF32Base64` (Float32 LE base64) są nadal odczytywane.
 * API (`readAssertionModel`) odkodowuje to do `vertices: number[]`.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  ASSERTION_HEIGHT,
  buildAssertionModel,
  QUANT_STEP_M,
  decodeFloat32Base64,
  decodeQuantizedVertices,
  encodeQuantizedVertices,
  hashParams,
  summarizeAssertionModel,
  type AssertionModel,
  type AssertionModelSummary,
} from '../src/core/assertionModel';
import { profileAtHeight, scaleProfileByHeight } from '../src/core/heightProfile';
import { SPECIES_PROFILES } from '../src/core/speciesProfiles';
import type { TreeKindParams } from '../src/core/treeSpeciesRegistry';

export const ASSERTION_DIR = path.resolve('assertion-models');
const FITTED_PATH = path.resolve('src/core/fittedProfiles.json');
const PKG_VERSION: string = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf-8')).version;

export const SUMMARIES_FILE = 'summaries.json';

export function fileFor(kind: string): string {
  return path.join(ASSERTION_DIR, `${kind.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

export function loadFitted(): any[] {
  return JSON.parse(fs.readFileSync(FITTED_PATH, 'utf-8'));
}

/** Jak treeKindParams(kind, 12), ale z aktualnego pliku fittedProfiles.json (nie z pamięci procesu) */
export function resolveParamsFresh(kind: string, fitted = loadFitted()): TreeKindParams {
  const e = fitted.find((f: any) => f.ref === kind);
  if (e) {
    const profile = e.heightAnchors?.length
      ? profileAtHeight(e.heightAnchors, ASSERTION_HEIGHT)
      : scaleProfileByHeight(e.profile, ASSERTION_HEIGHT, 10);
    return { species: e.startSpecies, profile, form: e.form ?? 'SINGLE' };
  }
  if (!(kind in SPECIES_PROFILES)) throw new Error(`Nieznany rodzaj: ${kind}`);
  return {
    species: kind as any,
    profile: scaleProfileByHeight((SPECIES_PROFILES as any)[kind], ASSERTION_HEIGHT, kind === 'BUSH' ? 3 : 10),
    form: 'SINGLE',
  };
}

export function allKinds(fitted = loadFitted()): string[] {
  return [...new Set([...Object.keys(SPECIES_PROFILES), ...fitted.map((f: any) => f.ref as string)])];
}

export function writeAssertionModel(kind: string, fitted = loadFitted()): AssertionModelSummary {
  const model = buildAssertionModel(kind, {
    version: PKG_VERSION,
    generatedAt: new Date().toISOString(),
    params: resolveParamsFresh(kind, fitted),
  });
  const { vertices, ...rest } = model;
  const step = QUANT_STEP_M;
  const enc = encodeQuantizedVertices(vertices, step);
  const dec = decodeQuantizedVertices(enc, step, vertices.length);
  let maxError = 0;
  for (let i = 0; i < vertices.length; i++) maxError = Math.max(maxError, Math.abs(dec[i] - vertices[i]));
  const verticesQ = zlib.deflateRawSync(Buffer.from(enc), { level: 9 }).toString('base64');
  fs.mkdirSync(ASSERTION_DIR, { recursive: true });
  fs.writeFileSync(fileFor(kind), JSON.stringify({ ...rest, quant: { step, maxError }, verticesQ }) + '\n');
  const summary = summarizeAssertionModel(model);
  writeSummaries();
  return summary;
}

/** Mały indeks podsumowań (bez wierzchołków) wysyłany w paczce npm */
export function writeSummaries(): void {
  fs.writeFileSync(path.join(ASSERTION_DIR, SUMMARIES_FILE), JSON.stringify(listAssertionSummaries()) + '\n');
}

function readFile(kind: string): (AssertionModelSummary & { verticesF32Base64?: string; verticesQ?: string; quant?: { step: number; maxError: number } }) | null {
  const f = fileFor(kind);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {
    return null;
  }
}

/** Pełny model; regeneruje, gdy plik nie istnieje lub paramsHash nie zgadza się z bieżącym profilem */
export function readAssertionModel(kind: string): AssertionModel {
  const fitted = loadFitted();
  const current = hashParams(resolveParamsFresh(kind, fitted));
  let file = readFile(kind);
  if (!file || file.paramsHash !== current) {
    writeAssertionModel(kind, fitted);
    file = readFile(kind)!;
  }
  const { verticesF32Base64, verticesQ, quant, ...rest } = file;
  if (verticesQ && quant) {
    const bytes = new Uint8Array(zlib.inflateRawSync(Buffer.from(verticesQ, 'base64')));
    return { ...rest, vertices: decodeQuantizedVertices(bytes, quant.step, 3 * rest.counts.vertices) };
  }
  return { ...rest, vertices: decodeFloat32Base64(verticesF32Base64!) };
}

export function listAssertionSummaries(): AssertionModelSummary[] {
  if (!fs.existsSync(ASSERTION_DIR)) return [];
  const out: AssertionModelSummary[] = [];
  for (const name of fs.readdirSync(ASSERTION_DIR).sort()) {
    if (!name.endsWith('.json') || name === SUMMARIES_FILE) continue;
    try {
      const { verticesF32Base64: _v, verticesQ: _q, quant: _qt, ...rest } = JSON.parse(fs.readFileSync(path.join(ASSERTION_DIR, name), 'utf-8'));
      out.push(rest);
    } catch {
      /* pomiń uszkodzony */
    }
  }
  return out;
}
