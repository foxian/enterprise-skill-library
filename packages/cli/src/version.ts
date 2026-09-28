import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function readCliVersion(): string {
  const startDir = path.dirname(fileURLToPath(import.meta.url));
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        name?: string;
        version?: string;
        bin?: Record<string, string>;
      };
      if (pkg.name === '@foxian/esl' || pkg.bin?.esl) {
        if (typeof pkg.version === 'string' && pkg.version.length > 0) {
          return pkg.version;
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error('Unable to resolve @foxian/esl package version from package.json');
}
