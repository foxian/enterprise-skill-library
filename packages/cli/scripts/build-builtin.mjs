import { buildBuiltinPackage } from '@esl/core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinSkills } from './builtin-skills.mjs';

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(cliDir, '..', '..');
const outputRoot = path.join(cliDir, 'dist', 'builtin');
const cliPkg = JSON.parse(await fs.readFile(path.join(cliDir, 'package.json'), 'utf8'));

for (const skill of builtinSkills) {
  const entry = await buildBuiltinPackage({
    sourceDir: path.join(repoRoot, 'skills', skill.name),
    outputRoot,
    identity: `@builtin/${skill.name}`,
    cliVersion: cliPkg.version,
    versionSource: skill.versionSource
  });
  console.log(`Built built-in skill package ${entry.name}@${entry.version}`);
}
