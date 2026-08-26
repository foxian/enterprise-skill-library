import { buildBuiltinPackage } from '@esl/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(cliDir, '..', '..');
const builtinSourceDir = path.join(repoRoot, 'skills', 'esl-operator');
const outputRoot = path.join(cliDir, 'dist', 'builtin');

const cliPkg = JSON.parse(await fs.readFile(path.join(cliDir, 'package.json'), 'utf8'));
const cliVersion = cliPkg.version;

const sourceStat = await fs.stat(builtinSourceDir).catch(() => null);
if (!sourceStat?.isDirectory()) {
  throw new Error(`Built-in skill source not found: ${builtinSourceDir}`);
}

await buildBuiltinPackage({
  sourceDir: builtinSourceDir,
  outputRoot,
  identity: '@builtin/esl-operator',
  cliVersion
});

console.log(`Built built-in skill package @builtin/esl-operator@${cliVersion} -> ${outputRoot}`);