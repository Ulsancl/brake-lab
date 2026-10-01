import { brakeDetail } from './detail-model.js';
export { brakeDetail } from './detail-model.js';

const phases = { increase: '압력 증가', hold: '압력 유지', decrease: '압력 감소', off: 'ABS 끔', stopped: '정지 완료', 'low-speed': '저속 · 운전자 압력' };

/** Values remain numeric until the UI formats them; SI conversion is explicit. */
export function describeBrakeDetail(partId, snapshot, settings) {
  const d = brakeDetail(snapshot, settings);
  if (!d) return { facts: [], note: '계산 상태를 확인할 수 없습니다.' };
  const facts = [], add = (label, value, unit = '', digits = 1) => facts.push({ label, value, unit, digits });
  const { rotor: r, caliper: c, hydraulics: h, wheel: w } = d;
  const stoppedNote = d.active ? '' : ' 정지 완료 뒤에는 실험 상태를 고정하므로 냉각과 압력 변화도 진행하지 않습니다.';
  let note;
  if (partId === 'rotor') {
    add('평균 접촉 반경 선속도', r.meanSurfaceSpeedMps, 'm/s');
    add('실제 제동 동력', r.brakePowerW / 1000, 'kW', 2);
    add('디스크 유입 열률', r.heatInputW / 1000, 'kW', 2);
    add('주변으로의 열교환률', r.coolingPowerW / 1000, 'kW', 2);
    add('디스크 평균 온도', r.bulkTemperatureC, '°C');
    add('평균 온도 변화율', r.bulkTemperatureRateKPerS, '°C/s', 2);
    note = '동력은 실제 토크 × 각속도입니다. 온도는 디스크 전체의 평균이며 마찰면 최고 온도가 아닙니다. 열교환률이 음수이면 주변에서 열을 받습니다.' + stoppedNote;
  } else if (partId === 'caliper' || partId === 'pistons') {
    add('실제 피스톤 수', c.pistonCount, '개', 0);
    add('한쪽 유압 면적', c.hydraulicAreaPerSideM2 * 1e4, 'cm²', 2);
    add('합산 압착 유효 면적', c.effectiveClampAreaM2 * 1e4, 'cm²', 2);
    add('캘리퍼 압력', h.pressurePa / 1e5, 'bar');
    add('안쪽 패드 수직력', c.inboardNormalForceN / 1000, 'kN', 2);
    add('바깥쪽 패드 수직력', c.outboardNormalForceN / 1000, 'kN', 2);
    note = c.type === 'floating'
      ? '플로팅형의 실제 피스톤은 한쪽에 있습니다. 몸체 반작용으로 반대 패드도 눌러 양쪽 수직력 합은 2PA입니다. 피스톤 이동·실 변형은 계산하지 않습니다.'
      : '지름 배열은 각 측의 피스톤을 뜻합니다. 양쪽의 유압 면적 합이 압착 유효 면적이며, 압착 유효 면적이 같으면 기본 플로팅형과 제동력이 같습니다.';
  } else if (partId === 'pads') {
    add('안쪽 패드 수직력', c.inboardNormalForceN / 1000, 'kN', 2);
    add('바깥쪽 패드 수직력', c.outboardNormalForceN / 1000, 'kN', 2);
    add('패드 마찰 계수', d.pads.frictionCoefficient, '', 3);
    add('평균 작용 반경', d.pads.meanRadiusM * 1000, 'mm');
    add('토크 용량', c.torqueCapacityNm, 'N·m');
    add('실제 반작용 토크', c.actualTorqueNm, 'N·m');
    note = '바퀴가 잠기면 필요한 정지 반작용만 발생하며 용량 전체를 쓰지 않을 수 있습니다. 패드 형상은 대표 배치이며 접촉 압력·마모·페이드는 계산하지 않습니다.';
  } else if (partId === 'encoder' || partId === 'sensor') {
    add('대표 인코더 잇수', d.encoder.teeth, '개', 0);
    add('이상 톱니 통과 빈도', d.encoder.pulseHz, 'Hz');
    add('바퀴 회전수', w.rpm, 'rpm');
    add('바퀴 원주 속도', w.circumferentialSpeedMps * 3.6, 'km/h');
    add('차량 속도', w.vehicleSpeedMps * 3.6, 'km/h');
    add('제동 슬립', h.slip === null ? '정지 근처' : h.slip * 100, h.slip === null ? '' : '%');
    note = '표시된 48개 톱니가 센서를 지나는 이상 빈도입니다. 센서 신호·샘플링·잡음은 모사하지 않으며 ABS는 실제 차량 속도를 정확히 안다고 가정합니다.';
  } else if (partId === 'bearing') {
    add('내륜 회전수', d.bearing.innerRpm, 'rpm');
    add('외륜 회전수', 0, 'rpm', 0);
    add('케이지 공전', d.bearing.cageRpm, 'rpm');
    add('볼 자전 · 고정 좌표', d.bearing.ballWorldRpm, 'rpm');
    add('볼 중심 피치 지름', d.bearing.pitchRadius * 2000, 'mm', 2);
    add('대표 볼 지름', d.bearing.ballRadius * 2000, 'mm', 2);
    note = '그려진 두 줄 베어링의 대표 치수와 접촉각 0°, 미끄럼 없는 운동 관계입니다. 실제 허브 베어링의 접촉 하중·마찰·수명은 계산하지 않습니다.';
  } else if (partId === 'hydraulic-unit' || partId === 'valves') {
    add('현재 제어 단계', phases[h.phase] || h.phase);
    add('캘리퍼 압력', h.pressurePa / 1e5, 'bar');
    add('현재 단계 압력 변화율', h.pressureRatePaPerS / 1e5, 'bar/s');
    add('목표 슬립 범위', `${(h.lowerSlip * 100).toFixed(1)}–${(h.upperSlip * 100).toFixed(1)}`, '%');
    add('입구 밸브', h.inletOpen ? '열림' : '닫힘');
    add('출구 밸브', h.outletOpen ? '열림' : '닫힘');
    note = '5 ms마다 단계를 고르는 교육용 제어입니다. 변화율은 현재 단계의 압력식이며 다음 전환을 예측하지 않습니다. 2 m/s 미만에서는 운전자 압력으로 복귀합니다.' + stoppedNote;
  } else if (partId === 'pump') {
    add('환류 경로 상태', h.pumpActive ? '감압 중 작동 표시' : '대기');
    add('캘리퍼 압력', h.pressurePa / 1e5, 'bar');
    add('현재 단계 압력 변화율', h.pressureRatePaPerS / 1e5, 'bar/s');
    add('운전자 명령 압력', h.commandedPressurePa / 1e5, 'bar');
    add('실제 유량·펌프 회전수', '계산하지 않음');
    note = '펌프 가동 표시는 감압 환류 경로의 역할을 설명합니다. 펌프 압력·소비 동력·유량 해석 결과가 아닙니다.' + stoppedNote;
  } else if (['hose', 'bleeder', 'seals'].includes(partId)) {
    add('운전자 명령 압력', h.commandedPressurePa / 1e5, 'bar');
    add('캘리퍼 압력', h.pressurePa / 1e5, 'bar');
    add('현재 단계 압력 변화율', h.pressureRatePaPerS / 1e5, 'bar/s');
    add('유로별 유량·압력 강하', '계산하지 않음');
    note = '하나의 캘리퍼 압력 상태를 표시합니다. 호스 팽창·누유·기포·블리더 유출·실 변형은 계산하지 않습니다.' + stoppedNote;
  } else if (partId === 'hub') {
    add('허브 회전수', w.rpm, 'rpm');
    add('각속도', w.omegaRadPerS, 'rad/s', 2);
    add('각가속도', w.angularAccelerationRadPerS2, 'rad/s²', 2);
    add('바퀴 원주 속도', w.circumferentialSpeedMps, 'm/s');
    add('실제 제동 토크', c.actualTorqueNm, 'N·m');
    note = '허브·로터·인코더는 같은 바퀴 각도로 회전합니다. 각가속도는 계산된 노면 토크와 브레이크 반작용의 차이를 관성으로 나눈 값입니다.';
  } else {
    add('양쪽 패드 수직력 합', c.clampForceN / 1000, 'kN', 2);
    add('실제 제동 토크', c.actualTorqueNm, 'N·m');
    add('누적 브레이크 열', d.energy.brakeHeatJ / 1000, 'kJ', 2);
    add('누적 타이어 손실', d.energy.tireLossJ / 1000, 'kJ', 2);
    note = '이 수치는 제동계 전체의 작동 조건입니다. 선택 부품에 걸리는 개별 힘·응력·변형·내구 수명은 계산하지 않습니다.';
  }
  return { facts, note };
}
