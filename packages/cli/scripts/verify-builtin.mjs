import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBuiltinPackageOrThrow, validateSkillDirectory } from '../dist/vendor/core/index.js';
import { builtinSkills } from './builtin-skills.mjs';

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPkg = JSON.parse(await fs.readFile(path.join(cliDir, 'package.json'), 'utf8'));
const builtinRoot = path.join(cliDir, 'dist', 'builtin');
for (const skill of builtinSkills) {
  const identity = `@builtin/${skill.name}`;
  const entry = await loadBuiltinPackageOrThrow(builtinRoot, identity);
  const validation = await validateSkillDirectory(entry.directory);
  if (!validation.success) throw new Error(`Invalid built-in package ${identity}: ${validation.errors.join(', ')}`);
  const expectedVersion = skill.versionSource === 'cli' ? cliPkg.version :
    JSON.parse(await fs.readFile(path.resolve(cliDir, '..', '..', 'skills', skill.name, 'skill.json'), 'utf8')).version;
  if (entry.version !== expectedVersion || validation.data.skillJson.version !== expectedVersion || validation.data.skillJson.name !== identity) {
    throw new Error(`Built-in skill package identity or version mismatch: ${identity}`);
  }
  console.log(`Verified built-in skill package ${identity}@${entry.version}`);
}
