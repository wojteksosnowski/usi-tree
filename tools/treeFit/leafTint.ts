import * as THREE from 'three';
import { leafToneShift, type TreeKind } from '../../src/index.js';

/**
 * Ton listowia przesunięty w HSL o przesunięcie rodzaju (`leafToneShift`; `null` = ton neutralny).
 * `hueDeg` dodaje się do obrotu odcienia, `lightness` mnoży jasność (rozrzut drzewa, rozjaśnienie sceny).
 * Jedno źródło matematyki tonu dla rzutni 3D (`IsoTrees.tsx`) i planszy gatunków (`renderSpeciesBoard.ts`).
 */
export function shiftLeafColor(
  color: THREE.ColorRepresentation,
  kind: TreeKind | null,
  extra: { hueDeg?: number; lightness?: number } = {},
  target = new THREE.Color()
): THREE.Color {
  const { hue, saturation, lightness } = leafToneShift(kind);
  const hsl = new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 });
  return target.setHSL(
    (((hsl.h + (hue + (extra.hueDeg ?? 0)) / 360) % 1) + 1) % 1,
    THREE.MathUtils.clamp(hsl.s * saturation, 0, 1),
    THREE.MathUtils.clamp(hsl.l * lightness * (extra.lightness ?? 1), 0, 1)
  );
}
