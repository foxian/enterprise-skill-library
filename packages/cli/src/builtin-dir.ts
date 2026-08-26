import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveBuiltinDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(moduleDir, '..', 'builtin');
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return path.resolve(moduleDir, '..', 'dist', 'builtin');
}