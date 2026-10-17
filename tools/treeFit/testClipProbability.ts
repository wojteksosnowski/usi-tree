import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';

async function main() {
  const width = 1600;
  const heightPx = 1000;

  const clientCode = `
    import * as THREE from 'three';
    import { TreeGenerator, ILLUSTRATION_STROKE } from '${path.resolve(__dirname, '../../src/index.ts').replace(/\\/g, '/')}';

    const canvas = document.getElementById('webgl-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(2);
    renderer.setSize(${width}, ${heightPx});
    renderer.setClearColor(0xfcfbf9, 1.0);

    const scene = new THREE.Scene();

    const H = 6.0;
    const frustumH = H * 1.35;
    const aspect = ${width} / ${heightPx};
    const frustumW = frustumH * aspect;
    const centerY = H * 0.48;

    const camera = new THREE.OrthographicCamera(
      -frustumW * 0.5, frustumW * 0.5,
      frustumH * 0.5, -frustumH * 0.5,
      1, 500
    );
    camera.position.set(0, centerY, 100);
    camera.lookAt(0, centerY, 0);

    const barkMat = new THREE.MeshBasicMaterial({ color: 0x4a3b32, side: THREE.DoubleSide });
    const leafMats = [
      new THREE.MeshBasicMaterial({ color: 0xc49174, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0xb35a38, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ color: 0x732918, side: THREE.DoubleSide }),
    ];

    const baseProfile = JSON.parse(fs.readFileSync('/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/klon-jawor_Acer/klon_6m_cukrowy.json', 'utf8'));

    // Test 1: Obecny (100% deterministyczne docinanie obwiednią)
    // Test 2: limbsReachEnvelope: false (naturalny wzrost bez wymuszania sięgania obwiedni)
    // Test 3: limbsReachEnvelope: false + prune: false (pełna swoboda pędów)
  `;
}
main();
