// Wspólna ocena profilu względem wzorca: średnia odległość miar sylwetki po kilku ziarnach.
import type { SpeciesProfile, TreeSpecies, TrunkForm } from '../../src/index.js';
import { silhouetteMetrics, metricsDistance, type SilhouetteMetrics } from './silhouetteMetrics';
import { rasterize } from './rasterize';

/** Ziarna oceny; TREEFIT_SEEDS=101,202,… liczy na innych (kontrola przeuczenia — dopasowanie używa domyślnych) */
export const SEEDS = process.env.TREEFIT_SEEDS ? process.env.TREEFIT_SEEDS.split(',').map(Number) : [11, 23, 37];

export function evalProfile(profile: SpeciesProfile, species: TreeSpecies, target: SilhouetteMetrics, form: TrunkForm, targetH: number): number {
  let sum = 0;
  for (const seed of SEEDS) {
    const { mask, W, H } = rasterize(profile, species, seed, form, targetH);
    const m = silhouetteMetrics(mask, W, H);
    sum += m ? metricsDistance(m, target) : 99;
  }
  return sum / SEEDS.length;
}
