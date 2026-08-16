import { fileURLToPath } from 'node:url';

const DEFAULT_BASE_URL = 'http://localhost:3000';

const STATIC_ASSET_TYPES = [
  { name: 'CSS', pattern: /\.css(?:[?#].*)?$/ },
  { name: 'JavaScript', pattern: /\.js(?:[?#].*)?$/ },
  { name: 'image', pattern: /\.(?:svg|png|jpg|jpeg|webp)(?:[?#].*)?$/ }
];

export async function checkGitBackendMaintenanceEntry({
  baseUrl = DEFAULT_BASE_URL,
  fetch = globalThis.fetch
} = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('A fetch implementation is required');
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');

  await expectSuccessfulResponse(fetch, `${normalizedBaseUrl}/health`);
  await expectApiBoundaryResponse(fetch, `${normalizedBaseUrl}/api/auth/login`);

  const loginUrl = `${normalizedBaseUrl}/git/user/login`;
  const loginResponse = await expectSuccessfulResponse(fetch, loginUrl);
  const loginHtml = await loginResponse.text();
  const assetUrls = discoverRepresentativeAssets(loginHtml, normalizedBaseUrl);

  for (const assetUrl of assetUrls) {
    await expectSuccessfulResponse(fetch, assetUrl);
  }
}

async function expectSuccessfulResponse(fetch, url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status}`);
  }
  return response;
}

async function expectApiBoundaryResponse(fetch, url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (response.status >= 500) {
    throw new Error(`GET ${url} returned ${response.status}`);
  }
  return response;
}

function discoverRepresentativeAssets(html, baseUrl) {
  return STATIC_ASSET_TYPES.map(({ name, pattern }) => {
    const assetPath = discoverFirstAssetPath(html, pattern);
    if (!assetPath) {
      throw new Error(`Login page did not reference a ${name} asset`);
    }
    return new URL(assetPath, baseUrl).href;
  });
}

function discoverFirstAssetPath(html, pattern) {
  const attributePattern = /\b(?:href|src)="([^"]+)"/g;
  for (const match of html.matchAll(attributePattern)) {
    const assetPath = match[1];
    if (assetPath.startsWith('/git/') && pattern.test(assetPath)) {
      return assetPath;
    }
  }
  return null;
}

async function main() {
  const baseUrl = process.argv[2] ?? process.env.ESL_SERVER_URL ?? DEFAULT_BASE_URL;
  await checkGitBackendMaintenanceEntry({ baseUrl });
  console.log(`Git Backend Maintenance Entry is reachable through ${baseUrl.replace(/\/+$/, '')}/git`);
}

function isDirectRun(moduleUrl, argvPath) {
  if (!argvPath) {
    return false;
  }

  return normalizePath(fileURLToPath(moduleUrl)) === normalizePath(argvPath);
}

function normalizePath(path) {
  return path.replace(/\\/g, '/').replace(/^\/([A-Za-z]:\/)/, '$1');
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
