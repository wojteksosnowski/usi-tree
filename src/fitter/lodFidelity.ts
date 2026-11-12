/**
 * Miara zachowania wyglądu między poziomami LOD siatki drzewa: sylwetka siatki rasteryzowana do maski
 * (rzut boczny XY i z góry XZ, czysty JS — bez `canvas`), porównanie z siatką odniesienia przez IoU masek
 * (osobno sama kora i całość), odległość miar sylwetki (`metricsDistance`) i udział pola rzutu trzech tonów listowia.
 */
import type { RawTreeMesh } from '../core/types.js';
import { metricsDistance, silhouetteMetrics } from './silhouetteMetrics.js';

export type LodView = 'side' | 'top';

/** Wspólny kadr rasteryzacji: ten sam dla porównywanych siatek, żeby maski nakładały się piksel w piksel */
export interface LodFrame {
  view: LodView;
  /** Lewy dolny róg kadru w metrach (oś pozioma: x; pionowa: y w rzucie bocznym, z w rzucie z góry) */
  minU: number;
  minV: number;
  pxPerUnit: number;
  W: number;
  H: number;
}

/** Kadr obejmujący wszystkie podane siatki; dłuższy bok ma `size` pikseli */
export function lodFrame(meshes: readonly RawTreeMesh[], view: LodView, size = 128): LodFrame {
  const v = view === 'side' ? 1 : 2;
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (const m of meshes) {
    minU = Math.min(minU, m.boundingBox.min[0]);
    maxU = Math.max(maxU, m.boundingBox.max[0]);
    minV = Math.min(minV, m.boundingBox.min[v]);
    maxV = Math.max(maxV, m.boundingBox.max[v]);
  }
  if (!(maxU > minU)) maxU = minU + 1e-6;
  if (!(maxV > minV)) maxV = minV + 1e-6;
  const pxPerUnit = size / Math.max(maxU - minU, maxV - minV);
  return {
    view,
    minU,
    minV,
    pxPerUnit,
    W: Math.max(1, Math.ceil((maxU - minU) * pxPerUnit)) + 2,
    H: Math.max(1, Math.ceil((maxV - minV) * pxPerUnit)) + 2,
  };
}

/**
 * Maska W×H rzutu siatki (1 = zakryty piksel; wiersz 0 u góry, jak w `silhouetteMetrics`).
 * Trójkąt zakrywa piksele, których środek leży w jego wnętrzu, oraz piksele pod jego krawędziami —
 * cienkie pędy (poniżej piksela) nie znikają. `material` ogranicza maskę do wybranych grup materiałów.
 */
export function rasterizeMesh(
  mesh: RawTreeMesh,
  frame: LodFrame,
  material?: (materialIndex: number) => boolean
): Uint8Array {
  const { W, H, minU, minV, pxPerUnit } = frame;
  const v = frame.view === 'side' ? 1 : 2;
  const mask = new Uint8Array(W * H);
  const pos = mesh.positions,
    idx = mesh.indices;
  const set = (x: number, y: number) => {
    const xi = Math.floor(x),
      yi = Math.floor(y);
    if (xi >= 0 && yi >= 0 && xi < W && yi < H) mask[yi * W + xi] = 1;
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  };
  for (const g of mesh.groups) {
    if (material && !material(g.materialIndex)) continue;
    for (let k = g.start; k < g.start + g.count; k += 3) {
      const a = idx[k] * 3,
        b = idx[k + 1] * 3,
        c = idx[k + 2] * 3;
      const ax = (pos[a] - minU) * pxPerUnit + 1,
        ay = H - 1 - (pos[a + v] - minV) * pxPerUnit;
      const bx = (pos[b] - minU) * pxPerUnit + 1,
        by = H - 1 - (pos[b + v] - minV) * pxPerUnit;
      const cx = (pos[c] - minU) * pxPerUnit + 1,
        cy = H - 1 - (pos[c + v] - minV) * pxPerUnit;
      line(ax, ay, bx, by);
      line(bx, by, cx, cy);
      line(cx, cy, ax, ay);
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
        x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))),
        y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const w0 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
          const w1 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
          const w2 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
          if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) mask[y * W + x] = 1;
        }
      }
    }
  }
  return mask;
}

/** Część wspólna / suma dwóch masek tego samego kadru (1 = identyczne; dwie puste maski = 1) */
export function maskIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0,
    union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) union++;
    if (a[i] && b[i]) inter++;
  }
  return union === 0 ? 1 : inter / union;
}

/** Liczba zakrytych pikseli maski */
export function maskArea(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

/** Obrys maski: każdy wiersz wypełniony między skrajnymi zakrytymi pikselami (bez prześwitów w koronie) */
export function fillMaskOutline(mask: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    let x0 = -1,
      x1 = -1;
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (x0 < 0) x0 = x;
      x1 = x;
    }
    for (let x = x0; x0 >= 0 && x <= x1; x++) out[y * W + x] = 1;
  }
  return out;
}

/** Udział pola rzutu bocznego każdego z trzech tonów listowia (materiały 1..3) w ich sumie; brak listowia = zera */
export function toneShares(mesh: RawTreeMesh, frame: LodFrame): [number, number, number] {
  const areas = [1, 2, 3].map((m) => maskArea(rasterizeMesh(mesh, frame, (i) => i === m)));
  const sum = areas[0] + areas[1] + areas[2];
  return sum === 0 ? [0, 0, 0] : [areas[0] / sum, areas[1] / sum, areas[2] / sum];
}

/**
 * Widoczny materiał w każdym pikselu rzutu (0 = pusto, 1 = kora, 2..4 = tony listowia: jasny, pośredni, ciemny):
 * bufor głębi — wygrywa trójkąt najbliższy obserwatorowi (rzut boczny: największe z, z góry: największe y).
 * W odróżnieniu od `toneShares` uwzględnia zasłanianie, więc mierzy to, co faktycznie widać.
 */
export function rasterizeVisibleMaterials(mesh: RawTreeMesh, frame: LodFrame): Uint8Array {
  const { W, H, minU, minV, pxPerUnit } = frame;
  const v = frame.view === 'side' ? 1 : 2;
  const d = frame.view === 'side' ? 2 : 1;
  const out = new Uint8Array(W * H);
  const depth = new Float32Array(W * H).fill(-Infinity);
  const pos = mesh.positions,
    idx = mesh.indices;
  for (const g of mesh.groups) {
    const value = Math.min(4, g.materialIndex + 1);
    const plot = (x: number, y: number, z: number) => {
      const xi = Math.floor(x),
        yi = Math.floor(y);
      if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
      const k = yi * W + xi;
      if (z > depth[k]) {
        depth[k] = z;
        out[k] = value;
      }
    };
    const line = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
      const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        plot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);
      }
    };
    for (let k = g.start; k < g.start + g.count; k += 3) {
      const a = idx[k] * 3,
        b = idx[k + 1] * 3,
        c = idx[k + 2] * 3;
      const ax = (pos[a] - minU) * pxPerUnit + 1,
        ay = H - 1 - (pos[a + v] - minV) * pxPerUnit,
        az = pos[a + d];
      const bx = (pos[b] - minU) * pxPerUnit + 1,
        by = H - 1 - (pos[b + v] - minV) * pxPerUnit,
        bz = pos[b + d];
      const cx = (pos[c] - minU) * pxPerUnit + 1,
        cy = H - 1 - (pos[c + v] - minV) * pxPerUnit,
        cz = pos[c + d];
      line(ax, ay, az, bx, by, bz);
      line(bx, by, bz, cx, cy, cz);
      line(cx, cy, cz, ax, ay, az);
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
        x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))),
        y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const w0 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) / area;
          const w1 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) / area;
          const w2 = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) / area;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          // w0 waży wierzchołek c, w1 — a, w2 — b
          plot(px, py, cz * w0 + az * w1 + bz * w2);
        }
      }
    }
  }
  return out;
}

/** Wagi jasności tonów listowia: jasny, pośredni, ciemny */
const TONE_BRIGHTNESS = [1, 0.5, 0] as const;

/** Średnia jasność widocznego listowia w rzucie (0 = sam ton ciemny, 1 = sam jasny); brak listowia = 0 */
export function visibleBrightness(materials: Uint8Array): number {
  let sum = 0,
    n = 0;
  for (let i = 0; i < materials.length; i++) {
    if (materials[i] < 2) continue;
    sum += TONE_BRIGHTNESS[materials[i] - 2];
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/** Maska rozszerzona o `radius` pikseli (kwadratowe sąsiedztwo) */
export function dilateMask(mask: Uint8Array, W: number, H: number, radius: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      for (let yy = Math.max(0, y - radius); yy <= Math.min(H - 1, y + radius); yy++) {
        for (let xx = Math.max(0, x - radius); xx <= Math.min(W - 1, x + radius); xx++) out[yy * W + xx] = 1;
      }
    }
  }
  return out;
}

/** Obwód maski: liczba krawędzi pikseli między zakrytym a pustym (brzeg kadru liczy się jak pusty) */
export function maskPerimeter(mask: Uint8Array, W: number, H: number): number {
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (x === 0 || !mask[y * W + x - 1]) n++;
      if (x === W - 1 || !mask[y * W + x + 1]) n++;
      if (y === 0 || !mask[(y - 1) * W + x]) n++;
      if (y === H - 1 || !mask[(y + 1) * W + x]) n++;
    }
  }
  return n;
}

/**
 * Chropowatość obrysu: obwód² / (4π · pole) obrysu wypełnionego wierszami — koło ma najmniej, poszarpany kontur
 * (kolce) dużo więcej, gładka bryła mniej niż chmura liści. Pusta maska = 0.
 */
export function outlineRoughness(mask: Uint8Array, W: number, H: number): number {
  const outline = fillMaskOutline(mask, W, H);
  const area = maskArea(outline);
  if (area === 0) return 0;
  const perimeter = maskPerimeter(outline, W, H);
  return (perimeter * perimeter) / (4 * Math.PI * area);
}

/** O ile pikseli rozszerzany jest obrys odniesienia przy mierzeniu wystawania */
const OVERHANG_TOLERANCE_PX = 2;

export interface LodViewFidelity {
  /** IoU maski całej siatki (kora + listowie) */
  iou: number;
  /** IoU maski samej kory (materiał 0) — rysunek konarów */
  iouBark: number;
  /** IoU obrysu (maska wypełniona wierszami) — kontur korony bez wpływu prześwitów między liśćmi */
  iouOutline: number;
  /** Wystawanie: udział pola maski siatki leżący poza obrysem odniesienia rozszerzonym o 2 piksele (kolce, za duże płaty) */
  overhang: number;
  /** Chropowatość obrysu siatki względem odniesienia (1 = taka sama; > 1 poszarpany, < 1 wygładzony) */
  roughnessRatio: number;
  /** Średnia jasność widocznego listowia: siatka minus odniesienie (dodatnia = jaśniejsza) */
  brightnessDelta: number;
}

export interface LodFidelity {
  side: LodViewFidelity;
  top: LodViewFidelity;
  /** Odległość miar sylwetki w elewacji (`metricsDistance`); null, gdy któraś maska jest pusta */
  metricsDistance: number | null;
  /** Udział pola rzutu bocznego tonów listowia: odniesienie i siatka badana (jasny, pośredni, ciemny) */
  referenceToneShares: [number, number, number];
  toneShares: [number, number, number];
  /** Największa różnica udziału jednego tonu */
  toneShareDelta: number;
}

const isBark = (materialIndex: number) => materialIndex === 0;

/** Rastry jednej siatki we wspólnym kadrze (liczone raz, także gdy odniesienie porównuje się z kilkoma siatkami) */
interface ViewRasters {
  all: Uint8Array;
  bark: Uint8Array;
  outline: Uint8Array;
  roughness: number;
  brightness: number;
}

function viewRasters(mesh: RawTreeMesh, frame: LodFrame): ViewRasters {
  const all = rasterizeMesh(mesh, frame);
  return {
    all,
    bark: rasterizeMesh(mesh, frame, isBark),
    outline: fillMaskOutline(all, frame.W, frame.H),
    roughness: outlineRoughness(all, frame.W, frame.H),
    brightness: visibleBrightness(rasterizeVisibleMaterials(mesh, frame)),
  };
}

function viewFidelity(a: ViewRasters, b: ViewRasters, frame: LodFrame): LodViewFidelity {
  const allowed = dilateMask(a.outline, frame.W, frame.H, OVERHANG_TOLERANCE_PX);
  let outside = 0,
    areaB = 0;
  for (let i = 0; i < b.all.length; i++) {
    if (!b.all[i]) continue;
    areaB++;
    if (!allowed[i]) outside++;
  }
  return {
    iou: maskIoU(a.all, b.all),
    iouBark: maskIoU(a.bark, b.bark),
    iouOutline: maskIoU(a.outline, b.outline),
    overhang: areaB === 0 ? 0 : outside / areaB,
    roughnessRatio: a.roughness > 0 ? b.roughness / a.roughness : 1,
    brightnessDelta: b.brightness - a.brightness,
  };
}

/**
 * Zgodność wyglądu kilku siatek z jedną siatką odniesienia (zwykle poziomy dalsze względem `near` tego samego szkieletu)
 * we wspólnym kadrze — rastry odniesienia liczone raz. Wyniki w kolejności `meshes`.
 */
export function lodFidelityMany(reference: RawTreeMesh, meshes: readonly RawTreeMesh[], size = 128): LodFidelity[] {
  const everything = [reference, ...meshes];
  const side = lodFrame(everything, 'side', size);
  const top = lodFrame(everything, 'top', size);
  const refSide = viewRasters(reference, side),
    refTop = viewRasters(reference, top);
  const ma = silhouetteMetrics(refSide.all, side.W, side.H);
  const ta = toneShares(reference, side);
  return meshes.map((mesh) => {
    const meshSide = viewRasters(mesh, side);
    const mb = silhouetteMetrics(meshSide.all, side.W, side.H);
    const tb = toneShares(mesh, side);
    return {
      side: viewFidelity(refSide, meshSide, side),
      top: viewFidelity(refTop, viewRasters(mesh, top), top),
      metricsDistance: ma && mb ? metricsDistance(ma, mb) : null,
      referenceToneShares: ta,
      toneShares: tb,
      toneShareDelta: Math.max(Math.abs(ta[0] - tb[0]), Math.abs(ta[1] - tb[1]), Math.abs(ta[2] - tb[2])),
    };
  });
}

/** Zgodność wyglądu siatki `mesh` z siatką odniesienia (zwykle poziom `near` tego samego szkieletu) */
export function lodFidelity(reference: RawTreeMesh, mesh: RawTreeMesh, size = 128): LodFidelity {
  return lodFidelityMany(reference, [mesh], size)[0];
}

// ---------------------------------------------------------------------------------------------------------------
// Miara oświetlona: to, co widać w aplikacji — listowie Lamberta dwustronnego w słońcu, z cieniem własnym korony.
// Same tony wierzchołków (`brightnessDelta`) tego nie mierzą: o jasności lasu decyduje orientacja normalnych
// względem słońca i to, ile powierzchni korony leży w cieniu innych liści.
// ---------------------------------------------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];

/** Rzut równoległy: osie ekranu U, V i kierunek D ku obserwatorowi (większa głębia = bliżej), kadr w pikselach */
interface Projection {
  U: Vec3;
  V: Vec3;
  D: Vec3;
  minU: number;
  minV: number;
  pxPerUnit: number;
  W: number;
  H: number;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Kadr rzutu z kierunku `toViewer` obejmujący wszystkie siatki; dłuższy bok ma `size` pikseli */
function projectionFrame(meshes: readonly RawTreeMesh[], toViewer: Vec3, size: number): Projection {
  const D = normalize(toViewer);
  const U = normalize(Math.abs(D[1]) > 0.999 ? [1, 0, 0] : cross([0, 1, 0], D));
  const V = cross(D, U);
  let minU = Infinity,
    maxU = -Infinity,
    minV = Infinity,
    maxV = -Infinity;
  for (const m of meshes) {
    for (let c = 0; c < 8; c++) {
      const x = (c & 1 ? m.boundingBox.max : m.boundingBox.min)[0];
      const y = (c & 2 ? m.boundingBox.max : m.boundingBox.min)[1];
      const z = (c & 4 ? m.boundingBox.max : m.boundingBox.min)[2];
      const u = x * U[0] + y * U[1] + z * U[2],
        v = x * V[0] + y * V[1] + z * V[2];
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  }
  if (!(maxU > minU)) maxU = minU + 1e-6;
  if (!(maxV > minV)) maxV = minV + 1e-6;
  const pxPerUnit = size / Math.max(maxU - minU, maxV - minV);
  return {
    U,
    V,
    D,
    minU,
    minV,
    pxPerUnit,
    W: Math.max(1, Math.ceil((maxU - minU) * pxPerUnit)) + 2,
    H: Math.max(1, Math.ceil((maxV - minV) * pxPerUnit)) + 2,
  };
}

/**
 * Bufor głębi rzutu: w pikselu głębia i pierwszy indeks (w `indices`) najbliższego trójkąta; −1 = pusto.
 * Trójkąt zakrywa tylko piksele, których środek leży w jego wnętrzu (bez dorysowywania krawędzi jak w `rasterizeMesh`):
 * pole maski jest wtedy nieobciążonym oszacowaniem pola rzutu — dorysowane krawędzie zawyżałyby pole drobnych liści
 * względem dużych i fałszowały porównanie poziomów.
 */
function depthRaster(mesh: RawTreeMesh, p: Projection): { depth: Float32Array; tri: Int32Array } {
  const { W, H, U, V, D, minU, minV, pxPerUnit } = p;
  const depth = new Float32Array(W * H).fill(-Infinity);
  const tri = new Int32Array(W * H).fill(-1);
  const pos = mesh.positions,
    idx = mesh.indices;
  const sx = new Float64Array(3),
    sy = new Float64Array(3),
    sd = new Float64Array(3);
  for (const g of mesh.groups) {
    for (let k = g.start; k < g.start + g.count; k += 3) {
      for (let e = 0; e < 3; e++) {
        const v = idx[k + e] * 3;
        const x = pos[v],
          y = pos[v + 1],
          z = pos[v + 2];
        sx[e] = (x * U[0] + y * U[1] + z * U[2] - minU) * pxPerUnit + 1;
        sy[e] = H - 1 - (x * V[0] + y * V[1] + z * V[2] - minV) * pxPerUnit;
        sd[e] = x * D[0] + y * D[1] + z * D[2];
      }
      const plot = (x: number, y: number, d: number) => {
        const xi = Math.floor(x),
          yi = Math.floor(y);
        if (xi < 0 || yi < 0 || xi >= W || yi >= H) return;
        const q = yi * W + xi;
        if (d > depth[q]) {
          depth[q] = d;
          tri[q] = k;
        }
      };
      const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sy[1] - sy[0]) * (sx[2] - sx[0]);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2]))),
        x1 = Math.min(W - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
      const y0 = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2]))),
        y1 = Math.min(H - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const w2 = ((sx[1] - sx[0]) * (py - sy[0]) - (sy[1] - sy[0]) * (px - sx[0])) / area;
          const w0 = ((sx[2] - sx[1]) * (py - sy[1]) - (sy[2] - sy[1]) * (px - sx[1])) / area;
          const w1 = ((sx[0] - sx[2]) * (py - sy[2]) - (sy[0] - sy[2]) * (px - sx[2])) / area;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          plot(px, py, sd[0] * w0 + sd[1] * w1 + sd[2] * w2);
        }
      }
    }
  }
  return { depth, tri };
}

/** Ustawienia miary oświetlonej (domyślne odpowiadają widokowi aksonometrycznemu aplikacji) */
export interface LodLitOptions {
  /** Kierunek ku kamerze (aksonometria ok. 30–40° nad horyzontem) */
  toCamera?: Vec3;
  /** Kierunki ku słońcu */
  suns?: readonly Vec3[];
  /** Udział światła rozproszonego w pełnym oświetleniu (0–1) */
  ambient?: number;
  /** Dłuższy bok rastrów w pikselach */
  size?: number;
}

/** Słońce: wysokość i azymut w stopniach → kierunek ku słońcu */
function sunDirection(elevationDeg: number, azimuthDeg: number): Vec3 {
  const e = (elevationDeg * Math.PI) / 180,
    a = (azimuthDeg * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}

/** Domyślne słońca: wysokie południe, średnie (kadr porównawczy aplikacji: 38°), niskie z boku */
export const LOD_LIT_SUNS: readonly Vec3[] = [sunDirection(60, 200), sunDirection(38, 185), sunDirection(25, 110)];
const LOD_LIT_CAMERA: Vec3 = [1, 0.8, 1];
/** Jasność materiałów: kora, ton jasny, pośredni, ciemny (luminancja palety aplikacji) */
const LIT_ALBEDO = [0.28, 0.7, 0.52, 0.36] as const;
/** Odsunięcie testu cienia (m) — jak bias shadow mapy, żeby płaszczyzna liścia nie cieniowała samej siebie */
const SHADOW_BIAS = 0.15;

/** Wynik miary oświetlonej jednej siatki */
export interface LodLitMeasure {
  /** Średnia luminancja zakrytych pikseli rzutu kamery (0–1), dla każdego słońca */
  luminance: number[];
  /** Udział zakrytych pikseli rzutu kamery leżących w cieniu własnym drzewa, dla każdego słońca */
  shadowed: number[];
  /** Pole rzutu z kamery (piksele wspólnego kadru) */
  cameraArea: number;
  /** Pole cienia rzucanego na grunt (piksele rzutu wzdłuż światła we wspólnym kadrze), dla każdego słońca */
  castShadowArea: number[];
}

function litMeasure(
  mesh: RawTreeMesh,
  camera: Projection,
  lights: readonly Projection[],
  ambient: number
): LodLitMeasure {
  const cam = depthRaster(mesh, camera);
  const pos = mesh.positions,
    nrm = mesh.normals,
    idx = mesh.indices;
  const materialOf = new Uint8Array(idx.length);
  for (const g of mesh.groups) materialOf.fill(Math.min(3, g.materialIndex), g.start, g.start + g.count);
  const { W, H, U, V, D } = camera;
  let cameraArea = 0;
  for (let q = 0; q < cam.tri.length; q++) if (cam.tri[q] >= 0) cameraArea++;
  const luminance: number[] = [],
    shadowed: number[] = [],
    castShadowArea: number[] = [];
  for (const light of lights) {
    const map = depthRaster(mesh, light);
    let cast = 0;
    for (let q = 0; q < map.tri.length; q++) if (map.tri[q] >= 0) cast++;
    castShadowArea.push(cast);
    const L = light.D;
    let sum = 0,
      dark = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = cam.tri[y * W + x];
        if (k < 0) continue;
        const a = idx[k] * 3,
          b = idx[k + 1] * 3,
          c = idx[k + 2] * 3;
        // Normalna cieniowania: z siatki, odwrócona dla ściany widzianej od tyłu (jak DoubleSide w three)
        let nx = nrm[a] + nrm[b] + nrm[c],
          ny = nrm[a + 1] + nrm[b + 1] + nrm[c + 1],
          nz = nrm[a + 2] + nrm[b + 2] + nrm[c + 2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const ux = pos[b] - pos[a],
          uy = pos[b + 1] - pos[a + 1],
          uz = pos[b + 2] - pos[a + 2];
        const wx = pos[c] - pos[a],
          wy = pos[c + 1] - pos[a + 1],
          wz = pos[c + 2] - pos[a + 2];
        const facing =
          (uy * wz - uz * wy) * D[0] + (uz * wx - ux * wz) * D[1] + (ux * wy - uy * wx) * D[2];
        const lambert = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) * (facing >= 0 ? 1 : -1));
        // Położenie fragmentu w scenie z piksela i głębi, potem test w buforze głębi światła
        const u = (x + 0.5 - 1) / camera.pxPerUnit + camera.minU,
          v = (H - 1 - (y + 0.5)) / camera.pxPerUnit + camera.minV,
          d = cam.depth[y * W + x];
        const px = U[0] * u + V[0] * v + D[0] * d,
          py = U[1] * u + V[1] * v + D[1] * d,
          pz = U[2] * u + V[2] * v + D[2] * d;
        const lx = Math.floor((px * light.U[0] + py * light.U[1] + pz * light.U[2] - light.minU) * light.pxPerUnit + 1),
          ly = Math.floor(light.H - 1 - (px * light.V[0] + py * light.V[1] + pz * light.V[2] - light.minV) * light.pxPerUnit);
        let lit = 1;
        if (lx >= 0 && ly >= 0 && lx < light.W && ly < light.H) {
          if (map.depth[ly * light.W + lx] > px * L[0] + py * L[1] + pz * L[2] + SHADOW_BIAS) lit = 0;
        }
        if (!lit) dark++;
        sum += LIT_ALBEDO[materialOf[k]] * (ambient + (1 - ambient) * lambert * lit);
      }
    }
    luminance.push(cameraArea ? sum / cameraArea : 0);
    shadowed.push(cameraArea ? dark / cameraArea : 0);
  }
  return { luminance, shadowed, cameraArea, castShadowArea };
}

/** Zgodność siatki z odniesieniem w oświetleniu aplikacji */
export interface LodLitFidelity {
  reference: LodLitMeasure;
  measure: LodLitMeasure;
  /** Średnia po słońcach różnica luminancji rzutu: siatka − odniesienie (dodatnia = jaśniejsza), w skali 0–1 */
  luminanceDelta: number;
  /** Największa co do modułu różnica luminancji wśród słońc (ze znakiem) */
  luminanceDeltaWorst: number;
  /** Pole rzutu z kamery aksonometrycznej: siatka / odniesienie */
  cameraAreaRatio: number;
  /** Pole rzutu z góry: siatka / odniesienie */
  topAreaRatio: number;
  /** Pole cienia rzucanego na grunt, średnia po słońcach: siatka / odniesienie */
  castShadowRatio: number;
}

/**
 * Miara oświetlona: rzut z kamery aksonometrycznej z buforem głębi, cieniowanie Lamberta dwustronnego, cień własny
 * z bufora głębi światła (jak shadow mapa). Zwraca luminancję, pole rzutu i pole cienia na gruncie względem odniesienia.
 */
export function lodLitFidelity(reference: RawTreeMesh, mesh: RawTreeMesh, options: LodLitOptions = {}): LodLitFidelity {
  const size = options.size ?? 192;
  const suns = options.suns ?? LOD_LIT_SUNS;
  const ambient = options.ambient ?? 0.4;
  const both = [reference, mesh];
  const camera = projectionFrame(both, options.toCamera ?? LOD_LIT_CAMERA, size);
  const lights = suns.map((s) => projectionFrame(both, s, size));
  const a = litMeasure(reference, camera, lights, ambient),
    b = litMeasure(mesh, camera, lights, ambient);
  const top = projectionFrame(both, [0, 1, 0], size);
  const covered = (m: RawTreeMesh) => {
    let n = 0;
    for (const t of depthRaster(m, top).tri) if (t >= 0) n++;
    return n;
  };
  const topA = covered(reference),
    topB = covered(mesh);
  let sum = 0,
    worst = 0,
    cast = 0;
  for (let i = 0; i < suns.length; i++) {
    const d = b.luminance[i] - a.luminance[i];
    sum += d;
    if (Math.abs(d) > Math.abs(worst)) worst = d;
    cast += a.castShadowArea[i] ? b.castShadowArea[i] / a.castShadowArea[i] : 1;
  }
  return {
    reference: a,
    measure: b,
    luminanceDelta: sum / suns.length,
    luminanceDeltaWorst: worst,
    cameraAreaRatio: a.cameraArea ? b.cameraArea / a.cameraArea : 1,
    topAreaRatio: topA ? topB / topA : 1,
    castShadowRatio: cast / suns.length,
  };
}

/** Kształt i orientacja liści siatki (wielokąty o `corners` narożnikach w grupach listowia) */
export interface LeafPolygonStats {
  count: number;
  /** Najmniejszy kąt wewnętrzny wielokąta liścia w całej siatce (stopnie) — „ostrość” liścia */
  minAngleDeg: number;
  /** Mediana najmniejszego kąta wewnętrznego liścia (stopnie) */
  medianMinAngleDeg: number;
  /** Średni |n · pion| normalnych liści (0 = liście pionowe, 1 = poziome) */
  meanAbsNormalUp: number;
  /** Średni |n · kierunek od osi korony| (1 = liście styczne do korony, zwrócone na zewnątrz; 0 = sterczące) */
  meanAbsNormalRadial: number;
}

/**
 * Statystyka liści siatki zbudowanej z wielokątów-wachlarzy (jak `addLeaves`): kolejne `corners` wierzchołków
 * i `corners − 2` trójkątów na liść. Do porównania kształtu i rozkładu orientacji liści między poziomami.
 */
export function leafPolygonStats(mesh: RawTreeMesh, corners: number): LeafPolygonStats {
  const pos = mesh.positions,
    nrm = mesh.normals,
    idx = mesh.indices;
  const step = (corners - 2) * 3;
  let cx = 0,
    cz = 0,
    n = 0;
  for (const g of mesh.groups) {
    if (g.materialIndex === 0) continue;
    for (let k = g.start; k + step <= g.start + g.count; k += step) {
      cx += pos[idx[k] * 3];
      cz += pos[idx[k] * 3 + 2];
      n++;
    }
  }
  if (n === 0) return { count: 0, minAngleDeg: 0, medianMinAngleDeg: 0, meanAbsNormalUp: 0, meanAbsNormalRadial: 0 };
  cx /= n;
  cz /= n;
  const minAngles: number[] = [];
  let up = 0,
    radial = 0;
  for (const g of mesh.groups) {
    if (g.materialIndex === 0) continue;
    for (let k = g.start; k + step <= g.start + g.count; k += step) {
      const v0 = idx[k];
      let sharpest = 180,
        mx = 0,
        mz = 0;
      for (let p = 0; p < corners; p++) {
        const a = (v0 + p) * 3,
          b = (v0 + ((p + 1) % corners)) * 3,
          c = (v0 + ((p + corners - 1) % corners)) * 3;
        const ux = pos[b] - pos[a],
          uy = pos[b + 1] - pos[a + 1],
          uz = pos[b + 2] - pos[a + 2];
        const wx = pos[c] - pos[a],
          wy = pos[c + 1] - pos[a + 1],
          wz = pos[c + 2] - pos[a + 2];
        const cos = (ux * wx + uy * wy + uz * wz) / (Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz) || 1);
        sharpest = Math.min(sharpest, (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
        mx += pos[a] / corners;
        mz += pos[a + 2] / corners;
      }
      minAngles.push(sharpest);
      const nx = nrm[v0 * 3],
        ny = nrm[v0 * 3 + 1],
        nz = nrm[v0 * 3 + 2];
      up += Math.abs(ny);
      const rx = mx - cx,
        rz = mz - cz;
      const rl = Math.hypot(rx, rz);
      radial += rl > 1e-9 ? Math.abs(nx * rx + nz * rz) / rl : 0;
    }
  }
  minAngles.sort((a, b) => a - b);
  return {
    count: n,
    minAngleDeg: minAngles[0],
    medianMinAngleDeg: minAngles[minAngles.length >> 1],
    meanAbsNormalUp: up / n,
    meanAbsNormalRadial: radial / n,
  };
}
