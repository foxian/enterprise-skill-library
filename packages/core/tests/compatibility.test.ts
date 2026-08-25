import { describe, expect, it, vi } from 'vitest';
import { evaluateCompatibility } from '../src/schema/compatibility.js';

describe('compatibility evaluation', () => {
  it('reports a missing required tool', async () => {
    const execFileAsync = vi.fn().mockRejectedValue(new Error('not found'));

    const result = await evaluateCompatibility(
      { tools: ['required-tool'] },
      { execFileAsync: execFileAsync as any, platform: 'linux' }
    );

    expect(result).toEqual({
      compatible: false,
      missingTools: ['required-tool'],
      unsupportedLanguages: []
    });
  });

  it('accepts installed required tools and supported runtimes', async () => {
    const execFileAsync = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

    const result = await evaluateCompatibility(
      { tools: ['git'], languages: ['node', 'python'] },
      { execFileAsync: execFileAsync as any, platform: 'linux' }
    );

    expect(result.compatible).toBe(true);
    expect(result.missingTools).toEqual([]);
    expect(result.unsupportedLanguages).toEqual([]);
  });
});
