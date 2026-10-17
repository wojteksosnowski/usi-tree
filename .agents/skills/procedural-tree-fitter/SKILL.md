---
name: procedural-tree-fitter
description: Dopasowanie generatora drzew przez graf gałęzi (obraz → graf raz, potem iteracyjne strojenie parametrów do grafu). Specjalista analizy pni, gałęzi i odwrotnego modelowania proceduralnego drzew (IPM / ADPM / FSPM / Weber-Penn) na podstawie obrazów referencyjnych w usi-tree. Umożliwia ekstrakcję szkieletu, suwmiarkę grubości r(s), pomiary kątów, krzywizny i sprężystego ugięcia (pliancy), rendering headless w Three.js oraz automatyczne porównywanie ze wsadem bez utraty stylu architektonicznego B/B2.
---

# Procedural Tree Fitter — Anatomia Drzew i Odwrotne Modelowanie Proceduralne

Niniejszy skill umożliwia precyzyjną, iteracyjną inżynierię pni i gałęzi w silniku proceduralnym **`usi-tree`** (`src/core/TreeGenerator.ts`) w oparciu o obrazy referencyjne (sylwetki, ryciny, szkice botaniczne, plansze stylu architektonicznego).

Skill łączy wiedzę o wiodących metodykach generowania roślinności (IPM/ADPM, FSPM, Weber-Penn/Sapling) z precyzyjnym zachowaniem ustanowionego stylu graficznego `usi-tree`.

---

## 1. Trzy Filary Metodyk Generowania Drzew

### 1.1. Odwrotne i Różniczkowalne Modelowanie Proceduralne (IPM / ADPM)
- **`diff_procedural_generators` (Garifullin i in.)**:
  - Odwrotne modelowanie proceduralne z pojedynczych obrazów.
  - Wykorzystanie wielowymiarowych deskryptorów sylwetki (profil szerokości $W(y)$, położenie środka ciężkości, gęstość i kierunkowość krawędzi) połączonych z algorytmami genetycznymi i wyżarzaniem symulowanym (Simulated Annealing).
  - Kluczowa reguła: **Ewaluacja wieloziarnowa** (Multi-seed evaluation) — dopasowanie optymalizuje zestaw cech wspólny dla całego gatunku, uśredniony po wielu ziarnach PRNG, co zapobiega przeuczeniu do pojedynczej losowej gałęzi.
- **`Sorcar`**:
  - Otwarty silnik proceduralnego modelowania węzłowego (DAG).
  - Zasada rozdzielenia potoku: definicja osi wzrostu -> resampling krzywych -> atrybuty promienia wzdłuż długości -> instancjonowanie węzłów rozgałęzień.

### 1.2. L-Systemy i Ramki Biologiczne (FSPM)
- **`L-Py / OpenAlea`**:
  - Budowa i symulacja architektury roślin za pomocą parametrycznych L-systemów i relacji biomechanicznych.
  - **Tropizmy**: Fototropizm (ciągnięcie ku słońcu $\vec{L}$) vs Grawitropizm/Geotropizm (wznoszenie pnia vs zwisanie witek wierzby).
  - **Sprężystość i Ugięcie**: Model belki wspornikowej Eulera-Bernoulliego ($\kappa \propto \frac{M}{E \cdot I}$). Ponieważ moment od ciężaru $M \propto r^2 \cdot L^2$, a moment bezwładności $I \propto r^4$, ugięcie $\theta_{sag} \propto \frac{L}{r}$. Cienkie, długie pędy uginają się silnie, a grube konary pozostają sztywne.
- **`GroIMP`**:
  - Relacyjne gramatyki wzrostu (język XL) symulujące rozwój drzew, alokację asymilatów i prawo rur Leonarda da Vinci / Murraya:
    $$r_{rodz}^p = \sum r_{dzieci}^p \quad (p \approx 2.0 - 2.5)$$

### 1.3. Narzędzia dla Blendera i Silników Gier
- **`Sapling Tree Gen` (Model Webera–Penna 1995)**:
  - Podstawa silnika `usi-tree`: rekurencyjne rzędy gałęzi (Level 0 = pień, Level 1 = konary, Level 2 = gałęzie, Level 3 = witki).
  - Kąty odejścia (`downAngle`), gradient dolnych konarów (`downAngleSlope`), załamania sympodialne (`kink`), falowanie (`curve`, `curveV`).
  - Przycinanie do obwiedni (`prune`): pędy są proporcjonalnie skracane przed symulacją, by mieścić się w profilu korony, eliminując obcięte kikuty.
- **Zestawy węzłów Geometry Nodes**:
  - Instancjonowanie liści wg filotaksji złotego kąta ($137.5°$), bezpieczny promień końcówki, płynne zbieżności i deformacje krzywych profilu.

---

## 2. Architektura Silnika Roślinności `usi-tree`

Silnik `usi-tree` realizuje dwuwarstwowy model drzewa:
1. **Szkielet Morfologiczny (`SpeciesProfile` & `TreeSkeleton`)**:
   - Zdefiniowany w `src/core/types.ts` i `src/core/speciesProfiles.ts`.
   - Wyznacza rzeczywistą anatomię botaniczną gatunku: `trunkHeightRatio`, `crownSpreadRatio`, `crownShape`, `scaffoldLimbs`, `pliancy`.
   - Zapewnia uporządkowaną strukturę (`TIDY_STRUCTURE`): brak kikutów na obwiedni (`prune: true`), plagiotropia konarów na zewnątrz (`outwardBias: 0.5`), złoty kąt filotaksji i wskaźnik granatu $\le 0.40$.
2. **Kreska Siatki Architektonicznej (`TreeStroke` & `ILLUSTRATION_STROKE`)**:
   - `ILLUSTRATION_STROKE = { levelScale: [1.0, 1.65, 2.9, 1], smooth: true, flareRise: 0.03 }`
   - Kreska gwarantuje, że niezależnie od gatunku drzewo posiada czytelny odziomek (rozszerzenie przy gruncie na 3% wysokości), gruby, zbieżny pień (mediana 3.8% wysokości) oraz wyraziste konary w stylu rycin architektonicznych.

---

## 3. Zestaw Narzędzi CLI (Command Reference)

Wszystkie skrypty znajdują się w katalogu `.agents/skills/procedural-tree-fitter/scripts/` i są uruchamiane przez `NODE_NO_WARNINGS=1 npx tsx`.

### 3.1. Ekstrakcja Anatomii z Obrazu Referencyjnego
Wyodrębnia szkielet, suwmiarkę grubości, kąty, krzywiznę i estymuje parametr sprężystości `pliancy`:
```bash
NODE_NO_WARNINGS=1 npx tsx .agents/skills/procedural-tree-fitter/scripts/tree_anatomy_extractor.ts <obraz_wzorcowy.png> --debug tmp/debug_skeleton.png
```
Format JSON (do integracji skryptowej):
```bash
NODE_NO_WARNINGS=1 npx tsx .agents/skills/procedural-tree-fitter/scripts/tree_anatomy_extractor.ts <obraz_wzorcowy.png> --json
```

### 3.2. Renderowanie Headless w Three.js (Playwright)
Renderuje dowolne drzewo z silnika do zrzutu ekranu PNG wysokiej rozdzielczości:
```bash
# Render elewacyjny (front) w stylu ilustracji architektonicznej
NODE_NO_WARNINGS=1 npx tsx .agents/skills/procedural-tree-fitter/scripts/tree_headless_runner.ts --species OAK --view elevation --out tmp/render_oak.png

# Render samego szkieletu kory z własnego profilu JSON
NODE_NO_WARNINGS=1 npx tsx .agents/skills/procedural-tree-fitter/scripts/tree_headless_runner.ts --species OAK --profile tmp/custom_profile.json --mode bark_only --out tmp/render_bark.png

# Render w aksonometrii 3D
NODE_NO_WARNINGS=1 npx tsx .agents/skills/procedural-tree-fitter/scripts/tree_headless_runner.ts --species PINE --view isometric --out tmp/render_pine_iso.png
```

### 3.3. Porównanie Wizualne i Audyt Stylu
Porównuje wyrenderowane drzewo z obrazem wsadowym, generując planszę 3-panelową `[Wzorzec | Render | Różnica]`:
```bash
NODE_NO_WARNINGS=1 npx tsx .agents/skills/procedural-tree-fitter/scripts/tree_visual_diff.ts <wzorzec.png> <render.png> --diff tmp/tree_diff.png
```

### 3.4. Pętla IPM na cechach sylwetki (starsza; preferuj §3a — graf gałęzi)
Optymalizuje profil gatunku pod kątem obrazu wzorcowego, chroniąc wskaźnik granatu i styl kreski:
```bash
# Optymalizacja z zapisem profilu do pliku tymczasowego
NODE_NO_WARNINGS=1 npx tsx .agents/skills/procedural-tree-fitter/scripts/fit_tree_anatomy.ts <wzorzec.png> --species OAK --iterations 300 --out tmp/tree-fit/profile_oak.json

# Zastosowanie dopasowanego profilu bezpośrednio do bazy fittedProfiles.json
NODE_NO_WARNINGS=1 npx tsx .agents/skills/procedural-tree-fitter/scripts/fit_tree_anatomy.ts <wzorzec.png> --species OAK --iterations 500 --apply
```

---

## 3a. Graf Gałęzi — Główna Ścieżka Dopasowania

**Zasada:** obraz wzorca analizuje się **raz** — tłumacząc go na graf gałęzi. Dalsze dopasowanie porównuje graf wzorca z grafem szkieletu generatora (`TreeGenerator.buildSkeleton` → `skeletonToBranchGraph`), bez renderowania i bez oglądania obrazów w pętli. Obraz ogląda się tylko dwa razy: podgląd grafu wzorca (kontrola ekstrakcji) i końcowy podgląd nakładki.

Moduł: `.agents/skills/procedural-tree-fitter/scripts/tree_branch_graph.ts`. Wspólny format `BranchGraph` (rzut elewacyjny, podstawa pnia = 0, wysokość = 1):
`branches[] = { order (0 = pień), parent, attachT (0..1 na rodzicu), pts (łamana co 1% wys.), r[] }`.

### Krok 1 — Obraz → graf (jednorazowo)
```bash
NODE_NO_WARNINGS=1 npx tsx .agents/skills/procedural-tree-fitter/scripts/tree_branch_graph.ts <wzorzec.png> \
  --out tmp/tree-renders/graph_<nazwa>.json --png tmp/tree-renders/graph_<nazwa>.png \
  [--mode lum|bg] [--threshold 210] [--tolerance 18] [--minRadius 0]
```
`--mode lum` (domyślnie): drzewo = piksele ciemniejsze niż `--threshold` (ryciny, rendery). `--mode bg`: drzewo = piksele różne od koloru tła (mediana narożników) o > `--tolerance` — **dla zdjęć**, zwłaszcza białej kory brzozy na białym tle, której próg luminancji nie widzi.
Potok: binaryzacja → transformata odległości (promień) → Zhang–Suen → węzły (końcówki, skrzyżowania scalone) i krawędzie (łańcuchy pikseli) → usunięcie ostróg (< 2·r węzła, < 1,5% wys.) → drzewo BFS od najniższego węzła → składanie krawędzi w gałęzie: **kontynuacja = dziecko o największym poddrzewie** (reguła rur) z premią za współliniowość, pozostałe dzieci = rząd +1 → wygładzenie i próbkowanie co 1% wysokości.

Obejrzyj **raz** `graph_<nazwa>.png` (kolory = rzędy: brąz pień, pomarańcz konary, niebieski gałęzie): czy pień idzie do nasady korony, czy konary są pomarańczowe. Jeśli nie — popraw wejście, nie wynik: `--threshold` (tło/kreska), `--minRadius` (odcięcie szumu, uwaga: przerywa cienki pień), a najlepiej wzorzec bez liści (`tree_headless_runner.ts --mode bark_only`, rycina kreskowa).

### Krok 1b (opcjonalnie) — Start z presetu Sapling Tree Gen
Opis drzewa w parametrach Blender Sapling (tablice `[L0, L1, L2, L3]`) zapisz jako JSON (wzór: `.agents/skills/procedural-tree-fitter/presets/sapling_betula_pendula.json`) i przełóż na profil:
```bash
NODE_NO_WARNINGS=1 npx tsx .agents/skills/procedural-tree-fitter/scripts/sapling_to_profile.ts \
  .agents/skills/procedural-tree-fitter/presets/sapling_<gatunek>.json --base BIRCH --out tmp/tree-renders/sapling_<gatunek>.json
```
Przełożenie:
- **znak krzywizny odwrócony** (Sapling „+” = w dół, u nas „+” = w górę)
- `Back Curvature` → `curveBack` (łuk esowaty)
- ujemne `Down Angle Variation` → `downAngleSlope = 2|v|`, `downAngle − |v|`
- `Curvature Variation / curveRes` → `curveV`
- `Length[1]` → `crownSpreadRatio`
- `Base Size` → `trunkHeightRatio`
- `Secondary Base Size` → `levels[].baseSize`
- `Rotate` → `levels[].rotate`/`rotateV`

### Krok 2 — Iteracyjne dopasowanie parametrów do grafu
```bash
NODE_NO_WARNINGS=1 npx tsx .agents/skills/procedural-tree-fitter/scripts/fit_tree_graph.ts tmp/tree-renders/graph_<nazwa>.json \
  --species OAK [--iterations 6] [--seeds 42,107,314] [--start profil.json] \
  [--out tmp/tree-renders/fitted_graph_oak.json] [--png tmp/tree-renders/fit_graph_oak.png] [--apply]
```
(Można też podać od razu `<wzorzec.png>` — wtedy krok 1 wykona się w locie.)
- Kandydat: `buildSkeleton` (wys. 12 m) dla każdego ziarna → graf → deskryptor (~ms, bez siatki i renderu).
- Koszt: `compareBranchGraphs` (suma unormowanych różnic cech, ~1 = wyraźnie inne drzewo) uśredniony po ziarnach + kara `clipped` (ułamek pędów uciętych na obwiedni — wskaźnik granatu).
- Optymalizator: przeszukiwanie współrzędnościowe ±krok po pokrętłach (`KNOBS` w `fit_tree_graph.ts`: `crownSpreadRatio`, `trunkHeightRatio`, `trunkLengthRatio`, `trunkCurveV`, `pliancy`, `levels[0..1].{downAngle, downAngleSlope, curve, curveV, count, lengthRatio}`); brak poprawy → krok /2; stop po rundzie bez zmian. Deterministyczny — ten sam wynik przy tych samych ziarnach.
- Wyjście: profil JSON, tabela „wzorzec vs kandydat” dla cech i lista **największych pozostałych składników kosztu** — to wskazuje, które pokrętło/cecha jeszcze nie pasuje.

### Cechy grafu (deskryptor) → parametry generatora
| Cecha (`GraphDescriptor`) | Znaczenie | Główne pokrętła |
|---|---|---|
| `spread`, `widthProfile[10]` | szerokość / wys., profil W(y) | `crownSpreadRatio`, `crownShape`, `levels[0].lengthRatio` |
| `crownBase` | wysokość najniższego konara | `trunkHeightRatio` |
| `trunkLength`, `trunkLean` | przewodnik ginie w koronie / pochylenie | `trunkLengthRatio`, `trunkCurveV`, `scaffoldLimbs` |
| `L1/L2.perParent` | gęstość odgałęzień | `levels[i].count` |
| `L1/L2.angle`, `angleStd` | kąt odejścia w rzucie, rozrzut | `downAngle`, `downAngleV` |
| `angleSlope` | dolne bardziej rozłożyste niż górne | `downAngleSlope` |
| `lengthRatio` | długość / długość rodzica | `lengthRatio`, `lengthV` |
| `bend` | wygięcie nasada→koniec (+ w górę, − zwis) | `curve`, `tropism`, `pliancy` |
| `droop` | ułamek końcówek poniżej poziomu | `pliancy`, `tropism` |
| `wiggle` | falowanie (średni zwrot między cięciwami ~8% wys.) | `curveV`, `twigGnarl`, `kink` |
| `attachMean` | gdzie na rodzicu wyrastają dzieci | `trunkHeightRatio`, `prune` |

### Krok 3 — Kontrola końcowa
`fit_graph_<gatunek>.png`: szary = graf wzorca, kolor = graf kandydata. Potem render z kreską (`tree_headless_runner.ts`) i strażnik stylu (§3b / §4).

---

## 3b. Twarde Bezpieczniki Wymiarów 3D i Sanity Checks (3D Aspect Guard)

Podczas jakiegokolwiek strojenia generatora (czy to ręcznego, czy przez `fit_tree_graph.ts`) **bezwzględnie zakazuje się** polegania wyłącznie na spadku kosztu rzutu 2D:

1. **Wskaźnik smukłości korony ($W / H \le \text{limit}$)**:
   - Obliczany z `(res.bounds.crownRadius * 2) / res.bounds.height`.
   - Drzewa smukłe/kolumnowe (brzoza, topola, świerk): $W / H \le 0.40 - 0.45$.
   - Drzewa rozłożyste (dąb, lipa, buk): $W / H \le 0.75 - 0.85$.
   - **Czerwona flaga**: Jeśli korona osiąga $W / H > 1.0$ (drzewo szersze niż wyższe), profil jest odrzucany.
2. **Ochrona budżetu pędów (Stems Count Preservation)**:
   - Liczba pędów kandydata nie może spaść o więcej niż 20% względem gatunku bazowego.
3. **Pliancy Sanity Limit**:
   - `pliancy` powyżej 4.0 jest dozwolone **wyłącznie** dla wierzby płaczącej (`WILLOW`). Dla innych gatunków `pliancy` wynosi typowo 1.5 – 3.0.

---

## 3c. Zasada Strojenia Inkrementalnego (Incremental Steps Only)

- **Limit delty per krok (Max Delta $\le \pm 15\text{–}25\%$)**: parametry dostrajaj stopniowo.
- **Izolacja zmiennych i unikanie efektu wahadła**: diagnozuj przyczynę zamiast skrajnych kompensacji.
- **Weryfikacja miar fizycznych po każdym kroku**: sprawdzaj $W/H$, $W$, $H$ i liczbę pędów po każdej modyfikacji.

---

## 4. Przewodnik Iteracyjny: Jak Dopasować Kształt bez Utraty Stylu

### Niezmiennik Kompletności Produktów Wizualnych (Visual Deliverables Triad)
Po zakończeniu każdej iteracji strojenia lub utworzeniu nowego profilu generuj:
1. **Elewację — ulistnienie**: `<gatunek>_<wariant>.png`
2. **Elewację — szkielet kory i witek**: `<gatunek>_<wariant>_bark.png`
3. **Widok aksonometryczny 3D**: `<gatunek>_<wariant>_iso.png`

### Zasada Celowanej Interwencji Architektonicznej
Gdy zidentyfikowano konkretny mankament (np. pień nie zanika, gałęzie są za grube):
- Nie uruchamiaj ślepej optymalizacji wszystkich parametrów.
- Zidentyfikuj i zmodyfikuj konkretne pokrętła (`trunkTipRatio`, `trunkLengthRatio`, `trunkBaseRadiusRatio`, `TreeStroke.levelScale`, `tropism`).

### Zapisywanie Profilu
Zaakceptowany profil zapisuj przez flagę `--apply` w skrypcie `fit_tree_graph.ts` lub bezpośrednio do `src/core/fittedProfiles.json`.
Wszystkie zmiany w profilach muszą zachowywać integralność testów (`npm test`) i brak zależności runtime od `three` w głównym pakiecie.
