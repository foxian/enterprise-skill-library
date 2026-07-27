import YAML from 'yaml';
import { z } from 'zod';
import type { ValidationResult } from '../schema/validation-result.js';

const SkillMdMetadataSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9-]{1,64}$/, {
      message: 'SKILL.md name must use lowercase letters, digits, and hyphens'
    }),
    description: z.string().min(1).max(1024)
  })
  .strict();

export type SkillMdMetadata = z.infer<typeof SkillMdMetadataSchema>;

export function validateSkillMd(content: string): ValidationResult<SkillMdMetadata> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { success: false, errors: ['SKILL.md: missing YAML frontmatter'] };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(match[1]);
  } catch (error) {
    return { success: false, errors: [`SKILL.md: invalid YAML frontmatter: ${(error as Error).message}`] };
  }

  const result = SkillMdMetadataSchema.safeParse(parsed);
  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.join('.') || 'frontmatter';
      return `SKILL.md ${path}: ${issue.message}`;
    })
  };
}
