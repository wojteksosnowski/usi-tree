# Standardy testowania (Vitest)

- Testy geometrii wielu drzew lub liści (foliage accents) mają jawny timeout, np. `it('...', () => { ... }, 30000)` (domyślne 5 s daje fałszywe błędy).
- Testy silnika (inwarianty LOD, sumy kontrolne siatek, ciągłość) NIE zależą od `src/core/fittedProfiles.json` (stale strojony). Używają bazowych profili gatunkowych lub zamrożonych fixture w `src/__tests__/fixtures/`.
- Testy po żywych profilach sprawdzają tylko własności odporne: niepusta siatka, brak NaN, monotoniczność liczby trójkątów.
- Sumy kontrolne (`treeLod`, `heightProfile`): zmiana geometrii domyślnych drzew wymaga ich świadomej aktualizacji.
- Każda zmiana silnika zachowuje zdawalność `src/__tests__/reentrancy.test.ts` oraz `src/__tests__/branchContinuity.test.ts` ([skeleton-continuity.md](skeleton-continuity.md)).
- E2E bez mocków (`src/__tests__/studioE2e.test.ts`): wpływ parametrów na geometrię (`TreeGenerator.generateRaw`) i zapis (`POST /api/save-profile`) na prawdziwym silniku i serwerze HTTP, z kopią zapasową `fittedProfiles.json` w `try...finally`.
