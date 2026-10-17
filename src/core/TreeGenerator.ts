import { mulberry32 } from './prng.js';
import { applyPipeRadii, growEzTree, type EzTreeOptions } from './ezTree.js';

export type TreeSpecies =
  | 'OAK'         // Dąb: rozłożysta korona, masywny pień, węzłowate rozgałęzienia
  | 'BIRCH'       // Brzoza: wysoki, smukły pień, zwisające/delikatne gałązki
  | 'PINE'        // Sosna: wysoki pień ogołocony z dołu, korona parasolowata na szczycie
  | 'SPRUCE'      // Świerk: sylwetka stożkowa, symetryczne piętra gałęzi
  | 'POPLAR'      // Topola włoska: wąska, kolumnowa, gałęzie ostro ku górze
  | 'WILLOW'      // Wierzba: malowniczy pień, przewieszające się ku dołowi witki
  | 'ASH'         // Jesion: wysoki pień, jajowata korona z wzniesionymi konarami (preset ez-tree ash)
  | 'ASPEN'       // Osika: smukły pień, mała wąska korona wysoko (preset ez-tree aspen)
  | 'BUSH';       // Krzew: wiele pędów od gruntu, kulista sylwetka (preset ez-tree bush)

export type TreeDetail = 'HIGH' | 'MEDIUM' | 'LOW';

/** Pokrój pnia (styl B2, wzorzec SA_Artboard2) */
export type TrunkForm =
  | 'SINGLE'   // jeden pień
  | 'FORKED'   // pień rozdwojony nisko w dwa przewodniki o podobnej grubości
  | 'MULTI';   // odmiana wielopniowa: 3–5 pni z jednego odziomka, rozchylonych wachlarzowo

export interface TreeGenerationParams {
  species: TreeSpecies;
  height: number;               // Wysokość drzewa w metrach (np. 3.0 - 30.0)
  seed?: number;                // Ziarno PRNG dla powtarzalności
  radialSegments?: number;      // Liczba boków przekroju pnia (3-6, domyślnie 4)
  withFoliageAccents?: boolean; // Liście: płaskie kępki w 3 tonach (grupy materiałów 1 = jasny, 2 = średni, 3 = ciemny)
  detail?: TreeDetail;          // Poziom szczegółowości siatki (LOD); szkielet jest wspólny dla wszystkich
  form?: TrunkForm;             // Pokrój pnia (domyślnie SINGLE)
  flow?: boolean;               // Płynne, cienkie gałązki: bez załamań i ostróg, łagodne wygięcia
  profile?: SpeciesProfile;     // Własny profil zamiast SPECIES_PROFILES[species] (dopasowanie do wzorców)
  ez?: EzTreeOptions;           // Wzrost pnia, gałęzi i miejsc liści wg ez-tree (`ezTree.ts`); profil służy wtedy tylko siatce (kreska, liście)
  stroke?: TreeStroke;          // Kreska siatki (tylko grubość tub; szkielet bez zmian), domyślnie jak w szkielecie
}

/**
 * Kreska siatki — grubość tub niezależna od szkieletu (sylwetka mierzona względem alfabetu drzew się nie zmienia).
 * `levelScale[i]` mnoży promień pędów rzędu i (ostatni wpis dla głębszych), `smooth` wygładza skokową zbieżność
 * pnia i konarów (reguła rur daje schodki przy każdym odgałęzieniu), `flareRise` rozkłada odziomek na tę część wysokości.
 */
export interface TreeStroke {
  levelScale: readonly number[];
  smooth: boolean;
  flareRise: number;
}

/**
 * Kreska ilustracji (wzorzec SA_Artboard2), mnożniki skalibrowane pomiarem wzorca (`scripts/treeFit/strokeCompare.ts --fit`):
 * mediany grubości / wysokość drzewa — pień ~3,8% przy odziomku i ~3,2% na 15% wysokości, konary ~2,7%, gałęzie ~0,8%.
 */
export const ILLUSTRATION_STROKE: TreeStroke = { levelScale: [1.0, 1.65, 2.9, 1], smooth: true, flareRise: 0.03 };

export interface RawTreeMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  groups: { start: number; count: number; materialIndex: number }[];
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
  };
  boundingSphere: {
    center: [number, number, number];
    radius: number;
  };
}

export interface TreeRawGeometryResult {
  mesh: RawTreeMesh;
  bounds: {
    height: number;
    crownRadius: number;
  };
}

/** Obwiednia korony (Weber & Penn 1995) — względna długość konara w funkcji położenia w koronie */
export type CrownShape =
  | 'CONICAL'        // świerk: najdłuższe konary u dołu
  | 'SPHERICAL'      // dąb: kula
  | 'HEMISPHERICAL'  // wierzba: kopuła
  | 'TEND_FLAME'     // brzoza: jajowata, szersza w dolnej połowie
  | 'CYLINDRICAL'    // topola: kolumna
  | 'OVOID_COLUMN'   // jesion dojrzały: kolumna z łagodnym wejściem od dołu i parabolicznym wierzchołkiem
  | 'UMBRELLA';      // sosna: parasol na szczycie

/** Parametry jednego rzędu gałęzi (1 = konary, 2 = gałęzie, 3 = witki) */
export interface BranchLevelParams {
  count: number;        // Liczba odgałęzień na rodzicu o pełnej długości
  downAngle: number;    // Kąt odchylenia od osi rodzica (stopnie)
  downAngleV: number;   // Rozrzut kąta odchylenia (stopnie)
  lengthRatio: number;  // Długość względem rodzica (rząd ≥ 2) / skala obwiedni (rząd 1)
  lengthV: number;      // Rozrzut długości (ułamek)
  curve: number;        // Łączne wygięcie ku górze (+) / ku dołowi (−) na całej długości (stopnie)
  curveV: number;       // Losowe falowanie (stopnie na segment)
  curveRes: number;     // Liczba segmentów tuby
  tropism: number;      // Fototropizm (+ ku górze) / geotropizm (− zwisanie) na całą długość
  downAngleSlope?: number; // Dodatkowy kąt odchylenia u nasady rodzica, malejący do 0 na jego końcu (stopnie) — dolne konary rozłożyste
  kink?: number;        // Maks. załamanie pędu w węźle odgałęzienia, w stronę przeciwną do dziecka (stopnie, domyślnie 15)
  fork: number;         // Kąt rozwidlenia „Y” na końcu pędu (stopnie, 0 = brak) — kontynuacja jak w ez-tree
  tipRatio?: number;    // Ułamek promienia pędu na końcu względem nasady (domyślnie: p.fork > 0 ? 0.5 : 0.22)
  // Rozszerzenia z Sapling Tree Gen (Weber–Penn); brak pola = dotychczasowy wynik
  curveBack?: number;   // Wygięcie drugiej połowy pędu (stopnie, + ku górze); wtedy `curve` działa na pierwszej połowie — łuk esowaty (konar brzozy: w górę, końcówka w dół)
  baseSize?: number;    // Początek odgałęzień tego rzędu na rodzicu (ułamek jego długości, domyślnie 0.1; konary na pniu — trunkHeightRatio)
  rotate?: number;      // Kąt obrotu kolejnych odgałęzień tego rzędu wokół rodzica (stopnie; zastępuje złoty kąt / przetasowane sloty)
  rotateV?: number;     // Rozrzut kąta obrotu (stopnie, domyślnie jak przy złotym kącie: ~14°)
}

export interface SpeciesProfile {
  trunkHeightRatio: number;      // Ułamek wysokości pnia bez gałęzi (odziomek do pierwszego konara)
  trunkBaseRadiusRatio: number;  // Promień pnia u podstawy / wysokość
  trunkLengthRatio: number;      // Długość przewodnika / wysokość (< 1: przewodnik ginie w koronie)
  trunkTipRatio?: number;        // Ułamek promienia pnia na szczycie względem podstawy (domyślnie 0.3; < 0.15: przewodnik silnie zbieżny i zanika)
  trunkCurveV: number;           // Falowanie przewodnika (stopnie na segment)
  crownSpreadRatio: number;      // Skala długości konarów względem wysokości
  crownShape: CrownShape;
  twigStroke?: number;           // Mnożnik grubości kreski gałązek i witek (rząd ≥ 2) w stylu ilustracji; brak = 1
  crownPeak?: number;            // Względna wysokość w koronie (0 = nasada, 1 = wierzchołek), na której obwiednia jest najszersza; brak = naturalne maksimum kształtu
  ratioPower: number;            // Wykładnik reguły rur: r_dziecka = r_rodzica · (L_dziecka / L_rodzica)^ratioPower
  levels: BranchLevelParams[];   // Rzędy gałęzi 1..n
  jitterStrength: number;        // Nieregularność przekroju (styl flamastra)
  flareFactor: number;           // Rozszerzenie pnia przy gruncie
  radialSegments?: number;       // Domyślna liczba boków przekroju tuby (3-5)
  leafSizeRatio: number;         // Długość liścia / wysokość drzewa
  leafAspect?: number;           // Szerokość / długość liścia (domyślnie 0.55)
  leafClump?: number;            // Liści w kępce (domyślnie 5)
  leafDensity?: number;          // Kępek na jednostkę długości witki, w skali nominalnej (domyślnie 60)
  limbsReachEnvelope?: boolean;  // Konary sięgają konturu korony (pokrój rozpierzchły: buk, lipa, kasztanowiec, wiąz)
  disableEnvelope?: boolean;    // Wyłącza sztywne docinanie obwiednią (pozwala na swobodny zwis wierzby/brzozy płaczącej)
  envelopeScale?: number;       // Mnożnik promienia obwiedni docinającej (domyślnie 1.0; > 1 daje luźniejszą koronę)
  envelopeClipProbability?: number; // Prawdopodobieństwo przycięcia pędu przez obwiednię korony (domyślnie 1.0; np. 0.70 = 30% szans na swobodny wzrost pędu poza obwiednię)
  trunkKink?: number;            // Załamanie przewodnika w węźle (stopnie, domyślnie 3; iglaste 0)
  tipSpurs?: boolean;            // Drobne widełki na końcach najcieńszych witek (domyślnie tak)
  scaffoldLimbs?: number;        // Pokrój rozpierzchły (wiąz, kasztanowiec): przewodnik kończy się w nasadzie korony i rozpada na tyle konarów głównych, z których dopiero wychodzą gałęzie
  trunkFork?: boolean;           // Rozwidlenie szczytowe przewodnika (apical leader fork) wewnątrz korony
  trunkForkAngle?: number;       // Kąt rozwidlenia szczytowego pnia (stopnie, domyślnie 20)
  trunkForkCount?: number;       // Liczba odgałęzień rozwidlenia szczytowego pnia (domyślnie 2)
  trunkForkAsymmetry?: number;   // Asymetria widełek pnia FORKED (0–1, domyślnie 0): przewodnik główny bliżej pionu i grubszy, boczny cieńszy, krótszy, odchylony mocniej (młode okazy)
  trunkForkHeightRatio?: number; // Wysokość rozwidlenia pnia FORKED / wysokość (domyślnie: min(0.9·trunkHeightRatio, 0.18–0.35 losowo))
  // Porządek struktury korony (brak pola = dotychczasowy wynik; komplet w TIDY_STRUCTURE)
  trunkForkSideLength?: number;  // FORKED: długość bocznego przewodnika względem głównego (domyślnie 1 − 0,3·asymetria)
  trunkForkSideRadius?: number;  // FORKED: promień bocznego przewodnika względem szczytu pnia (domyślnie 0,72 − 0,25·asymetria)
  trunkForkMainAngleScale?: number; // FORKED: mnożnik odchylenia głównego przewodnika od osi pnia (0 = przedłużenie pnia)
  trunkLeanScale?: number;       // FORKED: mnożnik przechyłu pnia (2–5°; 0 = pion)
  crownAsymmetry?: number;       // 0–1: konary po jednej stronie pnia dłuższe, po drugiej krótsze (bryła jednostronna — drzewo samotne, na skraju); kierunek z ziarna
  trunkForkTropism?: number;     // FORKED: fototropizm przewodników po rozwidleniu (domyślnie 2,2); większy = łokieć — odejście płasko i szybki skręt ku górze
  limbBreakProbability?: number; // Udział konarów (rząd 1) złamanych: urwane tępo w 35–70% długości, bez dalszych gałęzi (stare topole)
  prune?: boolean;               // Przycinanie jak w Weber–Penn/Sapling: pęd skracany przed wzrostem, by zmieścił się w obwiedni (zamiast urywania kikutem na niej)
  outwardBias?: number;          // 0..1: azymut gałęzi rzędu ≥ 2 ściągany „na zewnątrz” korony (plagiotropia), kąt odchylenia ≤ 80°
  phyllotaxis?: 'golden';        // Azymuty odgałęzień co złoty kąt 137,5° zamiast przetasowanych slotów
  twigGnarl?: number;            // Mnożnik dodatkowego falowania cienkich pędów (domyślnie 1; 0 = cienkie falują jak grube)
  kinkScale?: number;            // Mnożnik załamań gałęzi w węzłach odgałęzień (bez pnia; domyślnie 1)
  pliancy?: number;              // Wiotkość gałęzi (stopnie): ugięcie pod własnym ciężarem jak belka wspornikowa — rośnie ze smukłością pędu (długość / promień) i z jego poziomością; pęd zwisający pionowo już się nie ugina (wierzba płacząca, brzoza)
}

/**
 * Uporządkowana struktura korony: bez kikutów na obwiedni, gałęzie na zewnątrz, spokojniejsze witki.
 * Na ziarnach spoza dopasowania sylwetka bliżej alfabetu drzew w 9 z 11 wzorców, wskaźnik granatu ~2× niższy
 * (`scripts/treeFit/structureReport.ts`).
 */
export const TIDY_STRUCTURE: Pick<SpeciesProfile, 'prune' | 'outwardBias' | 'phyllotaxis' | 'twigGnarl' | 'kinkScale'> = {
  prune: true, outwardBias: 0.5, phyllotaxis: 'golden', twigGnarl: 0.3, kinkScale: 0.4,
};

const lvl = (p: Partial<BranchLevelParams> & Pick<BranchLevelParams, 'count' | 'downAngle' | 'lengthRatio'>): BranchLevelParams => ({
  downAngleV: 10, lengthV: 0.2, curve: 0, curveV: 8, curveRes: 3, tropism: 0, fork: 0, ...p,
});

/**
 * Profile morfologiczne gatunków (model Webera–Penna) strojone pod ryciny
 * w reference/design/drzewa/: cienki pień, gęsta drobna koronka witek, czytelna obwiednia.
 * Wszystkie z uporządkowaną strukturą korony (TIDY_STRUCTURE).
 */
export const SPECIES_PROFILES: Record<TreeSpecies, SpeciesProfile> = {
  OAK: {
    trunkHeightRatio: 0.24, trunkBaseRadiusRatio: 0.013, trunkLengthRatio: 0.85, trunkCurveV: 4,
    crownSpreadRatio: 0.42, crownShape: 'SPHERICAL', ratioPower: 1.25,
    levels: [
      lvl({ count: 11, downAngle: 45, downAngleSlope: 35, downAngleV: 10, lengthRatio: 1, curve: 30, curveV: 8, curveRes: 6, fork: 24 }),
      lvl({ count: 7, downAngle: 40, downAngleV: 15, lengthRatio: 0.6, curve: 10, curveV: 9, curveRes: 3, fork: 24 }),
      lvl({ count: 7, downAngle: 38, downAngleV: 15, lengthRatio: 0.55, curveV: 18, curveRes: 2 }),
    ],
    jitterStrength: 0.10, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.017,
    ...TIDY_STRUCTURE,
  },
  BIRCH: {
    trunkHeightRatio: 0.28, trunkBaseRadiusRatio: 0.009, trunkLengthRatio: 0.98, trunkCurveV: 3,
    crownSpreadRatio: 0.30, crownShape: 'TEND_FLAME', ratioPower: 1.3,
    levels: [
      lvl({ count: 26, downAngle: 42, downAngleSlope: 25, downAngleV: 10, lengthRatio: 1, curve: 15, curveV: 8, curveRes: 5 }),
      lvl({ count: 8, downAngle: 40, lengthRatio: 0.6, curveV: 10, curveRes: 3, tropism: -0.25 }),
      lvl({ count: 6, downAngle: 30, lengthRatio: 0.5, curveV: 10, curveRes: 2, tropism: -0.9 }),
    ],
    jitterStrength: 0.06, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.012, leafAspect: 0.7,
    ...TIDY_STRUCTURE,
  },
  PINE: {
    trunkHeightRatio: 0.60, trunkBaseRadiusRatio: 0.011, trunkLengthRatio: 0.97, trunkCurveV: 3,
    crownSpreadRatio: 0.34, crownShape: 'UMBRELLA', ratioPower: 1.2,
    levels: [
      lvl({ count: 14, downAngle: 72, downAngleV: 12, lengthRatio: 1, curve: 35, curveV: 12, kink: 10, curveRes: 5 }),
      lvl({ count: 8, downAngle: 50, lengthRatio: 0.45, curve: 15, curveV: 12, kink: 10, curveRes: 3, tropism: 0.2 }),
      lvl({ count: 5, downAngle: 40, lengthRatio: 0.4, curveV: 12, kink: 10, curveRes: 2, tropism: 0.3 }),
    ],
    jitterStrength: 0.08, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.014, leafAspect: 0.18, leafClump: 9, trunkKink: 0, tipSpurs: false,
    ...TIDY_STRUCTURE,
  },
  SPRUCE: {
    trunkHeightRatio: 0.06, trunkBaseRadiusRatio: 0.012, trunkLengthRatio: 1.0, trunkCurveV: 1.5,
    crownSpreadRatio: 0.24, crownShape: 'CONICAL', ratioPower: 1.0,
    levels: [
      lvl({ count: 64, downAngle: 82, downAngleV: 6, lengthRatio: 1, lengthV: 0.1, curve: 8, curveV: 3, kink: 4, curveRes: 4, tropism: -0.15 }),
      lvl({ count: 9, downAngle: 55, downAngleV: 8, lengthRatio: 0.32, curveV: 4, kink: 4, curveRes: 2, tropism: -0.4 }),
    ],
    jitterStrength: 0.04, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.012, leafAspect: 0.18, leafClump: 7, trunkKink: 0, tipSpurs: false,
    ...TIDY_STRUCTURE,
  },
  POPLAR: {
    trunkHeightRatio: 0.10, trunkBaseRadiusRatio: 0.01, trunkLengthRatio: 1.0, trunkCurveV: 1.5,
    crownSpreadRatio: 0.16, crownShape: 'CYLINDRICAL', ratioPower: 1.2,
    levels: [
      lvl({ count: 32, downAngle: 26, downAngleV: 8, lengthRatio: 1, curve: 10, curveV: 4, kink: 5, curveRes: 4, tropism: 0.4 }),
      lvl({ count: 7, downAngle: 25, lengthRatio: 0.45, curveV: 6, kink: 5, curveRes: 2, tropism: 0.4 }),
      lvl({ count: 4, downAngle: 25, lengthRatio: 0.45, curveV: 8, kink: 5, curveRes: 2, tropism: 0.3 }),
    ],
    jitterStrength: 0.05, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.012, leafAspect: 0.7, leafDensity: 50, trunkKink: 0, tipSpurs: false,
    ...TIDY_STRUCTURE,
  },
  WILLOW: {
    trunkHeightRatio: 0.24, trunkBaseRadiusRatio: 0.015, trunkLengthRatio: 0.55, trunkCurveV: 7,
    crownSpreadRatio: 0.36, crownShape: 'HEMISPHERICAL', ratioPower: 1.2,
    levels: [
      lvl({ count: 7, downAngle: 40, downAngleSlope: 20, downAngleV: 12, lengthRatio: 1, curve: 15, curveV: 7, curveRes: 5, fork: 25 }),
      lvl({ count: 5, downAngle: 40, lengthRatio: 0.55, curveV: 10, curveRes: 4, tropism: -0.7 }),
      lvl({ count: 3, downAngle: 25, lengthRatio: 1.1, lengthV: 0.15, curveV: 3, curveRes: 4, tropism: -3.0 }),
    ],
    jitterStrength: 0.10, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.013, leafAspect: 0.25, leafClump: 6, leafDensity: 70,
    ...TIDY_STRUCTURE,
  },
  // Gatunki przeniesione z presetów ez-tree (github.com/dgreenheck/ez-tree, MIT): ash/aspen/bush_medium,
  // przeliczone na model obwiedni (kąty i proporcje rzędów; długości bezwzględne zastąpione obwiednią korony).
  ASH: {
    trunkHeightRatio: 0.26, trunkBaseRadiusRatio: 0.011, trunkLengthRatio: 0.9, trunkCurveV: 3,
    crownSpreadRatio: 0.34, crownShape: 'TEND_FLAME', ratioPower: 1.25,
    levels: [
      lvl({ count: 12, downAngle: 38, downAngleSlope: 22, downAngleV: 10, lengthRatio: 1, curve: 25, curveV: 8, curveRes: 6, fork: 22 }),
      lvl({ count: 6, downAngle: 55, lengthRatio: 0.5, curve: 15, curveV: 8, curveRes: 3, tropism: 0.15 }),
      lvl({ count: 4, downAngle: 45, lengthRatio: 0.5, curveV: 8, curveRes: 2, tropism: 0.2 }),
    ],
    jitterStrength: 0.06, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.016,
    ...TIDY_STRUCTURE,
  },
  ASPEN: {
    trunkHeightRatio: 0.50, trunkBaseRadiusRatio: 0.008, trunkLengthRatio: 1.0, trunkCurveV: 2,
    crownSpreadRatio: 0.22, crownShape: 'TEND_FLAME', ratioPower: 1.3,
    levels: [
      lvl({ count: 30, downAngle: 55, downAngleV: 12, lengthRatio: 1, curve: 25, curveV: 6, curveRes: 4, tropism: 0.2 }),
      lvl({ count: 7, downAngle: 32, lengthRatio: 0.55, curveV: 6, curveRes: 2, tropism: 0.25 }),
    ],
    jitterStrength: 0.04, flareFactor: 1.12, radialSegments: 4, leafSizeRatio: 0.013, leafAspect: 0.85, trunkKink: 1,
    ...TIDY_STRUCTURE,
  },
  BUSH: {
    trunkHeightRatio: 0.02, trunkBaseRadiusRatio: 0.014, trunkLengthRatio: 0.12, trunkCurveV: 2,
    crownSpreadRatio: 0.75, crownShape: 'HEMISPHERICAL', ratioPower: 1.1,
    levels: [
      lvl({ count: 14, downAngle: 26, downAngleV: 12, lengthRatio: 1, curve: -15, curveV: 7, curveRes: 5, fork: 26 }),
      lvl({ count: 5, downAngle: 50, lengthRatio: 0.45, curveV: 9, curveRes: 3 }),
      lvl({ count: 3, downAngle: 45, lengthRatio: 0.5, curveV: 10, curveRes: 2 }),
    ],
    jitterStrength: 0.05, flareFactor: 1.12, radialSegments: 3, leafSizeRatio: 0.036,
    ...TIDY_STRUCTURE,
  },
};

/** Względna wysokość w koronie, na której kształt obwiedni jest najszerszy (dla `crownPeak`) */
const CROWN_SHAPE_PEAK: Record<CrownShape, number> = {
  CONICAL: 0,
  SPHERICAL: 0.5,
  HEMISPHERICAL: 0,
  TEND_FLAME: 0.35,
  CYLINDRICAL: 1 / 2.2,
  OVOID_COLUMN: 0.6,
  UMBRELLA: 0.35 / 0.85,
};

/**
 * Kształt korony z przesuniętym maksimum: t odwzorowane odcinkami liniowo tak, by `peak` trafiało
 * w naturalne maksimum kształtu (nasada i wierzchołek bez zmian). Kształty z maksimum u nasady — bez przesunięcia.
 */
function crownRatio(shape: CrownShape, t: number, peak: number | undefined): number {
  const p0 = CROWN_SHAPE_PEAK[shape];
  if (peak === undefined || p0 <= 0 || peak <= 0 || peak >= 1 || t >= 1) return crownShapeRatio(shape, t);
  const u = t <= peak ? (t / peak) * p0 : p0 + ((t - peak) / (1 - peak)) * (1 - p0);
  return crownShapeRatio(shape, u);
}

function crownShapeRatio(shape: CrownShape, t: number): number {
  // t: 0 = dół korony, 1 = szczyt
  switch (shape) {
    case 'CONICAL': return 0.08 + 0.92 * (1 - t);
    case 'SPHERICAL': return t < 0.5 ? 0.25 + 0.75 * Math.sin(Math.PI * t) : Math.max(0.04, Math.sqrt(1 - (2 * t - 1) * (2 * t - 1)));
    case 'HEMISPHERICAL': return Math.max(0.04, Math.sqrt(1 - t * t));
    case 'TEND_FLAME': return t <= 0.35 ? 0.5 + 0.5 * (t / 0.35) : 0.1 + 0.9 * (1 - t) / 0.65;
    case 'CYLINDRICAL': return 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 1.1));
    case 'OVOID_COLUMN': {
      // Z wzorców fotograficznych jesionu (Fraxinus) — pokrój kolumnowo-jajowaty:
      // - t <= 0.20: płynne wejście od dołu korony (0.30 -> 0.85)
      // - t in [0.20, 0.60]: stabilna, pełna kolumna (0.85 -> 1.00)
      // - t > 0.60: łagodny łuk paraboliczny dochodzący do czubka (1.00 -> 0.06 przy t=1.0)
      if (t <= 0.20) return 0.30 + 0.55 * Math.sin((Math.PI / 2) * (t / 0.20));
      if (t <= 0.60) return 0.85 + 0.15 * Math.sin((Math.PI / 2) * ((t - 0.20) / 0.40));
      if (t <= 1.00) {
        const u = (t - 0.60) / 0.40;
        return Math.max(0.04, 1.0 - 0.94 * Math.pow(u, 1.8));
      }
      return Math.max(0, 0.04 * (1 - (t - 1.00) / 0.05));
    }
    case 'UMBRELLA': return 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.85));
  }
}

/**
 * Profil siatki dla szkieletu ez-tree: liczba rzędów (szczegółowość LOW pomija najdrobniejszy), przekrój tub,
 * odziomek i liście w naszej stylizacji. Parametry wzrostu naszego modelu nie są używane.
 */
export function ezMeshProfile(ez: EzTreeOptions): SpeciesProfile {
  const evergreen = ez.type === 'evergreen';
  return {
    trunkHeightRatio: 0.2, trunkBaseRadiusRatio: 0.012, trunkLengthRatio: 1, trunkCurveV: 0,
    crownSpreadRatio: 0.4, crownShape: 'SPHERICAL', ratioPower: 1.2,
    levels: Array.from({ length: ez.branch.levels }, () => lvl({ count: 0, downAngle: 0, lengthRatio: 1 })),
    jitterStrength: 0.06, flareFactor: 1.12, radialSegments: 4,
    leafSizeRatio: evergreen ? 0.014 : 0.016, leafAspect: evergreen ? 0.18 : 0.55, leafClump: evergreen ? 9 : 4,
  };
}

/**
 * 32-bitowy deterministyczny PRNG Mulberry32 o zerowym narzucie pamięciowym
 */
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

/** Rosnący bufor typowany (podwajanie pojemności) — bez boksowania liczb i konwersji przy budowie geometrii */
class GrowableBuffer<T extends Float32Array | Uint32Array> {
  length = 0;
  constructor(public a: T, private readonly make: (n: number) => T) {}
  push3(x: number, y: number, z: number) {
    if (this.length + 3 > this.a.length) {
      const next = this.make(this.a.length * 2);
      next.set(this.a);
      this.a = next;
    }
    const a = this.a, i = this.length;
    a[i] = x; a[i + 1] = y; a[i + 2] = z;
    this.length = i + 3;
  }
  /** Kopia wypełnionej części (bufor jest współdzielony między wywołaniami) */
  slice(): T {
    return this.a.slice(0, this.length) as T;
  }
}

/**
 * Bufor wielokrotnego użytku do szybkiej asemblacji siatek bez GC
 */
class MeshBufferBuilder {
  positions = new GrowableBuffer(new Float32Array(1 << 15), (n) => new Float32Array(n));
  normals = new GrowableBuffer(new Float32Array(1 << 15), (n) => new Float32Array(n));
  indices = new GrowableBuffer(new Uint32Array(1 << 15), (n) => new Uint32Array(n));
  groups: { start: number; count: number; materialIndex: number }[] = [];
  vertexCount = 0;

  minX = Infinity; maxX = -Infinity;
  minY = Infinity; maxY = -Infinity;
  minZ = Infinity; maxZ = -Infinity;

  reset() {
    this.positions.length = 0;
    this.normals.length = 0;
    this.indices.length = 0;
    this.groups.length = 0;
    this.vertexCount = 0;
    this.minX = Infinity; this.maxX = -Infinity;
    this.minY = Infinity; this.maxY = -Infinity;
    this.minZ = Infinity; this.maxZ = -Infinity;
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
      indices: this.vertexCount < 65536
        ? new Uint16Array(this.indices.a.subarray(0, this.indices.length))
        : this.indices.slice(),
      groups: this.groups.map((g) => ({ ...g })),
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


/**
 * Pęd (pień, konar, gałąź, witka) jako ciągła łamana z promieniami w węzłach.
 * Tuby budowane są z pierścieni współdzielonych między segmentami — brak szczelin na zgięciach.
 */
export interface Stem {
  level: number;
  px: number[]; py: number[]; pz: number[];
  r: number[];
  length: number;
  clipped: boolean; // pęd ucięty na obwiedni korony (bez rozwidlenia końcowego)
}

/** Szkielet drzewa niezależny od szczegółowości siatki */
export interface TreeSkeleton {
  species: TreeSpecies;
  profile: SpeciesProfile;
  seed: number;
  stems: Stem[];
  scale: number;   // skala nominalna → metry
  height: number;
  /** Miejsca kępek liści (x, y, z, kierunek dx, dy, dz) ze wzrostu ez-tree; brak = rozmieszczenie na witkach */
  leafSites?: number[];
  /** Promienie ciągłe między rzędami (model rur) — kreska bez mnożników rzędów, tylko wygładzenie i odziomek */
  uniformStroke?: boolean;
}

const DEG = Math.PI / 180;
// Sześciokąt liścia: pary (wzdłuż, w poprzek/w) — nasada, dwa boki, czubek
const LEAF_HEX = [0, 0, 0.3, 1, 0.75, 0.8, 1, 0, 0.75, -0.8, 0.3, -1] as const;
const GNARL_REF_RADIUS = 0.008; // promień nominalny, poniżej którego pęd zaczyna się wichrować
const GNARL_MAX = 3;
/** Tablice cos/sin przekroju tuby dla 3–8 boków */
const RING_COS: Float64Array[] = [];
const RING_SIN: Float64Array[] = [];
for (let n = 3; n <= 8; n++) {
  RING_COS[n] = new Float64Array(n); RING_SIN[n] = new Float64Array(n);
  for (let j = 0; j < n; j++) { RING_COS[n][j] = Math.cos((j / n) * Math.PI * 2); RING_SIN[n][j] = Math.sin((j / n) * Math.PI * 2); }
}
const ENVELOPE_FILL = 0.95; // promień obwiedni / zasięg konarów
const MIN_RADIUS_RATIO = 0.0009; // najcieńsza witka / wysokość
export const DEFAULT_LEAF_DENSITY = 38;
// Szkielet ez-tree: promień pnia przy gruncie / wysokość (wzorzec SA_Artboard2: pień ~3,6% wysokości) i najcieńsza końcówka
const EZ_TRUNK_RADIUS = 0.018;
const EZ_TIP_RADIUS = 0.0011; // kępek na jednostkę długości witki (skala nominalna)
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // 137,5°
const GOLDEN_JITTER = 0.25;      // rozrzut azymutu przy złotym kącie (rad)
const OUTWARD_MAX_DOWN = 80 * DEG;
const PRUNE_MIN_FRACTION = 0.12; // pęd mieszczący się w obwiedni na mniejszym ułamku nie rośnie
const PRUNE_MARGIN = 0.94;       // zapas na falowanie (oś symulowana bez niego)
const GROUND_CLEARANCE = 0.04;   // najniższy punkt gałęzi przy przycinaniu (ułamek wysokości)
/** Górna granica promienia pędu w kresce względem nasady pnia, wg rzędu (da Vinci / Weber–Penn): pień, konary, gałęzie, witki */
const STROKE_LEVEL_CAP = [Infinity, 0.45, 0.22, 0.09] as const;
/** Sufit obwiedni (wysokość drzewa i względne położenie w koronie) — także dla pędów z przełamaniem obwiedni */
const ENVELOPE_CEILING = 1.02;
/** Przełamanie obwiedni (bypassRadial) poszerza ją tylko radialnie o ten mnożnik */
const ENVELOPE_RADIAL_BYPASS = 1.25;

/**
 * Miękkie ograniczenie promienia: do 70% limitu bez zmian, powyżej wykładniczo dochodzi do limitu —
 * pędy grubsze od limitu zachowują kolejność grubości zamiast spłaszczać się do jednej wartości.
 */
function softCap(v: number, cap: number): number {
  const knee = 0.7 * cap;
  if (!(v > knee)) return v;
  const span = cap - knee;
  return cap - span * Math.exp(-(v - knee) / span);
}
const SAG_REF_SLENDERNESS = 60;  // smukłość L/r, przy której ugięcie = pliancy
const SAG_MAX_SLENDERNESS = 4;   // ograniczenie mnożnika smukłości (bardzo cienkie witki)

/**
 * Proceduralny generator drzew (TreeGenerator) — model rekurencyjny Webera–Penna
 * („Creation and Rendering of Realistic Trees”, SIGGRAPH 1995):
 * obwiednia korony, wygięcie i tropizm pędów, filotaksja (przetasowane sloty albo złoty kąt),
 * promienie wg reguły rur (da Vinci). Stylistyka: rysunek architektoniczny (low-poly tuby).
 */
export class TreeGenerator {
  private static sharedBuilder = new MeshBufferBuilder();
  /** Profil, którego obwiednia korony przycina pędy w trakcie wzrostu (null = pień, bez przycinania) */
  private static envelopeProfile: SpeciesProfile | null = null;
  private static envelopeDisabled = false;
  private static envelopeBase = 0;
  private static envelopeInvH = 1;
  private static envelopeSpread = 0;
  private static envelopeShape: CrownShape = 'SPHERICAL';
  private static envelopePeak: number | undefined = undefined;

  /**
   * Obwiednia korony w skali nominalnej: bryła obrotowa od podstawy korony do szczytu (y = 1),
   * promień = crownSpreadRatio · ENVELOPE_FILL · kształt(t). Jak w rysunku odręcznym:
   * najpierw kontur korony, potem gałęzie od dużych do małych — końce witek dochodzą do konturu.
   */
  private static insideEnvelope(x: number, y: number, z: number): boolean {
    return !TreeGenerator.isOutsideEnvelope(x, y, z, false);
  }

  /**
   * Sprawdza czy punkt wychodzi poza dopuszczalną przestrzeń korony:
   * - Sufit pionowy (`ENVELOPE_CEILING`) oraz prześwit od gruntu są BEZWZGLĘDNE (zawsze aktywne, chronią skalę wysokości drzewa).
   * - Ograniczenie radialne (promień boczny) może być probabilistycznie pominięte (bypassRadial) na drobnych gałęziach.
   */
  private static isOutsideEnvelope(x: number, y: number, z: number, bypassRadial = false): boolean {
    if (!TreeGenerator.envelopeProfile) return false;
    if (y > ENVELOPE_CEILING) return true;
    if (y < TreeGenerator.groundClearance) return true;
    if (TreeGenerator.envelopeDisabled) return false;
    const t = Math.max(0, (y - TreeGenerator.envelopeBase) * TreeGenerator.envelopeInvH);
    if (t > ENVELOPE_CEILING) return true;
    const R0 = TreeGenerator.envelopeSpread * crownRatio(TreeGenerator.envelopeShape, t, TreeGenerator.envelopePeak);
    // Probabilistyczne przełamanie obwiedni pozwala witkom wyjść o +25% poza sferę,
    // eliminując sztuczny efekt przycięcia od cyrkla, zapobiegając jednocześnie niekontrolowanemu rozrostowi.
    const R = bypassRadial ? R0 * ENVELOPE_RADIAL_BYPASS : R0;
    return x * x + z * z > R * R;
  }

  /**
   * Generuje zoptymalizowaną geometrię BufferGeometry dla wskazanego gatunku i wysokości
   */
  static generateRaw(params: TreeGenerationParams): TreeRawGeometryResult {
    return TreeGenerator.meshSkeletonRaw(TreeGenerator.buildSkeleton(params), params);
  }

  /**
   * Szkielet drzewa (cała losowość kształtu). Jak w ez-tree: szkielet nie zależy od LOD,
   * więc jedno drzewo można zsiatkować w kilku szczegółowościach bez zmiany sylwetki.
   */
  static buildSkeleton(params: TreeGenerationParams): TreeSkeleton {
    const species = params.species;
    const height = Math.max(0.1, params.height);
    const profile = params.profile ?? SPECIES_PROFILES[species];
    const seed = params.seed ?? (Math.floor(height * 100) + species.charCodeAt(0) * 31);
    if (params.ez) return TreeGenerator.buildEzSkeleton(params, params.ez, seed, height);
    const stems: Stem[] = [];
    TreeGenerator.flow = params.flow ?? false;
    TreeGenerator.asymAz = (((seed * 0.6180339887) % 1) + 1) % 1 * Math.PI * 2;
    TreeGenerator.growTree(profile, new FastPrng(seed), stems, params.form ?? 'SINGLE');

    let maxY = 0;
    for (const s of stems) for (const y of s.py) if (y > maxY) maxY = y;
    return { species, profile, seed, stems, scale: height / Math.max(1e-6, maxY), height };
  }

  /**
   * Szkielet ze wzrostu ez-tree, przeliczony do skali nominalnej (wysokość = 1), jak szkielety naszego modelu:
   * dalej siatkuje go `meshSkeleton` w naszej stylizacji. Profil (jawny albo `ezMeshProfile`) steruje tylko siatką.
   */
  private static buildEzSkeleton(params: TreeGenerationParams, ez: EzTreeOptions, seed: number, height: number): TreeSkeleton {
    const profile = params.profile ?? ezMeshProfile(ez);
    const sk = growEzTree(ez, seed, params.form ?? 'SINGLE', params.flow ?? false);
    const { stems, leafSites } = sk;
    // Model rur z końcówkami o promieniu 1, potem skala: pnie od gruntu razem = EZ_TRUNK_RADIUS (wzorzec SA_Artboard2)
    const p = ez.pipeExponent ?? 2.5;
    applyPipeRadii(sk, p, 1);
    let rootSum = 0;
    for (let i = 0; i < stems.length; i++) if (sk.parents[i] < 0) rootSum += Math.pow(stems[i].r[0], p);
    let maxY = 1e-6;
    for (const s of stems) for (const y of s.py) if (y > maxY) maxY = y;
    const k = 1 / maxY;
    const kr = EZ_TRUNK_RADIUS / Math.pow(Math.max(1e-9, rootSum), 1 / p);
    for (const s of stems) {
      for (let i = 0; i < s.px.length; i++) { s.px[i] *= k; s.py[i] *= k; s.pz[i] *= k; s.r[i] = Math.max(EZ_TIP_RADIUS, s.r[i] * kr); }
      s.length *= k;
      if (s.level === 0 && s.py[0] < 1e-6) s.r[0] *= profile.flareFactor;
    }
    const sites: number[] = [];
    for (let i = 0; i < leafSites.length; i += 7) sites.push(leafSites[i] * k, leafSites[i + 1] * k, leafSites[i + 2] * k, leafSites[i + 3], leafSites[i + 4], leafSites[i + 5]);
    return { species: params.species, profile, seed, stems, scale: height, height, leafSites: sites, uniformStroke: true };
  }

  /** Siatka szkieletu w zadanej szczegółowości (nie zmienia kształtu) */
  static meshSkeletonRaw(skeleton: TreeSkeleton, params: Pick<TreeGenerationParams, 'radialSegments' | 'withFoliageAccents' | 'detail' | 'stroke'>): TreeRawGeometryResult {
    const { species, profile, stems, scale, height } = skeleton;
    // Osobny PRNG siatki: jitter przekroju nie zużywa losowości szkieletu
    const prng = new FastPrng(skeleton.seed ^ 0x9e3779b9);
    const radialSegs = Math.max(3, Math.min(8, params.radialSegments ?? profile.radialSegments ?? 4));
    const withFoliage = params.withFoliageAccents ?? false;
    const detail = params.detail ?? 'HIGH';
    const deepest = profile.levels.length;
    const ringStride = detail === 'HIGH' ? 1 : 2;
    const maxLevel = detail === 'LOW' ? Math.max(1, deepest - 1) : deepest;

    // Ciągłe tuby (pień pełną liczbą boków, drobne pędy trójkątne)
    const builder = TreeGenerator.sharedBuilder;
    builder.reset();
    const trunkBaseR = TreeGenerator.trunkBaseRadius(stems);
    const baseStroke = params.stroke && skeleton.uniformStroke ? { ...params.stroke, levelScale: [1] } : params.stroke;
    const twig = profile.twigStroke ?? 1;
    const stroke = baseStroke && twig !== 1 ? { ...baseStroke, levelScale: baseStroke.levelScale.map((k, i) => (i >= 2 ? k * twig : k)) } : baseStroke;
    for (const s of stems) {
      if (s.level > maxLevel) continue;
      const sides = s.level === 0 ? radialSegs : (s.level === 1 && detail === 'HIGH' ? radialSegs : 3);
      TreeGenerator.extrudeStem(stroke ? TreeGenerator.strokeStem(s, stroke, height / scale, trunkBaseR) : s, scale, sides, s.level >= 2 ? 0 : profile.jitterStrength, s.level === 0 ? 1 : ringStride, prng, builder);
    }
    const trunkIndicesCount = builder.indices.length;
    builder.addGroup(0, trunkIndicesCount, 0);

    // Opcjonalne obłoki korony na końcach najdrobniejszych pędów
    if (withFoliage) {
      TreeGenerator.addLeaves(stems, scale, profile, prng, builder, trunkIndicesCount, skeleton.leafSites);
    }

    const mesh = builder.buildRawMesh();

    const actualHeight = builder.maxY > builder.minY ? builder.maxY - builder.minY : height;
    const maxCrownDistSq = Math.max(
      builder.minX * builder.minX + builder.minZ * builder.minZ,
      builder.maxX * builder.maxX + builder.maxZ * builder.maxZ
    );
    const crownRadius = Math.max(0.5, Math.sqrt(maxCrownDistSq));

    return { mesh, bounds: { height: actualHeight, crownRadius } };
  }

  /** Pień + rekurencyjne rzędy gałęzi w skali nominalnej (wysokość ≈ 1) */
  private static growTree(profile: SpeciesProfile, prng: FastPrng, out: Stem[], form: TrunkForm) {
    TreeGenerator.envelopeProfile = profile;
    TreeGenerator.envelopeDisabled = !!profile.disableEnvelope;
    TreeGenerator.envelopeBase = profile.trunkHeightRatio;
    TreeGenerator.envelopeInvH = 1 / Math.max(1e-6, 1 - profile.trunkHeightRatio);
    TreeGenerator.envelopeSpread = profile.crownSpreadRatio * (profile.envelopeScale ?? 1.0) * ENVELOPE_FILL;
    TreeGenerator.envelopeShape = profile.crownShape;
    TreeGenerator.envelopePeak = profile.crownPeak;
    TreeGenerator.trunkCountScale = 1;
    TreeGenerator.clipLeaders = form !== 'SINGLE' || !!profile.scaffoldLimbs;
    TreeGenerator.leaderTropism = 2.2;
    const L = profile.trunkLengthRatio, R0 = profile.trunkBaseRadiusRatio;

    if (form === 'MULTI') {
      // Kilka pni z jednego odziomka; każdy cieńszy (suma przekrojów ≈ pień pojedynczy) i rozchylony
      const n = 3 + Math.floor(prng.next() * 3);
      TreeGenerator.growLeaders(n, 0, R0, 16, 12, L * 0.72, L * 0.2, profile, prng, out);
    } else if (form === 'SINGLE' && profile.scaffoldLimbs) {
      // Pokrój rozpierzchły: krótki pień do nasady korony, z niej konary główne rozchylone szerzej niż pnie MULTI
      const baseY = profile.trunkHeightRatio;
      out.push({ level: 0, px: [0, 0], py: [0, baseY], pz: [0, 0], r: [R0, R0 * 0.9], length: baseY, clipped: false });
      const n = profile.scaffoldLimbs + (prng.next() < 0.5 ? 0 : 1);
      // Konary główne rosną łukiem na zewnątrz — słaby fototropizm, inaczej prostują się w miotłę
      TreeGenerator.leaderTropism = 0.5;
      TreeGenerator.growLeaders(n, baseY, R0 * 0.9, 28, 18, (1 - baseY) * 0.85, (1 - baseY) * 0.25, profile, prng, out);
    } else if (form === 'FORKED') {
      // Krótki pień bez gałęzi, potem dwa przewodniki rozchylone o ±(14–22)°
      // Losowanie zawsze — profil z jawnym trunkForkHeightRatio nie przesuwa strumienia PRNG
      const forkYRand = Math.min(profile.trunkHeightRatio * 0.9, 0.18 + prng.next() * 0.17);
      const forkY = profile.trunkForkHeightRatio ?? forkYRand;
      // Pień lekko przechylony (2–5°); widełki niesymetryczne: przewodnik główny bliżej pionu i grubszy,
      // boczny odchylony mocniej i cieńszy (suma przekrojów ≈ przekrój pnia)
      const az0 = prng.range(0, Math.PI * 2);
      const lean = (2 + prng.next() * 3) * DEG * (profile.trunkLeanScale ?? 1);
      const tx = Math.sin(lean) * Math.cos(az0), tz = Math.sin(lean) * Math.sin(az0), ty = Math.cos(lean);
      const rTop = R0 * 0.8;
      out.push({ level: 0, px: [0, tx * forkY * 0.5, tx * forkY], py: [0, ty * forkY * 0.5, ty * forkY], pz: [0, tz * forkY * 0.5, tz * forkY],
        r: [R0, R0 * 0.9, rTop], length: forkY, clipped: false });
      TreeGenerator.trunkCountScale = 0.7;
      // Przewodnik boczny odchodzący płasko skręca ku pionowi szybciej (kandelabr starej topoli)
      if (profile.trunkForkTropism !== undefined) TreeGenerator.leaderTropism = profile.trunkForkTropism;
      const spread = (profile.trunkForkAngle ?? 32) * (0.85 + prng.next() * 0.3);
      const asym = Math.min(1, Math.max(0, profile.trunkForkAsymmetry ?? 0));
      const leaders = [
        { az: az0 + Math.PI, angle: spread * (0.35 - 0.25 * asym) * (profile.trunkForkMainAngleScale ?? 1), len: 1.0, r: rTop * (0.82 + 0.08 * asym) },
        { az: az0 + prng.signedRange(0.5), angle: spread * (0.7 + 0.3 * asym), len: (0.85 + prng.next() * 0.1) * (profile.trunkForkSideLength ?? 1 - 0.3 * asym), r: rTop * (profile.trunkForkSideRadius ?? 0.72 - 0.25 * asym) },
      ];
      for (const ld of leaders) {
        TreeGenerator.splitDir(tx, ty, tz, ld.az, ld.angle * DEG);
        const [dx, dy, dz] = TreeGenerator.tmp;
        TreeGenerator.growBranch(0, tx * forkY, ty * forkY, tz * forkY, dx, dy, dz, (L - forkY) * ld.len,
          ld.r, profile, prng, out);
      }
    } else {
      TreeGenerator.growBranch(0, 0, 0, 0, 0, 1, 0, L, R0, profile, prng, out);
    }
    // Odziomek: rozszerzenie pierwszego pierścienia pni wychodzących z gruntu
    for (const s of out) if (s.level === 0 && s.py[0] < 1e-6) s.r[0] *= profile.flareFactor;
  }

  /**
   * Kilka przewodników z jednego punktu (y = oy): rozchylonych wachlarzowo o lean0 + [0, leanV]°,
   * cieńszych tak, by suma przekrojów ≈ przekrój pnia pod nimi; konary dzielą koronę między siebie.
   */
  private static growLeaders(
    n: number, oy: number, r: number, lean0: number, leanV: number, len0: number, lenV: number,
    profile: SpeciesProfile, prng: FastPrng, out: Stem[]
  ) {
    TreeGenerator.trunkCountScale = Math.pow(n, -0.55);
    const az0 = prng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const lean = (lean0 + prng.next() * leanV) * DEG;
      const az = az0 + (i / n) * Math.PI * 2 + prng.signedRange(0.4);
      const dx = Math.sin(lean) * Math.cos(az), dz = Math.sin(lean) * Math.sin(az), dy = Math.cos(lean);
      const off = r * 0.8;
      TreeGenerator.growBranch(0, Math.cos(az) * off, oy, Math.sin(az) * off, dx, dy, dz,
        len0 + prng.next() * lenV, r * Math.pow(n, -0.5) * 1.1, profile, prng, out);
    }
  }

  /** Kierunek wydłużonej strony korony (`crownAsymmetry`) — z ziarna drzewa, bez zużycia PRNG */
  private static asymAz = 0;
  /** Fototropizm pochylonych przewodników (pnie MULTI/FORKED prostują się ku górze, konary główne słabiej) */
  private static leaderTropism = 2.2;
  /** Przewodniki (pnie wielokrotne, konary główne) też są przycinane obwiednią korony */
  private static clipLeaders = false;
  /** Mnożnik liczby konarów na pień (pnie wielokrotne dzielą koronę) */
  private static trunkCountScale = 1;
  /** Najniższy dopuszczalny punkt bieżącego pędu (ustawiany w growBranch) */
  private static groundClearance = -Infinity;
  /** Tryb płynnych gałązek (B2) */
  private static flow = false;

  /**
   * Wzrost jednego pędu razem z planem jego odgałęzień (model sympodialny, wzorzec drawism):
   * - węzły łamanej leżą w punktach odgałęzień — między nimi pęd jest prosty,
   * - w węźle pęd macierzysty załamuje się w stronę przeciwną do dziecka (kąt ∝ r_dziecka / r_rodzica),
   * - promień maleje skokowo wg reguły rur: r'² = r² − k·r_dziecka²,
   * - na końcu: rozwidlenie „Y” (fork) albo para drobnych ostróg na najdrobniejszych witkach.
   * Pęd wychodzący poza obwiednię korony jest ucinany na niej (dzieci za punktem cięcia odpadają).
   */
  private static growBranch(
    level: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
    length: number, r0: number, profile: SpeciesProfile, prng: FastPrng, out: Stem[]
  ) {
    const isTrunk = level === 0;
    const p: BranchLevelParams = isTrunk
      ? { count: 0, downAngle: 0, downAngleV: 0, lengthRatio: 1, lengthV: 0, curve: 0, curveV: profile.trunkCurveV, curveRes: 10, tropism: Math.abs(dy) < 0.97 ? TreeGenerator.leaderTropism : 0.3, fork: 0, kink: profile.trunkKink ?? 3 }
      : profile.levels[level - 1];
    const cp = profile.levels[level]; // parametry dzieci (undefined = najdrobniejszy rząd)
    const deepest = profile.levels.length;
    const clipProb = profile.envelopeClipProbability ?? 1.0;
    // Konary szkieletowe (level < deepest - 1) zawsze trzymają obwiednię korony.
    // Drobne pędy peryferyjne (level >= deepest - 1) mogą probabilistycznie omijać cięcie boczne (z marginesem +20%),
    // lecz sufit pionowy (y <= 1.01) oraz prześwit gruntu obowiązują je ZAWSZE.
    const bypassRadial = !isTrunk && level >= deepest - 1 && clipProb < 1.0 && TreeGenerator.stemHash(ox, oy, oz, level) >= clipProb;

    // Grunt jako granica obwiedni: tylko dla gałęzi wyrastających ponad próg (pnie i krzewy od gruntu bez zmian)
    TreeGenerator.groundClearance = profile.prune && !isTrunk && oy > GROUND_CLEARANCE ? GROUND_CLEARANCE : -Infinity;
    let pruneFactor = 1;
    if (profile.prune && (!isTrunk || TreeGenerator.clipLeaders)) {
      // Przycinanie (Weber–Penn): pęd razem z planem dzieci skraca się tak, by jego oś (bez falowania) zmieściła się
      // w obwiedni; promień maleje wg reguły rur. Pęd, który mieści się tylko szczątkowo, w ogóle nie rośnie.
      const f0 = TreeGenerator.pruneFraction(ox, oy, oz, dx, dy, dz, length, p, TreeGenerator.stemTropism(p, r0), isTrunk ? 0 : TreeGenerator.stemSag(profile, length, r0), bypassRadial);
      if (f0 < 1) {
        if (f0 < PRUNE_MIN_FRACTION && !isTrunk) return;
        const r1 = r0 * Math.pow(Math.max(PRUNE_MIN_FRACTION, f0), profile.ratioPower);
        const f = Math.min(f0, TreeGenerator.pruneFraction(ox, oy, oz, dx, dy, dz, length, p, TreeGenerator.stemTropism(p, r1), isTrunk ? 0 : TreeGenerator.stemSag(profile, length, r1), bypassRadial));
        pruneFactor = f;
        // Te najbardziej docięte (małe f) generowane jako cieńsze i krótsze:
        // wycofują się łagodnie w głąb korony, dając margines na naturalne zakończenie i gałązki zamiast tępego ucięcia na obwiedni.
        const suppression = Math.pow(Math.max(PRUNE_MIN_FRACTION, f), 0.35);
        const k = Math.max(PRUNE_MIN_FRACTION, f * suppression) * PRUNE_MARGIN;
        length *= k;
        r0 = Math.max(MIN_RADIUS_RATIO, r0 * Math.pow(k, profile.ratioPower) * suppression);
      }
    }

    // Złamany konar: tępe zakończenie w 35–70% długości (los z pozycji — strumień PRNG bez zmian)
    let breakT = Infinity;
    if (level === 1 && profile.limbBreakProbability) {
      const hb = TreeGenerator.stemHash(oz, ox, oy, 7);
      if (hb < profile.limbBreakProbability) breakT = 0.35 + 0.35 * (hb / profile.limbBreakProbability);
    }

    // 1. Plan dzieci: pozycja t, azymut, długość (rozkład warstwowy z przetasowanym azymutem — ez-tree)
    const plan: { t: number; az: number; len: number; down: number; reach?: boolean }[] = [];
    if (cp) {
      // Pień: pierwsze konary od wysokości trunkHeightRatio liczonej od gruntu (przewodniki po rozwidleniu startują wyżej)
      const base = isTrunk ? Math.max(0.03, (profile.trunkHeightRatio - oy) / Math.max(1e-6, length)) : (cp.baseSize ?? 0.1);
      const count = isTrunk
        ? Math.max(2, Math.round(cp.count * TreeGenerator.trunkCountScale))
        : Math.max(1, Math.round(cp.count * (0.25 + 0.75 * Math.min(1, length / TreeGenerator.levelRefLength(profile, level)))));
      const golden = profile.phyllotaxis === 'golden';
      const rot = cp.rotate !== undefined ? cp.rotate * DEG : golden ? GOLDEN_ANGLE : null;
      const rotJitter = cp.rotateV !== undefined ? cp.rotateV * DEG : GOLDEN_JITTER;
      const slots = rot !== null ? null : TreeGenerator.shuffledSlots(count, prng);
      const azOffset = prng.next();
      for (let i = 0; i < count; i++) {
        const t = Math.min(0.97, base + (1 - base) * (i + 0.15 + prng.next() * 0.7) / count);
        const az = slots
          ? 2 * Math.PI * (azOffset + (slots[i] + prng.signedRange(0.4)) / count)
          : 2 * Math.PI * azOffset + i * rot! + prng.signedRange(rotJitter);
        let len: number;
        if (isTrunk) {
          len = profile.crownSpreadRatio * crownRatio(profile.crownShape, (t - base) / Math.max(1e-6, 1 - base), profile.crownPeak);
        } else {
          len = cp.lengthRatio * length * (1 - 0.6 * t);
        }
        len *= 1 + prng.signedRange(cp.lengthV);
        // Bryła asymetryczna: konary wydłużone po stronie kierunku drzewa, skrócone po przeciwnej (±crownAsymmetry)
        if (isTrunk && profile.crownAsymmetry) len *= 1 + profile.crownAsymmetry * Math.cos(az - TreeGenerator.asymAz);
        if (len < 0.004) continue;
        const tRel = (t - base) / Math.max(1e-6, 1 - base);
        const down = cp.downAngle + (cp.downAngleSlope ?? 0) * (1 - tRel) + prng.signedRange(cp.downAngleV);
        plan.push({ t, az, len, down: Math.min(110, down) * DEG, reach: isTrunk && !!profile.limbsReachEnvelope });
      }
    }

    // 2. Węzły: punkty odgałęzień + siatka curveRes (dla długich odcinków bez dzieci)
    const res = Math.max(1, TreeGenerator.flow && !isTrunk ? p.curveRes * 2 : p.curveRes);
    const ts: number[] = [];
    for (let i = 1; i <= res; i++) ts.push(i / res);
    for (const c of plan) ts.push(c.t);
    ts.sort((a, b) => a - b);

    const gnarl = Math.min(GNARL_MAX, Math.max(1, Math.sqrt(GNARL_REF_RADIUS / Math.max(1e-6, r0))));
    const flow = TreeGenerator.flow;
    const wobble = p.curveV * DEG * (1 + (gnarl - 1) * (profile.twigGnarl ?? 1)) * (flow ? 0.45 : 1);
    const trop = TreeGenerator.stemTropism(p, r0);
    const kinkMax = flow ? 0 : (p.kink ?? 15) * DEG * (isTrunk ? 1 : (profile.kinkScale ?? 1));
    const outward = isTrunk ? 0 : (profile.outwardBias ?? 0);
    const sag = isTrunk ? 0 : TreeGenerator.stemSag(profile, length, r0);
    const tipRatioBase = isTrunk ? (profile.trunkTipRatio ?? 0.3) : (p.tipRatio ?? (p.fork > 0 ? 0.35 : 0.22));
    const tipRatio = isTrunk ? tipRatioBase : Math.max(0.12, tipRatioBase * (pruneFactor < 1 ? Math.pow(pruneFactor, 0.35) : 1));

    const stem: Stem = { level, px: [ox], py: [oy], pz: [oz], r: [r0], length, clipped: false };
    let x = ox, y = oy, z = oz, r = r0;
    // Zygzak: załamanie w węźle odchyla tylko następny odcinek, kierunek główny pędu zostaje
    let kx = 0, ky = 0, kz = 0;
    let tPrev = 0, pi = 0;
    const children: { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number; len: number; r: number }[] = [];
    // Plan posortowany po t (dopasowanie do węzłów)
    plan.sort((a, b) => a.t - b.t);

    for (let k = 0; k < ts.length; k++) {
      const t = ts[k];
      const dt = t - tPrev;
      if (t > breakT + 1e-9) {
        stem.length = length * tPrev;
        break;
      }
      if (dt >= 1e-5) {
        const step = dt * length;
        // Wygięcie (curve) i tropizm proporcjonalnie do długości odcinka, falowanie na węzeł
        const hl = Math.sqrt(dx * dx + dz * dz);
        // curveBack: `curve` na pierwszej połowie, `curveBack` na drugiej (każde jako łączny kąt swojej połowy)
        const bend = p.curveBack === undefined ? p.curve : 2 * (tPrev + dt * 0.5 < 0.5 ? p.curve : p.curveBack);
        if (hl > 1e-4 && bend !== 0) {
          const el = Math.atan2(dy, hl) + bend * DEG * dt * (TreeGenerator.flow ? 1.5 : 1);
          const ce = Math.cos(el);
          dx = (dx / hl) * ce; dz = (dz / hl) * ce; dy = Math.sin(el);
        }
        if (sag > 0) {
          // Wiotkość: ugięcie pod ciężarem (dzieci dziedziczą kierunek, więc ugięcie rodzica przenosi się dalej)
          TreeGenerator.applySag(dx, dy, dz, sag * dt);
          dx = TreeGenerator.tmp[0]; dy = TreeGenerator.tmp[1]; dz = TreeGenerator.tmp[2];
        }
        if (wobble > 0) {
          TreeGenerator.perturb(dx, dy, dz, wobble * Math.sqrt(dt * res), prng);
          dx = TreeGenerator.tmp[0]; dy = TreeGenerator.tmp[1]; dz = TreeGenerator.tmp[2];
        }
        dy += trop * dt;
        const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= dl; dy /= dl; dz /= dl;

        let sdx = dx, sdy = dy, sdz = dz;
        if (kx !== 0 || ky !== 0 || kz !== 0) {
          sdx += kx; sdy += ky; sdz += kz;
          const sl0 = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz) || 1; sdx /= sl0; sdy /= sl0; sdz /= sl0;
          kx = 0; ky = 0; kz = 0;
        }
        let nx = x + sdx * step, ny = y + sdy * step, nz = z + sdz * step;
        if ((!isTrunk || TreeGenerator.clipLeaders) && TreeGenerator.isOutsideEnvelope(nx, ny, nz, bypassRadial)) {
          let lo = 0, hi = 1;
          for (let b = 0; b < 4; b++) {
            const m = (lo + hi) * 0.5;
            if (!TreeGenerator.isOutsideEnvelope(x + sdx * step * m, y + sdy * step * m, z + sdz * step * m, bypassRadial)) lo = m; else hi = m;
          }
          stem.clipped = true;
          if (lo > 0.05) {
            x += sdx * step * lo; y = Math.max(0.01, y + sdy * step * lo); z += sdz * step * lo;
            stem.px.push(x); stem.py.push(y); stem.pz.push(z);
            stem.r.push(Math.max(MIN_RADIUS_RATIO * 0.6, Math.min(r * 0.5, r0 * 0.10)));
          }
          stem.length = length * (tPrev + dt * lo);
          break;
        }
        x = nx; y = Math.max(0.01, ny); z = nz;
        // Zbieżność liniowa ku końcowi (obok skokowej, poniżej)
        r = Math.max(MIN_RADIUS_RATIO * 0.6, Math.min(r, r0 * (1 - t * (1 - tipRatio))));
        stem.px.push(x); stem.py.push(y); stem.pz.push(z); stem.r.push(r);
        tPrev = t;
      }

      // Dziecko w tym węźle
      while (pi < plan.length && plan[pi].t <= t + 1e-9) {
        const c = plan[pi++];
        // Kierunek dziecka: odchylenie o down od osi rodzica, azymut az
        let ax: number, ay: number, az: number;
        if (Math.abs(dy) < 0.9) { ax = -dz; ay = 0; az = dx; } else { ax = 0; ay = dz; az = -dy; }
        const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
        const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
        let azc = c.az, down = c.down;
        if (outward > 0) {
          // Plagiotropia: azymut ściągany ku kierunkowi „od osi drzewa” (rzut na płaszczyznę prostopadłą do rodzica)
          const rh = Math.hypot(x, z);
          if (rh > 1e-4) {
            const ua = (ax * x + az * z) / rh, ub = (bx * x + bz * z) / rh;
            if (Math.hypot(ua, ub) > 0.2) {
              const azU = Math.atan2(ub, ua);
              let d = (c.az - azU) % (2 * Math.PI);
              if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
              azc = azU + d * (1 - outward);
            }
          }
          down = Math.min(down, OUTWARD_MAX_DOWN);
        }
        const ca = Math.cos(azc), sa = Math.sin(azc);
        const sx = ax * ca + bx * sa, sy = ay * ca + by * sa, sz = az * ca + bz * sa;
        const cd = Math.cos(down), sd = Math.sin(down);
        const cx = dx * cd + sx * sd, cy = dy * cd + sy * sd, cz = dz * cd + sz * sd;

        if (c.reach) {
          // Konar do konturu: marsz wzdłuż kierunku (z uwzględnieniem wygięcia ku górze) aż do obwiedni
          const curveUp = (cp?.curve ?? 0) * DEG;
          let mx = x, my = y, mz = z, ddx = cx, ddy = cy, ddz = cz, dist = 0;
          const stepL = 0.01;
          for (let it = 0; it < 300; it++) {
            const nx2 = mx + ddx * stepL, ny2 = my + ddy * stepL, nz2 = mz + ddz * stepL;
            if (!TreeGenerator.insideEnvelope(nx2, ny2, nz2) || ny2 < 0.02) break;
            mx = nx2; my = ny2; mz = nz2; dist += stepL;
            const hl2 = Math.hypot(ddx, ddz);
            if (hl2 > 1e-4) { const el = Math.atan2(ddy, hl2) + curveUp * stepL / Math.max(0.05, c.len); const ce = Math.cos(el); ddx = ddx / hl2 * ce; ddz = ddz / hl2 * ce; ddy = Math.sin(el); }
          }
          c.len = Math.max(0.02, dist * (0.85 + prng.next() * 0.10));
        }
        const rc = Math.max(MIN_RADIUS_RATIO, Math.min(r * 0.85, r * Math.pow(c.len / Math.max(1e-6, length), profile.ratioPower) * (TreeGenerator.flow ? 1.15 : 1.6)));
        children.push({ ox: x, oy: y, oz: z, dx: cx, dy: cy, dz: cz, len: c.len, r: rc });

        // Załamanie rodzica w stronę przeciwną do dziecka, proporcjonalne do udziału dziecka
        const kink = kinkMax * Math.min(1, rc / Math.max(1e-6, r)) * (0.6 + prng.next() * 0.4);
        kx -= sx * Math.tan(kink); ky -= sy * Math.tan(kink); kz -= sz * Math.tan(kink);
        // Skokowe chudnięcie wg reguły rur
        // (nie cieńszy niż 75% zbieżności liniowej — przy gęstych okółkach pień nie „znika”)
        const rLinear = r0 * (1 - t * (1 - tipRatio));
        r = Math.max(MIN_RADIUS_RATIO * 0.6, rLinear * 0.75, Math.sqrt(Math.max(0, r * r - 0.7 * rc * rc)));
        stem.r[stem.r.length - 1] = Math.max(stem.r[stem.r.length - 1], r);
      }
    }

    if (stem.px.length < 2) return;
    out.push(stem);

    for (const c of children) {
      TreeGenerator.growBranch(level + 1, c.ox, c.oy, c.oz, c.dx, c.dy, c.dz, c.len, c.r, profile, prng, out);
    }

    if (stem.clipped) return;
    const m = stem.px.length - 1;
    const tipR = stem.r[m];
    const tdx = stem.px[m] - stem.px[m - 1], tdy = stem.py[m] - stem.py[m - 1], tdz = stem.pz[m] - stem.pz[m - 1];
    const tl = Math.hypot(tdx, tdy, tdz) || 1;

    if (isTrunk) {
      if (profile.trunkFork && cp) {
        const forkAngle = (profile.trunkForkAngle ?? 20) * DEG;
        const forkLen = (1 - profile.trunkHeightRatio) * profile.crownSpreadRatio * (0.8 + prng.next() * 0.3);
        const az0 = prng.range(0, Math.PI * 2);
        const numForks = profile.trunkForkCount ?? 2;
        for (let s = 0; s < numForks; s++) {
          TreeGenerator.splitDir(tdx / tl, tdy / tl, tdz / tl, az0 + (s * 2 * Math.PI) / numForks, forkAngle * (0.8 + prng.next() * 0.4));
          const [fx, fy, fz] = TreeGenerator.tmp;
          TreeGenerator.growBranch(level + 1, stem.px[m], stem.py[m], stem.pz[m], fx, fy, fz,
            forkLen, Math.max(MIN_RADIUS_RATIO, tipR * Math.pow(numForks, -0.5)), profile, prng, out);
        }
      }
      return;
    }
    if (p.fork > 0 && cp) {
      // Rozwidlenie „Y”: dwa pędy kolejnego rzędu z końca, rozchylone o ±fork
      const forkLen = length * cp.lengthRatio * 1.3;
      const az0 = prng.range(0, Math.PI * 2);
      for (let s = 0; s < 2; s++) {
        TreeGenerator.splitDir(tdx / tl, tdy / tl, tdz / tl, az0 + s * Math.PI, p.fork * DEG * (0.8 + prng.next() * 0.4));
        const [fx, fy, fz] = TreeGenerator.tmp;
        TreeGenerator.growBranch(level + 1, stem.px[m], stem.py[m], stem.pz[m], fx, fy, fz,
          forkLen * (0.85 + prng.next() * 0.3), Math.max(MIN_RADIUS_RATIO, tipR * Math.SQRT1_2), profile, prng, out);
      }
    } else if (!TreeGenerator.flow && level === deepest && profile.tipSpurs !== false && length > 0.01 && prng.next() < 0.5) {
      // Drobne ostrogi na końcu najcieńszej witki (widełki z rycin)
      const az0 = prng.range(0, Math.PI * 2);
      for (let s = 0; s < 2; s++) {
        TreeGenerator.splitDir(tdx / tl, tdy / tl, tdz / tl, az0 + s * Math.PI, (22 + prng.next() * 12) * DEG);
        const [fx, fy, fz] = TreeGenerator.tmp;
        const sl = length * (0.12 + prng.next() * 0.08);
        out.push({
          level: level + 1, px: [stem.px[m], stem.px[m] + fx * sl], py: [stem.py[m], stem.py[m] + fy * sl], pz: [stem.pz[m], stem.pz[m] + fz * sl],
          r: [Math.max(MIN_RADIUS_RATIO * 0.6, tipR), MIN_RADIUS_RATIO * 0.5], length: sl, clipped: false,
        });
      }
    }
  }

  private static tmp: [number, number, number] = [0, 0, 0];

  /**
   * Ugięcie pędu pod własnym ciężarem na całą długość (rad), przed uwzględnieniem poziomości.
   * Belka wspornikowa: krzywizna ∝ obciążenie / sztywność ∝ r² / r⁴, więc ugięcie rośnie ze smukłością L / r.
   */
  private static stemSag(profile: SpeciesProfile, length: number, r0: number): number {
    const k = profile.pliancy ?? 0;
    if (k <= 0) return 0;
    return k * DEG * Math.min(SAG_MAX_SLENDERNESS, length / Math.max(MIN_RADIUS_RATIO, r0) / SAG_REF_SLENDERNESS);
  }

  /** Obrót kierunku ku dołowi o angle · cos(elewacja): poziomy pęd ugina się najmocniej, zwisający pionowo wcale (wynik w tmp) */
  private static applySag(dx: number, dy: number, dz: number, angle: number) {
    const hl = Math.hypot(dx, dz);
    if (hl < 1e-4) { TreeGenerator.tmp[0] = dx; TreeGenerator.tmp[1] = dy; TreeGenerator.tmp[2] = dz; return; }
    const el0 = Math.atan2(dy, hl);
    const el = Math.max(-Math.PI / 2 + 0.02, el0 - angle * Math.cos(el0));
    const ce = Math.cos(el);
    TreeGenerator.tmp[0] = (dx / hl) * ce; TreeGenerator.tmp[1] = Math.sin(el); TreeGenerator.tmp[2] = (dz / hl) * ce;
  }

  /** Tropizm pędu na całą długość (cienkie pędy silniej ku górze; zwisanie bez wzmocnienia) */
  private static stemTropism(p: BranchLevelParams, r0: number): number {
    const gnarl = Math.min(GNARL_MAX, Math.max(1, Math.sqrt(GNARL_REF_RADIUS / Math.max(1e-6, r0))));
    return p.tropism * (p.tropism < 0 ? 1 : gnarl);
  }

  /**
   * Ułamek długości pędu, na którym jego oś (wygięcie + tropizm, bez falowania i załamań) pozostaje w obwiedni korony.
   * 1 = cały pęd mieści się w obwiedni.
   */
  private static pruneFraction(
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
    length: number, p: BranchLevelParams, trop: number, sag = 0, bypassRadial = false
  ): number {
    const n = Math.max(8, p.curveRes * 3);
    const dt = 1 / n, curveK = DEG * dt * (TreeGenerator.flow ? 1.5 : 1);
    let x = ox, y = oy, z = oz;
    for (let k = 0; k < n; k++) {
      const curve = (p.curveBack === undefined ? p.curve : 2 * ((k + 0.5) * dt < 0.5 ? p.curve : p.curveBack)) * curveK;
      const hl = Math.sqrt(dx * dx + dz * dz);
      if (hl > 1e-4 && curve !== 0) {
        const el = Math.atan2(dy, hl) + curve, ce = Math.cos(el);
        dx = (dx / hl) * ce; dz = (dz / hl) * ce; dy = Math.sin(el);
      }
      if (sag > 0) { TreeGenerator.applySag(dx, dy, dz, sag * dt); dx = TreeGenerator.tmp[0]; dy = TreeGenerator.tmp[1]; dz = TreeGenerator.tmp[2]; }
      dy += trop * dt;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= dl; dy /= dl; dz /= dl;
      const step = dt * length;
      if (TreeGenerator.isOutsideEnvelope(x + dx * step, y + dy * step, z + dz * step, bypassRadial)) {
        let lo = 0, hi = 1;
        for (let b = 0; b < 5; b++) {
          const m = (lo + hi) * 0.5;
          if (!TreeGenerator.isOutsideEnvelope(x + dx * step * m, y + dy * step * m, z + dz * step * m, bypassRadial)) lo = m; else hi = m;
        }
        return (k + lo) * dt;
      }
      x += dx * step; y += dy * step; z += dz * step;
    }
    return 1;
  }

  /** Deterministyczny hash pozycji i poziomu gałęzi (nie zaburza głównego strumienia PRNG) */
  private static stemHash(ox: number, oy: number, oz: number, level: number): number {
    let h = (Math.round(ox * 1000) * 73856093) ^ (Math.round(oy * 1000) * 19349663) ^ (Math.round(oz * 1000) * 83492791) ^ (level * 2654435761);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** Losowe wychylenie kierunku o kąt ≤ amp (wynik w tmp) */
  private static perturb(dx: number, dy: number, dz: number, amp: number, prng: FastPrng) {
    let ax: number, ay: number, az: number;
    if (Math.abs(dy) < 0.9) { ax = -dz; ay = 0; az = dx; } else { ax = 0; ay = dz; az = -dy; }
    const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
    const phi = prng.next() * Math.PI * 2;
    const amt = Math.tan(prng.signedRange(amp));
    const c = Math.cos(phi) * amt, s = Math.sin(phi) * amt;
    TreeGenerator.tmp[0] = dx + ax * c + bx * s;
    TreeGenerator.tmp[1] = dy + ay * c + by * s;
    TreeGenerator.tmp[2] = dz + az * c + bz * s;
  }

  /** Kierunek odchylony o kąt `angle` od (dx,dy,dz) w azymucie `az` (wynik w tmp, znormalizowany) */
  private static splitDir(dx: number, dy: number, dz: number, az: number, angle: number) {
    let ax: number, ay: number, a2: number;
    if (Math.abs(dy) < 0.9) { ax = -dz; ay = 0; a2 = dx; } else { ax = 0; ay = dz; a2 = -dy; }
    const al = Math.hypot(ax, ay, a2) || 1; ax /= al; ay /= al; a2 /= al;
    const bx = dy * a2 - dz * ay, by = dz * ax - dx * a2, bz = dx * ay - dy * ax;
    const ca = Math.cos(az), sa = Math.sin(az), cd = Math.cos(angle), sd = Math.sin(angle);
    const x = dx * cd + (ax * ca + bx * sa) * sd, y = dy * cd + (ay * ca + by * sa) * sd, z = dz * cd + (a2 * ca + bz * sa) * sd;
    const l = Math.hypot(x, y, z) || 1;
    TreeGenerator.tmp[0] = x / l; TreeGenerator.tmp[1] = y / l; TreeGenerator.tmp[2] = z / l;
  }

  private static shuffledSlots(count: number, prng: FastPrng): number[] {
    const a: number[] = [];
    for (let i = 0; i < count; i++) a.push(i);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(prng.next() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** Typowa długość pędu danego rzędu — normalizuje liczbę dzieci krótszych pędów */
  private static levelRefLength(profile: SpeciesProfile, level: number): number {
    if (level === 0) return profile.trunkLengthRatio;
    let len = profile.crownSpreadRatio;
    for (let l = 2; l <= level; l++) len *= profile.levels[l - 1].lengthRatio;
    return len;
  }

  /**
   * Wytłacza ciągłą tubę wzdłuż pędu: ramka transportowana równolegle,
   * pierścienie współdzielone przez sąsiednie segmenty, zamknięcie stożkiem.
   */
  /** Promień nasady pnia (pierwszy pęd rzędu 0) — odniesienie limitów grubości kreski; brak pnia = bez limitu */
  static trunkBaseRadius(stems: readonly Stem[]): number {
    for (const s of stems) if (s.level === 0) return s.r[0];
    return Infinity;
  }

  /** Bufor roboczy wygładzania promieni w `strokeStem` (bez alokacji na pęd) */
  private static smoothScratch = new Float64Array(64);

  /** Pęd z promieniami wg kreski: mnożnik rzędu, wygładzona zbieżność, odziomek rozłożony w górę pnia */
  static strokeStem(stem: Stem, stroke: TreeStroke, nominalHeight: number, trunkBaseR: number): Stem {
    const k = stroke.levelScale[Math.min(stem.level, stroke.levelScale.length - 1)] ?? 1;
    const n = stem.r.length;
    // Anatomiczna hierarchia da Vinci / Weber-Penn: żaden pęd boczny nie może być grubszy od nasady pnia
    // Konary (lvl 1) <= 45% pnia, gałęzie (lvl 2) <= 22% pnia, witki (lvl >= 3) <= 9% pnia
    const cap = trunkBaseR * STROKE_LEVEL_CAP[Math.min(stem.level, STROKE_LEVEL_CAP.length - 1)];
    const r = stem.r.map((v) => softCap(v * k, cap));
    if (stroke.smooth && stem.level <= 1 && n > 2) {
      // Zbieżność bez schodków: promień nie rośnie ku końcowi, a skoki rozkładają się na sąsiednie węzły
      const prev = TreeGenerator.smoothScratch.length >= n ? TreeGenerator.smoothScratch : (TreeGenerator.smoothScratch = new Float64Array(n * 2));
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) prev[i] = r[i];
        for (let i = 1; i < n - 1; i++) r[i] = (prev[i - 1] + 2 * prev[i] + prev[i + 1]) / 4;
      }
      for (let i = 1; i < n; i++) r[i] = Math.min(r[i], r[i - 1]);
    }
    if (stem.level === 0 && stem.py[0] < 1e-6 && stroke.flareRise > 0 && n > 1) {
      // Odziomek: rozszerzenie wygasa łagodnie do flareRise wysokości drzewa (w szkielecie tylko pierwszy pierścień)
      const rise = stroke.flareRise * nominalHeight;
      const flare = r[0] / Math.max(1e-9, r[1]);
      for (let i = 1; i < n && stem.py[i] < rise; i++) {
        const f = 1 - stem.py[i] / rise;
        r[i] *= 1 + (flare - 1) * f * f;
      }
    }
    return { ...stem, r };
  }

  private static extrudeStem(
    stem: Stem, scale: number, sides: number, jitter: number, ringStride: number, prng: FastPrng, builder: MeshBufferBuilder
  ) {
    const n = stem.px.length;
    // LOD: co ringStride-ty pierścień, pierwszy i ostatni zawsze (końce pędów zostają na miejscu)
    const rings: number[] = [];
    for (let i = 0; i < n - 1; i += ringStride) rings.push(i);
    rings.push(n - 1);
    let sx = 0, sy = 0, sz = 0, hasSide = false;
    let prevRingStart = -1;
    for (let q = 0; q < rings.length; q++) {
      const i = rings[q];
      const a = rings[Math.max(0, q - 1)], b = rings[Math.min(rings.length - 1, q + 1)];
      let dx = stem.px[b] - stem.px[a], dy = stem.py[b] - stem.py[a], dz = stem.pz[b] - stem.pz[a];
      const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
      if (!hasSide) {
        if (Math.abs(dy) < 0.9) { sx = -dz; sy = 0; sz = dx; } else { sx = 0; sy = dz; sz = -dy; }
        hasSide = true;
      } else {
        // Transport równoległy: rzut poprzedniego wektora bocznego na płaszczyznę prostopadłą do d
        const dot = sx * dx + sy * dy + sz * dz;
        sx -= dx * dot; sy -= dy * dot; sz -= dz * dot;
      }
      const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
      const ux = dy * sz - dz * sy, uy = dz * sx - dx * sz, uz = dx * sy - dy * sx;
      const cx = stem.px[i] * scale, cy = stem.py[i] * scale, cz = stem.pz[i] * scale;
      const r = stem.r[i] * scale;
      const ringStart = builder.vertexCount;
      const cosT = RING_COS[sides], sinT = RING_SIN[sides];
      for (let j = 0; j < sides; j++) {
        const c = cosT[j], s = sinT[j];
        const nx = sx * c + ux * s, ny = sy * c + uy * s, nz = sz * c + uz * s;
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
    // Zamknięcie końca pędu
    const last = n - 1;
    const tip = builder.vertexCount;
    builder.addVertex(stem.px[last] * scale, stem.py[last] * scale, stem.pz[last] * scale, 0, 1, 0);
    for (let j = 0; j < sides; j++) {
      builder.indices.push3(prevRingStart + j, tip, prevRingStart + (j + 1) % sides);
    }
  }

  /**
   * Liście w stylu ilustracji architektonicznej (wzorzec SA_AI_Template): drobne, płaskie plamki
   * w kępkach wzdłuż zewnętrznej części najcieńszych pędów. Bez światła — głębię daje ton:
   * nisko i w głębi korony ciemny, wysoko i na obrzeżu jasny. Każdy ton to osobna grupa materiału.
   */
  private static addLeaves(
    stems: Stem[], scale: number, profile: SpeciesProfile, prng: FastPrng,
    builder: MeshBufferBuilder, startIndex: number, leafSites?: number[]
  ) {
    const deepest = profile.levels.length;
    const aspect = profile.leafAspect ?? 0.55;
    const clump = profile.leafClump ?? 4;
    const density = profile.leafDensity ?? DEFAULT_LEAF_DENSITY;
    const L = profile.leafSizeRatio;

    // 1. Miejsca kępek na pędach dwóch najdrobniejszych rzędów (zewnętrzne 60% długości + koniec)
    const sites: number[] = []; // x, y, z, dx, dy, dz
    let minY = Infinity, maxY = -Infinity, cx = 0, cz = 0;
    if (leafSites) {
      // Miejsca z ez-tree; gęstość profilu (względem domyślnej) przerzedza je, jak liczbę kępek na witkach
      const keep = Math.min(1, density / DEFAULT_LEAF_DENSITY);
      for (let i = 0; i < leafSites.length; i += 6) {
        if (keep < 1 && prng.next() > keep) continue;
        for (let c = 0; c < 6; c++) sites.push(leafSites[i + c]);
        const x = leafSites[i], y = leafSites[i + 1], z = leafSites[i + 2];
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        cx += x; cz += z;
      }
    }
    for (const s of leafSites ? [] : stems) {
      if (s.level < deepest - 1) continue;
      const n = s.px.length - 1;
      const count = Math.max(1, Math.round(s.length * density * (0.7 + prng.next() * 0.6)));
      for (let i = 0; i < count; i++) {
        const t = i === count - 1 ? 1 : 0.4 + 0.6 * prng.next();
        const f = t * n, k = Math.min(n - 1, Math.floor(f)), u = f - k;
        const x = s.px[k] + (s.px[k + 1] - s.px[k]) * u;
        const y = s.py[k] + (s.py[k + 1] - s.py[k]) * u;
        const z = s.pz[k] + (s.pz[k + 1] - s.pz[k]) * u;
        sites.push(x, y, z, s.px[k + 1] - s.px[k], s.py[k + 1] - s.py[k], s.pz[k + 1] - s.pz[k]);
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        cx += x; cz += z;
      }
    }
    const nSites = sites.length / 6;
    if (nSites === 0) return;
    cx /= nSites; cz /= nSites;
    let maxR = 1e-6;
    for (let i = 0; i < nSites; i++) maxR = Math.max(maxR, Math.hypot(sites[i * 6] - cx, sites[i * 6 + 2] - cz));

    // 2. Przydział kępek do tonów (1 jasny, 2 średni, 3 ciemny)
    const buckets: number[][] = [[], [], []];
    for (let i = 0; i < nSites; i++) {
      const hy = (sites[i * 6 + 1] - minY) / Math.max(1e-6, maxY - minY);
      const hr = Math.hypot(sites[i * 6] - cx, sites[i * 6 + 2] - cz) / maxR;
      const shade = 0.55 * hy + 0.45 * hr + prng.signedRange(0.22);
      buckets[shade > 0.62 ? 0 : shade > 0.36 ? 1 : 2].push(i);
    }

    // 3. Kępki płaskich liści (sześciokąt wydłużony wzdłuż kierunku wzrostu, losowa orientacja płaszczyzny)
    let groupStart = startIndex;
    for (let b = 0; b < 3; b++) {
      for (const i of buckets[b]) {
        const sx = sites[i * 6], sy = sites[i * 6 + 1], sz = sites[i * 6 + 2];
        let tx = sites[i * 6 + 3], ty = sites[i * 6 + 4], tz = sites[i * 6 + 5];
        const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        const nLeaves = Math.max(1, Math.round(clump * (0.6 + prng.next() * 0.8)));
        for (let q = 0; q < nLeaves; q++) {
          const size = L * (0.6 + prng.next() * 0.8);
          // Oś liścia: kierunek pędu rozchylony losowo (wachlarz kępki)
          TreeGenerator.splitDir(tx, ty, tz, prng.range(0, Math.PI * 2), (25 + prng.next() * 55) * DEG);
          const ax = TreeGenerator.tmp[0], ay = TreeGenerator.tmp[1], az = TreeGenerator.tmp[2];
          // Druga oś płaszczyzny liścia: losowa, prostopadła do osi
          TreeGenerator.splitDir(ax, ay, az, prng.range(0, Math.PI * 2), Math.PI / 2);
          const bx = TreeGenerator.tmp[0], by = TreeGenerator.tmp[1], bz = TreeGenerator.tmp[2];
          const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          const ox = sx + ax * size * 0.15, oy = sy + ay * size * 0.15, oz = sz + az * size * 0.15;
          const w = size * aspect * 0.5;
          const v0 = builder.vertexCount;
          for (let p = 0; p < 6; p++) {
            const along = LEAF_HEX[p * 2] * size, across = LEAF_HEX[p * 2 + 1] * w;
            builder.addVertex(
              (ox + ax * along + bx * across) * scale,
              (oy + ay * along + by * across) * scale,
              (oz + az * along + bz * across) * scale,
              nx, ny, nz
            );
          }
          for (let p = 1; p < 5; p++) builder.indices.push3(v0, v0 + p, v0 + p + 1);
        }
      }
      builder.addGroup(groupStart, builder.indices.length - groupStart, b + 1);
      groupStart = builder.indices.length;
    }
  }
}
