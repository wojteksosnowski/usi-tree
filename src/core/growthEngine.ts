/**
 * Pure botanical skeleton growth engine (Weber & Penn 1995 model).
 * Fully re-entrant and instance-encapsulated (zero static mutable state).
 */
import { CrownEnvelope, GROUND_CLEARANCE, crownRatio } from './crownEnvelope.js';
import { FastPrng, stemHash } from './prng.js';
import type {
  BranchLevelParams,
  SpeciesProfile,
  Stem,
  TrunkForm,
} from './types.js';

const DEG = Math.PI / 180;
const GNARL_REF_RADIUS = 0.008; // promień nominalny, poniżej którego pęd zaczyna się wichrować
const GNARL_MAX = 3;
const MIN_RADIUS_RATIO = 0.0009; // najcieńsza witka / wysokość
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // 137,5°
const GOLDEN_JITTER = 0.25; // rozrzut azymutu przy złotym kącie (rad)
const OUTWARD_MAX_DOWN = 80 * DEG;
const PRUNE_MIN_FRACTION = 0.12; // pęd mieszczący się w obwiedni na mniejszym ułamku nie rośnie
const PRUNE_MARGIN = 0.94; // zapas na falowanie (oś symulowana bez niego)
const SAG_REF_SLENDERNESS = 60; // smukłość L/r, przy której ugięcie = pliancy
const SAG_MAX_SLENDERNESS = 4; // ograniczenie mnożnika smukłości (bardzo cienkie witki)

export class GrowthContext {
  readonly envelope: CrownEnvelope;
  readonly flow: boolean;
  readonly asymAz: number;

  trunkCountScale = 1;
  clipLeaders = false;
  leaderTropism = 2.2;
  groundClearance = -Infinity;
  tmp: [number, number, number] = [0, 0, 0];

  constructor(profile: SpeciesProfile, flow: boolean, asymAz: number) {
    this.envelope = new CrownEnvelope(profile);
    this.flow = flow;
    this.asymAz = asymAz;
  }

  grow(profile: SpeciesProfile, prng: FastPrng, form: TrunkForm): Stem[] {
    const out: Stem[] = [];
    this.trunkCountScale = 1;
    this.clipLeaders = form !== 'SINGLE' || !!profile.scaffoldLimbs;
    this.leaderTropism = 2.2;
    const L = profile.trunkLengthRatio;
    const R0 = profile.trunkBaseRadiusRatio;

    if (form === 'MULTI') {
      const n = 3 + Math.floor(prng.next() * 3);
      this.growLeaders(n, 0, R0, 16, 12, L * 0.72, L * 0.2, profile, prng, out);
    } else if (form === 'SINGLE' && profile.scaffoldLimbs) {
      const baseY = profile.trunkHeightRatio;
      out.push({
        level: 0,
        px: [0, 0],
        py: [0, baseY],
        pz: [0, 0],
        r: [R0, R0 * 0.9],
        length: baseY,
        clipped: false,
      });
      const n = profile.scaffoldLimbs + (prng.next() < 0.5 ? 0 : 1);
      this.leaderTropism = 0.5;
      this.growLeaders(
        n,
        baseY,
        R0 * 0.9,
        28,
        18,
        (1 - baseY) * 0.85,
        (1 - baseY) * 0.25,
        profile,
        prng,
        out
      );
    } else if (form === 'FORKED') {
      const forkYRand = Math.min(profile.trunkHeightRatio * 0.9, 0.18 + prng.next() * 0.17);
      const forkY = profile.trunkForkHeightRatio ?? forkYRand;
      const az0 = prng.range(0, Math.PI * 2);
      const lean = (2 + prng.next() * 3) * DEG * (profile.trunkLeanScale ?? 1);
      const tx = Math.sin(lean) * Math.cos(az0);
      const tz = Math.sin(lean) * Math.sin(az0);
      const ty = Math.cos(lean);
      const rTop = R0 * 0.8;
      out.push({
        level: 0,
        px: [0, tx * forkY * 0.5, tx * forkY],
        py: [0, ty * forkY * 0.5, ty * forkY],
        pz: [0, tz * forkY * 0.5, tz * forkY],
        r: [R0, R0 * 0.9, rTop],
        length: forkY,
        clipped: false,
      });
      this.trunkCountScale = 0.7;
      if (profile.trunkForkTropism !== undefined) {
        this.leaderTropism = profile.trunkForkTropism;
      }
      const spread = (profile.trunkForkAngle ?? 32) * (0.85 + prng.next() * 0.3);
      const asym = Math.min(1, Math.max(0, profile.trunkForkAsymmetry ?? 0));
      const leaders = [
        {
          az: az0 + Math.PI,
          angle: spread * (0.35 - 0.25 * asym) * (profile.trunkForkMainAngleScale ?? 1),
          len: 1.0,
          r: rTop * (0.82 + 0.08 * asym),
        },
        {
          az: az0 + prng.signedRange(0.5),
          angle: spread * (0.7 + 0.3 * asym),
          len:
            (0.85 + prng.next() * 0.1) *
            (1 - 0.3 * asym) *
            (profile.trunkForkSideLength ?? 1),
          r: rTop * (0.72 - 0.25 * asym) * (profile.trunkForkSideRadius ?? 1),
        },
      ];
      for (const ld of leaders) {
        this.splitDir(tx, ty, tz, ld.az, ld.angle * DEG);
        const [dx, dy, dz] = this.tmp;
        this.growBranch(
          0,
          tx * forkY,
          ty * forkY,
          tz * forkY,
          dx,
          dy,
          dz,
          (L - forkY) * ld.len,
          ld.r,
          profile,
          prng,
          out
        );
      }
    } else {
      this.growBranch(0, 0, 0, 0, 0, 1, 0, L, R0, profile, prng, out);
    }

    for (const s of out) {
      if (s.level === 0 && s.py[0] < 1e-6) s.r[0] *= profile.flareFactor;
    }
    return out;
  }

  private growLeaders(
    n: number,
    oy: number,
    r: number,
    lean0: number,
    leanV: number,
    len0: number,
    lenV: number,
    profile: SpeciesProfile,
    prng: FastPrng,
    out: Stem[]
  ) {
    this.trunkCountScale = Math.pow(n, -0.55);
    const az0 = prng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const lean = (lean0 + prng.next() * leanV) * DEG;
      const az = az0 + (i / n) * Math.PI * 2 + prng.signedRange(0.4);
      const dx = Math.sin(lean) * Math.cos(az);
      const dz = Math.sin(lean) * Math.sin(az);
      const dy = Math.cos(lean);
      const off = r * 0.8;
      this.growBranch(
        0,
        Math.cos(az) * off,
        oy,
        Math.sin(az) * off,
        dx,
        dy,
        dz,
        len0 + prng.next() * lenV,
        r * Math.pow(n, -0.5) * 1.1,
        profile,
        prng,
        out
      );
    }
  }

  growBranch(
    level: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    length: number,
    r0: number,
    profile: SpeciesProfile,
    prng: FastPrng,
    out: Stem[]
  ) {
    const isTrunk = level === 0;
    const p: BranchLevelParams = isTrunk
      ? {
          count: 0,
          downAngle: 0,
          downAngleV: 0,
          lengthRatio: 1,
          lengthV: 0,
          curve: 0,
          curveV: profile.trunkCurveV,
          curveRes: 10,
          tropism: Math.abs(dy) < 0.97 ? this.leaderTropism : 0.3,
          fork: 0,
          kink: profile.trunkKink ?? 3,
        }
      : profile.levels[level - 1];
    const cp = profile.levels[level];
    const deepest = profile.levels.length;
    const clipProb = profile.envelopeClipProbability ?? 1.0;

    const bypassRadial =
      !isTrunk &&
      level >= deepest - 1 &&
      clipProb < 1.0 &&
      stemHash(ox, oy, oz, level) >= clipProb;

    this.groundClearance =
      profile.prune && !isTrunk && oy > GROUND_CLEARANCE ? GROUND_CLEARANCE : -Infinity;
    this.envelope.groundClearance = this.groundClearance;

    let pruneFactor = 1;
    if (profile.prune && (!isTrunk || this.clipLeaders)) {
      const f0 = this.pruneFraction(
        ox,
        oy,
        oz,
        dx,
        dy,
        dz,
        length,
        p,
        this.stemTropism(p, r0),
        isTrunk ? 0 : this.stemSag(profile, length, r0),
        bypassRadial
      );
      if (f0 < 1) {
        if (f0 < PRUNE_MIN_FRACTION && !isTrunk) return;
        const r1 = r0 * Math.pow(Math.max(PRUNE_MIN_FRACTION, f0), profile.ratioPower);
        const f = Math.min(
          f0,
          this.pruneFraction(
            ox,
            oy,
            oz,
            dx,
            dy,
            dz,
            length,
            p,
            this.stemTropism(p, r1),
            isTrunk ? 0 : this.stemSag(profile, length, r1),
            bypassRadial
          )
        );
        pruneFactor = f;
        const suppression = Math.pow(Math.max(PRUNE_MIN_FRACTION, f), 0.35);
        const k = Math.max(PRUNE_MIN_FRACTION, f * suppression) * PRUNE_MARGIN;
        length *= k;
        r0 = Math.max(MIN_RADIUS_RATIO, r0 * Math.pow(k, profile.ratioPower) * suppression);
      }
    }

    let breakT = Infinity;
    if (level === 1 && profile.limbBreakProbability) {
      const hb = stemHash(oz, ox, oy, 7);
      if (hb < profile.limbBreakProbability) {
        breakT = 0.35 + 0.35 * (hb / profile.limbBreakProbability);
      }
    }

    const plan: { t: number; az: number; len: number; down: number; reach?: boolean }[] = [];
    if (cp) {
      const base = isTrunk
        ? Math.max(0.03, (profile.trunkHeightRatio - oy) / Math.max(1e-6, length))
        : (cp.baseSize ?? 0.1);
      const count = isTrunk
        ? Math.max(2, Math.round(cp.count * this.trunkCountScale))
        : Math.max(
            1,
            Math.round(
              cp.count *
                (0.25 + 0.75 * Math.min(1, length / this.levelRefLength(profile, level)))
            )
          );
      const golden = profile.phyllotaxis === 'golden';
      const rot = cp.rotate !== undefined ? cp.rotate * DEG : golden ? GOLDEN_ANGLE : null;
      const rotJitter = cp.rotateV !== undefined ? cp.rotateV * DEG : GOLDEN_JITTER;
      const slots = rot !== null ? null : this.shuffledSlots(count, prng);
      const azOffset = prng.next();
      for (let i = 0; i < count; i++) {
        const t = Math.min(
          0.97,
          base + ((1 - base) * (i + 0.15 + prng.next() * 0.7)) / count
        );
        const az = slots
          ? 2 * Math.PI * (azOffset + (slots[i] + prng.signedRange(0.4)) / count)
          : 2 * Math.PI * azOffset + i * rot! + prng.signedRange(rotJitter);
        let len: number;
        if (isTrunk) {
          len = profile.crownSpreadRatio * crownRatio(profile.crownShape, (t - base) / Math.max(1e-6, 1 - base), profile.crownPeak);
        } else {
          len = cp.lengthRatio * length * (1 - 0.6 * t);
        }
        len *= 1 + prng.signedRange(cp.lengthV);
        if (isTrunk && profile.crownAsymmetry) {
          len *= 1 + profile.crownAsymmetry * Math.cos(az - this.asymAz);
        }
        if (len < 0.004) continue;
        const tRel = (t - base) / Math.max(1e-6, 1 - base);
        const down =
          cp.downAngle + (cp.downAngleSlope ?? 0) * (1 - tRel) + prng.signedRange(cp.downAngleV);
        plan.push({
          t,
          az,
          len,
          down: Math.min(110, down) * DEG,
          reach: isTrunk && !!profile.limbsReachEnvelope,
        });
      }
    }

    const res = Math.max(1, this.flow && !isTrunk ? p.curveRes * 2 : p.curveRes);
    const ts: number[] = [];
    for (let i = 1; i <= res; i++) ts.push(i / res);
    for (const c of plan) ts.push(c.t);
    ts.sort((a, b) => a - b);

    const gnarl = Math.min(
      GNARL_MAX,
      Math.max(1, Math.sqrt(GNARL_REF_RADIUS / Math.max(1e-6, r0)))
    );
    const flow = this.flow;
    const wobble =
      p.curveV * DEG * (1 + (gnarl - 1) * (profile.twigGnarl ?? 1)) * (flow ? 0.45 : 1);
    const trop = this.stemTropism(p, r0);
    const kinkMax = flow ? 0 : (p.kink ?? 15) * DEG * (isTrunk ? 1 : (profile.kinkScale ?? 1));
    const outward = isTrunk ? 0 : (profile.outwardBias ?? 0);
    const sag = isTrunk ? 0 : this.stemSag(profile, length, r0);
    const tipRatioBase = isTrunk
      ? (profile.trunkTipRatio ?? 0.3)
      : (p.tipRatio ?? (p.fork > 0 ? 0.35 : 0.22));
    const tipRatio = isTrunk
      ? tipRatioBase
      : Math.max(0.12, tipRatioBase * (pruneFactor < 1 ? Math.pow(pruneFactor, 0.35) : 1));

    const stem: Stem = { level, px: [ox], py: [oy], pz: [oz], r: [r0], length, clipped: false };
    let x = ox,
      y = oy,
      z = oz,
      r = r0;
    let kx = 0,
      ky = 0,
      kz = 0;
    let tPrev = 0,
      pi = 0;
    const children: {
      ox: number;
      oy: number;
      oz: number;
      dx: number;
      dy: number;
      dz: number;
      len: number;
      r: number;
    }[] = [];
    plan.sort((a, b) => a.t - b.t);

    for (let k = 0; k < ts.length; k++) {
      const t = ts[k];
      const dt = t - tPrev;
      if (t > breakT + 1e-9) {
        stem.length = length * tPrev;
        break;
      }
      if (dt >= 1e-5) {
        const step = dt * length;
        const hl = Math.sqrt(dx * dx + dz * dz);
        const bend =
          p.curveBack === undefined
            ? p.curve
            : 2 * (tPrev + dt * 0.5 < 0.5 ? p.curve : p.curveBack);
        if (hl > 1e-4 && bend !== 0) {
          const el = Math.atan2(dy, hl) + bend * DEG * dt * (this.flow ? 1.5 : 1);
          const ce = Math.cos(el);
          dx = (dx / hl) * ce;
          dz = (dz / hl) * ce;
          dy = Math.sin(el);
        }
        if (sag > 0) {
          this.applySag(dx, dy, dz, sag * dt);
          dx = this.tmp[0];
          dy = this.tmp[1];
          dz = this.tmp[2];
        }
        if (wobble > 0) {
          this.perturb(dx, dy, dz, wobble * Math.sqrt(dt * res), prng);
          dx = this.tmp[0];
          dy = this.tmp[1];
          dz = this.tmp[2];
        }
        dy += trop * dt;
        const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        dx /= dl;
        dy /= dl;
        dz /= dl;

        let sdx = dx,
          sdy = dy,
          sdz = dz;
        if (kx !== 0 || ky !== 0 || kz !== 0) {
          sdx += kx;
          sdy += ky;
          sdz += kz;
          const sl0 = Math.sqrt(sdx * sdx + sdy * sdy + sdz * sdz) || 1;
          sdx /= sl0;
          sdy /= sl0;
          sdz /= sl0;
          kx = 0;
          ky = 0;
          kz = 0;
        }
        const nx = x + sdx * step,
          ny = y + sdy * step,
          nz = z + sdz * step;
        if (
          (!isTrunk || this.clipLeaders) &&
          this.envelope.isOutside(nx, ny, nz, bypassRadial)
        ) {
          let lo = 0,
            hi = 1;
          for (let b = 0; b < 4; b++) {
            const m = (lo + hi) * 0.5;
            if (
              !this.envelope.isOutside(
                x + sdx * step * m,
                y + sdy * step * m,
                z + sdz * step * m,
                bypassRadial
              )
            ) {
              lo = m;
            } else {
              hi = m;
            }
          }
          stem.clipped = true;
          if (lo > 0.05) {
            x += sdx * step * lo;
            y = Math.max(0.01, y + sdy * step * lo);
            z += sdz * step * lo;
            stem.px.push(x);
            stem.py.push(y);
            stem.pz.push(z);
            stem.r.push(Math.max(MIN_RADIUS_RATIO * 0.6, Math.min(r * 0.5, r0 * 0.1)));
          }
          stem.length = length * (tPrev + dt * lo);
          break;
        }
        x = nx;
        y = Math.max(0.01, ny);
        z = nz;
        r = Math.max(MIN_RADIUS_RATIO * 0.6, Math.min(r, r0 * (1 - t * (1 - tipRatio))));
        stem.px.push(x);
        stem.py.push(y);
        stem.pz.push(z);
        stem.r.push(r);
        tPrev = t;
      }

      while (pi < plan.length && plan[pi].t <= t + 1e-9) {
        const c = plan[pi++];
        let ax: number, ay: number, az: number;
        if (Math.abs(dy) < 0.9) {
          ax = -dz;
          ay = 0;
          az = dx;
        } else {
          ax = 0;
          ay = dz;
          az = -dy;
        }
        const al = Math.hypot(ax, ay, az) || 1;
        ax /= al;
        ay /= al;
        az /= al;
        const bx = dy * az - dz * ay,
          by = dz * ax - dx * az,
          bz = dx * ay - dy * ax;
        let azc = c.az,
          down = c.down;
        if (outward > 0) {
          const rh = Math.hypot(x, z);
          if (rh > 1e-4) {
            const ua = (ax * x + az * z) / rh,
              ub = (bx * x + bz * z) / rh;
            if (Math.hypot(ua, ub) > 0.2) {
              const azU = Math.atan2(ub, ua);
              let d = (c.az - azU) % (2 * Math.PI);
              if (d > Math.PI) d -= 2 * Math.PI;
              else if (d < -Math.PI) d += 2 * Math.PI;
              azc = azU + d * (1 - outward);
            }
          }
          down = Math.min(down, OUTWARD_MAX_DOWN);
        }
        const ca = Math.cos(azc),
          sa = Math.sin(azc);
        const sx = ax * ca + bx * sa,
          sy = ay * ca + by * sa,
          sz = az * ca + bz * sa;
        const cd = Math.cos(down),
          sd = Math.sin(down);
        const cx = dx * cd + sx * sd,
          cy = dy * cd + sy * sd,
          cz = dz * cd + sz * sd;

        if (c.reach) {
          const curveUp = (cp?.curve ?? 0) * DEG;
          let mx = x,
            my = y,
            mz = z,
            ddx = cx,
            ddy = cy,
            ddz = cz,
            dist = 0;
          const stepL = 0.01;
          for (let it = 0; it < 300; it++) {
            const nx2 = mx + ddx * stepL,
              ny2 = my + ddy * stepL,
              nz2 = mz + ddz * stepL;
            if (!this.envelope.inside(nx2, ny2, nz2) || ny2 < 0.02) break;
            mx = nx2;
            my = ny2;
            mz = nz2;
            dist += stepL;
            const hl2 = Math.hypot(ddx, ddz);
            if (hl2 > 1e-4) {
              const el =
                Math.atan2(ddy, hl2) + (curveUp * stepL) / Math.max(0.05, c.len);
              const ce = Math.cos(el);
              ddx = (ddx / hl2) * ce;
              ddz = (ddz / hl2) * ce;
              ddy = Math.sin(el);
            }
          }
          c.len = Math.max(0.02, dist * (0.85 + prng.next() * 0.1));
        }
        const rc = Math.max(
          MIN_RADIUS_RATIO,
          Math.min(
            r * 0.85,
            r *
              Math.pow(c.len / Math.max(1e-6, length), profile.ratioPower) *
              (this.flow ? 1.15 : 1.6)
          )
        );
        children.push({ ox: x, oy: y, oz: z, dx: cx, dy: cy, dz: cz, len: c.len, r: rc });

        const kink =
          kinkMax * Math.min(1, rc / Math.max(1e-6, r)) * (0.6 + prng.next() * 0.4);
        kx -= sx * Math.tan(kink);
        ky -= sy * Math.tan(kink);
        kz -= sz * Math.tan(kink);
        const rLinear = r0 * (1 - t * (1 - tipRatio));
        r = Math.max(
          MIN_RADIUS_RATIO * 0.6,
          rLinear * 0.75,
          Math.sqrt(Math.max(0, r * r - 0.7 * rc * rc))
        );
        stem.r[stem.r.length - 1] = Math.max(stem.r[stem.r.length - 1], r);
      }
    }

    if (stem.px.length < 2) return;
    out.push(stem);

    for (const c of children) {
      this.growBranch(
        level + 1,
        c.ox,
        c.oy,
        c.oz,
        c.dx,
        c.dy,
        c.dz,
        c.len,
        c.r,
        profile,
        prng,
        out
      );
    }

    if (stem.clipped) return;
    const m = stem.px.length - 1;
    const tipR = stem.r[m];
    const tdx = stem.px[m] - stem.px[m - 1],
      tdy = stem.py[m] - stem.py[m - 1],
      tdz = stem.pz[m] - stem.pz[m - 1];
    const tl = Math.hypot(tdx, tdy, tdz) || 1;

    if (isTrunk) {
      if (profile.trunkFork && cp) {
        const forkAngle = (profile.trunkForkAngle ?? 20) * DEG;
        const forkLen =
          (1 - profile.trunkHeightRatio) *
          profile.crownSpreadRatio *
          (0.8 + prng.next() * 0.3);
        const az0 = prng.range(0, Math.PI * 2);
        const numForks = profile.trunkForkCount ?? 2;
        for (let s = 0; s < numForks; s++) {
          this.splitDir(
            tdx / tl,
            tdy / tl,
            tdz / tl,
            az0 + (s * 2 * Math.PI) / numForks,
            forkAngle * (0.8 + prng.next() * 0.4)
          );
          const [fx, fy, fz] = this.tmp;
          this.growBranch(
            level + 1,
            stem.px[m],
            stem.py[m],
            stem.pz[m],
            fx,
            fy,
            fz,
            forkLen,
            Math.max(MIN_RADIUS_RATIO, tipR * Math.pow(numForks, -0.5)),
            profile,
            prng,
            out
          );
        }
      }
      return;
    }

    if (p.fork > 0 && cp) {
      const forkLen = length * cp.lengthRatio * 1.3;
      const az0 = prng.range(0, Math.PI * 2);
      for (let s = 0; s < 2; s++) {
        this.splitDir(
          tdx / tl,
          tdy / tl,
          tdz / tl,
          az0 + s * Math.PI,
          p.fork * DEG * (0.8 + prng.next() * 0.4)
        );
        const [fx, fy, fz] = this.tmp;
        this.growBranch(
          level + 1,
          stem.px[m],
          stem.py[m],
          stem.pz[m],
          fx,
          fy,
          fz,
          forkLen * (0.85 + prng.next() * 0.3),
          Math.max(MIN_RADIUS_RATIO, tipR * Math.SQRT1_2),
          profile,
          prng,
          out
        );
      }
    } else if (
      !this.flow &&
      level === deepest &&
      profile.tipSpurs !== false &&
      length > 0.01 &&
      prng.next() < 0.5
    ) {
      const az0 = prng.range(0, Math.PI * 2);
      for (let s = 0; s < 2; s++) {
        this.splitDir(
          tdx / tl,
          tdy / tl,
          tdz / tl,
          az0 + s * Math.PI,
          (22 + prng.next() * 12) * DEG
        );
        const [fx, fy, fz] = this.tmp;
        const sl = length * (0.12 + prng.next() * 0.08);
        out.push({
          level: level + 1,
          px: [stem.px[m], stem.px[m] + fx * sl],
          py: [stem.py[m], stem.py[m] + fy * sl],
          pz: [stem.pz[m], stem.pz[m] + fz * sl],
          r: [Math.max(MIN_RADIUS_RATIO * 0.6, tipR), MIN_RADIUS_RATIO * 0.5],
          length: sl,
          clipped: false,
        });
      }
    }
  }


  private stemSag(profile: SpeciesProfile, length: number, r0: number): number {
    const k = profile.pliancy ?? 0;
    if (k <= 0) return 0;
    return (
      k *
      DEG *
      Math.min(
        SAG_MAX_SLENDERNESS,
        length / Math.max(MIN_RADIUS_RATIO, r0) / SAG_REF_SLENDERNESS
      )
    );
  }

  private applySag(dx: number, dy: number, dz: number, angle: number) {
    const hl = Math.hypot(dx, dz);
    if (hl < 1e-4) {
      this.tmp[0] = dx;
      this.tmp[1] = dy;
      this.tmp[2] = dz;
      return;
    }
    const el0 = Math.atan2(dy, hl);
    const el = Math.max(-Math.PI / 2 + 0.02, el0 - angle * Math.cos(el0));
    const ce = Math.cos(el);
    this.tmp[0] = (dx / hl) * ce;
    this.tmp[1] = Math.sin(el);
    this.tmp[2] = (dz / hl) * ce;
  }

  private stemTropism(p: BranchLevelParams, r0: number): number {
    const gnarl = Math.min(
      GNARL_MAX,
      Math.max(1, Math.sqrt(GNARL_REF_RADIUS / Math.max(1e-6, r0)))
    );
    return p.tropism * (p.tropism < 0 ? 1 : gnarl);
  }

  private pruneFraction(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    length: number,
    p: BranchLevelParams,
    trop: number,
    sag = 0,
    bypassRadial = false
  ): number {
    const n = Math.max(8, p.curveRes * 3);
    const dt = 1 / n,
      curveK = DEG * dt * (this.flow ? 1.5 : 1);
    let x = ox,
      y = oy,
      z = oz;
    for (let k = 0; k < n; k++) {
      const curve =
        (p.curveBack === undefined
          ? p.curve
          : 2 * ((k + 0.5) * dt < 0.5 ? p.curve : p.curveBack)) * curveK;
      const hl = Math.sqrt(dx * dx + dz * dz);
      if (hl > 1e-4 && curve !== 0) {
        const el = Math.atan2(dy, hl) + curve,
          ce = Math.cos(el);
        dx = (dx / hl) * ce;
        dz = (dz / hl) * ce;
        dy = Math.sin(el);
      }
      if (sag > 0) {
        this.applySag(dx, dy, dz, sag * dt);
        dx = this.tmp[0];
        dy = this.tmp[1];
        dz = this.tmp[2];
      }
      dy += trop * dt;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= dl;
      dy /= dl;
      dz /= dl;
      const step = dt * length;
      if (this.envelope.isOutside(x + dx * step, y + dy * step, z + dz * step, bypassRadial)) {
        let lo = 0,
          hi = 1;
        for (let b = 0; b < 5; b++) {
          const m = (lo + hi) * 0.5;
          if (
            !this.envelope.isOutside(
              x + dx * step * m,
              y + dy * step * m,
              z + dz * step * m,
              bypassRadial
            )
          ) {
            lo = m;
          } else {
            hi = m;
          }
        }
        return (k + lo) * dt;
      }
      x += dx * step;
      y += dy * step;
      z += dz * step;
    }
    return 1;
  }

  private perturb(dx: number, dy: number, dz: number, amp: number, prng: FastPrng) {
    let ax: number, ay: number, az: number;
    if (Math.abs(dy) < 0.9) {
      ax = -dz;
      ay = 0;
      az = dx;
    } else {
      ax = 0;
      ay = dz;
      az = -dy;
    }
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al;
    ay /= al;
    az /= al;
    const bx = dy * az - dz * ay,
      by = dz * ax - dx * az,
      bz = dx * ay - dy * ax;
    const phi = prng.next() * Math.PI * 2;
    const amt = Math.tan(prng.signedRange(amp));
    const c = Math.cos(phi) * amt,
      s = Math.sin(phi) * amt;
    this.tmp[0] = dx + ax * c + bx * s;
    this.tmp[1] = dy + ay * c + by * s;
    this.tmp[2] = dz + az * c + bz * s;
  }

  splitDir(dx: number, dy: number, dz: number, az: number, angle: number) {
    let ax: number, ay: number, a2: number;
    if (Math.abs(dy) < 0.9) {
      ax = -dz;
      ay = 0;
      a2 = dx;
    } else {
      ax = 0;
      ay = dz;
      a2 = -dy;
    }
    const al = Math.hypot(ax, ay, a2) || 1;
    ax /= al;
    ay /= al;
    a2 /= al;
    const bx = dy * a2 - dz * ay,
      by = dz * ax - dx * a2,
      bz = dx * ay - dy * ax;
    const ca = Math.cos(az),
      sa = Math.sin(az),
      cd = Math.cos(angle),
      sd = Math.sin(angle);
    const x = dx * cd + (ax * ca + bx * sa) * sd;
    const y = dy * cd + (ay * ca + by * sa) * sd;
    const z = dz * cd + (a2 * ca + bz * sa) * sd;
    const l = Math.hypot(x, y, z) || 1;
    this.tmp[0] = x / l;
    this.tmp[1] = y / l;
    this.tmp[2] = z / l;
  }

  private shuffledSlots(count: number, prng: FastPrng): number[] {
    const a: number[] = [];
    for (let i = 0; i < count; i++) a.push(i);
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(prng.next() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  private levelRefLength(profile: SpeciesProfile, level: number): number {
    if (level === 0) return profile.trunkLengthRatio;
    let len = profile.crownSpreadRatio;
    for (let l = 2; l <= level; l++) len *= profile.levels[l - 1].lengthRatio;
    return len;
  }
}


export function growBotanicalTree(
  profile: SpeciesProfile,
  prng: FastPrng,
  form: TrunkForm = 'SINGLE',
  flow = false,
  asymAz = 0
): Stem[] {
  const ctx = new GrowthContext(profile, flow, asymAz);
  return ctx.grow(profile, prng, form);
}
