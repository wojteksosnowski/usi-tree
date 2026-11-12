/**
 * Poziomy geometryczne siatki drzewa (LOD): gotowe zestawy `TreeMeshLod` i licznik trójkątów.
 * Szkielet i miejsca liści są wspólne dla wszystkich poziomów — degraduje się wyłącznie siatka,
 * a każde uproszczenie ma kompensację (mniej liści = większe, mniej pierścieni = tylko na prostych odcinkach).
 */
import type { RawTreeMesh, TreeMeshLod, TreeMeshTriangles } from './types.js';

export type TreeLodName = 'near' | 'mid' | 'far' | 'shell';

/**
 * Próg skali ekranu (piksele na jednostkę szkieletu/świata), od którego poziom jest nieodróżnialny od `near`:
 * detal, który poziom usuwa, ma wtedy < 1 px. Jednolity dla całej sceny (bez danych o pojedynczym drzewie).
 * Pochodzenie (drzewo ~10 jedn. wysokości, `leafSizeRatio` profilu miejskiego ≈ 0,3–0,5 jedn., najcieńszy zachowany
 * pęd poziomu `near` ma promień ≈ 0,02 jedn., pierścienie ścinane tolerancją ≈ 0,5% długości pędu):
 * - near: zawsze ważny (0),
 * - mid: najcieńszy zachowany pęd (promień ≈ 0,02 jedn.) ma < 0,5 px, a tolerancja pierścieni (0,005 × ~10 jedn. ≈ 0,05 jedn.)
 *   mieści się w 1 px przy ≤ 20 px/jedn.; liście zachowują kształt i wielkość,
 * - far: gdy cały liść (≈ 0,3 jedn.) ma ≲ 1,5 px, czyli ≤ ~5 px/jedn. (liść poziomu jest nie większy niż 1,5× liść near,
 *   a pokrycie korony spada do ok. połowy — przy tej skali to różnica poniżej piksela na liść),
 * - shell: drzewo 10 jedn. ma ≤ 10 px, pień i konary < 1 px — ok. 1 px/jedn.
 */
export const TREE_LOD_MIN_PIXELS_PER_UNIT_MAX: Readonly<Record<TreeLodName, number>> = {
  near: Infinity,
  mid: 20,
  far: 5,
  shell: 1,
};

/**
 * Zestawy poziomów, od najbliższego:
 * - `near`: wszystkie miejsca liści profilu szkieletu, liście sześciokątne; pień, konary i gałęzie bez najgłębszego rzędu,
 * - `mid`: pełny rysunek konarów (otwarte pręty trójkątne), gałęzie od najdłuższych zbiegające się w szpic; mniej liści,
 *   większych, o tym samym sześciokątnym obrysie,
 * - `far`: pień i główne konary; jeszcze mniej, większych liści o obrysie pięciokąta (sześciokąt ze ściętym końcem),
 * - `shell`: pień z kilkoma konarami, zamknięty rdzeń korony i kilkanaście dużych liści na nim (maska konturu i cień korony).
 * Liść poziomu dalszego to powiększony liść poziomu bliskiego — ten sam obrys i rozkład orientacji, więc to samo
 * oświetlenie; miejsca liści są zagnieżdżone (shell ⊂ far ⊂ mid ⊂ near), pokryta powierzchnia korony jest ta sama.
 * Poziomy odnoszą się do profilu szkieletu: gęstość, wielkość i kępki liści widoku bliskiego ustala wywołujący
 * w profilu (jak dotąd), a poziomy dalsze zmniejszają liczbę liści względem niego.
 */
export const TREE_LOD_PRESETS: Readonly<Record<TreeLodName, Readonly<TreeMeshLod>>> = {
  near: {
    dropDeepestLevels: 1,
    ringTolerance: 0.002,
    trunkSides: 4,
    branchSides: 3,
    leafShape: 'hex',
  },
  mid: {
    dropDeepestLevels: 1,
    minPixelsPerUnit: TREE_LOD_MIN_PIXELS_PER_UNIT_MAX.mid,
    minStemRadiusRatio: 0.0015,
    ringTolerance: 0.008,
    trunkSides: 4,
    branchSides: 2,
    maxBarkTriangles: 450,
    leafShape: 'hex',
    maxLeaves: 170,
  },
  far: {
    dropDeepestLevels: 1,
    minPixelsPerUnit: TREE_LOD_MIN_PIXELS_PER_UNIT_MAX.far,
    minStemRadiusRatio: 0.003,
    ringTolerance: 0.025,
    trunkSides: 3,
    branchSides: 2,
    maxBarkTriangles: 120,
    leafShape: 'penta',
    maxLeaves: 80,
    leafCoverage: 0.7,
  },
  shell: {
    dropDeepestLevels: 1,
    minPixelsPerUnit: TREE_LOD_MIN_PIXELS_PER_UNIT_MAX.shell,
    ringTolerance: 0.04,
    trunkSides: 3,
    branchSides: 2,
    maxBarkTriangles: 50,
    leafShape: 'penta',
    crownShell: { rings: 2, sides: 5, lobes: 17 },
  },
};

/**
 * Najbardziej uproszczony poziom, którego warunek jest spełniony przy skali ekranu `pixelsPerUnit` (px na jednostkę):
 * poziom jest ważny, gdy `pixelsPerUnit` ≤ jego próg (`minPixelsPerUnit`). Czysta, jednolita dla całej sceny.
 */
export function pickTreeLodForScale(
  pixelsPerUnit: number,
  presets: Readonly<Record<TreeLodName, Readonly<TreeMeshLod>>> = TREE_LOD_PRESETS
): TreeLodName {
  const order: TreeLodName[] = ['shell', 'far', 'mid'];
  for (const n of order) if (pixelsPerUnit <= (presets[n].minPixelsPerUnit ?? Infinity)) return n;
  return 'near';
}

/** Liczba trójkątów siatki: kora (materiał 0) i listowie albo bryła korony (materiały 1..3) */
export function countMeshTriangles(mesh: Pick<RawTreeMesh, 'groups'>): TreeMeshTriangles {
  let bark = 0,
    foliage = 0;
  for (const g of mesh.groups) {
    if (g.materialIndex === 0) bark += g.count / 3;
    else foliage += g.count / 3;
  }
  return { bark, foliage, total: bark + foliage };
}
