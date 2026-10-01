import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, normalizeSettings, ROAD_PRESETS, PEAK_SLIP, createSimulation, runExperiment, compareAbs } from '../src/model.js';

const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} ± ${tolerance}`);
const finiteSnapshot = (s) => {
  for (const [key, value] of Object.entries(s)) if (typeof value === 'number') assert.ok(Number.isFinite(value), key);
  assert.ok(s.speed >= 0 && s.wheelOmega >= 0 && s.pressure >= 0);
};

test('normalization rejects nonfinite and wrong types; bounds geometry and arrays', () => {
  const n = normalizeSettings({ speedKmh: Infinity, pressureBar: -10, abs: 'false', road: '__proto__',
    mass: NaN, caliper: 'other', padMeanRadius: 2, discOuterRadius: 0.1, discInnerRadius: 0.12,
    fixedPistonDiametersMm: [NaN, -3, 999], absEnabled: false, caliperType: 'fixed' });
  assert.equal(n.speedKmh, 100); assert.equal(n.pressureBar, 0); assert.equal(n.abs, true);
  assert.equal(n.road, 'high'); assert.equal(n.mass, 375); assert.equal(n.caliper, 'floating');
  assert.equal(n.absEnabled, n.abs); assert.equal(n.caliperType, n.caliper);
  assert.ok(n.padMeanRadius < n.discOuterRadius && n.padMeanRadius > n.discInnerRadius);
  assert.deepEqual(n.fixedPistonDiametersMm, [54 / Math.SQRT2, 10, 80]);
  assert.deepEqual(normalizeSettings(null), normalizeSettings());
  assert.deepEqual(normalizeSettings([]), normalizeSettings());
});

test('default and normalized settings are detached and deeply immutable', () => {
  assert.ok(Object.isFrozen(defaultSettings) && Object.isFrozen(defaultSettings.fixedPistonDiametersMm));
  const diameters = [40, 42]; const cfg = normalizeSettings({ fixedPistonDiametersMm: diameters });
  diameters[0] = 70; assert.equal(cfg.fixedPistonDiametersMm[0], 40);
  assert.throws(() => { cfg.mass = 1; }, TypeError);
  assert.throws(() => cfg.fixedPistonDiameters.push(1), TypeError);
});

test('omitted pad radius is also constrained when the disc geometry changes', () => {
  const cfg = normalizeSettings({ discInnerRadius: 0.06, discOuterRadius: 0.1 });
  assert.equal(cfg.padMeanRadius, 0.095);
  assert.ok(cfg.padMeanRadius > cfg.discInnerRadius && cfg.padMeanRadius < cfg.discOuterRadius);
  assert.equal(normalizeSettings({ road: { toString() { throw Error('must not coerce'); } } }).road, 'high');
});

test('synthetic road amplitudes share shape and have a computed non-universal target', () => {
  assert.equal(ROAD_PRESETS.high.D, 1); assert.equal(ROAD_PRESETS.medium.D, 0.6); assert.equal(ROAD_PRESETS.low.D, 0.2);
  close(PEAK_SLIP, 0.1802, 1e-6); assert.notEqual(PEAK_SLIP, 0.2);
  assert.ok(Object.isFrozen(ROAD_PRESETS.high));
});

test('zero pressure coasts without artificial deceleration, energy, or heating', () => {
  const r = runExperiment({ pressureBar: 0 }, { duration: 2 });
  assert.equal(r.summary.stopped, false); assert.equal(r.summary.stopDistance, null);
  close(r.summary.finalSpeed, 100 / 3.6); close(r.summary.distance, 2 * 100 / 3.6, 1e-8);
  close(r.summary.brakeHeat, 0); close(r.summary.tireLoss, 0); close(r.summary.energyResidual, 0);
});

test('zero start speed is a finite stationary state and step is idempotent', () => {
  const sim = createSimulation({ speedKmh: 0 }); const a = sim.snapshot();
  assert.equal(a.stopped, true); assert.equal(a.slip, null); assert.equal(a.brakeTorque, 0);
  assert.deepEqual(sim.step(1), a); finiteSnapshot(a);
});

test('all SI scene fields, force balance, and balanced per-side pad force are present', () => {
  const sim = createSimulation(); const s = sim.step(0.1);
  for (const key of ['time', 'distance', 'speed', 'wheelOmega', 'wheelAngle', 'pressure', 'brakeTorque',
    'normalForce', 'tireForce', 'roadMu', 'discTemperatureC', 'absPhase', 'inletOpen', 'outletOpen',
    'pumpActive', 'clampForce', 'padNormalForce', 'stopped', 'lockTime', 'brakeHeat', 'tireLoss', 'energyResidual']) {
    assert.ok(Object.hasOwn(s, key), key);
  }
  close(s.normalForce, 375 * 9.81); close(s.padNormalForce.inboard + s.padNormalForce.outboard, s.clampForce);
  close(s.brakeTorqueCapacity, s.clampForce * 0.4 * 0.125); finiteSnapshot(s);
});

test('equal total hydraulic area floating and four-piston fixed produce equal physical results', () => {
  const a = runExperiment({ caliper: 'floating', abs: false });
  const b = runExperiment({ caliper: 'fixed', abs: false });
  close(a.summary.stopDistance, b.summary.stopDistance, 1e-8);
  close(a.summary.brakeHeat, b.summary.brakeHeat, 1e-5);
  const f = createSimulation({ caliper: 'floating' }).step(0.1);
  const g = createSimulation({ caliper: 'fixed' }).step(0.1);
  close(f.clampForce, g.clampForce, 1e-8);
});

test('pad coefficient and effective radius scale torque capacity, independently of road friction', () => {
  const snap = (s) => createSimulation({ ...s, abs: false, pressureBar: 5 }).step(0.01);
  const a = snap({ padFriction: 0.3, padMeanRadius: 0.1 });
  const b = snap({ padFriction: 0.6, padMeanRadius: 0.1 });
  const c = snap({ padFriction: 0.3, padMeanRadius: 0.15 });
  const d = snap({ padFriction: 0.3, padMeanRadius: 0.1, road: 'low' });
  close(b.brakeTorqueCapacity / a.brakeTorqueCapacity, 2);
  close(c.brakeTorqueCapacity / a.brakeTorqueCapacity, 1.5);
  close(d.brakeTorqueCapacity, a.brakeTorqueCapacity);
});

test('hard braking locks a wheel without reverse rotation; static torque is a reaction', () => {
  const sim = createSimulation({ abs: false, pressureBar: 100 });
  let locked;
  for (let i = 0; i < 3000 && !sim.snapshot().stopped; i++) {
    const s = sim.step(0.001); finiteSnapshot(s);
    if (s.wheelOmega === 0 && s.speed > 2) { locked = s; break; }
  }
  assert.ok(locked); close(locked.slip, 1);
  close(locked.brakeTorque, locked.tireForce * defaultSettings.wheelRadius, 1e-7);
  assert.ok(locked.brakeTorque <= locked.brakeTorqueCapacity);
});

test('a locked wheel has analytic constant deceleration and zero brake dissipation', () => {
  const sim = createSimulation({ abs: false, pressureBar: 100 });
  let a;
  for (let i = 0; i < 2000; i++) {
    a = sim.step(0.001); if (a.wheelOmega === 0 && a.speed > 5) break;
  }
  assert.equal(a.wheelOmega, 0);
  const b = sim.step(0.02);
  close(b.speed, a.speed - a.roadMu * 9.81 * 0.02, 1e-9);
  close(b.brakeHeat, a.brakeHeat, 1e-9); assert.ok(b.tireLoss > a.tireLoss);
});

test('ABS opens the dump valve, releases pressure and recovers wheel rotation', () => {
  const sim = createSimulation({ pressureBar: 100 });
  let previous = sim.snapshot(), sawDump = false, sawRecovery = false;
  for (let i = 0; i < 4000 && !previous.stopped; i++) {
    const s = sim.step(0.001);
    if (s.absPhase === 'decrease') {
      assert.equal(s.inletOpen, false); assert.equal(s.outletOpen, true); assert.equal(s.pumpActive, true);
      if (previous.absPhase === 'decrease') assert.ok(s.pressure <= previous.pressure + 1e-8);
      sawDump = true;
    }
    if (sawDump && s.wheelOmega > previous.wheelOmega + 1e-6) sawRecovery = true;
    if (s.absPhase === 'hold') { assert.equal(s.inletOpen, false); assert.equal(s.outletOpen, false); }
    previous = s;
  }
  assert.ok(sawDump && sawRecovery);
});

test('mechanical and rotor thermal energy budgets close including numerical cutoff', () => {
  for (const abs of [false, true]) {
    const r = runExperiment({ abs }); const s = r.samples.at(-1);
    assert.ok(r.summary.stopped && s.speed === 0 && s.wheelOmega === 0);
    assert.ok(s.cutoffResidualEnergy > 0 && s.cutoffResidualEnergy < 0.1);
    assert.ok(Math.abs(s.energyResidual) < 0.02, `${s.energyResidual} J`);
    assert.ok(Math.abs(s.thermalResidual) < 1e-6, `${s.thermalResidual} J`);
    assert.ok(s.numericalProjectionEnergy < 1e-6);
    assert.ok(s.brakeHeat >= 0 && s.tireLoss >= 0);
  }
});

test('unloaded thermal cooling follows the independent analytic exponential', () => {
  const r = runExperiment({ pressureBar: 0, initialTemperatureC: 300 }, { duration: 2 });
  const expected = 20 + 280 * Math.exp(-12 * 2 / (7 * 460));
  close(r.samples.at(-1).discTemperatureC, expected, 1e-8);
  close(r.summary.peakTemperatureC, 300); close(r.summary.brakeHeat, 0);
  close(r.summary.thermalResidual, 0, 1e-6);
});

test('RK4 refinement genuinely changes integration step and converges', () => {
  for (const abs of [false, true]) {
    const a = runExperiment({ abs }, { dt: 0.001 });
    const b = runExperiment({ abs }, { dt: 0.0005 });
    const c = runExperiment({ abs }, { dt: 0.00025 });
    assert.equal(a.summary.integrationStep, 0.001); assert.equal(b.summary.integrationStep, 0.0005);
    assert.equal(c.summary.integrationStep, 0.00025);
    close(a.summary.stopDistance, c.summary.stopDistance, 1e-4);
    close(a.summary.stopTime, c.summary.stopTime, 0.002);
    close(a.summary.brakeHeat, c.summary.brakeHeat, 0.05);
  }
});

test('frame partition at 3, 30 and 60 FPS has the same fixed-tick dynamics', () => {
  const states = [3, 30, 60].map((fps) => {
    const sim = createSimulation(); for (let i = 0; i < 2 * fps; i++) sim.step(1 / fps); return sim.snapshot();
  });
  for (const s of states.slice(1)) {
    close(s.time, states[0].time, 1e-10); close(s.speed, states[0].speed, 1e-10);
    close(s.pressure, states[0].pressure, 1e-5); close(s.distance, states[0].distance, 1e-10);
  }
});

test('weak braking receives no artificial ABS distance bonus', () => {
  const r = compareAbs({ pressureBar: 20 });
  assert.ok(r.withoutAbs.summary.stopped && r.withAbs.summary.stopped);
  close(r.withoutAbs.summary.stopDistance, r.withAbs.summary.stopDistance, 1e-9);
  assert.equal(r.withAbs.summary.absTransitions, 1); // only the explicit low-speed handover
});

test('ABS comparisons detach input and differ only in the ABS primary setting', () => {
  const input = { speedKmh: 80, road: 'medium', mass: 420, fixedPistonDiametersMm: [35, 40] };
  const r = compareAbs(input); input.mass = 1000; input.fixedPistonDiametersMm[0] = 80;
  assert.equal(r.withAbs.settings.mass, 420); assert.equal(r.withoutAbs.settings.mass, 420);
  const { abs: a, absEnabled: aa, ...left } = r.withoutAbs.settings;
  const { abs: b, absEnabled: bb, ...right } = r.withAbs.settings;
  assert.deepEqual(left, right); assert.equal(a, false); assert.equal(b, true);
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.samples ?? r.withAbs.samples));
});

test('result sampling is bounded, includes first and last states and preserves summary peaks', () => {
  const r = runExperiment({ road: 'low' });
  assert.ok(r.summary.stopped); assert.ok(r.samples.length <= 501 && r.samples.length > 2);
  assert.equal(r.samples[0].time, 0); assert.equal(r.samples.at(-1).time, r.summary.stopTime);
  assert.ok(r.summary.peakTemperatureC >= Math.max(...r.samples.map((s) => s.discTemperatureC)));
  assert.throws(() => { r.samples[0].speed = 0; }, TypeError);
});

test('pressure-free duration exhaustion is explicit and all road/pressure extremes remain finite', () => {
  const exhausted = runExperiment({ pressureBar: 0 }, { duration: 0.05 });
  assert.equal(exhausted.summary.stopped, false); assert.equal(exhausted.summary.stopTime, null);
  for (const road of ['high', 'medium', 'low']) {
    const r = runExperiment({ road, pressureBar: 100, speedKmh: 20 }, { duration: 20 });
    assert.ok(r.summary.stopped); for (const s of r.samples) finiteSnapshot(s);
    assert.ok(Math.abs(r.summary.energyResidual) < 0.02);
  }
});

test('bounded parameter corners preserve nonnegative states and an honest energy budget', () => {
  const settings = [
    { mass: 650, wheelInertia: 0.2, wheelRadius: 0.5, pressureBar: 100, padFriction: 0.65, road: 'low', abs: false },
    { mass: 200, wheelInertia: 8, wheelRadius: 0.2, pressureBar: 100, padFriction: 0.2, road: 'high', abs: true },
    { mass: 1200, wheelInertia: 0.2, wheelRadius: 0.5, pressureBar: 160, floatingPistonDiameterMm: 120, road: 'high', abs: false },
  ];
  for (const input of settings) {
    const r = runExperiment({ ...input, speedKmh: 20 }, { duration: 20 });
    assert.ok(r.summary.stopped);
    for (const s of r.samples) finiteSnapshot(s);
    assert.ok(Math.abs(r.summary.energyResidual) / r.summary.initialEnergy < 1e-5);
    assert.ok(r.summary.numericalProjectionEnergy / r.summary.initialEnergy < 1e-8);
  }
});

test('reset clears accumulated state and detached input cannot change a running experiment', () => {
  const input = { pressureBar: 60 }; const sim = createSimulation(input); sim.step(0.2); input.pressureBar = 0;
  assert.equal(sim.settings.pressureBar, 60); const s = sim.reset({ speedKmh: 50, pressureBar: 0 });
  assert.equal(s.time, 0); assert.equal(s.distance, 0); assert.equal(s.brakeHeat, 0); close(s.speed, 50 / 3.6);
  close(sim.step(1).speed, 50 / 3.6);
});

test('invalid timestep and duration fail clearly instead of poisoning state', () => {
  const sim = createSimulation();
  for (const dt of [NaN, Infinity, -1, 6, '1']) assert.throws(() => sim.step(dt), RangeError);
  assert.equal(sim.snapshot().time, 0);
  for (const dt of [NaN, Infinity, -1, 0]) assert.throws(() => runExperiment({}, { dt }), RangeError);
  for (const duration of [NaN, Infinity, -1, 91]) assert.throws(() => runExperiment({}, { duration }), RangeError);
  assert.equal(runExperiment({}, { duration: 0 }).summary.elapsedTime, 0);
});
