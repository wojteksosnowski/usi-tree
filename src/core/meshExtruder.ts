/**
 * 3D mesh extrusion along botanical stems and foliage generation.
 */
import { MeshBufferBuilder } from './meshBuilder.js';
import { FastPrng } from './prng.js';
import type {
  SpeciesProfile,
  Stem,
  TreeMeshLod,
  TreeStroke,
} from './types.js';

const DEG = Math.PI / 180;
export const DEFAULT_LEAF_DENSITY = 38;

/** Sześciokąt liścia: pary (wzdłuż, w poprzek/w) — nasada, dwa boki, czubek */
const LEAF_HEX = [0, 0, 0.3, 1, 0.75, 0.8, 1, 0, 0.75, -0.8, 0.3, -1] as const;

/** Tablice cos/sin przekroju tuby dla 3–8 boków */
export const RING_COS: Float64Array[] = [];
export const RING_SIN: Float64Array[] = [];
for (let n = 3; n <= 8; n++) {
  RING_COS[n] = new Float64Array(n);
  RING_SIN[n] = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    RING_COS[n][j] = Math.cos((j / n) * Math.PI * 2);
    RING_SIN[n][j] = Math.sin((j / n) * Math.PI * 2);
  }
}

/** Górna granica promienia pędu w kresce względem nasady pnia, wg rzędu (da Vinci / Weber–Penn): pień, konary, gałęzie, witki */
const STROKE_LEVEL_CAP = [Infinity, 0.45, 0.22, 0.09] as const;

/**
 * Miękkie ograniczenie promienia: do 70% limitu bez zmian, powyżej wykładniczo dochodzi do limitu —
 * pędy grubsze od limitu zachowują kolejność grubości zamiast spłaszczać się do jednej wartości.
 */
export function softCap(v: number, cap: number): number {
  const knee = 0.7 * cap;
  if (!(v > knee)) return v;
  const span = cap - knee;
  return cap - span * Math.exp(-(v - knee) / span);
}

/** Promień nasady pnia (pierwszy pęd rzędu 0) — odniesienie limitów grubości kreski; brak pnia = bez limitu */
export function trunkBaseRadius(stems: readonly Stem[]): number {
  for (const s of stems) if (s.level === 0) return s.r[0];
  return Infinity;
}

/** Pęd z promieniami wg kreski: mnożnik rzędu, wygładzona zbieżność, odziomek rozłożony w górę pnia */
export function strokeStem(
  stem: Stem,
  stroke: TreeStroke,
  nominalHeight: number,
  trunkBaseR: number,
  twigStroke = 1
): Stem {
  const k = (stroke.levelScale[Math.min(stem.level, stroke.levelScale.length - 1)] ?? 1) * (stem.level >= 2 ? twigStroke : 1);
  const n = stem.r.length;
  const cap = trunkBaseR * STROKE_LEVEL_CAP[Math.min(stem.level, STROKE_LEVEL_CAP.length - 1)];
  const r = stem.r.map((v) => softCap(v * k, cap));

  if (stroke.smooth && stem.level <= 1 && n > 2) {
    const prev = new Float64Array(n);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) prev[i] = r[i];
      for (let i = 1; i < n - 1; i++) r[i] = (prev[i - 1] + 2 * prev[i] + prev[i + 1]) / 4;
    }
    for (let i = 1; i < n; i++) r[i] = Math.min(r[i], r[i - 1]);
  }

  if (stem.level === 0 && stem.py[0] < 1e-6 && stroke.flareRise > 0 && n > 1) {
    const rise = stroke.flareRise * nominalHeight;
    const flare = r[0] / Math.max(1e-9, r[1]);
    for (let i = 1; i < n && stem.py[i] < rise; i++) {
      const f = 1 - stem.py[i] / rise;
      r[i] *= 1 + (flare - 1) * f * f;
    }
  }
  return { ...stem, r };
}

/** Oblicza równolegle transportowaną ramkę [dx, dy, dz, sx, sy, sz, ux, uy, uz] dla pierścienia q */
function advanceTransportFrame(
  stem: Stem,
  rings: readonly number[],
  q: number,
  frame: Float64Array,
  hasSide: boolean
): void {
  const a = rings[Math.max(0, q - 1)],
    b = rings[Math.min(rings.length - 1, q + 1)];
  let dx = stem.px[b] - stem.px[a],
    dy = stem.py[b] - stem.py[a],
    dz = stem.pz[b] - stem.pz[a];
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl;
  dy /= dl;
  dz /= dl;
  let sx = frame[3],
    sy = frame[4],
    sz = frame[5];
  if (!hasSide) {
    if (Math.abs(dy) < 0.9) {
      sx = -dz;
      sy = 0;
      sz = dx;
    } else {
      sx = 0;
      sy = dz;
      sz = -dy;
    }
  } else {
    const dot = sx * dx + sy * dy + sz * dz;
    sx -= dx * dot;
    sy -= dy * dot;
    sz -= dz * dot;
  }
  const sl = Math.hypot(sx, sy, sz) || 1;
  sx /= sl;
  sy /= sl;
  sz /= sl;
  frame[0] = dx;
  frame[1] = dy;
  frame[2] = dz;
  frame[3] = sx;
  frame[4] = sy;
  frame[5] = sz;
  frame[6] = dy * sz - dz * sy;
  frame[7] = dz * sx - dx * sz;
  frame[8] = dx * sy - dy * sx;
}

/**
 * Wytłacza ciągłą tubę wzdłuż pędu: ramka transportowana równolegle,
 * pierścienie współdzielone przez sąsiednie segmenty, zamknięcie stożkiem.
 */
export function extrudeStem(
  stem: Stem,
  scale: number,
  sides: number,
  jitter: number,
  ringStride: number,
  prng: FastPrng,
  builder: MeshBufferBuilder,
  /** LOD: gotowy wybór pierścieni (indeksy punktów pędu, rosnąco, z ostatnim) zamiast `ringStride` */
  ringIdx?: readonly number[],
  /**
   * LOD: zakończenie tuby — `cone`: płaski stożek na ostatnim pierścieniu (jak dotąd), `open`: bez zamknięcia,
   * `spike`: ostatni pierścień zastąpiony wierzchołkiem (pęd zbiega się w szpic; o połowę mniej trójkątów na krótkim pędzie)
   */
  end: 'cone' | 'open' | 'spike' = 'cone',
  /** Odwrócenie kierunku pierścienia (lustrzana kolejność kątów; normalne nadal na zewnątrz) */
  reverse = false
) {
  const n = stem.px.length;
  let rings: number[];
  if (ringIdx) rings = ringIdx as number[];
  else {
    rings = [];
    for (let i = 0; i < n - 1; i += ringStride) rings.push(i);
    rings.push(n - 1);
  }
  const frame = new Float64Array(9);
  let hasSide = false;
  let prevRingStart = -1;

  const ringCount = end === 'spike' ? rings.length - 1 : rings.length;
  for (let q = 0; q < ringCount; q++) {
    const i = rings[q];
    advanceTransportFrame(stem, rings, q, frame, hasSide);
    hasSide = true;
    const sx = frame[3],
      sy = frame[4],
      sz = frame[5],
      ux = frame[6],
      uy = frame[7],
      uz = frame[8];
    const cx = stem.px[i] * scale,
      cy = stem.py[i] * scale,
      cz = stem.pz[i] * scale;
    const r = stem.r[i] * scale;
    const ringStart = builder.vertexCount;
    const cosT = RING_COS[sides],
      sinT = RING_SIN[sides];
    for (let j = 0; j < sides; j++) {
      const c = cosT[j],
        s = sinT[j];
      const sg = reverse ? -s : s;
      const nx = sx * c + ux * sg,
        ny = sy * c + uy * sg,
        nz = sz * c + uz * sg;
      const rr = jitter > 0 ? r * (1 + prng.signedRange(jitter)) : r;
      builder.addVertex(cx + nx * rr, cy + ny * rr, cz + nz * rr, nx, ny, nz);
    }
    if (prevRingStart >= 0) {
      for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        builder.indices.push3(prevRingStart + j, ringStart + j1, prevRingStart + j1);
        builder.indices.push3(prevRingStart + j, ringStart + j, ringStart + j1);
      }
    }
    prevRingStart = ringStart;
  }

  if (end === 'open' || prevRingStart < 0) return;
  const last = n - 1;
  const tip = builder.vertexCount;
  builder.addVertex(stem.px[last] * scale, stem.py[last] * scale, stem.pz[last] * scale, 0, 1, 0);
  for (let j = 0; j < sides; j++) {
    builder.indices.push3(prevRingStart + j, tip, prevRingStart + ((j + 1) % sides));
  }
}

/**
 * Wytłacza cienki pęd (L3+) jako 2-wierzchołkową wstęgę skręcaną naprzemiennie o ±45° w płaszczyźnie (sx, ux),
 * zakończoną pojedynczym wierzchołkiem szpica (`spike`). Naprzemienna faza ±45° daje 90° skręt normalnej
 * między kolejnymi pierścieniami bez przewężenia (bowtie) i utrzymuje witki czytelne pod każdym kątem w 3D.
 */
export function extrudeRibbonStem(
  stem: Stem,
  scale: number,
  jitter: number,
  prng: FastPrng,
  builder: MeshBufferBuilder,
  rings: readonly number[],
  stemIdx = 0,
  doubleFace = false,
  reverse = false
) {
  if (rings.length < 2) return;
  const ringCount = rings.length - 1;
  const flipSign = (stemIdx & 1) === 0 ? 1 : -1;
  const frame = new Float64Array(9);
  let hasSide = false;
  let prevRingStart = -1;

  for (let q = 0; q < ringCount; q++) {
    const i = rings[q];
    advanceTransportFrame(stem, rings, q, frame, hasSide);
    hasSide = true;
    const sx = frame[3],
      sy = frame[4],
      sz = frame[5],
      ux = frame[6],
      uy = frame[7],
      uz = frame[8];

    const phase = flipSign * ((q & 1) === 0 ? Math.PI * 0.25 : -Math.PI * 0.25);
    const cosP = Math.cos(phase);
    const sinP = Math.sin(phase);

    const rx = sx * cosP + ux * sinP;
    const ry = sy * cosP + uy * sinP;
    const rz = sz * cosP + uz * sinP;

    const nx = -sx * sinP + ux * cosP;
    const ny = -sy * sinP + uy * cosP;
    const nz = -sz * sinP + uz * cosP;

    const cx = stem.px[i] * scale;
    const cy = stem.py[i] * scale;
    const cz = stem.pz[i] * scale;
    const r = stem.r[i] * scale;

    const rr0 = jitter > 0 ? r * (1 + prng.signedRange(jitter)) : r;
    const rr1 = jitter > 0 ? r * (1 + prng.signedRange(jitter)) : r;

    const ringStart = builder.vertexCount;
    builder.addVertex(cx + rx * rr0, cy + ry * rr0, cz + rz * rr0, nx, ny, nz);
    builder.addVertex(cx - rx * rr1, cy - ry * rr1, cz - rz * rr1, nx, ny, nz);

    if (prevRingStart >= 0) {
      if (reverse) {
        builder.indices.push3(prevRingStart, prevRingStart + 1, ringStart + 1);
        builder.indices.push3(prevRingStart, ringStart + 1, ringStart);
      } else {
        builder.indices.push3(prevRingStart, ringStart + 1, prevRingStart + 1);
        builder.indices.push3(prevRingStart, ringStart, ringStart + 1);
      }
      if (doubleFace) {
        builder.indices.push3(prevRingStart, prevRingStart + 1, ringStart + 1);
        builder.indices.push3(prevRingStart, ringStart + 1, ringStart);
      }
    }
    prevRingStart = ringStart;
  }

  if (prevRingStart < 0) return;
  const last = rings[rings.length - 1];
  const tip = builder.vertexCount;
  builder.addVertex(stem.px[last] * scale, stem.py[last] * scale, stem.pz[last] * scale, 0, 1, 0);
  if (reverse) builder.indices.push3(prevRingStart, prevRingStart + 1, tip);
  else builder.indices.push3(prevRingStart, tip, prevRingStart + 1);
  if (doubleFace) {
    builder.indices.push3(prevRingStart, prevRingStart + 1, tip);
  }
}

function splitDir(
  dx: number,
  dy: number,
  dz: number,
  az: number,
  angle: number,
  out: [number, number, number]
) {
  let ax: number, ay: number, a2: number;
  if (Math.abs(dy) < 0.9) {
    ax = -dz;
    ay = 0;
    a2 = dx;
  } else {
    ax = 0;
    ay = dz;
    a2 = -dy;
  }
  const al = Math.hypot(ax, ay, a2) || 1;
  ax /= al;
  ay /= al;
  a2 /= al;
  const bx = dy * a2 - dz * ay,
    by = dz * ax - dx * a2,
    bz = dx * ay - dy * ax;
  const ca = Math.cos(az),
    sa = Math.sin(az),
    cd = Math.cos(angle),
    sd = Math.sin(angle);
  const x = dx * cd + (ax * ca + bx * sa) * sd;
  const y = dy * cd + (ay * ca + by * sa) * sd;
  const z = dz * cd + (a2 * ca + bz * sa) * sd;
  const l = Math.hypot(x, y, z) || 1;
  out[0] = x / l;
  out[1] = y / l;
  out[2] = z / l;
}

/**
 * Liście w stylu ilustracji architektonicznej (wzorzec SA_AI_Template): drobne, płaskie plamki
 * w kępkach wzdłuż zewnętrznej części najcieńszych pędów. Bez światła — głębię daje ton:
 * nisko i w głębi korony ciemny, wysoko i na obrzeżu jasny. Każdy ton to osobna grupa materiału.
 */
export function addLeaves(
  stems: Stem[],
  scale: number,
  profile: SpeciesProfile,
  prng: FastPrng,
  builder: MeshBufferBuilder,
  startIndex: number,
  leafSites?: number[],
  wind?: { strength: number; dirX?: number; dirZ?: number; time?: number }
) {
  const deepest = profile.levels.length;
  const aspect = profile.leafAspect ?? 0.55;
  const clump = profile.leafClump ?? 4;
  const density = profile.leafDensity ?? DEFAULT_LEAF_DENSITY;
  const L = profile.leafSizeRatio;
  const outline = profile.leafOutline?.length ? profile.leafOutline : LEAF_OUTLINES[profile.leafShape ?? 'hex'];
  const corners = outline.length / 2;
  const petioleLen = profile.petioleLengthRatio ?? 0.15;
  const petiolePliancy = profile.petiolePliancy ?? 0;
  const flatness = Math.max(0, Math.min(1, profile.leafFlatness ?? 0));

  const sites: number[] = [];
  let minY = Infinity,
    maxY = -Infinity,
    cx = 0,
    cz = 0;
  if (leafSites) {
    const keep = Math.min(1, density / DEFAULT_LEAF_DENSITY);
    for (let i = 0; i < leafSites.length; i += 6) {
      if (keep < 1 && prng.next() > keep) continue;
      for (let c = 0; c < 6; c++) sites.push(leafSites[i + c]);
      const x = leafSites[i],
        y = leafSites[i + 1],
        z = leafSites[i + 2];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      cx += x;
      cz += z;
    }
  }
  for (const s of leafSites ? [] : stems) {
    if (s.level < deepest - 1) continue;
    const n = s.px.length - 1;
    const count = Math.max(1, Math.round(s.length * density * (0.7 + prng.next() * 0.6)));
    for (let i = 0; i < count; i++) {
      const t = i === count - 1 ? 1 : 0.4 + 0.6 * prng.next();
      const f = t * n,
        k = Math.min(n - 1, Math.floor(f)),
        u = f - k;
      const x = s.px[k] + (s.px[k + 1] - s.px[k]) * u;
      const y = s.py[k] + (s.py[k + 1] - s.py[k]) * u;
      const z = s.pz[k] + (s.pz[k + 1] - s.pz[k]) * u;
      sites.push(
        x,
        y,
        z,
        s.px[k + 1] - s.px[k],
        s.py[k + 1] - s.py[k],
        s.pz[k + 1] - s.pz[k]
      );
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      cx += x;
      cz += z;
    }
  }
  const nSites = sites.length / 6;
  if (nSites === 0) return;
  cx /= nSites;
  cz /= nSites;
  let maxR = 1e-6;
  for (let i = 0; i < nSites; i++) {
    maxR = Math.max(maxR, Math.hypot(sites[i * 6] - cx, sites[i * 6 + 2] - cz));
  }

  const buckets: number[][] = [[], [], []];
  for (let i = 0; i < nSites; i++) {
    const hy = (sites[i * 6 + 1] - minY) / Math.max(1e-6, maxY - minY);
    const hr = Math.hypot(sites[i * 6] - cx, sites[i * 6 + 2] - cz) / maxR;
    const shade = 0.55 * hy + 0.45 * hr + prng.signedRange(0.22);
    buckets[shade > 0.62 ? 0 : shade > 0.36 ? 1 : 2].push(i);
  }

  const tmpVecA: [number, number, number] = [0, 0, 0];
  const tmpVecB: [number, number, number] = [0, 0, 0];

  let groupStart = startIndex;
  for (let b = 0; b < 3; b++) {
    for (const i of buckets[b]) {
      const sx = sites[i * 6],
        sy = sites[i * 6 + 1],
        sz = sites[i * 6 + 2];
      let tx = sites[i * 6 + 3],
        ty = sites[i * 6 + 4],
        tz = sites[i * 6 + 5];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const sitePrng = new FastPrng(((i + 1) * 0x9e3779b9) ^ 0x85ebca6b);
      const nLeaves = Math.max(1, Math.round(clump * (0.6 + sitePrng.next() * 0.8)));
      for (let q = 0; q < nLeaves; q++) {
        const size = L * (0.6 + sitePrng.next() * 0.8);
        splitDir(
          tx,
          ty,
          tz,
          sitePrng.range(0, Math.PI * 2),
          (25 + sitePrng.next() * 55 * (1 - flatness * 0.85)) * DEG,
          tmpVecA
        );
        const petioleLever = (0.35 + 2.8 * petioleLen) * petiolePliancy;
        if (petioleLever > 0) {
          tmpVecA[1] -= petioleLever * 1.6;
        }
        if (wind && wind.strength > 0) {
          const wdl = Math.hypot(wind.dirX ?? 1, wind.dirZ ?? 0) || 1;
          const wx = (wind.dirX ?? 1) / wdl;
          const wz = (wind.dirZ ?? 0) / wdl;
          const s = wind.strength;
          const petioleFlex = (0.3 + 1.8 * petiolePliancy) * (0.45 + 2.4 * petioleLen);
          const wSteady = s * (0.55 + 1.5 * petioleFlex);
          const phase = (wind.time ?? 0) * (2.4 + 3.2 * s) - (sx * wx + sz * wz) * 3.5 + i * 0.4 + q * 0.8;
          const wOsc = wind.time !== undefined
            ? (0.18 * s + 0.95 * s * s) * (0.4 + 1.5 * petioleFlex) * (Math.sin(phase) + 0.35 * Math.sin(phase * 2.1 + 0.7))
            : 0;
          const wAmt = wSteady + wOsc;
          tmpVecA[0] += wx * wAmt;
          tmpVecA[1] -= wAmt * 0.25;
          tmpVecA[2] += wz * wAmt;
        }
        if (petioleLever > 0 || (wind && wind.strength > 0)) {
          const al = Math.hypot(tmpVecA[0], tmpVecA[1], tmpVecA[2]) || 1;
          tmpVecA[0] /= al;
          tmpVecA[1] /= al;
          tmpVecA[2] /= al;
        }
        const [ax, ay, az] = tmpVecA;
        splitDir(ax, ay, az, sitePrng.range(0, Math.PI * 2), Math.PI / 2, tmpVecB);
        if (flatness > 0) {
          tmpVecB[1] *= 1 - flatness * 0.85;
          const dot = tmpVecB[0] * ax + tmpVecB[1] * ay + tmpVecB[2] * az;
          tmpVecB[0] -= dot * ax;
          tmpVecB[1] -= dot * ay;
          tmpVecB[2] -= dot * az;
          const bl = Math.hypot(tmpVecB[0], tmpVecB[1], tmpVecB[2]) || 1;
          tmpVecB[0] /= bl;
          tmpVecB[1] /= bl;
          tmpVecB[2] /= bl;
        }
        let [bx, by, bz] = tmpVecB;
        let nx = ay * bz - az * by,
          ny = az * bx - ax * bz,
          nz = ax * by - ay * bx;
        if (flatness > 0 && ny < 0) {
          bx = -bx;
          by = -by;
          bz = -bz;
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const ox = sx + ax * size * petioleLen,
          oy = sy + ay * size * petioleLen,
          oz = sz + az * size * petioleLen;
        const w = size * aspect * 0.5;
        const v0 = builder.vertexCount;
        for (let p = 0; p < corners; p++) {
          const along = outline[p * 2] * size,
            across = outline[p * 2 + 1] * w;
          builder.addVertex(
            (ox + ax * along + bx * across) * scale,
            (oy + ay * along + by * across) * scale,
            (oz + az * along + bz * across) * scale,
            nx,
            ny,
            nz
          );
        }
        for (let p = 1; p < corners - 1; p++) builder.indices.push3(v0, v0 + p, v0 + p + 1);
      }
    }
    builder.addGroup(groupStart, builder.indices.length - groupStart, b + 1);
    groupStart = builder.indices.length;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Degradacja geometryczna (LOD): szkielet i miejsca liści wspólne dla wszystkich poziomów, upraszcza się sama siatka.
// ---------------------------------------------------------------------------------------------------------------

/** Pięciokąt liścia (3 trójkąty) o polu sześciokąta `LEAF_HEX`: ta sama nasada i boki, koniec ścięty zamiast czubka */
const LEAF_PENTA = [0, 0, 0.3, 1.03, 0.9, 0.64, 0.9, -0.64, 0.3, -1.03] as const;
/** Latawiec liścia (2 trójkąty) o polu i długości sześciokąta `LEAF_HEX`, najszerszy tam, gdzie on */
const LEAF_QUAD = [0, 0, 0.42, 1.25, 1.05, 0, 0.42, -1.25] as const;
/** Trójkąt liścia (1 trójkąt) przyczepiony wierzchołkiem w (0, 0) */
const LEAF_TRI = [0, 0, 1.0, 1.0, 1.0, -1.0] as const;
const LEAF_OUTLINES = { hex: LEAF_HEX, penta: LEAF_PENTA, quad: LEAF_QUAD, tri: LEAF_TRI } as const;
type LeafShape = keyof typeof LEAF_OUTLINES;

/**
 * Wybór pierścieni tuby tolerancją cięciwy (Douglas–Peucker): punkt pędu zostaje, gdy odchyłka osi albo promienia
 * od odcinka między sąsiednimi wybranymi punktami przekracza `tol` (jednostki szkieletu). Zostają załamania
 * i zmiany grubości (odziomek), znikają pierścienie na prostych odcinkach. Zwraca indeksy rosnąco, z pierwszym i ostatnim.
 */
export function selectStemRings(stem: Stem, tol: number): number[] {
  const n = stem.px.length;
  if (n <= 2 || !(tol > 0)) {
    const all: number[] = [];
    for (let i = 0; i < n; i++) all.push(i);
    return all;
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop()!,
      a = stack.pop()!;
    if (b - a < 2) continue;
    const ax = stem.px[a],
      ay = stem.py[a],
      az = stem.pz[a];
    const dx = stem.px[b] - ax,
      dy = stem.py[b] - ay,
      dz = stem.pz[b] - az;
    const dd = dx * dx + dy * dy + dz * dz;
    let worst = -1,
      worstD = tol;
    for (let i = a + 1; i < b; i++) {
      const ex = stem.px[i] - ax,
        ey = stem.py[i] - ay,
        ez = stem.pz[i] - az;
      const t = dd > 0 ? Math.max(0, Math.min(1, (ex * dx + ey * dy + ez * dz) / dd)) : 0;
      const axis = Math.hypot(ex - dx * t, ey - dy * t, ez - dz * t);
      const radial = Math.abs(stem.r[i] - (stem.r[a] + (stem.r[b] - stem.r[a]) * t));
      const d = Math.max(axis, radial);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push(a, worst, worst, b);
  }
  const rings: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) rings.push(i);
  return rings;
}

/** Hash miejsca liścia (ziarno drzewa × indeks miejsca × sól) — niezależny od kolejności losowań siatki */
export function leafSiteHash(seed: number, index: number, salt = 0): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Miejsca liści drzewa wspólne dla wszystkich poziomów LOD: położenia, ton i kolejność wyboru */
export interface LeafSiteField {
  /** 6 liczb na miejsce: x, y, z, kierunek dx, dy, dz (jednostki szkieletu) */
  sites: number[];
  count: number;
  /** Kubełek tonu miejsca: 0 = jasny (wysoko, na obrzeżu), 1 = pośredni, 2 = ciemny (nisko, w głębi) */
  tone: Uint8Array;
  /** Ciągła jasność miejsca (wysokość i odległość od osi korony plus szum), z której powstaje kubełek tonu */
  shade: Float32Array;
  /**
   * Indeksy miejsc w kolejności wyboru — poziom bierze początek tej listy, więc far ⊂ mid ⊂ near.
   * Kolejność jest warstwowana: korona podzielona na piętra × sektory, z każdej komórki po jednym miejscu na obieg
   * (najpierw miejsca zewnętrzne) — krótki początek listy pokrywa całą bryłę równomiernie, bez łysych pięter.
   */
  order: Uint32Array;
  /** Ułamek miejsc wynikający z gęstości profilu (tylko miejsca ze wzrostu ez-tree; inaczej 1) */
  baseKeep: number;
  minY: number;
  maxY: number;
  cx: number;
  cz: number;
  maxR: number;
  /** Promień korony: wysoki percentyl odległości miejsc od osi (bez pojedynczych odstających pędów) */
  crownR: number;
}

/** Piętra × sektory warstwowania kolejności wyboru miejsc */
const ORDER_BANDS = 6;
const ORDER_SECTORS = 8;
/** Udział losu w kolejności miejsc komórki (reszta: odległość od osi — zewnętrzne pierwsze) */
const ORDER_RANDOM = 1.0;

/**
 * Miejsca liści dla poziomów LOD. Własny strumień losowy z ziarna drzewa (nie strumień kory), ton miejsca z hasha
 * jego indeksu — to samo miejsce ma to samo położenie i ten sam ton na każdym poziomie.
 */
export function collectLeafSites(
  stems: readonly Stem[],
  profile: SpeciesProfile,
  seed: number,
  leafSites?: readonly number[]
): LeafSiteField {
  const deepest = profile.levels.length;
  const density = profile.leafDensity ?? DEFAULT_LEAF_DENSITY;
  const sites: number[] = [];
  let baseKeep = 1;
  if (leafSites) {
    baseKeep = Math.min(1, density / DEFAULT_LEAF_DENSITY);
    for (let i = 0; i + 5 < leafSites.length; i += 6) for (let c = 0; c < 6; c++) sites.push(leafSites[i + c]);
  } else {
    const prng = new FastPrng(seed ^ 0x51ed270b);
    for (const s of stems) {
      if (s.level < deepest - 1) continue;
      const n = s.px.length - 1;
      const count = Math.max(1, Math.round(s.length * density * (0.7 + prng.next() * 0.6)));
      for (let i = 0; i < count; i++) {
        const t = i === count - 1 ? 1 : 0.4 + 0.6 * prng.next();
        const f = t * n,
          k = Math.min(n - 1, Math.floor(f)),
          u = f - k;
        sites.push(
          s.px[k] + (s.px[k + 1] - s.px[k]) * u,
          s.py[k] + (s.py[k + 1] - s.py[k]) * u,
          s.pz[k] + (s.pz[k + 1] - s.pz[k]) * u,
          s.px[k + 1] - s.px[k],
          s.py[k + 1] - s.py[k],
          s.pz[k + 1] - s.pz[k]
        );
      }
    }
  }
  const count = sites.length / 6;
  let minY = Infinity,
    maxY = -Infinity,
    cx = 0,
    cz = 0;
  for (let i = 0; i < count; i++) {
    const y = sites[i * 6 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    cx += sites[i * 6];
    cz += sites[i * 6 + 2];
  }
  if (count > 0) {
    cx /= count;
    cz /= count;
  } else {
    minY = maxY = 0;
  }
  let maxR = 1e-6;
  const dist = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    dist[i] = Math.hypot(sites[i * 6] - cx, sites[i * 6 + 2] - cz);
    maxR = Math.max(maxR, dist[i]);
  }
  const sortedDist = Array.from(dist).sort((a, b) => a - b);
  const crownR = count > 0 ? Math.max(1e-6, sortedDist[Math.min(count - 1, Math.floor(count * 0.9))]) : 1e-6;

  const tone = new Uint8Array(count);
  const shades = new Float32Array(count);
  const score = new Float64Array(count);
  const cells: number[][] = [];
  for (let c = 0; c < ORDER_BANDS * ORDER_SECTORS; c++) cells.push([]);
  const spanY = Math.max(1e-6, maxY - minY);
  for (let i = 0; i < count; i++) {
    const hy = (sites[i * 6 + 1] - minY) / spanY;
    const hr = dist[i] / maxR;
    const noise = (leafSiteHash(seed, i, 1) / 4294967296) * 2 - 1;
    const shade = 0.55 * hy + 0.45 * hr + noise * 0.22;
    shades[i] = shade;
    tone[i] = shade > 0.62 ? 0 : shade > 0.36 ? 1 : 2;
    score[i] = hr + ORDER_RANDOM * (leafSiteHash(seed, i, 0) / 4294967296);
    const band = Math.min(ORDER_BANDS - 1, Math.floor(hy * ORDER_BANDS));
    const az = Math.atan2(sites[i * 6 + 2] - cz, sites[i * 6] - cx) / (Math.PI * 2) + 0.5;
    const sector = Math.min(ORDER_SECTORS - 1, Math.floor(az * ORDER_SECTORS));
    cells[band * ORDER_SECTORS + sector].push(i);
  }
  for (const cell of cells) cell.sort((a, b) => score[b] - score[a] || a - b);
  const cellOrder = cells.map((_, c) => c).sort((a, b) => leafSiteHash(seed, a, 3) - leafSiteHash(seed, b, 3) || a - b);
  const order = new Uint32Array(count);
  let filled = 0;
  for (let round = 0; filled < count; round++) {
    for (const c of cellOrder) if (round < cells[c].length) order[filled++] = cells[c][round];
  }
  return { sites, count, tone, shade: shades, order, baseKeep, minY, maxY, cx, cz, maxR, crownR };
}

/** Zasięg korony w siatce walcowej: piętra × sektory, w komórce percentyl odległości miejsc liści od osi korony */
export interface CrownReach {
  bands: number;
  sectors: number;
  /** Promień komórki [piętro × sectors + sektor] (jednostki szkieletu) */
  r: Float64Array;
  /** Średnia jasność miejsc komórki (`shade`) */
  light: Float64Array;
}

/**
 * Zasięg chmury liści wokół pionowej osi korony. Komórki bez miejsc (prześwit w koronie) biorą średnią z sąsiadów,
 * więc bryła zbudowana z zasięgu jest zamknięta; przekrój idzie za miejscami w obu osiach (nie jest elipsą).
 */
export function crownReach(field: LeafSiteField, bands: number, sectors: number, percentile: number): CrownReach {
  const n = bands * sectors;
  const lists: number[][] = [];
  for (let i = 0; i < n; i++) lists.push([]);
  const lightSum = new Float64Array(n);
  const spanY = Math.max(1e-6, field.maxY - field.minY);
  for (let i = 0; i < field.count; i++) {
    const x = field.sites[i * 6] - field.cx,
      z = field.sites[i * 6 + 2] - field.cz;
    const band = Math.min(bands - 1, Math.floor(((field.sites[i * 6 + 1] - field.minY) / spanY) * bands));
    const sector = Math.min(sectors - 1, Math.floor((Math.atan2(z, x) / (Math.PI * 2) + 0.5) * sectors));
    lists[band * sectors + sector].push(Math.hypot(x, z));
    lightSum[band * sectors + sector] += field.shade[i];
  }
  const r = new Float64Array(n).fill(-1);
  const light = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = lists[i];
    if (a.length === 0) continue;
    a.sort((p, q) => p - q);
    r[i] = a[Math.min(a.length - 1, Math.floor(a.length * percentile))];
    light[i] = lightSum[i] / a.length;
  }
  for (let pass = 0; pass < bands + sectors; pass++) {
    let missing = 0;
    const next = r.slice();
    for (let i = 0; i < n; i++) {
      if (r[i] >= 0) continue;
      const band = Math.floor(i / sectors),
        sector = i % sectors;
      const around = [band * sectors + ((sector + 1) % sectors), band * sectors + ((sector + sectors - 1) % sectors)];
      if (band > 0) around.push((band - 1) * sectors + sector);
      if (band < bands - 1) around.push((band + 1) * sectors + sector);
      let sum = 0,
        lsum = 0,
        k = 0;
      for (const j of around) {
        if (r[j] < 0) continue;
        sum += r[j];
        lsum += light[j];
        k++;
      }
      if (k > 0) {
        next[i] = sum / k;
        light[i] = lsum / k;
      } else missing++;
    }
    r.set(next);
    if (missing === 0) break;
  }
  for (let i = 0; i < n; i++) if (r[i] < 0) r[i] = field.crownR;
  return { bands, sectors, r, light };
}

/** Wybór miejsc liści poziomu: ile pierwszych miejsc z `field.order`, liści w kępce i mnożnik długości liścia */
export interface LeafSiteSelection {
  /** Liczba miejsc poziomu — pierwsze `count` pozycji `field.order` */
  count: number;
  /** Liści w kępce (średnio) */
  clump: number;
  /** Mnożnik długości liścia: kompensacja pola (mniej liści = większe) × `leafSizeScale` */
  sizeScale: number;
  /** Poziom z powiększeniem: liść przesuwany ku wnętrzu, żeby nie wystawał poza chmurę liści poziomu bliskiego */
  enlarged: boolean;
}

/**
 * Poziom bez żadnej redukcji liści (wszystkie miejsca, ta sama kępka i wielkość, sześciokąt, bez bryły korony):
 * jego liście buduje ta sama ścieżka co oryginał (`addLeaves`), nie `addLeavesLod`.
 */
export function isFullLeafLod(lod: TreeMeshLod): boolean {
  return (
    !lod.crownShell &&
    (lod.leafShape ?? 'hex') === 'hex' &&
    lod.maxLeaves === undefined &&
    (lod.leafKeep ?? 1) === 1 &&
    (lod.leafClumpScale ?? 1) === 1 &&
    (lod.leafSizeScale ?? 1) === 1
  );
}

/** Pułap powiększenia liścia względem liścia profilu: poziomy dalsze zachowują kształt (żadnych kolców) */
export const MAX_LEAF_SIZE_SCALE = 1.5;

/**
 * Pułap powiększenia dla poziomów z twardym budżetem `maxLeaves`: budżet wygrywa z pokryciem, a większe liście
 * oddają część pola (wydłużenie nadal ograniczone `ENLARGED_MAX_LENGTH_SCALE`, dalej liść tylko szerzeje).
 */
export const MAX_LEAF_SIZE_SCALE_BUDGET = 2;

/** Od tego powiększenia liść jest pilnowany przed wystawaniem (przesuwany ku wnętrzu korony) */
const ENLARGED_FROM_SCALE = 1.15;

/** Najwyżej tyle razy wydłuża się powiększony liść; dalszy przyrost pola to szerokość (liść nie robi się kolcem) */
const ENLARGED_MAX_LENGTH_SCALE = 1.15;

/** Rozrzut kąta liści kępki powiększonej (stopnie) i odstęp liści wzdłuż pędu (ułamek długości liścia) */
const CLUMP_SPREAD_DEG = 14;
const CLUMP_STEP = 0.55;

/**
 * Ile miejsc liści bierze poziom i o ile rośnie liść, żeby pokryta powierzchnia korony była stała:
 * pole ∝ miejsca × liści w kępce × długość², więc długość rośnie o 1/√(ułamek miejsc × ułamek kępki).
 * Pułap `maxLeaves` zmniejsza najpierw kępkę (więcej miejsc po jednym liściu pokrywa bryłę równiej niż mniej kępek).
 */
export function selectLeafSites(
  field: LeafSiteField,
  profile: SpeciesProfile,
  lod: TreeMeshLod
): LeafSiteSelection {
  const baseClump = profile.leafClump ?? 4;
  let clump = Math.max(1, Math.round(baseClump * (lod.leafClumpScale ?? 1)));
  const full = field.count * field.baseKeep;
  let count = Math.round(full * Math.max(0, Math.min(1, lod.leafKeep ?? 1)));
  if (lod.maxLeaves !== undefined && count * clump > lod.maxLeaves && lod.crownShell) {
    count = Math.min(count, Math.max(1, Math.floor(lod.maxLeaves)));
    clump = Math.max(1, Math.floor(lod.maxLeaves / count));
  } else if (lod.maxLeaves !== undefined && count * clump > lod.maxLeaves) {
    // Najpierw mniej miejsc, kępka zostaje ≥ 2 (zwykle ok. 3, nie więcej niż kępka profilu): pojedyncze duże liście
    // wystawałyby promieniście z korony jak kolce
    clump = Math.max(1, Math.min(clump, Math.max(Math.min(2, baseClump), Math.min(3, baseClump))));
    count = Math.min(count, Math.max(1, Math.floor(lod.maxLeaves / clump)));
  }
  count = Math.max(field.count > 0 ? 1 : 0, Math.min(field.count, count));
  const leafScale = lod.leafSizeScale ?? 1;
  const share = (c: number, k: number) => (c / Math.max(1, full)) * (k / Math.max(1, baseClump));
  // Pułap powiększenia: zamiast powiększać liść ponad MAX_LEAF_SIZE_SCALE zostawiamy więcej miejsc, potem większą kępkę.
  // Bryła korony (crownShell) ma własną, małą liczbę płatów — tam pułap tylko obcina powiększenie.
  const sizeCap = lod.maxLeaves !== undefined && !lod.crownShell ? MAX_LEAF_SIZE_SCALE_BUDGET : MAX_LEAF_SIZE_SCALE;
  if (!lod.crownShell && leafScale / Math.sqrt(Math.max(1e-6, share(count, clump))) > sizeCap) {
    const need = (leafScale / sizeCap) ** 2 * Math.max(0, Math.min(1, lod.leafCoverage ?? 1));
    count = Math.max(count, Math.min(field.count, Math.ceil((need * Math.max(1, full) * Math.max(1, baseClump)) / clump)));
    if (share(count, clump) < need) {
      clump = Math.min(baseClump, Math.max(clump, Math.ceil((need * Math.max(1, full) * Math.max(1, baseClump)) / Math.max(1, count))));
    }
  }
  // Twardy budżet i nigdy więcej miejsc niż poziom bliski (dobór pokrycia może sięgnąć po miejsca spoza `baseKeep`)
  if (lod.maxLeaves !== undefined && !lod.crownShell) count = Math.min(count, Math.max(1, Math.round(full)));
  if (lod.maxLeaves !== undefined && !lod.crownShell && count * clump > lod.maxLeaves) {
    count = Math.max(1, Math.min(count, Math.floor(lod.maxLeaves / clump)));
    if (count * clump > lod.maxLeaves) clump = Math.max(1, Math.floor(lod.maxLeaves / count));
  }
  const areaShare = share(count, clump);
  const sizeScale = Math.min(sizeCap, leafScale / Math.sqrt(Math.max(1e-6, areaShare)));
  return { count, clump, sizeScale, enlarged: sizeScale > ENLARGED_FROM_SCALE };
}

/**
 * Przesunięcie progów tonu na poziomach z powiększeniem (na każde podwojenie długości liścia, najwyżej dwa): mało dużych
 * liści odsłania mniej ciemnego wnętrza korony niż chmura drobnych, więc bez korekty masa korony jaśnieje.
 */
const ENLARGED_TONE_SHIFT = 0.009;

/** Piętra × sektory zasięgu, w którym mają się mieścić powiększone liście, i jego percentyl */
const CLAMP_BANDS = 8;
const CLAMP_SECTORS = 12;
const CLAMP_PERCENTILE = 0.95;
/** Zapas zasięgu: liść profilu sięga poza swoje miejsce (ułamek długości liścia profilu) */
const CLAMP_MARGIN = 1.15;

/** Ograniczenia powiększonego liścia */
interface LeafLimits {
  /** Największa długość liścia (jednostki szkieletu); Infinity = bez ograniczenia */
  maxLength: number;
}

/**
 * Liście poziomu LOD: miejsca wybrane z wspólnej listy (zagnieżdżone), liść o zadanej liczbie trójkątów i polu
 * powiększonym tak, by masa barwna korony się nie zmieniła. Losowość liścia pochodzi z hasha miejsca.
 *
 * Liść poziomu dalszego to powiększony liść poziomu bliskiego: ten sam obrys (`leafShape`), ta sama procedura
 * losowania kierunku co w `addLeaves` (oś 25–80° od kierunku pędu, losowy obrót wokół osi) — więc ten sam rozkład
 * normalnych, a z nim to samo oświetlenie korony. Środek powiększonego liścia zostaje tam, gdzie środek liścia profilu,
 * a gdy liść wyszedłby poza zasięg chmury liści poziomu bliskiego w swoim piętrze i sektorze, cały przesuwa się ku
 * osi korony (bez zmiany kształtu i orientacji). Wąski liść (igła) przy powiększaniu szerzeje.
 */
export function addLeavesLod(
  field: LeafSiteField,
  scale: number,
  profile: SpeciesProfile,
  seed: number,
  builder: MeshBufferBuilder,
  startIndex: number,
  lod: TreeMeshLod
) {
  if (field.count === 0) return;
  const sel = selectLeafSites(field, profile, lod);
  const emit = leafEmitter(field, scale, profile, seed, builder, sel, lod.leafShape ?? 'hex', {
    maxLength: 2 * (field.crownR + profile.leafSizeRatio),
  });
  let groupStart = startIndex;
  for (let b = 0; b < 3; b++) {
    emit(b);
    builder.addGroup(groupStart, builder.indices.length - groupStart, b + 1);
    groupStart = builder.indices.length;
  }
}

/** Zwraca funkcję wstawiającą liście jednego tonu (grupy materiałów muszą być ciągłe) */
function leafEmitter(
  field: LeafSiteField,
  scale: number,
  profile: SpeciesProfile,
  seed: number,
  builder: MeshBufferBuilder,
  sel: LeafSiteSelection,
  shape: LeafShape,
  limits: LeafLimits
): (toneIndex: number) => void {
  const { sites, order, cx, cz, minY, maxY } = field;
  const toneShift = sel.enlarged ? ENLARGED_TONE_SHIFT * Math.min(2, Math.log2(sel.sizeScale)) : 0;
  let tone = field.tone;
  if (toneShift > 0) {
    tone = new Uint8Array(field.count);
    for (let i = 0; i < field.count; i++) {
      const shade = field.shade[i] - toneShift;
      tone[i] = shade > 0.62 ? 0 : shade > 0.36 ? 1 : 2;
    }
  }
  const outline = profile.leafOutline?.length ? profile.leafOutline : LEAF_OUTLINES[profile.leafShape ?? shape];
  const corners = outline.length / 2;
  const petioleLen = profile.petioleLengthRatio ?? 0.15;
  const petiolePliancy = profile.petiolePliancy ?? 0;
  const flatness = Math.max(0, Math.min(1, profile.leafFlatness ?? 0));
  const enlarged = sel.enlarged;
  const baseAspect = profile.leafAspect ?? 0.55;
  // Powiększony liść wydłuża się najwyżej ENLARGED_MAX_LENGTH_SCALE×, resztę pola (stałe pokrycie korony) bierze szerokość
  // (gdy szerokość dobiłaby do sufitu proporcji 1, długość rośnie tyle, ile trzeba do zachowania pola)
  const lenScale = enlarged
    ? Math.min(sel.sizeScale, Math.max(ENLARGED_MAX_LENGTH_SCALE, sel.sizeScale * Math.sqrt(baseAspect)))
    : sel.sizeScale;
  const aspect = enlarged ? Math.min(1, baseAspect * (sel.sizeScale / lenScale) ** 2) : baseAspect;
  const L = profile.leafSizeRatio * lenScale;
  // Środek powiększonego liścia tam, gdzie środek liścia profilu (nasada 0,15 + środek 0,52 długości)
  const rootShift = enlarged ? 0.67 / lenScale - 0.52 : 0.15;
  const spreadLo = enlarged ? 0.85 : 0.6,
    spreadSpan = enlarged ? 0.3 : 0.8;
  const tiltSpan = enlarged ? 30 : 55;
  const reach = enlarged ? crownReach(field, CLAMP_BANDS, CLAMP_SECTORS, CLAMP_PERCENTILE) : null;
  const margin = profile.leafSizeRatio * CLAMP_MARGIN;
  const spanY = Math.max(1e-6, maxY - minY);
  const tmpVecA: [number, number, number] = [0, 0, 0];
  const tmpVecB: [number, number, number] = [0, 0, 0];
  const baseA: [number, number, number] = [0, 0, 0];
  let baseRoll = 0;
  const vx = new Float64Array(corners),
    vy = new Float64Array(corners),
    vz = new Float64Array(corners);

  return (toneIndex: number) => {
    for (let k = 0; k < sel.count; k++) {
      const i = order[k];
      if (tone[i] !== toneIndex) continue;
      const prng = new FastPrng(leafSiteHash(seed, i, 2));
      const sx = sites[i * 6],
        sy = sites[i * 6 + 1],
        sz = sites[i * 6 + 2];
      let tx = sites[i * 6 + 3],
        ty = sites[i * 6 + 4],
        tz = sites[i * 6 + 5];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const nLeaves = Math.max(1, Math.round(sel.clump * (0.6 + prng.next() * 0.8)));
      if (enlarged) {
        splitDir(tx, ty, tz, prng.range(0, Math.PI * 2), (25 + prng.next() * tiltSpan * (1 - flatness * 0.85)) * DEG, baseA);
        baseRoll = prng.range(0, Math.PI * 2);
      }
      for (let q = 0; q < nLeaves; q++) {
        const size = Math.min(limits.maxLength, L * (spreadLo + prng.next() * spreadSpan));
        if (enlarged) {
          // Kępka powiększonych liści: wspólna oś z małym rozrzutem kąta i wspólny obrót, liście kolejno wzdłuż pędu
          // (zwarta masa jak w oryginale, nie rozetka wokół jednej nasady)
          splitDir(baseA[0], baseA[1], baseA[2], prng.range(0, Math.PI * 2), prng.next() * CLUMP_SPREAD_DEG * (1 - flatness * 0.85) * DEG, tmpVecA);
          splitDir(tmpVecA[0], tmpVecA[1], tmpVecA[2], baseRoll + (prng.next() - 0.5) * 0.8 * (1 - flatness * 0.85), Math.PI / 2, tmpVecB);
        } else {
          splitDir(tx, ty, tz, prng.range(0, Math.PI * 2), (25 + prng.next() * tiltSpan * (1 - flatness * 0.85)) * DEG, tmpVecA);
          splitDir(tmpVecA[0], tmpVecA[1], tmpVecA[2], prng.range(0, Math.PI * 2), Math.PI / 2, tmpVecB);
        }
        if (petiolePliancy > 0) {
          tmpVecA[1] -= petiolePliancy * 0.9;
          const al = Math.hypot(tmpVecA[0], tmpVecA[1], tmpVecA[2]) || 1;
          tmpVecA[0] /= al;
          tmpVecA[1] /= al;
          tmpVecA[2] /= al;
          splitDir(tmpVecA[0], tmpVecA[1], tmpVecA[2], prng.range(0, Math.PI * 2), Math.PI / 2, tmpVecB);
        }
        const [ax, ay, az] = tmpVecA;
        if (flatness > 0) {
          tmpVecB[1] *= 1 - flatness * 0.85;
          const dot = tmpVecB[0] * ax + tmpVecB[1] * ay + tmpVecB[2] * az;
          tmpVecB[0] -= dot * ax;
          tmpVecB[1] -= dot * ay;
          tmpVecB[2] -= dot * az;
          const bl = Math.hypot(tmpVecB[0], tmpVecB[1], tmpVecB[2]) || 1;
          tmpVecB[0] /= bl;
          tmpVecB[1] /= bl;
          tmpVecB[2] /= bl;
        }
        let [bx, by, bz] = tmpVecB;
        let nx = ay * bz - az * by,
          ny = az * bx - ax * bz,
          nz = ax * by - ay * bx;
        if (flatness > 0 && ny < 0) {
          bx = -bx;
          by = -by;
          bz = -bz;
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const along0 = enlarged ? (q - (nLeaves - 1) / 2) * size * CLUMP_STEP : 0;
        const ox = sx + ax * size * (enlarged ? rootShift : petioleLen) + tx * along0,
          oy = sy + ay * size * (enlarged ? rootShift : petioleLen) + ty * along0,
          oz = sz + az * size * (enlarged ? rootShift : petioleLen) + tz * along0;
        const w = size * aspect * 0.5;
        let far = 0,
          farX = 0,
          farZ = 0,
          top = -Infinity,
          bottom = Infinity;
        for (let p = 0; p < corners; p++) {
          const along = outline[p * 2] * size,
            across = outline[p * 2 + 1] * w;
          const x = ox + ax * along + bx * across,
            y = oy + ay * along + by * across,
            z = oz + az * along + bz * across;
          vx[p] = x;
          vy[p] = y;
          vz[p] = z;
          if (!reach) continue;
          if (y > top) top = y;
          if (y < bottom) bottom = y;
          const hx = x - cx,
            hz = z - cz;
          const hd = Math.hypot(hx, hz);
          const band = Math.max(0, Math.min(reach.bands - 1, Math.floor(((y - minY) / spanY) * reach.bands)));
          const sector = Math.min(
            reach.sectors - 1,
            Math.floor((Math.atan2(hz, hx) / (Math.PI * 2) + 0.5) * reach.sectors)
          );
          const over = hd - (reach.r[band * reach.sectors + sector] + margin);
          if (over > far && hd > 1e-9) {
            far = over;
            farX = hx / hd;
            farZ = hz / hd;
          }
        }
        // Przesunięcie całego liścia: poziomo ku osi o największe wystawanie, pionowo do wysokości chmury liści
        let dx = 0,
          dy = 0,
          dz = 0;
        if (reach) {
          dx = -farX * far;
          dz = -farZ * far;
          if (top > maxY + margin) dy = maxY + margin - top;
          else if (bottom < minY - margin) dy = minY - margin - bottom;
        }
        const v0 = builder.vertexCount;
        for (let p = 0; p < corners; p++) {
          builder.addVertex((vx[p] + dx) * scale, (vy[p] + dy) * scale, (vz[p] + dz) * scale, nx, ny, nz);
        }
        for (let p = 1; p < corners - 1; p++) builder.indices.push3(v0, v0 + p, v0 + p + 1);
      }
    }
  };
}

/** Amplituda szumu promienia otoczki (tylko na zewnątrz) i jasności jej ścian (z ziarna drzewa) */
const SHELL_NOISE = 0.05;
const SHELL_TONE_NOISE = 0.16;
/** Udział normalnej geometrycznej w normalnej cieniowania ściany (reszta: losowa, jak u liści) */
const SHELL_NORMAL_OUTWARD = 0.25;
/** Przesunięcie tonów ku ciemnym (ułamek pola): pełna bryła nie ma cienia własnego chmury liści */
const SHELL_TONE_DARKEN = 0.15;
/** Największa długość liścia bryły korony względem promienia korony */
const SHELL_LEAF_MAX_LENGTH = 0.9;
/** Zapas otoczki za miejscem liścia (ułamek długości liścia) i za punktem gałęzi */
const SHELL_LEAF_MARGIN = 0.5;
const SHELL_BRANCH_MARGIN = 0.15;
/** Najmniejszy promień sąsiada względem średniej sąsiadów (wygładzanie kolców i dziur) */
const SHELL_SMOOTH = 0.85;
/** Percentyl punktów w stożku kierunku wyznaczający promień (reszta — pojedyncze witki — może wystawać) */
export const SHELL_PERCENTILE = 0.93;
/** Percentyl wysokości miejsc liści wyznaczający podstawę korony (poniżej bryła jest ścięta i zaokrąglona) */
export const SHELL_BASE_PERCENTILE = 0.05;
/** Miękkość ścięcia spodu: ułamek wysokości bryły, o który spód może zejść poniżej podstawy korony */
const SHELL_BASE_SOFT = 0.06;
/** Największy promień wierzchołka bieguna względem średniej pierwszego pasa (zaokrąglony wierzchołek, bez szpica) */
const SHELL_POLE = 0.88;
/** Rozdzielenie skupisk: odległość środków / suma promieni rms; poniżej — skupiska zlewają się w jedną bryłę */
export const SHELL_BLOB_SEPARATION = 1.1;
/** Najmniejszy stosunek szerokości do wysokości chmury punktów, przy którym korona może się podzielić */
const SHELL_BLOB_MIN_ASPECT = 0.5;
/** Waga osi pionowej przy szukaniu skupisk */
const SHELL_BLOB_VERTICAL = 0.25;
/** Najmniejszy udział punktów skupiska i domyślna największa liczba brył */
const SHELL_BLOB_MIN_SHARE = 0.08;
export const SHELL_MAX_BLOBS = 3;
/** Pułap trójkątów otoczki wielobryłowej */
const SHELL_MAX_TRIANGLES = 200;

/** Deterministyczne k-średnich (start: najdalsze punkty); zwraca przypisanie albo null, gdy skupiska nie są rozdzielone */
function splitShellPoints(P0: Float64Array, n: number, k: number): Int32Array | null {
  // Skupiska szukane głównie poziomo: oś pionowa osłabiona, by smukłe i stożkowe korony nie dzieliły się na piętra
  const P = new Float64Array(P0);
  for (let i = 0; i < n; i++) P[i * 3 + 1] *= SHELL_BLOB_VERTICAL;
  const step = Math.max(1, Math.floor(n / 1200));
  const sample: number[] = [];
  for (let i = 0; i < n; i += step) sample.push(i);
  if (sample.length < k * 4) return null;
  // Korony kolumnowe (szerokość < połowy wysokości) nie dzielą się na bryły obok siebie
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const i of sample) {
    x0 = Math.min(x0, P0[i * 3]); x1 = Math.max(x1, P0[i * 3]);
    y0 = Math.min(y0, P0[i * 3 + 1]); y1 = Math.max(y1, P0[i * 3 + 1]);
    z0 = Math.min(z0, P0[i * 3 + 2]); z1 = Math.max(z1, P0[i * 3 + 2]);
  }
  if (Math.max(x1 - x0, z1 - z0) < SHELL_BLOB_MIN_ASPECT * (y1 - y0)) return null;
  let mx = 0, my = 0, mz = 0;
  for (const i of sample) { mx += P[i * 3]; my += P[i * 3 + 1]; mz += P[i * 3 + 2]; }
  mx /= sample.length; my /= sample.length; mz /= sample.length;
  const C: number[][] = [];
  let far = sample[0], fd = -1;
  for (const i of sample) {
    const d = (P[i * 3] - mx) ** 2 + (P[i * 3 + 1] - my) ** 2 + (P[i * 3 + 2] - mz) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  C.push([P[far * 3], P[far * 3 + 1], P[far * 3 + 2]]);
  while (C.length < k) {
    let bi = sample[0], bd = -1;
    for (const i of sample) {
      let md = Infinity;
      for (const c of C) md = Math.min(md, (P[i * 3] - c[0]) ** 2 + (P[i * 3 + 1] - c[1]) ** 2 + (P[i * 3 + 2] - c[2]) ** 2);
      if (md > bd) { bd = md; bi = i; }
    }
    C.push([P[bi * 3], P[bi * 3 + 1], P[bi * 3 + 2]]);
  }
  const label = (i: number) => {
    let b = 0, bd = Infinity;
    for (let c = 0; c < k; c++) {
      const d = (P[i * 3] - C[c][0]) ** 2 + (P[i * 3 + 1] - C[c][1]) ** 2 + (P[i * 3 + 2] - C[c][2]) ** 2;
      if (d < bd) { bd = d; b = c; }
    }
    return b;
  };
  for (let it = 0; it < 12; it++) {
    const sum = C.map(() => [0, 0, 0, 0]);
    for (const i of sample) {
      const c = label(i);
      sum[c][0] += P[i * 3]; sum[c][1] += P[i * 3 + 1]; sum[c][2] += P[i * 3 + 2]; sum[c][3]++;
    }
    for (let c = 0; c < k; c++) if (sum[c][3] > 0) C[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  const cnt = new Float64Array(k), rr = new Float64Array(k);
  for (const i of sample) {
    const c = label(i);
    cnt[c]++;
    rr[c] += (P[i * 3] - C[c][0]) ** 2 + (P[i * 3 + 1] - C[c][1]) ** 2 + (P[i * 3 + 2] - C[c][2]) ** 2;
  }
  for (let c = 0; c < k; c++) {
    if (cnt[c] < SHELL_BLOB_MIN_SHARE * sample.length) return null;
    rr[c] = Math.sqrt(rr[c] / cnt[c]);
  }
  for (let a = 0; a < k; a++) {
    let nearest = Infinity;
    for (let b = 0; b < k; b++) {
      if (a === b) continue;
      const d = Math.hypot(C[a][0] - C[b][0], C[a][1] - C[b][1], C[a][2] - C[b][2]);
      nearest = Math.min(nearest, d / (rr[a] + rr[b] + 1e-9));
    }
    if (nearest < SHELL_BLOB_SEPARATION) return null;
  }
  const assign = new Int32Array(n);
  for (let i = 0; i < n; i++) assign[i] = label(i);
  return assign;
}

interface ShellHull {
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  faces: number[];
  light: Float64Array;
}

const quantile = (v: number[], q: number) => {
  if (v.length === 0) return -1;
  v.sort((a, b) => a - b);
  return v.length < 5 ? v[v.length - 1] : v[Math.min(v.length - 1, Math.floor(q * (v.length - 1) + 0.5))];
};

/**
 * Bryła korony (otoczka) zamiast liści: nieregularne, zamknięte bryły gwiaździste wokół środków skupisk korony.
 * Punkty: miejsca liści i punkty gałęzi rzędów 1..N (`branchPoints`, xyz w jednostkach szkieletu; witki automatyczne
 * N+1 pomija wywołujący). Otoczka nie mieści wszystkiego: promień kierunku to wysoki percentyl (`SHELL_PERCENTILE`)
 * punktów w jego stożku, więc pojedyncze witki mogą wystawać. Spód jest ścięty na podstawie korony (percentyl
 * `SHELL_BASE_PERCENTILE` wysokości liści) i zaokrąglony — pień pozostaje widoczny; biegun górny zaokrąglony.
 *
 * Gdy punkty dzielą się na rozdzielone skupiska (k-średnich, k ≤ `shell.maxBlobs`, domyślnie `SHELL_MAX_BLOBS`;
 * kryterium `SHELL_BLOB_SEPARATION`) powstaje kilka mniejszych brył (łącznie ≤ `SHELL_MAX_TRIANGLES` trójkątów);
 * `maxBlobs` = 1 daje jedną bryłę. Każda bryła: `rings` pasów szerokości × `sides` sektorów (bieguny pionowo), promienie
 * wygładzone (sąsiad ≥ 0,85 średniej sąsiadów), puste kierunki uzupełnione z sąsiadów, szum z ziarna tylko na zewnątrz.
 * Ściany mają własne wierzchołki; normalna cieniowania to mieszanka normalnej ściany i losowego kierunku. Ton ściany:
 * ściany uszeregowane wg jasności pola świetlnego z szumem dostają tony w proporcji miejsc liści w kubełkach `shade`,
 * przesuniętej ku ciemnym.
 *
 * `lobes` pierwszych miejsc z kolejności wyboru dostaje duże liście jak w `addLeavesLod` (domyślnie 0).
 */
export function addCrownShell(
  field: LeafSiteField,
  scale: number,
  profile: SpeciesProfile,
  seed: number,
  builder: MeshBufferBuilder,
  startIndex: number,
  shell: { rings: number; sides: number; lobes?: number; maxBlobs?: number },
  lod: TreeMeshLod = {},
  branchPoints: readonly number[] = []
) {
  if (field.count === 0) return;
  const bands0 = Math.max(2, Math.min(16, Math.round(shell.rings)));
  const sectors0 = Math.max(3, Math.min(24, Math.round(shell.sides)));
  const leaf = profile.leafSizeRatio;
  const prng = new FastPrng(seed ^ 0x2c1b3c6d);
  const leafCount = Math.max(0, Math.min(field.count, Math.floor(shell.lobes ?? 0)));

  // Punkty: x, y, z i zapas; pierwsze `field.count` to miejsca liści
  const nBr = Math.floor(branchPoints.length / 3);
  const nPts = field.count + nBr;
  const P = new Float64Array(nPts * 3), M = new Float64Array(nPts);
  for (let i = 0; i < field.count; i++) {
    P[i * 3] = field.sites[i * 6]; P[i * 3 + 1] = field.sites[i * 6 + 1]; P[i * 3 + 2] = field.sites[i * 6 + 2];
    M[i] = leaf * SHELL_LEAF_MARGIN;
  }
  for (let i = 0; i < nBr; i++) {
    const q = field.count + i;
    P[q * 3] = branchPoints[i * 3]; P[q * 3 + 1] = branchPoints[i * 3 + 1]; P[q * 3 + 2] = branchPoints[i * 3 + 2];
    M[q] = leaf * SHELL_BRANCH_MARGIN;
  }

  // Skupiska
  const maxBlobs = Math.max(1, Math.min(4, Math.floor(shell.maxBlobs ?? SHELL_MAX_BLOBS)));
  let groups: number[][];
  let assign: Int32Array | null = null;
  for (let k = maxBlobs; k >= 2 && !assign; k--) assign = splitShellPoints(P, nPts, k);
  if (assign) {
    const k = Math.max(...assign) + 1;
    groups = Array.from({ length: k }, () => [] as number[]);
    for (let i = 0; i < nPts; i++) groups[assign[i]].push(i);
  } else {
    groups = [Array.from({ length: nPts }, (_, i) => i)];
  }
  const nb = groups.length;
  const totalTris = nb === 1 ? 2 * sectors0 * (bands0 - 1) : Math.min(SHELL_MAX_TRIANGLES, Math.round(2 * sectors0 * (bands0 - 1) * 1.5));
  const weights = groups.map((g) => Math.max(0.2, g.length / nPts));
  const wSum = weights.reduce((a, b) => a + b, 0);

  const hulls: ShellHull[] = [];
  groups.forEach((idx, gi) => {
    let bands = bands0, sectors = sectors0;
    if (nb > 1) {
      const tris = (totalTris * weights[gi]) / wSum;
      sectors = Math.max(6, Math.min(sectors0, Math.round(Math.sqrt((tris / 2) * (sectors0 / (bands0 - 1))))));
      bands = Math.max(4, Math.min(bands0, Math.round(tris / (2 * sectors)) + 1));
    }
    hulls.push(buildShellHull(field, P, M, idx, bands, sectors, prng, leaf));
  });

  // Scalenie brył w jedną listę wierzchołków i ścian
  let vTotal = 0;
  for (const h of hulls) vTotal += h.px.length;
  const px = new Float64Array(vTotal), py = new Float64Array(vTotal), pz = new Float64Array(vTotal), light = new Float64Array(vTotal);
  const faces: number[] = [];
  let off = 0;
  for (const h of hulls) {
    px.set(h.px, off); py.set(h.py, off); pz.set(h.pz, off); light.set(h.light, off);
    for (const f of h.faces) faces.push(f + off);
    off += h.px.length;
  }
  const nFaces = faces.length / 3;
  const faceArea = new Float64Array(nFaces);
  const faceLight = new Float64Array(nFaces);
  const faceNormal = new Float64Array(nFaces * 3);
  let areaSum = 0;
  for (let f = 0; f < nFaces; f++) {
    const a = faces[f * 3],
      b = faces[f * 3 + 1],
      c = faces[f * 3 + 2];
    const ux = px[b] - px[a],
      uy = py[b] - py[a],
      uz = pz[b] - pz[a];
    const wx = px[c] - px[a],
      wy = py[c] - py[a],
      wz = pz[c] - pz[a];
    const fx = uy * wz - uz * wy,
      fy = uz * wx - ux * wz,
      fz = ux * wy - uy * wx;
    const fl = Math.hypot(fx, fy, fz) || 1;
    faceArea[f] = fl / 2;
    // Normalna cieniowania: normalna ściany zmieszana z losowym kierunkiem (równomiernie na sferze)
    const ry = prng.signedRange(1),
      rphi = prng.range(0, Math.PI * 2),
      rxz = Math.sqrt(Math.max(0, 1 - ry * ry));
    let nx = (fx / fl) * SHELL_NORMAL_OUTWARD + Math.cos(rphi) * rxz * (1 - SHELL_NORMAL_OUTWARD),
      ny = (fy / fl) * SHELL_NORMAL_OUTWARD + ry * (1 - SHELL_NORMAL_OUTWARD),
      nz = (fz / fl) * SHELL_NORMAL_OUTWARD + Math.sin(rphi) * rxz * (1 - SHELL_NORMAL_OUTWARD);
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-6) {
      nx = fx / fl;
      ny = fy / fl;
      nz = fz / fl;
    } else {
      nx /= nl;
      ny /= nl;
      nz /= nl;
    }
    faceNormal[f * 3] = nx;
    faceNormal[f * 3 + 1] = ny;
    faceNormal[f * 3 + 2] = nz;
    faceLight[f] = (light[a] + light[b] + light[c]) / 3 + prng.signedRange(SHELL_TONE_NOISE);
    areaSum += faceArea[f];
  }
  const toneCount = [0, 0, 0];
  for (let i = 0; i < field.count; i++) toneCount[field.tone[i]]++;
  const byLight: number[] = [];
  for (let f = 0; f < nFaces; f++) byLight.push(f);
  byLight.sort((p, q) => faceLight[q] - faceLight[p] || p - q);
  const faceTone = new Uint8Array(nFaces);
  const limit0 = Math.max(0, toneCount[0] / field.count - SHELL_TONE_DARKEN) * areaSum,
    limit1 = Math.max(0, (toneCount[0] + toneCount[1]) / field.count - SHELL_TONE_DARKEN) * areaSum;
  let done = 0;
  for (const f of byLight) {
    const mid = done + faceArea[f] / 2;
    faceTone[f] = mid < limit0 ? 0 : mid < limit1 ? 1 : 2;
    done += faceArea[f];
  }

  const emit =
    leafCount > 0
      ? leafEmitter(
          field,
          scale,
          profile,
          seed,
          builder,
          { ...selectLeafSites(field, profile, { ...lod, maxLeaves: leafCount }), enlarged: true },
          lod.leafShape ?? 'penta',
          { maxLength: SHELL_LEAF_MAX_LENGTH * (field.crownR + leaf) }
        )
      : null;

  let groupStart = startIndex;
  for (let t = 0; t < 3; t++) {
    for (let f = 0; f < nFaces; f++) {
      if (faceTone[f] !== t) continue;
      const v0 = builder.vertexCount;
      for (let e = 0; e < 3; e++) {
        const v = faces[f * 3 + e];
        builder.addVertex(
          px[v] * scale,
          py[v] * scale,
          pz[v] * scale,
          faceNormal[f * 3],
          faceNormal[f * 3 + 1],
          faceNormal[f * 3 + 2]
        );
      }
      builder.indices.push3(v0, v0 + 1, v0 + 2);
    }
    if (emit) emit(t);
    builder.addGroup(groupStart, builder.indices.length - groupStart, t + 1);
    groupStart = builder.indices.length;
  }
}

/** Jedna otoczka gwiaździsta wokół podzbioru punktów `idx` (patrz `addCrownShell`) */
function buildShellHull(
  field: LeafSiteField,
  P: Float64Array,
  M: Float64Array,
  idx: number[],
  bands: number,
  sectors: number,
  prng: FastPrng,
  leaf: number
): ShellHull {
  const nPts = idx.length;
  const isLeaf = (i: number) => idx[i] < field.count;
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], ly: number[] = [];
  for (let i = 0; i < nPts; i++) {
    const q = idx[i];
    xs.push(P[q * 3]); ys.push(P[q * 3 + 1]); zs.push(P[q * 3 + 2]);
    if (isLeaf(i)) ly.push(P[q * 3 + 1]);
  }
  const qr = (a: number[], f: number) => {
    const s = a.slice().sort((p, q) => p - q);
    return s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))];
  };
  // Środek i półosie z przyciętego zakresu (2–98%), podstawa korony z wysokości liści
  const loX = qr(xs, 0.02), hiX = qr(xs, 0.98), loY = qr(ys, 0.02), hiY = qr(ys, 0.98), loZ = qr(zs, 0.02), hiZ = qr(zs, 0.98);
  const ox = (loX + hiX) / 2, oy = (loY + hiY) / 2, oz = (loZ + hiZ) / 2;
  const ax = Math.max(leaf, (hiX - loX) / 2, (hiZ - loZ) / 2), ay = Math.max(leaf, (hiY - loY) / 2);
  const baseY = ly.length > 0 ? qr(ly, SHELL_BASE_PERCENTILE) : loY;

  const nVerts = (bands - 1) * sectors + 2;
  const last = nVerts - 1;
  const ux = new Float64Array(nVerts), uy = new Float64Array(nVerts), uz = new Float64Array(nVerts);
  const nbr: number[][] = [];
  const ringOf = (r: number, j: number) => 1 + (r - 1) * sectors + ((j + sectors) % sectors);
  for (let v = 0; v < nVerts; v++) {
    let theta = 0, phi = 0;
    if (v === last) theta = Math.PI;
    else if (v > 0) {
      theta = (Math.PI * (1 + Math.floor((v - 1) / sectors))) / bands;
      phi = (((v - 1) % sectors) / sectors) * Math.PI * 2;
    }
    ux[v] = Math.sin(theta) * Math.cos(phi);
    uy[v] = Math.cos(theta);
    uz[v] = Math.sin(theta) * Math.sin(phi);
    const list: number[] = [];
    if (v === 0) for (let j = 0; j < sectors; j++) list.push(ringOf(1, j));
    else if (v === last) for (let j = 0; j < sectors; j++) list.push(ringOf(bands - 1, j));
    else {
      const r = 1 + Math.floor((v - 1) / sectors), j = (v - 1) % sectors;
      list.push(ringOf(r, j - 1), ringOf(r, j + 1), r === 1 ? 0 : ringOf(r - 1, j), r === bands - 1 ? last : ringOf(r + 1, j));
    }
    nbr.push(list);
  }

  // Promień: percentyl odległości punktów w stożku (liście i gałęzie osobno, większy z nich); jasność: średnia pola światła
  const cone = Math.cos(Math.max(Math.PI / bands, (Math.PI * 2) / sectors) * 0.75);
  const R = new Float64Array(nVerts).fill(-1);
  const lightSum = new Float64Array(nVerts), lightN = new Float64Array(nVerts);
  const dl: number[][] = Array.from({ length: nVerts }, () => []);
  const db: number[][] = Array.from({ length: nVerts }, () => []);
  for (let i = 0; i < nPts; i++) {
    const q = idx[i];
    const dx = (P[q * 3] - ox) / ax, dy = (P[q * 3 + 1] - oy) / ay, dz = (P[q * 3 + 2] - oz) / ax;
    const len = Math.hypot(dx, dy, dz) || 1e-9;
    const nx = dx / len, ny = dy / len, nz = dz / len;
    const phys = Math.hypot(nx * ax, ny * ay, nz * ax) || 1e-9;
    const pr = len + M[q] / phys;
    for (let v = 0; v < nVerts; v++) {
      if (nx * ux[v] + ny * uy[v] + nz * uz[v] < cone) continue;
      (isLeaf(i) ? dl : db)[v].push(pr);
      if (isLeaf(i)) { lightSum[v] += field.shade[q]; lightN[v]++; }
    }
  }
  let meanShade = 0;
  for (let i = 0; i < field.count; i++) meanShade += field.shade[i] / field.count;
  const light = new Float64Array(nVerts);
  for (let v = 0; v < nVerts; v++) {
    R[v] = Math.max(quantile(dl[v], SHELL_PERCENTILE), quantile(db[v], SHELL_PERCENTILE));
    light[v] = lightN[v] > 0 ? lightSum[v] / lightN[v] : meanShade;
  }
  for (let pass = 0; pass < nVerts; pass++) {
    let missing = 0;
    const next = R.slice();
    for (let v = 0; v < nVerts; v++) {
      if (R[v] >= 0) continue;
      let sum = 0, k = 0;
      for (const w of nbr[v]) if (R[w] >= 0) { sum += R[w]; k++; }
      if (k > 0) next[v] = sum / k; else missing++;
    }
    R.set(next);
    if (missing === 0) break;
  }
  for (let v = 0; v < nVerts; v++) if (R[v] < 0) R[v] = 1;
  for (let pass = 0; pass < 2; pass++) {
    const next = R.slice();
    for (let v = 0; v < nVerts; v++) {
      let avg = 0;
      for (const w of nbr[v]) avg += R[w] / nbr[v].length;
      next[v] = Math.max(R[v], SHELL_SMOOTH * avg);
    }
    R.set(next);
  }
  // Zaokrąglone bieguny: promień bieguna nie przekracza średniej pierwszego pasa (kolumnowe korony bez szpica)
  for (const pole of [0, last]) {
    let avg = 0;
    for (const w of nbr[pole]) avg += R[w] / nbr[pole].length;
    R[pole] = Math.min(R[pole], avg * SHELL_POLE);
  }
  for (let v = 0; v < nVerts; v++) R[v] *= 1 + prng.range(0, SHELL_NOISE);

  const faces: number[] = [];
  for (let j = 0; j < sectors; j++) {
    const j1 = (j + 1) % sectors;
    faces.push(0, 1 + j1, 1 + j);
    for (let r = 1; r + 1 < bands; r++) {
      const a = ringOf(r, j), b = ringOf(r, j1), c = ringOf(r + 1, j), d = ringOf(r + 1, j1);
      faces.push(a, b, d, a, d, c);
    }
    faces.push(last, ringOf(bands - 1, j), ringOf(bands - 1, j1));
  }

  // Spód: miękkie ścięcie na podstawie korony (zejście poniżej podstawy ≤ ~SHELL_BASE_SOFT wysokości bryły)
  const soft = Math.max(1e-6, SHELL_BASE_SOFT * (hiY - loY));
  const px = new Float64Array(nVerts), py = new Float64Array(nVerts), pz = new Float64Array(nVerts);
  for (let v = 0; v < nVerts; v++) {
    px[v] = ox + ux[v] * R[v] * ax;
    let y = oy + uy[v] * R[v] * ay;
    if (y < baseY) y = baseY - soft * Math.tanh((baseY - y) / soft);
    py[v] = y;
    pz[v] = oz + uz[v] * R[v] * ax;
  }
  return { px, py, pz, faces, light };
}
