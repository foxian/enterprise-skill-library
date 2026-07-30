import { describe, expect, it, vi } from 'vitest';
import { executeInfo, executeSearch } from '../src/index.js';

describe('network CLI commands', () => {
  it('searches skills via API server', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ name: '@myorg/my-skill', description: 'Test skill' }]
    });

    const results = await executeSearch('test', {
      registry: 'http://skills.company.com/api',
      customFetch: mockFetch as any
    });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('@myorg/my-skill');
    expect(mockFetch).toHaveBeenCalledWith('http://skills.company.com/api/skills/search?q=test');
  });

  it('fetches skill info via API server', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: '@myorg/my-skill', versions: ['0.1.0'] })
    });

    const result = await executeInfo('@myorg/my-skill', {
      registry: 'http://skills.company.com/api',
      customFetch: mockFetch as any
    });

    expect(result.name).toBe('@myorg/my-skill');
    expect(mockFetch).toHaveBeenCalledWith('http://skills.company.com/api/skills/%40myorg%2Fmy-skill');
  });
});
