# Tree Studio i MCP

## Tree Studio (`scripts/tree-studio.ts`)
- Przeciąganie wierzchołków liścia (`onmousemove`) aktualizuje wyłącznie podgląd SVG; przebudowa 3D (`renderTree()`) dopiero na `onmouseup`.
- Bez blokujących `alert()`; używać `showToast`.
- Przepływ pracy, wykres krzywej parametru i allometria: [parameters-and-interpolation.md](parameters-and-interpolation.md), sekcja 4.

## Wydajność renderowania (szczegóły)
- Minimalizować liczbę wywołań rysowania: grupować bufory po materiale, bez rozbijania na pojedyncze elementy; nie przebudowywać siatek na CPU w pętli klatek.
- Warstwy pomocnicze (krawędzie, obrysy, nakładki) podlegają tym samym transformacjom wierzchołków co siatka główna.
- Profile z Chrome DevTools Performance analizować narzędziem MCP `analyze_chrome_trace` na kopiach trace w `tmp/`.

## Serwer MCP (`scripts/tree-mcp.ts`, `npm run mcp`)
- Rejestrować wyłącznie w `.agents/mcp_config.json` (bez duplikatu w `.agents/plugins/`).
- Narzędzia: `inspect_tree_geometry` (trójkąty, bounds, W/H, liczba pędów), `get_assertion_model` (model asercyjny 12 m, ziarno 1111), `check_branch_continuity`, `update_tree_parameter` (parametr węzła w `fittedProfiles.json`), `analyze_chrome_trace`.
- `analyze_chrome_trace` (`tracePath`, opcjonalnie `topN`, domyślnie 15): czasy klatek z `DrawFrame` (fallback `BeginMainThreadFrame`), tylko z pid o największej liczbie takich zdarzeń, po sortowaniu wg `ts`; zwraca `frameCount`, `avgFrameMs`, `p50FrameMs`, `p95FrameMs`, `maxFrameMs`, `approxFps`. Hotspoty liczone wg czasu własnego (self time: dla każdego (pid, tid) czas zdarzenia minus czas dzieci; obsługiwane `X` oraz pary `B`/`E`), posortowane po `selfMs`, z `totalMs` (inclusive), `count`, `maxMs`. Brak pliku lub zły `topN` zwraca błąd.
