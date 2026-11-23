/** Regeneruje modele asercyjne (12 m, ziarno 1111) dla wszystkich rodzajów: NODE_NO_WARNINGS=1 npx tsx scripts/buildAssertionModels.ts */
import { allKinds, loadFitted, writeAssertionModel } from './assertionStore';

const fitted = loadFitted();
for (const kind of allKinds(fitted)) {
  const s = writeAssertionModel(kind, fitted);
  console.log(`${kind}\t${s.hash}\tv=${s.counts.vertices}\tbark=${s.counts.barkTriangles}\tleaf=${s.counts.leafTriangles}`);
}
