import { validateSkillDirectory } from '@esl/core';

export async function executeValidate(directory = process.cwd()): Promise<{ valid: boolean; errors: string[] }> {
  const result = await validateSkillDirectory(directory);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return { valid: false, errors: result.errors };
}
