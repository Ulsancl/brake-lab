import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAbs } from '../src/model.js';
import { describeComparison } from '../src/comparison-summary.js';

const safeText = (result) => {
  assert.equal(typeof result.headline, 'string');
  assert.equal(typeof result.detail, 'string');
  assert.ok(['shorter', 'longer', 'similar', 'incomplete', 'stationary'].includes(result.direction));
  assert.doesNotMatch(`${result.headline} ${result.detail}`, /NaN|Infinity|<[^>]*>/);
};

// These minimal records exercise presentation branches only. They are not
// model runs and make no assertion that their numbers describe a physical stop.
const fixture = ({ offDistance = 20, onDistance = 18, offLock = 2, onLock = 0,
  offStopped = true, onStopped = true, speedKmh = 100, pressureBar = 60 } = {}) => ({
  settings: { speedKmh, pressureBar },
  withoutAbs: { summary: { stopped: offStopped, stopDistance: offStopped ? offDistance : null,
    lockTime: offLock, distance: 987 } },
  withAbs: { summary: { stopped: onStopped, stopDistance: onStopped ? onDistance : null,
    lockTime: onLock, distance: 654 } },
  difference: { stopDistance: -999, lockTime: -999 },
});

test('real model: the default captured comparison reports the measured shorter stop and lock reduction', () => {
  const comparison = compareAbs();
  const result = describeComparison(comparison);
  const distance = comparison.withAbs.summary.stopDistance - comparison.withoutAbs.summary.stopDistance;
  const locks = comparison.withoutAbs.summary.lockTime - comparison.withAbs.summary.lockTime;
  assert.ok(distance < 0 && locks > 0);
  assert.equal(result.direction, 'shorter');
  assert.ok(result.headline.includes(`${Math.abs(distance).toFixed(1)} m 더 짧`));
  assert.ok(result.detail.includes(`${locks.toFixed(1)}초 줄었습니다`));
  assert.match(result.detail, /ABS 끔 .*초, ABS 켬 .*초/);
  safeText(result);
});

test('real model: zero pressure leaves both stops incomplete and requests pressure without guessing a distance', () => {
  const comparison = compareAbs({ pressureBar: 0 }, { duration: 2 });
  assert.equal(comparison.withoutAbs.summary.stopDistance, null);
  assert.equal(comparison.withAbs.summary.stopDistance, null);
  const result = describeComparison(comparison);
  assert.equal(result.direction, 'incomplete');
  assert.match(result.headline, /켠 기록과 끈 기록 모두.*완료되지/);
  assert.match(result.detail, /압력.*높여.*다시 비교/);
  assert.doesNotMatch(result.headline, /\d|더 짧|더 깁/);
  safeText(result);
});

test('real model: zero initial speed is stationary rather than an ABS benefit', () => {
  const comparison = compareAbs({ speedKmh: 0 });
  assert.equal(comparison.withoutAbs.samples.length, 1);
  assert.equal(comparison.withAbs.samples.length, 1);
  const result = describeComparison(comparison);
  assert.equal(result.direction, 'stationary');
  assert.match(result.headline, /처음부터 정지.*효과를 비교할 수 없/);
  assert.match(result.detail, /시작 속도를 높여/);
  assert.doesNotMatch(result.headline, /더 짧|더 깁|비슷/);
  safeText(result);
});

test('presentation fixture: longer stop and more lock time use saved summaries, ignore cached differences, and preserve the record', () => {
  const comparison = fixture({ offDistance: 20, onDistance: 21.2, offLock: 0.5, onLock: 1.8 });
  const before = JSON.stringify(comparison);
  Object.freeze(comparison.settings);
  Object.freeze(comparison.withAbs.summary);
  Object.freeze(comparison.withoutAbs.summary);
  Object.freeze(comparison);
  const result = describeComparison(comparison);
  assert.equal(result.direction, 'longer');
  assert.match(result.headline, /1\.2 m 더 깁니다/);
  assert.match(result.detail, /1\.3초 늘었습니다/);
  assert.equal(JSON.stringify(comparison), before);
  safeText(result);
});

test('presentation fixtures: one-decimal rounding decides similar, including both signs and the 0.05 m boundary', () => {
  for (const [offDistance, onDistance, direction] of [
    [0.049, 0, 'similar'], [0, 0.049, 'similar'], [0, 0, 'similar'],
    [0.05, 0, 'shorter'], [0, 0.05, 'longer'],
    [0.051, 0, 'shorter'], [0, 0.051, 'longer'],
  ]) {
    const result = describeComparison(fixture({ offDistance, onDistance }));
    assert.equal(result.direction, direction, `${offDistance} / ${onDistance}`);
    if (direction === 'similar') {
      assert.match(result.headline, /비슷/);
      assert.doesNotMatch(result.headline, /0\.0 m|더 짧|더 깁/);
    } else assert.match(result.headline, /0\.1 m/);
    safeText(result);
  }
});

test('presentation fixtures: identify exactly which run is incomplete without treating partial travel as a stopping distance', () => {
  for (const [offStopped, onStopped, name] of [[true, false, '켠'], [false, true, '끈']]) {
    const result = describeComparison(fixture({ offStopped, onStopped }));
    assert.equal(result.direction, 'incomplete');
    assert.ok(result.headline.includes(`ABS를 ${name} 기록의 정지가 완료되지`));
    assert.doesNotMatch(result.headline, /모두|\d|더 짧|더 깁/);
    assert.match(result.detail, /기록된 시간 동안.*정지 거리를 비교할 수 없/);
    assert.doesNotMatch(result.detail, /987|654|압력.*높여/);
    safeText(result);
  }
});

test('presentation fixtures: absent or nonfinite data never leaks invalid numbers or HTML into text', () => {
  for (const comparison of [null, {}, fixture({ onDistance: NaN }), fixture({ offDistance: Infinity })]) {
    const result = describeComparison(comparison);
    assert.equal(result.direction, 'incomplete');
    safeText(result);
  }
  const comparison = fixture({ offLock: Infinity, onLock: NaN });
  comparison.settings.road = '<img src=x onerror=alert(1)>';
  const result = describeComparison(comparison);
  assert.equal(result.direction, 'shorter');
  assert.match(result.detail, /잠긴 시간은 기록에서 확인할 수 없/);
  safeText(result);
});
