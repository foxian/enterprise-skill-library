import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPkg = JSON.parse(await fs.readFile(path.join(cliDir, 'package.json'), 'utf8'));
const manifestPath = path.join(cliDir, 'dist', 'builtin', 'builtin-packages.json');

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const entry = manifest.packages['@builtin/esl-operator'];
if (!entry) {
  throw new Error('Built-in skill package manifest is missing @builtin/esl-operator; run the build first');
}
if (entry.version !== cliPkg.version) {
  throw new Error(
    `Built-in skill package version ${entry.version} does not match @esl/cli version ${cliPkg.version}`
  );
}
if (!entry.checksum || !entry.checksum.startsWith('sha256-')) {
  throw new Error(`Built-in skill package is missing a valid checksum: ${entry.checksum}`);
}

console.log(`Verified built-in skill package @builtin/esl-operator@${entry.version} matches @esl/cli@${cliPkg.version}`);