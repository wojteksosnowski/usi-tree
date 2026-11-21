/**
 * High-performance typed buffer builders for 3D procedural mesh assembly.
 */
import type { RawTreeMesh } from './types.js';

/** Rosnący bufor typowany (podwajanie pojemności) — bez boksowania liczb i konwersji przy budowie geometrii */
export class GrowableBuffer<T extends Float32Array | Uint32Array> {
  length = 0;

  constructor(public a: T, private readonly make: (n: number) => T) {}

  push3(x: number, y: number, z: number) {
    if (this.length + 3 > this.a.length) {
      const next = this.make(this.a.length * 2);
      next.set(this.a);
      this.a = next;
    }
    const a = this.a;
    const i = this.length;
    a[i] = x;
    a[i + 1] = y;
    a[i + 2] = z;
    this.length = i + 3;
  }

  /** Kopia wypełnionej części */
  slice(): T {
    return this.a.slice(0, this.length) as T;
  }
}

/**
 * Bufor wielokrotnego użytku do szybkiej asemblacji siatek bez zbędnego GC.
 */
export class MeshBufferBuilder {
  positions = new GrowableBuffer(new Float32Array(1 << 15), (n) => new Float32Array(n));
  normals = new GrowableBuffer(new Float32Array(1 << 15), (n) => new Float32Array(n));
  indices = new GrowableBuffer(new Uint32Array(1 << 15), (n) => new Uint32Array(n));
  groups: { start: number; count: number; materialIndex: number }[] = [];
  vertexCount = 0;
  /** Atrybut wiatru (vec3 na wierzchołek: ugięcie gałęzi, faza, trzepot liści); null = nie zbieramy (domyślnie) */
  wind: GrowableBuffer<Float32Array> | null = null;
  private windBaseX = 0;
  private windBaseY = 0;
  private windBaseZ = 0;
  private windInvLen = 0;
  private windW0 = 0;
  private windSpan = 0;
  private windPhase = 0;
  private windFlutter = 0;

  /** Włącza zbieranie atrybutu `windData` (wywołać przed dodaniem wierzchołków) */
  enableWind() {
    if (!this.wind) this.wind = new GrowableBuffer(new Float32Array(1 << 15), (n) => new Float32Array(n));
  }

  /**
   * Tag wiatru dla kolejnych wierzchołków pędu: ugięcie rośnie liniowo od `w0` u nasady (x, y, z)
   * do `w0 + span` w odległości `len` od niej. Faza rozsynchronizowuje gałęzie.
   */
  setWindStem(x: number, y: number, z: number, len: number, w0: number, span: number, phase: number) {
    this.windBaseX = x;
    this.windBaseY = y;
    this.windBaseZ = z;
    this.windInvLen = len > 1e-9 ? 1 / len : 0;
    this.windW0 = w0;
    this.windSpan = span;
    this.windPhase = phase;
    this.windFlutter = 0;
  }

  /** Tag wiatru dla listowia: stałe ugięcie jak najcieńszych gałązek, trzepot włączony */
  setWindFoliage(weight: number) {
    this.windInvLen = 0;
    this.windW0 = weight;
    this.windSpan = 0;
    this.windPhase = 0;
    this.windFlutter = 1;
  }

  minX = Infinity;
  maxX = -Infinity;
  minY = Infinity;
  maxY = -Infinity;
  minZ = Infinity;
  maxZ = -Infinity;

  reset() {
    this.positions.length = 0;
    this.normals.length = 0;
    this.indices.length = 0;
    this.groups.length = 0;
    this.vertexCount = 0;
    if (this.wind) this.wind.length = 0;
    this.minX = Infinity;
    this.maxX = -Infinity;
    this.minY = Infinity;
    this.maxY = -Infinity;
    this.minZ = Infinity;
    this.maxZ = -Infinity;
  }

  addGroup(start: number, count: number, materialIndex: number) {
    if (count > 0) {
      this.groups.push({ start, count, materialIndex });
    }
  }

  updateBounds(x: number, y: number, z: number) {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
    if (z < this.minZ) this.minZ = z;
    if (z > this.maxZ) this.maxZ = z;
  }

  addVertex(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
    this.positions.push3(x, y, z);
    this.normals.push3(nx, ny, nz);
    this.updateBounds(x, y, z);
    if (this.wind) {
      let t = 0;
      if (this.windInvLen > 0) {
        t = Math.hypot(x - this.windBaseX, y - this.windBaseY, z - this.windBaseZ) * this.windInvLen;
        if (t > 1) t = 1;
      }
      this.wind.push3(this.windW0 + this.windSpan * t, this.windPhase, this.windFlutter);
    }
    this.vertexCount++;
  }

  buildRawMesh(): RawTreeMesh {
    const minX = this.minX === Infinity ? 0 : this.minX;
    const minY = this.minY === Infinity ? 0 : this.minY;
    const minZ = this.minZ === Infinity ? 0 : this.minZ;
    const maxX = this.maxX === -Infinity ? 0 : this.maxX;
    const maxY = this.maxY === -Infinity ? 0 : this.maxY;
    const maxZ = this.maxZ === -Infinity ? 0 : this.maxZ;

    const cX = (minX + maxX) * 0.5;
    const cY = (minY + maxY) * 0.5;
    const cZ = (minZ + maxZ) * 0.5;
    const radius = Math.hypot(maxX - cX, maxY - cY, maxZ - cZ);

    return {
      positions: this.positions.slice(),
      normals: this.normals.slice(),
      indices:
        this.vertexCount < 65536
          ? new Uint16Array(this.indices.a.subarray(0, this.indices.length))
          : this.indices.slice(),
      groups: this.groups.map((g) => ({ ...g })),
      ...(this.wind ? { windData: this.wind.slice() } : {}),
      boundingBox: {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      boundingSphere: {
        center: [cX, cY, cZ],
        radius,
      },
    };
  }
}
