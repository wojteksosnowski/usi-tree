# `usi-tree` Roadmap & Future Milestones

## 1. NPM Registry Publication
- [ ] Utworzenie / weryfikacja konta na [npmjs.com](https://www.npmjs.com) dla organizacji lub użytkownika `@wojteksosnowski`.
- [ ] Zalogowanie lokalne w terminalu:
  ```bash
  npm login
  ```
- [ ] Publikacja oficjalnej wersji publicznej `0.1.0`:
  ```bash
  cd /Volumes/Samsam/py/usi-tree
  npm publish --access public
  ```
- [ ] Konfiguracja automatycznego publikowania przez GitHub Actions (`.github/workflows/publish.yml`) z użyciem secretu `NPM_TOKEN` przy tworzeniu tagu/release (`v*`).

## 2. Standard Rozszerzony (USI Tree Standard v1.1+)
- [ ] Obsługa wariantów pnia i kory: proceduralne tekstury kory (normal maps / displacement) oparte na parametrach biomechanicznych (`flutingLobes`, `gnarliness`, `fiberTwist`).
- [ ] Sezonowość fenologiczna: parametry cyklu wegetacyjnego (kwitnienie wiosenne, przebarwienia jesienne, zrzucanie liści na zimę) w specyfikacji `appearance.phenology`.
- [ ] Wzbogacenie bazy prekalibrowanych gatunków (m.in. sosna czarna, modrzew europejski, grab pospolity, robinia akacjowa).

## 3. Ekosystem i Narzędzia
- [ ] Web Playground / Viewer dla specyfikacji `.utree.json` (podgląd 3D Three.js w przeglądarce).
- [ ] Eksportery do formatów CAD/BIM: IFC 4x3 (`IfcGeographicElement` / tree proxy) oraz glTF / USDZ.
- [ ] Integracja z miejskimi chmurami punktów LiDAR (dopasowywanie parametrów `TreeFit` do chmury punktów drzewa).

## 4. Poziomy geometryczne siatki (LOD) — 0.2.0
- [x] `TreeMeshLod` + `TREE_LOD_PRESETS` (`near` / `mid` / `far` / `shell`): degradacja samej siatki przy wspólnym szkielecie i wspólnych, zagnieżdżonych miejscach liści (far ⊂ mid ⊂ near). Kora: pierścienie wybierane tolerancją cięciwy, pręty trójkątne, budżet trójkątów; listowie: romb / trójkąt o polu sześciokąta, mniej liści = większe (stała pokryta powierzchnia); `shell`: zamknięta bryła korony z miejsc liści w trzech tonach.
- [x] `TreeGenerator.meshSkeletonLodsRaw` (rdzeń) i `meshSkeletonLods` (`usi-tree/three`) — siatki z liczbą trójkątów kory i listowia. Bez `lod` wynik bit w bit jak w 0.1.0.
- [x] Miara zachowania wyglądu `usi-tree/fitter` → `lodFidelity` (IoU masek rzutu bocznego i z góry, kora osobno, udział tonów); pomiar: `npx tsx scripts/lodBaseline.ts`, test `src/__tests__/treeLod.test.ts`.
- [x] Runda 2 po kontroli wizualnej plansz: poziomy z powiększeniem rysują tępe płaty zwrócone na zewnątrz korony, przycięte do zasięgu chmury liści (bez kolców, także u iglastych); kolejność wyboru miejsc warstwowana (piętra × sektory); `shell` = zamknięty rdzeń + płaty; `lodFidelity` mierzy też wystawanie, chropowatość obrysu i jasność widocznego listowia.
- [x] Runda 3 po pomiarze w aplikacji (las, oświetlenie Lamberta z cieniami): liść poziomu dalszego to powiększony liść poziomu bliskiego (ten sam obrys — sześciokąt / pięciokąt — i ta sama procedura losowania orientacji), przesuwany ku osi korony zamiast obracania; `lodLitFidelity` mierzy luminancję rzutu aksonometrycznego z cieniem własnym, pole rzutu i pole cienia na gruncie względem `near`; `leafPolygonStats` — kształt i rozkład orientacji liści.

## 5. Pamięć geometrii drzew (z integracji w usi-light)

> Analiza wykonana w aplikacji usi-light (Światło); ścieżki `src/components/preview/*` i `src/engine/trees/*` dotyczą repozytorium usi-light. Kwantyzacja atrybutów (pkt 1) i rezygnacja z prewarmu `near` (pkt 3) są wdrażane po stronie aplikacji — do rozważenia przeniesienie do `RawTreeMesh` / `usi-tree/three`.


### Root Causes of Tree `BufferGeometry` Heap Footprint
Across `src/components/preview/IsoTrees.tsx`, `src/components/preview/isoTreeLibrary.ts`, `src/components/preview/isoTreePrewarm.ts`, and `src/components/preview/isoTreeVariantMesh.ts`:
1. **Uncompressed `Float32Array` vertex attributes (`isoTreeLibrary.ts:65-73`)**:
   - `normal` uses `Float32Array` (12 B/vertex) instead of normalized `Int8Array` (3 B/vertex, **4× smaller**).
   - `color` uses `Float32Array` (12 B/vertex) instead of normalized `Uint8Array` (3 B/vertex, **4× smaller**).
   - `position` uses `Float32Array` (12 B/vertex); for local tree bounds, quantized `Int16Array` + scale/offset (6 B/vertex, **2× smaller**) is sufficient.
2. **Cache key explosion by `heightM` (`isoTreeLibrary.ts:78-79`)**:
   - `treeVariantKey` includes `shape.heightM`, so every distinct tree height allocates separate `bark` + `foliage` `BufferGeometry` pairs instead of scaling a unit/canonical height variant via `InstancedMesh` instance matrix.
3. **Eager prewarming & retention of all 4 LODs (`isoTreePrewarm.ts:290-291`, `isoTreeLibrary.ts:29`)**:
   - `prewarmOtherLods` pre-builds `near`, `mid`, `far`, and `shell` LODs in the background, multiplying cached `BufferGeometry` count by 4× even when only 1–2 LODs are ever viewed.
4. **Up to 6 variants per species (`src/engine/trees/treeVariants.ts:8-9`)**:
   - `TREE_VARIANTS_MAX = 6` × 4 LODs × 2 parts (`bark`, `foliage`) = up to 48 `BufferGeometry` objects per species/height/form combination.

### Recommended Non-Triangle-Count Optimizations
1. **Quantize vertex attributes in `rawPartGeometry` (`isoTreeLibrary.ts`)**:
   - Convert `normal` → `Int8Array` (`normalized: true`) and `color` → `Uint8Array` (`normalized: true`).
   - Use `Uint16Array` for `index` whenever vertex count `< 65535`.
2. **Normalize tree height in `treeVariantKey` (`isoTreeLibrary.ts:78-79`)**:
   - Remove `shape.heightM` from the geometry cache key (or bucket into coarse height classes) and apply exact height via the `InstancedMesh` instance matrix.
3. **Cap `TREE_VARIANTS_MAX` (e.g. `6` → `3–4`)** for distant/secondary species and **disable eager `prewarmOtherLods` for `near` LOD** until the camera actually zooms in.
4. **Evict inactive LODs**: When `stepTreeLod` settles on a new LOD, allow `evictTreeVariants` to drop `near` (the heaviest LOD) when the scene is zoomed out to `far`/`shell`.
