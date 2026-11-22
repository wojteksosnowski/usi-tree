/**
 * Mathematical models for crown bounding envelopes (Weber & Penn 1995).
 */
import { CROWN_SHAPE_PEAK } from './speciesProfiles.js';
import type { CrownShape, SpeciesProfile } from './types.js';

export const ENVELOPE_FILL = 0.95; // promień obwiedni / zasięg konarów
export const ENVELOPE_CEILING = 1.02; // sufit pionowy obwiedni
export const ENVELOPE_RADIAL_BYPASS = 1.25; // mnożnik przełamania obwiedni radialnej
export const GROUND_CLEARANCE = 0.04; // najniższy punkt gałęzi przy przycinaniu

export function crownShapeRatio(shape: CrownShape, t: number): number {
  // t: 0 = dół korony, 1 = szczyt
  switch (shape) {
    case 'CONICAL':
      return 0.08 + 0.92 * (1 - t);
    case 'SPHERICAL':
      return t < 0.5 ? 0.25 + 0.75 * Math.sin(Math.PI * t) : Math.max(0.04, Math.sqrt(1 - (2 * t - 1) * (2 * t - 1)));
    case 'HEMISPHERICAL':
      return Math.max(0.04, Math.sqrt(1 - t * t));
    case 'TEND_FLAME':
      return t <= 0.35 ? 0.5 + 0.5 * (t / 0.35) : 0.1 + 0.9 * (1 - t) / 0.65;
    case 'CYLINDRICAL':
      return 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.1));
    case 'OVOID_COLUMN': {
      if (t <= 0.20) return 0.30 + 0.55 * Math.sin((Math.PI / 2) * (t / 0.20));
      if (t <= 0.60) return 0.85 + 0.15 * Math.sin((Math.PI / 2) * ((t - 0.20) / 0.40));
      if (t <= 1.00) {
        const u = (t - 0.60) / 0.40;
        return Math.max(0.04, 1.0 - 0.94 * Math.pow(u, 1.8));
      }
      return Math.max(0, 0.04 * (1 - (t - 1.00) / 0.05));
    }
    case 'UMBRELLA':
      return 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.85));
  }
}

/**
 * Kształt korony z przesuniętym maksimum: t odwzorowane odcinkami liniowo tak, by `peak` trafiało
 * w naturalne maksimum kształtu (nasada i wierzchołek bez zmian).
 */
function crownSingleRatio(shape: CrownShape, t: number, peak: number | undefined): number {
  const p0 = CROWN_SHAPE_PEAK[shape];
  const p = peak !== undefined ? Math.min(0.95, Math.max(0.05, peak)) : undefined;
  if (p === undefined || p0 <= 0 || p <= 0 || p >= 1 || t >= 1) return crownShapeRatio(shape, t);
  const u = t <= p ? (t / p) * p0 : p0 + ((t - p) / (1 - p)) * (1 - p0);
  return crownShapeRatio(shape, u);
}

export function crownRatio(
  shape: CrownShape,
  t: number,
  peak?: number,
  shapeB?: CrownShape,
  blend?: number
): number {
  const rA = crownSingleRatio(shape, t, peak);
  if (shapeB && shapeB !== shape && blend !== undefined && blend > 0) {
    if (blend >= 1) return crownSingleRatio(shapeB, t, peak);
    return (1 - blend) * rA + blend * crownSingleRatio(shapeB, t, peak);
  }
  return rA;
}

/**
 * Re-entrantna obwiednia korony dla pojedynczego drzewa (eliminacja globalnego stanu statycznego).
 */
export class CrownEnvelope {
  readonly profile: SpeciesProfile;
  readonly disabled: boolean;
  readonly base: number;
  readonly invH: number;
  readonly spread: number;
  readonly shape: CrownShape;
  readonly shapeB: CrownShape | undefined;
  readonly shapeBlend: number;
  readonly peak: number | undefined;
  groundClearance = -Infinity;

  constructor(profile: SpeciesProfile | null) {
    if (!profile) {
      this.profile = null as unknown as SpeciesProfile;
      this.disabled = true;
      this.base = 0;
      this.invH = 1;
      this.spread = 0;
      this.shape = 'SPHERICAL';
      this.shapeB = undefined;
      this.shapeBlend = 0;
      this.peak = undefined;
      return;
    }
    this.profile = profile;
    this.disabled = !!profile.disableEnvelope;
    this.base = Math.min(profile.trunkHeightRatio, (profile.trunkLengthRatio ?? 1) * 0.85);
    this.invH = 1 / Math.max(1e-6, 1 - this.base);
    const l1Scale = Math.max(1, profile.levels?.[0]?.lengthRatio ?? 1);
    this.spread = profile.crownSpreadRatio * (profile.envelopeScale ?? 1.0) * l1Scale * ENVELOPE_FILL;
    this.shape = profile.crownShape;
    this.shapeB = profile.crownShapeB;
    this.shapeBlend = profile.crownShapeBlend ?? 0;
    this.peak = profile.crownPeak;
  }

  ratioAt(t: number): number {
    return crownRatio(this.shape, t, this.peak, this.shapeB, this.shapeBlend);
  }

  inside(x: number, y: number, z: number): boolean {
    return !this.isOutside(x, y, z, false);
  }

  isOutside(x: number, y: number, z: number, bypassRadial = false): boolean {
    if (!this.profile) return false;
    const isCylindrical =
      this.shape === 'CYLINDRICAL' && (!this.shapeB || this.shapeBlend <= 0 || this.shapeB === 'CYLINDRICAL');
    if (!isCylindrical && y > ENVELOPE_CEILING) return true;
    if (y < this.groundClearance) return true;
    if (this.disabled) return false;
    const t = Math.max(0, (y - this.base) * this.invH);
    if (!isCylindrical && t > ENVELOPE_CEILING) return true;
    const R0 = this.spread * this.ratioAt(t);
    const R = bypassRadial ? R0 * ENVELOPE_RADIAL_BYPASS : R0;
    return x * x + z * z > R * R;
  }
}
