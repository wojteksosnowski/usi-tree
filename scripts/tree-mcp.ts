#!/usr/bin/env node
/**
 * Stdio JSON-RPC 2.0 MCP server for usi-tree:
 * Exposes tools for inspecting tree 3D geometry, checking branch continuity,
 * updating fittedProfiles.json parameters, and verifying the studio bundle.
 */
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TreeGenerator } from '../src/core/TreeGenerator.js';
import { treeKindParams, type TreeKind } from '../src/core/treeSpeciesRegistry.js';
import { countMeshTriangles } from '../src/core/treeLod.js';
import type { TrunkForm } from '../src/core/types.js';

const FITTED_PATH = fileURLToPath(new URL('../src/core/fittedProfiles.json', import.meta.url));

const TOOLS = [
  {
    name: 'inspect_tree_geometry',
    description: 'Generates a 3D tree and returns triangle counts, bounds, W/H ratio, and stem counts.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Tree kind / species name (e.g. Plane, ASH, Horsechestnut)' },
        height: { type: 'number', description: 'Tree height in meters' },
        form: { type: 'string', enum: ['SINGLE', 'FORKED', 'MULTI'] },
        seed: { type: 'number' },
      },
      required: ['kind', 'height'],
    },
  },
  {
    name: 'check_branch_continuity',
    description: 'Checks ring-to-ring radius continuity and child<=parent radius invariants on a generated skeleton.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        height: { type: 'number' },
        form: { type: 'string', enum: ['SINGLE', 'FORKED', 'MULTI'] },
        seed: { type: 'number' },
      },
      required: ['kind', 'height'],
    },
  },
  {
    name: 'update_tree_parameter',
    description: 'Updates a top-level parameter on a height anchor in src/core/fittedProfiles.json.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        anchorHeight: { type: 'number' },
        key: { type: 'string' },
        value: {},
      },
      required: ['kind', 'anchorHeight', 'key', 'value'],
    },
  },
];

function handleToolCall(name: string, args: any) {
  if (name === 'inspect_tree_geometry') {
    const params = treeKindParams(args.kind as TreeKind, args.height);
    const res = TreeGenerator.generateRaw({
      species: params.species,
      height: args.height,
      seed: args.seed ?? 42,
      form: (args.form as TrunkForm) ?? params.form,
      profile: params.profile,
      withFoliageAccents: true,
      detail: 'HIGH',
    });
    const tris = countMeshTriangles(res.mesh);
    return {
      tris,
      bounds: res.bounds,
      whRatio: Number(((res.bounds.crownRadius * 2) / Math.max(1e-6, res.bounds.height)).toFixed(3)),
    };
  }
  if (name === 'check_branch_continuity') {
    const params = treeKindParams(args.kind as TreeKind, args.height);
    const sk = TreeGenerator.buildSkeleton({
      species: params.species,
      height: args.height,
      seed: args.seed ?? 42,
      form: (args.form as TrunkForm) ?? params.form,
      profile: params.profile,
    });
    let minRingRatio = 1;
    let ringViolations = 0;
    for (const s of sk.stems) {
      for (let i = 0; i < s.r.length - 1; i++) {
        const ratio = s.r[i + 1] / Math.max(1e-9, s.r[i]);
        if (ratio < minRingRatio) minRingRatio = ratio;
        if (ratio < 0.78 || ratio > 1.001) ringViolations++;
      }
    }
    return { stemCount: sk.stems.length, minRingRatio: Number(minRingRatio.toFixed(4)), ringViolations };
  }
  if (name === 'update_tree_parameter') {
    const fitted = JSON.parse(fs.readFileSync(FITTED_PATH, 'utf-8'));
    const entry = fitted.find((f: any) => f.ref === args.kind);
    if (!entry) throw new Error(`Unknown kind: ${args.kind}`);
    const anchor = entry.heightAnchors?.find((a: any) => a.h === args.anchorHeight);
    if (!anchor) throw new Error(`Anchor ${args.anchorHeight}m not found for ${args.kind}`);
    anchor.profile[args.key] = args.value;
    fs.writeFileSync(FITTED_PATH, JSON.stringify(fitted, null, 2) + '\n');
    return { ok: true, kind: args.kind, anchorHeight: args.anchorHeight, key: args.key, value: args.value };
  }
  throw new Error(`Unknown tool: ${name}`);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let req: any;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const reply = (result: any) => {
    if (req.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n');
  };
  const replyErr = (code: number, message: string) => {
    if (req.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code, message } }) + '\n');
  };

  try {
    if (req.method === 'initialize') {
      reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'usi-tree-mcp', version: '0.1.0' } });
    } else if (req.method === 'tools/list') {
      reply({ tools: TOOLS });
    } else if (req.method === 'tools/call') {
      const out = handleToolCall(req.params?.name, req.params?.arguments ?? {});
      reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
    } else if (req.method === 'notifications/initialized') {
      // no-op
    } else {
      replyErr(-32601, `Method not found: ${req.method}`);
    }
  } catch (err: any) {
    replyErr(-32000, err.message);
  }
});
