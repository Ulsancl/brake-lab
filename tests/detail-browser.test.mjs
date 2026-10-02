import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
const output = path.join(root, 'output', 'detail-browser');
const address = 'http://127.0.0.1:5242';
const checks = [], errors = [], evidence = [];
let server, browser, page;
const near = (actual, expected, tolerance = 1e-9) => assert.ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const angleNear = (actual, expected) => near(Math.atan2(Math.sin(actual - expected), Math.cos(actual - expected)), 0);
const cameraNear = (actual, expected) => {
  for (const key of ['position', 'target']) actual[key].forEach((value, index) => near(value, expected[key][index], 1e-10));
};
const state = () => page.evaluate(() => window.brakeLab.getState());
const project = () => page.evaluate(() => window.brakeLab.project());
const setSettings = patch => page.evaluate(patch => window.brakeLab.setSettings(patch), patch);
const advance = seconds => page.evaluate(seconds => window.brakeLab.advance(seconds), seconds);
async function check(name, action) {
  try { await action(); checks.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) {
    checks.push({ name, passed: false, error: error.message });
    await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  }
}
async function select(id) {
  await page.locator(`#parts-list [data-part="${id}"]`).click();
  assert.equal((await state()).view.selectedPart, id);
  assert.equal((await state()).scene.selectedPart, id);
}
const facts = (focus = false) => page.locator(focus ? '#focus-detail-facts .detail-fact' : '#part-detail-facts .detail-fact').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.label || node.querySelector('dt').textContent, node.querySelector('dd').textContent.trim()])));
function numericFact(rows, label, expected, digits = 1) {
  assert.ok(Object.hasOwn(rows, label), `Missing fact ${label}; available: ${Object.keys(rows).join(', ')}`);
  const actual = Number.parseFloat(rows[label].replaceAll(',', ''));
  near(actual, expected, .5 * 10 ** -digits + 1e-8);
}
async function capture(name) {
  // A paused browser clock still needs a render frame after canvas resize/state changes.
  await page.clock.runFor(80);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
}
async function captureInspection(name) {
  await page.locator('#inspect-part').click(); await page.clock.runFor(80);
  await page.locator('#scene').screenshot({ path: path.join(output, `${name}.png`) });
  await page.locator('#inspect-part').click();
}

try {
  await mkdir(output, { recursive: true });
  server = await createServer({ root, server: { host: '127.0.0.1', port: 5242, strictPort: true } });
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push({ kind: 'page', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ kind: 'console', message: message.text() }); });
  await page.clock.install({ time: new Date('2026-10-02T00:00:00Z') });
  await page.goto(address, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.brakeLab?.getState().scene?.renderCount > 0);
  await page.clock.pauseAt(new Date('2026-10-02T00:01:00Z'));

  await check('Bearing and encoder phases come from the same physical wheel state', async () => {
    await setSettings({ speedKmh: 100, pressureBar: 60, abs: true, caliper: 'floating' });
    await advance(.4);
    const current = await state(), s = current.snapshot, b = current.scene.bearing;
    assert.ok(b && b.rows.length === 2);
    const R = b.pitchRadius, r = b.ballRadius, wi = s.wheelOmega, wheelRpm = wi * 60 / (2 * Math.PI);
    near(b.innerRpm, wheelRpm); near(b.cageRpm, wheelRpm * (1 - r / R) / 2);
    near(b.ballWorldRpm, b.cageRpm + b.ballRelativeRpm);
    near(b.cageRpm * R - b.ballWorldRpm * r, wheelRpm * (R - r));
    near(b.cageRpm * R + b.ballWorldRpm * r, 0);
    angleNear(b.innerAngle, s.wheelAngle);
    angleNear(b.cageAngle, s.wheelAngle * b.cageRatio);
    angleNear(b.ballRelativeAngle, s.wheelAngle * b.ballRelativeRatio);
    angleNear(b.ballWorldAngle, b.cageAngle + b.ballRelativeAngle);
    assert.equal(current.scene.encoder.teeth, 48);
    near(current.scene.encoder.pulseHz, Math.abs(wi) * 48 / (2 * Math.PI));
    evidence.push({ wheelTime: s.time, bearing: b, encoder: current.scene.encoder });
  });

  await check('Paused redraws, selection, mode rebuilds, and quality changes preserve physical phases', async () => {
    await select('bearing');
    const before = await state(), saved = await project();
    const result = await page.evaluate(() => {
      const app = window.brakeLab, before = app.getState(), rows = [];
      for (const quality of ['low', 'high', 'auto']) {
        app.scene.setView({ quality });
        app.scene.setState(before.snapshot, before.settings, { ...before.view, quality });
        rows.push(app.scene.getDiagnostics());
      }
      for (const mode of ['assembled', 'exploded', 'cutaway']) {
        app.scene.setState(before.snapshot, before.settings, { ...before.view, mode });
        rows.push(app.scene.getDiagnostics());
      }
      for (let i = 0; i < 5; i++) app.scene.setState(before.snapshot, before.settings, before.view);
      return rows;
    });
    for (const row of result) {
      assert.equal(row.selectedPart, 'bearing');
      for (const key of ['innerAngle', 'cageAngle', 'ballRelativeAngle', 'ballWorldAngle']) angleNear(row.bearing[key], before.scene.bearing[key]);
      near(row.encoder.pulseHz, before.scene.encoder.pulseHz);
    }
    assert.deepEqual((await state()).snapshot, before.snapshot);
    assert.deepEqual(await project(), saved);
    evidence.push({ rebuildPhases: result.map(row => ({ mode: row.mode, bearing: row.bearing })) });
  });

  await check('Wheel-state partition changes do not accumulate separate visual bearing time', async () => {
    await setSettings({ speedKmh: 100, pressureBar: 60, abs: true });
    await advance(.6); const single = await state();
    await page.evaluate(() => { brakeLab.reset(); for (let i = 0; i < 6; i++) brakeLab.advance(.1); });
    const split = await state();
    near(split.snapshot.time, single.snapshot.time); near(split.snapshot.wheelAngle, single.snapshot.wheelAngle);
    for (const key of ['innerAngle', 'cageAngle', 'ballRelativeAngle', 'ballWorldAngle']) angleNear(split.scene.bearing[key], single.scene.bearing[key]);
  });

  await check('Selected rotor facts describe actual instantaneous power and the bulk thermal balance', async () => {
    await setSettings({ speedKmh: 100, pressureBar: 60, abs: true, initialTemperatureC: 120, ambientTemperatureC: 20 });
    await advance(.4); await select('rotor');
    const current = await state(), s = current.snapshot, cfg = current.settings, detail = current.detail.rotor;
    near(detail.brakePowerW, s.brakeTorque * s.wheelOmega);
    near(detail.heatInputW, cfg.discHeatShare * s.brakeTorque * s.wheelOmega);
    near(detail.coolingPowerW, cfg.coolingWattsPerK * (s.discTemperatureC - cfg.ambientTemperatureC));
    near(detail.bulkTemperatureRateKPerS, (detail.heatInputW - detail.coolingPowerW) / (cfg.discMass * cfg.discHeatCapacity));
    near(detail.meanSurfaceSpeedMps, s.wheelOmega * cfg.padMeanRadius);
    near(detail.thermalClosureJ, 0, 1e-5);
    const rows = await facts();
    numericFact(rows, '실제 제동 동력', detail.brakePowerW / 1000, 2);
    numericFact(rows, '디스크 유입 열률', detail.heatInputW / 1000, 2);
    numericFact(rows, '주변으로의 열교환률', detail.coolingPowerW / 1000, 2);
    numericFact(rows, '디스크 평균 온도', s.discTemperatureC, 1);
    numericFact(rows, '평균 온도 변화율', detail.bulkTemperatureRateKPerS, 2);
    const raw = await page.locator('#part-detail-facts .detail-fact').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.label, { value: Number(node.dataset.value), unit: node.dataset.unit }])));
    near(raw['실제 제동 동력'].value, detail.brakePowerW / 1000); assert.equal(raw['실제 제동 동력'].unit, 'kW');
    near(raw['평균 온도 변화율'].value, detail.bulkTemperatureRateKPerS); assert.equal(raw['평균 온도 변화율'].unit, '°C/s');
    assert.match(await page.locator('#part-detail-note').textContent(), /평균|균일/);
    evidence.push({ rotorDetail: detail, displayed: rows }); await capture('rotor-live-detail');
    await captureInspection('rotor-inspection');
  });

  await check('ABS fill, hold, and dump readouts agree with both physical pressure rate and valve seating', async () => {
    for (const [time, phase] of [[.05, 'increase'], [.13, 'hold'], [.145, 'decrease']]) {
      await setSettings({ speedKmh: 100, pressureBar: 80, road: 'high', abs: true });
      await advance(time); await select('valves');
      const current = await state(), s = current.snapshot, cfg = current.settings, h = current.detail.hydraulics, geometry = current.scene.hydraulics;
      assert.equal(s.absPhase, phase); assert.equal(h.phase, phase);
      const expectedRate = phase === 'hold' ? 0 : phase === 'decrease' ? -s.pressure / cfg.pressureDumpTime : (cfg.pressureBar * 1e5 - s.pressure) / cfg.pressureFillTime;
      near(h.pressureRatePaPerS, expectedRate, 1e-6);
      near(h.pressurePa, s.pressure); near(h.commandedPressurePa, cfg.pressureBar * 1e5);
      for (const [key, open] of [['inlet', s.inletOpen], ['outlet', s.outletOpen]]) {
        assert.equal(geometry[key].open, open);
        if (open) assert.ok(geometry[key].lift > 0); else near(geometry[key].lift, 0);
        near(Math.abs(geometry[key].tipZ - geometry[key].seatZ), geometry[key].lift);
      }
      assert.equal(geometry.pumpActive, s.pumpActive);
      assert.ok(Object.keys(await facts()).length > 0);
      evidence.push({ absPhase: phase, hydraulic: h, valveGeometry: geometry });
    }
    await capture('abs-dump-detail');
    await captureInspection('valves-inspection');
  });

  await check('Floating and opposed fixed pistons share the same clamp force for equal hydraulic area', async () => {
    const rows = [];
    for (const caliper of ['floating', 'fixed']) {
      await setSettings({ caliper, speedKmh: 100, pressureBar: 60, abs: false, initialTemperatureC: 20 });
      await advance(.05); await select('pistons');
      const current = await state(), s = current.snapshot, cfg = current.settings, detail = current.detail.caliper;
      const areaPerSide = caliper === 'floating' ? Math.PI * (cfg.floatingPistonDiameterMm / 1000) ** 2 / 4 : cfg.fixedPistonDiametersMm.reduce((sum, diameter) => sum + Math.PI * (diameter / 1000) ** 2 / 4, 0);
      near(detail.hydraulicAreaPerSideM2, areaPerSide); near(detail.effectiveClampAreaM2, 2 * areaPerSide);
      near(detail.inboardNormalForceN, s.pressure * areaPerSide); near(detail.outboardNormalForceN, s.pressure * areaPerSide);
      near(detail.clampForceN, s.clampForce); near(detail.torqueCapacityNm, cfg.padFriction * s.clampForce * cfg.padMeanRadius);
      assert.equal(detail.pistonCount, caliper === 'floating' ? 1 : cfg.fixedPistonDiametersMm.length * 2);
      assert.ok(Object.keys(await facts()).length > 0);
      rows.push({ caliper, detail, snapshot: s });
    }
    near(rows[0].detail.clampForceN, rows[1].detail.clampForceN, 1e-7);
    evidence.push({ pistonComparison: rows });
  });

  await check('A locked wheel has zero disc rubbing power and encoder pulses despite available brake torque', async () => {
    await setSettings({ speedKmh: 100, pressureBar: 160, road: 'low', abs: false, initialTemperatureC: 20 });
    await advance(1); await select('rotor');
    const current = await state(), s = current.snapshot;
    assert.ok(s.speed > 20); near(s.wheelOmega, 0);
    assert.ok(current.detail.caliper.torqueCapacityNm > current.detail.caliper.actualTorqueNm);
    assert.ok(current.detail.caliper.torqueCapacityNm > 1000);
    near(current.detail.rotor.brakePowerW, 0); near(current.detail.rotor.heatInputW, 0);
    near(current.scene.encoder.pulseHz, 0); near(current.scene.bearing.innerRpm, 0);
    numericFact(await facts(), '실제 제동 동력', 0, 2);
    evidence.push({ lockedWheel: { speed: s.speed, capacity: current.detail.caliper.torqueCapacityNm, actual: current.detail.caliper.actualTorqueNm, heatRate: current.detail.rotor.heatInputW } });
  });

  await check('A completed run freezes cooling and pressure derivatives instead of inventing continuing motion', async () => {
    await setSettings({ speedKmh: 10, pressureBar: 100, road: 'high', abs: true, initialTemperatureC: 120, ambientTemperatureC: 20 });
    await advance(5); await select('rotor');
    const stopped = await state(); assert.equal(stopped.snapshot.stopped, true);
    assert.ok(stopped.snapshot.discTemperatureC > stopped.settings.ambientTemperatureC);
    near(stopped.detail.rotor.brakePowerW, 0); near(stopped.detail.rotor.heatInputW, 0);
    near(stopped.detail.rotor.coolingPowerW, 0); near(stopped.detail.rotor.bulkTemperatureRateKPerS, 0);
    near(stopped.detail.hydraulics.pressureRatePaPerS, 0);
    numericFact(await facts(), '주변으로의 열교환률', 0, 2);
    assert.match(await page.locator('#part-detail-note').textContent(), /멈|정지|종료|고정/);
    await advance(2); assert.deepEqual((await state()).snapshot, stopped.snapshot);
    assert.deepEqual((await state()).detail, stopped.detail);
    evidence.push({ stoppedDetail: stopped.detail });
  });

  await check('Live energy categories account for the initial energy and remain finite at zero initial speed', async () => {
    await setSettings({ speedKmh: 100, pressureBar: 60, road: 'high', abs: true }); await advance(.4);
    for (const zero of [false, true]) {
      if (zero) await setSettings({ speedKmh: 0 });
      const current = await state(), s = current.snapshot;
      const displayed = await page.locator('[data-energy-segment]').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.energySegment, Number(node.dataset.joules)])));
      near(displayed.kinetic, s.kineticEnergy, 1e-7); near(displayed.brake, s.brakeHeat, 1e-7);
      near(displayed.tire, s.tireLoss, 1e-7); near(displayed.cutoff, s.cutoffResidualEnergy + s.numericalProjectionEnergy, 1e-7);
      near(Object.values(displayed).reduce((sum, value) => sum + value, 0) + s.energyResidual, s.initialEnergy, 1e-6);
      assert.ok(Object.values(displayed).every(Number.isFinite));
      assert.doesNotMatch(await page.locator('#energy-total').textContent(), /NaN|Infinity/);
      assert.doesNotMatch(await page.locator('#energy-residual').textContent(), /NaN|Infinity/);
      if (zero) {
        assert.ok(Object.values(displayed).every(value => value === 0));
        const dimensions = await page.locator('[data-energy-segment]').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, style: node.style.width })));
        assert.ok(dimensions.every(segment => segment.width === 0 && segment.style === '0%'), JSON.stringify(dimensions));
      }
      evidence.push({ energy: displayed, initial: s.initialEnergy, residual: s.energyResidual });
    }
  });

  await check('Explicit inspection preserves the selected part and model, then restores the exact saved camera', async () => {
    await setSettings({ speedKmh: 100, pressureBar: 60, abs: true, caliper: 'floating' }); await advance(.2); await select('bearing');
    await page.locator('[data-camera="side"]').click();
    await page.clock.runFor(80);
    const canvas = await page.locator('#scene canvas').boundingBox();
    await page.mouse.move(canvas.x + canvas.width * .45, canvas.y + canvas.height * .45); await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * .58, canvas.y + canvas.height * .55, { steps: 6 }); await page.mouse.up();
    await page.clock.runFor(500);
    const before = await state(), saved = await project();
    assert.equal(before.scene.autoFraming, false);
    await page.locator('#inspect-part').click(); const inspected = await state();
    assert.equal(inspected.scene.inspection.active, true); assert.equal(inspected.scene.inspection.partId, 'bearing');
    assert.equal(inspected.view.selectedPart, 'bearing'); assert.equal(inspected.scene.selectedPart, 'bearing');
    assert.deepEqual(inspected.snapshot, before.snapshot); assert.deepEqual(await project(), saved);
    assert.notDeepEqual(inspected.scene.cameraPose.position, before.scene.cameraPose.position);
    await page.clock.runFor(80); await page.locator('#scene').screenshot({ path: path.join(output, 'bearing-inspection.png') });
    await page.locator('#inspect-part').click(); const restored = await state();
    assert.equal(restored.scene.inspection.active, false); cameraNear(restored.scene.cameraPose, before.scene.cameraPose);
    assert.equal(restored.scene.autoFraming, before.scene.autoFraming);
    await capture('bearing-inspection-restored');
  });

  await check('Inspection restores the saved camera preset metadata and keeps its actual pose after resize', async () => {
    await select('bearing'); await page.locator('[data-camera="side"]').click(); await page.clock.runFor(80);
    const before = await state(), saved = await project();
    assert.equal(before.view.camera, 'side'); assert.equal(before.scene.camera, 'side'); assert.equal(before.scene.autoFraming, true);
    await page.locator('#inspect-part').click(); await page.locator('[data-camera="front"]').click();
    const inspected = await state(); assert.equal(inspected.view.camera, 'front'); assert.equal(inspected.scene.camera, 'front');
    await page.locator('#restore-inspection').click(); const restored = await state();
    assert.equal(restored.scene.inspection.active, false); assert.equal(restored.view.camera, 'side'); assert.equal(restored.scene.camera, 'side');
    cameraNear(restored.scene.cameraPose, before.scene.cameraPose); assert.deepEqual(restored.snapshot, before.snapshot); assert.deepEqual(await project(), saved);
    await page.evaluate(() => brakeLab.scene.resize()); await page.clock.runFor(80);
    const resized = await state(); assert.equal(resized.view.camera, 'side'); assert.equal(resized.scene.camera, 'side');
    cameraNear(resized.scene.cameraPose, before.scene.cameraPose); assert.deepEqual(resized.snapshot, before.snapshot);
    evidence.push({ restoredCamera: { preset: resized.view.camera, saved: before.scene.cameraPose, afterResize: resized.scene.cameraPose } });
  });

  await check('Ordinary selection retains the camera during inspection and settings refresh facts without clearing comparison', async () => {
    await page.locator('#compare-abs').click();
    const comparison = (await project()).comparison;
    await select('bearing'); await page.locator('#inspect-part').click();
    const inspected = await state();
    await select('pads'); const selected = await state();
    cameraNear(selected.scene.cameraPose, inspected.scene.cameraPose);
    assert.deepEqual(selected.snapshot, inspected.snapshot); assert.deepEqual((await project()).comparison, comparison);
    assert.equal(await page.locator('#restore-inspection').isVisible(), true);
    await page.locator('#restore-inspection').click();
    assert.equal((await state()).scene.inspection.active, false);
    assert.equal((await state()).view.selectedPart, 'pads');
    await page.locator('#inspect-part').click(); assert.equal((await state()).scene.inspection.partId, 'pads');
    await page.locator('#inspect-part').click();
    await setSettings({ pressureBar: 80 }); await advance(.1);
    const updated = await state(); assert.equal(updated.view.selectedPart, 'pads'); assert.equal(updated.scene.selectedPart, 'pads');
    assert.equal(updated.settings.pressureBar, 80); assert.ok(Object.keys(await facts()).length > 0);
    assert.deepEqual((await project()).comparison, comparison);
    evidence.push({ retainedComparison: true, selectedPart: updated.view.selectedPart, detail: updated.detail.caliper });
  });

  await check('Restoring inspection after a caliper change reveals newly applicable structural parts', async () => {
    await setSettings({ caliper: 'fixed' }); await select('bearing');
    await page.locator('#inspect-part').click();
    await setSettings({ caliper: 'floating' });
    assert.equal((await state()).scene.inspection.active, true);
    await page.locator('#restore-inspection').click(); await select('slide-pins'); await page.clock.runFor(80);
    assert.equal((await state()).scene.inspection.active, false);
    assert.equal((await state()).view.selectedPart, 'slide-pins');
    assert.equal(await page.locator('.brake-part-label[data-part-id="slide-pins"]').isVisible(), true);
  });

  await check('Focused narrow layout mirrors live facts and explicit inspection preserves selected part', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.clock.runFor(80);
    await page.locator('#focus').click(); await page.clock.runFor(80);
    assert.equal((await state()).focused, true);
    assert.equal(await page.locator('#focus-component-details').getAttribute('open'), null);
    await page.locator('#focus-part').selectOption('rotor');
    const before = await state(), expected = await facts();
    await page.locator('#focus-component-details summary').click();
    assert.deepEqual(await facts(true), expected);
    assert.equal(await page.locator('#focus-detail-note').textContent(), await page.locator('#part-detail-note').textContent());
    await page.locator('#focus-component-details summary').click();
    await page.locator('#focus-inspect-part').click(); const inspected = await state();
    assert.equal(inspected.scene.inspection.partId, 'rotor'); assert.equal(inspected.view.selectedPart, 'rotor');
    assert.deepEqual(inspected.snapshot, before.snapshot);
    await page.locator('#focus-part').selectOption('bearing');
    assert.equal((await state()).scene.inspection.partId, 'rotor');
    assert.equal((await state()).view.selectedPart, 'bearing');
    await page.locator('#restore-inspection').click();
    assert.equal((await state()).scene.inspection.active, false);
    await page.locator('#focus-inspect-part').click();
    assert.equal((await state()).scene.inspection.partId, 'bearing');
    await capture('narrow-bearing-inspection');
    await page.locator('#focus-inspect-part').click(); await page.clock.runFor(80);
    const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, sceneHeight: document.querySelector('#scene').getBoundingClientRect().height }));
    assert.ok(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout)); assert.ok(layout.sceneHeight >= 240, JSON.stringify(layout));
    await capture('narrow-focused-detail'); await page.keyboard.press('Escape');
  });

  assert.deepEqual(errors, []);
  console.log(`All ${checks.length} brake detail browser checks passed.`);
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'detail-browser-results.json'), JSON.stringify({ version, checks, passed: checks.filter(check => check.passed).length, failed: checks.filter(check => !check.passed).length, errors, evidence, rendererScope: 'Headless Chromium with SwiftShader; functional and geometry evidence, not a physical GPU performance claim.' }, null, 2));
  await browser?.close();
  await server?.close();
}
