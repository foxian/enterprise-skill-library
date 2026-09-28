import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(cliDir, 'package.json'), 'utf8')) as {
  name: string;
  license?: string;
  dependencies?: Record<string, string>;
  files?: string[];
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
};

describe('@foxian/esl package publish surface', () => {
  it('uses the public package identity and MIT license', () => {
    expect(pkg.name).toBe('@foxian/esl');
    expect(pkg.license).toBe('MIT');
    expect(pkg.bin?.esl).toBe('./dist/bin/esl.js');
    expect(pkg.scripts?.postinstall).toBe('node ./postinstall.mjs');
  });

  it('does not declare unpublished @esl/* runtime dependencies', () => {
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps.some((name) => name.startsWith('@esl/'))).toBe(false);
  });

  it('publishes the built dist surface and license', () => {
    expect(pkg.files).toEqual(['dist/', 'LICENSE', 'README.md', 'postinstall.mjs']);
  });
});
