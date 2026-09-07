import fs from 'node:fs/promises';
import path from 'node:path';
import { createMinimalReleaseManifest } from '@esl/core';
import { notify } from '../output.js';

export interface ManifestOptions {
  license?: string;
}

export const DEFAULT_LICENSE = 'MIT';

export async function ensureReleaseManifest(options: ManifestOptions, directory: string): Promise<void> {
  const license = options.license ?? DEFAULT_LICENSE;
  if (!options.license) {
    notify(`release.json is missing; creating it with the default license ${license} (pass --license to override).`);
  }
  const releaseJson = createMinimalReleaseManifest(license);
  await fs.writeFile(path.join(directory, 'release.json'), `${JSON.stringify(releaseJson, null, 2)}\n`, 'utf8');
}
