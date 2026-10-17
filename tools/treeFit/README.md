# Iteracyjne udoskonalanie silnika drzew (`src/engine/vegetation/TreeGenerator.ts`)

Pętla: **uwaga do sylwetki → mechanizm w generatorze → ocena → dopasowanie → porównanie wizualne → decyzja**.
Dwa rodzaje wzorców (katalog `reference/design/drzewa/`, poza repo, np. OneDrive):
- **kształt gatunku:** alfabet drzew `tree-alphabet.jpeg`, liczbowo (`silhouetteMetrics`);
- **styl (stabilizacja):** `SA_Artboard2_*.webp` (styl B/B2: kontur korony, rozgałęzione pnie), `SA_AI_Template-1.webp` oraz ryciny w tym samym katalogu. Zmiana poprawiająca odległość od alfabetu nie może rozjechać stylu.

## Narzędzia

| Skrypt | Do czego |
|---|---|
| `extractReference.ts <alfabet.jpeg> <out.json>` | wyodrębnia 26 sylwetek wzorca i ich miary → `referenceMetrics.json` (raz, przy zmianie miar) |
| `silhouetteMetrics.ts` | miary sylwetki wspólne dla wzorca i generatora (proporcje, nasada korony, pień, profil szerokości, gęstość i kierunki kreski) |
| `rasterize.ts`, `evaluate.ts` | elewacja szkieletu jako maska w skali wzorca; `evalProfile` = średnia odległość miar po ziarnach `SEEDS` |
| `evalProfiles.ts [wzorzec] [pole=wartość …] [--write]` | szybka ocena dopasowanych profili bez ponownego dopasowania; nadpisania pól (`scaffoldLimbs=4`, `levels.0.count=8`, `form="SINGLE"`) pokazują, czy zmiana pomaga |
| `structureMetrics.ts`, `structureReport.ts [wzorzec] [pole=wartość …]` | wskaźnik granatu: udział gałęzi uciętych na obwiedni, kikutów, gałęzi do środka korony, średni zwrot w węźle; raport przed/po |
| `fitSpecies.ts [iteracje] [wzorzec,…]` | wyżarzanie parametrów (`FIT_KEEP_SCAFFOLD=1`: bez wyłączania konarów głównych; `FIT_STRUCTURE_WEIGHT`, `FIT_STEM_BUDGET`, `FIT_TIDY`, `FIT_OUT` — opis w nagłówku skryptu). Z listą wzorców dopasowuje tylko je, startując od dotychczasowego wyniku + `START_PATCH`, i zostawia resztę `src/engine/vegetation/fittedProfiles.json` |
| `renderComparison.ts <alfabet.jpeg> <out.png>` | plansza: wzorzec obok naszych sylwetek ×3 ziarna, z odległością przed/po |
| `strokeCompare.ts <SA_Artboard2.webp> [out.json] [--fit]` | kreska stylu B: grubość pnia (5/15/25% wysokości), konarów i gałęzi / wysokość — wzorzec (kora z barwy, pokrycie pikseli) wobec naszych gatunków; `--fit` kalibruje `ILLUSTRATION_STROKE.levelScale` (miary w `strokeMetrics.ts`) |
| `../renderTreeVariantsHeadless.ts` | rendery 3D wariantów stylu (Playwright) |

Uruchamianie: `NODE_NO_WARNINGS=1 npx tsx scripts/treeFit/<skrypt>.ts …`

## Jedna iteracja

1. **Uwaga → mechanizm.** Brak kształtu, którego parametry nie wyrażą (np. „brakuje konarów głównych”), to nowa reguła wzrostu w generatorze, nie strojenie liczb. Nowe pole `SpeciesProfile` jest opcjonalne, a jego brak daje dotychczasowy wynik. Sprawdzenie: `evalProfiles.ts` bez argumentów musi dać te same odległości dla nietkniętych gatunków.
2. **Szybka próba:** `evalProfiles.ts Elm scaffoldLimbs=4`. Gorszy wynik bez dopasowania jest normalny, bo pozostałe parametry stroiły się pod stary mechanizm.
3. **Dopasowanie częściowe:** dopisz punkt startowy do `START_PATCH`, potem `fitSpecies.ts 400 Elm`. Jeśli mechanizm ma podlegać wyżarzaniu, dodaj mutację w `mutate`.
4. **Porównanie wizualne:** `renderComparison.ts`. Miary nie widzą struktury (np. liczby konarów), więc decyduje obraz *i* liczba. Zmianę przyjmujemy, gdy nie pogarsza odległości, a wizualnie realizuje uwagę.
4b. **Stabilizacja stylu:** `TREE_MODES=style_b2,style_fitted_b npx tsx scripts/renderTreeVariantsHeadless.ts` (wynik w `tmp/tree-renders/`) i porównanie obok wzorców stylu. Sprawdzamy: grubość i zbieżność pnia, płynność konarów, charakter konturu korony, gęstość kreski, proporcje. Regresja stylu blokuje zmianę tak samo jak gorsza odległość.
5. **Decyzja per gatunek.** Mechanizm, który pogarsza gatunek, zostaje dla niego wyłączony (przykład: konary główne pomagają wiązowi, a kasztanowiec we wzorcu ma przewodnik do szczytu).
6. **Zapis:** zostaje `src/engine/vegetation/fittedProfiles.json` z wynikiem, a tabela odległości (przed → po) trafia do opisu commitu i do artefaktu przeglądu.

## Dziennik iteracji

| Data | Uwaga | Mechanizm | Wynik |
|---|---|---|---|
| 2026-10-15 | wiąz: „brakuje kilku konarów, z których idą gałęzie” | `scaffoldLimbs`: przewodnik kończy się w nasadzie korony i rozpada na N konarów głównych (słaby fototropizm, łuk na zewnątrz) | wiąz 0,511 → 0,451, widoczne konary główne; kasztanowiec 0,890 → 1,096 → wycofany (wzorzec ma przewodnik). Styl B: wiąz najbliższy SA_Artboard2 (tam prawie każde drzewo rozpada się nisko na konary) |
| 2026-10-15 | właściciel: „poprawić pień i gałęzie, żeby lepiej naśladowały wzorzec” (SA_Artboard2) | kreska siatki `ILLUSTRATION_STROKE` (`meshSkeleton({ stroke })`): pień ×1,45, konary ×1,9, wygładzona zbieżność, odziomek na 7% wysokości — szkielet i odległość bez zmian; konary główne próbowane dla buka, lipy, jawora, dębu, jabłoni (`FIT_KEEP_SCAFFOLD=1`) | konary główne odrzucone (wszystkie gorsze: 0,87–1,72); dopasowanie 2000 kroków: buk 0,857 → 0,646, jawor 0,893 → 0,682, dąb 0,781 → 0,620; lipa i jabłoń bez zmian. Alfabet i wzorzec stylu ciągną w różne strony — kształt z alfabetu, kreska ze stylu |
| 2026-10-15 | właściciel: „zmierz we wzorcu szerokość pni i gałęzi względem wysokości drzewa; algorytm ma to replikować” | `strokeCompare.ts`: pomiar SA_Artboard2 (mediana 12 drzew: pień 3,85 / 3,28 / 2,56%, konary 2,74%, gałęzie 0,82% wysokości) i kalibracja mnożników rzędów | iteracja 2 (×1,45 / ×1,9 / ×1,35, wzrokowo) dawała pień 5,7 / 4,7 / 3,0%, gałęzie 0,64% — za gruby pień, za cienkie gałęzie. Po kalibracji `levelScale [1,0, 1,65, 2,9, 1]`, odziomek 3%: 4,8 / 2,8 / 2,4%, konary 3,0%, gałęzie 0,76% |
| 2026-10-15 | właściciel: „drzewa wyglądają jak trafione granatem” | `TIDY_STRUCTURE` (Weber–Penn/Sapling): `prune` — pęd skracany przed wzrostem zamiast urywania kikutem na obwiedni; `outwardBias` — gałęzie rzędu ≥ 2 na zewnątrz korony; złoty kąt; `twigGnarl`, `kinkScale` — spokojniejsze witki. Miara struktury `structureMetrics.ts` (wskaźnik granatu) w koszcie dopasowania (`FIT_STRUCTURE_WEIGHT=0.5`), budżet pędów sprzed zmiany (`FIT_STEM_BUDGET`, trójkąty w 3D), 5 ziaren | na 12 ziarnach spoza dopasowania (`TREEFIT_SEEDS`): sylwetka lepsza w 11/11, średnio 1,309 → 1,077; wskaźnik granatu ~0,82 → ~0,32; trójkąty na wariant −3% (near) / −4% (far). Wcześniejsze „pogorszenie” na 3 ziarnach dopasowania było przeuczeniem: stare profile na nowych ziarnach dawały ~2× większą odległość |

Obserwacje ze wzorców stylu (do kolejnych iteracji): pnie we wzorcu są grubsze i wyraźnie zbieżne, konary płynne; nasze kontury korony są bardziej poszarpane i rozdrobnione, a pnie cienkie.

Uwaga metodyczna: dopasowanie i ocena używają domyślnie tych samych 3 ziaren, więc odległość jest liczona na danych uczących i łatwo o przeuczenie (każda zmiana zużycia losowości wygląda wtedy na pogorszenie). Kontrola: `TREEFIT_SEEDS=$(seq -s, 1000 37 1407) npx tsx scripts/treeFit/evalProfiles.ts` — 12 ziaren spoza dopasowania. `structureReport.ts` porównuje wskaźnik granatu i sylwetkę.
