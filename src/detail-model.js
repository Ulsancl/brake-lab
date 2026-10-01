import { normalizeSettings } from './model.js';
import { ENCODER_TEETH, hubBearingKinematics } from './mechanical-detail.js';

const TAU = Math.PI * 2;
const required = ['speed', 'wheelOmega', 'wheelAngle', 'pressure', 'commandedPressure', 'brakeTorque',
  'brakeTorqueCapacity', 'clampForce', 'tireForce', 'discTemperatureC', 'brakeHeat', 'tireLoss',
  'discCoolingEnergy', 'initialEnergy', 'kineticEnergy', 'cutoffResidualEnergy', 'numericalProjectionEnergy',
  'energyResidual', 'targetSlip'];

/** Pure observations of a solved state. No pressure, heat or motion is integrated here. */
export function brakeDetail(snapshot, settings) {
  if (!snapshot || !required.every(key => Number.isFinite(snapshot[key]))
    || !Number.isFinite(snapshot.padNormalForce?.inboard) || !Number.isFinite(snapshot.padNormalForce?.outboard)) return null;
  const s = snapshot, cfg = normalizeSettings(settings), active = !s.stopped;
  const diameterList = cfg.caliper === 'floating' ? [cfg.pistonDiameter] : cfg.fixedPistonDiameters;
  const pistonAreas = diameterList.map(d => Math.PI * d * d / 4);
  const hydraulicAreaPerSideM2 = pistonAreas.reduce((sum, area) => sum + area, 0);
  const effectiveClampAreaM2 = hydraulicAreaPerSideM2 * 2;
  const pressureRatePaPerS = !active ? 0 : s.absPhase === 'decrease' ? -s.pressure / cfg.pressureDumpTime
    : s.absPhase === 'hold' ? 0 : (s.commandedPressure - s.pressure) / cfg.pressureFillTime;
  const brakePowerW = s.brakeTorque * s.wheelOmega;
  const heatInputW = cfg.discHeatShare * brakePowerW;
  // step() freezes the entire stopped state, including its temperature. The
  // displayed derivative must follow that boundary rather than imply cooldown.
  const coolingPowerW = active ? cfg.coolingWattsPerK * (s.discTemperatureC - cfg.ambientTemperatureC) : 0;
  const heatCapacityJPerK = cfg.discMass * cfg.discHeatCapacity;
  const absorbedHeatJ = cfg.discHeatShare * s.brakeHeat;
  const storedHeatJ = heatCapacityJPerK * (s.discTemperatureC - cfg.initialTemperatureC);
  const tireSlipSpeedMps = s.speed - cfg.wheelRadius * s.wheelOmega;
  const slip = Number.isFinite(s.slip) ? s.slip : null;
  const accountedJ = s.kineticEnergy + s.brakeHeat + s.tireLoss + s.cutoffResidualEnergy + s.numericalProjectionEnergy;
  return {
    active,
    rotor: {
      meanSurfaceSpeedMps: cfg.padMeanRadius * s.wheelOmega,
      outerEdgeSpeedMps: cfg.discOuterRadius * s.wheelOmega,
      brakePowerW, heatInputW, coolingPowerW, heatCapacityJPerK,
      bulkTemperatureC: s.discTemperatureC,
      bulkTemperatureRateKPerS: active ? (heatInputW - coolingPowerW) / heatCapacityJPerK : 0,
      absorbedHeatJ, storedHeatJ, removedHeatJ: s.discCoolingEnergy,
      thermalClosureJ: storedHeatJ - absorbedHeatJ + s.discCoolingEnergy,
      surfaceTemperatureSolved: false,
    },
    caliper: {
      type: cfg.caliper,
      pistonCount: diameterList.length * (cfg.caliper === 'floating' ? 1 : 2),
      hydraulicAreaPerSideM2,
      physicalPistonAreaM2: hydraulicAreaPerSideM2 * (cfg.caliper === 'floating' ? 1 : 2),
      effectiveClampAreaM2,
      inboardNormalForceN: s.padNormalForce.inboard, outboardNormalForceN: s.padNormalForce.outboard,
      clampForceN: s.clampForce, torqueCapacityNm: s.brakeTorqueCapacity, actualTorqueNm: s.brakeTorque,
      forceClosureN: s.clampForce - s.pressure * effectiveClampAreaM2,
    },
    pads: {
      frictionCoefficient: cfg.padFriction, meanRadiusM: cfg.padMeanRadius,
      tangentialForceCapacityN: cfg.padFriction * s.clampForce,
      actualTangentialForceN: s.brakeTorque / cfg.padMeanRadius,
      contactPressureSolved: false,
    },
    wheel: {
      rpm: s.wheelOmega * 60 / TAU, omegaRadPerS: s.wheelOmega,
      circumferentialSpeedMps: cfg.wheelRadius * s.wheelOmega,
      vehicleSpeedMps: s.speed, tireSlipSpeedMps,
      angularAccelerationRadPerS2: active ? (cfg.wheelRadius * s.tireForce - s.brakeTorque) / cfg.wheelInertia : 0,
      tireLossPowerW: s.tireForce * tireSlipSpeedMps,
    },
    hydraulics: {
      phase: s.absPhase, pressurePa: s.pressure, commandedPressurePa: s.commandedPressure,
      pressureRatePaPerS, targetSlip: s.targetSlip,
      lowerSlip: s.targetSlip - cfg.absSlipBand, upperSlip: s.targetSlip + cfg.absSlipBand,
      slip, slipError: slip === null ? null : slip - s.targetSlip,
      controlPeriodS: 0.005,
      inletOpen: s.inletOpen, outletOpen: s.outletOpen, pumpActive: s.pumpActive,
      flowSolved: false,
    },
    encoder: { teeth: ENCODER_TEETH, pulseHz: ENCODER_TEETH * Math.abs(s.wheelOmega) / TAU, signalNoiseSolved: false },
    bearing: hubBearingKinematics({ wheelAngle: s.wheelAngle, wheelOmega: s.wheelOmega }),
    energy: {
      initialJ: s.initialEnergy, remainingKineticJ: s.kineticEnergy, brakeHeatJ: s.brakeHeat,
      tireLossJ: s.tireLoss, cutoffJ: s.cutoffResidualEnergy, projectionJ: s.numericalProjectionEnergy,
      residualJ: s.energyResidual, accountedJ,
    },
  };
}
