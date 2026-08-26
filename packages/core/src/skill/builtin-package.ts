import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseSkillName, SemVerSchema } from '../schema/skill-json.js';
import { validateSkillMd } from './skill-md.js';

export interface BuiltinPackageManifestEntry {
  name: string;
  version: string;
  checksum: string;
  shortName: string;
}

export interface BuiltinPackageManifest {
  version: 1;
  packages: Record<string, BuiltinPackageManifestEntry>;
}

export interface BuiltinPackage {
  name: string;
  shortName: string;
  version: string;
  checksum: string;
  directory: string;
}

export interface BuildBuiltinPackageOptions {
  sourceDir: string;
  outputRoot: string;
  identity: string;
  cliVersion: string;
  author?: string;
}

const BUILTIN_MANIFEST = 'builtin-packages.json';

export const BUILTIN_SCOPE = 'builtin';
export const BUILTIN_IDENTITY = '@builtin/esl-operator';
export const BUILTIN_SPECIFIER_PREFIX = 'builtin:';

export function isBuiltinIdentity(name: string): boolean {
  try {
    return parseSkillName(name).scope === BUILTIN_SCOPE;
  } catch {
    return false;
  }
}

export async function buildBuiltinPackage(
  options: BuildBuiltinPackageOptions
): Promise<BuiltinPackageManifestEntry> {
  const { scope, skillName } = parseSkillName(options.identity);
  if (scope !== 'builtin') {
    throw new Error(`Built-in skill identity must use the builtin scope: ${options.identity}`);
  }
  if (!SemVerSchema.safeParse(options.cliVersion).success) {
    throw new Error(`Built-in skill version must be a valid SemVer matching @esl/cli: ${options.cliVersion}`);
  }

  const skillMdContent = await fs.readFile(path.join(options.sourceDir, 'SKILL.md'), 'utf8');
  const skillMdValidation = validateSkillMd(skillMdContent);
  if (!skillMdValidation.success) {
    throw new Error(`Invalid built-in SKILL.md: ${skillMdValidation.errors.join(', ')}`);
  }
  if (skillMdValidation.data.name !== skillName) {
    throw new Error(`SKILL.md name "${skillMdValidation.data.name}" must match built-in short name "${skillName}"`);
  }

  const packageDir = path.join(options.outputRoot, skillName);
  await fs.rm(packageDir, { recursive: true, force: true });
  await fs.mkdir(packageDir, { recursive: true });

  const skillJson = {
    name: options.identity,
    version: options.cliVersion,
    description: skillMdValidation.data.description,
    author: options.author ?? '@esl/cli',
    keywords: []
  };
  await fs.writeFile(path.join(packageDir, 'skill.json'), `${JSON.stringify(skillJson, null, 2)}\n`, 'utf8');

  await copySourceFiles(options.sourceDir, packageDir);

  const checksum = await computePackageChecksum(packageDir);

  const manifest = await loadManifest(options.outputRoot);
  manifest.packages[options.identity] = {
    name: options.identity,
    version: options.cliVersion,
    checksum,
    shortName: skillName
  };
  await saveManifest(options.outputRoot, manifest);

  return {
    name: options.identity,
    version: options.cliVersion,
    checksum,
    shortName: skillName
  };
}

export async function loadBuiltinPackage(
  builtinRoot: string,
  name: string
): Promise<BuiltinPackage | null> {
  const manifest = await loadManifest(builtinRoot);
  const entry = manifest.packages[name];
  if (!entry) {
    return null;
  }

  const directory = path.join(builtinRoot, entry.shortName);
  const actualChecksum = await computePackageChecksum(directory);
  if (actualChecksum !== entry.checksum) {
    throw new Error(`Built-in skill package checksum does not match: expected ${entry.checksum}, got ${actualChecksum}`);
  }

  return {
    name: entry.name,
    shortName: entry.shortName,
    version: entry.version,
    checksum: entry.checksum,
    directory
  };
}

export async function loadBuiltinPackageOrThrow(builtinRoot: string, name: string): Promise<BuiltinPackage> {
  const builtin = await loadBuiltinPackage(builtinRoot, name);
  if (!builtin) {
    throw new Error(`Unknown built-in skill: ${name}`);
  }
  return builtin;
}

async function loadManifest(builtinRoot: string): Promise<BuiltinPackageManifest> {
  try {
    const raw = await fs.readFile(path.join(builtinRoot, BUILTIN_MANIFEST), 'utf8');
    const parsed = JSON.parse(raw) as BuiltinPackageManifest;
    return { version: 1, packages: parsed.packages ?? {} };
  } catch {
    return { version: 1, packages: {} };
  }
}

async function saveManifest(builtinRoot: string, manifest: BuiltinPackageManifest): Promise<void> {
  await fs.mkdir(builtinRoot, { recursive: true });
  await fs.writeFile(
    path.join(builtinRoot, BUILTIN_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

async function copySourceFiles(sourceDir: string, packageDir: string): Promise<void> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') {
      continue;
    }
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(packageDir, entry.name);
    if (entry.isDirectory()) {
      await fs.cp(sourcePath, targetPath, { recursive: true });
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

export async function computePackageChecksum(directory: string): Promise<string> {
  const files: string[] = [];
  async function walk(current: string, rel: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, entryRel);
      } else {
        files.push(entryRel);
      }
    }
  }
  await walk(directory, '');
  files.sort();

  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const content = await fs.readFile(path.join(directory, file));
    hash.update(file);
    hash.update('\0');
    hash.update(content);
  }
  return `sha256-${hash.digest('hex')}`;
}