import { describe, expect, it, vi } from 'vitest';

import { checkGitBackendMaintenanceEntry } from '../scripts/check-git-backend-maintenance-entry.mjs';

describe('Git Backend Maintenance Entry smoke check', () => {
  it('checks the maintenance entry through ESL Server /git paths', async () => {
    const requestedUrls = [];
    const fetch = vi.fn(async (url) => {
      requestedUrls.push(url);
      if (url === 'http://localhost:3000/git/user/login') {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <link rel="stylesheet" href="/git/assets/css/index.css?v=1.22.6">
            <script src="/git/assets/js/index.js?v=1.22.6"></script>
            <img src="/git/assets/img/logo.svg">
          `
        };
      }
      return { ok: true, status: 200, text: async () => '' };
    });

    await checkGitBackendMaintenanceEntry({
      baseUrl: 'http://localhost:3000',
      fetch
    });

    expect(requestedUrls).toEqual([
      'http://localhost:3000/health',
      'http://localhost:3000/api/auth/login',
      'http://localhost:3000/git/user/login',
      'http://localhost:3000/git/assets/css/index.css?v=1.22.6',
      'http://localhost:3000/git/assets/js/index.js?v=1.22.6',
      'http://localhost:3000/git/assets/img/logo.svg'
    ]);
  });

  it('fails when a representative asset is unavailable', async () => {
    const fetch = vi.fn(async (url) => {
      if (url === 'http://localhost:3000/git/user/login') {
        return {
          ok: true,
          status: 200,
          text: async () => `
            <link rel="stylesheet" href="/git/assets/css/index.css?v=1.22.6">
            <script src="/git/assets/js/index.js?v=1.22.6"></script>
            <img src="/git/assets/img/logo.svg">
          `
        };
      }
      return {
        ok: !url.endsWith('/git/assets/js/index.js?v=1.22.6'),
        status: url.endsWith('/git/assets/js/index.js?v=1.22.6') ? 404 : 200,
        text: async () => ''
      };
    });

    await expect(
      checkGitBackendMaintenanceEntry({
        baseUrl: 'http://localhost:3000',
        fetch
      })
    ).rejects.toThrow('GET http://localhost:3000/git/assets/js/index.js?v=1.22.6 returned 404');
  });

  it('fails when the login page does not reference a representative asset type', async () => {
    const fetch = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      text: async () => (url === 'http://localhost:3000/git/user/login' ? '<script src="/git/assets/js/index.js"></script>' : '')
    }));

    await expect(
      checkGitBackendMaintenanceEntry({
        baseUrl: 'http://localhost:3000',
        fetch
      })
    ).rejects.toThrow('Login page did not reference a CSS asset');
  });
});
