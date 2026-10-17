/**
 * Miary struktury szkieletu („wskaźnik granatu”): to, czego sylwetka nie widzi — chaos wewnątrz korony.
 * Liczone na szkielecie w skali nominalnej (wysokość ≈ 1), bez rastra.
 */
import type { TreeSkeleton } from '../core/types.js';

export interface StructureMetrics {
  clipped: number;  // udział gałęzi uciętych na obwiedni korony
  stubs: number;    // udział gałęzi kończących się grubo (koniec ≥ 45% promienia nasady i ≥ 2× najcieńsza witka) — kikuty
  inward: number;   // udział gałęzi rzędu ≥ 2 skierowanych do osi drzewa (poziomo, cos < −0,3)
  turn: number;     // średnia zmiana kierunku w węźle gałęzi (stopnie) — kręcenie i zygzak
  grenade: number;  // łączny wskaźnik (0 = porządek)
}

const MIN_R = 0.0009;

export function structureMetrics(sk: TreeSkeleton): StructureMetrics {
  let n = 0, clipped = 0, stubs = 0, inwardN = 0, inward = 0, turnSum = 0, turnN = 0;
  for (const s of sk.stems) {
    if (s.level === 0 || s.px.length < 2) continue;
    n++;
    if (s.clipped) clipped++;
    const m = s.r.length - 1;
    if (s.r[m] >= 0.45 * s.r[0] && s.r[m] >= 2 * MIN_R) stubs++;
    if (s.level >= 2) {
      const rh = Math.hypot(s.px[0], s.pz[0]);
      const dx = s.px[1] - s.px[0], dz = s.pz[1] - s.pz[0], hl = Math.hypot(dx, dz);
      if (rh > 1e-3 && hl > 1e-6) {
        inwardN++;
        if ((dx * s.px[0] + dz * s.pz[0]) / (rh * hl) < -0.3) inward++;
      }
    }
    for (let i = 1; i + 1 < s.px.length; i++) {
      const ax = s.px[i] - s.px[i - 1], ay = s.py[i] - s.py[i - 1], az = s.pz[i] - s.pz[i - 1];
      const bx = s.px[i + 1] - s.px[i], by = s.py[i + 1] - s.py[i], bz = s.pz[i + 1] - s.pz[i];
      const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
      if (la < 1e-6 || lb < 1e-6) continue;
      turnSum += Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (la * lb)))) * 180 / Math.PI;
      turnN++;
    }
  }
  const c = n ? clipped / n : 0, st = n ? stubs / n : 0, inw = inwardN ? inward / inwardN : 0, turn = turnN ? turnSum / turnN : 0;
  return { clipped: c, stubs: st, inward: inw, turn, grenade: c + 2 * st + inw + turn / 30 };
}
