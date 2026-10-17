/**
 * usi-tree — Open Standard & Zero-Dependency Procedural 3D Tree Generator
 */
export {
  TreeGenerator,
  SPECIES_PROFILES,
  TIDY_STRUCTURE,
  ILLUSTRATION_STROKE,
  DEFAULT_LEAF_DENSITY,
  ezMeshProfile,
  type TreeSpecies,
  type TreeDetail,
  type TrunkForm,
  type TreeGenerationParams,
  type TreeStroke,
  type RawTreeMesh,
  type TreeRawGeometryResult,
  type CrownShape,
  type BranchLevelParams,
  type SpeciesProfile,
  type Stem,
  type TreeSkeleton,
} from './core/TreeGenerator.js';

export {
  growEzTree,
  applyPipeRadii,
  type EzTreeOptions,
  type EzSkeleton,
} from './core/ezTree.js';

export {
  EZ_TREE_PRESETS,
  type EzTreePresetName,
} from './core/ezTreePresets.js';

export {
  EZ_SPECIES_PRESETS,
  stabilizeToDesign,
  type EzSpeciesPreset,
} from './core/ezTreeSpecies.js';

export {
  profileAtHeight,
  heightClassM,
  MAX_EXTRAPOLATION_M,
  type HeightAnchor,
} from './core/heightProfile.js';

export {
  resolveTreeKind,
  treeKindParams,
  leafToneShift,
  keepsOwnShape,
  hasHeightScaling,
  hasSpeciesInfo,
  type FittedTreeRef,
  type TreeKind,
  type TreeKindParams,
  type LeafToneShift,
  type TreeKindSource,
} from './core/treeSpeciesRegistry.js';

export {
  skeletonCrownReach,
  crownRadiusOf,
} from './core/crownMeasure.js';

export {
  mulberry32,
  hashString,
  FastPrng,
  stemHash,
} from './core/prng.js';

export {
  GrowableBuffer,
  MeshBufferBuilder,
} from './core/meshBuilder.js';

export {
  CrownEnvelope,
  crownRatio,
  crownShapeRatio,
} from './core/crownEnvelope.js';

export {
  growBotanicalTree,
  GrowthContext,
} from './core/growthEngine.js';

export {
  USI_TREE_SCHEMA_URI,
  validateUsiTreeSpec,
  resolveSpecProfileAtHeight,
  type UsiTreeSpecV1,
  type UsiTreeTaxonomy,
  type UsiTreeBiomechanics,
  type UsiTreeOntogeny,
  type UsiTreeAppearance,
  type ValidationIssue,
} from './schema/index.js';

export {
  FITTED_PROFILES,
  toUsiTreeSpec,
  type FittedProfileEntry,
} from './profiles/index.js';
