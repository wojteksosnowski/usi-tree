# `usi-tree` — Open Standard for Dendrological & Procedural 3D Trees

**`usi-tree`** is an open-source TypeScript library that defines the **USI Tree Standard v1.0 (`.utree.json`)** — a declarative, biologically grounded specification for describing, interpolating, and generating 3D trees for CAD, BIM, GIS, and architectural visualization.

## Key Features

1. **Declarative Open Standard (`UsiTreeSpec v1.0`)**:
   - **Taxonomy & GIS/OSM Semantic Resolution**: Maps Latin genera, species names, vernacular names (PL/EN/DE), and leaf types (`broadleaved` / `needleleaved`) to calibrated 3D archetypes.
   - **Biomechanical & Dendrological Model**: Incorporates Leonardo da Vinci pipe model, Euler–Bernoulli cantilever beam sag (pliancy), apical dominance, and root flare.
   - **Ontogenetic Age/Height Progression**: Multi-anchor age profiles (6m -> 9m -> 15m -> 24m) with continuous log2(h) interpolation.
   - **Decoupled Architectural Stroke (`TreeStroke`)**: Renders the same botanical skeleton as an architectural linework illustration (`ILLUSTRATION_STROKE`) or realistic 3D geometry.
2. **Zero-Dependency Core**:
   - `import { TreeGenerator, resolveTreeKind, crownRadiusOf } from "usi-tree"` has **0 runtime dependencies** (no Three.js required), returning typed `Float32Array` / `Uint32Array` buffers.
3. **First-Class Three.js Adapter (`usi-tree/three`)**:
   - `import { TreeGenerator, toThreeBufferGeometry } from "usi-tree/three"` builds ready-to-render `THREE.BufferGeometry` instances with precomputed O(1) bounding boxes.
4. **Inverse Procedural Modeling Toolkit (`usi-tree/fitter` & CLI)**:
   - Silhouette and structural metrics for fitting procedural parameters to botanical reference photographs.

## License

MIT © USI Light Contributors
