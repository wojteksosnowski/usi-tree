# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Primal rules

1. Delegate implementation to sub-agents. Do small reads, greps, test/build runs and git yourself.
2. For implementation use the `worker` agent (`.claude/agents/worker.md`, Sonnet). Use Haiku (`model: haiku`) for I/O, code search and git.
3. A `worker` may spawn its own sub-agents only for large, self-contained parts of its task — never for small tasks.

Zasady i metody pracy są w @AGENTS.md; szczegóły techniczne (moduły, parametry, ciągłość, wiatr, liście, testy, fitter, Studio/MCP) w `docs/` (indeks na końcu AGENTS.md). Ten plik ich nie powtarza.

## Polecenia

```bash
npm test                                            # vitest run (cały zestaw)
npx vitest run src/__tests__/branchContinuity.test.ts   # jeden plik
npx vitest run -t "trunkTaper"                      # testy po nazwie
npm run typecheck                                   # tsc --noEmit
npm run build                                       # dist/ z tsconfig.build.json
npm run studio                                      # Tree Studio (scripts/tree-studio.ts), zapis do fittedProfiles.json
npm run mcp                                         # lokalny serwer MCP (scripts/tree-mcp.ts)
NODE_NO_WARNINGS=1 npx tsx <skrypt.ts>              # skrypty CLI / fitter / plansze
```

Rendery i pliki robocze trafiają do `tmp/` (ignorowany przez git). Plansza gatunków w jednej skali: `scripts/speciesBoard.ts`.

## Architektura (przepływ danych)

1. **Rodzaj drzewa → profil** (`src/core/treeSpeciesRegistry.ts`, `treeKindParams(kind, height)`): nazwa rodzaju (łacina/PL/EN/OSM) wskazuje wpis w `fittedProfiles.json` albo gatunek bazowy z `speciesProfiles.ts`. Tylko tu wysokość zmienia parametry:
   - wpis z `heightAnchors`: `profileAtHeight` (`heightProfile.ts`) dopasowuje dla każdego parametru krzywą lin/log/exp; zakresy i wartości domyślne pochodzą z `paramSpec.ts`;
   - bez węzłów: `scaleProfileByHeight` (prawa potęgowe względem 10 m).
2. **Profil → szkielet** (`TreeGenerator.buildSkeleton` → `GrowthContext` w `growthEngine.ts`): model Webera–Penna w jednostkach względnych (wysokość ≈ 1), deterministyczny z ziarna (`prng.ts`, `childSeed`). Formy pnia: `SINGLE`, `FORKED`, `MULTI` oraz `scaffoldLimbs`. Obwiednia korony z `crownEnvelope.ts` docina pędy. Wynik to lista `Stem` (punkty i promienie) przeskalowana do metrów przez `scale`.
3. **Szkielet → siatka** (`TreeGenerator.meshSkeletonRaw`, `meshExtruder.ts`, `meshBuilder.ts`): tuby i liście jako `Float32Array`/`Uint32Array`. LOD (`treeLod.ts`, `TREE_LOD_PRESETS`) zmienia tylko gęstość siatki, nie kształt szkieletu. Wiatr działa na szkielet (`applyWindToSkeleton`), nie na wierzchołki.
4. **Adaptery** (osobne punkty `exports` w `package.json`): `src/three` (BufferGeometry, `three` jest opcjonalnym peerem), `src/profiles`, `src/schema` (UsiTreeSpec `.utree.json`, `schema/`), `src/fitter` (metryki sylwetki do odwrotnego modelowania) i `src/cli`.

Z pakietu korzystają zewnętrzne aplikacje, więc zmiany w API i w domyślnym wyglądzie drzew powinny być wstecznie zgodne. Część testów (`treeLod`, `heightProfile`) przechowuje sumy kontrolne siatek: każda zmiana wzrostu, która zmienia geometrię domyślnych drzew, wymaga ich świadomej aktualizacji.
