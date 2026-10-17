/**
 * 3D mesh extrusion along botanical stems and foliage generation.
 */
import { MeshBufferBuilder } from './meshBuilder.js';
import { FastPrng } from './prng.js';
import type {
  SpeciesProfile,
  Stem,
  TreeStroke,
} from './types.js';

const DEG = Math.PI / 180;
export const DEFAULT_LEAF_DENSITY = 38;

/** Sześciokąt liścia: pary (wzdłuż, w poprzek/w) — nasada, dwa boki, czubek */
const LEAF_HEX = [0, 0, 0.3, 1, 0.75, 0.8, 1, 0, 0.75, -0.8, 0.3, -1] as const;

/** Tablice cos/sin przekroju tuby dla 3–8 boków */
const RING_COS: Float64Array[] = [];
const RING_SIN: Float64Array[] = [];
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
  trunkBaseR: number
): Stem {
  const k = stroke.levelScale[Math.min(stem.level, stroke.levelScale.length - 1)] ?? 1;
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
  builder: MeshBufferBuilder
) {
  const n = stem.px.length;
  const rings: number[] = [];
  for (let i = 0; i < n - 1; i += ringStride) rings.push(i);
  rings.push(n - 1);
  let sx = 0,
    sy = 0,
    sz = 0,
    hasSide = false;
  let prevRingStart = -1;

  for (let q = 0; q < rings.length; q++) {
    const i = rings[q];
    const a = rings[Math.max(0, q - 1)],
      b = rings[Math.min(rings.length - 1, q + 1)];
    let dx = stem.px[b] - stem.px[a],
      dy = stem.py[b] - stem.py[a],
      dz = stem.pz[b] - stem.pz[a];
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl;
    dy /= dl;
    dz /= dl;
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
      hasSide = true;
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
    const ux = dy * sz - dz * sy,
      uy = dz * sx - dx * sz,
      uz = dx * sy - dy * sx;
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
      const nx = sx * c + ux * s,
        ny = sy * c + uy * s,
        nz = sz * c + uz * s;
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

  const last = n - 1;
  const tip = builder.vertexCount;
  builder.addVertex(stem.px[last] * scale, stem.py[last] * scale, stem.pz[last] * scale, 0, 1, 0);
  for (let j = 0; j < sides; j++) {
    builder.indices.push3(prevRingStart + j, tip, prevRingStart + ((j + 1) % sides));
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
  leafSites?: number[]
) {
  const deepest = profile.levels.length;
  const aspect = profile.leafAspect ?? 0.55;
  const clump = profile.leafClump ?? 4;
  const density = profile.leafDensity ?? DEFAULT_LEAF_DENSITY;
  const L = profile.leafSizeRatio;

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
      const nLeaves = Math.max(1, Math.round(clump * (0.6 + prng.next() * 0.8)));
      for (let q = 0; q < nLeaves; q++) {
        const size = L * (0.6 + prng.next() * 0.8);
        splitDir(
          tx,
          ty,
          tz,
          prng.range(0, Math.PI * 2),
          (25 + prng.next() * 55) * DEG,
          tmpVecA
        );
        const [ax, ay, az] = tmpVecA;
        splitDir(ax, ay, az, prng.range(0, Math.PI * 2), Math.PI / 2, tmpVecB);
        const [bx, by, bz] = tmpVecB;
        const nx = ay * bz - az * by,
          ny = az * bx - ax * bz,
          nz = ax * by - ay * bx;
        const ox = sx + ax * size * 0.15,
          oy = sy + ay * size * 0.15,
          oz = sz + az * size * 0.15;
        const w = size * aspect * 0.5;
        const v0 = builder.vertexCount;
        for (let p = 0; p < 6; p++) {
          const along = LEAF_HEX[p * 2] * size,
            across = LEAF_HEX[p * 2 + 1] * w;
          builder.addVertex(
            (ox + ax * along + bx * across) * scale,
            (oy + ay * along + by * across) * scale,
            (oz + az * along + bz * across) * scale,
            nx,
            ny,
            nz
          );
        }
        for (let p = 1; p < 5; p++) builder.indices.push3(v0, v0 + p, v0 + p + 1);
      }
    }
    builder.addGroup(groupStart, builder.indices.length - groupStart, b + 1);
    groupStart = builder.indices.length;
  }
}
