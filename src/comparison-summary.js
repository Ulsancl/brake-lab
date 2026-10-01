// Presentation only: describe the captured summaries without running the model again.
const nonnegativeFinite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const displayedMagnitude = (value) => Number(Math.abs(value).toFixed(1));
const decimal = (value) => value.toFixed(1);

function lockDetail(withoutAbs, withAbs) {
  const off = withoutAbs.lockTime;
  const on = withAbs.lockTime;
  if (!nonnegativeFinite(off) || !nonnegativeFinite(on)) {
    return '바퀴가 잠긴 시간은 기록에서 확인할 수 없습니다.';
  }
  const difference = on - off;
  const amount = displayedMagnitude(difference);
  const recorded = `기록된 시간 동안 바퀴가 잠긴 시간은 ABS 끔 ${decimal(off)}초, ABS 켬 ${decimal(on)}초입니다.`;
  if (amount === 0) return `${recorded} 표시상 잠김 시간은 비슷합니다.`;
  return `${recorded} ABS를 켠 기록에서 잠김 시간이 ${decimal(amount)}초 ${difference < 0 ? '줄었습니다' : '늘었습니다'}.`;
}

/**
 * Return plain Korean text for an already captured ABS comparison.
 * direction: shorter | longer | similar | incomplete | stationary.
 * A distance difference displayed as 0.0 m at one decimal place is "similar".
 * The caller can retain the more precise distances in its existing detail table.
 */
export function describeComparison(comparison) {
  const off = comparison?.withoutAbs?.summary;
  const on = comparison?.withAbs?.summary;
  if (!off || !on || typeof off.stopped !== 'boolean' || typeof on.stopped !== 'boolean') {
    return {
      headline: '비교 기록이 부족해 결과를 확인할 수 없습니다.',
      detail: '유효한 비교 기록을 불러오거나 새 비교를 실행해 주세요.',
      direction: 'incomplete',
    };
  }

  const locks = lockDetail(off, on);
  if (!off.stopped || !on.stopped) {
    const unfinished = !off.stopped && !on.stopped
      ? 'ABS를 켠 기록과 끈 기록 모두'
      : !on.stopped ? 'ABS를 켠 기록의' : 'ABS를 끈 기록의';
    const advice = comparison?.settings?.pressureBar === 0
      ? '제동 압력이 0이므로 압력을 높여 다시 비교해 보세요.'
      : '조건을 조정해 다시 비교해 보세요.';
    return {
      headline: `${unfinished} 정지가 완료되지 않았습니다.`,
      detail: `${locks} 아직 정지 거리를 비교할 수 없습니다. ${advice}`,
      direction: 'incomplete',
    };
  }

  if (!nonnegativeFinite(off.stopDistance) || !nonnegativeFinite(on.stopDistance)) {
    return {
      headline: '정지 거리 정보가 없어 비교를 완료할 수 없습니다.',
      detail: `${locks} 유효한 비교 기록을 불러오거나 새 비교를 실행해 주세요.`,
      direction: 'incomplete',
    };
  }

  if (comparison?.settings?.speedKmh === 0) {
    return {
      headline: '처음부터 정지한 조건이라 ABS 효과를 비교할 수 없습니다.',
      detail: `${locks} 시작 속도를 높여 다시 비교해 보세요.`,
      direction: 'stationary',
    };
  }

  // Read the two stored summaries, rather than trusting a cached difference or
  // using today's model/settings to recompute an older experiment.
  const difference = on.stopDistance - off.stopDistance;
  const amount = displayedMagnitude(difference);
  if (amount === 0) {
    return {
      headline: 'ABS를 켠 기록과 끈 기록의 정지 거리는 표시상 비슷합니다.',
      detail: `${locks} 정지 거리 차이는 소수 첫째 자리 기준으로 비교했습니다.`,
      direction: 'similar',
    };
  }
  return {
    headline: `ABS를 켠 기록의 정지 거리가 ${decimal(amount)} m 더 ${difference < 0 ? '짧습니다' : '깁니다'}.`,
    detail: locks,
    direction: difference < 0 ? 'shorter' : 'longer',
  };
}
