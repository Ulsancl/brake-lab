import assert from 'node:assert/strict';
import test from 'node:test';
import { compareAbs, runExperiment } from '../src/model.js';
import { makeProject, parseProject, ProjectError } from '../src/project.js';

test('starting disc temperature shifts the thermal trace for both ABS modes', () => {
  const cold = compareAbs({ initialTemperatureC: 20, coolingWattsPerK: 0 });
  const warm = compareAbs({ initialTemperatureC: 300, coolingWattsPerK: 0 });
  for (const mode of ['withoutAbs', 'withAbs']) {
    const coldRun = cold[mode];
    const warmRun = warm[mode];
    assert.equal(warmRun.samples[0].discTemperatureC, 300);
    assert.ok(Math.abs(warmRun.summary.peakTemperatureC - coldRun.summary.peakTemperatureC - 280) < 1e-8);
    assert.equal(warmRun.summary.stopDistance, coldRun.summary.stopDistance);
    assert.equal(warmRun.summary.brakeHeat, coldRun.summary.brakeHeat);
  }
});

test('cooling coefficient and ambient temperature independently change signed heat exchange', () => {
  const settings = { initialTemperatureC: 200, ambientTemperatureC: -40 };
  const insulated = runExperiment({ ...settings, coolingWattsPerK: 0 });
  const cooled = runExperiment({ ...settings, coolingWattsPerK: 100 });
  const warmerAir = runExperiment({ ...settings, ambientTemperatureC: 60, coolingWattsPerK: 100 });
  const insulatedStop = insulated.samples.at(-1);
  const cooledStop = cooled.samples.at(-1);
  const warmerAirStop = warmerAir.samples.at(-1);

  assert.equal(insulatedStop.discCoolingEnergy, 0);
  assert.ok(cooledStop.discCoolingEnergy > warmerAirStop.discCoolingEnergy);
  assert.ok(warmerAirStop.discCoolingEnergy > 0);
  assert.ok(cooledStop.discTemperatureC < warmerAirStop.discTemperatureC);
  assert.ok(warmerAirStop.discTemperatureC < insulatedStop.discTemperatureC);
  assert.ok(Math.abs(cooledStop.thermalResidual) < 1e-6);
  assert.equal(cooled.summary.stopDistance, insulated.summary.stopDistance);

  const heatedByAir = runExperiment({
    pressureBar: 0, initialTemperatureC: -20, ambientTemperatureC: 60, coolingWattsPerK: 100,
  }, { duration: 1 }).samples.at(-1);
  assert.ok(heatedByAir.discCoolingEnergy < 0);
  assert.ok(heatedByAir.discTemperatureC > -20);
});

test('the v1 project keeps archived thermal conditions and recorded results when current conditions differ', () => {
  // A short archived run would have different samples and summaries if opened as a fresh comparison.
  const archived = compareAbs({}, { duration: 0.05 });
  const current = { initialTemperatureC: 231.125, ambientTemperatureC: -12.75, coolingWattsPerK: 87.25 };
  const project = makeProject(current, {}, archived);
  assert.equal(project.version, 1);
  assert.equal(project.modelVersion, 'brake-1.0.0');

  const parsed = parseProject(JSON.stringify(project));
  for (const [key, value] of Object.entries(current)) assert.equal(parsed.settings[key], value);
  assert.equal(parsed.comparison.settings.initialTemperatureC, 20);
  assert.equal(parsed.comparison.settings.ambientTemperatureC, 20);
  assert.equal(parsed.comparison.settings.coolingWattsPerK, 12);
  assert.deepEqual(parsed.comparison, archived);
  assert.deepEqual(makeProject(parsed.settings, parsed.view, parsed.comparison), project);

  project.comparison.withAbs.settings.coolingWattsPerK = 100;
  assert.throws(() => parseProject(JSON.stringify(project)), error => error instanceof ProjectError && error.preserveOriginal);
});
