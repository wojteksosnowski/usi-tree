/**
 * Wzrost szkieletu drzewa wg ez-tree (github.com/dgreenheck/ez-tree, src/lib/tree.js, commit dcf309b).
 * Licencja MIT, Copyright (c) 2024 Daniel Greenheck.
 *
 * Port 1:1 części wzrostu (`#generateSkeleton`, `#growBranch`, `generateChildBranches`, `generateLeaves`, RNG):
 * ta sama kolejność losowań, więc ziarno daje to samo drzewo co oryginał. Siatki, materiały, wiatr i tekstury
 * ez-tree zostają pominięte — wynik to nasz szkielet (`Stem[]`) i miejsca liści, które siatkuje
 * `TreeGenerator.meshSkeleton` w zatwierdzonej stylizacji (kreska, tony liści, kontur, LOD).
 *
 * Różnica wobec naszego modelu Webera–Penna: brak obwiedni korony i przycinania. Kształt wynika z reguł wzrostu,
 * a każda gałąź drzewa liściastego ma przedłużenie końcowe (z czubka rośnie pęd kolejnego rzędu), więc gałęzie
 * kończą się zbieżnie, bez kikutów.
 *
 * Dodatki poza oryginałem (pokroje stylu B2): pień rozdwojony i wielopniowy jako kilka przewodników poziomu 0,
 * „płynne gałązki” jako mniejsze falowanie.
 */
import { Vec3, Quat, EulerXYZ } from './vec3Math.js';
import type { Stem, TrunkForm, EzTreeOptions } from './types.js';
export type { EzTreeOptions };

export interface EzSkeleton {
  stems: Stem[];
  /** Rodzic pędu (indeks w `stems`, −1 = pień od gruntu) i miejsce odgałęzienia (ułamkowy indeks węzła rodzica) */
  parents: number[];
  attach: number[];
  /** Miejsca liści: x, y, z, kierunek dx, dy, dz, rozmiar (jednostki ez-tree) */
  leafSites: number[];
}

/** RNG ez-tree (multiply-with-carry), 1:1 z src/lib/rng.js */
class EzRng {
  private w: number;
  private z: number;
  constructor(seed: number) {
    this.w = (123456789 + seed) & 0xffffffff;
    this.z = (987654321 - seed) & 0xffffffff;
  }
  random(max = 1, min = 0): number {
    this.z = (36969 * (this.z & 65535) + (this.z >> 16)) & 0xffffffff;
    this.w = (18000 * (this.w & 65535) + (this.w >> 16)) & 0xffffffff;
    const result = (((this.z << 16) + (this.w & 65535)) >>> 0) / 4294967296;
    return (max - min) * result + min;
  }
}

interface Section { origin: Vec3; orientation: EulerXYZ; radius: number }
interface QueuedBranch {
  origin: Vec3; orientation: EulerXYZ; length: number; radius: number;
  level: number; sectionCount: number;
  /** Mnożnik liczby dzieci (przewodniki pni wielokrotnych dzielą koronę) */
  childScale: number;
  parent: number;
  attach: number;
}

const UP = new Vec3(0, 1, 0);
/** Najniższy punkt gałęzi (ułamek długości pnia) */
const GROUND_CLEARANCE = 0.03;
const X_AXIS = new Vec3(1, 0, 0);

export function growEzTree(options: EzTreeOptions, seed: number, form: TrunkForm = 'SINGLE', flow = false): EzSkeleton {
  const o = options.branch;
  const rng = new EzRng(seed);
  const stems: Stem[] = [];
  const parents: number[] = [];
  const attach: number[] = [];
  const leafSites: number[] = [];
  const pushStem = (stem: Stem, parent: number, at: number) => { stems.push(stem); parents.push(parent); attach.push(at); return stems.length - 1; };
  const queue: QueuedBranch[] = [];
  const gnarlScale = flow ? 0.45 : 1;
  const groundY = o.length[0] * GROUND_CLEARANCE;
  const deciduous = options.type === 'deciduous';

  const recordLeaf = (origin: Vec3, orientation: EulerXYZ) => {
    const size = options.leaves.size * (1 + rng.random(options.leaves.sizeVariance, -options.leaves.sizeVariance));
    const d = UP.clone().applyEuler(orientation);
    leafSites.push(origin.x, origin.y, origin.z, d.x, d.y, d.z, size);
  };

  const shuffledIndices = (count: number) => {
    const arr = Array.from({ length: count }, (_, k) => k);
    for (let k = count - 1; k > 0; k--) {
      const r = Math.floor(rng.random() * (k + 1));
      [arr[k], arr[r]] = [arr[r], arr[k]];
    }
    return arr;
  };

  /** Punkt na łamanej sekcji rodzica (t ∈ [0, 1]): położenie, orientacja, promień */
  const sampleSections = (sections: Section[], t: number) => {
    const sectionIndex = Math.floor(t * (sections.length - 1));
    const a = sections[sectionIndex];
    const b = sectionIndex === sections.length - 1 ? a : sections[sectionIndex + 1];
    const alpha = (t - sectionIndex / (sections.length - 1)) / (1 / (sections.length - 1));
    const origin = new Vec3().lerpVectors(a.origin, b.origin, alpha);
    const radius = (1 - alpha) * a.radius + alpha * b.radius;
    const qA = new Quat().setFromEuler(a.orientation);
    const qB = new Quat().setFromEuler(b.orientation);
    // Jak w oryginale: qB.slerp(qA, alpha)
    const orientation = new EulerXYZ().setFromQuaternion(qB.slerp(qA, alpha));
    return { origin, orientation, radius };
  };

  /** Kierunek odgałęzienia: obrót o kąt wokół X, potem o azymut wokół Y, w ramie rodzica */
  const childOrientation = (parent: EulerXYZ, angleDeg: number, radialAngle: number) => {
    const q1 = new Quat().setFromAxisAngle(X_AXIS, angleDeg / (180 / Math.PI));
    const q2 = new Quat().setFromAxisAngle(UP, radialAngle);
    const q3 = new Quat().setFromEuler(parent);
    return new EulerXYZ().setFromQuaternion(q3.multiply(q2.multiply(q1)));
  };

  const generateChildBranches = (count: number, level: number, sections: Section[], parent: number) => {
    const radialOffset = rng.random();
    const startMin = o.start[level];
    const heightStep = (1.0 - startMin) / count;
    const angleSlots = shuffledIndices(count);
    for (let i = 0; i < count; i++) {
      const t = startMin + (i + rng.random()) * heightStep;
      const s = sampleSections(sections, t);
      const radialJitter = rng.random(0.5, -0.5);
      const radialAngle = 2.0 * Math.PI * (radialOffset + (angleSlots[i] + radialJitter) / count);
      const length = o.length[level] * (deciduous ? 1.0 : 1.0 - t);
      queue.push({
        origin: s.origin, orientation: childOrientation(s.orientation, o.angle[level], radialAngle),
        length, radius: o.radius[level] * s.radius, level, sectionCount: o.sections[level], childScale: 1,
        parent, attach: t * (sections.length - 1),
      });
    }
  };

  const generateLeaves = (sections: Section[]) => {
    const radialOffset = rng.random();
    const count = options.leaves.count;
    const startMin = options.leaves.start;
    const heightStep = (1.0 - startMin) / count;
    const angleSlots = shuffledIndices(count);
    for (let i = 0; i < count; i++) {
      const t = startMin + (i + rng.random()) * heightStep;
      const s = sampleSections(sections, t);
      const radialJitter = rng.random(0.5, -0.5);
      const radialAngle = 2.0 * Math.PI * (radialOffset + (angleSlots[i] + radialJitter) / count);
      recordLeaf(s.origin, childOrientation(s.orientation, options.leaves.angle, radialAngle));
    }
  };

  const growBranch = (branch: QueuedBranch) => {
    const sectionOrientation = branch.orientation.clone();
    const sectionOrigin = branch.origin.clone();
    // Oryginał porównuje typ z 'Deciduous' (wielka litera), więc dzielnik przez (levels − 1) nigdy nie działa;
    // zachowane, żeby presety wyglądały jak w ez-tree
    const sectionLength = branch.length / branch.sectionCount;
    const sections: Section[] = [];

    for (let i = 0; i <= branch.sectionCount; i++) {
      let sectionRadius = branch.radius;
      if (i === branch.sectionCount && branch.level === o.levels) sectionRadius = 0.001;
      else if (deciduous) sectionRadius *= 1 - o.taper[branch.level] * (i / branch.sectionCount);
      else sectionRadius *= 1 - i / branch.sectionCount;

      sections.push({ origin: sectionOrigin.clone(), orientation: sectionOrientation.clone(), radius: sectionRadius });
      // Rozszerzenie: zwisający pęd kończy się nad gruntem (ez-tree nie zna gruntu)
      if (branch.level > 0 && i > 0 && sectionOrigin.y < groundY) break;
      sectionOrigin.add(new Vec3(0, sectionLength, 0).applyEuler(sectionOrientation));

      // Falowanie: większe na cienkich pędach
      const gnarliness = Math.max(1, 1 / Math.sqrt(sectionRadius)) * o.gnarliness[branch.level] * gnarlScale;
      sectionOrientation.x += rng.random(gnarliness, -gnarliness);
      sectionOrientation.z += rng.random(gnarliness, -gnarliness);

      const qSection = new Quat().setFromEuler(sectionOrientation);
      qSection.multiply(new Quat().setFromAxisAngle(UP, o.twist[branch.level]));

      // Siła wzrostu: obrót ku kierunkowi siły o strength / r (cienkie pędy ustępują bardziej), bez przestrzelenia
      const sectionUp = UP.clone().applyQuaternion(qSection);
      const target = new Vec3(o.force.direction.x, o.force.direction.y, o.force.direction.z).normalize();
      const axis = new Vec3().crossVectors(sectionUp, target);
      const sinFull = axis.length();
      if (sinFull > 1e-6) {
        axis.divideScalar(sinFull);
        const fullAngle = Math.atan2(sinFull, sectionUp.dot(target));
        const step = o.force.strength / sectionRadius;
        qSection.premultiply(new Quat().setFromAxisAngle(axis, Math.max(-fullAngle, Math.min(fullAngle, step))));
      }
      sectionOrientation.setFromQuaternion(qSection);
    }

    const self = pushStem({
      level: branch.level,
      px: sections.map((s) => s.origin.x), py: sections.map((s) => s.origin.y), pz: sections.map((s) => s.origin.z),
      r: sections.map((s) => s.radius),
      length: branch.length,
      clipped: false,
    }, branch.parent, branch.attach);

    // Drzewa liściaste: przedłużenie końcowe z czubka pędu
    if (deciduous) {
      const last = sections[sections.length - 1];
      if (branch.level < o.levels) {
        queue.push({
          origin: last.origin, orientation: last.orientation, length: o.length[branch.level + 1], radius: last.radius,
          level: branch.level + 1, sectionCount: branch.sectionCount, childScale: 1,
          parent: self, attach: sections.length - 1,
        });
      } else {
        recordLeaf(last.origin, last.orientation);
      }
    }

    if (branch.level === o.levels) generateLeaves(sections);
    else if (branch.level < o.levels) {
      generateChildBranches(Math.max(1, Math.round(o.children[branch.level] * branch.childScale)), branch.level + 1, sections, self);
    }
  };

  const len0 = o.length[0], r0 = o.radius[0];
  const sc = options.scaffold;
  if (form === 'SINGLE' && sc) {
    const baseY = len0 * sc.height;
    // Pień zwężający się ku rozwidleniu (bez skoku grubości przy konarach)
    const stub = pushStem({ level: 0, px: [0, 0, 0], py: [0, baseY * 0.6, baseY], pz: [0, 0, 0], r: [r0, r0 * 0.86, r0 * 0.74], length: baseY, clipped: false }, -1, 0);
    const az0 = rng.random() * Math.PI * 2;
    for (let i = 0; i < sc.count; i++) {
      const lean = (sc.lean + rng.random(sc.leanV, -sc.leanV)) * (Math.PI / 180);
      const az = az0 + (i / sc.count) * Math.PI * 2 + rng.random(0.35, -0.35);
      const dir = new Vec3(Math.sin(lean) * Math.cos(az), Math.cos(lean), Math.sin(lean) * Math.sin(az));
      queue.push({
        origin: new Vec3(0, baseY, 0), orientation: new EulerXYZ().setFromQuaternion(new Quat().setFromUnitVectors(UP, dir)),
        length: (len0 - baseY) * (0.8 + rng.random() * 0.2), radius: r0 * 0.74 * Math.pow(sc.count, -0.5) * 1.3,
        level: 0, sectionCount: o.sections[0], childScale: Math.pow(sc.count, -0.4), parent: stub, attach: 2,
      });
    }
  } else if (form === 'SINGLE') {
    queue.push({ origin: new Vec3(), orientation: new EulerXYZ(), length: len0, radius: r0, level: 0, sectionCount: o.sections[0], childScale: 1, parent: -1, attach: 0 });
  } else {
    // Przewodniki pni wielokrotnych (styl B2): rozdwojony — krótki pień i dwa przewodniki; wielopniowy — 3–5 od gruntu
    const forked = form === 'FORKED';
    const baseY = forked ? len0 * (0.18 + rng.random() * 0.12) : 0;
    const stub = forked ? pushStem({ level: 0, px: [0, 0], py: [0, baseY], pz: [0, 0], r: [r0, r0 * 0.92], length: baseY, clipped: false }, -1, 0) : -1;
    const n = forked ? 2 : 3 + Math.floor(rng.random() * 3);
    const az0 = rng.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const lean = (forked ? 22 + rng.random() * 10 : 16 + rng.random() * 12) * (Math.PI / 180);
      const az = az0 + (i / n) * Math.PI * 2 + (forked ? 0 : rng.random(0.4, -0.4));
      const dir = new Vec3(Math.sin(lean) * Math.cos(az), Math.cos(lean), Math.sin(lean) * Math.sin(az));
      const orientation = new EulerXYZ().setFromQuaternion(new Quat().setFromUnitVectors(UP, dir));
      const off = forked ? 0 : r0 * 0.8;
      queue.push({
        origin: new Vec3(Math.cos(az) * off, baseY, Math.sin(az) * off), orientation,
        length: (len0 - baseY) * (forked ? 0.85 + rng.random() * 0.15 : 0.7 + rng.random() * 0.2),
        radius: r0 * (forked ? 0.92 * Math.SQRT1_2 * 1.05 : Math.pow(n, -0.5) * 1.1),
        level: 0, sectionCount: o.sections[0], childScale: forked ? 0.7 : Math.pow(n, -0.55), parent: stub, attach: 1,
      });
    }
  }

  while (queue.length > 0) growBranch(queue.shift()!);
  return { stems, parents, attach, leafSites };
}

/**
 * Promienie wg modelu rur (da Vinci): od końców gałęzi w dół r_węzła^p = r_wyżej^p + Σ r_nasady_dziecka^p.
 * Pień jest gruby aż do korony i chudnie przy każdym odgałęzieniu, przejścia między rzędami są ciągłe
 * (przedłużenie końcowe zaczyna się promieniem końca rodzica), a końce pędów mają promień `tip` zamiast zera.
 * Zastępuje liniową zbieżność ez-tree, która dawała uskoki, kolce i karykaturalnie szybko chudnące pnie.
 * Dzieci zawsze powstają po rodzicu (kolejka wszerz), więc wystarcza jeden przebieg od końca listy.
 */
export function applyPipeRadii(sk: EzSkeleton, exponent: number, tip: number, taperPerNode = 0.012): void {
  const { stems, parents, attach } = sk;
  const kids: { at: number; child: number }[][] = stems.map(() => []);
  for (let c = 0; c < stems.length; c++) if (parents[c] >= 0) kids[parents[c]].push({ at: attach[c], child: c });
  for (let s = stems.length - 1; s >= 0; s--) {
    const st = stems[s], n = st.r.length, list = kids[s];
    let acc = Math.pow(tip, exponent);
    for (let i = n - 1; i >= 0; i--) {
      // Dzieci odgałęziające się między węzłem i a i + 1 (koniec: dokładnie w ostatnim węźle)
      for (const k of list) {
        const inSpan = i === n - 1 ? k.at >= n - 1 - 1e-9 : k.at >= i - 1e-9 && k.at < i + 1 - 1e-9;
        if (inSpan) acc += Math.pow(stems[k.child].r[0], exponent);
      }
      if (i < n - 1) acc *= Math.pow(1 + taperPerNode, exponent);
      st.r[i] = Math.pow(acc, 1 / exponent);
    }
  }
}
