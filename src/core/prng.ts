/** Deterministyczny PRNG (mulberry32) — ta sama sekwencja dla tego samego ziarna. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Szybki obiektowy wrapper na generator liczb pseudolosowych z pomocniczymi zakresami */
export class FastPrng {
  readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed >>> 0 || 0x12345678);
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  signedRange(magnitude: number): number {
    return (this.next() * 2 - 1) * magnitude;
  }
}

/** Deterministyczny hash pozycji i poziomu gałęzi (nie zaburza głównego strumienia PRNG) */
export function stemHash(ox: number, oy: number, oz: number, level: number): number {
  let h = (Math.round(ox * 1000) * 73856093) ^ (Math.round(oy * 1000) * 19349663) ^ (Math.round(oz * 1000) * 83492791) ^ (level * 2654435761);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Stabilny 32-bitowy hash FNV-1a łańcucha znaków. */
export function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
