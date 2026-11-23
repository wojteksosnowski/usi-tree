# Wytyczne `usi-tree`

Konkrety (nazwy funkcji, parametry, progi, ścieżki) są w `docs/`. Tu tylko zasady i metody pracy.

## Architektura
- Fasada generatora jest bezstanowa; stan wzrostu żyje w kontekście per wywołanie, więc generacja jest re-entrantna.
- Typy domenowe w jednym miejscu; moduły mają wąskie, rozłączne odpowiedzialności.
- Rdzeń pakietu nie ma zależności uruchomieniowych; zmiany API i domyślnego wyglądu są wstecznie zgodne.

## Szkielet
- Szkielet jest ciągły matematycznie: zwężanie monotoniczne, bez uskoków, dziecko cieńsze od rodzica.

## Testy
- Testy silnika nie zależą od żywo strojonych danych; używają profili bazowych lub zamrożonych fixture.
- Testy geometrii mają jawne timeouty; E2E działają na prawdziwym silniku i serwerze, bez mocków.
- Zmiana geometrii domyślnych drzew wymaga świadomej aktualizacji sum kontrolnych.

## Odwrotne modelowanie
- Strojenie jest przyrostowe i chronione twardymi bezpiecznikami sylwetki oraz budżetu pędów.
- Artefakty robocze trafiają tylko do `tmp/`.

## Wiatr i liście
- Ruch wiatru działa na szkielet, nie na wierzchołki siatki w przestrzeni ekranu.
- Losowość liści jest deterministyczna i niezależna od ruchu pozostałych elementów.

## Wydajność i spójność wizualna
- Optymalizacja nie może zmieniać zachowania ani wyglądu. Inny algorytm (np. fizyka wiatru) wprowadza się jako osobną, opcjonalną ścieżkę, a nie jako „optymalizację”.
- Najpierw mierzyć, potem optymalizować: decyzje opierać na profilu (pliki trace w `tmp/`), a nie na domysłach.
- Warstwy pomocnicze (np. krawędzie, nakładki) muszą wynikać z tych samych danych i transformacji co obiekt główny, a nie z ich kopii.
- Zmian wizualnych i animacyjnych nie uznaje się za zweryfikowane bez obejrzenia rzeczywistego renderu.

## Narzędzia
- Interakcje w Studio są lekkie (podgląd na bieżąco, ciężka przebudowa po zakończeniu gestu); bez blokujących okien.
- Serwer MCP rejestrowany w jednym miejscu, bez duplikatów.

## Indeks docs/
- [architecture.md](docs/architecture.md): moduły, fasada, re-entrancy, eksporty.
- [skeleton-continuity.md](docs/skeleton-continuity.md): niezmienniki ciągłości szkieletu.
- [parameters-and-interpolation.md](docs/parameters-and-interpolation.md): parametry, `heightAnchors`, krzywe, zakresy.
- [leaves.md](docs/leaves.md): obrysy liści, szypułka, rozmiar, losowość.
- [wind.md](docs/wind.md): wiatr na szkielecie i opcjonalny oscylator.
- [fitter.md](docs/fitter.md): narzędzia CLI, profile, bezpieczniki.
- [testing.md](docs/testing.md): standardy testów.
- [tree-studio-and-mcp.md](docs/tree-studio-and-mcp.md): Studio, wydajność renderu, MCP.
