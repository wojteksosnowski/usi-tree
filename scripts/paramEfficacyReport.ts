/**
 * Raport skuteczności parametrów (realny vs iluzoryczny wpływ). Profile bazowe, 8 ziaren.
 * Uruchomienie: NODE_NO_WARNINGS=1 npx tsx scripts/paramEfficacyReport.ts
 * Wyjście: tmp/param-efficacy/{report.json,report.md,taper-*.csv}
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRANCH_PARAM_SPEC, SPECIES_PARAM_SPEC, paramRange } from '../src/core/paramSpec.js';
import * as M from '../src/__tests__/helpers/geometryMetrics.js';

const OUT = join(process.cwd(), 'tmp', 'param-efficacy');
mkdirSync(OUT, { recursive: true });
const SP = 'OAK' as const;
const P = M.baseProfile(SP);

interface Row {
  param: string;
  metric: string;
  values: number[];
  sensitivity: number;
  cls: M.EfficacyClass;
  consistent: number;
  note: string;
}
const rows: Row[] = [];
const fmt = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(4)) : n);

// 1) sweepy celowane
const targetedKeys = new Set<string>();
for (const def of M.TARGETED_SWEEPS) {
  const c = M.classify(M.runSweep(def), def.dir);
  targetedKeys.add(def.param.replace(/^levels\[\d\]\./, '').replace(/ .*/, ''));
  const note = def.id === 'flareFactor.tip' && c.cls === 'martwy' ? 'oczekiwane: flare nie dotyka czubka' : c.note;
  rows.push({ param: def.param, metric: def.metric, values: def.values, sensitivity: fmt(c.sensitivity), cls: c.cls, consistent: c.consistent, note });
}

// 2) sweepy ogólne: sygnatura szkieletu + siatki z listowiem (wykrywa martwe parametry)
function genericValues(key: string, d: number): number[] {
  const { min, max, integer } = paramRange(key);
  let v = d === 0 ? [0, 0.25, 0.5, 1].map((f) => min + f * Math.min(max - min, 1)) : [0.5, 1, 1.5, 2].map((f) => d * f);
  if (integer) v = v.map((x) => Math.round(x));
  v = v.map((x) => Math.min(max, Math.max(min, x)));
  const u = [...new Set(v)];
  // wartość domyślna na początku (rozrzut bazowy), reszta rosnąco
  return u.sort((a, b) => a - b);
}
function genericMeasure(profile: M.Profile, seed: number): number {
  const sk = M.skeleton(SP, profile, seed);
  const ms = M.meshStats(SP, profile, seed, { foliage: true });
  return M.skeletonSignature(sk) + ms.signature * 1e-3 + ms.triangles;
}
const covered = new Set(['trunkLengthRatio', 'trunkHeightRatio', 'lengthRatio', 'lengthV', 'count', 'curveRes', 'radialSegments', 'trunkTipRatio', 'tipRatio', 'taperShape', 'ratioPower', 'flareFactor']);
const seeds3 = M.SEEDS;

for (const [key, spec] of Object.entries(BRANCH_PARAM_SPEC)) {
  if (covered.has(key)) continue;
  const d = typeof spec.default === 'function' ? (spec.default({}, 10) ?? 0) : (spec.default ?? 0);
  const cur = (P.levels[0] as unknown as Record<string, number>)[key];
  const base = typeof cur === 'number' ? cur : d;
  const values = genericValues(key, base);
  if (values.length < 2) continue;
  const data = M.sweep(values, seeds3, (v, s) => genericMeasure(M.withLevel(P, 0, { [key]: v } as never), s));
  const c = M.classifyPaired(data);
  rows.push({ param: `levels[0].${key}`, metric: 'sygnatura (szkielet+siatka)', values, sensitivity: fmt(c.sensitivity), cls: c.cls, consistent: c.consistent, note: c.note });
}
for (const [key, spec] of Object.entries(SPECIES_PARAM_SPEC)) {
  if (covered.has(key)) continue;
  const d = typeof spec.default === 'function' ? (spec.default(P as never, 10) ?? 0) : (spec.default ?? 0);
  const cur = (P as unknown as Record<string, number>)[key];
  const base = typeof cur === 'number' ? cur : d;
  const values = genericValues(key, base);
  if (values.length < 2) continue;
  const data = M.sweep(values, seeds3, (v, s) => genericMeasure({ ...P, [key]: v } as M.Profile, s));
  const c = M.classifyPaired(data);
  const note = c.cls === 'martwy' ? `${c.note} (może być warunkowy: wymaga formy pnia/opcji nieaktywnej w OAK)` : c.note;
  rows.push({ param: key, metric: 'sygnatura (szkielet+siatka)', values, sensitivity: fmt(c.sensitivity), cls: c.cls, consistent: c.consistent, note });
}

// 3) taper: osiągnięte vs cel + CSV r(t)
const taper: Record<string, unknown>[] = [];
const csv: string[] = ['case,tipRatio,curveRes,t,r_over_r0,target_over_r0'];
for (const tt of [0.05, 0.1, 0.3, 0.6]) {
  const isoT = M.trunk(M.skeleton(SP, { ...P, levels: [], trunkTipRatio: tt, flareFactor: 1 } as M.Profile, 42));
  const fullT = M.trunk(M.skeleton(SP, { ...P, trunkTipRatio: tt, flareFactor: 1 }, 42));
  taper.push({ kind: 'trunk', target: tt, curveRes: 10, isolated: fmt(M.tipOverBase(isoT)), withChildren: fmt(M.tipOverBase(fullT)) });
  for (const [name, st] of [['trunk-iso', isoT], ['trunk-full', fullT]] as const)
    for (const t of M.T_SAMPLES) csv.push(`${name},${tt},10,${t},${fmt(M.radiusAtArc(st, t) / st.r[0])},${fmt(M.expectedRadiusRatio(t, tt, 0))}`);
  for (const cr of [3, 10]) {
    const isoP = M.withLevel({ ...P, levels: [P.levels[0]] }, 0, { curveRes: cr, tipRatio: tt, fork: 0 });
    const fullP = M.withLevel(P, 0, { curveRes: cr, tipRatio: tt });
    const iso = M.levelStems(M.skeleton(SP, isoP, 42), 1);
    const full = M.levelStems(M.skeleton(SP, fullP, 42), 1);
    // izolowany L1 na grubym pniu (×10), by r0 gałęzi leżał nad podłogą MIN_RADIUS_RATIO
    const isoTP = M.withLevel({ ...P, trunkBaseRadiusRatio: P.trunkBaseRadiusRatio * 10, levels: [P.levels[0]] } as M.Profile, 0, { curveRes: cr, tipRatio: tt, fork: 0 });
    taper.push({
      kind: 'L1', target: tt, curveRes: cr, isolated: fmt(M.medianTip(iso)), withChildren: fmt(M.medianTip(full)),
      thickIsolated: fmt(M.medianTip(M.levelStems(M.skeleton(SP, isoTP, 42), 1))),
    });
    for (const [name, sts] of [['L1-iso', iso], ['L1-full', full]] as const) {
      const u = M.unclipped(sts);
      for (const t of M.T_SAMPLES) csv.push(`${name},${tt},${cr},${t},${fmt(M.median(u.map((s) => M.radiusAtArc(s, t) / s.r[0])))},${fmt(M.expectedRadiusRatio(t, tt, 0))}`);
    }
  }
}
writeFileSync(join(OUT, 'taper-profiles.csv'), csv.join('\n'));

const shape: Record<string, unknown>[] = [];
for (const sh of [0, 0.5, 1]) {
  const iso = M.trunk(M.skeleton(SP, { ...P, levels: [], taperShape: sh, trunkTipRatio: 0.1, flareFactor: 1 } as M.Profile, 42));
  const full = M.trunk(M.skeleton(SP, { ...P, taperShape: sh, trunkTipRatio: 0.1, flareFactor: 1 }, 42));
  shape.push({ shape: sh, mid_isolated: fmt(M.radiusAtArc(iso, 0.5) / iso.r[0]), mid_withChildren: fmt(M.radiusAtArc(full, 0.5) / full.r[0]), expectedMid: fmt(M.expectedRadiusRatio(0.5, 0.1, sh)) });
}
const radial = [] as { n: number; triangles: number; vertices: number }[];
for (let n = 3; n <= 16; n++) {
  const m = M.meshStats(SP, { ...P, radialSegments: n }, 42);
  radial.push({ n, triangles: m.triangles, vertices: m.vertices });
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify({ species: SP, seeds: M.SEEDS, rows, taper, shape, radial }, null, 2));
const md: string[] = [
  `# Raport skuteczności parametrów (${SP}, profil bazowy, ${M.SEEDS.length} ziaren; sweepy ogólne: klasyfikacja sparowana)`,
  '',
  '| parametr | metryka | czułość | klasa | zgodność ziaren | uwagi |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.param} | ${r.metric} | ${r.sensitivity} | ${r.cls} | ${r.consistent} | ${r.note} |`),
  '',
  '## Taper: osiągnięte r_tip/r0 wobec celu',
  '| pęd | cel | curveRes | izolowany | z dziećmi | izol. na grubym pniu (×10) |',
  '|---|---|---|---|---|---|',
  ...taper.map((t) => `| ${t.kind} | ${t.target} | ${t.curveRes} | ${t.isolated} | ${t.withChildren} | ${t.thickIsolated ?? '–'} |`),
  '',
  '## taperShape (trunkTipRatio=0.1): r(0.5)/r0',
  '| shape | izolowany | z dziećmi | oczekiwany |',
  '|---|---|---|---|',
  ...shape.map((s) => `| ${s.shape} | ${s.mid_isolated} | ${s.mid_withChildren} | ${s.expectedMid} |`),
  '',
  '## radialSegments: trójkąty',
  '| n | trójkąty | wierzchołki |',
  '|---|---|---|',
  ...radial.map((r) => `| ${r.n} | ${r.triangles} | ${r.vertices} |`),
];
writeFileSync(join(OUT, 'report.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
