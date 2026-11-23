/**
 * Model asercyjny: referencyjna siatka drzewa (12 m, ziarno 1111, pełny LOD) generowana dla każdego rodzaju.
 * Służy do porównań regresyjnych (hash + wszystkie wierzchołki). Zero zależności zewnętrznych.
 */
import { TreeGenerator } from './TreeGenerator.js';
import { treeKindParams, type TreeKind, type TreeKindParams } from './treeSpeciesRegistry.js';

export const ASSERTION_HEIGHT = 12;
export const ASSERTION_SEED = 1111;

export interface AssertionModelSummary {
  kind: string;
  height: number;
  seed: number;
  version: string;
  generatedAt?: string;
  /** Hash rozwiązanych parametrów (wykrywanie nieaktualnego pliku względem profilu) */
  paramsHash: string;
  params: { species: string; form: string; profile: unknown };
  counts: { vertices: number; barkTriangles: number; leafTriangles: number; stemsPerLevel: number[] };
  bbox: { min: [number, number, number]; max: [number, number, number] };
  /** FNV-1a (32 bit, hex) po pozycjach i indeksach siatki */
  hash: string;
}

export interface AssertionModel extends AssertionModelSummary {
  /** Płaskie xyz wszystkich wierzchołków */
  vertices: number[];
  indices?: number[];
  normals?: number[];
}

export interface AssertionModelOptions {
  version?: string;
  generatedAt?: string;
  /** Gotowe parametry (np. świeżo odczytane z fittedProfiles.json); domyślnie treeKindParams(kind, 12) */
  params?: TreeKindParams;
  includeIndices?: boolean;
  includeNormals?: boolean;
}

function fnv1a(bytes: Uint8Array, h = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const hex = (n: number) => n.toString(16).padStart(8, '0');

export function hashParams(params: TreeKindParams): string {
  const s = JSON.stringify({ species: params.species, form: params.form, profile: params.profile });
  const b = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    b[2 * i] = s.charCodeAt(i) & 0xff;
    b[2 * i + 1] = s.charCodeAt(i) >> 8;
  }
  return hex(fnv1a(b));
}

export function buildAssertionModel(kind: string, opts: AssertionModelOptions = {}): AssertionModel {
  const params = opts.params ?? treeKindParams(kind as TreeKind, ASSERTION_HEIGHT);
  const input = {
    species: params.species,
    height: ASSERTION_HEIGHT,
    seed: ASSERTION_SEED,
    form: params.form,
    profile: params.profile,
    withFoliageAccents: true,
  };
  const skeleton = TreeGenerator.buildSkeleton(input);
  const { mesh } = TreeGenerator.meshSkeletonRaw(skeleton, input);
  const pos = mesh.positions;
  const idx = mesh.indices;

  let h = fnv1a(new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength));
  const idx32 = Uint32Array.from(idx);
  h = fnv1a(new Uint8Array(idx32.buffer), h);

  let bark = 0;
  let leaf = 0;
  for (const g of mesh.groups) {
    if (g.materialIndex === 0) bark += g.count / 3;
    else leaf += g.count / 3;
  }
  if (mesh.groups.length === 0) bark = idx.length / 3;

  const stemsPerLevel: number[] = [];
  for (const s of skeleton.stems) stemsPerLevel[s.level] = (stemsPerLevel[s.level] ?? 0) + 1;
  for (let i = 0; i < stemsPerLevel.length; i++) stemsPerLevel[i] ??= 0;

  const model: AssertionModel = {
    kind,
    height: ASSERTION_HEIGHT,
    seed: ASSERTION_SEED,
    version: opts.version ?? 'unknown',
    ...(opts.generatedAt ? { generatedAt: opts.generatedAt } : {}),
    paramsHash: hashParams(params),
    params: { species: params.species, form: params.form, profile: params.profile },
    counts: { vertices: pos.length / 3, barkTriangles: bark, leafTriangles: leaf, stemsPerLevel },
    bbox: { min: [...mesh.boundingBox.min], max: [...mesh.boundingBox.max] },
    hash: hex(h),
    vertices: Array.from(pos),
  };
  if (opts.includeIndices) model.indices = Array.from(idx);
  if (opts.includeNormals) model.normals = Array.from(mesh.normals);
  return model;
}

export function summarizeAssertionModel(model: AssertionModelSummary): AssertionModelSummary {
  const { kind, height, seed, version, generatedAt, paramsHash, params, counts, bbox, hash } = model;
  return { kind, height, seed, version, ...(generatedAt ? { generatedAt } : {}), paramsHash, params, counts, bbox, hash };
}

/** Float32 LE → base64 (zapis kompaktowy) */
export function encodeFloat32Base64(values: ArrayLike<number>): string {
  const f = Float32Array.from(values as ArrayLike<number>);
  const u8 = new Uint8Array(f.buffer);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return (globalThis as any).btoa(bin);
}

export function decodeFloat32Base64(b64: string): number[] {
  const bin: string = (globalThis as any).atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return Array.from(new Float32Array(u8.buffer));
}

/** Krok siatki kwantyzacji współrzędnych (m): 0,05 cm */
export const QUANT_STEP_M = 0.0005;

/**
 * Kwantyzacja do siatki `step`, delta po osiach (x,y,z względem poprzedniego wierzchołka),
 * zigzag i varint LEB128. Długość `values` musi być wielokrotnością 3.
 */
export function encodeQuantizedVertices(values: ArrayLike<number>, step: number = QUANT_STEP_M): Uint8Array {
  const out: number[] = [];
  const prev = [0, 0, 0];
  for (let i = 0; i < values.length; i++) {
    const a = i % 3;
    const q = Math.round(values[i] / step);
    const d = q - prev[a];
    prev[a] = q;
    let z = d >= 0 ? d * 2 : -d * 2 - 1; // zigzag (bez operatorów bitowych: bezpieczne > 2^31)
    while (z >= 128) {
      out.push((z % 128) | 128);
      z = Math.floor(z / 128);
    }
    out.push(z);
  }
  return Uint8Array.from(out);
}

export function decodeQuantizedVertices(bytes: Uint8Array, step: number, count: number): number[] {
  const out: number[] = new Array(count);
  const prev = [0, 0, 0];
  let p = 0;
  for (let i = 0; i < count; i++) {
    let z = 0;
    let mul = 1;
    for (;;) {
      if (p >= bytes.length) throw new Error('Uciety strumien varint');
      const b = bytes[p++];
      z += (b & 127) * mul;
      if (b < 128) break;
      mul *= 128;
    }
    const d = z % 2 === 0 ? z / 2 : -(z + 1) / 2;
    const a = i % 3;
    prev[a] += d;
    out[i] = prev[a] * step;
  }
  return out;
}
