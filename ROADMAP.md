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
