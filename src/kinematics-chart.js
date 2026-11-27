const WINDOW_SECONDS = 1;
const SAMPLE_BUCKETS_PER_SECOND = 200;
const MAX_LINE_GAP_SECONDS = 0.1;
const PASCALS_PER_BAR = 100_000;
const number = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const percent = value => `${number.format(value * 100)}%`;
const bar = value => `${number.format(value)} bar`;

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function drawPlot(plot, samples, start, end, { min, max, color, axisLabel, valueOf, reference }) {
  const { context, width, height } = plot;
  if (!context || width < 120 || height < 44) return;
  const { canvas } = context;
  const scale = Math.min(devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(width * scale), pixelHeight = Math.round(height * scale);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  context.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
  context.clearRect(0, 0, width, height);

  const left = 47, right = width - 13, top = 9, bottom = height - 20;
  const x = time => left + (time - start) / WINDOW_SECONDS * (right - left);
  const y = value => bottom - (value - min) / (max - min) * (bottom - top);
  context.font = '10px Segoe UI, Malgun Gothic, sans-serif';
  context.textBaseline = 'middle';
  context.lineWidth = 1;
  context.strokeStyle = '#334953';
  context.fillStyle = '#a6bbc6';
  context.textAlign = 'right';
  for (const value of [min, (min + max) / 2, max]) {
    const row = y(value);
    context.fillText(axisLabel(value), left - 6, row);
    context.beginPath();
    context.moveTo(left, row);
    context.lineTo(right, row);
    context.stroke();
  }
  for (const [position, time, align] of [[left, start, 'left'], [(left + right) / 2, (start + end) / 2, 'center'], [right, end, 'right']]) {
    context.textAlign = align;
    context.fillText(`${time.toFixed(2)} s`, position, height - 6);
  }

  context.save();
  context.beginPath();
  context.rect(left - 3, top - 3, right - left + 6, bottom - top + 6);
  context.clip();
  reference(context, left, right, y);
  context.beginPath();
  let previous = null;
  for (const sample of samples) {
    const value = valueOf(sample);
    if (value === null) {
      previous = null;
      continue;
    }
    const pointX = x(sample.time), pointY = y(value);
    if (previous === null || sample.time - previous > MAX_LINE_GAP_SECONDS) context.moveTo(pointX, pointY);
    else context.lineTo(pointX, pointY);
    previous = sample.time;
  }
  context.lineWidth = 2;
  context.strokeStyle = color;
  context.lineJoin = 'round';
  context.stroke();
  const latest = samples.at(-1), liveValue = valueOf(latest);
  if (liveValue !== null) {
    context.beginPath();
    context.arc(x(latest.time), y(liveValue), 3, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
  }
  context.restore();
}

export function createKinematicsChart(anchor) {
  const template = document.createElement('template');
  template.innerHTML = `
    <section class="kinematics" aria-labelledby="kinematics-heading">
      <header class="kinematics-heading">
        <h3 id="kinematics-heading">제동 파형</h3>
        <p>최근 1초 · 시뮬레이션 경과 시간</p>
      </header>
      <dl class="kinematics-grid">
        <div class="kinematics-card kinematics-slip">
          <dt>바퀴 슬립</dt>
          <dd class="kinematics-value" data-kinematics="slip"></dd>
          <dd class="kinematics-reference" data-kinematics="target"></dd>
          <dd class="kinematics-plot" aria-hidden="true"><canvas></canvas></dd>
        </div>
        <div class="kinematics-card kinematics-pressure">
          <dt>캘리퍼 압력</dt>
          <dd class="kinematics-value" data-kinematics="pressure"></dd>
          <dd class="kinematics-reference" data-kinematics="command"></dd>
          <dd class="kinematics-plot" aria-hidden="true"><canvas></canvas></dd>
        </div>
      </dl>
    </section>`;
  const section = template.content.firstElementChild;
  anchor.after(section);
  const readout = key => section.querySelector(`[data-kinematics="${key}"]`);
  const slip = readout('slip'), target = readout('target');
  const pressure = readout('pressure'), command = readout('command');
  const plots = Array.from(section.querySelectorAll('canvas'), canvas => ({ canvas, context: canvas.getContext('2d'), width: 0, height: 0 }));
  const samples = [];
  let latestSnapshot, latestSettings, visible = false;

  function draw() {
    if (!visible || !latestSnapshot) return;
    const end = Math.max(WINDOW_SECONDS, latestSnapshot.time), start = end - WINDOW_SECONDS;
    const commandedBar = latestSnapshot.commandedPressure / PASCALS_PER_BAR;
    const pressureLimit = Math.max(20, Math.ceil(commandedBar / 20) * 20);
    const lowerSlip = latestSnapshot.targetSlip - latestSettings.absSlipBand;
    const upperSlip = latestSnapshot.targetSlip + latestSettings.absSlipBand;
    drawPlot(plots[0], samples, start, end, {
      min: -1, max: 1, color: '#77e0d0', axisLabel: value => `${value * 100}%`, valueOf: sample => sample.slip,
      reference(context, left, right, y) {
        if (!latestSettings.abs) return;
        context.fillStyle = '#2b544e';
        context.fillRect(left, y(upperSlip), right - left, y(lowerSlip) - y(upperSlip));
      }
    });
    drawPlot(plots[1], samples, start, end, {
      min: 0, max: pressureLimit, color: '#ffb786', axisLabel: value => `${value} bar`, valueOf: sample => sample.pressureBar,
      reference(context, left, right, y) {
        const row = y(commandedBar);
        context.setLineDash([4, 4]);
        context.strokeStyle = '#c6a289';
        context.beginPath();
        context.moveTo(left, row);
        context.lineTo(right, row);
        context.stroke();
        context.setLineDash([]);
      }
    });
  }

  const observer = new ResizeObserver(entries => {
    for (const { target: canvas, contentRect } of entries) {
      const plot = plots.find(candidate => candidate.canvas === canvas);
      plot.width = contentRect.width;
      plot.height = contentRect.height;
    }
    draw();
  });
  for (const plot of plots) observer.observe(plot.canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    draw();
  }).observe(section);

  return {
    render(snapshot, settings) {
      if (snapshot === latestSnapshot && settings === latestSettings) return;
      const settingsChanged = settings !== latestSettings;
      if (settingsChanged) {
        section.dataset.abs = String(settings.abs);
        setText(target, settings.abs
          ? `ABS 기준 범위 ${percent(snapshot.targetSlip - settings.absSlipBand)}–${percent(snapshot.targetSlip + settings.absSlipBand)}`
          : 'ABS 꺼짐');
        setText(command, `운전자 설정 ${bar(snapshot.commandedPressure / PASCALS_PER_BAR)}`);
      }
      if (settingsChanged || snapshot.time < latestSnapshot.time) samples.length = 0;
      latestSnapshot = snapshot;
      latestSettings = settings;

      const { time } = snapshot;
      const pressureBar = snapshot.pressure / PASCALS_PER_BAR;
      // Retain the newest rendered state in each simulation-time bucket.
      const sample = { time, slip: snapshot.slip, pressureBar, bucket: Math.floor(time * SAMPLE_BUCKETS_PER_SECOND) };
      if (samples.at(-1)?.bucket === sample.bucket) samples[samples.length - 1] = sample;
      else samples.push(sample);
      while (samples.length > 1 && samples[1].time < time - WINDOW_SECONDS) samples.shift();

      setText(slip, sample.slip === null ? '저속 · 계산 범위 미만' : percent(sample.slip));
      setText(pressure, bar(pressureBar));
      draw();
    }
  };
}
