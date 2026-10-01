import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAbs } from '../src/model.js';
import { describeComparisonEnergy } from '../src/comparison-energy.js';

const safeText = (text) => {
  assert.equal(typeof text, 'string');
  assert.doesNotMatch(text, /NaN|Infinity|undefined|<[^>]*>/);
  assert.ok((text.match(/\.(?:\s|$)/g) || []).length <= 4, text);
};
const amounts = (text, off, on) => {
  assert.ok(text.includes(`ABS 끔 ${(off.brakeHeat / 1000).toFixed(1)} kJ, 켬 ${(on.brakeHeat / 1000).toFixed(1)} kJ`), text);
  assert.ok(text.includes(`ABS 끔 ${(off.tireLoss / 1000).toFixed(1)} kJ, 켬 ${(on.tireLoss / 1000).toFixed(1)} kJ`), text);
};
// Minimal presentation records are not assertions about physically achievable experiments.
const fixture = (off = {}, on = {}) => ({
  withoutAbs: { summary: { stopped: true, brakeHeat: 100000, tireLoss: 50000,
    peakTemperatureC: 40, initialEnergy: 150000, ...off } },
  withAbs: { summary: { stopped: true, brakeHeat: 120000, tireLoss: 30000,
    peakTemperatureC: 45, initialEnergy: 150000, ...on } },
});
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

test('real default: saved J values become kJ and the observed energy split is separated from the causes of temperature', () => {
  const comparison = compareAbs();
  const original = JSON.stringify(comparison);
  const off = comparison.withoutAbs.summary, on = comparison.withAbs.summary;
  assert.ok(on.brakeHeat > off.brakeHeat && on.tireLoss < off.tireLoss && on.peakTemperatureC > off.peakTemperatureC);
  const text = describeComparisonEnergy(comparison);
  amounts(text, off, on);
  assert.ok(text.includes(`ABS 끔 ${off.peakTemperatureC.toFixed(1)}°C, 켬 ${on.peakTemperatureC.toFixed(1)}°C`));
  assert.match(text, /이 모형/);
  assert.match(text, /ABS 켬의 브레이크 열이 더 크고 타이어·노면 손실이 더 작/);
  assert.match(text, /열 배분과 주변과의 열교환도 함께 반영/);
  assert.match(text, /더 높은 온도만으로 ABS가 실패했다고 볼 수 없/);
  assert.equal(JSON.stringify(comparison), original);
  safeText(text);
});

test('real supported warm-ambient case: zero disc heat share never attributes a higher peak to larger brake heat', () => {
  const comparison = compareAbs({ road: 'high', pressureBar: 60,
    pressureFillTime: .5, pressureDumpTime: .015, discHeatShare: 0,
    initialTemperatureC: 0, ambientTemperatureC: 60,
    discMass: 1, discHeatCapacity: 250, coolingWattsPerK: 100 });
  const off = comparison.withoutAbs.summary, on = comparison.withAbs.summary;
  assert.equal(comparison.withAbs.settings.discHeatShare, 0);
  assert.ok(on.stopped && off.stopped && on.brakeHeat > off.brakeHeat && on.tireLoss < off.tireLoss);
  assert.ok(on.peakTemperatureC > off.peakTemperatureC && on.elapsedTime > off.elapsedTime);
  // No brake heat reaches the disc: its positive temperature comes from the warmer ambient air.
  assert.ok(off.peakTemperatureC > 0 && on.peakTemperatureC > 0);
  const text = describeComparisonEnergy(comparison);
  amounts(text, off, on);
  assert.match(text, /ABS 켬의 브레이크 열이 더 크고 타이어·노면 손실이 더 작/);
  assert.match(text, /열 배분과 주변과의 열교환도 함께 반영/);
  assert.doesNotMatch(text, /브레이크 열이 늘면서 온도가 높|열이 커서 온도가 더 높/);
  safeText(text);
});

test('real zero pressure: zero dissipation and equal peak temperatures remain partial records, not an ABS benefit', () => {
  const comparison = compareAbs({ pressureBar: 0 }, { duration: 2 });
  assert.equal(comparison.withAbs.summary.stopped, false);
  assert.equal(comparison.withoutAbs.summary.brakeHeat, 0);
  assert.equal(comparison.withAbs.summary.tireLoss, 0);
  const text = describeComparisonEnergy(comparison);
  amounts(text, comparison.withoutAbs.summary, comparison.withAbs.summary);
  assert.match(text, /두 기록 모두 아직 정지하지 않아/);
  assert.match(text, /기록된 구간까지만/);
  assert.doesNotMatch(text, /처음부터 정지|몫이 줄|실패했다고|표시상 같/);
  safeText(text);
});

test('real zero speed: signed Celsius is valid and an already stationary record is separated from heating or ABS effects', () => {
  const comparison = compareAbs({ speedKmh: 0, initialTemperatureC: -20, ambientTemperatureC: -20 });
  assert.equal(comparison.withAbs.summary.initialEnergy, 0);
  const text = describeComparisonEnergy(comparison);
  assert.match(text, /ABS 끔 -20\.0°C, 켬 -20\.0°C/);
  assert.match(text, /처음부터 정지한 기록/);
  assert.match(text, /제동으로 소모된 에너지가 없/);
  assert.doesNotMatch(text, /아직 정지하지|몫이 줄|실패했다고/);
  safeText(text);
});

test('real low pressure: equal completed records do not invent energy redistribution or an ABS advantage', () => {
  const comparison = compareAbs({ pressureBar: 5 });
  assert.equal(comparison.withAbs.summary.stopped, true);
  assert.deepEqual(comparison.withoutAbs.summary.brakeHeat, comparison.withAbs.summary.brakeHeat);
  assert.deepEqual(comparison.withoutAbs.summary.peakTemperatureC, comparison.withAbs.summary.peakTemperatureC);
  const text = describeComparisonEnergy(comparison);
  amounts(text, comparison.withoutAbs.summary, comparison.withAbs.summary);
  assert.match(text, /소수 첫째 자리 표시상 같/);
  assert.doesNotMatch(text, /몫이 줄|온도가 더 높|실패했다고|더 좋|더 짧/);
  safeText(text);
});

test('partial presentation records identify either unfinished run and never describe partial heat as a completed comparison', () => {
  for (const [offStopped, onStopped, name] of [[true, false, '켬'], [false, true, '끔']]) {
    const comparison = fixture({ stopped: offStopped }, { stopped: onStopped });
    const text = describeComparisonEnergy(comparison);
    amounts(text, comparison.withoutAbs.summary, comparison.withAbs.summary);
    assert.ok(text.includes(`ABS ${name} 기록이 아직 정지하지 않아`));
    assert.match(text, /기록된 구간까지만/);
    assert.doesNotMatch(text, /몫이 줄|온도가 더 높|실패했다고|표시상 같/);
    safeText(text);
  }
});

test('presentation branches follow displayed temperatures and saved energy, ignore all settings, and leave frozen originals intact', () => {
  const cases = [
    [fixture({ brakeHeat: 120000, tireLoss: 30000, peakTemperatureC: 45 },
      { brakeHeat: 100000, tireLoss: 50000, peakTemperatureC: 40 }), /ABS 끔의 브레이크 열이 더 크고 타이어·노면 손실이 더 작/],
    [fixture({ peakTemperatureC: 40.01 }, { peakTemperatureC: 40.049 }), /소수 첫째 자리 표시상 같/],
    [fixture({ brakeHeat: 120000, tireLoss: 30000, peakTemperatureC: 40 },
      { brakeHeat: 100000, tireLoss: 50000, peakTemperatureC: 45 }), /디스크 배분과 주변과의 열교환이 함께 반영/],
  ];
  for (const [comparison, expected] of cases) {
    const original = JSON.stringify(comparison);
    for (const object of [comparison, comparison.withoutAbs, comparison.withAbs]) {
      Object.defineProperty(object, 'settings', { get() { throw new Error('Presentation must not read settings'); } });
    }
    Object.defineProperty(comparison, 'difference', { get() { throw new Error('Presentation must not read cached differences'); } });
    freeze(comparison);
    const text = describeComparisonEnergy(comparison);
    assert.match(text, expected);
    assert.equal(JSON.stringify(comparison), original);
    safeText(text);
  }
});

test('missing, nonfinite, wrong-type or negative energy never becomes fabricated zero heat or invalid displayed numbers', () => {
  const invalid = [null, {}, { withoutAbs: null }, fixture({ brakeHeat: NaN }), fixture({}, { tireLoss: Infinity }),
    fixture({ brakeHeat: -1 }), fixture({}, { tireLoss: '12' }), fixture({ peakTemperatureC: -Infinity }),
    fixture({}, { initialEnergy: NaN }), fixture({ stopped: 'true' }), fixture({ brakeHeat: undefined }),
    { withoutAbs: { summary: [] }, withAbs: { summary: {} } }];
  for (const comparison of invalid) {
    const text = describeComparisonEnergy(comparison);
    assert.match(text, /기록이 부족하거나 유효하지 않아/);
    assert.doesNotMatch(text, /0\.0|kJ|°C|실패|몫이 줄/);
    safeText(text);
  }
});
