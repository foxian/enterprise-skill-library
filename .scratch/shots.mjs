import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5173/admin';
const OUT = new URL('./shots/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900']
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });

// 1. 登录页
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
await page.waitForSelector('[data-test="login-submit"]');
await shot('01-login');

// 2. 填表登录(super)
await page.type('[data-test="username"]', 'eslroot');
await page.type('[data-test="password"]', '123456123456');
await page.click('[data-test="login-submit"]');
await page.waitForSelector('.console-shell', { timeout: 15000 });
await page.waitForNetworkIdle();
await shot('02-super-dashboard');

// 3. super 各页
for (const [name, path] of [
  ['03-super-orgs', '/super/orgs'],
  ['04-super-applications', '/super/applications'],
  ['05-super-settings', '/super/settings']
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.console-shell');
  await shot(name);
}

// 4. 用户下拉菜单展开态
await page.goto(`${BASE}/super/dashboard`, { waitUntil: 'networkidle0' });
await page.waitForSelector('[data-test="user-dropdown"]');
await page.click('[data-test="user-dropdown"]');
await page.waitForSelector('[data-test="change-password"]', { visible: true, timeout: 5000 });
await shot('06-user-dropdown');

// 5. 菜单 hover 态
await page.keyboard.press('Escape');
await page.hover('.console-shell .el-aside .el-menu-item:nth-child(2)');
await new Promise((r) => setTimeout(r, 300));
await shot('07-menu-hover');

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

await browser.close();
console.log('DONE, console errors:', errors.length ? errors : 'none');
