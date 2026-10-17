// Kreska stylu B: grubość pnia, konarów i gałęzi / wysokość drzewa — wzorzec stylu (plansza rysunków) wobec generatora.
// Uruchomienie: npx tsx scripts/treeFit/strokeCompare.ts <SA_Artboard2.webp> [out.json] [--fit]
// --fit: kalibracja mnożników rzędów kreski (pień, konary, gałęzie) tak, by mediany zgadzały się ze wzorcem
// Wzorzec dekodowany w przeglądarce (WebP), kora i tło z barw planszy. Nasze: dopasowane gatunki × ziarna oceny,
// bez kreski (sam szkielet) i z `ILLUSTRATION_STROKE`.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { ILLUSTRATION_STROKE, type TreeStroke } from '../../src/index.js';
import { SEEDS } from './evaluate';
import { measureBoard, measureGenerated, STROKE_KEYS, type StrokeMetrics } from './strokeMetrics';

const args = process.argv.slice(2);
const fitMode = args.includes('--fit');
const [refPath, outPath] = args.filter((a) => !a.startsWith('--'));
const fitted = JSON.parse(fs.readFileSync('../../src/core/fittedProfiles.json', 'utf8'));

async function decode(path: string) {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless: true });
  const page = await browser.newPage();
  const mime = path.endsWith('.webp') ? 'image/webp' : path.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const r = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let s = ''; for (let i = 0; i < d.length; i += 4) s += String.fromCharCode(d[i], d[i + 1], d[i + 2]);
    return { W: c.width, H: c.height, rgb: btoa(s) };
  }, `data:${mime};base64,${fs.readFileSync(path).toString('base64')}`);
  await browser.close();
  return { W: r.W, H: r.H, rgb: new Uint8Array(Buffer.from(r.rgb, 'base64')) };
}

/** Tło: średnia jasnych pikseli; kora: 60. percentyl „różowości” wśród wyraźnie różowych pikseli */
function boardColors(rgb: Uint8Array, W: number, H: number) {
  const bg = [0, 0, 0]; let n = 0;
  const pink: [number, number, number][] = [];
  for (let i = 0; i < W * H; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    if (r + g + b > 680) { bg[0] += r; bg[1] += g; bg[2] += b; n++; }
    if (r - g > 18 && r - b > 30) pink.push([r, g, b]);
  }
  pink.sort((a, b) => (a[0] - a[1]) - (b[0] - b[1]));
  return { bg: bg.map((v) => v / n) as [number, number, number], bark: pink[Math.floor(pink.length * 0.6)] };
}

const median = (a: number[]) => { const b = [...a].sort((p, q) => p - q); return b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
const pct = (v: number) => (v * 100).toFixed(2).padStart(7);
const row = (name: string, m: Record<string, number>) => `${name.padEnd(20)}${STROKE_KEYS.map((k) => pct(m[k])).join('')}`;
const medianOf = (rows: StrokeMetrics[]) => Object.fromEntries(STROKE_KEYS.map((k) => [k, median(rows.map((r) => r[k]))]));

function ours(stroke: TreeStroke | undefined) {
  return fitted.map((f: any) => {
    const per = SEEDS.map((seed) => measureGenerated(f.profile, f.startSpecies, seed, f.form, stroke));
    return { pl: f.pl, form: f.form, m: medianOf(per) };
  });
}

async function main() {
  const { W, H, rgb } = await decode(refPath);
  const colors = boardColors(rgb, W, H);
  const ref = measureBoard(rgb, W, H, colors);
  const head = `${''.padEnd(20)}${['pień 5%', 'pień 15%', 'pień 25%', 'konary', 'gałęzie'].map((s) => s.padStart(7)).join('')}   (% wysokości drzewa)`;
  console.log(`Wzorzec: ${ref.length} drzew, tło ${colors.bg.map(Math.round)}, kora ${colors.bark}`);
  console.log(head);
  ref.forEach((m, i) => console.log(row(`wzorzec ${i + 1} (${m.stems} pn.)`, m as any)));
  const refMed = medianOf(ref);
  console.log(row('wzorzec — mediana', refMed));
  const before = ours(undefined), after = ours(ILLUSTRATION_STROKE);
  console.log('\nNasze z ILLUSTRATION_STROKE (mediana 3 ziaren):');
  for (const o of after) console.log(row(`${o.pl} (${o.form})`, o.m));
  const med = (list: any[]) => Object.fromEntries(STROKE_KEYS.map((k) => [k, median(list.map((o) => o.m[k]))]));
  console.log(row('nasze — mediana', med(after)));
  console.log(row('bez kreski — mediana', med(before)));
  let fittedStroke: TreeStroke | undefined;
  if (fitMode) {
    // Mnożnik rzędu ← iloraz median wzorzec / nasze dla miary, którą ten rząd wyznacza (pień: średnia z 3 wysokości)
    let st: TreeStroke = { ...ILLUSTRATION_STROKE, levelScale: [...ILLUSTRATION_STROKE.levelScale] };
    for (let it = 0; it < 7; it++) {
      const m = med(ours(st));
      const trunk = (refMed.trunkBase / m.trunkBase + refMed.trunk15 / m.trunk15 + refMed.trunk25 / m.trunk25) / 3;
      const ls = [...st.levelScale];
      // Tłumienie (pierwiastek): miary nie są rozdzielne — przewodnik w koronie wpływa na konary
      ls[0] *= Math.sqrt(trunk); ls[1] *= Math.sqrt(refMed.limb / m.limb); ls[2] *= Math.sqrt(refMed.branch / m.branch);
      st = { ...st, levelScale: ls.map((v) => +v.toFixed(2)) };
      console.log(`kalibracja ${it + 1}: levelScale [${st.levelScale.join(', ')}]  ${STROKE_KEYS.map((k) => `${k} ${(m[k] * 100).toFixed(2)}`).join(' ')}`);
    }
    fittedStroke = st;
    const fin = ours(st);
    console.log('\nNasze po kalibracji:');
    for (const o of fin) console.log(row(`${o.pl} (${o.form})`, o.m));
    console.log(row('nasze — mediana', med(fin)));
    console.log(row('wzorzec — mediana', refMed));
  }
  if (outPath) fs.writeFileSync(outPath, JSON.stringify({ ref, refMed, before, after, oursMed: med(after), bareMed: med(before), fittedStroke }, null, 1));
}

main();
