import { validateSkillSourceDirectory } from '@esl/core';

export async function executeValidate(directory = process.cwd()): Promise<{ valid: boolean; errors: string[] }> {
  const result = await validateSkillSourceDirectory(directory);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return { valid: false, errors: result.errors };
}