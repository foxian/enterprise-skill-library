import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(cliDir, 'package.json'), 'utf8'));

if (pkg.name !== '@foxian/esl') {
  throw new Error(`Expected package name @foxian/esl, found ${pkg.name}`);
}

const deps = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
for (const name of Object.keys(deps ?? {})) {
  if (name.startsWith('@esl/')) {
    throw new Error(`Published package must not depend on unpublished workspace package: ${name}`);
  }
}

const requiredFiles = [
  'dist/bin/esl.js',
  'dist/postinstall.js',
  'dist/builtin/builtin-packages.json',
  'dist/vendor/core/index.js',
  'dist/vendor/i18n/index.js',
  'LICENSE',
  'README.md'
];

for (const rel of requiredFiles) {
  const full = path.join(cliDir, rel);
  try {
    await fs.access(full);
  } catch {
    throw new Error(`Missing required publish file: ${rel}`);
  }
}

async function listJs(dir) {
  const out = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

const vendorDir = path.join(cliDir, 'dist', 'vendor');
const leftovers = [];
for (const file of await listJs(path.join(cliDir, 'dist'))) {
  if (file.startsWith(vendorDir + path.sep)) continue;
  const text = await fs.readFile(file, 'utf8');
  if (text.includes("'@esl/") || text.includes('"@esl/')) {
    leftovers.push(path.relative(cliDir, file));
  }
}
if (leftovers.length > 0) {
  throw new Error(`Publish dist still contains @esl/* imports:\n${leftovers.join('\n')}`);
}

console.log(`Verified @foxian/esl@${pkg.version} pack layout (vendored workspace libs, no @esl/* deps)`);

