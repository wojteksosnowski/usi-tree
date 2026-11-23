# Ciągłość matematyczna szkieletu (brak uskoków)

Każda zmiana w `src/core/growthEngine.ts` musi przechodzić `src/__tests__/branchContinuity.test.ts`
(w MCP: narzędzie `check_branch_continuity`, zob. [tree-studio-and-mcp.md](tree-studio-and-mcp.md)).

## Zwężanie wzdłuż pędu
- Monotonicznie: `s.r[i+1] <= s.r[i]`.
- Brak schodków między pierścieniami: `s.r[i+1] / s.r[i] >= 0.78`.

## Nasada gałęzi potomnej
- `s.r[0] <= 0.9 * r_parent_at_attach` (promień dziecka mniejszy od promienia rodzica w punkcie odgałęzienia).
- Redukcja po `prune` nie może podbijać `r0` przez `Math.max(MIN_RADIUS_RATIO, ...)` ponad wyjściowe `r0`.

## Rozwidlenie `FORKED`
- `rTopFork = rMain`.
- Min. 6 segmentów dolnego pnia z gładkim zanikiem `flareFactor`.
