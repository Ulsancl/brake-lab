import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, compareAbs, MODEL_VERSION } from '../src/model.js';
import { projectFormat, projectVersion, validateComparison, parseProject, makeProject, ProjectError } from '../src/project.js';

const baseline = compareAbs({ speedKmh: 80 });
const clone = (x) => structuredClone(x);
const file = () => makeProject(normalizeSettings({ speedKmh: 80 }), { mode: 'cutaway', cutaway: 0.7, explode: 0.2, labels: false }, baseline);
const rejects = (data, code) => assert.throws(() => parseProject(typeof data === 'string' ? data : JSON.stringify(data)),
  (error) => error instanceof ProjectError && error.preserveOriginal && (!code || error.code === code));

test('project round trip retains original results and merges only saved view keys', () => {
  const data = file(); const parsed = parseProject(JSON.stringify(data), { selectedPart: 'rotor', camera: 'front' });
  assert.equal(data.format, projectFormat); assert.equal(data.version, projectVersion);
  assert.deepEqual(parsed.comparison, baseline); assert.deepEqual(parsed.settings, data.settings);
  assert.equal(parsed.view.selectedPart, 'rotor'); assert.equal(parsed.view.camera, 'front');
  assert.equal(parsed.view.labels, false); assert.equal(parsed.view.cutaway, 0.7);
});

test('canonical settings comparison ignores object key order', () => {
  const data = file();
  const reverse = (x) => Object.fromEntries(Object.entries(x).reverse());
  data.settings = reverse(data.settings); data.comparison.settings = reverse(data.comparison.settings);
  data.comparison.withoutAbs.settings = reverse(data.comparison.withoutAbs.settings);
  data.comparison.withAbs.settings = reverse(data.comparison.withAbs.settings);
  assert.deepEqual(parseProject(JSON.stringify(data)).comparison, data.comparison);
});

test('no comparison is valid and returned objects do not alias the caller', () => {
  const cfg = normalizeSettings(); const view = { mode: 'assembled' };
  const data = makeProject(cfg, view, null); assert.equal(data.comparison, null);
  view.mode = 'exploded'; assert.equal(data.view.mode, 'assembled');
  assert.deepEqual(parseProject(JSON.stringify(data)).settings, cfg);
  const restored = validateComparison(baseline); restored.withAbs.samples[0].speed = 0;
  assert.equal(baseline.withAbs.samples[0].speed, 80 / 3.6);
});

test('zero speed allows one stopped sample with zero distance/time', () => {
  const comparison = compareAbs({ speedKmh: 0 });
  const parsed = parseProject(JSON.stringify(makeProject({ speedKmh: 0 }, {}, comparison)));
  assert.equal(parsed.comparison.withAbs.samples.length, 1);
  assert.equal(parsed.comparison.withAbs.summary.stopTime, 0);
  assert.equal(parsed.comparison.withAbs.summary.stopDistance, 0);
  assert.equal(parsed.comparison.difference.stopDistance, 0);
});

test('zero pressure and duration exhaustion allow null stopping values without recomputation', () => {
  const comparison = compareAbs({ pressureBar: 0 }, { duration: 0.05 });
  const parsed = parseProject(JSON.stringify(makeProject({ pressureBar: 0 }, {}, comparison)));
  assert.equal(parsed.comparison.withAbs.summary.stopped, false);
  assert.equal(parsed.comparison.withAbs.summary.stopTime, null);
  assert.equal(parsed.comparison.difference.stopDistance, null);
  assert.deepEqual(parsed.comparison, comparison);
});

test('future schema and model are explicitly preserved', () => {
  const schema = file(); schema.version++; rejects(schema, 'FUTURE_SCHEMA');
  const model = file(); model.modelVersion = 'brake-2.0.0'; rejects(model, 'FUTURE_MODEL');
  try { parseProject(JSON.stringify(schema)); } catch (error) { assert.equal(error.futureVersion, true); }
  const old = file(); old.modelVersion = 'brake-0.9.0'; rejects(old, 'UNSUPPORTED_MODEL');
});

test('format/version/missing fields are rejected without mutating previous state', () => {
  for (const update of [{ format: 'other' }, { version: 0 }, { version: '1' }]) rejects({ ...file(), ...update });
  for (const key of ['settings', 'view', 'comparison']) { const data = file(); delete data[key]; rejects(data); }
  const data = file(), original = clone(data); data.comparison.withAbs.summary.stopDistance++;
  const before = clone(data); rejects(data); assert.deepEqual(data, before); assert.notDeepEqual(data, original);
});

test('settings reject unsupported values, normalized clamping, unknown keys and conflicting aliases', () => {
  for (const patch of [{ pressureBar: 161 }, { road: 'wet' }, { mass: null }, { abs: 'true' },
    { surprise: 1 }, { absEnabled: false }, { fixedPistonDiametersMm: [0] }]) {
    const data = file(); Object.assign(data.settings, patch); rejects(data);
  }
});

test('missing comparison top metadata fails before rendering can access it', () => {
  for (const key of ['modelVersion', 'settings', 'difference', 'withAbs', 'withoutAbs']) {
    const data = file(); delete data.comparison[key]; rejects(data);
  }
  const data = file(); data.comparison.extra = 1; rejects(data);
});

test('comparison runs must match top settings with ABS as their only change', () => {
  const wrongAbs = file(); wrongAbs.comparison.withAbs.settings = normalizeSettings({ ...wrongAbs.comparison.withAbs.settings, abs: false }); rejects(wrongAbs);
  const wrongMass = file(); wrongMass.comparison.withAbs.settings = normalizeSettings({ ...wrongMass.comparison.withAbs.settings, mass: 400 }); rejects(wrongMass);
  const wrongTop = file(); wrongTop.comparison.settings = normalizeSettings({ ...wrongTop.comparison.settings, pressureBar: 50 }); rejects(wrongTop);
  const wrongModel = file(); wrongModel.comparison.withAbs.modelVersion = 'brake-2.0.0'; rejects(wrongModel);
});

test('summary and final sample must agree on stopping and accumulated quantities', () => {
  for (const key of ['stopDistance', 'stopTime', 'distance', 'elapsedTime', 'lockTime', 'brakeHeat', 'peakTemperatureC', 'energyResidual']) {
    const data = file(); data.comparison.withAbs.summary[key] += 1; rejects(data);
  }
  const negative = file(); negative.comparison.withAbs.summary.stopDistance = -1; rejects(negative);
  const stopped = file(); stopped.comparison.withAbs.summary.stopped = false; rejects(stopped);
});

test('difference is derived from the two summaries and incomplete values remain null', () => {
  for (const key of ['stopDistance', 'stopTime', 'lockTime']) {
    const data = file(); data.comparison.difference[key] += 1; rejects(data);
  }
  const data = makeProject({ pressureBar: 0 }, {}, compareAbs({ pressureBar: 0 }, { duration: 0.05 }));
  data.comparison.difference.stopDistance = 0; rejects(data);
});

test('sample fields are finite with monotonic time and correct first-state conditions', () => {
  for (const patch of [{ time: -1 }, { speed: null }, { pressure: -1 }, { wheelOmega: -1 },
    { initialEnergy: null }, { discTemperatureC: null }, { commandedPressure: 1 }]) {
    const data = file(); Object.assign(data.comparison.withAbs.samples[0], patch); rejects(data);
  }
  const duplicate = file(); duplicate.comparison.withAbs.samples[1].time = 0; rejects(duplicate);
  const changed = file(); changed.comparison.withAbs.samples[0].speed = 1; rejects(changed);
});

test('sample limit/count, extra fields, phase/valve consistency and aliases are checked', () => {
  const tooMany = file(); const run = tooMany.comparison.withAbs;
  while (run.samples.length <= 501) run.samples.push(clone(run.samples.at(-1))); run.summary.sampleCount = run.samples.length; rejects(tooMany);
  const wrongCount = file(); wrongCount.comparison.withAbs.summary.sampleCount++; rejects(wrongCount);
  const extra = file(); extra.comparison.withAbs.samples[0].unknown = 1; rejects(extra);
  const valves = file(); valves.comparison.withAbs.samples[0].outletOpen = true; rejects(valves);
  const angle = file(); angle.comparison.withAbs.samples[0].angle = 10; rejects(angle);
});

test('view values are bounded and stored schema ignores transient caller-only controls', () => {
  const data = makeProject({}, { mode: 'cutaway', camera: 'top', selectedPart: 'pad', quality: 'low' });
  assert.deepEqual(Object.keys(data.view).sort(), ['cutaway', 'explode', 'labels', 'mode']);
  for (const patch of [{ mode: 'other' }, { cutaway: 2 }, { explode: null }, { labels: 1 }, { extra: 1 }]) {
    const bad = file(); Object.assign(bad.view, patch); rejects(bad);
  }
});

test('JSON text is limited by UTF-8 bytes and dangerous unknown property names are rejected', () => {
  rejects(' '.repeat(10 * 1024 * 1024 + 1) + '{}', 'PROJECT_TOO_LARGE');
  rejects('"' + '한'.repeat(3_500_000) + '"', 'PROJECT_TOO_LARGE');
  rejects('{', 'INVALID_JSON');
  const text = JSON.stringify(file()).replace('"format":', '"__proto__":{"polluted":true},"format":');
  rejects(text); assert.equal({}.polluted, undefined);
});

test('very low initial speed cutoff and empty-duration comparison are valid recorded outcomes', () => {
  const nearZero = compareAbs({ speedKmh: 0.01 });
  assert.equal(validateComparison(nearZero).withAbs.summary.stopped, true);
  const empty = compareAbs({}, { duration: 0 });
  assert.equal(validateComparison(empty).withAbs.samples.length, 1);
  assert.equal(empty.withAbs.summary.stopDistance, null);
});

test('canonical project model version is retained in every layer', () => {
  const data = file(); const parsed = parseProject(JSON.stringify(data));
  assert.equal(data.modelVersion, MODEL_VERSION); assert.equal(parsed.comparison.modelVersion, MODEL_VERSION);
  assert.equal(parsed.comparison.withoutAbs.modelVersion, MODEL_VERSION);
  assert.ok(parsed.comparison.withAbs.samples.every((sample) => sample.modelVersion === MODEL_VERSION));
});
