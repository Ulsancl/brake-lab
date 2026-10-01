import { describeBrakeDetail } from './detail-readouts.js';

const format = (value, digits = 1) => Number.isFinite(value)
  ? value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  : typeof value === 'string' ? value : '—';

function renderFacts(list, facts) {
  const signature = facts.map(fact => fact.label).join('|');
  if (list.dataset.signature !== signature) {
    list.replaceChildren(...facts.map(fact => {
      const row = document.createElement('div'); row.className = 'detail-fact';
      row.dataset.label = fact.label;
      const label = document.createElement('dt'); label.textContent = fact.label;
      row.append(label, document.createElement('dd'));
      return row;
    }));
    list.dataset.signature = signature;
  }
  facts.forEach((fact, index) => {
    const row = list.children[index], value = `${format(fact.value, fact.digits ?? 1)}${fact.unit ? ' ' + fact.unit : ''}`;
    row.dataset.value = String(fact.value); row.dataset.unit = fact.unit ?? '';
    if (row.lastElementChild.textContent !== value) row.lastElementChild.textContent = value;
  });
}

export function renderBrakeDetails(partId, snapshot, settings, inspection) {
  const detail = describeBrakeDetail(partId, snapshot, settings);
  for (const prefix of ['part', 'focus']) {
    renderFacts(document.querySelector(`#${prefix}-detail-facts`), detail.facts);
    const note = document.querySelector(`#${prefix}-detail-note`);
    if (note.textContent !== detail.note) note.textContent = detail.note;
  }
  for (const id of ['inspect-part', 'focus-inspect-part']) {
    const button = document.getElementById(id), active = inspection?.active && inspection.partId === partId;
    button.textContent = active ? '전체 구조로 돌아가기' : '선택 부품 자세히 보기';
    button.setAttribute('aria-pressed', String(!!active));
  }
  document.getElementById('restore-inspection').hidden = !inspection?.active;
  const initial = Math.max(0, snapshot.initialEnergy), scale = initial > 0 ? 100 / initial : 0;
  const energies = {
    kinetic: snapshot.kineticEnergy,
    brake: snapshot.brakeHeat,
    tire: snapshot.tireLoss,
    cutoff: snapshot.cutoffResidualEnergy + snapshot.numericalProjectionEnergy
  };
  for (const [key, value] of Object.entries(energies)) {
    const segment = document.querySelector(`[data-energy-segment="${key}"]`);
    segment.style.width = `${Math.max(0, Math.min(100, value * scale))}%`;
    segment.dataset.joules = String(value);
    document.querySelector(`[data-energy-value="${key}"]`).textContent = format(value / 1000, key === 'cutoff' ? 3 : 1) + ' kJ';
  }
  document.getElementById('energy-residual').textContent = '에너지 수지 잔차 ' + format(snapshot.energyResidual, 3) + ' J';
  document.getElementById('energy-total').textContent = '출발 ' + format(initial / 1000, 1) + ' kJ';
}
