import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(cliDir, '..', '..');
const distDir = path.join(cliDir, 'dist');
const vendorDir = path.join(distDir, 'vendor');

const workspacePackages = [
  { name: '@esl/core', sourceDist: path.join(repoRoot, 'packages', 'core', 'dist'), vendorName: 'core' },
  { name: '@esl/i18n', sourceDist: path.join(repoRoot, 'packages', 'i18n', 'dist'), vendorName: 'i18n' }
];

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(from, to) {
  await fs.cp(from, to, { recursive: true, force: true });
}

async function listFiles(dir, suffix) {
  const out = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith(suffix)) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}

function rewriteImports(source, filePath) {
  let next = source;
  for (const pkg of workspacePackages) {
    const target = path.join(vendorDir, pkg.vendorName, 'index.js');
    const rel = path.relative(path.dirname(filePath), target).split(path.sep).join('/');
    const spec = rel.startsWith('.') ? rel : `./${rel}`;
    const patterns = [
      new RegExp(`from\\s+['"]${pkg.name}['"]`, 'g'),
      new RegExp(`import\\(\\s*['"]${pkg.name}['"]\\s*\\)`, 'g'),
      new RegExp(`export\\s+\\*\\s+from\\s+['"]${pkg.name}['"]`, 'g')
    ];
    for (const pattern of patterns) {
      next = next.replace(pattern, (match) => match.replace(pkg.name, spec));
    }
  }
  return next;
}

if (!(await pathExists(distDir))) {
  throw new Error('dist/ missing; run tsc before bundle');
}

for (const pkg of workspacePackages) {
  if (!(await pathExists(pkg.sourceDist))) {
    throw new Error(`Missing ${pkg.name} build output at ${pkg.sourceDist}; build it first`);
  }
}

await fs.rm(vendorDir, { recursive: true, force: true });
await fs.mkdir(vendorDir, { recursive: true });

for (const pkg of workspacePackages) {
  const dest = path.join(vendorDir, pkg.vendorName);
  await copyDir(pkg.sourceDist, dest);
}

const jsFiles = await listFiles(distDir, '.js');
let rewritten = 0;
for (const file of jsFiles) {
  // Vendor copies should keep their own relative imports; only rewrite consumers.
  if (file.startsWith(vendorDir + path.sep) || file.startsWith(vendorDir + '/')) {
    continue;
  }
  const original = await fs.readFile(file, 'utf8');
  if (!original.includes('@esl/')) {
    continue;
  }
  const updated = rewriteImports(original, file);
  if (updated !== original) {
    await fs.writeFile(file, updated, 'utf8');
    rewritten += 1;
  }
}

// Fail if any non-vendor dist file still references @esl/*
const leftovers = [];
for (const file of jsFiles) {
  if (file.startsWith(vendorDir + path.sep) || file.startsWith(vendorDir + '/')) continue;
  const text = await fs.readFile(file, 'utf8');
  if (text.includes("'@esl/") || text.includes('"@esl/')) {
    leftovers.push(path.relative(cliDir, file));
  }
}
if (leftovers.length > 0) {
  throw new Error(`Unresolved @esl/* imports after vendor bundle:\n${leftovers.join('\n')}`);
}

console.log(
  `Vendored @esl/core + @esl/i18n into dist/vendor and rewrote ${rewritten} dist modules (${pathToFileURL(distDir).href})`
);
