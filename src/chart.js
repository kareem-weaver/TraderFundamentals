// Inline-SVG line charts for the progress view.
//
// One measure per chart, one axis each - speed and accuracy never share a plot,
// because two y-scales on one chart invent a correlation that isn't in the data.

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step / 1000; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

/**
 * Draw a progress line chart into `container`.
 *
 * @param {HTMLElement} container
 * @param {{
 *   series: {at: number, mode: string}[],
 *   valueKey: string,
 *   color: string,          // CSS custom property name carrying the series hue
 *   format?: (n: number) => string,
 *   min?: number, max?: number
 * }} options
 */
export function renderLineChart(container, options) {
  const { series, valueKey, color = '--series-1', format = (n) => String(n) } = options;
  container.innerHTML = '';
  container.classList.toggle('is-empty', series.length === 0);

  if (series.length === 0) {
    container.append(Object.assign(document.createElement('p'), {
      className: 'chart-empty',
      textContent: 'Finish a run and your progress shows up here.'
    }));
    return;
  }

  const width = Math.max(container.clientWidth || 320, 240);
  const height = 180;
  const pad = { top: 16, right: 52, bottom: 24, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const values = series.map((point) => point[valueKey] ?? 0);
  const rawMin = options.min ?? Math.min(...values);
  const rawMax = options.max ?? Math.max(...values);
  // Give a flat series some breathing room so the line doesn't sit on an edge.
  const span = rawMax - rawMin || Math.max(rawMax * 0.1, 1);
  const min = options.min ?? Math.max(0, rawMin - span * 0.15);
  const max = options.max ?? rawMax + span * 0.15;

  const x = (i) => (series.length === 1 ? pad.left + plotW / 2 : pad.left + (i / (series.length - 1)) * plotW);
  const y = (v) => pad.top + plotH - ((v - min) / (max - min || 1)) * plotH;

  const svg = el('svg', {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart-svg',
    role: 'img',
    'aria-label': options.ariaLabel ?? `${valueKey} over recent sessions`
  });

  // Gridlines: hairline, solid, recessive - they carry the values not directly labelled.
  for (const tick of niceTicks(min, max)) {
    const ty = y(tick);
    svg.append(el('line', {
      x1: pad.left, x2: pad.left + plotW, y1: ty, y2: ty, class: 'chart-grid'
    }));
    const label = el('text', { x: pad.left - 8, y: ty + 4, class: 'chart-tick', 'text-anchor': 'end' });
    label.textContent = format(tick);
    svg.append(label);
  }

  const line = series.map((point, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(point[valueKey] ?? 0)}`).join(' ');
  const areaPath = `${line} L${x(series.length - 1)},${pad.top + plotH} L${x(0)},${pad.top + plotH} Z`;

  svg.append(el('path', { d: areaPath, class: 'chart-area', style: `fill: var(${color})` }));
  svg.append(el('path', { d: line, class: 'chart-line', style: `stroke: var(${color})` }));

  // End marker, with a surface-coloured ring so it stays legible over the line.
  const lastIndex = series.length - 1;
  const lastValue = series[lastIndex][valueKey] ?? 0;
  svg.append(el('circle', {
    cx: x(lastIndex), cy: y(lastValue), r: 5, class: 'chart-end-ring'
  }));
  svg.append(el('circle', {
    cx: x(lastIndex), cy: y(lastValue), r: 4, class: 'chart-end', style: `fill: var(${color})`
  }));

  // Label the endpoint only - a number on every point goes unread.
  const endLabel = el('text', {
    x: Math.min(x(lastIndex) + 10, width - 4),
    y: y(lastValue) + 4,
    class: 'chart-end-label'
  });
  endLabel.textContent = format(lastValue);
  svg.append(endLabel);

  const crosshair = el('line', { class: 'chart-crosshair', y1: pad.top, y2: pad.top + plotH, style: 'opacity:0' });
  const hoverDot = el('circle', { r: 4, class: 'chart-hover-dot', style: `fill: var(${color}); opacity:0` });
  svg.append(crosshair, hoverDot);
  container.append(svg);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  tooltip.hidden = true;
  container.append(tooltip);

  const nearest = (clientX) => {
    const box = svg.getBoundingClientRect();
    const px = clientX - box.left;
    let best = 0;
    let bestDistance = Infinity;
    series.forEach((_, i) => {
      const distance = Math.abs(x(i) - px);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  };

  const show = (event) => {
    const i = nearest(event.clientX);
    const point = series[i];
    const px = x(i);
    const py = y(point[valueKey] ?? 0);
    crosshair.setAttribute('x1', px);
    crosshair.setAttribute('x2', px);
    crosshair.style.opacity = '1';
    hoverDot.setAttribute('cx', px);
    hoverDot.setAttribute('cy', py);
    hoverDot.style.opacity = '1';
    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${format(point[valueKey] ?? 0)}</strong>
      <span>${new Date(point.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      · ${point.prompts} prompts · ${point.mode}</span>`;
    const left = Math.max(4, Math.min(px - tooltip.offsetWidth / 2, width - tooltip.offsetWidth - 4));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(0, py - tooltip.offsetHeight - 12)}px`;
  };

  const hide = () => {
    crosshair.style.opacity = '0';
    hoverDot.style.opacity = '0';
    tooltip.hidden = true;
  };

  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerleave', hide);
}
