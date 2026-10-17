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
