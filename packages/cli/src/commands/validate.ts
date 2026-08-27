import { fileExists, validateSkillDirectory, validateSkillSourceDirectory } from '@esl/core';
import path from 'node:path';

export async function executeValidate(directory = process.cwd()): Promise<{ valid: boolean; errors: string[] }> {
  const result = (await fileExists(path.join(directory, 'release.json')))
    ? await validateSkillSourceDirectory(directory)
    : await validateSkillDirectory(directory);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return { valid: false, errors: result.errors };
}