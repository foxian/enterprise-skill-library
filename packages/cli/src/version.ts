import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function readCliVersion(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(moduleDir, '..', 'package.json');
  const raw = fs.readFileSync(pkgPath, 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}
