/**
 * Rejestr rodzajów drzew dla widoku 3D: z danych drzewa (rodzaj łaciński, nazwa polska, typ liści,
 * gatunek z samplera Standardu Zieleni) do parametrów generatora (`TreeGenerator`) — gatunek bazowy
 * z `SPECIES_PROFILES` albo profil dopasowany do alfabetu drzew (`fittedProfiles.json`, pętla w `scripts/treeFit`).
 *
 * Bez three: moduł wolno importować poza leniwym widokiem 3D (strażnik `lazy3d.guard.test.ts`).
 */
import type { SpeciesProfile, TreeSpecies, TrunkForm } from './TreeGenerator.js';
import FITTED_PROFILES from './fittedProfiles.json' with { type: 'json' };
import { profileAtHeight, type HeightAnchor } from './heightProfile.js';

/** Wzorce alfabetu drzew z dopasowanym profilem (pole `ref` w `fittedProfiles.json`) */
export type FittedTreeRef =
  | 'Beech'
  | 'Elm'
  | 'Horsechestnut'
  | 'Linden'
  | 'Sycamore'
  | 'Quaking Aspen'
  | 'Weeping Willow'
  | 'Viburnum'
  | 'Dogwood'
  | 'Apple'
  | 'Plane'
  | 'Black Poplar';

/** Rodzaj drzewa w 3D: gatunek bazowy generatora albo wzorzec z dopasowanym profilem */
export type TreeKind = TreeSpecies | FittedTreeRef;

export interface TreeKindParams {
  species: TreeSpecies;
  profile?: SpeciesProfile;
  form: TrunkForm;
}

interface FittedEntry {
  ref: string;
  startSpecies: TreeSpecies;
  form?: TrunkForm;
  /** Pokrój dostrojony do wzorców — styl B2 nie losuje mu innej formy pnia */
  keepShape?: boolean;
  profile: SpeciesProfile;
  /** Profile strojone dla kilku wysokości (wieku) — profil drzewa interpolowany po log2(h) */
  heightAnchors?: HeightAnchor[];
}

const FITTED = new Map<string, FittedEntry>((FITTED_PROFILES as unknown as FittedEntry[]).map((f) => [f.ref, f]));

/** Czy rodzaj ma pokrój dostrojony do wzorców (flaga `keepShape` w `fittedProfiles.json`) */
export function keepsOwnShape(kind: TreeKind): boolean {
  return !!FITTED.get(kind)?.keepShape;
}

/** Czy profil rodzaju zmienia się z wysokością drzewa (węzły `heightAnchors`) */
export function hasHeightScaling(kind: TreeKind): boolean {
  return !!FITTED.get(kind)?.heightAnchors?.length;
}

/**
 * Parametry generatora dla rodzaju; brak dopasowanego profilu → gatunek bazowy.
 * Rodzaj z węzłami wysokości dostaje profil dla `height` (bez wysokości: profil 9 m).
 */
export function treeKindParams(kind: TreeKind, height?: number): TreeKindParams {
  const fitted = FITTED.get(kind);
  if (fitted) {
    const profile = fitted.heightAnchors?.length ? profileAtHeight(fitted.heightAnchors, height ?? 9) : fitted.profile;
    return { species: fitted.startSpecies, profile, form: fitted.form ?? 'SINGLE' };
  }
  return { species: kind as TreeSpecies, form: 'SINGLE' };
}

/**
 * Przesunięcie tonów listowia rodzaju względem tonów palety (`iso.treeLeaf*`): obrót odcienia w stopniach
 * (ujemny = cieplej, ku żółci; dodatni = chłodniej, ku błękitowi) i mnożniki nasycenia oraz jasności.
 * Trzy tony na drzewo zostają, przesuwa się cały zestaw.
 */
export interface LeafToneShift {
  hue: number;
  saturation: number;
  lightness: number;
}

const NEUTRAL_LEAF_SHIFT: LeafToneShift = { hue: 0, saturation: 1, lightness: 1 };

const LEAF_TONE_SHIFTS: Partial<Record<TreeKind, LeafToneShift>> = {
  // ciemne, głębokie, pełne zielenie
  OAK: { hue: 4, saturation: 0.95, lightness: 0.72 },
  Horsechestnut: { hue: 6, saturation: 1.1, lightness: 0.72 },
  Elm: { hue: 2, saturation: 0.9, lightness: 0.84 },
  ASH: { hue: 4, saturation: 0.9, lightness: 0.94 },
  // jasne i świeże
  Beech: { hue: -6, saturation: 1.2, lightness: 1.12 },
  BIRCH: { hue: -4, saturation: 1.2, lightness: 1.28 },
  Apple: { hue: 0, saturation: 1.05, lightness: 1.1 },
  // klon i jawor: świeża, czysta zieleń; lipa: wyraźnie jasna, żółtawa
  Sycamore: { hue: 8, saturation: 1.18, lightness: 1.04 },
  Linden: { hue: -8, saturation: 1.3, lightness: 1.24 },
  // srebrzyste, chłodne, przygaszone
  'Quaking Aspen': { hue: -10, saturation: 0.85, lightness: 1.1 },
  WILLOW: { hue: 22, saturation: 0.45, lightness: 1.2 },
  'Weeping Willow': { hue: 20, saturation: 0.5, lightness: 1.15 },
  // topole: przygaszone, oliwkowo-żółtawe zielenie (zdjęcia wzorców)
  POPLAR: { hue: -20, saturation: 0.8, lightness: 1.15 },
  'Black Poplar': { hue: -22, saturation: 0.75, lightness: 1.25 },
  Dogwood: { hue: 6, saturation: 0.9, lightness: 0.9 },
  Plane: { hue: -12, saturation: 0.85, lightness: 1.12 },
  // iglaste: niebieskawe i ciemniejsze
  PINE: { hue: 16, saturation: 0.75, lightness: 0.8 },
  SPRUCE: { hue: 28, saturation: 0.7, lightness: 0.7 },
};

/** Przesunięcie tonów listowia dla rodzaju; `null` (gatunek nieznany) albo brak wpisu → bez zmian */
export function leafToneShift(kind: TreeKind | null): LeafToneShift {
  return (kind && LEAF_TONE_SHIFTS[kind]) || NEUTRAL_LEAF_SHIFT;
}

/** Czy dane drzewa mówią cokolwiek o gatunku (inaczej rodzaj 3D jest tylko domyślny) */
export function hasSpeciesInfo(src: TreeKindSource): boolean {
  return !!(src.species || src.genus?.trim() || src.nameLatin?.trim() || src.namePolish?.trim());
}

export interface TreeKindSource {
  genus?: string;
  nameLatin?: string;
  namePolish?: string;
  leafType?: string;
  /** Gatunek z samplera drzew projektowanych (`SampledProjectTree.species`) */
  species?: string;
}

const SAMPLER_SPECIES: Record<string, TreeKind> = {
  OAK: 'OAK',
  BIRCH: 'BIRCH',
  MAPLE: 'Sycamore',
  PINE: 'PINE',
  SPRUCE: 'SPRUCE',
};

/** Reguły w kolejności: rodzaj łaciński (dokładnie) albo fragment nazwy (łacińskiej lub polskiej) */
const RULES: { genera: string[]; words: string[]; kind: TreeKind }[] = [
  { genera: ['pinus'], words: ['sosna'], kind: 'PINE' },
  { genera: ['picea', 'abies', 'larix', 'pseudotsuga', 'thuja', 'juniperus', 'taxus', 'chamaecyparis'], words: ['świerk', 'swierk', 'jodł', 'jodl', 'modrzew', 'żywotnik', 'jałowiec', 'cis '], kind: 'SPRUCE' },
  { genera: ['quercus'], words: ['dąb', 'dab '], kind: 'OAK' },
  { genera: ['betula'], words: ['brzoz'], kind: 'BIRCH' },
  { genera: ['fagus', 'carpinus'], words: ['buk', 'grab'], kind: 'Beech' },
  { genera: ['ulmus'], words: ['wiąz', 'wiaz'], kind: 'Elm' },
  { genera: ['aesculus'], words: ['kasztan'], kind: 'Horsechestnut' },
  { genera: ['tilia'], words: ['lipa'], kind: 'Linden' },
  { genera: ['platanus'], words: ['platan'], kind: 'Plane' },
  { genera: ['acer', 'liquidambar'], words: ['klon', 'jawor', 'ambrowiec'], kind: 'Sycamore' },
  { genera: [], words: ['babylonica', 'płacząc', 'placzac'], kind: 'Weeping Willow' },
  { genera: ['salix'], words: ['wierzb'], kind: 'WILLOW' },
  { genera: [], words: ['tremula', 'osika'], kind: 'Quaking Aspen' },
  // Topola kolumnowa tylko z nazwy odmiany; pozostałe topole (czarna, biała, kanadyjska) — szeroka korona
  { genera: [], words: ['italica', 'piramidaln', 'włosk', 'wlosk'], kind: 'POPLAR' },
  { genera: ['populus'], words: ['topol'], kind: 'Black Poplar' },
  { genera: ['malus', 'prunus', 'pyrus', 'sorbus', 'crataegus'], words: ['jabło', 'jablo', 'wiśni', 'wisni', 'czereśn', 'grusz', 'jarząb', 'głóg'], kind: 'Apple' },
  { genera: ['fraxinus', 'robinia', 'gleditsia', 'sophora'], words: ['jesion', 'robinia', 'grochodrzew'], kind: 'ASH' },
  { genera: ['cornus'], words: ['dereń', 'deren'], kind: 'Dogwood' },
  { genera: ['viburnum', 'sambucus', 'corylus', 'syringa'], words: ['kalin', 'bez ', 'leszczyn', 'lilak'], kind: 'Viburnum' },
];

/** Rodzaj drzewa w 3D z danych drzewa (OSM, WFS, sampler Standardu Zieleni) */
export function resolveTreeKind(src: TreeKindSource): TreeKind {
  if (src.species && SAMPLER_SPECIES[src.species]) return SAMPLER_SPECIES[src.species];
  const genus = (src.genus ?? '').trim().toLowerCase();
  const text = ` ${src.nameLatin ?? ''} ${genus} ${src.namePolish ?? ''} `.toLowerCase();
  for (const rule of RULES) {
    if (rule.genera.includes(genus) || rule.genera.some((g) => text.includes(` ${g} `) || text.includes(` ${g}`))) return rule.kind;
    if (rule.words.some((w) => text.includes(w))) return rule.kind;
  }
  return src.leafType === 'needleleaved' ? 'SPRUCE' : 'Linden';
}
