import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ValidationResult } from './validation-result.js';
import { validateSkillMd, type SkillMdMetadata } from '../skill/skill-md.js';

const SpdxLicenseSchema = z.string().regex(
  /^(?:MIT|Apache-2\.0|BSD-[234]-Clause|ISC|MPL-2\.0|GPL-[23]\.0|LGPL-[23]\.0|AGPL-[23]\.0)(?:\s+(?:AND|OR)\s+(?:MIT|Apache-2\.0|BSD-[234]-Clause|ISC|MPL-2\.0|GPL-[23]\.0|LGPL-[23]\.0|AGPL-[23]\.0))*$/,
  { message: 'license must be an SPDX expression or LicenseRef-* identifier' }
);

const LicenseSchema = z.union([
  SpdxLicenseSchema,
  z.string().regex(/^LicenseRef-[A-Za-z0-9.-]+$/, {
    message: 'license must be an SPDX expression or LicenseRef-* identifier'
  })
]);

export const ReleaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  license: LicenseSchema,
  keywords: z.array(z.string().min(1)),
  compatibility: z.object({
    tools: z.array(z.string().min(1)).optional(),
    languages: z.array(z.string().min(1)).optional()
  }),
  dependencies: z.record(z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/), z.string().min(1))
}).strict();

export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

export function createMinimalReleaseManifest(license: string): ReleaseManifest {
  return { schemaVersion: 1, license, keywords: [], compatibility: {}, dependencies: {} };
}

export function validateReleaseManifest(data: unknown): ValidationResult<ReleaseManifest> {
  const result = ReleaseManifestSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const field = issue.path.join('.') || 'release.json';
      return `${field}: ${issue.message}`;
    })
  };
}

export interface SkillSourceDirectory {
  directory: string;
  skillMd: SkillMdMetadata;
  releaseManifest: ReleaseManifest;
}

export async function validateSkillSourceDirectory(
  directory: string
): Promise<ValidationResult<SkillSourceDirectory>> {
  const resolved = path.resolve(directory);
  const skillMdPath = path.join(resolved, 'SKILL.md');
  const releaseManifestPath = path.join(resolved, 'release.json');
  const errors: string[] = [];

  let skillMd: SkillMdMetadata | undefined;
  let releaseManifest: ReleaseManifest | undefined;

  try {
    const validation = validateSkillMd(await fs.readFile(skillMdPath, 'utf8'));
    if (validation.success) skillMd = validation.data;
    else errors.push(...validation.errors);
  } catch {
    errors.push('SKILL.md: file is required');
  }

  try {
    const parsed = JSON.parse(await fs.readFile(releaseManifestPath, 'utf8')) as unknown;
    const validation = validateReleaseManifest(parsed);
    if (validation.success) releaseManifest = validation.data;
    else errors.push(...validation.errors);
  } catch {
    errors.push('release.json: file is required and must contain valid JSON');
  }

  if (errors.length > 0 || !skillMd || !releaseManifest) {
    return { success: false, errors };
  }
  return { success: true, data: { directory: resolved, skillMd, releaseManifest } };
}
