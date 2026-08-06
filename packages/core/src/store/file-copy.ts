import fs from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED_DIRS = new Set(['.git']);

async function copyRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      await copyRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
      await fs.chmod(destPath, 0o444);
    }
  }
}

export async function copySkillDirectory(source: string, target: string): Promise<void> {
  const resolvedSource = await resolveExistingPath(source);
  const resolvedTarget = path.resolve(target);

  if (pathsOverlap(resolvedSource, resolvedTarget)) {
    throw new Error(`Source and target directories must not overlap: ${resolvedSource} and ${resolvedTarget}`);
  }

  await removeDirectory(target);
  await copyRecursive(source, target);
}

export async function removeDirectory(target: string): Promise<void> {
  if (await isSymbolicLink(target)) {
    await fs.rm(target, { force: true });
    return;
  }

  try {
    await makeWritableRecursive(target);
  } catch {
    // Directory may not exist.
  }
  await fs.rm(target, { recursive: true, force: true });
}

async function makeWritableRecursive(dir: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const stat = await fs.lstat(fullPath);
    if (stat.isSymbolicLink()) {
      continue;
    }

    if (stat.isDirectory()) {
      await makeWritableRecursive(fullPath);
    } else {
      try {
        await fs.chmod(fullPath, 0o666);
      } catch {
        // Ignore failures while restoring file permissions.
      }
    }
  }
}

async function resolveExistingPath(input: string): Promise<string> {
  try {
    return await fs.realpath(input);
  } catch {
    return path.resolve(input);
  }
}

async function isSymbolicLink(input: string): Promise<boolean> {
  try {
    return (await fs.lstat(input)).isSymbolicLink();
  } catch {
    return false;
  }
}

function pathsOverlap(source: string, target: string): boolean {
  return isSameOrDescendant(source, target) || isSameOrDescendant(target, source);
}

function isSameOrDescendant(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
