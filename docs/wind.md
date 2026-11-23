# Wiatr

## Domyślna kinematyka (szkielet)
- Wiatr ugina hierarchicznie szkielet: `TreeGenerator.applyWindToSkeleton`, z zachowaniem długości segmentów i dziedziczeniem przesunięcia dla `stems[p].level <= stems[i].level`.
- Sztywne liście odchylają się wokół szypułki wg `petioleLengthRatio` i `petiolePliancy`.
- ZAKAZ deformowania wierzchołków siatki globalną falą `sin(x+y)` w przestrzeni ekranu.

## Opt-in: oscylator na pęd (`src/core/windOscillator.ts`, `windSkin`)
- Każdy pęd to oscylator wspornikowy: `ω ∝ r/L²`; deformacje składane hierarchicznie (dziecko dziedziczy obrót i przesunięcie rodzica w punkcie zaczepienia).
- `prepareWindRig` liczy raz na drzewo (zaczepienie, ω, A, φ, oś gięcia, kolejność rodzic -> dziecko); `evaluateWindRig(rig, t)` daje na pęd 8 liczb (`WIND_TRANSFORM_STRIDE`): kwaternion bazy, przesunięcie bazy, kąt gięcia β.
- Linia środkowa gnie się jak belka utwierdzona (przemieszczenie ~ s²); długości segmentów są zachowane.
- `windSkin: true` w `meshSkeletonRaw` tylko oznacza wierzchołki indeksem pędu (bez zmiany siatki; -1 = listowie); wejście dla `deformVertices`.
- To referencja CPU i wyrocznia dla przyszłego vertex shadera. Domyślna ścieżka pozostaje bez zmian.
- Jeszcze nieobsłużone: liście i normalne.
- Testy: `src/__tests__/windOscillator.test.ts`.
