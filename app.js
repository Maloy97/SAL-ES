const DEFAULT_CONFIG = {
  venueName: 'Salão do Clube',
  clientName: '',
  eventName: 'Evento social',
  eventDate: '',
  roomWidth: 24,
  clearWidth: 22,
  roomDepth: 22.6,
  stageWidth: 4.5,
  stageDepth: 9.4,
  kitchenDepth: 10.8,
  kitchenEnabled: true,
  tableShape: 'round',
  tableCount: 20,
  chairCount: 160,
  chairsPerTable: 8,
  roundDiameter: 1.5,
  rectWidth: 1.8,
  rectDepth: 0.8,
  clearance: 0.55,
  aisleWidth: 1.8,
  danceWidth: 5.5,
  danceDepth: 6.5,
  manualLayouts: {},
  annotationsByLayout: {}
};

const LAYOUT_INFO = {
  balanced: {
    name: 'Banquete equilibrado',
    subtitle: 'Distribuição uniforme, boa circulação e aproveitamento geral.'
  },
  'central-aisle': {
    name: 'Corredor central',
    subtitle: 'Eixo livre para cerimônia, serviço ou entrada de convidados.'
  },
  'dance-floor': {
    name: 'Pista central',
    subtitle: 'Mesas ao redor de uma área central para dança ou atrações.'
  },
  'stage-focus': {
    name: 'Palco em foco',
    subtitle: 'Prioriza visibilidade e aproximação das mesas ao palco.'
  }
};

let config = loadConfig();
let selectedKey = 'balanced';
let selectedAnnotationId = null;
let layouts = [];
let editorMessage = 'Arraste uma mesa ou selecione um texto para editar.';
let suppressCanvasClickUntil = 0;

function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function normalizeConfig(raw = {}) {
  const normalized = {
    ...cloneDefaultConfig(),
    ...raw
  };
  normalized.manualLayouts = raw.manualLayouts && typeof raw.manualLayouts === 'object'
    ? raw.manualLayouts
    : {};
  normalized.annotationsByLayout = raw.annotationsByLayout && typeof raw.annotationsByLayout === 'object'
    ? raw.annotationsByLayout
    : {};
  return normalized;
}

function loadConfig() {
  try {
    const storedV3 = localStorage.getItem('planeja-salao-config-v3');
    if (storedV3) return normalizeConfig(JSON.parse(storedV3));

    const storedV2 = localStorage.getItem('planeja-salao-config-v2');
    if (storedV2) return normalizeConfig(JSON.parse(storedV2));

    // Migração automática da primeira versão, que interpretava o salão como trapézio.
    const legacyStored = localStorage.getItem('planeja-salao-config-v1');
    if (legacyStored) {
      const legacy = JSON.parse(legacyStored);
      return normalizeConfig({
        ...legacy,
        roomWidth: Number(legacy.roomTop ?? DEFAULT_CONFIG.roomWidth),
        clearWidth: Number(legacy.roomBottom ?? DEFAULT_CONFIG.clearWidth)
      });
    }
    return cloneDefaultConfig();
  } catch {
    return cloneDefaultConfig();
  }
}

function persist() {
  localStorage.setItem('planeja-salao-config-v3', JSON.stringify(config));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roomWidthAtY() {
  return config.roomWidth;
}

function getKitchenWidth() {
  if (!config.kitchenEnabled) return 0;
  return Math.max(0, config.roomWidth - clamp(config.clearWidth, 0, config.roomWidth));
}

function rectsOverlap(a, b, padding = 0) {
  return !(
    a.x + a.w + padding <= b.x ||
    b.x + b.w + padding <= a.x ||
    a.y + a.h + padding <= b.y ||
    b.y + b.h + padding <= a.y
  );
}

function isInsideRoom(rect, wallMargin) {
  if (rect.x < wallMargin || rect.y < wallMargin) return false;
  if (rect.y + rect.h > config.roomDepth - wallMargin) return false;
  const narrowestRightEdge = Math.min(roomWidthAtY(rect.y), roomWidthAtY(rect.y + rect.h));
  return rect.x + rect.w <= narrowestRightEdge - wallMargin;
}

function getObstacles() {
  const stageY = Math.max(0, (config.roomDepth - config.stageDepth) / 2);
  const obstacles = [
    { x: 0, y: stageY, w: config.stageWidth, h: config.stageDepth, label: 'PALCO' }
  ];
  const kitchenWidth = getKitchenWidth();
  if (config.kitchenEnabled && kitchenWidth > 0.05) {
    obstacles.push({
      x: clamp(config.clearWidth, 0, config.roomWidth),
      y: Math.max(0, config.roomDepth - config.kitchenDepth),
      w: kitchenWidth,
      h: config.kitchenDepth,
      label: 'COZINHA'
    });
  }
  return obstacles;
}

function getFurnitureEnvelope(angle) {
  const chairProjection = 0.62;
  let actualW = config.tableShape === 'round' ? config.roundDiameter : config.rectWidth;
  let actualH = config.tableShape === 'round' ? config.roundDiameter : config.rectDepth;
  if (angle % 180 !== 0 && config.tableShape === 'rect') {
    [actualW, actualH] = [actualH, actualW];
  }
  return {
    actualW,
    actualH,
    w: actualW + chairProjection * 2,
    h: actualH + chairProjection * 2
  };
}

function getReservedAreas(key) {
  const centerX = roomWidthAtY(config.roomDepth / 2) / 2;
  const reserved = [];
  if (key === 'central-aisle') {
    reserved.push({
      x: centerX - config.aisleWidth / 2,
      y: 0,
      w: config.aisleWidth,
      h: config.roomDepth,
      label: 'CORREDOR CENTRAL'
    });
  }
  if (key === 'dance-floor') {
    reserved.push({
      x: centerX - config.danceWidth / 2 + 0.7,
      y: config.roomDepth / 2 - config.danceDepth / 2,
      w: config.danceWidth,
      h: config.danceDepth,
      label: 'PISTA / ÁREA LIVRE'
    });
  }
  if (key === 'stage-focus') {
    reserved.push({
      x: config.stageWidth,
      y: Math.max(0, (config.roomDepth - config.stageDepth) / 2),
      w: 1.25,
      h: config.stageDepth,
      label: 'FAIXA TÉCNICA'
    });
  }
  return reserved;
}

function distributeChairs(placedCount) {
  const capacity = placedCount * config.chairsPerTable;
  const total = Math.min(config.chairCount, capacity);
  const result = [];
  let remaining = total;
  for (let i = 0; i < placedCount; i += 1) {
    const tablesLeft = placedCount - i;
    const ideal = Math.ceil(remaining / tablesLeft);
    const value = clamp(ideal, 0, config.chairsPerTable);
    result.push(value);
    remaining -= value;
  }
  return result;
}

function applySavedManualPositions(key, placements) {
  const saved = Array.isArray(config.manualLayouts?.[key]) ? config.manualLayouts[key] : [];
  if (!saved.length) return placements;
  const savedById = new Map(saved.map((item) => [Number(item.id), item]));
  return placements.map((placement) => {
    const manual = savedById.get(placement.id);
    if (!manual) return placement;
    return {
      ...placement,
      x: safeNumber(manual.x, placement.x),
      y: safeNumber(manual.y, placement.y)
    };
  });
}

function generateLayout(key) {
  const obstacles = getObstacles();
  const reserved = getReservedAreas(key);
  const angle = key === 'stage-focus' && config.tableShape === 'rect' ? 90 : 0;
  const envelope = getFurnitureEnvelope(angle);
  const stepX = envelope.w + config.clearance;
  const stepY = envelope.h + config.clearance;
  const wallMargin = 0.45;
  const candidates = [];
  let row = 0;

  for (let y = wallMargin; y + envelope.h <= config.roomDepth - wallMargin + 0.001; y += stepY) {
    const offset = key === 'balanced' && row % 2 === 1 ? stepX / 2 : 0;
    const rightEdge = Math.min(roomWidthAtY(y), roomWidthAtY(y + envelope.h));
    for (let x = wallMargin + offset; x + envelope.w <= rightEdge - wallMargin + 0.001; x += stepX) {
      const candidate = { x, y, w: envelope.w, h: envelope.h };
      if (!isInsideRoom(candidate, wallMargin)) continue;
      if (obstacles.some((obstacle) => rectsOverlap(candidate, obstacle, 0.18))) continue;
      if (reserved.some((zone) => rectsOverlap(candidate, zone, 0.12))) continue;
      candidates.push(candidate);
    }
    row += 1;
  }

  const stageCenterY = (config.roomDepth - config.stageDepth) / 2 + config.stageDepth / 2;
  const roomCenterX = roomWidthAtY(config.roomDepth / 2) / 2;
  const roomCenterY = config.roomDepth / 2;

  candidates.sort((a, b) => {
    const acx = a.x + a.w / 2;
    const acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2;
    const bcy = b.y + b.h / 2;

    if (key === 'stage-focus') {
      return (a.x * 2 + Math.abs(acy - stageCenterY) * 0.6) - (b.x * 2 + Math.abs(bcy - stageCenterY) * 0.6);
    }
    if (key === 'dance-floor') {
      return Math.hypot(bcx - roomCenterX, bcy - roomCenterY) - Math.hypot(acx - roomCenterX, acy - roomCenterY);
    }
    return acy - bcy || acx - bcx;
  });

  const wanted = Math.max(0, config.tableCount);
  let selected;
  if ((key === 'balanced' || key === 'central-aisle') && wanted > 0 && candidates.length > wanted) {
    const rows = [];
    for (const candidate of candidates) {
      const existing = rows.find((rowItems) => Math.abs(rowItems[0].y - candidate.y) < 0.01);
      if (existing) existing.push(candidate);
      else rows.push([candidate]);
    }
    rows.forEach((rowItems) => rowItems.sort((a, b) => a.x - b.x));

    const averageWidth = config.roomWidth;
    const targetRows = clamp(Math.ceil(Math.sqrt((wanted * config.roomDepth) / averageWidth)), 1, rows.length);
    const chosenRows = [];
    const usedRowIndexes = new Set();
    for (let i = 0; i < targetRows; i += 1) {
      let rowIndex = Math.floor(((i + 0.5) * rows.length) / targetRows);
      rowIndex = clamp(rowIndex, 0, rows.length - 1);
      while (usedRowIndexes.has(rowIndex) && rowIndex + 1 < rows.length) rowIndex += 1;
      while (usedRowIndexes.has(rowIndex) && rowIndex - 1 >= 0) rowIndex -= 1;
      usedRowIndexes.add(rowIndex);
      chosenRows.push(rows[rowIndex]);
    }
    chosenRows.sort((a, b) => a[0].y - b[0].y);

    selected = [];
    let remaining = wanted;
    chosenRows.forEach((rowItems, rowIndex) => {
      const rowsLeft = chosenRows.length - rowIndex;
      const desiredInRow = Math.min(rowItems.length, Math.ceil(remaining / rowsLeft));
      for (let i = 0; i < desiredInRow; i += 1) {
        const candidateIndex = clamp(Math.floor(((i + 0.5) * rowItems.length) / desiredInRow), 0, rowItems.length - 1);
        selected.push(rowItems[candidateIndex]);
      }
      remaining -= desiredInRow;
    });

    if (selected.length < wanted) {
      const selectedSet = new Set(selected);
      for (const candidate of candidates) {
        if (!selectedSet.has(candidate)) {
          selected.push(candidate);
          selectedSet.add(candidate);
        }
        if (selected.length >= wanted) break;
      }
    }
    selected = selected.slice(0, wanted).sort((a, b) => a.y - b.y || a.x - b.x);
  } else {
    selected = candidates.slice(0, wanted);
  }

  const assignedChairs = distributeChairs(selected.length);
  const automaticPlacements = selected.map((candidate, index) => ({
    id: index + 1,
    x: candidate.x + (candidate.w - envelope.actualW) / 2,
    y: candidate.y + (candidate.h - envelope.actualH) / 2,
    w: envelope.actualW,
    h: envelope.actualH,
    angle,
    chairs: assignedChairs[index] || 0
  }));
  const placements = applySavedManualPositions(key, automaticPlacements);

  const notes = [];
  if (placements.length < config.tableCount) {
    notes.push(`O padrão comportou ${placements.length} das ${config.tableCount} mesas solicitadas.`);
  }
  const capacity = placements.length * config.chairsPerTable;
  if (config.chairCount > capacity) {
    notes.push(`Faltam lugares para ${config.chairCount - capacity} cadeiras neste padrão.`);
  }
  if (key === 'central-aisle') notes.push(`Corredor preservado com ${config.aisleWidth.toFixed(2)} m.`);
  if (key === 'dance-floor') notes.push(`Área central livre de ${round1(config.danceWidth * config.danceDepth)} m².`);
  if (key === 'stage-focus') notes.push('Faixa técnica mantida junto ao palco.');
  if (Array.isArray(config.manualLayouts?.[key]) && config.manualLayouts[key].length) {
    notes.push('Este padrão possui ajustes manuais de posicionamento.');
  }

  return {
    key,
    ...LAYOUT_INFO[key],
    placements,
    reserved,
    capacity,
    notes
  };
}

function svgChair(x, y, angle = 0) {
  return `<g transform="rotate(${angle} ${x} ${y})"><rect x="${x - 0.19}" y="${y - 0.19}" width="0.38" height="0.38" rx="0.07" class="svg-chair"/><line x1="${x - 0.16}" y1="${y - 0.26}" x2="${x + 0.16}" y2="${y - 0.26}" class="svg-chair-back"/></g>`;
}

function tableGroup(placement, interactive = false) {
  const cx = placement.x + placement.w / 2;
  const cy = placement.y + placement.h / 2;
  let chairs = '';
  const interactionAttrs = interactive
    ? ` data-table-id="${placement.id}" class="furniture-group draggable-furniture" role="button" aria-label="Arrastar mesa ${placement.id}"`
    : ' class="furniture-group"';

  if (config.tableShape === 'round') {
    const radius = placement.w / 2 + 0.43;
    for (let i = 0; i < placement.chairs; i += 1) {
      const theta = (Math.PI * 2 * i) / Math.max(placement.chairs, 1) - Math.PI / 2;
      const x = cx + Math.cos(theta) * radius;
      const y = cy + Math.sin(theta) * radius;
      chairs += svgChair(x, y, (theta * 180) / Math.PI + 90);
    }
    return `<g${interactionAttrs}><g>${chairs}<circle cx="${cx}" cy="${cy}" r="${placement.w / 2}" class="svg-table"/><text x="${cx}" y="${cy + 0.12}" text-anchor="middle" class="svg-table-label">M${placement.id}</text></g></g>`;
  }

  const points = [];
  const n = placement.chairs;
  const topCount = Math.ceil(n / 4);
  const bottomCount = Math.ceil((n - topCount) / 3);
  const leftCount = Math.ceil((n - topCount - bottomCount) / 2);
  const rightCount = Math.max(0, n - topCount - bottomCount - leftCount);

  const addSide = (count, side) => {
    for (let i = 0; i < count; i += 1) {
      const t = (i + 1) / (count + 1);
      if (side === 'top') points.push({ x: placement.x + placement.w * t, y: placement.y - 0.43, angle: 0 });
      if (side === 'bottom') points.push({ x: placement.x + placement.w * t, y: placement.y + placement.h + 0.43, angle: 180 });
      if (side === 'left') points.push({ x: placement.x - 0.43, y: placement.y + placement.h * t, angle: -90 });
      if (side === 'right') points.push({ x: placement.x + placement.w + 0.43, y: placement.y + placement.h * t, angle: 90 });
    }
  };

  addSide(topCount, 'top');
  addSide(bottomCount, 'bottom');
  addSide(leftCount, 'left');
  addSide(rightCount, 'right');
  chairs = points.map((point) => svgChair(point.x, point.y, point.angle)).join('');

  return `<g${interactionAttrs}><g transform="rotate(${placement.angle} ${cx} ${cy})">${chairs}<rect x="${placement.x}" y="${placement.y}" width="${placement.w}" height="${placement.h}" rx="0.12" class="svg-table"/><text x="${cx}" y="${cy + 0.12}" text-anchor="middle" class="svg-table-label">M${placement.id}</text></g></g>`;
}

function getAnnotations(key = selectedKey) {
  if (!Array.isArray(config.annotationsByLayout[key])) config.annotationsByLayout[key] = [];
  return config.annotationsByLayout[key];
}

function getSelectedAnnotation() {
  return getAnnotations().find((item) => item.id === selectedAnnotationId) || null;
}

function annotationTextSvg(annotation) {
  const lines = String(annotation.text || 'Texto').split(/\r?\n/).slice(0, 8);
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const width = Math.max(1.2, longest * 0.37 + 0.5);
  const height = Math.max(0.8, lines.length * 0.75 + 0.2);
  const startY = -((lines.length - 1) * 0.72) / 2 + 0.22;
  const tspans = lines.map((line, index) => `<tspan x="0" y="${startY + index * 0.72}">${escapeHtml(line || ' ')}</tspan>`).join('');
  const selected = annotation.id === selectedAnnotationId;
  return `
    <g data-annotation-id="${escapeHtml(annotation.id)}" class="annotation-group" transform="translate(${annotation.x} ${annotation.y})" role="button" aria-label="Mover texto ${escapeHtml(annotation.text)}">
      <g transform="rotate(${annotation.rotation}) scale(${annotation.scale})">
        <rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" rx="0.16" class="annotation-hitbox"/>
        ${selected ? `<rect data-editor-only="true" x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" rx="0.16" class="annotation-selection"/>` : ''}
        <text x="0" y="0" text-anchor="middle" dominant-baseline="middle" class="svg-annotation-text" style="fill:${escapeHtml(annotation.color)}">${tspans}</text>
      </g>
    </g>`;
}

function renderAnnotations(layoutKey, compact) {
  const annotations = Array.isArray(config.annotationsByLayout[layoutKey])
    ? config.annotationsByLayout[layoutKey]
    : [];
  return annotations
    .map((annotation) => {
      if (compact || layoutKey !== selectedKey) {
        const deselected = { ...annotation, id: `compact-${annotation.id}` };
        return annotationTextSvg(deselected)
          .replace('class="annotation-group"', 'class="annotation-group annotation-compact"')
          .replace(/ data-annotation-id="[^"]+"/, '');
      }
      return annotationTextSvg(annotation);
    })
    .join('');
}

function renderFloorPlan(layout, compact = false) {
  const obstacles = getObstacles();
  const viewPad = compact ? 0.6 : 1.6;
  const stageY = (config.roomDepth - config.stageDepth) / 2;
  const roomPoints = `0,0 ${config.roomWidth},0 ${config.roomWidth},${config.roomDepth} 0,${config.roomDepth}`;
  const id = compact ? '' : 'id="layout-svg"';

  const dimensions = compact ? '' : `
    <line x1="0" y1="-0.55" x2="${config.roomWidth}" y2="-0.55" class="svg-dimension"/>
    <text x="${config.roomWidth / 2}" y="-0.78" text-anchor="middle" class="svg-dimension-text">${config.roomWidth.toFixed(2)} m</text>
    <line x1="0" y1="${config.roomDepth + 0.55}" x2="${clamp(config.clearWidth, 0, config.roomWidth)}" y2="${config.roomDepth + 0.55}" class="svg-dimension"/>
    <text x="${clamp(config.clearWidth, 0, config.roomWidth) / 2}" y="${config.roomDepth + 1.05}" text-anchor="middle" class="svg-dimension-text">${clamp(config.clearWidth, 0, config.roomWidth).toFixed(2)} m livres</text>
    ${config.kitchenEnabled && getKitchenWidth() > 0 ? `<line x1="${clamp(config.clearWidth, 0, config.roomWidth)}" y1="${config.roomDepth + 0.55}" x2="${config.roomWidth}" y2="${config.roomDepth + 0.55}" class="svg-dimension-secondary"/><text x="${(clamp(config.clearWidth, 0, config.roomWidth) + config.roomWidth) / 2}" y="${config.roomDepth + 1.05}" text-anchor="middle" class="svg-dimension-text-secondary">${getKitchenWidth().toFixed(2)} m</text>` : ''}
    <line x1="${config.roomWidth + 0.55}" y1="0" x2="${config.roomWidth + 0.55}" y2="${config.roomDepth}" class="svg-dimension"/>
    <text x="${config.roomWidth + 1}" y="${config.roomDepth / 2}" text-anchor="middle" transform="rotate(90 ${config.roomWidth + 1} ${config.roomDepth / 2})" class="svg-dimension-text">${config.roomDepth.toFixed(2)} m</text>`;

  const reserved = layout.reserved.map((zone) => `
    <g><rect x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}" class="svg-reserved"/>
    ${compact ? '' : `<text x="${zone.x + zone.w / 2}" y="${zone.y + zone.h / 2}" text-anchor="middle" class="svg-reserved-label">${escapeHtml(zone.label)}</text>`}</g>`).join('');

  const obstacleSvg = obstacles.map((obstacle) => {
    const cx = obstacle.x + obstacle.w / 2;
    const cy = obstacle.y + obstacle.h / 2;
    const isNarrowKitchen = obstacle.label === 'COZINHA' && obstacle.w < 3.2;
    const label = compact && obstacle.label === 'COZINHA' ? 'COZ.' : obstacle.label;
    const transform = isNarrowKitchen ? ` transform="rotate(-90 ${cx} ${cy})"` : '';
    const labelClass = isNarrowKitchen ? 'svg-obstacle-label svg-obstacle-label-narrow' : 'svg-obstacle-label';
    return `
    <g><rect x="${obstacle.x}" y="${obstacle.y}" width="${obstacle.w}" height="${obstacle.h}" class="svg-obstacle"/>
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" class="${labelClass}"${transform}>${label}</text></g>`;
  }).join('');

  const legend = compact ? '' : `
    <text x="0.2" y="${stageY - 0.25}" class="svg-small-note">${config.stageWidth.toFixed(2).replace('.', ',')} × ${config.stageDepth.toFixed(2).replace('.', ',')} m</text>
    <g transform="translate(0.2,-1.45)">
      <rect x="0" y="0" width="7.4" height="0.68" rx="0.18" class="svg-legend-bg"/>
      <circle cx="0.38" cy="0.34" r="0.14" class="svg-table"/><text x="0.65" y="0.44" class="svg-legend-text">mesa arrastável</text>
      <rect x="2.75" y="0.20" width="0.28" height="0.28" rx="0.05" class="svg-chair"/><text x="3.18" y="0.44" class="svg-legend-text">cadeira</text>
      <rect x="4.35" y="0.20" width="0.34" height="0.27" class="svg-reserved"/><text x="4.85" y="0.44" class="svg-legend-text">área bloqueada</text>
    </g>`;

  return `<svg ${id} class="${compact ? 'floorplan floorplan-compact' : 'floorplan floorplan-editor'}" viewBox="${-viewPad} ${-viewPad} ${config.roomWidth + viewPad * 2} ${config.roomDepth + viewPad * 2}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Planta do padrão ${escapeHtml(layout.name)}">
    <rect x="${-viewPad}" y="${-viewPad}" width="${config.roomWidth + viewPad * 2}" height="${config.roomDepth + viewPad * 2}" class="svg-page"/>
    <polygon points="${roomPoints}" class="svg-room"/>
    ${dimensions}${reserved}${obstacleSvg}${layout.placements.map((placement) => tableGroup(placement, !compact)).join('')}${renderAnnotations(layout.key, compact)}${legend}
  </svg>`;
}

function renderMain() {
  layouts = Object.keys(LAYOUT_INFO).map(generateLayout);
  const selectedLayout = layouts.find((layout) => layout.key === selectedKey) || layouts[0];
  const grossArea = config.roomWidth * config.roomDepth;
  const stageArea = config.stageWidth * config.stageDepth;
  const kitchenArea = getKitchenWidth() * config.kitchenDepth;
  const usableArea = Math.max(0, grossArea - stageArea - kitchenArea);
  const tableFootprint = config.tableShape === 'round'
    ? Math.PI * Math.pow(config.roundDiameter / 2, 2)
    : config.rectWidth * config.rectDepth;
  const furnitureArea = tableFootprint * config.tableCount + config.chairCount * 0.25;
  const occupancy = usableArea > 0 ? (furnitureArea / usableArea) * 100 : 0;
  const requestedCapacity = config.tableCount * config.chairsPerTable;
  const selectedPlacedChairs = selectedLayout.placements.reduce((sum, item) => sum + item.chairs, 0);
  const hasManualLayout = Array.isArray(config.manualLayouts?.[selectedKey]) && config.manualLayouts[selectedKey].length > 0;

  document.getElementById('main-content').innerHTML = `
    <section class="proposal-header print-only-header">
      <div><span>Proposta de montagem</span><h1>${escapeHtml(config.eventName || 'Evento')}</h1><p>${config.clientName ? `Cliente: ${escapeHtml(config.clientName)}` : 'Cliente não informado'} · ${escapeHtml(config.venueName)}</p></div>
      <div class="proposal-date">${escapeHtml(config.eventDate || 'Data a definir')}</div>
    </section>

    <section class="hero-panel">
      <div><span class="eyebrow">Planejamento automático + editor manual</span><h1>Gere uma base e ajuste cada detalhe diretamente na planta.</h1><p>Arraste mesas completas com as cadeiras, crie textos personalizados e exporte a proposta final em PNG ou PDF.</p></div>
      <div class="hero-badge"><strong>${selectedLayout.placements.length}</strong><span>mesas acomodadas</span></div>
    </section>

    <section class="stats-grid">
      ${statCard('Área bruta', `${round1(grossArea)} m²`, 'Cálculo do retângulo')}
      ${statCard('Área útil estimada', `${round1(usableArea)} m²`, 'Descontando palco e cozinha')}
      ${statCard('Mobiliário', `${round1(furnitureArea)} m²`, `Ocupação física aproximada: ${round1(occupancy)}%`)}
      ${statCard('Capacidade solicitada', `${requestedCapacity} lugares`, `${config.chairCount} cadeiras informadas`)}
    </section>

    <section class="layout-selector no-print">
      ${layouts.map((layout) => `<button data-layout="${layout.key}" class="layout-tab ${layout.key === selectedKey ? 'active' : ''}"><span>${layout.name}</span><small>${layout.placements.length}/${config.tableCount} mesas${Array.isArray(config.manualLayouts?.[layout.key]) && config.manualLayouts[layout.key].length ? ' · editado' : ''}</small></button>`).join('')}
    </section>

    <section class="plan-card">
      <div class="plan-toolbar">
        <div><span class="eyebrow">Padrão selecionado ${hasManualLayout ? '· montagem manual' : ''}</span><h2>${selectedLayout.name}</h2><p>${selectedLayout.subtitle}</p></div>
        <div class="plan-actions no-print"><button class="button button-muted" id="reset-manual-main">Refazer automático</button><button class="button button-muted" id="export-png">Exportar PNG</button><button class="button button-primary" id="print-main">Gerar apresentação PDF</button></div>
      </div>
      <div class="editor-strip no-print"><strong>Editor manual:</strong> arraste mesas e textos com o mouse. <span id="editor-status" aria-live="polite">${escapeHtml(editorMessage)}</span></div>
      <div class="plan-stage">${renderFloorPlan(selectedLayout, false)}</div>
      <div class="plan-summary">
        <div class="summary-item"><span>Mesas posicionadas</span><strong>${selectedLayout.placements.length} de ${config.tableCount}</strong></div>
        <div class="summary-item"><span>Cadeiras distribuídas</span><strong>${selectedPlacedChairs} de ${config.chairCount}</strong></div>
        <div class="summary-item"><span>Capacidade máxima do padrão</span><strong>${selectedLayout.capacity} lugares</strong></div>
      </div>
      ${renderAlerts(selectedLayout, requestedCapacity)}
    </section>

    <section class="comparison-section no-print">
      <div class="section-title-row"><div><span class="eyebrow">Comparação rápida</span><h2>Quatro propostas para apresentar ao cliente</h2></div><p>Clique em qualquer opção para abrir e editar em tamanho grande.</p></div>
      <div class="comparison-grid">
        ${layouts.map((layout) => `<button class="comparison-card" data-layout="${layout.key}"><div class="comparison-preview">${renderFloorPlan(layout, true)}</div><div class="comparison-copy"><strong>${layout.name}</strong><span>${layout.placements.length} mesas · até ${layout.capacity} lugares</span><p>${layout.subtitle}</p></div></button>`).join('')}
      </div>
    </section>

    <section class="technical-note"><strong>Nota técnica</strong><p>Este planejamento é uma estimativa visual. Antes da montagem, confira portas, saídas de emergência, extintores, rotas acessíveis e exigências do AVCB. O editor bloqueia mesas fora do salão, sobre palco, cozinha ou áreas reservadas, mas a conferência presencial continua indispensável.</p></section>`;

  document.querySelectorAll('[data-layout]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedKey = button.dataset.layout;
      selectedAnnotationId = null;
      editorMessage = 'Padrão selecionado. Você já pode arrastar as mesas.';
      renderMain();
    });
  });

  document.getElementById('export-png').addEventListener('click', exportPng);
  document.getElementById('print-main').addEventListener('click', () => window.print());
  document.getElementById('reset-manual-main').addEventListener('click', resetSelectedManualLayout);
  bindCanvasEditor(selectedLayout);
  syncTextEditor();
}

function statCard(label, value, detail) {
  return `<article class="stat-card"><span>${label}</span><strong>${value}</strong><small>${detail}</small></article>`;
}

function renderAlerts(layout, requestedCapacity) {
  const alerts = [];
  if (config.chairCount > requestedCapacity) {
    alerts.push(`<div class="alert alert-warning">A quantidade de cadeiras supera a capacidade informada das mesas em ${config.chairCount - requestedCapacity} lugares.</div>`);
  }
  layout.notes.forEach((note) => alerts.push(`<div class="alert">${escapeHtml(note)}</div>`));
  return alerts.length ? `<div class="alerts">${alerts.join('')}</div>` : '';
}

function syncForm() {
  document.querySelectorAll('[data-key]').forEach((input) => {
    const key = input.dataset.key;
    if (input.type === 'checkbox') input.checked = Boolean(config[key]);
    else input.value = config[key];
  });
  document.querySelectorAll('[data-shape]').forEach((button) => {
    button.classList.toggle('active', button.dataset.shape === config.tableShape);
  });
  document.getElementById('kitchen-fields').style.display = config.kitchenEnabled ? 'grid' : 'none';
  const kitchenWidthOutput = document.getElementById('kitchen-width-calculated');
  if (kitchenWidthOutput) kitchenWidthOutput.value = getKitchenWidth().toFixed(2);
  document.getElementById('round-diameter-field').style.display = config.tableShape === 'round' ? 'grid' : 'none';
  document.querySelectorAll('.rect-only').forEach((element) => {
    element.style.display = config.tableShape === 'rect' ? 'grid' : 'none';
  });
}

function setEditorStatus(message) {
  editorMessage = message;
  const status = document.getElementById('editor-status');
  if (status) status.textContent = message;
}

function syncTextEditor() {
  const annotation = getSelectedAnnotation();
  const controls = {
    content: document.getElementById('text-content'),
    color: document.getElementById('text-color'),
    scale: document.getElementById('text-scale'),
    rotation: document.getElementById('text-rotation'),
    x: document.getElementById('text-x'),
    y: document.getElementById('text-y'),
    deleteButton: document.getElementById('delete-text')
  };
  const disabled = !annotation;
  Object.entries(controls).forEach(([key, control]) => {
    if (!control) return;
    control.disabled = disabled;
    if (disabled || key === 'deleteButton') return;
    if (key === 'content') control.value = annotation.text;
    if (key === 'color') control.value = annotation.color;
    if (key === 'scale') control.value = annotation.scale;
    if (key === 'rotation') control.value = annotation.rotation;
    if (key === 'x') control.value = Number(annotation.x).toFixed(2);
    if (key === 'y') control.value = Number(annotation.y).toFixed(2);
  });
  document.getElementById('text-editor')?.classList.toggle('is-disabled', disabled);
}

function bindForm() {
  document.querySelectorAll('[data-key]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.key;
      if (input.type === 'checkbox') config[key] = input.checked;
      else if (input.type === 'number') config[key] = Number(input.value || 0);
      else config[key] = input.value;
      if (key === 'roomWidth' || key === 'clearWidth') {
        config.roomWidth = Math.max(1, config.roomWidth);
        config.clearWidth = clamp(config.clearWidth, 0, config.roomWidth);
      }
      persist();
      syncForm();
      renderMain();
    });
  });

  document.querySelectorAll('[data-shape]').forEach((button) => {
    button.addEventListener('click', () => {
      config.tableShape = button.dataset.shape;
      persist();
      syncForm();
      renderMain();
    });
  });

  document.getElementById('print-top').addEventListener('click', () => window.print());
  document.getElementById('reset-project').addEventListener('click', () => {
    if (!window.confirm('Restaurar todas as medidas, montagens manuais e textos do exemplo inicial?')) return;
    config = cloneDefaultConfig();
    selectedKey = 'balanced';
    selectedAnnotationId = null;
    persist();
    syncForm();
    renderMain();
  });

  document.getElementById('save-project').addEventListener('click', saveProject);
  document.getElementById('open-project').addEventListener('change', (event) => openProject(event.target.files?.[0]));
  document.getElementById('add-text').addEventListener('click', addAnnotation);
  document.getElementById('delete-text').addEventListener('click', deleteSelectedAnnotation);
  document.getElementById('reset-manual-layout').addEventListener('click', resetSelectedManualLayout);

  const textBindings = [
    ['text-content', 'text', (value) => value],
    ['text-color', 'color', (value) => value],
    ['text-scale', 'scale', (value) => clamp(safeNumber(value, 1), 0.4, 4)],
    ['text-rotation', 'rotation', (value) => clamp(safeNumber(value, 0), -180, 180)],
    ['text-x', 'x', (value) => clamp(safeNumber(value, 0), 0, config.roomWidth)],
    ['text-y', 'y', (value) => clamp(safeNumber(value, 0), 0, config.roomDepth)]
  ];
  textBindings.forEach(([id, property, parser]) => {
    document.getElementById(id).addEventListener('input', (event) => {
      const annotation = getSelectedAnnotation();
      if (!annotation) return;
      annotation[property] = parser(event.target.value);
      persist();
      renderMain();
    });
  });

  document.querySelectorAll('[data-text-color]').forEach((button) => {
    button.addEventListener('click', () => {
      const annotation = getSelectedAnnotation();
      if (!annotation) return;
      annotation.color = button.dataset.textColor;
      persist();
      renderMain();
    });
  });
}

function addAnnotation() {
  const annotation = {
    id: `txt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: 'Novo texto',
    x: config.roomWidth / 2,
    y: config.roomDepth / 2,
    color: '#176b5b',
    rotation: 0,
    scale: 1
  };
  getAnnotations().push(annotation);
  selectedAnnotationId = annotation.id;
  persist();
  editorMessage = 'Texto criado. Arraste na planta ou ajuste os controles laterais.';
  renderMain();
  document.getElementById('text-content')?.focus();
  document.getElementById('text-content')?.select();
}

function deleteSelectedAnnotation() {
  if (!selectedAnnotationId) return;
  const annotations = getAnnotations();
  const index = annotations.findIndex((item) => item.id === selectedAnnotationId);
  if (index >= 0) annotations.splice(index, 1);
  selectedAnnotationId = null;
  persist();
  editorMessage = 'Texto excluído.';
  renderMain();
}

function resetSelectedManualLayout() {
  const hasManual = Array.isArray(config.manualLayouts?.[selectedKey]) && config.manualLayouts[selectedKey].length;
  if (!hasManual) {
    setEditorStatus('Este padrão já está na distribuição automática.');
    return;
  }
  if (!window.confirm('Descartar os ajustes manuais das mesas deste padrão? Os textos serão mantidos.')) return;
  delete config.manualLayouts[selectedKey];
  persist();
  editorMessage = 'Distribuição automática restaurada.';
  renderMain();
}

function saveProject() {
  const blob = new Blob([JSON.stringify({ version: 2, config, selectedKey }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'projeto-evento.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

function openProject(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const incoming = parsed.config || parsed;
      config = normalizeConfig({
        ...incoming,
        roomWidth: Number(incoming.roomWidth ?? incoming.roomTop ?? DEFAULT_CONFIG.roomWidth),
        clearWidth: Number(incoming.clearWidth ?? incoming.roomBottom ?? DEFAULT_CONFIG.clearWidth)
      });
      config.clearWidth = clamp(config.clearWidth, 0, config.roomWidth);
      if (parsed.selectedKey && LAYOUT_INFO[parsed.selectedKey]) selectedKey = parsed.selectedKey;
      selectedAnnotationId = null;
      persist();
      syncForm();
      editorMessage = 'Projeto aberto com as montagens manuais e textos salvos.';
      renderMain();
    } catch {
      window.alert('Não foi possível abrir este arquivo de projeto.');
    }
  };
  reader.readAsText(file);
}

function svgPointFromPointer(svg, event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  return point.matrixTransform(matrix.inverse());
}

function getPlacementVisualEnvelope(placement) {
  const projection = 0.62;
  const cx = placement.x + placement.w / 2;
  const cy = placement.y + placement.h / 2;
  let width = placement.w + projection * 2;
  let height = placement.h + projection * 2;
  if (config.tableShape === 'rect' && Math.abs(placement.angle % 180) === 90) {
    [width, height] = [height, width];
  }
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    w: width,
    h: height
  };
}

function validatePlacement(candidate, layout) {
  const envelope = getPlacementVisualEnvelope(candidate);
  if (!isInsideRoom(envelope, 0.08)) {
    return { valid: false, message: 'A mesa precisa permanecer totalmente dentro do salão.' };
  }
  if (getObstacles().some((obstacle) => rectsOverlap(envelope, obstacle, 0.03))) {
    return { valid: false, message: 'A mesa não pode ocupar palco ou cozinha.' };
  }
  if (layout.reserved.some((zone) => rectsOverlap(envelope, zone, 0.03))) {
    return { valid: false, message: 'A mesa não pode ocupar a área livre deste padrão.' };
  }
  const collision = layout.placements.some((other) => {
    if (other.id === candidate.id) return false;
    return rectsOverlap(envelope, getPlacementVisualEnvelope(other), 0.05);
  });
  if (collision) {
    return { valid: false, message: 'As cadeiras desta mesa estão encostando em outra mesa.' };
  }
  return { valid: true, message: 'Posição válida. Solte para confirmar.' };
}

function storeManualLayout(layout) {
  config.manualLayouts[selectedKey] = layout.placements.map((placement) => ({
    id: placement.id,
    x: roundCoordinate(placement.x),
    y: roundCoordinate(placement.y)
  }));
  persist();
}

function roundCoordinate(value) {
  return Math.round(value * 1000) / 1000;
}

function bindCanvasEditor(layout) {
  const svg = document.getElementById('layout-svg');
  if (!svg) return;

  svg.querySelectorAll('[data-table-id]').forEach((group) => {
    group.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectedAnnotationId = null;
      syncTextEditor();
      const tableId = Number(group.dataset.tableId);
      const placement = layout.placements.find((item) => item.id === tableId);
      if (!placement) return;
      const start = svgPointFromPointer(svg, event);
      const origin = { x: placement.x, y: placement.y };
      let latest = { ...origin };
      let latestValidation = { valid: true, message: '' };
      group.setPointerCapture(event.pointerId);
      group.classList.add('is-dragging');

      const onMove = (moveEvent) => {
        const current = svgPointFromPointer(svg, moveEvent);
        latest = {
          x: origin.x + current.x - start.x,
          y: origin.y + current.y - start.y
        };
        const candidate = { ...placement, ...latest };
        latestValidation = validatePlacement(candidate, layout);
        group.setAttribute('transform', `translate(${latest.x - origin.x} ${latest.y - origin.y})`);
        group.classList.toggle('is-invalid', !latestValidation.valid);
        setEditorStatus(latestValidation.message);
      };

      const onEnd = (endEvent) => {
        group.releasePointerCapture?.(endEvent.pointerId);
        group.removeEventListener('pointermove', onMove);
        group.removeEventListener('pointerup', onEnd);
        group.removeEventListener('pointercancel', onCancel);
        group.classList.remove('is-dragging', 'is-invalid');
        group.removeAttribute('transform');
        if (latestValidation.valid) {
          placement.x = latest.x;
          placement.y = latest.y;
          storeManualLayout(layout);
          editorMessage = `Mesa M${placement.id} reposicionada com todas as cadeiras.`;
        } else {
          editorMessage = `Posição cancelada: ${latestValidation.message}`;
        }
        renderMain();
      };

      const onCancel = (cancelEvent) => {
        latestValidation = { valid: false, message: 'Movimento cancelado.' };
        onEnd(cancelEvent);
      };

      group.addEventListener('pointermove', onMove);
      group.addEventListener('pointerup', onEnd);
      group.addEventListener('pointercancel', onCancel);
    });
  });

  svg.querySelectorAll('[data-annotation-id]').forEach((group) => {
    group.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const annotation = getAnnotations().find((item) => item.id === group.dataset.annotationId);
      if (!annotation) return;
      selectedAnnotationId = annotation.id;
      syncTextEditor();
      const start = svgPointFromPointer(svg, event);
      const origin = { x: annotation.x, y: annotation.y };
      let latest = { ...origin };
      group.setPointerCapture(event.pointerId);
      group.classList.add('is-dragging');

      const onMove = (moveEvent) => {
        const current = svgPointFromPointer(svg, moveEvent);
        latest = {
          x: clamp(origin.x + current.x - start.x, 0, config.roomWidth),
          y: clamp(origin.y + current.y - start.y, 0, config.roomDepth)
        };
        group.setAttribute('transform', `translate(${latest.x} ${latest.y})`);
        setEditorStatus(`Texto em X ${latest.x.toFixed(2)} m · Y ${latest.y.toFixed(2)} m.`);
      };

      const onEnd = (endEvent) => {
        group.releasePointerCapture?.(endEvent.pointerId);
        group.removeEventListener('pointermove', onMove);
        group.removeEventListener('pointerup', onEnd);
        group.removeEventListener('pointercancel', onEnd);
        group.classList.remove('is-dragging');
        annotation.x = roundCoordinate(latest.x);
        annotation.y = roundCoordinate(latest.y);
        persist();
        editorMessage = 'Texto reposicionado. Use os controles laterais para cor, escala e rotação.';
        suppressCanvasClickUntil = Date.now() + 700;
        renderMain();
      };

      group.addEventListener('pointermove', onMove);
      group.addEventListener('pointerup', onEnd);
      group.addEventListener('pointercancel', onEnd);
    });
  });

  svg.addEventListener('click', (event) => {
    if (Date.now() < suppressCanvasClickUntil) return;
    if (event.target.closest('[data-table-id], [data-annotation-id]')) return;
    if (!selectedAnnotationId) return;
    selectedAnnotationId = null;
    editorMessage = 'Seleção de texto removida.';
    renderMain();
  });
}

function exportPng() {
  const svg = document.getElementById('layout-svg');
  if (!svg) return;
  const cloned = svg.cloneNode(true);
  cloned.querySelectorAll('[data-editor-only]').forEach((element) => element.remove());
  cloned.querySelectorAll('.is-dragging, .is-invalid').forEach((element) => element.classList.remove('is-dragging', 'is-invalid'));
  cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const styleText = Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n');
      } catch {
        return '';
      }
    }).join('\n');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = styleText;
  cloned.insertBefore(style, cloned.firstChild);

  const svgString = new XMLSerializer().serializeToString(cloned);
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    const scale = 80;
    canvas.width = Math.round((config.roomWidth + 3.2) * scale);
    canvas.height = Math.round((config.roomDepth + 3.2) * scale);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const link = document.createElement('a');
    const safeName = `${config.clientName || 'cliente'}-${LAYOUT_INFO[selectedKey].name}`
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    link.download = `${safeName || 'layout-evento'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  image.src = url;
}

bindForm();
syncForm();
renderMain();
