import fs from 'node:fs/promises';
import path from 'node:path';
import { createMinimalReleaseManifest } from '@esl/core';
import { isInteractive, readText } from '../prompt.js';

export interface ManifestOptions {
  license?: string;
  noInput?: boolean;
}

export async function ensureReleaseManifest(options: ManifestOptions, directory: string): Promise<void> {
  const license = await resolveLicense(options);
  const releaseJson = createMinimalReleaseManifest(license);
  await fs.writeFile(path.join(directory, 'release.json'), `${JSON.stringify(releaseJson, null, 2)}\n`, 'utf8');
}

export async function resolveLicense(options: ManifestOptions): Promise<string> {
  if (options.license) {
    return options.license;
  }
  if (options.noInput || !isInteractive()) {
    throw new Error('Missing release.json: a license is required to create release.json; pass --license or run interactively');
  }
  const license = (await readText('Missing release.json. SPDX license for the new manifest: ')).trim();
  if (!license) {
    throw new Error('Missing release.json: a license is required to create release.json');
  }
  return license;
}