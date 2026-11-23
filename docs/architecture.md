# Architektura i separacja odpowiedzialności

Przepływ danych (rodzaj drzewa, profil, szkielet, siatka, adaptery) opisuje `CLAUDE.md`; tu są reguły podziału modułów.

## Bezstanowa fasada
- `src/core/TreeGenerator.ts` jest wyłącznie publiczną fasadą (wsteczna kompatybilność API).
- Do `TreeGenerator` NIE wolno dodawać mutowalnego stanu statycznego (`static shared*`, `static tmp`, `static envelope*`).

## Re-entrancy (`GrowthContext`)
- Wszelkie operacje wzrostu botanicznego korzystają z instancyjnego kontekstu `GrowthContext` z `src/core/growthEngine.ts`.
- Daje to pełną thread-safety (np. Web Workers). Test strażnika: `src/__tests__/reentrancy.test.ts`.
- Również `src/core/windOscillator.ts` to czyste funkcje bez stanu statycznego (własnością rigu jest tylko `rig.work`).

## Czystość modułów
- Typy domenowe: wyłącznie `src/core/types.ts` (eliminuje cykle importów).
- Profile morfologiczne: `src/core/speciesProfiles.ts`.
- Geometria obwiedni: `src/core/crownEnvelope.ts`.
- Wytłaczanie siatki i liście: `src/core/meshExtruder.ts`.
- Bufory pamięci: `src/core/meshBuilder.ts`.
- Domyślne wartości i zakresy parametrów: `src/core/paramSpec.ts` (zob. [parameters-and-interpolation.md](parameters-and-interpolation.md)).

## Integralność pakietu i eksportów
- Pakiet główny (`usi-tree`) oraz adaptery (`usi-tree/three`, `usi-tree/fitter`, `usi-tree/schema`, `usi-tree/profiles`) zachowują zero runtime dependencies w rdzeniu.
- `three` jest opcjonalnym peerDependency.
- Zmiany API i domyślnego wyglądu drzew muszą być wstecznie zgodne (z pakietu korzystają zewnętrzne aplikacje).
