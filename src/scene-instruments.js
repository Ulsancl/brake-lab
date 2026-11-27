const HEAT_MIN_C = 20;
const HEAT_MAX_C = 220;
const PRESSURE_MAX_BAR = 160;
const PRESSURE_WINDOW_S = 1;
const SVG = 'http://www.w3.org/2000/svg';

const phases = {
  increase: '압력 증가', hold: '압력 유지', decrease: '감압',
  off: 'ABS 꺼짐', 'low-speed': '저속 제어 해제', stopped: '정지'
};

const clampUnit = value => Math.min(1, Math.max(0, value));
export const rotorHeatRatio = temperature => Number.isFinite(temperature)
  ? clampUnit((temperature - HEAT_MIN_C) / (HEAT_MAX_C - HEAT_MIN_C)) : 0;

export function createRigInstruments(host) {
  const document = host.ownerDocument;
  const panel = document.createElement('div');
  panel.className = 'brake-scene-state';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', '시험 장치 계기 · 시뮬레이션 값');

  function readout(label) {
    const cell = document.createElement('div');
    cell.className = 'brake-rig-readout';
    const caption = document.createElement('span');
    caption.textContent = label;
    const value = document.createElement('strong');
    const scale = document.createElement('small');
    cell.append(caption, value, scale);
    panel.appendChild(cell);
    return { cell, value, scale };
  }

  const heat = readout('로터 평균 온도');
  heat.cell.classList.add('brake-rig-thermal');
  heat.scale.textContent = `색상 ${HEAT_MIN_C}–${HEAT_MAX_C} °C`;
  const heatTrack = document.createElement('i');
  heatTrack.className = 'brake-rig-heat-track';
  heatTrack.setAttribute('aria-hidden', 'true');
  heat.cell.insertBefore(heatTrack, heat.scale);

  const pressure = readout('캘리퍼 압력');
  pressure.scale.textContent = `최근 1초 · 0–${PRESSURE_MAX_BAR} bar`;
  const trace = document.createElementNS(SVG, 'svg');
  trace.classList.add('brake-rig-pressure-trace');
  trace.setAttribute('aria-hidden', 'true');
  trace.setAttribute('viewBox', '0 0 100 12');
  trace.setAttribute('preserveAspectRatio', 'none');
  const line = document.createElementNS(SVG, 'path');
  const marker = document.createElementNS(SVG, 'path');
  marker.classList.add('brake-rig-pressure-marker');
  trace.append(line, marker);
  pressure.cell.insertBefore(trace, pressure.scale);

  const abs = readout('ABS 단계');
  abs.cell.classList.add('brake-rig-abs');
  host.appendChild(panel);

  const samples = [];
  let currentTime = Number.NaN;
  let currentBar = Number.NaN;

  function updateTrace(time, bar) {
    if (time === currentTime && bar === currentBar) return;
    if (!Number.isFinite(time) || !Number.isFinite(bar)) {
      samples.length = 0;
      line.removeAttribute('d');
      marker.removeAttribute('d');
    } else {
      if (time < currentTime) samples.length = 0;
      const centisecond = Math.floor(time * 100 + 1e-6);
      if (samples.at(-1)?.centisecond === centisecond) samples.pop();
      samples.push({ time, bar, centisecond });
      const start = time - PRESSURE_WINDOW_S;
      while (samples[0].time < start) samples.shift();

      const y = value => (11 - 10 * clampUnit(value / PRESSURE_MAX_BAR)).toFixed(2);
      // Leave gaps when playback or a time jump omits a span of samples.
      const path = samples.map((sample, index) => {
        const move = index === 0 || sample.time - samples[index - 1].time > .15;
        const x = 98 * (sample.time - start) / PRESSURE_WINDOW_S;
        return `${move ? 'M' : 'L'}${x.toFixed(2)} ${y(sample.bar)}`;
      }).join('');
      line.setAttribute('d', path);
      marker.setAttribute('d', `M96 ${y(bar)}H99`);
    }
    currentTime = time;
    currentBar = bar;
  }

  return {
    element: panel,
    update(snapshot) {
      const temperature = snapshot.discTemperatureC;
      const bar = Number.isFinite(snapshot.pressure) ? Math.max(0, snapshot.pressure / 1e5) : Number.NaN;
      heat.value.textContent = Number.isFinite(temperature) ? `${temperature.toFixed(1)} °C` : '—';
      heatTrack.style.setProperty('--heat-position', `${rotorHeatRatio(temperature) * 100}%`);
      heatTrack.classList.toggle('has-value', Number.isFinite(temperature));
      pressure.value.textContent = Number.isFinite(bar) ? `${bar.toFixed(1)} bar` : '—';
      updateTrace(snapshot.time, bar);
      const phase = Object.hasOwn(phases, snapshot.absPhase) ? snapshot.absPhase : '';
      abs.cell.dataset.phase = phase;
      abs.value.textContent = phases[phase] ?? '대기';
      const valve = open => open === true ? '열림' : open === false ? '닫힘' : '—';
      abs.scale.textContent = `입구 ${valve(snapshot.inletOpen)} · 출구 ${valve(snapshot.outletOpen)}`;
    }
  };
}
