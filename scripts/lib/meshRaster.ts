/** Wspólny rasteryzer siatek drzew (rzut boczny, flat shading, sortowanie po z) dla skryptów diagnostycznych. */
import type { CanvasRenderingContext2D } from 'canvas';
import type { RawTreeMesh } from '../../src/core/types.js';

export const MESH_COLORS = ['#5b4630', '#9ccc5a', '#6fa83f', '#487a2c'];

/** Rysuje siatkę w rzucie bocznym: oś pnia (x=0) w `axisX` px, grunt (y=0) w `groundY` px, skala `k` px/m. */
export function drawMeshSide(g: CanvasRenderingContext2D, m: RawTreeMesh, axisX: number, groundY: number, k: number, stroke = 0.5): void {
  const tris: { z: number; c: number; p: number[] }[] = [];
  for (const gr of m.groups) for (let t = gr.start; t < gr.start + gr.count; t += 3) {
    const P3 = [0, 1, 2].map((j) => { const i = m.indices[t + j] * 3; return [m.positions[i], m.positions[i + 1], m.positions[i + 2]]; });
    tris.push({ z: (P3[0][2] + P3[1][2] + P3[2][2]) / 3, c: gr.materialIndex, p: P3.flatMap((q) => [q[0], q[1]]) });
  }
  tris.sort((u, v) => u.z - v.z);
  for (const t of tris) {
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const x = axisX + t.p[i * 2] * k, y = groundY - t.p[i * 2 + 1] * k;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath(); g.fillStyle = MESH_COLORS[t.c] ?? '#487a2c'; g.fill();
    g.strokeStyle = '#2c3a20'; g.lineWidth = stroke; g.stroke();
  }
}
