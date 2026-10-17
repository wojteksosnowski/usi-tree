/**
 * Core domain types and interfaces for usi-tree procedural generation.
 */

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

/** Parametry wzrostu szkieletu wg ez-tree */
export type ByLevel = Record<number, number>;

export interface EzTreeOptions {
  type: 'deciduous' | 'evergreen';
  branch: {
    levels: number;
    angle: ByLevel;       // kąt dziecka względem rodzica (stopnie), poziomy 1..
    children: ByLevel;    // liczba dzieci na pędzie danego poziomu
    force: { direction: { x: number; y: number; z: number }; strength: number };
    gnarliness: ByLevel;  // falowanie (rad na sekcję, ×max(1, 1/√r))
    length: ByLevel;
    radius: ByLevel;      // poziom 0: promień pnia; dalej ułamek promienia rodzica w punkcie odgałęzienia
    sections: ByLevel;
    segments: ByLevel;
    start: ByLevel;       // początek odgałęzień na rodzicu (ułamek długości)
    taper: ByLevel;
    twist: ByLevel;
  };
  leaves: { angle: number; count: number; start: number; size: number; sizeVariance: number };
  scaffold?: { count: number; height: number; lean: number; leanV: number };
  pipeExponent?: number;
}

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
  trunkForkSideLength?: number;  // FORKED: mnożnik długości bocznego przewodnika (bazowo 1 − 0,3·asymetria głównego)
  trunkForkSideRadius?: number;  // FORKED: mnożnik promienia bocznego przewodnika (bazowo 0,72 − 0,25·asymetria szczytu pnia)
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

export interface Stem {
  level: number;
  px: number[];
  py: number[];
  pz: number[];
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
