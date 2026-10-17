import FITTED_PROFILES_RAW from '../core/fittedProfiles.json' with { type: 'json' };
import { SPECIES_PROFILES } from '../core/speciesProfiles.js';
import type { SpeciesProfile, TreeSpecies, TrunkForm } from '../core/types.js';
import type { HeightAnchor } from '../core/heightProfile.js';
import { leafToneShift, type TreeKind } from '../core/treeSpeciesRegistry.js';
import { USI_TREE_SCHEMA_URI, type UsiTreeSpecV1 } from '../schema/index.js';

export interface FittedProfileEntry {
  ref: string;
  startSpecies: TreeSpecies;
  form?: TrunkForm;
  keepShape?: boolean;
  profile: SpeciesProfile;
  heightAnchors?: HeightAnchor[];
}

export const FITTED_PROFILES: readonly FittedProfileEntry[] = FITTED_PROFILES_RAW as unknown as FittedProfileEntry[];

export { SPECIES_PROFILES };

const TAXONOMY_METADATA: Record<string, { genus: string; latin: string; pl: string[]; en: string[]; leafType: 'broadleaved' | 'needleleaved' }> = {
  OAK: { genus: 'Quercus', latin: 'Quercus robur', pl: ['dąb szypułkowy', 'dąb'], en: ['pedunculate oak', 'English oak'], leafType: 'broadleaved' },
  BIRCH: { genus: 'Betula', latin: 'Betula pendula', pl: ['brzoza brodawkowata', 'brzoza'], en: ['silver birch'], leafType: 'broadleaved' },
  PINE: { genus: 'Pinus', latin: 'Pinus sylvestris', pl: ['sosna zwyczajna', 'sosna'], en: ['Scots pine'], leafType: 'needleleaved' },
  SPRUCE: { genus: 'Picea', latin: 'Picea abies', pl: ['świerk pospolity', 'świerk'], en: ['Norway spruce'], leafType: 'needleleaved' },
  POPLAR: { genus: 'Populus', latin: "Populus nigra 'Italica'", pl: ['topola włoska'], en: ['Lombardy poplar'], leafType: 'broadleaved' },
  WILLOW: { genus: 'Salix', latin: 'Salix alba', pl: ['wierzba biała', 'wierzba'], en: ['white willow'], leafType: 'broadleaved' },
  ASH: { genus: 'Fraxinus', latin: 'Fraxinus excelsior', pl: ['jesion wyniosły', 'jesion'], en: ['European ash'], leafType: 'broadleaved' },
  ASPEN: { genus: 'Populus', latin: 'Populus tremula', pl: ['topola osika', 'osika'], en: ['Eurasian aspen'], leafType: 'broadleaved' },
  BUSH: { genus: 'Cornus', latin: 'Cornus sanguinea', pl: ['krzew liściasty'], en: ['deciduous shrub'], leafType: 'broadleaved' },
  Beech: { genus: 'Fagus', latin: 'Fagus sylvatica', pl: ['buk pospolity', 'buk'], en: ['European beech'], leafType: 'broadleaved' },
  Elm: { genus: 'Ulmus', latin: 'Ulmus laevis', pl: ['wiąz szypułkowy', 'wiąz'], en: ['European white elm'], leafType: 'broadleaved' },
  Horsechestnut: { genus: 'Aesculus', latin: 'Aesculus hippocastanum', pl: ['kasztanowiec pospolity'], en: ['horse chestnut'], leafType: 'broadleaved' },
  Linden: { genus: 'Tilia', latin: 'Tilia cordata', pl: ['lipa drobnolistna', 'lipa'], en: ['small-leaved lime'], leafType: 'broadleaved' },
  Sycamore: { genus: 'Acer', latin: 'Acer pseudoplatanus', pl: ['klon jawor', 'jawor', 'klon'], en: ['sycamore maple'], leafType: 'broadleaved' },
  'Quaking Aspen': { genus: 'Populus', latin: 'Populus tremula', pl: ['topola osika', 'osika'], en: ['quaking aspen'], leafType: 'broadleaved' },
  'Weeping Willow': { genus: 'Salix', latin: 'Salix babylonica', pl: ['wierzba płacząca'], en: ['weeping willow'], leafType: 'broadleaved' },
  Viburnum: { genus: 'Viburnum', latin: 'Viburnum opulus', pl: ['kalina koralowa', 'kalina'], en: ['guelder-rose'], leafType: 'broadleaved' },
  Dogwood: { genus: 'Cornus', latin: 'Cornus mas', pl: ['dereń jadalny', 'dereń'], en: ['Cornelian cherry'], leafType: 'broadleaved' },
  Apple: { genus: 'Malus', latin: 'Malus domestica', pl: ['jabłoń domowa', 'jabłoń'], en: ['orchard apple'], leafType: 'broadleaved' },
  Plane: { genus: 'Platanus', latin: 'Platanus × hispanica', pl: ['platan klonolistny', 'platan'], en: ['London plane'], leafType: 'broadleaved' },
  'Black Poplar': { genus: 'Populus', latin: 'Populus nigra', pl: ['topola czarna'], en: ['black poplar'], leafType: 'broadleaved' },
};

/**
 * Exports any registered TreeKind (base or fitted) as a standardized UsiTreeSpecV1 document.
 */
export function toUsiTreeSpec(kind: TreeKind): UsiTreeSpecV1 {
  const fitted = FITTED_PROFILES.find((f) => f.ref === kind);
  const meta = TAXONOMY_METADATA[kind] ?? {
    genus: String(kind),
    latin: String(kind),
    pl: [String(kind).toLowerCase()],
    en: [String(kind).toLowerCase()],
    leafType: 'broadleaved' as const,
  };
  const id = String(kind).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const defaultProfile = fitted ? fitted.profile : SPECIES_PROFILES[kind as TreeSpecies];

  return {
    $schema: USI_TREE_SCHEMA_URI,
    version: '1.0',
    taxonomy: {
      id,
      genus: meta.genus,
      speciesLatin: meta.latin,
      commonNames: { pl: meta.pl, en: meta.en },
      leafType: meta.leafType,
      leafCycle: meta.leafType === 'needleleaved' ? 'evergreen' : 'deciduous',
    },
    ontogeny: {
      baseSpecies: fitted ? fitted.startSpecies : (kind as TreeSpecies),
      form: fitted?.form ?? 'SINGLE',
      keepShape: fitted?.keepShape,
      defaultProfile: structuredClone(defaultProfile),
      heightAnchors: fitted?.heightAnchors ? structuredClone(fitted.heightAnchors) : undefined,
    },
    appearance: {
      leafToneShift: leafToneShift(kind),
    },
  };
}
