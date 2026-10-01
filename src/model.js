// Educational single-wheel model. All dynamics and snapshot values use SI units.
export const MODEL_VERSION = 'brake-1.0.0';
const G = 9.81;
const BASE_TICK = 0.001;
const CONTROL_PERIOD = 0.005;
const STOP_SPEED = 0.02;
const SLIP_FLOOR = 0.5;
const ABS_LOW_SPEED = 2;
const SAMPLE_PERIOD = 0.01;

const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value)
  ? clamp(value, min, max) : clamp(fallback, min, max);

export const ROAD_PRESETS = freeze({
  high: { label: '높은 마찰 · 합성 연습 곡선', B: 10, C: 1.9, D: 1, E: 0.97 },
  medium: { label: '중간 마찰 · 합성 연습 곡선', B: 10, C: 1.9, D: 0.6, E: 0.97 },
  low: { label: '낮은 마찰 · 합성 연습 곡선', B: 10, C: 1.9, D: 0.2, E: 0.97 },
});

export const defaultSettings = freeze({
  speedKmh: 100, pressureBar: 60, road: 'high', abs: true, caliper: 'floating',
  mass: 375, wheelRadius: 0.31, wheelInertia: 1.5, padFriction: 0.4,
  floatingPistonDiameterMm: 54, fixedPistonDiametersMm: [54 / Math.SQRT2, 54 / Math.SQRT2],
  padMeanRadius: 0.125, discOuterRadius: 0.18, discInnerRadius: 0.055, discThickness: 0.025,
  discMass: 7, discHeatCapacity: 460, initialTemperatureC: 20, ambientTemperatureC: 20,
  discHeatShare: 0.9, coolingWattsPerK: 12, absSlipBand: 0.025,
  pressureFillTime: 0.07, pressureDumpTime: 0.035,
});

export function normalizeSettings(input = {}) {
  const s = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const d = defaultSettings;
  const discInnerRadius = finite(s.discInnerRadius, d.discInnerRadius, 0.03, 0.12);
  const discOuterRadius = finite(s.discOuterRadius, d.discOuterRadius, discInnerRadius + 0.035, 0.3);
  const fixedPistonDiametersMm = Array.isArray(s.fixedPistonDiametersMm) && s.fixedPistonDiametersMm.length
    ? s.fixedPistonDiametersMm.slice(0, 8).map((x) => finite(x, d.fixedPistonDiametersMm[0], 10, 80))
    : [...d.fixedPistonDiametersMm];
  const result = {
    modelVersion: MODEL_VERSION,
    speedKmh: finite(s.speedKmh, d.speedKmh, 0, 200),
    pressureBar: finite(s.pressureBar, d.pressureBar, 0, 160),
    road: typeof s.road === 'string' && Object.hasOwn(ROAD_PRESETS, s.road) ? s.road : d.road,
    abs: typeof s.abs === 'boolean' ? s.abs : d.abs,
    caliper: s.caliper === 'fixed' || s.caliper === 'floating' ? s.caliper : d.caliper,
    mass: finite(s.mass, d.mass, 100, 1200),
    wheelRadius: finite(s.wheelRadius, d.wheelRadius, 0.2, 0.5),
    wheelInertia: finite(s.wheelInertia, d.wheelInertia, 0.2, 8),
    padFriction: finite(s.padFriction, d.padFriction, 0.05, 0.9),
    floatingPistonDiameterMm: finite(s.floatingPistonDiameterMm, d.floatingPistonDiameterMm, 10, 120),
    fixedPistonDiametersMm,
    discInnerRadius, discOuterRadius,
    padMeanRadius: finite(s.padMeanRadius, d.padMeanRadius, discInnerRadius + 0.005, discOuterRadius - 0.005),
    discThickness: finite(s.discThickness, d.discThickness, 0.008, 0.05),
    discMass: finite(s.discMass, d.discMass, 1, 25),
    discHeatCapacity: finite(s.discHeatCapacity, d.discHeatCapacity, 250, 1000),
    initialTemperatureC: finite(s.initialTemperatureC, d.initialTemperatureC, -40, 900),
    ambientTemperatureC: finite(s.ambientTemperatureC, d.ambientTemperatureC, -40, 60),
    discHeatShare: finite(s.discHeatShare, d.discHeatShare, 0, 1),
    coolingWattsPerK: finite(s.coolingWattsPerK, d.coolingWattsPerK, 0, 100),
    absSlipBand: finite(s.absSlipBand, d.absSlipBand, 0.005, 0.06),
    pressureFillTime: finite(s.pressureFillTime, d.pressureFillTime, 0.025, 0.5),
    pressureDumpTime: finite(s.pressureDumpTime, d.pressureDumpTime, 0.015, 0.5),
  };
  // Derived aliases are rebuilt from the primary keys; conflicting input aliases cannot affect physics.
  result.absEnabled = result.abs;
  result.caliperType = result.caliper;
  result.pistonDiameter = result.floatingPistonDiameterMm / 1000;
  result.fixedPistonDiameters = result.fixedPistonDiametersMm.map((x) => x / 1000);
  result.initialDiscTemperatureC = result.initialTemperatureC;
  return freeze(result);
}

function roadCoefficient(slip, road) {
  const z = road.B * slip;
  return road.D * Math.sin(road.C * Math.atan(z - road.E * (z - Math.atan(z))));
}

// The curve shapes are shared; changing D changes grip without pretending to identify a real road.
let targetSlip = 0;
let highestMu = -Infinity;
for (let i = 0; i <= 10000; i++) {
  const slip = i / 10000;
  const mu = roadCoefficient(slip, ROAD_PRESETS.high);
  if (mu > highestMu) { highestMu = mu; targetSlip = slip; }
}
export const PEAK_SLIP = targetSlip;

function effectiveArea(s) {
  return s.caliper === 'floating'
    ? 2 * Math.PI * s.pistonDiameter ** 2 / 4
    : 2 * s.fixedPistonDiameters.reduce((sum, diameter) => sum + Math.PI * diameter ** 2 / 4, 0);
}

function simulation(settings, tick) {
  let cfg, road, area, torquePerPascal, normalForce, initialEnergy, y;
  let time, carry, stopped, phase, lockTime, cutoffEnergy, projectionEnergy, peakTemperature, transitions;
  let nextControl;
  const kinetic = (state) => 0.5 * cfg.mass * state[1] ** 2 + 0.5 * cfg.wheelInertia * state[2] ** 2;

  function reset(input = cfg) {
    cfg = normalizeSettings(input);
    road = ROAD_PRESETS[cfg.road];
    area = effectiveArea(cfg);
    torquePerPascal = cfg.padFriction * area * cfg.padMeanRadius;
    normalForce = cfg.mass * G;
    const speed = cfg.speedKmh / 3.6;
    // distance, speed, omega, angle, pressure, brake heat, tire loss, temperature, cooling energy
    y = [0, speed, speed / cfg.wheelRadius, 0, 0, 0, 0, cfg.initialTemperatureC, 0];
    initialEnergy = kinetic(y);
    time = 0; carry = 0; lockTime = 0; cutoffEnergy = 0; projectionEnergy = 0;
    peakTemperature = cfg.initialTemperatureC; transitions = 0; nextControl = 0;
    phase = cfg.abs ? 'increase' : 'off';
    stopped = speed <= STOP_SPEED;
    if (stopped) { cutoffEnergy = initialEnergy; y[1] = 0; y[2] = 0; }
    return snapshot();
  }

  function forces(state) {
    const speed = Math.max(0, state[1]);
    const omega = Math.max(0, state[2]);
    const pressure = clamp(state[4], 0, cfg.pressureBar * 1e5);
    const slip = clamp((speed - cfg.wheelRadius * omega) / Math.max(speed, SLIP_FLOOR), -1, 1);
    const mu = roadCoefficient(slip, road);
    const force = normalForce * mu;
    const capacity = pressure * torquePerPascal;
    const torque = omega <= 1e-10 && cfg.wheelRadius * force <= capacity
      ? Math.max(0, cfg.wheelRadius * force) : capacity;
    return { speed, omega, pressure, slip, mu, force, capacity, torque };
  }

  function derivative(state) {
    const f = forces(state);
    const pressureRate = phase === 'decrease' ? -f.pressure / cfg.pressureDumpTime
      : phase === 'hold' ? 0 : (cfg.pressureBar * 1e5 - f.pressure) / cfg.pressureFillTime;
    const brakePower = f.torque * f.omega;
    const coolingPower = cfg.coolingWattsPerK * (state[7] - cfg.ambientTemperatureC);
    return [f.speed, -f.force / cfg.mass, (cfg.wheelRadius * f.force - f.torque) / cfg.wheelInertia,
      f.omega, pressureRate, brakePower, f.force * (f.speed - cfg.wheelRadius * f.omega),
      (cfg.discHeatShare * brakePower - coolingPower) / (cfg.discMass * cfg.discHeatCapacity), coolingPower];
  }

  function rk4(state, h) {
    const a = derivative(state);
    const b = derivative(state.map((x, i) => x + h * 0.5 * a[i]));
    const c = derivative(state.map((x, i) => x + h * 0.5 * b[i]));
    const d = derivative(state.map((x, i) => x + h * c[i]));
    return state.map((x, i) => x + h / 6 * (a[i] + 2 * b[i] + 2 * c[i] + d[i]));
  }

  function substep(h) {
    let next = rk4(y, h);
    if (next[2] < 0 && y[2] > 1e-10) {
      let lo = 0, hi = h;
      for (let i = 0; i < 35; i++) {
        const mid = (lo + hi) / 2;
        if (rk4(y, mid)[2] > 0) lo = mid; else hi = mid;
      }
      const eventTime = (lo + hi) / 2;
      y = rk4(y, eventTime);
      projectionEnergy += 0.5 * cfg.wheelInertia * y[2] ** 2;
      y[2] = 0;
      next = rk4(y, h - eventTime);
    }
    if (next[2] < 0) { projectionEnergy += 0.5 * cfg.wheelInertia * next[2] ** 2; next[2] = 0; }
    if (next[1] < 0) { projectionEnergy += 0.5 * cfg.mass * next[1] ** 2; next[1] = 0; }
    y = next;
    y[4] = clamp(y[4], 0, cfg.pressureBar * 1e5);
    time += h;
    if (y[1] > ABS_LOW_SPEED && y[2] < 0.1) lockTime += h;
    peakTemperature = Math.max(peakTemperature, y[7]);
    if (y[1] <= STOP_SPEED) {
      cutoffEnergy = kinetic(y);
      y[1] = 0; y[2] = 0; stopped = true; carry = 0;
    }
  }

  function physicsTick() {
    if (time + 1e-10 >= nextControl) {
      const old = phase;
      const slip = forces(y).slip;
      phase = !cfg.abs ? 'off' : y[1] < ABS_LOW_SPEED ? 'low-speed'
        : slip > targetSlip + cfg.absSlipBand ? 'decrease'
        : slip < targetSlip - cfg.absSlipBand ? 'increase' : 'hold';
      if (phase !== old) transitions++;
      nextControl += CONTROL_PERIOD;
    }
    const stiffness = normalForce * road.B * road.C * road.D
      * (2 / cfg.mass + cfg.wheelRadius ** 2 / cfg.wheelInertia) / Math.max(y[1], SLIP_FLOOR);
    const n = 2 ** Math.max(0, Math.ceil(Math.log2(tick * Math.max(stiffness, 1) / 0.35)));
    for (let i = 0; i < n && !stopped; i++) substep(tick / n);
  }

  function snapshot() {
    const f = forces(y);
    const clampForce = area * f.pressure;
    const currentEnergy = kinetic(y);
    const absPhase = stopped ? 'stopped' : phase;
    return freeze({
      modelVersion: MODEL_VERSION, time, distance: y[0], speed: y[1], wheelOmega: y[2],
      wheelAngle: y[3], angle: y[3], slip: y[1] < SLIP_FLOOR ? null : f.slip,
      effectiveSlip: f.slip, pressure: f.pressure, commandedPressure: cfg.pressureBar * 1e5,
      brakeTorque: f.torque, brakeTorqueCapacity: f.capacity, tireForce: f.force,
      roadMu: Math.abs(f.mu), normalForce, discTemperatureC: y[7], absPhase,
      inletOpen: !stopped && phase !== 'hold' && phase !== 'decrease',
      outletOpen: !stopped && phase === 'decrease', pumpActive: !stopped && phase === 'decrease',
      clampForce, padNormalForce: { inboard: clampForce / 2, outboard: clampForce / 2 },
      stopped, lockTime, brakeHeat: y[5], tireLoss: y[6], discCoolingEnergy: y[8],
      initialEnergy, kineticEnergy: currentEnergy, cutoffResidualEnergy: cutoffEnergy,
      numericalProjectionEnergy: projectionEnergy,
      energyResidual: initialEnergy - currentEnergy - y[5] - y[6] - cutoffEnergy - projectionEnergy,
      thermalResidual: cfg.discMass * cfg.discHeatCapacity * (y[7] - cfg.initialTemperatureC)
        - cfg.discHeatShare * y[5] + y[8],
      peakTemperatureC: peakTemperature, targetSlip, absTransitions: transitions, integrationStep: tick,
    });
  }

  function step(dt) {
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0 || dt > 5) {
      throw new RangeError('step(dt)는 0 이상 5 이하의 유한한 초 값이어야 합니다.');
    }
    if (stopped) return snapshot();
    carry += dt;
    while (!stopped && carry + 1e-12 >= tick) { carry = Math.max(0, carry - tick); physicsTick(); }
    return snapshot();
  }
  reset(settings);
  return Object.freeze({ reset, step, snapshot, get settings() { return cfg; } });
}

export function createSimulation(settings = defaultSettings) { return simulation(settings, BASE_TICK); }

export function runExperiment(settings = defaultSettings, options = {}) {
  const requestedDt = options.dt ?? BASE_TICK;
  const duration = options.duration ?? 60;
  if (typeof requestedDt !== 'number' || !Number.isFinite(requestedDt) || requestedDt <= 0
    || typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > 90) {
    throw new RangeError('실험 dt는 양수, duration은 0..90초의 유한한 값이어야 합니다.');
  }
  // Refinement is a power-of-two subdivision of 1 ms, preserving exact 5 ms control ticks.
  const tick = BASE_TICK / 2 ** clamp(Math.ceil(Math.log2(BASE_TICK / requestedDt)), 0, 3);
  const sim = simulation(settings, tick);
  const captured = [sim.snapshot()];
  let state = captured[0], nextSample = SAMPLE_PERIOD;
  const count = Math.floor((duration + 1e-12) / tick);
  for (let i = 0; i < count && !state.stopped; i++) {
    state = sim.step(tick);
    if (state.time + 1e-10 >= nextSample) { captured.push(state); nextSample += SAMPLE_PERIOD; }
  }
  if (captured.at(-1).time !== state.time) captured.push(state);
  const samples = captured.length <= 501 ? captured
    : Array.from({ length: 501 }, (_, i) => captured[Math.round(i * (captured.length - 1) / 500)]);
  const summary = {
    stopped: state.stopped, stopDistance: state.stopped ? state.distance : null,
    stopTime: state.stopped ? state.time : null, distance: state.distance, elapsedTime: state.time,
    lockTime: state.lockTime, peakTemperatureC: state.peakTemperatureC,
    brakeHeat: state.brakeHeat, tireLoss: state.tireLoss, initialEnergy: state.initialEnergy,
    cutoffResidualEnergy: state.cutoffResidualEnergy, numericalProjectionEnergy: state.numericalProjectionEnergy,
    energyResidual: state.energyResidual, thermalResidual: state.thermalResidual,
    finalSpeed: state.speed, absTransitions: state.absTransitions, integrationStep: tick,
    sampleCount: samples.length,
  };
  return freeze({ modelVersion: MODEL_VERSION, settings: sim.settings, summary, samples });
}

export function compareAbs(settings = defaultSettings, options = {}) {
  const cfg = normalizeSettings(settings);
  const withoutAbs = runExperiment({ ...cfg, abs: false }, options);
  const withAbs = runExperiment({ ...cfg, abs: true }, options);
  return freeze({ modelVersion: MODEL_VERSION, settings: cfg, withoutAbs, withAbs, difference: {
    stopDistance: withoutAbs.summary.stopped && withAbs.summary.stopped
      ? withAbs.summary.stopDistance - withoutAbs.summary.stopDistance : null,
    stopTime: withoutAbs.summary.stopped && withAbs.summary.stopped
      ? withAbs.summary.stopTime - withoutAbs.summary.stopTime : null,
    lockTime: withAbs.summary.lockTime - withoutAbs.summary.lockTime,
  } });
}
