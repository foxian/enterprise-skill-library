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
      try {
        await fs.chmod(destPath, 0o444);
      } catch {
        // On Windows, chmod may not fully work; ignore errors.
      }
    }
  }
}

export async function copySkillDirectory(source: string, target: string): Promise<void> {
  await removeDirectory(target);
  await copyRecursive(source, target);
}

export async function removeDirectory(target: string): Promise<void> {
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
    if (entry.isDirectory()) {
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
