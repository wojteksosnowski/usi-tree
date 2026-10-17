/**
 * USI Tree Standard v1.0 — Declarative Open Specification for Dendrological & Procedural 3D Trees
 */
import type { SpeciesProfile, TreeSpecies, TreeStroke, TrunkForm } from '../core/types.js';
import type { HeightAnchor } from '../core/heightProfile.js';
import type { LeafToneShift } from '../core/treeSpeciesRegistry.js';
import { profileAtHeight } from '../core/heightProfile.js';

export const USI_TREE_SCHEMA_URI = 'https://usi-tree.org/schema/v1/tree.schema.json' as const;

export interface UsiTreeTaxonomy {
  id: string;
  genus: string;
  speciesLatin?: string;
  commonNames?: {
    pl?: string[];
    en?: string[];
    de?: string[];
  };
  leafType: 'broadleaved' | 'needleleaved';
  leafCycle?: 'deciduous' | 'evergreen' | 'semi-deciduous';
}

export interface UsiTreeBiomechanics {
  /** 1.0 = monopodial (e.g. spruce), 0.1 = strongly sympodial (e.g. oak, olive) */
  apicalDominance: number;
  /** Rate of trunk radius reduction along height (0..1) */
  taperRate: number;
  /** Axis curvature & sympodial zig-zag intensity (0..1) */
  gnarliness: number;
  /** Helical fiber twist around stem axis (0..1) */
  fiberTwist: number;
  /** Branch attachment collar shape */
  junctionType: 'U' | 'V' | 'UV';
  /** Root flare & basal buttressing intensity (0..1) */
  buttressing?: number;
  /** Number of muscular cross-section lobes (e.g. Carpinus betulus = 6..10) */
  flutingLobes?: number;
}

export interface UsiTreeOntogeny {
  baseSpecies?: TreeSpecies;
  form: TrunkForm;
  keepShape?: boolean;
  defaultProfile: SpeciesProfile;
  heightAnchors?: HeightAnchor[];
}

export interface UsiTreeAppearance {
  barkColorHex?: string;
  leafToneShift?: LeafToneShift;
  recommendedStroke?: TreeStroke;
}

export interface UsiTreeSpecV1 {
  $schema?: string;
  version: '1.0';
  taxonomy: UsiTreeTaxonomy;
  biomechanics?: UsiTreeBiomechanics;
  ontogeny: UsiTreeOntogeny;
  appearance?: UsiTreeAppearance;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * Validates a UsiTreeSpecV1 document for structural, botanical, and physical invariants.
 */
export function validateUsiTreeSpec(doc: unknown): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (!doc || typeof doc !== 'object') {
    return { valid: false, issues: [{ path: '', message: 'Document must be a JSON object' }] };
  }
  const d = doc as Partial<UsiTreeSpecV1>;
  if (d.version !== '1.0') {
    issues.push({ path: 'version', message: 'Expected version "1.0"' });
  }
  if (!d.taxonomy || typeof d.taxonomy !== 'object') {
    issues.push({ path: 'taxonomy', message: 'Missing taxonomy section' });
  } else {
    if (!d.taxonomy.id || !/^[a-z0-9-]+$/.test(d.taxonomy.id)) {
      issues.push({ path: 'taxonomy.id', message: 'taxonomy.id must be a non-empty kebab-case identifier' });
    }
    if (!d.taxonomy.genus || typeof d.taxonomy.genus !== 'string') {
      issues.push({ path: 'taxonomy.genus', message: 'taxonomy.genus is required' });
    }
    if (d.taxonomy.leafType !== 'broadleaved' && d.taxonomy.leafType !== 'needleleaved') {
      issues.push({ path: 'taxonomy.leafType', message: 'leafType must be "broadleaved" or "needleleaved"' });
    }
  }
  if (!d.ontogeny || typeof d.ontogeny !== 'object') {
    issues.push({ path: 'ontogeny', message: 'Missing ontogeny section' });
  } else {
    if (!['SINGLE', 'FORKED', 'MULTI'].includes(d.ontogeny.form as string)) {
      issues.push({ path: 'ontogeny.form', message: 'ontogeny.form must be SINGLE, FORKED, or MULTI' });
    }
    const p = d.ontogeny.defaultProfile;
    if (!p || typeof p !== 'object') {
      issues.push({ path: 'ontogeny.defaultProfile', message: 'Missing defaultProfile' });
    } else {
      if (typeof p.trunkHeightRatio !== 'number' || p.trunkHeightRatio < 0 || p.trunkHeightRatio > 0.95) {
        issues.push({ path: 'ontogeny.defaultProfile.trunkHeightRatio', message: 'trunkHeightRatio must be in [0, 0.95]' });
      }
      if (typeof p.crownSpreadRatio !== 'number' || p.crownSpreadRatio <= 0 || p.crownSpreadRatio > 1.5) {
        issues.push({ path: 'ontogeny.defaultProfile.crownSpreadRatio', message: 'crownSpreadRatio must be in (0, 1.5]' });
      }
      if (!Array.isArray(p.levels) || p.levels.length === 0) {
        issues.push({ path: 'ontogeny.defaultProfile.levels', message: 'levels must be a non-empty array' });
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Resolves the effective SpeciesProfile for a given tree height [m] from a UsiTreeSpecV1 document.
 */
export function resolveSpecProfileAtHeight(spec: UsiTreeSpecV1, heightM: number): SpeciesProfile {
  if (spec.ontogeny.heightAnchors && spec.ontogeny.heightAnchors.length > 0) {
    return profileAtHeight(spec.ontogeny.heightAnchors, heightM);
  }
  return structuredClone(spec.ontogeny.defaultProfile);
}
