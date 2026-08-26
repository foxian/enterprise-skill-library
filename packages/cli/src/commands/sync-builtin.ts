import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BUILTIN_IDENTITY,
  loadSkillsJson,
  loadSkillsLock,
  resolveLocalStorePaths,
  type LocalStoreOptions
} from '@esl/core';
import { executeInstall } from './install.js';
import { resolveBuiltinDir } from '../builtin-dir.js';

export interface SyncBuiltinOptions extends LocalStoreOptions {
  builtinDir?: string;
}

export interface SyncBuiltinResult {
  synced: boolean;
  failed: boolean;
}

const SYNC_PENDING_MARKER = '.builtin-sync-pending';

export async function syncGlobalBuiltinSkill(options: SyncBuiltinOptions = {}): Promise<SyncBuiltinResult> {
  const globalRoot = resolveLocalStorePaths(options).root;
  try {
    const skillsJson = await loadSkillsJson(globalRoot);
    if (!skillsJson.skills[BUILTIN_IDENTITY]) {
      return { synced: false, failed: false };
    }

    const builtinDir = options.builtinDir ?? resolveBuiltinDir();
    const lock = await loadSkillsLock(globalRoot);
    const installedVersion = lock.skills[BUILTIN_IDENTITY]?.version;

    await executeInstall(BUILTIN_IDENTITY, {
      homeDir: options.homeDir,
      builtinDir,
      global: true,
      noAdapt: false
    });

    const newLock = await loadSkillsLock(globalRoot);
    const synced = newLock.skills[BUILTIN_IDENTITY]?.version !== installedVersion;
    return { synced, failed: false };
  } catch (error) {
    await writeSyncPendingMarker(globalRoot, error);
    return { synced: false, failed: true };
  }
}

export async function retryPendingGlobalSync(options: SyncBuiltinOptions = {}): Promise<SyncBuiltinResult> {
  const globalRoot = resolveLocalStorePaths(options).root;
  if (!await hasSyncPendingMarker(globalRoot)) {
    return { synced: false, failed: false };
  }
  const result = await syncGlobalBuiltinSkill(options);
  if (!result.failed) {
    await clearSyncPendingMarker(globalRoot);
  }
  return result;
}

async function writeSyncPendingMarker(globalRoot: string, error: unknown): Promise<void> {
  try {
    await fs.mkdir(globalRoot, { recursive: true });
    await fs.writeFile(
      path.join(globalRoot, SYNC_PENDING_MARKER),
      `${new Date().toISOString()} ${(error as Error).message ?? String(error)}\n`,
      'utf8'
    );
  } catch {
    // Marker writes are best-effort; a failed marker must not mask the original error.
  }
}

async function hasSyncPendingMarker(globalRoot: string): Promise<boolean> {
  try {
    await fs.access(path.join(globalRoot, SYNC_PENDING_MARKER));
    return true;
  } catch {
    return false;
  }
}

async function clearSyncPendingMarker(globalRoot: string): Promise<void> {
  try {
    await fs.rm(path.join(globalRoot, SYNC_PENDING_MARKER), { force: true });
  } catch {
    // Best-effort cleanup.
  }
}