import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron as electron } from 'playwright';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const packaged = !!process.env.BRAKE_DESKTOP_EXE;
const executablePath = packaged ? process.env.BRAKE_DESKTOP_EXE : require('electron');
assert.ok(path.isAbsolute(executablePath), 'The tested executable must have an absolute path');
const output = path.join(root, 'output', `${packaged ? 'desktop-packaged' : 'desktop'}-v${expectedVersion}`);
await fs.mkdir(output, { recursive: true });
const profile = await fs.mkdtemp(path.join(output, 'profile-'));
const env = { ...process.env, BRAKE_LAB_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const projectPath = path.join(output, '브레이크 실험.brake.json');
let app, page, saved, windowRestoration;
const checks = [], errors = [], remoteRequests = [];
const state = () => page.evaluate(() => window.brakeLab.getState());
const project = () => page.evaluate(() => window.brakeLab.project());
const observation = () => page.evaluate(() => {
  const r = document.querySelector('#scene').getBoundingClientRect(), panel = document.querySelector('.workbench');
  const p = panel.getBoundingClientRect(), clipped = getComputedStyle(panel).overflowY !== 'visible';
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right,
    viewportTop: clipped ? Math.max(0, p.top) : 0, viewportBottom: clipped ? Math.min(innerHeight, p.bottom) : innerHeight,
    viewportRight: document.documentElement.clientWidth, focus: document.activeElement.id,
    scroll: { x: scrollX, y: scrollY, panelTop: panel.scrollTop, panelLeft: panel.scrollLeft } };
});
const assertObservation = visible => {
  assert.ok(visible.top >= visible.viewportTop - 1 && visible.bottom <= visible.viewportBottom + 1
    && visible.left >= -1 && visible.right <= visible.viewportRight + 1, JSON.stringify(visible));
  assert.equal(visible.focus, 'scene');
};

async function waitFor(predicate, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(30); }
  throw new Error(`Timed out: ${label}`);
}
async function check(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`); }
async function launch() {
  app = await electron.launch({ executablePath, args: packaged ? [] : [root], env, timeout: 45000 });
  page = await app.firstWindow(); page.setDefaultTimeout(45000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
  await page.waitForFunction(() => window.brakeLab?.getState && document.querySelector('#scene canvas'), {}, { timeout: 45000 });
  await app.evaluate(({ BrowserWindow }) => {const window=BrowserWindow.getAllWindows()[0];window.setTitle('Brake Lab · 자동 검사');window.focus();});
  await page.evaluate(() => window.brakeLab.reset());
}
async function menu(group, label) {
  await app.evaluate(({ Menu }, names) => {
    const item = Menu.getApplicationMenu().items.find(value => value.label === names[0])?.submenu?.items.find(value => value.label === names[1]);
    if (!item || typeof item.click !== 'function') throw new Error(`Missing native menu: ${names.join(' > ')}`);
    item.click();
  }, [group, label]);
}
async function nativeShortcut(key, shift = false) {
  await app.evaluate(({ BrowserWindow }, payload) => {
    const window = BrowserWindow.getAllWindows()[0]; window.focus();
    const modifiers = payload.shift ? ['control', 'shift'] : ['control'];
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: payload.key, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: payload.key, modifiers });
  }, { key, shift });
}
async function saveDialog(filePath, canceled = false) {
  await app.evaluate(({ dialog }, payload) => {
    dialog.showSaveDialog = async (_window, options) => {
      globalThis.saveDialogCalls = (globalThis.saveDialogCalls || 0) + 1;
      globalThis.saveDialogOptions = options;
      return { canceled: payload.canceled, filePath: payload.filePath };
    };
  }, { filePath, canceled });
}
async function openDialog(filePath, canceled = false) {
  await app.evaluate(({ dialog }, payload) => {
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.openDialogCalls = (globalThis.openDialogCalls || 0) + 1;
      globalThis.openDialogOptions = options;
      return { canceled: payload.canceled, filePaths: payload.canceled ? [] : [payload.filePath] };
    };
  }, { filePath, canceled });
}
async function toast(pattern) {
  await waitFor(() => page.evaluate(p => new RegExp(p).test(document.querySelector('#toast')?.textContent || ''), pattern), `toast ${pattern}`);
}
async function savedFile(filePath = projectPath) {
  let result;
  await waitFor(async () => {
    try { result = JSON.parse(await fs.readFile(filePath, 'utf8')); return result.format === 'brake-lab-project'; }
    catch { return false; }
  }, 'native JSON save');
  return result;
}

try {
  await launch();
  await check('offline app origin, isolated bridge, sandbox, version and disposable test profile', async () => {
    assert.equal(page.url(), 'app://brake/');
    const bridge = await page.evaluate(() => ({ isDesktop: window.brakeDesktop?.isDesktop,
      keys: Object.keys(window.brakeDesktop).sort(), node: typeof window.require, process: typeof window.process,
      suspension: typeof window.suspensionDesktop, transmission: typeof window.transmissionDesktop,
      canvases: document.querySelectorAll('#scene canvas').length }));
    assert.equal(bridge.isDesktop, true); assert.equal(bridge.node, 'undefined'); assert.equal(bridge.process, 'undefined');
    assert.equal(bridge.suspension, 'undefined'); assert.equal(bridge.transmission, 'undefined'); assert.equal(bridge.canvases, 1);
    assert.deepEqual(bridge.keys, ['isDesktop', 'onCommand', 'openProject', 'saveProject', 'setBusy']);
    const native = await app.evaluate(({ BrowserWindow, app }) => {
      const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { name: app.name, version: app.getVersion(), data: app.getPath('userData'),
        contextIsolation: preferences.contextIsolation, sandbox: preferences.sandbox, nodeIntegration: preferences.nodeIntegration };
    });
    assert.equal(native.name, 'Brake Lab'); assert.equal(native.version, expectedVersion); assert.equal(native.data, profile);
    assert.equal(native.contextIsolation, true); assert.equal(native.sandbox, true); assert.equal(native.nodeIntegration, false);
    assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  });
  await check('remote fetch and popup are denied while bundled assets remain readable', async () => {
    const response = await page.evaluate(async () => ({
      denied: await fetch('https://example.com/').then(() => false).catch(() => true),
      local: await fetch('app://brake/index.html').then(result => result.ok),
      popup: window.open('https://example.com/') === null,
    }));
    assert.equal(response.denied, true); assert.equal(response.local, true);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    // Deliberate denied requests are excluded from application-origin error checks.
    errors.length = 0; remoteRequests.length = 0;
  });
  await check('SI pressure and live playback use the actual physical snapshot', async () => {
    const result = await page.evaluate(() => {
      window.brakeLab.setSettings({ speedKmh: 100, pressureBar: 60, road: 'high', abs: true });
      const s = window.brakeLab.advance(0.1);
      const pressureText = document.querySelector('#caliper-pressure').textContent;
      document.querySelector('#start').click();
      const before = window.brakeLab.getState().snapshot.time;
      window.advanceTime(300);
      const after = window.brakeLab.getState().snapshot.time;
      document.querySelector('#start').click();
      const paused = window.brakeLab.getState().snapshot.time;
      window.advanceTime(200);
      return { s, pressureText, before, after, paused, final: window.brakeLab.getState() };
    });
    assert.ok(result.s.pressure > 0 && result.s.pressure <= 60e5);
    assert.ok(result.pressureText.includes((result.s.pressure / 1e5).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })));
    assert.ok(Math.abs(result.after - result.before - 0.3 * 0.25) < 0.002);
    assert.equal(result.final.running, false); assert.equal(result.final.snapshot.time, result.paused);
  });
  await check('bundled component inspection, bearing motion and energy observations preserve experiment state', async () => {
    const before = await state(), saved = await project();
    await page.evaluate(() => window.brakeLab.selectPart('bearing'));
    await page.locator('#inspect-part').click();
    const inspected = await state();
    assert.equal(inspected.scene.inspection.active, true); assert.equal(inspected.scene.inspection.partId, 'bearing');
    assert.deepEqual(inspected.snapshot, before.snapshot);
    assert.equal(inspected.detail.bearing.cageAngle, inspected.scene.bearing.cageAngle);
    assert.equal(inspected.detail.bearing.innerAngle, inspected.snapshot.wheelAngle);
    assert.equal(await page.locator('#part-detail-facts .detail-fact').count(), 6);
    const energy = await page.locator('[data-energy-segment]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.joules)));
    assert.ok(Math.abs(energy.reduce((total, value) => total + value, 0) + inspected.snapshot.energyResidual - inspected.snapshot.initialEnergy) < 1e-7);
    await page.locator('#restore-inspection').click();
    const restored = await state(); assert.equal(restored.scene.inspection.active, false);
    for (const key of ['position', 'target']) restored.scene.cameraPose[key].forEach((value, index) => assert.ok(Math.abs(value - before.scene.cameraPose[key][index]) < 1e-9));
    assert.deepEqual((await project()).comparison, saved.comparison);
    await page.evaluate(id => window.brakeLab.selectPart(id), before.view.selectedPart);
  });
  await check('native play menu and shortcut return from comparison to 3D; Space pauses once without scroll and ignores inputs', async () => {
    await page.evaluate(() => { window.brakeLab.reset(); document.activeElement?.blur(); });
    const clockTime = new Date('2026-10-01T08:00:00Z');
    await page.clock.install({ time: clockTime }); await page.clock.pauseAt(new Date(clockTime.getTime() + 1000));
    try {
      await page.locator('#compare-abs').click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'comparison-summary');
      const captured = await project(), originalView = (await state()).view;
      await menu('실험', '제동 시작 / 일시정지'); await waitFor(async () => (await state()).running, 'menu play');
      assertObservation(await observation()); assert.deepEqual(await project(), captured); assert.deepEqual((await state()).view, originalView);
      await page.clock.runFor(400);assert((await state()).snapshot.time>0);
      const playingPosition = (await observation()).scroll;
      await page.keyboard.press('Space'); await waitFor(async () => !(await state()).running, 'Space pause');
      const pausedTime = (await state()).snapshot.time;
      assert.deepEqual((await observation()).scroll, playingPosition);
      assert.equal(await page.locator('#run-status').textContent(),'일시정지');assert.equal(await page.locator('#start').textContent(),'이어서 제동');
      await page.locator('#compare-abs').click();
      assert.equal(await page.evaluate(() => document.activeElement.id), 'comparison-summary');
      assert.equal((await state()).snapshot.time, pausedTime);
      await nativeShortcut('P', true); await waitFor(async () => (await state()).running, 'native shortcut play');
      assert.equal((await state()).snapshot.time, pausedTime); assertObservation(await observation());
      assert.equal(await page.locator('#run-status').textContent(),'제동 중');
      await page.clock.runFor(100); assert.ok((await state()).snapshot.time > pausedTime);
      const visiblePosition = (await observation()).scroll;
      await page.keyboard.press('Space'); await waitFor(async () => !(await state()).running, 'Space pause after resume');
      assert.deepEqual((await observation()).scroll, visiblePosition);
      const beforeResume = await state();
      await nativeShortcut('P', true); await waitFor(async () => (await state()).running, 'already visible native resume');
      assert.equal((await state()).snapshot.time, beforeResume.snapshot.time); assert.deepEqual((await observation()).scroll, visiblePosition);
      assert.deepEqual((await state()).view, originalView); assert.equal((await state()).scene.camera, beforeResume.scene.camera);
      await page.locator('[data-setting="speedKmh"]').focus(); await page.keyboard.press('Space');
      assert.equal((await state()).running, true);
      const beforeMenuPause = (await observation()).scroll;
      await menu('실험', '제동 시작 / 일시정지'); await waitFor(async () => !(await state()).running, 'menu pause');
      assert.deepEqual((await observation()).scroll, beforeMenuPause); assert.deepEqual(await project(), captured);
    } finally { await page.clock.resume(); }
    await menu('보기', '3D 크게 보기'); await waitFor(async () => (await state()).focused, 'native focus');
    const focusRecord=await project(),focusSettings=(await state()).settings;
    assert.equal(await page.locator('#focus-play').isVisible(),true);await page.locator('#focus-part').selectOption('pads');assert.equal((await state()).view.selectedPart,'pads');assert.equal(await page.locator('#focus-part-description').textContent(),await page.locator('#part-description').textContent());
    assert.equal(await page.locator('#focus-pressure-note').isVisible(),true);assert.match(await page.locator('#focus-pressure-note').textContent(),/처음부터/);
    await page.locator('#focus-pressure').evaluate(node=>{node.value='75';node.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal((await state()).settings.pressureBar,75);assert.equal((await state()).snapshot.time,0);assert.equal((await state()).running,false);
    await page.locator('#focus-rate').selectOption('0.5');await page.locator('#focus-play').click();await waitFor(async()=>(await state()).snapshot.time>.02,'focused playback');await page.locator('#focus-play').click();assert.equal((await state()).running,false);assert.equal(await page.locator('#focus-play').textContent(),'이어서 제동');assert.deepEqual((await project()).comparison,focusRecord.comparison);
    await page.screenshot({path:path.join(output,'native-expanded-controls.png')});await page.locator('#focus-pressure').evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},focusSettings.pressureBar);await page.locator('#focus-rate').selectOption('0.25');
    await menu('보기', '3D 크게 보기'); await waitFor(async () => !(await state()).focused, 'native focus return');
    await menu('도움말', '사용 안내'); await page.waitForFunction(() => document.querySelector('#help-dialog').open);
    await page.locator('#close-help').click();
  });
  await check('same-condition ABS result stays captured when the working settings change', async () => {
    await page.evaluate(() => window.brakeLab.setSettings({ speedKmh: 80, pressureBar: 60, road: 'medium', mass: 425, caliper: 'fixed' }));
    await page.locator('[data-mode="exploded"]').click(); await page.locator('#explode').fill('0.4'); await page.locator('#labels').uncheck();
    await page.locator('#compare-abs').click();
    await waitFor(async () => (await state()).hasComparison, 'captured comparison');
    const explanation = await page.evaluate(() => { const node=document.querySelector('#comparison-summary'),r=node.getBoundingClientRect();return {text:node.textContent,top:r.top,bottom:r.bottom,height:innerHeight,focus:document.activeElement.id}; });
    assert.ok(explanation.top>=0&&explanation.bottom<=explanation.height,JSON.stringify(explanation));
    assert.equal(explanation.focus,'comparison-summary');assert.match(explanation.text,/ABS/);assert.ok(explanation.text.length>30);
    const before = await project(); const savedEnergy=await page.locator('#comparison-energy').textContent();assert.match(savedEnergy,/kJ/);assert.match(savedEnergy,/°C/);assert.ok(before.comparison.withAbs.summary.stopped);
    await page.evaluate(() => window.brakeLab.setSettings({ pressureBar: 50 }));
    const after = await project(); assert.deepEqual(after.comparison, before.comparison);
    assert.equal(after.settings.pressureBar, 50); assert.equal(after.comparison.settings.pressureBar, 60);
    assert.ok(await page.locator('#comparison-note').textContent().then(text => text.includes('60 bar')));
    assert.equal(await page.locator('#comparison-energy').textContent(),savedEnergy);
    saved = after;
  });
  await check('native JSON save atomically replaces an existing file without changing conditions or records', async () => {
    await fs.writeFile(projectPath, 'previous file', 'utf8'); await saveDialog(projectPath);
    await menu('파일', '실험 저장…'); await toast('실험 파일을 저장했습니다');
    assert.deepEqual(await savedFile(), saved);
    assert.deepEqual(await project(), saved);
    assert.deepEqual((await fs.readdir(output)).filter(name => name.endsWith('.tmp')), []);
  });
  await check('save and open cancellation preserve the project and destination', async () => {
    const canceledPath = path.join(output, 'canceled.json'), before = await project();
    await saveDialog(canceledPath, true); await page.locator('#save-project').click();
    await delay(150); await assert.rejects(fs.access(canceledPath)); assert.deepEqual(await project(), before);
    await openDialog(projectPath, true); await page.locator('#open-project').click();
    await delay(150); assert.deepEqual(await project(), before);
  });
  await check('Ctrl+S and Ctrl+O each open one native dialog and restore exact captured results', async () => {
    await saveDialog(projectPath); await openDialog(projectPath);
    await app.evaluate(() => { globalThis.saveDialogCalls = 0; globalThis.openDialogCalls = 0; });
    await page.evaluate(() => document.activeElement?.blur()); await nativeShortcut('S');
    await waitFor(async () => await app.evaluate(() => globalThis.saveDialogCalls) === 1, 'native Ctrl+S');
    await toast('실험 파일을 저장했습니다'); await delay(100);
    assert.equal(await app.evaluate(() => globalThis.saveDialogCalls), 1);
    await page.evaluate(() => window.brakeLab.setSettings({ speedKmh: 120, pressureBar: 20 }));
    await page.locator('#clear-results').click(); await nativeShortcut('O');
    await toast('조건과 저장된 비교 결과를 복원했습니다'); await delay(100);
    assert.equal(await app.evaluate(() => globalThis.openDialogCalls), 1);
    assert.deepEqual(await project(), saved);
  });
  await check('invalid and future native project files are rejected atomically', async () => {
    const before = await project();
    for (const [name, contents, message] of [
      ['wrong-format.json', JSON.stringify({ format: 'other-app' }), '지원하지 않는'],
      ['future-project.json', JSON.stringify({ ...before, version: 2 }), '새로운 저장 형식'],
      ['future-model.json', JSON.stringify({ ...before, modelVersion: 'brake-2.0.0' }), '계산 모형'],
    ]) {
      const filePath = path.join(output, name); await fs.writeFile(filePath, contents, 'utf8'); await openDialog(filePath);
      await page.locator('#open-project').click(); await toast(message);
      assert.deepEqual(await project(), before); assert.equal(await fs.readFile(filePath, 'utf8'), contents);
    }
  });
  await check('native file byte limit and malformed save payload protect existing data', async () => {
    const before = await project(), original = await fs.readFile(projectPath, 'utf8');
    const largePath = path.join(output, 'oversized.json'); await fs.writeFile(largePath, Buffer.alloc(10 * 1024 * 1024 + 1, 32));
    await openDialog(largePath); await page.locator('#open-project').click(); await toast('10 MiB');
    assert.deepEqual(await project(), before);
    const rejected = await page.evaluate(async () => {
      const results = [];
      for (const contents of [42, 'invalid JSON']) results.push(await window.brakeDesktop.saveProject({ contents }).then(() => false).catch(() => true));
      return results;
    });
    assert.deepEqual(rejected, [true, true]); assert.equal(await fs.readFile(projectPath, 'utf8'), original);
  });
  await check('busy close prompt keeps the current window and preserved records', async () => {
    const before = await project(); await page.evaluate(() => window.brakeDesktop.setBusy(true)); await delay(50);
    await app.evaluate(({ dialog, BrowserWindow }) => {
      globalThis.originalMessageBox = dialog.showMessageBox;
      globalThis.busyClosePrompt = null;
      dialog.showMessageBox = async (_window, options) => { globalThis.busyClosePrompt = options; return { response: 0 }; };
      BrowserWindow.getAllWindows()[0].close();
    });
    await waitFor(async () => !!await app.evaluate(() => globalThis.busyClosePrompt), 'busy close protection');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    assert.deepEqual(await project(), before); await page.evaluate(() => window.brakeDesktop.setBusy(false));
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = globalThis.originalMessageBox; });
  });
  await check('second launch restores and focuses the existing single window', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await new Promise((resolve, reject) => {
      const child = spawn(executablePath, packaged ? [] : [root], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { child.kill(); reject(new Error('Duplicate process did not exit')); }, 30000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Duplicate launch exit ${code}`)); });
    });
    await waitFor(() => app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows(); return windows.length === 1 && !windows[0].isMinimized() && windows[0].isFocused();
    }), 'single-window restore');
    assert.deepEqual(await project(), saved);
  });
  await check('reload and full relaunch retain settings, original comparison and saved window dimensions', async () => {
    assert.deepEqual(await project(), saved);
    const display = await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window.isMaximized()) window.unmaximize();
      const current = window.getNormalBounds(), display = screen.getDisplayMatching(current);
      return { bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor,
        minimumSize: window.getMinimumSize(), current };
    });
    const area = display.workArea, [minWidth, minHeight] = display.minimumSize;
    assert(area.width >= minWidth && area.height >= minHeight, 'The display must accommodate the application minimum size');
    // Use integer DIP and physical-pixel edges. A half-pixel origin at fractional
    // DPI can expand the native outer frame before this persistence test begins.
    const gridStep = Array.from({ length: 100 }, (_, index) => index + 1)
      .find(step => Math.abs(step * display.scaleFactor - Math.round(step * display.scaleFactor)) < 1e-7);
    assert(gridStep, 'The display scale must have a usable integer DIP/physical-pixel grid');
    const sizeOnGrid = (preferred, minimum, available) => {
      const target = Math.max(minimum, Math.min(preferred, available - 32));
      const value = Math.max(Math.ceil(minimum / gridStep), Math.floor(target / gridStep)) * gridStep;
      assert(value <= available, 'The display must fit an aligned test size');
      return value;
    };
    const positionOnGrid = (origin, start, available, size) => {
      const first = Math.ceil((start - origin) / gridStep), last = Math.floor((start + available - size - origin) / gridStep);
      assert(first <= last, 'The work area must fit an aligned test position');
      const center = Math.floor((start + (available - size) / 2 - origin) / gridStep);
      return origin + Math.max(first, Math.min(center, last)) * gridStep;
    };
    const requested = {
      width: sizeOnGrid(1050, minWidth, area.width),
      height: sizeOnGrid(780, minHeight, area.height),
    };
    requested.x = positionOnGrid(display.bounds.x, area.x, area.width, requested.width);
    requested.y = positionOnGrid(display.bounds.y, area.y, area.height, requested.height);
    windowRestoration = { display, gridStep, requested };
    await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), requested);
    const stableBounds = async label => {
      let bounds, previousBounds, stableSamples = 0;
      await waitFor(async () => {
        bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds());
        stableSamples = JSON.stringify(bounds) === JSON.stringify(previousBounds) ? stableSamples + 1 : 0;
        previousBounds = bounds;
        return stableSamples >= 2;
      }, label);
      return bounds;
    };
    const bounds = await stableBounds('stable native window rectangle');
    windowRestoration.beforeReload = bounds;
    assert.equal(bounds.width, requested.width, 'Native width differs from the selected valid size');
    assert.equal(bounds.height, requested.height, 'Native height differs from the selected valid size');
    assert(bounds.width >= minWidth && bounds.height >= minHeight);
    assert(bounds.width <= area.width && bounds.height <= area.height, 'Saved dimensions must fit the display work area');
    assert(bounds.x >= area.x && bounds.y >= area.y);
    assert(bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
    await page.reload(); await page.waitForFunction(() => window.brakeLab?.getState && document.querySelector('#scene canvas'));
    assert.deepEqual(await project(), saved);
    const afterReload = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds());
    windowRestoration.afterReload = afterReload;
    assert.deepEqual(afterReload, bounds, 'Reload must keep the selected window rectangle');
    await app.close(); app = null;
    const recordedBounds = JSON.parse(await fs.readFile(path.join(profile,'window.json'),'utf8'));
    windowRestoration.saved = recordedBounds;
    assert.equal(recordedBounds.maximized, false);
    assert.equal(recordedBounds.width, bounds.width); assert.equal(recordedBounds.height, bounds.height);
    await launch();
    assert.deepEqual(await project(), saved);
    const restored = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds());
    windowRestoration.restored = restored;
    assert.equal(restored.width, recordedBounds.width); assert.equal(restored.height, recordedBounds.height);
    // Keep an arbitrary, potentially half-physical-pixel position as well. The
    // initial native frame may quantize the requested size, but saving that actual
    // rectangle must not add another pixel on either of the next two restarts.
    const offsetPosition = (position, start, available, size) => position + size + 2 <= start + available
      ? position + 1 : position - 1 >= start ? position - 1 : position;
    const arbitrary = { ...requested,
      x: offsetPosition(requested.x, area.x, area.width, requested.width),
      y: offsetPosition(requested.y, area.y, area.height, requested.height) };
    windowRestoration.arbitraryPosition = { requested: arbitrary, cycles: [] };
    await app.evaluate(({ BrowserWindow }, target) => BrowserWindow.getAllWindows()[0].setBounds(target), arbitrary);
    const originalRectangle = await stableBounds('stable arbitrary-position native rectangle');
    windowRestoration.arbitraryPosition.initialActual = originalRectangle;
    assert(Math.abs(originalRectangle.width - arbitrary.width) <= 1, 'Initial native width quantization exceeds one DIP');
    assert(Math.abs(originalRectangle.height - arbitrary.height) <= 1, 'Initial native height quantization exceeds one DIP');
    assert(originalRectangle.x >= area.x && originalRectangle.y >= area.y);
    assert(originalRectangle.x + originalRectangle.width <= area.x + area.width
      && originalRectangle.y + originalRectangle.height <= area.y + area.height);
    let beforeClose = originalRectangle;
    for (let restart = 1; restart <= 2; restart++) {
      const cycle = { restart, beforeClose };
      windowRestoration.arbitraryPosition.cycles.push(cycle);
      assert.deepEqual(await project(), saved);
      await app.close(); app = null;
      cycle.saved = JSON.parse(await fs.readFile(path.join(profile, 'window.json'), 'utf8'));
      assert.equal(cycle.saved.maximized, false);
      for (const axis of ['x', 'y', 'width', 'height']) {
        assert.equal(cycle.saved[axis], beforeClose[axis], `Restart ${restart}: saved ${axis} differs from the actual window`);
      }
      await launch();
      assert.deepEqual(await project(), saved);
      cycle.restored = await stableBounds(`stable arbitrary-position rectangle after restart ${restart}`);
      for (const axis of ['x', 'y', 'width', 'height']) {
        assert.equal(cycle.restored[axis], cycle.saved[axis], `Restart ${restart}: restored ${axis} differs from the saved value`);
        assert.equal(cycle.restored[axis], originalRectangle[axis], `Restart ${restart}: arbitrary-position ${axis} accumulated drift`);
      }
      beforeClose = cycle.restored;
    }
    await page.screenshot({ path: path.join(output, 'native-app-restarted.png') });
  });
  await check('new experiment command clears comparisons and restores default input values', async () => {
    await page.locator('[data-caliper="fixed"]').click();
    assert.equal(await page.locator('[data-part="slide-pins"]').count(),0);
    await menu('파일', '새 실험'); await waitFor(async () => !(await state()).hasComparison, 'new experiment');
    const current = await state(); assert.equal(current.settings.speedKmh, 100); assert.equal(current.settings.pressureBar, 60);
    assert.equal(current.settings.caliper, 'floating'); assert.equal(current.snapshot.time, 0); assert.equal(current.running, false);
    assert.equal(await page.locator('[data-setting="speedKmh"]').inputValue(), '100');
    assert.equal(await page.locator('[data-setting="pressureBar"]').inputValue(), '60');
    assert.equal(await page.locator('[data-part="slide-pins"]').count(),1);
  });
  await check('corrupt automatic-save original can be exported through the native download flow', async () => {
    const raw='{native original preserved verbatim';
    await page.evaluate(value=>localStorage.setItem('brake-lab-project-v1',value),raw);
    await page.reload();await page.waitForFunction(()=>window.brakeLab?.getState&&document.querySelector('#recover-original')&&!document.querySelector('#storage-recovery').hidden);
    const target=path.join(output,'native-recovered-original.txt');
    await app.evaluate(({session},filename)=>{globalThis.brakeTestDownload=null;session.defaultSession.once('will-download',(_event,item)=>{item.setSavePath(filename);item.once('done',(_event,status)=>{globalThis.brakeTestDownload=status;});});},target);
    await page.locator('#recover-original').click();await waitFor(()=>app.evaluate(()=>globalThis.brakeTestDownload==='completed'),'native original export');
    assert.equal(await fs.readFile(target,'utf8'),raw);
    assert(await page.evaluate(value=>Object.keys(localStorage).some(key=>key.startsWith('brake-lab-project-v1-original-')&&localStorage.getItem(key)===value),raw));
  });
  await check('final application has no JavaScript errors or remote application content', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  });
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ version: expectedVersion, packaged,
    executablePath, profile, checks, errors, remoteRequests, windowRestoration, state: await state() }, null, 2));
  console.log(`Desktop validation: ${checks.length} checks passed.`);
} catch (error) {
  const diagnostic = page ? await page.evaluate(() => ({ toast: document.querySelector('#toast')?.textContent,
    state: window.brakeLab?.getState() })).catch(() => null) : null;
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, checks,
    errors, remoteRequests, windowRestoration, diagnostic }, null, 2));
  throw error;
} finally { if (app) { await page?.evaluate(() => window.brakeDesktop?.setBusy(false)).catch(() => {}); await app.close().catch(() => {}); } }
