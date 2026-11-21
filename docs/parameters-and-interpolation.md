# Parametry proceduralne i interpolacja wysokościowa (`usi-tree`)

Dokumentacja techniczna architektury parametrów gatunkowych (`SpeciesProfile`, `BranchLevelParams`), ontogenezy wysokościowej (`heightAnchors`), interpolacji krzywych trendu (`heightProfile.ts`) oraz przepływu pracy w Tree Studio (`scripts/tree-studio.ts`).

---

## 1. Przegląd architektury

System generacji drzew w `usi-tree` rozdziela definicję morfologii gatunku od stanu wykonania i generacji siatki 3D:

1. **Kontrakt danych (`src/core/types.ts`)**:
   - `SpeciesProfile` opisuje globalne cechy pnia, obwiedni korony, liści, stylizacji oraz tablicę rzędów gałęzi `levels: BranchLevelParams[]` (`L1` = konary, `L2` = gałęzie, `L3` = witki, opcjonalnie `Ln`).
   - `BranchLevelParams` definiuje geometrię pojedynczego rzędu rozgałęzień (liczba odgałęzień, kąty, krzywizna, rozdzielczość segmentów, zwężanie, rozwidlenia).
2. **Silnik wzrostu (`src/core/growthEngine.ts`)**:
   - Re-entrantny kontekst `GrowthContext` buduje szkielet `TreeSkeleton` w jednostkach znormalizowanych (wysokość drzewa $H = 1$, skalowana później przez `scale` do metrów).
   - Stosuje regułę rur (pipe model) przez `ratioPower`, fototropizm/geotropizm, załamania węzłowe (`kink`), wiotkość (`pliancy`) oraz rozwidlenia (`FORKED`, `MULTI`, `trunkFork`).
3. **Obwiednia korony (`src/core/crownEnvelope.ts`)**:
   - Klasa `CrownEnvelope` definiuje bryłę ograniczającą korony na podstawie `crownShape`, `crownSpreadRatio`, `crownPeak` i `envelopeScale`.
   - Kontroluje przycinanie pędów (`prune`, `envelopeClipProbability`, `disableEnvelope`) oraz zasięg konarów (`limbsReachEnvelope`).
4. **Wytłaczanie siatki i listowie (`src/core/meshExtruder.ts`)**:
   - Zamienia `TreeSkeleton` na bufory `RawTreeMesh` (kora + grupy materiałów liści 1–3).
   - Obsługuje przekrój pędów (`radialSegments`, `jitterStrength`, `twigStroke`), geometrię blaszki liściowej (`leafShape`, `leafOutline`, `leafSizeCm`, `leafSizeRatio`, `leafAspect`) oraz szypułkę (`petioleLengthRatio`, `petiolePliancy`, `leafFlatness`).
5. **Ontogeneza wysokościowa (`src/core/heightProfile.ts`)**:
   - Gatunki wielowęzłowe definiują `heightAnchors: HeightAnchor[]` (np. dla 6, 9, 15, 24 m).
   - Funkcja `profileAtHeight(anchors, h)` wyznacza ciągły profil dla dowolnej wysokości `h` poprzez dopasowanie krzywych trendu (`fitParameterCurve`) dla parametrów liczbowych oraz uzupełnianie brakujących pól opcjonalnych kanonicznymi wartościami domyślnymi.
   - Gatunki jednowysokościowe mogą korzystać z allometrycznego skalowania `scaleProfileByHeight(profile, heightM, refHeightM)` (Opcja A).

---

## 2. Tabele referencyjne parametrów

### 2.1. Pień i korona (`SpeciesProfile`)

| Nazwa pola | Typ | Zakres | Domyślna w silniku | Efekt matematyczny i geometryczny |
| :--- | :--- | :--- | :--- | :--- |
| `trunkHeightRatio` | `number` | `0.05 – 0.75` | *(wymagane)* | Ułamek wysokości drzewa bez konarów (od gruntu do nasady korony `base`). |
| `trunkBaseRadiusRatio` | `number` | `0.005 – 0.08` | *(wymagane)* | Promień pnia u podstawy jako ułamek wysokości drzewa ($r_0 = H \cdot \text{ratio}$). |
| `trunkLengthRatio` | `number` | `0.2 – 1.2` | *(wymagane)* | Długość przewodnika względem wysokości drzewa ($< 1$: przewodnik kończy się wewnątrz korony). |
| `trunkTipRatio` | `number` | `0.02 – 0.8` | `0.3` | Ułamek promienia pnia na szczycie względem podstawy przy liniowym zwężaniu: $r(t) = r_0 (1 - t(1 - \text{tipRatio}))$. |
| `trunkTaper` | `number` | `0 – 0.99` | `0` (brak = liniowo) | Wykładnicze zwężanie pnia (ubytki całkowite): $r(t) = r_0 (1 - \text{trunkTaper})^t$. Gdy $> 0$, nadpisuje `trunkTipRatio`. |
| `trunkCurveV` | `number` | `0 – 20` (°/seg) | *(wymagane)* | Losowe falowanie przewodnika w stopniach na segment. |
| `trunkKink` | `number` | `0 – 15` (°) | `3` | Maksymalne załamanie przewodnika w węźle odgałęzienia w stronę przeciwną do dziecka (iglaste zwykle `0`). |
| `crownSpreadRatio` | `number` | `0.05 – 0.9` | *(wymagane)* | Skala promienia/długości konarów względem wysokości drzewa. |
| `crownShape` | `CrownShape` | enum (7 wartości) | *(wymagane)* | Kształt obwiedni korony (`CONICAL`, `SPHERICAL`, `HEMISPHERICAL`, `TEND_FLAME`, `CYLINDRICAL`, `OVOID_COLUMN`, `UMBRELLA`). |
| `crownPeak` | `number` | `0.05 – 0.95` | `CROWN_SHAPE_PEAK[crownShape]` | Względna wysokość w koronie ($0$ = nasada, $1$ = szczyt), na której obwiednia osiąga maksimum szerokości (odcinkowo liniowe przemapowanie $t \to u$). |
| `ratioPower` | `number` | `0.5 – 2.5` | *(wymagane)* | Wykładnik reguły rur: $r_{\text{dziecka}} = r_{\text{rodzica}} \cdot (L_{\text{dziecka}} / L_{\text{rodzica}})^{\text{ratioPower}}$. |
| `flareFactor` | `number` | `0 – 1.5` | *(wymagane)* | Rozszerzenie odziomkowe pnia przy gruncie. |
| `radialSegments` | `number` | `3 – 8` | `4` | Domyślna liczba boków przekroju tuby pnia. |
| `scaffoldLimbs` | `number` | `0 – 8` | `0` (brak) | Liczba głównych konarów szkieletowych, na które rozpada się przewodnik w nasadzie korony (pokrój rozpierzchły). |
| `trunkFork` | `boolean` | `true / false` | `false` | Włącza rozwidlenie szczytowe przewodnika wewnątrz korony. |
| `trunkForkAngle` | `number` | `5 – 60` (°) | `20` (szczyt) / `32` (`FORKED`) | Kąt rozwidlenia przewodnika. |
| `trunkForkCount` | `number` | `2 – 5` | `2` | Liczba odgałęzień rozwidlenia szczytowego pnia. |
| `trunkForkAsymmetry` | `number` | `0 – 1` | `0` | Dla `FORKED`: asymetria widełek ($0$ = symetryczne, $1$ = główny przewodnik bliżej pionu i grubszy, boczny cieńszy i krótszy). |
| `trunkForkHeightRatio` | `number` | `0.05 – 0.8` | `min(0.9 * trunkHeightRatio, 0.18..0.35)` | Względna wysokość rozwidlenia pnia `FORKED`. |
| `trunkForkSideLength` | `number` | `0.2 – 1.2` | `1` | Dla `FORKED`: mnożnik długości bocznego przewodnika. |
| `trunkForkSideRadius` | `number` | `0.2 – 1.2` | `1` | Dla `FORKED`: mnożnik promienia bocznego przewodnika. |
| `trunkForkMainAngleScale` | `number` | `0 – 2` | `1` | Dla `FORKED`: mnożnik odchylenia głównego przewodnika od osi pnia (`0` = przedłużenie pnia). |
| `trunkLeanScale` | `number` | `0 – 2` | `1` | Dla `FORKED`: mnożnik przechyłu pnia (`2–5°`; `0` = pion). |
| `trunkForkTropism` | `number` | `0 – 5` | `2.2` (w `FORKED`) | Fototropizm przewodników po rozwidleniu (`FORKED`); większy daje efekt „łokcia”. |
| `crownAsymmetry` | `number` | `0 – 1` | `0` | Jednostronne wydłużenie konarów po jednej stronie pnia i skrócenie po przeciwnej (kierunek losowany z ziarna). |

---

### 2.2. Poziomy gałęzi `L1..Ln` (`BranchLevelParams`)

| Nazwa pola | Typ | Zakres | Domyślna w silniku | Efekt matematyczny i geometryczny |
| :--- | :--- | :--- | :--- | :--- |
| `count` | `number` (int) | `1 – 60` | *(wymagane)* | Liczba odgałęzień na rodzicu o pełnej długości (zaokrąglana do całkowitej $\ge 1$). |
| `downAngle` | `number` | `0 – 140` (°) | *(wymagane)* | Kąt odchylenia nasady gałęzi od osi rodzica. |
| `downAngleSlope` | `number` | `-45 – 60` (°) | `0` | Dodatkowy kąt odchylenia u nasady rodzica, malejący liniowo do $0$ na jego końcu. |
| `downAngleV` | `number` | `0 – 60` (°) | *(wymagane)* | Losowy rozrzut kąta odchylenia ($\pm \text{downAngleV}$). |
| `lengthRatio` | `number` | `0.05 – 1.5` | *(wymagane)* | Dla `L1`: skala obwiedni; dla `L2+`: długość względem rodzica. |
| `lengthV` | `number` | `0 – 0.6` | *(wymagane)* | Losowy rozrzut długości (ułamek). |
| `curve` | `number` | `-120 – 120` (°) | *(wymagane)* | Łączne wygięcie pędu ku górze ($+$) lub ku dołowi ($-$) na całej długości (lub na 1. połowie, jeśli podano `curveBack`). |
| `curveBack` | `number` | `-120 – 120` (°) | `curve` | Wygięcie drugiej połowy pędu (łuk esowaty, np. konar brzozy: w górę, końcówka w dół). |
| `curveV` | `number` | `0 – 45` (°/seg) | *(wymagane)* | Losowe falowanie pędu w stopniach na segment. |
| `curveRes` | `number` (int) | `2 – 24` | *(wymagane)* | Liczba segmentów tuby pędu (zaokrąglana do całkowitej $\ge 1$). |
| `tropism` | `number` | `-3 – 3` | *(wymagane)* | Fototropizm ($+$ ku górze) / geotropizm ($-$ zwisanie) na całej długości pędu. |
| `kink` | `number` | `0 – 45` (°) | `15` | Maksymalne załamanie pędu w węźle odgałęzienia w stronę przeciwną do dziecka (mnożone przez `kinkScale`). |
| `fork` | `number` | `0 – 60` (°) | *(wymagane)* | Kąt rozwidlenia „Y” na końcu pędu (`0` = brak rozwidlenia). |
| `tipRatio` | `number` | `0.05 – 0.9` | `fork > 0 ? 0.35 : 0.22` | Ułamek promienia na końcu pędu względem nasady (z dolnym ograniczeniem `0.12` po przycięciu `prune`). |
| `taper` | `number` | `0 – 0.5` | `0` (brak = `tipRatio`) | *@deprecated*: Współczynnik zwężania na sekcję; gdy $> 0$, nadpisuje `tipRatio`. |
| `baseSize` | `number` | `0 – 0.8` | `0.1` | Względny początek odgałęzień tego rzędu na rodzicu (dla `L1` używane jest `trunkHeightRatio`). |
| `rotate` | `number` | `0 – 360` (°) | złoty kąt / sloty | Kąt obrotu kolejnych odgałęzień wokół rodzica. |
| `rotateV` | `number` | `0 – 90` (°) | `~14` (`GOLDEN_JITTER`) | Losowy rozrzut kąta obrotu wokół rodzica. |

---

### 2.3. Liście i szypułka (`SpeciesProfile`)

| Nazwa pola | Typ | Zakres | Domyślna w silniku | Efekt matematyczny i geometryczny |
| :--- | :--- | :--- | :--- | :--- |
| `leafSizeCm` | `number` | `1 – 60` (cm) | `undefined` | Absolutna długość liścia w centymetrach; ma priorytet nad `leafSizeRatio`. |
| `leafSizeRatio` | `number` | `0.003 – 0.2` | *(wymagane)* | Długość liścia jako ułamek wysokości drzewa (używane, gdy brak `leafSizeCm`). |
| `leafAspect` | `number` | `0.15 – 1.5` | `0.55` | Stosunek szerokości do długości blaszki liściowej. |
| `leafShape` | `'tri' \| 'quad' \| 'penta' \| 'hex'` | 4 warianty | `'hex'` | Obrys blaszki (odpowiednio 1, 2, 3 lub 4 trójkąty), symetryczny osiowo. |
| `leafOutline` | `number[]` | tablica `[along, across, ...]` | `undefined` | Własny obrys liścia; nadpisuje `leafShape`. |
| `petioleLengthRatio` | `number` | `0 – 0.8` | `0.15` | Długość szypułki jako ułamek długości liścia; odsuwa nasadę `(0, 0)` blaszki od pędu i nie generuje trójkątów. |
| `petiolePliancy` | `number` | `0 – 1` | `0` | Miękkość/uginanie szypułki pod ciężarem i wiatrem. |
| `leafFlatness` | `number` | `0 – 1` | `0` | Spłaszczenie poziome orientacji liści (`1` = liście układają się poziomo). |
| `leafClump` | `number` (int) | `0 – 16` | `4` | Liczba liści w jednej kępce na witce (zaokrąglana do całkowitej $\ge 0$). |
| `leafDensity` | `number` | `5 – 150` | `38` (`DEFAULT_LEAF_DENSITY`) | Liczba kępek na jednostkę długości witki w skali nominalnej. |

---

### 2.4. Wiatr, obwiednia i stylizacja (`SpeciesProfile`)

| Nazwa pola | Typ | Zakres | Domyślna w silniku | Efekt matematyczny i geometryczny |
| :--- | :--- | :--- | :--- | :--- |
| `pliancy` | `number` | `0 – 60` (°) | `0` | Wiotkość gałęzi pod własnym ciężarem (belka wspornikowa); rośnie ze smukłością $L/r$ względem `SAG_REF_SLENDERNESS = 60` i poziomością pędu. |
| `prune` | `boolean` | `true / false` | `false` | Przycinanie predykcyjne (Weber–Penn): pęd skracany przed wzrostem, by zmieścił się w obwiedni, zamiast urywania kikutem. |
| `outwardBias` | `number` | `0 – 1` | `0` | Ściąganie azymutu gałęzi rzędu $\ge 2$ „na zewnątrz” korony (plagiotropia), kąt odchylenia $\le 80°$. |
| `phyllotaxis` | `'golden' \| undefined` | `'golden'` | `undefined` | Azymuty odgałęzień co złoty kąt $137.5°$ zamiast przetasowanych slotów. |
| `twigGnarl` | `number` | `0 – 3` | `1` | Mnożnik dodatkowego falowania cienkich pędów (`0` = cienkie falują tak samo jak grube). |
| `kinkScale` | `number` | `0 – 3` | `1` | Mnożnik załamań gałęzi w węzłach odgałęzień (nie dotyczy pnia). |
| `jitterStrength` | `number` | `0 – 0.5` | *(wymagane)* | Nieregularność przekroju tuby (styl flamastra/ilustracji). |
| `twigStroke` | `number` | `0.2 – 3` | `1` | Mnożnik grubości kreski gałązek i witek (rząd $\ge 2$). |
| `limbsReachEnvelope` | `boolean` | `true / false` | `false` | Konary sięgają konturu obwiedni korony (pokrój rozpierzchły). |
| `disableEnvelope` | `boolean` | `true / false` | `false` | Wyłącza sztywne docinanie obwiednią radialną (swobodny zwis wierzby/brzozy). |
| `envelopeScale` | `number` | `0.5 – 2.0` | `1.0` | Mnożnik promienia obwiedni docinającej ($> 1$ daje luźniejszą koronę). |
| `envelopeClipProbability` | `number` | `0 – 1` | `0.72` | Prawdopodobieństwo przycięcia pędu przez obwiednię korony. |
| `limbBreakProbability` | `number` | `0 – 1` | `0` | Udział konarów `L1` złamanych tępo w $35–70\%$ długości, bez dalszych gałęzi. |
| `tipSpurs` | `boolean` | `true / false` | `true` | Drobne widełki na końcach najcieńszych witek (wyłączane przy `flow: true`). |

---

## 3. Interpolacja wysokościowa i dopasowanie krzywych (`heightProfile.ts`)

### 3.1. Węzły `heightAnchors`
Gatunki z pełną ontogenezą przechowują w `fittedProfiles.json` tablicę `heightAnchors: Array<{ h: number; profile: SpeciesProfile }>`, najczęściej dla wysokości referencyjnych **6 m, 9 m, 15 m, 24 m**.
Wywołanie `profileAtHeight(anchors, h)`:
1. Sortuje węzły rosnąco po `h`.
2. Jeśli `sorted.length === 1` lub `h <= sorted[0].h`, zwraca kopię profilu najniższego węzła (**clamping** poniżej najniższego węzła).
3. Jeśli istnieje węzeł o dokładnej wysokości `a.h === h`, zwraca jego kopię bez interpolacji.
4. W przeciwnym razie wywołuje `evalAtNodes` dla każdego pola profilu i poziomu `levels[i]`.

### 3.2. Uzupełnianie kanonicznych wartości domyślnych (`resolveNumericParam`)
Wiele parametrów w `SpeciesProfile` i `BranchLevelParams` jest opcjonalnych (np. `pliancy`, `tipRatio`, `taper`, `trunkTaper`, `petioleLengthRatio`, `crownPeak`). Jeśli parametr opcjonalny jest zdefiniowany tylko w części węzłów (np. `pliancy: 18` dopiero dla $h = 24\text{ m}$), brakujące węzły są uzupełniane przez `resolveNumericParam(profile, levelIdx, key)` kanoniczną wartością domyślną silnika (np. `0` dla `pliancy`, `0.3` dla `trunkTipRatio`, `fork > 0 ? 0.35 : 0.22` dla `tipRatio`). Dzięki temu `evalAtNodes` zawsze interpoluje płynną krzywą zamiast skokowo przełączać wartość w połowie drogi między węzłami.

### 3.3. Reguły `fitParameterCurve`
Dla wektora punktów $(h_i, y_i)$ funkcja `fitParameterCurve` wybiera model analityczny:
- **1 punkt lub wszystkie wartości identyczne** ($|y_i - y_0| < 10^{-12}$): funkcja stała **`const`** ($y(h) = y_0$).
- **2 węzły**: dopasowanie liniowe **`linear`** ($y(h) = a \cdot h + b$).
- **3 lub więcej węzłów**: wybór modelu o najmniejszym błędzie średniokwadratowym (**SSE**) spośród:
  - **`linear`**: $y(h) = a \cdot h + b$ (regresja OLS),
  - **`log`** (gdy wszystkie $h_i > 0$): $y(h) = a \cdot \ln(\max(10^{-3}, h)) + b$,
  - **`exp`** (gdy wszystkie $y_i > 0$): $y(h) = c \cdot e^{a \cdot h}$ (regresja OLS na $\ln y_i$).

### 3.4. Ekstrapolacja, ograniczenia i zaokrąglanie
- **Powyżej najwyższego węzła** (w tym $> 24\text{ m}$): wartość jest kontynuowana wyznaczoną krzywą trendu (ekstrapolacja).
- **Ograniczenia dodatniości**: `leafSizeRatio` ma dolny limit `0.003`, a pozostałe klucze z `POSITIVE_RATIO_KEYS` (`trunkBaseRadiusRatio`, `trunkTipRatio`, `lengthRatio`, `trunkLengthRatio`, `crownSpreadRatio`, `trunkHeightRatio`) mają dolny limit `1e-4`.
- **Zaokrąglanie liczb całkowitych**: klucze `count`, `curveRes` (min. `1`) oraz `leafClump` (min. `0`) są zaokrąglane przez `Math.round`.
- **Pola nieliczbowe** (`crownShape`, `leafShape`, `boolean`): pobierane są z najbliższego węzła (`nearestIndex`).

---

## 4. Przepływ pracy w Tree Studio (`scripts/tree-studio.ts`)

Tree Studio udostępnia interaktywny edytor profili gatunkowych połączony z podglądem 3D i zapisem do `src/core/fittedProfiles.json`:

1. **Edycja węzłów (`heightAnchors`)**:
   - Użytkownik wybiera gatunek i wysokość węzła (np. 6, 9, 15, 24 m) lub dowolną wysokość pośrednią.
   - Panel parametrów dzieli pola na sekcje: `Pień i korona`, `Liście i styl` oraz `Poziom gałęzi L1..Ln`.
2. **Wykres krzywej parametru na żywo (`renderChartInto` / `updateInlineChart`)**:
   - Kliknięcie, fokus lub zmiana dowolnego pola liczbowego natychmiast przełącza wykres SVG na dany parametr.
   - Wykres rysuje punkty wszystkich węzłów (uzupełnione przez `resolveNumericParam`), dopasowaną krzywą (`const` / `linear` / `log` / `exp`) oraz aktualną wysokość roboczą.
3. **Allometria Opcji A (`scaleProfileByHeight`)**:
   - Dla gatunków jednowysokościowych (bez `heightAnchors`) funkcja `scaleProfileByHeight(profile, heightM, refHeightM = 10)` skaluje profil względem wysokości referencyjnej $10\text{ m}$ w funkcji oktaw $\text{oct} = \text{clamp}(\log_2(H / H_{\text{ref}}), -2, 2)$:
     - `levels[0].count`: $\times 2^{0.35 \cdot \text{oct}}$ (min. 3),
     - `levels[1].count`: $\times 2^{0.25 \cdot \text{oct}}$ (min. 2),
     - `leafSizeRatio`: $\times 2^{-0.45 \cdot \text{oct}}$,
     - `leafDensity`: $\times 2^{0.25 \cdot \text{oct}}$ (min. 10),
     - `trunkBaseRadiusRatio`: $\times 2^{0.12 \cdot \text{oct}}$,
     - `crownSpreadRatio`: $\times 2^{0.08 \cdot \text{oct}}$,
     - `trunkHeightRatio`: $\times 2^{0.08 \cdot \text{oct}}$ (w zakresie `0.05 – 0.7`).
