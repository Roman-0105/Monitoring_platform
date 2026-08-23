// ── Блок-схема водоотлива v2 (AntV X6 + dagre) ──────────────────
// Полная замена предыдущего hand-rolled SVG-движка (ui-dewatering.js,
// секция "Блок-схема водоотлива"). X6 отвечает за рендер/интерактив
// (drag, zoom/pan, orthogonal-роутинг с обходом узлов И других линий —
// то, чего не хватало старому движку), dagre — за автоматическую
// слоистую раскладку (зумпф → насос → направление), которую пользователь
// может донастроить руками; правки сохраняются и переживают обновление.
//
// Использует те же данные и часть готовых хелперов из ui-dewatering.js
// (DewateringState, DustState, _dewDiagramComputeFlows, DEW_DEST_TYPE,
// DEW_PUMP_STATUS, _dewDestColor, escHTML/escAttr) — этот файл грузится
// после ui-dewatering.js, так что всё это уже доступно глобально.

var DewDiag = {
  graph:       null,
  wrap:        null,   // текущий контейнер монтирования (инлайн или fullscreen)
  fullscreen:  false,
  animEnabled: true,
  editMode:    false,   // MAP-EDIT: ручное редактирование связей (порты + изгибы)
  datePreset:  'yesterday', // 'yesterday' | '7d' | '2w' | '1m' | 'custom'
  dateFrom:    '',
  dateTo:      '',
  positions:   {},      // {nodeId: {x,y}} — ручные правки поверх авто-раскладки
  edges:       {},      // {edgeId: {vertices:[{x,y}], sourcePort, targetPort}} — ручные правки связей
  quarryOrder: [],
  templates:       [],   // именованные шаблоны расстановки (из Supabase, dew_diagram_templates)
  templatesLoaded: false,
  templatesPanelOpen: false,
};

var DEWD_POS_KEY   = 'dew_diagram_pos_v2';
var DEWD_EDGES_KEY = 'dew_diagram_edges_v2';

function dewDiagLoadPos() {
  try { DewDiag.positions = JSON.parse(localStorage.getItem(DEWD_POS_KEY) || '{}'); }
  catch(e) { DewDiag.positions = {}; }
  try { DewDiag.edges = JSON.parse(localStorage.getItem(DEWD_EDGES_KEY) || '{}'); }
  catch(e) { DewDiag.edges = {}; }
}
function dewDiagSavePos() {
  try { localStorage.setItem(DEWD_POS_KEY, JSON.stringify(DewDiag.positions)); } catch(e) {}
}
function dewDiagSaveEdges() {
  try { localStorage.setItem(DEWD_EDGES_KEY, JSON.stringify(DewDiag.edges)); } catch(e) {}
}

// ── Геометрия узлов ──────────────────────────────────────────────
// width/height (не w/h) — так их ожидает dagre при вычислении раскладки.
var DEWD_SIZE = {
  sump:   { width: 190, height: 100 },
  pump:   { width: 84,  height: 84  },
  dest:   { width: 176, height: 78  },
  nozzle: { width: 92,  height: 80  },
};
// Зумпфы, принимающие поток от других зумпфов (промежуточные), показывают
// доп. строку "Пришло" — карточке нужно больше высоты под неё.
var DEWD_SUMP_IN_EXTRA = 24;

function dewDiagId(type, id) { return type + '_' + id; }

// ── Порты узлов (точки подключения связей) ────────────────────────
// У каждого узла — 4 порта по сторонам (N/E/S/W). В обычном режиме они
// прозрачные (opacity:0, но magnet:true — соединяться с ними можно,
// просто не видно точки); в режиме редактирования связей — видимые
// кружки, за которые можно перетащить конец линии на другую сторону узла.
var DEWD_PORT_SIDES = ['top', 'right', 'bottom', 'left'];
function dewDiagPortsFor(editMode) {
  var vis = editMode ? 1 : 0;
  var groups = {};
  DEWD_PORT_SIDES.forEach(function(side) {
    groups[side] = {
      position: side,
      attrs: {
        circle: {
          r: 5, magnet: true, stroke: '#f59e0b', strokeWidth: 1.5, fill: 'var(--bg-1,#0d1117)',
          opacity: vis, cursor: 'crosshair',
        },
      },
    };
  });
  return {
    groups: groups,
    items: DEWD_PORT_SIDES.map(function(side) { return { id: side, group: side }; }),
  };
}

// ── Диапазон дат (как в старом коде — переносим 1:1) ──────────────
function dewDiagGetRange() {
  var today = new Date();
  var fmt = function(d) { return d.toISOString().slice(0, 10); };
  var yesterday = fmt(new Date(today.getTime() - 86400000));
  if (DewDiag.datePreset === 'yesterday') return { from: yesterday, to: yesterday };
  if (DewDiag.datePreset === '7d')  return { from: fmt(new Date(today.getTime() - 7  * 86400000)), to: yesterday };
  if (DewDiag.datePreset === '2w')  return { from: fmt(new Date(today.getTime() - 14 * 86400000)), to: yesterday };
  if (DewDiag.datePreset === '1m')  return { from: fmt(new Date(today.getTime() - 30 * 86400000)), to: yesterday };
  if (DewDiag.datePreset === 'custom') return { from: DewDiag.dateFrom || yesterday, to: DewDiag.dateTo || yesterday };
  return { from: yesterday, to: yesterday };
}
function dewDiagPeriodLabel() {
  if (DewDiag.datePreset === 'yesterday') return 'Вчера';
  if (DewDiag.datePreset === '7d')  return '7 дней';
  if (DewDiag.datePreset === '2w')  return '2 недели';
  if (DewDiag.datePreset === '1m')  return '30 дней';
  if (DewDiag.datePreset === 'custom') {
    var r = dewDiagGetRange();
    return r.from === r.to ? r.from : r.from + '…' + r.to;
  }
  return 'Период';
}

// ── Сбор данных модели (узлы + связи) ─────────────────────────────
function dewDiagBuildModel() {
  var range = dewDiagGetRange();
  var dateFrom = range.from, dateTo = range.to;
  var sumps = DewateringState.sumps;
  var pumps = DewateringState.pumps.filter(function(p) { return DewateringState.pumpExistsOn(p, dateTo); });
  var flows = _dewDiagramComputeFlows(dateFrom, dateTo);

  var termDests = DewateringState.destinations.filter(function(d) {
    return !(d.type === 'intermediate_sump' && d.targetSumpId);
  });

  // Насадки пылеподавления, питающиеся из наших зумпфов (как в старом коде)
  var nozzles = [];
  var nozzleVolumes = {};
  if (typeof DustState !== 'undefined' && DustState.nozzles) {
    var sumpIdSet = {};
    sumps.forEach(function(s) { sumpIdSet[s.id] = true; });
    DustState.nozzles.forEach(function(nzl) {
      if (nzl.sourceType !== 'sump' || !nzl.sourceId || !sumpIdSet[nzl.sourceId]) return;
      nozzles.push(nzl);
      var logs = DustState.logs.filter(function(l) { return l.nozzleId === nzl.id; });
      function logVol(l) {
        if (l.isManualVolume) return parseFloat(l.manualVolume) || 0;
        var veh = DustState.vehicleById(l.vehicleId);
        return (parseFloat(l.trips) || 0) * (veh ? (parseFloat(veh.capacity) || 0) : 0);
      }
      var volDate = logs.filter(function(l) { return l.date >= dateFrom && l.date <= dateTo; }).reduce(function(a,l){ return a+logVol(l); }, 0);
      var volTotal = logs.reduce(function(a,l){ return a+logVol(l); }, 0);
      nozzleVolumes[nzl.id] = { volDate: volDate, volTotal: volTotal };
    });
  }

  var qSet = {}, qNames = [];
  sumps.forEach(function(s) { var q = s.quarry || '—'; if (!qSet[q]) { qSet[q] = true; qNames.push(q); } });
  if (!DewDiag.quarryOrder.length || DewDiag.quarryOrder.length !== qNames.length) DewDiag.quarryOrder = qNames;

  return {
    dateFrom: dateFrom, dateTo: dateTo, flows: flows,
    sumps: sumps, pumps: pumps, termDests: termDests, nozzles: nozzles, nozzleVolumes: nozzleVolumes,
    quarryNames: qNames,
  };
}

// ── Карточки узлов (HTML, тема берётся из CSS-переменных приложения) ──

function dewDiagSumpHtml(data) {
  var barPct = data.depth != null ? Math.min(100, Math.max(0, data.depth / 5 * 100)) : 0;
  var barClr = data.depth == null ? 'var(--txt-3)' : data.depth > 2 ? 'var(--bad)' : data.depth > 1 ? 'var(--warn)' : '#58a6ff';
  return '' +
    '<div class="dewd-card dewd-sump" title="Открыть в Журнале">' +
      '<div class="dewd-card-hdr" style="background:var(--dewd-sump-header)"></div>' +
      '<div class="dewd-card-body">' +
        '<div class="dewd-title">' + escHTML(data.name) + '</div>' +
        '<div class="dewd-sub">' + (data.quarry ? escHTML(data.quarry) : 'зумпф') + '</div>' +
        (data.hasInflow ? '<div class="dewd-sump-in">⬇ Пришло: <b>' + data.inVolDate.toFixed(0) + '</b><span class="dewd-unit"> м³</span></div>' : '') +
        '<div class="dewd-bar"><div class="dewd-bar-fill" style="width:' + barPct + '%;background:' + barClr + '"></div></div>' +
        '<div class="dewd-stats">' +
          '<div><div class="dewd-stat-lbl">⬆ ' + escHTML(data.periodLabel) + '</div><div class="dewd-stat-val" style="color:var(--gold)">' + data.volDate.toFixed(0) + '<span class="dewd-unit"> м³</span></div></div>' +
          '<div><div class="dewd-stat-lbl">Всего</div><div class="dewd-stat-val2">' + data.volTotal.toFixed(0) + '<span class="dewd-unit"> м³</span></div></div>' +
          (data.depth != null ? '<div class="dewd-stat-r"><div class="dewd-stat-lbl">Глубина</div><div class="dewd-stat-val2" style="color:' + barClr + '">' + data.depth.toFixed(1) + ' м</div></div>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
}

function dewDiagPumpHtml(data) {
  var st = DEW_PUMP_STATUS[data.status] || DEW_PUMP_STATUS.off;
  var stClr = data.status === 'working' ? 'var(--ok)' : data.status === 'standby' ? '#58a6ff' : data.status === 'repair' ? 'var(--warn)' : 'var(--txt-3)';
  // Пульсация "сонаром" — насос реально качает воду в выбранный период
  // (не просто числится "в работе"): визуально узел сам эмитирует поток,
  // а не только линия от него.
  var pulse = (data.active && data.animEnabled)
    ? '<div class="dewd-pump-pulse" style="border-color:' + stClr + '"></div><div class="dewd-pump-pulse" style="border-color:' + stClr + ';animation-delay:.9s"></div>'
    : '';
  return '' +
    '<div class="dewd-pump-ring" style="border-color:' + stClr + ';box-shadow:0 0 14px ' + stClr + '55,var(--dewd-shadow)" title="' + escAttr(st.label) + '">' +
      pulse +
      '<div class="dewd-pump-inner" style="border-color:' + stClr + '55">' +
        '<div class="dewd-pump-name">' + escHTML(data.name) + '</div>' +
        '<div class="dewd-pump-dot" style="background:' + stClr + '"></div>' +
        '<div class="dewd-pump-vol">' + data.volDate.toFixed(0) + '<span class="dewd-unit"> м³</span></div>' +
      '</div>' +
    '</div>';
}

function dewDiagDestHtml(data) {
  var dtInfo = DEW_DEST_TYPE[data.destType] || { label: data.destType || 'направление', icon: '📍' };
  return '' +
    '<div class="dewd-card dewd-dest">' +
      '<div class="dewd-card-hdr" style="background:' + data.color + '"></div>' +
      '<div class="dewd-card-body">' +
        '<div class="dewd-dest-row"><span class="dewd-dot" style="background:' + data.color + '"></span><span class="dewd-title">' + escHTML(data.name) + '</span></div>' +
        '<div class="dewd-sub" style="color:' + data.color + 'cc">' + escHTML(dtInfo.label) + '</div>' +
        '<div class="dewd-stats">' +
          '<div><div class="dewd-stat-lbl">' + escHTML(data.periodLabel) + '</div><div class="dewd-stat-val" style="color:' + (data.volDate > 0 ? data.color : 'var(--txt-3)') + '">' + data.volDate.toFixed(0) + '<span class="dewd-unit"> м³</span></div></div>' +
          '<div><div class="dewd-stat-lbl">Всего</div><div class="dewd-stat-val2">' + data.volTotal.toFixed(0) + '<span class="dewd-unit"> м³</span></div></div>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function dewDiagNozzleHtml(data) {
  return '' +
    '<div class="dewd-nozzle">' +
      '<div class="dewd-nozzle-icon">💦</div>' +
      '<div class="dewd-nozzle-name">' + escHTML(data.name) + '</div>' +
      '<div class="dewd-nozzle-vol">' + data.volDate.toFixed(0) + '<span class="dewd-unit"> м³</span></div>' +
    '</div>';
}

function dewDiagQuarryBgHtml(data) {
  var qc = data.color;
  return '' +
    '<div class="dewd-quarry-bg" style="background:' + qc.bg + ';border-color:' + qc.border + '">' +
      '<div class="dewd-quarry-lbl" style="color:' + qc.text + '">' + escHTML(data.name) + '</div>' +
    '</div>';
}

// ── Регистрация HTML-форм узлов в X6 (один раз) ───────────────────
var _dewDiagShapesRegistered = false;
function dewDiagRegisterShapes() {
  if (_dewDiagShapesRegistered) return;
  _dewDiagShapesRegistered = true;

  function reg(shape, renderFn) {
    X6.Shape.HTML.register({
      shape: shape,
      html: function(node) { var d = node.getData() || {}; var el = document.createElement('div'); el.style.cssText = 'width:100%;height:100%'; el.innerHTML = renderFn(d); return el; },
      effect: ['data'],
    });
  }
  reg('dewd-sump',   dewDiagSumpHtml);
  reg('dewd-pump',   dewDiagPumpHtml);
  reg('dewd-dest',   dewDiagDestHtml);
  reg('dewd-nozzle', dewDiagNozzleHtml);
  reg('dewd-quarry', dewDiagQuarryBgHtml);
}

// ── CSS (тема — через CSS-переменные приложения, как везде в проекте) ──
function dewDiagInjectCss() {
  if (document.getElementById('dewd-css')) return;
  var s = document.createElement('style');
  s.id = 'dewd-css';
  s.textContent = [
    ':root{--dewd-shadow:0 2px 10px rgba(0,0,0,.35)}',
    '[data-theme="light"]{--dewd-shadow:0 2px 8px rgba(0,0,0,.1)}',
    '.dewd-card{width:100%;height:100%;background:var(--bg-2);border:1px solid var(--line);border-radius:var(--r,8px);box-shadow:var(--dewd-shadow);overflow:hidden;box-sizing:border-box;font-family:inherit}',
    '.dewd-sump{cursor:pointer;transition:box-shadow .15s,border-color .15s}',
    '.dewd-sump:hover{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold),var(--dewd-shadow)}',
    '.dewd-card-hdr{height:3px}',
    '.dewd-card-body{padding:7px 9px}',
    '.dewd-title{font-size:11px;font-weight:700;color:var(--txt-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dewd-sub{font-size:8px;color:var(--txt-3);margin:1px 0 5px}',
    '.dewd-sump-in{font-size:9px;color:#58a6ff;margin:0 0 4px;display:flex;align-items:center;gap:3px;line-height:1.3}',
    '.dewd-sump-in b{font-size:11px;font-weight:700}',
    '.dewd-bar{height:4px;background:var(--bg-0,rgba(0,0,0,.2));border-radius:2px;overflow:hidden;margin-bottom:5px}',
    '.dewd-bar-fill{height:100%;border-radius:2px}',
    '.dewd-stats{display:flex;gap:8px;align-items:flex-end}',
    '.dewd-stat-lbl{font-size:8px;color:var(--txt-3)}',
    '.dewd-stat-val{font-size:13px;font-weight:700;line-height:1.3}',
    '.dewd-stat-val2{font-size:11px;color:var(--txt-2)}',
    '.dewd-stat-r{margin-left:auto;text-align:right}',
    '.dewd-unit{font-size:8px;font-weight:400;color:var(--txt-3)}',
    '.dewd-dest-row{display:flex;align-items:center;gap:5px;margin-bottom:2px}',
    '.dewd-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}',
    '.dewd-pump-ring{position:absolute;inset:0;border-radius:50%;background:var(--bg-2);border:3px solid;box-sizing:border-box}',
    '.dewd-pump-inner{position:absolute;inset:6px;border-radius:50%;border:1px solid;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;text-align:center;gap:1px;box-sizing:border-box}',
    '.dewd-pump-name{font-size:8.5px;font-weight:700;color:var(--txt-1);max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.2;padding:0 2px}',
    '.dewd-pump-dot{width:3px;height:3px;border-radius:50%;flex-shrink:0}',
    '.dewd-pump-vol{font-size:11px;font-weight:700;color:var(--gold);line-height:1}',
    '.dewd-pump-pulse{position:absolute;inset:-4px;border-radius:50%;border:2px solid;opacity:0;animation:dewd-pulse 1.8s ease-out infinite;pointer-events:none}',
    '@keyframes dewd-pulse{0%{transform:scale(.82);opacity:.65}100%{transform:scale(1.3);opacity:0}}',
    '.dewd-nozzle{position:relative;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:1px;background:var(--dewd-nozzle-bg,#0d1b2a);clip-path:polygon(25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%);border:2px solid var(--dewd-nozzle-border,#22d3ee);box-sizing:border-box}',
    '.dewd-nozzle-icon{font-size:13px;line-height:1}',
    '.dewd-nozzle-name{font-size:8px;font-weight:700;color:var(--txt-1);max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dewd-nozzle-vol{font-size:10px;font-weight:700;color:var(--gold)}',
    '.dewd-quarry-bg{width:100%;height:100%;border:1.5px dashed;border-radius:12px;box-sizing:border-box;position:relative}',
    '.dewd-quarry-lbl{position:absolute;top:6px;left:10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;opacity:.85}',
    '.dewd-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}',
    '.dewd-btn{background:var(--bg-2);border:1px solid var(--line);color:var(--txt-2);border-radius:6px;padding:3px 9px;font-size:11px;cursor:pointer;line-height:1.6}',
    '.dewd-btn:hover{color:var(--txt-1);border-color:var(--txt-3)}',
    '.dewd-btn.active{background:var(--gold);color:#000;border-color:var(--gold)}',
    '.dewd-sep{width:1px;height:20px;background:var(--line)}',
    '.dewd-viewport{overflow:hidden;position:relative;border:1px solid var(--line);border-radius:8px;background:var(--bg-1)}',
    '.dewd-legend{display:flex;flex-wrap:wrap;gap:10px;font-size:10px;color:var(--txt-3);margin-top:6px}',
    '.dewd-edit-hint{font-size:11px;color:var(--gold);background:rgba(234,179,8,.1);border:1px solid rgba(234,179,8,.25);border-radius:6px;padding:6px 10px;margin-bottom:8px;line-height:1.5}',
    '.dewd-droplet{filter:drop-shadow(0 0 2px rgba(0,0,0,.5))}',
    '.dewd-legend-sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}',
    '@keyframes dewd-flow{to{stroke-dashoffset:-40}}',
    '.dewd-tpl-panel{background:var(--bg-2);border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px;max-width:340px}',
    '.dewd-tpl-hdr{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px}',
    '.dewd-tpl-empty{font-size:11px;color:var(--txt-3);padding:4px 0 10px}',
    '.dewd-tpl-row{display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--line)}',
    '.dewd-tpl-name{flex:1;font-size:12px;color:var(--txt-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dewd-tpl-save{margin-top:8px;width:100%}',
  ].join('\n');
  document.head.appendChild(s);
}

// ── Палитра карьеров (для фоновых зон) ────────────────────────────
var DEWD_QUARRY_COLORS_DARK = [
  { bg:'rgba(88,166,255,0.06)', border:'rgba(88,166,255,0.35)', text:'rgba(88,166,255,0.85)' },
  { bg:'rgba(74,222,128,0.06)', border:'rgba(74,222,128,0.32)', text:'rgba(74,222,128,0.85)' },
  { bg:'rgba(251,191,36,0.06)', border:'rgba(251,191,36,0.32)', text:'rgba(251,191,36,0.85)' },
  { bg:'rgba(188,140,255,0.06)',border:'rgba(188,140,255,0.32)',text:'rgba(188,140,255,0.85)' },
  { bg:'rgba(248,81,73,0.06)',  border:'rgba(248,81,73,0.32)',  text:'rgba(248,81,73,0.85)' },
];
var DEWD_QUARRY_COLORS_LIGHT = [
  { bg:'rgba(37,99,235,0.05)', border:'rgba(37,99,235,0.3)',  text:'rgba(37,99,235,0.9)' },
  { bg:'rgba(5,150,105,0.05)', border:'rgba(5,150,105,0.28)', text:'rgba(5,150,105,0.9)' },
  { bg:'rgba(217,119,6,0.05)', border:'rgba(217,119,6,0.28)', text:'rgba(217,119,6,0.9)' },
  { bg:'rgba(139,92,246,0.05)',border:'rgba(139,92,246,0.28)',text:'rgba(139,92,246,0.9)' },
  { bg:'rgba(239,68,68,0.05)', border:'rgba(239,68,68,0.28)', text:'rgba(239,68,68,0.9)' },
];
function dewDiagQuarryColors() {
  var isLight = document.documentElement.getAttribute('data-theme') === 'light';
  return isLight ? DEWD_QUARRY_COLORS_LIGHT : DEWD_QUARRY_COLORS_DARK;
}

// ── Авто-раскладка (dagre, слева-направо: зумпф → насос → направление) ──
// dagre пишет вычисленные x/y/rank прямо в переданный объект узла — если
// отдавать один и тот же объект-константу (DEWD_SIZE.sump и т.п.) сразу
// нескольким узлам, они окажутся одним и тем же объектом по ссылке, и все
// такие узлы "схлопнутся" в одну точку. dewdSizeCopy() отдаёт свежую копию
// на каждый вызов — отсюда и обязателен для каждого g.setNode().
function dewdSizeCopy(sz) { return { width: sz.width, height: sz.height }; }

// Зумпф считается "принимающим", если хоть один поток (насос → направление
// типа "промежуточный зумпф") нацелен именно на него — независимо от того,
// был ли в выбранном периоде реальный объём (0 м³ тоже осмысленный ответ:
// "в этом периоде ничего не пришло"). Используется и раскладкой (чтобы
// зарезервировать место под доп. строку), и самой карточкой (что показать).
function dewDiagSumpHasInflow(model, sumpId) {
  var targetId = dewDiagId('smp', sumpId);
  return Object.keys(model.flows).some(function(k) { return model.flows[k].targetNodeId === targetId; });
}
function dewDiagSumpSize(model, sumpId) {
  var sz = dewdSizeCopy(DEWD_SIZE.sump);
  if (dewDiagSumpHasInflow(model, sumpId)) sz.height += DEWD_SUMP_IN_EXTRA;
  return sz;
}

function dewDiagAutoLayout(model) {
  var g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 34, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(function() { return {}; });

  model.sumps.forEach(function(s) { g.setNode(dewDiagId('smp', s.id), dewDiagSumpSize(model, s.id)); });
  model.pumps.forEach(function(p) {
    g.setNode(dewDiagId('pmp', p.id), dewdSizeCopy(DEWD_SIZE.pump));
    g.setEdge(dewDiagId('smp', p.sumpId), dewDiagId('pmp', p.id));
  });
  model.termDests.forEach(function(d) { g.setNode(dewDiagId('dst', d.id), dewdSizeCopy(DEWD_SIZE.dest)); });
  model.nozzles.forEach(function(n) {
    g.setNode(dewDiagId('nzl', n.id), dewdSizeCopy(DEWD_SIZE.nozzle));
    g.setEdge(dewDiagId('smp', n.sourceId), dewDiagId('nzl', n.id));
  });
  Object.keys(model.flows).forEach(function(k) {
    var f = model.flows[k];
    if (!g.hasNode(dewDiagId('pmp', f.pumpId)) || !g.hasNode(f.targetNodeId)) return;
    g.setEdge(dewDiagId('pmp', f.pumpId), f.targetNodeId);
  });

  dagre.layout(g);

  var pos = {};
  g.nodes().forEach(function(id) {
    var n = g.node(id);
    pos[id] = { x: Math.round(n.x - n.width / 2), y: Math.round(n.y - n.height / 2) };
  });
  return pos;
}

// Сводит воедино: сохранённые вручную позиции (приоритет) + авто-раскладку
// для всего, чего в сохранённых нет (новый узел, первый запуск, сброс).
function dewDiagResolvePositions(model) {
  var auto = dewDiagAutoLayout(model);
  var resolved = {};
  Object.keys(auto).forEach(function(id) {
    resolved[id] = DewDiag.positions[id] || auto[id];
  });
  return resolved;
}

// ── Фоновые зоны карьеров (визуальная группировка, не влияет на раскладку) ──
function dewDiagComputeQuarryBoxes(model) {
  var qColors = dewDiagQuarryColors();
  var PAD = 22, TOP_PAD = 28;
  var boxes = {};
  model.quarryNames.forEach(function(q, qi) {
    var sumpsInQ = model.sumps.filter(function(s) { return (s.quarry || '—') === q; });
    if (!sumpsInQ.length) return;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    sumpsInQ.forEach(function(s) {
      var p = DewDiag.graph ? dewDiagNodeXY(dewDiagId('smp', s.id)) : null;
      if (!p) return;
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + DEWD_SIZE.sump.width); maxY = Math.max(maxY, p.y + dewDiagSumpSize(model, s.id).height);
    });
    if (minX === Infinity) return;
    boxes[q] = {
      x: minX - PAD, y: minY - TOP_PAD, w: (maxX - minX) + PAD * 2, h: (maxY - minY) + TOP_PAD + PAD,
      color: qColors[qi % qColors.length],
    };
  });
  return boxes;
}
function dewDiagNodeXY(id) {
  var cell = DewDiag.graph && DewDiag.graph.getCellById(id);
  return cell ? cell.position() : null;
}
function dewDiagRefreshQuarryBounds() {
  if (!DewDiag.graph || !DewDiag.model) return;
  var boxes = dewDiagComputeQuarryBoxes(DewDiag.model);
  Object.keys(boxes).forEach(function(q) {
    var b = boxes[q];
    var cell = DewDiag.graph.getCellById(dewDiagId('qry', q));
    if (cell) { cell.position(b.x, b.y); cell.resize(b.w, b.h); }
  });
}

// ── Тулбар + легенда ───────────────────────────────────────────────
function dewDiagToolbarHtml(isOverlay) {
  var presets = [
    { key: 'yesterday', label: 'Вчера' },
    { key: '7d',  label: '7 дней' },
    { key: '2w',  label: '2 нед' },
    { key: '1m',  label: '1 мес' },
    { key: 'custom', label: 'Период' },
  ];
  var presetBtns = presets.map(function(pr) {
    var active = DewDiag.datePreset === pr.key;
    return '<button class="dewd-btn' + (active ? ' active' : '') + '" onclick="dewDiagSetPreset(\'' + pr.key + '\')">' + pr.label + '</button>';
  }).join('');
  var customRange = DewDiag.datePreset === 'custom'
    ? '<input type="date" class="form-control" value="' + escAttr(DewDiag.dateFrom) + '" style="width:130px;font-size:11px" onchange="DewDiag.dateFrom=this.value;dewDiagRender(DewDiag.wrap)">' +
      '<span style="color:var(--txt-3);font-size:11px">—</span>' +
      '<input type="date" class="form-control" value="' + escAttr(DewDiag.dateTo) + '" style="width:130px;font-size:11px" onchange="DewDiag.dateTo=this.value;dewDiagRender(DewDiag.wrap)">'
    : '';
  return '' +
    '<div style="display:flex;gap:4px;flex-wrap:wrap">' + presetBtns + customRange + '</div>' +
    '<div class="dewd-sep"></div>' +
    '<button class="dewd-btn" onclick="dewDiagZoomOut()">−</button>' +
    '<span id="dewd-zoom-label" style="font-size:11px;color:var(--txt-3);min-width:36px;text-align:center;display:inline-block">100%</span>' +
    '<button class="dewd-btn" onclick="dewDiagZoomIn()">+</button>' +
    '<button class="dewd-btn" onclick="dewDiagZoomFit()">⊞ Центр</button>' +
    '<div class="dewd-sep"></div>' +
    '<button class="dewd-btn' + (DewDiag.animEnabled ? ' active' : '') + '" id="dewd-btn-anim" onclick="dewDiagToggleAnimation()">' + (DewDiag.animEnabled ? '⏸' : '▶') + ' Анимация</button>' +
    '<button class="dewd-btn" onclick="dewDiagResetLayout()">↺ Авто-раскладка</button>' +
    '<button class="dewd-btn' + (DewDiag.templatesPanelOpen ? ' active' : '') + '" onclick="dewDiagToggleTemplatesPanel()">📐 Шаблоны</button>' +
    '<div class="dewd-sep"></div>' +
    '<button class="dewd-btn' + (DewDiag.editMode ? ' active' : '') + '" onclick="dewDiagToggleEditMode()" title="Перетаскивайте конец линии на любую сторону узла (порт), двойной клик по линии — точка изгиба">✎ Редактировать связи</button>' +
    (DewDiag.editMode ? '<button class="dewd-btn" onclick="dewDiagResetEdges()" title="Убрать все ручные изгибы/порты связей">↺ Сбросить связи</button>' : '') +
    '<button class="dewd-btn" onclick="dewDiagToggleFullscreen()">' + (isOverlay ? '✕ Закрыть' : '⛶ На весь экран') + '</button>';
}

function dewDiagLegendHtml(model) {
  var seen = {}, items = [];
  model.termDests.forEach(function(d) {
    var key = d.type;
    if (seen[key]) return;
    seen[key] = true;
    var info = DEW_DEST_TYPE[d.type] || { label: d.type };
    items.push('<span><span class="dewd-legend-sw" style="background:' + _dewDestColor(d) + '"></span>' + escHTML(info.label) + '</span>');
  });
  if (!items.length) return '';
  return '<div class="dewd-legend">' + items.join('') + '</div>';
}

// ── Шаблоны расстановки (Supabase, dew_diagram_templates) ─────────
// Позиции узлов + правки связей — те же, что живут в DewDiag.positions/
// DewDiag.edges (и обычно в localStorage) — но именованным снимком в
// базе, доступным с любого устройства/браузера, а не только текущего.
function dewDiagTemplatesPanelHtml() {
  if (!DewDiag.templatesPanelOpen) return '';
  var body;
  if (!DewDiag.templatesLoaded) {
    body = '<div class="dewd-tpl-empty">Загрузка…</div>';
  } else if (!DewDiag.templates.length) {
    body = '<div class="dewd-tpl-empty">Шаблонов пока нет — сохраните текущую раскладку.</div>';
  } else {
    body = DewDiag.templates.map(function(t) {
      return '<div class="dewd-tpl-row">' +
        '<span class="dewd-tpl-name" title="' + escAttr(t.name) + '">' + escHTML(t.name) + '</span>' +
        '<button class="dewd-btn" onclick="dewDiagApplyTemplate(\'' + t.id + '\')">Применить</button>' +
        '<button class="dewd-btn" onclick="dewDiagDeleteTemplate(\'' + t.id + '\')" title="Удалить шаблон">✕</button>' +
      '</div>';
    }).join('');
  }
  return '<div class="dewd-tpl-panel">' +
    '<div class="dewd-tpl-hdr">Шаблоны расстановки схемы</div>' +
    body +
    '<button class="dewd-btn dewd-tpl-save" onclick="dewDiagSaveAsTemplate()">💾 Сохранить текущую как шаблон…</button>' +
  '</div>';
}

function dewDiagToggleTemplatesPanel() {
  DewDiag.templatesPanelOpen = !DewDiag.templatesPanelOpen;
  if (DewDiag.templatesPanelOpen && !DewDiag.templatesLoaded) {
    dewDiagLoadTemplates(function() { dewDiagRender(DewDiag.wrap); });
    return; // перерисуется, когда загрузка ответит
  }
  dewDiagRender(DewDiag.wrap);
}

function dewDiagLoadTemplates(cb) {
  if (!window.Api) { DewDiag.templates = []; DewDiag.templatesLoaded = true; if (cb) cb(); return; }
  Api.getDewDiagTemplates().then(function(res) {
    DewDiag.templates = (res && !res.error && res.data) ? res.data.map(rowToDewDiagTemplate) : [];
    DewDiag.templatesLoaded = true;
    if (cb) cb();
  }).catch(function() {
    DewDiag.templates = [];
    DewDiag.templatesLoaded = true;
    if (cb) cb();
  });
}

function dewDiagSaveAsTemplate() {
  var name = (prompt('Название шаблона расстановки:', '') || '').trim();
  if (!name) return;
  var existing = DewDiag.templates.find(function(t) { return t.name === name; });
  if (existing && !confirm('Шаблон «' + name + '» уже существует. Перезаписать текущей раскладкой?')) return;
  var tpl = {
    id: existing ? existing.id : DewateringState._id('dgt'),
    name: name,
    positions: DewDiag.positions,
    edges: DewDiag.edges,
  };
  if (!window.Api) { if (window.Toast) Toast.show('Нет соединения с сервером', 'error'); return; }
  Api.upsertDewDiagTemplate(dewDiagTemplateToRow(tpl)).then(function(res) {
    if (res && res.error) { if (window.Toast) Toast.show('Не удалось сохранить шаблон', 'error'); return; }
    if (existing) DewDiag.templates[DewDiag.templates.indexOf(existing)] = tpl;
    else DewDiag.templates.push(tpl);
    DewDiag.templates.sort(function(a, b) { return a.name.localeCompare(b.name); });
    if (window.Toast) Toast.show('Шаблон «' + name + '» сохранён', 'success');
    dewDiagRender(DewDiag.wrap);
  }).catch(function() { if (window.Toast) Toast.show('Не удалось сохранить шаблон', 'error'); });
}

function dewDiagApplyTemplate(id) {
  var tpl = DewDiag.templates.find(function(t) { return t.id === id; });
  if (!tpl) return;
  DewDiag.positions = JSON.parse(JSON.stringify(tpl.positions || {}));
  DewDiag.edges = JSON.parse(JSON.stringify(tpl.edges || {}));
  dewDiagSavePos();
  dewDiagSaveEdges();
  DewDiag.templatesPanelOpen = false;
  dewDiagRender(DewDiag.wrap);
  if (window.Toast) Toast.show('Шаблон «' + tpl.name + '» применён', 'success');
}

function dewDiagDeleteTemplate(id) {
  var tpl = DewDiag.templates.find(function(t) { return t.id === id; });
  if (!tpl || !confirm('Удалить шаблон «' + tpl.name + '»?')) return;
  if (!window.Api) { if (window.Toast) Toast.show('Нет соединения с сервером', 'error'); return; }
  Api.deleteDewDiagTemplate(id).then(function(res) {
    if (res && res.error) { if (window.Toast) Toast.show('Не удалось удалить шаблон', 'error'); return; }
    DewDiag.templates = DewDiag.templates.filter(function(t) { return t.id !== id; });
    dewDiagRender(DewDiag.wrap);
  }).catch(function() { if (window.Toast) Toast.show('Не удалось удалить шаблон', 'error'); });
}

// ── Основной рендер ──────────────────────────────────────────────
function dewDiagRender(wrap) {
  if (!wrap) return;
  dewDiagRegisterShapes();
  dewDiagInjectCss();
  dewDiagLoadPos();
  DewDiag.wrap = wrap;

  var model = dewDiagBuildModel();
  DewDiag.model = model;
  var pos = dewDiagResolvePositions(model);

  var isOverlay = wrap.id === 'dewd-fs-overlay';
  var vpHeight = isOverlay ? 'calc(100vh - 190px)' : '560px';
  wrap.innerHTML =
    '<div class="dewd-toolbar">' + dewDiagToolbarHtml(isOverlay) + '</div>' +
    dewDiagTemplatesPanelHtml() +
    (DewDiag.editMode ? '<div class="dewd-edit-hint">✎ Режим редактирования связей: перетащите жёлтый кружок на конце линии на другую сторону узла — тянуть можно только к портам того же узла, с которым линия уже соединена; двойной клик по линии добавляет точку изгиба, её можно таскать и удалить повторным двойным кликом.</div>' : '') +
    '<div id="dewd-viewport" class="dewd-viewport" style="' + (isOverlay ? 'flex:1;height:0' : 'height:' + vpHeight) + '"></div>' +
    dewDiagLegendHtml(model);

  var vpEl = wrap.querySelector('#dewd-viewport');
  var rect = vpEl.getBoundingClientRect();

  if (DewDiag.graph) { DewDiag.graph.dispose(); DewDiag.graph = null; }
  var TC = _dewGetThemeColors();
  var graph = new X6.Graph({
    container: vpEl,
    width: Math.max(200, rect.width || 900),
    height: Math.max(200, rect.height || 560),
    background: { color: 'transparent' },
    panning: { enabled: true },
    mousewheel: { enabled: true, modifiers: [], minScale: 0.2, maxScale: 3, factor: 1.1 },
    interacting: function(cellView) {
      var cell = cellView.cell;
      var isQuarry = cell.isNode && cell.isNode() && String(cell.id).indexOf('qry_') === 0;
      return { nodeMovable: !isQuarry, edgeMovable: DewDiag.editMode, vertexMovable: DewDiag.editMode, vertexAddable: DewDiag.editMode, vertexDeletable: DewDiag.editMode };
    },
    connecting: {
      allowBlank: false,   // конец связи всегда должен попасть на порт — иначе откатывается назад
      allowLoop: false,
      allowNode: false,    // нельзя цеплять за произвольную точку тела узла — только за порт
      allowEdge: false,
      allowPort: true,
      snap: { radius: 20 },
      highlight: true,
    },
    // Связь на схеме отражает реальные данные (насос ⇒ направление из
    // журнала) — редактирование меняет ТОЛЬКО то, с какой стороны узла
    // выходит линия, а не саму топологию. Поэтому при перетаскивании
    // конца связи разрешаем попасть только на порт ТОГО ЖЕ узла, за
    // который эта связь и так уже была зацеплена.
    validateConnection: function(args) {
      if (!DewDiag.editMode) return false;
      var edge = args.edge;
      var data = edge && edge.getData && edge.getData();
      if (!data) return false;
      var fixedId = args.type === 'source' ? data.origSource : data.origTarget;
      var cellId = args.cell && args.cell.id;
      return !!cellId && cellId === fixedId;
    },
  });
  DewDiag.graph = graph;

  // Первый рендер данного зумпфа/насоса/направления не должен подхватывать
  // старые события — очищаем, затем подписываемся заново.
  graph.off('node:moved');
  graph.on('node:moved', function(args) {
    var node = args.node;
    var id = String(node.id);
    if (id.indexOf('qry_') === 0) return;
    var p = node.position();
    DewDiag.positions[id] = { x: Math.round(p.x), y: Math.round(p.y) };
    dewDiagSavePos();
    if (id.indexOf('smp_') === 0) dewDiagRefreshQuarryBounds();
  });

  // ── Клик по узлу-зумпфу → переход в Журнал, отфильтрованный на него ──
  // (заменяет прежнюю кнопку "Заполнить данные" на убранных карточках
  // зумпфов). Отслеживаем позицию на mousedown, чтобы отличить настоящий
  // клик от завершения перетаскивания — иначе перенос узла на схеме тоже
  // уводил бы на другую вкладку.
  var dewDiagClickStartPos = null;
  graph.off('node:mousedown');
  graph.on('node:mousedown', function(args) { dewDiagClickStartPos = args.node.position(); });
  graph.off('node:click');
  graph.on('node:click', function(args) {
    if (DewDiag.editMode) return;
    var node = args.node;
    var id = String(node.id);
    if (id.indexOf('smp_') !== 0) return;
    if (dewDiagClickStartPos) {
      var p = node.position();
      var moved = Math.abs(p.x - dewDiagClickStartPos.x) > 2 || Math.abs(p.y - dewDiagClickStartPos.y) > 2;
      if (moved) return;
    }
    if (typeof _dewJumpToSumpJournal === 'function') _dewJumpToSumpJournal(id.slice(4));
  });

  // ── Персист правок связей: изгибы + порт подключения ──────────────
  graph.off('edge:change:vertices');
  graph.off('edge:change:source');
  graph.off('edge:change:target');
  function dewDiagSaveEdgeOverride(edge) {
    var id = String(edge.id);
    var verts = edge.getVertices() || [];
    var src = edge.getSource(), tgt = edge.getTarget();
    DewDiag.edges[id] = {
      vertices: verts.map(function(v) { return { x: Math.round(v.x), y: Math.round(v.y) }; }),
      sourcePort: src && src.port,
      targetPort: tgt && tgt.port,
    };
    dewDiagSaveEdges();
  }
  graph.on('edge:change:vertices', function(args) { if (DewDiag.editMode) dewDiagSaveEdgeOverride(args.edge); });
  graph.on('edge:change:source',   function(args) { if (DewDiag.editMode) dewDiagSaveEdgeOverride(args.edge); });
  graph.on('edge:change:target',   function(args) { if (DewDiag.editMode) dewDiagSaveEdgeOverride(args.edge); });

  // ── Фоновые зоны карьеров (первыми — визуально позади всего) ──
  // dewDiagComputeQuarryBoxes() читает позиции узлов из графа, а на первом
  // проходе узлов ещё нет — поэтому здесь считаем границы прямо по `pos`.
  var quarryBoxes = {};
  (function() {
    var qColors = dewDiagQuarryColors();
    var PAD = 22, TOP_PAD = 28;
    model.quarryNames.forEach(function(q, qi) {
      var sumpsInQ = model.sumps.filter(function(s) { return (s.quarry || '—') === q; });
      if (!sumpsInQ.length) return;
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      sumpsInQ.forEach(function(s) {
        var p = pos[dewDiagId('smp', s.id)]; if (!p) return;
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + DEWD_SIZE.sump.width); maxY = Math.max(maxY, p.y + dewDiagSumpSize(model, s.id).height);
      });
      if (minX === Infinity) return;
      quarryBoxes[q] = {
        x: minX - PAD, y: minY - TOP_PAD, w: (maxX - minX) + PAD * 2, h: (maxY - minY) + TOP_PAD + PAD,
        color: qColors[qi % qColors.length],
      };
    });
  })();
  Object.keys(quarryBoxes).forEach(function(q) {
    var b = quarryBoxes[q];
    graph.addNode({ id: dewDiagId('qry', q), shape: 'dewd-quarry', x: b.x, y: b.y, width: b.w, height: b.h, zIndex: 0, data: { name: q, color: b.color } });
  });

  // ── Зумпфы ──
  model.sumps.forEach(function(s) {
    var p = pos[dewDiagId('smp', s.id)]; if (!p) return;
    var pumpIds = DewateringState.pumpsOfSump(s.id).map(function(pp) { return pp.id; });
    var volDate = DewateringState.meterReadings
      .filter(function(r) { return r.date >= model.dateFrom && r.date <= model.dateTo && pumpIds.indexOf(r.pumpId) >= 0; })
      .reduce(function(a, r) { return a + (DewateringState.computedVolume(r) || 0); }, 0);
    var volTotal = pumpIds.reduce(function(a, pid) { return a + DewateringState.totalVolumePump(pid); }, 0);
    var latestWL = DewateringState.waterLevels.filter(function(w) { return w.sumpId === s.id; })
      .sort(function(a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
    var wl = latestWL.length ? parseFloat(latestWL[0].elevation) : null;
    var elev = DewateringState.sumpCurrentElevation(s.id);
    var depth = (wl != null && elev != null) ? (wl - elev) : null;

    // Входящий поток от других зумпфов (насос вышестоящего зумпфа → это как
    // "промежуточный зумпф"-направление) — сколько ПРИШЛО за период, отдельно
    // от того, сколько сам зумпф откачал своими насосами (volDate выше).
    var targetId = dewDiagId('smp', s.id);
    var hasInflow = false, inVolDate = 0;
    Object.keys(model.flows).forEach(function(k) {
      var f = model.flows[k];
      if (f.targetNodeId === targetId) { hasInflow = true; inVolDate += f.volDate; }
    });
    var sz = dewDiagSumpSize(model, s.id);

    graph.addNode({
      id: dewDiagId('smp', s.id), shape: 'dewd-sump', x: p.x, y: p.y, width: sz.width, height: sz.height, zIndex: 10,
      ports: dewDiagPortsFor(DewDiag.editMode),
      data: { name: s.name, quarry: s.quarry, volDate: volDate, volTotal: volTotal, depth: depth, periodLabel: dewDiagPeriodLabel(), hasInflow: hasInflow, inVolDate: inVolDate },
    });
  });

  // ── Насосы ──
  model.pumps.forEach(function(pu) {
    var p = pos[dewDiagId('pmp', pu.id)]; if (!p) return;
    var volDate = DewateringState.meterReadings
      .filter(function(r) { return r.pumpId === pu.id && r.date >= model.dateFrom && r.date <= model.dateTo; })
      .reduce(function(a, r) { return a + (DewateringState.computedVolume(r) || 0); }, 0);
    graph.addNode({
      id: dewDiagId('pmp', pu.id), shape: 'dewd-pump', x: p.x, y: p.y, width: DEWD_SIZE.pump.width, height: DEWD_SIZE.pump.height, zIndex: 12,
      ports: dewDiagPortsFor(DewDiag.editMode),
      data: { name: pu.name, status: pu.status, volDate: volDate, active: volDate > 0, animEnabled: DewDiag.animEnabled },
    });
  });

  // ── Направления ──
  model.termDests.forEach(function(d) {
    var p = pos[dewDiagId('dst', d.id)]; if (!p) return;
    var volDate = 0, volTotal = 0;
    Object.keys(model.flows).forEach(function(k) {
      var f = model.flows[k];
      if (f.targetNodeId === dewDiagId('dst', d.id)) { volDate += f.volDate; volTotal += f.volTotal; }
    });
    graph.addNode({
      id: dewDiagId('dst', d.id), shape: 'dewd-dest', x: p.x, y: p.y, width: DEWD_SIZE.dest.width, height: DEWD_SIZE.dest.height, zIndex: 10,
      ports: dewDiagPortsFor(DewDiag.editMode),
      data: { name: d.name, destType: d.type, color: _dewDestColor(d), volDate: volDate, volTotal: volTotal, periodLabel: dewDiagPeriodLabel() },
    });
  });

  // ── Насадки пылеподавления ──
  model.nozzles.forEach(function(n) {
    var p = pos[dewDiagId('nzl', n.id)]; if (!p) return;
    var v = model.nozzleVolumes[n.id] || { volDate: 0, volTotal: 0 };
    graph.addNode({
      id: dewDiagId('nzl', n.id), shape: 'dewd-nozzle', x: p.x, y: p.y, width: DEWD_SIZE.nozzle.width, height: DEWD_SIZE.nozzle.height, zIndex: 12,
      ports: dewDiagPortsFor(DewDiag.editMode),
      data: { name: n.name, volDate: v.volDate },
    });
  });

  // ── Хелпер добавления ребра: стабильный id + применение ручных правок
  // (изгибы/порты, если пользователь их задавал) + инструменты редактора.
  function addFlowEdge(id, srcId, tgtId, opts) {
    var ov = DewDiag.edges[id];
    var edgeDef = {
      id: id,
      source: (ov && ov.sourcePort) ? { cell: srcId, port: ov.sourcePort } : srcId,
      target: (ov && ov.targetPort) ? { cell: tgtId, port: ov.targetPort } : tgtId,
      vertices: (ov && ov.vertices) || [],
      data: { origSource: srcId, origTarget: tgtId },
      tools: DewDiag.editMode ? ['vertices', 'source-arrowhead', 'target-arrowhead'] : [],
      zIndex: opts.zIndex,
      router: opts.router,
      connector: opts.connector,
      attrs: opts.attrs,
      labels: opts.labels || [],
    };
    return graph.addEdge(edgeDef);
  }

  // ── Рёбра: структурные (зумпф→насос, зумпф→насадка) ──
  model.pumps.forEach(function(pu) {
    var srcId = dewDiagId('smp', pu.sumpId), tgtId = dewDiagId('pmp', pu.id);
    if (!graph.getCellById(srcId) || !graph.getCellById(tgtId)) return;
    addFlowEdge('edge_struct_' + pu.id, srcId, tgtId, {
      zIndex: 1,
      router: { name: 'manhattan', args: { padding: 8, step: 10 } },
      connector: { name: 'rounded', args: { radius: 6 } },
      attrs: { line: { stroke: TC.edgeStruct, strokeWidth: 1.4, targetMarker: null } },
    });
  });
  model.nozzles.forEach(function(n) {
    var srcId = dewDiagId('smp', n.sourceId), tgtId = dewDiagId('nzl', n.id);
    if (!graph.getCellById(srcId) || !graph.getCellById(tgtId)) return;
    addFlowEdge('edge_nzl_' + n.id, srcId, tgtId, {
      zIndex: 1,
      router: { name: 'manhattan', args: { padding: 8, step: 10 } },
      connector: { name: 'rounded', args: { radius: 6 } },
      attrs: { line: { stroke: TC.edgeNozzle, strokeWidth: 1.2, strokeDasharray: '3,3', targetMarker: null } },
    });
  });

  // ── Рёбра: поток (насос→направление/промежуточный зумпф) ──
  var maxVol = 0;
  Object.keys(model.flows).forEach(function(k) { if (model.flows[k].volTotal > maxVol) maxVol = model.flows[k].volTotal; });
  maxVol = maxVol || 1;
  var flowEdgesForDroplets = [];
  Object.keys(model.flows).forEach(function(k) {
    var f = model.flows[k];
    var srcId = dewDiagId('pmp', f.pumpId);
    if (!graph.getCellById(srcId) || !graph.getCellById(f.targetNodeId)) return;
    var edgeClr = TC.edgeFlow, arrowClr = TC.arrowFlow;
    if (f.targetNodeId.indexOf('dst_') === 0) {
      var dest = DewateringState.destById(f.targetNodeId.slice(4));
      if (dest) { edgeClr = _dewDestColor(dest); arrowClr = edgeClr; }
    } else if (f.targetNodeId.indexOf('smp_') === 0) {
      edgeClr = DEW_DEST_TYPE.intermediate_sump.color; arrowClr = edgeClr;
    }
    var sw = 1.5 + f.volTotal / maxVol * 3.5;
    var lineAttrs = {
      stroke: edgeClr, strokeWidth: sw,
      targetMarker: { name: 'block', width: 7, height: 5, fill: arrowClr },
    };
    var animated = DewDiag.animEnabled && f.volDate > 0;
    if (animated) {
      lineAttrs.strokeDasharray = 6;
      lineAttrs.style = { animation: 'dewd-flow ' + Math.max(0.6, 2.2 - (f.volTotal / maxVol) * 1.6).toFixed(2) + 's linear infinite' };
    }
    var edgeId = 'edge_flow_' + f.pumpId + '__' + f.targetNodeId;
    var edgeCell = addFlowEdge(edgeId, srcId, f.targetNodeId, {
      zIndex: 2,
      router: { name: 'manhattan', args: { padding: 10, step: 10 } },
      connector: { name: 'rounded', args: { radius: 8 } },
      attrs: { line: lineAttrs },
      // Селекторы 'label'/'body' — так называются элементы во ВСТРОЕННОЙ
      // разметке ярлыка X6; свой markup с другими именами селекторов
      // ломает рендер (X6 внутренне ожидает найти именно 'label').
      labels: f.volDate > 0 ? [{
        attrs: {
          label: { text: f.volDate.toFixed(0) + ' м³', fill: TC.labelText, fontSize: 10, fontWeight: 600 },
          body: { fill: 'var(--bg-1)', stroke: 'none', rx: 3, ry: 3 },
        },
      }] : [],
    });
    if (animated) flowEdgesForDroplets.push({ edge: edgeCell, color: arrowClr, speed: Math.max(1.2, 4 - (f.volTotal / maxVol) * 2.6) });
  });

  // ── Анимация капель воды, бегущих по пути каждого активного ребра ──
  // (эмулирует направление тока воды точнее, чем просто пунктир —
  // видно движение конкретной "частицы" от насоса до направления).
  if (flowEdgesForDroplets.length) {
    // X6 считает пути manhattan-роутера асинхронно и вразнобой по времени
    // (на полном графе ~30 рёбер часть путей готова к 120мс, часть — нет).
    // Вместо гадания с фиксированной паузой — дожидаемся, пока у ВСЕХ
    // рёбер появится непустой d, с несколькими попытками и отступлением.
    dewDiagWaitPathsReady(flowEdgesForDroplets, 0);
  }

  dewDiagUpdateZoomLabel();
}

// Ждёт, пока у ВСЕХ рёбер из items появится непустой атрибут d (X6 считает
// manhattan-роутинг асинхронно и не одновременно для всех рёбер сразу —
// на полном графе часть путей готова раньше других), затем один раз
// добавляет капли. Максимум 10 попыток по 60мс (=до 600мс) — с запасом
// даже для большого графа; если что-то так и не просчиталось, капли
// добавляются только для готовых рёбер, а не блокируются навсегда.
function dewDiagWaitPathsReady(items, attempt) {
  if (!DewDiag.graph) return;
  var allReady = items.every(function(item) {
    var view = DewDiag.graph.findViewByCell(item.edge);
    var pathEl = view && (view.container.querySelector('path[data-connection]') || view.container.querySelector('path'));
    return pathEl && (pathEl.getAttribute('d') || '').length > 0;
  });
  if (allReady || attempt >= 10) { dewDiagAddDroplets(items); return; }
  setTimeout(function() { dewDiagWaitPathsReady(items, attempt + 1); }, 60);
}

// Добавляет 1-2 бегущие "капли" вдоль SVG-пути каждого ребра через нативный
// SVG <animateMotion mpath>. Вызывается из dewDiagWaitPathsReady() —
// только когда у всех (или почти всех) рёбер уже готов путь в DOM.
function dewDiagAddDroplets(items) {
  if (!DewDiag.graph) return;
  var svg = DewDiag.graph.container.querySelector('svg');
  if (!svg) return;
  // Капли должны жить ВНУТРИ трансформируемой группы вьюпорта (там же, где
  // сами рёбра), а не как прямые дети <svg> — иначе они не наследуют
  // transform (translate/scale) при пане/зуме и "отклеиваются" от схемы,
  // оставаясь на месте относительно окна, пока сама схема двигается.
  var viewport = svg.querySelector('.x6-graph-svg-viewport') || svg;
  var ns = 'http://www.w3.org/2000/svg';
  items.forEach(function(item, idx) {
    var view = DewDiag.graph.findViewByCell(item.edge);
    if (!view) return;
    var pathEl = view.container.querySelector('path[data-connection]') || view.container.querySelector('path');
    if (!pathEl) return;
    var pathId = 'dewd-path-' + item.edge.id;
    pathEl.setAttribute('id', pathId);

    var dropCount = item.speed < 2 ? 2 : 1; // быстрый поток — две капли, чтобы не выглядело редко
    for (var i = 0; i < dropCount; i++) {
      var circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('r', '3');
      circle.setAttribute('fill', item.color);
      circle.setAttribute('opacity', '0.9');
      circle.setAttribute('class', 'dewd-droplet');
      var anim = document.createElementNS(ns, 'animateMotion');
      anim.setAttribute('dur', item.speed.toFixed(2) + 's');
      anim.setAttribute('repeatCount', 'indefinite');
      anim.setAttribute('begin', (i * item.speed / dropCount).toFixed(2) + 's');
      anim.setAttribute('rotate', 'auto');
      var mpath = document.createElementNS(ns, 'mpath');
      mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#' + pathId);
      anim.appendChild(mpath);
      circle.appendChild(anim);
      viewport.appendChild(circle);
    }
  });
}

// ── Zoom / pan ────────────────────────────────────────────────────
function dewDiagUpdateZoomLabel() {
  var el = (DewDiag.wrap && DewDiag.wrap.querySelector('#dewd-zoom-label')) || document.getElementById('dewd-zoom-label');
  if (el && DewDiag.graph) el.textContent = Math.round(DewDiag.graph.zoom() * 100) + '%';
}
function dewDiagZoomIn()  { if (DewDiag.graph) { DewDiag.graph.zoom(0.15, { minScale: 0.2, maxScale: 3 }); dewDiagUpdateZoomLabel(); } }
function dewDiagZoomOut() { if (DewDiag.graph) { DewDiag.graph.zoom(-0.15, { minScale: 0.2, maxScale: 3 }); dewDiagUpdateZoomLabel(); } }
function dewDiagZoomFit() {
  if (!DewDiag.graph) return;
  DewDiag.graph.zoomToFit({ padding: 30, maxScale: 1 });
  dewDiagUpdateZoomLabel();
}

// ── Переключатели тулбара ───────────────────────────────────────────
function dewDiagSetPreset(preset) { DewDiag.datePreset = preset; dewDiagRender(DewDiag.wrap); }
function dewDiagToggleAnimation() { DewDiag.animEnabled = !DewDiag.animEnabled; dewDiagRender(DewDiag.wrap); }
function dewDiagResetLayout() { DewDiag.positions = {}; dewDiagSavePos(); dewDiagRender(DewDiag.wrap); }
function dewDiagToggleEditMode() { DewDiag.editMode = !DewDiag.editMode; dewDiagRender(DewDiag.wrap); }
function dewDiagResetEdges() { DewDiag.edges = {}; dewDiagSaveEdges(); dewDiagRender(DewDiag.wrap); }

// ── Полноэкранный режим ──────────────────────────────────────────
function dewDiagToggleFullscreen() {
  var overlay = document.getElementById('dewd-fs-overlay');
  var backdrop = document.getElementById('dewd-fs-backdrop');
  if (overlay) {
    document.body.removeChild(overlay);
    if (backdrop) document.body.removeChild(backdrop);
    DewDiag.fullscreen = false;
    if (DewDiag._escHandler) document.removeEventListener('keydown', DewDiag._escHandler);
    var inline = document.getElementById('dew-diagram-wrap');
    if (inline) dewDiagRender(inline);
    return;
  }
  DewDiag.fullscreen = true;

  var bd = document.createElement('div');
  bd.id = 'dewd-fs-backdrop';
  bd.style.cssText = 'position:fixed;inset:0;z-index:8999;background:rgba(0,0,0,.72);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)';
  bd.addEventListener('click', dewDiagToggleFullscreen);
  document.body.appendChild(bd);

  var ov = document.createElement('div');
  ov.id = 'dewd-fs-overlay';
  ov.style.cssText = 'position:fixed;inset:32px 48px;z-index:9000;background:var(--bg-1,#0d1117);border:1px solid var(--line);border-radius:14px;box-shadow:0 32px 100px rgba(0,0,0,.85);display:flex;flex-direction:column;padding:16px;overflow:hidden';
  document.body.appendChild(ov);
  dewDiagRender(ov);

  DewDiag._escHandler = function(e) { if (e.key === 'Escape') dewDiagToggleFullscreen(); };
  document.addEventListener('keydown', DewDiag._escHandler);
}

// ── Совместимость со старыми точками вызова из ui-dewatering.js ──────
// (панель "Обзор" при первом рендере, форма направлений после
// сохранения) — эти имена определены позже по порядку загрузки
// скриптов и полностью замещают старые реализации того же имени.
function _dewRenderDiagram(wrap) {
  dewDiagRender(wrap);
  if (DewDiag.fullscreen) {
    var ov = document.getElementById('dewd-fs-overlay');
    if (ov && ov !== wrap) dewDiagRender(ov);
  }
}
function _dewDiagramToggleFullscreen() { dewDiagToggleFullscreen(); }

window.dewDiagRender           = dewDiagRender;
window.dewDiagSetPreset        = dewDiagSetPreset;
window.dewDiagToggleAnimation  = dewDiagToggleAnimation;
window.dewDiagResetLayout      = dewDiagResetLayout;
window.dewDiagToggleFullscreen = dewDiagToggleFullscreen;
window.dewDiagZoomIn           = dewDiagZoomIn;
window.dewDiagZoomOut          = dewDiagZoomOut;
window.dewDiagZoomFit          = dewDiagZoomFit;
window.dewDiagToggleEditMode   = dewDiagToggleEditMode;
window.dewDiagResetEdges       = dewDiagResetEdges;
window.dewDiagToggleTemplatesPanel = dewDiagToggleTemplatesPanel;
window.dewDiagSaveAsTemplate       = dewDiagSaveAsTemplate;
window.dewDiagApplyTemplate        = dewDiagApplyTemplate;
window.dewDiagDeleteTemplate       = dewDiagDeleteTemplate;
window._dewRenderDiagram           = _dewRenderDiagram;
window._dewDiagramToggleFullscreen = _dewDiagramToggleFullscreen;

