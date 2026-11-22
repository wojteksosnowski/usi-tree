import { describe, expect, it } from 'vitest';
import * as M from './helpers/geometryMetrics.js';
import { paramRange } from '../core/paramSpec.js';

const T = 60000;
const P = M.baseProfile('OAK');
const byId = (id: string) => M.TARGETED_SWEEPS.find((d) => d.id === id)!;
const cls = (id: string) => M.classify(M.runSweep(byId(id)), byId(id).dir);

describe('Skuteczność parametrów: sweepy i klasyfikacja (profile bazowe, 8 ziaren)', () => {
  for (const id of [
    'trunkLengthRatio',
    'trunkHeightRatio',
    'L1.lengthRatio',
    'L1.lengthV',
    'L1.count',
    'L2.count',
    'L1.curveRes.iso',
    'L1.curveRes',
    'ratioPower',
    'flareFactor',
    'trunkTipRatio',
    'L1.tipRatio',
    'taperShape',
  ]) {
    it(`${id}: klasyfikacja (log) i brak NaN`, () => {
      const data = M.runSweep(byId(id));
      for (const row of data) for (const x of row) expect(Number.isFinite(x)).toBe(true);
      const c = M.classify(data, byId(id).dir);
      console.log(`[efficacy] ${id}: ${c.cls} sens=${c.sensitivity.toFixed(3)} consistent=${c.consistent}/8 ${c.note}`);
      expect(['martwy', 'iluzoryczny', 'nasycony', 'skuteczny']).toContain(c.cls);
    }, T);
  }

  // Parametry z oczekiwaną skutecznością
  for (const id of ['trunkLengthRatio', 'trunkHeightRatio', 'L1.lengthRatio', 'L1.count', 'L2.count', 'ratioPower', 'flareFactor']) {
    it(`${id} jest skuteczny w kierunku ${byId(id).dir}`, () => {
      expect(cls(id).cls).toBe('skuteczny');
    }, T);
  }

  it('baseSize L2 nie jest martwy', () => {
    expect(cls('L2.baseSize').cls).not.toBe('martwy');
  }, T);

  it('flareFactor nie zmienia promienia czubka pnia', () => {
    const data = M.runSweep(byId('flareFactor.tip'));
    for (let s = 0; s < data[0].length; s++) for (const row of data) expect(row[s]).toBeCloseTo(data[0][s], 9);
  }, T);

  it('izolacja: zmiana parametrów L2 nie zmienia pnia ani liczby/nasady pędów L1', () => {
    for (const seed of [42, 101]) {
      const a = M.skeleton('OAK', P, seed);
      const b = M.skeleton('OAK', M.withLevel(P, 1, { count: 15, lengthRatio: 0.3 }), seed);
      // pień i nasady L1 identyczne; punkty L1 mogą się różnić, bo punkty dzieci L2 są dokładane do ts (curveRes)
      expect(M.trunk(b).px).toEqual(M.trunk(a).px);
      expect(M.trunk(b).r).toEqual(M.trunk(a).r);
      const sa = M.levelStems(a, 1);
      const sb = M.levelStems(b, 1);
      expect(sb.length).toBe(sa.length);
      for (let i = 0; i < sa.length; i++) {
        expect(sb[i].px[0]).toBe(sa[i].px[0]);
        expect(sb[i].r[0]).toBe(sa[i].r[0]);
      }
    }
  }, T);
});

describe('radialSegments', () => {
  it('liczba trójkątów rośnie 3..8', () => {
    const tri = [3, 4, 5, 6, 7, 8].map((n) => M.meshStats('OAK', { ...P, radialSegments: n }, 42).triangles);
    for (let i = 1; i < tri.length; i++) expect(tri[i]).toBeGreaterThan(tri[i - 1]);
  }, T);

  it('paramSpec.max = 8 i wartości >8 są obcinane do 8 (bez zmiany geometrii)', () => {
    expect(paramRange('radialSegments').max).toBe(8);
    const t8 = M.meshStats('OAK', { ...P, radialSegments: 8 }, 42).triangles;
    const t16 = M.meshStats('OAK', { ...P, radialSegments: 16 }, 42).triangles;
    expect(t16).toBe(t8);
  }, T);

  it('klasyfikacja sweepu radialSegments = nasycony', () => {
    expect(cls('radialSegments').cls).toBe('nasycony');
  }, T);
});

describe('Taper: osiągnięty czubek wobec celu', () => {
  const targets = [0.05, 0.1, 0.3, 0.6];
  const isoTrunk = (tt: number) =>
    M.trunk(M.skeleton('OAK', { ...P, levels: [], trunkTipRatio: tt, flareFactor: 1 } as typeof P, 42));
  const fullTrunk = (tt: number) => M.trunk(M.skeleton('OAK', { ...P, trunkTipRatio: tt, flareFactor: 1 }, 42));
  const isoL1 = (tt: number, cr: number) =>
    M.medianTip(
      M.levelStems(
        M.skeleton('OAK', M.withLevel({ ...P, levels: [P.levels[0]] }, 0, { curveRes: cr, tipRatio: tt, fork: 0 }), 42),
        1
      )
    );
  const fullL1 = (tt: number, cr: number) =>
    M.medianTip(M.levelStems(M.skeleton('OAK', M.withLevel(P, 0, { curveRes: cr, tipRatio: tt }), 42), 1));

  it('raport liczbowy (log)', () => {
    for (const tt of targets) {
      console.log(
        `[taper] trunkTipRatio=${tt} iso=${M.tipOverBase(isoTrunk(tt)).toFixed(3)} full=${M.tipOverBase(fullTrunk(tt)).toFixed(3)}`
      );
      for (const cr of [3, 10]) {
        console.log(`[taper] L1 tipRatio=${tt} curveRes=${cr} iso=${isoL1(tt, cr).toFixed(3)} full=${fullL1(tt, cr).toFixed(3)}`);
      }
    }
  }, T);

  it('izolowany pień osiąga trunkTipRatio ±10% dla 0.3 i 0.6', () => {
    for (const tt of [0.3, 0.6]) expect(Math.abs(M.tipOverBase(isoTrunk(tt)) / tt - 1)).toBeLessThan(0.1);
  }, T);

  it('pęd L1 z dziećmi: czubek jest monotoniczny względem tipRatio (czułość)', () => {
    const v = targets.map((tt) => fullL1(tt, 3));
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1] - 1e-9);
  }, T);

  it('taperShape: r(0.5) różni się o >10% między shape 0 i 1 (pień izolowany)', () => {
    const mid = (sh: number) => {
      const t = M.trunk(M.skeleton('OAK', { ...P, levels: [], taperShape: sh, trunkTipRatio: 0.1, flareFactor: 1 } as typeof P, 42));
      return M.radiusAtArc(t, 0.5) / t.r[0];
    };
    console.log(`[taper] shape r(0.5)/r0: shape0=${mid(0).toFixed(3)} shape1=${mid(1).toFixed(3)}`);
    expect((mid(0) - mid(1)) / mid(0)).toBeGreaterThan(0.1);
  }, T);

  it('taperShape: r(0.5) różni się o >10% między shape 0 i 1 (pień z dziećmi)', () => {
    const mid = (sh: number) => {
      const t = M.trunk(M.skeleton('OAK', { ...P, taperShape: sh, trunkTipRatio: 0.1, flareFactor: 1 }, 42));
      return M.radiusAtArc(t, 0.5) / t.r[0];
    };
    console.log(`[taper] shape r(0.5)/r0 z dziećmi: shape0=${mid(0).toFixed(3)} shape1=${mid(1).toFixed(3)}`);
    expect((mid(0) - mid(1)) / mid(0)).toBeGreaterThan(0.1);
  }, T);
});

describe('Taper: cel osiągany także dla cienkich pędów i niskich tipRatio', () => {
  const targets = [0.05, 0.1, 0.3, 0.6];
  // Gruby pień: r0 gałęzi L1 musi leżeć wyraźnie nad absolutną podłogą promienia (MIN_RADIUS_RATIO), inaczej cel 0.05 jest fizycznie nieosiągalny
  const PT = { ...P, trunkBaseRadiusRatio: P.trunkBaseRadiusRatio * 10 } as typeof P;
  const isoTrunk = (tt: number) =>
    M.trunk(M.skeleton('OAK', { ...PT, levels: [], trunkTipRatio: tt, flareFactor: 1 } as typeof P, 42));
  const fullTrunk = (tt: number, shape = 0) =>
    M.trunk(M.skeleton('OAK', { ...P, trunkTipRatio: tt, taperShape: shape, flareFactor: 1 }, 42));
  const isoL1 = (tt: number, cr: number) =>
    M.medianTip(
      M.levelStems(
        M.skeleton('OAK', M.withLevel({ ...PT, levels: [P.levels[0]] }, 0, { curveRes: cr, tipRatio: tt, fork: 0 }), 42),
        1
      )
    );
  const fullL1 = (tt: number, cr: number) =>
    M.medianTip(M.levelStems(M.skeleton('OAK', M.withLevel(PT, 0, { curveRes: cr, tipRatio: tt }), 42), 1));

  it('raport liczbowy (log)', () => {
    for (const tt of targets) {
      console.log(`[taper-target] trunk tip=${tt} iso=${M.tipOverBase(isoTrunk(tt)).toFixed(3)} full=${M.tipOverBase(fullTrunk(tt)).toFixed(3)}`);
      for (const cr of [3, 10])
        console.log(`[taper-target] L1 tip=${tt} cr=${cr} iso=${isoL1(tt, cr).toFixed(3)} full=${fullL1(tt, cr).toFixed(3)}`);
    }
  }, T);

  it('izolowany pień osiąga trunkTipRatio ±10% dla 0.05/0.1/0.3/0.6', () => {
    for (const tt of targets) expect(Math.abs(M.tipOverBase(isoTrunk(tt)) / tt - 1)).toBeLessThan(0.1);
  }, T);

  it('izolowany pęd L1 osiąga tipRatio ±10% (curveRes 3 i 10) dla 0.05/0.1/0.3/0.6', () => {
    for (const cr of [3, 10])
      for (const tt of targets) expect(Math.abs(isoL1(tt, cr) / tt - 1)).toBeLessThan(0.1);
  }, T);

  it('pień z dziećmi: czubek w ±10% celu', () => {
    for (const tt of [0.05, 0.1, 0.3, 0.6]) expect(Math.abs(M.tipOverBase(fullTrunk(tt)) / tt - 1)).toBeLessThan(0.1);
  }, T);

  // Normalna grubość pnia (bez mnożnika x10): pędy L1 są cienkie, więc cel wymaga względnej podłogi promienia i pierwszeństwa krzywej nad regułą rur
  const normL1 = (tt: number, iso: boolean) =>
    M.medianTip(
      M.levelStems(
        M.skeleton(
          'OAK',
          M.withLevel(
            iso ? ({ ...P, levels: [P.levels[0]] } as typeof P) : P,
            0,
            iso ? { tipRatio: tt, fork: 0 } : { tipRatio: tt }
          ),
          42
        ),
        1
      )
    );

  it('L1 normalnej grubości (z dziećmi i izolowany) osiąga tipRatio ±10%, 0.05 różne od 0.1', () => {
    for (const iso of [false, true]) {
      const v = targets.map((tt) => normL1(tt, iso));
      console.log(`[taper-target] normal L1 iso=${iso}: ${v.map((x) => x.toFixed(3)).join(' ')}`);
      targets.forEach((tt, i) => expect(Math.abs(v[i] / tt - 1)).toBeLessThan(0.1));
      expect(v[1] - v[0]).toBeGreaterThan(0.03);
    }
  }, T);

  it('tipRatio 0.05 i 0.1 dają różne czubki L1 (brak podłogi 0.12)', () => {
    expect(Math.abs(isoL1(0.05, 3) - isoL1(0.1, 3))).toBeGreaterThan(0.01);
  }, T);

  it('taperShape: r(0.5) różni się o >10% między shape 0 i 1', () => {
    const mid = (sh: number) => {
      const t = fullTrunk(0.1, sh);
      return M.radiusAtArc(t, 0.5) / t.r[0];
    };
    expect((mid(0) - mid(1)) / mid(0)).toBeGreaterThan(0.1);
  }, T);

  it('ciągłość: monotoniczny spadek, krok >= 0.78, dzieci <= 0.9 rodzica (ziarna 1, 42)', () => {
    for (const seed of [1, 42]) {
      for (const sp of ['OAK', 'BIRCH', 'PINE'] as const) {
        const prof = M.baseProfile(sp);
        const stems = M.skeleton(sp, prof, seed).stems;
        for (const s of stems) {
          for (let i = 0; i + 1 < s.r.length; i++) {
            expect(s.r[i + 1]).toBeLessThanOrEqual(s.r[i] + 1e-12);
            expect(s.r[i + 1] / s.r[i]).toBeGreaterThanOrEqual(0.78);
          }
          expect(s.r.every(Number.isFinite)).toBe(true);
        }
      }
    }
  }, T);
});

describe('segmentDecay: geometryczny podział pędu', () => {
  const FS = [0.7, 0.85, 1];
  const withDecay = (f: number, extra: Record<string, unknown> = {}) =>
    ({ ...M.withLevel(P, 1, { segmentDecay: f, ...extra } as never), trunkSegmentDecay: f } as typeof P);

  it('f=1 i brak pola dają identyczny szkielet', () => {
    const a = M.skeletonSignature(M.skeleton('OAK', P, 42));
    const b = M.skeletonSignature(M.skeleton('OAK', withDecay(1), 42));
    expect(b).toBe(a);
  }, T);

  it('liczba dzieci pnia jak przy f=1 (głębsze rzędy ±5%), długość nominalna zachowana', () => {
    for (const seed of [11, 42]) {
      const ref = M.skeleton('OAK', withDecay(1), seed);
      for (const f of FS) {
        const sk = M.skeleton('OAK', withDecay(f), seed);
        // Plan dzieci pnia i konarów jest ustalony przed podziałem; głębsze rzędy mogą się nieznacznie
        // różnić (inna geometria => inne przycięcie obwiednią / prune), więc tolerancja 5%.
        for (const lv of [0, 1]) expect(M.stemCount(sk, lv)).toBe(M.stemCount(ref, lv));
        expect(Math.abs(sk.stems.length - ref.stems.length) / ref.stems.length).toBeLessThan(0.05);
        const t = M.trunk(sk);
        const tr = M.trunk(ref);
        expect(Math.abs(t.length - tr.length) / tr.length).toBeLessThan(1e-6);
      }
    }
  }, T);

  it('odcinki pnia maleją ku czubkowi dla f<1', () => {
    for (const f of [0.7, 0.85]) {
      const L = M.segLengths(M.trunk(M.skeleton('OAK', withDecay(f), 42)));
      expect(L.length).toBeGreaterThan(2);
      // Pierwsza połowa odcinków (bez punktów dzieci) ma wyraźnie dłuższe odcinki niż ostatnie
      expect(M.mean(L.slice(0, 3))).toBeGreaterThan(M.mean(L.slice(-3)));
    }
  }, T);

  it('minSegmentRatio: ostatni odcinek >= min, więcej pierścieni', () => {
    const min = 0.02;
    const sk = M.skeleton('OAK', { ...P, trunkSegmentDecay: 0.8, trunkMinSegmentRatio: min } as typeof P, 42);
    const t = M.trunk(sk);
    const L = M.segLengths(t);
    const total = L.reduce((a, b) => a + b, 0);
    expect(L[L.length - 1] / total).toBeGreaterThanOrEqual(min * 0.8);
    const base = M.skeleton('OAK', { ...P, trunkSegmentDecay: 0.8 } as typeof P, 42);
    expect(t.px.length).toBeGreaterThan(M.trunk(base).px.length);
  }, T);
});
