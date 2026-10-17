// Szybka ocena dopasowanych profili (bez ponownego dopasowania) — pętla iteracyjna silnika drzew.
// Uruchomienie:
//   npx tsx scripts/treeFit/evalProfiles.ts                       → tabela odległości dla wszystkich wzorców
//   npx tsx scripts/treeFit/evalProfiles.ts Elm scaffoldLimbs=4   → jeden wzorzec, z nadpisaniem pól profilu
//   ... --write                                                   → zapis nadpisań do fittedProfiles.json
// form=SINGLE|FORKED|MULTI zmienia pokrój pnia.
// Klucze nadpisań: pola SpeciesProfile (np. trunkHeightRatio=0.3) albo rzędu (levels.0.count=8); wartość JSON.
import fs from 'node:fs';
import { evalProfile } from './evaluate';

const FITTED = '../../src/core/fittedProfiles.json';
const fitted = JSON.parse(fs.readFileSync(FITTED, 'utf8'));
const ref = JSON.parse(fs.readFileSync('scripts/treeFit/referenceMetrics.json', 'utf8'));

const args = process.argv.slice(2);
const write = args.includes('--write');
const only = args.find((a) => !a.includes('=') && !a.startsWith('--'));
const overrides = args.filter((a) => a.includes('=')).map((a) => {
  const [k, v] = a.split('=');
  return { path: k.split('.'), value: v === 'undefined' ? undefined : JSON.parse(v) };
});

for (const f of fitted) {
  if (only && f.ref !== only && f.pl !== only) continue;
  const box = ref.find((r: any) => r.name === f.ref).box;
  const h = box[3] - box[1] + 1;
  const before = evalProfile(f.profile, f.startSpecies, f.target, f.form, h);
  const profile = structuredClone(f.profile);
  let form = f.form;
  for (const o of overrides) {
    if (o.path[0] === 'form') { form = o.value; continue; }
    let obj = profile;
    for (const k of o.path.slice(0, -1)) obj = obj[k];
    obj[o.path[o.path.length - 1]] = o.value;
  }
  const after = overrides.length ? evalProfile(profile, f.startSpecies, f.target, form, h) : before;
  console.log(`${f.pl.padEnd(18)} ${before.toFixed(3)}${overrides.length ? ` → ${after.toFixed(3)} ${after < before ? '✓' : '✗'}` : ''}`);
  if (write && overrides.length) { f.profile = profile; f.form = form; f.distFitted = +after.toFixed(3); }
}
if (write) fs.writeFileSync(FITTED, JSON.stringify(fitted, null, 1));
