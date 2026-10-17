#!/usr/bin/env node
/**
 * usi-tree CLI — Inspect, validate, and export USI Tree Standard (.utree.json) profiles
 */
import fs from 'node:fs';
import { TreeGenerator, SPECIES_PROFILES } from '../core/TreeGenerator.js';
import { resolveTreeKind, treeKindParams, type TreeKind } from '../core/treeSpeciesRegistry.js';
import { crownRadiusOf } from '../core/crownMeasure.js';
import { toUsiTreeSpec, FITTED_PROFILES } from '../profiles/index.js';
import { validateUsiTreeSpec } from '../schema/index.js';

const args = process.argv.slice(2);
const cmd = args[0] ?? 'help';

if (cmd === 'list') {
  const baseKinds = Object.keys(SPECIES_PROFILES);
  const fittedKinds = FITTED_PROFILES.map((f) => f.ref);
  console.log(JSON.stringify({ baseSpecies: baseKinds, fittedSpecies: fittedKinds }, null, 2));
} else if (cmd === 'export-spec') {
  const query = args[1] ?? 'ASH';
  const kind = resolveTreeKind({ namePolish: query, nameLatin: query, species: query }) as TreeKind;
  const spec = toUsiTreeSpec(kind);
  console.log(JSON.stringify(spec, null, 2));
} else if (cmd === 'validate') {
  const file = args[1];
  if (!file) {
    console.error('Usage: usi-tree validate <file.utree.json>');
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = validateUsiTreeSpec(doc);
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.valid ? 0 : 1);
} else if (cmd === 'inspect') {
  const query = args[1] ?? 'ASH';
  const height = Number(args[2] ?? 15);
  const kind = resolveTreeKind({ namePolish: query, nameLatin: query, species: query });
  const params = treeKindParams(kind, height);
  const sk = TreeGenerator.buildSkeleton({ ...params, height, seed: 108 });
  const radius = crownRadiusOf(kind, height);
  console.log(JSON.stringify({
    query,
    resolvedKind: kind,
    heightM: height,
    crownRadiusM: Number(radius.toFixed(2)),
    crownDiameterM: Number((radius * 2).toFixed(2)),
    aspectWH: Number(((radius * 2) / height).toFixed(3)),
    stemsCount: sk.stems.length,
  }, null, 2));
} else {
  console.log(`usi-tree — Open Standard for 3D & CAD Tree Description (v0.1.0)

Commands:
  usi-tree list                         List all built-in base and fitted species
  usi-tree inspect <name> [heightM]     Compute 3D skeleton metrics & crown reach
  usi-tree export-spec <name>           Export species as a UsiTreeSpecV1 (.utree.json) document
  usi-tree validate <file.utree.json>   Validate a tree specification against USI Tree Standard v1.0
`);
}
