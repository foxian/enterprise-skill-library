import { z } from 'zod';
import type { ValidationResult } from './validation-result.js';

export const SkillNameSchema = z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/, {
  message: 'Skill name must follow @namespace/skill-name using lowercase letters, digits, and hyphens'
});

export const SemVerSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, {
  message: 'Version must be valid SemVer such as 1.0.0'
});

export const SkillJsonSchema = z.object({
  name: SkillNameSchema,
  version: SemVerSchema,
  description: z.string().min(1).max(1024),
  author: z.string().min(1),
  license: z.string().optional(),
  keywords: z.array(z.string().min(1)).optional(),
  compatibility: z
    .object({
      tools: z.array(z.string().min(1)).optional(),
      languages: z.array(z.string().min(1)).optional()
    })
    .optional(),
  dependencies: z.record(SkillNameSchema, z.string().min(1)).optional(),
  repository: z.string().min(1).optional()
});

export type SkillJson = z.infer<typeof SkillJsonSchema>;

export function validateSkillJson(data: unknown): ValidationResult<SkillJson> {
  const result = SkillJsonSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.join('.') || 'skill.json';
      return `${path}: ${issue.message}`;
    })
  };
}

export function parseSkillName(name: string): { scope: string; skillName: string } {
  const result = SkillNameSchema.safeParse(name);
  if (!result.success) {
    throw new Error('Skill name must follow @namespace/skill-name using lowercase letters, digits, and hyphens');
  }

  const [scope, skillName] = name.slice(1).split('/');
  return { scope, skillName };
}

export function createMinimalSkillManifest(input: {
  name: string;
  description: string;
  author: string;
}): SkillJson {
  return { name: input.name, version: '0.1.0', description: input.description, author: input.author, keywords: [] };
}
