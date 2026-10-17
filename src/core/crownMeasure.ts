/**
 * Promień korony drzewa wyliczany przez generator: szkielet rodzaju dla klasy wysokości (`heightClassM`,
 * te same klasy co warianty w widoku 3D) i największy poziomy zasięg gałęzi od osi pnia.
 * Proporcja promień/wysokość jest zapamiętywana per rodzaj × klasa wysokości (kilka ms na wpis),
 * promień drzewa = proporcja × jego wysokość.
 */
import { TreeGenerator, SPECIES_PROFILES, type TreeSkeleton } from './TreeGenerator.js';
import { heightClassM } from './heightProfile.js';
import { treeKindParams, type TreeKind } from './treeSpeciesRegistry.js';

/**
 * Zasięg korony szkieletu [m]: największa pozioma odległość punktu gałęzi od osi pnia.
 * Ta sama miara dla rozmieszczania drzew i skalowania wariantu w widoku 3D — rysowana korona
 * ma dokładnie promień przyjęty przy rozmieszczaniu.
 */
export function skeletonCrownReach(sk: TreeSkeleton): number {
  let maxR2 = 0;
  for (const s of sk.stems) {
    for (let i = 0; i < s.px.length; i++) {
      const r2 = s.px[i] * s.px[i] + s.pz[i] * s.pz[i];
      if (r2 > maxR2) maxR2 = r2;
    }
  }
  return Math.sqrt(maxR2) * sk.scale;
}

/** Ziarno pomiaru — jedno na rodzaj, żeby promień nie zależał od wariantu */
const MEASURE_SEED = 1009;
const cache = new Map<string, number>();

/** Proporcja promienia korony do wysokości dla rodzaju i wysokości */
function crownRatio(kind: TreeKind, height: number): number {
  const h = heightClassM(height);
  const key = `${kind}@${h}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const { species, profile, form } = treeKindParams(kind, h);
  const sk = TreeGenerator.buildSkeleton({ species, profile: profile ?? SPECIES_PROFILES[species], form, height: h, seed: MEASURE_SEED });
  const ratio = skeletonCrownReach(sk) / h;
  cache.set(key, ratio);
  return ratio;
}

/** Promień korony [m] drzewa danego rodzaju i wysokości */
export function crownRadiusOf(kind: TreeKind, height: number): number {
  return crownRatio(kind, height) * height;
}

