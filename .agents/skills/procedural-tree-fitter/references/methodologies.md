# Metodyki Generowania Drzew i Odwrotnego Modelowania Proceduralnego

Niniejszy dokument stanowi kompendium wiedzy na temat wiodących metodyk komputerowej generacji drzew, ich matematycznych podstaw oraz technik odwrotnego modelowania proceduralnego (Inverse Procedural Modeling — IPM).

---

## 1. Odwrotne i Różniczkowalne Modelowanie Proceduralne (IPM / ADPM)

### 1.1. diff_procedural_generators (Garifullin i in.)
- **Repozytorium i Koncepcja**: Opracowane przez autorów prac nad odwrotnym modelowaniem proceduralnym z pojedynczych obrazów (Garifullin et al.). Zawiera implementacje generatorów roślinności powiązanych z optymalizacją ewolucyjną (algorytmy genetyczne, CMA-ES) oraz różniczkowalnymi aproksymacjami funkcji renderującej.
- **Zasada Działania**:
  1. **Wejście**: Pojedynczy obraz sylwetki lub fotografii drzewa (maska binarna lub mapa gęstości konturu).
  2. **Ekstrakcja Cech (Feature Descriptors)**: Wyznaczanie profilu szerokości korony $W(y)$, położenia środka ciężkości, udziału powierzchni pnia w odniesieniu do całości, wskaźnika porowatości (lacunarity) oraz rozkładu kierunkowego gradientów (Sobel / HOG).
  3. **Pętla Optymalizacji**: Generator proceduralny przyjmuje wektor parametrów $\theta \in \mathbb{R}^D$ (kąty gałęzi, zbieżności, długości, fototropizmy). Wygenerowana bryła rzutowana jest na płaszczyznę 2D, a funkcja straty $\mathcal{L}(\theta) = \mathcal{L}_{silhouette} + \lambda \mathcal{L}_{features} + \gamma \mathcal{L}_{regularization}$ minimalizowana jest iteracyjnie.
  4. **Unikanie Przeuczenia**: Użycie wielu ziaren PRNG ($\{s_1, \dots, s_K\}$) podczas ewaluacji pojedynczego zestawu parametrów $\theta$, co gwarantuje wyuczenie cech gatunku, a nie konkretnej instancji losowej.

### 1.2. Sorcar
- **Koncepcja**: Otwarty silnik proceduralnego modelowania węzłowego (Node-based Procedural Modeling) dla Blendera.
- **Rola w Ekosystemie**:
  - Umożliwia parametryzację operacji geometrycznych w postaci acyklicznego grafu skierowanego (DAG).
  - W modelowaniu drzew dostarcza wzorców dla generatorów opartych na przepływie szkieletu: generowanie krzywych bazowych -> dzielenie na segmenty (resample curve) -> ekstruzja promienia zmiennego wzdłuż parametru $t \in [0, 1]$ -> instancjonowanie gałęzi bocznych w punktach próbkowania.

---

## 2. L-Systemy i Ramy Biologiczne (FSPM)

### 2.1. L-Py / OpenAlea
- **Koncepcja**: Framework w języku Python integrujący gramatyki Lindenmayera (L-systemy) z biologicznie wierną symulacją architektury roślinnej (Functional-Structural Plant Models — FSPM).
- **Zasady Modelowania Architektury Roślin**:
  - **Przepisywanie Słów (String Rewriting)**: Zdefiniowane moduły osiowe, np. `A(l, r) -> F(l, r) [ +(downAngle) /(azimuth) A(l*k_l, r*k_r) ] A(l*k_l2, r*k_r2)`.
  - **Tropizmy Środowiskowe**:
    - *Fototropizm*: Wektor wzrostu pąka odchylany w stronę wektora światła $\vec{L}$ z wagą $w_{photo}$.
    - *Grawitropizm / Geotropizm*: Odchylanie gałęzi w kierunku przeciwnym do grawitacji (pnie wzniesione) lub w kierunku grawitacji (gałęzie płaczące, zwisające witki).
  - **Biomechanika i Sprężystość Pędów**:
    - W L-Py ugięcie pędu pod wpływem obciążenia własnego modelowane jest jako odkształcenie sprężyste belek (Euler-Bernoulli):
      $$\frac{d^2 y}{dx^2} = \frac{M(x)}{E \cdot I(x)}$$
      gdzie $M(x)$ to moment gnący od ciężaru dystalnej części gałęzi i ulistnienia, $E$ to moduł Younga drewna, a $I(x) = \frac{\pi r(x)^4}{4}$ to osiowy moment bezwładności przekroju kołowego.
    - Zależność ta bezpośrednio tłumaczy silne ugięcie pędów cienkich i długich (smukłych: $L/r \gg 1$) oraz brak ugięcia grubych konarów.

### 2.2. GroIMP (Growth Grammar-related Interactive Modelling Platform)
- **Koncepcja**: Otwarta platforma oparta na języku Java i formalizmie relacyjnych gramatyk wzrostu (RGG / język XL).
- **Zastosowanie**:
  - Symulacja rozwoju drzew w relacji ze środowiskiem (konkurencja o światło, alokacja asymilatów wg modelu rur Shinozakiego / Murraya).
  - Formalny opis hierarchii pędów:
    - Oś główna: rzędu 0 (Order 0 / trunk).
    - Konary szkieletowe: rzędu 1 (Scaffold limbs / primary boughs).
    - Gałęzie boczne: rzędu 2 (Secondary branches).
    - Witki i pędy ulistnione: rzędu 3+ (Twigs & leaf clusters).

---

## 3. Narzędzia dla Blendera i Silników Gier

### 3.1. Sapling Tree Gen (Model Webera–Penna 1995)
- **Podstawa Teoretyczna**: Jason Weber & Joseph Penn, *"Creation and Rendering of Realistic Trees"*, SIGGRAPH 1995.
- **Kluczowe Parametry i Założenia**:
  - **Hierarchia Poziomów (Levels 0..N)**: Poziom 0 reprezentuje pień/przewodnik, poziom 1 konary, kolejne poziomy — drobniejsze rozgałęzienia.
  - **Kąty Odejmowania (Down Angle)**: Kąt $\theta_{down}$ mierzony od osi wektora rodzica. Dla pnia 0°, dla konarów dolnych często 40–80°.
  - **Gradient Kąta (Down Angle Slope)**: Zmiana kąta odejścia w zależności od wysokości na pniu macierzystym (dolne konary rozłożyste, górne wzniesione ku koronie).
  - **Krzywizny i Załamania (Curve, CurveV, Kink)**:
    - `curve`: Systematyczne wygięcie ku górze (+) lub dołowi (-).
    - `curveV`: Losowe falowanie (wariacja) per segment.
    - `kink`: Dyskretne załamanie kierunku osi w węźle rozgałęzienia (efekt sympodialnego wzrostu gałęzi).
  - **Pruning (Przycinanie do Obwiedni)**: Zamiast urywania pędów na obwiedni korony, pędy są proporcjonalnie skracane przed symulacją, by mieścić się w profilu korony (stożek, kula, płomień, parasol).

### 3.2. Zestawy Węzłów Geometry Nodes (Blender)
- **Nowoczesne Wzorce**:
  - Dystrybucja punktów na krzywych wg filotaksji złotego kąta ($\Phi \approx 137.5077°$).
  - Kontrola profilu promienia za pomocą krzywych `Float Curve` (flare przy odziomku, zbieżność $r(t)$, bezpieczny promień końcówki).
  - Deformacje osi wektorami szumu (Simplex/Perlin noise) w relacji do grubości: grube elementy zachowują stabilną strukturę, cienkie gałązki otrzymują drobne zafalowania.
