import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Zdjęcie wzorca (jpg/webp/png) jako `data:image/png;base64,…` do osadzenia w planszy porównawczej.
 * Konwersja `sips` (macOS) do unikalnego katalogu tymczasowego, sprzątanego po odczycie —
 * równoległe rendery nie nadpisują sobie plików.
 */
export function imageToPngDataUrl(imagePath: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'treefit-img-'));
  try {
    const png = path.join(dir, 'image.png');
    execFileSync('sips', ['-s', 'format', 'png', imagePath, '--out', png], { stdio: 'ignore' });
    return `data:image/png;base64,${fs.readFileSync(png).toString('base64')}`;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
