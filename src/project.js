import { MODEL_VERSION, normalizeSettings } from './model.js';

export const projectFormat = 'brake-lab-project';
export const projectVersion = 1;
const MAX_BYTES = 10 * 1024 * 1024;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export class ProjectError extends Error {
  constructor(message, code = 'INVALID_PROJECT') {
    super(`${message} 원본 파일은 변경하지 않습니다.`);
    this.name = 'ProjectError';
    this.code = code;
    this.preserveOriginal = true;
    this.futureVersion = code === 'FUTURE_SCHEMA' || code === 'FUTURE_MODEL';
  }
}
const fail = (message, code) => { throw new ProjectError(message, code); };

function shape(value, keys, label) {
  if (!record(value)) fail(`${label} 형식이 올바르지 않습니다.`);
  const own = Object.keys(value);
  if (own.length !== keys.length || own.some((key) => !keys.includes(key))) {
    fail(`${label}에 누락되거나 지원하지 않는 항목이 있습니다.`);
  }
}

function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (!record(a) || !record(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

function settings(value, label) {
  if (!record(value)) fail(`${label} 설정 형식이 올바르지 않습니다.`);
  const normalized = normalizeSettings(value);
  if (!equal(value, normalized)) fail(`${label} 조건에 지원하지 않는 값이나 항목이 있습니다.`);
  return normalized;
}

function numeric(value, label, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} 수치가 올바르지 않습니다.`);
  }
}
function near(a, b, label) {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)
    || Math.abs(a - b) > 1e-8 + 1e-10 * Math.max(Math.abs(a), Math.abs(b))) {
    fail(`${label} 기록이 서로 일치하지 않습니다.`);
  }
}
function bool(value, label) { if (typeof value !== 'boolean') fail(`${label} 상태가 올바르지 않습니다.`); }

const summaryKeys = ['stopped', 'stopDistance', 'stopTime', 'distance', 'elapsedTime', 'lockTime',
  'peakTemperatureC', 'brakeHeat', 'tireLoss', 'initialEnergy', 'cutoffResidualEnergy',
  'numericalProjectionEnergy', 'energyResidual', 'thermalResidual', 'finalSpeed', 'absTransitions',
  'integrationStep', 'sampleCount'];
const sampleKeys = ['modelVersion', 'time', 'distance', 'speed', 'wheelOmega', 'wheelAngle', 'angle',
  'slip', 'effectiveSlip', 'pressure', 'commandedPressure', 'brakeTorque', 'brakeTorqueCapacity',
  'tireForce', 'roadMu', 'normalForce', 'discTemperatureC', 'absPhase', 'inletOpen', 'outletOpen',
  'pumpActive', 'clampForce', 'padNormalForce', 'stopped', 'lockTime', 'brakeHeat', 'tireLoss',
  'discCoolingEnergy', 'initialEnergy', 'kineticEnergy', 'cutoffResidualEnergy', 'numericalProjectionEnergy',
  'energyResidual', 'thermalResidual', 'peakTemperatureC', 'targetSlip', 'absTransitions', 'integrationStep'];
const sampleNonnegative = ['time', 'distance', 'speed', 'wheelOmega', 'wheelAngle', 'angle', 'pressure',
  'commandedPressure', 'brakeTorque', 'brakeTorqueCapacity', 'roadMu', 'normalForce', 'clampForce',
  'lockTime', 'brakeHeat', 'tireLoss', 'initialEnergy', 'kineticEnergy', 'cutoffResidualEnergy',
  'numericalProjectionEnergy', 'absTransitions'];
const commonKeys = ['lockTime', 'peakTemperatureC', 'brakeHeat', 'tireLoss', 'initialEnergy',
  'cutoffResidualEnergy', 'numericalProjectionEnergy', 'energyResidual', 'thermalResidual',
  'absTransitions', 'integrationStep'];

function sample(value, cfg, index, previous, integrationStep) {
  const label = `비교 기록 ${index + 1}`;
  shape(value, sampleKeys, label);
  if (value.modelVersion !== MODEL_VERSION) fail('비교 기록의 계산 모형 버전을 지원하지 않습니다.', 'UNSUPPORTED_MODEL');
  for (const key of sampleNonnegative) numeric(value[key], `${label} ${key}`, 0);
  for (const key of ['tireForce', 'discTemperatureC', 'discCoolingEnergy', 'energyResidual', 'thermalResidual', 'peakTemperatureC']) numeric(value[key], `${label} ${key}`);
  numeric(value.effectiveSlip, `${label} effectiveSlip`, -1, 1);
  numeric(value.targetSlip, `${label} targetSlip`, 0, 1);
  if (value.slip !== null) numeric(value.slip, `${label} slip`, -1, 1);
  for (const key of ['inletOpen', 'outletOpen', 'pumpActive', 'stopped']) bool(value[key], `${label} ${key}`);
  if (!Number.isInteger(value.absTransitions)) fail('ABS 전환 횟수가 올바르지 않습니다.');
  near(value.integrationStep, integrationStep, '적분 간격');
  near(value.commandedPressure, cfg.pressureBar * 1e5, '운전자 명령 압력');
  near(value.normalForce, cfg.mass * 9.81, '수직하중');
  near(value.angle, value.wheelAngle, '바퀴 각도');
  if (value.pressure > value.commandedPressure + 1e-7) fail('캘리퍼 압력이 운전자 명령을 넘습니다.');
  if (value.brakeTorque > value.brakeTorqueCapacity + 1e-7) fail('브레이크 토크가 용량을 넘습니다.');
  shape(value.padNormalForce, ['inboard', 'outboard'], '패드 힘');
  numeric(value.padNormalForce.inboard, '안쪽 패드 힘', 0);
  numeric(value.padNormalForce.outboard, '바깥쪽 패드 힘', 0);
  near(value.clampForce, value.padNormalForce.inboard + value.padNormalForce.outboard, '패드 힘 합');
  near(Math.abs(value.tireForce), value.roadMu * value.normalForce, '노면 힘');
  if (value.lockTime > value.time + 1e-8) fail('잠김 시간이 경과 시간을 넘습니다.');
  if (value.peakTemperatureC + 1e-8 < value.discTemperatureC) fail('최고 온도가 현재 온도보다 낮습니다.');
  if (value.stopped) {
    if (value.speed !== 0 || value.wheelOmega !== 0 || value.absPhase !== 'stopped'
      || value.inletOpen || value.outletOpen || value.pumpActive) fail('정지 상태 기록이 서로 일치하지 않습니다.');
  } else {
    const allowed = cfg.abs ? ['increase', 'hold', 'decrease', 'low-speed'] : ['off'];
    if (!allowed.includes(value.absPhase)) fail('ABS 단계와 비교 조건이 일치하지 않습니다.');
    if (value.outletOpen !== (value.absPhase === 'decrease') || value.pumpActive !== value.outletOpen
      || value.inletOpen !== !['hold', 'decrease'].includes(value.absPhase)) fail('ABS 밸브 상태가 단계와 일치하지 않습니다.');
  }
  if ((value.speed < 0.5) !== (value.slip === null)) fail('저속 슬립 표시가 올바르지 않습니다.');
  if (previous) {
    if (value.time <= previous.time || value.distance + 1e-8 < previous.distance
      || value.brakeHeat + 1e-8 < previous.brakeHeat || value.tireLoss + 1e-8 < previous.tireLoss
      || value.lockTime + 1e-8 < previous.lockTime || value.peakTemperatureC + 1e-8 < previous.peakTemperatureC) {
      fail('비교 기록의 시간 또는 누적량 순서가 올바르지 않습니다.');
    }
    if (previous.stopped) fail('정지 이후의 추가 진행 기록을 지원하지 않습니다.');
    near(value.initialEnergy, previous.initialEnergy, '초기 에너지');
  } else {
    near(value.time, 0, '첫 기록 시간'); near(value.distance, 0, '첫 기록 거리');
    near(value.brakeHeat, 0, '첫 기록 브레이크 열'); near(value.tireLoss, 0, '첫 기록 타이어 손실');
    const startSpeed = cfg.speedKmh / 3.6;
    near(value.speed, startSpeed <= 0.02 ? 0 : startSpeed, '시작 속도');
    near(value.wheelOmega, startSpeed <= 0.02 ? 0 : startSpeed / cfg.wheelRadius, '시작 바퀴 속도');
    near(value.discTemperatureC, cfg.initialTemperatureC, '시작 온도');
  }
}

function run(value, expectedSettings, name) {
  shape(value, ['modelVersion', 'settings', 'summary', 'samples'], name);
  if (value.modelVersion !== MODEL_VERSION) fail(`${name} 계산 모형 버전을 지원하지 않습니다.`, 'UNSUPPORTED_MODEL');
  const cfg = settings(value.settings, name);
  if (!equal(cfg, expectedSettings)) fail(`${name} 조건이 원래 비교 조건과 일치하지 않습니다.`);
  shape(value.summary, summaryKeys, `${name} 요약`);
  const s = value.summary;
  bool(s.stopped, `${name} 정지`);
  for (const key of ['distance', 'elapsedTime', 'lockTime', 'brakeHeat', 'tireLoss', 'initialEnergy',
    'cutoffResidualEnergy', 'numericalProjectionEnergy', 'finalSpeed', 'absTransitions']) numeric(s[key], `${name} ${key}`, 0);
  for (const key of ['peakTemperatureC', 'energyResidual', 'thermalResidual']) numeric(s[key], `${name} ${key}`);
  if (![0.001, 0.0005, 0.00025, 0.000125].includes(s.integrationStep)) fail('지원하지 않는 적분 간격입니다.');
  if (!Number.isInteger(s.absTransitions)) fail('ABS 전환 횟수가 올바르지 않습니다.');
  if (!Array.isArray(value.samples) || value.samples.length < 1 || value.samples.length > 501
    || s.sampleCount !== value.samples.length) fail('비교 기록은 1..501개여야 하며 요약과 개수가 같아야 합니다.');
  let previous = null;
  for (let i = 0; i < value.samples.length; i++) {
    sample(value.samples[i], cfg, i, previous, s.integrationStep);
    previous = value.samples[i];
  }
  const last = previous;
  if (s.stopped !== last.stopped) fail('요약의 정지 여부가 마지막 기록과 일치하지 않습니다.');
  near(s.elapsedTime, last.time, '경과 시간'); near(s.distance, last.distance, '누적 거리');
  near(s.finalSpeed, last.speed, '마지막 속도');
  for (const key of commonKeys) near(s[key], last[key], key);
  if (s.stopped) {
    numeric(s.stopTime, '정지 시간', 0); numeric(s.stopDistance, '정지 거리', 0);
    near(s.stopTime, last.time, '정지 시간'); near(s.stopDistance, last.distance, '정지 거리');
  } else if (s.stopTime !== null || s.stopDistance !== null) fail('미완료 실험의 정지 시간과 거리는 비어 있어야 합니다.');
  return value;
}

export function validateComparison(value) {
  if (value === null) return null;
  shape(value, ['modelVersion', 'settings', 'withoutAbs', 'withAbs', 'difference'], '비교 결과');
  if (value.modelVersion !== MODEL_VERSION) fail('비교 결과의 계산 모형 버전을 지원하지 않습니다.', 'UNSUPPORTED_MODEL');
  const cfg = settings(value.settings, '비교');
  const off = run(value.withoutAbs, normalizeSettings({ ...cfg, abs: false }), 'ABS 끔');
  const on = run(value.withAbs, normalizeSettings({ ...cfg, abs: true }), 'ABS 켬');
  shape(value.difference, ['stopDistance', 'stopTime', 'lockTime'], '비교 차이');
  const complete = off.summary.stopped && on.summary.stopped;
  for (const key of ['stopDistance', 'stopTime']) {
    if (complete) near(value.difference[key], on.summary[key] - off.summary[key], key);
    else if (value.difference[key] !== null) fail('미완료 비교의 정지 차이는 비어 있어야 합니다.');
  }
  near(value.difference.lockTime, on.summary.lockTime - off.summary.lockTime, '잠김 시간 차이');
  return structuredClone(value);
}

const viewDefaults = { mode: 'cutaway', cutaway: 0.65, explode: 0.5, labels: true };
function savedView(value) {
  shape(value, ['mode', 'cutaway', 'explode', 'labels'], '관찰 화면');
  if (!['assembled', 'cutaway', 'exploded'].includes(value.mode)) fail('지원하지 않는 관찰 방식입니다.');
  numeric(value.cutaway, '절개 비율', 0, 1); numeric(value.explode, '분해 비율', 0, 1);
  bool(value.labels, '이름표');
  return structuredClone(value);
}

function newerModel(version) {
  const parse = (text) => typeof text === 'string' ? /^brake-(\d+)\.(\d+)\.(\d+)$/.exec(text)?.slice(1).map(Number) : null;
  const candidate = parse(version), current = parse(MODEL_VERSION);
  if (!candidate || !current) return false;
  for (let i = 0; i < 3; i++) { if (candidate[i] !== current[i]) return candidate[i] > current[i]; }
  return false;
}

export function parseProject(text, currentView = {}) {
  if (typeof text !== 'string') fail('실험 파일은 JSON 텍스트여야 합니다.', 'INVALID_JSON');
  if (text.length > MAX_BYTES || new TextEncoder().encode(text).byteLength > MAX_BYTES) {
    fail('실험 파일은 10 MiB 이하여야 합니다.', 'PROJECT_TOO_LARGE');
  }
  let data;
  try { data = JSON.parse(text); } catch { fail('JSON 실험 파일을 읽을 수 없습니다.', 'INVALID_JSON'); }
  if (!record(data) || data.format !== projectFormat) fail('지원하지 않는 실험 파일 형식입니다.', 'UNSUPPORTED_FORMAT');
  if (Number.isInteger(data.version) && data.version > projectVersion) fail('새로운 저장 형식을 보호합니다.', 'FUTURE_SCHEMA');
  if (data.version !== projectVersion) fail('지원하지 않는 저장 형식 버전입니다.', 'UNSUPPORTED_SCHEMA');
  if (data.modelVersion !== MODEL_VERSION) {
    fail('이 계산 모형 버전의 원래 기록을 보호합니다.', newerModel(data.modelVersion) ? 'FUTURE_MODEL' : 'UNSUPPORTED_MODEL');
  }
  shape(data, ['format', 'version', 'modelVersion', 'settings', 'view', 'comparison'], '실험 파일');
  const cfg = settings(data.settings, '현재');
  const comparison = validateComparison(data.comparison);
  const view = { ...(record(currentView) ? structuredClone(currentView) : {}), ...savedView(data.view) };
  return { settings: cfg, view, comparison };
}

export function makeProject(input, view = {}, comparison = null) {
  const cfg = normalizeSettings(input);
  const picked = { ...viewDefaults };
  for (const key of Object.keys(picked)) if (record(view) && Object.hasOwn(view, key)) picked[key] = view[key];
  return { format: projectFormat, version: projectVersion, modelVersion: MODEL_VERSION,
    settings: structuredClone(cfg), view: savedView(picked), comparison: validateComparison(comparison) };
}
