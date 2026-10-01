import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, runExperiment, defaultSettings } from '../src/model.js';
import { brakeDetail, describeBrakeDetail } from '../src/detail-readouts.js';

const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const observe = (settings = {}, elapsed = 0.1) => {
  const sim = createSimulation(settings), snapshot = sim.step(elapsed);
  return { sim, snapshot, detail: brakeDetail(snapshot, sim.settings) };
};
function finiteTree(value) {
  for (const item of Object.values(value)) {
    if (typeof item === 'number') assert.ok(Number.isFinite(item));
    else if (item && typeof item === 'object') finiteTree(item);
  }
}

test('hydraulic areas reconstruct independent per-side forces and torque capacity across caliper designs', () => {
  for (const settings of [
    { caliper: 'floating' }, { caliper: 'fixed' },
    { caliper: 'floating', floatingPistonDiameterMm: 110 },
    { caliper: 'fixed', fixedPistonDiametersMm: [10, 20, 30, 40, 50, 60, 70, 80] },
  ]) {
    const { sim, snapshot: s, detail: d } = observe({ ...settings, abs: false });
    const cfg = sim.settings;
    const diameters = cfg.caliper === 'floating' ? [cfg.floatingPistonDiameterMm] : cfg.fixedPistonDiametersMm;
    const area = diameters.reduce((sum, mm) => sum + Math.PI * (mm / 2000) ** 2, 0);
    close(d.caliper.hydraulicAreaPerSideM2, area);
    close(d.caliper.inboardNormalForceN, s.pressure * area);
    close(d.caliper.outboardNormalForceN, s.pressure * area);
    close(d.caliper.clampForceN, 2 * s.pressure * area);
    close(d.caliper.torqueCapacityNm, 2 * area * s.pressure * cfg.padFriction * cfg.padMeanRadius);
    close(d.caliper.forceClosureN, 0);
    assert.equal(d.caliper.pistonCount, diameters.length * (cfg.caliper === 'floating' ? 1 : 2));
    close(d.caliper.physicalPistonAreaM2, area * (cfg.caliper === 'floating' ? 1 : 2));
  }
});

test('default fixed and floating calipers have equal pressure-force behavior but distinct physical piston areas', () => {
  const a = observe({ caliper: 'floating' }), b = observe({ caliper: 'fixed' });
  close(a.detail.caliper.effectiveClampAreaM2, b.detail.caliper.effectiveClampAreaM2);
  close(a.detail.caliper.clampForceN, b.detail.caliper.clampForceN);
  close(a.detail.caliper.torqueCapacityNm, b.detail.caliper.torqueCapacityNm);
  close(a.detail.rotor.brakePowerW, b.detail.rotor.brakePowerW);
  close(b.detail.caliper.physicalPistonAreaM2, 2 * a.detail.caliper.physicalPistonAreaM2);
  assert.equal(a.detail.caliper.pistonCount, 1); assert.equal(b.detail.caliper.pistonCount, 4);
});

test('display units reconstruct SI values instead of confusing hydraulic pressure and contact stress', () => {
  const { sim, snapshot: s, detail: d } = observe();
  const facts = Object.fromEntries(describeBrakeDetail('pistons', s, sim.settings).facts.map(f => [f.label, f]));
  assert.equal(facts['한쪽 유압 면적'].unit, 'cm²'); close(facts['한쪽 유압 면적'].value * 1e-4, d.caliper.hydraulicAreaPerSideM2);
  assert.equal(facts['캘리퍼 압력'].unit, 'bar'); close(facts['캘리퍼 압력'].value * 1e5, s.pressure);
  close(facts['안쪽 패드 수직력'].value * 1000, s.padNormalForce.inboard);
  assert.equal(d.pads.contactPressureSolved, false);
  assert.match(describeBrakeDetail('pads', s, sim.settings).note, /접촉 압력.*계산하지 않습니다/);
  assert.equal(d.rotor.surfaceTemperatureSolved, false);
});

test('pressure observations reproduce analytic fill, hold, and dump segments of the existing controller', () => {
  const sim = createSimulation({ pressureBar: 100 });
  const found = new Set(); let previous = sim.snapshot();
  for (let i = 0; i < 4000 && found.size < 3; i++) {
    const s = sim.step(0.001), h = brakeDetail(previous, sim.settings).hydraulics;
    if (s.absPhase === previous.absPhase && ['increase', 'hold', 'decrease'].includes(s.absPhase) && !found.has(s.absPhase)) {
      const elapsed = s.time - previous.time;
      const target = s.absPhase === 'decrease' ? 0 : s.commandedPressure;
      const tau = s.absPhase === 'decrease' ? sim.settings.pressureDumpTime : sim.settings.pressureFillTime;
      const expected = s.absPhase === 'hold' ? previous.pressure : target + (previous.pressure - target) * Math.exp(-elapsed / tau);
      // One RK4 step truncates the exponential after its fourth-order term;
      // adaptive substeps can only make this local exponential bound smaller.
      const remainder = Math.abs(previous.pressure - target) * Math.exp(elapsed / tau) * (elapsed / tau) ** 5 / 120;
      close(s.pressure, expected, remainder + 1e-6);
      close(h.pressureRatePaPerS, s.absPhase === 'hold' ? 0 : (target - previous.pressure) / tau);
      assert.equal(h.inletOpen, s.absPhase === 'increase'); assert.equal(h.outletOpen, s.absPhase === 'decrease');
      found.add(s.absPhase);
    }
    previous = s;
  }
  assert.deepEqual([...found].sort(), ['decrease', 'hold', 'increase']);
});

test('zero-pressure cooling agrees with independent exponential temperature derivative and signed heat exchange', () => {
  for (const initialTemperatureC of [-20, 300]) {
    const { sim, snapshot: s, detail: d } = observe({ pressureBar: 0, initialTemperatureC }, 2);
    const cfg = sim.settings, capacity = cfg.discMass * cfg.discHeatCapacity;
    const gap = (initialTemperatureC - cfg.ambientTemperatureC) * Math.exp(-cfg.coolingWattsPerK * s.time / capacity);
    close(d.rotor.bulkTemperatureC, cfg.ambientTemperatureC + gap, 1e-7);
    close(d.rotor.coolingPowerW, cfg.coolingWattsPerK * gap, 1e-6);
    close(d.rotor.bulkTemperatureRateKPerS, -cfg.coolingWattsPerK * gap / capacity, 1e-8);
    close(d.rotor.brakePowerW, 0); close(d.rotor.heatInputW, 0);
    close(d.rotor.storedHeatJ + d.rotor.removedHeatJ, 0, 1e-6);
    assert.equal(Math.sign(d.rotor.coolingPowerW), Math.sign(initialTemperatureC - cfg.ambientTemperatureC));
  }
});

test('locked wheel actual friction power vanishes while torque capacity and tire dissipation remain', () => {
  const sim = createSimulation({ abs: false, pressureBar: 100 }); let s;
  for (let i = 0; i < 2000; i++) { s = sim.step(0.001); if (s.wheelOmega === 0 && s.speed > 2) break; }
  assert.equal(s.wheelOmega, 0); assert.ok(s.speed > 2);
  const d = brakeDetail(s, sim.settings);
  assert.ok(d.caliper.torqueCapacityNm > d.caliper.actualTorqueNm);
  assert.equal(d.rotor.brakePowerW, 0); assert.equal(d.rotor.meanSurfaceSpeedMps, 0);
  assert.ok(d.wheel.tireLossPowerW > 0); assert.equal(d.encoder.pulseHz, 0);
  close(d.wheel.angularAccelerationRadPerS2, 0);
  close(d.caliper.actualTorqueNm, s.tireForce * sim.settings.wheelRadius);
});

test('mechanical and bulk thermal balances reconstruct from solver histories without double-counting heat', () => {
  for (const abs of [false, true]) {
    const run = runExperiment({ abs });
    for (const s of run.samples) {
      const d = brakeDetail(s, run.settings), e = d.energy;
      close(e.accountedJ, e.remainingKineticJ + e.brakeHeatJ + e.tireLossJ + e.cutoffJ + e.projectionJ);
      close(e.initialJ - e.accountedJ, e.residualJ, 1e-8);
      close(d.rotor.storedHeatJ + d.rotor.removedHeatJ - d.rotor.absorbedHeatJ, s.thermalResidual, 1e-8);
      close(d.rotor.absorbedHeatJ, run.settings.discHeatShare * e.brakeHeatJ);
      close(d.rotor.heatInputW, run.settings.discHeatShare * d.rotor.brakePowerW);
      close(d.rotor.brakePowerW, d.pads.actualTangentialForceN * d.rotor.meanSurfaceSpeedMps, 1e-7);
      finiteTree(d);
    }
  }
});

test('stopped state reports frozen rates and does not imply continuing hydraulic or thermal simulation', () => {
  const sim = createSimulation({ speedKmh: 0, initialTemperatureC: 300 });
  const s = sim.snapshot(), d = brakeDetail(s, sim.settings);
  assert.equal(d.active, false); assert.equal(d.rotor.bulkTemperatureC, 300);
  assert.equal(d.rotor.coolingPowerW, 0); assert.equal(d.rotor.bulkTemperatureRateKPerS, 0);
  assert.equal(d.hydraulics.pressureRatePaPerS, 0); assert.equal(d.hydraulics.slipError, null);
  assert.deepEqual(sim.step(2), s);
  assert.match(describeBrakeDetail('rotor', s, sim.settings).note, /정지 완료 뒤.*냉각과 압력 변화도 진행하지 않습니다/);
  assert.match(describeBrakeDetail('sensor', s, sim.settings).facts.find(f => f.label === '제동 슬립').value, /정지 근처/);
});

test('low-speed pressure return and near-stop undefined slip keep their distinct meaning', () => {
  const low = observe({ speedKmh: 5, pressureBar: 8 }, 0.01);
  assert.equal(low.snapshot.absPhase, 'low-speed');
  assert.ok(low.detail.hydraulics.pressureRatePaPerS > 0);
  assert.notEqual(low.detail.hydraulics.slip, null);
  const nearStop = observe({ speedKmh: 1, pressureBar: 0 }, 0.01);
  assert.equal(nearStop.detail.hydraulics.slip, null); assert.equal(nearStop.detail.hydraulics.slipError, null);
  assert.ok(nearStop.detail.encoder.pulseHz > 0); assert.equal(nearStop.snapshot.stopped, false);
});

test('encoder frequency and bearing surface velocities reconstruct the actual wheel state', () => {
  for (const speedKmh of [0, 1, 100, 200]) {
    const { snapshot: s, detail: d } = observe({ speedKmh, pressureBar: 0 });
    assert.equal(d.encoder.teeth, 48);
    close(d.encoder.pulseHz / 48 * 60, d.wheel.rpm);
    close(d.wheel.rpm * Math.PI * 2 / 60, s.wheelOmega);
    const b = d.bearing;
    close(b.cageRpm * b.pitchRadius - b.ballWorldRpm * b.ballRadius, b.innerRpm * (b.pitchRadius - b.ballRadius));
    close(b.cageRpm * b.pitchRadius + b.ballWorldRpm * b.ballRadius, 0);
    close(b.ballWorldRpm, b.cageRpm + b.ballRelativeRpm);
  }
});

test('readouts remain compact, finite and non-mutating for every selectable part', () => {
  const { sim, snapshot: s } = observe(), before = JSON.stringify({ settings: sim.settings, snapshot: s });
  const ids = ['rotor','hub','caliper','pads','pistons','seals','boots','bracket','slide-pins','pad-hardware','bleeder','hose','bearing','knuckle','encoder','sensor','hydraulic-unit','valves','pump'];
  for (const id of ids) {
    const result = describeBrakeDetail(id, s, sim.settings);
    assert.ok(result.facts.length > 0 && result.facts.length <= 6, id);
    assert.ok(result.note.length > 0, id); finiteTree(result);
    assert.ok(result.facts.every(f => typeof f.value === 'string' || typeof f.value === 'number'));
  }
  assert.equal(JSON.stringify({ settings: sim.settings, snapshot: s }), before);
  assert.equal(brakeDetail(null, defaultSettings), null);
  assert.equal(brakeDetail({ ...s, wheelOmega: NaN }, sim.settings), null);
  assert.deepEqual(describeBrakeDetail('rotor', null, defaultSettings).facts, []);
});
