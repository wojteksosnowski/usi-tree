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
