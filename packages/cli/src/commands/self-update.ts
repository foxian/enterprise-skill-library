import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import semver from 'semver';
import { loadConfig, saveConfig } from '@esl/core';
import { confirm, isInteractive } from '../prompt.js';
import { readCliPackageRoot, readCliVersion } from '../version.js';

const execFileAsync = promisify(execFile);
const PACKAGE = '@foxian/esl';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function sameUtcDay(left: string | undefined, right = new Date()): boolean {
  return Boolean(left) && left!.slice(0, 10) === right.toISOString().slice(0, 10);
}

export interface UpdateInfo { currentVersion: string; latestVersion: string; }

async function npm(args: string[], timeout = 2000): Promise<string> {
  const result = await execFileAsync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    timeout, windowsHide: true, maxBuffer: 1024 * 1024
  });
  return result.stdout.trim();
}

export async function isGlobalCliInstall(): Promise<boolean> {
  try {
    const root = path.resolve(await npm(['root', '--global']));
    const packageRoot = path.resolve(readCliPackageRoot());
    const expected = path.join(root, PACKAGE);
    return packageRoot === expected || packageRoot.startsWith(`${expected}${path.sep}`);
  } catch { return false; }
}

export async function queryLatestStableVersion(): Promise<string> {
  const parsed = JSON.parse(await npm(['view', PACKAGE, 'version', '--json'])) as unknown;
  if (typeof parsed !== 'string' || !semver.valid(parsed) || semver.prerelease(parsed)) {
    throw new Error('npm returned an invalid stable version');
  }
  return parsed;
}

export async function checkForCliUpdate(homeDir?: string): Promise<UpdateInfo | null> {
  if (!(await isGlobalCliInstall())) return null;
  const config = await loadConfig({ homeDir });
  if (config.cliUpdate?.enabled === false) return null;
  const checkedAt = config.cliUpdate?.lastCheckedAt ? Date.parse(config.cliUpdate.lastCheckedAt) : 0;
  if (Number.isFinite(checkedAt) && Date.now() - checkedAt < CHECK_INTERVAL_MS) return null;
  const currentVersion = readCliVersion();
  const latestVersion = await queryLatestStableVersion();
  await saveConfig({ cliUpdate: { ...config.cliUpdate, lastCheckedAt: new Date().toISOString() } }, { homeDir });
  if (!semver.gt(latestVersion, currentVersion) ||
      (config.cliUpdate?.lastNotifiedVersion === latestVersion && sameUtcDay(config.cliUpdate.lastNotifiedAt))) return null;
  return { currentVersion, latestVersion };
}

export async function installCliVersion(version: string): Promise<void> {
  await npm(['install', '--global', `${PACKAGE}@${version}`], 120000);
}

async function markUpdateNotified(info: UpdateInfo, homeDir?: string): Promise<void> {
  const config = await loadConfig({ homeDir });
  await saveConfig({
    cliUpdate: {
      ...config.cliUpdate,
      lastNotifiedVersion: info.latestVersion,
      lastNotifiedAt: new Date().toISOString()
    }
  }, { homeDir });
}

export async function executeSelfUpdate(options: {
  homeDir?: string;
  confirmUpdate?: typeof confirm;
  noInput?: boolean;
} = {}): Promise<void> {
  const info = await checkForCliUpdate(options.homeDir);
  if (!info) { console.log(`ESL CLI is up to date (${readCliVersion()}).`); return; }
  await markUpdateNotified(info, options.homeDir);
  console.log(`ESL CLI update available: ${info.currentVersion} -> ${info.latestVersion}`);
  if (options.noInput || !isInteractive()) {
    console.log(`Run: npm install --global ${PACKAGE}@${info.latestVersion}`);
    return;
  }
  if (!(await (options.confirmUpdate ?? confirm)(`Install ESL CLI ${info.latestVersion} now?`))) return;
  try {
    await installCliVersion(info.latestVersion);
    const config = await loadConfig({ homeDir: options.homeDir });
    await saveConfig({
      cliUpdate: {
        ...config.cliUpdate,
        lastCheckedAt: new Date().toISOString(),
        lastNotifiedVersion: info.latestVersion,
        lastNotifiedAt: new Date().toISOString()
      }
    }, { homeDir: options.homeDir });
    console.log(`Updated ESL CLI to ${info.latestVersion}. Please run your command again.`);
  } catch (error) {
    console.error(`Could not update ESL CLI: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Run manually: npm install --global ${PACKAGE}@${info.latestVersion}`);
  }
}

export async function maybeNotifyCliUpdate(options: { homeDir?: string; json?: boolean; agentInteraction?: boolean }): Promise<void> {
  if (options.json || options.agentInteraction) return;
  try {
    const info = await checkForCliUpdate(options.homeDir);
    if (!info) return;
    const config = await loadConfig({ homeDir: options.homeDir });
    await saveConfig({ cliUpdate: { ...config.cliUpdate, lastNotifiedVersion: info.latestVersion, lastNotifiedAt: new Date().toISOString() } }, { homeDir: options.homeDir });
    console.error(`A newer ESL CLI is available (${info.currentVersion} -> ${info.latestVersion}). Run: npm install --global ${PACKAGE}@${info.latestVersion}`);
  } catch (error) {
    console.error(`ESL CLI update check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
