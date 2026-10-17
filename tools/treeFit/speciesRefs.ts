/**
 * Wzorce gatunków z katalogu `reference/design/drzewa/<gatunek>/`: zdjęcia pokroju z wysokością
 * (sufiks `-<h>m` w nazwie albo jawne przypisanie) i strojone profile `*_<h>m*.json`.
 * Obrys drzewa na zdjęciu wyznaczany automatycznie z maski (zdjęcia mają różne rozmiary i marginesy).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from 'canvas';
import type { TreeKind } from '../../src/index.js';

export const DRZEWA_DIR = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa';
export const OUT_DIR = '/Users/ws/.gemini/antigravity-cli/brain/edf8e0b7-9a5d-469e-8ece-91be40f78015/tree-renders';

export interface SpeciesRef {
  /** Klucz CLI i prefiks plików wyjściowych */
  key: string;
  dir: string;
  label: string;
  /** Rodzaj drzewa w aplikacji (`treeKindParams`) */
  kind: TreeKind;
  /** Strojone profile (źródło strojenia) dla wysokości */
  profiles?: Record<number, string>;
  /** Wysokość domyślna zdjęć bez sufiksu i bez przypisania */
  defaultHeight?: number;
  /** Tylko zdjęcia tych wysokości (katalog z kilkoma pokrojami) */
  onlyHeights?: number[];
}

/**
 * Wiedza o pojedynczych zdjęciach (`photoManifest.json`, klucz gatunku): `photoHeights` — wysokość zdjęć bez
 * sufiksu `-<h>m` lub z błędnym sufiksem (fragment nazwy → metry); `exclude` — pominięte zdjęcia (fragment nazwy).
 */
interface PhotoManifestEntry {
  photoHeights?: Record<string, number>;
  exclude?: string[];
}
const PHOTO_MANIFEST: Record<string, PhotoManifestEntry> = JSON.parse(
  fs.readFileSync(new URL('./photoManifest.json', import.meta.url), 'utf8')
);

export const SPECIES: SpeciesRef[] = [
  {
    key: 'jesion', dir: 'jesion_Fraxinus', label: 'Jesion (Fraxinus)', kind: 'ASH',
    profiles: { 6: 'jesion_6m_fraxinus.json', 9: 'jesion_9m_fraxinus.json', 15: 'jesion_15m_fraxinus.json', 24: 'jesion_24m_fraxinus.json' },
  },
  {
    key: 'wiaz', dir: 'wiaz_Ulmus', label: 'Wiąz (Ulmus)', kind: 'Elm',
    profiles: { 6: 'wiaz_6m_ulmus.json', 9: 'wiaz_9m_ulmus.json', 15: 'wiaz_15m_ulmus.json' },
  },
  {
    key: 'lipa', dir: 'lipa_Tilia', label: 'Lipa (Tilia)', kind: 'Linden',
    profiles: { 6: 'lipa_6m_drobnolistna.json', 9: 'lipa_9m_drobnolistna.json', 15: 'lipa_15m_drobnolistna.json' },
  },
  {
    key: 'klon', dir: 'klon-jawor_Acer', label: 'Klon / jawor (Acer)', kind: 'Sycamore',
    profiles: { 6: 'klon_6m_cukrowy.json', 9: 'klon_9m_zloty.json', 15: 'klon_15m_korona.json' },
  },
  {
    key: 'brzoza', dir: 'brzoza_Betula', label: 'Brzoza (Betula)', kind: 'BIRCH',
    profiles: { 6: 'brzoza_mala_6m.json', 9: 'brzoza_9m_zwisajaca.json', 15: 'brzoza_15m_pokroj.json' },
  },
  { key: 'dab', dir: 'dab_Quercus', label: 'Dąb (Quercus)', kind: 'OAK', defaultHeight: 15 },
  { key: 'eukaliptus', dir: 'eukaliptus_Eucalyptus', label: 'Eukaliptus', kind: 'Linden', defaultHeight: 15 },
  {
    key: 'kasztanowiec', dir: 'kasztanowiec_Aesculus', label: 'Kasztanowiec (Aesculus)', kind: 'Horsechestnut',
    profiles: { 6: 'kasztanowiec_6m.json', 9: 'kasztanowiec_9m.json', 15: 'kasztanowiec_15m.json', 24: 'kasztanowiec_24m.json' },
  },
  { key: 'platan', dir: 'platan_occidentalis', label: 'Platan (Platanus)', kind: 'Plane', profiles: { 6: 'platan_6m.json', 9: 'platan_9m.json', 15: 'platan_15m.json' } },
  { key: 'sosna', dir: 'sosna_Pinus', label: 'Sosna (Pinus)', kind: 'PINE', profiles: { 6: 'sosna_6m_pinus.json', 9: 'sosna_9m_pinus.json', 15: 'sosna_15m_pinus.json' } },
  {
    key: 'sosna_samotna', dir: 'sosna_Pinus', label: 'Sosna samotna (Pinus, pokrój rozłożysty)', kind: 'PINE',
    profiles: { 15: 'sosna_samotna_15m_pinus.json' }, onlyHeights: [15] },
  { key: 'swierk', dir: 'swierk_Picea', label: 'Świerk (Picea)', kind: 'SPRUCE', profiles: { 9: 'swierk_9m_picea.json' }, defaultHeight: 9 },
  {
    key: 'topola_wloska', dir: 'topola_czarna', label: "Topola czarna 'Italica' (kolumnowa)", kind: 'POPLAR',
    profiles: { 15: 'topola_wloska_15m.json' }, onlyHeights: [15],
  },
  {
    key: 'topola_czarna', dir: 'topola_czarna', label: 'Topola czarna (Populus nigra)', kind: 'Black Poplar',
    profiles: { 24: 'topola_czarna_24m.json' }, onlyHeights: [24],
  },
  { key: 'osika', dir: 'osika_Populus-tremula', label: 'Osika (Populus tremula)', kind: 'Quaking Aspen', profiles: { 6: 'osika_6m.json', 9: 'osika_9m.json', 15: 'osika_15m.json' } },
  { key: 'topola', dir: 'topola_Populus', label: 'Topola młoda (Populus)', kind: 'Black Poplar', defaultHeight: 9 },
  { key: 'wierzba', dir: 'wierzba_Salix', label: 'Wierzba (Salix)', kind: 'WILLOW', defaultHeight: 9 },
];

export interface RefPhoto {
  file: string;
  path: string;
  height: number;
}

const HEIGHT_SUFFIX = /-(\d+)m\.[a-z]+$/i;

/** Zdjęcia pokroju gatunku z przypisaną wysokością (pomijane: bez wysokości i bez domyślnej) */
const photoCache = new Map<string, RefPhoto[]>();

export function speciesPhotos(sp: SpeciesRef): RefPhoto[] {
  const cached = photoCache.get(sp.key);
  if (cached) return cached;
  // Katalog `zdjecia` albo `zdjęcia` (z polską literą, w dowolnej normalizacji Unicode)
  const root = path.join(DRZEWA_DIR, sp.dir);
  const sub = fs.existsSync(root) ? fs.readdirSync(root).find((d) => ['zdjecia', 'zdjęcia'].includes(d.normalize('NFC'))) : undefined;
  if (!sub) { photoCache.set(sp.key, []); return []; }
  const dir = path.join(root, sub);
  const { photoHeights = {}, exclude = [] } = PHOTO_MANIFEST[sp.key] ?? {};
  const out: RefPhoto[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
    const suffix = HEIGHT_SUFFIX.exec(file);
    const mapped = Object.entries(photoHeights).find(([frag]) => file.includes(frag))?.[1];
    // Jawne przypisanie ma pierwszeństwo przed sufiksem (przekwalifikowanie zdjęcia bez zmiany nazwy pliku)
    const height = mapped ?? (suffix ? Number(suffix[1]) : sp.defaultHeight);
    if (!height || exclude.some((frag) => file.includes(frag)) || (sp.onlyHeights && !sp.onlyHeights.includes(height))) continue;
    out.push({ file, path: path.join(dir, file), height });
  }
  photoCache.set(sp.key, out);
  return out;
}

export const profilePath = (sp: SpeciesRef, h: number) => (sp.profiles?.[h] ? path.join(DRZEWA_DIR, sp.dir, sp.profiles[h]) : undefined);

/** Dolny pas zdjęcia pomijany (znaki wodne, napisy agencji) */
const BOTTOM_SKIP = 0.06;
/** Margines krawędzi zdjęcia pomijany (ramki, cienie skanu) */
const EDGE_MARGIN = 0.012;
/** Najmniejsza liczba pikseli drzewa w wierszu / kolumnie, żeby wliczyć je do obrysu (szum, znaki wodne) */
const MIN_RUN_FRACTION = 0.004;

function isTreePixel(d: Uint8ClampedArray, i: number): boolean {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  if (d[i + 3] < 30) return false;
  if (r > 235 && g > 235 && b > 235) return false; // białe tło
  return !(r > 215 && g > 215 && b > 215 && Math.abs(r - b) < 25 && Math.abs(g - b) < 25); // szare tło, znaki wodne
}

export interface PhotoSilhouette {
  mask: Uint8Array;
  /** Piksele RGBA całego zdjęcia (do dalszych analiz bez ponownego dekodowania) */
  data: Uint8ClampedArray;
  W: number;
  H: number;
  /** Obrys drzewa [x, y, w, h] w pikselach zdjęcia: dół = grunt, góra = wierzchołek */
  crop: [number, number, number, number];
}

/** Maska drzewa na zdjęciu i jej obrys (wiersze/kolumny z odpowiednią liczbą pikseli drzewa) */
export async function photoSilhouette(photoPath: string): Promise<PhotoSilhouette> {
  const img = await loadImage(photoPath.endsWith('.webp') ? await webpAsPng(photoPath) : photoPath);
  const W = img.width, H = img.height;
  const ctx = createCanvas(W, H).getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  const mx = Math.round(W * EDGE_MARGIN), my = Math.round(H * EDGE_MARGIN), maxY = Math.floor(H * (1 - BOTTOM_SKIP));
  const rows = new Int32Array(H), cols = new Int32Array(W);
  for (let y = my; y < maxY; y++) {
    for (let x = mx; x < W - mx; x++) {
      if (!isTreePixel(data, (y * W + x) * 4)) continue;
      mask[y * W + x] = 1;
      rows[y]++;
      cols[x]++;
    }
  }
  const minRow = Math.max(2, W * MIN_RUN_FRACTION), minCol = Math.max(2, H * MIN_RUN_FRACTION);
  let x0 = 0, x1 = W - 1, y0 = 0, y1 = H - 1;
  while (x0 < W && cols[x0] < minCol) x0++;
  while (x1 > x0 && cols[x1] < minCol) x1--;
  while (y0 < H && rows[y0] < minRow) y0++;
  while (y1 > y0 && rows[y1] < minRow) y1--;
  // Maska tylko w obrysie (odcina rozproszony szum poza drzewem)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < x0 || x > x1 || y < y0 || y > y1) mask[y * W + x] = 0;
  return { mask, data, W, H, crop: [x0, y0, x1 - x0 + 1, y1 - y0 + 1] };
}

/** node-canvas nie dekoduje webp — konwersja `sips` przez unikalny katalog tymczasowy */
async function webpAsPng(p: string): Promise<Buffer> {
  const { imageToPngDataUrl } = await import('./imageDataUrl');
  return Buffer.from(imageToPngDataUrl(p).split(',')[1], 'base64');
}
