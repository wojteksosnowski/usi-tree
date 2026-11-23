# Odwrotne modelowanie (TreeFit / Fitter)

- Skrypty CLI (ekstrakcja, translacja Sapling, strojenie grafu gałęzi) są w `.agents/skills/procedural-tree-fitter/scripts/`; uruchamiane `NODE_NO_WARNINGS=1 npx tsx`.
- Docelowy rejestr wystrojonych profili: `src/core/fittedProfiles.json`.
- Artefakty robocze (rendery, grafy JSON, plansze) wyłącznie w `tmp/` (np. `tmp/tree-renders/`), ignorowanym przez git.

## Twarde bezpieczniki 3D
- Smukłość W/H: kolumnowe `<= 0.45`, rozłożyste `<= 0.85`, zakaz `> 1.0`.
- Strojenie inkrementalne: maks. delta parametru w kroku `<= ±25%`.
- Budżet pędów: liczba pędów kandydata nie spada o więcej niż 20% względem gatunku bazowego.
