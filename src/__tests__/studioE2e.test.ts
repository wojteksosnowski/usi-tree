import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
// @ts-ignore - node types not in tsconfig
import { spawn, type ChildProcess } from 'node:child_process';
// @ts-ignore - node types not in tsconfig
import fs from 'node:fs';
// @ts-ignore - node types not in tsconfig
import path from 'node:path';
import { TreeGenerator } from '../core/TreeGenerator';
import type { SpeciesProfile, CrownShape } from '../core/types';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FITTED_PATH = path.resolve(CURRENT_DIR, '../core/fittedProfiles.json');

interface FittedEntry {
  ref: string;
  startSpecies: string;
  profile: SpeciesProfile;
  heightAnchors?: Array<{ h: number; profile: SpeciesProfile }>;
}

interface GeometrySignature {
  vertexCount: number;
  indexCount: number;
  posChecksum: number;
  height: number;
  crownRadius: number;
}

function loadHorsechestnutEntry(): FittedEntry {
  const raw = JSON.parse(fs.readFileSync(FITTED_PATH, 'utf8')) as FittedEntry[];
  const entry = raw.find((f) => f.ref === 'Horsechestnut');
  if (!entry) {
    throw new Error('Horsechestnut profile not found in src/core/fittedProfiles.json');
  }
  return entry;
}

function computeSignature(raw: ReturnType<typeof TreeGenerator.generateRaw>): GeometrySignature {
  const pos = raw.mesh.positions;
  let checksum = 0;
  for (let i = 0; i < pos.length; i++) {
    checksum += pos[i] * ((i % 7) + 1);
  }
  return {
    vertexCount: pos.length / 3,
    indexCount: raw.mesh.indices.length,
    posChecksum: checksum,
    height: raw.bounds.height,
    crownRadius: raw.bounds.crownRadius,
  };
}

function signaturesDiffer(a: GeometrySignature, b: GeometrySignature): boolean {
  if (a.vertexCount !== b.vertexCount) return true;
  if (a.indexCount !== b.indexCount) return true;
  if (Math.abs(a.posChecksum - b.posChecksum) > 1e-4) return true;
  if (Math.abs(a.height - b.height) > 1e-4) return true;
  if (Math.abs(a.crownRadius - b.crownRadius) > 1e-4) return true;
  return false;
}

function cloneProfile(p: SpeciesProfile): SpeciesProfile {
  return JSON.parse(JSON.stringify(p)) as SpeciesProfile;
}

describe('Tree Studio E2E', () => {
  it('changing each profile and level[0] parameter produces measurably different 3D geometry', () => {
    const entry = loadHorsechestnutEntry();
    const baseProfile = cloneProfile(entry.profile);
    const species = entry.startSpecies as any;

    const baseGeom = TreeGenerator.generateRaw({
      species,
      height: 15,
      seed: 42,
      detail: 'HIGH',
      withFoliageAccents: true,
      profile: baseProfile,
    });
    const baseSig = computeSignature(baseGeom);

    const mutations: Array<{ name: string; mutate: (p: SpeciesProfile) => void }> = [
      {
        name: 'trunkHeightRatio',
        mutate: (p) => {
          p.trunkHeightRatio = p.trunkHeightRatio * 1.4 + 0.05;
        },
      },
      {
        name: 'trunkBaseRadiusRatio',
        mutate: (p) => {
          p.trunkBaseRadiusRatio = p.trunkBaseRadiusRatio * 1.8 + 0.005;
        },
      },
      {
        name: 'trunkLengthRatio',
        mutate: (p) => {
          p.trunkLengthRatio = p.trunkLengthRatio * 0.7;
        },
      },
      {
        name: 'trunkCurveV',
        mutate: (p) => {
          p.trunkCurveV = (p.trunkCurveV ?? 0) + 12;
        },
      },
      {
        name: 'trunkTipRatio',
        mutate: (p) => {
          p.trunkTipRatio = (p.trunkTipRatio ?? 0.1) + 0.25;
        },
      },
      {
        name: 'crownSpreadRatio',
        mutate: (p) => {
          p.crownSpreadRatio = p.crownSpreadRatio * 1.5 + 0.1;
        },
      },
      {
        name: 'crownShape',
        mutate: (p) => {
          const nextShape: CrownShape = p.crownShape === 'CONICAL' ? 'SPHERICAL' : 'CONICAL';
          p.crownShape = nextShape;
        },
      },
      {
        name: 'crownPeak',
        mutate: (p) => {
          p.crownPeak = (p.crownPeak ?? 0.5) > 0.5 ? 0.15 : 0.85;
        },
      },
      {
        name: 'ratioPower',
        mutate: (p) => {
          p.ratioPower = p.ratioPower + 0.6;
        },
      },
      {
        name: 'leafSizeRatio',
        mutate: (p) => {
          p.leafSizeRatio = (p.leafSizeRatio ?? 0.02) * 2.5 + 0.01;
        },
      },
      {
        name: 'leafAspect',
        mutate: (p) => {
          p.leafAspect = (p.leafAspect ?? 1.0) * 1.8 + 0.3;
        },
      },
      {
        name: 'leafDensity',
        mutate: (p) => {
          p.leafDensity = (p.leafDensity ?? 1.0) * 2.0 + 0.5;
        },
      },
      {
        name: 'pliancy',
        mutate: (p) => {
          p.pliancy = (p.pliancy ?? 0) + 0.6;
        },
      },
      {
        name: 'levels[0].count',
        mutate: (p) => {
          p.levels[0].count = p.levels[0].count + 8;
        },
      },
      {
        name: 'levels[0].downAngle',
        mutate: (p) => {
          p.levels[0].downAngle = p.levels[0].downAngle + 20;
        },
      },
      {
        name: 'levels[0].lengthRatio',
        mutate: (p) => {
          p.levels[0].lengthRatio = p.levels[0].lengthRatio * 0.4;
        },
      },
      {
        name: 'levels[0].lengthRatio (increase > 1)',
        mutate: (p) => {
          p.levels[0].lengthRatio = p.levels[0].lengthRatio * 1.4;
        },
      },
      {
        name: 'levels[1].lengthRatio',
        mutate: (p) => {
          if (p.levels[1]) p.levels[1].lengthRatio = p.levels[1].lengthRatio * 0.4;
        },
      },
      {
        name: 'levels[2].lengthRatio',
        mutate: (p) => {
          if (p.levels[2]) p.levels[2].lengthRatio = p.levels[2].lengthRatio * 0.4;
        },
      },
      {
        name: 'levels[0].curve',
        mutate: (p) => {
          p.levels[0].curve = (p.levels[0].curve ?? 0) + 25;
        },
      },
      {
        name: 'levels[0].tropism',
        mutate: (p) => {
          p.levels[0].tropism = (p.levels[0].tropism ?? 0) + 0.5;
        },
      },
      {
        name: 'levels[0].fork',
        mutate: (p) => {
          p.levels[0].fork = (p.levels[0].fork ?? 0) + 25;
        },
      },
    ];

    for (const { name, mutate } of mutations) {
      const mutatedProfile = cloneProfile(baseProfile);
      mutate(mutatedProfile);

      const nextGeom = TreeGenerator.generateRaw({
        species,
        height: 15,
        seed: 42,
        detail: 'HIGH',
        withFoliageAccents: true,
        profile: mutatedProfile,
      });
      const nextSig = computeSignature(nextGeom);

      expect(
        signaturesDiffer(baseSig, nextSig),
        `Expected parameter "${name}" to change generated 3D geometry`
      ).toBe(true);
    }
  }, 30000);

  it('POST /api/save-profile on real tree-studio server persists changes to fittedProfiles.json', async () => {
    const originalContent = fs.readFileSync(FITTED_PATH, 'utf8');
    const ASSERT_DIR = path.resolve(CURRENT_DIR, '../../assertion-models');
    const horseFile = path.join(ASSERT_DIR, 'Horsechestnut.json');
    const synthFile = path.join(ASSERT_DIR, '__E2E_TEST_KIND__.json');
    const horseBackup = fs.existsSync(horseFile) ? fs.readFileSync(horseFile, 'utf8') : null;
    const port = 4199;
    let serverProc: ChildProcess | null = null;

    try {
      serverProc = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/tree-studio.ts'], {
        cwd: path.resolve(CURRENT_DIR, '../..'),
        env: { ...(globalThis as any).process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timed out waiting for tree-studio server to start'));
        }, 15000);

        let stderr = '';
        serverProc!.stderr?.on('data', (chunk: Uint8Array | string) => {
          stderr += chunk.toString();
        });
        serverProc!.stdout?.on('data', (chunk: Uint8Array | string) => {
          const text = chunk.toString();
          if (text.includes('Tree Studio (Dev) uruchomione:')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        serverProc!.on('exit', (code: number | null) => {
          clearTimeout(timeout);
          reject(new Error(`tree-studio exited early with code ${code}: ${stderr}`));
        });
      });

      const entry = loadHorsechestnutEntry();
      const modifiedProfile = cloneProfile(entry.profile);
      const testCrownSpread = Number((modifiedProfile.crownSpreadRatio + 0.1234).toFixed(6));
      modifiedProfile.crownSpreadRatio = testCrownSpread;

      const res = await fetch(`http://127.0.0.1:${port}/api/save-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'Horsechestnut',
          height: 15,
          profile: modifiedProfile,
        }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean };
      expect(json.ok).toBe(true);
      expect((json as any).assertion.hash).toMatch(/^[0-9a-f]{8}$/);
      expect(fs.existsSync(horseFile)).toBe(true);
      const apiRes = await fetch(`http://127.0.0.1:${port}/api/assertion-model?kind=Horsechestnut`);
      const apiModel = (await apiRes.json()) as any;
      expect(apiModel.hash).toBe((json as any).assertion.hash);
      expect(apiModel.vertices.length).toBe(apiModel.counts.vertices * 3);
      const listRes = await fetch(`http://127.0.0.1:${port}/api/assertion-models`);
      expect(((await listRes.json()) as any[]).some((m) => m.kind === 'Horsechestnut')).toBe(true);

      const updatedRaw = JSON.parse(fs.readFileSync(FITTED_PATH, 'utf8')) as FittedEntry[];
      const updatedEntry = updatedRaw.find((f) => f.ref === 'Horsechestnut');
      const anchor = updatedEntry?.heightAnchors?.find((a) => a.h === 15);
      expect(anchor).toBeDefined();
      expect(anchor?.profile.crownSpreadRatio).toBe(testCrownSpread);

      // Syntetyczny rodzaj bez wpisu (nie dotyka prawdziwych wpisów) → serwer tworzy wpis na bazie `startSpecies`
      const SYNTH = '__E2E_TEST_KIND__';
      expect(updatedRaw.some((f) => f.ref === SYNTH)).toBe(false);
      const poplarAnchors = [9, 15].map((h) => ({ h, profile: cloneProfile(entry.profile) }));
      const resPoplar = await fetch(`http://127.0.0.1:${port}/api/save-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: SYNTH, startSpecies: 'POPLAR', anchors: poplarAnchors }),
      });
      expect(((await resPoplar.json()) as any).ok).toBe(true);
      const poplar = (JSON.parse(fs.readFileSync(FITTED_PATH, 'utf8')) as FittedEntry[]).find((f) => f.ref === SYNTH);
      expect(poplar?.startSpecies).toBe('POPLAR');
      expect(poplar?.heightAnchors?.map((a) => a.h)).toEqual([9, 15]);

      // Nieznany rodzaj → 400
      const resBad = await fetch(`http://127.0.0.1:${port}/api/save-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'NOPE', anchors: poplarAnchors }),
      });
      expect(resBad.status).toBe(400);

      // HTML zawiera elementy tła referencyjnego
      const htmlRes = await fetch(`http://127.0.0.1:${port}/`);
      expect(htmlRes.status).toBe(200);
      const html = await htmlRes.text();
      for (const id of ['id="bg-canvas"', 'id="bg-file-input"', 'id="bg-scale-num"', 'id="bg-ox-num"', 'id="bg-oy-num"']) {
        expect(html).toContain(id);
      }

      // POST /api/studio-bg + GET /api/studio-bg zapisują i zwracają byTier oraz byFile
      const bgPayload = {
        byTier: {
          '__E2E_TEST_KIND__:15': {
            fileName: 'e2e-ref.png',
            dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            scale: 1.25,
            offsetX: 0.5,
            offsetY: -0.2,
            opacity: 0.6,
            visible: true,
          },
        },
        byFile: {
          'e2e-ref.png': {
            scale: 1.25,
            offsetX: 0.5,
            offsetY: -0.2,
            opacity: 0.6,
            visible: true,
          },
        },
      };
      const bgPost = await fetch(`http://127.0.0.1:${port}/api/studio-bg`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bgPayload),
      });
      expect(bgPost.status).toBe(200);
      expect(await bgPost.json()).toEqual({ ok: true });

      const bgGet = await fetch(`http://127.0.0.1:${port}/api/studio-bg`);
      expect(bgGet.status).toBe(200);
      const bgData = (await bgGet.json()) as typeof bgPayload;
      expect(bgData.byTier['__E2E_TEST_KIND__:15']).toEqual(bgPayload.byTier['__E2E_TEST_KIND__:15']);
      expect(bgData.byFile['e2e-ref.png']).toEqual(bgPayload.byFile['e2e-ref.png']);
    } finally {
      fs.writeFileSync(FITTED_PATH, originalContent, 'utf8');
      if (horseBackup !== null) fs.writeFileSync(horseFile, horseBackup, 'utf8');
      else (fs as any).rmSync(horseFile, { force: true });
      (fs as any).rmSync(synthFile, { force: true });
      if (serverProc && !serverProc.killed) {
        serverProc.kill('SIGTERM');
      }
    }
  }, 30000);
});
