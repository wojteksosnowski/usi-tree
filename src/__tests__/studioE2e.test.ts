import { describe, it, expect } from 'vitest';
// @ts-ignore - node types not in tsconfig
import { spawn, type ChildProcess } from 'node:child_process';
// @ts-ignore - node types not in tsconfig
import fs from 'node:fs';
// @ts-ignore - node types not in tsconfig
import path from 'node:path';
import { TreeGenerator } from '../core/TreeGenerator';
import type { SpeciesProfile, CrownShape } from '../core/types';

const CURRENT_DIR = path.dirname(new URL(import.meta.url).pathname);
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
          p.limbsReachEnvelope = false;
          p.levels[0].lengthRatio = p.levels[0].lengthRatio * 0.4;
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
    const port = 4199;
    let serverProc: ChildProcess | null = null;

    try {
      serverProc = spawn('./node_modules/.bin/tsx', ['scripts/tree-studio.ts'], {
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
      expect(json).toEqual({ ok: true });

      const updatedRaw = JSON.parse(fs.readFileSync(FITTED_PATH, 'utf8')) as FittedEntry[];
      const updatedEntry = updatedRaw.find((f) => f.ref === 'Horsechestnut');
      const anchor = updatedEntry?.heightAnchors?.find((a) => a.h === 15);
      expect(anchor).toBeDefined();
      expect(anchor?.profile.crownSpreadRatio).toBe(testCrownSpread);

      // Gatunek bazowy bez wpisu (POPLAR) w formacie Studio `anchors[]` → serwer tworzy wpis
      expect(updatedRaw.some((f) => f.ref === 'POPLAR')).toBe(false);
      const poplarAnchors = [9, 15].map((h) => ({ h, profile: cloneProfile(entry.profile) }));
      const resPoplar = await fetch(`http://127.0.0.1:${port}/api/save-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'POPLAR', anchors: poplarAnchors }),
      });
      expect(await resPoplar.json()).toEqual({ ok: true });
      const poplar = (JSON.parse(fs.readFileSync(FITTED_PATH, 'utf8')) as FittedEntry[]).find((f) => f.ref === 'POPLAR');
      expect(poplar?.startSpecies).toBe('POPLAR');
      expect(poplar?.heightAnchors?.map((a) => a.h)).toEqual([9, 15]);

      // Nieznany rodzaj → 400
      const resBad = await fetch(`http://127.0.0.1:${port}/api/save-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'NOPE', anchors: poplarAnchors }),
      });
      expect(resBad.status).toBe(400);
    } finally {
      fs.writeFileSync(FITTED_PATH, originalContent, 'utf8');
      if (serverProc && !serverProc.killed) {
        serverProc.kill('SIGTERM');
      }
    }
  }, 30000);
});
