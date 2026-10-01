// Presentation only: energy is stored in joules; temperatures are in Celsius.
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value) => finite(value) && value >= 0;
const displayed = (value, divisor = 1) => Number((value / divisor).toFixed(1));
const decimal = (value, divisor = 1) => displayed(value, divisor).toFixed(1);

function validSummary(summary) {
  return summary && typeof summary === 'object' && !Array.isArray(summary)
    && typeof summary.stopped === 'boolean'
    && nonnegative(summary.brakeHeat) && nonnegative(summary.tireLoss)
    && finite(summary.peakTemperatureC)
    && (summary.initialEnergy === undefined || nonnegative(summary.initialEnergy));
}

/** Describe only the two saved summaries, without reading settings or rerunning physics. */
export function describeComparisonEnergy(comparison) {
  const off = comparison?.withoutAbs?.summary;
  const on = comparison?.withAbs?.summary;
  if (!validSummary(off) || !validSummary(on)) {
    return '열·온도 기록이 부족하거나 유효하지 않아 에너지 분배를 비교할 수 없습니다.';
  }

  const sentences = [
    `브레이크에서 열로 바뀐 에너지는 ABS 끔 ${decimal(off.brakeHeat, 1000)} kJ, 켬 ${decimal(on.brakeHeat, 1000)} kJ입니다.`,
    `타이어·노면에서 소모된 에너지는 ABS 끔 ${decimal(off.tireLoss, 1000)} kJ, 켬 ${decimal(on.tireLoss, 1000)} kJ입니다.`,
    `디스크 평균 온도의 최고값은 ABS 끔 ${decimal(off.peakTemperatureC)}°C, 켬 ${decimal(on.peakTemperatureC)}°C입니다.`,
  ];
  const noDissipation = off.brakeHeat === 0 && on.brakeHeat === 0
    && off.tireLoss === 0 && on.tireLoss === 0;
  if (off.stopped && on.stopped && off.initialEnergy === 0 && on.initialEnergy === 0 && noDissipation) {
    sentences.push('처음부터 정지한 기록이라 제동으로 소모된 에너지가 없으며, 이 온도를 ABS의 효과로 해석하지 않습니다.');
  } else if (!off.stopped || !on.stopped) {
    const unfinished = !off.stopped && !on.stopped ? '두 기록 모두' : !on.stopped ? 'ABS 켬 기록이' : 'ABS 끔 기록이';
    sentences.push(`${unfinished} 아직 정지하지 않아, 에너지와 최고 온도는 기록된 구간까지만의 값입니다.`);
  } else {
    const offTemperature = displayed(off.peakTemperatureC);
    const onTemperature = displayed(on.peakTemperatureC);
    const offHeat = displayed(off.brakeHeat, 1000), onHeat = displayed(on.brakeHeat, 1000);
    const offTire = displayed(off.tireLoss, 1000), onTire = displayed(on.tireLoss, 1000);
    if (offTemperature === onTemperature) {
      sentences.push('최고 온도는 소수 첫째 자리 표시상 같으며, 이 온도만으로 ABS의 차이를 구분할 수 없습니다.');
    } else if (onTemperature > offTemperature && onHeat > offHeat && onTire < offTire) {
      sentences.push('이 모형의 기록에서는 ABS 켬의 브레이크 열이 더 크고 타이어·노면 손실이 더 작으며, 디스크 온도에는 열 배분과 주변과의 열교환도 함께 반영되므로 더 높은 온도만으로 ABS가 실패했다고 볼 수 없습니다.');
    } else if (offTemperature > onTemperature && offHeat > onHeat && offTire < onTire) {
      sentences.push('이 기록에서는 ABS 끔의 브레이크 열이 더 크고 타이어·노면 손실이 더 작으며, 디스크 온도에는 열 배분과 주변과의 열교환도 함께 반영되므로 온도만으로 ABS의 효과를 판단할 수 없습니다.');
    } else {
      sentences.push('이 모형의 온도에는 브레이크 열의 디스크 배분과 주변과의 열교환이 함께 반영되므로, 온도 차이만으로 ABS의 효과를 판단할 수 없습니다.');
    }
  }
  return sentences.join(' ');
}
