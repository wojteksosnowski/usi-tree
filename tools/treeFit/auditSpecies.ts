/**
 * Audyt zgodności drzew aplikacji ze zdjęciami wzorców w `reference/design/drzewa/`:
 * dla każdego zdjęcia z wysokością — miary sylwetki (`silhouetteMetrics`) zdjęcia i modelu aplikacji
 * (`treeKindParams` dla tej wysokości, średnia z kilku ziaren) oraz pokrycie katalogów wzorcami i profilami.
 *
 *   NODE_NO_WARNINGS=1 npx tsx scripts/treeFit/auditSpecies.ts [gatunek…]
 *
 * Model mierzony jak zdjęcie: render elewacji z liśćmi (`renderSingleTree`, ziarno planszy) i ta sama maska
 * (`photoSilhouette`) — sam szkielet zaniżałby koronę względem zdjęć z liśćmi.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderSingleTree } from './renderSingleTree';
import { modelProfile } from './renderSpeciesBoard';
import { silhouetteMetrics, type SilhouetteMetrics } from './silhouetteMetrics';
import { DRZEWA_DIR, SPECIES, photoSilhouette, speciesPhotos, type SpeciesRef } from './speciesRefs';

const SEED = 108;
/** Kadr renderu modelu: 2400 px ≈ 1,9 × wysokość drzewa — szerokie korony nie są przycinane */
const AUDIT_WIDTH_PX = 2400;
/** Progi rozbieżności: względna W/H, nasada korony i najszersze miejsce (ułamek wysokości) */
const LIMITS = { aspectRel: 0.15, crownBase: 0.1, widestAt: 0.2 };
const MIN_PHOTO_CROWN_BASE = 0.03;

type Outline = Pick<SilhouetteMetrics, 'aspect' | 'crownBase' | 'widestAt' | 'trunk'>;

async function modelOutline(sp: SpeciesRef, h: number, tmp: string): Promise<Outline> {
  const m = modelProfile(sp, h);
  const outPrefix = path.join(tmp, `${sp.key}_${h}m`);
  await renderSingleTree({ profile: { ...m.profile, form: m.form }, species: m.species, height: h, outPrefix, seed: SEED, bare: true, widthPx: AUDIT_WIDTH_PX, leafColors: [0x7eae2e, 0x5c8e22, 0x3d6816], barkColor: 0x4a4742 });
  const s = await photoSilhouette(`${outPrefix}.png`);
  return silhouetteMetrics(s.mask, s.W, s.H)!;
}

function flags(photo: Outline, model: Outline): string[] {
  const out: string[] = [];
  const rel = model.aspect / photo.aspect - 1;
  if (Math.abs(rel) > LIMITS.aspectRel) out.push(`korona ${rel > 0 ? 'za szeroka' : 'za wąska'} ${(rel * 100).toFixed(0)}%`);
  // Nasada < 3% H na zdjęciu: trawa / cień u podstawy poszerza dolny wiersz — miara nieoznaczona
  const cb = model.crownBase - photo.crownBase;
  if (photo.crownBase >= MIN_PHOTO_CROWN_BASE && Math.abs(cb) > LIMITS.crownBase) out.push(`nasada korony ${cb > 0 ? 'za wysoko' : 'za nisko'} ${(cb * 100).toFixed(0)}% H`);
  const wa = model.widestAt - photo.widestAt;
  if (Math.abs(wa) > LIMITS.widestAt) out.push(`najszerzej ${wa > 0 ? 'za wysoko' : 'za nisko'} ${(wa * 100).toFixed(0)}% H`);
  return out;
}

const pct = (v: number) => `${(v * 100).toFixed(0).padStart(3)}%`;

async function main() {
  const only = process.argv.slice(2);
  const species = only.length ? SPECIES.filter((s) => only.includes(s.key)) : SPECIES;
  let total = 0, flagged = 0;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'treefit-audit-'));
  for (const sp of species) {
    const photos = speciesPhotos(sp);
    console.log(`\n=== ${sp.label} → rodzaj aplikacji ${sp.kind} | profile strojone: ${Object.keys(sp.profiles ?? {}).join('/') || 'brak'}`);
    if (!photos.length) {
      console.log('  brak zdjęć z wysokością');
      continue;
    }
    console.log('  zdjęcie                                              h  |  W/H zdj/mod | nasada zdj/mod | najszerzej zdj/mod | uwagi');
    const cache = new Map<number, Outline>();
    for (const ph of photos) {
      const s = await photoSilhouette(ph.path);
      const m = silhouetteMetrics(s.mask, s.W, s.H);
      if (!m) {
        console.log(`  ${ph.file}: brak sylwetki`);
        continue;
      }
      if (!cache.has(ph.height)) cache.set(ph.height, await modelOutline(sp, ph.height, tmp));
      const mod = cache.get(ph.height)!;
      const f = flags(m, mod);
      total++;
      if (f.length) flagged++;
      console.log(
        `  ${ph.file.slice(0, 50).padEnd(50)} ${String(ph.height).padStart(3)} | ${m.aspect.toFixed(2)} / ${mod.aspect.toFixed(2)} | ${pct(m.crownBase)} / ${pct(mod.crownBase)} | ${pct(m.widestAt)} / ${pct(mod.widestAt)} | ${f.join('; ') || 'OK'}`
      );
    }
  }
  // Katalogi gatunków bez zdjęć lub poza audytem
  const audited = new Set(SPECIES.map((s) => s.dir));
  const rest = fs.readdirSync(DRZEWA_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_') && !audited.has(d.name));
  console.log(`\nKatalogi bez zdjęć pokroju (poza audytem): ${rest.map((d) => d.name).join(', ')}`);
  console.log(`Zdjęcia: ${total}, z rozbieżnością ponad progi: ${flagged}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
