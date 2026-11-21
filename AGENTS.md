# Wytyczne Architektoniczne i Rozwoju `usi-tree`

## 1. Architektura Generatora i Separacja Odpowiedzialności
- **Bezstanowa Fasada (`TreeGenerator.ts`)**: Klasa `TreeGenerator` pełni wyłącznie rolę fasady publicznej (wsteczna kompatybilność API). NIE wolno dodawać do niej mutowalnego stanu statycznego (`static shared*`, `static tmp`, `static envelope*`).
- **Re-entrancy i Bezpieczeństwo Współbieżne (`GrowthContext`)**: Wszelkie operacje wzrostu botanicznego muszą korzystać z instancyjnego kontekstu `GrowthContext` z [src/core/growthEngine.ts](file:///Volumes/Samsam/py/usi-tree/src/core/growthEngine.ts). Zapewnia to 100% thread-safety (np. w Web Workers).
- **Czystość Modułów**:
  - Typy domenowe: wyłącznie w [src/core/types.ts](file:///Volumes/Samsam/py/usi-tree/src/core/types.ts) (eliminuje cykle importów).
  - Profile morfologiczne: [src/core/speciesProfiles.ts](file:///Volumes/Samsam/py/usi-tree/src/core/speciesProfiles.ts).
  - Geometria obwiedni: [src/core/crownEnvelope.ts](file:///Volumes/Samsam/py/usi-tree/src/core/crownEnvelope.ts).
  - Wytłaczanie siatki i liście: [src/core/meshExtruder.ts](file:///Volumes/Samsam/py/usi-tree/src/core/meshExtruder.ts).
  - Bufory pamięci: [src/core/meshBuilder.ts](file:///Volumes/Samsam/py/usi-tree/src/core/meshBuilder.ts).

## 2. Standardy Testowania (Vitest)
- **Timeouty dla testów geometrii**: Złożone testy generujące siatki wielu drzew lub liście (foliage accents) muszą definiować jawny timeout (np. `it('...', () => { ... }, 30000)`), aby zapobiec fałszywym błędom po 5 sekundach.
- **Weryfikacja Re-entrancy**: Każda zmiana w silniku generacji musi zachowywać zdawalność testów w [src/__tests__/reentrancy.test.ts](file:///Volumes/Samsam/py/usi-tree/src/__tests__/reentrancy.test.ts).
- **Prawdziwe testy E2E bez mocków**: Weryfikacja wpływu parametrów na geometrię 3D (`TreeGenerator.generateRaw`) oraz zapisu (`POST /api/save-profile`) w [src/__tests__/studioE2e.test.ts](file:///Volumes/Samsam/py/usi-tree/src/__tests__/studioE2e.test.ts) musi działać na rzeczywistym silniku i serwerze HTTP (z kopią zapasową `fittedProfiles.json` w `try...finally`), bez żadnych mocków.
- **Matematyczna ciągłość szkieletu (brak uskoków)**: Każda zmiana w [src/core/growthEngine.ts](file:///Volumes/Samsam/py/usi-tree/src/core/growthEngine.ts) musi przechodzić testy w [src/__tests__/branchContinuity.test.ts](file:///Volumes/Samsam/py/usi-tree/src/__tests__/branchContinuity.test.ts):
  - Monotoniczne zwężanie wzdłuż każdego pędu (`s.r[i+1] <= s.r[i]`) oraz brak nagłych schodków między pierścieniami (`s.r[i+1] / s.r[i] >= 0.78`).
  - Promień nasady gałęzi potomnej zawsze mniejszy od promienia rodzica w punkcie odgałęzienia (`s.r[0] <= 0.9 * r_parent_at_attach`; redukcja po `prune` nie może podbijać `r0` przez `Math.max(MIN_RADIUS_RATIO, ...)` ponad wyjściowe `r0`).
  - Płynne przejście na rozwidleniu `FORKED` (`rTopFork = rMain`, min. 6 segmentów dolnego pnia z gładkim zanikiem `flareFactor`).

## 3. Integralność Pakietu i Eksportów
- Pakiet główny (`usi-tree`) oraz adaptery (`usi-tree/three`, `usi-tree/fitter`, `usi-tree/schema`, `usi-tree/profiles`) muszą zachowywać zero runtime dependencies w rdzeniu (`three` jest peerDependency opcjonalnym).

## 4. Narzędzia Odwrotnego Modelowania (TreeFit / Fitter) i Środowisko Robocze
- **Lokalizacja Skryptów CLI**: Wszystkie narzędzia ekstrakcji, translacji Sapling oraz strojenia grafu gałęzi znajdują się w `.agents/skills/procedural-tree-fitter/scripts/` i są uruchamiane przez `NODE_NO_WARNINGS=1 npx tsx`.
- **Baza Profili Gatunkowych**: Docelowym rejestrem wystrojonych profili jest `src/core/fittedProfiles.json`.
- **Izolacja Artefaktów Roboczych**: Tymczasowe rendery, grafy JSON i plansze porównawcze muszą być zapisywane wyłącznie w katalogu `tmp/` (np. `tmp/tree-renders/`), zignorowanym w `.gitignore`.
- **Twarde Bezpieczniki 3D (Sanity Checks)**:
  - Wskaźnik smukłości $W/H$: korona nie może przekraczać limitu gatunku (kolumnowe: $W/H \le 0.45$, rozłożyste: $W/H \le 0.85$, zakaz $W/H > 1.0$).
  - Strojenie inkrementalne: maksymalna delta parametru w jednym kroku $\le \pm 25\%$.
  - Ochrona budżetu pędów: liczba pędów kandydata nie może spaść o więcej niż 20% względem gatunku bazowego.

## 5. Ontogeneza, Liście, Wiatr i Tree Studio (`scripts/tree-studio.ts`)
- **Ciągłe dopasowanie krzywych wysokości (`heightProfile.ts`)**: Parametry zmienne między węzłami `heightAnchors` są dopasowywane przez `fitParameterCurve` (2 węzły: liniowo; ≥ 3 węzły: wybór najlepszego modelu z `{liniowa, logarytmiczna, wykładnicza}` wg SSE) z płynną ekstrapolacją powyżej ostatniego węzła (> 24 m).
- **Geometria liści i szypułki (`meshExtruder.ts`)**:
  - Obrysy liści (`tri` 1 trójkąt, `quad` 2 trójkąty, `penta` 3 trójkąty, `hex` 4 trójkąty oraz `leafOutline`) są symetryczne osiowo (`across = 0`) i przypięte wierzchołkiem `(0, 0)` do końca szypułki (`petioleLengthRatio` odsuwa nasadę blaszki od pędu i nie generuje trójkątów).
  - Rozmiar liścia może być zadany absolutnie w centymetrach (`leafSizeCm`), co ma priorytet nad `leafSizeRatio`.
  - Każde miejsce liścia (`site i`) w `addLeaves` musi korzystać z deterministycznego generatora ziarna indeksowanego numerem miejsca (`sitePrng`), aby ruch gałązek nie przesuwał strumienia losowań pozostałych liści.
- **Kinematyka wiatru**: Zabrania się deformowania wierzchołków siatki globalną falą `sin(x+y)` w przestrzeni ekranu. Wiatr ugina hierarchicznie szkielet (`TreeGenerator.applyWindToSkeleton` z zachowaniem długości segmentów i dziedziczeniem przesunięcia dla `stems[p].level <= stems[i].level`) oraz odchyla sztywne liście wokół szypułki wg `petioleLengthRatio` i `petiolePliancy`.
- **Tree Studio i MCP**:
  - Podczas przeciągania wierzchołków liścia (`onmousemove`) aktualizować wyłącznie podgląd SVG, a przebudowę drzewa 3D (`renderTree()`) wywoływać dopiero na `onmouseup`. Nie używać blokujących `alert()` (tylko `showToast`).
  - Lokalny serwer MCP (`scripts/tree-mcp.ts`) rejestrować wyłącznie w `.agents/mcp_config.json` (bez duplikowania w `.agents/plugins/`).
