import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CompatibilityRequirements {
  tools?: string[];
  languages?: string[];
}

export interface CompatibilityResult {
  compatible: boolean;
  missingTools: string[];
  unsupportedLanguages: string[];
}

export async function evaluateCompatibility(
  requirements: CompatibilityRequirements,
  options: { execFileAsync?: typeof execFileAsync; platform?: string; nodeVersion?: string } = {}
): Promise<CompatibilityResult> {
  const runner = options.execFileAsync ?? execFileAsync;
  const missingTools: string[] = [];
  for (const tool of requirements.tools ?? []) {
    try {
      await runner(process.platform === 'win32' ? 'where' : 'which', [tool]);
    } catch {
      missingTools.push(tool);
    }
  }

  const platform = options.platform ?? process.platform;
  const supportedLanguages = new Set<string>(['node', 'nodejs', 'javascript', 'typescript']);
  if (platform === 'win32') supportedLanguages.add('powershell');
  const unsupportedLanguages: string[] = [];
  for (const language of requirements.languages ?? []) {
    const normalized = language.toLowerCase();
    if (supportedLanguages.has(normalized)) continue;
    if (normalized === 'python') {
      let found = false;
      for (const candidate of ['python', 'python3']) {
        try {
          await runner(process.platform === 'win32' ? 'where' : 'which', [candidate]);
          found = true;
          break;
        } catch {
        }
      }
      if (found) continue;
    }
    unsupportedLanguages.push(language);
  }

  return {
    compatible: missingTools.length === 0 && unsupportedLanguages.length === 0,
    missingTools,
    unsupportedLanguages
  };
}
