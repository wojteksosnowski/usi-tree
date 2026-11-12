import { describe, it, expect } from 'vitest';
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
  type TreeLodName,
  type TreeLodRawResult,
  type TreeSkeleton,
} from '../index.js';
import { collectLeafSites, isFullLeafLod, selectLeafSites, selectStemRings } from '../core/meshExtruder.js';
import {
  lodFidelity,
  lodFidelityMany,
  lodLitFidelity,
  leafPolygonStats,
  leafSpikiness,
  lodFrame,
  rasterizeMesh,
  maskArea,
  maskIoU,
  type LodFidelity,
  type LodLitFidelity,
} from '../fitter/index.js';
import { TreeGenerator as ThreeTreeGenerator } from '../three/index.js';

const KINDS = [...new Set([...Object.keys(SPECIES_PROFILES), ...FITTED_PROFILES.map((f) => f.ref)])] as TreeKind[];
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
  const p = treeKindParams(kind, HEIGHT);
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
const TRIANGLE_CEILING: Record<Exclude<TreeLodName, 'near'>, number> = { mid: 9900, far: 5100, shell: 120 };

describe('poziomy LOD siatki drzewa (TREE_LOD_PRESETS)', () => {
  it('liść nie jest powiększany ponad 1,5 na żadnym poziomie ani rodzaju; progi skali monotoniczne', () => {
    for (const s of SAMPLES) {
      const field = collectLeafSites(s.sk.stems, s.sk.profile, s.sk.seed, s.sk.leafSites);
      for (const n of LEVELS) {
        expect(selectLeafSites(field, s.sk.profile, TREE_LOD_PRESETS[n]).sizeScale, `${s.kind} ${n}`).toBeLessThanOrEqual(1.5 + 1e-9);
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
      const near = leafPolygonStats(s.lods[0].mesh, 6);
      const mid = leafPolygonStats(s.lods[1].mesh, 6);
      const far = leafPolygonStats(s.lods[2].mesh, 5);
      const label = `${s.kind}#${s.seed}`;
      expect(mid.medianMinAngleDeg, label).toBeGreaterThanOrEqual(near.medianMinAngleDeg - 3);
      expect(far.medianMinAngleDeg, label).toBeGreaterThanOrEqual(near.medianMinAngleDeg - 9);
    }
  });

  it('near ma liście oryginału: bufory liści identyczne z meshSkeletonRaw bez lod', () => {
    for (const s of SAMPLES.filter((x) => x.seed === SEEDS[0])) {
      expect(isFullLeafLod(TREE_LOD_PRESETS.near), s.kind).toBe(true);
      expect(isFullLeafLod(TREE_LOD_PRESETS.mid), s.kind).toBe(false);
      const params = { ...MESH_PARAMS, radialSegments: 4 };
      const orig = TreeGenerator.meshSkeletonRaw(s.sk, { ...params, detail: 'LOW' }).mesh;
      const near = TreeGenerator.meshSkeletonRaw(s.sk, { ...params, lod: TREE_LOD_PRESETS.near }).mesh;
      const leafVerts = (m: RawTreeMesh) => (m.groups.filter((g) => g.materialIndex > 0).reduce((n, g) => n + g.count, 0) / 12) * 6;
      const n = leafVerts(orig);
      expect(leafVerts(near), s.kind).toBe(n);
      const tail = (a: Float32Array, k: number) => Array.from(a.slice(a.length - n * k));
      expect(tail(near.positions, 3), s.kind).toEqual(tail(orig.positions, 3));
      expect(tail(near.normals, 3), s.kind).toEqual(tail(orig.normals, 3));
      expect(near.groups.filter((g) => g.materialIndex > 0).map((g) => g.count), s.kind).toEqual(
        orig.groups.filter((g) => g.materialIndex > 0).map((g) => g.count)
      );
    }
  });

  it('liście LOD nie są spiczastsze niż oryginał i nie sterczą poza jego chmurę liści (miara spiczastości)', () => {
    const worst = { asp: 0, prot: 0, nearProt: 0 };
    for (const s of SAMPLES) {
      const orig = legacyNear(s.sk);
      const o = leafSpikiness(orig, 6, orig);
      for (const [i, corners] of [[0, 6], [1, 6], [2, 5]] as const) {
        const m = leafSpikiness(s.lods[i].mesh, corners, orig);
        const label = `${s.kind}#${s.seed} ${LEVELS[i]}`;
        expect(m.p90Aspect, label).toBeLessThanOrEqual(o.p90Aspect * 1.25 + 0.5);
        worst.asp = Math.max(worst.asp, m.p90Aspect / Math.max(1e-9, o.p90Aspect));
        if (i === 0) worst.nearProt = Math.max(worst.nearProt, m.protrudeShare);
        else worst.prot = Math.max(worst.prot, m.protrudeShare);
      }
    }
    console.log('[treeLod] spiczastość LOD/oryginał:', JSON.stringify(worst, (_, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));
    expect(worst.nearProt).toBeLessThanOrEqual(0.12);
    expect(worst.prot).toBeLessThanOrEqual(0.25);
  });

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
      for (let i = 0; i < 3; i++) expect(t[i].total, label).toBeGreaterThan(t[i + 1].total);
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
    // Zmierzone maksima (near/mid/far/shell): Plane 16447/6549/3324/116, Black Poplar 23789/8648/4422/116
    const BUDGET: Record<string, number[]> = { Plane: [17300, 6900, 3500, 120], 'Black Poplar': [25000, 9100, 4650, 120] };
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
    // Zmierzone 2026-11-10: ratio 1,08; obrys bok 0,86, góra 0,85; ton 0,054 (dwa niezależne losowania liści tej samej korony)
    expect(stats.ratio).toBeLessThanOrEqual(1.1);
    expect(stats.side).toBeGreaterThanOrEqual(0.82);
    expect(stats.top).toBeGreaterThanOrEqual(0.81);
    expect(stats.tone).toBeLessThanOrEqual(0.07);
  });

  it('wygląd poziomów dalszych względem near: sylwetka, rysunek konarów, wystawanie, chropowatość obrysu, jasność i tony', () => {
    // Progi tuż poniżej (pułapy tuż powyżej) wartości zmierzonych 2026-11-10 po wszystkich rodzajach i ziarnach;
    // pomiar wypisuje console.log niżej. Kora `far`/`shell` jest odcinana celowo (pień i główne konary).
    const LIMITS = [
      // mid — pomiar: bok 0,62 / obrys 0,83 / kora 0,53; góra 0,61 / obrys 0,78 / kora 0,39; wystawanie 0,036;
      // chropowatość 0,67–1,19; jasność tonów −0,08…+0,10; ton 0,099; miary 12,8
      { side: 0.52, sideOutline: 0.8, sideBark: 0.33, top: 0.5, topOutline: 0.75, topBark: 0.03, overhang: 0.05, roughMin: 0.6, roughMax: 1.4, brightMin: -0.14, brightMax: 0.12, tone: 0.12, metrics: 14 },
      // far po 0.2.2 (pokrycie 0,7, kora budżet 120): pomiar bok 0,57 / obrys 0,82 / kora 0,20; góra 0,57 / obrys 0,80 / kora 0,012; chropowatość 0,83–1,70; jasność −0,08…+0,05; ton 0,046; miary 13,7
      // (mid po 0.2.2: bok 0,70 / obrys 0,85 / kora 0,38; góra 0,68 / obrys 0,81 / kora 0,053; chropowatość 0,85–1,19; ton 0,029; miary 4,3)
      // far (wcześniej) — pomiar: bok 0,47 / obrys 0,78 / kora 0,29; góra 0,51 / obrys 0,71 / kora 0,19; wystawanie 0,074;
      // chropowatość 0,60–1,21; jasność tonów −0,22…+0,16; ton 0,14; miary 9,3
      { side: 0.42, sideOutline: 0.75, sideBark: 0.17, top: 0.4, topOutline: 0.68, topBark: 0.008, overhang: 0.09, roughMin: 0.57, roughMax: 1.78, brightMin: -0.25, brightMax: 0.18, tone: 0.16, metrics: 14.5 },
      // shell — pomiar: bok 0,41 / obrys 0,59 / kora 0,15; góra 0,38 / obrys 0,47 / kora 0,05; wystawanie 0,068;
      // chropowatość 0,53–1,33; jasność tonów −0,27…+0,19; ton 0,19; miary 10,0
      // po pułapie powiększenia liści 1,5 (0.2.1) bryła korony pokrywa mniej: pomiar bok 0,27 / obrys 0,43; góra 0,16 / obrys 0,33; chropowatość 0,71–2,43; ton 0,254; miary 13,4
      { side: 0.25, sideOutline: 0.4, sideBark: 0.13, top: 0.14, topOutline: 0.28, topBark: 0.04, overhang: 0.09, roughMin: 0.5, roughMax: 2.6, brightMin: -0.32, brightMax: 0.24, tone: 0.28, metrics: 15 },
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
      expect(mid.sizeScale, label).toBeLessThanOrEqual(1.5 + 1e-9);
      expect(far.sizeScale, label).toBeLessThanOrEqual(1.5 + 1e-9);
      // W siatce: jeden liść na miejsce (sześciokąt 4 trójkąty, pięciokąt 3)
      if (mid.clump === 1) expect(s.lods[1].triangles.foliage, label).toBe(mid.count * 4);
      if (far.clump === 1) expect(s.lods[2].triangles.foliage, label).toBe(far.count * 3);

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
      const near = leafPolygonStats(s.lods[0].mesh, 6);
      const mid = leafPolygonStats(s.lods[1].mesh, 6);
      const far = leafPolygonStats(s.lods[2].mesh, 5);
      expect(near.count, label).toBe(s.lods[0].triangles.foliage / 4);
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
    const LIM = { angle: -9, upMid: 0.1, upFar: 0.13, radialMid: 0.08, radialFar: 0.16 };
    {
      expect(m.angleMid).toBeGreaterThanOrEqual(LIM.angle);
      expect(m.angleFar).toBeGreaterThanOrEqual(LIM.angle);
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
      { lum: 0.035, lumMean: 0.01, isoMin: 0.9, isoMax: 1.2, topMin: 0.72, topMax: 1.12, castMin: 0.9, castMax: 1.15, areaMean: 0.06 },
      { lum: 0.06, lumMean: 0.015, isoMin: 0.69, isoMax: 1.26, topMin: 0.6, topMax: 1.21, castMin: 0.62, castMax: 1.26, areaMean: 0.19 },
      // shell po 0.2.1 (pomiar: luminancja −0,06…+0,10; iso 0,56–0,73; góra 0,23–0,75; cień 0,56–0,70)
      { lum: 0.11, lumMean: 0.04, isoMin: 0.5, isoMax: 1.6, topMin: 0.2, topMax: 1.37, castMin: 0.5, castMax: 1.35, areaMean: 0.55 },
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

  it('bryła korony (shell): zamknięty rdzeń bez dziur, liście na powierzchni, trzy tony, normalne jednostkowe', () => {
    const { rings, sides, lobes } = TREE_LOD_PRESETS.shell.crownShell!;
    for (const s of SAMPLES) {
      const label = `${s.kind}#${s.seed}`;
      // Sam rdzeń (bez płatów): każda krawędź — po położeniach, bo ściany są płaskie i mają własne wierzchołki —
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
      expect(coreTriangles, label).toBe(2 * rings * sides);
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
      expect(s.lods[3].triangles.foliage, label).toBeGreaterThan(2 * rings * sides);
      expect(s.lods[3].triangles.foliage, label).toBeLessThanOrEqual(2 * rings * sides + lobes! * 3);
      expect(tones.size, label).toBeGreaterThanOrEqual(2);
      for (const t of tones) expect(t >= 1 && t <= 3, label).toBe(true);
    }
  });

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

  it('bez `lod` siatka jest identyczna z dotychczasową (sumy kontrolne z wersji 0.1.0)', () => {
    const cases = [
      [{ species: 'OAK', height: 10, seed: 42, withFoliageAccents: true, detail: 'HIGH' }, 'f6ee6d19:115563:[[0,34815,0],[34815,29148,1],[63963,37548,2],[101511,14052,3]]'],
      [{ species: 'BIRCH', height: 14, seed: 7, withFoliageAccents: true, detail: 'MEDIUM', radialSegments: 5 }, '849c562a:93963:[[0,31887,0],[31887,14532,1],[46419,32556,2],[78975,14988,3]]'],
      [{ species: 'SPRUCE', height: 10, seed: 11, withFoliageAccents: true, detail: 'LOW', radialSegments: 3, stroke: ILLUSTRATION_STROKE }, '3c053fcf:63786:[[0,6678,0],[6678,6324,1],[13002,30624,2],[43626,20160,3]]'],
      [{ species: 'WILLOW', height: 8, seed: 3, form: 'FORKED' }, 'b808103a:18759:[[0,18759,0]]'],
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
});
