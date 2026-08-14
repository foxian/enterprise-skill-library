import { describe, expect, it, vi } from 'vitest';
import { executeInfo, executeSearch, formatSkillInfo } from '../src/index.js';

describe('network CLI commands', () => {
  it('searches skills via API server', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ name: '@myorg/my-skill', description: 'Test skill' }]
    });

    const results = await executeSearch('test', {
      server: 'http://skills.company.com',
      customFetch: mockFetch as any
    });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('@myorg/my-skill');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/skills/search?q=test',
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('fetches skill info via API server', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@myorg/my-skill', versions: ['0.1.0'] })
    });

    const result = await executeInfo('@myorg/my-skill', {
      server: 'http://skills.company.com',
      customFetch: mockFetch as any
    });

    expect(result.name).toBe('@myorg/my-skill');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://skills.company.com/api/skills/%40myorg%2Fmy-skill',
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('formats skill info for humans with core fields', () => {
    const result = formatSkillInfo({
      name: '@myorg/my-skill',
      description: 'A test skill',
      versions: ['1.0.0', '0.9.0'],
      gitRepoPath: 'esl-skills/myorg_my-skill'
    });

    expect(result).toBe(
      'Name: @myorg/my-skill\nDescription: A test skill\nVersions: 1.0.0, 0.9.0\nRepository: esl-skills/myorg_my-skill'
    );
  });

  it('omits absent fields in human info', () => {
    expect(formatSkillInfo({ name: '@myorg/my-skill' })).toBe('Name: @myorg/my-skill');
  });
});
