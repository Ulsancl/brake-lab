import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const packagerRequire = createRequire(require.resolve('app-builder-lib/package.json'));
const { getCurrentFuseWire, FuseV1Options } = packagerRequire('@electron/fuses');
const { FuseState } = packagerRequire('@electron/fuses/dist/constants');
const root = path.resolve(import.meta.dirname, '..');
const executable = path.join(root, 'release/windows/win-unpacked/Brake Lab.exe');
const { version } = require('../package.json');

async function verifyPage(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', event => { if (event.type() === 'error') errors.push(event.text()); });
  await page.locator('#scene canvas').waitFor({ state: 'visible' });
  assert.deepEqual(await page.evaluate(() => [typeof window.brakeLab, typeof window.advanceTime,
    typeof window.render_game_to_text]), ['undefined', 'undefined', 'undefined']);
  assert.equal(await page.locator('.header-note span').textContent(), '버전 ' + version);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /worker-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  await page.locator('#compare-abs').click();
  await page.locator('#comparison-summary').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#result-rows tr').count(), 2);
  assert.deepEqual(errors, []);
}

const server = await preview({ root, preview: { host: '127.0.0.1', port: 0 } });
try {
  const web = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    const page = await web.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto('http://127.0.0.1:' + server.httpServer.address().port);
    await verifyPage(page);
    console.log('Production web bundle: CSP, version, rendered scene and comparison worker verified.');
  } finally { await web.close(); }
} finally { await server.close(); }

const fuses = await getCurrentFuseWire(executable);
for (const name of ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments',
  'GrantFileProtocolExtraPrivileges']) assert.equal(fuses[FuseV1Options[name]], FuseState.DISABLE, name);
for (const name of ['EnableEmbeddedAsarIntegrityValidation', 'OnlyLoadAppFromAsar']) {
  assert.equal(fuses[FuseV1Options[name]], FuseState.ENABLE, name);
}

const fixture = await mkdtemp(path.join(os.tmpdir(), 'brake-production-'));
const ignoredProfile = path.join(fixture, 'legacy-override');
await mkdir(ignoredProfile);
const env = { ...process.env, BRAKE_LAB_DATA_DIR: ignoredProfile };
delete env.ELECTRON_RUN_AS_NODE;
// The production exe has no Node inspector. Use Chromium's loopback debugging
// endpoint only to drive the same controls a user sees.
const child = spawn(executable, ['--remote-debugging-port=0', '--enable-logging=stderr', '--enable-unsafe-swiftshader'],
  { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
const closed = once(child, 'close').catch(() => {});
let desktop;
try {
  let logs = '';
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Desktop debugging endpoint did not start\n' + logs)), 30_000);
    child.stderr.on('data', bytes => {
      logs = (logs + bytes.toString()).slice(-4096);
      const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/.exec(logs);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); reject(new Error('Desktop exited ' + code + '\n' + logs)); });
  });
  desktop = await chromium.connectOverCDP(endpoint, { timeout: 30_000 });
  const [context] = desktop.contexts();
  const page = context.pages()[0] || await context.waitForEvent('page', { timeout: 30_000 });
  await page.waitForURL('app://brake/');
  await verifyPage(page);
  assert.equal(await page.evaluate(() => window.brakeDesktop.isDesktop), true);
  assert.deepEqual(await readdir(ignoredProfile), []);
  console.log('Production Windows executable: hardened fuses, ASAR startup, renderer and comparison worker verified.');
} finally {
  if (desktop) await desktop.close();
  if (child.exitCode === null) child.kill();
  await closed;
  await rm(fixture, { recursive: true, force: true });
}
