import { describe, it, expect } from 'vitest';
import LOD_FIXTURE from './fixtures/lodProfiles.json';
import {
  TreeGenerator,
  SPECIES_PROFILES,
  FITTED_PROFILES,
  ILLUSTRATION_STROKE,
  DEFAULT_LEAF_DENSITY,
  TREE_LOD_PRESETS,
  pickTreeLodForScale,
  countMeshTriangles,
  treeKindParams,
  type RawTreeMesh,
  type SpeciesProfile,
  type TreeKind,
  type TreeSpecies,
  type TreeLodName,
  type TreeLodRawResult,
  type TreeSkeleton,
} from '../index.js';
import { MAX_LEAF_SIZE_SCALE, MAX_LEAF_SIZE_SCALE_BUDGET, collectLeafSites, isFullLeafLod, selectLeafSites, selectStemRings } from '../core/meshExtruder.js';
import {
  lodFidelity,
  lodFidelityMany,
  lodLitFidelity,
  leafPolygonStats,
  leafSpikiness,
  lodFrame,
  rasterizeMesh,
  maskArea,
  fillMaskOutline,
  maskIoU,
  type LodFidelity,
  type LodLitFidelity,
} from '../fitter/index.js';
import { TreeGenerator as ThreeTreeGenerator } from '../three/index.js';

/** Zamrożona migawka profili (fixtures/lodProfiles.json): inwarianty LOD nie zależą od żywego fittedProfiles.json */
const FIXTURE = LOD_FIXTURE as unknown as Record<string, { species: TreeSpecies; form: 'SINGLE' | 'FORKED' | 'MULTI'; profile: SpeciesProfile }>;
const KINDS = Object.keys(FIXTURE) as TreeKind[];
const LIVE_KINDS = [...new Set([...Object.keys(SPECIES_PROFILES), ...FITTED_PROFILES.map((f) => f.ref)])] as TreeKind[];
const SEEDS = [11, 22, 33];
const HEIGHT = 10;
const LEVELS: TreeLodName[] = ['near', 'mid', 'far', 'shell'];
const MESH_PARAMS = { withFoliageAccents: true, stroke: ILLUSTRATION_STROKE } as const;

/** Profil widoku bliskiego aplikacji (usi-light, `CITY_FOLIAGE.near`): rzadsze, większe liście — do niego odnoszą się poziomy */
function cityProfile(b: SpeciesProfile): SpeciesProfile {
  return {
    ...b,
    leafDensity: (b.leafDensity ?? DEFAULT_LEAF_DENSITY) * 0.3,
    leafSizeRatio: b.leafSizeRatio * 3.2,
    leafClump: Math.max(1, Math.round((b.leafClump ?? 4) * 0.4)),
  };
}

function skeletonOf(kind: TreeKind, seed: number): TreeSkeleton {
  const p = FIXTURE[kind];
  const sk = TreeGenerator.buildSkeleton({ species: p.species, height: HEIGHT, seed, form: p.form, profile: p.profile });
  return { ...sk, profile: cityProfile(sk.profile) };
}

function lodsOf(sk: TreeSkeleton): TreeLodRawResult[] {
  return TreeGenerator.meshSkeletonLodsRaw(sk, LEVELS.map((n) => TREE_LOD_PRESETS[n]), MESH_PARAMS);
}

/** Dotychczasowa siatka bliska aplikacji (bez `lod`) */
function legacyNear(sk: TreeSkeleton): RawTreeMesh {
  return TreeGenerator.meshSkeletonRaw(sk, { ...MESH_PARAMS, detail: 'LOW', radialSegments: 4 }).mesh;
}

function meshChecksum(mesh: RawTreeMesh): string {
  let h = 2166136261;
  for (const arr of [mesh.positions, mesh.normals, mesh.indices]) {
    const u = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < u.length; i++) {
      h ^= u[i];
      h = Math.imul(h, 16777619);
    }
  }
  return `${(h >>> 0).toString(16)}:${mesh.indices.length}:${JSON.stringify(mesh.groups.map((g) => [g.start, g.count, g.materialIndex]))}`;
}

// Wszystkie rodzaje × ziarna liczone raz: poziomy, miara wyglądu względem `near`, zgodność `near` z dotychczasową siatką
interface Sample {
  kind: TreeKind;
  seed: number;
  sk: TreeSkeleton;
  lods: TreeLodRawResult[];
  fidelity: LodFidelity[]; // mid, far, shell względem near
  lit: LodLitFidelity[]; // jw., w oświetleniu aplikacji
  nearVsLegacy: LodFidelity;
  legacyTriangles: number;
}
const SAMPLES: Sample[] = [];
for (const kind of KINDS) {
  for (const seed of SEEDS) {
    const sk = skeletonOf(kind, seed);
    const lods = lodsOf(sk);
    const legacy = legacyNear(sk);
    SAMPLES.push({
      kind,
      seed,
      sk,
      lods,
      fidelity: lodFidelityMany(lods[0].mesh, [lods[1].mesh, lods[2].mesh, lods[3].mesh]),
      // Miara oświetlona jest kosztowna (bufory głębi kamery i trzech słońc): jedno ziarno na rodzaj
      lit: seed === SEEDS[0] ? [1, 2, 3].map((i) => lodLitFidelity(lods[0].mesh, lods[i].mesh, { size: 128 })) : [],
      nearVsLegacy: lodFidelity(legacy, lods[0].mesh),
      legacyTriangles: countMeshTriangles(legacy).total,
    });
  }
}

/** Pułapy trójkątów (kora + korona) poziomów dalszych */
// Twardy budżet liści (drabina 2026-11-23): mid ≤ 5000 czworokątów, far ≤ 2400 trójkątów + kora
const TRIANGLE_CEILING: Record<Exclude<TreeLodName, 'near'>, number> = { mid: 7900, far: 3090, shell: 270 };

describe('poziomy LOD siatki drzewa (TREE_LOD_PRESETS)', () => {
  it('liść nie jest powiększany ponad pułap (1,5; poziomy z twardym budżetem `maxLeaves` — MAX_LEAF_SIZE_SCALE_BUDGET); twardy budżet; progi skali monotoniczne', () => {
    for (const s of SAMPLES) {
      const field = collectLeafSites(s.sk.stems, s.sk.profile, s.sk.seed, s.sk.leafSites);
      for (const n of LEVELS) {
        const lod = TREE_LOD_PRESETS[n];
        const sel = selectLeafSites(field, s.sk.profile, lod);
        const cap = lod.maxLeaves !== undefined && !lod.crownShell ? MAX_LEAF_SIZE_SCALE_BUDGET : MAX_LEAF_SIZE_SCALE;
        expect(sel.sizeScale, `${s.kind} ${n}`).toBeLessThanOrEqual(cap + 1e-9);
        if (lod.maxLeaves !== undefined && !lod.crownShell) expect(sel.count * sel.clump, `${s.kind} ${n}`).toBeLessThanOrEqual(lod.maxLeaves);
      }
    }
    const th = LEVELS.map((n) => TREE_LOD_PRESETS[n].minPixelsPerUnit ?? Infinity);
    for (let i = 0; i < 3; i++) expect(th[i]).toBeGreaterThan(th[i + 1]);
  });

  it('pickTreeLodForScale: najbardziej uproszczony poziom, którego próg jest spełniony', () => {
    const { mid, far, shell } = { mid: TREE_LOD_PRESETS.mid.minPixelsPerUnit!, far: TREE_LOD_PRESETS.far.minPixelsPerUnit!, shell: TREE_LOD_PRESETS.shell.minPixelsPerUnit! };
    expect(pickTreeLodForScale(1e6)).toBe('near');
    expect(pickTreeLodForScale(mid + 0.01)).toBe('near');
    expect(pickTreeLodForScale(mid)).toBe('mid');
    expect(pickTreeLodForScale(far + 0.01)).toBe('mid');
    expect(pickTreeLodForScale(far)).toBe('far');
    expect(pickTreeLodForScale(shell + 0.01)).toBe('far');
    expect(pickTreeLodForScale(shell)).toBe('shell');
    expect(pickTreeLodForScale(0)).toBe('shell');
  });

  it('liść mid/far nie jest bardziej wydłużony (ostrzejszy) niż near', () => {
    for (const s of SAMPLES) {
      // near i mid: latawiec (quad, 4 wierzchołki) od 2026-11-22
      const near = leafPolygonStats(s.lods[0].mesh, 4);
      const mid = leafPolygonStats(s.lods[1].mesh, 4);
      const far = leafPolygonStats(s.lods[2].mesh, 4);
      const label = `${s.kind}#${s.seed}`;
      expect(mid.medianMinAngleDeg, label).toBeGreaterThanOrEqual(near.medianMinAngleDeg - 5); // było −3; pomiar 2026-11-22 (near quad): Sycamore#11 −4,4°
      // far: latawiec (quad, 2 trójkąty) od 2026-11-21 — kąt wynika z obrysu, nie z gatunku (pomiar ≈ 79,1°, igły sosny 56,7°): bez kolców
      expect(far.medianMinAngleDeg, label).toBeGreaterThanOrEqual(Math.min(75, near.medianMinAngleDeg - 45)); // far trójkąt (1 tr.) od 2026-11-22: pomiar do −41,2° (Plane#11; hex near vs tri far), było −30
    }
  });

  it('near (sześciokąt, 4 tr.) ma te same liście co oryginał (isFullLeafLod)', () => {
    for (const s of SAMPLES.filter((x) => x.seed === SEEDS[0])) {
      // od 2026-11-22 near wraca do leafShape 'hex' — `isFullLeafLod`, liście z tej samej ścieżki co oryginał
      expect(isFullLeafLod(TREE_LOD_PRESETS.near), s.kind).toBe(true);
      expect(isFullLeafLod(TREE_LOD_PRESETS.mid), s.kind).toBe(false);
      const params = { ...MESH_PARAMS, radialSegments: 4 };
      const orig = TreeGenerator.meshSkeletonRaw(s.sk, { ...params, detail: 'LOW' }).mesh;
      const near = TreeGenerator.meshSkeletonRaw(s.sk, { ...params, lod: TREE_LOD_PRESETS.near }).mesh;
      const leafTris = (m: RawTreeMesh) => m.groups.filter((g) => g.materialIndex > 0).reduce((n, g) => n + g.count, 0) / 3;
      // pomiar OAK 1,0%, WILLOW 4,5% (addLeavesLod zaokrągla kępki inaczej niż addLeaves) — do 5%
      // własny `leafOutline` profilu ma pierwszeństwo przed `leafShape` presetu (Horsechestnut) — liście bez zmiany
      const expected = leafTris(orig);
      expect(Math.abs(leafTris(near) / expected - 1), s.kind).toBeLessThanOrEqual(0.05);
    }
  });

  it('liście LOD nie są spiczastsze niż oryginał i nie sterczą poza jego chmurę liści (miara spiczastości)', () => {
    const worst = { asp: 0, prot: 0, nearProt: 0 };
    for (const s of SAMPLES) {
      const orig = legacyNear(s.sk);
      const o = leafSpikiness(orig, 6, orig);
      for (const [i, corners] of [[0, 4], [1, 4], [2, 4]] as const) {
        const m = leafSpikiness(s.lods[i].mesh, corners, orig);
        const label = `${s.kind}#${s.seed} ${LEVELS[i]}`;
        expect(m.p90Aspect, label).toBeLessThanOrEqual(o.p90Aspect * 2.4 + 0.5);
        worst.asp = Math.max(worst.asp, m.p90Aspect / Math.max(1e-9, o.p90Aspect));
        if (i === 0) worst.nearProt = Math.max(worst.nearProt, m.protrudeShare);
        else worst.prot = Math.max(worst.prot, m.protrudeShare);
      }
    }
    console.log('[treeLod] spiczastość LOD/oryginał:', JSON.stringify(worst, (_, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
    expect(worst.nearProt).toBeLessThanOrEqual(0.12);
    // Twardy budżet liści (2026-11-21): liść mid/far do 2× większy, wystaje częściej — pomiar 0,266
    expect(worst.prot).toBeLessThanOrEqual(0.28);
  }, 30000);

  it('żywy rejestr: niepusta siatka, brak NaN, trójkąty nie rosną near ≥ mid ≥ far (shell: stała otoczka, może przekroczyć far rzadkiej korony)', () => {
    for (const kind of LIVE_KINDS) {
      const p = treeKindParams(kind, HEIGHT);
      const sk = TreeGenerator.buildSkeleton({ species: p.species, height: HEIGHT, seed: 11, form: p.form, profile: p.profile });
      const lods = lodsOf({ ...sk, profile: cityProfile(sk.profile) });
      const tt = lods.map((l) => l.triangles.total);
      for (const l of lods) {
        expect(l.mesh.positions.length, kind).toBeGreaterThan(0);
        expect(l.mesh.positions.some((v) => Number.isNaN(v)), kind).toBe(false);
      }
      for (let i = 0; i < 2; i++) expect(tt[i], `${kind} ${tt}`).toBeGreaterThanOrEqual(tt[i + 1]);
      expect(tt[3], `${kind} ${tt}`).toBeLessThanOrEqual(TRIANGLE_CEILING.shell);
    }
  }, 60000);

  it('obejmuje wszystkie rodzaje rejestru', () => {
    expect(KINDS.length).toBeGreaterThanOrEqual(20);
    expect(SAMPLES.length).toBe(KINDS.length * SEEDS.length);
  });

  it('trójkąty maleją monotonicznie near > mid > far > shell i mieszczą się w pułapach', () => {
    const table: Record<string, number[]> = {};
    for (const s of SAMPLES) {
      const tt = s.lods.map((l) => l.triangles.total);
      const row = (table[s.kind] ??= [0, 0, 0, 0]);
      tt.forEach((v, i) => (row[i] = Math.max(row[i], v)));
    }
    console.log('[treeLod] TRI max near/mid/far/shell\n' + Object.entries(table).map(([k, v]) => `${k}\t${v.join('\t')}`).join('\n'));
    for (const s of SAMPLES) {
      const t = s.lods.map((l) => l.triangles);
      const label = `${s.kind}#${s.seed}`;
      // shell (stała otoczka ~120 tr.) bywa większy od far rzadkiej korony — porównanie tylko near > mid > far i shell < mid
      for (let i = 0; i < 2; i++) expect(t[i].total, label).toBeGreaterThan(t[i + 1].total);
      expect(t[3].total, label).toBeLessThan(t[1].total);
      expect(t[1].total, label).toBeLessThanOrEqual(TRIANGLE_CEILING.mid);
      expect(t[2].total, label).toBeLessThanOrEqual(TRIANGLE_CEILING.far);
      expect(t[3].total, label).toBeLessThanOrEqual(TRIANGLE_CEILING.shell);
      for (const l of s.lods) {
        expect(l.triangles.bark, label).toBeGreaterThan(0);
        expect(l.triangles.foliage, label).toBeGreaterThan(0);
        expect(l.triangles.bark + l.triangles.foliage).toBe(l.mesh.indices.length / 3);
      }
    }
  });

  it('budżety trójkątów Platanu i Topoli czarnej na każdym poziomie (zmierzone maksimum z 3 ziaren + zapas ~5%)', () => {
    // Zmierzone maksima (near/mid/far/shell): Plane 16447/6549/3324/116, Black Poplar 23789/8648/4422/116 (do 2026-11-22);
    // od 2026-11-22 (near levelSides [3,3,2] z L3, liście hex/quad/tri/tri): Plane 8154/1603/468/76, Black Poplar 21972/2115/557/76
    // od 2026-11-22 (shell: otoczka 7×10 + sam pień L0): Plane 159, Black Poplar 159
    // od 2026-11-22 (poziomy: mid L0..L2 levelSides [3,3,2] i far/shell L0..L1 [3,2] bez odcięcia pikselowego): Plane 8154/2022/510/96, Black Poplar 21972/2748/603/106 (mid/far/shell rosną, bo wracają konary)
    // od 2026-11-23 (drabina LOD: mid leafKeep 0.65/maxLeaves 5000, far 0.46/2400): Plane 8154/2708/871/159, Black Poplar 21972/7318/2417/159
    const BUDGET: Record<string, number[]> = { Plane: [8570, 2850, 920, 235], 'Black Poplar': [23100, 7690, 2540, 235] };
    for (const [kind, budget] of Object.entries(BUDGET)) {
      const rows = SAMPLES.filter((s) => s.kind === kind);
      expect(rows.length, kind).toBe(SEEDS.length);
      for (const s of rows) {
        s.lods.forEach((l, i) => expect(l.triangles.total, `${kind}#${s.seed} ${LEVELS[i]}`).toBeLessThanOrEqual(budget[i]));
      }
    }
  });

  it('near odpowiada dotychczasowej siatce bliskiej: zbliżona liczba trójkątów, ten sam obrys i tony', () => {
    const stats = { ratio: 0, side: 1, top: 1, tone: 0 };
    for (const s of SAMPLES) {
      stats.ratio = Math.max(stats.ratio, s.lods[0].triangles.total / s.legacyTriangles);
      stats.side = Math.min(stats.side, s.nearVsLegacy.side.iouOutline);
      stats.top = Math.min(stats.top, s.nearVsLegacy.top.iouOutline);
      stats.tone = Math.max(stats.tone, s.nearVsLegacy.toneShareDelta);
    }
    console.log('[treeLod] near vs dotychczasowe near:', JSON.stringify(stats));
    // Zmierzone 2026-11-22: ratio 1,86 (near zachowuje wszystkie pierścienie L0/L1); obrys bok 0,87, góra 0,83; ton 0,040
    // 2026-11-22: near zachowuje L3 (bez witek auto) — kora 6× większa; pomiar ratio 7,12, obrys bok 0,839 / góra 0,840, ton 0,0636
    // 2026-11-22 (near levelSides [3,3,2], tolerancja 0,002, liście hex): ratio 1,018, obrys bok 0,883 / góra 0,892, ton 0,0382
    expect(stats.ratio).toBeLessThanOrEqual(1.07);
    expect(stats.side).toBeGreaterThanOrEqual(0.86);
    expect(stats.top).toBeGreaterThanOrEqual(0.86);
    expect(stats.tone).toBeLessThanOrEqual(0.045);
  });

  it('wygląd poziomów dalszych względem near: sylwetka, rysunek konarów, wystawanie, chropowatość obrysu, jasność i tony', () => {
    // Progi tuż poniżej (pułapy tuż powyżej) wartości zmierzonych 2026-11-10 po wszystkich rodzajach i ziarnach;
    // pomiar wypisuje console.log niżej. Kora `far`/`shell` jest odcinana celowo (pień i główne konary).
    const LIMITS = [
      // mid (L0..L2, levelSides [3,3,2], bez odcięcia pikselowego — wcześniej tylko pień, kora ~25 tr.).
      // Pomiar 2026-11-22: bok 0,552 / obrys 0,803 / kora 0,438; góra 0,523 / obrys 0,769 / kora 0,356; wystawanie 0,034; chropowatość 0,71–1,36; jasność −0,098…+0,083; ton 0,106; miary 12,5
      // (poprzednio: kora 0,010 / 0,0015 = sam pień)
      { side: 0.52, sideOutline: 0.78, sideBark: 0.40, top: 0.49, topOutline: 0.74, topBark: 0.32, overhang: 0.045, roughMin: 0.65, roughMax: 1.45, brightMin: -0.12, brightMax: 0.10, tone: 0.12, metrics: 13.2 },
      // far (L0..L1, levelSides [3,2]): bok 0,393 / obrys 0,769 / kora 0,219; góra 0,367 / obrys 0,724 / kora 0,131; wystawanie 0,057; chropowatość 0,77–1,68; jasność −0,119…+0,090; ton 0,159; miary 12,3
      { side: 0.37, sideOutline: 0.74, sideBark: 0.19, top: 0.34, topOutline: 0.70, topBark: 0.11, overhang: 0.07, roughMin: 0.70, roughMax: 1.95, brightMin: -0.14, brightMax: 0.11, tone: 0.175, metrics: 13.6 },
      // shell (L0 sam pień, otoczka 7 pasów × 10 sektorów mieszcząca wszystkie liście i gałęzie; otoczka jest WIĘKSZA niż chmura liści near, więc wystawanie ≫ 0, a kora ≈ 0 — gałęzie ukryte w środku).
      // Pomiar 2026-11-22: bok 0,399 / obrys 0,489 / kora 0,013; góra 0,371 / obrys 0,572 / kora 0,002; wystawanie 0,428; chropowatość 0,28–0,72; jasność −0,267…+0,092; ton 0,208; miary 16,1
      // (poprzednio, rdzeń walcowy: bok 0,282 / obrys 0,459 / kora 0,175; góra 0,135 / obrys 0,331 / kora 0,117; wystawanie 0,076; chropowatość 0,70–3,75; jasność −0,294…+0,237; ton 0,244; miary 6,1)
      // Po percentylowej otoczce (2026-11-22, ~93% punktów, spód ścięty na podstawie korony, wiele brył): bok 0,482 / obrys 0,680 / kora 0,014; góra 0,422 / obrys 0,410 (kolumnowa topola z góry) / kora 0,003; wystawanie 0,178; chropowatość 0,27–0,84; jasność −0,265…+0,066; ton 0,201; miary 18,3
      // (poprzednio, otoczka mieszcząca wszystko: bok 0,399 / obrys 0,489; góra 0,371 / obrys 0,572; wystawanie 0,428; miary 16,1)
      { side: 0.45, sideOutline: 0.64, sideBark: 0.005, top: 0.39, topOutline: 0.38, topBark: 0.001, overhang: 0.2, roughMin: 0.24, roughMax: 0.9, brightMin: -0.30, brightMax: 0.10, tone: 0.23, metrics: 19.5 },
    ];
    for (let i = 0; i < 3; i++) {
      const m = {
        side: 1, sideOutline: 1, sideBark: 1, top: 1, topOutline: 1, topBark: 1,
        overhang: 0, roughMin: Infinity, roughMax: 0, brightMin: Infinity, brightMax: -Infinity, tone: 0, metrics: 0,
      };
      const worst: Record<string, string> = {};
      const lo = (key: 'side' | 'sideOutline' | 'sideBark' | 'top' | 'topOutline' | 'topBark', v: number, s: Sample) => {
        if (v < m[key]) {
          m[key] = v;
          worst[key] = `${s.kind}#${s.seed}`;
        }
      };
      for (const s of SAMPLES) {
        const f = s.fidelity[i];
        lo('side', f.side.iou, s);
        lo('sideOutline', f.side.iouOutline, s);
        lo('sideBark', f.side.iouBark, s);
        lo('top', f.top.iou, s);
        lo('topOutline', f.top.iouOutline, s);
        lo('topBark', f.top.iouBark, s);
        for (const v of [f.side, f.top]) {
          if (v.overhang > m.overhang) {
            m.overhang = v.overhang;
            worst.overhang = `${s.kind}#${s.seed}`;
          }
          m.brightMin = Math.min(m.brightMin, v.brightnessDelta);
          m.brightMax = Math.max(m.brightMax, v.brightnessDelta);
        }
        // Chropowatość tylko w elewacji: w rzucie z góry obrys wąskich koron to kilka pikseli
        m.roughMin = Math.min(m.roughMin, f.side.roughnessRatio);
        m.roughMax = Math.max(m.roughMax, f.side.roughnessRatio);
        m.tone = Math.max(m.tone, f.toneShareDelta);
        m.metrics = Math.max(m.metrics, f.metricsDistance ?? Infinity);
      }
      const level = LEVELS[i + 1];
      console.log(`[treeLod] ${level}:`, JSON.stringify(m, (_, v) => (typeof v === 'number' ? +v.toFixed(3) : v)), JSON.stringify(worst));
      const lim = LIMITS[i];
      for (const key of ['side', 'sideOutline', 'sideBark', 'top', 'topOutline', 'topBark'] as const) {
        expect(m[key], `${level} ${key} (${worst[key]})`).toBeGreaterThanOrEqual(lim[key]);
      }
      expect(m.overhang, `${level} wystawanie (${worst.overhang})`).toBeLessThanOrEqual(lim.overhang);
      expect(m.roughMin, `${level} chropowatość min`).toBeGreaterThanOrEqual(lim.roughMin);
      expect(m.roughMax, `${level} chropowatość maks`).toBeLessThanOrEqual(lim.roughMax);
      expect(m.brightMin, `${level} jasność min`).toBeGreaterThanOrEqual(lim.brightMin);
      expect(m.brightMax, `${level} jasność maks`).toBeLessThanOrEqual(lim.brightMax);
      expect(m.tone, `${level} ton`).toBeLessThanOrEqual(lim.tone);
      expect(m.metrics, `${level} miary sylwetki`).toBeLessThanOrEqual(lim.metrics);
    }
  });

  it('jest deterministyczne: ten sam szkielet i poziom dają identyczne bufory', () => {
    for (const s of SAMPLES.filter((x) => x.seed === SEEDS[0])) {
      const again = lodsOf(skeletonOf(s.kind, s.seed));
      for (let i = 0; i < LEVELS.length; i++) {
        expect(meshChecksum(again[i].mesh), `${s.kind} ${LEVELS[i]}`).toBe(meshChecksum(s.lods[i].mesh));
      }
    }
  });

  it('miejsca liści poziomów są zagnieżdżone (shell ⊂ far ⊂ mid ⊂ near) i pokrywają wszystkie piętra korony', () => {
    for (const s of SAMPLES) {
      const label = `${s.kind}#${s.seed}`;
      const field = collectLeafSites(s.sk.stems, s.sk.profile, s.sk.seed, s.sk.leafSites);
      const [near, mid, far] = (['near', 'mid', 'far'] as const).map((n) => selectLeafSites(field, s.sk.profile, TREE_LOD_PRESETS[n]));
      // Poziom bierze początek wspólnej kolejności, więc mniejsza liczba miejsc = podzbiór
      expect(new Set(field.order).size, label).toBe(field.count);
      expect(near.count, label).toBe(field.count);
      expect(near.enlarged, label).toBe(false);
      expect(mid.count, label).toBeLessThanOrEqual(near.count);
      expect(far.count, label).toBeLessThanOrEqual(mid.count);
      // Pokryta powierzchnia nie rośnie ponad near, a liść nie jest powiększany ponad pułap
      const area = (x: typeof near) => x.count * x.clump * x.sizeScale ** 2;
      expect(area(mid) / area(near), label).toBeLessThanOrEqual(1.000001);
      expect(area(far) / area(near), label).toBeLessThanOrEqual(1.000001);
      expect(mid.sizeScale, label).toBeLessThanOrEqual(MAX_LEAF_SIZE_SCALE_BUDGET + 1e-9);
      expect(far.sizeScale, label).toBeLessThanOrEqual(MAX_LEAF_SIZE_SCALE_BUDGET + 1e-9);
      // W siatce: jeden liść na miejsce (latawiec near/mid/far 2 trójkąty)
      if (mid.clump === 1) expect(s.lods[1].triangles.foliage, label).toBe(mid.count * 2);
      if (far.clump === 1) expect(s.lods[2].triangles.foliage, label).toBe(far.count); // far: trójkąt (1 tr.) od 2026-11-22

      // Warstwowanie: każde piętro korony, w którym są miejsca liści, ma miejsca także na poziomie far (bez łysych pięter)
      const BANDS = 6;
      const band = (i: number) => Math.min(BANDS - 1, Math.floor(((field.sites[i * 6 + 1] - field.minY) / Math.max(1e-6, field.maxY - field.minY)) * BANDS));
      const all = new Set<number>(), kept = new Set<number>();
      for (let i = 0; i < field.count; i++) all.add(band(i));
      for (let k = 0; k < far.count; k++) kept.add(band(field.order[k]));
      expect(kept.size, label).toBe(all.size);

      const tones = (mesh: RawTreeMesh) => mesh.groups.filter((g) => g.materialIndex > 0).map((g) => g.materialIndex);
      for (const l of s.lods) expect(tones(l.mesh).every((m) => m >= 1 && m <= 3), label).toBe(true);
    }
  });

  it('liść poziomu dalszego to powiększony liść near: nie ostrzejszy, o tym samym rozkładzie orientacji', () => {
    const m = { angleMid: Infinity, angleFar: Infinity, upMid: 0, upFar: 0, radialMid: 0, radialFar: 0 };
    for (const s of SAMPLES) {
      const label = `${s.kind}#${s.seed}`;
      const near = leafPolygonStats(s.lods[0].mesh, 4);
      const mid = leafPolygonStats(s.lods[1].mesh, 4);
      const far = leafPolygonStats(s.lods[2].mesh, 4);
      // ±1: liść graniczny przy zaokrągleniu liczby miejsc (pomiar fixture 2026-11-21)
      expect(Math.abs(near.count - s.lods[0].triangles.foliage / 2), label).toBeLessThanOrEqual(1);
      // Kształt: najostrzejszy kąt liścia nie mniejszy niż u liścia near (igła na poziomach dalszych szerzeje)
      m.angleMid = Math.min(m.angleMid, mid.minAngleDeg - near.minAngleDeg);
      m.angleFar = Math.min(m.angleFar, far.minAngleDeg - near.minAngleDeg);
      // Orientacja: średni |n·pion| i |n·kierunek od osi korony| jak u liści near
      m.upMid = Math.max(m.upMid, Math.abs(mid.meanAbsNormalUp - near.meanAbsNormalUp));
      m.upFar = Math.max(m.upFar, Math.abs(far.meanAbsNormalUp - near.meanAbsNormalUp));
      m.radialMid = Math.max(m.radialMid, Math.abs(mid.meanAbsNormalRadial - near.meanAbsNormalRadial));
      m.radialFar = Math.max(m.radialFar, Math.abs(far.meanAbsNormalRadial - near.meanAbsNormalRadial));
    }
    console.log('[treeLod] liść mid/far vs near:', JSON.stringify(m, (_, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
    // Pomiar 2026-11-10: kąt mid 0°, far −4,1° (pięciokąt far wobec sześciokąta near); |n·pion| 0,044 / 0,089;
    // |n·radialny| 0,054 / 0,117 (far ma 80 liści — rozrzut próby)
    const LIM = { angle: -9, upMid: 0.1, upFar: 0.13, radialMid: 0.1, radialFar: 0.16 };
    {
      expect(m.angleMid).toBeGreaterThanOrEqual(LIM.angle);
      // far: latawiec (quad) od 2026-11-21 — pomiar −31,3°
      expect(m.angleFar).toBeGreaterThanOrEqual(-57); // far trójkąt (1 tr.) od 2026-11-22: pomiar −54,3° (było −34, latawiec)
      expect(m.upMid).toBeLessThanOrEqual(LIM.upMid);
      expect(m.upFar).toBeLessThanOrEqual(LIM.upFar);
      expect(m.radialMid).toBeLessThanOrEqual(LIM.radialMid);
      expect(m.radialFar).toBeLessThanOrEqual(LIM.radialFar);
    }
  });

  it('w oświetleniu aplikacji (Lambert dwustronny, cień własny) poziomy dalsze mają luminancję, pole rzutu i pole cienia jak near', () => {
    // Pomiar 2026-11-10 (skrajne po rodzajach i ziarnach; szum miary między dwoma losowaniami liści near: luminancja ±0,02,
    // pola ±0,06–0,10):
    // mid   — luminancja −0,016…+0,025 (śr. +0,002); pole iso 0,93–1,17 (1,03), z góry 0,83–1,09 (0,98), cienia 0,93–1,12 (1,01)
    // far   — luminancja −0,021…+0,049 (śr. +0,006); pole iso 0,94–1,23 (1,07), z góry 0,82–1,18 (0,99), cienia 0,89–1,23 (1,04)
    // shell — luminancja −0,034…+0,071 (śr. +0,014); pole iso 0,71–1,54 (0,96), z góry 0,47–1,33 (0,84), cienia 0,70–1,31 (0,93)
    const LIT = [
      { lum: 0.05, lumMean: 0.01, isoMin: 0.74, isoMax: 1.2, topMin: 0.62, topMax: 1.12, castMin: 0.70, castMax: 1.15, areaMean: 0.11 },
      { lum: 0.06, lumMean: 0.015, isoMin: 0.65, isoMax: 1.26, topMin: 0.6, topMax: 1.21, castMin: 0.62, castMax: 1.26, areaMean: 0.19 },
      // shell po 0.2.1 (pomiar: luminancja −0,06…+0,10; iso 0,56–0,73; góra 0,23–0,75; cień 0,56–0,70)
      // shell po przejściu na otoczkę (2026-11-22): pomiar luminancja −0,066…+0,065 (śr. +0,009); iso 1,24–4,34 (2,00), góra 0,83–5,16 (2,10), cień 1,16–5,01 (2,08).
      // Otoczka mieści całą koronę, więc pole rzutu i cień są większe niż chmury ażurowych liści near (poprzednio iso 0,56–0,73, góra 0,23–0,75, cień 0,56–0,70)
      // po otoczce percentylowej (2026-11-22): iso 0,84–3,57 (1,52), góra 0,48–4,14 (1,55), cień 0,79–3,97 (1,55) (poprzednio iso 1,24–4,34, średnio 2,00)
      { lum: 0.09, lumMean: 0.03, isoMin: 0.78, isoMax: 3.9, topMin: 0.42, topMax: 4.5, castMin: 0.74, castMax: 4.3, areaMean: 0.6 },
    ];
    for (let i = 0; i < 3; i++) {
      const m = { lumMin: Infinity, lumMax: -Infinity, lumMean: 0, isoMin: Infinity, isoMax: 0, isoMean: 0, topMin: Infinity, topMax: 0, topMean: 0, castMin: Infinity, castMax: 0, castMean: 0 };
      const lit = SAMPLES.filter((s) => s.lit.length > 0);
      for (const s of lit) {
        const f = s.lit[i];
        m.lumMin = Math.min(m.lumMin, f.luminanceDeltaWorst, f.luminanceDelta);
        m.lumMax = Math.max(m.lumMax, f.luminanceDeltaWorst, f.luminanceDelta);
        m.lumMean += f.luminanceDelta / lit.length;
        m.isoMin = Math.min(m.isoMin, f.cameraAreaRatio);
        m.isoMax = Math.max(m.isoMax, f.cameraAreaRatio);
        m.isoMean += f.cameraAreaRatio / lit.length;
        m.topMin = Math.min(m.topMin, f.topAreaRatio);
        m.topMax = Math.max(m.topMax, f.topAreaRatio);
        m.topMean += f.topAreaRatio / lit.length;
        m.castMin = Math.min(m.castMin, f.castShadowRatio);
        m.castMax = Math.max(m.castMax, f.castShadowRatio);
        m.castMean += f.castShadowRatio / lit.length;
      }
      const level = LEVELS[i + 1];
      console.log(`[treeLod] oświetlone ${level}:`, JSON.stringify(m, (_, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
      const lim = LIT[i];
      expect(m.lumMin, `${level} luminancja min`).toBeGreaterThanOrEqual(-lim.lum);
      expect(m.lumMax, `${level} luminancja maks`).toBeLessThanOrEqual(lim.lum);
      expect(Math.abs(m.lumMean), `${level} luminancja średnio`).toBeLessThanOrEqual(lim.lumMean);
      for (const key of ['iso', 'top', 'cast'] as const) {
        expect(m[`${key}Min`], `${level} pole ${key} min`).toBeGreaterThanOrEqual(lim[`${key}Min`]);
        expect(m[`${key}Max`], `${level} pole ${key} maks`).toBeLessThanOrEqual(lim[`${key}Max`]);
        expect(Math.abs(m[`${key}Mean`] - 1), `${level} pole ${key} średnio`).toBeLessThanOrEqual(lim.areaMean);
      }
    }
  });

  it('bryła korony (shell): zamknięta otoczka bez dziur, trzy tony, normalne jednostkowe', () => {
    const { rings, sides, lobes } = TREE_LOD_PRESETS.shell.crownShell!;
    const shellTriangles = 2 * sides * (rings - 1);
    const maxShellTriangles = 200;
    for (const s of SAMPLES) {
      const label = `${s.kind}#${s.seed}`;
      // Sama otoczka: każda krawędź — po położeniach, bo ściany są płaskie i mają własne wierzchołki —
      // należy do dokładnie dwóch trójkątów = powierzchnia zamknięta
      const core = TreeGenerator.meshSkeletonRaw(s.sk, {
        ...MESH_PARAMS,
        lod: { ...TREE_LOD_PRESETS.shell, crownShell: { rings, sides, lobes: 0 } },
      }).mesh;
      const key = (v: number) => `${core.positions[v * 3]},${core.positions[v * 3 + 1]},${core.positions[v * 3 + 2]}`;
      const edges = new Map<string, number>();
      let coreTriangles = 0;
      for (const g of core.groups) {
        if (g.materialIndex === 0) continue;
        for (let k = g.start; k < g.start + g.count; k += 3) {
          coreTriangles++;
          for (let e = 0; e < 3; e++) {
            const a = key(core.indices[k + e]), b = key(core.indices[k + ((e + 1) % 3)]);
            const id = a < b ? `${a}|${b}` : `${b}|${a}`;
            edges.set(id, (edges.get(id) ?? 0) + 1);
          }
        }
      }
      expect(coreTriangles, label).toBeGreaterThanOrEqual(36);
      expect(coreTriangles, label).toBeLessThanOrEqual(Math.max(shellTriangles, maxShellTriangles));
      for (const n of edges.values()) expect(n, label).toBe(2);

      const mesh = s.lods[3].mesh;
      const tones = new Set<number>();
      for (const g of mesh.groups) {
        if (g.materialIndex === 0) continue;
        tones.add(g.materialIndex);
        for (let k = g.start; k < g.start + g.count; k++) {
          const v = mesh.indices[k] * 3;
          expect(Math.hypot(mesh.normals[v], mesh.normals[v + 1], mesh.normals[v + 2]), label).toBeCloseTo(1, 4);
        }
      }
      expect(s.lods[3].triangles.foliage, label).toBeGreaterThanOrEqual(36);
      expect(s.lods[3].triangles.foliage, label).toBeLessThanOrEqual(maxShellTriangles + (lobes ?? 0) * 3);
      expect(tones.size, label).toBeGreaterThanOrEqual(2);
      for (const t of tones) expect(t >= 1 && t <= 3, label).toBe(true);
    }
  });

  it('bryła korony (shell) zawiera ≥ 90% miejsc liści i punktów gałęzi rzędów 1..N (bez witek N+1), spód nad pniem: gatunki bazowe × ziarna 1/42 × wysokości 4/12/24 m', () => {
    // Punkt w bryle: parzystość przecięć promienia o dowolnym kierunku z trójkątami otoczki (powierzchnia zamknięta)
    const dir = [1, 0.3719, 0.2113];
    const inside = (tris: Float32Array, px: number, py: number, pz: number) => {
      let hits = 0;
      for (let t = 0; t < tris.length; t += 9) {
        const e1x = tris[t + 3] - tris[t], e1y = tris[t + 4] - tris[t + 1], e1z = tris[t + 5] - tris[t + 2];
        const e2x = tris[t + 6] - tris[t], e2y = tris[t + 7] - tris[t + 1], e2z = tris[t + 8] - tris[t + 2];
        const hx = dir[1] * e2z - dir[2] * e2y, hy = dir[2] * e2x - dir[0] * e2z, hz = dir[0] * e2y - dir[1] * e2x;
        const det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) < 1e-12) continue;
        const sx = px - tris[t], sy = py - tris[t + 1], sz = pz - tris[t + 2];
        const u = (sx * hx + sy * hy + sz * hz) / det;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) / det;
        if (v < 0 || u + v > 1) continue;
        if ((e2x * qx + e2y * qy + e2z * qz) / det > 0) hits++;
      }
      return hits % 2 === 1;
    };
    let total = 0, miss = 0;
    for (const species of Object.keys(SPECIES_PROFILES) as TreeSpecies[]) {
      for (const seed of [1, 42]) {
        for (const height of [4, 12, 24]) {
          const sk = TreeGenerator.buildSkeleton({ species, height, seed });
          const { mesh } = TreeGenerator.meshSkeletonLodsRaw(sk, [TREE_LOD_PRESETS.shell], MESH_PARAMS)[0];
          const tris: number[] = [];
          for (const g of mesh.groups) {
            if (g.materialIndex === 0) continue;
            for (let k = g.start; k < g.start + g.count; k++) {
              const v = mesh.indices[k] * 3;
              tris.push(mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]);
            }
          }
          const hull = new Float32Array(tris);
          const field = collectLeafSites(sk.stems, sk.profile, sk.seed, sk.leafSites);
          const leafPts: number[] = [], brPts: number[] = [];
          for (let i = 0; i < field.count; i++) leafPts.push(field.sites[i * 6], field.sites[i * 6 + 1], field.sites[i * 6 + 2]);
          const N = sk.profile.levels.length;
          for (const st of sk.stems) if (st.level >= 1 && st.level <= N) for (let k = 0; k < st.px.length; k++) brPts.push(st.px[k], st.py[k], st.pz[k]);
          const frac = (pts: number[]) => {
            const step = Math.max(1, Math.floor(pts.length / 3 / 600)); // do ~600 punktów na drzewo
            let n = 0, bad = 0;
            for (let i = 0; i < pts.length; i += 3 * step) {
              n++;
              if (!inside(hull, pts[i] * sk.scale, pts[i + 1] * sk.scale, pts[i + 2] * sk.scale)) bad++;
            }
            return { n, bad };
          };
          const l = frac(leafPts), b = frac(brPts);
          total += l.n + b.n;
          miss += l.bad + b.bad;
          if (l.n > 0) expect(l.bad / l.n, `liście ${species} s${seed} h${height}`).toBeLessThanOrEqual(0.15);
          // Pień widoczny: spód otoczki nie niżej niż podstawa korony (5. percentyl y liści) minus 15% wysokości korony
          const ysL: number[] = [];
          for (let i = 1; i < leafPts.length; i += 3) ysL.push(leafPts[i] * sk.scale);
          ysL.sort((x, y) => x - y);
          let hullMin = Infinity;
          for (let i = 1; i < hull.length; i += 3) hullMin = Math.min(hullMin, hull[i]);
          const crownH = ysL[ysL.length - 1] - ysL[0];
          expect(hullMin, `spód ${species} s${seed} h${height}`).toBeGreaterThanOrEqual(ysL[Math.floor(ysL.length * 0.05)] - 0.15 * crownH - 1e-6);
        }
      }
    }
    expect(miss / total).toBeLessThanOrEqual(0.1);
  }, 120000);

  it('bryła korony (shell): pole rzutu bocznego ≈ chmura liści near (mediana 0,9–1,4×), wystawanie ≤ 0,2, kilka brył dla rozdzielonych koron, deterministycznie', () => {
    const ratios: number[] = [];
    let maxOver = 0, multi = 0;
    for (const s of SAMPLES.filter((x) => x.seed === SEEDS[0])) {
      const fr = lodFrame([s.lods[0].mesh, s.lods[3].mesh], 'side', 256);
      const area = (m: RawTreeMesh) => maskArea(fillMaskOutline(rasterizeMesh(m, fr, (i) => i > 0), fr.W, fr.H));
      ratios.push(area(s.lods[3].mesh) / area(s.lods[0].mesh));
      maxOver = Math.max(maxOver, s.fidelity[2].side.overhang);
      // Liczba brył: składowe spójne po położeniach wierzchołków
      const m = s.lods[3].mesh;
      const par = new Map<string, string>();
      const key = (v: number) => `${m.positions[v * 3]},${m.positions[v * 3 + 1]},${m.positions[v * 3 + 2]}`;
      const find = (x: string): string => { while (par.get(x) !== x) x = par.get(x)!; return x; };
      for (const g of m.groups) {
        if (g.materialIndex === 0) continue;
        for (let k = g.start; k < g.start + g.count; k += 3) {
          const ks = [0, 1, 2].map((e) => key(m.indices[k + e]));
          for (const q of ks) if (!par.has(q)) par.set(q, q);
          for (const q of ks) par.set(find(q), find(ks[0]));
        }
      }
      const blobs = new Set([...par.keys()].map(find)).size;
      expect(blobs, s.kind).toBeLessThanOrEqual(3);
      if (blobs > 1) multi++;
    }
    ratios.sort((a, b) => a - b);
    const med = ratios[Math.floor(ratios.length / 2)];
    console.log(`[treeLod] shell pole/near: mediana ${med.toFixed(2)}, min ${ratios[0].toFixed(2)}, maks ${ratios[ratios.length - 1].toFixed(2)}; wystawanie maks ${maxOver.toFixed(3)}; drzew wielobryłowych ${multi}/${ratios.length}`);
    expect(med).toBeGreaterThanOrEqual(0.9);
    expect(med).toBeLessThanOrEqual(1.4);
    expect(ratios[ratios.length - 1]).toBeLessThanOrEqual(1.8);
    expect(maxOver).toBeLessThanOrEqual(0.2);
    expect(multi).toBeGreaterThanOrEqual(1);

    // maxBlobs: 1 = jedna bryła (≤ 120 trójkątów), domyślnie wiele; ten sam szkielet daje identyczne bufory
    const countFoliage = (maxBlobs?: number) => {
      const sk = skeletonOf('Weeping Willow' as TreeKind, 11);
      const lod = { ...TREE_LOD_PRESETS.shell, crownShell: { ...TREE_LOD_PRESETS.shell.crownShell!, maxBlobs } };
      return TreeGenerator.meshSkeletonLodsRaw(sk, [lod], MESH_PARAMS)[0];
    };
    const one = countFoliage(1);
    expect(one.triangles.foliage).toBe(2 * TREE_LOD_PRESETS.shell.crownShell!.sides * (TREE_LOD_PRESETS.shell.crownShell!.rings - 1));
    const many = countFoliage(3), again = countFoliage(3);
    expect(meshChecksum(many.mesh)).toBe(meshChecksum(again.mesh));
    expect(many.triangles.foliage).toBeLessThanOrEqual(200);
  }, 120000);

  it('wybór pierścieni tolerancją cięciwy: końce zawsze, większa tolerancja = podzbiór', () => {
    const sk = skeletonOf('Weeping Willow', 11);
    for (const stem of sk.stems.filter((x) => x.level <= 1)) {
      const n = stem.px.length;
      const all = selectStemRings(stem, 0);
      expect(all.length).toBe(n);
      const fine = selectStemRings(stem, 0.002), coarse = selectStemRings(stem, 0.02);
      for (const r of [fine, coarse]) {
        expect(r[0]).toBe(0);
        expect(r[r.length - 1]).toBe(n - 1);
      }
      expect(coarse.length).toBeLessThanOrEqual(fine.length);
      for (const i of coarse) expect(fine.includes(i)).toBe(true);
    }
  });

  it('progi kory: promień nasady, pułap liczby pędów i budżet trójkątów odcinają pędy, pnie zostają', () => {
    const sk = skeletonOf('Linden', 22);
    const bark = (lod: Parameters<typeof TreeGenerator.meshSkeletonLodsRaw>[1][number]) =>
      TreeGenerator.meshSkeletonLodsRaw(sk, [lod], MESH_PARAMS)[0].triangles.bark;
    const full = bark({});
    const thick = bark({ minStemRadiusRatio: 0.003 });
    const trunkOnly = bark({ maxBranches: 0 });
    expect(thick).toBeLessThan(full);
    expect(thick).toBeGreaterThan(trunkOnly);
    expect(trunkOnly).toBeGreaterThan(0);
    expect(bark({ minStemRadiusRatio: 1 })).toBe(trunkOnly);
    expect(bark({ maxBranches: 10 })).toBeGreaterThan(trunkOnly);
    expect(bark({ maxBranches: 10 })).toBeLessThan(bark({ maxBranches: 40 }));
    for (const budget of [600, 1500]) {
      const t = bark({ maxBarkTriangles: budget, branchSides: 2 });
      expect(t).toBeLessThanOrEqual(budget);
      expect(t).toBeGreaterThan(trunkOnly);
    }
    // Budżet mniejszy niż sam pień: pień zostaje w całości, pędów brak
    expect(bark({ maxBarkTriangles: 10 })).toBe(trunkOnly);
  });

  it('bez `lod` siatka jest deterministyczna (sumy kontrolne domyślnego schematu B; tylko gatunki bazowe)', () => {
    // Sumy odświeżone 2026-11-21 po zmianach wzrostu (commit 103b14f: trunkTaper jako ubytek całkowity pnia); generateRaw({species}) używa tylko SPECIES_PROFILES, bez fittedProfiles
    const cases = [
      [{ species: 'OAK', height: 10, seed: 42, withFoliageAccents: true, detail: 'HIGH' }, '6333390d:91158:[[0,6222,0],[6222,31656,1],[37878,39120,2],[76998,14160,3]]'],
      [{ species: 'BIRCH', height: 14, seed: 7, withFoliageAccents: true, detail: 'MEDIUM', radialSegments: 5 }, 'bb58816f:64737:[[0,5529,0],[5529,19032,1],[24561,28872,2],[53433,11304,3]]'],
      [{ species: 'SPRUCE', height: 10, seed: 11, withFoliageAccents: true, detail: 'LOW', radialSegments: 3, stroke: ILLUSTRATION_STROKE }, '3252bf6:61338:[[0,1818,0],[1818,8100,1],[9918,30156,2],[40074,21264,3]]'],
      [{ species: 'WILLOW', height: 8, seed: 3, form: 'FORKED' }, 'fb20e5b7:4815:[[0,4815,0]]'],
    ] as const;
    for (const [params, sum] of cases) {
      expect(meshChecksum(TreeGenerator.generateRaw(params).mesh), params.species).toBe(sum);
    }
  });

  it('miara wyglądu: siatka względem siebie = 1, maska kory zawiera się w masce całości', () => {
    const s = SAMPLES[0];
    const same = lodFidelity(s.lods[0].mesh, s.lods[0].mesh);
    expect(same.side.iou).toBe(1);
    expect(same.top.iouBark).toBe(1);
    expect(same.toneShareDelta).toBe(0);
    expect(same.side.overhang).toBe(0);
    expect(same.side.roughnessRatio).toBe(1);
    expect(same.top.brightnessDelta).toBe(0);
    expect(same.metricsDistance).toBe(0);
    const frame = lodFrame([s.lods[0].mesh], 'side', 96);
    const all = rasterizeMesh(s.lods[0].mesh, frame);
    const bark = rasterizeMesh(s.lods[0].mesh, frame, (m) => m === 0);
    expect(maskArea(bark)).toBeGreaterThan(0);
    expect(maskArea(bark)).toBeLessThan(maskArea(all));
    for (let i = 0; i < all.length; i++) if (bark[i]) expect(all[i]).toBe(1);
    expect(maskIoU(bark, all)).toBeLessThan(1);
    const shares = same.toneShares;
    expect(shares[0] + shares[1] + shares[2]).toBeCloseTo(1, 6);
  });

  it('adapter three: meshSkeletonLods zwraca geometrie z tymi samymi trójkątami co siatki surowe', () => {
    const s = SAMPLES[0];
    const geoms = ThreeTreeGenerator.meshSkeletonLods(s.sk, LEVELS.map((n) => TREE_LOD_PRESETS[n]), MESH_PARAMS);
    expect(geoms.length).toBe(LEVELS.length);
    geoms.forEach((g, i) => {
      expect(g.triangles).toEqual(s.lods[i].triangles);
      expect(g.geometry.getIndex()!.count).toBe(s.lods[i].mesh.indices.length);
      expect(g.geometry.groups.length).toBe(s.lods[i].mesh.groups.length);
    });
    const single = ThreeTreeGenerator.meshSkeleton(s.sk, { ...MESH_PARAMS, lod: TREE_LOD_PRESETS.far });
    expect(single.geometry.getIndex()!.count).toBe(s.lods[2].mesh.indices.length);
  });

  it('minStemThicknessPx: 1 odrzuca cienkie pędy L2/L3 (< 1px grubości) bez wpływu na grubsze konary', () => {
    const sk = SAMPLES[0].sk;
    const baseLod = { ...TREE_LOD_PRESETS.mid, minStemThicknessPx: undefined, minStemRadiusRatio: undefined, maxBarkTriangles: undefined };
    const culledLod = { ...baseLod, minStemThicknessPx: 1 };
    const baseTri = countMeshTriangles(TreeGenerator.meshSkeletonRaw(sk, { ...MESH_PARAMS, lod: baseLod }).mesh);
    const culledTri = countMeshTriangles(TreeGenerator.meshSkeletonRaw(sk, { ...MESH_PARAMS, lod: culledLod }).mesh);
    expect(culledTri.bark).toBeLessThan(baseTri.bark);
    expect(culledTri.bark).toBeGreaterThan(0);
  });

  it('pień L0 zachowuje pierścienie pośrednie na wszystkich poziomach LOD', () => {
    const sk = SAMPLES[0].sk;
    const trunk = sk.stems.find((st) => st.level === 0)!;
    expect(trunk.r.length).toBeGreaterThan(2);
    for (const n of LEVELS) {
      const lod = TREE_LOD_PRESETS[n];
      const rings = selectStemRings(trunk, lod.ringTolerance ?? 0);
      expect(rings.length, `${n} L0 rings`).toBeGreaterThan(2);
    }
  });
});
