#!/usr/bin/env node
/**
 * Stdio JSON-RPC 2.0 MCP server for usi-tree:
 * Exposes tools for inspecting tree 3D geometry, checking branch continuity,
 * updating fittedProfiles.json parameters, and verifying the studio bundle.
 */
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { TreeGenerator } from '../src/core/TreeGenerator.js';
import { treeKindParams, type TreeKind } from '../src/core/treeSpeciesRegistry.js';
import { countMeshTriangles } from '../src/core/treeLod.js';
import { readAssertionModel } from './assertionStore.js';
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
    name: 'get_assertion_model',
    description: 'Returns the assertion model (12 m, seed 1111) for a kind: hash, counts, bbox, params and (optionally) all vertices.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        includeVertices: { type: 'boolean', description: 'default true' },
      },
      required: ['kind'],
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
  {
    name: 'analyze_chrome_trace',
    description: 'Analyzes a Chrome DevTools Performance trace (.json or .json.gz) and summarizes frame times, FPS, and main-thread / GPU hotspots.',
    inputSchema: {
      type: 'object',
      properties: {
        tracePath: { type: 'string', description: 'Path to .json or .json.gz trace file' },
        topN: { type: 'number', description: 'Number of top hotspots to return (default 15)' },
      },
      required: ['tracePath'],
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
  if (name === 'get_assertion_model') {
    const m = readAssertionModel(args.kind);
    if (args.includeVertices === false) {
      const { vertices: _v, ...summary } = m;
      return summary;
    }
    return m;
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
  if (name === 'analyze_chrome_trace') {
    if (typeof args.tracePath !== 'string' || !args.tracePath) throw new Error('tracePath is required (string)');
    const tracePath = path.resolve(args.tracePath);
    if (!fs.existsSync(tracePath) || !fs.statSync(tracePath).isFile()) throw new Error(`Trace file not found: ${tracePath}`);
    const rawBuf = fs.readFileSync(tracePath);
    const isGz = tracePath.endsWith('.gz') || (rawBuf[0] === 0x1f && rawBuf[1] === 0x8b);
    const trace = JSON.parse((isGz ? zlib.gunzipSync(rawBuf) : rawBuf).toString('utf-8'));
    const events: any[] = Array.isArray(trace) ? trace : (trace.traceEvents ?? []);
    const topNRaw = args.topN ?? 15;
    if (typeof topNRaw !== 'number' || !Number.isFinite(topNRaw) || topNRaw < 1) throw new Error('topN must be a positive number');
    const topN = Math.min(Math.floor(topNRaw), 1000);

    // Frame timing: DrawFrame only (fallback BeginMainThreadFrame), single dominant pid, sorted by ts.
    const pickFrames = (n: string) => events.filter((e) => e.name === n && typeof e.ts === 'number');
    let frameEvs = pickFrames('DrawFrame');
    if (frameEvs.length === 0) frameEvs = pickFrames('BeginMainThreadFrame');
    const pidCounts = new Map<any, number>();
    for (const e of frameEvs) pidCounts.set(e.pid, (pidCounts.get(e.pid) ?? 0) + 1);
    let bestPid: any = undefined;
    let bestCount = 0;
    for (const [pid, c] of pidCounts) if (c > bestCount) { bestCount = c; bestPid = pid; }
    const frameTs = frameEvs.filter((e) => e.pid === bestPid).map((e) => e.ts as number).sort((a, b) => a - b);
    const frames: number[] = [];
    for (let i = 1; i < frameTs.length; i++) {
      const d = (frameTs[i] - frameTs[i - 1]) / 1000;
      if (d > 0) frames.push(d);
    }
    let sumMs = 0;
    let maxFrameMs = 0;
    for (const f of frames) { sumMs += f; if (f > maxFrameMs) maxFrameMs = f; }
    const avgFrameMs = frames.length ? sumMs / frames.length : 0;
    const sortedFrames = [...frames].sort((a, b) => a - b);
    const pct = (p: number) => (sortedFrames.length ? sortedFrames[Math.min(sortedFrames.length - 1, Math.floor(p * sortedFrames.length))] : 0);

    // Self time: per (pid, tid), complete (X) events plus B/E pairs converted to spans.
    type Span = { ts: number; dur: number; label: string };
    const threads = new Map<string, Span[]>();
    const openB = new Map<string, Span[]>();
    const labelOf = (ev: any) => (ev.args?.data?.functionName ? `${ev.name}:${ev.args.data.functionName}` : ev.name);
    const sortedEvs = events.filter((e) => typeof e.ts === 'number').sort((a, b) => a.ts - b.ts);
    for (const ev of sortedEvs) {
      const key = `${ev.pid}:${ev.tid}`;
      if (ev.ph === 'X' && typeof ev.dur === 'number' && ev.dur > 0) {
        if (!threads.has(key)) threads.set(key, []);
        threads.get(key)!.push({ ts: ev.ts, dur: ev.dur, label: labelOf(ev) });
      } else if (ev.ph === 'B') {
        if (!openB.has(key)) openB.set(key, []);
        openB.get(key)!.push({ ts: ev.ts, dur: 0, label: labelOf(ev) });
      } else if (ev.ph === 'E') {
        const sp = openB.get(key)?.pop();
        if (sp && ev.ts > sp.ts) {
          sp.dur = ev.ts - sp.ts;
          if (!threads.has(key)) threads.set(key, []);
          threads.get(key)!.push(sp);
        }
      }
    }
    const stats = new Map<string, { count: number; selfMs: number; totalMs: number; maxMs: number }>();
    const add = (label: string, selfUs: number, totalUs: number) => {
      const cur = stats.get(label) ?? { count: 0, selfMs: 0, totalMs: 0, maxMs: 0 };
      cur.count++;
      cur.selfMs += selfUs / 1000;
      cur.totalMs += totalUs / 1000;
      if (totalUs / 1000 > cur.maxMs) cur.maxMs = totalUs / 1000;
      stats.set(label, cur);
    };
    for (const spans of threads.values()) {
      spans.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
      const stack: { end: number; label: string; dur: number; childUs: number }[] = [];
      const pop = () => {
        const t = stack.pop()!;
        add(t.label, Math.max(0, t.dur - t.childUs), t.dur);
      };
      for (const s of spans) {
        while (stack.length && stack[stack.length - 1].end <= s.ts) pop();
        const parent = stack[stack.length - 1];
        if (parent) parent.childUs += Math.min(s.dur, parent.end - s.ts);
        stack.push({ end: s.ts + s.dur, label: s.label, dur: s.dur, childUs: 0 });
      }
      while (stack.length) pop();
    }
    const hotspots = [...stats.entries()]
      .sort((a, b) => b[1].selfMs - a[1].selfMs)
      .slice(0, topN)
      .map(([event, s]) => ({
        event,
        count: s.count,
        selfMs: Number(s.selfMs.toFixed(2)),
        totalMs: Number(s.totalMs.toFixed(2)),
        maxMs: Number(s.maxMs.toFixed(2)),
      }));

    return {
      totalEvents: events.length,
      frameSource: frameEvs.length && frameEvs[0].name,
      framePid: bestPid ?? null,
      frameCount: frames.length,
      avgFrameMs: Number(avgFrameMs.toFixed(2)),
      p50FrameMs: Number(pct(0.5).toFixed(2)),
      p95FrameMs: Number(pct(0.95).toFixed(2)),
      maxFrameMs: Number(maxFrameMs.toFixed(2)),
      approxFps: avgFrameMs > 0 ? Number((1000 / avgFrameMs).toFixed(1)) : 0,
      hotspots,
    };
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
