# Geometria liści i szypułki (`src/core/meshExtruder.ts`)

- Obrysy liści: `tri` (1 trójkąt), `quad` (2), `penta` (3), `hex` (4) oraz `leafOutline`. Są symetryczne osiowo (`across = 0`) i przypięte wierzchołkiem `(0, 0)` do końca szypułki.
- `petioleLengthRatio` odsuwa nasadę blaszki od pędu i nie generuje trójkątów.
- Rozmiar absolutny w centymetrach (`leafSizeCm`) ma priorytet nad `leafSizeRatio`.
- Każde miejsce liścia (`site i`) w `addLeaves` używa deterministycznego generatora indeksowanego numerem miejsca (`sitePrng`), aby ruch gałązek nie przesuwał strumienia losowań pozostałych liści.
- Tabela parametrów liści: [parameters-and-interpolation.md](parameters-and-interpolation.md), sekcja 2.3.
