// ── Карьерный водоотлив v2 ───────────────────────────────────

var DewateringState = {
  sumps:                [],  // {id, name, quarry, notes}
  sumpElevationHistory: [],  // {id, sumpId, date, elevation, notes}
  pumps:                [],  // {id, sumpId, name, model, serialNumber, inventoryNumber, quarry, capacity, head, type, status, installDate, notes}
  pumpEvents:           [],  // {id, sumpId, date, type, removedPumpId, installedPumpId, reason, performedBy, notes}
  destinations:         [],  // {id, name, type, targetSumpId}
  meterReadings:        [],  // {id, pumpId, date, reading, isReset, isStopped, downtimeReason, hoursWorked, destinationId, isManualVolume, manualVolume, notes}
  waterLevels:          [],  // {id, sumpId, date, time, elevation, measuredBy, notes}

  _id: function(p) { return p + Date.now() + '_' + Math.random().toString(36).slice(2, 6); },

  load: function() {
    try {
      var raw = localStorage.getItem('dew_v2');
      var d = raw ? JSON.parse(raw) : {};
      this.sumps                = Array.isArray(d.sumps)                ? d.sumps                : [];
      this.sumpElevationHistory = Array.isArray(d.sumpElevationHistory) ? d.sumpElevationHistory : [];
      this.pumps                = Array.isArray(d.pumps)                ? d.pumps                : [];
      this.pumpEvents           = Array.isArray(d.pumpEvents)           ? d.pumpEvents           : [];
      this.destinations         = Array.isArray(d.destinations)         ? d.destinations         : _dewDefaultDest();
      this.meterReadings        = Array.isArray(d.meterReadings)        ? d.meterReadings        : [];
      this.waterLevels          = Array.isArray(d.waterLevels)          ? d.waterLevels          : [];
    } catch(e) {
      this.sumps = []; this.sumpElevationHistory = []; this.pumps = [];
      this.pumpEvents = []; this.destinations = _dewDefaultDest();
      this.meterReadings = []; this.waterLevels = [];
    }
  },

  save: function() {
    localStorage.setItem('dew_v2', JSON.stringify({
      sumps: this.sumps, sumpElevationHistory: this.sumpElevationHistory,
      pumps: this.pumps, pumpEvents: this.pumpEvents,
      destinations: this.destinations, meterReadings: this.meterReadings,
      waterLevels: this.waterLevels,
    }));
  },

  sumpById:    function(id) { return this.sumps.find(function(x) { return x.id === id; }); },
  pumpById:    function(id) { return this.pumps.find(function(x) { return x.id === id; }); },
  destById:    function(id) { return this.destinations.find(function(x) { return x.id === id; }); },
  pumpsOfSump: function(sid) { return this.pumps.filter(function(p) { return p.sumpId === sid; }); },

  sumpCurrentElevation: function(sumpId) {
    var hist = this.sumpElevationHistory
      .filter(function(h) { return h.sumpId === sumpId; })
      .sort(function(a, b) { return b.date.localeCompare(a.date); });
    return hist.length ? parseFloat(hist[0].elevation) : null;
  },

  readingForDate: function(pumpId, date) {
    return this.meterReadings.find(function(r) { return r.pumpId === pumpId && r.date === date; }) || null;
  },

  prevReading: function(pumpId, date) {
    var candidates = this.meterReadings
      .filter(function(r) { return r.pumpId === pumpId && r.date < date; })
      .sort(function(a, b) { return b.date.localeCompare(a.date); });
    return candidates.length ? candidates[0] : null;
  },

  computedVolume: function(rec) {
    if (!rec) return null;
    if (rec.isStopped) return 0;
    if (rec.isManualVolume) return parseFloat(rec.manualVolume) || 0;
    if (rec.isReset) return 0;
    var prev = this.prevReading(rec.pumpId, rec.date);
    if (!prev || prev.isStopped || prev.isReset) return null;
    var diff = parseFloat(rec.reading) - parseFloat(prev.reading);
    return diff >= 0 ? diff : null;
  },

  totalVolumePump: function(pumpId) {
    var self = this;
    return this.meterReadings
      .filter(function(r) { return r.pumpId === pumpId; })
      .reduce(function(acc, r) { var v = self.computedVolume(r); return acc + (v || 0); }, 0);
  },

  // Check if today's readings are complete for a sump (all working pumps have a record)
  sumpFillStatus: function(sumpId, date) {
    var pumps = this.pumpsOfSump(sumpId).filter(function(p) { return p.status === 'working'; });
    if (!pumps.length) return 'noactive';
    var filled = pumps.filter(function(p) {
      var r = DewateringState.readingForDate(p.id, date);
      return r !== null;
    }).length;
    if (filled === pumps.length) return 'complete';
    if (filled > 0) return 'partial';
    return 'empty';
  },

  // CRUD helpers
  addSump: function(d) { d.id = this._id('smp'); this.sumps.push(d); this.save(); return d; },
  updateSump: function(id, d) { var i = this.sumps.findIndex(function(s){return s.id===id;}); if(i>=0){this.sumps[i]=Object.assign({},this.sumps[i],d);this.save();} },
  deleteSump: function(id) {
    var pIds = this.pumps.filter(function(p){return p.sumpId===id;}).map(function(p){return p.id;});
    this.sumps=[...this.sumps.filter(function(s){return s.id!==id;})];
    this.sumpElevationHistory=this.sumpElevationHistory.filter(function(h){return h.sumpId!==id;});
    this.pumps=this.pumps.filter(function(p){return p.sumpId!==id;});
    this.pumpEvents=this.pumpEvents.filter(function(e){return e.sumpId!==id;});
    this.meterReadings=this.meterReadings.filter(function(r){return pIds.indexOf(r.pumpId)<0;});
    this.waterLevels=this.waterLevels.filter(function(w){return w.sumpId!==id;});
    this.save();
  },
  addElevation: function(d) { d.id=this._id('elv'); this.sumpElevationHistory.push(d); this.save(); return d; },
  deleteElevation: function(id) { this.sumpElevationHistory=this.sumpElevationHistory.filter(function(h){return h.id!==id;}); this.save(); },

  addPump: function(d) { d.id=this._id('pmp'); this.pumps.push(d); this.save(); return d; },
  updatePump: function(id, d) { var i=this.pumps.findIndex(function(p){return p.id===id;}); if(i>=0){this.pumps[i]=Object.assign({},this.pumps[i],d);this.save();} },
  deletePump: function(id) { this.pumps=this.pumps.filter(function(p){return p.id!==id;}); this.meterReadings=this.meterReadings.filter(function(r){return r.pumpId!==id;}); this.save(); },

  addPumpEvent: function(d) { d.id=this._id('evt'); this.pumpEvents.push(d); this.save(); return d; },
  deletePumpEvent: function(id) { this.pumpEvents=this.pumpEvents.filter(function(e){return e.id!==id;}); this.save(); },

  addDest: function(d) { d.id=this._id('dst'); this.destinations.push(d); this.save(); return d; },
  deleteDest: function(id) { this.destinations=this.destinations.filter(function(d){return d.id!==id;}); this.save(); },

  addReading: function(d) { d.id=this._id('mrd'); this.meterReadings.push(d); this.save(); return d; },
  updateReading: function(id, d) { var i=this.meterReadings.findIndex(function(r){return r.id===id;}); if(i>=0){this.meterReadings[i]=Object.assign({},this.meterReadings[i],d);this.save();} },
  deleteReading: function(id) { this.meterReadings=this.meterReadings.filter(function(r){return r.id!==id;}); this.save(); },

  addWaterLevel: function(d) { d.id=this._id('wlv'); this.waterLevels.push(d); this.save(); return d; },
  updateWaterLevel: function(id, d) { var i=this.waterLevels.findIndex(function(w){return w.id===id;}); if(i>=0){this.waterLevels[i]=Object.assign({},this.waterLevels[i],d);this.save();} },
  deleteWaterLevel: function(id) { this.waterLevels=this.waterLevels.filter(function(w){return w.id!==id;}); this.save(); },
};

function _dewDefaultDest() {
  return [
    { id: 'dst0', name: 'Отстойник №1',          type: 'settler',           targetSumpId: null },
    { id: 'dst1', name: 'Пруд-накопитель',        type: 'settler',           targetSumpId: null },
    { id: 'dst2', name: 'Технические нужды',      type: 'reuse',             targetSumpId: null },
    { id: 'dst3', name: 'Пылеподавление',         type: 'reuse',             targetSumpId: null },
    { id: 'dst4', name: 'Промежуточный зумпф',    type: 'intermediate_sump', targetSumpId: null },
    { id: 'dst5', name: 'За карьер',              type: 'outside',           targetSumpId: null },
  ];
}

var DEW_PUMP_STATUS = {
  working: { label: 'Работает', cls: 'pg' },
  standby: { label: 'Резерв',   cls: 'pb' },
  repair:  { label: 'Ремонт',   cls: 'py' },
  off:     { label: 'Отключён', cls: 'p_' },
};

var DEW_PUMP_TYPE = { main: 'Основной', standby: 'Резервный' };

var DEW_DEST_TYPE = {
  settler:          { label: 'Отстойник / пруд',       icon: '💧' },
  intermediate_sump:{ label: 'Промежуточный зумпф',    icon: '↕'  },
  internal:         { label: 'Внутри карьера',         icon: '→'  },
  reuse:            { label: 'Повторное использование', icon: '♻'  },
  outside:          { label: 'За карьер',              icon: '⇥'  },
};

var DEW_EVENT_TYPE = {
  install:    'Установка насоса',
  remove:     'Снятие насоса',
  replace:    'Замена насоса',
  repair_out: 'Отправка в ремонт',
  repair_in:  'Возврат из ремонта',
};

var _dewInited  = false;
var _dewSubTab  = 'overview';
var _dewJFilter = { sumpId: '', date: '' };
var _dewLFilter = { sumpId: '' };

// ── Init ─────────────────────────────────────────────────────

function initDewateringTab() {
  DewateringState.load();
  if (!_dewInited) {
    _dewInited = true;
    document.querySelectorAll('[data-dew-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() { _dewSwitch(this.dataset.dewTab); });
    });
  }
  _dewSwitch(_dewSubTab);
}

function _dewSwitch(tab) {
  _dewSubTab = tab;
  document.querySelectorAll('[data-dew-tab]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.dewTab === tab);
  });
  document.querySelectorAll('.dew-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'dew-panel-' + tab);
  });
  if (tab === 'overview')  _dewRenderOverview();
  if (tab === 'sumps')     _dewRenderSumps();
  if (tab === 'journal')   _dewRenderJournal();
  if (tab === 'levels')    _dewRenderLevels();
  if (tab === 'analytics') _dewRenderAnalytics();
}

// ── Обзор ────────────────────────────────────────────────────

function _dewRenderOverview() {
  var el = document.getElementById('dew-panel-overview');
  if (!el) return;

  var today      = new Date().toISOString().slice(0, 10);
  var monthStart = today.slice(0, 7) + '-01';

  var allPumps = DewateringState.pumps;
  var working  = allPumps.filter(function(p) { return p.status === 'working'; }).length;
  var standby  = allPumps.filter(function(p) { return p.status === 'standby'; }).length;
  var repair   = allPumps.filter(function(p) { return p.status === 'repair';  }).length;

  // Monthly volume from meter readings
  var monthReadings = DewateringState.meterReadings.filter(function(r) { return r.date >= monthStart && r.date <= today; });
  var volMonth = monthReadings.reduce(function(a, r) { return a + (DewateringState.computedVolume(r) || 0); }, 0);
  var volToday = DewateringState.meterReadings
    .filter(function(r) { return r.date === today; })
    .reduce(function(a, r) { return a + (DewateringState.computedVolume(r) || 0); }, 0);

  var nowRu = new Date().toLocaleString('ru', { month: 'long' });

  var kpiHtml =
    '<div class="anl-kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">' +
    _dewKpi('Зумпфов в карьере',  DewateringState.sumps.length, allPumps.length + ' насосов', 'var(--gold)') +
    _dewKpi('Работают сейчас',    working,  standby + ' рез. · ' + repair + ' рем.', 'var(--ok)') +
    _dewKpi('Объём за сутки',     volToday.toFixed(0) + ' <small>м³</small>', 'показания расходомеров', 'var(--blue)') +
    _dewKpi('Объём за месяц',     volMonth.toFixed(0) + ' <small>м³</small>', nowRu, 'var(--warn)') +
    _dewKpi('Записей журнала',    DewateringState.meterReadings.length, 'всего показаний', 'var(--txt-2)') +
    _dewKpi('Замеров уровня',     DewateringState.waterLevels.length,   'зеркало воды', 'var(--txt-2)') +
    '</div>';

  // Daily fill status
  var FILL_STATUS = {
    complete: { icon: '✓', clr: 'var(--ok)',   label: 'Журнал заполнен' },
    partial:  { icon: '◑', clr: 'var(--warn)', label: 'Частично заполнен' },
    empty:    { icon: '✗', clr: 'var(--bad)',  label: 'Не заполнен' },
    noactive: { icon: '—', clr: 'var(--txt-3)',label: 'Нет активных насосов' },
  };

  var sumpsHtml = !DewateringState.sumps.length
    ? '<div class="card" style="padding:24px;text-align:center;color:var(--txt-3);font-size:13px">Зумпфы не добавлены — перейдите на вкладку <b>Зумпфы</b></div>'
    : '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:8px">Состояние зумпфов · ' + today + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">' +
      DewateringState.sumps.map(function(sump) {
        var pumps  = DewateringState.pumpsOfSump(sump.id);
        var wk     = pumps.filter(function(p) { return p.status === 'working'; }).length;
        var st     = pumps.filter(function(p) { return p.status === 'standby'; }).length;
        var rp     = pumps.filter(function(p) { return p.status === 'repair';  }).length;
        var fillSt = DewateringState.sumpFillStatus(sump.id, today);
        var fs     = FILL_STATUS[fillSt];
        var elev   = DewateringState.sumpCurrentElevation(sump.id);
        var latestWL = DewateringState.waterLevels
          .filter(function(w) { return w.sumpId === sump.id; })
          .sort(function(a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
        var wl = latestWL.length ? parseFloat(latestWL[0].elevation) : null;
        var depth = (wl != null && elev != null) ? (wl - elev) : null;

        // Sump daily volume
        var sumpPumpIds = pumps.map(function(p) { return p.id; });
        var sumpVolToday = DewateringState.meterReadings
          .filter(function(r) { return r.date === today && sumpPumpIds.indexOf(r.pumpId) >= 0; })
          .reduce(function(a, r) { return a + (DewateringState.computedVolume(r) || 0); }, 0);

        return '<div class="card" style="padding:14px">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px">' +
            '<div>' +
              '<div style="font-weight:600;color:var(--txt-1);font-size:13px">' + escHTML(sump.name) + '</div>' +
              (sump.quarry ? '<div style="font-size:10px;color:var(--txt-3)">' + escHTML(sump.quarry) + '</div>' : '') +
            '</div>' +
            '<div style="text-align:right">' +
              '<div style="font-size:13px;color:' + fs.clr + ';font-weight:700">' + fs.icon + '</div>' +
              '<div style="font-size:9px;color:var(--txt-3)">' + fs.label + '</div>' +
            '</div>' +
          '</div>' +
          (wl != null ?
            '<div style="display:flex;gap:12px;font-size:11px;margin-bottom:8px">' +
              '<div><div style="color:var(--txt-3);font-size:9px">Зеркало воды</div><div style="color:var(--txt-1);font-weight:600">' + wl.toFixed(1) + ' м абс.</div></div>' +
              (depth != null ? '<div><div style="color:var(--txt-3);font-size:9px">Глубина воды</div><div style="color:' + (depth > 1.5 ? 'var(--warn)' : 'var(--ok)') + ';font-weight:600">' + depth.toFixed(1) + ' м</div></div>' : '') +
              (latestWL.length ? '<div><div style="color:var(--txt-3);font-size:9px">Замер</div><div style="color:var(--txt-2)">' + latestWL[0].date + '</div></div>' : '') +
            '</div>' : '') +
          '<div style="display:flex;gap:10px;font-size:11px;color:var(--txt-3);margin-bottom:6px">' +
            '<span>Насосов: <b style="color:var(--txt-1)">' + pumps.length + '</b></span>' +
            '<span style="color:var(--ok)">▶ ' + wk + '</span>' +
            '<span style="color:var(--gold)">◼ ' + st + ' рез.</span>' +
            (rp ? '<span style="color:var(--warn)">⚠ ' + rp + ' рем.</span>' : '') +
          '</div>' +
          '<div style="font-size:11px;color:var(--txt-3)">За сутки: <span style="color:var(--txt-1);font-weight:600">' + sumpVolToday.toFixed(0) + ' м³</span></div>' +
        '</div>';
      }).join('') +
      '</div>';

  el.innerHTML = kpiHtml + sumpsHtml;
}

function _dewKpi(label, val, sub, clr) {
  return '<div class="anl-kpi"><div class="anl-kpi-lbl">' + label + '</div>' +
    '<div class="anl-kpi-val" style="color:' + clr + '">' + val + '</div>' +
    (sub ? '<div class="anl-kpi-sub">' + sub + '</div>' : '') + '</div>';
}

// ── Зумпфы ───────────────────────────────────────────────────

function _dewRenderSumps() {
  var el = document.getElementById('dew-panel-sumps');
  if (!el) return;
  el.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">' +
      '<div>' +
        _dewSectionHeader('Зумпфы', 'dew-btn-add-sump', '+ Зумпф', true) +
        '<div id="dew-sumps-list"></div><div id="dew-sump-form"></div>' +
      '</div>' +
      '<div>' +
        _dewSectionHeader('Насосы', 'dew-btn-add-pump', '+ Насос', false) +
        '<div id="dew-pumps-list"></div><div id="dew-pump-form"></div>' +
        '<div id="dew-pump-events-panel"></div>' +
        '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">' +
          _dewSectionHeader('Направления перекачки', 'dew-btn-add-dest', '+ Добавить', false) +
          '<div id="dew-dest-list"></div><div id="dew-dest-form"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  _dewRenderSumpsList(); _dewRenderPumpsList(); _dewRenderDestList();

  document.getElementById('dew-btn-add-sump').addEventListener('click', function() { _dewOpenSumpForm(null); });
  document.getElementById('dew-btn-add-pump').addEventListener('click', function() {
    if (!DewateringState.sumps.length) { Toast.show('Сначала добавьте зумпф', 'warning'); return; }
    _dewOpenPumpForm(null);
  });
  document.getElementById('dew-btn-add-dest').addEventListener('click', _dewOpenDestForm);
}

function _dewSectionHeader(title, btnId, btnLabel, gold) {
  return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
    '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3)">' + title + '</div>' +
    '<button class="btn btn-sm ' + (gold ? '' : 'btn-outline') + '" id="' + btnId + '" style="font-size:11px' + (gold ? ';background:var(--gold);color:#000' : '') + '">' + btnLabel + '</button>' +
    '</div>';
}

function _dewRenderSumpsList() {
  var el = document.getElementById('dew-sumps-list');
  if (!el) return;
  if (!DewateringState.sumps.length) { el.innerHTML = '<p style="color:var(--txt-3);font-size:12px;padding:8px 0">Нет зумпфов</p>'; return; }
  el.innerHTML = DewateringState.sumps.map(function(s) {
    var pumps = DewateringState.pumpsOfSump(s.id);
    var elev  = DewateringState.sumpCurrentElevation(s.id);
    var hist  = DewateringState.sumpElevationHistory.filter(function(h) { return h.sumpId === s.id; });
    return '<div class="card" style="padding:12px 14px;margin-bottom:8px">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
        '<div style="flex:1;font-weight:600;color:var(--txt-1);font-size:13px">' + escHTML(s.name) + '</div>' +
        (s.quarry ? '<span style="font-size:10px;color:var(--txt-3)">' + escHTML(s.quarry) + '</span>' : '') +
        '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 7px" onclick="_dewOpenSumpForm(\'' + s.id + '\')">✎</button>' +
        '<button class="btn btn-sm" style="font-size:10px;padding:2px 7px;background:rgba(248,113,113,.12);color:var(--bad);border:1px solid rgba(248,113,113,.25)" onclick="_dewDeleteSump(\'' + s.id + '\')">✕</button>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--txt-3);display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px">' +
        (elev != null ? '<span>Отм. дна: <b style="color:var(--txt-2)">' + elev.toFixed(1) + ' м абс.</b></span>' : '<span style="color:var(--warn)">Отметка не задана</span>') +
        '<span>Насосов: <b style="color:var(--txt-2)">' + pumps.length + '</b></span>' +
      '</div>' +
      '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 8px" onclick="_dewOpenElevationHistory(\'' + s.id + '\')">' +
        '📜 История отметок (' + hist.length + ')' +
      '</button>' +
      (s.notes ? '<div style="font-size:10px;color:var(--txt-3);margin-top:4px">' + escHTML(s.notes) + '</div>' : '') +
    '</div>';
  }).join('');
}

function _dewOpenSumpForm(id) {
  var s = id ? DewateringState.sumpById(id) : null;
  var formEl = document.getElementById('dew-sump-form');
  if (!formEl) return;
  formEl.innerHTML =
    '<div class="card" style="padding:14px;margin-top:8px;border:1px solid var(--gold-2)">' +
    '<div style="font-size:12px;font-weight:600;color:var(--gold);margin-bottom:10px">' + (id ? 'Редактировать зумпф' : 'Новый зумпф') + '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
    _dewFld('Название', 'text', 'dew-sf-name', s ? s.name : '', 'Зумпф №1') +
    _dewFld('Карьер / участок', 'text', 'dew-sf-quarry', s ? s.quarry || '' : '', 'ЮРГ') +
    '</div>' +
    _dewFld('Примечание', 'text', 'dew-sf-notes', s ? s.notes || '' : '', '') +
    '<p style="font-size:10px;color:var(--txt-3);margin:4px 0 8px">Отметку дна зумпфа вводите через «История отметок» — это позволяет отслеживать изменения при углублении карьера</p>' +
    '<div style="display:flex;gap:8px;margin-top:6px">' +
    '<button class="btn btn-sm" style="background:var(--gold);color:#000" id="dew-sf-save">Сохранить</button>' +
    '<button class="btn btn-sm btn-outline" id="dew-sf-cancel">Отмена</button>' +
    '</div></div>';

  document.getElementById('dew-sf-cancel').onclick = function() { formEl.innerHTML = ''; };
  document.getElementById('dew-sf-save').onclick = function() {
    var name = document.getElementById('dew-sf-name').value.trim();
    if (!name) { Toast.show('Введите название зумпфа', 'warning'); return; }
    var data = { name: name, quarry: document.getElementById('dew-sf-quarry').value.trim() || '', notes: document.getElementById('dew-sf-notes').value.trim() || '' };
    if (id) DewateringState.updateSump(id, data);
    else    DewateringState.addSump(data);
    formEl.innerHTML = '';
    _dewRenderSumpsList();
    Toast.show(id ? 'Зумпф обновлён' : 'Зумпф добавлен', 'success');
  };
}

function _dewOpenElevationHistory(sumpId) {
  var sump  = DewateringState.sumpById(sumpId);
  if (!sump) return;
  var formEl = document.getElementById('dew-sump-form');
  if (!formEl) return;

  var hist = DewateringState.sumpElevationHistory
    .filter(function(h) { return h.sumpId === sumpId; })
    .sort(function(a, b) { return b.date.localeCompare(a.date); });

  var today = new Date().toISOString().slice(0, 10);
  var curElev = DewateringState.sumpCurrentElevation(sumpId);

  formEl.innerHTML =
    '<div class="card" style="padding:14px;margin-top:8px;border:1px solid rgba(34,211,238,.3)">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
      '<div style="font-size:12px;font-weight:600;color:var(--gold)">История отметок дна: ' + escHTML(sump.name) + '</div>' +
      '<button class="btn btn-sm btn-outline" style="font-size:10px" id="dew-elv-close">✕ Закрыть</button>' +
    '</div>' +
    '<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:10px;flex-wrap:wrap">' +
    _dewFld('Дата изменения', 'date', 'dew-elv-date', today, '') +
    _dewFld('Отметка дна (м абс.)', 'number', 'dew-elv-val', curElev != null ? curElev.toFixed(1) : '', '-120.0') +
    _dewFld('Примечание', 'text', 'dew-elv-notes', '', 'Углубление на 2 м') +
    '<div style="padding-bottom:4px"><button class="btn btn-sm" style="background:var(--gold);color:#000;white-space:nowrap" id="dew-elv-add">+ Добавить</button></div>' +
    '</div>' +
    (hist.length
      ? '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<thead><tr style="color:var(--txt-3);font-size:10px;text-transform:uppercase;border-bottom:1px solid var(--line)">' +
          '<th style="padding:4px 8px;text-align:left;font-weight:500">Дата</th>' +
          '<th style="padding:4px 8px;text-align:right;font-weight:500">Отм. дна, м абс.</th>' +
          '<th style="padding:4px 8px;font-weight:500">Примечание</th>' +
          '<th></th>' +
        '</tr></thead><tbody>' +
        hist.map(function(h, idx) {
          return '<tr style="border-bottom:1px solid var(--line-2)">' +
            '<td style="padding:5px 8px;color:var(--txt-1)">' + h.date + (idx === 0 ? ' <span style="font-size:9px;color:var(--gold)">актуальная</span>' : '') + '</td>' +
            '<td style="padding:5px 8px;text-align:right;font-weight:600;color:var(--txt-1)">' + parseFloat(h.elevation).toFixed(1) + '</td>' +
            '<td style="padding:5px 8px;color:var(--txt-3)">' + escHTML(h.notes || '') + '</td>' +
            '<td style="padding:5px 8px;text-align:right"><button class="btn btn-sm" style="font-size:10px;padding:2px 6px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dewDelElev(\'' + h.id + '\',\'' + sumpId + '\')">✕</button></td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>'
      : '<p style="color:var(--txt-3);font-size:12px;text-align:center;padding:12px">Нет записей — добавьте первую отметку дна зумпфа</p>') +
    '</div>';

  document.getElementById('dew-elv-close').onclick = function() { formEl.innerHTML = ''; };
  document.getElementById('dew-elv-add').onclick = function() {
    var elv = document.getElementById('dew-elv-val').value.trim();
    var dt  = document.getElementById('dew-elv-date').value;
    if (!elv || !dt) { Toast.show('Укажите дату и отметку', 'warning'); return; }
    DewateringState.addElevation({ sumpId: sumpId, date: dt, elevation: parseFloat(elv), notes: document.getElementById('dew-elv-notes').value.trim() || '' });
    _dewOpenElevationHistory(sumpId);
    _dewRenderSumpsList();
    Toast.show('Отметка добавлена', 'success');
  };
}

function _dewDelElev(id, sumpId) {
  DewateringState.deleteElevation(id);
  _dewOpenElevationHistory(sumpId);
  _dewRenderSumpsList();
}

function _dewDeleteSump(id) {
  var s = DewateringState.sumpById(id);
  if (!s || !confirm('Удалить зумпф "' + s.name + '" и все его данные?')) return;
  DewateringState.deleteSump(id);
  _dewRenderSumpsList(); _dewRenderPumpsList();
  var f = document.getElementById('dew-sump-form'); if(f) f.innerHTML='';
  Toast.show('Зумпф удалён', 'info');
}

function _dewRenderPumpsList() {
  var el = document.getElementById('dew-pumps-list');
  if (!el) return;
  if (!DewateringState.pumps.length) { el.innerHTML = '<p style="color:var(--txt-3);font-size:12px;padding:8px 0">Нет насосов</p>'; return; }
  el.innerHTML = DewateringState.pumps.map(function(p) {
    var sump = DewateringState.sumpById(p.sumpId);
    var st   = DEW_PUMP_STATUS[p.status] || DEW_PUMP_STATUS.off;
    var vol  = DewateringState.totalVolumePump(p.id).toFixed(0);
    var evts = DewateringState.pumpEvents.filter(function(e) { return e.installedPumpId === p.id || e.removedPumpId === p.id; }).length;
    return '<div class="card" style="padding:12px 14px;margin-bottom:8px">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
        '<div style="flex:1">' +
          '<span style="font-weight:600;color:var(--txt-1);font-size:13px">' + escHTML(p.name) + '</span>' +
          (p.inventoryNumber ? ' <span style="font-size:10px;color:var(--txt-3)">Инв. ' + escHTML(p.inventoryNumber) + '</span>' : '') +
        '</div>' +
        '<span class="anl-pill anl-pill-' + st.cls + '">' + st.label + '</span>' +
        '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 7px" onclick="_dewOpenPumpForm(\'' + p.id + '\')">✎</button>' +
        '<button class="btn btn-sm" style="font-size:10px;padding:2px 7px;background:rgba(248,113,113,.12);color:var(--bad);border:1px solid rgba(248,113,113,.25)" onclick="_dewDeletePump(\'' + p.id + '\')">✕</button>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--txt-3);display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
        (p.model ? '<span style="color:var(--txt-2)">' + escHTML(p.model) + '</span>' : '') +
        '<span>Q: <b style="color:var(--txt-2)">' + (p.capacity || '—') + ' м³/ч</b></span>' +
        (p.type ? '<span>' + (DEW_PUMP_TYPE[p.type] || '') + '</span>' : '') +
        (sump ? '<span>↳ ' + escHTML(sump.name) + '</span>' : '') +
        (p.installDate ? '<span>с ' + p.installDate + '</span>' : '') +
        '<span style="color:var(--ok)">∑ ' + vol + ' м³</span>' +
      '</div>' +
      '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 8px" onclick="_dewOpenPumpEvents(\'' + p.id + '\')">' +
        '🔧 События насоса (' + evts + ')' +
      '</button>' +
    '</div>';
  }).join('');
}

function _dewOpenPumpForm(id) {
  var p = id ? DewateringState.pumpById(id) : null;
  var formEl = document.getElementById('dew-pump-form');
  if (!formEl) return;

  var statusOpts = Object.keys(DEW_PUMP_STATUS).map(function(k) {
    return '<option value="' + k + '"' + (p && p.status === k ? ' selected' : '') + '>' + DEW_PUMP_STATUS[k].label + '</option>';
  }).join('');
  var typeOpts = Object.keys(DEW_PUMP_TYPE).map(function(k) {
    return '<option value="' + k + '"' + (p && p.type === k ? ' selected' : '') + '>' + DEW_PUMP_TYPE[k] + '</option>';
  }).join('');
  var sumpOpts = DewateringState.sumps.map(function(s) {
    return '<option value="' + s.id + '"' + (p && p.sumpId === s.id ? ' selected' : '') + '>' + escHTML(s.name) + '</option>';
  }).join('');

  formEl.innerHTML =
    '<div class="card" style="padding:14px;margin-top:8px;border:1px solid rgba(34,211,238,.3)">' +
    '<div style="font-size:12px;font-weight:600;color:var(--gold);margin-bottom:10px">' + (id ? 'Редактировать насос' : 'Новый насос') + '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
    _dewFld('Название / №', 'text', 'dew-pf-name', p ? p.name : '', 'НС-01') +
    _dewFld('Марка / модель', 'text', 'dew-pf-model', p ? p.model || '' : '', 'НЦС-100') +
    _dewFld('Серийный №', 'text', 'dew-pf-serial', p ? p.serialNumber || '' : '', '') +
    _dewFld('Инв. №', 'text', 'dew-pf-inv', p ? p.inventoryNumber || '' : '', '') +
    _dewFld('Карьер / участок', 'text', 'dew-pf-quarry', p ? p.quarry || '' : '', 'ЮРГ') +
    _dewFld('Произв. (м³/ч)', 'number', 'dew-pf-cap', p ? p.capacity || '' : '', '100') +
    _dewFld('Напор (м)', 'number', 'dew-pf-head', p ? p.head || '' : '', '60') +
    _dewFld('Дата установки', 'date', 'dew-pf-date', p ? p.installDate || '' : '', '') +
    '<div class="form-group"><label class="form-label">Зумпф</label><select id="dew-pf-sump" class="form-control">' + sumpOpts + '</select></div>' +
    '<div class="form-group"><label class="form-label">Тип</label><select id="dew-pf-type" class="form-control">' + typeOpts + '</select></div>' +
    '<div class="form-group"><label class="form-label">Статус</label><select id="dew-pf-status" class="form-control">' + statusOpts + '</select></div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:10px">' +
    '<button class="btn btn-sm" style="background:var(--gold);color:#000" id="dew-pf-save">Сохранить</button>' +
    '<button class="btn btn-sm btn-outline" id="dew-pf-cancel">Отмена</button>' +
    '</div></div>';

  document.getElementById('dew-pf-cancel').onclick = function() { formEl.innerHTML = ''; };
  document.getElementById('dew-pf-save').onclick = function() {
    var name = document.getElementById('dew-pf-name').value.trim();
    var sumpId = document.getElementById('dew-pf-sump').value;
    if (!name)   { Toast.show('Введите название насоса', 'warning'); return; }
    if (!sumpId) { Toast.show('Выберите зумпф', 'warning'); return; }
    var data = {
      name: name, model: document.getElementById('dew-pf-model').value.trim() || '',
      serialNumber: document.getElementById('dew-pf-serial').value.trim() || '',
      inventoryNumber: document.getElementById('dew-pf-inv').value.trim() || '',
      quarry: document.getElementById('dew-pf-quarry').value.trim() || '',
      capacity: parseFloat(document.getElementById('dew-pf-cap').value) || null,
      head: parseFloat(document.getElementById('dew-pf-head').value) || null,
      installDate: document.getElementById('dew-pf-date').value || '',
      sumpId: sumpId, type: document.getElementById('dew-pf-type').value,
      status: document.getElementById('dew-pf-status').value,
    };
    if (id) DewateringState.updatePump(id, data);
    else    DewateringState.addPump(data);
    formEl.innerHTML = '';
    _dewRenderPumpsList();
    Toast.show(id ? 'Насос обновлён' : 'Насос добавлен', 'success');
  };
}

function _dewOpenPumpEvents(pumpId) {
  var pump = DewateringState.pumpById(pumpId);
  if (!pump) return;
  var panel = document.getElementById('dew-pump-events-panel');
  if (!panel) return;

  var events = DewateringState.pumpEvents
    .filter(function(e) { return e.installedPumpId === pumpId || e.removedPumpId === pumpId; })
    .sort(function(a, b) { return b.date.localeCompare(a.date); });

  var today = new Date().toISOString().slice(0, 10);
  var evtOpts = Object.keys(DEW_EVENT_TYPE).map(function(k) {
    return '<option value="' + k + '">' + DEW_EVENT_TYPE[k] + '</option>';
  }).join('');

  panel.innerHTML =
    '<div class="card" style="padding:14px;margin-top:8px;border:1px solid var(--line)">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
      '<div style="font-size:12px;font-weight:600;color:var(--txt-1)">🔧 События: ' + escHTML(pump.name) + '</div>' +
      '<button class="btn btn-sm btn-outline" style="font-size:10px" onclick="document.getElementById(\'dew-pump-events-panel\').innerHTML=\'\'">✕</button>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;margin-bottom:10px">' +
    _dewFld('Дата', 'date', 'dew-evt-date', today, '') +
    '<div class="form-group"><label class="form-label">Тип события</label><select id="dew-evt-type" class="form-control">' + evtOpts + '</select></div>' +
    _dewFld('Причина', 'text', 'dew-evt-reason', '', 'износ, авария...') +
    _dewFld('Выполнил', 'text', 'dew-evt-by', '', '') +
    _dewFld('Примечание', 'text', 'dew-evt-notes', '', '') +
    '<div style="padding-bottom:4px"><button class="btn btn-sm" style="background:var(--gold);color:#000;white-space:nowrap" id="dew-evt-add">+ Добавить</button></div>' +
    '</div>' +
    (events.length
      ? '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
        '<thead><tr style="color:var(--txt-3);font-size:10px;text-transform:uppercase;border-bottom:1px solid var(--line)">' +
          '<th style="padding:4px 6px;font-weight:500">Дата</th><th style="padding:4px 6px;font-weight:500">Событие</th>' +
          '<th style="padding:4px 6px;font-weight:500">Причина</th><th style="padding:4px 6px;font-weight:500">Кто</th><th></th>' +
        '</tr></thead><tbody>' +
        events.map(function(e) {
          return '<tr style="border-bottom:1px solid var(--line-2)">' +
            '<td style="padding:5px 6px;color:var(--txt-1)">' + e.date + '</td>' +
            '<td style="padding:5px 6px;color:var(--txt-2)">' + (DEW_EVENT_TYPE[e.type] || e.type) + '</td>' +
            '<td style="padding:5px 6px;color:var(--txt-3)">' + escHTML(e.reason || '') + '</td>' +
            '<td style="padding:5px 6px;color:var(--txt-3)">' + escHTML(e.performedBy || '') + '</td>' +
            '<td style="padding:5px 6px"><button class="btn btn-sm" style="font-size:10px;padding:1px 5px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dewDelPumpEvent(\'' + e.id + '\',\'' + pumpId + '\')">✕</button></td>' +
          '</tr>';
        }).join('') + '</tbody></table>'
      : '<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:8px">Нет событий</p>') +
    '</div>';

  document.getElementById('dew-evt-add').onclick = function() {
    var dt = document.getElementById('dew-evt-date').value;
    if (!dt) { Toast.show('Укажите дату', 'warning'); return; }
    DewateringState.addPumpEvent({
      sumpId: pump.sumpId, date: dt,
      type: document.getElementById('dew-evt-type').value,
      installedPumpId: pumpId, removedPumpId: null,
      reason: document.getElementById('dew-evt-reason').value.trim() || '',
      performedBy: document.getElementById('dew-evt-by').value.trim() || '',
      notes: document.getElementById('dew-evt-notes').value.trim() || '',
    });
    _dewOpenPumpEvents(pumpId);
    _dewRenderPumpsList();
    Toast.show('Событие добавлено', 'success');
  };
}

function _dewDelPumpEvent(id, pumpId) {
  DewateringState.deletePumpEvent(id);
  _dewOpenPumpEvents(pumpId);
  _dewRenderPumpsList();
}

function _dewDeletePump(id) {
  var p = DewateringState.pumpById(id);
  if (!p || !confirm('Удалить насос "' + p.name + '" и все его показания?')) return;
  DewateringState.deletePump(id);
  _dewRenderPumpsList();
  var ep = document.getElementById('dew-pump-events-panel'); if(ep) ep.innerHTML = '';
  Toast.show('Насос удалён', 'info');
}

function _dewRenderDestList() {
  var el = document.getElementById('dew-dest-list');
  if (!el) return;
  if (!DewateringState.destinations.length) { el.innerHTML = '<p style="color:var(--txt-3);font-size:12px">Нет направлений</p>'; return; }
  el.innerHTML = '<div style="display:flex;flex-direction:column;gap:5px">' +
    DewateringState.destinations.map(function(d) {
      var tp = DEW_DEST_TYPE[d.type] || {};
      var targetSump = d.targetSumpId ? DewateringState.sumpById(d.targetSumpId) : null;
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-3);border-radius:var(--r-sm);font-size:12px">' +
        '<span>' + (tp.icon || '•') + '</span>' +
        '<span style="flex:1;color:var(--txt-1)">' + escHTML(d.name) + '</span>' +
        '<span style="color:var(--txt-3);font-size:10px">' + (tp.label || '') + (targetSump ? ' → ' + escHTML(targetSump.name) : '') + '</span>' +
        '<button class="btn btn-sm" style="font-size:10px;padding:2px 6px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dewDeleteDest(\'' + d.id + '\')">✕</button>' +
      '</div>';
    }).join('') + '</div>';
}

function _dewOpenDestForm() {
  var formEl = document.getElementById('dew-dest-form');
  if (!formEl) return;
  var typeOpts = Object.keys(DEW_DEST_TYPE).map(function(k) {
    return '<option value="' + k + '">' + DEW_DEST_TYPE[k].label + '</option>';
  }).join('');
  var sumpOpts = '<option value="">— не указан —</option>' + DewateringState.sumps.map(function(s) {
    return '<option value="' + s.id + '">' + escHTML(s.name) + '</option>';
  }).join('');

  formEl.innerHTML =
    '<div class="card" style="padding:12px;margin-top:8px;border:1px solid var(--line)">' +
    '<div style="display:grid;grid-template-columns:1fr 1fr auto auto;gap:8px;align-items:flex-end">' +
    _dewFld('Название', 'text', 'dew-df-name', '', 'Отстойник №2') +
    '<div class="form-group"><label class="form-label">Тип</label><select id="dew-df-type" class="form-control" onchange="_dewDestTypeChanged()">' + typeOpts + '</select></div>' +
    '<div class="form-group" id="dew-df-sump-wrap" style="display:none"><label class="form-label">Целевой зумпф</label><select id="dew-df-sump" class="form-control">' + sumpOpts + '</select></div>' +
    '<div style="padding-bottom:4px;display:flex;gap:6px">' +
    '<button class="btn btn-sm" style="background:var(--gold);color:#000" id="dew-df-save">Добавить</button>' +
    '<button class="btn btn-sm btn-outline" id="dew-df-cancel">✕</button>' +
    '</div></div></div>';

  document.getElementById('dew-df-cancel').onclick = function() { formEl.innerHTML = ''; };
  document.getElementById('dew-df-save').onclick = function() {
    var name = document.getElementById('dew-df-name').value.trim();
    if (!name) { Toast.show('Введите название', 'warning'); return; }
    var type = document.getElementById('dew-df-type').value;
    var targetSumpId = type === 'intermediate_sump' ? (document.getElementById('dew-df-sump').value || null) : null;
    DewateringState.addDest({ name: name, type: type, targetSumpId: targetSumpId });
    formEl.innerHTML = '';
    _dewRenderDestList();
    Toast.show('Направление добавлено', 'success');
  };
}

function _dewDestTypeChanged() {
  var type = document.getElementById('dew-df-type') ? document.getElementById('dew-df-type').value : '';
  var wrap = document.getElementById('dew-df-sump-wrap');
  if (wrap) wrap.style.display = type === 'intermediate_sump' ? 'block' : 'none';
}

function _dewDeleteDest(id) { DewateringState.deleteDest(id); _dewRenderDestList(); }

// ── Журнал расходомеров ───────────────────────────────────────

function _dewRenderJournal() {
  var el = document.getElementById('dew-panel-journal');
  if (!el) return;

  var today = new Date().toISOString().slice(0, 10);
  if (!_dewJFilter.date) _dewJFilter.date = today;

  var sumpOpts = '<option value="">Все зумпфы</option>' +
    DewateringState.sumps.map(function(s) {
      return '<option value="' + s.id + '"' + (_dewJFilter.sumpId === s.id ? ' selected' : '') + '>' + escHTML(s.name) + '</option>';
    }).join('');

  el.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start">' +
      // LEFT: quick daily entry
      '<div>' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px">Ввод показаний (6:00)</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
          '<input type="date" id="dew-jr-date" class="form-control" value="' + _dewJFilter.date + '" style="width:150px;font-size:12px">' +
          '<button class="btn btn-sm" style="background:var(--gold);color:#000;font-size:11px" id="dew-jr-save-all">💾 Сохранить всё</button>' +
        '</div>' +
        '<div id="dew-jr-quick"></div>' +
      '</div>' +
      // RIGHT: history table
      '<div>' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px">История показаний</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
          '<select id="dew-jf-sump" class="form-control" style="width:160px;font-size:12px">' + sumpOpts + '</select>' +
          '<div style="font-size:11px;color:var(--txt-3);align-self:center" id="dew-jr-summary"></div>' +
        '</div>' +
        '<div id="dew-jr-table"></div>' +
      '</div>' +
    '</div>';

  _dewRenderQuickEntry(_dewJFilter.date);
  _dewRenderReadingsTable();

  document.getElementById('dew-jr-date').addEventListener('change', function() {
    _dewJFilter.date = this.value;
    _dewRenderQuickEntry(this.value);
  });
  document.getElementById('dew-jf-sump').addEventListener('change', function() {
    _dewJFilter.sumpId = this.value;
    _dewRenderReadingsTable();
  });
  document.getElementById('dew-jr-save-all').addEventListener('click', _dewSaveQuickEntry);
}

function _dewRenderQuickEntry(date) {
  var el = document.getElementById('dew-jr-quick');
  if (!el) return;

  if (!DewateringState.pumps.length) {
    el.innerHTML = '<div class="card" style="padding:16px;text-align:center;color:var(--txt-3);font-size:12px">Насосы не добавлены</div>';
    return;
  }

  var html = '';
  DewateringState.sumps.forEach(function(sump) {
    var pumps = DewateringState.pumpsOfSump(sump.id).filter(function(p) { return p.status === 'working' || p.status === 'standby'; });
    if (!pumps.length) return;
    html += '<div class="card" style="padding:12px 14px;margin-bottom:8px">' +
      '<div style="font-size:11px;font-weight:600;color:var(--txt-1);margin-bottom:10px">' + escHTML(sump.name) + '</div>';

    pumps.forEach(function(p) {
      var existing = DewateringState.readingForDate(p.id, date);
      var prevRec  = DewateringState.prevReading(p.id, date);
      var prevVal  = prevRec && !prevRec.isStopped && !prevRec.isReset ? prevRec.reading : null;
      var prevDate = prevRec ? prevRec.date : null;
      var isStopped = existing ? existing.isStopped : false;
      var destOpts = '<option value="">— направление —</option>' +
        DewateringState.destinations.map(function(d) {
          return '<option value="' + d.id + '"' + (existing && existing.destinationId === d.id ? ' selected' : '') + '>' + escHTML(d.name) + '</option>';
        }).join('');

      html +=
        '<div style="padding:8px 0;border-top:1px solid var(--line-2)" data-pump-id="' + p.id + '">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
          '<span style="font-size:12px;color:var(--txt-1);font-weight:500">' + escHTML(p.name) + '</span>' +
          '<span class="anl-pill anl-pill-' + (DEW_PUMP_STATUS[p.status] || DEW_PUMP_STATUS.off).cls + '" style="font-size:9px">' + (DEW_PUMP_STATUS[p.status] || DEW_PUMP_STATUS.off).label + '</span>' +
          (existing ? '<span style="font-size:10px;color:var(--ok)">✓ введено</span>' : '') +
        '</div>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--txt-3);margin-bottom:6px;cursor:pointer">' +
          '<input type="checkbox" id="dew-qe-stopped-' + p.id + '"' + (isStopped ? ' checked' : '') + ' onchange="_dewQeToggleStopped(\'' + p.id + '\')">' +
          ' Насос не работал (простой)' +
        '</label>' +
        '<div id="dew-qe-fields-' + p.id + '" style="' + (isStopped ? 'display:none' : '') + '">' +
          '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">' +
            '<div>' +
              '<div style="font-size:9px;color:var(--txt-3);margin-bottom:2px">Пред. показание ' + (prevDate ? '(' + prevDate + ')' : '(нет данных)') + '</div>' +
              '<div style="font-size:13px;font-weight:600;color:var(--txt-2);min-width:80px">' + (prevVal != null ? parseFloat(prevVal).toFixed(0) + ' м³' : '—') + '</div>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:9px;color:var(--txt-3);margin-bottom:2px">Показание на 6:00 ' + (date || '') + '</div>' +
              '<input type="number" id="dew-qe-val-' + p.id + '" class="form-control" value="' + (existing && !existing.isStopped ? existing.reading || '' : '') + '" placeholder="м³ накоп." style="width:110px;font-size:13px" oninput="_dewQeCalcVol(\'' + p.id + '\',' + (prevVal != null ? prevVal : 'null') + ')">' +
            '</div>' +
            '<div>' +
              '<div style="font-size:9px;color:var(--txt-3);margin-bottom:2px">Объём за сутки</div>' +
              '<div id="dew-qe-vol-' + p.id + '" style="font-size:13px;font-weight:600;min-width:70px;color:var(--ok)">' +
                _dewCalcVolDisplay(existing, prevVal) +
              '</div>' +
            '</div>' +
            '<div class="form-group" style="margin:0">' +
              '<div style="font-size:9px;color:var(--txt-3);margin-bottom:2px">Направление</div>' +
              '<select id="dew-qe-dest-' + p.id + '" class="form-control" style="font-size:11px">' + destOpts + '</select>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:9px;color:var(--txt-3);margin-bottom:2px">Часов работы</div>' +
              '<input type="number" id="dew-qe-hrs-' + p.id + '" class="form-control" value="' + (existing ? existing.hoursWorked || '' : '') + '" placeholder="ч" style="width:60px;font-size:12px" min="0" max="24">' +
            '</div>' +
          '</div>' +
          '<div style="margin-top:6px">' +
            '<label style="font-size:9px;color:var(--txt-3)">Примечание</label>' +
            '<input type="text" id="dew-qe-notes-' + p.id + '" class="form-control" value="' + escAttr(existing ? existing.notes || '' : '') + '" placeholder="необязательно" style="font-size:11px">' +
          '</div>' +
        '</div>' +
        '<div id="dew-qe-stopped-reason-' + p.id + '" style="' + (!isStopped ? 'display:none' : '') + ';margin-top:4px">' +
          _dewFld('Причина простоя', 'text', 'dew-qe-dreason-' + p.id, existing ? existing.downtimeReason || '' : '', 'нет воды, авария, ремонт...') +
        '</div>' +
        '</div>';
    });
    html += '</div>';
  });

  el.innerHTML = html || '<div class="card" style="padding:16px;text-align:center;color:var(--txt-3);font-size:12px">Нет активных насосов</div>';
}

function _dewCalcVolDisplay(existing, prevVal) {
  if (!existing) return '<span style="color:var(--txt-3)">—</span>';
  if (existing.isStopped) return '<span style="color:var(--txt-3)">простой</span>';
  if (existing.isManualVolume) return (parseFloat(existing.manualVolume) || 0).toFixed(0) + ' м³';
  if (prevVal == null) return '<span style="color:var(--txt-3)">нет пред.</span>';
  var diff = parseFloat(existing.reading) - parseFloat(prevVal);
  return diff >= 0 ? diff.toFixed(0) + ' м³' : '<span style="color:var(--bad)">ошибка</span>';
}

function _dewQeCalcVol(pumpId, prevVal) {
  var inp = document.getElementById('dew-qe-val-' + pumpId);
  var volEl = document.getElementById('dew-qe-vol-' + pumpId);
  if (!inp || !volEl) return;
  var cur = parseFloat(inp.value);
  if (isNaN(cur) || prevVal == null) { volEl.innerHTML = '<span style="color:var(--txt-3)">—</span>'; return; }
  var diff = cur - parseFloat(prevVal);
  volEl.innerHTML = diff >= 0
    ? diff.toFixed(0) + ' м³'
    : '<span style="color:var(--bad)">⚠ ' + diff.toFixed(0) + '</span>';
}

function _dewQeToggleStopped(pumpId) {
  var chk     = document.getElementById('dew-qe-stopped-' + pumpId);
  var fields  = document.getElementById('dew-qe-fields-' + pumpId);
  var reason  = document.getElementById('dew-qe-stopped-reason-' + pumpId);
  if (fields)  fields.style.display  = chk.checked ? 'none' : '';
  if (reason)  reason.style.display  = chk.checked ? '' : 'none';
}

function _dewSaveQuickEntry() {
  var date = document.getElementById('dew-jr-date') ? document.getElementById('dew-jr-date').value : _dewJFilter.date;
  if (!date) { Toast.show('Укажите дату', 'warning'); return; }

  var saved = 0;
  DewateringState.pumps.filter(function(p) { return p.status === 'working' || p.status === 'standby'; }).forEach(function(p) {
    var stoppedChk = document.getElementById('dew-qe-stopped-' + p.id);
    if (!stoppedChk) return;

    var isStopped = stoppedChk.checked;
    var existing  = DewateringState.readingForDate(p.id, date);

    var data = {
      pumpId: p.id,
      date:   date,
      isStopped: isStopped,
      downtimeReason: isStopped ? ((document.getElementById('dew-qe-dreason-' + p.id) || {}).value || '').trim() : '',
      isReset: false,
      isManualVolume: false,
    };

    if (!isStopped) {
      var valEl = document.getElementById('dew-qe-val-' + p.id);
      if (!valEl || valEl.value.trim() === '') return;
      data.reading      = parseFloat(valEl.value);
      data.hoursWorked  = parseFloat((document.getElementById('dew-qe-hrs-' + p.id) || {}).value) || null;
      data.destinationId = (document.getElementById('dew-qe-dest-' + p.id) || {}).value || null;
      data.notes        = ((document.getElementById('dew-qe-notes-' + p.id) || {}).value || '').trim();
    }

    if (existing) DewateringState.updateReading(existing.id, data);
    else          DewateringState.addReading(data);
    saved++;
  });

  if (saved > 0) {
    Toast.show('Сохранено: ' + saved + ' записей', 'success');
    _dewRenderReadingsTable();
    _dewRenderQuickEntry(date);
  } else {
    Toast.show('Нечего сохранять — введите показания', 'warning');
  }
}

function _dewRenderReadingsTable() {
  var el    = document.getElementById('dew-jr-table');
  var sumEl = document.getElementById('dew-jr-summary');
  if (!el) return;

  var sumpId = _dewJFilter.sumpId;
  var pumpsFilter = sumpId
    ? DewateringState.pumpsOfSump(sumpId).map(function(p) { return p.id; })
    : DewateringState.pumps.map(function(p) { return p.id; });

  var records = DewateringState.meterReadings
    .filter(function(r) { return pumpsFilter.indexOf(r.pumpId) >= 0; })
    .sort(function(a, b) { return b.date.localeCompare(a.date) || (b.pumpId || '').localeCompare(a.pumpId || ''); });

  var totalVol = records.reduce(function(a, r) { return a + (DewateringState.computedVolume(r) || 0); }, 0);
  if (sumEl) sumEl.innerHTML = records.length + ' записей · <b style="color:var(--txt-1)">' + totalVol.toFixed(0) + ' м³</b> итого';

  if (!records.length) {
    el.innerHTML = '<div class="card" style="padding:20px;text-align:center;color:var(--txt-3);font-size:12px">' +
      (DewateringState.meterReadings.length ? 'Нет данных по выбранному зумпфу' : 'Журнал пуст — введите первые показания слева') + '</div>';
    return;
  }

  el.innerHTML = '<div style="overflow-x:auto;max-height:420px;overflow-y:auto">' +
    '<table style="width:100%;border-collapse:collapse;font-size:11px;min-width:480px">' +
    '<thead style="position:sticky;top:0;background:var(--bg-2);z-index:1"><tr style="color:var(--txt-3);border-bottom:1px solid var(--line);font-size:10px;text-transform:uppercase">' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Дата</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Насос</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Показание м³</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Объём м³</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Часов</th>' +
      '<th style="padding:6px 8px;font-weight:500">Направление</th>' +
      '<th style="padding:6px 8px;font-weight:500"></th>' +
    '</tr></thead><tbody>' +
    records.map(function(r) {
      var pump = DewateringState.pumpById(r.pumpId);
      var sump = pump ? DewateringState.sumpById(pump.sumpId) : null;
      var dest = r.destinationId ? DewateringState.destById(r.destinationId) : null;
      var vol  = DewateringState.computedVolume(r);
      var volStr = r.isStopped ? '<span style="color:var(--txt-3)">простой</span>'
                : vol == null  ? '<span style="color:var(--txt-3)">нет пред.</span>'
                : '<span style="color:var(--ok);font-weight:600">' + vol.toFixed(0) + '</span>';
      return '<tr style="border-bottom:1px solid var(--line-2)">' +
        '<td style="padding:5px 8px;color:var(--txt-1);white-space:nowrap">' + r.date + '</td>' +
        '<td style="padding:5px 8px">' +
          '<div style="color:var(--txt-1)">' + (pump ? escHTML(pump.name) : '—') + '</div>' +
          (sump ? '<div style="color:var(--txt-3);font-size:9px">' + escHTML(sump.name) + '</div>' : '') +
        '</td>' +
        '<td style="padding:5px 8px;text-align:right;color:var(--txt-2)">' + (r.isStopped ? '—' : (r.reading != null ? parseFloat(r.reading).toFixed(0) : '—')) + '</td>' +
        '<td style="padding:5px 8px;text-align:right">' + volStr + '</td>' +
        '<td style="padding:5px 8px;text-align:right;color:var(--txt-3)">' + (r.hoursWorked != null ? parseFloat(r.hoursWorked).toFixed(1) : '—') + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-3)">' + (dest ? escHTML(dest.name) : '—') + '</td>' +
        '<td style="padding:5px 8px;text-align:right">' +
          '<button class="btn btn-sm" style="font-size:10px;padding:2px 5px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dewDeleteReading(\'' + r.id + '\')">✕</button>' +
        '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';
}

function _dewDeleteReading(id) {
  if (!confirm('Удалить запись показания?')) return;
  DewateringState.deleteReading(id);
  _dewRenderReadingsTable();
  _dewRenderQuickEntry(_dewJFilter.date);
}

// ── Уровни воды ──────────────────────────────────────────────

function _dewRenderLevels() {
  var el = document.getElementById('dew-panel-levels');
  if (!el) return;

  var today = new Date().toISOString().slice(0, 10);
  var sumpOpts = '<option value="">— выберите зумпф —</option>' +
    DewateringState.sumps.map(function(s) {
      return '<option value="' + s.id + '"' + (_dewLFilter.sumpId === s.id ? ' selected' : '') + '>' + escHTML(s.name) + '</option>';
    }).join('');

  el.innerHTML =
    '<div style="display:grid;grid-template-columns:300px 1fr;gap:14px;align-items:start">' +
      // LEFT: add form
      '<div>' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px">Новый замер уровня</div>' +
        '<div class="card" style="padding:14px">' +
        '<div class="form-group"><label class="form-label">Зумпф</label>' +
        '<select id="dew-lv-sump" class="form-control">' + sumpOpts + '</select></div>' +
        _dewFld('Дата', 'date', 'dew-lv-date', today, '') +
        _dewFld('Время', 'time', 'dew-lv-time', '06:00', '') +
        _dewFld('Отметка зеркала воды (м абс.)', 'number', 'dew-lv-elev', '', '-118.5') +
        _dewFld('Кто замерил', 'text', 'dew-lv-by', '', '') +
        _dewFld('Примечание', 'text', 'dew-lv-notes', '', '') +
        '<div id="dew-lv-depth-hint" style="font-size:11px;color:var(--txt-3);margin-bottom:8px"></div>' +
        '<button class="btn btn-sm" style="background:var(--gold);color:#000" id="dew-lv-save">Сохранить замер</button>' +
        '</div>' +
      '</div>' +
      // RIGHT: history per sump
      '<div>' +
        '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);margin-bottom:8px">История замеров</div>' +
        '<div class="form-group" style="margin-bottom:10px"><select id="dew-lv-filter-sump" class="form-control" style="font-size:12px;width:200px">' + sumpOpts + '</select></div>' +
        '<div id="dew-lv-table"></div>' +
        '<div id="dew-lv-chart" style="margin-top:12px"></div>' +
      '</div>' +
    '</div>';

  _dewRenderLevelsTable(_dewLFilter.sumpId);

  document.getElementById('dew-lv-sump').addEventListener('change', function() { _dewLvUpdateDepthHint(); });
  document.getElementById('dew-lv-elev').addEventListener('input', function() { _dewLvUpdateDepthHint(); });
  document.getElementById('dew-lv-filter-sump').addEventListener('change', function() {
    _dewLFilter.sumpId = this.value;
    _dewRenderLevelsTable(this.value);
  });
  document.getElementById('dew-lv-save').addEventListener('click', function() {
    var sumpId = document.getElementById('dew-lv-sump').value;
    var elev   = document.getElementById('dew-lv-elev').value.trim();
    var date   = document.getElementById('dew-lv-date').value;
    if (!sumpId) { Toast.show('Выберите зумпф', 'warning'); return; }
    if (!elev)   { Toast.show('Введите отметку зеркала воды', 'warning'); return; }
    if (!date)   { Toast.show('Укажите дату', 'warning'); return; }
    DewateringState.addWaterLevel({
      sumpId: sumpId, date: date,
      time:   document.getElementById('dew-lv-time').value || '06:00',
      elevation: parseFloat(elev),
      measuredBy: document.getElementById('dew-lv-by').value.trim()    || '',
      notes:      document.getElementById('dew-lv-notes').value.trim() || '',
    });
    _dewRenderLevelsTable(_dewLFilter.sumpId);
    Toast.show('Замер сохранён', 'success');
    document.getElementById('dew-lv-elev').value = '';
  });
}

function _dewLvUpdateDepthHint() {
  var hint   = document.getElementById('dew-lv-depth-hint');
  var sumpId = (document.getElementById('dew-lv-sump') || {}).value;
  var elevIn = (document.getElementById('dew-lv-elev') || {}).value;
  if (!hint || !sumpId || !elevIn) { if (hint) hint.innerHTML = ''; return; }
  var bottomElev = DewateringState.sumpCurrentElevation(sumpId);
  if (bottomElev == null) { hint.innerHTML = '<span style="color:var(--warn)">Отметка дна зумпфа не задана</span>'; return; }
  var depth = parseFloat(elevIn) - bottomElev;
  hint.innerHTML = 'Глубина воды в зумпфе: <b style="color:' + (depth > 1.5 ? 'var(--warn)' : 'var(--ok)') + '">' + depth.toFixed(2) + ' м</b> (дно: ' + bottomElev.toFixed(1) + ' м абс.)';
}

function _dewRenderLevelsTable(sumpId) {
  var el = document.getElementById('dew-lv-table');
  if (!el) return;

  var records = DewateringState.waterLevels
    .filter(function(w) { return !sumpId || w.sumpId === sumpId; })
    .sort(function(a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });

  if (!records.length) {
    el.innerHTML = '<div class="card" style="padding:16px;text-align:center;color:var(--txt-3);font-size:12px">' +
      (DewateringState.waterLevels.length ? 'Нет замеров по выбранному зумпфу' : 'Замеры не добавлены — заполните форму слева') + '</div>';
    _dewRenderLevelsChart([], sumpId);
    return;
  }

  el.innerHTML = '<div style="overflow-x:auto;max-height:320px;overflow-y:auto">' +
    '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
    '<thead style="position:sticky;top:0;background:var(--bg-2)"><tr style="color:var(--txt-3);font-size:10px;text-transform:uppercase;border-bottom:1px solid var(--line)">' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Дата</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Время</th>' +
      '<th style="padding:6px 8px;font-weight:500">Зумпф</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Отм. зеркала, м абс.</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Глубина воды, м</th>' +
      '<th style="padding:6px 8px;font-weight:500">Кто замерил</th>' +
      '<th></th>' +
    '</tr></thead><tbody>' +
    records.map(function(w) {
      var sump      = DewateringState.sumpById(w.sumpId);
      var botElev   = DewateringState.sumpCurrentElevation(w.sumpId);
      var depth     = botElev != null ? (parseFloat(w.elevation) - botElev) : null;
      var depthStr  = depth != null
        ? '<span style="color:' + (depth > 1.5 ? 'var(--warn)' : 'var(--ok)') + ';font-weight:600">' + depth.toFixed(2) + '</span>'
        : '<span style="color:var(--txt-3)">—</span>';
      return '<tr style="border-bottom:1px solid var(--line-2)">' +
        '<td style="padding:5px 8px;color:var(--txt-1)">' + w.date + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-3)">' + (w.time || '—') + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-2)">' + (sump ? escHTML(sump.name) : '—') + '</td>' +
        '<td style="padding:5px 8px;text-align:right;font-weight:600;color:var(--txt-1)">' + parseFloat(w.elevation).toFixed(2) + '</td>' +
        '<td style="padding:5px 8px;text-align:right">' + depthStr + '</td>' +
        '<td style="padding:5px 8px;color:var(--txt-3)">' + escHTML(w.measuredBy || '') + '</td>' +
        '<td style="padding:5px 8px"><button class="btn btn-sm" style="font-size:10px;padding:2px 5px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dewDeleteWaterLevel(\'' + w.id + '\')">✕</button></td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';

  _dewRenderLevelsChart(records, sumpId);
}

function _dewRenderLevelsChart(records, sumpId) {
  var el = document.getElementById('dew-lv-chart');
  if (!el || !records.length || !sumpId) { if(el) el.innerHTML=''; return; }

  var pts = records.slice().reverse().slice(-30);
  var elevs = pts.map(function(w) { return parseFloat(w.elevation); });
  var minE = Math.min.apply(null, elevs), maxE = Math.max.apply(null, elevs);
  var range = maxE - minE || 1;

  var W = 420, H = 90, PL = 50, PR = 10, PT = 8, PB = 20;
  var cW = W - PL - PR, cH = H - PT - PB;
  var n = pts.length;
  function px(i) { return PL + (i / Math.max(n - 1, 1)) * cW; }
  function py(v) { return PT + (1 - (v - minE) / range) * cH; }

  var linePts = pts.map(function(w, i) { return px(i).toFixed(1) + ',' + py(parseFloat(w.elevation)).toFixed(1); }).join(' ');
  var smoothLine = _anlPtsToSmooth ? _anlPtsToSmooth(linePts) : ('M ' + linePts.replace(/ /g, ' L '));
  var areaPath = smoothLine + ' L' + px(n-1).toFixed(1) + ',' + (PT+cH) + ' L' + PL + ',' + (PT+cH) + ' Z';

  var yLines = [minE, (minE+maxE)/2, maxE].map(function(v) {
    var y = py(v).toFixed(1);
    return '<line x1="' + PL + '" y1="' + y + '" x2="' + (W-PR) + '" y2="' + y + '" stroke="rgba(255,255,255,.05)" stroke-width="1"/>' +
           '<text x="' + (PL-3) + '" y="' + (parseFloat(y)+3) + '" fill="var(--txt-3)" font-size="8" text-anchor="end">' + v.toFixed(1) + '</text>';
  }).join('');

  var xLbls = pts.filter(function(_,i){return i===0||i===n-1;}).map(function(w,_,arr) {
    var i = pts.indexOf(w);
    return '<text x="' + px(i).toFixed(1) + '" y="' + (H-3) + '" fill="var(--txt-3)" font-size="7" text-anchor="middle">' + w.date.slice(5) + '</text>';
  }).join('');

  el.innerHTML =
    '<div style="font-size:10px;color:var(--txt-3);margin-bottom:4px">Динамика отметки зеркала воды (м абс.)</div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block">' +
    '<defs><linearGradient id="lwGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--blue)" stop-opacity=".25"/><stop offset="100%" stop-color="var(--blue)" stop-opacity="0"/></linearGradient></defs>' +
    yLines +
    '<path d="' + areaPath + '" fill="url(#lwGrad)"/>' +
    '<path d="' + smoothLine + '" fill="none" stroke="var(--blue)" stroke-width="1.5"/>' +
    '<text x="' + (PL-3) + '" y="' + (H/2) + '" fill="var(--txt-3)" font-size="8" text-anchor="middle" transform="rotate(-90 ' + (PL-3) + ' ' + (H/2) + ')">м абс.</text>' +
    xLbls + '</svg>';
}

function _dewDeleteWaterLevel(id) {
  if (!confirm('Удалить замер уровня воды?')) return;
  DewateringState.deleteWaterLevel(id);
  _dewRenderLevelsTable(_dewLFilter.sumpId);
}

// ── Аналитика ────────────────────────────────────────────────

function _dewRenderAnalytics() {
  var el = document.getElementById('dew-panel-analytics');
  if (!el) return;
  el.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      '<div class="card" style="padding:14px"><div class="card-title">Объём откачки (м³/сутки) · 30 дней</div><div id="dew-ch-trend"></div></div>' +
      '<div class="card" style="padding:14px"><div class="card-title">Распределение по направлениям</div><div id="dew-ch-dest"></div></div>' +
      '<div class="card" style="padding:14px"><div class="card-title">Объём по насосам (всё время)</div><div id="dew-ch-pumps"></div></div>' +
      '<div class="card" style="padding:14px"><div class="card-title">Сравнение зумпфов (3 месяца)</div><div id="dew-ch-sumps"></div></div>' +
    '</div>';
  _dewChartTrend(); _dewChartDest(); _dewChartPumps(); _dewChartSumps();
}

function _dewChartTrend() {
  var el = document.getElementById('dew-ch-trend');
  if (!el) return;
  var days = [];
  for (var i = 29; i >= 0; i--) { var d = new Date(); d.setDate(d.getDate()-i); days.push(d.toISOString().slice(0,10)); }

  var data = days.map(function(day) {
    var vol = DewateringState.meterReadings.filter(function(r){return r.date===day;})
      .reduce(function(a,r){return a+(DewateringState.computedVolume(r)||0);},0);
    return { day: day, vol: vol };
  });

  var maxV = Math.max.apply(null, data.map(function(d){return d.vol;})) || 1;
  var W=360, H=110, PL=38, PR=8, PT=8, PB=22;
  var cW=W-PL-PR, cH=H-PT-PB, n=data.length;
  var bW=Math.max(1, Math.floor(cW/n)-1);

  var bars = data.map(function(d,i) {
    if (!d.vol) return '';
    var bH=Math.max(2,(d.vol/maxV)*cH), x=PL+i*(cW/n)+1, y=PT+cH-bH;
    return '<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bW+'" height="'+bH.toFixed(1)+'" fill="'+(i===n-1?'var(--gold)':'var(--blue)')+'" opacity=".75" rx="1"><title>'+d.day+': '+d.vol.toFixed(0)+' м³</title></rect>';
  }).join('');

  var yLines = [0,maxV/2,maxV].map(function(v){
    var y=(PT+cH-(v/maxV)*cH).toFixed(1);
    return '<line x1="'+PL+'" y1="'+y+'" x2="'+(W-PR)+'" y2="'+y+'" stroke="rgba(255,255,255,.05)" stroke-width="1"/>' +
           '<text x="'+(PL-3)+'" y="'+(parseFloat(y)+3)+'" fill="var(--txt-3)" font-size="8" text-anchor="end">'+Math.round(v)+'</text>';
  }).join('');

  var xLbls = data.filter(function(_,i){return i%7===0||i===n-1;}).map(function(d){
    var i=data.indexOf(d), x=PL+i*(cW/n)+bW/2;
    return '<text x="'+x.toFixed(1)+'" y="'+(H-4)+'" fill="var(--txt-3)" font-size="7" text-anchor="middle">'+d.day.slice(5)+'</text>';
  }).join('');

  el.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;display:block">'+yLines+bars+xLbls+'</svg>' +
    (data.every(function(d){return d.vol===0;}) ? '<p style="color:var(--txt-3);font-size:11px;text-align:center;margin:4px 0">Нет данных за последние 30 дней</p>' : '');
}

function _dewChartDest() {
  var el = document.getElementById('dew-ch-dest');
  if (!el) return;
  var byDest = {};
  DewateringState.meterReadings.forEach(function(r) {
    if (!r.destinationId) return;
    var v = DewateringState.computedVolume(r) || 0;
    byDest[r.destinationId] = (byDest[r.destinationId] || 0) + v;
  });
  var total = Object.keys(byDest).reduce(function(a,k){return a+byDest[k];},0);
  if (!total) { el.innerHTML='<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет данных</p>'; return; }
  var clrs = ['var(--gold)','var(--ok)','var(--warn)','var(--bad)','#bc8cff','#58a6ff'];
  var entries = Object.keys(byDest).map(function(k,i){
    var d=DewateringState.destById(k);
    return {name: d?d.name:'Не указано', vol:byDest[k], clr:clrs[i%clrs.length]};
  }).sort(function(a,b){return b.vol-a.vol;});
  el.innerHTML = entries.map(function(e){
    var pct=Math.round(e.vol/total*100);
    return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">' +
      '<span style="color:var(--txt-2)">'+escHTML(e.name)+'</span>' +
      '<span style="color:'+e.clr+';font-weight:600">'+e.vol.toFixed(0)+' м³ <span style="color:var(--txt-3);font-weight:400">('+pct+'%)</span></span>' +
      '</div><div style="background:var(--bg-1);border-radius:3px;height:5px;overflow:hidden">' +
      '<div style="height:100%;width:'+pct+'%;background:'+e.clr+';border-radius:3px"></div></div></div>';
  }).join('') + '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:11px;color:var(--txt-3)">Всего: <b style="color:var(--txt-1)">'+total.toFixed(0)+' м³</b></div>';
}

function _dewChartPumps() {
  var el = document.getElementById('dew-ch-pumps');
  if (!el) return;
  if (!DewateringState.pumps.length) { el.innerHTML='<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет насосов</p>'; return; }
  var pumps = DewateringState.pumps.slice().sort(function(a,b){return DewateringState.totalVolumePump(b.id)-DewateringState.totalVolumePump(a.id);});
  var maxV = DewateringState.totalVolumePump(pumps[0].id) || 1;
  el.innerHTML = pumps.map(function(p) {
    var vol=DewateringState.totalVolumePump(p.id), pct=Math.round(vol/maxV*100);
    var st=DEW_PUMP_STATUS[p.status]||DEW_PUMP_STATUS.off;
    var clr=p.status==='working'?'var(--ok)':p.status==='standby'?'var(--blue)':p.status==='repair'?'var(--warn)':'var(--txt-3)';
    return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;margin-bottom:3px">' +
      '<div style="display:flex;align-items:center;gap:6px"><span style="color:var(--txt-1)">'+escHTML(p.name)+'</span>' +
      '<span class="anl-pill anl-pill-'+st.cls+'" style="font-size:9px">'+st.label+'</span></div>' +
      '<span style="color:var(--txt-2)">'+vol.toFixed(0)+' м³</span></div>' +
      '<div style="background:var(--bg-1);border-radius:3px;height:6px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+clr+';border-radius:3px"></div></div></div>';
  }).join('');
}

function _dewChartSumps() {
  var el = document.getElementById('dew-ch-sumps');
  if (!el) return;
  if (!DewateringState.sumps.length) { el.innerHTML='<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет зумпфов</p>'; return; }
  var now=new Date(), ruM=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  var months=[];
  for(var i=2;i>=0;i--){var d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({key:d.toISOString().slice(0,7),label:ruM[d.getMonth()]});}
  var clrs=['var(--gold)','var(--ok)','var(--warn)','var(--bad)','#bc8cff'];
  var rows=DewateringState.sumps.map(function(sump,si){
    var pIds=DewateringState.pumpsOfSump(sump.id).map(function(p){return p.id;});
    var vols=months.map(function(m){
      return DewateringState.meterReadings.filter(function(r){return r.date.slice(0,7)===m.key&&pIds.indexOf(r.pumpId)>=0;})
        .reduce(function(a,r){return a+(DewateringState.computedVolume(r)||0);},0);
    });
    return {sump:sump,vols:vols,clr:clrs[si%clrs.length]};
  });
  var maxV=0; rows.forEach(function(r){r.vols.forEach(function(v){if(v>maxV)maxV=v;});}); maxV=maxV||1;
  el.innerHTML=rows.map(function(r){
    return '<div style="margin-bottom:14px"><div style="font-size:11px;color:var(--txt-1);font-weight:600;margin-bottom:6px">'+escHTML(r.sump.name)+'</div>' +
      '<div style="display:flex;gap:6px;align-items:flex-end;height:48px">' +
      r.vols.map(function(v,i){
        var h=v>0?Math.max(4,Math.round(v/maxV*42)):0;
        return '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1">' +
          '<div style="font-size:9px;color:var(--txt-3)">'+(v>0?v.toFixed(0):'')+'</div>' +
          '<div style="width:100%;background:'+r.clr+';height:'+h+'px;border-radius:2px 2px 0 0;opacity:.8"></div>' +
          '<div style="font-size:9px;color:var(--txt-3)">'+months[i].label+'</div></div>';
      }).join('') + '</div></div>';
  }).join('');
}

// ── Helpers ──────────────────────────────────────────────────

function _dewFld(label, type, id, value, placeholder) {
  return '<div class="form-group"><label class="form-label">' + escHTML(label) + '</label>' +
    '<input type="' + type + '" id="' + id + '" class="form-control"' +
    ' value="' + escAttr(String(value != null ? value : '')) + '"' +
    (placeholder ? ' placeholder="' + escAttr(placeholder) + '"' : '') + '></div>';
}
