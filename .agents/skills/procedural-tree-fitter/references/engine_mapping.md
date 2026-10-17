# Mapowanie Cech Obrazu na Silnik USI Light (`TreeGenerator.ts`)

Niniejszy dokument opisuje bezpośrednie odwzorowanie miar geometrii, fizyki ugięcia oraz stylu architektonicznego z obrazów referencyjnych na struktury danych silnika USI Light (`SpeciesProfile`, `BranchLevelParams`, `TreeStroke`, `ILLUSTRATION_STROKE`).

---

## 1. Struktura Danych i Poziomy Morfologii

W silniku usi-tree (`src/core/TreeGenerator.ts` / `src/core/types.ts`) każde drzewo opisywane jest przez interfejs `SpeciesProfile`:

| Pole w `SpeciesProfile` | Znaczenie Botaniczne / Geometryczne | Źródło z Obrazu Referencyjnego |
|---|---|---|
| `trunkHeightRatio` | Ułamek wysokości do pierwszego konara | $y_{first\_branch} / H_{total}$ |
| `trunkBaseRadiusRatio` | Promień pnia przy odziomku / wysokość | $r_{base} / H_{total}$ |
| `trunkLengthRatio` | Długość przewodnika głównego / wysokość | Długość osi pnia do wierzchołka |
| `trunkCurveV` | Wariancja falowania pnia (stopnie/segment) | Wariancja kąta wektora stycznego pnia |
| `crownSpreadRatio` | Rozpiętość korony / wysokość | Szerokość obwiedni korony $W / H$ |
| `crownShape` | Obwiednia (stożek, kula, kopuła, płomień, parasol) | Kształt konturu korony |
| `ratioPower` | Wykładnik reguły rur Shinozakiego / Leonarda | Zbieżność sumy promieni w węzłach ($r_{rodz}^p = \sum r_{dzieci}^p$) |
| `flareFactor` | Rozszerzenie odziomka przy gruncie | $r(y=0) / r(y=0.05 \cdot H)$ |
| `scaffoldLimbs` | Liczba konarów głównych w pokroju rozpierzchłym | Liczba głównych odgałęzień u nasady pnia |
| `pliancy` | Wiotkość gałęzi (stopnie ugięcia belki) | Zmierzone ugięcie poziomych gałęzi pod ciężarem |

---

## 2. Parametry Poziomu Gałęzi (`BranchLevelParams`)

Dla każdego rzędu gałęzi (rząd 1 = konary główne, rząd 2 = gałęzie boczne, rząd 3 = witki):

```typescript
export interface BranchLevelParams {
  count: number;           // Średnia liczba pędów potomnych na rodzicu
  downAngle: number;       // Kąt odchylenia od osi rodzica (stopnie)
  downAngleV: number;      // Rozrzut losowy kąta (stopnie)
  downAngleSlope?: number; // Dodatkowy kąt u nasady rodzica (rozchylenie dolnych konarów)
  lengthRatio: number;     // Długość względem rodzica (rząd >= 2) / skala obwiedni (rząd 1)
  lengthV: number;         // Rozrzut długości
  curve: number;           // Sumaryczne wygięcie ku górze (+) / ku dołowi (-) na całą długość
  curveV: number;          // Losowe falowanie (stopnie na segment)
  curveRes: number;        // Liczba segmentów dyskretyzacji tuby
  tropism: number;         // Fototropizm (+ ku górze) / geotropizm (- ku dołowi)
  kink?: number;           // Załamanie pędu w węźle (stopnie, sympodialny wzrost)
  fork: number;            // Kąt rozwidlenia 'Y' na końcu pędu (stopnie)
}
```

---

## 3. Matematyczny Model Ugięcia i Sprężystości (`pliancy` & `stemSag`)

W USI Light ugięcie gałęzi opiera się na analitycznym modelu belki wspornikowej:
1. **Zależność od Smukłości ($L / r$)**:
   Krzywizna ugięcia sprężystego belki $\kappa = \frac{M}{E \cdot I}$. Ponieważ moment od ciężaru własnego $M \propto \rho \cdot r^2 \cdot L^2$, a moment bezwładności przekroju $I \propto r^4$, stosunek wynosi:
   $$\kappa \propto \frac{L^2}{r^2} \implies \theta_{sag} \propto \frac{L}{r}$$
2. **Kąt Ugięcia w Silniku**:
   ```typescript
   private static stemSag(profile: SpeciesProfile, length: number, r0: number): number {
     const k = profile.pliancy ?? 0;
     if (k <= 0) return 0;
     return k * DEG * Math.min(SAG_MAX_SLENDERNESS, length / Math.max(MIN_RADIUS_RATIO, r0) / SAG_REF_SLENDERNESS);
   }
   ```
3. **Wpływ Orientacji Przestrzennej (Poziomość)**:
   Gałąź rosnąca pionowo ku górze lub zwisająca pionowo ku dołowi nie doznaje momentu gnącego od siły ciężkości. Kąt obrotu wektora jest modulowany przez cosinus elewacji:
   $$\Delta\theta = \theta_{sag} \cdot \cos(\alpha_{elevation})$$
   Dzięki temu poziome gałęzie dębu czy jesionu uginają się w malownicze łuki, a pionowe przewodniki topoli lub wierzby zachowują kierunek.

---

## 4. Ochrona Stylu Kreski Architektonicznej (`TreeStroke` & `ILLUSTRATION_STROKE`)

Aby zapobiec utracie stylu plansz `SA_Artboard2`:
- **Niezależność Kreski od Szkieletu**: Szkielet wyznaczany jest w znormalizowanych proporcjach botanicznych. Grubość widocznych tub siatki renderującej sterowana jest przez obiekt `TreeStroke`:
  ```typescript
  export const ILLUSTRATION_STROKE: TreeStroke = {
    levelScale: [1.0, 1.65, 2.9, 1], // Skala pnia, konarów i gałęzi
    smooth: true,                    // Płynne przejścia bez ostrych schodków w węzłach
    flareRise: 0.03                  // Wysokość rozszerzenia odziomka
  };
  ```
- **Wskaźnik Granatu (`StructureMetrics`)**:
  Metryka chroniąca przed chaotycznym rozpadem korony:
  - Udział gałęzi odciętych obwiednią $\le 15\%$,
  - Udział gałęzi skierowanych ku wnętrzu korony $\le 10\%$,
  - Płynność przejść kątowych w węzłach $\le 25°$.
